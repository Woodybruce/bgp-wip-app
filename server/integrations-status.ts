import type { Express, Request, Response } from "express";
import { requireAuth } from "./auth";
import { pool } from "./db";

async function requireAdmin(req: Request, res: Response, next: Function) {
  const userId = (req.session as any)?.userId || (req as any).tokenUserId;
  if (!userId) return res.status(401).json({ error: "Not authenticated" });
  const result = await pool.query("SELECT is_admin FROM users WHERE id = $1", [userId]);
  if (!result.rows[0]?.is_admin) return res.status(403).json({ error: "Admin access required" });
  next();
}

type KeyDef = {
  name: string;
  label: string;
  group: string;
  fallbacks?: string[];
};

// Every env var the server actually reads for an external integration.
// Fallbacks mirror the resolution chain used in the code (e.g. GEMINI).
const KEYS: KeyDef[] = [
  // AI
  { name: "ANTHROPIC_API_KEY", label: "Anthropic (ChatBGP)", group: "AI" },
  { name: "OPENAI_API_KEY", label: "OpenAI / DALL-E", group: "AI" },
  {
    name: "GEMINI_API_KEY",
    label: "Google Gemini",
    group: "AI",
    fallbacks: ["AI_INTEGRATIONS_GEMINI_API_KEY", "GOOGLE_AI_API_KEY", "GOOGLE_API_KEY"],
  },

  // Google
  { name: "GOOGLE_API_KEY", label: "Google Maps / Places / Street View", group: "Google" },

  // Stock imagery
  { name: "PEXELS_API_KEY", label: "Pexels", group: "Images" },
  { name: "PIXABAY_API_KEY", label: "Pixabay", group: "Images" },

  // CRM enrichment
  { name: "APOLLO_API_KEY", label: "Apollo.io", group: "CRM" },
  { name: "COMPANIES_HOUSE_API_KEY", label: "Companies House", group: "CRM" },

  // Accounting
  { name: "XERO_CLIENT_ID", label: "Xero Client ID", group: "Accounting" },
  { name: "XERO_CLIENT_SECRET", label: "Xero Client Secret", group: "Accounting" },

  // Microsoft / Office add-in
  { name: "AZURE_CLIENT_ID", label: "Azure Client ID", group: "Microsoft" },
  { name: "AZURE_SECRET_V2", label: "Azure Client Secret", group: "Microsoft" },
  { name: "AZURE_TENANT_ID", label: "Azure Tenant ID", group: "Microsoft" },

  // Comms / collab
  { name: "MONDAY_API_TOKEN", label: "Monday.com", group: "Comms" },
  { name: "AGENTMAIL_API_KEY", label: "AgentMail", group: "Comms" },

  // Payments
  { name: "STRIPE_SECRET_KEY", label: "Stripe", group: "Payments" },

  // Storage
  { name: "DROPBOX_APP_KEY", label: "Dropbox App Key", group: "Storage" },
  { name: "DROPBOX_APP_SECRET", label: "Dropbox App Secret", group: "Storage" },

  // Push
  { name: "VAPID_PUBLIC_KEY", label: "Web Push VAPID public", group: "Push" },
  { name: "VAPID_PRIVATE_KEY", label: "Web Push VAPID private", group: "Push" },

  // Core
  { name: "DATABASE_URL", label: "Postgres", group: "Core" },
  { name: "SESSION_SECRET", label: "Session secret", group: "Core" },
];

function mask(value: string): string {
  if (!value) return "";
  if (value.length <= 8) return "•".repeat(value.length);
  return `${value.slice(0, 4)}…${value.slice(-4)} (${value.length} chars)`;
}

function resolveKey(def: KeyDef): { configured: boolean; source: string | null; masked: string | null } {
  const candidates = [def.name, ...(def.fallbacks ?? [])];
  for (const n of candidates) {
    const v = process.env[n];
    if (v && v.trim().length > 0) {
      return { configured: true, source: n, masked: mask(v) };
    }
  }
  return { configured: false, source: null, masked: null };
}

type PingResult = { ok: boolean; status?: number; message: string };

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return await Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)),
  ]);
}

async function pingApollo(): Promise<PingResult> {
  const key = process.env.APOLLO_API_KEY;
  if (!key) return { ok: false, message: "APOLLO_API_KEY not set" };
  try {
    // /people/match with an obviously-empty query: authed requests return 200
    // with an empty person; unauth returns 401. This does not consume credits
    // when no match is found.
    const res = await withTimeout(
      fetch("https://api.apollo.io/api/v1/people/match", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Api-Key": key },
        body: JSON.stringify({ reveal_personal_emails: false }),
      }),
      8000,
    );
    if (res.status === 401 || res.status === 403) {
      return { ok: false, status: res.status, message: "Apollo rejected the key (401/403)" };
    }
    return { ok: true, status: res.status, message: "Apollo reachable and key accepted" };
  } catch (err: any) {
    return { ok: false, message: `Apollo ping failed: ${err?.message || "unknown error"}` };
  }
}

async function pingCompaniesHouse(): Promise<PingResult> {
  const key = process.env.COMPANIES_HOUSE_API_KEY;
  if (!key) return { ok: false, message: "COMPANIES_HOUSE_API_KEY not set" };
  try {
    const auth = Buffer.from(`${key}:`).toString("base64");
    // Company 00000006 is "MARINE AND GENERAL MUTUAL LIFE ASSURANCE SOCIETY",
    // a long-defunct historic record that's guaranteed to exist.
    const res = await withTimeout(
      fetch("https://api.company-information.service.gov.uk/company/00000006", {
        headers: { Authorization: `Basic ${auth}` },
      }),
      8000,
    );
    if (res.status === 401 || res.status === 403) {
      return { ok: false, status: res.status, message: "Companies House rejected the key (401/403)" };
    }
    if (res.status === 429) {
      return { ok: false, status: 429, message: "Companies House rate-limit hit" };
    }
    if (!res.ok) {
      return { ok: false, status: res.status, message: `Companies House returned ${res.status}` };
    }
    return { ok: true, status: res.status, message: "Companies House reachable and key accepted" };
  } catch (err: any) {
    return { ok: false, message: `Companies House ping failed: ${err?.message || "unknown error"}` };
  }
}

async function pingXero(req: Request): Promise<PingResult> {
  const clientId = process.env.XERO_CLIENT_ID;
  const clientSecret = process.env.XERO_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return { ok: false, message: "XERO_CLIENT_ID / XERO_CLIENT_SECRET not set" };
  }
  // Xero uses the OAuth2 authorisation-code flow — the client creds alone
  // can't be used to call the API. Check that a user session has tokens and,
  // if it does, hit /connections to verify they're live.
  const session = req.session as any;
  const tokens = session?.xeroTokens;
  if (!tokens?.accessToken) {
    return {
      ok: false,
      message: "Client credentials set. No Xero session yet — connect via Admin → Xero to test end-to-end.",
    };
  }
  try {
    const res = await withTimeout(
      fetch("https://api.xero.com/connections", {
        headers: { Authorization: `Bearer ${tokens.accessToken}`, Accept: "application/json" },
      }),
      8000,
    );
    if (res.status === 401) {
      return { ok: false, status: 401, message: "Xero token expired or revoked — reconnect required" };
    }
    if (!res.ok) {
      return { ok: false, status: res.status, message: `Xero returned ${res.status}` };
    }
    const json = (await res.json()) as Array<{ tenantName?: string }>;
    const tenant = Array.isArray(json) && json[0]?.tenantName ? ` (${json[0].tenantName})` : "";
    return { ok: true, status: res.status, message: `Xero connected${tenant}` };
  } catch (err: any) {
    return { ok: false, message: `Xero ping failed: ${err?.message || "unknown error"}` };
  }
}

export function registerIntegrationsStatusRoutes(app: Express) {
  app.get("/api/integrations/status", requireAuth, requireAdmin, async (_req: Request, res: Response) => {
    const items = KEYS.map((def) => {
      const { configured, source, masked } = resolveKey(def);
      return {
        key: def.name,
        label: def.label,
        group: def.group,
        configured,
        resolvedFrom: source,
        masked,
        fallbacks: def.fallbacks ?? [],
      };
    });

    const grouped: Record<string, typeof items> = {};
    for (const it of items) {
      (grouped[it.group] ??= []).push(it);
    }

    const total = items.length;
    const configured = items.filter((i) => i.configured).length;

    res.json({
      total,
      configured,
      missing: total - configured,
      items,
      grouped,
    });
  });

  // Live connectivity checks — actually hit each upstream API.
  app.get("/api/integrations/ping", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    const [apollo, companiesHouse, xero] = await Promise.all([
      pingApollo(),
      pingCompaniesHouse(),
      pingXero(req),
    ]);
    res.json({ apollo, companiesHouse, xero });
  });
}
