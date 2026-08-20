// ─────────────────────────────────────────────────────────────────────────
// Deal invoice-verdict alarm (Woody, 2026-08-19: agents ignore deals due to
// exchange/complete this month — "we need something dramatic and annoying
// that will get them out of bed").
//
// A deal is DUE A VERDICT when its target date falls inside (or before) the
// current month, it hasn't been invoiced, and it isn't Withdrawn/Invoiced.
// The assigned agent must answer, once per calendar month, per deal:
//   on_track    — completes as dated
//   slipping    — must supply a new target date (re-dates the deal)
//   invoice_now — ready to invoice (pushes Woody immediately)
//
// Nagging: GET /pending drives an un-dismissable banner (3+ days overdue →
// full-screen block). 08:00 push + 09:00 email per agent; ≥3 days ignored →
// daily escalation digest to Woody + the agent's manager.
// ─────────────────────────────────────────────────────────────────────────
import { Router, type Request, type Response } from "express";
import { requireAuth } from "./auth";
import { pool } from "./db";
import { legacyToCode } from "../shared/deal-status";

const router = Router();

// Dials
const ESCALATION_EMAIL = "woody@brucegillinghampollard.com"; // "ready to invoice" push
const SUMMARY_EMAIL = "equity@brucegillinghampollard.com";   // daily outstanding-verdicts summary
const APP_URL = "https://chatbgp.app";
// Deals whose target date is older than this are ancient zombies, not live
// emergencies — they skip the agent alarms and surface on the equity
// summary's tidy-up list instead (Woody, 2026-08-20).
const LOOKBACK_MONTHS = 6;

pool.query(`
  CREATE TABLE IF NOT EXISTS deal_verdicts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_id VARCHAR NOT NULL,
    user_id VARCHAR NOT NULL,
    verdict TEXT NOT NULL,
    new_target_date TIMESTAMPTZ,
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`).catch(() => {});

export interface PendingVerdictDeal {
  id: string;
  name: string;
  propertyName: string | null;
  fee: number | null;
  targetDate: string;
  status: string | null;
  daysOverdue: number;
}

// Deals awaiting this user's verdict this month. Status is screened in JS —
// legacy free-text statuses only normalise through legacyToCode.
export async function pendingVerdictDeals(userId: string, userName: string): Promise<PendingVerdictDeal[]> {
  const { rows } = await pool.query(
    `SELECT d.id, d.name, d.status, d.fee, d.target_date, p.name AS property_name
       FROM crm_deals d
       LEFT JOIN crm_properties p ON p.id = d.property_id
      WHERE d.invoiced_at IS NULL
        AND d.target_date IS NOT NULL
        AND d.target_date < date_trunc('month', now()) + interval '1 month'
        AND d.target_date >= now() - interval '${LOOKBACK_MONTHS} months'
        AND (d.internal_agent_ids @> ARRAY[$1]::varchar[] OR $2 = ANY(d.internal_agent))
        AND NOT EXISTS (
          SELECT 1 FROM deal_verdicts v
           WHERE v.deal_id = d.id AND v.user_id = $1
             AND v.created_at >= date_trunc('month', now()))
      ORDER BY d.target_date ASC`,
    [userId, userName]
  );
  const out: PendingVerdictDeal[] = [];
  for (const r of rows) {
    const code = legacyToCode(r.status);
    if (code === "WIT" || code === "INV") continue;
    const target = new Date(r.target_date);
    const daysOverdue = Math.max(0, Math.floor((Date.now() - target.getTime()) / 86400000));
    out.push({
      id: r.id,
      name: r.name,
      propertyName: r.property_name || null,
      fee: r.fee != null ? Number(r.fee) : null,
      targetDate: target.toISOString(),
      status: r.status,
      daysOverdue,
    });
  }
  return out;
}

async function sessionUser(req: Request): Promise<{ id: string; name: string } | null> {
  const userId = (req as any).session?.userId || (req as any).tokenUserId;
  if (!userId) return null;
  const r = await pool.query(`SELECT id, name FROM users WHERE id = $1`, [userId]);
  return r.rows[0] || null;
}

router.get("/api/deal-verdicts/pending", requireAuth, async (req: Request, res: Response) => {
  try {
    const { isClientRequestUser } = await import("./company-scope");
    if (await isClientRequestUser(req)) return res.json({ count: 0, maxDaysOverdue: 0, deals: [] });
    const user = await sessionUser(req);
    if (!user) return res.json({ count: 0, maxDaysOverdue: 0, deals: [] });
    const deals = await pendingVerdictDeals(user.id, user.name);
    res.json({
      count: deals.length,
      maxDaysOverdue: deals.reduce((m, d) => Math.max(m, d.daysOverdue), 0),
      deals,
    });
  } catch (e: any) {
    console.error("[deal-verdicts] pending failed:", e?.message);
    res.status(500).json({ error: e?.message || "failed" });
  }
});

router.post("/api/deal-verdicts/:dealId", requireAuth, async (req: Request, res: Response) => {
  try {
    const { isClientRequestUser } = await import("./company-scope");
    if (await isClientRequestUser(req)) return res.status(403).json({ error: "Staff only" });
    const user = await sessionUser(req);
    if (!user) return res.status(401).json({ error: "No session user" });

    const dealId = String(req.params.dealId);
    const verdict = String(req.body?.verdict || "");
    const note = req.body?.note ? String(req.body.note).slice(0, 2000) : null;
    if (!["on_track", "slipping", "invoice_now"].includes(verdict)) {
      return res.status(400).json({ error: "verdict must be on_track | slipping | invoice_now" });
    }

    const dealQ = await pool.query(
      `SELECT d.id, d.name, d.fee, p.name AS property_name FROM crm_deals d
        LEFT JOIN crm_properties p ON p.id = d.property_id WHERE d.id = $1`,
      [dealId]
    );
    const deal = dealQ.rows[0];
    if (!deal) return res.status(404).json({ error: "Deal not found" });

    let newTargetDate: Date | null = null;
    if (verdict === "slipping") {
      newTargetDate = req.body?.newTargetDate ? new Date(req.body.newTargetDate) : null;
      if (!newTargetDate || isNaN(newTargetDate.getTime())) {
        return res.status(400).json({ error: "Slipping needs a new target date" });
      }
      await pool.query(`UPDATE crm_deals SET target_date = $1 WHERE id = $2`, [newTargetDate, dealId]);
    }

    await pool.query(
      `INSERT INTO deal_verdicts (deal_id, user_id, verdict, new_target_date, note) VALUES ($1, $2, $3, $4, $5)`,
      [dealId, user.id, verdict, newTargetDate, note]
    );

    if (verdict === "invoice_now") {
      try {
        const woody = await pool.query(`SELECT id FROM users WHERE lower(email) = lower($1) LIMIT 1`, [ESCALATION_EMAIL]);
        if (woody.rows[0]) {
          const { sendPushNotification } = await import("./push-notifications");
          const feeTxt = deal.fee ? `£${Number(deal.fee).toLocaleString()} fee ` : "";
          sendPushNotification(woody.rows[0].id, {
            title: "Deal ready to invoice",
            body: `${feeTxt}on ${deal.name}${deal.property_name ? ` (${deal.property_name})` : ""} — verdict by ${user.name}`,
            tag: `verdict-${dealId}`,
            url: "/deals",
          }).catch(() => {});
        }
      } catch {}
    }

    res.json({ ok: true });
  } catch (e: any) {
    console.error("[deal-verdicts] post failed:", e?.message);
    res.status(500).json({ error: e?.message || "failed" });
  }
});

// ── Daily jobs ───────────────────────────────────────────────────────────

async function collectPendingByUser(): Promise<Array<{ userId: string; name: string; email: string | null; managerId: string | null; deals: PendingVerdictDeal[] }>> {
  const users = await pool.query(
    `SELECT id, name, email, manager_id FROM users WHERE is_active IS NOT FALSE AND role IS DISTINCT FROM 'Client'`
  );
  const out: Array<{ userId: string; name: string; email: string | null; managerId: string | null; deals: PendingVerdictDeal[] }> = [];
  for (const u of users.rows) {
    try {
      const deals = await pendingVerdictDeals(u.id, u.name);
      if (deals.length) out.push({ userId: u.id, name: u.name, email: u.email, managerId: u.manager_id, deals });
    } catch {}
  }
  return out;
}

const fmtDeal = (d: PendingVerdictDeal) =>
  `${d.name}${d.propertyName ? ` (${d.propertyName})` : ""}${d.fee ? ` — £${d.fee.toLocaleString()}` : ""} — target ${new Date(d.targetDate).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}${d.daysOverdue > 0 ? ` (${d.daysOverdue}d overdue)` : ""}`;

// 08:00 — push per agent.
export async function runMorningVerdictPushes(): Promise<void> {
  const perUser = await collectPendingByUser();
  const { sendPushNotification } = await import("./push-notifications");
  for (const u of perUser) {
    await sendPushNotification(u.userId, {
      title: `${u.deals.length} deal${u.deals.length === 1 ? "" : "s"} need your invoice verdict`,
      body: u.deals.slice(0, 3).map(d => d.name).join(" · "),
      tag: "deal-verdicts",
      url: "/deals?verdicts=1",
    }).catch(() => {});
  }
  console.log(`[deal-verdicts] morning pushes: ${perUser.length} agent(s) nagged`);
}

// Email blast — ONE red-alert email PER DEAL per agent, fired 6× a day
// (Woody, 2026-08-19: "send an email for each deal to the agents... 6 emails
// a day until they are fixed, make all the text bright red and say deal
// emergency at the top with lots of emojis"). Answered deals drop out of
// pendingVerdictDeals, so the emails stop the moment a verdict lands.
export async function runVerdictEmailBlast(): Promise<void> {
  const perUser = await collectPendingByUser();
  const { sendSharedMailboxEmail } = await import("./shared-mailbox");
  let sent = 0;
  for (const u of perUser) {
    if (!u.email) continue;
    for (const d of u.deals) {
      const overdueLine = d.daysOverdue > 0
        ? `⏰❗ <b>${d.daysOverdue} DAY${d.daysOverdue === 1 ? "" : "S"} PAST ITS TARGET DATE</b> ❗⏰`
        : `⏰ Target date: <b>${new Date(d.targetDate).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}</b> — this month!`;
      try {
        await sendSharedMailboxEmail({
          to: u.email,
          subject: `🚨 DEAL EMERGENCY — ${d.name} needs your invoice verdict`,
          body: `<div style="color:#e60000;font-family:Arial,sans-serif;">
<h1 style="color:#e60000;font-size:26px;margin:0 0 12px;">🚨🔥🚨 DEAL EMERGENCY 🚨🔥🚨</h1>
<p style="color:#e60000;font-size:15px;"><b>${u.name.split(" ")[0]} — this deal needs your verdict NOW:</b></p>
<p style="color:#e60000;font-size:17px;"><b>💼 ${d.name}</b>${d.propertyName ? ` — ${d.propertyName}` : ""}</p>
${d.fee ? `<p style="color:#e60000;font-size:15px;">💸💸 <b>£${d.fee.toLocaleString()} fee unconfirmed</b> 💸💸</p>` : ""}
<p style="color:#e60000;font-size:15px;">${overdueLine}</p>
<p style="color:#e60000;font-size:15px;">Is it 🟢 on track, 🟠 slipping, or 💰 <b>ready to invoice</b>? Nobody knows — because you haven't said! 😱</p>
<p style="color:#e60000;font-size:15px;">👉 <a href="${APP_URL}/deals?verdicts=1" style="color:#e60000;font-weight:bold;">GIVE YOUR VERDICT — the emails stop the moment you do</a> 👈</p>
<p style="color:#e60000;font-size:12px;">🚨 You will receive this email 6 times a day until this deal has a verdict. The equity partners receive a daily summary of every unanswered deal. 🚨</p>
</div>`,
        });
        sent++;
      } catch (e: any) {
        console.warn(`[deal-verdicts] blast email to ${u.email} failed: ${e?.message}`);
      }
    }
  }
  console.log(`[deal-verdicts] blast: ${sent} email(s) across ${perUser.length} agent(s)`);
}

// 09:00 — one clean daily summary of everything outstanding, to the equity
// partners' list "just so we know" (Woody, 2026-08-19).
// Ancient zombies for the tidy-up list: target date older than the
// look-back, still uninvoiced/unwithdrawn. Excluded from agent alarms.
async function ancientBacklogDeals(): Promise<Array<{ name: string; propertyName: string | null; agents: string[]; targetDate: string; fee: number | null }>> {
  const { rows } = await pool.query(
    `SELECT d.name, d.status, d.fee, d.target_date, d.internal_agent, p.name AS property_name
       FROM crm_deals d
       LEFT JOIN crm_properties p ON p.id = d.property_id
      WHERE d.invoiced_at IS NULL
        AND d.target_date IS NOT NULL
        AND d.target_date < now() - interval '${LOOKBACK_MONTHS} months'
      ORDER BY d.target_date ASC
      LIMIT 60`
  );
  return rows
    .filter((r: any) => { const c = legacyToCode(r.status); return c !== "WIT" && c !== "INV"; })
    .map((r: any) => ({
      name: r.name,
      propertyName: r.property_name || null,
      agents: Array.isArray(r.internal_agent) ? r.internal_agent : [],
      targetDate: new Date(r.target_date).toISOString(),
      fee: r.fee != null ? Number(r.fee) : null,
    }));
}

export async function runEquityVerdictSummary(): Promise<void> {
  const perUser = await collectPendingByUser();
  const ancient = await ancientBacklogDeals().catch(() => []);
  if (!perUser.length && !ancient.length) return;
  const totalDeals = perUser.reduce((n, u) => n + u.deals.length, 0);
  const totalFees = perUser.reduce((n, u) => n + u.deals.reduce((m, d) => m + (d.fee || 0), 0), 0);
  const sections = perUser.map(u =>
    `<p style="margin:10px 0 2px;"><b>${u.name}</b> — ${u.deals.length} deal${u.deals.length === 1 ? "" : "s"} awaiting verdict:</p>
<ul style="margin:2px 0 8px;">${u.deals.map(d => `<li>${fmtDeal(d)}</li>`).join("")}</ul>`
  ).join("");
  const { sendSharedMailboxEmail } = await import("./shared-mailbox");
  try {
    await sendSharedMailboxEmail({
      to: SUMMARY_EMAIL,
      subject: totalDeals
        ? `Invoice verdicts outstanding: ${totalDeals} deal${totalDeals === 1 ? "" : "s"}${totalFees ? ` · £${totalFees.toLocaleString()} in fees` : ""}`
        : `Deal tidy-up list: ${ancient.length} zombie deal${ancient.length === 1 ? "" : "s"} need re-dating or withdrawing`,
      body: `<div style="font-family:Arial,sans-serif;font-size:14px;color:#1F2937;">
<p>Daily summary of deals due to exchange or complete this month where the assigned agent has not yet given an invoice verdict.</p>
<p><b>${totalDeals} deal${totalDeals === 1 ? "" : "s"} outstanding${totalFees ? ` · £${totalFees.toLocaleString()} in unconfirmed fees` : ""}</b></p>
${sections}
${ancient.length ? `<hr style="border:none;border-top:1px solid #E5E7EB;margin:14px 0;">
<p><b>Tidy-up list — ${ancient.length} zombie deal${ancient.length === 1 ? "" : "s"}</b> (target date over ${LOOKBACK_MONTHS} months old, still not invoiced or withdrawn — excluded from the agent alarms; these need re-dating, invoicing or withdrawing):</p>
<ul style="margin:2px 0 8px;">${ancient.map(d => `<li>${d.name}${d.propertyName ? ` (${d.propertyName})` : ""}${d.fee ? ` — £${d.fee.toLocaleString()}` : ""} — target ${new Date(d.targetDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}${d.agents.length ? ` — ${d.agents.join(", ")}` : ""}</li>`).join("")}</ul>` : ""}
<p><a href="${APP_URL}/deals">Open the deal tracker</a></p>
<p style="color:#6B7280;font-size:12px;">Agents receive six reminder emails a day per deal until each verdict is given. This summary stops when nothing is outstanding.</p>
</div>`,
    });
    console.log(`[deal-verdicts] equity summary sent: ${totalDeals} deal(s), ${perUser.length} agent(s)`);
  } catch (e: any) {
    console.warn(`[deal-verdicts] equity summary failed: ${e?.message}`);
  }
}

export default router;
