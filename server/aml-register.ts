// The AML register's routes (Woody, 19 November 2026). The rules and the
// words are shared/aml-register.ts. The table is the old register's,
// aml_internal_reports, whose routes under /api/aml/ are retired with the
// in-app AML; these are outside that address.
//
//   POST  /api/aml-register        raise an entry (BGP staff: a suspicion, a sanctions concern or an
//                                  unregistered agent; the officers: any kind)
//   GET   /api/aml-register/mine   the entries you raised, as you may see them
//   GET   /api/aml-register        every entry (the Nominated Officer and the Deputy; admins while
//                                  no Nominated Officer is set)
//   PATCH /api/aml-register/:id    the officer's decision and record
//
// No company audit line is written for an entry: the KYC history is read by
// every BGP login, and a line saying a report exists can tip someone off.

import { Router, type Request, type Response } from "express";
import { pool } from "./db";
import {
  REGISTER_KIND_INFO, damlDates, isRegisterKind, registerRaiseInput, registerStatusOf, registerUpdateInput, reporterView,
  type RegisterDetails, type RegisterKind,
} from "@shared/aml-register";

export const AML_REGISTER_MIGRATIONS = [
  `ALTER TABLE aml_internal_reports ADD COLUMN IF NOT EXISTS party_role TEXT`,
  `ALTER TABLE aml_internal_reports ADD COLUMN IF NOT EXISTS trading_entity_id VARCHAR`,
  `ALTER TABLE aml_internal_reports ADD COLUMN IF NOT EXISTS details JSONB`,
  `ALTER TABLE aml_internal_reports ADD COLUMN IF NOT EXISTS reported_at TIMESTAMP`,
  `ALTER TABLE aml_internal_reports ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP`,
  `ALTER TABLE aml_internal_reports ADD COLUMN IF NOT EXISTS updated_by TEXT`,
  `CREATE INDEX IF NOT EXISTS aml_internal_reports_reporter_idx ON aml_internal_reports (reported_by)`,
];

const text = (v: unknown): string => String(v ?? "").replace(/\s+/g, " ").trim();
const londonToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

async function staffMe(req: Request): Promise<{ id: string; name: string } | null> {
  const userId = (req as any).session?.userId || (req as any).tokenUserId;
  if (!userId) return null;
  const { contactViewer } = await import("./contact-viewer");
  if (!(await contactViewer(req)).staff) return null;
  const u = (await pool.query(`SELECT id, name, email FROM users WHERE id = $1`, [userId])).rows[0];
  return u ? { id: String(u.id), name: text(u.name) || text(u.email) } : null;
}

const PARTY_COLUMN: Record<string, { brand: string; entity: string }> = {
  landlord: { brand: "landlord_id", entity: "landlord_trading_entity_id" },
  tenant: { brand: "tenant_id", entity: "tenant_trading_entity_id" },
  vendor: { brand: "vendor_id", entity: "vendor_trading_entity_id" },
  purchaser: { brand: "purchaser_id", entity: "purchaser_trading_entity_id" },
};

function officerView(r: any) {
  const kind: RegisterKind = isRegisterKind(r.kind) ? (r.kind as RegisterKind) : "suspicion";
  const details: RegisterDetails = r.details && typeof r.details === "object" ? r.details : {};
  return {
    id: Number(r.id), kind, kindWords: REGISTER_KIND_INFO[kind].short, reportedTo: REGISTER_KIND_INFO[kind].reportedTo,
    concern: String(r.concern || ""),
    dealId: r.deal_id || null, dealName: r.deal_name || null, dealRef: r.deal_ref ?? null,
    role: r.party_role || null, companyId: r.company_id || null, companyName: r.company_name || null,
    tradingEntityId: r.trading_entity_id || null, tradingEntityName: r.trading_entity_name || null,
    raisedBy: r.reported_by_name || null, raisedAt: r.created_at ? new Date(r.created_at).toISOString() : null,
    status: registerStatusOf(r.status),
    reportedOn: r.reported_at ? new Date(r.reported_at).toISOString().slice(0, 10) : null,
    reference: r.external_reference || null, reason: r.decision_reason || null,
    decidedBy: r.decided_by || null, decidedAt: r.decided_at ? new Date(r.decided_at).toISOString() : null,
    updatedBy: r.updated_by || null, updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : null,
    details,
    daml: kind === "suspicion" ? damlDates(details.damlRequestedOn, details.damlOutcome, details.damlOutcomeOn) : null,
  };
}

async function notifyOfficers(raisedBy: string | null): Promise<void> {
  try {
    const { amlOfficerEmails } = await import("./aml-authority");
    const to = await amlOfficerEmails();
    if (!to.length) return;
    const link = `${(process.env.PUBLIC_APP_URL || "https://chatbgp.app").replace(/\/+$/, "")}/deals/aml?section=reports`;
    const { sendKycEmail } = await import("./aml-portal");
    const { amlRegisterNoticeEmail } = await import("@shared/kyc-request");
    const sent = await sendKycEmail({ to, build: from => amlRegisterNoticeEmail({ raisedBy, link, sentFrom: from }) });
    if (!sent.ok) console.warn("[aml-register] officers not emailed:", sent.error);
  } catch (e: any) {
    console.warn("[aml-register] officers not emailed:", e?.message);
  }
}

const router = Router();

router.post("/api/aml-register", async (req: Request, res: Response) => {
  try {
    const me = await staffMe(req);
    if (!me) return res.status(403).json({ message: "BGP staff only, signed in as themselves." });
    const { amlActor } = await import("./aml-authority");
    const actor = await amlActor(req);
    const input = registerRaiseInput(req.body, { officer: actor.isMlro });
    if (!input.ok) return res.status(400).json({ message: input.error });
    const v = input.value;
    let companyId: string | null = null;
    let entityId: string | null = null;
    if (v.dealId) {
      const deal = (await pool.query(`SELECT * FROM crm_deals WHERE id = $1`, [v.dealId])).rows[0];
      if (!deal) return res.status(404).json({ message: "No such transaction." });
      if (v.role) {
        companyId = deal[PARTY_COLUMN[v.role].brand] || null;
        entityId = deal[PARTY_COLUMN[v.role].entity] || null;
      }
    }
    if (!companyId && v.companyId) {
      const c = (await pool.query(`SELECT id FROM crm_companies WHERE id = $1`, [v.companyId])).rows[0];
      if (!c) return res.status(404).json({ message: "No such company." });
      companyId = String(c.id);
    }
    const row = (await pool.query(
      `INSERT INTO aml_internal_reports (kind, company_id, deal_id, party_role, trading_entity_id, concern, reported_by, reported_by_name, status, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'open', now()) RETURNING id, kind, concern, created_at, status`,
      [v.kind, companyId, v.dealId, v.role, entityId, v.concern, me.id, me.name])).rows[0];
    void notifyOfficers(me.name);
    res.json({ ok: true, entry: reporterView(row) });
  } catch (err: any) {
    console.error("[aml-register] not raised:", err?.message);
    res.status(500).json({ message: "The report could not be sent. Tell the Nominated Officer directly." });
  }
});

router.get("/api/aml-register/mine", async (req: Request, res: Response) => {
  try {
    const me = await staffMe(req);
    if (!me) return res.status(403).json({ message: "BGP staff only, signed in as themselves." });
    const { rows } = await pool.query(
      `SELECT id, kind, concern, created_at, status FROM aml_internal_reports WHERE reported_by = $1 ORDER BY created_at DESC LIMIT 50`, [me.id]);
    res.json({ entries: rows.map(reporterView) });
  } catch (err: any) {
    console.error("[aml-register] own entries failed:", err?.message);
    res.status(500).json({ message: "Your reports could not be read." });
  }
});

router.get("/api/aml-register", async (req: Request, res: Response) => {
  try {
    if (!(await staffMe(req))) return res.status(403).json({ message: "BGP staff only, signed in as themselves." });
    const { amlActor, officerRefusal } = await import("./aml-authority");
    const actor = await amlActor(req);
    if (!actor.isMlro) return res.status(403).json({ message: officerRefusal(actor, "read the AML register"), code: "MLRO_ONLY" });
    const { rows } = await pool.query(
      `SELECT r.*, d.name AS deal_name, d.deal_ref, c.name AS company_name, e.name AS trading_entity_name
         FROM aml_internal_reports r
         LEFT JOIN crm_deals d ON d.id = r.deal_id
         LEFT JOIN crm_companies c ON c.id = r.company_id
         LEFT JOIN crm_trading_entities e ON e.id = r.trading_entity_id
        ORDER BY (r.status = 'open') DESC, r.created_at DESC LIMIT 500`);
    res.json({ entries: rows.map(officerView), officerRole: actor.officerRole });
  } catch (err: any) {
    console.error("[aml-register] list failed:", err?.message);
    res.status(500).json({ message: "The AML register could not be read." });
  }
});

router.patch("/api/aml-register/:id", async (req: Request, res: Response) => {
  try {
    if (!(await staffMe(req))) return res.status(403).json({ message: "BGP staff only, signed in as themselves." });
    const { amlActor, officerRefusal } = await import("./aml-authority");
    const actor = await amlActor(req);
    if (!actor.isMlro) return res.status(403).json({ message: officerRefusal(actor, "decide an entry in the AML register"), code: "MLRO_ONLY" });
    const current = (await pool.query(`SELECT * FROM aml_internal_reports WHERE id = $1`, [req.params.id])).rows[0];
    if (!current) return res.status(404).json({ message: "No such entry." });
    const kind: RegisterKind = isRegisterKind(current.kind) ? (current.kind as RegisterKind) : "suspicion";
    const input = registerUpdateInput(req.body, kind, londonToday());
    if (!input.ok) return res.status(400).json({ message: input.error });
    const v = input.value;
    const who = actor.name || actor.email || "the Nominated Officer";
    const decided = v.status !== "open";
    const row = (await pool.query(
      `UPDATE aml_internal_reports
          SET status = $2, reported_at = $3::date, external_reference = $4, decision_reason = $5, details = $6::jsonb,
              decided_by = CASE WHEN $7 THEN COALESCE(CASE WHEN status = $2 THEN decided_by END, $8) ELSE NULL END,
              decided_at = CASE WHEN $7 THEN COALESCE(CASE WHEN status = $2 THEN decided_at END, now()) ELSE NULL END,
              updated_by = $8, updated_at = now()
        WHERE id = $1 RETURNING *`,
      [current.id, v.status, v.reportedOn, v.reference, v.reason, JSON.stringify(v.details), decided, who])).rows[0];
    res.json({ ok: true, entry: officerView(row) });
  } catch (err: any) {
    console.error("[aml-register] not saved:", err?.message);
    res.status(500).json({ message: "The entry could not be saved." });
  }
});

export default router;
