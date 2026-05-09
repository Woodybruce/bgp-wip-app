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

// ─── Sandbox audit: exercise every candidate Experian product so we know
// what to put on the order before we talk to sales ─────────────────────────

export interface SandboxProbe {
  product: string;            // sales-facing product name
  bgpUse: string;             // why we want it
  path: string;               // sandbox URL path
  method: "GET" | "POST";
  reqBody?: any;
  status: number | null;      // HTTP status
  ok: boolean;
  latencyMs: number;
  fields: string[];           // top-level fields returned (when 200)
  responseShape?: string[];   // 2-level deep keys for 200s — shows what's bundled
  preview: string;            // first 250 chars of response
  note: string;               // human read of what this means
  errorCode?: string;         // parsed error code from body
  errorMessage?: string;      // parsed error message
  classification: "available" | "needs_real_input" | "not_entitled" | "path_unknown" | "rate_limited" | "server_error" | "ambiguous";
}

// Walk an object up to depth levels deep, returning "key.subkey" strings.
// Arrays are sampled at [0] to keep output bounded but readable.
function walkShape(obj: any, prefix = "", depth = 0, maxDepth = 4): string[] {
  if (depth > maxDepth || !obj || typeof obj !== "object") return [];
  const out: string[] = [];
  const keys = Array.isArray(obj) ? (obj.length ? ["[0]"] : []) : Object.keys(obj);
  for (const k of keys) {
    const v = Array.isArray(obj) ? obj[0] : obj[k];
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object") {
      out.push(`${path} (${Array.isArray(v) ? `[]×${(obj as any).length ?? "?"}` : "obj"})`);
      out.push(...walkShape(v, path, depth + 1, maxDepth));
    } else {
      const t = v == null ? "null" : typeof v;
      out.push(`${path}: ${t}`);
    }
  }
  return out;
}

// Map BGP's AML/KYC needs to the response shape buckets we expect to find.
// Each entry: which top-level key on a working product covers that need.
// Used to build the "what you can skip ordering" report.
interface CoverageMap {
  need: string;          // BGP requirement (sentence)
  bgpField: string;      // BGP-side identifier
  shapeMatchers: RegExp[]; // case-insensitive patterns to look for in walkShape output
  productsToCheck: string[]; // priority order
  // Existing non-Experian vendor that already covers this — so the audit
  // doesn't tell sales we need a new SKU when we already pay someone else.
  alternativeVendor?: string;
}
const COVERAGE: CoverageMap[] = [
  {
    need: "Active + resigned directors / officers",
    bgpField: "kyc_directors",
    shapeMatchers: [/director/i, /officer/i, /\bAppointment/i],
    productsToCheck: ["Business Profile (full report)", "Commercial Credit (Delphi)"],
  },
  {
    need: "CCJ count + total value",
    bgpField: "kyc_ccj",
    shapeMatchers: [/\bCCJ/i, /CountyCourtJudg/i, /JudgmentCount/i],
    productsToCheck: ["Commercial Credit (Delphi)", "Business Profile (full report)"],
  },
  {
    need: "Mortgages / outstanding charges",
    bgpField: "kyc_mortgages",
    shapeMatchers: [/mortgage/i, /\bcharge/i, /securitised/i],
    productsToCheck: ["Commercial Credit (Delphi)", "Business Profile (full report)"],
  },
  {
    need: "Filed turnover + accounts data",
    bgpField: "kyc_financials",
    shapeMatchers: [/turnover/i, /financ/i, /\bAccounts/i, /profit/i, /balance.?sheet/i],
    productsToCheck: ["Commercial Credit (Delphi)", "Business Profile (full report)"],
  },
  {
    need: "Group structure / parent + subsidiaries",
    bgpField: "kyc_group",
    shapeMatchers: [/group/i, /parent/i, /subsid/i, /family.?tree/i, /linkage/i, /ultimate.?owner/i],
    productsToCheck: ["Business Profile (full report)", "Commercial Credit (Delphi)"],
  },
  {
    need: "Commercial Delphi score + recommended limit",
    bgpField: "kyc_credit_score",
    shapeMatchers: [/delphi/i, /credit.?score/i, /credit.?limit/i, /risk.?band/i, /risk.?indicator/i],
    productsToCheck: ["Commercial Credit (Delphi)"],
  },
  {
    need: "Adverse media / negative press",
    bgpField: "kyc_adverse_media",
    shapeMatchers: [/adverse/i, /negative.?(news|media)/i, /press/i],
    productsToCheck: ["Business Profile (full report)", "Commercial Credit (Delphi)"],
    alternativeVendor: "Perplexity (web-grounded, cited) + Claude AI triage synthesis",
  },
  {
    need: "Insolvency / dissolution / liquidation history",
    bgpField: "kyc_insolvency",
    shapeMatchers: [/insolven/i, /liquidat/i, /dissolu/i, /administra/i, /receivership/i, /strike.?off/i, /\bgazette/i],
    productsToCheck: ["Business Profile (full report)", "Commercial Credit (Delphi)"],
  },
  {
    need: "PEP / Sanctions screening",
    bgpField: "kyc_pep",
    shapeMatchers: [/\bPEP\b/i, /sanction/i, /watchlist/i, /politically/i],
    productsToCheck: ["Business Profile (full report)", "Commercial Credit (Delphi)"],
    alternativeVendor: "ComplyAdvantage Mesh + UK OFSI + US OFAC sanctions feeds (already wired)",
  },
  {
    need: "Previous registered office + trading addresses",
    bgpField: "kyc_addresses",
    shapeMatchers: [/RegisteredOffice/i, /TradingLocation/i, /Previous(Address|Addresses)/i],
    productsToCheck: ["Business Profile (full report)"],
  },
  {
    need: "Previous company names",
    bgpField: "kyc_prev_names",
    shapeMatchers: [/PreviousNames/i, /PrevName/i],
    productsToCheck: ["Business Profile (full report)"],
  },
];

interface CoverageResult {
  need: string;
  bgpField: string;
  coveredBy: string[];     // Experian product names
  matchedKeys: string[];   // shape-walk lines that matched
  alternativeVendor?: string; // non-Experian vendor already covering this
  status: "covered" | "covered_elsewhere" | "uncovered";
}

function buildCoverageReport(probes: SandboxProbe[]): CoverageResult[] {
  const byProduct = new Map(probes.map(p => [p.product, p]));
  return COVERAGE.map((c) => {
    const coveredBy: string[] = [];
    const matchedKeys: string[] = [];
    for (const productName of c.productsToCheck) {
      const probe = byProduct.get(productName);
      if (!probe?.responseShape) continue;
      const matches = probe.responseShape.filter(line => c.shapeMatchers.some(rx => rx.test(line)));
      if (matches.length > 0) {
        coveredBy.push(productName);
        matchedKeys.push(...matches.slice(0, 3).map(m => `${productName} → ${m}`));
      }
    }
    let status: CoverageResult["status"];
    if (coveredBy.length > 0) status = "covered";
    else if (c.alternativeVendor) status = "covered_elsewhere";
    else status = "uncovered";
    return {
      need: c.need,
      bgpField: c.bgpField,
      coveredBy,
      matchedKeys,
      alternativeVendor: c.alternativeVendor,
      status,
    };
  });
}

// Catalog of Experian UK B2B products we want to evaluate.
// Each entry has multiple `paths` candidates because Experian UK has two
// active naming conventions: the older `risk/business/v2/<verb><thing>` and
// the newer `risk/business/v2/registered<thing>`. The audit tries each in
// order and reports the first non-404 result.
//
// Test regnum 99999999 is Experian's standard UK sandbox dummy company.
interface ProbeCandidate {
  product: string;
  bgpUse: string;
  paths: Array<{ path: string; method: "GET" | "POST"; reqBody?: any }>;
}

function probeCatalog(regnum: string): ProbeCandidate[] {
  const r = encodeURIComponent(regnum);
  return [
    {
      product: "Commercial Credit (Delphi)",
      bgpUse: "Counterparty credit score, recommended limit, CCJs, filed turnover — feeds BGP risk rating + covenant assessment",
      paths: [
        { path: `/risk/business/v2/registeredcompanycredit/${r}`, method: "GET" },
      ],
    },
    {
      product: "KYB Business Targeter",
      bgpUse: "Confirm registered name + status from Companies House number — corroborates billing/contracting entity ID",
      paths: [
        { path: `/risk/business/v2/businesstargeter?businessref=${r}`, method: "GET" },
      ],
    },
    {
      product: "Director Report",
      bgpUse: "Pull active + resigned directors, prior insolvencies, PEP signals — feeds UBO walk + adverse media",
      paths: [
        { path: `/risk/business/v2/registereddirectors/${r}`, method: "GET" },
        { path: `/risk/business/v2/registereddirectorreport/${r}`, method: "GET" },
        { path: `/risk/business/v2/registeredcompanydirectors/${r}`, method: "GET" },
        { path: `/risk/business/v2/registereddirectorlist/${r}`, method: "GET" },
        { path: `/risk/business/v2/directorsbyreg/${r}`, method: "GET" },
      ],
    },
    {
      product: "CCJ + Mortgage detail",
      bgpUse: "Itemised CCJs/satisfactions + outstanding charges — feeds covenant strength flag",
      paths: [
        { path: `/risk/business/v2/registeredcompanyccjs/${r}`, method: "GET" },
        { path: `/risk/business/v2/registeredccjs/${r}`, method: "GET" },
        { path: `/risk/business/v2/registeredccjmortgages/${r}`, method: "GET" },
        { path: `/risk/business/v2/registeredmortgages/${r}`, method: "GET" },
        { path: `/risk/business/v2/registeredpublicinformation/${r}`, method: "GET" },
      ],
    },
    {
      product: "Commercial Portfolio Monitoring",
      bgpUse: "Webhook alert when a counterparty's score / limit / CCJs change — replaces our quarterly re-screen with real-time push",
      paths: [
        { path: `/risk/business/v2/registeredportfolio`, method: "GET" },
        { path: `/risk/business/v2/registeredmonitoring`, method: "GET" },
        { path: `/risk/business/v2/monitoring`, method: "GET" },
        { path: `/risk/business/v2/alerts`, method: "GET" },
      ],
    },
    {
      product: "Bureau Monitoring (consumer)",
      bgpUse: "Sole-trader / LLP partner tenant deals where the bureau record sits on the individual",
      paths: [
        { path: `/risk/consumer/v2/registeredbureaumonitoring`, method: "GET" },
        { path: `/risk/consumer/v2/bureau`, method: "GET" },
        { path: `/consumer/v1/monitor`, method: "GET" },
      ],
    },
    {
      product: "Fraud Prevention (CIFAS / Hunter)",
      bgpUse: "Identity-fraud markers — flags spoofed counterparties before we waste effort issuing KYC requests",
      paths: [
        { path: `/risk/business/v2/registeredfraudcheck/${r}`, method: "GET" },
        { path: `/risk/business/v2/registeredhunter/${r}`, method: "GET" },
        { path: `/risk/business/v2/registeredcifas/${r}`, method: "GET" },
        { path: `/fraud/v1/check`, method: "POST", reqBody: { registrationNumber: regnum, country: "GB" } },
      ],
    },
    {
      product: "Group Structure / Corporate Linkage",
      bgpUse: "Walk parent → subsidiary chain — supplements Companies House PSCs with international parents we can't see in the UK filings",
      paths: [
        { path: `/risk/business/v2/registeredgroupstructure/${r}`, method: "GET" },
        { path: `/risk/business/v2/registeredcompanyfamilytree/${r}`, method: "GET" },
        { path: `/risk/business/v2/registeredcorporatelinkage/${r}`, method: "GET" },
        { path: `/risk/business/v2/registeredparent/${r}`, method: "GET" },
      ],
    },
    {
      product: "Sole Trader / Unincorporated Lookup",
      bgpUse: "Tenants trading as themselves — letting deals to individual operators where there's no Companies House record",
      paths: [
        { path: `/risk/business/v2/registeredsoletrader`, method: "GET" },
        { path: `/risk/business/v2/registeredunincorporated`, method: "GET" },
        { path: `/risk/business/v2/unincorporatedtargeter`, method: "GET" },
      ],
    },
    {
      product: "Adverse Media / Negative Press",
      bgpUse: "Curated press hits — reduces noise vs Perplexity, more legally defensible audit trail",
      paths: [
        { path: `/risk/business/v2/registeredadversemedia/${r}`, method: "GET" },
        { path: `/risk/business/v2/registerednegativenews/${r}`, method: "GET" },
      ],
    },
    {
      product: "PEP / Sanctions Screening",
      bgpUse: "If priced right could replace ComplyAdvantage — single Experian invoice instead of two",
      paths: [
        { path: `/risk/business/v2/registeredpepsanctions`, method: "POST", reqBody: { name: "John Smith", country: "GB" } },
        { path: `/risk/business/v2/registeredsanctions/${r}`, method: "GET" },
        { path: `/risk/business/v2/registeredpep/${r}`, method: "GET" },
        { path: `/compliance/uk/v1/pep-sanctions`, method: "POST", reqBody: { name: "John Smith", country: "GB" } },
      ],
    },
    {
      product: "Business Profile (full report)",
      bgpUse: "Single-call rich profile (filings + officers + financials + group + risk) — collapses several of the above into one",
      paths: [
        { path: `/risk/business/v2/registeredcompanyprofile/${r}`, method: "GET" },
        { path: `/risk/business/v2/businessprofile/${r}`, method: "GET" },
      ],
    },
  ];
}

// Read the structured error fields out of a 400/4xx body. Experian UK uses
// several shapes — we look at all the common ones.
function parseExperianError(body: any): { code?: string; message?: string } {
  if (!body || typeof body !== "object") return {};
  const candidates = [
    body?.errors?.[0],
    body?.error,
    body?.fault?.detail,
    body?.fault,
    body,
  ].filter(Boolean);
  for (const c of candidates) {
    const code = c?.code || c?.errorCode || c?.faultcode || c?.fault?.faultcode;
    const message = c?.message || c?.description || c?.detail || c?.faultstring || c?.fault?.faultstring || c?.error_description;
    if (code || message) return { code: code ? String(code) : undefined, message: message ? String(message) : undefined };
  }
  return {};
}

// Decide what a status + body actually mean for sales conversation.
// "available" → real working data
// "needs_real_input" → endpoint is real, just rejected our dummy payload
// "not_entitled" → endpoint exists, account doesn't have product enabled
// "path_unknown" → path returns generic gateway 400/404 — likely wrong path
// "rate_limited" → 429
// "server_error" → 5xx
// "ambiguous" → can't tell; ask Experian
function classify(status: number | null, body: any): {
  classification: SandboxProbe["classification"];
  errorCode?: string;
  errorMessage?: string;
  note: string;
} {
  const { code, message } = parseExperianError(body);
  if (status === null) {
    return { classification: "ambiguous", errorCode: code, errorMessage: message, note: "Network error — not Experian-side. Re-run." };
  }
  if (status >= 200 && status < 300) {
    return { classification: "available", errorCode: code, errorMessage: message, note: `Provisioned. Confirm production pricing.` };
  }
  if (status === 401 || status === 403) {
    return { classification: "not_entitled", errorCode: code, errorMessage: message, note: `Endpoint exists; account lacks entitlement. Sales needs to add this SKU.` };
  }
  if (status === 404) {
    return { classification: "path_unknown", errorCode: code, errorMessage: message, note: `Path not present. Likely wrong URL — ask Experian for canonical path.` };
  }
  if (status === 429) {
    return { classification: "rate_limited", errorCode: code, errorMessage: message, note: `Rate-limited. Confirm sandbox call quota with sales.` };
  }
  if (status >= 500) {
    return { classification: "server_error", errorCode: code, errorMessage: message, note: `Experian-side error. Re-run; raise with support if persistent.` };
  }
  // 400 — the interesting case. Read the body.
  if (status === 400) {
    const blob = `${(code || "").toLowerCase()} ${(message || "").toLowerCase()}`;
    // Experian UK's gateway "Invalid request format or URL" is deliberately
    // ambiguous — it covers both unknown paths and bad payloads. Treat as
    // ambiguous so we don't oversell to sales.
    if (/format or url|format.?or.?url/i.test(blob)) {
      return { classification: "ambiguous", errorCode: code, errorMessage: message, note: `Generic gateway 400 — could be wrong path OR rejected payload. Confirm canonical path with Experian.` };
    }
    if (/not.?found|invalid.?path|invalid.?endpoint|unknown.?resource|api.?does.?not.?exist|operation.?not.?found|service.?not.?available|no.?route|no.?matching/i.test(blob)) {
      return { classification: "path_unknown", errorCode: code, errorMessage: message, note: `Gateway says the path doesn't exist. Ask Experian for the canonical path for this product.` };
    }
    if (/not.?subscribed|not.?entitled|not.?authoris|not.?provision|access.?denied|forbidden|not.?permitt/i.test(blob)) {
      return { classification: "not_entitled", errorCode: code, errorMessage: message, note: `Account isn't entitled to this product. Sales needs to add it.` };
    }
    // Specific validation phrases — only mark needs_real_input when message
    // really points at a field/value problem rather than the URL.
    if (/missing|required|must.?be|expected|cannot.?be|too.?(short|long)|invalid.?(parameter|field|value|payload)/i.test(blob)) {
      return { classification: "needs_real_input", errorCode: code, errorMessage: message, note: `Endpoint exists; our test payload didn't validate. Real data should work.` };
    }
    return { classification: "ambiguous", errorCode: code, errorMessage: message, note: `400 with no clear reason. Ask Experian: is this product on our sandbox?` };
  }
  return { classification: "ambiguous", errorCode: code, errorMessage: message, note: `Status ${status} — ambiguous.` };
}

export async function sandboxAudit(regnum: string = "99999999"): Promise<{
  env: string;
  configured: boolean;
  tokenOk: boolean;
  tokenError?: string;
  probes: SandboxProbe[];
  coverage: CoverageResult[];
  recommendation: string[];
}> {
  const env = (process.env.EXPERIAN_ENV || "sandbox");
  const configured = isExperianConfigured();
  if (!configured) {
    return {
      env,
      configured: false,
      tokenOk: false,
      tokenError: "EXPERIAN_CLIENT_ID / EXPERIAN_CLIENT_SECRET not configured",
      probes: [],
      coverage: [],
      recommendation: ["Set EXPERIAN_CLIENT_ID, EXPERIAN_CLIENT_SECRET, EXPERIAN_USERNAME, EXPERIAN_PASSWORD on Railway and re-run."],
    };
  }

  let tokenOk = false;
  let tokenError: string | undefined;
  try {
    await getToken();
    tokenOk = true;
  } catch (e: any) {
    tokenError = e?.message || "unknown";
  }

  const cleanedReg = (regnum || "").trim().toUpperCase() || "99999999";
  const catalog = probeCatalog(cleanedReg);

  // Try every candidate path per product, in parallel within product.
  // Pick the most informative result: prefer 2xx > needs_real_input > not_entitled
  // > path_unknown (worst).
  const rank: Record<SandboxProbe["classification"], number> = {
    available: 0, needs_real_input: 1, not_entitled: 2, rate_limited: 3,
    ambiguous: 4, server_error: 5, path_unknown: 6,
  };

  const probes = await Promise.all(catalog.map(async (c): Promise<SandboxProbe> => {
    const tries = await Promise.all(c.paths.map(async (p) => {
      const start = Date.now();
      try {
        const r = await debugExperianRaw(cleanedReg, { path: p.path, method: p.method, reqBody: p.reqBody });
        const cls = classify(r.status, r.body);
        const ok = r.status >= 200 && r.status < 300;
        const fields = ok && r.body && typeof r.body === "object" ? Object.keys(r.body).slice(0, 12) : [];
        const responseShape = ok ? walkShape(r.body) : undefined;
        return {
          path: p.path,
          method: p.method,
          reqBody: p.reqBody,
          status: r.status,
          ok,
          latencyMs: Date.now() - start,
          fields,
          responseShape,
          preview: JSON.stringify(r.body).slice(0, 250),
          ...cls,
        };
      } catch (e: any) {
        return {
          path: p.path,
          method: p.method,
          reqBody: p.reqBody,
          status: null as number | null,
          ok: false,
          latencyMs: Date.now() - start,
          fields: [] as string[],
          preview: e?.message?.slice(0, 250) || "request failed",
          classification: "ambiguous" as SandboxProbe["classification"],
          note: "Network error",
        };
      }
    }));
    // Sort by helpful classification first, then status.
    tries.sort((a, b) => rank[a.classification] - rank[b.classification]);
    const best = tries[0];
    return {
      product: c.product,
      bgpUse: c.bgpUse,
      ...best,
    };
  }));

  const coverage = buildCoverageReport(probes);
  const recommendation = buildRecommendation(probes, coverage);

  return { env, configured, tokenOk, tokenError, probes, coverage, recommendation };
}

const REQUIRED_PRODUCTS = new Set([
  "Commercial Credit (Delphi)",
  "KYB Business Targeter",
  "Director Report",
  "CCJ + Mortgage detail",
  "Commercial Portfolio Monitoring",
  "Group Structure / Corporate Linkage",
  "Sole Trader / Unincorporated Lookup",
  "Business Profile (full report)",
]);

function buildRecommendation(probes: SandboxProbe[], coverage: CoverageResult[] = []): string[] {
  const buckets = {
    available: [] as SandboxProbe[],
    likelyAvailable: [] as SandboxProbe[],   // needs_real_input
    notEntitled: [] as SandboxProbe[],       // 401/403, "not subscribed"
    pathUnknown: [] as SandboxProbe[],       // 404 / "Resource not found" 400
    ambiguous: [] as SandboxProbe[],
  };
  for (const p of probes) {
    if (p.classification === "available") buckets.available.push(p);
    else if (p.classification === "needs_real_input") buckets.likelyAvailable.push(p);
    else if (p.classification === "not_entitled") buckets.notEntitled.push(p);
    else if (p.classification === "path_unknown") buckets.pathUnknown.push(p);
    else buckets.ambiguous.push(p);
  }

  const fmt = (p: SandboxProbe, withReason = true) => {
    const lines = [`- ${p.product}`];
    if (withReason) lines.push(`  Why BGP needs it: ${p.bgpUse}`);
    lines.push(`  Sandbox: ${p.status ?? "—"}${p.errorCode ? ` (${p.errorCode})` : ""}${p.errorMessage ? ` — ${p.errorMessage.slice(0, 140)}` : ""}`);
    lines.push(`  Path tested: ${p.method} ${p.path}`);
    return lines.join("\n");
  };

  const out: string[] = [];
  out.push(`# Experian sandbox audit — BGP commercial property AML`);
  out.push(``);
  out.push(`Account: ${(process.env.EXPERIAN_ENV || "sandbox").toUpperCase()}`);
  out.push(`Audited: ${new Date().toISOString()}`);
  out.push(``);

  // Coverage map — most useful section. Tells sales which BGP needs are
  // already met by the 3 working products and which need new SKUs.
  if (coverage.length > 0) {
    const covered = coverage.filter(c => c.status === "covered");
    const elsewhere = coverage.filter(c => c.status === "covered_elsewhere");
    const uncovered = coverage.filter(c => c.status === "uncovered");
    out.push(`## 🎯 BGP coverage map — what we need vs what's already provisioned`);
    out.push(``);
    out.push(`### Already covered by the 3 working Experian products (no new SKU needed)`);
    if (covered.length === 0) out.push(`(none yet)`);
    for (const c of covered) {
      out.push(`- **${c.need}** → ${c.coveredBy.join(", ")}`);
      for (const m of c.matchedKeys.slice(0, 3)) out.push(`  - ${m}`);
    }
    out.push(``);
    out.push(`### Already covered by other BGP vendors — DO NOT order from Experian unless it beats them on price`);
    if (elsewhere.length === 0) out.push(`(none)`);
    for (const c of elsewhere) {
      out.push(`- **${c.need}** — already wired via: ${c.alternativeVendor}`);
    }
    out.push(``);
    out.push(`### NOT visible in any working response and nothing else covers it — REAL sales asks`);
    if (uncovered.length === 0) out.push(`(everything BGP needs is covered by the working set or another vendor 🎉)`);
    for (const c of uncovered) {
      out.push(`- **${c.need}** (BGP field: \`${c.bgpField}\`) — not present in Commercial Credit or Business Profile shape, and no alternative vendor wired. Either Experian bundles it deeper than 4 levels, or it's a separate SKU.`);
    }
    out.push(``);
  }

  out.push(`## ✅ Provisioned and returning data`);
  if (buckets.available.length === 0) out.push(`(none yet)`);
  for (const p of buckets.available) out.push(fmt(p, false));
  out.push(``);

  out.push(`## 🟡 Endpoint exists, sandbox payload validation rejected our dummy data`);
  out.push(`These should work in production — confirm with Experian and provide a known good test reg.`);
  for (const p of buckets.likelyAvailable) out.push(fmt(p));
  if (buckets.likelyAvailable.length === 0) out.push(`(none)`);
  out.push(``);

  out.push(`## 🟠 Account not entitled — ASK SALES TO ADD THESE PRODUCTS`);
  for (const p of buckets.notEntitled) out.push(fmt(p));
  if (buckets.notEntitled.length === 0) out.push(`(none)`);
  out.push(``);

  out.push(`## 🔴 Gateway says path doesn't exist — ASK FOR THE CANONICAL PATH`);
  out.push(`These probes hit URLs that returned 404 / "Resource not found" 400. Either Experian uses a different naming convention than the documented one, or these products live on a separate API host. Get the right path from your account manager.`);
  for (const p of buckets.pathUnknown) {
    const required = REQUIRED_PRODUCTS.has(p.product);
    out.push(fmt(p) + (required ? `\n  ⚠ Required for BGP — must resolve.` : ""));
  }
  if (buckets.pathUnknown.length === 0) out.push(`(none)`);
  out.push(``);

  if (buckets.ambiguous.length > 0) {
    out.push(`## ❓ Ambiguous — ask Experian to look at these`);
    for (const p of buckets.ambiguous) out.push(fmt(p));
    out.push(``);
  }

  out.push(`## Commercials to nail down on the sales call`);
  out.push(`- Per-call pricing on Commercial Credit + Director Report at ~250 lookups / month`);
  out.push(`- Per-monitored-entity / month on Commercial Portfolio Monitoring (real-time webhook on score / CCJ change)`);
  out.push(`- Sole Trader / Unincorporated Lookup — included in commercial bundle or separate SKU?`);
  out.push(`- PEP & Sanctions Screening — bundled or add-on? (We currently pay ComplyAdvantage; sole-vendor would simplify invoicing)`);
  out.push(`- Group Structure / Corporate Linkage — does the commercial bundle include international parents (US/EU/Lux holdcos)?`);
  out.push(`- Webhook delivery — does Experian push events, or do we poll?`);
  out.push(`- Production-only entitlements — which of the above are sandbox-blocked entirely?`);
  out.push(``);
  out.push(`## Things to send Experian alongside this email`);
  out.push(`- Our sandbox client_id (so they can look at exactly which probes we ran)`);
  out.push(`- A real UK reg number you'd want to test against in sandbox (Experian seeds different test data depending on account)`);
  out.push(`- Anticipated monthly volume (rough): ~250 commercial lookups, ~50 director reports, ~100 monitored entities`);
  out.push(``);
  return out;
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
