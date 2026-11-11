// Landsec logins by role and scheme (docs/landsec-pitch-plan.md, item 6).
// The roles are a separate front door, not scheme checks retrofitted into
// the existing client view: an asset manager or joint agent login reaches
// only the Landsec workspace routes (plus brand pages for asset managers),
// and those routes filter to the person's schemes. A Landsec login with no
// row here — today's logins — keeps the full Landsec client view, which is
// what a leasing manager sees.
import type { Express, Request } from "express";
import { randomUUID } from "crypto";
import { pool } from "./db";
import { requireAuth, requireAdmin, hashPassword } from "./auth";
import { resolveCompanyScope, isClientRequestUser, clearCompanyScopeCache } from "./company-scope";
import { landsecCompanyId, isLandsecCompany, LANDSEC_SCHEMES } from "./landsec-schemes";
import { LANDSEC_ROLES, RESTRICTED_LANDSEC_ROLES, type LandsecRole } from "@shared/landsec";
import { runLandsecLocked, isLandsecLocked, LANDSEC_AI_LOCK_MESSAGE } from "./utils/ai-provider";
import type { Response, NextFunction } from "express";

// Is this request about Landsec data? A Landsec client login, or BGP staff
// who have switched the team picker to Landsec. Cached per request.
export async function isLandsecScopedRequest(req: Request): Promise<boolean> {
  if ((req as any)._landsecScopedResolved) return !!(req as any)._landsecScoped;
  const scope = await resolveCompanyScope(req);
  const scoped = !!scope && (await isLandsecCompany(scope));
  (req as any)._landsecScopedResolved = true;
  (req as any)._landsecScoped = scoped;
  return scoped;
}

// Runs every Landsec-scoped /api request inside the AI lock, so the
// provider switch is ignored and the third-party image paths refuse for
// the whole request, tools and streams included.
export async function landsecAiLockMiddleware(req: Request, _res: Response, next: NextFunction) {
  try {
    if (await isLandsecScopedRequest(req)) return runLandsecLocked(() => next());
  } catch (e: any) {
    console.warn("[landsec-access] AI lock check failed open:", e?.message);
  }
  next();
}

// For routes that would send content to OpenAI, Gemini or another provider.
export function refuseIfLandsecLocked(res: Response): boolean {
  if (!isLandsecLocked()) return false;
  res.status(403).json({ error: LANDSEC_AI_LOCK_MESSAGE, landsecAiLock: true });
  return true;
}

export interface LandsecAccessRow { role: LandsecRole; schemes: string[] | null; firm: string | null }

export async function getLandsecAccess(req: Request): Promise<LandsecAccessRow | null> {
  if ((req as any)._landsecAccessResolved) return (req as any)._landsecAccess || null;
  const userId = req.session?.userId || (req as any).tokenUserId;
  let row: LandsecAccessRow | null = null;
  if (userId) {
    const r = await pool.query(`SELECT landsec_role, schemes, firm FROM landsec_access WHERE user_id = $1`, [userId]).catch(() => ({ rows: [] as any[] }));
    if (r.rows[0]) row = { role: r.rows[0].landsec_role, schemes: r.rows[0].schemes, firm: r.rows[0].firm };
  }
  (req as any)._landsecAccessResolved = true;
  (req as any)._landsecAccess = row;
  return row;
}

export interface LandsecViewer {
  companyId: string;
  isClient: boolean;
  role: LandsecRole | "bgp" | "landsec";   // "landsec" = a Landsec login with no access row (full client view)
  schemes: Set<string> | null;             // null = every scheme
  firm: string | null;
}

// Who is asking, in Landsec terms. Null when the request is from another
// client's login (never Landsec data) or there is no Landsec company row.
export async function landsecViewer(req: Request): Promise<LandsecViewer | null> {
  const scope = await resolveCompanyScope(req);
  let companyId: string | null;
  let isClient = false;
  if (scope) {
    if (!(await isLandsecCompany(scope))) return null;
    companyId = scope;
    isClient = await isClientRequestUser(req);
  } else {
    companyId = await landsecCompanyId();
  }
  if (!companyId) return null;
  if (!isClient) return { companyId, isClient, role: "bgp", schemes: null, firm: null };
  const access = await getLandsecAccess(req);
  if (!access) return { companyId, isClient, role: "landsec", schemes: null, firm: null };
  const restricted = RESTRICTED_LANDSEC_ROLES.includes(access.role);
  const schemes = restricted ? new Set((access.schemes || []).filter(k => LANDSEC_SCHEMES.some(s => s.key === k))) : null;
  return { companyId, isClient, role: access.role, schemes, firm: access.firm };
}

export function viewerCanSeeScheme(v: LandsecViewer, schemeKey: string | null | undefined): boolean {
  if (!v.schemes) return true;
  return !!schemeKey && v.schemes.has(schemeKey);
}

// The API a restricted role may reach. Everything else is refused at the
// gateway before any handler runs.
const RESTRICTED_COMMON = ["/api/landsec/", "/api/heartbeat", "/api/client/brand-theme", "/api/push/", "/api/config/", "/api/notifications"];
const ASSET_MANAGER_READS = ["/api/crm/companies/", "/api/brands/", "/api/brand-logo/", "/api/brand/", "/api/covenant/by-crm/", "/api/client/crm/"];

export async function restrictedLandsecApiDecision(req: Request, path: string): Promise<"allow" | "deny" | null> {
  const access = await getLandsecAccess(req);
  if (!access || !RESTRICTED_LANDSEC_ROLES.includes(access.role)) return null;
  const p = path.toLowerCase();
  const hit = (list: string[]) => list.some(pre => pre.endsWith("/") ? p.startsWith(pre) : (p === pre || p.startsWith(pre + "/")));
  if (hit(RESTRICTED_COMMON)) {
    // Joint agents never see brand cases (BGP's brand work).
    if (access.role === "joint_agent" && p.startsWith("/api/landsec/brand-case")) return "deny";
    return "allow";
  }
  if (access.role === "asset_manager" && req.method === "GET" && hit(ASSET_MANAGER_READS)) return "allow";
  return "deny";
}

export function setupLandsecAccessRoutes(app: Express) {
  // Every Landsec login with its role and schemes (admin).
  app.get("/api/landsec/access", requireAuth, requireAdmin, async (_req, res) => {
    try {
      const r = await pool.query(
        `SELECT u.id, u.name, u.email, u.is_active, u.team, a.landsec_role, a.schemes, a.firm, a.notes, a.updated_at
           FROM users u
           LEFT JOIN landsec_access a ON a.user_id = u.id
          WHERE u.role = 'Client' AND (lower(u.team) = 'landsec' OR a.user_id IS NOT NULL)
          ORDER BY a.landsec_role NULLS FIRST, u.name`);
      res.json({
        users: r.rows.map((u: any) => ({ id: u.id, name: u.name, email: u.email, active: u.is_active !== false, team: u.team, role: u.landsec_role || null, schemes: u.schemes || [], firm: u.firm, notes: u.notes, updatedAt: u.updated_at })),
        roles: LANDSEC_ROLES, schemes: LANDSEC_SCHEMES.map(s => ({ key: s.key, name: s.name, group: s.group })),
      });
    } catch (e: any) { res.status(500).json({ error: e?.message || "Failed" }); }
  });

  // Create a Landsec login (or set an existing one's role and schemes).
  app.post("/api/landsec/access", requireAuth, requireAdmin, async (req: any, res) => {
    try {
      const b = req.body || {};
      const email = String(b.email || "").trim().toLowerCase();
      const role = String(b.role || "") as LandsecRole;
      if (!email || !/@/.test(email)) return res.status(400).json({ error: "An email address is needed" });
      if (!LANDSEC_ROLES.some(r => r.key === role)) return res.status(400).json({ error: "role must be leasing_manager, asset_manager or joint_agent" });
      if (email.endsWith("@brucegillinghampollard.com")) return res.status(400).json({ error: "BGP staff use their own logins" });
      const schemes: string[] = Array.isArray(b.schemes) ? b.schemes.map(String).filter((k: string) => LANDSEC_SCHEMES.some(s => s.key === k)) : [];
      if (RESTRICTED_LANDSEC_ROLES.includes(role) && schemes.length === 0) return res.status(400).json({ error: "Pick at least one scheme for an asset manager or joint agent" });
      const adminId = req.session?.userId || req.tokenUserId || null;

      let user = (await pool.query(`SELECT id, name, role, team FROM users WHERE lower(email) = $1 OR lower(username) = $1 LIMIT 1`, [email])).rows[0];
      let tempPassword: string | null = null;
      if (!user) {
        tempPassword = b.password ? String(b.password) : randomUUID().replace(/-/g, "").slice(0, 14);
        const name = String(b.name || email.split("@")[0]).trim();
        user = (await pool.query(
          `INSERT INTO users (id, username, password, name, email, role, team, is_active)
           VALUES (gen_random_uuid(), $1, $2, $3, $1, 'Client', 'Landsec', true) RETURNING id, name, role, team`,
          [email, await hashPassword(tempPassword), name]
        )).rows[0];
      } else if (user.role !== "Client" || String(user.team || "").toLowerCase() !== "landsec") {
        return res.status(400).json({ error: "That login is not a Landsec client login" });
      } else if (b.password) {
        tempPassword = String(b.password);
        await pool.query(`UPDATE users SET password = $2 WHERE id = $1`, [user.id, await hashPassword(tempPassword)]);
      }
      await pool.query(
        `INSERT INTO landsec_access (user_id, landsec_role, schemes, firm, notes, created_by, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())
         ON CONFLICT (user_id) DO UPDATE SET landsec_role = EXCLUDED.landsec_role, schemes = EXCLUDED.schemes, firm = EXCLUDED.firm, notes = EXCLUDED.notes, updated_at = NOW()`,
        [user.id, role, role === "leasing_manager" ? null : schemes, b.firm ? String(b.firm) : null, b.notes ? String(b.notes) : null, adminId]
      );
      clearCompanyScopeCache();
      res.json({ ok: true, userId: user.id, tempPassword });
    } catch (e: any) { res.status(500).json({ error: e?.message || "Failed" }); }
  });

  // Remove the role (the login goes back to the full Landsec client view).
  app.delete("/api/landsec/access/:userId", requireAuth, requireAdmin, async (req, res) => {
    try {
      await pool.query(`DELETE FROM landsec_access WHERE user_id = $1`, [String(req.params.userId)]);
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ error: e?.message || "Failed" }); }
  });
}
