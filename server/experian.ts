/**
 * Experian UK B2B API client — commercial credit + KYB.
 *
 * Experian's Developer Portal uses OAuth2 client-credentials. Tokens expire
 * in 1h; we cache one until ~2 min before expiry. Most UK B2B sandboxes
 * (Commercial Credit, KYB, Business Profile) sit on the same base host
 * and share the same token.
 *
 * Env vars (set in Railway):
 *   EXPERIAN_CLIENT_ID
 *   EXPERIAN_CLIENT_SECRET
 *   EXPERIAN_USERNAME        (some UK endpoints require basic-auth on top of OAuth)
 *   EXPERIAN_PASSWORD
 *   EXPERIAN_ENV             sandbox | production (default: sandbox)
 *
 * Used by kyc-orchestrator to populate crm_companies.experian_* fields
 * and auto-tick "financial_profile_obtained" on the AML checklist.
 */

const PROD_HOST = "https://uk-api.experian.com";
const SANDBOX_HOST = "https://sandbox-uk-api.experian.com";

function baseUrl(): string {
  return (process.env.EXPERIAN_ENV || "sandbox").toLowerCase() === "production" ? PROD_HOST : SANDBOX_HOST;
}

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getToken(): Promise<string> {
  const clientId = process.env.EXPERIAN_CLIENT_ID;
  const clientSecret = process.env.EXPERIAN_CLIENT_SECRET;
  const username = process.env.EXPERIAN_USERNAME;
  const password = process.env.EXPERIAN_PASSWORD;
  if (!clientId || !clientSecret) throw new Error("EXPERIAN_CLIENT_ID / EXPERIAN_CLIENT_SECRET not configured");

  if (cachedToken && Date.now() < cachedToken.expiresAt - 120_000) return cachedToken.token;

  const body = new URLSearchParams({
    grant_type: "password",
    client_id: clientId,
    client_secret: clientSecret,
    username: username || "",
    password: password || "",
  });

  const res = await fetch(`${baseUrl()}/oauth2/v1/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: body.toString(),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Experian token ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as { access_token: string; expires_in?: number };
  const ttlMs = (data.expires_in || 3600) * 1000;
  cachedToken = { token: data.access_token, expiresAt: Date.now() + ttlMs };
  return data.access_token;
}

export interface ExperianCreditReport {
  companyNumber: string;
  companyName: string;
  creditScore: number | null;      // 0-100 risk score
  creditLimit: number | null;       // recommended credit limit (£)
  creditBand: string | null;        // A / B / C / D or "Very Low Risk"...
  riskIndicator: string | null;     // "Low Risk" / "High Risk" etc
  ccj: number | null;               // count of County Court Judgements
  ccjTotalValue: number | null;     // £ total
  status: string | null;            // Active / Dissolved / Liquidation etc
  incorporationDate: string | null; // YYYY-MM-DD
  sic: string[] | null;
  employees: number | null;
  turnover: number | null;          // £
  rawResponse?: any;                // keep so we can debug / extract more fields
}

function first<T>(obj: any, ...paths: string[]): T | null {
  for (const p of paths) {
    const segs = p.split(".");
    let cur: any = obj;
    for (const s of segs) cur = cur?.[s];
    if (cur !== undefined && cur !== null && cur !== "") return cur as T;
  }
  return null;
}

function toNumber(v: any): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[£,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function normaliseReport(raw: any, companyNumber: string): ExperianCreditReport {
  // Experian's UK B2B response shapes vary by product (Commercial Credit vs
  // Business Profile). We probe the common paths.
  const root = raw?.results || raw?.result || raw?.data || raw;
  const biz = root?.businessInformation || root?.business || root;
  const score = root?.scoreInformation || root?.score || root?.creditScore;
  const risk = root?.riskDetails || root?.risk || {};
  const finance = root?.financialInformation || root?.financials || {};

  return {
    companyNumber,
    companyName: first<string>(biz, "name", "registeredName", "tradingName") || "",
    creditScore: toNumber(first(score, "score", "value", "commercialDelphiScore")),
    creditLimit: toNumber(first(score, "creditLimit", "recommendedCreditLimit")),
    creditBand: first<string>(score, "band", "creditBand", "riskClass"),
    riskIndicator: first<string>(risk, "indicator", "description", "level"),
    ccj: toNumber(first(root, "ccjInformation.totalCount", "ccj.count", "legalEvents.ccjCount")),
    ccjTotalValue: toNumber(first(root, "ccjInformation.totalValue", "ccj.totalValue")),
    status: first<string>(biz, "status", "companyStatus", "tradingStatus"),
    incorporationDate: first<string>(biz, "incorporationDate", "incorporated"),
    sic: (first<any[]>(biz, "sicCodes", "sic") || []).map((s: any) => typeof s === "string" ? s : s?.code).filter(Boolean),
    employees: toNumber(first(finance, "employees", "numberOfEmployees")),
    turnover: toNumber(first(finance, "turnover", "annualTurnover", "revenue")),
    rawResponse: raw,
  };
}

export function isExperianConfigured(): boolean {
  return !!(process.env.EXPERIAN_CLIENT_ID && process.env.EXPERIAN_CLIENT_SECRET);
}

export async function experianHealth(): Promise<{ ok: boolean; error?: string; env?: string }> {
  if (!isExperianConfigured()) return { ok: false, error: "EXPERIAN_CLIENT_ID / EXPERIAN_CLIENT_SECRET not set" };
  try {
    const token = await getToken();
    return { ok: !!token, env: (process.env.EXPERIAN_ENV || "sandbox") };
  } catch (err: any) {
    return { ok: false, error: err?.message || "unknown error" };
  }
}

// Fetch a commercial credit report by UK Companies House number.
// Returns null if the lookup 404s or the API isn't configured (non-fatal).
export async function fetchCommercialCredit(companyNumber: string): Promise<ExperianCreditReport | null> {
  if (!isExperianConfigured()) return null;
  const cleaned = (companyNumber || "").trim().toUpperCase();
  if (!cleaned) return null;

  try {
    const token = await getToken();
    const res = await fetch(`${baseUrl()}/business-information/businesses/uk/v1/credit-report`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        registrationNumber: cleaned,
        country: "GB",
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (res.status === 404) {
      console.log(`[experian] no credit report for ${cleaned}`);
      return null;
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.warn(`[experian] credit-report ${res.status} for ${cleaned}: ${text.slice(0, 200)}`);
      return null;
    }
    const raw = await res.json();
    return normaliseReport(raw, cleaned);
  } catch (err: any) {
    console.warn(`[experian] credit-report failed for ${cleaned}: ${err?.message}`);
    return null;
  }
}

// Debug helper — returns raw Experian response for a company number (sandbox testing only).
export async function debugExperianRaw(companyNumber: string): Promise<{ status: number; body: any }> {
  const token = await getToken();
  const cleaned = (companyNumber || "").trim().toUpperCase();
  const res = await fetch(`${baseUrl()}/business-information/businesses/uk/v1/credit-report`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ registrationNumber: cleaned, country: "GB" }),
    signal: AbortSignal.timeout(30_000),
  });
  const body = await res.json().catch(async () => ({ raw: await res.text().catch(() => "") }));
  return { status: res.status, body };
}

// KYB lookup — lighter-weight than full credit report, used for business
// identity verification (name / address / director match).
export async function kybLookup(companyNumber: string): Promise<{ verified: boolean; name?: string; status?: string; raw?: any } | null> {
  if (!isExperianConfigured()) return null;
  const cleaned = (companyNumber || "").trim().toUpperCase();
  if (!cleaned) return null;

  try {
    const token = await getToken();
    const res = await fetch(`${baseUrl()}/business-information/businesses/uk/v1/search`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        registrationNumber: cleaned,
        country: "GB",
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const raw = await res.json();
    const hit = raw?.results?.[0] || raw?.result || raw?.data?.[0] || raw;
    const name = hit?.businessInformation?.name || hit?.name;
    const status = hit?.businessInformation?.status || hit?.status;
    return { verified: !!name, name, status, raw };
  } catch (err: any) {
    console.warn(`[experian] kyb lookup failed for ${cleaned}: ${err?.message}`);
    return null;
  }
}
