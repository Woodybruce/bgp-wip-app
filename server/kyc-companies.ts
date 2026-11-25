// The Companies view on Transactions → AML (Woody, 24 November 2026: "We need
// a dashboard so it's easy to search and add a company ... Should auto
// populate with all the companies we have in the transactions list both
// brands and landlords ... we also want the deals / transactions to also be
// in there"). One row per company, built from the AML board's own rows (the
// transactions it covers, each party read the board's way) plus any company
// added here with no transaction or with a client file open. The rules are
// shared/kyc-companies.ts; the per-company KYC is the same read as the CRM
// chip (one count everywhere).
//
//   GET  /api/aml-dashboard/companies                    the rows
//   GET  /api/aml-dashboard/companies/search?q=           CRM companies to add (name, type, website, transactions)
//   POST /api/aml-dashboard/companies/list                { companyId }: add a company with no transaction to the view
//   PUT  /api/aml-dashboard/companies/:id/sanctions-only  { on: true | false | null }: the switch (null = worked out)
//
// BGP staff signed in as themselves only; /api/aml-dashboard is on no client
// login's list and outside the retired /api/aml/ address.

import { Router, type Request, type Response } from "express";
import { pool } from "./db";
import { isPrivateMailboxAddress } from "./private-mail";
import { subCompanyKycSql, subCompanyScope } from "@shared/client-kyc";
import { requirementStateSql } from "@shared/requirement-live";
import { DEAL_PARTY_ROLES, type DealPartyRole } from "@shared/deal-parties";
import {
  kycCompanyChip, kycCompanyKind, kycCompanyNext, kycCompanyWebsite, kycSanctionsOnly, transactionWaiting,
  type KycCompanyAgent, type KycCompanyEntity, type KycCompanyPerson, type KycCompanyRow, type KycCompanyTransaction,
} from "@shared/kyc-companies";

const text = (v: unknown): string => String(v ?? "").replace(/\s+/g, " ").trim();
const SUB_KYC = subCompanyKycSql("e");
const iso = (v: unknown): string | null => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

async function staffMe(req: Request): Promise<{ id: string; name: string } | null> {
  const userId = (req as any).session?.userId || (req as any).tokenUserId;
  if (!userId) return null;
  const { contactViewer } = await import("./contact-viewer");
  if (!(await contactViewer(req)).staff) return null;
  const u = (await pool.query(`SELECT id, name, email FROM users WHERE id = $1`, [userId])).rows[0];
  return u ? { id: String(u.id), name: text(u.name) || text(u.email) } : null;
}

// The agent the transaction records for each side (the joint agent checks' own list).
const SIDE_AGENT: Record<DealPartyRole, [string, string]> = {
  landlord: ["leasing_agent_id", "leasing_agent_contact_id"],
  tenant: ["acquisition_agent_id", "acquisition_agent_contact_id"],
  vendor: ["vendor_agent_id", "vendor_agent_contact_id"],
  purchaser: ["purchaser_agent_id", "purchaser_agent_contact_id"],
};

/** Each read on its own: one that fails leaves its part empty and is named, never the whole view. */
async function side(label: string, sql: string, params: unknown[], unchecked: string[]): Promise<any[]> {
  try { return (await pool.query(sql, params)).rows; }
  catch (e: any) { console.warn(`[kyc-companies] ${label} not read: ${e?.message}`); unchecked.push(label); return []; }
}

export async function loadKycCompanies(me: { id: string; name: string }, now: Date = new Date()): Promise<{ rows: KycCompanyRow[]; unchecked: string[] }> {
  const { loadAmlDashboard } = await import("./aml-dashboard");
  const board = await loadAmlDashboard(me, now);
  const unchecked: string[] = [...board.unchecked];

  const txByCompany = new Map<string, KycCompanyTransaction[]>();
  const rolesByCompany = new Map<string, string[]>();
  const partyKeys: Array<{ dealId: string; role: DealPartyRole; companyId: string; ref: number | null }> = [];
  for (const r of board.rows) {
    const list = txByCompany.get(r.brandId) || [];
    list.push({
      id: r.dealId, ref: r.dealRef, name: r.dealName, status: r.dealStatus, dealType: r.dealType, role: r.role,
      signsAs: r.signsAs, stage: r.stage, bucket: r.bucket, sanctionsOnly: !!r.sanctionsOnly, late: r.late, waitingOn: r.waitingOn,
    });
    txByCompany.set(r.brandId, list);
    rolesByCompany.set(r.brandId, [...(rolesByCompany.get(r.brandId) || []), r.role]);
    if ((DEAL_PARTY_ROLES as readonly string[]).includes(r.role)) partyKeys.push({ dealId: r.dealId, role: r.role as DealPartyRole, companyId: r.brandId, ref: r.dealRef });
  }

  // Added here with no transaction, or with a client file open.
  const listedRows = await side("the companies added here", `SELECT id FROM crm_companies WHERE kyc_listed_at IS NOT NULL
                 UNION SELECT company_id FROM kyc_client_files WHERE closed_at IS NULL`, [], unchecked);
  const listed = new Set(listedRows.map(r => String(r.id)));
  const ids = [...new Set([...txByCompany.keys(), ...listed])];
  if (!ids.length) return { rows: [], unchecked };

  const [companies, entities, contacts, reps, reqAgents, dealAgents, requests, kyc4u] = await Promise.all([
    side("the companies", `SELECT id, name, company_type, domain, domain_url, aml_subject_type, kyc_sanctions_only, kyc_listed_at,
              kyc_status, kyc_expires_at, kyc_checked_at
         FROM crm_companies WHERE id = ANY($1::text[]) AND merged_into_id IS NULL AND archived_at IS NULL`, [ids], unchecked),
    // The CRM chip's own read: each sub company with its KYC, and the record itself when it is a person, trust or public body.
    side("the contracting entities", `SELECT e.id, e.parent_company_id AS company_id, e.name, e.companies_house_number, e.entity_kind, e.country, e.xero_contact_id,
              ${SUB_KYC.columns},
              (EXISTS (SELECT 1 FROM kyc_client_files f WHERE f.trading_entity_id = e.id AND f.closed_at IS NULL)
                OR EXISTS (SELECT 1 FROM kyc_investigations i WHERE i.trading_entity_id = e.id AND i.result->>'kind' = 'precheck')) AS started,
              (SELECT count(*)::int FROM crm_deals d WHERE d.landlord_trading_entity_id = e.id OR d.tenant_trading_entity_id = e.id
                   OR d.vendor_trading_entity_id = e.id OR d.purchaser_trading_entity_id = e.id) AS signs_on
         FROM crm_trading_entities e
         ${SUB_KYC.joins}
        WHERE e.parent_company_id = ANY($1::text[])
       UNION ALL
       SELECT NULL, c.id, c.name, c.companies_house_number, c.aml_subject_type, NULL, NULL,
              c.kyc_status, c.kyc_expires_at, c.kyc_checked_at, NULL, NULL, l.notes, l.created_at, true,
              EXISTS (SELECT 1 FROM kyc_client_files f WHERE f.company_id = c.id AND f.trading_entity_id IS NULL AND f.closed_at IS NULL), 0
         FROM crm_companies c
         LEFT JOIN LATERAL (SELECT notes, created_at FROM kyc_audit_log WHERE company_id = c.id AND action = 'kyc_approved'
                             ORDER BY created_at DESC NULLS LAST, id DESC LIMIT 1) l ON true
        WHERE c.id = ANY($1::text[]) AND lower(COALESCE(c.aml_subject_type, '')) IN ('individual', 'trust', 'public_body')`, [ids], unchecked),
    side("the contacts", `SELECT id, company_id, name, role, email, phone, phone_mobile, is_favourite FROM crm_contacts WHERE company_id = ANY($1::text[])`, [ids], unchecked),
    // A brand's agents: its current tenant reps, and the agent on an open requirement (the CRM watch list's rule).
    side("the tenant reps", `SELECT r.brand_company_id AS company_id, r.agent_company_id AS firm_id, f.name AS firm, r.primary_contact_id AS contact_id,
              p.name AS person, p.email
         FROM brand_agent_representations r
         LEFT JOIN crm_companies f ON f.id = r.agent_company_id
         LEFT JOIN crm_contacts p ON p.id = r.primary_contact_id
        WHERE r.end_date IS NULL AND r.brand_company_id = ANY($1::text[])`, [ids], unchecked),
    side("the requirement agents", `SELECT q.company_id, p.company_id AS firm_id, f.name AS firm, q.agent_contact_id AS contact_id, p.name AS person, p.email
         FROM crm_requirements_leasing q
         JOIN crm_contacts p ON p.id = q.agent_contact_id
         LEFT JOIN crm_companies f ON f.id = p.company_id
        WHERE q.company_id = ANY($1::text[]) AND (${requirementStateSql("q")}) <> 'closed'`, [ids], unchecked),
    partyKeys.length ? side("the transactions' agents", `SELECT d.id, ${Object.values(SIDE_AGENT).flat().map(c => `d.${c}`).join(", ")} FROM crm_deals d WHERE d.id = ANY($1::text[])`,
      [[...new Set(partyKeys.map(p => p.dealId))]], unchecked) : Promise.resolve([] as any[]),
    // A client checks request with no transaction, still out: who it waits on.
    side("the client checks", `SELECT DISTINCT ON (company_id, trading_entity_id) company_id, trading_entity_id, contact_name, completed_at, revoked_at, expires_at, request->>'sentAt' AS sent_at
         FROM kyc_upload_tokens
        WHERE deal_id IS NULL AND company_id = ANY($1::text[]) AND is_test IS NOT TRUE AND request IS NOT NULL
          AND COALESCE(jsonb_typeof(request->'person'), 'null') <> 'object'
        ORDER BY company_id, trading_entity_id, created_at DESC`, [ids], unchecked),
    // KYC4U's request folders on each company (its past checks; the KYC4U strip's own read).
    side("KYC4U's past checks", `SELECT COALESCE(q.company_id_manual, q.company_id, e.parent_company_id) AS company_id,
              q.list_id, q.item_id, q.modified_at_source AS last
         FROM kyc4u_requests q
         LEFT JOIN crm_trading_entities e ON e.id = q.trading_entity_id
        WHERE COALESCE(q.company_id_manual, q.company_id, e.parent_company_id) = ANY($1::text[]) AND q.list_id <> 'manual'`, [ids], unchecked),
  ]);
  // And every KYC4U request that names one of a company's registered companies,
  // wherever it was filed (Sheet Anchor, 25 November 2026): the strip's own rule.
  const { kyc4uRequestsNaming } = await import("./kyc4u-named");
  const named = await kyc4uRequestsNaming(ids).catch((e: any) => { unchecked.push("KYC4U's checks named for each company"); console.warn("[kyc-companies] KYC4U by name:", e?.message); return new Map(); });
  const kyc4uSeen = new Map<string, Map<string, number>>();
  const kyc4uAdd = (companyId: string, key: string, last: unknown) => {
    const t = last ? new Date(last as any).getTime() : 0;
    const m = kyc4uSeen.get(companyId) || new Map<string, number>();
    m.set(key, Math.max(m.get(key) || 0, Number.isNaN(t) ? 0 : t));
    kyc4uSeen.set(companyId, m);
  };
  for (const r of kyc4u) kyc4uAdd(String(r.company_id), `${r.list_id}:${r.item_id}`, r.last);
  for (const [companyId, list] of named) for (const r of list) kyc4uAdd(companyId, `${r.listId}:${r.itemId}`, r.modifiedAt);
  const kyc4uBy = new Map([...kyc4uSeen.entries()].map(([companyId, m]) => {
    const last = Math.max(0, ...m.values());
    return [companyId, { folders: m.size, last: last ? new Date(last).toISOString() : null }] as const;
  }));

  // The agents the transactions record, named once.
  const agentIds = new Set<string>();
  for (const d of dealAgents) for (const [firmCol, personCol] of Object.values(SIDE_AGENT)) { if (d[firmCol]) agentIds.add(String(d[firmCol])); if (d[personCol]) agentIds.add(String(d[personCol])); }
  const [firms, people] = agentIds.size ? await Promise.all([
    side("the agent firms", `SELECT id, name FROM crm_companies WHERE id = ANY($1::text[])`, [[...agentIds]], unchecked),
    side("the agent contacts", `SELECT id, name, email FROM crm_contacts WHERE id = ANY($1::text[])`, [[...agentIds]], unchecked),
  ]) : [[], []];
  const firmName = new Map(firms.map(f => [String(f.id), text(f.name)]));
  const person = new Map(people.map(p => [String(p.id), { name: text(p.name), email: text(p.email) || null }]));
  const dealById = new Map(dealAgents.map(d => [String(d.id), d]));

  const group = <T>(rows: T[], key: (r: T) => string) => {
    const m = new Map<string, T[]>();
    for (const r of rows) { const k = key(r); m.set(k, [...(m.get(k) || []), r]); }
    return m;
  };
  const entitiesBy = group(entities, (r: any) => String(r.company_id));
  const contactsBy = group(contacts.filter((r: any) => !isPrivateMailboxAddress(r.email)), (r: any) => String(r.company_id));
  const repsBy = group([...reps.map((r: any) => ({ ...r, on: "Tenant rep" })), ...reqAgents.map((r: any) => ({ ...r, on: "Agent on a requirement" }))], (r: any) => String(r.company_id));
  const requestsBy = group(requests, (r: any) => String(r.company_id));
  const partiesBy = group(partyKeys, p => p.companyId);
  const fmt = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" });

  const rows: KycCompanyRow[] = [];
  for (const c of companies) {
    const id = String(c.id);
    const transactions = (txByCompany.get(id) || []).sort((a, b) => (b.ref ?? 0) - (a.ref ?? 0));
    const switchState = kycSanctionsOnly(transactions, c.kyc_sanctions_only);
    const ents: KycCompanyEntity[] = (entitiesBy.get(id) || []).map((e: any) => {
      const status = text(e.kyc_status) || null;
      const kindRaw = text(e.entity_kind).toLowerCase();
      return {
        id: e.id ? String(e.id) : null,
        name: text(e.name),
        number: text(e.companies_house_number) || null,
        kind: kindRaw === "individual" ? "person" : e.country && !/^(uk|gb|united kingdom|great britain|england|scotland|wales|northern ireland)$/i.test(text(e.country)) ? "abroad" : "company",
        status,
        expiresAt: iso(e.expires_at),
        scope: subCompanyScope(e),
        started: !!e.started,
        xero: !!e.xero_contact_id,
        signsOn: Number(e.signs_on) || 0,
      } satisfies KycCompanyEntity;
    }).sort((a, b) => b.signsOn - a.signsOn || a.name.localeCompare(b.name, "en-GB"));
    const ppl = (contactsBy.get(id) || []).sort((a: any, b: any) => Number(!!b.is_favourite) - Number(!!a.is_favourite) || Number(!!b.email) - Number(!!a.email) || text(a.name).localeCompare(text(b.name), "en-GB"));
    const first: KycCompanyPerson[] = ppl.slice(0, 4).map((p: any) => ({ id: String(p.id), name: text(p.name), role: text(p.role) || null, email: text(p.email) || null, phone: text(p.phone_mobile) || text(p.phone) || null }));
    const agents: KycCompanyAgent[] = [];
    const seen = new Set<string>();
    const addAgent = (a: KycCompanyAgent) => {
      const key = `${a.firmId || a.firm || ""}|${a.contactId || a.person || ""}`;
      if (seen.has(key) || (!a.firm && !a.person)) return;
      seen.add(key); agents.push(a);
    };
    for (const r of repsBy.get(id) || []) addAgent({ firmId: r.firm_id ? String(r.firm_id) : null, firm: text(r.firm) || null, contactId: r.contact_id ? String(r.contact_id) : null, person: text(r.person) || null, email: text(r.email) || null, on: r.on });
    for (const p of partiesBy.get(id) || []) {
      const d = dealById.get(p.dealId);
      if (!d) continue;
      const [firmCol, personCol] = SIDE_AGENT[p.role];
      const firmId = d[firmCol] ? String(d[firmCol]) : null;
      const contactId = d[personCol] ? String(d[personCol]) : null;
      const who = contactId ? person.get(contactId) : null;
      addAgent({ firmId, firm: firmId ? firmName.get(firmId) || null : null, contactId, person: who?.name || null, email: who?.email || null, on: `${p.role === "landlord" ? "Leasing" : p.role === "tenant" ? "Acquiring" : p.role === "vendor" ? "Seller's" : "Buyer's"} agent${p.ref != null ? ` on #${p.ref}` : ""}` });
    }
    // Who a request waits on: a client checks request with no transaction that is still out, else a transaction party in progress.
    const out = (requestsBy.get(id) || []).find((r: any) => !r.completed_at && !r.revoked_at && r.sent_at && new Date(r.expires_at).getTime() > now.getTime());
    const waiting = out ? text(out.contact_name) || "the client"
      : transactions.map(t => transactionWaiting(t.stage)).find(Boolean) || null;
    rows.push({
      id,
      name: text(c.name),
      kind: kycCompanyKind(c.company_type, rolesByCompany.get(id) || []),
      companyType: text(c.company_type) || null,
      website: kycCompanyWebsite(c.domain_url, c.domain),
      entities: ents,
      kyc: kycCompanyChip(ents, switchState.on, now),
      transactions,
      people: { count: ppl.length, first },
      agents,
      sanctionsOnly: switchState,
      next: kycCompanyNext({ entities: ents, sanctionsOnly: switchState.on, waiting, kyc4u: kyc4uBy.get(id) || null }, now, fmt),
      listed: listed.has(id),
      kyc4u: kyc4uBy.get(id) || null,
    });
  }
  rows.sort((a, b) => a.name.localeCompare(b.name, "en-GB", { sensitivity: "base" }));
  return { rows, unchecked };
}

/**
 * A company's sanctions-only switch as its client files read it: the switch if
 * set, else worked out from the transactions the AML board covers (all of them
 * lettings under £10,000 a month). A trust is never sanctions only.
 */
export async function companySanctionsOnly(db: { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> }, companyId: string): Promise<{ on: boolean; auto: boolean; set: boolean | null }> {
  const c = (await db.query(`SELECT kyc_sanctions_only, aml_subject_type FROM crm_companies WHERE id = $1`, [companyId])).rows[0];
  if (!c) return { on: false, auto: false, set: null };
  if (text(c.aml_subject_type).toLowerCase() === "trust") return { on: false, auto: false, set: null };
  const { amlBoardScopeSql } = await import("./aml-dashboard");
  const { amlRegime } = await import("@shared/aml-policy");
  const deals = (await db.query(
    `SELECT d.deal_type, d.team, d.rent_pa FROM crm_deals d
      WHERE (d.landlord_id = $1 OR d.tenant_id = $1 OR d.vendor_id = $1 OR d.purchaser_id = $1) AND ${amlBoardScopeSql("d")}`, [companyId])).rows;
  return kycSanctionsOnly(deals.map(d => ({ sanctionsOnly: amlRegime({ dealType: d.deal_type, team: d.team, rentPa: d.rent_pa }).regime === "sanctions_only" })), c.kyc_sanctions_only);
}

export const kycCompaniesRouter = Router();

kycCompaniesRouter.get("/api/aml-dashboard/companies", async (req: Request, res: Response) => {
  try {
    const me = await staffMe(req);
    if (!me) return res.status(403).json({ message: "BGP staff only, signed in as themselves." });
    res.json(await loadKycCompanies(me));
  } catch (err: any) {
    console.error("[kyc-companies] feed failed:", err?.message);
    res.status(500).json({ message: "The companies could not be read." });
  }
});

// The CRM's companies by name, to add one to the view (Add a company).
kycCompaniesRouter.get("/api/aml-dashboard/companies/search", async (req: Request, res: Response) => {
  try {
    const me = await staffMe(req);
    if (!me) return res.status(403).json({ message: "BGP staff only, signed in as themselves." });
    const q = text(req.query.q).slice(0, 80);
    if (q.length < 2) return res.json({ results: [] });
    const like = `%${q.toLowerCase().replace(/[%_\\]/g, m => `\\${m}`)}%`;
    const { rows } = await pool.query(
      `SELECT c.id, c.name, c.company_type, c.domain, c.domain_url, c.kyc_listed_at,
              -- An open client file puts a company on the view as surely as adding it (24 November 2026).
              EXISTS (SELECT 1 FROM kyc_client_files f WHERE f.company_id = c.id AND f.closed_at IS NULL) AS has_file,
              (SELECT count(*)::int FROM crm_deals d WHERE d.landlord_id = c.id OR d.tenant_id = c.id OR d.vendor_id = c.id OR d.purchaser_id = c.id) AS transactions
         FROM crm_companies c
        WHERE c.merged_into_id IS NULL AND c.archived_at IS NULL
          AND (lower(c.name) LIKE $1 OR lower(COALESCE(c.domain, '')) LIKE $1 OR lower(COALESCE(c.domain_url, '')) LIKE $1)
        ORDER BY (lower(c.name) LIKE $2) DESC, c.name
        LIMIT 12`, [like, `${q.toLowerCase().replace(/[%_\\]/g, m => `\\${m}`)}%`]);
    res.json({
      results: rows.map(r => ({
        id: String(r.id), name: text(r.name), companyType: text(r.company_type) || null,
        website: kycCompanyWebsite(r.domain_url, r.domain), transactions: Number(r.transactions) || 0, listed: !!r.kyc_listed_at || !!r.has_file,
      })),
    });
  } catch (err: any) {
    res.status(500).json({ message: err?.message || "Search failed" });
  }
});

// Add a company with no transaction to the view.
kycCompaniesRouter.post("/api/aml-dashboard/companies/list", async (req: Request, res: Response) => {
  try {
    const me = await staffMe(req);
    if (!me) return res.status(403).json({ message: "BGP staff only, signed in as themselves." });
    const companyId = text(req.body?.companyId);
    if (!companyId) return res.status(400).json({ message: "Which company?" });
    const { rowCount } = await pool.query(
      `UPDATE crm_companies SET kyc_listed_at = COALESCE(kyc_listed_at, now()) WHERE id = $1 AND merged_into_id IS NULL`, [companyId]);
    if (!rowCount) return res.status(404).json({ message: "That company was not found." });
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ message: err?.message || "Could not add it" });
  }
});

// The sanctions-only switch (Woody, 24 November 2026: "We don't want to do full
// aml though on smaller tenants / deals / landlords under the 10k mark ...
// Maybe just needs a switch"). null puts it back to worked out from the
// company's lettings. A transaction still decides its own checks from its rent.
kycCompaniesRouter.put("/api/aml-dashboard/companies/:id/sanctions-only", async (req: Request, res: Response) => {
  try {
    const me = await staffMe(req);
    if (!me) return res.status(403).json({ message: "BGP staff only, signed in as themselves." });
    const on = req.body?.on;
    if (!(on === true || on === false || on === null)) return res.status(400).json({ message: "Say on, off or automatic." });
    const id = text(req.params.id);
    const before = (await pool.query(`SELECT kyc_sanctions_only FROM crm_companies WHERE id = $1 AND merged_into_id IS NULL`, [id])).rows[0];
    if (!before) return res.status(404).json({ message: "That company was not found." });
    await pool.query(`UPDATE crm_companies SET kyc_sanctions_only = $2 WHERE id = $1`, [id, on]);
    await pool.query(
      `INSERT INTO kyc_audit_log (company_id, action, performed_by, notes) VALUES ($1, 'sanctions_only_switch', $2, $3)`,
      [id, me.name, on === null ? "Sanctions checks only: back to worked out from its lettings" : on ? "Sanctions checks only: on (lettings under £10,000 a month)" : "Sanctions checks only: off (the full checks)"],
    ).catch(() => {});
    res.json({ ok: true, on });
  } catch (err: any) {
    res.status(500).json({ message: err?.message || "Could not change it" });
  }
});
