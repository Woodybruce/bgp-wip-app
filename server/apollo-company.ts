// ─────────────────────────────────────────────────────────────────────────
// Apollo organization enrichment — company-level firmographics.
//
// Companion to rocketreach-company.ts (whose rich lookup 403s on the
// current RocketReach plan). Apollo's Organization Enrichment is included
// in the plan we already pay for and returns the momentum data BGP cares
// about: employee count, headcount growth, funding, industry, LinkedIn.
//
//   GET  /api/brand/:companyId/apollo-company          → cached payload
//   POST /api/brand/:companyId/apollo-company/refresh  → re-fetch from Apollo
//
// A refresh also:
//   - fills GAPS on crm_companies (employee_count, industry, linkedin_url,
//     founded_year) — never overwrites a value someone typed in
//   - converts headcount growth + fresh funding into brand_signals rows
//     (source 'apollo'), which the Expansion Intelligence score already
//     consumes as facts — so momentum flows straight into the hunter maths
// ─────────────────────────────────────────────────────────────────────────
import { Router, type Request, type Response } from "express";
import { requireAuth } from "./auth";
import { pool } from "./db";
import { assessBrandProviderMatch, brandProviderCacheResult, getBrandIdentity, stampBrandProviderPayload } from "./brand-identity";

const router = Router();

async function ensureTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS brand_apollo_data (
      company_id VARCHAR PRIMARY KEY,
      payload JSONB NOT NULL,
      fetched_at TIMESTAMP DEFAULT now()
    )`);
}

export async function fetchApolloOrganization(domain: string): Promise<any | null> {
  const key = process.env.APOLLO_API_KEY;
  if (!key) throw new Error("APOLLO_API_KEY not set");
  const res = await fetch(`https://api.apollo.io/api/v1/organizations/enrich?domain=${encodeURIComponent(domain)}`, {
    headers: { "X-Api-Key": key, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    // Apollo's error bodies are JSON with embedded HTML links — never show
    // that raw. Out-of-credits is an account state, not a fault: say so
    // plainly (the red "500: Apollo 422 {...<a href=..." toast, 2026-08-25).
    if (/insufficient credits/i.test(text)) {
      throw new Error("Apollo is out of credits — firmographics are paused until the Apollo plan is topped up (app.apollo.io → Settings → Plans & Billing).");
    }
    if (res.status === 401 || res.status === 403) {
      throw new Error("Apollo rejected our API key — check APOLLO_API_KEY in Subscriptions & APIs.");
    }
    throw new Error(`Apollo lookup failed (${res.status}) — try again shortly.`);
  }
  const data = (await res.json()) as any;
  return data?.organization || null;
}

// The fields the UI + AI read actually use, normalised from Apollo's shape.
export function normaliseApolloOrg(org: any): any {
  if (!org) return null;
  return {
    name: org.name || null,
    domain: org.primary_domain || null,
    linkedinUrl: org.linkedin_url || null,
    employees: Number.isFinite(Number(org.estimated_num_employees)) && Number(org.estimated_num_employees) > 0
      ? Math.round(Number(org.estimated_num_employees)) : null,
    // Growth fields are plan-dependent — keep whatever arrives.
    headcountGrowth6m: org.organization_headcount_six_month_growth ?? org.headcount_six_month_growth ?? null,
    headcountGrowth12m: org.organization_headcount_twelve_month_growth ?? org.headcount_twelve_month_growth ?? null,
    industry: org.industry || null,
    keywords: (org.keywords || []).slice(0, 12),
    foundedYear: org.founded_year ?? null,
    annualRevenue: org.annual_revenue_printed || org.annual_revenue || null,
    totalFunding: org.total_funding_printed || org.total_funding || null,
    latestFundingStage: org.latest_funding_stage || null,
    latestFundingDate: org.latest_funding_round_date || null,
    hq: [org.city, org.state, org.country].filter(Boolean).join(", ") || null,
    country: org.country || org.country_code || null,
    retailLocations: org.retail_location_count ?? null,
    description: (org.short_description || "").slice(0, 500) || null,
  };
}

// Auto-fetch on brand open (Woody, 2026-08-26: "make apollo automatic" —
// same no-ask rule as store research). One attempt per brand per 6h process
// window; a stored payload counts as fresh for 30 days. Landlord-type
// companies are skipped — the Momentum card never renders for them, so a
// fetch would just burn Apollo credits.
const autoKickFired = new Map<string, number>();
export async function autoRefreshApolloIfStale(companyId: string): Promise<void> {
  const last = autoKickFired.get(companyId);
  if (last && Date.now() - last < 6 * 3600_000) return;
  autoKickFired.set(companyId, Date.now());
  await ensureTable();
  const co = (await pool.query(`SELECT * FROM crm_companies WHERE id = $1`, [companyId])).rows[0];
  const identity = getBrandIdentity(co);
  if (!co || identity.status !== "verified") return;
  const type = (co.company_type || "").toLowerCase();
  if (["landlord", "landlord/freeholder", "investor", "reit", "developer", "fund"].includes(type)) return;
  const row = (await pool.query(
    `SELECT payload, fetched_at FROM brand_apollo_data WHERE company_id = $1`, [companyId])).rows[0];
  if (row?.payload?._brandIdentity?.fingerprint === identity.fingerprint
    && row?.fetched_at && Date.now() - new Date(row.fetched_at).getTime() < 30 * 864e5) return;
  await refreshApolloCompany(companyId);
}

export async function refreshApolloCompany(companyId: string): Promise<any> {
  await ensureTable();
  const co = (await pool.query(`SELECT * FROM crm_companies WHERE id = $1`, [companyId])).rows[0];
  if (!co) throw new Error("Company not found");
  const identity = getBrandIdentity(co);
  if (identity.status !== "verified" || !identity.domain) {
    return { status: "blocked", payload: null, reason: identity.reason, gapsFilled: 0 };
  }
  const org = await fetchApolloOrganization(identity.domain);
  const norm = normaliseApolloOrg(org);
  const match = assessBrandProviderMatch(co, norm);
  const fetchedAt = new Date().toISOString();
  const payload = stampBrandProviderPayload(norm, match, fetchedAt);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const current = (await client.query(`SELECT * FROM crm_companies WHERE id = $1 FOR UPDATE`, [companyId])).rows[0];
    if (!current || getBrandIdentity(current).fingerprint !== identity.fingerprint) {
      await client.query("ROLLBACK");
      return { status: "blocked", payload: null, reason: "The brand identity changed during the lookup. Refresh again.", gapsFilled: 0 };
    }
    await client.query(
      `INSERT INTO brand_apollo_data (company_id, payload, fetched_at) VALUES ($1, $2, now())
       ON CONFLICT (company_id) DO UPDATE SET payload = $2, fetched_at = now()`,
      [companyId, JSON.stringify(payload)]);
    // Retire only this machine source. A rejected lookup must not leave its
    // old high-confidence hiring/funding findings in the expansion score.
    await client.query(`DELETE FROM brand_signals WHERE brand_company_id = $1 AND source = 'apollo'`, [companyId]);
    let gapsFilled = 0;
    if (match.status === "matched") {
      const sets: string[] = [], values: any[] = [], provenance: Record<string, string> = {};
      const blank = (value: any) => value == null || typeof value === "string" && !value.trim();
      for (const [field, value] of Object.entries({ employee_count: norm.employees, industry: norm.industry,
        linkedin_url: norm.linkedinUrl, founded_year: norm.foundedYear })) {
        if (!blank(current[field]) || blank(value)) continue;
        values.push(value); sets.push(`${field} = $${values.length}`);
        provenance[field] = `apollo ${fetchedAt}`;
      }
      gapsFilled = sets.length;
      if (sets.length) {
        values.push(JSON.stringify(provenance));
        sets.push(`ai_generated_fields = COALESCE(ai_generated_fields, '{}'::jsonb) || $${values.length}::jsonb`, `updated_at = now()`);
        values.push(companyId);
        await client.query(`UPDATE crm_companies SET ${sets.join(", ")} WHERE id = $${values.length}`, values);
      }
      const growth = norm.headcountGrowth12m ?? norm.headcountGrowth6m;
      if (growth != null && Number.isFinite(Number(growth)) && Math.abs(Number(growth)) >= 0.05) {
        const pct = Math.round(Number(growth) * 100);
        const window = norm.headcountGrowth12m != null ? "12 months" : "6 months";
        await client.query(
          `INSERT INTO brand_signals (id, brand_company_id, signal_type, headline, detail, source, signal_date, magnitude, sentiment, ai_generated, confidence)
           VALUES (gen_random_uuid(), $1, 'hiring', $2, $3, 'apollo', now(), $4, $5, false, 'high')`,
          [companyId, `Headcount ${pct >= 0 ? "up" : "down"} ${Math.abs(pct)}% over ${window}${norm.employees ? ` (now ~${norm.employees} staff)` : ""}`,
           `Apollo firmographics for ${identity.domain}`, Math.abs(pct) >= 25 ? "major" : "moderate", pct >= 0 ? "positive" : "negative"]);
      }
      const fundingAge = Date.now() - new Date(norm.latestFundingDate).getTime();
      if (norm.latestFundingDate && fundingAge >= 0 && fundingAge < 365 * 864e5) {
        await client.query(
          `INSERT INTO brand_signals (id, brand_company_id, signal_type, headline, detail, source, signal_date, magnitude, sentiment, ai_generated, confidence)
           VALUES (gen_random_uuid(), $1, 'funding', $2, $3, 'apollo', $4, 'moderate', 'positive', false, 'high')`,
          [companyId, `${norm.latestFundingStage || "Funding round"}${norm.totalFunding ? ` — total raised ${norm.totalFunding}` : ""}`,
           `Apollo firmographics for ${identity.domain}`, norm.latestFundingDate]);
      }
    }
    await client.query("COMMIT");
    return { status: match.status, payload: match.status === "matched" ? payload : null, reason: match.reason, fetchedAt, gapsFilled };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally { client.release(); }
}

router.get("/api/brand/:companyId/apollo-company", requireAuth, async (req: Request, res: Response) => {
  try {
    await ensureTable();
    const companyId = String(req.params.companyId);
    const company = (await pool.query(`SELECT * FROM crm_companies WHERE id = $1`, [companyId])).rows[0];
    if (!company) return res.status(404).json({ error: "Company not found" });
    const row = (await pool.query(
      `SELECT payload, fetched_at FROM brand_apollo_data WHERE company_id = $1`, [companyId])).rows[0];
    res.json({ ...brandProviderCacheResult(company, row?.payload), fetchedAt: row?.fetched_at || null });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.post("/api/brand/:companyId/apollo-company/refresh", requireAuth, async (req: Request, res: Response) => {
  try {
    res.json(await refreshApolloCompany(String(req.params.companyId)));
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

export default router;
