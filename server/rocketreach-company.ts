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

// Map a RocketReach industry_str → BGP company_type (the "Tenant - X" tag
// the Brand Explorer filters on). Source of truth is BRAND_CATEGORIES in
// client/src/pages/brands-hub.tsx — keep these aligned.
//
// Returns null when no confident mapping exists; caller leaves company_type
// alone in that case rather than overwriting with a guess.
function mapRrIndustryToBgpType(industryStr: string | null | undefined): string | null {
  if (!industryStr) return null;
  const s = industryStr.toLowerCase();

  // Luxury
  if (/jewell?ery|watch(es)?/.test(s)) return "Tenant - Jewellery & Watches";
  if (/luxury/.test(s)) return "Tenant - Luxury";

  // Fashion & retail
  if (/footwear|shoe/.test(s)) return "Tenant - Footwear";
  if (/athleisure|sportswear|sporting goods/.test(s)) return "Tenant - Athleisure";
  if (/textile|apparel|clothing|fashion/.test(s)) return "Tenant - Fashion";
  if (/cosmetics|personal care|beauty|skin care|skincare/.test(s)) return "Tenant - Beauty";
  if (/fragrance|perfume/.test(s)) return "Tenant - Fragrance";
  if (/home(ware)?|furniture|furnishings|interior/.test(s)) return "Tenant - Homewares";
  if (/gift|specialty stores?/.test(s)) return "Tenant - Gifts & Speciality";
  if (/department store/.test(s)) return "Tenant - Department Store";
  if (/electronics|consumer electronics|technology hardware/.test(s)) return "Tenant - Electronics";
  if (/automotive|automobile|car dealer/.test(s)) return "Tenant - Automotive";
  if (/telecommunications|wireless|mobile carrier/.test(s)) return "Tenant - Telecoms";
  if (/books?|stationery|publishing/.test(s)) return "Tenant - Books & Stationery";
  if (/bank|financial services|insurance|wealth/.test(s)) return "Tenant - Financial Services";
  if (/optician|eyewear/.test(s)) return "Tenant - Optician";

  // F&B
  if (/coffee|cafe|café/.test(s)) return "Tenant - Café";
  if (/bakery|patisserie|pastry/.test(s)) return "Tenant - Bakery";
  if (/wine|bar|pub/.test(s)) return "Tenant - Bar";
  if (/fast food|quick service|qsr/.test(s)) return "Tenant - Quick Service";
  if (/restaurant|food.{0,4}beverage|hospitality/.test(s)) return "Tenant - Restaurant";

  // Leisure
  if (/cinema|film|motion picture/.test(s)) return "Tenant - Cinema";
  if (/gaming|video games|amusement|escape room/.test(s)) return "Tenant - Gaming";
  if (/arts?|museum|gallery|culture/.test(s)) return "Tenant - Arts";
  if (/entertainment|leisure/.test(s)) return "Tenant - Leisure";

  // Health & Wellness
  if (/gym|fitness|exercise/.test(s)) return "Tenant - Gym & Fitness";
  if (/yoga|pilates/.test(s)) return "Tenant - Yoga";
  if (/spa|wellness|health.{0,4}wellness|salon|nail/.test(s)) return "Tenant - Wellness";

  // National
  if (/grocery|supermarket|convenience store/.test(s)) return "Tenant - Grocery";
  if (/hardware|building supply|home improvement|diy/.test(s)) return "Tenant - DIY";

  // Generic retail fallback
  if (/retail/.test(s)) return "Tenant - Retail";

  return null;
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
      `SELECT id, name, domain, domain_url, industry, company_type FROM crm_companies WHERE id = $1`,
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

    // Auto-fill BGP categorisation from RocketReach when we don't already
    // have it. Never overwrite a manually-set company_type or industry.
    const autoFilled: { industry?: string; company_type?: string; domain?: string } = {};
    const isBlankIndustry = !company.industry || !String(company.industry).trim();
    const isGenericType = !company.company_type
      || ["Tenant", "Tenant - Other", "Tenant - Retail", "Tenant - Unknown"].includes(String(company.company_type).trim());
    const isBlankDomain = !company.domain && !company.domain_url;

    if (isBlankIndustry && stub.industry_str) {
      autoFilled.industry = String(stub.industry_str);
    }
    if (isGenericType) {
      const mapped = mapRrIndustryToBgpType(stub.industry_str);
      if (mapped) autoFilled.company_type = mapped;
    }
    // Backfill domain from RocketReach when missing — unlocks the brand for
    // bulk logo import (which requires a domain) and for downstream sources
    // that key off email_domain.
    if (isBlankDomain && stub.email_domain) {
      autoFilled.domain = String(stub.email_domain).toLowerCase().trim();
    }

    if (Object.keys(autoFilled).length > 0) {
      const sets: string[] = [];
      const vals: any[] = [companyId];
      let i = 2;
      if (autoFilled.industry !== undefined) { sets.push(`industry = $${i++}`); vals.push(autoFilled.industry); }
      if (autoFilled.company_type !== undefined) { sets.push(`company_type = $${i++}`); vals.push(autoFilled.company_type); }
      if (autoFilled.domain !== undefined) { sets.push(`domain = $${i++}`); vals.push(autoFilled.domain); }
      await pool.query(`UPDATE crm_companies SET ${sets.join(", ")}, updated_at = now() WHERE id = $1`, vals);
    }

    res.json({ payload, fetched_at: new Date().toISOString(), auto_filled: autoFilled });
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

// Bulk back-fill — loops over every tenant brand that hasn't been swept yet
// (or all if forceAll=true) and calls the refresh path inline. Used once to
// catch up the whole library when categorisation rules change. Background
// job because RocketReach searchCompany at scale runs into rate limits and
// the loop can take 5+ minutes — Railway's 60s edge proxy timeout kills the
// HTTP response otherwise. Same pattern as bulk-logo import.
interface BackfillJob {
  startedAt: number;
  finishedAt: number | null;
  total: number;
  attempted: number;
  matched: number;
  autoFilled: number;
  errors: number;
  consecutiveErrors: number;
  errorSamples: string[];
  lastBrand: string | null;
  abortedReason: string | null;
}
let backfillJob: BackfillJob | null = null;

router.get("/api/brands/rocketreach-backfill/status", requireAuth, async (_req: Request, res: Response) => {
  if (!backfillJob) return res.json({ running: false, message: "No backfill has been started in this process lifetime." });
  res.json({
    running: backfillJob.finishedAt === null,
    startedAt: new Date(backfillJob.startedAt).toISOString(),
    finishedAt: backfillJob.finishedAt ? new Date(backfillJob.finishedAt).toISOString() : null,
    progress: `${backfillJob.attempted}/${backfillJob.total}`,
    matched: backfillJob.matched,
    autoFilled: backfillJob.autoFilled,
    errors: backfillJob.errors,
    error_samples: backfillJob.errorSamples,
    last_brand: backfillJob.lastBrand,
    aborted_reason: backfillJob.abortedReason,
  });
});

router.post("/api/brands/rocketreach-backfill", requireAuth, async (req: Request, res: Response) => {
  try {
    if (!process.env.ROCKETREACH_API_KEY) {
      return res.status(503).json({ error: "ROCKETREACH_API_KEY not configured" });
    }
    if (backfillJob && backfillJob.finishedAt === null) {
      return res.status(409).json({ error: "A backfill is already running", progress: `${backfillJob.attempted}/${backfillJob.total}` });
    }
    const limit = Math.min(Number(req.body?.limit ?? 200), 1000);
    const forceAll: boolean = req.body?.forceAll === true;
    const where = forceAll
      ? `WHERE c.merged_into_id IS NULL AND c.company_type ILIKE 'Tenant%'`
      : `WHERE c.merged_into_id IS NULL
           AND c.company_type ILIKE 'Tenant%'
           AND NOT EXISTS (SELECT 1 FROM brand_rocketreach_data b WHERE b.company_id = c.id)`;
    const { rows } = await pool.query(
      `SELECT c.id, c.name, c.domain, c.domain_url, c.industry, c.company_type
         FROM crm_companies c
         ${where}
         ORDER BY c.last_enriched_at ASC NULLS FIRST
         LIMIT $1`,
      [limit]
    );

    if (rows.length === 0) {
      return res.json({ started: false, note: "No brands to backfill — all matched brands already have RocketReach data, or no tenants exist." });
    }

    backfillJob = {
      startedAt: Date.now(),
      finishedAt: null,
      total: rows.length,
      attempted: 0,
      matched: 0,
      autoFilled: 0,
      errors: 0,
      consecutiveErrors: 0,
      errorSamples: [],
      lastBrand: null,
      abortedReason: null,
    };

    // Run the work async so Railway's 60s proxy timeout doesn't kill the
    // response. Throttle 1s per call — RocketReach's searchCompany rate
    // limits aren't documented but bursting at 150ms hit 481 errors / 500.
    setImmediate(async () => {
      try {
        for (const company of rows) {
          if (!backfillJob) break;
          backfillJob.lastBrand = company.name;
          backfillJob.attempted++;

          // Circuit breaker — if we get 10 errors in a row, RocketReach is
          // clearly blocking us, abort the rest. Better to stop early than
          // burn through 1000 attempts.
          if (backfillJob.consecutiveErrors >= 10) {
            backfillJob.abortedReason = "Circuit breaker — 10 consecutive RocketReach errors. Wait 10 minutes and re-run, or check the key.";
            console.warn(`[rocketreach-backfill] ${backfillJob.abortedReason}`);
            break;
          }

          try {
            const domain = extractDomain(company.domain_url || company.domain);
            let stub: any = null;
            if (domain) stub = await searchCompany({ domain });
            if (!stub && company.name) stub = await searchCompany({ name: company.name });
            backfillJob.consecutiveErrors = 0;
            if (!stub) continue;
            backfillJob.matched++;
            await pool.query(
              `INSERT INTO brand_rocketreach_data (company_id, payload, fetched_at)
               VALUES ($1, $2::jsonb, now())
               ON CONFLICT (company_id) DO UPDATE SET payload = EXCLUDED.payload, fetched_at = now()`,
              [company.id, JSON.stringify(stub)]
            );
            const isBlankIndustry = !company.industry || !String(company.industry).trim();
            const isGenericType = !company.company_type
              || ["Tenant", "Tenant - Other", "Tenant - Retail", "Tenant - Unknown"].includes(String(company.company_type).trim());
            const isBlankDomain = !company.domain && !company.domain_url;
            const filled: { industry?: string; company_type?: string; domain?: string } = {};
            if (isBlankIndustry && stub.industry_str) filled.industry = String(stub.industry_str);
            if (isGenericType) {
              const mapped = mapRrIndustryToBgpType(stub.industry_str);
              if (mapped) filled.company_type = mapped;
            }
            if (isBlankDomain && stub.email_domain) filled.domain = String(stub.email_domain).toLowerCase().trim();
            if (Object.keys(filled).length > 0) {
              const sets: string[] = [];
              const vals: any[] = [company.id];
              let i = 2;
              if (filled.industry !== undefined) { sets.push(`industry = $${i++}`); vals.push(filled.industry); }
              if (filled.company_type !== undefined) { sets.push(`company_type = $${i++}`); vals.push(filled.company_type); }
              if (filled.domain !== undefined) { sets.push(`domain = $${i++}`); vals.push(filled.domain); }
              await pool.query(`UPDATE crm_companies SET ${sets.join(", ")}, updated_at = now() WHERE id = $1`, vals);
              backfillJob.autoFilled++;
            }
            // 1s throttle — burst of 150ms hit RocketReach rate limit hard.
            await new Promise(r => setTimeout(r, 1000));
          } catch (e: any) {
            backfillJob.errors++;
            backfillJob.consecutiveErrors++;
            const msg = `${company.name}: ${e?.message || e}`;
            if (backfillJob.errorSamples.length < 5) backfillJob.errorSamples.push(msg);
            console.warn(`[rocketreach-backfill] ${msg}`);
          }
        }
      } catch (err: any) {
        if (backfillJob) backfillJob.abortedReason = `Job crashed: ${err?.message}`;
        console.error("[rocketreach-backfill] background job crashed:", err);
      } finally {
        if (backfillJob) {
          backfillJob.finishedAt = Date.now();
          console.log(`[rocketreach-backfill] done — matched=${backfillJob.matched}, autoFilled=${backfillJob.autoFilled}, errors=${backfillJob.errors}`);
        }
      }
    });

    res.json({
      started: true,
      total: rows.length,
      message: "Background backfill started. Poll /api/brands/rocketreach-backfill/status for progress.",
    });
  } catch (err: any) {
    console.error("[rocketreach-company] backfill error:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
