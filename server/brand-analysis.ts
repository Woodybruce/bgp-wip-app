// Automatic AI brand analysis — generates a short briefing paragraph that
// summarises a brand's investability as a tenant for BGP deals. Runs on
// the auto-enrichment scheduler; there's no manual trigger. Output is
// cached on crm_companies.brand_analysis and refreshed at most every
// 14 days (or when the data behind it has materially changed).
import { pool } from "./db";
import { callClaude, CHATBGP_HELPER_MODEL } from "./utils/anthropic-client";

const STALE_AFTER_DAYS = 14;

function fmt(n: number | null | undefined, digits = 0) {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  return Number(n).toFixed(digits);
}

export async function generateBrandAnalysis(companyId: string): Promise<string | null> {
  const { rows } = await pool.query(
    `SELECT id, name, concept_pitch, store_count, rollout_status, backers,
            kyc_status, aml_risk_level,
            companies_house_data
       FROM crm_companies WHERE id = $1`,
    [companyId]
  );
  const c = rows[0];
  if (!c) return null;

  const [velocity, turnover, comps, signals, deals] = await Promise.all([
    pool.query(
      `SELECT COUNT(*) FILTER (WHERE signal_type = 'opening') ::int AS openings_12m,
              COUNT(*) FILTER (WHERE signal_type = 'closure') ::int AS closures_12m
         FROM brand_signals
        WHERE brand_company_id = $1
          AND COALESCE(signal_date, created_at) >= now() - interval '12 months'`,
      [companyId]
    ),
    pool.query(
      `SELECT period, turnover FROM turnover_data WHERE company_id = $1 ORDER BY period DESC LIMIT 3`,
      [companyId]
    ),
    pool.query(
      // crm_comps stores rent/area as text (values may be "£25.50", "1,200 sqft" etc)
      // so extract the leading numeric run before averaging.
      `SELECT AVG(NULLIF(substring(COALESCE(rent_psf_overall, rent_psf_nia, zone_a_rate) from '[0-9]+(?:\\.[0-9]+)?'), '')::numeric)::real AS avg_psf,
              AVG(NULLIF(substring(area_sqft from '[0-9]+(?:\\.[0-9]+)?'), '')::numeric)::real AS avg_sqft,
              MODE() WITHIN GROUP (ORDER BY use_class) AS use_class,
              COUNT(*)::int AS n
         FROM crm_comps
        WHERE (tenant ILIKE (SELECT name FROM crm_companies WHERE id = $1)
           OR contact_company ILIKE (SELECT name FROM crm_companies WHERE id = $1))
          AND COALESCE(rent_psf_overall, rent_psf_nia, zone_a_rate) IS NOT NULL`,
      [companyId]
    ),
    pool.query(
      `SELECT signal_type, headline, signal_date
         FROM brand_signals
        WHERE brand_company_id = $1
        ORDER BY COALESCE(signal_date, created_at) DESC LIMIT 5`,
      [companyId]
    ),
    pool.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE status ILIKE '%complet%' OR status ILIKE '%won%')::int AS completed
         FROM crm_deals WHERE tenant_id = $1 OR landlord_id = $1`,
      [companyId]
    ),
  ]);

  const v = velocity.rows[0] || {};
  const net12m = (Number(v.openings_12m) || 0) - (Number(v.closures_12m) || 0);
  const compRow = comps.rows[0] || {};
  const dealRow = deals.rows[0] || {};
  const chProfile = (c.companies_house_data as any)?.profile || {};

  const context = {
    name: c.name,
    concept: c.concept_pitch || "(unknown)",
    storeCount: c.store_count,
    rollout: c.rollout_status || "(unknown)",
    backers: c.backers || "(none listed)",
    openings12m: v.openings_12m || 0,
    closures12m: v.closures_12m || 0,
    net12m,
    chStatus: chProfile.companyStatus || "(unknown)",
    insolvencyHistory: !!chProfile.hasInsolvencyHistory,
    latestTurnover: turnover.rows[0]?.turnover ? `£${(turnover.rows[0].turnover / 1_000_000).toFixed(1)}m (${turnover.rows[0].period})` : "(unknown)",
    avgRentPsf: compRow.avg_psf ? `£${fmt(compRow.avg_psf)} psf` : "(unknown)",
    avgSqft: compRow.avg_sqft ? `${Math.round(compRow.avg_sqft)} sqft` : "(unknown)",
    useClass: compRow.use_class || "(unknown)",
    compSample: compRow.n || 0,
    recentSignals: signals.rows.map((s: any) => `${s.signal_type}: ${s.headline}`).slice(0, 3),
    bgpDeals: dealRow.total || 0,
    bgpCompletedDeals: dealRow.completed || 0,
    kycStatus: c.kyc_status || "pending",
    amlRisk: c.aml_risk_level || "not assessed",
  };

  const prompt = `You are an analyst writing a briefing for a UK commercial property agent (BGP) about a retail/hospitality tenant.

Brand: ${context.name}
Concept: ${context.concept}
UK stores: ${context.storeCount ?? "unknown"} · Rollout: ${context.rollout}
Net store change (12m): ${context.net12m > 0 ? "+" : ""}${context.net12m} (${context.openings12m} opened, ${context.closures12m} closed)
Ownership: ${context.backers}
Companies House: ${context.chStatus}${context.insolvencyHistory ? " (has insolvency history)" : ""}
Latest turnover: ${context.latestTurnover}
Typical deal: ${context.avgSqft} at ${context.avgRentPsf} · use class ${context.useClass} · based on ${context.compSample} comps
BGP history: ${context.bgpDeals} deals (${context.bgpCompletedDeals} completed)
KYC: ${context.kycStatus} · AML risk: ${context.amlRisk}
Recent signals: ${context.recentSignals.join("; ") || "none"}

Write a 3-sentence briefing paragraph (max 90 words total) for a broker deciding whether to pitch an available unit to this brand. Cover:
1. Their current expansion posture and financial health in one sentence.
2. What kind of space they typically take and what they pay, in one sentence.
3. A concrete recommendation — pitch aggressively / selectively / avoid / not enough data — in one sentence.

Be specific with numbers. Do not use bullet points or headings. Do not start with "Here is" or similar — just the paragraph.`;

  try {
    const completion = await callClaude({
      model: CHATBGP_HELPER_MODEL,
      max_completion_tokens: 300,
      temperature: 0.3,
      messages: [{ role: "user", content: prompt }],
    });
    const text = completion.choices?.[0]?.message?.content?.trim();
    if (!text) return null;
    return text;
  } catch (err: any) {
    console.error(`[brand-analysis] ${context.name} failed:`, err.message);
    return null;
  }
}

export async function refreshBrandAnalysis(companyId: string, force = false): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT brand_analysis_at FROM crm_companies WHERE id = $1`,
    [companyId]
  );
  if (!rows[0]) return false;
  if (!force && rows[0].brand_analysis_at) {
    const ageMs = Date.now() - new Date(rows[0].brand_analysis_at).getTime();
    if (ageMs < STALE_AFTER_DAYS * 24 * 60 * 60 * 1000) return false;
  }
  const analysis = await generateBrandAnalysis(companyId);
  if (!analysis) return false;
  await pool.query(
    `UPDATE crm_companies SET brand_analysis = $1, brand_analysis_at = NOW(), updated_at = NOW() WHERE id = $2`,
    [analysis, companyId]
  );
  return true;
}

// Refresh a small batch of tracked brands whose analysis is stale or missing.
// Called from runAutoEnrichmentCycle.
export async function refreshStaleBrandAnalyses(limit = 3): Promise<{ processed: number; refreshed: number }> {
  const { rows } = await pool.query(
    `SELECT id FROM crm_companies
      WHERE is_tracked_brand = true
        AND (ai_disabled IS NULL OR ai_disabled = FALSE)
        AND merged_into_id IS NULL
        AND (brand_analysis_at IS NULL OR brand_analysis_at < NOW() - INTERVAL '${STALE_AFTER_DAYS} days')
      ORDER BY brand_analysis_at ASC NULLS FIRST
      LIMIT $1`,
    [limit]
  );
  let refreshed = 0;
  for (const r of rows) {
    try {
      if (await refreshBrandAnalysis(r.id, true)) refreshed++;
    } catch (err: any) {
      console.error("[brand-analysis] refresh error:", err.message);
    }
  }
  return { processed: rows.length, refreshed };
}
