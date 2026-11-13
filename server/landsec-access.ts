// Landsec logins by role and scheme (docs/landsec-pitch-plan.md, item 6).
// A joint agent is a separate front door, not scheme checks retrofitted
// into the existing client view: that login reaches only the Landsec
// workspace routes and the letting work on its own schemes, and those
// routes filter to its schemes. A Landsec login with no row here, a leasing
// manager and an asset manager all have the full Landsec client view
// (Woody, 2026-11-13: "asset managers and leasing landsec should be the
// same"). An asset manager's role is a label: it says who the asset manager
// is on a brief, a brand case and a recommendation, and the schemes on the
// login are the ones that person answers for. They limit nothing.
import type { Express, Request } from "express";
import { randomUUID } from "crypto";
import { pool } from "./db";
import { requireAuth, requireAdmin, hashPassword } from "./auth";
import { resolveCompanyScope, isClientRequestUser, clearCompanyScopeCache } from "./company-scope";
import { landsecCompanyId, isLandsecCompany, resolveLandsecPortfolio, LANDSEC_SCHEMES } from "./landsec-schemes";
import { LANDSEC_ROLES, RESTRICTED_LANDSEC_ROLES, restrictedLandsecApiRule, isKnownLandsecRole, UNKNOWN_LANDSEC_ROLE_ERROR, type LandsecRole } from "@shared/landsec";
import { runLandsecLocked, isLandsecLocked, LANDSEC_AI_LOCK_MESSAGE } from "./utils/ai-provider";
import type { Response, NextFunction } from "express";

// Is this request about Landsec data? A Landsec client login, or BGP staff
// who have switched the team picker to Landsec. Cached per request. The
// team name counts on its own, so renaming the Landsec company row cannot
// take a Landsec login out of the lock.
const isLandsecTeamName = (t: any) => ["landsec", "landsecurities"].includes(String(t || "").toLowerCase().replace(/[^a-z]/g, ""));

export async function isLandsecScopedRequest(req: Request): Promise<boolean> {
  if ((req as any)._landsecScopedResolved) return !!(req as any)._landsecScoped;
  const scope = await resolveCompanyScope(req);
  const scoped = isLandsecTeamName((req as any)._scopeTeam) || (!!scope && (await isLandsecCompany(scope)));
  (req as any)._landsecScopedResolved = true;
  (req as any)._landsecScoped = scoped;
  return scoped;
}

// Runs every Landsec-scoped /api request inside the AI lock, so the
// provider switch is ignored and the outside-provider paths refuse for the
// whole request, tools and streams included. Fails closed: when the check
// itself errors the request is refused, never let through unlocked. The
// flag on the request lets upload middleware re-enter the lock
// (server/utils/upload.ts).
export async function landsecAiLockMiddleware(req: Request, res: Response, next: NextFunction) {
  let scoped: boolean;
  try {
    scoped = await isLandsecScopedRequest(req);
  } catch (e: any) {
    console.warn("[landsec-access] AI lock check failed, request refused:", e?.message);
    return res.status(503).json({ error: "The request could not be checked. Try again in a moment." });
  }
  if (!scoped) return next();
  (req as any)._landsecLocked = true;
  return runLandsecLocked(() => next());
}

// For routes that would send content to OpenAI, Gemini or another provider.
export function refuseIfLandsecLocked(res: Response): boolean {
  if (!isLandsecLocked()) return false;
  res.status(403).json({ error: LANDSEC_AI_LOCK_MESSAGE, landsecAiLock: true });
  return true;
}

export interface LandsecAccessRow { role: LandsecRole; schemes: string[] | null; firm: string | null }

// A row whose role is not one of the three is thrown, on every read of it
// (the kept answer included), so the request is refused: an unrecognised
// value is never served as a full Landsec login.
function knownAccess(row: LandsecAccessRow | null): LandsecAccessRow | null {
  if (row && !isKnownLandsecRole(row.role)) throw new Error(UNKNOWN_LANDSEC_ROLE_ERROR);
  return row;
}

export async function getLandsecAccess(req: Request): Promise<LandsecAccessRow | null> {
  if ((req as any)._landsecAccessResolved) return knownAccess((req as any)._landsecAccess || null);
  const userId = req.session?.userId || (req as any).tokenUserId;
  let row: LandsecAccessRow | null = null;
  if (userId) {
    // Only a database with no landsec_access table reads as "no role". Any
    // other failure is thrown, so the request is refused and a restricted
    // login is never served as a full Landsec one because the read failed.
    const r = await pool.query(`SELECT landsec_role, schemes, firm FROM landsec_access WHERE user_id = $1`, [userId]).catch((e: any) => {
      if (e?.code === "42P01") return { rows: [] as any[] };
      throw e;
    });
    if (r.rows[0]) row = { role: r.rows[0].landsec_role, schemes: r.rows[0].schemes, firm: r.rows[0].firm };
  }
  (req as any)._landsecAccessResolved = true;
  (req as any)._landsecAccess = row;
  return knownAccess(row);
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

// The properties a Landsec login held to named schemes (a joint agent) may
// read deals and figures at. Null = no scheme limit applies to this caller
// (BGP staff, another client, and every Landsec login but a joint agent). It throws when the schemes cannot be read: the caller must then
// serve nothing (fail closed), never the whole Landsec portfolio.
export async function schemeLimitedPropertyIds(req: Request): Promise<string[] | null> {
  const viewer = await landsecViewer(req);
  if (!viewer?.schemes) return null;
  const portfolio = await resolveLandsecPortfolio(viewer.companyId);
  return portfolio.schemes.filter(s => viewerCanSeeScheme(viewer, s.key)).flatMap(s => s.properties.map(p => p.id));
}

// The same list for a handler that must answer either way: a failed read
// gives no properties (fail closed), never null, which would read as "no
// limit" and serve the whole Landsec portfolio.
export async function schemeLimitedPropertyIdsOrNone(req: Request, label: string): Promise<string[] | null> {
  try {
    return await schemeLimitedPropertyIds(req);
  } catch (e: any) {
    console.error(`[${label}] scheme scope failed:`, e?.message);
    return [];
  }
}

// The API a restricted role may reach. Only a joint agent is one: null
// means the ordinary client gateway decides. Everything else is refused at
// the gateway before any handler runs. The rules themselves are
// restrictedLandsecApiRule in shared/landsec.ts (tested without a database
// in server/landsec-gateway.test.ts).
export async function restrictedLandsecApiDecision(req: Request, path: string): Promise<"allow" | "deny" | null> {
  const access = await getLandsecAccess(req);
  if (!access || !RESTRICTED_LANDSEC_ROLES.includes(access.role)) return null;
  return restrictedLandsecApiRule(access.role, req.method, path);
}

export interface JointAgentLeftovers { schemes: string[]; viewingsCleared: number; checklistItems: number; dealsResponsible: number; briefs: number }

// A joint agent taken off a scheme (or deactivated) can no longer open its
// units, but work there may still name them. The viewings they are the agent
// on that are still to happen, or have no outcome yet, are cleared so they
// show as having no agent; the rest is counted for BGP to reassign: open
// checklist items they are responsible for, deals they are responsible for,
// and briefs they are a person on.
async function releaseJointAgentSchemes(userId: string, schemeKeys: string[]): Promise<JointAgentLeftovers | null> {
  if (!schemeKeys.length) return null;
  const out: JointAgentLeftovers = { schemes: schemeKeys.map(k => LANDSEC_SCHEMES.find(s => s.key === k)?.name || k), viewingsCleared: 0, checklistItems: 0, dealsResponsible: 0, briefs: 0 };
  const companyId = await landsecCompanyId();
  if (!companyId) return out;
  const propertyIds = (await resolveLandsecPortfolio(companyId)).schemes.filter(s => schemeKeys.includes(s.key)).flatMap(s => s.properties.map(p => p.id));
  if (!propertyIds.length) return out;
  const today = new Date().toISOString().slice(0, 10);
  out.viewingsCleared = (await pool.query(
    `UPDATE unit_viewings v SET owner_user_id = NULL, updated_at = NOW()
      WHERE v.owner_user_id = $1 AND v.deleted_at IS NULL
        AND COALESCE(v.status, 'scheduled') NOT IN ('cancelled', 'no_show', 'not_leasing')
        AND v.unit_id IN (SELECT id FROM available_units WHERE property_id = ANY($2::text[]))
        AND (left(v.viewing_date, 10) >= $3 OR COALESCE(trim(v.outcome), '') = '')
      RETURNING v.id`, [userId, propertyIds, today])).rows.length;
  const count = async (sql: string) => Number((await pool.query(sql, [userId, propertyIds])).rows[0]?.n || 0);
  out.checklistItems = await count(
    `SELECT COUNT(*)::int AS n FROM deal_checklist_items i JOIN available_units au ON au.id = i.unit_id
      WHERE i.assignee_user_id = $1 AND i.done_at IS NULL AND au.property_id = ANY($2::text[])`);
  out.dealsResponsible = await count(
    `SELECT COUNT(*)::int AS n FROM deal_checklists c JOIN available_units au ON au.id = c.unit_id
      WHERE c.responsible_user_id = $1 AND au.property_id = ANY($2::text[])`);
  out.briefs = await count(
    `SELECT COUNT(DISTINCT b.id)::int AS n FROM unit_brief_people p JOIN unit_briefs b ON b.id = p.brief_id
      WHERE p.user_id = $1 AND b.property_id = ANY($2::text[])`);
  return out;
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
      if (RESTRICTED_LANDSEC_ROLES.includes(role) && schemes.length === 0) return res.status(400).json({ error: "Pick at least one scheme for a joint agent" });
      const adminId = req.session?.userId || req.tokenUserId || null;

      let user = (await pool.query(`SELECT id, name, role, team FROM users WHERE lower(email) = $1 OR lower(username) = $1 LIMIT 1`, [email])).rows[0];
      // The role and schemes the login holds before this save.
      const before = user ? (await pool.query(`SELECT landsec_role, schemes FROM landsec_access WHERE user_id = $1`, [user.id])).rows[0] : undefined;
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
      } else if (before?.landsec_role === "joint_agent" && role !== "joint_agent" && b.confirmFullView !== true) {
        // A joint agent is an outside firm's login. Any other role gives it
        // the full Landsec view (all 14 schemes, brand pages, chat), so the
        // save is refused until the admin has confirmed exactly that.
        return res.status(400).json({ code: "JOINT_AGENT_FULL_VIEW", error: "This login is a joint agent's. Changing its role would give it the full Landsec view: all 14 schemes, BGP's brand pages and chat. Confirm that to save it." });
      } else if (role === "joint_agent" && before?.landsec_role !== "joint_agent"
        && (await pool.query(`SELECT 1 WHERE EXISTS (SELECT 1 FROM chat_threads WHERE created_by = $1) OR EXISTS (SELECT 1 FROM chat_thread_members WHERE user_id = $1)`, [user.id])).rows.length) {
        // A login that had the full Landsec view has conversations from it:
        // ChatBGP answers drawn from the whole account, and threads a joint
        // agent may not be in. They would stay readable to it.
        return res.status(400).json({ code: "JOINT_AGENT_HAS_CHATS", error: "This login has conversations from its full Landsec view. Make a new login for the joint agent." });
      } else if (b.password) {
        tempPassword = String(b.password);
        await pool.query(`UPDATE users SET password = $2 WHERE id = $1`, [user.id, await hashPassword(tempPassword)]);
      }
      // The schemes a joint agent is being taken off by this save.
      const removedSchemes: string[] = before?.landsec_role === "joint_agent"
        ? (before.schemes || []).filter((k: string) => !(role === "joint_agent" && schemes.includes(k)))
        : [];
      await pool.query(
        `INSERT INTO landsec_access (user_id, landsec_role, schemes, firm, notes, created_by, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())
         ON CONFLICT (user_id) DO UPDATE SET landsec_role = EXCLUDED.landsec_role, schemes = EXCLUDED.schemes, firm = EXCLUDED.firm, notes = EXCLUDED.notes, updated_at = NOW()`,
        [user.id, role, role === "leasing_manager" ? null : schemes, b.firm ? String(b.firm) : null, b.notes ? String(b.notes) : null, adminId]
      );
      clearCompanyScopeCache();
      // A socket connected under the old role may sit in conversation rooms a
      // joint agent's socket never joins: it reconnects under the new one.
      if (role === "joint_agent") {
        try { (await import("./websocket")).getIO()?.in(`user:${user.id}`).disconnectSockets(true); } catch {}
      }
      // The access change is saved. What the login still holds at the schemes
      // it lost is reported for BGP to reassign; if that check fails the save
      // still stands and the reply says the check could not be made.
      let removed: JointAgentLeftovers | null = null;
      let removedCheckFailed = false;
      if (removedSchemes.length) {
        try { removed = await releaseJointAgentSchemes(user.id, removedSchemes); }
        catch (e: any) { removedCheckFailed = true; console.warn("[landsec-access] could not check what the joint agent still holds:", e?.message); }
      }
      res.json({ ok: true, userId: user.id, tempPassword, removed, removedCheckFailed });
    } catch (e: any) { res.status(500).json({ error: e?.message || "Failed" }); }
  });

  // Remove the role. An asset manager or leasing manager is Landsec's own
  // person: the login goes back to the full Landsec client view. A joint
  // agent is an outside firm's login and must never get that view, so its
  // row is kept and the login is deactivated, with its sessions and tokens
  // ended.
  app.delete("/api/landsec/access/:userId", requireAuth, requireAdmin, async (req, res) => {
    try {
      const userId = String(req.params.userId);
      const row = (await pool.query(`SELECT landsec_role, schemes FROM landsec_access WHERE user_id = $1`, [userId])).rows[0];
      if (row?.landsec_role === "joint_agent") {
        await pool.query(`UPDATE users SET is_active = false WHERE id = $1`, [userId]);
        await pool.query(`DELETE FROM session WHERE sess::jsonb -> 'passport' ->> 'user' = $1 OR sess::jsonb ->> 'userId' = $1`, [userId]).catch((e: any) => console.warn("[landsec-access] sessions not ended:", e?.message));
        await pool.query(`DELETE FROM auth_tokens WHERE user_id = $1`, [userId]).catch((e: any) => console.warn("[landsec-access] tokens not ended:", e?.message));
        await pool.query(`DELETE FROM sso_exchange_codes WHERE user_id = $1`, [userId]).catch(() => undefined);
        let removed: JointAgentLeftovers | null = null;
        let removedCheckFailed = false;
        try { removed = await releaseJointAgentSchemes(userId, row.schemes || []); }
        catch (e: any) { removedCheckFailed = true; console.warn("[landsec-access] could not check what the joint agent still holds:", e?.message); }
        return res.json({ ok: true, deactivated: true, message: "The login was deactivated. A joint agent's login is never given the full Landsec view.", removed, removedCheckFailed });
      }
      await pool.query(`DELETE FROM landsec_access WHERE user_id = $1`, [userId]);
      res.json({ ok: true, deactivated: false });
    } catch (e: any) { res.status(500).json({ error: e?.message || "Failed" }); }
  });
}
