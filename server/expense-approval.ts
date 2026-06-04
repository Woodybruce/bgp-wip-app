// Expense approval workflow.
//
// Routing: every expense submitted for approval is assigned to the
// submitter's manager (users.managerId). When the manager is unset or
// is the submitter, the expense falls into the shared inbox monitored
// by Layla and Wendy (FALLBACK_APPROVER_EMAILS). Either one can approve;
// admins can override anyone's decisions.
//
// Flagging: each submission runs through a fixed set of pre-approval
// checks. Anything that trips a check gets flagged_for_review = true
// with the trigger reason in flag_reasons. The inbox UI groups by
// flagged vs clean so the approver can bulk-approve the clean section
// and review only the flagged ones.

import { db, pool } from "./db";
import { expenses, users, expenseReceipts } from "@shared/schema";
import { eq, and, desc, gte, isNull, or, sql, inArray } from "drizzle-orm";

// Layla + Wendy are the fallback approvers when an agent has no manager
// set or their manager is the submitter. Hardcoded to mirror the pattern
// in server/crm.ts:2660 (SENIOR_EMAILS for deal approvals). Move to
// system_settings if the list ever needs to change without a deploy.
export const FALLBACK_APPROVER_EMAILS = new Set([
  "layla@brucegillinghampollard.com",
  "wendy@brucegillinghampollard.com",
  "accounts@brucegillinghampollard.com",   // Wendy McKenzie's actual login
]);

// Entertainment categories trigger extra scrutiny — these are the ones
// that need a business purpose + attendees for HMRC compliance.
const ENTERTAINMENT_CATEGORIES = new Set([
  "Client Entertainment",
  "Agent Entertainment (External)",
  "Staff Entertainment",
  "Directors Meetings",
  "Meals & Drinks",
]);

const HIGH_VALUE_THRESHOLD_PENCE = 20000; // £200

export type FlagReason =
  | "missing_receipt"
  | "entertainment_no_purpose"
  | "entertainment_no_attendees"
  | "high_value_no_purpose"
  | "possible_duplicate"
  | "category_not_set";

/**
 * Compute the flag reasons for an expense at submission time. Returns
 * an empty array if the row is clean. Idempotent — safe to re-run on
 * every PATCH and on the submit-for-approval transition.
 */
export async function computeFlagReasons(expenseId: string): Promise<FlagReason[]> {
  const [exp] = await db.select().from(expenses).where(eq(expenses.id, expenseId)).limit(1);
  if (!exp) return [];

  const reasons: FlagReason[] = [];

  // Receipt check: anything not personal needs a receipt before it can
  // post to Xero.
  if (!exp.isPersonal) {
    const receipts = await db.select().from(expenseReceipts).where(eq(expenseReceipts.expenseId, expenseId)).limit(1);
    if (receipts.length === 0 && !exp.receiptFilename) {
      reasons.push("missing_receipt");
    }
  }

  if (!exp.category) {
    reasons.push("category_not_set");
  }

  // Entertainment: HMRC needs purpose + attendees for client/agent meals
  // to be deductible. Staff entertainment is more lenient but still wants
  // a purpose for audit. Attendees can come from either the structured
  // join (manual edit via the CRM picker) or the legacy free-text column
  // (Outlook calendar context for inbound WhatsApp receipts).
  if (exp.category && ENTERTAINMENT_CATEGORIES.has(exp.category)) {
    if (!exp.businessPurpose || exp.businessPurpose.trim().length < 5) {
      reasons.push("entertainment_no_purpose");
    }
    const { expenseAttendees } = await import("@shared/schema");
    const linkedAttendees = await db.select().from(expenseAttendees).where(eq(expenseAttendees.expenseId, expenseId)).limit(1);
    const hasFreetextAttendees = !!exp.attendees && exp.attendees.trim().length >= 3;
    if (linkedAttendees.length === 0 && !hasFreetextAttendees) {
      reasons.push("entertainment_no_attendees");
    }
  }

  // High-value (£200+) on any category needs a purpose. Card transactions
  // above this often need PO/justification for the year-end review.
  if (exp.amountPence >= HIGH_VALUE_THRESHOLD_PENCE) {
    if (!exp.businessPurpose || exp.businessPurpose.trim().length < 5) {
      reasons.push("high_value_no_purpose");
    }
  }

  // Possible duplicate: same merchant + ±10% amount + ±1 day, owned by
  // the same cardholder, NOT including the current row. Catches the
  // "submitted twice" mistake.
  if (exp.merchant && exp.cardholderId && exp.transactionDate) {
    const txnDate = new Date(exp.transactionDate);
    const lo = new Date(txnDate.getTime() - 24 * 60 * 60 * 1000);
    const hi = new Date(txnDate.getTime() + 24 * 60 * 60 * 1000);
    const amountLo = Math.floor(exp.amountPence * 0.9);
    const amountHi = Math.ceil(exp.amountPence * 1.1);
    const dupes = await pool.query(
      `SELECT id FROM expenses
        WHERE cardholder_id = $1
          AND lower(merchant) = lower($2)
          AND transaction_date BETWEEN $3 AND $4
          AND amount_pence BETWEEN $5 AND $6
          AND id <> $7
        LIMIT 1`,
      [exp.cardholderId, exp.merchant, lo.toISOString(), hi.toISOString(), amountLo, amountHi, exp.id]
    );
    if ((dupes.rowCount ?? 0) > 0) reasons.push("possible_duplicate");
  }

  return reasons;
}

/** Transition an expense to pending_approval. Computes flag reasons,
 *  resolves the approver (manager → shared inbox), stamps submitted_at,
 *  and persists. Idempotent — re-running re-evaluates flags but doesn't
 *  bump submittedForApprovalAt if already set. Called by every site that
 *  used to write status='pending_approval' directly. */
export async function submitForApproval(expenseId: string, submitterUserId: string | null): Promise<void> {
  const [exp] = await db.select().from(expenses).where(eq(expenses.id, expenseId)).limit(1);
  if (!exp) return;

  const reasons = await computeFlagReasons(expenseId);

  // Resolve approver. Cardholder.userId is the canonical link; fall back
  // to the passed submitterUserId for cash claims via WhatsApp / dashboard.
  let resolvedSubmitter = submitterUserId;
  if (!resolvedSubmitter && exp.cardholderId) {
    const { stripeCardholders } = await import("@shared/schema");
    const [ch] = await db.select().from(stripeCardholders).where(eq(stripeCardholders.id, exp.cardholderId)).limit(1);
    resolvedSubmitter = (ch as any)?.userId || null;
  }
  const approverUserId = resolvedSubmitter ? await resolveApproverUserId(resolvedSubmitter) : null;

  // Admins with no manager (e.g. the MD) used to auto-approve their own
  // spend and post straight to Xero. Per Woody (June 2026) that's wrong —
  // he wants Wendy to sign his expenses off like everyone else's. So they
  // now route to the Layla/Wendy finance shared inbox (approverUserId null,
  // which the fallback approvers see) rather than self-approving.

  await db.update(expenses).set({
    status: "pending_approval",
    submitterUserId: resolvedSubmitter || exp.submitterUserId || null,
    submittedForApprovalAt: exp.submittedForApprovalAt || new Date(),
    approverUserId,
    flaggedForReview: reasons.length > 0,
    flagReasons: reasons,
    updatedAt: new Date(),
  }).where(eq(expenses.id, expenseId));
}

/** Resolve the approver for a given submitter. Returns the manager's
 *  user id, or null if the expense should go to the Layla/Wendy shared
 *  inbox (no manager set OR manager is the submitter).
 *
 *  Reads users.manager_id first (canonical going forward — mirrored from
 *  staff_profiles on every write). Falls back to staff_profiles.manager_id
 *  for rows the boot backfill hasn't reconciled yet, so a fresh install
 *  with seeded staff still routes correctly before the next HR edit. */
export async function resolveApproverUserId(submitterUserId: string): Promise<string | null> {
  const [u] = await db.select().from(users).where(eq(users.id, submitterUserId)).limit(1);
  if (!u) return null;
  let managerId: string | null = (u as any).managerId ?? null;
  if (!managerId) {
    const sp = await pool.query<{ manager_id: string | null }>(
      "SELECT manager_id FROM staff_profiles WHERE user_id = $1 LIMIT 1",
      [submitterUserId]
    );
    managerId = sp.rows[0]?.manager_id ?? null;
  }
  if (!managerId || managerId === submitterUserId) return null;
  return managerId;
}

/** Is this user allowed to approve this expense? Either it's their
 *  direct report (assigned), they're a fallback approver (Layla/Wendy),
 *  or they're an admin. */
export async function canApproveExpense(approverUserId: string, expenseId: string): Promise<boolean> {
  const [u] = await db.select().from(users).where(eq(users.id, approverUserId)).limit(1);
  if (!u) return false;
  if ((u as any).isAdmin) return true;
  const email = ((u as any).email || "").toLowerCase();
  if (FALLBACK_APPROVER_EMAILS.has(email)) return true;
  const [exp] = await db.select().from(expenses).where(eq(expenses.id, expenseId)).limit(1);
  if (!exp) return false;
  return exp.approverUserId === approverUserId;
}

/** List of expenses an approver can act on. Includes:
 *  - Rows where approver_user_id = approverUserId (their direct reports)
 *  - Rows where approver_user_id IS NULL AND the approver is in the
 *    fallback pool (Layla/Wendy/admins) — the shared inbox
 *  All filtered to status = 'pending_approval'. */
export async function listPendingForApprover(approverUserId: string) {
  const [u] = await db.select().from(users).where(eq(users.id, approverUserId)).limit(1);
  if (!u) return [];
  const email = ((u as any).email || "").toLowerCase();
  const isFallback = (u as any).isAdmin || FALLBACK_APPROVER_EMAILS.has(email);

  const rows = await db
    .select()
    .from(expenses)
    .where(and(
      eq(expenses.status, "pending_approval"),
      isFallback
        ? or(eq(expenses.approverUserId, approverUserId), isNull(expenses.approverUserId))!
        : eq(expenses.approverUserId, approverUserId),
    ))
    .orderBy(desc(expenses.submittedForApprovalAt));

  return rows;
}
