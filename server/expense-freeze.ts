// ─────────────────────────────────────────────────────────────────────────
// Month-end card auto-freeze.
//
// Policy (configured in CLAUDE convo Jun 2026):
//   • On the 1st of each new month at 09:00 UTC, sweep every cardholder.
//   • If they have one or more Revolut card swipes older than 3 days that
//     are still missing a receipt (and not marked personal, and ≥ £10),
//     freeze their Revolut card AND flip the local status to inactive.
//   • Admin cardholders are exempt.
//   • Auto-unfreezes the moment they upload a receipt OR mark the
//     expense personal (payroll deduction). The receipt-upload and
//     mark-personal routes call unfreezeIfClear() after their own work.
//
// Frozen state is NOT a new schema column — it's derived live from the
// existing stripe_cardholders.status flag plus a recompute of blocking
// expenses for the banner. That keeps this feature off the migrations
// path and reversible by hand if needed.
// ─────────────────────────────────────────────────────────────────────────

import { db } from "./db";
import { expenses, stripeCardholders, users } from "@shared/schema";
import { and, eq, lt, ne } from "drizzle-orm";
import { freezeRevolutCard, unfreezeRevolutCard, resolveRevolutCardIdForCardholder } from "./revolut";

// £10 floor — Trainline, parking, etc. just nag, don't freeze.
const MIN_AMOUNT_PENCE = 1000;
// 3-day grace window: an expense isn't "overdue" until its txn date is
// > 3 days ago. Keeps a freeze from firing on a Jan 31 dinner if you
// don't get to it before the Feb 1 09:00 sweep.
const GRACE_DAYS = 3;

export interface BlockingExpense {
  id: string;
  merchant: string | null;
  amountPence: number;
  transactionDate: Date | null;
}

export interface FreezeOutcome {
  cardholderId: string;
  userName: string;
  blockingCount: number;
  blockingTotalPence: number;
  revolutFrozen: boolean;     // true if the Revolut API call succeeded
  revolutError: string | null;  // surfaced verbatim when CARDS_FULL scope is missing etc.
  alreadyInactive: boolean;
}

// ─── Per-cardholder blocking-expense check ────────────────────────────────
//
// Returns every pending-receipt expense for the cardholder that's:
//   - older than the grace window
//   - not marked personal
//   - >= £10
// The caller uses len > 0 as the freeze condition, and the list itself
// powers the "your card is frozen because X, Y, Z" banner.

export async function getBlockingExpenses(cardholderId: string): Promise<BlockingExpense[]> {
  const cutoff = new Date(Date.now() - GRACE_DAYS * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({
      id: expenses.id,
      merchant: expenses.merchant,
      amountPence: expenses.amountPence,
      transactionDate: expenses.transactionDate,
    })
    .from(expenses)
    .where(
      and(
        eq(expenses.cardholderId, cardholderId),
        eq(expenses.status, "pending_receipt"),
        // mark-personal flips isPersonal=true, so excluded rows clear the freeze.
        ne(expenses.isPersonal, true),
        lt(expenses.transactionDate, cutoff),
      ),
    );
  return rows
    .filter((r) => (r.amountPence || 0) >= MIN_AMOUNT_PENCE)
    .map((r) => ({
      id: r.id,
      merchant: r.merchant,
      amountPence: r.amountPence,
      transactionDate: r.transactionDate,
    }));
}

// Card id lookup goes through revolut.ts so we get the cardholders-row
// preferred + stripe_cards fallback behaviour and the lazy backfill.
const getRevolutCardIdFor = (cardholderId: string) => resolveRevolutCardIdForCardholder(cardholderId);

// ─── Freeze one cardholder ───────────────────────────────────────────────
//
// Idempotent: skips if already inactive (avoids spamming Revolut). The
// Revolut call is best-effort — if the token lacks CARDS_FULL, we still
// flip the local flag so the dashboard reflects intent and surface the
// error to logs so an admin can fix the scope.

async function freezeOne(cardholderId: string, userName: string, blocking: BlockingExpense[]): Promise<FreezeOutcome> {
  const [ch] = await db.select().from(stripeCardholders).where(eq(stripeCardholders.id, cardholderId)).limit(1);
  if (!ch) {
    return { cardholderId, userName, blockingCount: blocking.length, blockingTotalPence: 0, revolutFrozen: false, revolutError: "cardholder not found", alreadyInactive: false };
  }
  const total = blocking.reduce((s, b) => s + (b.amountPence || 0), 0);
  if (ch.status === "inactive") {
    return { cardholderId, userName, blockingCount: blocking.length, blockingTotalPence: total, revolutFrozen: false, revolutError: null, alreadyInactive: true };
  }

  const cardId = await getRevolutCardIdFor(cardholderId);
  let revolutError: string | null = null;
  let revolutFrozen = false;
  if (cardId) {
    try {
      await freezeRevolutCard(cardId);
      revolutFrozen = true;
    } catch (e: any) {
      revolutError = e?.message || String(e);
      console.warn(`[expense-freeze] Revolut freeze failed for ${userName} (card ${cardId}):`, revolutError);
    }
  } else {
    revolutError = "no Revolut card mapped to this cardholder";
  }

  await db.update(stripeCardholders).set({ status: "inactive", updatedAt: new Date() }).where(eq(stripeCardholders.id, cardholderId));
  console.log(`[expense-freeze] froze ${userName}: ${blocking.length} blocking expense(s) totalling £${(total / 100).toFixed(2)}, revolut=${revolutFrozen ? "yes" : `no (${revolutError})`}`);

  return { cardholderId, userName, blockingCount: blocking.length, blockingTotalPence: total, revolutFrozen, revolutError, alreadyInactive: false };
}

// ─── Auto-unfreeze when blocking expenses clear ──────────────────────────
//
// Called fire-and-forget from the receipt-upload and mark-personal
// routes. If the cardholder is currently inactive AND has no remaining
// blocking expenses, unfreeze them on Revolut + flip the local flag.
// Silent no-op in every other case (active card, still blocked, no
// Revolut mapping, API error) so callers don't need to handle it.

export async function unfreezeIfClear(cardholderId: string): Promise<{ unfrozen: boolean; reason?: string }> {
  try {
    const [ch] = await db.select().from(stripeCardholders).where(eq(stripeCardholders.id, cardholderId)).limit(1);
    if (!ch) return { unfrozen: false, reason: "cardholder not found" };
    if (ch.status !== "inactive") return { unfrozen: false, reason: "not frozen" };

    const blocking = await getBlockingExpenses(cardholderId);
    if (blocking.length > 0) return { unfrozen: false, reason: `${blocking.length} expense(s) still blocking` };

    const cardId = await getRevolutCardIdFor(cardholderId);
    if (cardId) {
      try {
        await unfreezeRevolutCard(cardId);
      } catch (e: any) {
        // Local flag still flips; Revolut admin can unfreeze manually if needed.
        console.warn(`[expense-freeze] Revolut unfreeze failed for cardholder ${cardholderId}:`, e?.message);
      }
    }
    await db.update(stripeCardholders).set({ status: "active", updatedAt: new Date() }).where(eq(stripeCardholders.id, cardholderId));
    console.log(`[expense-freeze] auto-unfroze cardholder ${cardholderId} (${ch.userName}) — blocking expenses cleared`);
    return { unfrozen: true };
  } catch (e: any) {
    console.warn(`[expense-freeze] unfreezeIfClear failed for ${cardholderId}:`, e?.message);
    return { unfrozen: false, reason: e?.message };
  }
}

// ─── Month-end sweep ─────────────────────────────────────────────────────
//
// Iterates every active cardholder, skips admins, computes blocking
// expenses, freezes those with any. Returns a per-cardholder outcome
// list so the admin "run now" button can show what happened.

export async function runMonthEndFreezeSweep(): Promise<{ frozen: FreezeOutcome[]; skipped: number }> {
  // Join cardholders → users so we can drop admins. (users.userId == users.id)
  const cardholders = await db
    .select({
      cardholderId: stripeCardholders.id,
      userId: stripeCardholders.userId,
      userName: stripeCardholders.userName,
      status: stripeCardholders.status,
    })
    .from(stripeCardholders);

  // Pull admin flags in one query.
  const allUsers = await db.select({ id: users.id, isAdmin: users.isAdmin }).from(users);
  const adminIds = new Set(allUsers.filter((u) => u.isAdmin).map((u) => u.id));

  const outcomes: FreezeOutcome[] = [];
  let skipped = 0;
  for (const ch of cardholders) {
    if (adminIds.has(ch.userId)) { skipped++; continue; }
    const blocking = await getBlockingExpenses(ch.cardholderId);
    if (blocking.length === 0) { skipped++; continue; }
    const result = await freezeOne(ch.cardholderId, ch.userName, blocking);
    outcomes.push(result);
  }
  console.log(`[expense-freeze] month-end sweep: ${outcomes.length} cardholder(s) frozen, ${skipped} clean/exempt`);
  return { frozen: outcomes, skipped };
}
