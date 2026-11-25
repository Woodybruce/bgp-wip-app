// Client KYC with no transaction (Woody, 24 November 2026: "Yes build it
// within companies and show in the CRM boards and we will want to be able to
// aml all the sub companies within each company ... and use those for xero
// invoicing too"). The rules are shared/client-kyc.ts.
//
// A client file is one subject: a sub company filed under an account
// (crm_trading_entities), or the account's own record when it is a person,
// trust or UK public body. Its steps are a transaction party's, through the
// same code: BGP's checks before asking (server/kyc-prechecks.ts), the client
// checks and people to check (server/aml-portal.ts, the requests with no
// transaction), the documents (server/kyc-documents.ts), the red flags
// (server/kyc-red-flags.ts) and the sign-off rules (signOffFacts and
// signOffDenial). The sign-off writes the approval every transaction reads
// (crm_entity_kyc for a sub company, the record's kyc_* for its own record),
// for the AML policy's re-check period, so a transaction with that company is
// cleared when it comes.
//
//   GET  /api/client-kyc/:companyId/subjects/:entity                the file: state, BGP's checks, red flags, sign-off, next step
//   POST /api/client-kyc/:companyId/subjects/:entity/open           { instruction, contactId? }: opens the file and starts BGP's checks
//   POST /api/client-kyc/:companyId/subjects/:entity/checks         { again? }: BGP's checks on it
//   POST /api/client-kyc/:companyId/subjects/:entity/sign-off       { note }
//   POST /api/client-kyc/:companyId/subjects/:entity/red-flags/set-aside { key, comment } (the officers)
//   POST /api/client-kyc/:companyId/subjects/:entity/red-flags/put-back  { reviewId } (the officers)
//   POST /api/client-kyc/:companyId/subjects/:entity/red-flags/suggest   { key } (the officers: the app's draft of the reason)
//   POST /api/client-kyc/:companyId/checks                         { entityIds, again? }: BGP's checks on many sub companies, one at a time
//   GET  /api/client-kyc/:companyId/checks                         where that run is
//
// :entity is a sub company's id, or "self" for the account's own record. The
// client checks, people and documents of a file are under the same address
// (aml-portal.ts and kyc-documents.ts register both). BGP staff signed in as
// themselves only; nothing here is on a client login's list.

import { Router, type Request, type Response } from "express";
import { pool } from "./db";
import {
  CLIENT_KYC_BULK_MAX, bulkCheckList, clientFileName, clientInstructionLabel, clientKycBucket, clientKycNextStep, clientSubjectEntity,
  isClientInstruction, recordIsOwnSubject, type ClientKycNextFacts,
} from "@shared/client-kyc";
import { DUE_DILIGENCE_LABEL, RECHECK_YEARS } from "@shared/aml-policy";
import { kycVerdict, sameLegalCompany, signOffDenial, signOffEnhanced, signOffInHouse } from "@shared/party-kyc";
import { partySubjectKind } from "@shared/deal-parties";
import type { AmlSubject } from "./deal-party-aml";
import { companySanctionsOnly } from "./kyc-companies";

type Db = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> };

const text = (v: unknown): string => String(v ?? "").replace(/\s+/g, " ").trim();
const iso = (v: unknown): string | null => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

export interface ClientSubject extends AmlSubject {
  accountName: string;
  accountSubjectType: string | null;
  entityNumber: string | null;
  entityKind: string | null;            // the sub company's entity_kind: individual for a person
  country: string | null;               // a company registered abroad
  xero: { id: string; name: string } | null;
  file: ClientFile | null;
}

export interface ClientFile {
  id: string;
  instruction: string | null;
  instructionLabel: string | null;
  contactId: string | null;
  openedAt: string | null;
  openedBy: string | null;
}

async function staffMe(req: Request): Promise<{ id: string; name: string; email: string | null } | null> {
  const userId = (req as any).session?.userId || (req as any).tokenUserId;
  if (!userId) return null;
  const { contactViewer } = await import("./contact-viewer");
  if (!(await contactViewer(req)).staff) return null;
  const me = (await pool.query(`SELECT id, name, email FROM users WHERE id = $1`, [userId])).rows[0];
  return me ? { id: String(me.id), name: text(me.name) || text(me.email) || "BGP", email: me.email || null } : null;
}

export async function openClientFile(db: Db, companyId: string, entityId: string | null): Promise<ClientFile | null> {
  const r = (await db.query(
    `SELECT id, instruction, contact_id, opened_at, opened_by_name FROM kyc_client_files
      WHERE company_id = $1 AND trading_entity_id IS NOT DISTINCT FROM $2::varchar AND closed_at IS NULL
      ORDER BY opened_at DESC LIMIT 1`, [companyId, entityId]).catch(() => ({ rows: [] as any[] }))).rows[0];
  return r ? {
    id: String(r.id), instruction: r.instruction || null, instructionLabel: clientInstructionLabel(r.instruction),
    contactId: r.contact_id || null, openedAt: iso(r.opened_at), openedBy: r.opened_by_name || null,
  } : null;
}

/**
 * The subject of a client file, read the way a transaction party is (its
 * approval through loadPartyKyc, full checks). Null when the account is not
 * found or merged, the sub company is not filed under it, or there is no sub
 * company and the record is an ordinary company (its checks are about a
 * company that signs: file it as a sub company first).
 */
export async function loadClientSubject(db: Db, companyId: string, entityId: string | null): Promise<ClientSubject | null> {
  const c = (await db.query(
    `SELECT id, name, aml_subject_type, merged_into_id, uk_entity_name, companies_house_number, companies_house_data->>'company_name' AS ch_name,
            bgp_contact_user_ids
       FROM crm_companies WHERE id = $1`, [companyId])).rows[0];
  if (!c || c.merged_into_id) return null;
  const e = entityId ? (await db.query(
    `SELECT id, name, companies_house_number, entity_kind, country, xero_contact_id, xero_contact_name
       FROM crm_trading_entities WHERE id = $1 AND parent_company_id = $2`, [entityId, companyId])).rows[0] || null : null;
  if (entityId && !e) return null;
  if (!e && !recordIsOwnSubject(c.aml_subject_type)) return null;
  const { loadPartyKyc } = await import("./deal-gates");
  const state = (await loadPartyKyc(db, [{ role: "client", brandId: companyId, entityId: e ? String(e.id) : null, fullChecks: true }])).client;
  if (!state) return null;
  const sameCompany = !!e && sameLegalCompany(
    { id: companyId, name: c.name, companiesHouseNumber: c.companies_house_number || null, legalName: c.uk_entity_name || c.ch_name || null, status: null, expiresAt: null, approvedBy: null },
    { id: String(e.id), name: e.name, companiesHouseNumber: e.companies_house_number || null, kyc: null });
  const ids = Array.isArray(c.bgp_contact_user_ids) ? c.bgp_contact_user_ids.filter(Boolean).map(String) : [];
  return {
    dealId: null, dealName: clientFileName(c.name), role: "client",
    brandId: String(c.id), brandName: state.brandName || text(c.name),
    entityId: e ? String(e.id) : null, entityName: e ? text(e.name) : null,
    // The company's sanctions-only switch (24 November 2026): lettings under £10,000 a month only, the sanctions steps alone.
    sameCompany, state, regime: (await companySanctionsOnly(db, companyId).catch(() => ({ on: false }))).on ? "sanctions_only" : "full", fullOnSmall: false, jointRule: "other",
    agents: { ids, names: [] },
    accountName: text(c.name), accountSubjectType: c.aml_subject_type || null,
    entityNumber: e?.companies_house_number || null, entityKind: e?.entity_kind || null, country: e?.country || null,
    xero: e?.xero_contact_id ? { id: String(e.xero_contact_id), name: text(e.xero_contact_name) || text(e.name) } : null,
    file: await openClientFile(db, companyId, e ? String(e.id) : null),
  };
}

/** For the routes the client file shares (documents, translation): the subject from :companyId and :entity, or the refusal sent. */
export async function clientSubjectFor(req: Request, res: Response): Promise<ClientSubject | null> {
  const subject = await loadClientSubject(pool, String(req.params.companyId), clientSubjectEntity(String(req.params.entity || "")));
  if (!subject) { res.status(404).json({ message: "That company was not found under this account. File it as a sub company first." }); return null; }
  return subject;
}

// Who may sign a client file off: the officers, or one of the account's own
// BGP people (crm_companies.bgp_contact_user_ids) on a standard or simplified
// file, as an agent on a transaction does (the AML policy: fee earners
// approve standard checks).
async function signOffActor(req: Request, subject: ClientSubject) {
  const { decider } = await import("./deal-party-aml");
  const officer = await decider(req);
  if ("id" in officer) return officer;
  if (officer.status === 401) return officer;
  const me = await staffMe(req);
  if (me && subject.agents.ids.includes(me.id)) {
    const { amlActor } = await import("./aml-authority");
    const actor = await amlActor(req);
    return { id: me.id, name: me.name, mlroAppointed: actor.mlroAppointed, as: "agent" as const, officerRole: null };
  }
  return { refusal: `Only ${subject.accountName}'s BGP people, the Nominated Officer or a Deputy can sign this off.`, status: 403 };
}

async function canDecide(req: Request): Promise<boolean> {
  const { decider } = await import("./deal-party-aml");
  const d = await decider(req).catch(() => null);
  return !!d && "id" in d;
}

/** The file as the client KYC box draws it. */
export async function clientFileView(req: Request, subject: ClientSubject) {
  const { latestPrecheck, precheckRunning } = await import("./kyc-prechecks");
  const { precheckCardLines, precheckCompany } = await import("@shared/kyc-prechecks");
  const { loadDealRedFlags } = await import("./kyc-red-flags");
  const { signOffFacts, signOffView } = await import("./deal-party-aml");
  const { clientChecksForDeal } = await import("./aml-portal");
  const stored = await latestPrecheck(subject.brandId, subject.entityId).catch(() => null);
  const running = precheckRunning(subject.brandId, subject.entityId);
  const flags = await loadDealRedFlags(null, [subject.brandId], subject.entityId ? { [subject.brandId]: subject.entityId } : {})
    .catch(() => ({ parties: {}, deal: [], setAside: {}, dealSetAside: [], unchecked: ["the red flags"], levels: {} } as any));
  // Only the red flags are handed over: signOffFacts reads BGP's checks itself (owners abroad included).
  const facts = await signOffFacts(pool, subject, { redFlags: flags });
  const view = signOffView(facts);
  const requests = await clientChecksForDeal(null, { companyId: subject.brandId, entityId: subject.entityId }).catch(() => []);
  const main = requests.find((r: any) => !r.person) || null;
  const officer = await canDecide(req);
  const me = await staffMe(req);
  const canSignOff = officer || (!!me && subject.agents.ids.includes(me.id));
  const verdict = kycVerdict(subject.state);
  const live = (flags.parties?.[subject.brandId] || []) as any[];
  const contact = subject.file?.contactId
    ? (await pool.query(`SELECT id, name, email FROM crm_contacts WHERE id = $1 AND company_id = $2`, [subject.file.contactId, subject.brandId])).rows[0] || null
    : null;
  // On a sanctions-only company a sanctions-only sign-off is all it needs.
  const bucket = clientKycBucket({ status: subject.state.status, expiresAt: subject.state.expiresAt ? iso(subject.state.expiresAt) : null, scope: subject.regime === "sanctions_only" ? null : (subject.state as any).scope || null,
    started: !!subject.file || !!stored || requests.length > 0 }, new Date());
  const smallOnly = subject.regime === "sanctions_only";
  const nextFacts: ClientKycNextFacts = {
    rejected: subject.state.status === "rejected",
    cleared: verdict.approved && (smallOnly || bucket !== "sanctions_only") ? { until: subject.state.expiresAt ? iso(subject.state.expiresAt) : null } : null,
    sanctionsOnly: !smallOnly && bucket === "sanctions_only",
    sanctionsChecks: smallOnly,
    precheck: running ? "running" : stored ? "done" : "not_run",
    redFlags: live.length,
    canDecide: officer,
    whoToAsk: main?.recipientName || contact?.name || null,
    request: main ? main.status : "none",
    waitingOn: view.outstanding.length && main?.status === "finished" ? requests.filter((r: any) => r.person && r.status !== "finished").map((r: any) => r.person.name) : [],
    signOffBlocked: view.blocked,
    dobNeeded: !!view.person?.needed && !view.person.details,
  };
  const fmt = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" });
  const { rows: transactions } = await pool.query(
    `SELECT d.id, d.name, d.deal_ref, d.status, r.role FROM crm_deals d
       CROSS JOIN LATERAL (VALUES ('landlord', d.landlord_id, d.landlord_trading_entity_id), ('tenant', d.tenant_id, d.tenant_trading_entity_id),
                                  ('vendor', d.vendor_id, d.vendor_trading_entity_id), ('purchaser', d.purchaser_id, d.purchaser_trading_entity_id)) AS r(role, brand_id, entity_id)
      WHERE r.brand_id = $1 AND r.entity_id IS NOT DISTINCT FROM $2::varchar AND COALESCE(d.status, '') NOT IN ('WIT', 'ARC', 'Withdrawn', 'Archived')
      ORDER BY d.updated_at DESC NULLS LAST LIMIT 12`, [subject.brandId, subject.entityId]).catch(() => ({ rows: [] as any[] }));
  return {
    subject: {
      companyId: subject.brandId, accountName: subject.accountName, entityId: subject.entityId, name: subject.entityName || subject.accountName,
      number: subject.entityNumber, kind: partySubjectKind(subject.accountSubjectType, subject.entityId ? { kind: subject.entityKind } : null),
      country: subject.country, sameCompany: subject.sameCompany,
    },
    file: subject.file ? { ...subject.file, contact: contact ? { id: String(contact.id), name: contact.name, email: contact.email || null } : null } : null,
    state: {
      status: subject.state.status, expiresAt: subject.state.expiresAt ? iso(subject.state.expiresAt) : null, approvedBy: subject.state.approvedBy || null,
      scope: (subject.state as any).scope || null, bucket,
    },
    precheck: stored || running ? {
      ranAt: stored?.ranAt || null, running: !!running,
      lines: stored ? precheckCardLines(stored.result, { publicBody: !subject.entityId && String(subject.accountSubjectType || "").trim().toLowerCase() === "public_body" }) : [],
      company: stored ? precheckCompany(stored.result) : null,
    } : null,
    flags: { live, setAside: flags.setAside?.[subject.brandId] || [], level: flags.levels?.[subject.brandId] || null, unchecked: flags.unchecked || [] },
    signOff: { ...view, canSignOff, canDecide: officer },
    // The documents are in once the client checks came back and nobody still owes theirs (or the company is cleared).
    documents: {
      done: bucket === "cleared" || bucket === "expiring" || (main?.status === "finished" && view.outstanding.length === 0),
      // For the Documents step's line, worked out by the rule every AML screen uses (shared/aml-steps.ts).
      request: main ? { status: main.status, who: main.recipientName || main.recipientEmail || "the client", sentAt: main.sentAt || null } : null,
      owing: view.outstanding.length,
    },
    // The company's sanctions-only switch: the three sanctions steps, and nothing asked of the client.
    sanctionsOnly: smallOnly,
    next: clientKycNextStep(nextFacts, fmt),
    xero: subject.xero,
    transactions: transactions.map((d: any) => ({ id: String(d.id), name: text(d.name) || "Untitled transaction", ref: d.deal_ref ?? null, status: d.status || null, role: d.role })),
  };
}

// ── BGP's checks on many sub companies, one at a time ──────────────────────
//
// One run of BGP's checks reads Companies House, the sanctions lists, the web
// and ComplyAdvantage, under a daily allowance (KYC_PRECHECK_DAILY_CAP): the
// picked sub companies are run one after another, and those left when the
// allowance is used say so. The queue is in memory: a restart loses the
// waiting ones, which read "not run" and can be run again.

type BulkState = "waiting" | "running" | "done" | "fresh" | "cap" | "failed" | "off";
const bulkQueue: Array<{ companyId: string; entityId: string; userId: string; again: boolean }> = [];
const bulkState = new Map<string, { state: BulkState; at: number }>();
let bulkWorking = false;
const bulkKey = (companyId: string, entityId: string) => `${companyId}|${entityId}`;

async function workBulk(): Promise<void> {
  if (bulkWorking) return;
  bulkWorking = true;
  try {
    const { startPrecheck, awaitPrecheck } = await import("./kyc-prechecks");
    while (bulkQueue.length) {
      const job = bulkQueue.shift()!;
      const key = bulkKey(job.companyId, job.entityId);
      bulkState.set(key, { state: "running", at: Date.now() });
      let start: string;
      try {
        start = await startPrecheck(job.companyId, { entityId: job.entityId, userId: job.userId, force: job.again });
      } catch {
        start = "failed";
      }
      if (start === "cap" || start === "off") {
        // The day's allowance is used (or the checks are switched off): the rest wait for a person to run them again.
        bulkState.set(key, { state: start, at: Date.now() });
        for (const left of bulkQueue.splice(0)) bulkState.set(bulkKey(left.companyId, left.entityId), { state: start, at: Date.now() });
        break;
      }
      if (start === "started" || start === "running") await awaitPrecheck(job.companyId, 15 * 60_000, job.entityId).catch(() => null);
      bulkState.set(key, { state: start === "fresh" ? "fresh" : start === "failed" ? "failed" : "done", at: Date.now() });
    }
  } finally {
    bulkWorking = false;
  }
}

/** Where a company's run is: each picked sub company's state in the last six hours. */
export function bulkCheckState(companyId: string): Record<string, BulkState> {
  const out: Record<string, BulkState> = {};
  const cutoff = Date.now() - 6 * 3600_000;
  for (const [key, v] of bulkState) {
    const [c, e] = key.split("|");
    if (c === companyId && v.at >= cutoff) out[e] = v.state;
  }
  return out;
}

// ── Routes ──────────────────────────────────────────────────────────────────

export const clientKycRouter = Router();

const STAFF_ONLY = "BGP staff only, signed in as themselves.";

clientKycRouter.get("/api/client-kyc/:companyId/subjects/:entity", async (req: Request, res: Response) => {
  try {
    if (!(await staffMe(req))) return res.status(403).json({ message: STAFF_ONLY });
    const subject = await clientSubjectFor(req, res);
    if (!subject) return;
    res.json(await clientFileView(req, subject));
  } catch (err: any) {
    console.error("[client-kyc] read failed:", err?.message);
    res.status(500).json({ message: "The client's checks could not be loaded." });
  }
});

clientKycRouter.post("/api/client-kyc/:companyId/subjects/:entity/open", async (req: Request, res: Response) => {
  try {
    const me = await staffMe(req);
    if (!me) return res.status(403).json({ message: STAFF_ONLY });
    const subject = await clientSubjectFor(req, res);
    if (!subject) return;
    const instruction = req.body?.instruction == null || req.body.instruction === "" ? null : String(req.body.instruction);
    if (instruction && !isClientInstruction(instruction)) return res.status(400).json({ message: "Pick what BGP is instructed on." });
    const contactId = req.body?.contactId ? String(req.body.contactId) : null;
    if (contactId) {
      const at = (await pool.query(`SELECT 1 FROM crm_contacts WHERE id = $1 AND company_id = $2`, [contactId, subject.brandId])).rows[0];
      if (!at) return res.status(400).json({ message: `That person is not filed under ${subject.accountName}.` });
    }
    if (subject.file) {
      await pool.query(`UPDATE kyc_client_files SET instruction = COALESCE($2, instruction), contact_id = COALESCE($3, contact_id) WHERE id = $1`,
        [subject.file.id, instruction, contactId]);
    } else {
      await pool.query(
        `INSERT INTO kyc_client_files (company_id, trading_entity_id, instruction, contact_id, opened_by, opened_by_name) VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT DO NOTHING`,
        [subject.brandId, subject.entityId, instruction, contactId, me.id, me.name]);
      await pool.query(`INSERT INTO kyc_audit_log (company_id, action, performed_by, notes, entity_kind, entity_id) VALUES ($1, 'client_file_opened', $2, $3, $4, $5)`,
        [subject.brandId, me.name, `Client checks opened on ${subject.entityName || subject.accountName}${instruction ? ` (${clientInstructionLabel(instruction)?.toLowerCase()})` : ""}, with no transaction`,
          subject.entityId ? "trading_entity" : null, subject.entityId]).catch(() => {});
    }
    // BGP's checks start at once, unless they ran in the last 30 days.
    const { startPrecheck } = await import("./kyc-prechecks");
    void startPrecheck(subject.brandId, { entityId: subject.entityId, userId: me.id }).catch(() => {});
    const fresh = await loadClientSubject(pool, subject.brandId, subject.entityId);
    res.json(await clientFileView(req, fresh || subject));
  } catch (err: any) {
    console.error("[client-kyc] open failed:", err?.message);
    res.status(500).json({ message: "The client's checks could not be opened." });
  }
});

clientKycRouter.post("/api/client-kyc/:companyId/subjects/:entity/checks", async (req: Request, res: Response) => {
  try {
    const me = await staffMe(req);
    if (!me) return res.status(403).json({ message: STAFF_ONLY });
    const subject = await clientSubjectFor(req, res);
    if (!subject) return;
    const { startPrecheck } = await import("./kyc-prechecks");
    const started = await startPrecheck(subject.brandId, { entityId: subject.entityId, userId: me.id, force: req.body?.again === true });
    if (started === "cap") return res.status(429).json({ message: "Today's allowance of BGP's checks is used. They can be run again tomorrow.", started });
    if (started === "off") return res.status(410).json({ message: "BGP's checks are switched off.", started });
    res.json({ started, view: await clientFileView(req, subject) });
  } catch (err: any) {
    console.error("[client-kyc] checks failed:", err?.message);
    res.status(500).json({ message: "BGP's checks could not be started." });
  }
});

clientKycRouter.post("/api/client-kyc/:companyId/checks", async (req: Request, res: Response) => {
  try {
    const me = await staffMe(req);
    if (!me) return res.status(403).json({ message: STAFF_ONLY });
    const companyId = String(req.params.companyId);
    const filed = (await pool.query(
      `SELECT e.id FROM crm_trading_entities e JOIN crm_companies c ON c.id = e.parent_company_id
        WHERE e.parent_company_id = $1 AND c.merged_into_id IS NULL`, [companyId])).rows.map((r: any) => String(r.id));
    const plan = bulkCheckList(req.body?.entityIds, filed);
    if (!plan.ids.length) return res.status(400).json({ message: "Pick the sub companies to check." });
    const again = req.body?.again === true;
    let queued = 0;
    for (const entityId of plan.ids) {
      const key = bulkKey(companyId, entityId);
      const now = bulkState.get(key)?.state;
      if (now === "waiting" || now === "running") continue;
      bulkQueue.push({ companyId, entityId, userId: me.id, again });
      bulkState.set(key, { state: "waiting", at: Date.now() });
      queued++;
    }
    await pool.query(`INSERT INTO kyc_audit_log (company_id, action, performed_by, notes) VALUES ($1, 'client_checks_bulk', $2, $3)`,
      [companyId, me.name, `BGP's checks asked for on ${queued} sub compan${queued === 1 ? "y" : "ies"}${again ? " (again)" : ""}`]).catch(() => {});
    void workBulk();
    res.json({ queued, over: plan.over, unknown: plan.unknown, max: CLIENT_KYC_BULK_MAX, state: bulkCheckState(companyId) });
  } catch (err: any) {
    console.error("[client-kyc] bulk checks failed:", err?.message);
    res.status(500).json({ message: "The checks could not be started." });
  }
});

clientKycRouter.get("/api/client-kyc/:companyId/checks", async (req: Request, res: Response) => {
  if (!(await staffMe(req).catch(() => null))) return res.status(403).json({ message: STAFF_ONLY });
  res.json({ state: bulkCheckState(String(req.params.companyId)) });
});

clientKycRouter.post("/api/client-kyc/:companyId/subjects/:entity/sign-off", async (req: Request, res: Response) => {
  try {
    const subject = await clientSubjectFor(req, res);
    if (!subject) return;
    const me = await signOffActor(req, subject);
    if (!("id" in me)) return res.status(me.status).json({ message: me.refusal });
    const { signOffFacts, approveBrand } = await import("./deal-party-aml");
    const facts = await signOffFacts(pool, subject);
    const note = text(req.body?.note).slice(0, 1000);
    const denial = signOffDenial({ ...facts, note });
    if (denial) return res.status(409).json({ message: denial, code: "SIGN_OFF_REFUSED" });
    const edd = signOffEnhanced(facts) && signOffInHouse(facts);
    if (edd && me.as !== "officer") return res.status(403).json({ message: "Enhanced due diligence is signed off by the Nominated Officer or a Deputy.", code: "SIGN_OFF_REFUSED" });
    const level = edd ? "enhanced" : facts.level && facts.level.level !== "enhanced" ? facts.level.level : "standard";
    const years = RECHECK_YEARS[level];
    const smallOnly = subject.regime === "sanctions_only";
    const relied = [
      smallOnly ? null : DUE_DILIGENCE_LABEL[level].toLowerCase(),
      level === "simplified" && facts.level?.why[0] ? `why: ${facts.level.why[0]}` : null,
      edd ? "done by BGP's officers" : null,
      // The company's switch (24 November 2026): the brand's history line carries these words, which brandSignOffScope reads.
      smallOnly ? "sanctions checks only (lettings under £10,000 a month)" : null,
      subject.file?.instructionLabel ? `checks for ${subject.file.instructionLabel.toLowerCase()}, before any transaction` : "checks before any transaction",
      facts.precheck ? `BGP's checks before asking ${facts.precheck.ranAt.slice(0, 10)}` : null,
      smallOnly ? null : facts.clientChecksFinished ? "client checks finished" : `client checks not finished${facts.clientChecksOutstanding?.length ? ` (still to come: ${facts.clientChecksOutstanding.join("; ")})` : ""}`,
      note ? `note: ${note}` : null,
    ].filter(Boolean).join("; ");
    const who = me.as === "agent" ? `${me.name} (BGP's contact for ${subject.accountName})` : `${me.name}${me.officerRole === "nominated" ? " (Nominated Officer)" : me.officerRole === "deputy" ? " (Deputy Nominated Officer)" : ""}`;
    // A listed company's note, written from the file (24 November 2026), kept with the approval.
    const line = `BGP sign-off on ${subject.entityName || subject.accountName}, ${subject.dealName}, by ${who}: ${relied}${facts.fileNote ? `. Written from the file: ${facts.fileNote}` : ""}`;
    if (subject.entityId) {
      const { approveEntityKyc } = await import("./account-entities");
      const r = await approveEntityKyc("trading_entity", subject.entityId, me.name, {
        reminderCompanyId: subject.brandId, notes: line, recheckYears: years,
        evidence: { bgpSignOff: { by: me.name, userId: me.id, as: me.as, at: new Date().toISOString(), dealId: null, role: "client", clientFile: subject.file?.id || null,
          instruction: subject.file?.instruction || null, note: note || null, fileNote: facts.fileNote || null, level, regime: subject.regime, precheckRanAt: facts.precheck?.ranAt || null, clientChecksFinished: facts.clientChecksFinished } },
      });
      if (r.status !== 200) return res.status(r.status).json({ message: "The company was not found." });
      const { recomputeDealsForTradingEntity } = await import("./deal-gates");
      await recomputeDealsForTradingEntity(subject.entityId, me.name).catch((e: any) => console.warn("[client-kyc] transaction recompute failed:", e?.message));
    } else {
      await approveBrand(subject, me, line, years);
      const { recomputeDealKycApproved } = await import("./deal-gates");
      await recomputeDealKycApproved(subject.brandId, me.name).catch((e: any) => console.warn("[client-kyc] transaction recompute failed:", e?.message));
    }
    // The file is done: it stays on the record, closed.
    await pool.query(`UPDATE kyc_client_files SET closed_at = now(), closed_by_name = $3, outcome = 'approved'
       WHERE company_id = $1 AND trading_entity_id IS NOT DISTINCT FROM $2::varchar AND closed_at IS NULL`, [subject.brandId, subject.entityId, me.name]).catch(() => {});
    const after = await loadClientSubject(pool, subject.brandId, subject.entityId);
    res.json({ ok: true, years, level, view: after ? await clientFileView(req, after) : null });
  } catch (err: any) {
    console.error("[client-kyc] sign-off failed:", err?.message);
    res.status(500).json({ message: "The sign-off could not be saved." });
  }
});

clientKycRouter.post("/api/client-kyc/:companyId/subjects/:entity/red-flags/set-aside", async (req: Request, res: Response) => {
  try {
    const { decider } = await import("./deal-party-aml");
    const me = await decider(req);
    if (!("id" in me)) return res.status(me.status).json({ message: me.refusal });
    const subject = await clientSubjectFor(req, res);
    if (!subject) return;
    const { flagReviewComment } = await import("@shared/kyc-red-flags");
    const said = flagReviewComment(req.body?.comment);
    if ("problem" in said) return res.status(400).json({ message: said.problem });
    const key = text(req.body?.key).slice(0, 300);
    if (!key) return res.status(400).json({ message: "Which red flag?" });
    const { setFlagAside } = await import("./kyc-red-flags");
    const done = await setFlagAside({ dealId: null, brandId: subject.brandId, entityId: subject.entityId, key, comment: said.comment, me });
    res.json({ ok: true, review: done.review });
  } catch (err: any) {
    if (err?.name === "FlagReviewRefusal") return res.status(err.status || 409).json({ message: err.message });
    console.error("[client-kyc] set aside failed:", err?.message);
    res.status(500).json({ message: "The red flag could not be set aside." });
  }
});

// The app's draft of the reason for setting a flag aside (server/flag-set-aside.ts). Saves nothing.
clientKycRouter.post("/api/client-kyc/:companyId/subjects/:entity/red-flags/suggest", async (req: Request, res: Response) => {
  try {
    const { decider } = await import("./deal-party-aml");
    const me = await decider(req);
    if (!("id" in me)) return res.status(me.status).json({ message: me.refusal });
    const subject = await clientSubjectFor(req, res);
    if (!subject) return;
    const key = text(req.body?.key).slice(0, 300);
    if (!key) return res.status(400).json({ message: "Which red flag?" });
    const { suggestSetAside } = await import("./flag-set-aside");
    res.json(await suggestSetAside({ dealId: null, brandId: subject.brandId, entityId: subject.entityId, key }));
  } catch (err: any) {
    if (err?.name === "SuggestRefusal") return res.status(err.status || 409).json({ message: err.message });
    console.error("[client-kyc] suggest failed:", err?.message);
    res.status(500).json({ message: "The app could not draft a reason." });
  }
});

clientKycRouter.post("/api/client-kyc/:companyId/subjects/:entity/red-flags/put-back", async (req: Request, res: Response) => {
  try {
    const { decider } = await import("./deal-party-aml");
    const me = await decider(req);
    if (!("id" in me)) return res.status(me.status).json({ message: me.refusal });
    const subject = await clientSubjectFor(req, res);
    if (!subject) return;
    const reviewId = Number(req.body?.reviewId);
    if (!Number.isInteger(reviewId) || reviewId <= 0) return res.status(400).json({ message: "Which red flag?" });
    const { putFlagBack } = await import("./kyc-red-flags");
    await putFlagBack({ dealId: null, partyIds: [subject.brandId], reviewId, me });
    res.json({ ok: true });
  } catch (err: any) {
    if (err?.name === "FlagReviewRefusal") return res.status(err.status || 409).json({ message: err.message });
    console.error("[client-kyc] put back failed:", err?.message);
    res.status(500).json({ message: "The red flag could not be put back." });
  }
});
