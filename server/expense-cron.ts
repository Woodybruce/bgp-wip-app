// Scheduled background jobs for the expenses module.
//
// Two cadences:
//   1. Weekly agent chase (Mondays ~09:00 UK): every agent with any
//      pending_receipt expenses gets a WhatsApp message listing them.
//      Stops the "I'll do them at month end" pile-up.
//   2. Monthly approver digest (28th of the month ~09:00 UK): Layla
//      and Wendy each get a digest of what's still in their inbox,
//      grouped by submitter. Reminds them to clear before book-close.
//
// Implementation follows the existing pattern in server/index.ts —
// setInterval running hourly, branches on the calendar to fire once.

import { db, pool } from "./db";
import { expenses, stripeCardholders, users } from "@shared/schema";
import { eq, and, lt, isNotNull, sql } from "drizzle-orm";
import { sendWhatsAppText, getWhatsAppConfig } from "./whatsapp";
import { FALLBACK_APPROVER_EMAILS } from "./expense-approval";
import { backfillRecentRevolutTransactions } from "./revolut";

const fmt = (p: number) => `£${(p / 100).toFixed(2)}`;

async function runWeeklyAgentChase(): Promise<void> {
  const cfg = getWhatsAppConfig();
  if (!cfg.token || !cfg.phoneNumberId) { console.warn("[expense-cron] no WhatsApp config — skipping weekly chase"); return; }

  // Group pending_receipt rows by cardholder. Limit per-message to 10
  // rows to keep the WhatsApp text readable; older rows get the rest.
  const rows = await db
    .select()
    .from(expenses)
    .where(eq(expenses.status, "pending_receipt"));
  if (rows.length === 0) return;

  const byCardholder = new Map<string, typeof rows>();
  for (const r of rows) {
    if (!r.cardholderId) continue;
    if (!byCardholder.has(r.cardholderId)) byCardholder.set(r.cardholderId, []);
    byCardholder.get(r.cardholderId)!.push(r);
  }

  let sent = 0;
  for (const [chId, list] of byCardholder.entries()) {
    const [ch] = await db.select().from(stripeCardholders).where(eq(stripeCardholders.id, chId)).limit(1);
    if (!ch?.phone) continue;

    const total = list.reduce((s, r) => s + (r.amountPence || 0), 0);
    const lines = [
      `📸 ${list.length} receipt${list.length === 1 ? "" : "s"} still needed — total ${fmt(total)}`,
      "",
      ...list.slice(0, 10).map(r =>
        `• ${r.merchant || "(no merchant)"} — ${fmt(r.amountPence)}${r.transactionDate ? ` on ${new Date(r.transactionDate).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : ""}`
      ),
      list.length > 10 ? `… and ${list.length - 10} more` : "",
      "",
      "Send me a photo of the receipt and I'll match it up.",
    ].filter(Boolean).join("\n");

    try {
      await sendWhatsAppText(cfg, ch.phone, lines);
      sent++;
    } catch (e: any) {
      console.warn(`[expense-cron] weekly chase to ${ch.userName} (${ch.phone}) failed:`, e?.message);
    }
  }
  console.log(`[expense-cron] weekly agent chase: notified ${sent}/${byCardholder.size} cardholders`);
}

async function runMonthlyApproverDigest(): Promise<void> {
  const cfg = getWhatsAppConfig();
  if (!cfg.token || !cfg.phoneNumberId) { console.warn("[expense-cron] no WhatsApp config — skipping monthly digest"); return; }

  // Pull every pending_approval row + the submitter row. Group by
  // submitter; total per group; oldest-first so the most-urgent are
  // visible at the top of the digest.
  const rows = await pool.query<{
    expense_id: string;
    submitter_user_id: string | null;
    submitter_name: string | null;
    amount_pence: number;
    submitted_at: Date | null;
    flagged: boolean | null;
  }>(`
    SELECT
      e.id AS expense_id,
      e.submitter_user_id,
      u.name AS submitter_name,
      e.amount_pence,
      e.submitted_for_approval_at AS submitted_at,
      e.flagged_for_review AS flagged
    FROM expenses e
    LEFT JOIN users u ON u.id = e.submitter_user_id
    WHERE e.status = 'pending_approval'
    ORDER BY e.submitted_for_approval_at NULLS LAST
  `);

  if (rows.rows.length === 0) {
    console.log("[expense-cron] monthly digest: nothing pending");
    return;
  }

  const bySubmitter = new Map<string, { name: string; rows: typeof rows.rows; total: number; flagged: number }>();
  for (const r of rows.rows) {
    const key = r.submitter_user_id || "unknown";
    const name = r.submitter_name || "Unknown submitter";
    if (!bySubmitter.has(key)) bySubmitter.set(key, { name, rows: [], total: 0, flagged: 0 });
    const bucket = bySubmitter.get(key)!;
    bucket.rows.push(r);
    bucket.total += r.amount_pence || 0;
    if (r.flagged) bucket.flagged++;
  }

  const message = [
    `📋 Monthly expense approval digest`,
    `${rows.rows.length} expenses pending — ${fmt(rows.rows.reduce((s, r) => s + (r.amount_pence || 0), 0))} total`,
    "",
    ...Array.from(bySubmitter.values())
      .sort((a, b) => b.total - a.total)
      .map(g => `• ${g.name} — ${g.rows.length} × ${fmt(g.total)}${g.flagged > 0 ? ` (${g.flagged} flagged)` : ""}`),
    "",
    `Clear them: ${process.env.APP_BASE_URL || "https://app.brucegillinghampollard.com"}/expenses/approvals`,
  ].join("\n");

  // Send to the fallback pool (Layla + Wendy). Each approver gets the
  // same digest — they share the inbox so duplicate-effort risk is low.
  const approverRows = await db.select().from(users);
  let sent = 0;
  for (const u of approverRows) {
    const email = (u.email || "").toLowerCase();
    if (!FALLBACK_APPROVER_EMAILS.has(email)) continue;
    if (!u.phone) continue;
    try {
      await sendWhatsAppText(cfg, u.phone, message);
      sent++;
    } catch (e: any) {
      console.warn(`[expense-cron] monthly digest to ${u.name} failed:`, e?.message);
    }
  }
  console.log(`[expense-cron] monthly digest sent to ${sent} approver(s)`);
}

let _started = false;

export function startExpenseCron(): void {
  if (_started) return;
  _started = true;

  // Check every hour. Each job has its own day/hour gate so they fire
  // at most once per scheduled window. UK time — Railway boxes run UTC
  // so this drifts an hour during BST; close enough for "Monday 09:00 ish".
  setInterval(() => {
    const now = new Date();
    const day = now.getUTCDay();   // 0 Sun .. 6 Sat
    const date = now.getUTCDate();
    const hour = now.getUTCHours();

    // Monday 09:00 UTC — weekly agent chase
    if (day === 1 && hour === 9) {
      runWeeklyAgentChase().catch(e => console.error("[expense-cron] weekly chase failed:", e?.message));
    }

    // 28th of the month 09:00 UTC — monthly approver digest
    if (date === 28 && hour === 9) {
      runMonthlyApproverDigest().catch(e => console.error("[expense-cron] monthly digest failed:", e?.message));
    }

    // 06:00 UTC daily — pre-generate everyone's AI Daily Briefing so it's
    // already cached when they open the app (no 15s regen on each open).
    if (hour === 6) {
      import("./daily-briefing")
        .then(m => m.pregenerateAllBriefings())
        .catch(e => console.error("[expense-cron] briefing pre-gen failed:", e?.message));
    }

    // 1st of the month 09:00 UTC — month-end card freeze sweep. Anyone
    // with a Revolut card swipe older than 3 days still missing a receipt
    // (and ≥ £10, not personal, not an admin) gets their card frozen
    // until they upload the receipt or mark it personal.
    if (date === 1 && hour === 9) {
      import("./expense-freeze")
        .then(m => m.runMonthEndFreezeSweep())
        .then(r => console.log(`[expense-cron] month-end freeze: ${r.frozen.length} frozen, ${r.skipped} clean/exempt`))
        .catch(e => console.error("[expense-cron] month-end freeze failed:", e?.message));
    }
  }, 60 * 60 * 1000);

  // Revolut safety-net sync — every 10 minutes, pull anything from the
  // last hour. The webhook is the primary path (live + near-instant),
  // but we add this so the dashboard never has gaps: webhook downtime,
  // signature mismatch, late deliveries, or a missed retry all get
  // caught on the next sweep. Idempotent — upsert won't duplicate rows.
  const REVOLUT_SYNC_INTERVAL_MS = 10 * 60 * 1000;
  setInterval(() => {
    backfillRecentRevolutTransactions({ lookbackMinutes: 60, limit: 200 })
      .then(r => {
        if (r.created > 0 || r.updated > 0) {
          console.log(`[expense-cron] revolut auto-sync: ${r.created} new, ${r.updated} updated, ${r.skipped} skipped (${r.total} fetched)`);
        }
      })
      .catch(e => console.warn("[expense-cron] revolut auto-sync failed:", e?.message));
  }, REVOLUT_SYNC_INTERVAL_MS);

  // Kick once on startup so a freshly-deployed instance catches up
  // immediately without waiting for the first 10-minute tick.
  setTimeout(() => {
    backfillRecentRevolutTransactions({ lookbackMinutes: 60, limit: 200 })
      .then(r => console.log(`[expense-cron] revolut startup sync: ${r.created} new, ${r.updated} updated`))
      .catch(e => console.warn("[expense-cron] revolut startup sync failed:", e?.message));
  }, 30_000);

  console.log("[expense-cron] scheduled — weekly Mon 09:00 UTC + monthly 28th 09:00 UTC + month-end freeze 1st 09:00 UTC + revolut every 10min");
}

// Manual fire helpers — exported for admin "run now" endpoints if added.
export const _internal = { runWeeklyAgentChase, runMonthlyApproverDigest };
