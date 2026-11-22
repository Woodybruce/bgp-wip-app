// BGP stops acting on a deal for AML reasons (Woody, 21 November 2026). The
// rules and the words are shared/aml-stop.ts.
//
//   GET  /api/deals/:id/aml-stop          BGP staff signed in as themselves: whether it is stopped (why: the officers only)
//   POST /api/deals/:id/aml-stop          the Nominated Officer or a Deputy: { reason, note, withdraw }
//   POST /api/deals/:id/aml-stop/resume   the Nominated Officer or a Deputy
//
// The guards (amlStopDenial, stoppedDealIds) are asked by every door that
// moves a deal's status (dealStatusTransitionDenial in server/deal-gates.ts,
// the deal save and the bulk update in server/crm.ts), by the Xero invoice
// route and by the deal deletes. The columns are boot migrations on crm_deals
// (server/index.ts), not in shared/schema.ts; before they exist every guard
// reads "not stopped".

import { Router, type Request, type Response } from "express";
import { pool } from "./db";
import { AML_STOP_REASONS, AML_STOP_REFUSAL, amlStopAllowsMove, amlStopInput, type AmlStopReason, type AmlStopView } from "@shared/aml-stop";

type Db = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }> };

const missingColumn = (e: any) => e?.code === "42703";
const text = (v: unknown, max = 200): string => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

export interface AmlStopRow {
  at: string;
  byId: string | null;
  by: string;
  reason: AmlStopReason;
  note: string;
  prevStatus: string | null;
  withdrew: boolean;
}

/** Whether BGP has stopped acting on the deal, and who, when and why. */
export async function amlStopOf(dealId: string, db: Db = pool): Promise<AmlStopRow | null> {
  let r: any;
  try {
    r = (await db.query(
      `SELECT aml_stopped_at, aml_stopped_by, aml_stopped_by_name, aml_stopped_reason, aml_stopped_note, aml_stopped_prev_status, aml_stopped_withdrew
         FROM crm_deals WHERE id = $1`, [dealId])).rows[0];
  } catch (e: any) {
    if (missingColumn(e)) return null;
    throw e;
  }
  if (!r?.aml_stopped_at) return null;
  return {
    at: new Date(r.aml_stopped_at).toISOString(),
    byId: r.aml_stopped_by || null,
    by: text(r.aml_stopped_by_name) || "the Nominated Officer",
    reason: (r.aml_stopped_reason in AML_STOP_REASONS ? r.aml_stopped_reason : "other") as AmlStopReason,
    note: String(r.aml_stopped_note || ""),
    prevStatus: r.aml_stopped_prev_status || null,
    withdrew: !!r.aml_stopped_withdrew,
  };
}

/** The refusal for a status move while the deal is stopped, or null when it may move. */
export async function amlStopDenial(dealId: string, targetRaw: string): Promise<{ status: number; error: string; code: string } | null> {
  let r: any;
  try {
    r = (await pool.query(`SELECT status, aml_stopped_at FROM crm_deals WHERE id = $1`, [dealId])).rows[0];
  } catch (e: any) {
    if (missingColumn(e)) return null;
    throw e;
  }
  if (!r?.aml_stopped_at) return null;
  const { legacyToCode } = await import("../shared/deal-status");
  if (amlStopAllowsMove(legacyToCode(r.status) || null, legacyToCode(targetRaw) || null)) return null;
  return { status: 409, error: AML_STOP_REFUSAL, code: "AML_STOPPED" };
}

/** The deals among these that BGP has stopped acting on. */
export async function stoppedDealIds(ids: string[]): Promise<Set<string>> {
  const list = ids.map(String).filter(Boolean);
  if (!list.length) return new Set();
  try {
    return new Set((await pool.query(`SELECT id FROM crm_deals WHERE id = ANY($1::varchar[]) AND aml_stopped_at IS NOT NULL`, [list])).rows.map((r: any) => String(r.id)));
  } catch (e: any) {
    if (missingColumn(e)) return new Set();
    throw e;
  }
}

export function stopView(stop: AmlStopRow, officer: boolean): AmlStopView {
  return {
    at: stop.at, by: stop.by,
    ...(officer ? { reason: stop.reason, reasonWords: AML_STOP_REASONS[stop.reason], note: stop.note, prevStatus: stop.prevStatus, withdrew: stop.withdrew } : {}),
  };
}

const router = Router();

async function staffMe(req: Request): Promise<{ id: string; name: string } | null> {
  const { contactViewer } = await import("./contact-viewer");
  const viewer = await contactViewer(req).catch(() => null);
  const userId = (req as any).session?.userId || (req as any).tokenUserId;
  if (!viewer?.staff || !userId) return null;
  const u = (await pool.query(`SELECT id, name FROM users WHERE id = $1`, [userId])).rows[0];
  return u ? { id: String(u.id), name: text(u.name, 120) || "BGP" } : null;
}

async function officerOf(req: Request) {
  const { decider } = await import("./deal-party-aml");
  return decider(req);
}

async function audit(dealId: string, field: string, oldValue: string | null, newValue: string, reason: string, me: { id: string; name: string }) {
  await pool.query(
    `INSERT INTO deal_audit_log (deal_id, field, old_value, new_value, reason, changed_by, changed_by_name) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [dealId, field, oldValue, newValue, reason, me.id, me.name]).catch((e: any) => console.warn("[aml-stop] deal history line not written:", e?.message));
}

/** The deal's agents and the officers are told; never the reason. A failed send is reported, not fatal. */
async function tell(deal: { id: string; name: string; deal_ref: number | null }, by: string, resumed: boolean, withdrawn: boolean): Promise<{ sent: boolean; error: string | null }> {
  try {
    const { dealAgents, sendKycEmail } = await import("./aml-portal");
    const { amlOfficerEmails } = await import("./aml-authority");
    const { amlStoppedEmail } = await import("@shared/kyc-request");
    const agents = (await dealAgents(deal.id).catch(() => [])).map(a => a.email).filter(Boolean) as string[];
    const officers = await amlOfficerEmails().catch(() => [] as string[]);
    const to = agents.length ? agents : officers;
    if (!to.length) return { sent: false, error: "No agent or officer with an address" };
    const base = (process.env.PUBLIC_APP_URL || "https://chatbgp.app").replace(/\/+$/, "");
    const sent = await sendKycEmail({
      to, cc: agents.length ? officers : [],
      build: from => amlStoppedEmail({ dealName: deal.name, dealRef: deal.deal_ref, by, resumed, withdrawn, link: `${base}/deals/${deal.id}`, sentFrom: from }),
    });
    return { sent: sent.ok, error: sent.ok ? null : sent.error };
  } catch (e: any) {
    return { sent: false, error: String(e?.message || e).slice(0, 200) };
  }
}

router.get("/api/deals/:id/aml-stop", async (req: Request, res: Response) => {
  try {
    const me = await staffMe(req);
    if (!me) return res.status(403).json({ message: "BGP staff only, signed in as themselves." });
    const officer = await officerOf(req).then(d => "id" in d).catch(() => false);
    const stop = await amlStopOf(String(req.params.id));
    res.json({ stopped: stop ? stopView(stop, officer) : null, canDecide: officer });
  } catch (err: any) {
    console.error("[aml-stop] read failed:", err?.message);
    res.status(500).json({ message: "It could not be read." });
  }
});

router.post("/api/deals/:id/aml-stop", async (req: Request, res: Response) => {
  try {
    const me = await officerOf(req);
    if (!("id" in me)) return res.status(me.status).json({ message: me.refusal });
    const said = amlStopInput(req.body || {});
    if (!said.ok) return res.status(400).json({ message: said.message });
    const id = String(req.params.id);
    const deal = (await pool.query(`SELECT id, name, deal_ref, status FROM crm_deals WHERE id = $1`, [id])).rows[0];
    if (!deal) return res.status(404).json({ message: "Transaction not found." });
    // Set first, so nothing moves the deal on meanwhile; a second press finds it set.
    const set = await pool.query(
      `UPDATE crm_deals SET aml_stopped_at = now(), aml_stopped_by = $2, aml_stopped_by_name = $3, aml_stopped_reason = $4,
              aml_stopped_note = $5, aml_stopped_prev_status = $6, aml_stopped_withdrew = false
        WHERE id = $1 AND aml_stopped_at IS NULL`,
      [id, me.id, me.name, said.value.reason, said.value.note, deal.status || null]);
    if (!set.rowCount) return res.status(409).json({ message: "BGP has already stopped acting on this transaction." });
    await audit(id, "aml_stopped", null, `stopped by ${me.name}`, "BGP stopped acting on this transaction (AML)", me);

    const { legacyToCode } = await import("../shared/deal-status");
    let withdrawn = false;
    let withdrawError: string | null = null;
    if (said.value.withdraw && legacyToCode(deal.status) !== "WIT") {
      try {
        const { updateDeal } = await import("./letting-service");
        await updateDeal(id, { status: "WIT" }, { userId: me.id, source: "deal-form" });
        withdrawn = true;
        await pool.query(`UPDATE crm_deals SET aml_stopped_withdrew = true WHERE id = $1`, [id]);
        await audit(id, "status", deal.status || null, "WIT", `Withdrawn by ${me.name}`, me);
        const { mirrorFromDeal } = await import("./lease-status-mirror");
        await mirrorFromDeal(id, "WIT", { pool, reason: "aml_stop", actorUserId: me.id })
          .catch((e: any) => console.warn("[aml-stop] tracker mirror failed:", e?.message));
      } catch (e: any) {
        withdrawError = "BGP has stopped acting, but the transaction could not be moved to Withdrawn.";
        console.warn("[aml-stop] withdraw failed:", e?.message);
      }
    }
    const told = await tell({ id, name: text(deal.name) || "the deal", deal_ref: deal.deal_ref ?? null }, me.name, false, withdrawn);
    res.json({ ok: true, withdrawn, withdrawError, told });
  } catch (err: any) {
    console.error("[aml-stop] stop failed:", err?.message);
    res.status(500).json({ message: "It could not be stopped." });
  }
});

router.post("/api/deals/:id/aml-stop/resume", async (req: Request, res: Response) => {
  try {
    const me = await officerOf(req);
    if (!("id" in me)) return res.status(me.status).json({ message: me.refusal });
    const id = String(req.params.id);
    const stop = await amlStopOf(id);
    if (!stop) return res.status(409).json({ message: "BGP has not stopped acting on this transaction. Reload the page." });
    const deal = (await pool.query(`SELECT id, name, deal_ref, status FROM crm_deals WHERE id = $1`, [id])).rows[0];
    if (!deal) return res.status(404).json({ message: "Transaction not found." });
    await pool.query(
      `UPDATE crm_deals SET aml_stopped_at = NULL, aml_stopped_by = NULL, aml_stopped_by_name = NULL, aml_stopped_reason = NULL,
              aml_stopped_note = NULL, aml_stopped_prev_status = NULL, aml_stopped_withdrew = NULL WHERE id = $1`, [id]);
    await audit(id, "aml_stopped", `stopped by ${stop.by}`, `released by ${me.name}`, "BGP acts on this transaction again (AML)", me);

    // A deal the stop withdrew goes back where it was, through the ordinary gates.
    const { legacyToCode } = await import("../shared/deal-status");
    let restored: string | null = null;
    let restoreError: string | null = null;
    if (stop.withdrew && stop.prevStatus && legacyToCode(deal.status) === "WIT") {
      const { dealStatusTransitionDenial } = await import("./deal-gates");
      const denial = await dealStatusTransitionDenial(me.id, id, stop.prevStatus);
      if (denial) {
        restoreError = `The transaction stays Withdrawn: ${denial.error}`;
      } else {
        const { updateDeal } = await import("./letting-service");
        await updateDeal(id, { status: stop.prevStatus }, { userId: me.id, source: "deal-form" });
        await audit(id, "status", "WIT", stop.prevStatus, `Put back by ${me.name}`, me);
        const { mirrorFromDeal } = await import("./lease-status-mirror");
        await mirrorFromDeal(id, stop.prevStatus, { pool, reason: "aml_stop_resume", actorUserId: me.id })
          .catch((e: any) => console.warn("[aml-stop] tracker mirror failed:", e?.message));
        restored = stop.prevStatus;
      }
    }
    const told = await tell({ id, name: text(deal.name) || "the deal", deal_ref: deal.deal_ref ?? null }, me.name, true, false);
    res.json({ ok: true, restored, restoreError, told });
  } catch (err: any) {
    console.error("[aml-stop] resume failed:", err?.message);
    res.status(500).json({ message: "It could not be released." });
  }
});

export default router;
