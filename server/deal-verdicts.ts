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
const ESCALATE_AFTER_DAYS = 3;
const ESCALATION_EMAIL = "woody@brucegillinghampollard.com";
const APP_URL = "https://chatbgp.app";

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

// 09:00 — email per agent.
export async function runMorningVerdictEmails(): Promise<void> {
  const perUser = await collectPendingByUser();
  const { sendSharedMailboxEmail } = await import("./shared-mailbox");
  for (const u of perUser) {
    if (!u.email) continue;
    const items = u.deals.map(d => `<li>${fmtDeal(d)}</li>`).join("");
    try {
      await sendSharedMailboxEmail({
        to: u.email,
        subject: `${u.deals.length} deal${u.deals.length === 1 ? "" : "s"} awaiting your invoice verdict`,
        body: `<p>Hi ${u.name.split(" ")[0]},</p>
<p>These deals are due to exchange or complete this month and need your verdict — on track, slipping (with a new date), or ready to invoice:</p>
<ul>${items}</ul>
<p><a href="${APP_URL}/deals?verdicts=1">Answer them in the dashboard</a> — the banner clears the moment you do.</p>
<p>BGP Dashboard</p>`,
      });
    } catch (e: any) {
      console.warn(`[deal-verdicts] email to ${u.email} failed: ${e?.message}`);
    }
  }
  console.log(`[deal-verdicts] morning emails: ${perUser.length} agent(s)`);
}

// 09:00 — escalation digest to Woody + each offender's manager when a deal
// has sat ≥ESCALATE_AFTER_DAYS past its target date with no verdict.
export async function runVerdictEscalation(): Promise<void> {
  const perUser = await collectPendingByUser();
  const offenders = perUser
    .map(u => ({ ...u, deals: u.deals.filter(d => d.daysOverdue >= ESCALATE_AFTER_DAYS) }))
    .filter(u => u.deals.length > 0);
  if (!offenders.length) return;

  const lines = offenders.map(u =>
    `<p><b>${u.name}</b> — ${u.deals.length} ignored deal${u.deals.length === 1 ? "" : "s"}:</p><ul>${u.deals.map(d => `<li>${fmtDeal(d)}</li>`).join("")}</ul>`
  ).join("");
  const html = `<p>These deals passed their target date ${ESCALATE_AFTER_DAYS}+ days ago and the assigned agent still hasn't given an invoice verdict:</p>${lines}<p><a href="${APP_URL}/deals">Deal tracker</a></p>`;

  const { sendSharedMailboxEmail } = await import("./shared-mailbox");
  const { sendPushNotification } = await import("./push-notifications");

  const recipients = new Set<string>([ESCALATION_EMAIL.toLowerCase()]);
  for (const u of offenders) {
    if (u.managerId) {
      const mgr = await pool.query(`SELECT email FROM users WHERE id = $1`, [u.managerId]);
      if (mgr.rows[0]?.email) recipients.add(String(mgr.rows[0].email).toLowerCase());
    }
  }
  for (const email of recipients) {
    try {
      await sendSharedMailboxEmail({ to: email, subject: "Unanswered invoice verdicts — escalation", body: html });
    } catch (e: any) {
      console.warn(`[deal-verdicts] escalation email to ${email} failed: ${e?.message}`);
    }
  }
  try {
    const woody = await pool.query(`SELECT id FROM users WHERE lower(email) = lower($1) LIMIT 1`, [ESCALATION_EMAIL]);
    if (woody.rows[0]) {
      const total = offenders.reduce((n, u) => n + u.deals.length, 0);
      await sendPushNotification(woody.rows[0].id, {
        title: "Invoice verdicts being ignored",
        body: offenders.map(u => `${u.name}: ${u.deals.length}`).join(" · ") + ` — ${total} deal(s) unconfirmed`,
        tag: "verdict-escalation",
        url: "/deals",
      });
    }
  } catch {}
  console.log(`[deal-verdicts] escalation: ${offenders.length} agent(s) named to ${recipients.size} recipient(s)`);
}

export default router;
