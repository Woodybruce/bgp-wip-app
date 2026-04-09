import type { Request, Response, NextFunction } from "express";
import { pool } from "./db";

const BGP_EMAIL_DOMAIN = "@brucegillinghampollard.com";

const CLIENT_TEAM_COMPANY_CACHE = new Map<string, string>();

const INTERNAL_TEAMS = new Set([
  "london leasing", "national leasing", "investment", "tenant rep",
  "development", "lease advisory", "office / corporate"
]);

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
    `SELECT team, email, client_view_mode FROM users WHERE id = $1`,
    [userId]
  );
  if (!userResult.rows.length) {
    (req as any)._companyScopeResolved = true;
    (req as any)._companyScope = null;
    return null;
  }

  const { team, email, client_view_mode } = userResult.rows[0];
  if (!team) {
    (req as any)._companyScopeResolved = true;
    (req as any)._companyScope = null;
    return null;
  }

  const isBgpStaff = email && email.toLowerCase().endsWith(BGP_EMAIL_DOMAIN);

  if (isBgpStaff && !client_view_mode) {
    (req as any)._companyScopeResolved = true;
    (req as any)._companyScope = null;
    return null;
  }

  const companyId = await getCompanyIdForClientTeam(team);
  (req as any)._companyScopeResolved = true;
  (req as any)._companyScope = companyId;
  return companyId;
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

  const result = await pool.query(
    `SELECT id FROM crm_companies WHERE LOWER(name) = LOWER($1) LIMIT 1`,
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
