// RocketReach company-level lookup. Companion to rocketreach-contacts.ts.
//
// Uses /v2/api/searchCompany (POST with a query body) — same pattern as the
// people search. Picks the best match by domain, falls back to name. Returns
// the firmographic record (description, industry, headcount, revenue band,
// funding, HQ, social URLs, tech stack). Cached per-brand in
// brand_rocketreach_data.
//
// Endpoints:
//   GET  /api/brand/:companyId/rocketreach-company        → cached payload
//   POST /api/brand/:companyId/rocketreach-company/refresh → re-fetch from RR
import { Router, type Request, type Response } from "express";
import { requireAuth } from "./auth";
import { pool } from "./db";

const router = Router();

function rrAuthHeader(): Record<string, string> | null {
  const key = process.env.ROCKETREACH_API_KEY;
  if (!key) return null;
  return { "Api-Key": key };
}

function extractDomain(raw: string | null | undefined): string | null {
  if (!raw) return null;
  return String(raw).replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "").toLowerCase();
}

async function searchCompany(opts: { domain?: string | null; name?: string | null }): Promise<any | null> {
  const auth = rrAuthHeader();
  if (!auth) throw new Error("ROCKETREACH_API_KEY not configured");

  const query: Record<string, string[]> = {};
  if (opts.domain) query.domain = [opts.domain];
  if (opts.name) query.name = [opts.name];
  if (!query.domain && !query.name) return null;

  const body = { query, page_size: 5, start: 1 };

  const res = await fetch("https://api.rocketreach.co/v2/api/searchCompany", {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error(`[rocketreach-company] searchCompany ${res.status}:`, text.slice(0, 400));
    throw new Error(`RocketReach searchCompany ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as any;
  const list = (data?.companies || data?.results || data?.profiles || []) as any[];
  return list[0] || null;
}

// /v2/api/lookupCompany would return the rich firmographic record
// (description, revenue, employees, tech stack, competitors) but our current
// plan returns 403: "You do not have enough company lookups". Until that
// credit pack is bought from sales@rocketreach.co we only have the
// searchCompany stub fields: id, name, city, region, country_code,
// email_domain, industry_str, ticker_symbol.

router.get("/api/brand/:companyId/rocketreach-company", requireAuth, async (req: Request, res: Response) => {
  try {
    const companyId = String(req.params.companyId);
    const row = await pool.query(
      `SELECT payload, fetched_at FROM brand_rocketreach_data WHERE company_id = $1`,
      [companyId]
    );
    if (row.rowCount) {
      return res.json({
        configured: !!process.env.ROCKETREACH_API_KEY,
        payload: row.rows[0].payload,
        fetched_at: row.rows[0].fetched_at,
      });
    }
    res.json({ configured: !!process.env.ROCKETREACH_API_KEY, payload: null, fetched_at: null });
  } catch (err: any) {
    console.error("[rocketreach-company] GET error:", err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/brand/:companyId/rocketreach-company/refresh", requireAuth, async (req: Request, res: Response) => {
  try {
    if (!process.env.ROCKETREACH_API_KEY) {
      return res.status(503).json({ error: "ROCKETREACH_API_KEY not configured" });
    }
    const companyId = String(req.params.companyId);
    const companyRow = await pool.query(
      `SELECT id, name, domain, domain_url FROM crm_companies WHERE id = $1`,
      [companyId]
    );
    if (!companyRow.rowCount) return res.status(404).json({ error: "Company not found" });
    const company = companyRow.rows[0];
    const domain = extractDomain(company.domain_url || company.domain);

    let stub: any = null;
    if (domain) {
      stub = await searchCompany({ domain });
    }
    if (!stub && company.name) {
      stub = await searchCompany({ name: company.name });
    }

    if (!stub) {
      return res.json({ payload: null, fetched_at: new Date().toISOString(), note: "No match on RocketReach" });
    }

    // Only the search-stub fields are available on the current plan
    // (lookupCompany is credit-gated). See note above.
    const payload: any = stub;

    await pool.query(
      `INSERT INTO brand_rocketreach_data (company_id, payload, fetched_at)
       VALUES ($1, $2::jsonb, now())
       ON CONFLICT (company_id) DO UPDATE
         SET payload = EXCLUDED.payload, fetched_at = now()`,
      [companyId, JSON.stringify(payload)]
    );

    res.json({ payload, fetched_at: new Date().toISOString() });
  } catch (err: any) {
    console.error("[rocketreach-company] refresh error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Diagnostic — tries several candidate RocketReach company endpoints and
// returns whichever responses came back. RocketReach's web UI shows rich
// firmographics (description, revenue, employees, tech stack, competitors)
// for Aesop et al, but /v2/api/lookupCompany returns only the stub. This
// probe helps identify the right endpoint / parameter combination.
//
// Hit /api/rocketreach-company-probe?id=61841 (Aesop) or ?domain=aesop.com.
router.get("/api/rocketreach-company-probe", requireAuth, async (req: Request, res: Response) => {
  const auth = rrAuthHeader();
  if (!auth) return res.status(503).json({ error: "ROCKETREACH_API_KEY not configured" });
  const id = String(req.query.id || "").trim();
  const domain = String(req.query.domain || "").trim();
  const name = String(req.query.name || "").trim();

  const probes: Array<{ label: string; url: string; method: "GET" | "POST"; body?: any }> = [];

  if (id) {
    probes.push({ label: "GET /v2/api/lookupCompany?id=", url: `https://api.rocketreach.co/v2/api/lookupCompany?id=${encodeURIComponent(id)}`, method: "GET" });
    probes.push({ label: "GET /v2/api/companyLookup?id=", url: `https://api.rocketreach.co/v2/api/companyLookup?id=${encodeURIComponent(id)}`, method: "GET" });
    probes.push({ label: "GET /v2/api/company/lookup?id=", url: `https://api.rocketreach.co/v2/api/company/lookup?id=${encodeURIComponent(id)}`, method: "GET" });
    probes.push({ label: "GET /v2/api/getCompany?id=", url: `https://api.rocketreach.co/v2/api/getCompany?id=${encodeURIComponent(id)}`, method: "GET" });
    probes.push({ label: "GET /v2/api/company?id=", url: `https://api.rocketreach.co/v2/api/company?id=${encodeURIComponent(id)}`, method: "GET" });
    probes.push({ label: "GET /v2/person/company/lookup?id=", url: `https://api.rocketreach.co/v2/person/company/lookup?id=${encodeURIComponent(id)}`, method: "GET" });
    // Suggested by RocketReach's "LookupProfileAndCompany" webhook endpoint name
    // — implies an API endpoint that returns profile + company firmographics.
    probes.push({ label: "GET /v2/api/lookupProfileAndCompany?id=", url: `https://api.rocketreach.co/v2/api/lookupProfileAndCompany?id=${encodeURIComponent(id)}`, method: "GET" });
    probes.push({ label: "GET /v2/api/lookupProfileAndCompany?company_id=", url: `https://api.rocketreach.co/v2/api/lookupProfileAndCompany?company_id=${encodeURIComponent(id)}`, method: "GET" });
  }
  if (domain) {
    probes.push({ label: "GET /v2/api/lookupCompany?domain=", url: `https://api.rocketreach.co/v2/api/lookupCompany?domain=${encodeURIComponent(domain)}`, method: "GET" });
    probes.push({ label: "GET /v2/api/companyLookup?domain=", url: `https://api.rocketreach.co/v2/api/companyLookup?domain=${encodeURIComponent(domain)}`, method: "GET" });
  }
  if (domain || name) {
    const body: any = { query: {} };
    if (domain) body.query.domain = [domain];
    if (name) body.query.name = [name];
    body.page_size = 1;
    body.start = 1;
    probes.push({ label: "POST /v2/api/searchCompany", url: "https://api.rocketreach.co/v2/api/searchCompany", method: "POST", body });
  }

  const results = await Promise.all(probes.map(async (p) => {
    const t0 = Date.now();
    try {
      const r = await fetch(p.url, {
        method: p.method,
        headers: p.method === "POST" ? { ...auth, "Content-Type": "application/json" } : auth,
        body: p.body ? JSON.stringify(p.body) : undefined,
        signal: AbortSignal.timeout(15_000),
      });
      const text = await r.text().catch(() => "");
      let parsed: any = null;
      try { parsed = JSON.parse(text); } catch {}
      return {
        label: p.label,
        url: p.url,
        method: p.method,
        status: r.status,
        ms: Date.now() - t0,
        fieldCount: parsed && typeof parsed === "object" ? Object.keys(parsed).length : null,
        topKeys: parsed && typeof parsed === "object" ? Object.keys(parsed).slice(0, 30) : null,
        body: parsed ?? text.slice(0, 500),
      };
    } catch (err: any) {
      return { label: p.label, url: p.url, method: p.method, error: err?.message || String(err), ms: Date.now() - t0 };
    }
  }));

  res.json({ query: { id, domain, name }, results });
});

export default router;
