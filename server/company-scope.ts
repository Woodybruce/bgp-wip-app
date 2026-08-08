import type { Request, Response, NextFunction } from "express";
import { pool } from "./db";
import { CLIENT_CRM_CATEGORIES, isClientCrmCategory } from "@shared/tenant-categories";

const BGP_EMAIL_DOMAIN = "@brucegillinghampollard.com";

const CLIENT_TEAM_COMPANY_CACHE = new Map<string, string>();

const INTERNAL_TEAMS = new Set([
  "london leasing", "national leasing", "investment", "tenant rep",
  "development", "lease advisory", "office / corporate"
]);

// Sentinel scope for client users whose team can't be mapped to a company —
// matches no rows anywhere, so an unresolvable client fails CLOSED (sees
// nothing) instead of silently becoming an unscoped firm-wide user.
export const NO_ACCESS_SCOPE = "00000000-0000-0000-0000-000000000000";

export async function resolveCompanyScope(req: Request): Promise<string | null> {
  if ((req as any)._companyScopeResolved) {
    return (req as any)._companyScope || null;
  }

  const userId = req.session?.userId || (req as any).tokenUserId;
  if (!userId) {
    (req as any)._companyScopeResolved = true;
    (req as any)._companyScope = null;
    return null;
  }

  const userResult = await pool.query(
    `SELECT team, email, client_view_mode, role, active_team FROM users WHERE id = $1`,
    [userId]
  );
  if (!userResult.rows.length) {
    (req as any)._companyScopeResolved = true;
    (req as any)._companyScope = null;
    return null;
  }

  const { team, email, client_view_mode, role, active_team } = userResult.rows[0];
  const isBgpStaff = email && email.toLowerCase().endsWith(BGP_EMAIL_DOMAIN);
  const isClientRole = role === "Client" || (!isBgpStaff && !!email);
  (req as any)._isClientRole = isClientRole;

  if (!team) {
    (req as any)._companyScopeResolved = true;
    // A client with no team maps to nothing — fail closed, not open.
    (req as any)._companyScope = isClientRole ? NO_ACCESS_SCOPE : null;
    return (req as any)._companyScope;
  }

  // Any BGP staff member who switches the team picker to a CLIENT team (e.g.
  // "Landsec") is put into that client's exact view — same scoping the client
  // login gets, so "we see what they see". The picker persists the selection
  // to users.active_team, which is why this is server-visible at all.
  // Switching back to their own team or "All Teams" clears it. Internal teams
  // (Investment, Lease Advisory…) never map to a company, so they no-op here.
  if (isBgpStaff && role !== "Client" && active_team && active_team !== "all" && active_team !== team) {
    const switchedScope = await getCompanyIdForClientTeam(active_team);
    if (switchedScope) {
      (req as any)._companyScopeResolved = true;
      (req as any)._companyScope = switchedScope;
      return switchedScope;
    }
  }

  if (isBgpStaff && !client_view_mode && role !== "Client") {
    (req as any)._companyScopeResolved = true;
    (req as any)._companyScope = null;
    return null;
  }

  const companyId = await getCompanyIdForClientTeam(team);
  (req as any)._companyScopeResolved = true;
  // Same fail-closed rule when the team name doesn't match a company row.
  (req as any)._companyScope = companyId || (isClientRole ? NO_ACCESS_SCOPE : null);
  return (req as any)._companyScope;
}

// The brands a landlord client's CRM shows: the hospitality/F&B/leisure/fitness
// category slice (Landsec, 2026-08 — narrowed back from all-tenants) PLUS any
// brand the client has pulled in from the global directory (crm_extra_brand_ids
// on their own company). CLIENT_CRM_CATEGORIES in shared/tenant-categories.ts
// is the single source of truth for the slice; every client-facing brand
// filter goes through isClientVisibleBrand (per-row) or clientBrandSliceSql
// (SQL fragment) below — don't hand-roll another regex.
export async function getClientExtraBrandIds(scopeCompanyId: string | null | undefined): Promise<Set<string>> {
  if (!scopeCompanyId) return new Set();
  const r = await pool.query(`SELECT crm_extra_brand_ids FROM crm_companies WHERE id = $1`, [scopeCompanyId]);
  return new Set<string>(((r.rows[0]?.crm_extra_brand_ids as string[]) || []).filter(Boolean));
}

// The people a client account may see and message — NOT the whole BGP staff
// directory. Three sources, unioned: the BGP team assigned to this client on
// the org chart (crm_client_team_members), agents linked to the client's
// properties, and anyone on the client's own team (fellow client logins and
// staff share users.team with the client team name). Fails closed: unknown
// scope → empty set (the caller still lets the requester see themself).
export async function getClientVisibleUserIds(scopeCompanyId: string | null | undefined): Promise<Set<string>> {
  const ids = new Set<string>();
  if (!scopeCompanyId) return ids;
  try {
    const r = await pool.query(
      `SELECT user_id FROM crm_client_team_members WHERE client_company_id = $1
       UNION
       SELECT user_id FROM crm_property_agents WHERE property_id IN (
         SELECT id FROM crm_properties WHERE landlord_id = $1
         UNION
         SELECT property_id FROM crm_company_properties WHERE company_id = $1)
       UNION
       -- BGP agents working the client's tracker: assigned on the client's
       -- units, or on target operators under those units' briefs. Without
       -- these the client's Agent column renders the assignee as a raw
       -- user id — "who do I chase?" is the whole point of that column.
       SELECT unnest(agent_user_ids) FROM available_units
        WHERE agent_user_ids IS NOT NULL AND property_id IN (
         SELECT id FROM crm_properties WHERE landlord_id = $1
         UNION
         SELECT property_id FROM crm_company_properties WHERE company_id = $1)
       UNION
       SELECT unnest(t.agent_user_ids) FROM unit_target_operators t
         JOIN unit_briefs b ON b.id = t.brief_id
        WHERE t.agent_user_ids IS NOT NULL AND (b.client_company_id = $1 OR b.property_id IN (
         SELECT id FROM crm_properties WHERE landlord_id = $1
         UNION
         SELECT property_id FROM crm_company_properties WHERE company_id = $1))
       UNION
       SELECT u.id FROM users u
         JOIN crm_companies c ON c.id = $1
        WHERE LOWER(u.team) = LOWER(c.name)
           OR c.name ILIKE ANY(COALESCE(u.additional_teams, '{}'))`,
      [scopeCompanyId]
    );
    for (const row of r.rows) if (row.user_id) ids.add(row.user_id);
  } catch {}
  return ids;
}

// SQL fragment for "this crm_companies row is a client-visible brand":
// slice categories + the client's own extras. Safe to inline — category
// names are our own constants, extra ids are validated as uuids. Pass the
// id column reference used by the surrounding query (e.g. "c.id") when the
// table is aliased or joined.
export async function clientBrandSliceSql(scopeCompanyId: string | null | undefined, idCol = "id"): Promise<string> {
  const names = CLIENT_CRM_CATEGORIES.map(n => `'${n.replace(/'/g, "''")}'`).join(",");
  const extras = [...(await getClientExtraBrandIds(scopeCompanyId))].filter(id => /^[0-9a-f-]{36}$/i.test(id));
  const extraSql = extras.length ? ` OR ${idCol} IN (${extras.map(id => `'${id}'`).join(",")})` : "";
  return `(company_type ILIKE ANY(ARRAY[${names}])${extraSql})`;
}

export async function isClientVisibleBrand(companyId: string, scopeCompanyId?: string | null): Promise<boolean> {
  if (!companyId || !/^[0-9a-f-]{36}$/i.test(companyId)) return false;
  const r = await pool.query(`SELECT company_type FROM crm_companies WHERE id = $1`, [companyId]);
  // Slice categories (Woody, 2026-08-01: "landsec only want CRM on the
  // hospitality fitness restaurants leisure cafes") plus any brand the client
  // explicitly pulled in from the global directory. Non-brands stay out.
  if (isClientCrmCategory(r.rows[0]?.company_type)) return true;
  if (scopeCompanyId) {
    const extra = await getClientExtraBrandIds(scopeCompanyId);
    if (extra.has(companyId)) return true;
  }
  return false;
}

// True when the requesting user is an external client (role='Client' or a
// non-BGP email). Resolves + caches on the request object.
export async function isClientRequestUser(req: Request): Promise<boolean> {
  if ((req as any)._companyScopeResolved) return !!(req as any)._isClientRole;
  await resolveCompanyScope(req);
  return !!(req as any)._isClientRole;
}

export async function getClientTeamInfo(userId: string): Promise<{ team: string; companyId: string; companyName: string } | null> {
  const userResult = await pool.query(
    `SELECT team FROM users WHERE id = $1`,
    [userId]
  );
  if (!userResult.rows.length || !userResult.rows[0].team) return null;

  const team = userResult.rows[0].team;
  const companyId = await getCompanyIdForClientTeam(team);
  if (!companyId) return null;

  return { team, companyId, companyName: team };
}

// Display name for whichever company the request is scoped to. Used for the
// "Viewing as <client>" label — reading it off the user's own team column gets
// it wrong the moment a staff member switches into a different client's view.
export async function getScopeCompanyName(companyId: string | null): Promise<string | null> {
  if (!companyId || companyId === NO_ACCESS_SCOPE) return null;
  const r = await pool.query(`SELECT name FROM crm_companies WHERE id = $1`, [companyId]);
  return r.rows[0]?.name ?? null;
}

export async function getCompanyIdForClientTeam(teamName: string): Promise<string | null> {
  if (INTERNAL_TEAMS.has(teamName.toLowerCase())) return null;

  if (CLIENT_TEAM_COMPANY_CACHE.has(teamName)) {
    return CLIENT_TEAM_COMPANY_CACHE.get(teamName)!;
  }

  // A client's company name can appear more than once (e.g. a "Landsec"
  // Landlord row and a stray "Landsec" Agent row). Pick deterministically:
  // prefer the row that actually owns properties, then the Landlord type.
  const result = await pool.query(
    `SELECT c.id
       FROM crm_companies c
       LEFT JOIN (SELECT landlord_id, count(*) n FROM crm_properties GROUP BY landlord_id) p
         ON p.landlord_id = c.id
      WHERE LOWER(c.name) = LOWER($1)
      ORDER BY COALESCE(p.n, 0) DESC,
               (c.company_type = 'Landlord') DESC NULLS LAST,
               c.created_at ASC
      LIMIT 1`,
    [teamName]
  );

  if (!result.rows.length) return null;

  const companyId = result.rows[0].id;
  CLIENT_TEAM_COMPANY_CACHE.set(teamName, companyId);
  return companyId;
}

export function clearCompanyScopeCache() {
  CLIENT_TEAM_COMPANY_CACHE.clear();
}

export function isExternalUser(req: Request): boolean {
  return (req as any)._companyScopeResolved && !!(req as any)._companyScope;
}

export async function assertInScope(req: Request, entityType: string, checkFn: (scopeCompanyId: string) => Promise<boolean>): Promise<boolean> {
  const scopeCompanyId = await resolveCompanyScope(req);
  if (!scopeCompanyId) return true;
  return checkFn(scopeCompanyId);
}

// True when the request is a client login whose scope does NOT cover the
// property — the standard guard for property-keyed routes that were opened
// to clients in the board-parity work (plans / brochures / tasks).
export async function clientBlockedForProperty(req: Request, propertyId: string): Promise<boolean> {
  if (!(await isClientRequestUser(req))) return false;
  const scope = await resolveCompanyScope(req);
  if (!scope || scope === NO_ACCESS_SCOPE) return true;
  return !(await isPropertyInScope(scope, propertyId));
}

export async function isPropertyInScope(scopeCompanyId: string, propertyId: string): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1 FROM crm_company_properties WHERE company_id = $1 AND property_id = $2
     UNION ALL
     SELECT 1 FROM crm_properties WHERE id = $2 AND landlord_id = $1
     LIMIT 1`,
    [scopeCompanyId, propertyId]
  );
  return result.rows.length > 0;
}

export async function isDealInScope(scopeCompanyId: string, dealId: string): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1 FROM crm_deals WHERE id = $1 AND (landlord_id = $2 OR tenant_id = $2 OR vendor_id = $2 OR purchaser_id = $2) LIMIT 1`,
    [dealId, scopeCompanyId]
  );
  if (result.rows.length > 0) return true;
  const linkResult = await pool.query(
    `SELECT 1 FROM crm_company_deals WHERE company_id = $1 AND deal_id = $2 LIMIT 1`,
    [scopeCompanyId, dealId]
  );
  if (linkResult.rows.length > 0) return true;
  // Tracker-created deals carry no company fields — they're the client's
  // when they sit on one of the client's properties (same rule as the
  // dashboard KPI, letting tracker and activity feed).
  const propResult = await pool.query(
    `SELECT 1 FROM crm_deals d
     WHERE d.id = $1 AND d.property_id IS NOT NULL AND (
       EXISTS (SELECT 1 FROM crm_properties p WHERE p.id = d.property_id AND p.landlord_id = $2)
       OR EXISTS (SELECT 1 FROM crm_company_properties cp WHERE cp.property_id = d.property_id AND cp.company_id = $2)
     ) LIMIT 1`,
    [dealId, scopeCompanyId]
  );
  return propResult.rows.length > 0;
}

export async function isContactInScope(scopeCompanyId: string, contactId: string): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1 FROM crm_contacts WHERE id = $1 AND company_id = $2 LIMIT 1`,
    [contactId, scopeCompanyId]
  );
  return result.rows.length > 0;
}
