// Agents' anti-money laundering supervision (Woody, 19 November 2026: build
// the joint agent check in BGP's AML policy). The rules are
// shared/agent-aml.ts; HMRC's register is read by server/hmrc-register.ts.
//
//   GET  /api/agent-aml/company/:companyId          what BGP recorded about the firm
//   POST /api/agent-aml/company/:companyId/search   { name? } entries on HMRC's register
//   PUT  /api/agent-aml/company/:companyId          record a check
//   GET  /api/deals/:id/agents-aml                  every agent firm on a deal, with its state
//
// BGP staff signed in as themselves only; on no client gateway list.

import { Router, type Request, type Response } from "express";
import { pool } from "./db";
import {
  AGENT_ROLE_WORDS, agentAmlState, agentSupervisionInput, type AgentRole, type AgentSupervision,
} from "@shared/agent-aml";

type Db = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> };

export const AGENT_AML_MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS agent_aml_supervision (
     company_id VARCHAR PRIMARY KEY,
     status TEXT NOT NULL,
     registration_number TEXT, register_name TEXT, register_postcode TEXT, register_status TEXT,
     supervisor TEXT, agreement_in_place BOOLEAN, agreement_note TEXT, notes TEXT,
     source TEXT NOT NULL DEFAULT 'manual', register_date TEXT,
     checked_at TIMESTAMP NOT NULL DEFAULT now(), checked_by VARCHAR, checked_by_name TEXT,
     updated_at TIMESTAMP NOT NULL DEFAULT now())`,
];

const text = (v: unknown): string => String(v ?? "").replace(/\s+/g, " ").trim();

async function staffMe(req: Request): Promise<{ id: string; name: string } | null> {
  const userId = (req as any).session?.userId || (req as any).tokenUserId;
  if (!userId) return null;
  const { contactViewer } = await import("./contact-viewer");
  if (!(await contactViewer(req)).staff) return null;
  const u = (await pool.query(`SELECT id, name, email FROM users WHERE id = $1`, [userId])).rows[0];
  return u ? { id: String(u.id), name: text(u.name) || text(u.email) } : null;
}

const rowToRecord = (r: any): AgentSupervision => ({
  companyId: String(r.company_id),
  status: r.status,
  registrationNumber: r.registration_number || null,
  registerName: r.register_name || null,
  registerPostcode: r.register_postcode || null,
  registerStatus: r.register_status || null,
  supervisor: r.supervisor || null,
  agreementInPlace: typeof r.agreement_in_place === "boolean" ? r.agreement_in_place : null,
  agreementNote: r.agreement_note || null,
  notes: r.notes || null,
  checkedAt: r.checked_at ? new Date(r.checked_at).toISOString() : null,
  checkedByName: r.checked_by_name || null,
  source: r.source === "register" ? "register" : "manual",
  registerDate: r.register_date || null,
});

export async function loadAgentSupervision(db: Db, companyIds: string[]): Promise<Map<string, AgentSupervision>> {
  const ids = [...new Set(companyIds.filter(Boolean))];
  const out = new Map<string, AgentSupervision>();
  if (!ids.length) return out;
  const { rows } = await db.query(`SELECT * FROM agent_aml_supervision WHERE company_id = ANY($1::varchar[])`, [ids]);
  for (const r of rows) out.set(String(r.company_id), rowToRecord(r));
  return out;
}

const AGENT_COLUMNS: Array<{ role: AgentRole; column: string }> = [
  { role: "joint_agent", column: "joint_agent_id" },
  { role: "vendor_agent", column: "vendor_agent_id" },
  { role: "purchaser_agent", column: "purchaser_agent_id" },
  { role: "acquisition_agent", column: "acquisition_agent_id" },
  { role: "leasing_agent", column: "leasing_agent_id" },
];

/** Every agent firm on a deal, with what BGP recorded and what the card says. BGP's own record is never one. */
export async function dealAgentsAml(db: Db, dealId: string) {
  const deal = (await db.query(
    `SELECT id, ${AGENT_COLUMNS.map(a => a.column).join(", ")}, joint_agent_fee_pct FROM crm_deals WHERE id = $1`, [dealId])).rows[0];
  if (!deal) return null;
  const picked = AGENT_COLUMNS.map(a => ({ role: a.role, companyId: deal[a.column] ? String(deal[a.column]) : null })).filter(a => a.companyId) as Array<{ role: AgentRole; companyId: string }>;
  const ids = [...new Set(picked.map(p => p.companyId))];
  const names = ids.length ? (await db.query(`SELECT id, name FROM crm_companies WHERE id = ANY($1::varchar[])`, [ids])).rows : [];
  const records = await loadAgentSupervision(db, ids);
  const feeShared = Number(deal.joint_agent_fee_pct) > 0;
  const seen = new Set<string>();
  const agents = [];
  for (const p of picked) {
    const name = text(names.find((n: any) => String(n.id) === p.companyId)?.name);
    // BGP itself on an agent field is not an outside agent.
    if (!name || /bruce gillingham pollard/i.test(name)) continue;
    const key = `${p.role}:${p.companyId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const record = records.get(p.companyId) || null;
    agents.push({
      role: p.role, roleWords: AGENT_ROLE_WORDS[p.role], companyId: p.companyId, name,
      feeShared: p.role === "joint_agent" && feeShared,
      feePct: p.role === "joint_agent" && feeShared ? Number(deal.joint_agent_fee_pct) : null,
      record, state: agentAmlState({ role: p.role, feeShared: p.role === "joint_agent" && feeShared, record }),
    });
  }
  return { dealId: String(deal.id), agents };
}

const router = Router();

router.get("/api/agent-aml/company/:companyId", async (req: Request, res: Response) => {
  try {
    if (!(await staffMe(req))) return res.status(403).json({ message: "BGP staff only, signed in as themselves." });
    const company = (await pool.query(`SELECT id, name FROM crm_companies WHERE id = $1`, [req.params.companyId])).rows[0];
    if (!company) return res.status(404).json({ message: "No such company." });
    const record = (await loadAgentSupervision(pool, [String(company.id)])).get(String(company.id)) || null;
    const { hmrcRegisterState } = await import("./hmrc-register");
    res.json({ companyId: String(company.id), name: text(company.name), record, state: agentAmlState({ role: "joint_agent", feeShared: false, record }), register: hmrcRegisterState() });
  } catch (err: any) {
    console.error("[agent-aml] read failed:", err?.message);
    res.status(500).json({ message: "The firm's AML supervision could not be read." });
  }
});

router.post("/api/agent-aml/company/:companyId/search", async (req: Request, res: Response) => {
  try {
    if (!(await staffMe(req))) return res.status(403).json({ message: "BGP staff only, signed in as themselves." });
    const company = (await pool.query(`SELECT id, name FROM crm_companies WHERE id = $1`, [req.params.companyId])).rows[0];
    if (!company) return res.status(404).json({ message: "No such company." });
    const name = text(req.body?.name).slice(0, 160) || text(company.name);
    if (!name) return res.status(400).json({ message: "Give a name to search for." });
    const { searchHmrcRegister } = await import("./hmrc-register");
    res.json({ name, ...(await searchHmrcRegister(name)) });
  } catch (err: any) {
    console.error("[agent-aml] register search failed:", err?.message);
    res.status(502).json({ message: `HMRC's register could not be read just now (${text(err?.message).slice(0, 200)}). Search it on GOV.UK and record the result by hand.`, registerPage: "https://www.gov.uk/guidance/money-laundering-regulations-supervised-business-register" });
  }
});

router.put("/api/agent-aml/company/:companyId", async (req: Request, res: Response) => {
  try {
    const me = await staffMe(req);
    if (!me) return res.status(403).json({ message: "BGP staff only, signed in as themselves." });
    const company = (await pool.query(`SELECT id, name FROM crm_companies WHERE id = $1`, [req.params.companyId])).rows[0];
    if (!company) return res.status(404).json({ message: "No such company." });
    const input = agentSupervisionInput(req.body);
    if (!input.ok) return res.status(400).json({ message: input.error });
    const v = input.value;
    const row = (await pool.query(
      `INSERT INTO agent_aml_supervision (company_id, status, registration_number, register_name, register_postcode, register_status,
         supervisor, agreement_in_place, agreement_note, notes, source, register_date, checked_at, checked_by, checked_by_name, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, now(), $13, $14, now())
       ON CONFLICT (company_id) DO UPDATE SET status = EXCLUDED.status, registration_number = EXCLUDED.registration_number,
         register_name = EXCLUDED.register_name, register_postcode = EXCLUDED.register_postcode, register_status = EXCLUDED.register_status,
         supervisor = EXCLUDED.supervisor, agreement_in_place = EXCLUDED.agreement_in_place, agreement_note = EXCLUDED.agreement_note,
         notes = EXCLUDED.notes, source = EXCLUDED.source, register_date = EXCLUDED.register_date,
         checked_at = now(), checked_by = EXCLUDED.checked_by, checked_by_name = EXCLUDED.checked_by_name, updated_at = now()
       RETURNING *`,
      [String(company.id), v.status, v.registrationNumber, v.registerName, v.registerPostcode, v.registerStatus, v.supervisor,
       v.agreementInPlace, v.agreementNote, v.notes, v.source, v.registerDate, me.id, me.name])).rows[0];
    const words = v.status === "registered" ? `Registered with HMRC, ${v.registrationNumber}${v.registerStatus ? ` (${v.registerStatus})` : ""}`
      : v.status === "other_supervisor" ? `Supervised by ${v.supervisor}` : "Not on HMRC's register";
    await pool.query(
      `INSERT INTO kyc_audit_log (company_id, action, performed_by, notes) VALUES ($1, 'agent_hmrc_check', $2, $3)`,
      [String(company.id), me.name, `${words}${v.agreementInPlace === true ? "; agreement in place" : v.agreementInPlace === false ? "; no agreement" : ""}${v.notes ? `. ${v.notes}` : ""}`.slice(0, 1000)]).catch(() => {});
    res.json({ ok: true, record: rowToRecord(row) });
  } catch (err: any) {
    console.error("[agent-aml] not saved:", err?.message);
    res.status(500).json({ message: "The check could not be saved." });
  }
});

router.get("/api/deals/:id/agents-aml", async (req: Request, res: Response) => {
  try {
    if (!(await staffMe(req))) return res.status(403).json({ message: "BGP staff only, signed in as themselves." });
    const out = await dealAgentsAml(pool, String(req.params.id));
    if (!out) return res.status(404).json({ message: "No such deal." });
    res.json(out);
  } catch (err: any) {
    console.error("[agent-aml] deal agents failed:", err?.message);
    res.status(500).json({ message: "The deal's agents could not be read." });
  }
});

export default router;
