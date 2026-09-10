// RocketReach company-level lookup. Companion to rocketreach-contacts.ts.
//
// Uses /v2/api/searchCompany (POST with a query body) — same pattern as the
// people search. Validates candidates against the verified brand identity. Returns
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
import { brandProviderCacheResult, getBrandIdentity, selectBrandProviderMatch, stampBrandProviderPayload } from "./brand-identity";

const router = Router();

function rrAuthHeader(): Record<string, string> | null {
  const key = process.env.ROCKETREACH_API_KEY;
  if (!key) return null;
  return { "Api-Key": key };
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

async function searchCompany(opts: { domain?: string | null; name?: string | null }): Promise<any[]> {
  const auth = rrAuthHeader();
  if (!auth) throw new Error("ROCKETREACH_API_KEY not configured");

  const query: Record<string, string[]> = {};
  if (opts.domain) query.domain = [opts.domain];
  if (opts.name) query.name = [opts.name];
  if (!query.domain && !query.name) return [];

  const body = { query, page_size: 5, start: 1 };

  const res = await fetch("https://api.rocketreach.co/v2/api/searchCompany", {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status === 404) return [];
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error(`[rocketreach-company] searchCompany ${res.status}:`, text.slice(0, 400));
    throw new Error(`RocketReach searchCompany ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as any;
  const list = (data?.companies || data?.results || data?.profiles || []) as any[];
  return Array.isArray(list) ? list : [];
}

// /v2/api/lookupCompany would return the rich firmographic record
// (description, revenue, employees, tech stack, competitors) but our current
// plan returns 403: "You do not have enough company lookups". Until that
// credit pack is bought from sales@rocketreach.co we only have the
// searchCompany stub fields: id, name, city, region, country_code,
// email_domain, industry_str, ticker_symbol.

export async function refreshRocketReachCompany(companyId: string): Promise<any> {
  const company = (await pool.query(`SELECT * FROM crm_companies WHERE id = $1`, [companyId])).rows[0];
  if (!company) throw new Error("Company not found");
  const identity = getBrandIdentity(company);
  if (identity.status !== "verified" || !identity.domain) {
    return { status: "blocked", payload: null, reason: identity.reason, auto_filled: {} };
  }
  let candidates = await searchCompany({ domain: identity.domain });
  if (!candidates.length) candidates = await searchCompany({ name: company.name });
  const match = selectBrandProviderMatch(company, candidates);
  const fetchedAt = new Date().toISOString();
  const payload = stampBrandProviderPayload(match.candidate, match, fetchedAt);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const current = (await client.query(`SELECT * FROM crm_companies WHERE id = $1 FOR UPDATE`, [companyId])).rows[0];
    if (!current || getBrandIdentity(current).fingerprint !== identity.fingerprint) {
      await client.query("ROLLBACK");
      return { status: "blocked", payload: null, reason: "The brand identity changed during the lookup. Refresh again.", auto_filled: {} };
    }
    await client.query(
      `INSERT INTO brand_rocketreach_data (company_id, payload, fetched_at)
       VALUES ($1, $2::jsonb, now()) ON CONFLICT (company_id) DO UPDATE
         SET payload = EXCLUDED.payload, fetched_at = now()`, [companyId, JSON.stringify(payload)]);
    const autoFilled: Record<string, string> = {};
    if (match.status === "matched") {
      const stub = match.candidate;
      const blank = (value: any) => value == null || typeof value === "string" && !value.trim();
      if (blank(current.industry) && typeof stub.industry_str === "string" && stub.industry_str.trim()) {
        autoFilled.industry = stub.industry_str.trim();
      }
      // Existing categories can be deliberate, including generic Retail.
      // Only an empty category may be filled by an external source.
      if (blank(current.company_type)) {
        const mapped = mapRrIndustryToBgpType(stub.industry_str);
        if (mapped) autoFilled.company_type = mapped;
      }
      if (Object.keys(autoFilled).length) {
        const sets: string[] = [], values: any[] = [], provenance: Record<string, string> = {};
        for (const [field, value] of Object.entries(autoFilled)) {
          values.push(value); sets.push(`${field} = $${values.length}`);
          provenance[field] = `rocketreach ${fetchedAt}`;
        }
        values.push(JSON.stringify(provenance));
        sets.push(`ai_generated_fields = COALESCE(ai_generated_fields, '{}'::jsonb) || $${values.length}::jsonb`, `updated_at = now()`);
        values.push(companyId);
        await client.query(`UPDATE crm_companies SET ${sets.join(", ")} WHERE id = $${values.length}`, values);
      }
    }
    await client.query("COMMIT");
    return { status: match.status, payload: match.status === "matched" ? payload : null, reason: match.reason,
      fetched_at: fetchedAt, fetchedAt, auto_filled: autoFilled };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally { client.release(); }
}

router.get("/api/brand/:companyId/rocketreach-company", requireAuth, async (req: Request, res: Response) => {
  try {
    const companyId = String(req.params.companyId);
    const company = (await pool.query(`SELECT * FROM crm_companies WHERE id = $1`, [companyId])).rows[0];
    if (!company) return res.status(404).json({ error: "Company not found" });
    const row = (await pool.query(`SELECT payload, fetched_at FROM brand_rocketreach_data WHERE company_id = $1`, [companyId])).rows[0];
    res.json({ configured: !!process.env.ROCKETREACH_API_KEY, ...brandProviderCacheResult(company, row?.payload), fetched_at: row?.fetched_at || null });
  } catch (err: any) {
    console.error("[rocketreach-company] GET error:", err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/brand/:companyId/rocketreach-company/refresh", requireAuth, async (req: Request, res: Response) => {
  try {
    res.json(await refreshRocketReachCompany(String(req.params.companyId)));
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
        let currentBatch = rows;
        const attemptedIds = new Set<string>();
        // Auto-chain until no more eligible brands — one POST runs the
        // entire library overnight. Hard safety stop at 5000 to avoid runaway.
        let safetyCap = 5000;
        while (currentBatch.length > 0 && safetyCap > 0) {
          for (const company of currentBatch) {
            if (!backfillJob) break;
            if (safetyCap <= 0) break;
            attemptedIds.add(company.id);
            safetyCap--;
            backfillJob.lastBrand = company.name;
            backfillJob.attempted++;

            // Circuit breaker — if we get 10 errors in a row, RocketReach is
            // clearly blocking us. Don't abort outright — sleep 15 min and reset
            // (overnight run should resume after the hourly cap clears).
            if (backfillJob.consecutiveErrors >= 10) {
              console.warn(`[rocketreach-backfill] 10 consecutive errors, sleeping 15min before retrying`);
              await new Promise(r => setTimeout(r, 15 * 60 * 1000));
              backfillJob.consecutiveErrors = 0;
            }

            try {
              const refreshed = await refreshRocketReachCompany(company.id);
              backfillJob.consecutiveErrors = 0;
              if (refreshed.status === "matched") backfillJob.matched++;
              if (Object.keys(refreshed.auto_filled || {}).length) backfillJob.autoFilled++;
              // 30s throttle for overnight runs: 2 calls/min, 120/hr — well
              // under RR's observed 200/hr cap. Slower = safer overnight.
              await new Promise(r => setTimeout(r, 30_000));
          } catch (e: any) {
            backfillJob.errors++;
            backfillJob.consecutiveErrors++;
            const msg = `${company.name}: ${e?.message || e}`;
            if (backfillJob.errorSamples.length < 5) backfillJob.errorSamples.push(msg);
            console.warn(`[rocketreach-backfill] ${msg}`);
              // If RocketReach gives us an explicit retry-after, sleep that long
              // before the next call rather than churning through more 429s.
              const waitMatch = msg.match(/"wait":\s*"([\d.]+)"/);
              if (waitMatch) {
                const waitSec = Math.min(Math.ceil(Number(waitMatch[1])) + 5, 3600);
                console.warn(`[rocketreach-backfill] Sleeping ${waitSec}s per Retry-After`);
                await new Promise(r => setTimeout(r, waitSec * 1000));
                backfillJob.consecutiveErrors = 0;
              } else {
                // No explicit retry-after — wait the throttle window anyway
                // so we don't burn the next slot with a quick retry.
                await new Promise(r => setTimeout(r, 30_000));
              }
            }
          }
          if (!backfillJob) break;
          // Each brand gets one attempt per run, including no-match and
          // blocked identities. forceAll must not keep revisiting one batch.
          const { rows: nextRows } = await pool.query(
            `SELECT c.id, c.name, c.domain, c.domain_url, c.industry, c.company_type
               FROM crm_companies c
               ${where}
                 AND c.id <> ALL($2::varchar[])
               ORDER BY c.last_enriched_at ASC NULLS FIRST
               LIMIT $1`,
            [limit, [...attemptedIds]]
          );
          if (nextRows.length === 0) break;
          currentBatch = nextRows;
          backfillJob.total += nextRows.length;
          console.log(`[rocketreach-backfill] auto-chain: next batch of ${nextRows.length}, total so far ${backfillJob.attempted}`);
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
