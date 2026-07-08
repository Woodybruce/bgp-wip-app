import type { Request, Response, NextFunction } from "express";
import { pool } from "./db";

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
    `SELECT team, email, client_view_mode, role FROM users WHERE id = $1`,
    [userId]
  );
  if (!userResult.rows.length) {
    (req as any)._companyScopeResolved = true;
    (req as any)._companyScope = null;
    return null;
  }

  const { team, email, client_view_mode, role } = userResult.rows[0];
  const isBgpStaff = email && email.toLowerCase().endsWith(BGP_EMAIL_DOMAIN);
  const isClientRole = role === "Client" || (!isBgpStaff && !!email);
  (req as any)._isClientRole = isClientRole;

  if (!team) {
    (req as any)._companyScopeResolved = true;
    // A client with no team maps to nothing — fail closed, not open.
    (req as any)._companyScope = isClientRole ? NO_ACCESS_SCOPE : null;
    return (req as any)._companyScope;
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
  return linkResult.rows.length > 0;
}

export async function isContactInScope(scopeCompanyId: string, contactId: string): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1 FROM crm_contacts WHERE id = $1 AND company_id = $2 LIMIT 1`,
    [contactId, scopeCompanyId]
  );
  return result.rows.length > 0;
}
