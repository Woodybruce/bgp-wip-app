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

export function clearTokenCache(): void { cachedToken = null; }

async function getToken(): Promise<string> {
  const clientId = process.env.EXPERIAN_CLIENT_ID;
  const clientSecret = process.env.EXPERIAN_CLIENT_SECRET;
  const username = process.env.EXPERIAN_USERNAME;
  const password = process.env.EXPERIAN_PASSWORD;
  if (!clientId || !clientSecret) throw new Error("EXPERIAN_CLIENT_ID / EXPERIAN_CLIENT_SECRET not configured");

  if (cachedToken && Date.now() < cachedToken.expiresAt - 120_000) return cachedToken.token;

  // Experian UK requires client_id:client_secret as HTTP Basic auth on the token endpoint,
  // with username+password in the body (not client credentials in the body).
  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const body = new URLSearchParams({
    grant_type: "password",
    username: username || "",
    password: password || "",
  });

  const res = await fetch(`${baseUrl()}/oauth2/v1/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      Authorization: `Basic ${basicAuth}`,
    },
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
  return cachedToken.token;
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
  accountsDate: string | null;      // YYYY-MM-DD — accounts period end date for the turnover figure
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
  // Experian UK Commercial Credit v2 response shape:
  //   RegNumber, CommercialName, Identification.{LegalStatus,IncorporationDate,SICInformation1992[]},
  //   CommercialDelphi.{CommDelphiScore, CommDelphiBand, CommDelphiBandText, CreditLimit},
  //   CCJs.{NumberCCJs0To72, ValueCCJs0To72},
  //   Financials.Accounts[0].DisclosureItems.NumberEmployees
  const id = raw?.Identification || {};
  const delphi = raw?.CommercialDelphi || {};
  const ccjs = raw?.CCJs || {};
  const accounts = raw?.Financials?.Accounts?.[0] || {};
  const sic1992 = id?.SICInformation1992 || [];

  return {
    companyNumber,
    companyName: raw?.CommercialName || "",
    creditScore: toNumber(delphi?.CommDelphiScore),
    creditLimit: toNumber(delphi?.CreditLimit),
    creditBand: delphi?.CommDelphiBand ? String(delphi.CommDelphiBand) : null,
    riskIndicator: delphi?.CommDelphiBandText || null,
    ccj: toNumber(ccjs?.NumberCCJs0To72),
    ccjTotalValue: toNumber(ccjs?.ValueCCJs0To72),
    status: id?.LegalStatus ? String(id.LegalStatus) : null,
    incorporationDate: id?.IncorporationDate || null,
    sic: Array.isArray(sic1992) ? sic1992.map((s: any) => s?.Code).filter(Boolean) : null,
    employees: toNumber(accounts?.DisclosureItems?.NumberEmployees),
    turnover: toNumber(accounts?.ProfitLoss?.Turnover ?? accounts?.ProfitLoss?.UKTurnover ?? accounts?.ProfitLoss?.TotalTurnover),
    accountsDate: first<string>(accounts, "AccountsDate", "AccountDate", "PeriodEndDate", "Date"),
    rawResponse: raw,
  };
}

// Convert an Experian accounts date into a YYYY period suitable for turnover_data.period.
// Accepts ISO strings, "DD/MM/YYYY", or year-only. Falls back to current year.
export function experianTurnoverPeriod(accountsDate: string | null): string {
  if (!accountsDate) return new Date().getFullYear().toString();
  const iso = /^(\d{4})-/.exec(accountsDate);
  if (iso) return iso[1];
  const dmy = /\/(\d{4})$/.exec(accountsDate);
  if (dmy) return dmy[1];
  const y = /^(\d{4})$/.exec(accountsDate.trim());
  if (y) return y[1];
  return new Date().getFullYear().toString();
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
    const res = await fetch(`${baseUrl()}/risk/business/v2/registeredcompanycredit/${encodeURIComponent(cleaned)}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
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

// Debug helper — returns raw Experian response, accepts path + body overrides (sandbox testing only).
export async function debugExperianRaw(
  companyNumber: string,
  opts?: { path?: string; method?: string; reqBody?: any; extraHeaders?: Record<string, string>; baseOverride?: string; noAuth?: boolean }
): Promise<{ status: number; body: any; url: string }> {
  const token = opts?.noAuth ? "" : await getToken();
  const cleaned = (companyNumber || "").trim().toUpperCase();
  const path = opts?.path ?? "/business-information/businesses/uk/v1/credit-report";
  const method = opts?.method ?? "POST";
  const reqBody = opts?.reqBody ?? { registrationNumber: cleaned, country: "GB" };
  const base = opts?.baseOverride ?? baseUrl();
  const url = `${base}${path}`;
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...(opts?.extraHeaders ?? {}),
  };
  if (method !== "GET") headers["Content-Type"] = "application/json";
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(url, {
    method,
    headers,
    body: method !== "GET" ? JSON.stringify(reqBody) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  const body = await res.json().catch(async () => ({ raw: await res.text().catch(() => "") }));
  return { status: res.status, url, body };
}

// KYB lookup — lighter-weight than full credit report, used for business
// identity verification (name / address / director match).
export async function kybLookup(companyNumber: string): Promise<{ verified: boolean; name?: string; status?: string; raw?: any } | null> {
  if (!isExperianConfigured()) return null;
  const cleaned = (companyNumber || "").trim().toUpperCase();
  if (!cleaned) return null;

  try {
    const token = await getToken();
    // businesstargeter is the search endpoint — accepts businessref query param
    const res = await fetch(`${baseUrl()}/risk/business/v2/businesstargeter?businessref=${encodeURIComponent(cleaned)}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const raw = await res.json();
    const hit = raw?.SearchResults?.[0] || null;
    const name = hit?.CommercialName || hit?.Name || null;
    const status = hit?.BusinessStatus || null;
    return { verified: !!name, name: name || undefined, status: status || undefined, raw };
  } catch (err: any) {
    console.warn(`[experian] kyb lookup failed for ${cleaned}: ${err?.message}`);
    return null;
  }
}

// Upsert the filed turnover from an Experian credit report into turnover_data.
// Keyed on (company_id, source) so re-running the KYC sweep won't duplicate rows;
// it just refreshes the latest figure. Silent no-op if turnover is missing.
export async function persistExperianTurnover(
  pool: { query: (sql: string, params?: any[]) => Promise<any> },
  args: { companyId: string; companyName: string; report: ExperianCreditReport },
): Promise<{ inserted: boolean; updated: boolean } | null> {
  const { companyId, companyName, report } = args;
  if (!report || report.turnover == null || !(report.turnover > 0)) return null;
  const period = experianTurnoverPeriod(report.accountsDate);
  const source = "Experian (filed accounts)";
  const notes = `Filed turnover from Experian commercial credit report${report.accountsDate ? ` (accounts to ${report.accountsDate})` : ""}`;
  try {
    const existing = await pool.query(
      `SELECT id FROM turnover_data WHERE company_id = $1 AND source = $2 LIMIT 1`,
      [companyId, source],
    );
    if (existing.rows[0]) {
      await pool.query(
        `UPDATE turnover_data SET turnover = $1, period = $2, confidence = $3, notes = $4, updated_at = NOW() WHERE id = $5`,
        [report.turnover, period, "High", notes, existing.rows[0].id],
      );
      return { inserted: false, updated: true };
    }
    const { nanoid } = await import("nanoid");
    await pool.query(
      `INSERT INTO turnover_data (id, company_id, company_name, period, turnover, source, confidence, notes, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),NOW())`,
      [nanoid(), companyId, companyName, period, report.turnover, source, "High", notes],
    );
    return { inserted: true, updated: false };
  } catch (err: any) {
    console.warn(`[experian] persistTurnover failed for ${companyName}: ${err?.message}`);
    return null;
  }
}
