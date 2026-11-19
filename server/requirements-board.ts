// The requirements board's feed (docs/requirements-board-review-2026-11-19.md,
// section 4; Woody, 19 November 2026: "carry on"). One row per brand, in a
// fixed number of queries, carrying what the row shows and nothing more: the
// brand and its star, what it wants, the state and its dated line, the units
// that fit by the one fit rule, the agent, the BGP owner, the Expansion score
// and the last contact. The pickers the old board downloaded (every company,
// contact and deal) load only when a requirement is edited.
//
// Who reads what is decided here, on the server:
//   - BGP staff signed in as themselves: everything below.
//   - A client login (and staff viewing as one): every requirement (open to
//     clients since 17 November 2026) under Open or Closed, its dated line by
//     what it is and its own date (requirementReason().clientText), the agent,
//     the Expansion score and the fits against its own units only. Never the
//     state, the list, the owner, the sources or the last contact.
//   - A joint agent: refused (it has no Brands and no requirements).
//   - A login tied to no company (NO_ACCESS_SCOPE): nothing.
import { Router, type Request, type RequestHandler, type Response } from "express";
import { FIT_POOL_STATUSES, fitScore, requirementFit } from "@shared/requirement-fit";
import { DEAL_STATUS_LABELS, legacyToCode } from "@shared/deal-status";
import {
  REQUIREMENT_STATE_LABELS, parseRequirementDate, requirementLive, requirementLiveColumnsSql, requirementReason, requirementSourceLabels,
} from "@shared/requirement-live";
import {
  boardExpansionBand, boardListOf, clientList, compareCandidates, compareForClient, countPills, groupByBrand, wantsLine,
  type BoardCandidate, type BoardFit, type BoardRequirement, type BoardResponse, type BoardRow,
} from "@shared/requirements-board";
import { isPrivateMailboxAddress } from "./private-mail";
import { PRIVATE_PATTERN } from "./crm-hub";
import { schemeLimitSql } from "./scheme-limit";
import { splitSubScores } from "./hunter-score";

export type Queryable = { query: (sql: string, values?: any[]) => Promise<{ rows: any[] }> };
export type BoardViewer = { kind: "staff" } | { kind: "client"; companyId: string };

const iso = (value: any): string | null => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
};
const ids = (rows: any[], key: string) => Array.from(new Set(rows.map(row => row[key]).filter((v: any) => v != null && v !== "").map(String)));
const userIdsOf = (row: any): string[] => {
  const list = Array.isArray(row.bgp_contact_user_ids) ? row.bgp_contact_user_ids : [];
  return Array.from(new Set([...list, row.bgp_contact_user_id].filter(Boolean).map(String)));
};

type Side = { rows: any[]; ok: boolean };
async function side(q: Queryable, label: string, sql: string, values: any[], needed = true): Promise<Side> {
  if (!needed) return { rows: [], ok: true };
  try { return { rows: (await q.query(sql, values)).rows, ok: true }; }
  catch (error: any) { console.warn(`[requirements-board] ${label}: ${error?.message || error}`); return { rows: [], ok: false }; }
}

export interface BoardDeps {
  /** The scheme limit of the request being answered (server/scheme-limit.ts). */
  schemeLimitSql: (column: string) => string;
  /** The Expansion figure from a saved score row (server/hunter-score.ts). */
  splitSubScores: (sub: any) => { expansion: number; relationship: number } | null;
  /** May a client login open this deal (server/company-scope.ts isDealInScope)? Without it a client is sent no deal. */
  dealInScope?: (companyId: string, dealId: string) => Promise<boolean>;
}

// The units the fits are read against: those on the market on the Letting
// Tracker (the pool the board's Fits column and Match dialog read), a client
// login's own properties only, with each unit's schedule row by stored ties.
export const BOARD_UNITS_SQL = (schemeLimit: string) => `/* requirements-board:units */
  SELECT au.id, au.unit_name, au.sqft, au.use_class, p.id AS property_id, p.name AS property_name, p.address::text AS address,
         COALESCE(au.tenancy_unit_id::text,
           (SELECT ts.id::text FROM tenancy_schedule_units ts
             WHERE ts.letting_tracker_unit_id = au.id AND ts.property_id = au.property_id LIMIT 1)) AS schedule_row_id
    FROM available_units au
    JOIN crm_properties p ON p.id = au.property_id
   WHERE au.marketing_status = ANY($2::text[])
     AND ($1::text IS NULL OR p.landlord_id = $1
          OR p.id IN (SELECT property_id FROM crm_company_properties WHERE company_id = $1))${schemeLimit}`;

export async function loadRequirementsBoard(q: Queryable, viewer: BoardViewer, deps: BoardDeps, now: Date = new Date()): Promise<BoardResponse> {
  const staff = viewer.kind === "staff";
  const unavailable: string[] = [];
  const requirements = (await q.query(`/* requirements-board:requirements */
    SELECT r.id, r.name, r.company_id, r.size, r.use, r.requirement_locations, r.requirement_type, r.group_name, r.agent_contact_id, r.deal_id,
           r.bgp_contact_user_id, r.bgp_contact_user_ids, r.external_requirement_id, ${requirementLiveColumnsSql("r")}
      FROM crm_requirements_leasing r`)).rows;
  const listingIds = staff ? ids(requirements, "external_requirement_id") : [];
  const brandIds = ids(requirements, "company_id");
  const agentIds = ids(requirements, "agent_contact_id");
  const ownerIds = staff ? Array.from(new Set(requirements.flatMap(userIdsOf))) : [];
  const dealIds = staff || deps.dealInScope ? ids(requirements, "deal_id") : [];

  const [brands, agents, owners, scores, contacts, units, listings, deals] = await Promise.all([
    side(q, "brands", `/* requirements-board:brands */ SELECT c.id, c.name, c.domain, c.domain_url, c.hunter_flag
      FROM crm_companies c WHERE c.id = ANY($1::text[])`, [brandIds], brandIds.length > 0),
    side(q, "agents", `/* requirements-board:agents */ SELECT p.id, p.name, p.email, p.phone, p.phone_mobile, p.company_id, f.name AS firm_name
      FROM crm_contacts p LEFT JOIN crm_companies f ON f.id = p.company_id WHERE p.id = ANY($1::text[])`, [agentIds], agentIds.length > 0),
    side(q, "owners", `/* requirements-board:owners */ SELECT u.id, COALESCE(u.name, u.username, u.email) AS name
      FROM users u WHERE u.id = ANY($1::text[])`, [ownerIds], ownerIds.length > 0),
    side(q, "scores", `/* requirements-board:scores */ SELECT DISTINCT ON (h.brand_company_id) h.brand_company_id, h.hunter_score,
             to_jsonb(h) -> 'sub_scores' AS sub_scores
        FROM brand_score_history h WHERE h.brand_company_id = ANY($1::text[])
       ORDER BY h.brand_company_id, h.checked_at DESC`, [brandIds], brandIds.length > 0),
    // The last email, call or meeting filed against the brand or one of its
    // people; nothing the private mailbox is on (the CRM lists' own rule).
    side(q, "last contact", `/* requirements-board:contact */ SELECT COALESCE(i.company_id, p.company_id) AS company_id,
             MAX(i.interaction_date) FILTER (WHERE i.interaction_date <= now()) AS last_at
        FROM crm_interactions i LEFT JOIN crm_contacts p ON p.id = i.contact_id
       WHERE (i.company_id = ANY($1::text[]) OR p.company_id = ANY($1::text[]))
         AND COALESCE(i.bgp_user, '') !~* $2 AND COALESCE(i.participants::text, '') !~* $2
       GROUP BY 1`, [brandIds, PRIVATE_PATTERN], staff && brandIds.length > 0),
    side(q, "units", BOARD_UNITS_SQL(deps.schemeLimitSql("p.id")), [staff ? null : viewer.companyId, [...FIT_POOL_STATUSES]]),
    side(q, "listings", `/* requirements-board:listings */ SELECT x.id, x.source_url FROM external_requirements x WHERE x.id = ANY($1::text[])`,
      [listingIds], listingIds.length > 0),
    // The deal a requirement is linked to: its name and stage only, never a fee.
    side(q, "deals", `/* requirements-board:deals */ SELECT d.id, d.name, d.status FROM crm_deals d WHERE d.id = ANY($1::text[])`,
      [dealIds], dealIds.length > 0),
  ]);
  for (const [label, read] of [["brands", brands], ["agents", agents], ["owners", owners], ["scores", scores], ["last contact", contacts], ["units", units], ["listings", listings], ["deals", deals]] as const) {
    if (!read.ok) unavailable.push(label);
  }

  const brandById = new Map<string, any>(brands.rows.map(row => [String(row.id), row]));
  const agentById = new Map<string, any>(agents.rows.filter(row => !isPrivateMailboxAddress(row.email)).map(row => [String(row.id), row]));
  const ownerName = new Map<string, string>(owners.rows.map(row => [String(row.id), String(row.name || "")]));
  const scoreOf = new Map<string, number>(scores.rows.map(row => [String(row.brand_company_id), deps.splitSubScores(row.sub_scores)?.expansion ?? (Number(row.hunter_score) || 0)]));
  const lastContact = new Map<string, string | null>(contacts.rows.map(row => [String(row.company_id), iso(row.last_at)]));
  const listingUrl = new Map<string, string>(listings.rows.filter(row => /^https?:\/\//i.test(String(row.source_url || ""))).map(row => [String(row.id), String(row.source_url)]));
  const pool = units.rows.map(u => ({ ...u, place: `${u.property_name || ""} ${u.address || ""}` }));
  // A client is sent a linked deal only when it may open that deal.
  const dealRows = staff ? deals.rows : (await Promise.all(deals.rows.map(async d =>
    (await deps.dealInScope!(viewer.companyId, String(d.id)).catch(() => false)) ? d : null))).filter(Boolean) as any[];
  const dealById = new Map<string, any>(dealRows.map(d => [String(d.id), d]));
  const dealOf = (row: any): BoardRequirement["deal"] => {
    const d = row.deal_id ? dealById.get(String(row.deal_id)) : null;
    // The stage in words ("HOTs", not the stored code).
    const code = legacyToCode(d?.status);
    return d ? { id: String(d.id), name: String(d.name || "Deal"), status: code ? DEAL_STATUS_LABELS[code] : d.status || null } : null;
  };

  // Every requirement read by the one live rule, then grouped by brand.
  type Item = BoardCandidate & { companyId: string | null; row: any; live: ReturnType<typeof requirementLive> };
  const items: Item[] = requirements.map(row => {
    const live = requirementLive(row, now);
    return { id: String(row.id), name: String(row.name || ""), companyId: row.company_id ? String(row.company_id) : null,
      list: boardListOf(live), state: live.state, date: live.date, row, live };
  });

  const asRequirement = (item: Item): BoardRequirement => {
    const { row, live } = item;
    const type = (Array.isArray(row.requirement_type) ? row.requirement_type : row.requirement_type ? [row.requirement_type] : []).filter(Boolean).join(", ") || null;
    const base = { id: item.id, name: item.name, wants: wantsLine(row), type, group: row.group_name || null, deal: dealOf(row) };
    if (!staff) {
      // The requirement's own date: its listing, its date, or when it was added.
      const own = iso(row.last_listed_at) || iso(parseRequirementDate(row.requirement_date)) || iso(row.created_at);
      return { ...base, list: clientList(item.list), dateLine: requirementReason(row, now).clientText, date: own };
    }
    return { ...base, list: item.list, state: live.state, stateLabel: REQUIREMENT_STATE_LABELS[live.state], dateLine: live.dateLabel,
      date: iso(live.date), confirmedAt: iso(row.last_confirmed_at), sources: requirementSourceLabels(row),
      listingUrl: row.external_requirement_id ? listingUrl.get(String(row.external_requirement_id)) ?? null : null };
  };

  // The units a requirement fits, the surest first, then the smaller unit.
  const fitsOf = (row: any): BoardRow["fits"] => {
    const found = fitsFor(row, pool);
    return { count: found.length, best: found[0] ?? null };
  };

  const rows: BoardRow[] = groupByBrand(items, staff ? compareCandidates : compareForClient).map(({ key, brandId, shown, others }) => {
    const brand = brandId ? brandById.get(brandId) : null;
    const agentRow = shown.row.agent_contact_id ? agentById.get(String(shown.row.agent_contact_id)) : null;
    const score = brandId ? scoreOf.get(brandId) : undefined;
    return {
      key, brandId,
      brandName: String(brand?.name || shown.name || "Unnamed"),
      domain: brand?.domain_url || brand?.domain || null,
      superBrand: brand?.hunter_flag === true,
      list: staff ? shown.list : clientList(shown.list),
      requirement: asRequirement(shown),
      others: others.map(asRequirement),
      fits: fitsOf(shown.row),
      agent: agentRow ? {
        contactId: String(agentRow.id), name: String(agentRow.name || "").trim() || "Unnamed",
        firmId: agentRow.company_id || null, firmName: agentRow.firm_name || null,
        email: agentRow.email || null, phone: agentRow.phone_mobile || agentRow.phone || null,
      } : null,
      ...(staff ? {
        owners: userIdsOf(shown.row).filter(id => ownerName.has(id)).map(id => ({ id, name: ownerName.get(id)! })),
        lastContactAt: brandId ? lastContact.get(brandId) ?? null : null,
      } : {}),
      expansion: score === undefined ? null : { score, band: boardExpansionBand(score) },
    };
  });
  // The order of the shown requirements decides the order of the rows.
  const shownOf = new Map(items.map(item => [item.id, item]));
  const compare = staff ? compareCandidates : compareForClient;
  rows.sort((a, b) => compare(shownOf.get(a.requirement.id)!, shownOf.get(b.requirement.id)!));

  return { viewer: viewer.kind, rows, counts: countPills(rows), unitPool: pool.length, unavailable };
}

type PoolUnit = { id: any; unit_name: any; sqft: any; use_class: any; property_id: any; property_name: any; schedule_row_id: any; place: string };

/** Every unit in the pool a requirement fits by the one fit rule, the surest first, then the smaller unit, each with why. */
export function fitsFor(row: any, pool: PoolUnit[]): BoardFit[] {
  return pool.map(u => ({ u, fit: requirementFit(row, { sqft: u.sqft, use_class: u.use_class, unit_name: u.unit_name, property_text: u.place }) }))
    .filter(x => x.fit.fits)
    .sort((a, b) => fitScore(b.fit) - fitScore(a.fit) || ((Number(a.u.sqft) || Infinity) - (Number(b.u.sqft) || Infinity)))
    .map(({ u, fit }) => ({
      unitId: String(u.id), unitName: String(u.unit_name || "Unit"), propertyId: u.property_id || null, propertyName: u.property_name || null,
      scheduleRowId: u.schedule_row_id || null, sqft: Number(u.sqft) > 0 ? Number(u.sqft) : null, why: fit.why,
    }));
}

/** One requirement's fits for the panel: every unit, against the viewer's pool. Null when the requirement does not exist. */
export async function loadRequirementFits(q: Queryable, viewer: BoardViewer, deps: Pick<BoardDeps, "schemeLimitSql">, requirementId: string): Promise<{ fits: BoardFit[]; unitPool: number } | null> {
  const row = (await q.query(`/* requirements-board:requirement */ SELECT r.id, r.size, r.use, r.requirement_locations
    FROM crm_requirements_leasing r WHERE r.id = $1`, [requirementId])).rows[0];
  if (!row) return null;
  const units = (await q.query(BOARD_UNITS_SQL(deps.schemeLimitSql("p.id")), [viewer.kind === "staff" ? null : viewer.companyId, [...FIT_POOL_STATUSES]])).rows;
  const pool = units.map(u => ({ ...u, place: `${u.property_name || ""} ${u.address || ""}` }));
  return { fits: fitsFor(row, pool), unitPool: pool.length };
}

export interface BoardRouteDeps extends BoardDeps {
  requireAuth: RequestHandler;
  pool: Queryable;
  /** "staff", "client" or "joint_agent" (server/landsec-access.ts requirementViewer). */
  requirementViewer: (req: Request) => Promise<"staff" | "client" | "joint_agent">;
  /** The caller's client company, and whether it is a login tied to none (NO_ACCESS_SCOPE). */
  scopeOf: (req: Request) => Promise<{ scope: string | null; noAccess: boolean }>;
}

export function createRequirementsBoardRouter(deps: BoardRouteDeps) {
  const router = Router();
  // Who is asking: refused (a joint agent), nothing (a login tied to no company), or the viewer.
  const viewerOf = async (req: Request): Promise<BoardViewer | "refused" | "none"> => {
    const who = await deps.requirementViewer(req);
    if (who === "joint_agent") return "refused";
    const { scope, noAccess } = await deps.scopeOf(req);
    if (noAccess) return "none";
    return who === "staff" && !scope ? { kind: "staff" } : { kind: "client", companyId: String(scope) };
  };
  router.get("/api/crm/requirements-board", deps.requireAuth, async (req: Request, res: Response) => {
    try {
      const viewer = await viewerOf(req);
      if (viewer === "refused") return res.status(403).json({ error: "Access denied" });
      if (viewer === "none") return res.json({ viewer: "client", rows: [], counts: { open: 0, own: 0, market: 0, older: 0, closed: 0 }, unitPool: 0, unavailable: [] } satisfies BoardResponse);
      res.json(await loadRequirementsBoard(deps.pool, viewer, deps));
    } catch (error: any) {
      console.error("[requirements-board]", error?.message || error);
      res.status(500).json({ error: "The requirements board could not be loaded" });
    }
  });
  // Every unit one requirement fits, for its panel (a client login: its own units).
  router.get("/api/crm/requirements-board/:id/fits", deps.requireAuth, async (req: Request, res: Response) => {
    try {
      const viewer = await viewerOf(req);
      if (viewer === "refused") return res.status(403).json({ error: "Access denied" });
      if (viewer === "none") return res.json({ fits: [], unitPool: 0 });
      const out = await loadRequirementFits(deps.pool, viewer, deps, String(req.params.id));
      if (!out) return res.status(404).json({ error: "Requirement not found" });
      res.json(out);
    } catch (error: any) {
      console.error("[requirements-board] fits", error?.message || error);
      res.status(500).json({ error: "The units that fit could not be loaded" });
    }
  });
  return router;
}

// The database, the session check and the scope are loaded on first use (the
// CRM hub's pattern), so this file can be read and tested without a database.
export default createRequirementsBoardRouter({
  requireAuth: async (req, res, next) => {
    try { await (await import("./auth")).requireAuth(req, res, next); }
    catch (error) { next(error); }
  },
  pool: { query: async (sql: string, values?: any[]) => (await import("./db")).pool.query(sql, values) },
  requirementViewer: async req => (await import("./landsec-access")).requirementViewer(req),
  dealInScope: async (companyId, dealId) => (await import("./company-scope")).isDealInScope(companyId, dealId),
  scopeOf: async req => {
    const { resolveCompanyScope, NO_ACCESS_SCOPE } = await import("./company-scope");
    const scope = await resolveCompanyScope(req);
    return { scope, noAccess: scope === NO_ACCESS_SCOPE };
  },
  schemeLimitSql,
  splitSubScores,
});
