import type { Express, Request, Response } from "express";
import { requireAuth } from "./auth";
import { db } from "./db";
import { xeroInvoices, crmDeals, crmCompanies } from "@shared/schema";
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
  contactName: z.string().optional(),
  contactEmail: z.string().email().optional().or(z.literal("")),
  invoicingEntityId: z.string().nullable().optional(),
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

export async function refreshXeroToken(session: any): Promise<string | null> {
  if (!session.xeroTokens) return null;

  if (Date.now() < session.xeroTokens.expiresAt - 60000) {
    return session.xeroTokens.accessToken;
  }

  const clientId = process.env.XERO_CLIENT_ID;
  const clientSecret = process.env.XERO_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  try {
    const res = await fetch(XERO_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: session.xeroTokens.refreshToken,
      }),
    });

    if (!res.ok) {
      console.error("[Xero] Token refresh failed:", await res.text());
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
      scope: "openid profile email offline_access accounting.invoices accounting.contacts accounting.settings",
      state,
    });

    req.session.save((err) => {
      if (err) console.error("[Xero] Session save error:", err);
      res.json({ url: `${XERO_AUTH_URL}?${params.toString()}` });
    });
  });

  app.get("/api/xero/callback", async (req: Request, res: Response) => {
    const { code, state, error, error_description } = req.query;
    console.log("[Xero] Callback received — code:", !!code, "error:", error || "none", "error_description:", error_description || "none");

    if (error) {
      console.error("[Xero] Authorization error:", error, error_description);
      const errMsg = error_description ? `${error}: ${error_description}` : String(error);
      return res.redirect(`/deals?xero_error=${encodeURIComponent(errMsg)}`);
    }

    if (!code) {
      return res.redirect("/deals?xero_error=no_code_received");
    }

    if (!state || state !== req.session.xeroOAuthState) {
      console.error("[Xero] State mismatch — expected:", req.session.xeroOAuthState?.substring(0, 8), "got:", String(state).substring(0, 8));
      return res.redirect("/deals?xero_error=invalid_state");
    }

    const clientId = process.env.XERO_CLIENT_ID;
    const clientSecret = process.env.XERO_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      return res.redirect("/deals?xero_error=missing_config");
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
        return res.redirect("/deals?xero_error=token_failed");
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
          res.redirect("/deals?xero_error=no_tenant");
        } else {
          res.redirect("/deals?xero=connected");
        }
      });
    } catch (err: any) {
      console.error("[Xero] OAuth callback error:", err);
      res.redirect("/deals?xero_error=callback_failed");
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

  app.get("/api/xero/contacts", requireAuth, async (req: Request, res: Response) => {
    try {
      const search = req.query.search as string;
      let path = "/Contacts?page=1&pageSize=50";
      if (search) {
        path += `&where=Name.Contains("${search.replace(/"/g, "")}")`;
      }
      const data = await xeroApi(req.session, path);
      res.json(data.Contacts || []);
    } catch (err: any) {
      if (err.message.includes("Not connected")) {
        return res.status(401).json({ message: "Not connected to Xero" });
      }
      console.error("[Xero] Contacts error:", err);
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
      const { dealId, contactName, contactEmail, invoicingEntityId, poNumber, lineItems, reference, dueDate, accountCode } = parsed.data;

      const [deal] = await db.select().from(crmDeals).where(eq(crmDeals.id, dealId));
      if (!deal) return res.status(404).json({ message: "Deal not found" });

      const KYC_GATE_DATE = new Date("2025-05-01");
      if (new Date() >= KYC_GATE_DATE && !deal.kycApproved) {
        return res.status(400).json({ message: "KYC must be approved before creating an invoice. Please approve KYC on the deal first." });
      }

      let invoicingEntityName: string | undefined;
      const entityId = invoicingEntityId !== undefined ? (invoicingEntityId || null) : (deal.invoicingEntityId || null);
      if (entityId) {
        const [entity] = await db.select().from(crmCompanies).where(eq(crmCompanies.id, entityId));
        if (entity) invoicingEntityName = entity.name || undefined;
      }

      const resolvedContactName = contactName || invoicingEntityName || deal.name;
      let xeroContactId: string | undefined;

      if (resolvedContactName) {
        const searchRes = await xeroApi(req.session, `/Contacts?where=Name=="${resolvedContactName.replace(/"/g, "")}"`);
        if (searchRes.Contacts?.length > 0) {
          xeroContactId = searchRes.Contacts[0].ContactID;
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

      const [record] = await db.insert(xeroInvoices).values({
        dealId,
        xeroInvoiceId: xeroInvoice?.InvoiceID,
        xeroContactId: xeroContactId || null,
        invoicingEntityId: entityId || null,
        invoicingEntityName: invoicingEntityName || resolvedContactName || null,
        invoiceNumber: xeroInvoice?.InvoiceNumber,
        reference: reference || deal.name,
        status: xeroInvoice?.Status || "DRAFT",
        totalAmount: xeroInvoice?.Total || deal.fee || 0,
        currency: "GBP",
        dueDate: dueDate || null,
        sentToXero: true,
        xeroUrl: xeroInvoice?.InvoiceID ? `https://go.xero.com/AccountsReceivable/View.aspx?InvoiceID=${xeroInvoice.InvoiceID}` : null,
        syncedAt: new Date(),
      }).returning();

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
        await db.update(xeroInvoices).set({
          status: xeroInvoice.Status,
          totalAmount: xeroInvoice.Total,
          invoiceNumber: xeroInvoice.InvoiceNumber,
          syncedAt: new Date(),
          updatedAt: new Date(),
        }).where(eq(xeroInvoices.id, req.params.id));

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
