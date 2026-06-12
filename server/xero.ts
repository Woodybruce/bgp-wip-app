import type { Express, Request, Response } from "express";
import { requireAuth } from "./auth";
import { db } from "./db";
import { xeroInvoices, crmDeals } from "@shared/schema";
import { eq, desc } from "drizzle-orm";
import { z } from "zod";
import crypto from "crypto";
import { isInvoicedStatus } from "@shared/deal-status";

const XERO_AUTH_URL = "https://login.xero.com/identity/connect/authorize";
const XERO_TOKEN_URL = "https://identity.xero.com/connect/token";
const XERO_API_BASE = "https://api.xero.com/api.xro/2.0";
const XERO_CONNECTIONS_URL = "https://api.xero.com/connections";

const TRUSTED_HOSTS = ["bgp-wip-app-production-efac.up.railway.app", "chatbgp.app", "bgp-dashboard-flow.replit.app", "9578f23f-37ae-4acf-944d-42a112fa681a-00-w7prqguaevhh.worf.replit.dev"];

const XERO_INVOICED_STATUSES = ["AUTHORISED", "PAID"];

// Xero contacts can carry multiple addresses (POBOX, STREET, DELIVERY).
// For billing we want POBOX (the one used on invoices); fall back to
// STREET, then the first non-empty entry.
function pickBillingAddress(addresses: any[] | undefined | null): any | null {
  if (!Array.isArray(addresses) || addresses.length === 0) return null;
  const hasContent = (a: any) =>
    a && (a.AddressLine1 || a.AddressLine2 || a.City || a.PostalCode || a.Country);
  return (
    addresses.find((a) => a?.AddressType === "POBOX" && hasContent(a)) ||
    addresses.find((a) => a?.AddressType === "STREET" && hasContent(a)) ||
    addresses.find(hasContent) ||
    null
  );
}

async function autoPromoteDealToInvoiced(dealId: string, xeroStatus: string): Promise<boolean> {
  if (!XERO_INVOICED_STATUSES.includes(xeroStatus)) return false;
  try {
    const [deal] = await db.select().from(crmDeals).where(eq(crmDeals.id, dealId)).limit(1);
    if (!deal) return false;
    if (isInvoicedStatus(deal.status)) return false;
    await db.update(crmDeals)
      .set({ status: "INV", updatedAt: new Date() })
      .where(eq(crmDeals.id, dealId));
    console.log(`[xero-auto] Deal ${dealId} auto-promoted to INV (Xero status: ${xeroStatus})`);
    return true;
  } catch (err: any) {
    console.error(`[xero-auto] Failed to auto-promote deal ${dealId}:`, err.message);
    return false;
  }
}

const createInvoiceSchema = z.object({
  dealId: z.string().min(1),
  xeroContactId: z.string().nullable().optional(),
  contactName: z.string().optional(),
  contactEmail: z.string().email().optional().or(z.literal("")),
  poNumber: z.string().nullable().optional(),
  reference: z.string().optional(),
  dueDate: z.string().optional(),
  accountCode: z.string().optional(),
  lineItems: z.array(z.object({
    Description: z.string(),
    Quantity: z.number().positive(),
    UnitAmount: z.number().min(0),
    AccountCode: z.string().optional(),
    TaxType: z.string().optional(),
  })).optional(),
});

declare module "express-session" {
  interface SessionData {
    xeroTokens?: {
      accessToken: string;
      refreshToken: string;
      expiresAt: number;
      tenantId?: string;
    };
    xeroOAuthState?: string;
  }
}

function getRedirectUri(req: Request): string {
  // Explicit override wins — must match a URL registered in the Xero
  // developer app exactly. Set XERO_REDIRECT_URI if the app is reachable
  // under a custom domain (e.g. https://chatbgp.app/api/xero/callback).
  const override = process.env.XERO_REDIRECT_URI;
  if (override && override.trim()) return override.trim();

  // Otherwise derive from the incoming request so every trusted host works
  // automatically, as long as each one is registered in the Xero app.
  const fwdProto = (req.headers["x-forwarded-proto"] as string | undefined)?.split(",")[0]?.trim();
  const fwdHost = (req.headers["x-forwarded-host"] as string | undefined)?.split(",")[0]?.trim();
  const host = fwdHost || (req.headers.host as string | undefined);
  const proto = fwdProto || (host && host.startsWith("localhost") ? "http" : "https");
  if (host) return `${proto}://${host}/api/xero/callback`;

  // Last-ditch fallback — the Railway production URL.
  return "https://bgp-wip-app-production-efac.up.railway.app/api/xero/callback";
}

// Per-refresh-token mutex: Xero rotates refresh tokens (every successful
// refresh returns a new RT and invalidates the old one). If two parallel
// jobs both notice the access token expired and both POST the same RT,
// the first wins and the second hits `invalid_grant: refresh token
// consumed` — knocking the whole system session offline. Keyed by RT
// string so concurrent calls on the same token serialise, but different
// sessions don't block each other.
const refreshLocks = new Map<string, Promise<string | null>>();

export async function refreshXeroToken(session: any): Promise<string | null> {
  // Callers can pass null/undefined deliberately to mean "no user session —
  // try the system-wide Xero session instead". xeroApiWithFallback handles
  // that fallback; here we just bail cleanly so it can take over.
  if (!session || !session.xeroTokens) return null;

  if (Date.now() < session.xeroTokens.expiresAt - 60000) {
    return session.xeroTokens.accessToken;
  }

  const rt = session.xeroTokens.refreshToken;
  if (!rt) return null;

  const inFlight = refreshLocks.get(rt);
  if (inFlight) {
    // Another caller is already refreshing this token. Wait for them and
    // then re-read from session — they will have mutated session.xeroTokens
    // in place (we share the same session object across withSystemXero calls).
    await inFlight.catch(() => {});
    return session.xeroTokens?.accessToken || null;
  }

  const clientId = process.env.XERO_CLIENT_ID;
  const clientSecret = process.env.XERO_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  const run = (async (): Promise<string | null> => {
    try {
      const res = await fetch(XERO_TOKEN_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: rt,
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        console.error("[Xero] Token refresh failed:", errText);
        // invalid_grant = the RT is dead (consumed by a parallel refresh,
        // revoked, or expired). Clear the system session so background
        // jobs stop hammering Xero with a known-bad token and the admin
        // sees a clear "Reconnect" prompt on the next status check.
        if (/invalid_grant|refresh token (consumed|expired|revoked)/i.test(errText)) {
          try {
            const { clearSystemXeroSession } = await import("./xero-system-session");
            await clearSystemXeroSession();
          } catch {/* table may not exist yet on a fresh boot */}
        }
        session.xeroTokens = undefined;
        return null;
      }

      const data = await res.json();
      session.xeroTokens = {
        ...session.xeroTokens,
        accessToken: data.access_token,
        refreshToken: data.refresh_token || session.xeroTokens.refreshToken,
        expiresAt: Date.now() + (data.expires_in || 1800) * 1000,
      };
      return data.access_token;
    } catch (err) {
      console.error("[Xero] Token refresh error:", err);
      session.xeroTokens = undefined;
      return null;
    }
  })();

  refreshLocks.set(rt, run);
  try {
    return await run;
  } finally {
    refreshLocks.delete(rt);
  }
}

// Read-side helper: tries the caller's session first, then falls back
// to the firm-wide system Xero session for unauthenticated/orphan
// requests. Used by the contacts / accounts / organisation endpoints
// so agents who haven't OAuth-connected their own session can still
// search the firm's Xero contacts.
//
// Write paths stay session-scoped via xeroApi() — when an invoice gets
// posted we want it attributed to the user who triggered it.
export async function xeroApiWithFallback(session: any, path: string, options: RequestInit = {}): Promise<any> {
  // session=null is the explicit "background caller, use the firm session"
  // signal (used by expense-categories etc). Skip the user-session attempt
  // entirely in that case rather than letting it throw and recover.
  if (session) {
    try {
      return await xeroApi(session, path, options);
    } catch (err: any) {
      if (!String(err?.message || "").includes("Not connected")) throw err;
      // fall through to the system session
    }
  }
  // Use withSystemXero so any token refresh that happens during the call
  // gets persisted back to system_settings (otherwise we'd re-refresh
  // every time, burning through refresh tokens unnecessarily).
  const { withSystemXero } = await import("./xero-system-session");
  const result = await withSystemXero((sysSession) => xeroApi(sysSession, path, options));
  if (result === null) throw new Error("Not connected to Xero");
  return result;
}

export async function xeroApi(session: any, path: string, options: RequestInit = {}): Promise<any> {
  const token = await refreshXeroToken(session);
  if (!token) throw new Error("Not connected to Xero");

  let tenantId = session.xeroTokens?.tenantId;
  if (!tenantId) {
    try {
      const connRes = await fetch(XERO_CONNECTIONS_URL, {
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      });
      if (connRes.ok) {
        const connections = await connRes.json();
        console.log("[Xero] Connections found:", connections.length);
        if (connections.length > 0) {
          tenantId = connections[0].tenantId;
          session.xeroTokens.tenantId = tenantId;
          console.log("[Xero] Auto-resolved tenant:", connections[0].tenantName);
        }
      } else {
        console.error("[Xero] Connections request failed:", connRes.status, await connRes.text());
      }
    } catch (e) {
      console.error("[Xero] Failed to auto-resolve tenant:", e);
    }
    if (!tenantId) throw new Error("No Xero tenant found. Please disconnect and reconnect to Xero to re-authorize with the required permissions.");
  }

  const url = `${XERO_API_BASE}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Xero-Tenant-Id": tenantId,
      Accept: "application/json",
      ...options.headers,
    },
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error(`[Xero] API error ${res.status}:`, errText);
    throw new Error(`Xero API error: ${res.status} - ${errText}`);
  }

  return res.json();
}

// Xero Payroll UK API — separate base URL from accounting. Uses the same
// session token but the OAuth scope must include payroll.payslip and
// payroll.employees. PDF endpoints return binary, hence the optional
// `binary` flag that returns a Buffer instead of JSON.
const XERO_PAYROLL_API_BASE = "https://api.xero.com/payroll.xro/2.0";
export async function xeroPayrollApi(session: any, path: string, opts: { binary?: boolean } = {}): Promise<any> {
  const token = await refreshXeroToken(session);
  if (!token) throw new Error("Not connected to Xero");

  let tenantId = session.xeroTokens?.tenantId;
  if (!tenantId) throw new Error("No Xero tenant — reconnect to Xero with payroll scopes");

  const res = await fetch(`${XERO_PAYROLL_API_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Xero-Tenant-Id": tenantId,
      Accept: opts.binary ? "application/pdf" : "application/json",
    },
  });
  if (!res.ok) {
    const txt = await res.text();
    if (res.status === 403) {
      throw new Error(`Xero Payroll scope not granted (403). Reconnect to Xero — admin → /api/xero/connect — to authorise payroll.payslip + payroll.employees.`);
    }
    throw new Error(`Xero Payroll error ${res.status}: ${txt}`);
  }
  return opts.binary ? Buffer.from(await res.arrayBuffer()) : res.json();
}

export function setupXeroRoutes(app: Express) {
  app.get("/api/xero/status", requireAuth, async (req: Request, res: Response) => {
    const clientId = process.env.XERO_CLIENT_ID;
    const clientSecret = process.env.XERO_CLIENT_SECRET;
    const configured = !!(clientId && clientSecret);
    const token = configured ? await refreshXeroToken(req.session) : null;
    res.json({
      configured,
      connected: !!token,
      tenantId: req.session.xeroTokens?.tenantId || null,
    });
  });

  // Admin-only: shows whether the firm-wide Xero session is healthy.
  // The system session is the one background jobs (Stripe webhooks,
  // expense auto-post, month-end imports) use; if it's gone, every
  // auto-post silently no-ops and the admin needs to reconnect.
  app.get("/api/xero/system-status", requireAuth, async (_req: Request, res: Response) => {
    try {
      const { getSystemXeroStatus } = await import("./xero-system-session");
      const status = await getSystemXeroStatus();
      res.json(status);
    } catch (e: any) {
      res.status(500).json({ error: e?.message });
    }
  });

  // Direct-redirect connect endpoint — use this from anchors/links rather than
  // the JSON-returning /api/xero/auth so the browser handles the redirect chain
  // without any client-side fetch logic that can silently fail.
  app.get("/api/xero/connect", requireAuth, async (req: Request, res: Response) => {
    try {
      const clientId = process.env.XERO_CLIENT_ID;
      if (!clientId) {
        return res.redirect("/finance?xero_error=" + encodeURIComponent("XERO_CLIENT_ID not set in environment"));
      }

      const state = crypto.randomBytes(32).toString("hex");
      req.session.xeroOAuthState = state;
      const redirectUri = getRedirectUri(req);
      console.log("[Xero] /connect — redirect_uri:", redirectUri);

      // Base scopes are all GA accounting scopes (verified against Xero's
      // official example app). Payroll scopes are opt-in via ?payroll=1 —
      // payroll API access is app/region-conditional and a rejected scope
      // 500s the WHOLE consent with invalid_scope, which held the Finance
      // reconnect hostage to a permission it doesn't even need.
      let scope = "openid profile email offline_access accounting.transactions accounting.contacts accounting.settings accounting.reports.read";
      if (req.query.payroll === "1") scope += " payroll.payslip payroll.employees";
      console.log("[Xero] /connect — scopes:", scope);
      const params = new URLSearchParams({
        response_type: "code",
        client_id: clientId,
        redirect_uri: redirectUri,
        scope,
        state,
      });

      const authorizeUrl = `${XERO_AUTH_URL}?${params.toString()}`;

      // Pre-flight the EXACT authorize URL server-side. Xero's error page
      // gives the browser nothing machine-readable, so we ask Xero
      // ourselves: a healthy request 302s into the login UI; a rejected
      // one 302s to /identity/error — in which case we fetch that page
      // and log the human-readable reason (Unknown client / Invalid
      // scope / Invalid redirect…). This puts the verdict in OUR logs.
      try {
        const probe = await fetch(authorizeUrl, { redirect: "manual" });
        const loc = probe.headers.get("location") || "";
        if (loc.includes("/identity/error")) {
          let reason = loc.slice(0, 140);
          try {
            const errPage = await fetch(new URL(loc, "https://login.xero.com").toString());
            const text = await errPage.text();
            const matches = text.match(/Invalid scope|Unknown client|Invalid redirect[^<]*|unauthorized_client|invalid_request[^<]*|Error:\s*[a-z_]+/gi);
            if (matches) reason = Array.from(new Set(matches)).join("; ");
          } catch {}
          console.error("[Xero] /connect PRE-FLIGHT REJECTED by Xero:", reason);
          // Don't send the user to Xero's dead-end page — bounce back to
          // Finance with the verdict and which client id the server holds,
          // so the failure explains itself without log digging. Client ids
          // are public (they ride in every authorize URL); the secret is
          // what stays private.
          const idHint = `${clientId.slice(0, 4)}…${clientId.slice(-4)}`;
          return res.redirect("/finance?xero_error=" + encodeURIComponent(
            `Xero rejected the consent request before login — ${reason}. ` +
            `The server is using client ID ${idHint}. If that doesn't match your 'Web app' in the Xero portal, ` +
            `update XERO_CLIENT_ID / XERO_CLIENT_SECRET in Railway. Note: 'Custom connection' apps can never do this consent — the app type must be 'Web app'.`,
          ));
        } else {
          console.log(`[Xero] /connect pre-flight OK — Xero accepted the request (status ${probe.status}, location ${loc.slice(0, 60) || "(login page)"})`);
        }
      } catch (pfErr: any) {
        console.warn("[Xero] /connect pre-flight skipped:", pfErr?.message);
      }

      req.session.save((err) => {
        if (err) console.error("[Xero] Session save error in /connect:", err);
        res.redirect(authorizeUrl);
      });
    } catch (e: any) {
      console.error("[Xero] /connect crashed:", e?.message, e?.stack);
      res.redirect("/finance?xero_error=" + encodeURIComponent(e?.message || "connect failed"));
    }
  });

  app.get("/api/xero/auth", requireAuth, async (req: Request, res: Response) => {
    let clientId = process.env.XERO_CLIENT_ID;
    if (!clientId) {
      return res.status(500).json({ message: "Xero Client ID not configured. Add XERO_CLIENT_ID and XERO_CLIENT_SECRET to your environment." });
    }

    const state = crypto.randomBytes(32).toString("hex");
    req.session.xeroOAuthState = state;

    const redirectUri = getRedirectUri(req);
    console.log("[Xero] Auth redirect_uri:", redirectUri, "client_id:", clientId);

    const params = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: req.query.payroll === "1"
        ? "openid profile email offline_access accounting.transactions accounting.contacts accounting.settings accounting.reports.read payroll.payslip payroll.employees"
        : "openid profile email offline_access accounting.transactions accounting.contacts accounting.settings accounting.reports.read",
      state,
    });

    req.session.save((err) => {
      if (err) console.error("[Xero] Session save error:", err);
      res.json({ url: `${XERO_AUTH_URL}?${params.toString()}` });
    });
  });

  app.get("/api/xero/callback", async (req: Request, res: Response) => {
    const { code, state, error, error_description } = req.query;
    // Forensics for empty-callback hits: which query KEYS arrived (values
    // redacted), where the browser came from, and whether a session with a
    // pending OAuth state exists. A bare hit with referer=xero means Xero
    // dropped the params; referer=our-own-app means something client-side
    // re-navigated to the callback URL without them.
    console.log(
      "[Xero] Callback received — code:", !!code,
      "error:", error || "none",
      "error_description:", error_description || "none",
      "| queryKeys:", Object.keys(req.query).join(",") || "(none)",
      "| referer:", String(req.headers.referer || "(none)").slice(0, 80),
      "| hasSession:", !!req.session?.userId,
      "| pendingState:", !!req.session?.xeroOAuthState,
      "| ua:", String(req.headers["user-agent"] || "").slice(0, 60),
    );

    if (error) {
      console.error("[Xero] Authorization error:", error, error_description);
      const errMsg = error_description ? `${error}: ${error_description}` : String(error);
      return res.redirect(`/finance?xero_error=${encodeURIComponent(errMsg)}`);
    }

    if (!code) {
      return res.redirect("/finance?xero_error=no_code_received");
    }

    if (!state || state !== req.session.xeroOAuthState) {
      console.error("[Xero] State mismatch — expected:", req.session.xeroOAuthState?.substring(0, 8), "got:", String(state).substring(0, 8));
      return res.redirect("/finance?xero_error=invalid_state");
    }

    const clientId = process.env.XERO_CLIENT_ID;
    const clientSecret = process.env.XERO_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      return res.redirect("/finance?xero_error=missing_config");
    }

    try {
      const redirectUri = getRedirectUri(req);

      const tokenRes = await fetch(XERO_TOKEN_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code: code as string,
          redirect_uri: redirectUri,
        }),
      });

      if (!tokenRes.ok) {
        const errText = await tokenRes.text();
        console.error("[Xero] Token exchange failed:", errText);
        return res.redirect("/finance?xero_error=token_failed");
      }

      const data = await tokenRes.json();

      req.session.xeroTokens = {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt: Date.now() + (data.expires_in || 1800) * 1000,
      };

      const connRes = await fetch(XERO_CONNECTIONS_URL, {
        headers: {
          Authorization: `Bearer ${data.access_token}`,
          "Content-Type": "application/json",
        },
      });

      if (connRes.ok) {
        const connections = await connRes.json();
        console.log("[Xero] Callback connections found:", connections.length);
        if (connections.length > 0) {
          req.session.xeroTokens.tenantId = connections[0].tenantId;
          console.log("[Xero] Connected to tenant:", connections[0].tenantName, "id:", connections[0].tenantId);
        } else {
          console.error("[Xero] No tenants returned from connections endpoint");
        }
      } else {
        console.error("[Xero] Connections request failed in callback:", connRes.status);
      }

      delete req.session.xeroOAuthState;

      // Capture system-wide Xero session so background jobs (Stripe webhooks,
      // expense auto-post) can call Xero without an HTTP request context.
      try {
        const { captureSystemXeroSession } = await import("./xero-system-session");
        await captureSystemXeroSession(req.session);
      } catch (sysErr: any) {
        console.warn("[Xero] System session capture failed:", sysErr?.message);
      }

      req.session.save((saveErr) => {
        if (saveErr) console.error("[Xero] Session save error after callback:", saveErr);
        if (!req.session.xeroTokens?.tenantId) {
          res.redirect("/finance?xero_error=no_tenant");
        } else {
          res.redirect("/finance?xero=connected");
        }
      });
    } catch (err: any) {
      console.error("[Xero] OAuth callback error:", err);
      res.redirect("/finance?xero_error=callback_failed");
    }
  });

  app.post("/api/xero/disconnect", requireAuth, async (req: Request, res: Response) => {
    req.session.xeroTokens = undefined;
    res.json({ success: true });
  });

  app.post("/api/xero/initialise-chart", requireAuth, async (req: Request, res: Response) => {
    try {
      const { initialiseXeroChart } = await import("./xero-chart-setup");
      const result = await initialiseXeroChart(req.session);
      res.json({ success: true, ...result });
    } catch (e: any) {
      console.error("[xero-chart] init failed:", e);
      res.status(500).json({ success: false, error: e?.message || String(e) });
    }
  });

  // Returns Xero contacts with their account number and primary billing
  // address flattened to a stable shape, so the client billing-entity
  // picker can render account number + address without extra calls.
  app.get("/api/xero/contacts", requireAuth, async (req: Request, res: Response) => {
    try {
      const rawSearch = ((req.query.search as string) || "").trim();
      // Strip Xero-filter-incompatible chars, drop multi-token whitespace,
      // and lowercase both the term + the field. Xero's where-clause is a
      // .NET expression so Name.ToLower().Contains("landsec") matches
      // "Landsec", "LANDSEC", "LandSec" — fixes the case-sensitive miss
      // ("Land Sec" not matching "Landsec" was the original complaint).
      const search = rawSearch.replace(/"/g, "").toLowerCase();
      let path = "/Contacts?page=1&pageSize=100&includeArchived=false";
      if (search) {
        // Multi-token: split on whitespace, require each token to be a
        // substring of the lower-cased name. "land sec" matches "Landsec",
        // "London Land Securities Plc", etc. Tokens AND'd together via
        // chained Contains() — keeps the matching tight without exploding
        // into typo-tolerance territory.
        const tokens = search.split(/\s+/).filter(t => t.length > 0);
        const conds = tokens.map(t => `Name.ToLower().Contains("${t}")`);
        path += `&where=${encodeURIComponent(conds.join(" AND "))}`;
      }
      // Read-only endpoint — falls back to the firm-wide system Xero
      // session when the caller's session isn't connected. Means agents
      // can pick a billing entity without each having to OAuth-connect
      // their own Xero. Write endpoints stay session-scoped for proper
      // attribution.
      const data = await xeroApiWithFallback(req.session, path);
      const contacts = (data.Contacts || []).map((c: any) => ({
        ContactID: c.ContactID,
        Name: c.Name,
        AccountNumber: c.AccountNumber || null,
        EmailAddress: c.EmailAddress || null,
        BillingAddress: pickBillingAddress(c.Addresses),
        Addresses: c.Addresses || [],
      }));
      res.json(contacts);
    } catch (err: any) {
      if (err.message.includes("Not connected")) {
        return res.status(401).json({ message: "Xero isn't connected. An admin needs to connect Xero in Settings before billing entities will show here." });
      }
      console.error("[Xero] Contacts error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // Fetch a single Xero contact by ID — used to refresh the cached
  // account number / billing address stored on a deal.
  app.get("/api/xero/contacts/:contactId", requireAuth, async (req: Request, res: Response) => {
    try {
      const data = await xeroApiWithFallback(req.session, `/Contacts/${req.params.contactId}`);
      const c = data.Contacts?.[0];
      if (!c) return res.status(404).json({ message: "Contact not found" });
      res.json({
        ContactID: c.ContactID,
        Name: c.Name,
        AccountNumber: c.AccountNumber || null,
        EmailAddress: c.EmailAddress || null,
        BillingAddress: pickBillingAddress(c.Addresses),
        Addresses: c.Addresses || [],
      });
    } catch (err: any) {
      if (err.message.includes("Not connected")) {
        return res.status(401).json({ message: "Not connected to Xero" });
      }
      console.error("[Xero] Contact fetch error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/xero/accounts", requireAuth, async (req: Request, res: Response) => {
    try {
      const data = await xeroApi(req.session, '/Accounts?where=Type=="REVENUE"');
      res.json(data.Accounts || []);
    } catch (err: any) {
      if (err.message.includes("Not connected")) {
        return res.status(401).json({ message: "Not connected to Xero" });
      }
      console.error("[Xero] Accounts error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/xero/invoices", requireAuth, async (req: Request, res: Response) => {
    try {
      const parsed = createInvoiceSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid request", errors: parsed.error.flatten().fieldErrors });
      }
      const { dealId, xeroContactId: bodyContactId, contactName, contactEmail, poNumber, lineItems, reference, dueDate, accountCode } = parsed.data;

      const [deal] = await db.select().from(crmDeals).where(eq(crmDeals.id, dealId));
      if (!deal) return res.status(404).json({ message: "Deal not found" });

      // KYC approval is not a hard pre-condition for drafting an invoice —
      // surveyors need to be able to draft early. AML status is still
      // tracked on the deal and visible on the KYC board for follow-up.
      //
      // Xero contact is the source of truth for billing. Resolve in order:
      // request body → deal.xeroContactId → name lookup → create new.
      let xeroContactId: string | undefined = bodyContactId || deal.xeroContactId || undefined;
      let resolvedContactName: string | undefined = contactName || deal.xeroContactName || deal.name || undefined;

      if (!xeroContactId && resolvedContactName) {
        const searchRes = await xeroApi(req.session, `/Contacts?where=Name=="${resolvedContactName.replace(/"/g, "")}"`);
        if (searchRes.Contacts?.length > 0) {
          xeroContactId = searchRes.Contacts[0].ContactID;
          resolvedContactName = searchRes.Contacts[0].Name || resolvedContactName;
        } else {
          const createContactRes = await xeroApi(req.session, "/Contacts", {
            method: "POST",
            body: JSON.stringify({
              Contacts: [{
                Name: resolvedContactName,
                EmailAddress: contactEmail || undefined,
              }],
            }),
          });
          xeroContactId = createContactRes.Contacts?.[0]?.ContactID;
        }
      }

      const invoiceLines = lineItems?.length > 0 ? lineItems : [{
        Description: deal.name || "Professional fees",
        Quantity: 1,
        UnitAmount: deal.fee || 0,
        AccountCode: accountCode || "200",
        TaxType: "OUTPUT2",
      }];

      const resolvedPoNumber = poNumber || deal.poNumber || null;
      if (resolvedPoNumber && !deal.poNumber) {
        await db.update(crmDeals).set({ poNumber: resolvedPoNumber, updatedAt: new Date() }).where(eq(crmDeals.id, dealId));
      }

      const xeroInvoiceObj: Record<string, any> = {
        Type: "ACCREC",
        Contact: { ContactID: xeroContactId },
        LineItems: invoiceLines,
        Date: new Date().toISOString().split("T")[0],
        DueDate: dueDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
        Reference: reference || deal.name,
        Status: "DRAFT",
        CurrencyCode: "GBP",
        LineAmountTypes: "Exclusive",
      };
      if (resolvedPoNumber) {
        xeroInvoiceObj.Reference = `${xeroInvoiceObj.Reference} | PO: ${resolvedPoNumber}`;
      }

      const invoicePayload = { Invoices: [xeroInvoiceObj] };

      const xeroRes = await xeroApi(req.session, "/Invoices", {
        method: "POST",
        body: JSON.stringify(invoicePayload),
      });

      const xeroInvoice = xeroRes.Invoices?.[0];

      const firstLine = xeroInvoice?.LineItems?.[0];
      const [record] = await db.insert(xeroInvoices).values({
        dealId,
        xeroInvoiceId: xeroInvoice?.InvoiceID,
        xeroContactId: xeroContactId || null,
        invoicingEntityId: null,
        invoicingEntityName: resolvedContactName || null,
        invoiceNumber: xeroInvoice?.InvoiceNumber,
        reference: reference || deal.name,
        status: xeroInvoice?.Status || "DRAFT",
        totalAmount: xeroInvoice?.Total || deal.fee || 0,
        currency: "GBP",
        dueDate: dueDate || null,
        sentToXero: true,
        xeroUrl: xeroInvoice?.InvoiceID ? `https://go.xero.com/AccountsReceivable/View.aspx?InvoiceID=${xeroInvoice.InvoiceID}` : null,
        // Cache so the edit form can pre-fill without an extra round-trip.
        contactName: xeroInvoice?.Contact?.Name ?? resolvedContactName ?? null,
        lineDescription: firstLine?.Description ?? lineItems?.[0]?.Description ?? null,
        lineAmount: firstLine?.LineAmount ?? lineItems?.[0]?.UnitAmount ?? null,
        poNumber: poNumber || null,
        syncedAt: new Date(),
      } as any).returning();

      res.json({
        success: true,
        invoice: record,
        xeroInvoice,
      });
    } catch (err: any) {
      if (err.message.includes("Not connected")) {
        return res.status(401).json({ message: "Not connected to Xero" });
      }
      console.error("[Xero] Create invoice error:", err);

      if (req.body.dealId) {
        await db.insert(xeroInvoices).values({
          dealId: req.body.dealId,
          status: "ERROR",
          errorMessage: err.message,
          sentToXero: false,
        }).catch(() => {});
      }

      const safeMessage = err.message.includes("Xero API error") ? "Failed to create invoice in Xero. Please check your Xero connection and try again." : err.message;
      res.status(500).json({ message: safeMessage });
    }
  });

  app.get("/api/xero/invoices/:dealId", requireAuth, async (req: Request, res: Response) => {
    try {
      const invoices = await db
        .select()
        .from(xeroInvoices)
        .where(eq(xeroInvoices.dealId, req.params.dealId))
        .orderBy(desc(xeroInvoices.createdAt));
      res.json(invoices);
    } catch (err: any) {
      console.error("[Xero] Fetch invoices error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/xero/invoices/:id/sync", requireAuth, async (req: Request, res: Response) => {
    try {
      const [invoice] = await db
        .select()
        .from(xeroInvoices)
        .where(eq(xeroInvoices.id, req.params.id));

      if (!invoice) return res.status(404).json({ message: "Invoice record not found" });
      if (!invoice.xeroInvoiceId) return res.status(400).json({ message: "No Xero invoice ID to sync" });

      const xeroRes = await xeroApi(req.session, `/Invoices/${invoice.xeroInvoiceId}`);
      const xeroInvoice = xeroRes.Invoices?.[0];

      if (xeroInvoice) {
        // Pull the full content so edits made directly in Xero round-trip back.
        const firstLine = xeroInvoice.LineItems?.[0];
        await db.update(xeroInvoices).set({
          status: xeroInvoice.Status,
          totalAmount: xeroInvoice.Total,
          invoiceNumber: xeroInvoice.InvoiceNumber,
          reference: xeroInvoice.Reference ?? invoice.reference,
          dueDate: xeroInvoice.DueDate ? String(xeroInvoice.DueDate).slice(0, 10) : invoice.dueDate,
          contactName: xeroInvoice.Contact?.Name ?? invoice.contactName,
          lineDescription: firstLine?.Description ?? invoice.lineDescription,
          lineAmount: firstLine?.LineAmount ?? invoice.lineAmount,
          syncedAt: new Date(),
          updatedAt: new Date(),
        } as any).where(eq(xeroInvoices.id, req.params.id));

        if (invoice.dealId) {
          await autoPromoteDealToInvoiced(invoice.dealId, xeroInvoice.Status);
        }
      }

      res.json({ success: true, status: xeroInvoice?.Status });
    } catch (err: any) {
      console.error("[Xero] Sync invoice error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // Edit an existing draft and push the changes back to Xero. Only DRAFT
  // (or SUBMITTED) invoices are editable per Xero's rules — AUTHORISED+
  // invoices are locked once issued.
  app.put("/api/xero/invoices/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const [invoice] = await db.select().from(xeroInvoices).where(eq(xeroInvoices.id, req.params.id));
      if (!invoice) return res.status(404).json({ message: "Invoice record not found" });
      if (!invoice.xeroInvoiceId) return res.status(400).json({ message: "Invoice not yet sent to Xero" });
      if (invoice.status && !["DRAFT", "SUBMITTED"].includes(invoice.status)) {
        return res.status(409).json({ message: `Invoice is ${invoice.status} in Xero — only drafts can be edited` });
      }

      const { description, body, amount, reference, dueDate, contactName, poNumber } = req.body || {};
      const headline = (description || "").trim() || "Professional fees";
      const lineDescription = (body || "").trim() ? `${headline}\n\n${(body || "").trim()}` : headline;
      const lineAmount = typeof amount === "number" ? amount : (invoice.lineAmount ?? invoice.totalAmount ?? 0);

      const payload: any = {
        InvoiceID: invoice.xeroInvoiceId,
        Type: "ACCREC",
        LineAmountTypes: "Exclusive",
        LineItems: [{
          Description: lineDescription,
          Quantity: 1,
          UnitAmount: lineAmount,
          AccountCode: "200",
          TaxType: "OUTPUT2",
        }],
      };
      if (reference !== undefined) payload.Reference = reference;
      if (dueDate) payload.DueDate = dueDate;
      if (poNumber !== undefined) payload.PONumber = poNumber;
      if (contactName) payload.Contact = { Name: contactName };

      // Xero accepts updates by POSTing to /Invoices with the InvoiceID set.
      const xeroRes = await xeroApi(req.session, "/Invoices", {
        method: "POST",
        body: JSON.stringify({ Invoices: [payload] }),
      });
      const updated = xeroRes.Invoices?.[0];
      if (!updated) return res.status(502).json({ message: "Xero didn't return an updated invoice" });

      const firstLine = updated.LineItems?.[0];
      await db.update(xeroInvoices).set({
        status: updated.Status,
        totalAmount: updated.Total,
        invoiceNumber: updated.InvoiceNumber,
        reference: updated.Reference ?? reference ?? invoice.reference,
        dueDate: updated.DueDate ? String(updated.DueDate).slice(0, 10) : (dueDate || invoice.dueDate),
        contactName: updated.Contact?.Name ?? contactName ?? invoice.contactName,
        lineDescription: firstLine?.Description ?? lineDescription,
        lineAmount: firstLine?.LineAmount ?? lineAmount,
        poNumber: poNumber ?? invoice.poNumber,
        syncedAt: new Date(),
        updatedAt: new Date(),
      } as any).where(eq(xeroInvoices.id, req.params.id));

      res.json({ success: true, status: updated.Status });
    } catch (err: any) {
      console.error("[Xero] Edit invoice error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/xero/invoices/sync-all", requireAuth, async (req: Request, res: Response) => {
    try {
      const pendingInvoices = await db.select().from(xeroInvoices)
        .where(eq(xeroInvoices.sentToXero, true));

      const toSync = pendingInvoices.filter(inv =>
        inv.xeroInvoiceId && inv.status !== "PAID" && inv.status !== "VOIDED"
      );

      let synced = 0;
      let promoted = 0;
      const errors: string[] = [];

      for (const inv of toSync) {
        try {
          const xeroRes = await xeroApi(req.session, `/Invoices/${inv.xeroInvoiceId}`);
          const xeroInvoice = xeroRes.Invoices?.[0];
          if (!xeroInvoice) continue;

          const oldStatus = inv.status;
          await db.update(xeroInvoices).set({
            status: xeroInvoice.Status,
            totalAmount: xeroInvoice.Total,
            invoiceNumber: xeroInvoice.InvoiceNumber,
            syncedAt: new Date(),
            updatedAt: new Date(),
          }).where(eq(xeroInvoices.id, inv.id));
          synced++;

          if (inv.dealId) {
            const didPromote = await autoPromoteDealToInvoiced(inv.dealId, xeroInvoice.Status);
            if (didPromote) promoted++;
          }
        } catch (err: any) {
          errors.push(`Invoice ${inv.invoiceNumber || inv.id}: ${err.message}`);
        }
      }

      res.json({ success: true, synced, promoted, total: toSync.length, errors });
    } catch (err: any) {
      console.error("[Xero] Sync-all error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/xero/invoices/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      await db.delete(xeroInvoices).where(eq(xeroInvoices.id, req.params.id));
      res.json({ success: true });
    } catch (err: any) {
      console.error("[Xero] Delete invoice error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/xero/organisation", requireAuth, async (req: Request, res: Response) => {
    try {
      const data = await xeroApi(req.session, "/Organisation");
      res.json(data.Organisations?.[0] || null);
    } catch (err: any) {
      if (err.message.includes("Not connected")) {
        return res.status(401).json({ message: "Not connected to Xero" });
      }
      console.error("[Xero] Organisation error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // Xero webhook receiver — invoked by Xero when configured events fire
  // (Invoice.* / Contact.* / etc. depending on what's subscribed in the
  // developer portal). This endpoint is PUBLIC (no requireAuth) because
  // Xero servers call it directly. Auth happens via HMAC-SHA256 signature
  // on the request body using XERO_WEBHOOK_KEY.
  //
  // Two phases:
  //   1. "Intent to receive" — when you save the webhook config in the
  //      developer portal, Xero sends a POST with empty body + signature.
  //      We must respond 200 within 5s if the signature matches, 401 if
  //      not. Until that handshake passes, the portal won't let you save.
  //   2. Real events — POST with JSON body
  //      `{ events: [{ resourceUrl, resourceId, eventType, eventCategory,
  //         tenantId, eventDateUtc, ... }], firstEventSequence,
  //         lastEventSequence }`. We acknowledge fast (200 immediately)
  //      then process asynchronously per Xero's guidance — Xero retries on
  //      timeout and we don't want duplicate writes.
  //
  // The endpoint is registered with `express.raw()` middleware in
  // index.ts so we can compute the signature over the EXACT bytes Xero
  // sent — express.json() would normalise whitespace and break HMAC.
  app.post(
    "/api/xero/webhook",
    async (req: Request, res: Response) => {
      const signingKey = process.env.XERO_WEBHOOK_KEY;
      if (!signingKey) {
        console.warn("[xero-webhook] XERO_WEBHOOK_KEY not configured — rejecting");
        return res.status(401).end();
      }

      const sigHeader = (req.headers["x-xero-signature"] as string) || "";
      // index.ts mounts express.json with a `verify` callback that stashes
      // the raw bytes on req.rawBody — that's what we HMAC. Falling back
      // to a stringified body would re-serialise (different whitespace)
      // and the signature would never match.
      const rawBody = (req as any).rawBody as Buffer | undefined;
      const bodyBuf: Buffer = Buffer.isBuffer(rawBody)
        ? rawBody
        : (typeof req.body === "string"
            ? Buffer.from(req.body, "utf-8")
            : (req.body ? Buffer.from(JSON.stringify(req.body), "utf-8") : Buffer.from("", "utf-8")));

      const expected = crypto.createHmac("sha256", signingKey).update(bodyBuf).digest("base64");

      // Constant-time compare — short-circuit length differences first
      // since timingSafeEqual throws on mismatched lengths.
      const sigOk =
        expected.length === sigHeader.length &&
        crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sigHeader));
      if (!sigOk) {
        console.warn(`[xero-webhook] signature mismatch (got ${sigHeader.slice(0, 12)}…, expected ${expected.slice(0, 12)}…)`);
        return res.status(401).end();
      }

      // Acknowledge immediately — Xero requires <5s and retries on timeout.
      // Process events after responding so the work doesn't block the ACK.
      res.status(200).end();

      let payload: any = null;
      try {
        payload = bodyBuf.length > 0 ? JSON.parse(bodyBuf.toString("utf-8")) : null;
      } catch (err: any) {
        console.warn("[xero-webhook] body JSON parse failed:", err?.message);
        return;
      }

      const events: any[] = Array.isArray(payload?.events) ? payload.events : [];
      if (events.length === 0) {
        // Intent-to-receive handshake (empty body) or empty event batch.
        console.log(`[xero-webhook] handshake / empty batch acknowledged`);
        return;
      }

      console.log(`[xero-webhook] received ${events.length} event(s): ${events.map(e => `${e.eventCategory}.${e.eventType}`).join(", ")}`);

      for (const evt of events) {
        try {
          await processXeroWebhookEvent(evt);
        } catch (err: any) {
          console.error(`[xero-webhook] event processing failed for ${evt.eventCategory}.${evt.eventType} ${evt.resourceId}:`, err?.message);
        }
      }
    }
  );
}

/**
 * Handle one event from a Xero webhook. We currently care about Invoice
 * status flips (PAID, VOIDED, DELETED) and Contact updates so the local
 * crm_companies/xero_invoices rows track what's in Xero without a manual
 * sync. Other event types are logged and ignored — easy to extend later.
 *
 * Tenant context is on the event (`evt.tenantId`) but the existing
 * xeroApi() helper reads its token from a session, not a tenantId. For
 * now we update purely from the event payload (status + resourceId);
 * if we need to fetch the full invoice/contact body, we'd refresh
 * via stored tenant tokens (TODO once multi-tenant matters).
 */
async function processXeroWebhookEvent(evt: any): Promise<void> {
  const category = String(evt?.eventCategory || "").toUpperCase();
  const type = String(evt?.eventType || "").toUpperCase();
  const resourceId = String(evt?.resourceId || "");
  if (!resourceId) return;

  if (category === "INVOICE") {
    // We don't get the invoice status in the event itself — just that
    // *something* changed. Mark our local row as needing a refresh; the
    // sync-all path can pick it up, OR we can lazily fetch on the next
    // request that touches this invoice. For now: log so we can see the
    // signal landing and add fetching once we've validated the auth flow
    // in production with a real test invoice.
    const [row] = await db
      .select()
      .from(xeroInvoices)
      .where(eq(xeroInvoices.xeroInvoiceId, resourceId))
      .limit(1);
    if (row) {
      console.log(`[xero-webhook] invoice ${type} for known invoice ${resourceId} (deal ${row.dealId}) — flagged for sync`);
      // Touch updatedAt so downstream queries see staleness.
      await db
        .update(xeroInvoices)
        .set({ updatedAt: new Date() })
        .where(eq(xeroInvoices.id, row.id));
    } else {
      console.log(`[xero-webhook] invoice ${type} for unknown ${resourceId} — ignored`);
    }
    return;
  }

  if (category === "CONTACT") {
    console.log(`[xero-webhook] contact ${type} for ${resourceId} — no-op until contact sync ships`);
    return;
  }

  console.log(`[xero-webhook] unhandled event ${category}.${type} for ${resourceId}`);
}
