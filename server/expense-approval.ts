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
import { expenses, users, expenseReceipts, systemSettings } from "@shared/schema";
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

// ── Two-stage approval pools (Jun 2026) ──────────────────────────────────────
// Stage 1 (info check): goes to Wendy (accounts@) by default — see the
// stage-1 routing block below for the Wendy↔Layla cover toggle. STAGE1_SLOTS
// is retained as the finance-approver set for the diagnostic + receipt-view
// permission (both Wendy and Layla may always open a receipt).
// Stage 2 (spend sign-off): once stage 1 passes, it goes to one of the
// directors — Woody / Charlotte / Jack / Rupert — random even split. The
// submitter is excluded from their own pool. Each "slot" is one person; the
// inner array is that person's candidate logins (Wendy signs in as accounts@).
const STAGE1_SLOTS: string[][] = [
  ["wendy@brucegillinghampollard.com", "accounts@brucegillinghampollard.com"],
  ["layla@brucegillinghampollard.com"],
];
const STAGE2_SLOTS: string[][] = [
  ["woody@brucegillinghampollard.com"],
  ["charlotte@brucegillinghampollard.com"],
  ["jack@brucegillinghampollard.com"],
  ["rupert@brucegillinghampollard.com"],
];

// Stage-1 routing. The initial HMRC/info pass goes to Wendy (accounts@) by
// default — she does the first approvals, not a Wendy/Layla coin-flip. When
// she's away or busy she flips "cover" on from the approvals page and both
// new AND outstanding stage-1 items route to Layla instead; flipping it off
// hands them back to Wendy. Persisted in system_settings so it survives
// restarts and is shared across her devices.
const WENDY_EMAILS = ["accounts@brucegillinghampollard.com", "wendy@brucegillinghampollard.com"];
const LAYLA_EMAILS = ["layla@brucegillinghampollard.com"];
const STAGE1_COVER_KEY = "expense_stage1_cover";

export async function getStage1Cover(): Promise<boolean> {
  const [row] = await db.select().from(systemSettings).where(eq(systemSettings.key, STAGE1_COVER_KEY)).limit(1);
  return !!(row?.value as any)?.active;
}

export async function setStage1Cover(active: boolean): Promise<void> {
  await db.insert(systemSettings)
    .values({ key: STAGE1_COVER_KEY, value: { active } as any })
    .onConflictDoUpdate({ target: systemSettings.key, set: { value: { active } as any, updatedAt: new Date() } });
}

// Resolve the current stage-1 approver: Wendy normally, Layla while she's
// covering. Never the submitter themselves — if the primary IS the submitter
// (e.g. Wendy submits her own expense) it falls to the other finance approver.
async function pickStage1Approver(submitterUserId: string | null): Promise<string | null> {
  const cover = await getStage1Cover();
  const primaryEmails = cover ? LAYLA_EMAILS : WENDY_EMAILS;
  const backupEmails = cover ? WENDY_EMAILS : LAYLA_EMAILS;
  const primary = await resolveUserIdByEmails(primaryEmails);
  if (primary && primary !== submitterUserId) return primary;
  const backup = await resolveUserIdByEmails(backupEmails);
  if (backup && backup !== submitterUserId) return backup;
  return primary || backup;   // last resort — never strand the row
}

// Move every outstanding stage-1 item to whoever's on the initial pass now.
// Called when cover flips so the backlog follows Wendy ↔ Layla, not just new
// submissions.
export async function reassignPendingStage1(): Promise<number> {
  const rows = await db
    .select({ id: expenses.id, submitterUserId: expenses.submitterUserId })
    .from(expenses)
    .where(and(eq(expenses.status, "pending_approval"), eq(expenses.approvalStage, 1)));
  let n = 0;
  for (const r of rows) {
    const approver = await pickStage1Approver(r.submitterUserId);
    await db.update(expenses).set({ approverUserId: approver, updatedAt: new Date() }).where(eq(expenses.id, r.id));
    n++;
  }
  return n;
}

async function resolveUserIdByEmails(emails: string[]): Promise<string | null> {
  for (const e of emails) {
    // is_active IS NOT FALSE — treat NULL (never-set) as active, so an
    // approver whose flag was never explicitly set isn't silently dropped
    // from the rota (that left Layla with zero items while everything went
    // to Wendy). Prefer an explicitly-active row if there are duplicates.
    const r = await pool.query<{ id: string }>(
      `SELECT id FROM users
        WHERE lower(email) = $1 AND is_active IS NOT FALSE
        ORDER BY is_active DESC NULLS LAST
        LIMIT 1`,
      [e.toLowerCase()],
    );
    if (r.rows[0]?.id) return r.rows[0].id;
  }
  return null;
}

/** Diagnostic: resolve both stage pools to names so an admin can see exactly
 *  who's on the rota (and spot anyone missing). */
export async function describeApproverPools(): Promise<{
  stage1: Array<{ id: string; name: string | null; email: string | null }>;
  stage2: Array<{ id: string; name: string | null; email: string | null }>;
}> {
  const hydrate = async (ids: string[]) => {
    if (ids.length === 0) return [];
    const r = await pool.query<{ id: string; name: string | null; email: string | null }>(
      `SELECT id, name, email FROM users WHERE id = ANY($1)`,
      [ids],
    );
    // Preserve pool order.
    return ids.map((id) => r.rows.find((row) => row.id === id) || { id, name: null, email: null });
  };
  const [s1, s2] = await Promise.all([resolvePool(STAGE1_SLOTS), resolvePool(STAGE2_SLOTS)]);
  return { stage1: await hydrate(s1), stage2: await hydrate(s2) };
}

// Resolve each slot to a single user id (first existing login), deduped.
async function resolvePool(slots: string[][]): Promise<string[]> {
  const ids: string[] = [];
  for (const slot of slots) {
    const id = await resolveUserIdByEmails(slot);
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

// Pick a random approver from the stage pool, excluding the submitter so
// nobody approves their own spend. Falls back to the full pool if excluding
// the submitter would empty it (shouldn't happen, but never strand a row).
async function pickStageApprover(stage: 1 | 2, submitterUserId: string | null): Promise<string | null> {
  // Stage 1 is a single named approver (Wendy, or Layla while covering), not
  // a random pool. Stage 2 stays a random even split across the directors.
  if (stage === 1) return pickStage1Approver(submitterUserId);
  const fullPool = await resolvePool(STAGE2_SLOTS);
  if (fullPool.length === 0) return null;
  const eligible = submitterUserId ? fullPool.filter((id) => id !== submitterUserId) : fullPool;
  const use = eligible.length > 0 ? eligible : fullPool;
  return use[Math.floor(Math.random() * use.length)];
}

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
  // Stage 1: assign to Wendy OR Layla (random 50/50), excluding the
  // submitter so a finance approver never checks their own expense.
  const approverUserId = await pickStageApprover(1, resolvedSubmitter || null);

  await db.update(expenses).set({
    status: "pending_approval",
    approvalStage: 1,
    stage1ApprovedByUserId: null,
    stage1ApprovedAt: null,
    submitterUserId: resolvedSubmitter || exp.submitterUserId || null,
    submittedForApprovalAt: exp.submittedForApprovalAt || new Date(),
    approverUserId,
    flaggedForReview: reasons.length > 0,
    flagReasons: reasons,
    updatedAt: new Date(),
  }).where(eq(expenses.id, expenseId));
}

/**
 * Approve the current stage of an expense. Stage 1 (Wendy/Layla info check)
 * advances the row to stage 2 and randomly assigns a director; stage 2
 * (director sign-off) finalises it to `approved`. Returns the outcome so the
 * route knows whether to post to Xero (only on final approval).
 */
export async function approveExpense(
  approverUserId: string,
  expenseId: string,
  notes: string | null,
): Promise<{ outcome: "advanced" | "approved" | "noop"; stage: number; nextApproverUserId?: string | null }> {
  const [exp] = await db.select().from(expenses).where(eq(expenses.id, expenseId)).limit(1);
  if (!exp || exp.status !== "pending_approval") return { outcome: "noop", stage: exp?.approvalStage ?? 0 };

  const stage = exp.approvalStage ?? 1;

  if (stage === 1) {
    // Info check passed → hand to a director for spend sign-off.
    const nextApprover = await pickStageApprover(2, exp.submitterUserId || null);
    await db.update(expenses).set({
      approvalStage: 2,
      approverUserId: nextApprover,
      stage1ApprovedByUserId: approverUserId,
      stage1ApprovedAt: new Date(),
      approvalNotes: notes ?? exp.approvalNotes,
      updatedAt: new Date(),
    }).where(eq(expenses.id, expenseId));
    return { outcome: "advanced", stage: 2, nextApproverUserId: nextApprover };
  }

  // Stage 2 → final approval.
  await db.update(expenses).set({
    status: "approved",
    approvedAt: new Date(),
    approvedByUserId: approverUserId,
    approvalNotes: notes ?? exp.approvalNotes,
    updatedAt: new Date(),
  }).where(eq(expenses.id, expenseId));
  return { outcome: "approved", stage: 2 };
}

/**
 * Backfill: assign a stage-1 approver to any pending_approval row that
 * predates the two-stage model (approval_stage null or 0, or no approver).
 * Runs once on boot — cheap and idempotent.
 */
export async function backfillApprovalStages(): Promise<number> {
  const { rows } = await pool.query<{ id: string; submitter_user_id: string | null }>(
    `SELECT id, submitter_user_id FROM expenses
      WHERE status = 'pending_approval'
        AND (approval_stage IS NULL OR approval_stage = 0 OR approver_user_id IS NULL)`,
  );
  let fixed = 0;
  for (const r of rows) {
    const approver = await pickStageApprover(1, r.submitter_user_id);
    await pool.query(
      `UPDATE expenses SET approval_stage = 1, approver_user_id = $1, updated_at = NOW() WHERE id = $2`,
      [approver, r.id],
    );
    fixed++;
  }
  if (fixed > 0) console.log(`[expense-approval] backfilled ${fixed} pending row(s) into stage 1`);
  return fixed;
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
  if ((u as any).isAdmin) return true;          // admin override (covers the directors)
  const [exp] = await db.select().from(expenses).where(eq(expenses.id, expenseId)).limit(1);
  if (!exp) return false;
  // Two-stage model: you can only approve the row currently assigned to you.
  if (exp.approverUserId === approverUserId) return true;
  // Safety net: an unassigned row (assignment failed) is still actionable by
  // a fallback finance approver so nothing strands.
  const email = ((u as any).email || "").toLowerCase();
  return exp.approverUserId == null && FALLBACK_APPROVER_EMAILS.has(email);
}

/** Who may VIEW an expense's receipt. Deliberately broader than
 *  canApproveExpense: any finance approver (Layla/Wendy) or rota member can
 *  open a receipt to check it — not just whoever it's currently assigned to —
 *  plus the expense's own submitter and admins. Owner-by-cardholder is covered
 *  separately by userCanAccessExpense at the route. */
export async function canViewExpenseReceipt(userId: string, expenseId: string): Promise<boolean> {
  const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!u) return false;
  if ((u as any).isAdmin) return true;
  const [exp] = await db.select().from(expenses).where(eq(expenses.id, expenseId)).limit(1);
  if (!exp) return false;
  if (exp.submitterUserId === userId || exp.createdBy === userId || exp.approverUserId === userId) return true;
  // Finance shared inbox (Layla / Wendy / accounts) can view any receipt.
  const email = ((u as any).email || "").toLowerCase();
  if (FALLBACK_APPROVER_EMAILS.has(email)) return true;
  // Anyone on either approval rota can view (e.g. a director at sign-off).
  const approverPool = new Set([
    ...(await resolvePool(STAGE1_SLOTS)),
    ...(await resolvePool(STAGE2_SLOTS)),
  ]);
  return approverPool.has(userId);
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
  // Each approver works their own randomly-assigned queue. Fallback finance
  // approvers (and admins) also see any unassigned rows so a failed
  // assignment never disappears.
  const seesUnassigned = (u as any).isAdmin || FALLBACK_APPROVER_EMAILS.has(email);

  const rows = await db
    .select()
    .from(expenses)
    .where(and(
      eq(expenses.status, "pending_approval"),
      seesUnassigned
        ? or(eq(expenses.approverUserId, approverUserId), isNull(expenses.approverUserId))!
        : eq(expenses.approverUserId, approverUserId),
    ))
    .orderBy(desc(expenses.submittedForApprovalAt));

  return rows;
}
