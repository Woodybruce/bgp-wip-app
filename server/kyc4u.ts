// KYC4U — BGP's outsourced KYC provider keeps each request's status on a
// SharePoint site in THEIR Microsoft tenant (kyc4ultd, customer CST1092).
// BGP accounts are guests there (Woody, 2026-09-28: "anyone with our email
// can access the Sharepoint"). A BGP systems account signs in once, as a
// guest in KYC4U's tenant, through this app; its token cache is kept on the
// server and the request grid is pulled every six hours into kyc4u_requests.
// No password is ever typed into the app or a chat.
//
// Azure prerequisites (the app registration behind AZURE_CLIENT_ID):
//   - Supported account types: accounts in any organisational directory
//   - Redirect URI (Web): https://chatbgp.app/api/kyc4u/callback
//   - Delegated Microsoft Graph permissions: Sites.Read.All, User.Read, offline_access
import type { Express, Request, Response } from "express";
import crypto from "crypto";
import { ConfidentialClientApplication } from "@azure/msal-node";
import { pool } from "./db";

const TENANT = process.env.KYC4U_TENANT || "kyc4ultd.onmicrosoft.com";
const SITE_HOST = process.env.KYC4U_SITE_HOST || "kyc4ultd.sharepoint.com";
const SITE_PATH = process.env.KYC4U_SITE_PATH || "/sites/customers/CST1092";
const SCOPES = ["https://graph.microsoft.com/Sites.Read.All", "https://graph.microsoft.com/User.Read"];
const CACHE_KEY = "kyc4u:connection";
const SYNC_EVERY_MS = 6 * 3600_000;

let client: ConfidentialClientApplication | null = null;
function msal(): ConfidentialClientApplication {
  if (client) return client;
  const clientId = process.env.AZURE_CLIENT_ID;
  const clientSecret = (process.env.AZURE_SECRET_V2 || process.env.AZURE_CLIENT_SECRET)?.trim();
  if (!clientId || !clientSecret) throw new Error("Azure credentials not configured");
  client = new ConfidentialClientApplication({ auth: { clientId, clientSecret, authority: `https://login.microsoftonline.com/${TENANT}` } });
  return client;
}

const redirectUri = (req: Request) => {
  const proto = req.headers["x-forwarded-proto"] || req.protocol;
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `${proto}://${host}/api/kyc4u/callback`;
};

interface Connection { cache: string; homeAccountId: string; username: string; connectedAt: string; connectedBy: string | null; lastSyncAt?: string | null; lastError?: string | null; listIds?: string[] }

async function loadConnection(): Promise<Connection | null> {
  const r = await pool.query(`SELECT value FROM system_settings WHERE key = $1`, [CACHE_KEY]);
  return (r.rows[0]?.value as Connection) || null;
}
async function saveConnection(conn: Connection | null) {
  if (!conn) { await pool.query(`DELETE FROM system_settings WHERE key = $1`, [CACHE_KEY]); return; }
  await pool.query(`INSERT INTO system_settings (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [CACHE_KEY, JSON.stringify(conn)]);
}

let lock: Promise<unknown> = Promise.resolve();
async function token(): Promise<{ token: string; conn: Connection } | null> {
  const run = lock.then(async () => {
    const conn = await loadConnection();
    if (!conn) return null;
    const c = msal();
    c.getTokenCache().deserialize(conn.cache);
    const account = (await c.getTokenCache().getAllAccounts()).find(a => a.homeAccountId === conn.homeAccountId);
    if (!account) return null;
    const result = await c.acquireTokenSilent({ scopes: SCOPES, account });
    const cache = c.getTokenCache().serialize();
    if (cache !== conn.cache) await saveConnection({ ...conn, cache });
    return result?.accessToken ? { token: result.accessToken, conn: { ...conn, cache } } : null;
  });
  lock = run.catch(() => undefined);
  return run;
}

async function graph(path: string, accessToken: string): Promise<any> {
  const res = await fetch(path.startsWith("http") ? path : `https://graph.microsoft.com/v1.0${path}`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Graph ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

const pick = (fields: Record<string, any>, patterns: RegExp[]) => {
  for (const re of patterns) {
    const key = Object.keys(fields).find(k => re.test(k) && fields[k] != null && String(fields[k]).trim());
    if (key) return String(typeof fields[key] === "object" ? (fields[key].LookupValue ?? fields[key].Email ?? JSON.stringify(fields[key])) : fields[key]).trim();
  }
  return null;
};

// Pull every generic list on the site (the ViewRequestStatus grid reads one
// of them; system lists are skipped), upsert the items, and match each to a
// CRM company by its client / entity name when exactly one fits.
export async function syncKyc4u(): Promise<{ lists: number; items: number; matched: number }> {
  const auth = await token();
  if (!auth) throw new Error("KYC4U is not connected");
  try {
    const site = await graph(`/sites/${SITE_HOST}:${SITE_PATH}`, auth.token);
    const lists = (await graph(`/sites/${site.id}/lists?$select=id,displayName,list,system&$top=200`, auth.token)).value || [];
    const wanted = lists.filter((l: any) => !l.system && !l.list?.hidden && ["genericList", "issueTracking", "tasks", "events"].includes(l.list?.template || "genericList"));
    const { buyerNameKey } = await import("./investment-buyers");
    const companies = (await pool.query(`SELECT id, name FROM crm_companies WHERE merged_into_id IS NULL AND name IS NOT NULL`)).rows;
    const byKey = new Map<string, string[]>();
    for (const c of companies) { const k = buyerNameKey(c.name); if (k.length >= 3) byKey.set(k, [...(byKey.get(k) || []), c.id]); }
    let items = 0, matched = 0;
    for (const list of wanted) {
      let next: string | null = `/sites/${site.id}/lists/${list.id}/items?$expand=fields&$top=200`;
      while (next) {
        const page: any = await graph(next, auth.token);
        for (const item of page.value || []) {
          const fields = item.fields || {};
          const title = pick(fields, [/^title$/i, /client|entity|company|customer|subject/i]);
          const status = pick(fields, [/^status$/i, /status|stage|progress|outcome/i]);
          const entity = pick(fields, [/entity|client|company|customer|subject/i, /^title$/i]);
          const ids = entity ? byKey.get(buyerNameKey(entity)) : undefined;
          const companyId = ids?.length === 1 ? ids[0] : null;
          if (companyId) matched++;
          await pool.query(
            `INSERT INTO kyc4u_requests (list_id, item_id, list_name, title, status, entity_name, company_id, fields, created_at_source, modified_at_source, web_url, synced_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, NOW())
             ON CONFLICT (list_id, item_id) DO UPDATE SET list_name = EXCLUDED.list_name, title = EXCLUDED.title, status = EXCLUDED.status,
               entity_name = EXCLUDED.entity_name, company_id = COALESCE(kyc4u_requests.company_id_manual, EXCLUDED.company_id),
               fields = EXCLUDED.fields, created_at_source = EXCLUDED.created_at_source, modified_at_source = EXCLUDED.modified_at_source,
               web_url = EXCLUDED.web_url, synced_at = NOW()`,
            [list.id, item.id, list.displayName, title, status, entity, companyId, JSON.stringify(fields), item.createdDateTime || null, item.lastModifiedDateTime || null, item.webUrl || null]);
          items++;
        }
        next = page["@odata.nextLink"] || null;
      }
    }
    await saveConnection({ ...auth.conn, lastSyncAt: new Date().toISOString(), lastError: null, listIds: wanted.map((l: any) => l.id) });
    console.log(`[kyc4u] synced ${items} requests from ${wanted.length} lists (${matched} matched to CRM)`);
    return { lists: wanted.length, items, matched };
  } catch (e: any) {
    await saveConnection({ ...auth.conn, lastError: String(e?.message || e).slice(0, 500) });
    throw e;
  }
}

// state → who pressed Connect; the Microsoft redirect comes back without
// the app's bearer token, so the state is the proof.
const pendingStates = new Map<string, { userId: string | null; at: number }>();

export function registerKyc4uRoutes(app: Express, requireAuth: any, requireAdmin: any) {
  app.get("/api/kyc4u/status", requireAuth, async (_req: Request, res: Response) => {
    try {
      const conn = await loadConnection();
      const counts = (await pool.query(`SELECT COUNT(*)::int AS n, COUNT(company_id)::int AS matched FROM kyc4u_requests`)).rows[0];
      res.json({
        connected: !!conn, username: conn?.username || null, connectedAt: conn?.connectedAt || null,
        lastSyncAt: conn?.lastSyncAt || null, lastError: conn?.lastError || null,
        site: `https://${SITE_HOST}${SITE_PATH}`, requests: counts.n, matched: counts.matched,
      });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.get("/api/kyc4u/connect", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const state = crypto.randomBytes(24).toString("hex");
      pendingStates.set(state, { userId: req.session.userId || (req as any).tokenUserId || null, at: Date.now() });
      const authUrl = await msal().getAuthCodeUrl({ scopes: SCOPES, redirectUri: redirectUri(req), prompt: "select_account", state });
      res.json({ authUrl, redirectUri: redirectUri(req) });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.get("/api/kyc4u/callback", async (req: Request, res: Response) => {
    const back = (msg: string) => res.redirect(`/kyc-clouseau?tab=kyc4u&kyc4u=${encodeURIComponent(msg)}`);
    try {
      if (req.query.error) return back(String(req.query.error_description || req.query.error));
      const pending = pendingStates.get(String(req.query.state || ""));
      pendingStates.delete(String(req.query.state || ""));
      if (!pending || Date.now() - pending.at > 15 * 60_000) return back("The sign-in expired — try Connect again");
      const c = msal();
      const result = await c.acquireTokenByCode({ code: String(req.query.code || ""), scopes: SCOPES, redirectUri: redirectUri(req) });
      if (!result?.account) return back("No account came back from Microsoft");
      await saveConnection({
        cache: c.getTokenCache().serialize(), homeAccountId: result.account.homeAccountId,
        username: result.account.username, connectedAt: new Date().toISOString(), connectedBy: pending.userId,
      });
      syncKyc4u().catch((e: any) => console.warn("[kyc4u] first sync failed:", e?.message));
      back("connected");
    } catch (e: any) {
      console.error("[kyc4u] callback failed:", e?.message);
      back(String(e?.message || "Sign-in failed").slice(0, 300));
    }
  });

  app.post("/api/kyc4u/sync", requireAuth, requireAdmin, async (_req: Request, res: Response) => {
    try { res.json(await syncKyc4u()); } catch (e: any) { res.status(502).json({ message: e.message }); }
  });

  app.post("/api/kyc4u/disconnect", requireAuth, requireAdmin, async (_req: Request, res: Response) => {
    try { await saveConnection(null); res.json({ ok: true }); } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.get("/api/kyc4u/requests", requireAuth, async (_req: Request, res: Response) => {
    try {
      const r = await pool.query(
        `SELECT q.list_id AS "listId", q.item_id AS "itemId", q.list_name AS "listName", q.title, q.status, q.entity_name AS "entityName",
                q.company_id AS "companyId", c.name AS "companyName", q.modified_at_source AS "modifiedAt", q.web_url AS "webUrl", q.fields
           FROM kyc4u_requests q LEFT JOIN crm_companies c ON c.id = q.company_id
          ORDER BY q.modified_at_source DESC NULLS LAST LIMIT 500`);
      res.json(r.rows);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // Staff can fix a match by hand; later syncs keep it.
  app.patch("/api/kyc4u/requests/:listId/:itemId", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const companyId = typeof req.body?.companyId === "string" && req.body.companyId ? req.body.companyId : null;
      await pool.query(`UPDATE kyc4u_requests SET company_id = $3, company_id_manual = $3 WHERE list_id = $1 AND item_id = $2`, [req.params.listId, req.params.itemId, companyId]);
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  setInterval(() => {
    loadConnection().then(conn => { if (conn) return syncKyc4u(); }).catch((e: any) => console.warn("[kyc4u] scheduled sync failed:", e?.message));
  }, SYNC_EVERY_MS).unref?.();
}
