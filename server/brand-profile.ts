// ─────────────────────────────────────────────────────────────────────────
// Brand profile + agent representations + brand signals API.
// Everything the BrandProfilePanel on the company detail page reads from.
// ─────────────────────────────────────────────────────────────────────────
import { Router, type Request, type Response } from "express";
import { requireAuth } from "./auth";
import { pool } from "./db";

const router = Router();

// ─── Rent affordability helper ───────────────────────────────────────────
// Returns { avgRentPsf, avgTurnoverPsf, rentToTurnoverPct, peerRentPsf, sample }.
// Falls back to null on any given field if we don't have matching data.
async function computeRentAffordability(
  brandComps: any[],
  turnoverRows: any[],
): Promise<{
  avgRentPsf: number | null;
  avgTurnoverPsf: number | null;
  rentToTurnoverPct: number | null;
  peerRentPsf: number | null;
  peerSampleSize: number;
  brandSampleSize: number;
  useClass: string | null;
} | null> {
  if (!brandComps.length) return null;

  const rentPsfs: number[] = [];
  for (const c of brandComps) {
    const v = Number(c.rent_psf_overall || c.rent_psf_nia || c.zone_a_rate);
    if (Number.isFinite(v) && v > 0) rentPsfs.push(v);
  }
  const avgRentPsf = rentPsfs.length
    ? rentPsfs.reduce((a, b) => a + b, 0) / rentPsfs.length
    : null;

  const turnoverPsfs = turnoverRows
    .map((t) => Number(t.turnover_per_sqft))
    .filter((n) => Number.isFinite(n) && n > 0);
  const avgTurnoverPsf = turnoverPsfs.length
    ? turnoverPsfs.reduce((a, b) => a + b, 0) / turnoverPsfs.length
    : null;

  const rentToTurnoverPct = (avgRentPsf && avgTurnoverPsf)
    ? (avgRentPsf / avgTurnoverPsf) * 100
    : null;

  // Peer benchmark — most frequent use_class on this brand's comps
  const useClassCounts: Record<string, number> = {};
  for (const c of brandComps) if (c.use_class) useClassCounts[c.use_class] = (useClassCounts[c.use_class] || 0) + 1;
  const topUseClass = Object.entries(useClassCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

  let peerRentPsf: number | null = null;
  let peerSampleSize = 0;
  if (topUseClass) {
    const { rows } = await pool.query(
      // crm_comps stores rent/area as text (values may be "£25.50", "1,200 sqft" etc)
      // so extract the leading numeric run before averaging.
      `SELECT AVG(NULLIF(substring(COALESCE(rent_psf_overall, rent_psf_nia, zone_a_rate) from '[0-9]+(?:\\.[0-9]+)?'), '')::numeric)::float AS avg_psf,
              COUNT(*)::int AS n
         FROM crm_comps
        WHERE use_class = $1
          AND COALESCE(rent_psf_overall, rent_psf_nia, zone_a_rate) IS NOT NULL
          AND created_at >= now() - interval '3 years'`,
      [topUseClass]
    );
    peerRentPsf = rows[0]?.avg_psf || null;
    peerSampleSize = rows[0]?.n || 0;
  }

  return {
    avgRentPsf,
    avgTurnoverPsf,
    rentToTurnoverPct,
    peerRentPsf,
    peerSampleSize,
    brandSampleSize: brandComps.length,
    useClass: topUseClass,
  };
}

// ─── Auto-create brand_stores table if it doesn't exist ─────────────────
async function ensureBrandStoresTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS brand_stores (
      id          VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      brand_company_id VARCHAR NOT NULL,
      name        TEXT NOT NULL,
      address     TEXT,
      lat         DOUBLE PRECISION,
      lng         DOUBLE PRECISION,
      place_id    TEXT,
      status      TEXT DEFAULT 'open',
      store_type  TEXT,
      notes       TEXT,
      source_type TEXT DEFAULT 'google_places',
      researched_at TIMESTAMP,
      created_at  TIMESTAMP DEFAULT now(),
      updated_at  TIMESTAMP DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS brand_stores_company_idx ON brand_stores(brand_company_id)
  `);
  // Add unique constraint for upsert — safe to run repeatedly
  await pool.query(`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'brand_stores_company_place_unique'
      ) THEN
        ALTER TABLE brand_stores ADD CONSTRAINT brand_stores_company_place_unique
          UNIQUE (brand_company_id, place_id);
      END IF;
    END $$
  `).catch(() => {});
}

// Run once on module load
ensureBrandStoresTable().catch(err =>
  console.error("[brand-profile] brand_stores table setup error:", err.message)
);

// ─── Full brand profile (one request, all sections) ─────────────────────
router.get("/api/brand/:companyId/profile", requireAuth, async (req: Request, res: Response) => {
  try {
    const { companyId } = req.params;

    const companyQ = pool.query(
      `SELECT id, name, description, company_type, companies_house_number, companies_house_data,
              domain, domain_url, head_office_address,
              linkedin_url, phone, industry, employee_count, annual_revenue, founded_year,
              kyc_status, kyc_expires_at, aml_risk_level, aml_pep_status,
              is_tracked_brand, tracking_reason, brand_group_id, parent_company_id,
              concept_pitch, store_count, rollout_status, backers, instagram_handle,
              tiktok_handle, dept_store_presence, franchise_activity, hunter_flag,
              stock_ticker, uk_entity_name, agent_type, concept_status,
              ai_generated_fields, last_enriched_at,
              bgp_contact_crm, bgp_contact_user_ids,
              brand_analysis, brand_analysis_at,
              ai_disabled,
              merged_into_id,
              letting_hunter_flag, letting_hunter_notes,
              investment_hunter_flag, investment_hunter_notes
         FROM crm_companies WHERE id = $1`,
      [companyId]
    );

    // Pull a wider window than we'll display — the relevance filter below
    // drops obvious false-positive news (Supreme Court for streetwear brand
    // "Supreme", football "Coach", etc.) and we still want 20 real signals.
    const signalsQ = pool.query(
      `SELECT id, signal_type, headline, detail, source, signal_date, magnitude, sentiment, ai_generated, created_at
         FROM brand_signals WHERE brand_company_id = $1
         ORDER BY COALESCE(signal_date, created_at) DESC LIMIT 80`,
      [companyId]
    );

    // Who represents this brand
    const repsForBrandQ = pool.query(
      `SELECT r.id, r.agent_type, r.region, r.start_date, r.end_date, r.notes,
              r.agent_company_id, a.name AS agent_name, a.domain AS agent_domain,
              r.primary_contact_id, ct.name AS contact_name, ct.email AS contact_email
         FROM brand_agent_representations r
         LEFT JOIN crm_companies a ON a.id = r.agent_company_id
         LEFT JOIN crm_contacts  ct ON ct.id = r.primary_contact_id
        WHERE r.brand_company_id = $1 AND r.end_date IS NULL
        ORDER BY r.start_date DESC NULLS LAST`,
      [companyId]
    );

    // Brands this agent represents (if this company is an agent)
    const brandsForAgentQ = pool.query(
      `SELECT r.id, r.agent_type, r.region, r.start_date,
              r.brand_company_id, b.name AS brand_name, b.is_tracked_brand
         FROM brand_agent_representations r
         LEFT JOIN crm_companies b ON b.id = r.brand_company_id
        WHERE r.agent_company_id = $1 AND r.end_date IS NULL
        ORDER BY b.name ASC`,
      [companyId]
    );

    // KYC doc count + last upload
    const kycQ = pool.query(
      `SELECT COUNT(*)::int AS doc_count,
              MAX(uploaded_at) AS last_uploaded_at
         FROM kyc_documents
        WHERE company_id = $1 AND deleted_at IS NULL`,
      [companyId]
    );

    // Image gallery
    const imagesQ = pool.query(
      `SELECT i.id, i.file_name, i.thumbnail_data, i.category, i.created_at
         FROM image_studio_images i
        WHERE i.brand_name IS NOT NULL
          AND lower(i.brand_name) = (SELECT lower(name) FROM crm_companies WHERE id = $1)
        ORDER BY i.created_at DESC LIMIT 12`,
      [companyId]
    );

    // Deals where this company is a party
    const dealsQ = pool.query(
      `SELECT d.id, d.name, d.status, d.deal_type, d.stage, d.updated_at, d.hots_completed_at,
              CASE
                WHEN d.landlord_id  = $1 THEN 'landlord'
                WHEN d.tenant_id    = $1 THEN 'tenant'
                WHEN d.vendor_id    = $1 THEN 'vendor'
                WHEN d.purchaser_id = $1 THEN 'purchaser'
              END AS role
         FROM crm_deals d
        WHERE d.landlord_id = $1 OR d.tenant_id = $1 OR d.vendor_id = $1 OR d.purchaser_id = $1
        ORDER BY d.updated_at DESC NULLS LAST LIMIT 20`,
      [companyId]
    );

    // Parent brand group (if any)
    const parentGroupQ = pool.query(
      `SELECT c.id, c.name, c.store_count
         FROM crm_companies c
        WHERE c.id = (SELECT brand_group_id FROM crm_companies WHERE id = $1)`,
      [companyId]
    );

    // Sister brands — same group
    const siblingsQ = pool.query(
      `SELECT c.id, c.name, c.store_count, c.rollout_status
         FROM crm_companies c
        WHERE c.brand_group_id = (SELECT brand_group_id FROM crm_companies WHERE id = $1)
          AND c.id <> $1
          AND c.merged_into_id IS NULL`,
      [companyId]
    );

    // News articles mentioning this brand — deduped by URL, newest per source first
    const newsQ = pool.query(
      `SELECT id, title, summary, ai_summary, url, image_url, source_name, published_at, category
         FROM (
           SELECT DISTINCT ON (n.url) n.id, n.title, n.summary, n.ai_summary, n.url, n.image_url, n.source_name, n.published_at, n.category
             FROM news_articles n,
                  (SELECT name, domain_url, domain, industry FROM crm_companies WHERE id = $1) AS co
            WHERE (n.title ILIKE '%' || co.name || '%' OR n.summary ILIKE '%' || co.name || '%'
                   OR n.ai_summary ILIKE '%' || co.name || '%')
              AND (
                length(trim(co.name)) > 8
                OR co.domain_url IS NOT NULL AND (n.url ILIKE '%' || regexp_replace(co.domain_url, '^https?://(www\.)?', '', 'i') || '%')
                OR co.industry IS NOT NULL AND n.title ILIKE '%' || split_part(co.industry, ' ', 1) || '%'
                OR n.title ~* '\\y(retail|fashion|store|brand|clothing|apparel|shop|boutique|outlet|expansion|opening|pop.up|lease|tenant|uk|london|highstreet|high street)\\y'
                OR n.summary ~* '\\y(retail|fashion|store|brand|clothing|apparel|shop|boutique|outlet|expansion|opening|pop.up|lease|tenant)\\y'
              )
            ORDER BY n.url, n.published_at DESC NULLS LAST
         ) deduped
        ORDER BY published_at DESC NULLS LAST
        LIMIT 20`,
      [companyId]
    );

    // Active requirements / pipeline
    // crm_requirements_leasing stores size/use/locations as text[] arrays
    // (no size_min/size_max/budget/use_class/location_notes columns exist).
    const requirementsQ = pool.query(
      `SELECT r.id, r.name, r.use, r.size, r.requirement_locations, r.status,
              r.created_at, r.updated_at
         FROM crm_requirements_leasing r
        WHERE r.company_id = $1
        ORDER BY CASE WHEN r.status = 'Active' THEN 0 ELSE 1 END, r.updated_at DESC NULLS LAST
        LIMIT 10`,
      [companyId]
    );

    // Pitched-to history — leasing schedule units where this brand appears in target_brands or target_company_ids
    const pitchedToQ = pool.query(
      `SELECT u.id, u.unit_name, u.target_brands, u.status, u.priority, u.updated_at,
              p.id AS property_id, p.name AS property_name, p.address AS property_address
         FROM leasing_schedule_units u
         JOIN crm_properties p ON p.id = u.property_id
        WHERE u.target_company_ids @> ARRAY[$1]::text[]
           OR u.target_brands ILIKE '%' || (SELECT name FROM crm_companies WHERE id = $1) || '%'
        ORDER BY u.updated_at DESC NULLS LAST
        LIMIT 20`,
      [companyId]
    );

    // Recent contacts — emails/meetings linked to this company
    const contactsQ = pool.query(
      `SELECT ct.id, ct.name, ct.role, ct.email, ct.phone, ct.linkedin_url, ct.avatar_url,
              ct.enrichment_source, ct.last_enriched_at
         FROM crm_contacts ct
        WHERE ct.company_id = $1
        ORDER BY ct.name ASC
        LIMIT 20`,
      [companyId]
    );

    // Geocoded stores
    const storesQ = pool.query(
      `SELECT id, name, address, lat, lng, place_id, status, store_type, notes, source_type, researched_at
         FROM brand_stores
        WHERE brand_company_id = $1
        ORDER BY name ASC`,
      [companyId]
    );

    // Turnover data — most recent per period
    const turnoverQ = pool.query(
      `SELECT period, turnover, turnover_per_sqft, confidence, source, notes
         FROM turnover_data
        WHERE company_id = $1
        ORDER BY period DESC NULLS LAST
        LIMIT 5`,
      [companyId]
    );

    // Rollout velocity — openings minus closures in last 12m from brand_signals
    const rolloutVelocityQ = pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE signal_type = 'opening') ::int AS openings_12m,
         COUNT(*) FILTER (WHERE signal_type = 'closure') ::int AS closures_12m
         FROM brand_signals
        WHERE brand_company_id = $1
          AND COALESCE(signal_date, created_at) >= now() - interval '12 months'`,
      [companyId]
    );

    // Rent comps where this brand is the tenant (match on name or contact_company)
    // Used for rent affordability calc (rent ÷ turnover_per_sqft)
    const rentCompsQ = pool.query(
      `SELECT c.id, c.tenant, c.area_sqft, c.headline_rent, c.rent_psf_overall,
              c.rent_psf_nia, c.zone_a_rate, c.use_class, c.postcode,
              c.completion_date, c.rent_review_pattern
         FROM crm_comps c,
              (SELECT name FROM crm_companies WHERE id = $1) AS co
        WHERE (c.tenant ILIKE co.name OR c.contact_company ILIKE co.name)
          AND COALESCE(c.rent_psf_overall, c.rent_psf_nia, c.zone_a_rate) IS NOT NULL
        ORDER BY c.completion_date DESC NULLS LAST, c.created_at DESC LIMIT 20`,
      [companyId]
    );

    // BGP relationship history — all deals where this company appears + interactions count.
    // Used to show "we've done 3 deals with them, last email 2 weeks ago".
    const bgpDealsQ = pool.query(
      `SELECT d.id, d.name, d.deal_type, d.status, d.fee,
              d.team, d.internal_agent,
              d.created_at, d.updated_at,
              CASE
                WHEN d.tenant_id = $1 THEN 'tenant'
                WHEN d.landlord_id = $1 THEN 'landlord'
                WHEN d.vendor_id = $1 THEN 'vendor'
                WHEN d.purchaser_id = $1 THEN 'purchaser'
              END AS party_role,
              p.name AS property_name
         FROM crm_deals d
         LEFT JOIN crm_properties p ON p.id = d.property_id
        WHERE d.tenant_id = $1 OR d.landlord_id = $1 OR d.vendor_id = $1 OR d.purchaser_id = $1
        ORDER BY d.updated_at DESC NULLS LAST LIMIT 20`,
      [companyId]
    );
    const bgpInteractionsQ = pool.query(
      `SELECT COUNT(*) ::int AS total,
              MAX(interaction_date) AS last_at,
              COUNT(*) FILTER (WHERE interaction_date >= now() - interval '90 days') ::int AS last_90d
         FROM crm_interactions
        WHERE company_id = $1`,
      [companyId]
    );

    const bgpInteractionsListQ = pool.query(
      `SELECT id, type, direction, subject, preview, interaction_date, bgp_user
         FROM crm_interactions
        WHERE company_id = $1
        ORDER BY interaction_date DESC NULLS LAST LIMIT 12`,
      [companyId]
    );

    // Monthly rollout buckets — store openings and closures per month for last 12 months
    const rolloutMonthlyQ = pool.query(
      `WITH months AS (
         SELECT generate_series(date_trunc('month', now() - interval '11 months'), date_trunc('month', now()), interval '1 month') AS month
       )
       SELECT
         to_char(m.month, 'YYYY-MM') AS month,
         COALESCE(SUM(CASE WHEN s.signal_type = 'opening' THEN 1 ELSE 0 END), 0) ::int AS openings,
         COALESCE(SUM(CASE WHEN s.signal_type = 'closure' THEN 1 ELSE 0 END), 0) ::int AS closures
       FROM months m
       LEFT JOIN brand_signals s ON date_trunc('month', COALESCE(s.signal_date, s.created_at)) = m.month
         AND s.brand_company_id = $1
       GROUP BY m.month
       ORDER BY m.month`,
      [companyId]
    );

    // Decision-maker contacts — all contacts with enrichment_source, role, tier ranking.
    // Returned unsorted limit 20; client tiers into Store Dev / C-suite / Other.
    const decisionMakersQ = pool.query(
      `SELECT id, name, role, email, phone, linkedin_url, avatar_url, last_enriched_at, enrichment_source,
              CASE
                WHEN role ILIKE '%property%' OR role ILIKE '%real estate%' OR role ILIKE '%estates%'
                  OR role ILIKE '%acquisition%' OR role ILIKE '%expansion%' OR role ILIKE '%store%'
                  OR role ILIKE '%uk director%' OR role ILIKE '%uk manager%' OR role ILIKE '%country manager%'
                THEN 1
                WHEN role ILIKE '%ceo%' OR role ILIKE '%chief executive%' OR role ILIKE '%managing director%'
                  OR role ILIKE '%coo%' OR role ILIKE '%cfo%' OR role ILIKE '%cmo%'
                  OR role ILIKE '%chief operat%' OR role ILIKE '%chief financial%' OR role ILIKE '%chief marketing%'
                  OR role ILIKE '%founder%' OR role ILIKE '%president%'
                THEN 2
                WHEN role ILIKE '%director%' OR role ILIKE '%head of%' OR role ILIKE '%vp %' OR role ILIKE '%vice president%'
                THEN 3
                ELSE 4
              END AS tier
         FROM crm_contacts
        WHERE company_id = $1
        ORDER BY
          CASE
            WHEN role ILIKE '%property%' OR role ILIKE '%real estate%' OR role ILIKE '%estates%'
              OR role ILIKE '%acquisition%' OR role ILIKE '%expansion%' OR role ILIKE '%store%'
              OR role ILIKE '%uk director%' OR role ILIKE '%uk manager%' OR role ILIKE '%country manager%'
            THEN 1
            WHEN role ILIKE '%ceo%' OR role ILIKE '%chief executive%' OR role ILIKE '%managing director%'
              OR role ILIKE '%founder%' OR role ILIKE '%president%'
            THEN 2
            WHEN role ILIKE '%director%' OR role ILIKE '%head of%' OR role ILIKE '%vp %'
            THEN 3
            ELSE 4
          END,
          last_enriched_at DESC NULLS LAST,
          name ASC
        LIMIT 20`,
      [companyId]
    );

    // Lease-expiry radar — leasing schedule units occupied by this brand with events in next 18 months.
    const leaseEventsQ = pool.query(
      `SELECT u.id, u.unit_name, u.tenant_name, u.lease_expiry, u.lease_break, u.rent_review,
              p.id AS property_id, p.name AS property_name
         FROM leasing_schedule_units u
         JOIN crm_properties p ON p.id = u.property_id,
              (SELECT name FROM crm_companies WHERE id = $1) AS co
        WHERE u.tenant_name ILIKE co.name
          AND (
            (u.lease_expiry IS NOT NULL AND u.lease_expiry BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '18 months')
            OR (u.lease_break IS NOT NULL AND u.lease_break BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '18 months')
          )
        ORDER BY LEAST(COALESCE(u.lease_expiry, '9999-01-01'::date), COALESCE(u.lease_break, '9999-01-01'::date)) ASC
        LIMIT 10`,
      [companyId]
    );

    // Competitor cluster — other tracked brands in same use class (derived from rent comps)
    const competitorsQ = pool.query(
      `WITH me AS (
         SELECT DISTINCT use_class FROM crm_comps
          WHERE (tenant ILIKE (SELECT name FROM crm_companies WHERE id = $1)
             OR contact_company ILIKE (SELECT name FROM crm_companies WHERE id = $1))
            AND use_class IS NOT NULL
          LIMIT 3
       )
       SELECT DISTINCT c.id, c.name, c.store_count, c.rollout_status
         FROM crm_companies c
         JOIN crm_comps cm ON (cm.tenant ILIKE c.name OR cm.contact_company ILIKE c.name)
        WHERE c.is_tracked_brand = true
          AND c.id <> $1
          AND c.merged_into_id IS NULL
          AND cm.use_class IN (SELECT use_class FROM me)
        LIMIT 8`,
      [companyId]
    );

    // Latest KYC investigation for this company — provides Experian data
    const kycInvestigationQ = pool.query(
      `SELECT result->'experian' AS experian
         FROM kyc_investigations
        WHERE crm_company_id = $1
        ORDER BY conducted_at DESC LIMIT 1`,
      [companyId]
    );

    const empty = { rows: [] };
    const safe = (p: Promise<any>) => p.catch((e: any) => { console.error("[brand-profile] query failed:", e?.message); return empty; });
    const [
      company, signals, repsForBrand, brandsForAgent,
      kyc, images, deals, parentGroup, siblings, news,
      requirements, pitchedTo, contacts, stores, turnover,
      rolloutVelocityRow, rentComps,
      bgpDeals, bgpInteractions, bgpInteractionsList, decisionMakers, leaseEvents, competitors,
      rolloutMonthly, kycInvestigation,
    ] = await Promise.all([
      companyQ, safe(signalsQ), safe(repsForBrandQ), safe(brandsForAgentQ),
      safe(kycQ), safe(imagesQ), safe(dealsQ), safe(parentGroupQ), safe(siblingsQ), safe(newsQ),
      safe(requirementsQ), safe(pitchedToQ), safe(contactsQ), safe(storesQ), safe(turnoverQ),
      safe(rolloutVelocityQ), safe(rentCompsQ),
      safe(bgpDealsQ), safe(bgpInteractionsQ), safe(bgpInteractionsListQ), safe(decisionMakersQ), safe(leaseEventsQ), safe(competitorsQ),
      safe(rolloutMonthlyQ), safe(kycInvestigationQ),
    ]);

    if (!company.rows[0]) return res.status(404).json({ error: "Company not found" });

    const c = company.rows[0];

    // Resolve bgp_contact_user_ids → user display names
    let coverers: Array<{ id: string; name: string; email: string | null }> = [];
    if (Array.isArray(c.bgp_contact_user_ids) && c.bgp_contact_user_ids.length > 0) {
      const cov = await pool.query(
        `SELECT id, COALESCE(name, username, email) AS name, email
           FROM users WHERE id = ANY($1::text[]) ORDER BY name`,
        [c.bgp_contact_user_ids]
      ).catch(() => empty);
      coverers = cov.rows;
    }

    // Latest social-stats per platform — sub-query to skip if table missing
    let socialStats: Array<{ platform: string; followers: number | null; fetched_at: string | null }> = [];
    try {
      const sx = await pool.query(
        `SELECT DISTINCT ON (platform) platform, followers, fetched_at
           FROM brand_social_stats
          WHERE brand_company_id = $1
          ORDER BY platform, fetched_at DESC`,
        [companyId]
      );
      socialStats = sx.rows;
    } catch { /* table doesn't exist yet — first run */ }

    // Fire-and-forget: if tracked brand has no analysis yet, generate one
    // in the background so next load picks it up. Respects AI on/off.
    if (c.is_tracked_brand && !c.ai_disabled && !c.brand_analysis) {
      (async () => {
        try {
          const { refreshBrandAnalysis } = await import("./brand-analysis");
          await refreshBrandAnalysis(c.id, true);
        } catch (err: any) {
          console.error("[brand-profile] background analysis failed:", err.message);
        }
      })();
    }

    // Extract covenant data from Companies House JSONB
    const chData = c.companies_house_data;
    const chProfile = chData?.profile || {};
    const chAddress = chProfile.registered_office_address || chProfile.registeredOfficeAddress || null;
    const chAddressStr = chAddress
      ? [chAddress.address_line_1, chAddress.address_line_2, chAddress.locality, chAddress.region, chAddress.postal_code]
          .filter(Boolean).join(", ")
      : null;

    const chOfficers: any[] = (chData?.officers || [])
      .filter((o: any) => !o.resignedOn && !o.resigned_on)
      .map((o: any) => ({
        name: o.name,
        role: o.officerRole || o.officer_role || null,
        appointedOn: o.appointedOn || o.appointed_on || null,
        nationality: o.nationality || null,
        occupation: o.occupation || null,
      }));

    const covenant = chData ? {
      companyStatus: chProfile.companyStatus || null,
      accountsOverdue: chProfile.accountsOverdue || false,
      confirmationStatementOverdue: chProfile.confirmationStatementOverdue || false,
      hasInsolvencyHistory: chProfile.hasInsolvencyHistory || false,
      hasCharges: chProfile.hasCharges || false,
      lastAccountsMadeUpTo: chProfile.lastAccountsMadeUpTo || null,
      dateOfCreation: chProfile.dateOfCreation || null,
      checkedAt: chData.checkedAt || null,
      registeredAddress: chAddressStr,
      officers: chOfficers,
      // Derive traffic light: green = active + no issues, amber = warning, red = insolvency/dissolved
      trafficLight: chProfile.hasInsolvencyHistory
        ? "red"
        : chProfile.companyStatus === "active" && !chProfile.accountsOverdue
          ? "green"
          : "amber",
      experian: kycInvestigation.rows[0]?.experian || chData.experian || null,
    } : null;

    // Deal ledger summary
    const completedDeals = deals.rows.filter((d: any) => d.status === "completed" || d.hots_completed_at);
    const activeDeals = deals.rows.filter((d: any) => d.status === "active" || d.status === "in_progress" || d.stage === "negotiation");

    // Rollout velocity — signed net from brand_signals, plus store-count trend from brand_stores
    const velocityRow = rolloutVelocityRow.rows[0] || { openings_12m: 0, closures_12m: 0 };
    const openStores = stores.rows.filter((s: any) => s.status === "open").length;
    const closedStores = stores.rows.filter((s: any) => s.status === "closed").length;
    const rolloutVelocity = {
      openings12m: Number(velocityRow.openings_12m) || 0,
      closures12m: Number(velocityRow.closures_12m) || 0,
      net12m: (Number(velocityRow.openings_12m) || 0) - (Number(velocityRow.closures_12m) || 0),
      currentOpen: openStores,
      currentClosed: closedStores,
      monthly: rolloutMonthly.rows.map((r: any) => ({
        month: r.month,
        openings: r.openings,
        closures: r.closures,
      })),
    };

    // Rent affordability — rent psf ÷ turnover psf averaged across brand comps,
    // benchmarked against peer comps in the same use_class.
    const rentAffordability = await computeRentAffordability(
      rentComps.rows,
      turnover.rows,
    );

    // Space preferences — aggregate from this brand's rent comps
    // (median sqft, use class mix, typical rent psf).
    const spacePreferences = (() => {
      const sizes = rentComps.rows.map((r: any) => Number(r.area_sqft)).filter((n: number) => n > 0);
      const rents = rentComps.rows
        .map((r: any) => Number(r.rent_psf_overall ?? r.rent_psf_nia ?? r.zone_a_rate))
        .filter((n: number) => n > 0);
      const useClasses = rentComps.rows.map((r: any) => r.use_class).filter(Boolean);
      const useClassCounts: Record<string, number> = {};
      for (const uc of useClasses) useClassCounts[uc] = (useClassCounts[uc] || 0) + 1;
      const topUseClass = Object.entries(useClassCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
      const median = (arr: number[]) => {
        if (!arr.length) return null;
        const sorted = [...arr].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
      };
      return {
        sampleSize: rentComps.rows.length,
        sqftMin: sizes.length ? Math.min(...sizes) : null,
        sqftMax: sizes.length ? Math.max(...sizes) : null,
        sqftMedian: median(sizes),
        rentPsfMin: rents.length ? Math.min(...rents) : null,
        rentPsfMax: rents.length ? Math.max(...rents) : null,
        rentPsfMedian: median(rents),
        topUseClass,
      };
    })();

    // BGP relationship summary — deals count, fees, last-touch aggregate
    const bgpSummary = (() => {
      const rows = bgpDeals.rows;
      const completed = rows.filter((d: any) => (d.status || "").toLowerCase().includes("complet") || (d.status || "").toLowerCase().includes("won"));
      const totalFees = rows.reduce((acc: number, d: any) => acc + (Number(d.fee) || 0), 0);
      const bgpTeam = new Set<string>();
      for (const d of rows) {
        for (const t of (d.team || [])) bgpTeam.add(t);
        for (const a of (d.internal_agent || [])) bgpTeam.add(a);
      }
      const lastInteraction = bgpInteractions.rows[0] || {};
      return {
        totalDeals: rows.length,
        completedDeals: completed.length,
        totalFees,
        team: Array.from(bgpTeam),
        interactionsTotal: lastInteraction.total || 0,
        interactionsLast90d: lastInteraction.last_90d || 0,
        lastInteractionAt: lastInteraction.last_at || null,
      };
    })();

    // Re-apply the news relevance filter at read time so historical noise
    // (US Supreme Court articles, football coach articles, etc.) drops out
    // even before the next news refresh runs to delete them properly.
    const { articleLooksRelevantForBrand } = await import("./news-brand-linking");
    const filteredSignals = signals.rows.filter((s: any) => {
      if (s.signal_type !== "news") return true;
      return articleLooksRelevantForBrand(c.name, c.industry, s.headline || "", s.detail || null);
    }).slice(0, 20);

    res.json({
      company: c,
      signals: filteredSignals,
      representedBy: repsForBrand.rows,
      representing: brandsForAgent.rows,
      kyc: kyc.rows[0] || { doc_count: 0, last_uploaded_at: null },
      images: images.rows,
      deals: deals.rows,
      completedDeals,
      activeDeals,
      parentGroup: parentGroup.rows[0] || null,
      siblings: siblings.rows,
      news: news.rows,
      requirements: requirements.rows,
      pitchedTo: pitchedTo.rows,
      contacts: contacts.rows,
      stores: stores.rows,
      turnover: turnover.rows,
      covenant,
      coverers,
      interactions: bgpInteractionsList.rows,
      socialStats,
      rolloutVelocity,
      rentAffordability,
      rentComps: rentComps.rows,
      bgpDeals: bgpDeals.rows,
      bgpSummary,
      decisionMakers: decisionMakers.rows,
      leaseEvents: leaseEvents.rows,
      competitors: competitors.rows,
      spacePreferences,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Update brand-specific fields ───────────────────────────────────────
router.patch("/api/brand/:companyId", requireAuth, async (req: Request, res: Response) => {
  try {
    const { companyId } = req.params;
    const body = req.body || {};
    const allowed = [
      "is_tracked_brand", "tracking_reason", "brand_group_id",
      "concept_pitch", "store_count", "rollout_status", "backers",
      "instagram_handle", "tiktok_handle", "dept_store_presence",
      "franchise_activity", "hunter_flag", "stock_ticker", "uk_entity_name", "agent_type",
      "concept_status",
    ];
    const sets: string[] = [];
    const vals: any[] = [];
    let i = 1;
    for (const key of allowed) {
      const camel = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
      const v = key in body ? body[key] : (camel in body ? body[camel] : undefined);
      if (v !== undefined) {
        sets.push(`${key} = $${i++}`);
        vals.push(v);
      }
    }
    if (!sets.length) return res.status(400).json({ error: "no fields to update" });

    sets.push(`ai_generated_fields = (
      SELECT CASE WHEN ai_generated_fields IS NULL THEN NULL
                  ELSE ai_generated_fields - ARRAY[${allowed.filter(k => (k in body) || (k.replace(/_([a-z])/g, (_, c) => c.toUpperCase()) in body)).map(k => `'${k}'`).join(",") || "''"}]::text[]
             END
      FROM crm_companies WHERE id = $${i})`);
    sets.push(`updated_at = now()`);
    vals.push(companyId);

    await pool.query(
      `UPDATE crm_companies SET ${sets.join(", ")} WHERE id = $${i}`,
      vals
    );
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Agent representations CRUD ─────────────────────────────────────────
router.post("/api/brand/representations", requireAuth, async (req: Request, res: Response) => {
  try {
    const { brandCompanyId, agentCompanyId, agentType, region, primaryContactId, startDate, notes } = req.body || {};
    if (!brandCompanyId || !agentCompanyId || !agentType) {
      return res.status(400).json({ error: "brandCompanyId, agentCompanyId, agentType required" });
    }
    const r = await pool.query(
      `INSERT INTO brand_agent_representations (brand_company_id, agent_company_id, agent_type, region, primary_contact_id, start_date, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [brandCompanyId, agentCompanyId, agentType, region || null, primaryContactId || null, startDate || null, notes || null]
    );
    res.json(r.rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.patch("/api/brand/representations/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const body = req.body || {};
    const allowed = ["agent_type", "region", "primary_contact_id", "start_date", "end_date", "notes"];
    const sets: string[] = [];
    const vals: any[] = [];
    let i = 1;
    for (const key of allowed) {
      const camel = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
      const v = key in body ? body[key] : (camel in body ? body[camel] : undefined);
      if (v !== undefined) {
        sets.push(`${key} = $${i++}`);
        vals.push(v);
      }
    }
    if (!sets.length) return res.status(400).json({ error: "no fields" });
    sets.push(`updated_at = now()`);
    vals.push(id);
    await pool.query(`UPDATE brand_agent_representations SET ${sets.join(", ")} WHERE id = $${i}`, vals);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/api/brand/representations/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    await pool.query(`DELETE FROM brand_agent_representations WHERE id = $1`, [req.params.id]);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Brand signals CRUD ─────────────────────────────────────────────────
router.post("/api/brand/signals", requireAuth, async (req: Request, res: Response) => {
  try {
    const { brandCompanyId, signalType, headline, detail, source, signalDate, magnitude, sentiment, aiGenerated } = req.body || {};
    if (!brandCompanyId || !signalType || !headline) {
      return res.status(400).json({ error: "brandCompanyId, signalType, headline required" });
    }
    const r = await pool.query(
      `INSERT INTO brand_signals (brand_company_id, signal_type, headline, detail, source, signal_date, magnitude, sentiment, ai_generated)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [brandCompanyId, signalType, headline, detail || null, source || null, signalDate || null, magnitude || null, sentiment || null, !!aiGenerated]
    );
    res.json(r.rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/api/brand/signals/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    await pool.query(`DELETE FROM brand_signals WHERE id = $1`, [req.params.id]);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Stock snapshot + 3-month price history for a brand ─────────────────
router.get("/api/brand/:companyId/stock", requireAuth, async (req: Request, res: Response) => {
  try {
    const { companyId } = req.params;
    const { rows } = await pool.query(
      `SELECT stock_ticker FROM crm_companies WHERE id = $1`,
      [companyId]
    );
    const ticker = rows[0]?.stock_ticker;
    if (!ticker) return res.json({ snapshot: null, history: [] });
    const { getStockSnapshot, getHistoricalPrices } = await import("./stock-price");
    const [snapshot, history] = await Promise.all([
      getStockSnapshot(ticker),
      getHistoricalPrices(ticker),
    ]);
    res.json({ snapshot, history });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Ticker auto-suggest by brand name ───────────────────────────────────
router.get("/api/brand/:companyId/ticker-suggest", requireAuth, async (req: Request, res: Response) => {
  try {
    const { companyId } = req.params;
    const { rows } = await pool.query(
      `SELECT name FROM crm_companies WHERE id = $1`,
      [companyId]
    );
    const name = rows[0]?.name;
    if (!name) return res.json({ suggestions: [] });
    const { searchTicker } = await import("./stock-price");
    const suggestions = await searchTicker(name);
    res.json({ suggestions });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Tracked brands list ─────────────────────────────────────────────────
router.get("/api/brand/tracked", requireAuth, async (_req: Request, res: Response) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, tracking_reason, store_count, rollout_status, concept_pitch,
              brand_group_id, last_enriched_at, instagram_handle
         FROM crm_companies
        WHERE is_tracked_brand = true AND merged_into_id IS NULL
        ORDER BY name ASC`
    );
    res.json({ brands: rows });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Brand stores: list ──────────────────────────────────────────────────
router.get("/api/brand/:companyId/stores", requireAuth, async (req: Request, res: Response) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM brand_stores WHERE brand_company_id = $1 ORDER BY name ASC`,
      [req.params.companyId]
    );
    res.json({ stores: rows });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Brand stores: research via Google Places ────────────────────────────
// Uses Google Places Text Search to find all UK stores for a brand, then
// geocodes and upserts them into brand_stores.
// Look up UK stores for a brand via Google Places. Upserts into brand_stores
// and updates store_count. Used both by the manual endpoint and the
// auto-enrichment scheduler. Throws if GOOGLE_API_KEY is missing.
//
// Diagnostics shape mirrors the KYC re-resolver — caller surfaces these in
// the toast/console so a "0 stores found" result is debuggable without
// scraping logs.
export async function researchBrandStores(companyId: string): Promise<{
  found: number; upserted: number; openCount: number; companyName: string;
  diagnostics: Array<{ step: string; outcome: string; detail?: string }>;
}> {
  const googleKey = process.env.GOOGLE_API_KEY;
  if (!googleKey) throw new Error("GOOGLE_API_KEY not configured");

  const { rows } = await pool.query(
    `SELECT id, name, domain FROM crm_companies WHERE id = $1`,
    [companyId]
  );
  if (!rows[0]) throw new Error("Company not found");
  const company = rows[0];
  const diagnostics: Array<{ step: string; outcome: string; detail?: string }> = [];

  // Query plan — was just London + "UK" suffix, which heavily under-counts
  // any chain with stores outside London. Now: bare brand name (highest
  // yield), then major UK retail cities. Each query is paginated up to
  // 3 pages × 20 = 60 results, deduped by place_id across queries.
  const cities = [
    "London", "Manchester", "Birmingham", "Edinburgh", "Glasgow",
    "Leeds", "Liverpool", "Bristol", "Belfast", "Cardiff",
    "Newcastle", "Sheffield", "Nottingham",
  ];
  const queries = [
    company.name,
    `${company.name} UK`,
    ...cities.map((c) => `${company.name} ${c}`),
  ];
  const allResults: any[] = [];
  const seenPlaceIds = new Set<string>();
  // Per-query counters so the diagnostics show exactly where matches came
  // from (if "Abercrombie & Fitch Manchester" returns 0 raw, we want to know).
  const queryStats: Record<string, { raw: number; kept: number }> = {};
  // Sample of rejected names (first 10) — if all matches are being filtered
  // by isBrandMatch, the diagnostic surfaces what we threw away so the gate
  // can be loosened mid-incident.
  const rejectedSamples: string[] = [];

  // Brand-match gate — token-based, not strict prefix. Old code required the
  // place name to LITERALLY start with the brand token, which rejected real
  // listings like "BrandName at Selfridges" or "BrandName - Westfield". Now:
  // the place name must contain the brand's first significant word, and
  // none of the noise compound-words (pizza/tyres/cleaning/etc) for
  // single-word brands.
  const brandToken = company.name.toLowerCase().replace(/[^a-z0-9& ]+/g, "").trim();
  const brandFirstWord = brandToken.split(" ")[0] || brandToken;
  const brandWords = brandToken.split(" ").filter((w) => w.length > 1);
  const NOISE = new Set([
    "pizza","tyres","tyre","cars","car","hire","cleaning","plumbing",
    "gym","fitness","kebab","chicken","fried","fish","chips","pharmacy",
    "tile","tiles","blinds","carpet","carpets","windows","kitchens",
    "construction","builders","scaffolding","bakery","barbers","salon",
    "nails","beauty","dental","dentist","optician","physio","laundry",
    "taxi","cabs","minicabs","limo","party","tools","plant","plants",
    "garden","gardens","logistics","couriers","express","cash","loans",
    "insurance","mortgages","accountants","solicitors","estates",
    "lettings","properties","property","grocery","market","food","foods",
    "supermarket","off-licence","newsagent","convenience","dry","wash",
  ]);
  const isBrandMatch = (placeName: string): boolean => {
    const n = placeName.toLowerCase().replace(/[^a-z0-9& ]+/g, "").trim();
    if (!n) return false;
    // Exact match or starts-with: always accept (cheap, high precision)
    if (n === brandToken || n.startsWith(brandToken + " ")) return true;
    // Multi-word brand: require all significant tokens to appear somewhere
    // in the place name. Catches "BrandName - Westfield London" and
    // "BrandName at Selfridges" without false-positives on single-token coincidence.
    if (brandWords.length > 1) {
      return brandWords.every((w) => n.includes(w));
    }
    // Single-word brand: brand must appear as a word, and no noise compound
    // immediately after (avoids "Supreme Pizza", "Coach Hire", etc.).
    const re = new RegExp(`\\b${brandFirstWord}\\b(?:\\s+(\\S+))?`);
    const m = n.match(re);
    if (!m) {
      // Slug fallback: handles brands stored as slugs e.g. "andotherstories"
      // matching a Google Places result "& Other Stories". Normalise & → "and"
      // then strip non-alphanumeric before comparing.
      const slugify = (s: string) => s.replace(/&/g, "and").replace(/[^a-z0-9]/g, "");
      const bSlug = slugify(brandToken);
      const nSlug = slugify(n);
      return !!(bSlug && (nSlug === bSlug || nSlug.startsWith(bSlug)));
    }
    const next = (m[1] || "").replace(/[^a-z0-9]/g, "");
    if (next && NOISE.has(next)) return false;
    return true;
  };

  let lastApiStatus = "";
  for (const q of queries) {
    queryStats[q] = { raw: 0, kept: 0 };
    let nextPage: string | null = null;
    let page = 0;
    do {
      const url = nextPage
        ? `https://maps.googleapis.com/maps/api/place/textsearch/json?pagetoken=${nextPage}&key=${googleKey}`
        : `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(q)}&region=uk&key=${googleKey}`;
      const r = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (!r.ok) {
        diagnostics.push({ step: "places_query", outcome: "http_error", detail: `${q}: ${r.status} ${r.statusText}` });
        break;
      }
      const data: any = await r.json();
      // Google returns status="OK" | "ZERO_RESULTS" | "OVER_QUERY_LIMIT" |
      // "REQUEST_DENIED" | "INVALID_REQUEST". REQUEST_DENIED on every query
      // = key/billing issue → would otherwise be silent.
      lastApiStatus = data.status || "?";
      if (data.status === "REQUEST_DENIED" || data.status === "OVER_QUERY_LIMIT") {
        diagnostics.push({ step: "places_query", outcome: data.status.toLowerCase(), detail: data.error_message || `${q}: blocked by Google` });
        break;
      }
      const results = data.results || [];
      queryStats[q].raw += results.length;
      for (const p of results) {
        if (seenPlaceIds.has(p.place_id)) continue;
        // UK detection: accept "UK", "United Kingdom", "GB", UK postcode,
        // or England/Scotland/Wales/Northern Ireland in address.
        // We use region=uk but Google still sometimes omits the country suffix.
        const addr: string = p.formatted_address || "";
        const inUk = /\b(UK|United Kingdom|GB|England|Scotland|Wales|Northern Ireland)\b/.test(addr)
          || /\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/.test(addr); // UK postcode
        if (!inUk) {
          if (rejectedSamples.length < 10) rejectedSamples.push(`[non-UK addr] ${p.name}: ${addr}`);
          continue;
        }
        if (!isBrandMatch(p.name || "")) {
          if (rejectedSamples.length < 10) rejectedSamples.push(p.name || "(no name)");
          continue;
        }
        seenPlaceIds.add(p.place_id);
        allResults.push(p);
        queryStats[q].kept++;
      }
      nextPage = data.next_page_token || null;
      page++;
      if (nextPage && page < 3) await new Promise(r => setTimeout(r, 2000));
    } while (nextPage && page < 3);
  }

  // Surface query-level breakdown so "0 stores found" is never silent.
  const nonZero = Object.entries(queryStats).filter(([, s]) => s.raw > 0);
  if (nonZero.length === 0) {
    diagnostics.push({ step: "places_summary", outcome: "all_queries_empty", detail: `Google API returned 0 results across ${queries.length} queries (last status: ${lastApiStatus || "no response"}). Check GOOGLE_API_KEY billing/quota.` });
  } else {
    diagnostics.push({
      step: "places_summary",
      outcome: allResults.length > 0 ? "ok" : "all_filtered",
      detail: `${allResults.length} kept / ${nonZero.reduce((acc, [, s]) => acc + s.raw, 0)} raw across ${nonZero.length}/${queries.length} non-empty queries. Top: ${nonZero.slice(0, 5).map(([q, s]) => `"${q}" ${s.kept}/${s.raw}`).join(", ")}`,
    });
    if (allResults.length === 0 && rejectedSamples.length > 0) {
      diagnostics.push({ step: "places_summary", outcome: "rejected_samples", detail: `Match gate rejected: ${rejectedSamples.slice(0, 5).join(" · ")}` });
    }
  }

  let upserted = 0;
  for (const p of allResults) {
    const businessStatus = p.business_status || "OPERATIONAL";
    const status = businessStatus === "OPERATIONAL" ? "open"
      : businessStatus === "CLOSED_PERMANENTLY" ? "closed"
      : "unconfirmed";
    await pool.query(
      `INSERT INTO brand_stores (brand_company_id, name, address, lat, lng, place_id, status, source_type, researched_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'google_places', now(), now())
       ON CONFLICT (brand_company_id, place_id) DO UPDATE SET
         name = EXCLUDED.name, address = EXCLUDED.address,
         lat = EXCLUDED.lat, lng = EXCLUDED.lng,
         status = EXCLUDED.status, researched_at = now(), updated_at = now()`,
      [company.id, p.name, p.formatted_address, p.geometry?.location?.lat, p.geometry?.location?.lng, p.place_id, status]
    ).catch(async () => {
      const exists = await pool.query(
        `SELECT id FROM brand_stores WHERE brand_company_id = $1 AND place_id = $2`,
        [company.id, p.place_id]
      );
      if (exists.rowCount === 0) {
        await pool.query(
          `INSERT INTO brand_stores (brand_company_id, name, address, lat, lng, place_id, status, source_type, researched_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'google_places', now())`,
          [company.id, p.name, p.formatted_address, p.geometry?.location?.lat, p.geometry?.location?.lng, p.place_id, status]
        );
      }
    });
    upserted++;
  }

  const openCount = allResults.filter(p => (p.business_status || "OPERATIONAL") === "OPERATIONAL").length;
  if (allResults.length > 0) {
    await pool.query(
      `UPDATE crm_companies SET store_count = $1, updated_at = now() WHERE id = $2 AND (store_count IS NULL OR store_count < $1)`,
      [openCount, company.id]
    );
  }

  return { found: allResults.length, upserted, openCount, companyName: company.name, diagnostics };
}

// Gallery image by ID — serves image from local disk for authenticated users.
// (The image-studio full route is admin-only; this one is for brand profile panel.)
router.get("/api/brand/gallery-image/:imageId", requireAuth, async (req: Request, res: Response) => {
  try {
    const { rows } = await pool.query(
      `SELECT local_path, mime_type, thumbnail_data FROM image_studio_images WHERE id = $1`,
      [req.params.imageId]
    );
    const img = rows[0];
    if (!img) return res.status(404).end();

    const fs = await import("fs");
    if (img.local_path && fs.existsSync(img.local_path)) {
      res.setHeader("Content-Type", img.mime_type || "image/jpeg");
      res.setHeader("Cache-Control", "public, max-age=86400");
      return res.sendFile(img.local_path);
    }
    if (img.thumbnail_data) {
      const buf = Buffer.from(img.thumbnail_data, "base64");
      res.setHeader("Content-Type", img.mime_type || "image/jpeg");
      res.setHeader("Cache-Control", "public, max-age=86400");
      return res.send(buf);
    }
    res.status(404).end();
  } catch (err: any) {
    res.status(500).end();
  }
});

// Street View image of the brand's flagship store — picks the first cached
// Google Places store with coords and proxies Google's Street View Static
// API. Cached 24h client-side. Returns 204 when no suitable store exists.
// Flagship banner — try Google Places Photo first (real user/business photos
// of the storefront), fall back to Street View. Both are sized 1600 wide so
// the panel banner stays sharp on retina displays.
router.get("/api/brand/:companyId/flagship-image", requireAuth, async (req: Request, res: Response) => {
  try {
    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) return res.status(204).end();

    const { rows } = await pool.query(
      `SELECT lat, lng, name, place_id FROM brand_stores
        WHERE brand_company_id = $1 AND lat IS NOT NULL AND lng IS NOT NULL
          AND status = 'open'
        ORDER BY researched_at DESC NULLS LAST LIMIT 1`,
      [req.params.companyId]
    );
    const store = rows[0];
    if (!store) return res.status(204).end();

    const sendImage = (buf: Buffer) => {
      res.setHeader("Content-Type", "image/jpeg");
      res.setHeader("Cache-Control", "public, max-age=86400");
      res.send(buf);
    };

    // 1. Try Place Photos — usually much better quality than Street View.
    if (store.place_id) {
      try {
        const detailsUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(store.place_id)}&fields=photos&key=${apiKey}`;
        const detailsResp = await fetch(detailsUrl);
        if (detailsResp.ok) {
          const details = await detailsResp.json();
          const photoRef = details?.result?.photos?.[0]?.photo_reference;
          if (photoRef) {
            const photoUrl = `https://maps.googleapis.com/maps/api/place/photo?maxwidth=1600&photo_reference=${encodeURIComponent(photoRef)}&key=${apiKey}`;
            const photoResp = await fetch(photoUrl);
            if (photoResp.ok) {
              return sendImage(Buffer.from(await photoResp.arrayBuffer()));
            }
          }
        }
      } catch (e: any) {
        console.warn("[brand-flagship] place photo failed, falling back to street view:", e?.message);
      }
    }

    // 2. Street View fallback — 1600x600 for sharp retina rendering.
    const params = new URLSearchParams({
      size: "1600x600",
      location: `${store.lat},${store.lng}`,
      fov: "80",
      pitch: "0",
      key: apiKey,
    });
    const resp = await fetch(`https://maps.googleapis.com/maps/api/streetview?${params.toString()}`);
    if (!resp.ok) return res.status(204).end();
    return sendImage(Buffer.from(await resp.arrayBuffer()));
  } catch (err: any) {
    console.error("[brand-flagship]", err.message);
    res.status(500).end();
  }
});

router.post("/api/brand/:companyId/research-stores", requireAuth, async (req: Request, res: Response) => {
  try {
    const companyId = String(req.params.companyId);
    const out = await researchBrandStores(companyId);
    res.json({ ...out, company: { id: companyId, name: out.companyName } });
  } catch (err: any) {
    console.error("[research-stores]", err.message);
    const status = err.message === "Company not found" ? 404 : err.message.includes("GOOGLE_API_KEY") ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
});

// ─── Brand stores: manual add/update/delete ──────────────────────────────
router.post("/api/brand/:companyId/stores", requireAuth, async (req: Request, res: Response) => {
  try {
    const { name, address, lat, lng, placeId, status, storeType, notes } = req.body || {};
    if (!name) return res.status(400).json({ error: "name required" });
    const { rows } = await pool.query(
      `INSERT INTO brand_stores (brand_company_id, name, address, lat, lng, place_id, status, store_type, notes, source_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'manual') RETURNING *`,
      [req.params.companyId, name, address || null, lat || null, lng || null, placeId || null,
       status || "open", storeType || null, notes || null]
    );
    res.json(rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/api/brand/stores/:storeId", requireAuth, async (req: Request, res: Response) => {
  try {
    await pool.query(`DELETE FROM brand_stores WHERE id = $1`, [req.params.storeId]);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
