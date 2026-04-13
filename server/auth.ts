import bcrypt from "bcrypt";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import type { Express, Request, Response, NextFunction } from "express";
import { ConfidentialClientApplication } from "@azure/msal-node";
import { pool } from "./db";
import { storage } from "./storage";
import { loginSchema } from "@shared/schema";
import crypto from "crypto";
import { resolveCompanyScope, getClientTeamInfo } from "./company-scope";

const ADMIN_EMAILS = new Set([
  "woody@brucegillinghampollard.com",
  "rupert@brucegillinghampollard.com",
]);

async function ensureAdminFlag(userId: string, email: string) {
  const normalised = email.toLowerCase().trim();
  try {
    if (ADMIN_EMAILS.has(normalised)) {
      await pool.query("UPDATE users SET is_admin = true WHERE id = $1 AND (is_admin IS NULL OR is_admin = false)", [userId]);
    } else {
      await pool.query("UPDATE users SET is_admin = false WHERE id = $1 AND is_admin = true", [userId]);
    }
  } catch (err: any) {
    console.error("Failed to update admin flag:", err.message);
  }
}

declare module "express-session" {
  interface SessionData {
    userId: string;
    ssoState?: string;
  }
}

async function trackLogin(userId: string, method: 'password' | 'sso', isO365: boolean = false) {
  try {
    const existing = await pool.query("SELECT id FROM user_activity WHERE user_id = $1", [userId]);
    if (existing.rows.length > 0) {
      await pool.query(
        `UPDATE user_activity SET last_login_at = NOW(), login_count = login_count + 1, last_active_at = NOW(), login_method = $2${isO365 ? ", o365_linked = true, o365_linked_at = COALESCE(o365_linked_at, NOW())" : ""} WHERE user_id = $1`,
        [userId, method]
      );
    } else {
      await pool.query(
        "INSERT INTO user_activity (user_id, last_login_at, login_count, last_active_at, login_method, o365_linked, o365_linked_at) VALUES ($1, NOW(), 1, NOW(), $2, $3, $4)",
        [userId, method, isO365, isO365 ? new Date() : null]
      );
    }
  } catch (err: any) {
    console.error("Failed to track login:", err.message);
  }
}

async function trackActivity(userId: string) {
  try {
    await pool.query(
      "INSERT INTO user_activity (user_id, last_active_at, page_views) VALUES ($1, NOW(), 1) ON CONFLICT (user_id) DO UPDATE SET last_active_at = NOW(), page_views = user_activity.page_views + 1",
      [userId]
    );
  } catch (err: any) { console.error("[auth] trackActivity error:", err?.message); }
}

declare module "express" {
  interface Request {
    tokenUserId?: string;
  }
}

const PgStore = connectPgSimple(session);

async function createAuthToken(userId: string): Promise<string> {
  const token = crypto.randomBytes(48).toString("hex");
  const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000); // 8 hours
  await pool.query(
    "INSERT INTO auth_tokens (token, user_id, expires_at) VALUES ($1, $2, $3)",
    [token, userId, expiresAt]
  );
  return token;
}

export async function getUserIdFromToken(token: string): Promise<string | null> {
  const result = await pool.query(
    "SELECT user_id FROM auth_tokens WHERE token = $1 AND expires_at > NOW()",
    [token]
  );
  return result.rows[0]?.user_id || null;
}

async function deleteAuthToken(token: string): Promise<void> {
  await pool.query("DELETE FROM auth_tokens WHERE token = $1", [token]);
}

export function setupAuth(app: Express) {
  const isProduction = process.env.NODE_ENV === "production";

  if (isProduction && !process.env.SESSION_SECRET) {
    throw new Error("SESSION_SECRET must be set in production");
  }

  // Ensure session table exists before connect-pg-simple tries to use it
  pool.query(`
    CREATE TABLE IF NOT EXISTS "session" (
      "sid" varchar NOT NULL COLLATE "default",
      "sess" json NOT NULL,
      "expire" timestamp(6) NOT NULL,
      CONSTRAINT "session_pkey" PRIMARY KEY ("sid")
    );
    CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");
  `).catch((err: any) => console.error("[auth] Session table bootstrap error:", err.message));

  pool.query(`
    CREATE TABLE IF NOT EXISTS auth_tokens (
      id SERIAL PRIMARY KEY,
      token TEXT NOT NULL UNIQUE,
      user_id VARCHAR NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS user_activity (
      id SERIAL PRIMARY KEY,
      user_id VARCHAR NOT NULL UNIQUE,
      last_login_at TIMESTAMPTZ,
      login_count INTEGER DEFAULT 0,
      last_active_at TIMESTAMPTZ,
      page_views INTEGER DEFAULT 0,
      login_method TEXT,
      o365_linked BOOLEAN DEFAULT false,
      o365_linked_at TIMESTAMPTZ
    );
    CREATE TABLE IF NOT EXISTS sso_exchange_codes (
      id SERIAL PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      user_id VARCHAR NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL
    );
    ALTER TABLE users ADD COLUMN IF NOT EXISTS client_view_mode BOOLEAN DEFAULT false;
  `).catch((err: any) => console.error("[auth] Table bootstrap error:", err.message));

  app.set("trust proxy", 1);

  app.use(
    session({
      store: new PgStore({
        pool,
        tableName: "session",
        createTableIfMissing: true,
        pruneSessionInterval: 900,
        errorLog: (err: Error) => {
          console.error("[session-store]", err.message);
        },
      }),
      secret: process.env.SESSION_SECRET || "bgp-dev-fallback-secret",
      resave: false,
      saveUninitialized: false,
      rolling: true, // Extend session on activity (but cookie maxAge caps total lifetime)
      cookie: {
        maxAge: 8 * 60 * 60 * 1000, // 8 hours
        httpOnly: true,
        secure: isProduction,
        sameSite: isProduction ? ("none" as const) : ("lax" as const),
      },
    })
  );

  app.use(async (req: Request, _res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.slice(7);
      try {
        const userId = await getUserIdFromToken(token);
        if (userId) {
          req.tokenUserId = userId;
          if (!req.session.userId) {
            req.session.userId = userId;
          }
        }
      } catch (err: any) { console.error("[auth] token validation error:", err?.message); }
    }
    next();
  });

  app.post("/api/auth/login", async (req: Request, res: Response) => {
    const result = loginSchema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({ message: "Please provide email and password" });
    }

    const { username, password } = result.data;
    const loginInput = username.toLowerCase().trim();
    let user = await storage.getUserByUsername(loginInput);
    if (!user && loginInput.includes("@")) {
      const allUsers = await storage.getAllUsers();
      user = allUsers.find(u => u.email?.toLowerCase() === loginInput);
    }

    if (!user) {
      return res.status(401).json({ message: "Invalid username or password" });
    }

    if (user.isActive === false) {
      return res.status(403).json({ message: "Your account has been deactivated. Please contact an administrator." });
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.status(401).json({ message: "Invalid username or password" });
    }

    await new Promise<void>((resolve, reject) => {
      req.session.regenerate((err) => {
        if (err) return reject(err);
        resolve();
      });
    });
    req.session.userId = user.id;

    const token = await createAuthToken(user.id);
    trackLogin(user.id, 'password');
    ensureAdminFlag(user.id, user.email || user.username || "");

    const scopeCompanyId = await resolveCompanyScope(req);
    const isBgpStaff = (user.email || "").toLowerCase().endsWith("@brucegillinghampollard.com");
    let clientTeamInfo: { team: string; companyId: string; companyName: string } | null = null;
    if (isBgpStaff && user.team) {
      clientTeamInfo = await getClientTeamInfo(user.id);
    }
    req.session.save((err) => {
      if (err) {
        console.error("Session save error:", err);
      }
      const { password: _, ...safeUser } = user;
      const response: any = { ...safeUser, token };
      if (scopeCompanyId) {
        response.companyScopeId = scopeCompanyId;
        response.companyScopeName = user.team;
      }
      if (clientTeamInfo) {
        response.canViewAsClient = true;
        response.clientTeamCompanyId = clientTeamInfo.companyId;
        response.clientTeamName = clientTeamInfo.companyName;
        response.clientViewMode = false;
      }
      res.json(response);
    });
  });

  app.post("/api/auth/logout", async (req: Request, res: Response) => {
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith("Bearer ")) {
      await deleteAuthToken(authHeader.slice(7)).catch((err) => { console.error("[auth] Token deletion error on logout:", err?.message); });
    }

    req.session.destroy((err) => {
      if (err) {
        return res.status(500).json({ message: "Could not log out" });
      }
      res.clearCookie("connect.sid");
      res.json({ message: "Logged out" });
    });
  });

  app.get("/api/auth/me", async (req: Request, res: Response) => {
    const userId = req.session.userId || req.tokenUserId;
    if (!userId) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    const user = await storage.getUser(userId);
    if (!user) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    trackActivity(userId);
    await ensureAdminFlag(userId, user.email || user.username || "");
    if (ADMIN_EMAILS.has((user.email || "").toLowerCase().trim()) && !user.isAdmin) {
      user.isAdmin = true;
    }
    const { password: _, ...safeUser } = user;
    const scopeCompanyId = await resolveCompanyScope(req);
    if (scopeCompanyId) {
      (safeUser as any).companyScopeId = scopeCompanyId;
      (safeUser as any).companyScopeName = user.team;
    }
    const isBgpStaff = (user.email || "").toLowerCase().endsWith("@brucegillinghampollard.com");
    if (isBgpStaff && user.team) {
      const clientTeamInfo = await getClientTeamInfo(userId);
      if (clientTeamInfo) {
        const cvmResult = await pool.query(`SELECT client_view_mode FROM users WHERE id = $1`, [userId]);
        (safeUser as any).canViewAsClient = true;
        (safeUser as any).clientTeamCompanyId = clientTeamInfo.companyId;
        (safeUser as any).clientTeamName = clientTeamInfo.companyName;
        (safeUser as any).clientViewMode = !!(cvmResult.rows[0]?.client_view_mode);
      }
    }
    res.json(safeUser);
  });

  app.post("/api/auth/client-view-mode", requireAuth, async (req: Request, res: Response) => {
    const userId = req.session.userId || req.tokenUserId;
    if (!userId) return res.status(401).json({ message: "Not authenticated" });

    const user = await storage.getUser(userId);
    if (!user) return res.status(401).json({ message: "Not authenticated" });

    const isBgpStaff = (user.email || "").toLowerCase().endsWith("@brucegillinghampollard.com");
    if (!isBgpStaff) return res.status(403).json({ message: "Not available" });

    const clientTeamInfo = await getClientTeamInfo(userId);
    if (!clientTeamInfo) return res.status(400).json({ message: "Not on a client team" });

    const enabled = req.body.enabled === true;
    await pool.query(`UPDATE users SET client_view_mode = $1 WHERE id = $2`, [enabled, userId]);
    res.json({ clientViewMode: enabled, companyScopeId: enabled ? clientTeamInfo.companyId : null, companyScopeName: enabled ? clientTeamInfo.companyName : null });
  });

  const SSO_SCOPES_FULL = [
    "User.Read",
    "openid",
    "profile",
    "email",
    "offline_access",
    "Files.Read",
    "Files.Read.All",
    "Files.ReadWrite.All",
    "Sites.Read.All",
    "Sites.ReadWrite.All",
    "Calendars.Read",
    "Calendars.Read.Shared",
    "Mail.Read",
    "Mail.Read.Shared",
    "Mail.Send",
    "Notes.Read",
    "Notes.Read.All",
  ];
  const SSO_SCOPES_BASIC = [
    "User.Read",
    "openid",
    "profile",
    "email",
    "offline_access",
  ];
  // Note: We request full MS365 scopes at SSO login so SharePoint/Calendar/Mail
  // are auto-connected immediately, avoiding a second consent step.
  // If a user hits a permissions error, they can retry with ?basic=1 for minimal scopes.

  function getSsoMsalClient(): ConfidentialClientApplication | null {
    const clientId = process.env.AZURE_CLIENT_ID;
    const clientSecret = (process.env.AZURE_SECRET_V2 || process.env.AZURE_CLIENT_SECRET)?.trim();
    const tenantId = process.env.AZURE_TENANT_ID;
    if (!clientId || !clientSecret || !tenantId) return null;
    return new ConfidentialClientApplication({
      auth: {
        clientId,
        clientSecret,
        authority: `https://login.microsoftonline.com/${tenantId}`,
      },
    });
  }

  function getSsoRedirectUri(req: Request): string {
    const protocol = req.headers["x-forwarded-proto"] || req.protocol;
    const host = req.headers["x-forwarded-host"] || req.headers.host;
    return `${protocol}://${host}/api/auth/microsoft/callback`;
  }

  app.get("/api/auth/microsoft/diagnose", (_req: Request, res: Response) => {
    const secret = (process.env.AZURE_SECRET_V2 || process.env.AZURE_CLIENT_SECRET || "").trim();
    const clientId = (process.env.AZURE_CLIENT_ID || "").trim();
    const tenantId = (process.env.AZURE_TENANT_ID || "").trim();
    const fingerprint = secret ? `${secret.slice(0, 2)}…${secret.slice(-2)}` : null;
    res.json({
      clientIdLen: clientId.length,
      clientIdPreview: clientId ? `${clientId.slice(0, 8)}…${clientId.slice(-4)}` : null,
      tenantIdLen: tenantId.length,
      tenantIdPreview: tenantId ? `${tenantId.slice(0, 8)}…${tenantId.slice(-4)}` : null,
      secretLen: secret.length,
      secretFingerprint: fingerprint,
      secretSource: process.env.AZURE_SECRET_V2 ? "AZURE_SECRET_V2" : process.env.AZURE_CLIENT_SECRET ? "AZURE_CLIENT_SECRET" : null,
      secretHasWhitespace: /\s/.test(secret),
    });
  });

  app.get("/api/auth/microsoft", async (req: Request, res: Response) => {
    try {
      const client = getSsoMsalClient();
      if (!client) {
        return res.status(500).json({ message: "Microsoft SSO not configured" });
      }
      const useBasic = req.query.basic === "1";
      const scopes = useBasic ? SSO_SCOPES_BASIC : SSO_SCOPES_FULL;
      const state = crypto.randomBytes(32).toString("hex");
      req.session.ssoState = state;
      if (useBasic) {
        (req.session as any).ssoBasicMode = true;
      }
      const redirectUri = getSsoRedirectUri(req);
      console.log("SSO: initiating login, redirect URI =", redirectUri, "basic:", useBasic);

      const authUrl = await client.getAuthCodeUrl({
        scopes,
        redirectUri,
        prompt: "select_account",
        state,
        domainHint: "brucegillinghampollard.com",
      });

      req.session.save(() => {
        res.json({ authUrl });
      });
    } catch (err: any) {
      console.error("SSO auth error:", err.message);
      res.status(500).json({ message: "Failed to start Microsoft login" });
    }
  });

  app.get("/api/auth/microsoft/callback", async (req: Request, res: Response) => {
    const { code, error, error_description, state } = req.query;

    if (error) {
      const errDesc = (error_description as string) || (error as string) || "";
      console.error("SSO callback error:", error, "| description:", errDesc);
      const isConsentOrPermission = errDesc.toLowerCase().includes("consent") || 
        errDesc.toLowerCase().includes("permission") || 
        errDesc.toLowerCase().includes("aadsts65001") ||
        errDesc.toLowerCase().includes("aadsts70011") ||
        (error as string) === "access_denied";
      if (isConsentOrPermission && !(req.session as any).ssoBasicMode) {
        console.log("SSO: permissions error detected, retrying with basic scopes");
        try {
          const retryClient = getSsoMsalClient();
          if (retryClient) {
            const retryState = crypto.randomBytes(32).toString("hex");
            req.session.ssoState = retryState;
            (req.session as any).ssoBasicMode = true;
            const retryRedirectUri = getSsoRedirectUri(req);
            const retryAuthUrl = await retryClient.getAuthCodeUrl({
              scopes: SSO_SCOPES_BASIC,
              redirectUri: retryRedirectUri,
              prompt: "select_account",
              state: retryState,
              domainHint: "brucegillinghampollard.com",
            });
            return req.session.save(() => res.redirect(retryAuthUrl));
          }
        } catch (retryErr: any) {
          console.error("SSO: basic retry failed:", retryErr.message);
        }
      }
      return res.redirect("/?sso_error=" + encodeURIComponent(errDesc));
    }

    if (!code) {
      return res.redirect("/?sso_error=no_code");
    }

    const expectedState = req.session.ssoState;
    if (!expectedState || state !== expectedState) {
      console.error("SSO callback: state mismatch");
      return res.redirect("/?sso_error=invalid_state");
    }
    delete req.session.ssoState;

    try {
      const client = getSsoMsalClient();
      if (!client) {
        return res.redirect("/?sso_error=not_configured");
      }

      const redirectUri = getSsoRedirectUri(req);
      const useBasicScopes = !!(req.session as any).ssoBasicMode;
      delete (req.session as any).ssoBasicMode;
      const scopes = useBasicScopes ? SSO_SCOPES_BASIC : SSO_SCOPES_FULL;
      const result = await client.acquireTokenByCode({
        code: code as string,
        scopes,
        redirectUri,
      });

      if (!result?.accessToken) {
        return res.redirect("/?sso_error=no_token");
      }

      const graphRes = await fetch("https://graph.microsoft.com/v1.0/me", {
        headers: { Authorization: `Bearer ${result.accessToken}` },
      });

      if (!graphRes.ok) {
        console.error("SSO: failed to get user profile from Graph");
        return res.redirect("/?sso_error=graph_failed");
      }

      const profile = await graphRes.json() as { mail?: string; userPrincipalName?: string; displayName?: string };
      const msEmail = (profile.mail || profile.userPrincipalName || "").toLowerCase().trim();

      if (!msEmail) {
        return res.redirect("/?sso_error=no_email");
      }

      console.log("SSO: Microsoft user email:", msEmail);

      const allUsers = await storage.getAllUsers();
      const user = allUsers.find(u => u.email?.toLowerCase() === msEmail);

      if (!user) {
        console.log("SSO: no matching BGP user for email", msEmail);
        return res.redirect("/?sso_error=" + encodeURIComponent("No BGP account found for " + msEmail + ". Ask Woody to create your account first."));
      }

      req.session.regenerate((regenErr) => {
        if (regenErr) {
          console.error("SSO: session regenerate error:", regenErr);
        }

        req.session.userId = user.id;

        req.session.msTokens = {
          accessToken: result.accessToken,
          expiresOn: result.expiresOn?.toISOString() || "",
        };
        const homeAccountId = result.account?.homeAccountId || null;
        if (homeAccountId) {
          req.session.msAccountHomeId = homeAccountId;
        }

        (async () => {
          try {
            const cacheData = client!.getTokenCache().serialize();
            const existing = await pool.query("SELECT id FROM msal_token_cache WHERE user_id = $1", [user.id]);
            if (existing.rows.length > 0) {
              await pool.query("UPDATE msal_token_cache SET cache_data = $1, home_account_id = $2, updated_at = NOW() WHERE user_id = $3", [cacheData, homeAccountId, user.id]);
            } else {
              await pool.query("INSERT INTO msal_token_cache (user_id, home_account_id, cache_data) VALUES ($1, $2, $3)", [user.id, homeAccountId, cacheData]);
            }
          } catch (err: any) {
            console.error("SSO: failed to save MSAL cache:", err.message);
          }

          const exchangeCode = crypto.randomBytes(32).toString("hex");
          const expiresAt = new Date(Date.now() + 60 * 1000);
          await pool.query(
            "INSERT INTO sso_exchange_codes (code, user_id, expires_at) VALUES ($1, $2, $3)",
            [exchangeCode, user.id, expiresAt]
          );

          console.log("SSO: login successful for", user.name, "(", msEmail, ")");
          trackLogin(user.id, 'sso', true);
          ensureAdminFlag(user.id, msEmail);

          req.session.save(() => {
            res.redirect("/?sso_code=" + exchangeCode);
          });
        })();
      });
    } catch (err: any) {
      console.error("SSO callback error:", err.message || err);
      res.redirect("/?sso_error=" + encodeURIComponent(err.message || "login_failed"));
    }
  });

  app.post("/api/auth/sso-exchange", async (req: Request, res: Response) => {
    const { code } = req.body;
    if (!code || typeof code !== "string") {
      return res.status(400).json({ message: "Missing exchange code" });
    }

    try {
      const result = await pool.query(
        "DELETE FROM sso_exchange_codes WHERE code = $1 AND expires_at > NOW() RETURNING user_id",
        [code]
      );

      if (result.rows.length === 0) {
        return res.status(401).json({ message: "Invalid or expired code" });
      }

      const userId = result.rows[0].user_id;
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(401).json({ message: "User not found" });
      }

      req.session.userId = userId;
      const token = await createAuthToken(userId);

      req.session.save((err) => {
        if (err) console.error("SSO exchange session save error:", err);
        const { password: _, ...safeUser } = user;
        res.json({ ...safeUser, token });
      });
    } catch (err: any) {
      console.error("SSO exchange error:", err.message);
      res.status(500).json({ message: "Exchange failed" });
    }
  });

  app.patch("/api/auth/me/dashboard-widgets", requireAuth, async (req: Request, res: Response) => {
    const userId = req.session.userId || req.tokenUserId;
    if (!userId) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    const { widgets } = req.body;
    if (!Array.isArray(widgets) || !widgets.every((w: unknown) => typeof w === "string")) {
      return res.status(400).json({ message: "widgets must be an array of strings" });
    }
    const ALLOWED_WIDGETS = ["key-instructions", "news-summary", "quick-actions", "available-units", "today-diary", "active-contacts", "new-requirements", "activity-alerts", "inbox", "agent-pipeline", "my-leads", "sharepoint", "studios", "properties-deals", "system-activity", "daily-digest", "my-tasks"];
    const mapped = widgets.map((w: string) => w === "recent-properties" ? "key-instructions" : w);
    const sanitized = [...new Set(mapped.filter((w: string) => ALLOWED_WIDGETS.includes(w)))];
    await storage.updateUserDashboardWidgets(userId, sanitized);
    res.json({ success: true, widgets: sanitized });
  });

  app.patch("/api/auth/me/dashboard-layout", requireAuth, async (req: Request, res: Response) => {
    const userId = req.session.userId || req.tokenUserId;
    if (!userId) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    const { layout } = req.body;
    if (layout !== null && typeof layout !== "object") {
      return res.status(400).json({ message: "layout must be an object or null" });
    }
    await pool.query(`UPDATE users SET dashboard_layout = $1 WHERE id = $2`, [layout ? JSON.stringify(layout) : null, userId]);
    res.json({ success: true });
  });

  app.get("/api/dashboard-template", requireAuth, async (_req: Request, res: Response) => {
    const result = await pool.query(`SELECT value FROM system_settings WHERE key = 'dashboard_template'`);
    res.json({ template: result.rows[0]?.value || null });
  });

  app.put("/api/dashboard-template", requireAuth, async (req: Request, res: Response) => {
    const userId = req.session.userId || req.tokenUserId;
    if (!userId) return res.status(401).json({ message: "Not authenticated" });
    const userResult = await pool.query(`SELECT is_admin FROM users WHERE id = $1`, [userId]);
    if (!userResult.rows[0]?.is_admin) {
      return res.status(403).json({ message: "Admin access required" });
    }
    const { template } = req.body;
    if (template !== null && typeof template !== "object") {
      return res.status(400).json({ message: "template must be an object or null" });
    }
    await pool.query(
      `INSERT INTO system_settings (key, value, updated_at) VALUES ('dashboard_template', $1, now())
       ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = now()`,
      [template ? JSON.stringify(template) : null]
    );
    res.json({ success: true });
  });
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const userId = req.session.userId || req.tokenUserId;
  if (!userId) {
    return res.status(401).json({ message: "Not authenticated" });
  }
  if (!req.session.userId && req.tokenUserId) {
    req.session.userId = req.tokenUserId;
  }
  try {
    const result = await pool.query("SELECT is_active FROM users WHERE id = $1", [userId]);
    if (result.rows.length > 0 && result.rows[0].is_active === false) {
      return res.status(403).json({ message: "Your account has been deactivated. Please contact an administrator." });
    }
  } catch (_e) {}
  next();
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}
