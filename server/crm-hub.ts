// The feed behind the CRM page's one list (shared/crm-hub.ts): landlords,
// brands, agents and lenders, each row with who at BGP owns the relationship,
// the last contact, the next action and its CRM strategies.
//
// BGP staff only: it carries BGP's owners, contact history and plan for every
// account. A client login, a joint agent and staff viewing as a client are
// refused, by the CRM plan's own staff test (isEngagementStaff).
//
// A fixed number of queries per request, never one per company. The company
// list is the only read that can fail the request: every other read is a side
// query, and a failed one costs its column, not the list.
import { Router, type Request, type RequestHandler } from "express";
import { isEngagementStaff } from "./crm-engagement";
import { isPrivateEmailRecord, isPrivateMailboxAddress, PRIVATE_MAILBOX } from "./private-mail";
import { closedStatusSqlList } from "@shared/letting-rules";
import { requirementStateSql } from "@shared/requirement-live";
import { clientKycSummary, clientKycWords } from "@shared/client-kyc";
import { entitySignOffScope } from "@shared/party-kyc";
import {
  CRM_HUB_PEOPLE_SHOWN, LENDER_SUB_TYPES, LENDER_TYPES, LANDLORD_TYPES,
  agentLine, brandWhy, companyCity, companyIsKind, contactDates, isCrmClient, isCrmHubKind, landlordLine, lenderLine, lenderSubType,
  nextActionOf, rankPeople, shownDescription,
  type CrmHubKind, type CrmHubPerson, type CrmHubResponse, type CrmHubRow, type OpenActionLike, type RankablePerson,
} from "@shared/crm-hub";

export type Queryable = { query: (sql: string, values?: any[]) => Promise<{ rows: any[] }> };
type Actor = { id: string; name: string | null; email?: string; role?: string | null; is_active?: boolean; client_view_mode?: boolean };

const iso = (value: any): string | null => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
};
const sqlList = (items: readonly string[]) => items.map(item => `'${item.replace(/'/g, "''")}'`).join(", ");
const TYPE = "lower(btrim(coalesce(c.company_type, '')))";
const LISTED = "c.merged_into_id IS NULL AND c.archived_at IS NULL";

// Which companies each list reads. These narrow the read only: the rule that
// decides is companyIsKind (shared/crm-hub.ts), run on every row that comes
// back, so the two can never list a company the rule would not.
export const KIND_SQL: Record<CrmHubKind, string> = {
  landlord: `(${TYPE} IN (${sqlList(LANDLORD_TYPES)}) OR c.is_portfolio_account IS TRUE)`,
  agent: `${TYPE} = 'agent'`,
  lender: `(${LENDER_TYPES.map(type => `${TYPE} LIKE '%${type}%'`).join(" OR ")})`,
  brand: `${TYPE} LIKE 'tenant%'`,
};

// Open CRM actions and the strategies that are not completed, for the
// companies of one list (`where` names them). An action tied to an event the
// private mailbox is on is left out, as the CRM plan leaves it out.
const EVENT_PRIVACY = `ARRAY(SELECT email FROM users WHERE id=ANY(COALESCE(e.attendee_user_ids,'{}')) OR id=e.created_by_user_id OR id=e.lead_user_id)
  || ARRAY(SELECT email FROM crm_contacts WHERE id=ANY(COALESCE(e.attendee_contact_ids,'{}'))) AS participants`;
const actionsSql = (where: string) => `SELECT t.id, t.title, t.due_date, t.created_at, l.company_id, u.name AS owner_name, ${EVENT_PRIVACY}
  FROM crm_engagement_actions l
  JOIN user_tasks t ON t.id = l.task_id
  JOIN crm_companies c ON c.id = l.company_id
  LEFT JOIN users u ON u.id = t.user_id
  LEFT JOIN marketing_events e ON e.id = l.event_id
  WHERE t.status IS DISTINCT FROM 'done' AND ${where}`;
const strategiesSql = (where: string) => `SELECT s.id, s.name, t.company_id
  FROM crm_strategy_targets t
  JOIN marketing_campaigns s ON s.id = t.strategy_id
  JOIN crm_companies c ON c.id = t.company_id
  WHERE s.status IS DISTINCT FROM 'completed' AND ${where}
  ORDER BY lower(s.name)`;
const BY_IDS = "c.id = ANY($1::text[])";
const ALL_BRANDS = `${LISTED} AND ${KIND_SQL.brand}`;

// A deal that is not closed, by the shared historic list (the rule
// gatherBgpEvidence counts live deals by).
const OPEN_DEAL = `lower(trim(COALESCE(d.status, ''))) NOT IN (${closedStatusSqlList()})`;

// Emails and meetings filed against a company or one of its people. The date
// tests are the ones /api/interactions/summary uses (a last contact is on or
// before now; what is ahead is a meeting dated ahead), and nothing the
// private mailbox is on is read.
export const PRIVATE_PATTERN = (() => {
  const [local, domain] = PRIVATE_MAILBOX.split("@");
  const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return `(^|[^a-z0-9._%+-])${escape(local)}(\\+[^@[:space:]]+)?@${escape(domain)}`;
})();
const INTERACTIONS_SQL = `SELECT i.company_id, i.contact_id,
    MAX(i.interaction_date) FILTER (WHERE i.interaction_date <= now()) AS last_at,
    MIN(i.interaction_date) FILTER (WHERE i.type = 'meeting' AND i.interaction_date >= now()) AS next_at
  FROM crm_interactions i
  WHERE (i.company_id = ANY($1::text[]) OR i.contact_id = ANY($2::text[]))
    AND COALESCE(i.bgp_user, '') !~* $3 AND COALESCE(i.participants::text, '') !~* $3
  GROUP BY i.company_id, i.contact_id`;

// Nobody set on the account: the BGP agents on its deals cover it (the brand
// page's own fallback).
const DEAL_OWNERS_SQL = `SELECT DISTINCT x.company_id, u.id, COALESCE(u.name, u.username, u.email) AS name
  FROM (
    SELECT party.company_id, d.internal_agent
      FROM crm_deals d
      CROSS JOIN LATERAL unnest(ARRAY[d.tenant_id, d.landlord_id, d.vendor_id, d.purchaser_id]) AS party(company_id)
     WHERE d.tenant_id = ANY($1::text[]) OR d.landlord_id = ANY($1::text[]) OR d.vendor_id = ANY($1::text[]) OR d.purchaser_id = ANY($1::text[])
  ) x
  CROSS JOIN LATERAL unnest(COALESCE(x.internal_agent, ARRAY[]::text[])) AS agent(name)
  JOIN users u ON lower(u.name) = lower(agent.name) AND u.is_active IS DISTINCT FROM false
  WHERE x.company_id = ANY($1::text[])
  ORDER BY x.company_id, name`;
const DEAL_OWNERS_SHOWN = 6;

type Side = { rows: any[]; ok: boolean };
async function side(q: Queryable, label: string, sql: string, values: any[], needed = true): Promise<Side> {
  if (!needed) return { rows: [], ok: true };
  try { return { rows: (await q.query(sql, values)).rows, ok: true }; }
  catch (error: any) { console.warn(`[crm-hub] ${label}: ${error?.message || error}`); return { rows: [], ok: false }; }
}
function groupBy(rows: any[], key: string): Map<string, any[]> {
  const map = new Map<string, any[]>();
  for (const row of rows) {
    const id = row[key];
    if (!id) continue;
    const list = map.get(id);
    if (list) list.push(row); else map.set(id, [row]);
  }
  return map;
}
const countMap = (rows: any[], key = "company_id", value = "n") => new Map<string, number>(rows.map(row => [String(row[key]), Number(row[value]) || 0]));

function personOf(row: any): RankablePerson {
  return { id: String(row.id), name: String(row.name || "").trim() || "Unnamed", role: row.role || null, email: row.email || null,
    phone: row.phone || row.phone_mobile || null, favourite: row.is_favourite === true };
}
const publicPerson = (person: RankablePerson): CrmHubPerson => ({ id: person.id, name: person.name, role: person.role, email: person.email, phone: person.phone });

// The ids of the brands BGP is working, by the Brands list's own reasons (a
// strategy that is not completed, an open CRM action, a live deal, a live or
// to-confirm requirement, a Super Brand), for anything else that has to keep
// to that list. Each reason is a side read: a missing one loses that reason.
export async function workedBrandIds(q: Queryable): Promise<string[]> {
  const sides = await Promise.all([
    side(q, "brand actions", actionsSql(ALL_BRANDS), []),
    side(q, "brand strategies", strategiesSql(ALL_BRANDS), []),
    side(q, "brand live transactions", `SELECT d.tenant_id AS company_id FROM crm_deals d WHERE d.tenant_id IS NOT NULL AND ${OPEN_DEAL} GROUP BY d.tenant_id`, []),
    side(q, "brand requirements", `SELECT x.company_id FROM (SELECT r.company_id, ${requirementStateSql("r")} AS st FROM crm_requirements_leasing r WHERE r.company_id IS NOT NULL) x
      WHERE x.st IN ('live', 'to_confirm') GROUP BY x.company_id`, []),
    side(q, "super brands", `SELECT c.id AS company_id FROM crm_companies c WHERE ${ALL_BRANDS} AND c.hunter_flag IS TRUE`, []),
  ]);
  const [actions, ...rest] = sides;
  return Array.from(new Set([...actions.rows.filter(row => !isPrivateEmailRecord(row)), ...rest.flatMap(found => found.rows)].map(row => String(row.company_id || "")).filter(Boolean)));
}

export async function loadCrmHub(q: Queryable, kind: CrmHubKind, now: number = Date.now()): Promise<CrmHubResponse> {
  // Brands first read what puts a brand on the list: its plan, its live
  // deals and its requirements. Each is a side query, so a missing table
  // loses that reason, never the list.
  const brand = kind === "brand";
  const [brandActions, brandStrategies, brandDeals, brandRequirements] = await Promise.all([
    side(q, "brand actions", actionsSql(ALL_BRANDS), [], brand),
    side(q, "brand strategies", strategiesSql(ALL_BRANDS), [], brand),
    side(q, "brand live transactions", `SELECT d.tenant_id AS company_id, count(*)::int AS n FROM crm_deals d
      WHERE d.tenant_id IS NOT NULL AND ${OPEN_DEAL} GROUP BY d.tenant_id`, [], brand),
    side(q, "brand requirements", `SELECT x.company_id, count(*)::int AS n
      FROM (SELECT r.company_id, ${requirementStateSql("r")} AS st FROM crm_requirements_leasing r WHERE r.company_id IS NOT NULL) x
      WHERE x.st IN ('live', 'to_confirm') GROUP BY x.company_id`, [], brand),
  ]);
  const openBrandActions = brandActions.rows.filter(row => !isPrivateEmailRecord(row));
  const workedIds = brand ? Array.from(new Set([...openBrandActions, ...brandStrategies.rows, ...brandDeals.rows, ...brandRequirements.rows]
    .map(row => row.company_id).filter(Boolean))) : [];

  // The companies: the one read the list cannot do without.
  const companies = (await q.query(`SELECT c.id, c.name, c.company_type, c.domain, c.domain_url, c.description, c.is_portfolio_account,
      c.head_office_address, c.companies_house_data #>> '{profile,registeredOfficeAddress,locality}' AS registered_locality,
      c.bgp_contact_user_ids, c.hunter_flag, c.lending_active, c.typical_ltv_max, c.typical_loan_size_min_m, c.typical_loan_size_max_m
    FROM crm_companies c
    WHERE ${LISTED} AND ${KIND_SQL[kind]}${brand ? " AND (c.hunter_flag IS TRUE OR c.id = ANY($1::text[]))" : ""}
    ORDER BY lower(c.name)`, brand ? [workedIds] : [])).rows
    .filter(row => companyIsKind({ name: row.name, companyType: row.company_type, isPortfolioAccount: row.is_portfolio_account, domain: row.domain, domainUrl: row.domain_url }, kind));
  const ids: string[] = companies.map(row => row.id);
  if (!ids.length) return { kind, rows: [], owners: [], cities: [], subTypes: [] };

  const ownerIds = Array.from(new Set(companies.flatMap(row => Array.isArray(row.bgp_contact_user_ids) ? row.bgp_contact_user_ids : []).filter(Boolean)));
  const unowned = companies.filter(row => !(Array.isArray(row.bgp_contact_user_ids) && row.bgp_contact_user_ids.length)).map(row => row.id);
  const [actions, strategies, contacts, users, dealOwners, properties, deals, represented, kycRows] = await Promise.all([
    brand ? Promise.resolve(brandActions) : side(q, "actions", actionsSql(BY_IDS), [ids]),
    brand ? Promise.resolve(brandStrategies) : side(q, "strategies", strategiesSql(BY_IDS), [ids]),
    side(q, "contacts", `SELECT p.id, p.name, p.role, p.email, p.phone, p.phone_mobile, p.is_favourite, p.company_id
      FROM crm_contacts p WHERE p.company_id = ANY($1::text[])`, [ids]),
    side(q, "owners", `SELECT u.id, COALESCE(u.name, u.username, u.email) AS name FROM users u WHERE u.id = ANY($1::text[])`, [ownerIds], ownerIds.length > 0),
    side(q, "transaction owners", DEAL_OWNERS_SQL, [unowned], unowned.length > 0),
    // A landlord's properties: landlord on the property, or a company link
    // (the set the landlord cards and the landlord board count). A lender's:
    // senior or junior lender on the property.
    kind === "landlord" ? side(q, "properties", `SELECT links.company_id, count(DISTINCT links.property_id)::int AS n FROM (
        SELECT company_id, property_id FROM crm_company_properties WHERE company_id = ANY($1::text[])
        UNION SELECT landlord_id, id FROM crm_properties WHERE landlord_id = ANY($1::text[])) links GROUP BY links.company_id`, [ids])
      : kind === "lender" ? side(q, "properties", `SELECT links.company_id, count(DISTINCT links.property_id)::int AS n FROM (
        SELECT senior_lender_id AS company_id, id AS property_id FROM crm_properties WHERE senior_lender_id = ANY($1::text[])
        UNION SELECT junior_lender_id, id FROM crm_properties WHERE junior_lender_id = ANY($1::text[])) links GROUP BY links.company_id`, [ids])
      : Promise.resolve<Side>({ rows: [], ok: false }),
    kind === "landlord" ? side(q, "live transactions", `SELECT d.landlord_id AS company_id, count(*)::int AS n FROM crm_deals d
        WHERE d.landlord_id = ANY($1::text[]) AND ${OPEN_DEAL} GROUP BY d.landlord_id`, [ids])
      : brand ? Promise.resolve(brandDeals) : Promise.resolve<Side>({ rows: [], ok: false }),
    side(q, "brands represented", `SELECT r.agent_company_id AS company_id, count(DISTINCT r.brand_company_id)::int AS n
      FROM brand_agent_representations r JOIN crm_companies b ON b.id = r.brand_company_id
      WHERE r.agent_company_id = ANY($1::text[]) AND r.end_date IS NULL AND b.merged_into_id IS NULL AND b.archived_at IS NULL
      GROUP BY r.agent_company_id`, [ids], kind === "agent"),
    // The KYC on the companies filed under each (24 November 2026): every sub
    // company's own approval, whether its checks were started, and the
    // record's own when it is a person, trust or public body.
    side(q, "KYC", `SELECT e.parent_company_id AS company_id, k.kyc_status, k.expires_at, k.approved_at,
             k.evidence->'bgpSignOff'->>'regime' AS regime, k.evidence->'bgpSignOff'->>'at' AS signoff_at,
             (EXISTS (SELECT 1 FROM kyc_client_files f WHERE f.trading_entity_id = e.id AND f.closed_at IS NULL)
               OR EXISTS (SELECT 1 FROM kyc_investigations i WHERE i.trading_entity_id = e.id AND i.result->>'kind' = 'precheck')) AS started
        FROM crm_trading_entities e
        LEFT JOIN crm_entity_kyc k ON k.entity_kind = 'trading_entity' AND k.entity_id = e.id
       WHERE e.parent_company_id = ANY($1::text[])
      UNION ALL
      SELECT c.id, c.kyc_status, c.kyc_expires_at, c.kyc_checked_at, NULL, NULL,
             EXISTS (SELECT 1 FROM kyc_client_files f WHERE f.company_id = c.id AND f.trading_entity_id IS NULL AND f.closed_at IS NULL)
        FROM crm_companies c
       WHERE c.id = ANY($1::text[]) AND lower(COALESCE(c.aml_subject_type, '')) IN ('individual', 'trust', 'public_body')`, [ids]),
  ]);

  const people = contacts.rows.filter(row => !isPrivateMailboxAddress(row.email));
  const interactions = await side(q, "interactions", INTERACTIONS_SQL, [ids, people.map(row => row.id), PRIVATE_PATTERN]);

  const listed = new Set(ids);
  const peopleByCompany = groupBy(people, "company_id");
  const companyOfContact = new Map<string, string>(people.map(row => [row.id, row.company_id]));
  // A company's contact is whatever was filed against it or against one of its people.
  const datesByCompany = new Map<string, any[]>();
  const datesByContact = new Map<string, any[]>();
  for (const row of interactions.rows) {
    const dates = [row.last_at, row.next_at].filter(Boolean);
    const owners = new Set([row.company_id, row.contact_id ? companyOfContact.get(row.contact_id) : null].filter((id): id is string => !!id && listed.has(id)));
    for (const id of owners) datesByCompany.set(id, [...(datesByCompany.get(id) || []), ...dates]);
    if (row.contact_id) datesByContact.set(row.contact_id, [...(datesByContact.get(row.contact_id) || []), ...dates]);
  }
  const actionsByCompany = groupBy(actions.rows.filter(row => !isPrivateEmailRecord(row)), "company_id");
  const strategiesByCompany = groupBy(strategies.rows, "company_id");
  const userName = new Map<string, string>(users.rows.map(row => [String(row.id), String(row.name || "")]));
  const dealOwnersByCompany = groupBy(dealOwners.rows, "company_id");
  const propertyCount = countMap(properties.rows);
  const dealCount = countMap(deals.rows);
  const representedCount = countMap(represented.rows);
  const requirementCount = countMap(brandRequirements.rows);
  const kycByCompany = groupBy(kycRows.rows, "company_id");
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, "en-GB", { sensitivity: "base" });

  const rows: CrmHubRow[] = [];
  for (const company of companies) {
    const id: string = company.id;
    const assigned = (Array.isArray(company.bgp_contact_user_ids) ? company.bgp_contact_user_ids as string[] : [])
      .filter((userId, index, all) => userName.has(userId) && all.indexOf(userId) === index)
      .map(userId => ({ id: userId, name: userName.get(userId)! })).sort(byName);
    const fromDeals = assigned.length ? [] : (dealOwnersByCompany.get(id) || []).slice(0, DEAL_OWNERS_SHOWN).map(row => ({ id: String(row.id), name: String(row.name || "") }));
    const open: OpenActionLike[] = (actionsByCompany.get(id) || []).map(row => ({ id: String(row.id), title: String(row.title || ""), dueAt: iso(row.due_date), createdAt: iso(row.created_at), ownerName: row.owner_name || null }));
    const onStrategies = (strategiesByCompany.get(id) || []).map(row => ({ id: String(row.id), name: String(row.name || "") }));
    const everyone = (peopleByCompany.get(id) || []).map(row => ({ ...personOf(row), lastContactAt: contactDates(datesByContact.get(row.id) || [], now).lastContactAt }));

    const counts: CrmHubRow["counts"] = {};
    let line: string | null = null;
    let why: string[] | undefined;
    if (kind === "landlord") {
      if (properties.ok) counts.properties = propertyCount.get(id) || 0;
      if (deals.ok) counts.deals = dealCount.get(id) || 0;
      line = landlordLine(counts);
    } else if (kind === "agent") {
      if (represented.ok) counts.brandsRepresented = representedCount.get(id) || 0;
      line = agentLine(counts);
    } else if (kind === "lender") {
      if (properties.ok) counts.properties = propertyCount.get(id) || 0;
      line = lenderLine({ typicalLtvMax: company.typical_ltv_max, loanMin: company.typical_loan_size_min_m, loanMax: company.typical_loan_size_max_m, lendingActive: company.lending_active });
    } else {
      if (brandDeals.ok) counts.deals = dealCount.get(id) || 0;
      if (brandRequirements.ok) counts.requirements = requirementCount.get(id) || 0;
      why = brandWhy({ onStrategy: onStrategies.length > 0, openAction: open.length > 0, liveDeal: (counts.deals || 0) > 0,
        requirement: (counts.requirements || 0) > 0, hunterPick: company.hunter_flag === true });
      // An action the private mailbox is on can be all that named a brand: it is not listed for that.
      if (!why.length) continue;
      line = why.join(" · ");
    }

    rows.push({
      id, name: String(company.name || ""), kind, companyType: company.company_type || null,
      domain: company.domain_url || company.domain || null, description: shownDescription(company.description),
      isClient: isCrmClient({ companyType: company.company_type, isPortfolioAccount: company.is_portfolio_account }),
      subType: kind === "lender" ? lenderSubType(company.company_type) : null,
      city: companyCity(company.registered_locality, company.head_office_address),
      owners: assigned.length ? assigned : fromDeals,
      ...(fromDeals.length ? { ownersFromDeals: true } : {}),
      ...contactDates(datesByCompany.get(id) || [], now),
      openActions: open.length,
      nextAction: nextActionOf(open, now),
      strategies: onStrategies,
      contactCount: everyone.length,
      people: rankPeople(everyone).slice(0, CRM_HUB_PEOPLE_SHOWN).map(publicPerson),
      counts, line,
      ...(why ? { why } : {}),
      ...(kind === "brand" && company.hunter_flag === true ? { superBrand: true } : {}),
      ...kycChip(kycByCompany.get(id) || [], new Date(now)),
    });
  }
  // Super Brands lead the Brands list (the sort keeps name order within each).
  if (brand) rows.sort((a, b) => Number(!!b.superBrand) - Number(!!a.superBrand));

  const owners = Array.from(new Map(rows.flatMap(row => row.owners).map(owner => [owner.id, owner])).values()).sort(byName);
  const cities = Array.from(new Set(rows.map(row => row.city).filter((city): city is string => !!city))).sort((a, b) => a.localeCompare(b, "en-GB"));
  const present = new Set(rows.map(row => row.subType));
  return { kind, rows, owners, cities, subTypes: LENDER_SUB_TYPES.filter(type => present.has(type)) };
}

/** Everyone at one company, for a row opened in place. Null when the company is not one the lists hold. */
export async function loadCompanyPeople(q: Queryable, companyId: string): Promise<CrmHubPerson[] | null> {
  const company = (await q.query(`SELECT c.id FROM crm_companies c WHERE c.id = $1 AND c.merged_into_id IS NULL`, [companyId])).rows[0];
  if (!company) return null;
  const rows = (await q.query(`SELECT p.id, p.name, p.role, p.email, p.phone, p.phone_mobile, p.is_favourite FROM crm_contacts p WHERE p.company_id = $1`, [companyId])).rows;
  return rankPeople(rows.filter(row => !isPrivateMailboxAddress(row.email)).map(personOf)).map(publicPerson);
}

export interface CrmHubDeps {
  requireAuth: RequestHandler;
  query: Queryable["query"];
  resolveScope: (req: Request) => Promise<string | null>;
}
const REFUSED = "The CRM lists are available in the BGP staff view only";

export function createCrmHubRouter(deps: CrmHubDeps) {
  const router = Router();
  const q: Queryable = { query: (sql, values) => deps.query(sql, values) };
  // The CRM plan's own staff test: an active BGP login, as itself, with no
  // client scope. A check that cannot be made refuses.
  const staffOnly: RequestHandler = async (req, res, next) => {
    try {
      const userId = (req as any).session?.userId || (req as any).tokenUserId;
      const actor: Actor | null = userId ? (await q.query("SELECT id,name,email,role,is_active,client_view_mode FROM users WHERE id=$1", [userId])).rows[0] || null : null;
      const scope = await deps.resolveScope(req);
      if (!isEngagementStaff(actor, scope)) return res.status(403).json({ error: REFUSED });
      next();
    } catch { res.status(503).json({ error: "Unable to check CRM access" }); }
  };

  router.get("/api/crm/hub/company/:id/people", deps.requireAuth, staffOnly, async (req, res) => {
    try {
      const people = await loadCompanyPeople(q, String(req.params.id));
      if (!people) return res.status(404).json({ error: "Company not found" });
      res.json({ people });
    } catch (error: any) {
      console.error("[crm-hub] people:", error?.message || error);
      res.status(500).json({ error: "The people at this company could not be loaded" });
    }
  });

  // What the company is tied to: buildings, BGP's leasing instructions, the
  // brands an agent acts for and the buildings it lets (Woody, 2026-11-23).
  router.get("/api/crm/hub/company/:id/links", deps.requireAuth, staffOnly, async (req, res) => {
    try {
      const { companyLinks } = await import("./crm-company-links");
      const links = await companyLinks(q, String(req.params.id));
      if (!links) return res.status(404).json({ error: "Company not found" });
      res.json(links);
    } catch (error: any) {
      console.error("[crm-hub] links:", error?.message || error);
      res.status(500).json({ error: "What this company is linked to could not be loaded" });
    }
  });

  router.get("/api/crm/hub/:kind", deps.requireAuth, staffOnly, async (req, res) => {
    const kind = String(req.params.kind || "").toLowerCase();
    if (!isCrmHubKind(kind)) return res.status(404).json({ error: "Choose landlord, brand, agent or lender" });
    try { res.json(await loadCrmHub(q, kind)); }
    catch (error: any) {
      console.error(`[crm-hub] ${kind}:`, error?.message || error);
      res.status(500).json({ error: "The CRM list could not be loaded" });
    }
  });
  return router;
}

// The database, the session check and the scope are loaded on first use, so
// this file can be read (and tested) without a database.
export default createCrmHubRouter({
  requireAuth: async (req, res, next) => {
    try { await (await import("./auth")).requireAuth(req, res, next); }
    catch (error) { next(error); }
  },
  query: async (sql, values) => (await import("./db")).pool.query(sql, values),
  resolveScope: async req => (await import("./company-scope")).resolveCompanyScope(req),
});

// The KYC chip on a CRM row (24 November 2026): left out when no company is
// filed under it and nothing was started.
function kycChip(rows: any[], now: Date): { kyc?: CrmHubRow["kyc"] } {
  if (!rows.length) return {};
  const list = rows.map(r => ({
    status: r.kyc_status || null,
    expiresAt: r.expires_at ? new Date(r.expires_at).toISOString() : null,
    scope: String(r.kyc_status || "").toLowerCase() === "approved" ? entitySignOffScope({ regime: r.regime, signedOffAt: r.signoff_at, approvedAt: r.approved_at }) : null,
    started: !!r.started,
  }));
  const sum = clientKycSummary(list, now);
  const words = clientKycWords(sum);
  const cleared = sum.cleared + sum.expiring;
  return { kyc: { ...words, total: sum.total, cleared, toDo: sum.total - cleared } };
}
