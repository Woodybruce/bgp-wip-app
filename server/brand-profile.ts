// ─────────────────────────────────────────────────────────────────────────
// Brand profile + agent representations + brand signals API.
// Everything the BrandProfilePanel on the company detail page reads from.
// ─────────────────────────────────────────────────────────────────────────
import { Router, type Request, type Response } from "express";
import { requireAuth } from "./auth";
import { pool } from "./db";

const router = Router();

// ai_relevant is written by aiJudgeSignalRelevance (news-brand-linking) but
// read here — make sure the column exists before the first profile request.
pool.query(`ALTER TABLE brand_signals ADD COLUMN IF NOT EXISTS ai_relevant BOOLEAN`).catch(() => {});
// Expansion Intelligence v2 fact columns (Woody, 2026-08-03)
pool.query(`
  ALTER TABLE brand_signals ADD COLUMN IF NOT EXISTS geography TEXT;
  ALTER TABLE brand_signals ADD COLUMN IF NOT EXISTS confidence TEXT;
  ALTER TABLE brand_signals ADD COLUMN IF NOT EXISTS dedupe_key TEXT;
  CREATE UNIQUE INDEX IF NOT EXISTS idx_brand_signals_dedupe
    ON brand_signals(brand_company_id, dedupe_key) WHERE dedupe_key IS NOT NULL;
`).catch((e) => console.warn("[brand-signals] v2 columns:", e?.message));

// Brands whose gallery has had the duplicate-image healing sweep this boot.
const dedupeSweepFired = new Set<string>();
// Per-brand cooldown for the server-side UK-entity auto-kick below.
const entityKickFired = new Map<string, number>();
// Separate, shorter cooldown for the AML auto-kick — see its comment below.
const amlKickFired = new Map<string, number>();
// Per-brand cooldown for the fire-and-forget AI signal-relevance judge.
const signalJudgeFired = new Map<string, number>();

// Cheap ISO 3166-1 alpha-2 inference from Google Places formatted_address.
// We only get formatted_address back from Text Search (no structured
// components without an extra Place Details call), so we parse the tail.
// Falls back to null when nothing matches — the UI treats null as "Other".
const COUNTRY_TAIL_TO_ISO: Array<[RegExp, string]> = [
  [/\b(UK|United Kingdom)\.?$/i, "GB"],
  [/\bUSA\.?$/i, "US"], [/\bUnited States\.?$/i, "US"],
  [/\bFrance\.?$/i, "FR"], [/\bItaly\.?$/i, "IT"], [/\bSpain\.?$/i, "ES"],
  [/\bGermany\.?$/i, "DE"], [/\bNetherlands\.?$/i, "NL"],
  [/\bBelgium\.?$/i, "BE"], [/\bSwitzerland\.?$/i, "CH"],
  [/\bAustria\.?$/i, "AT"], [/\bIreland\.?$/i, "IE"],
  [/\bDenmark\.?$/i, "DK"], [/\bSweden\.?$/i, "SE"],
  [/\bNorway\.?$/i, "NO"], [/\bFinland\.?$/i, "FI"],
  [/\bPortugal\.?$/i, "PT"], [/\bPoland\.?$/i, "PL"],
  [/\b(UAE|United Arab Emirates)\.?$/i, "AE"],
  [/\bSaudi Arabia\.?$/i, "SA"], [/\bQatar\.?$/i, "QA"],
  [/\bJapan\.?$/i, "JP"], [/\bSouth Korea\.?$/i, "KR"],
  [/\bChina\.?$/i, "CN"], [/\bHong Kong\.?$/i, "HK"],
  [/\bSingapore\.?$/i, "SG"], [/\bThailand\.?$/i, "TH"],
  [/\bAustralia\.?$/i, "AU"], [/\bNew Zealand\.?$/i, "NZ"],
  [/\bCanada\.?$/i, "CA"], [/\bBrazil\.?$/i, "BR"], [/\bMexico\.?$/i, "MX"],
];

function inferCountryFromAddress(addr: string | null | undefined): string | null {
  if (!addr) return null;
  for (const [re, iso] of COUNTRY_TAIL_TO_ISO) if (re.test(addr.trim())) return iso;
  return null;
}

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

    // Heal galleries that picked up duplicate images before content dedupe
    // existed (same photo imported twice across refresh runs). Once per
    // brand per boot, fire-and-forget — the cleaned gallery shows on the
    // next load.
    const sweepId = String(companyId);
    if (!dedupeSweepFired.has(sweepId)) {
      dedupeSweepFired.add(sweepId);
      import("./brand-images").then(m => m.dedupeBrandImageRows(sweepId)).catch(e =>
        console.warn(`[brand-profile] image dedupe sweep failed: ${e?.message}`)
      );
    }

    // Server-side UK-entity auto-kick. The client-side auto-scrape only runs
    // for staff viewers (client research POSTs 403), so a brand first opened
    // by a client (Landsec browsing Bills) sat parked forever — no entity,
    // no Companies House number, no Covenant card. Fire the scraper here
    // instead, whoever is looking; guarded UPDATE + 6h cooldown per brand.
    if (!entityKickFired.has(sweepId) || Date.now() - entityKickFired.get(sweepId)! > 6 * 3600_000) {
      entityKickFired.set(sweepId, Date.now());
      (async () => {
        const row = (await pool.query(
          `SELECT name, domain, domain_url, backers, uk_entity_name, companies_house_number
             FROM crm_companies WHERE id = $1`, [sweepId])).rows[0];
        if (!row) return;
        let entityName: string | null = (row.uk_entity_name || "").trim() || null;
        let chNumber: string | null = (row.companies_house_number || "").trim() || null;
        if (!entityName && (row.domain || row.domain_url)) {
          const { scrapeUkEntityFromWebsite } = await import("./companies-house");
          const scraped = await scrapeUkEntityFromWebsite(row.domain || row.domain_url, { name: row.name, parentGroup: row.backers });
          if (scraped.entityName) {
            entityName = scraped.entityName;
            await pool.query(
              `UPDATE crm_companies SET uk_entity_name = $1
                WHERE id = $2 AND (uk_entity_name IS NULL OR uk_entity_name = '')`,
              [scraped.entityName, sweepId]);
          }
          if (scraped.chNumber && !chNumber) {
            chNumber = scraped.chNumber;
            await pool.query(
              `UPDATE crm_companies SET companies_house_number = $1
                WHERE id = $2 AND (companies_house_number IS NULL OR companies_house_number = '')`,
              [scraped.chNumber, sweepId]);
          }
          if (scraped.entityName || scraped.chNumber) {
            console.log(`[brand-profile] auto-identified entity for ${row.name}: ${scraped.entityName || "?"} / ${scraped.chNumber || "no CH#"}`);
          }
        }
        // Name → number bridge. Most websites state the legal entity but not
        // its registration number, so brands stalled at "entity set, covenant
        // parked" forever (WatchHouse, 2026-08-26). An exact match on the
        // registered name is unambiguous — auto-link it; anything fuzzier
        // stays a human call.
        if (entityName && !chNumber) {
          const { chFetch } = await import("./companies-house");
          const canon = (s: string) => s.toLowerCase()
            .replace(/\bltd\b\.?/g, "limited")
            .replace(/\bplc\b\.?/g, "public limited company")
            .replace(/[^a-z0-9]/g, "");
          const target = canon(entityName);
          const search = await chFetch(`/search/companies?q=${encodeURIComponent(entityName)}&items_per_page=10`);
          const hit = (search.items || []).find((i: any) =>
            i.company_status === "active" && i.company_number && canon(i.title || "") === target);
          if (hit) {
            await pool.query(
              `UPDATE crm_companies SET companies_house_number = $1
                WHERE id = $2 AND (companies_house_number IS NULL OR companies_house_number = '')`,
              [hit.company_number, sweepId]);
            console.log(`[brand-profile] auto-matched CH number for ${row.name}: ${hit.title} / ${hit.company_number}`);
          }
        }
      })().catch(e => console.warn(`[brand-profile] entity auto-kick failed: ${e?.message}`));
      // Menu / best-sellers auto-kick, same rationale: the refresh button is
      // a staff research POST, so brands first browsed by clients never got
      // their menu card. One attempt per brand per cooldown window.
      (async () => {
        const m = (await pool.query(
          `SELECT name, menu_intel FROM crm_companies WHERE id = $1`, [sweepId])).rows[0];
        if (!m || m.menu_intel) return;
        await refreshMenuIntelForCompany(sweepId);
        console.log(`[brand-profile] auto-refreshed menu intel for ${m.name}`);
      })().catch(e => console.warn(`[brand-profile] menu auto-kick skipped: ${e?.message}`));
      // Apollo firmographics auto-fetch, same no-ask rule — the card was a
      // manual "Fetch" button until 2026-08-26. Guards + 30-day freshness
      // live in apollo-company.ts.
      (async () => {
        const { autoRefreshApolloIfStale } = await import("./apollo-company");
        await autoRefreshApolloIfStale(sweepId);
      })().catch(e => console.warn(`[brand-profile] apollo auto-kick skipped: ${e?.message}`));
    }

    // AML pass self-serves on open: the nightly sweep runs oldest-first, so
    // a freshly-resolved brand sat unscreened at the back of its queue
    // (Bill's, 2026-08-18). Own 30-min guard, NOT the 6h entity-kick window
    // above — a run that recorded no outcome (pre-fix code, transient
    // ComplyAdvantage error) must retry on the next open, not tomorrow.
    // aml_pep_status flips non-empty on a completed screen, ending retries.
    if (!amlKickFired.has(sweepId) || Date.now() - amlKickFired.get(sweepId)! > 30 * 60_000) {
      amlKickFired.set(sweepId, Date.now());
      (async () => {
        const a = (await pool.query(
          `SELECT name, companies_house_number, aml_pep_status FROM crm_companies WHERE id = $1`, [sweepId])).rows[0];
        if (!a || !a.companies_house_number || (a.aml_pep_status || "").trim()) return;
        const { runAllAmlChecks } = await import("./kyc-orchestrator");
        await runAllAmlChecks(sweepId, null, null);
        console.log(`[brand-profile] auto-ran AML orchestrator for ${a.name}`);
      })().catch(e => console.warn(`[brand-profile] AML auto-kick skipped: ${e?.message}`));
    }

    // Clients may only read their OWN company's profile here. (Landsec audit.)
    const { resolveCompanyScope, isClientVisibleBrand } = await import("./company-scope");
    const bpScope = await resolveCompanyScope(req as any);
    if (bpScope && bpScope !== companyId) {
      // Clients get full Brand Intelligence on any brand they can see in
      // their CRM — the hospitality/leisure/fitness slice plus their own
      // added brands (same predicate as GET /api/crm/companies). Everything
      // else stays 403.
      if (!(await isClientVisibleBrand(String(companyId), bpScope))) {
        return res.status(403).json({ error: "Not available for this account" });
      }
    }

    const companyQ = pool.query(
      `SELECT id, name, description, company_type, companies_house_number, companies_house_data,
              domain, domain_url, head_office_address,
              linkedin_url, phone, industry, employee_count, annual_revenue, founded_year,
              kyc_status, kyc_expires_at, aml_risk_level, aml_pep_status,
              brand_group_id, parent_company_id,
              concept_pitch, store_count, rollout_status, backers, instagram_handle,
              tiktok_handle, x_handle, dept_store_presence, franchise_activity, hunter_flag,
              stock_ticker, uk_entity_name, agent_type, concept_status,
              last_accounts_doc_id, last_accounts_made_up_to,
              last_accounts_storage_key, last_accounts_fetched_at,
              annual_report_url, annual_report_storage_key, annual_report_fetched_at,
              folder_teams, sharepoint_folder_url,
              ai_generated_fields, last_enriched_at,
              bgp_contact_crm, bgp_contact_user_ids,
              brand_analysis, brand_analysis_at,
              ai_competitors, ai_competitors_at,
              menu_intel, menu_intel_at,
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
      `SELECT id, signal_type, headline, detail, source, signal_date, magnitude, sentiment, ai_generated, ai_relevant, created_at
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
              r.brand_company_id, b.name AS brand_name, (b.company_type ILIKE 'tenant%') AS is_brand
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

    // Image gallery. Pulls every column the brand profile UI needs —
    // tags is critical because the "brand-hero" pin (toggled from the
    // lightbox) reads it to decide which images go in the top banner.
    // Without tags here the UI thinks nothing is pinned even after a
    // successful PATCH. Also prefer company_id FK match (set on new
    // imports) and fall back to lowercased brand_name for older rows.
    const imagesQ = pool.query(
      `SELECT i.id, i.file_name, i.thumbnail_data, i.category, i.created_at,
              i.tags, i.mime_type, i.description, i.source, i.company_id, i.property_id
         FROM image_studio_images i
        WHERE i.company_id = $1
           OR (i.brand_name IS NOT NULL
               AND lower(i.brand_name) = (SELECT lower(name) FROM crm_companies WHERE id = $1))
        ORDER BY
          -- Hero images first so the UI doesn't have to re-sort
          ('brand-hero' = ANY(i.tags))::int DESC,
          i.created_at DESC
        LIMIT 60`,
      [companyId]
    );

    // Deals where this company is a party
    // A client sees this brand's deals only where THEIR OWN company is the
    // counterparty (landlord/vendor/purchaser) — the brand's deals with rival
    // landlords are BGP intel, not the client's to see. Staff see them all.
    const dealsClientScope = bpScope
      ? ` AND (d.landlord_id = $2 OR d.vendor_id = $2 OR d.purchaser_id = $2)`
      : "";
    const dealsQ = pool.query(
      `SELECT d.id, d.name, d.status, d.deal_type, d.stage, d.updated_at, d.exchanged_at, d.completed_at,
              CASE
                WHEN d.landlord_id  = $1 THEN 'landlord'
                WHEN d.tenant_id    = $1 THEN 'tenant'
                WHEN d.vendor_id    = $1 THEN 'vendor'
                WHEN d.purchaser_id = $1 THEN 'purchaser'
              END AS role
         FROM crm_deals d
        WHERE (d.landlord_id = $1 OR d.tenant_id = $1 OR d.vendor_id = $1 OR d.purchaser_id = $1)${dealsClientScope}
        ORDER BY d.updated_at DESC NULLS LAST LIMIT 20`,
      bpScope ? [companyId, bpScope] : [companyId]
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
            -- Two routes in: (1) the brand's OWN Google News source — that
            -- feed's query was already built for this specific brand, so its
            -- articles are in without name gymnastics (Bill's had 141 such
            -- articles and showed none, 2026-08-19); (2) name-matched
            -- articles from everywhere else, with the short-name guards.
            WHERE (
              n.source_id IN (SELECT ns.id FROM news_sources ns WHERE ns.category = 'brand:' || $1 AND ns.type = 'google_news')
              OR (
                -- Apostrophe-stripped comparison: the brand row says "Bills" but
                -- real coverage writes "Bill's" — the plain substring match never
                -- saw genuine articles, only NFL junk.
                (replace(n.title, '''', '') ILIKE '%' || replace(co.name, '''', '') || '%'
                   OR replace(coalesce(n.summary, ''), '''', '') ILIKE '%' || replace(co.name, '''', '') || '%'
                   OR replace(coalesce(n.ai_summary, ''), '''', '') ILIKE '%' || replace(co.name, '''', '') || '%')
                AND (
                  -- Long distinctive names match on their own. Short/ambiguous
                  -- names ("Bills", "Next", "Oliver") need the brand's own
                  -- domain in the URL or the brand's industry word in the
                  -- headline. The old name-at-start-of-headline allowance let
                  -- every "Bills …" NFL fixture headline through — removed.
                  length(trim(co.name)) > 8
                  OR (co.domain_url IS NOT NULL AND n.url ILIKE '%' || regexp_replace(co.domain_url, '^https?://(www\.)?', '', 'i') || '%')
                  OR (co.industry IS NOT NULL AND n.title ILIKE '%' || split_part(co.industry, ' ', 1) || '%')
                  -- Possessive form is a strong signal for short names: real
                  -- coverage writes "Bill's" (apostrophe), NFL noise writes
                  -- "Bills" — accept the exact apostrophized variant. Only for
                  -- names ending in a bare s (a name already possessive like
                  -- "Bill's" would double the apostrophe and match nothing).
                  OR (position('''' in co.name) = 0
                      AND regexp_replace(co.name, 's$', '''s') <> co.name
                      AND (n.title ILIKE '%' || regexp_replace(co.name, 's$', '''s') || '%'
                           OR coalesce(n.summary, '') ILIKE '%' || regexp_replace(co.name, 's$', '''s') || '%'))
                )
              )
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

    // Pitched-to history — leasing schedule units where this brand
    // is on the target list (target_company_ids), in target_brands
    // free text, OR already linked via the canonical tenant_company_id
    // FK (deals already in motion). One unified pitched list.
    // A client must only see this brand pitched to THEIR OWN schemes — the
    // full cross-landlord pitch list is BGP BD intel. Scope the properties to
    // the client's estate when the request is client-scoped; staff see all.
    const pitchedToScope = bpScope
      ? ` AND (p.landlord_id = $2 OR p.id IN (SELECT property_id FROM crm_company_properties WHERE company_id = $2))`
      : "";
    const pitchedToQ = pool.query(
      `SELECT u.id, u.unit_name, u.target_brands, u.status, u.priority, u.updated_at,
              p.id AS property_id, p.name AS property_name, p.address AS property_address
         FROM leasing_schedule_units u
         JOIN crm_properties p ON p.id = u.property_id
        WHERE (u.target_company_ids @> ARRAY[$1]::text[]
           OR u.tenant_company_id = $1
           OR u.target_brands ILIKE '%' || (SELECT name FROM crm_companies WHERE id = $1) || '%')${pitchedToScope}
        ORDER BY u.updated_at DESC NULLS LAST
        LIMIT 20`,
      bpScope ? [companyId, bpScope] : [companyId]
    );

    // Recent contacts — emails/meetings linked to this company
    // Interaction stats per contact — fold email/meeting counts and
    // last-touch date back into each contact row so the key-contacts
    // panel can show 'Charlotte · 18 touches · 3d ago' instead of just
    // a name. Cheaper than joining in JS later.
    const contactInteractionStatsQ = pool.query(
      `SELECT contact_id,
              COUNT(*)::int AS touches,
              MAX(interaction_date) AS last_touch
         FROM crm_interactions
        WHERE company_id = $1
        GROUP BY contact_id`,
      [companyId]
    );

    const contactsQ = pool.query(
      `SELECT ct.id, ct.name, ct.role, ct.email, ct.phone, ct.linkedin_url, ct.avatar_url,
              ct.enrichment_source, ct.last_enriched_at
         FROM crm_contacts ct
        WHERE ct.company_id = $1
        ORDER BY ct.name ASC
        LIMIT 100`,
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

    // Properties this company OWNS (as landlord) — surfaced on the
    // Ownership block of the landlord profile. lat/lng come through so
    // the same map renderer used for brand stores can plot them. Cast
    // to float because crm_properties stores coords as text.
    const ownedPropertiesQ = pool.query(
      `SELECT p.id, p.name, p.address, p.postcode, p.status, p.asset_class,
              NULLIF(p.latitude, '')::float8 AS lat,
              NULLIF(p.longitude, '')::float8 AS lng,
              (SELECT COUNT(*) FROM leasing_schedule_units u WHERE u.property_id = p.id) AS unit_count
         FROM crm_properties p
        WHERE p.landlord_id = $1
        ORDER BY p.name ASC`,
      [companyId]
    );

    // Live locations — every property where this brand is the
    // resolved tenant on at least one tenancy schedule row. The
    // canonical FK (tenant_company_id) is the source of truth; the
    // name match fallback is intentionally NOT used here, so this
    // count is honest about resolved coverage.
    const liveLocationsQ = pool.query(
      `SELECT p.id, p.name, p.address, p.postcode,
              NULLIF(p.latitude, '')::float8 AS lat,
              NULLIF(p.longitude, '')::float8 AS lng,
              COUNT(t.id) AS units,
              SUM(COALESCE(t.passing_rent_pa, 0)) AS total_rent_pa,
              MIN(t.lease_expiry) AS next_expiry
         FROM tenancy_schedule_units t
         JOIN crm_properties p ON p.id = t.property_id
        WHERE t.tenant_company_id = $1
          AND (t.status IS NULL OR t.status NOT IN ('Vacant', 'Void'))
        GROUP BY p.id
        ORDER BY units DESC, p.name`,
      [companyId]
    );

    // Latest landlord-website scrape findings (logo, share ticker, IR
    // contact, board, asset list, annual report URL). Only populated
    // after the user has hit "Sync from website" on the landlord profile.
    const landlordFindingsQ = pool.query(
      `SELECT scraped_at, source_urls, logo_url, share_ticker, ir_contact,
              board_members, annual_report_url, properties, image_urls, raw_notes, error
         FROM landlord_website_findings WHERE company_id = $1`,
      [companyId]
    ).catch(() => ({ rows: [] })); // table may not exist if module never loaded

    // Land Registry titles (CCOD / UCOD) for this company by CH number.
    // Counts every UK title where this company is proprietor 1 — the
    // authoritative answer to "what do they actually own". A landlord
    // with 0 CRM properties might have hundreds of registered titles
    // here; this block lets the user see the gap.
    const landRegistryQ = pool.query(
      `SELECT t.title_number, t.tenure, t.property_address, t.postcode, t.district,
              t.county, t.region, t.price_paid, t.date_proprietor_added, t.source
         FROM land_registry_titles t
        WHERE t.company_registration_number = (
                SELECT CASE
                  WHEN companies_house_number ~ '^[0-9]+$' THEN LPAD(companies_house_number, 8, '0')
                  ELSE UPPER(companies_house_number)
                END
                FROM crm_companies WHERE id = $1
              )
        ORDER BY t.postcode NULLS LAST, t.property_address
        LIMIT 200`,
      [companyId]
    ).catch(() => ({ rows: [] })); // table may not exist yet if CCOD never ingested

    // Discovery rows the user has dismissed from the Properties board.
    // The board filters these out so wrong/dupe finds stay hidden.
    const dismissedDiscoveriesQ = pool.query(
      `SELECT discovery_key FROM landlord_dismissed_discoveries WHERE company_id = $1`,
      [companyId]
    ).catch(() => ({ rows: [] })); // table may not exist if scraper never loaded

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
    // Same client scope as `deals` above — a client's BGP-relationship-history
    // panel only counts deals where their own company is the counterparty, not
    // the brand's deals with rival landlords. (The fee/team/internal_agent
    // columns are additionally stripped for clients in the response.)
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
        WHERE (d.tenant_id = $1 OR d.landlord_id = $1 OR d.vendor_id = $1 OR d.purchaser_id = $1)${dealsClientScope}
        ORDER BY d.updated_at DESC NULLS LAST LIMIT 20`,
      bpScope ? [companyId, bpScope] : [companyId]
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
      `SELECT id, type, direction, subject, preview, interaction_date, bgp_user, microsoft_id
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
    // A client sees this brand's upcoming lease events only in THEIR OWN
    // schemes — the brand's expiries/breaks in rival landlords' centres are
    // poaching intel, not the client's to see. Staff see all.
    const leaseEventsScope = bpScope
      ? ` AND (p.landlord_id = $2 OR p.id IN (SELECT property_id FROM crm_company_properties WHERE company_id = $2))`
      : "";
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
          )${leaseEventsScope}
        ORDER BY LEAST(COALESCE(u.lease_expiry, '9999-01-01'::date), COALESCE(u.lease_break, '9999-01-01'::date)) ASC
        LIMIT 10`,
      bpScope ? [companyId, bpScope] : [companyId]
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
        WHERE c.company_type ILIKE 'tenant%'
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
      rolloutMonthly, kycInvestigation, ownedProperties, landRegistry, landlordFindings, contactInteractionStats,
      liveLocations, dismissedDiscoveries,
    ] = await Promise.all([
      companyQ, safe(signalsQ), safe(repsForBrandQ), safe(brandsForAgentQ),
      safe(kycQ), safe(imagesQ), safe(dealsQ), safe(parentGroupQ), safe(siblingsQ), safe(newsQ),
      safe(requirementsQ), safe(pitchedToQ), safe(contactsQ), safe(storesQ), safe(turnoverQ),
      safe(rolloutVelocityQ), safe(rentCompsQ),
      safe(bgpDealsQ), safe(bgpInteractionsQ), safe(bgpInteractionsListQ), safe(decisionMakersQ), safe(leaseEventsQ), safe(competitorsQ),
      safe(rolloutMonthlyQ), safe(kycInvestigationQ), safe(ownedPropertiesQ), safe(landRegistryQ), safe(landlordFindingsQ), safe(contactInteractionStatsQ),
      safe(liveLocationsQ), safe(dismissedDiscoveriesQ),
    ]);

    if (!company.rows[0]) return res.status(404).json({ error: "Company not found" });

    const c = company.rows[0];

    // Resolve bgp_contact_user_ids → user display names + per-account
    // roles from crm_company_bgp_roles (Charlotte = Investment lead).
    let coverers: Array<{ id: string; name: string; email: string | null; role: string | null }> = [];
    if (Array.isArray(c.bgp_contact_user_ids) && c.bgp_contact_user_ids.length > 0) {
      const cov = await pool.query(
        `SELECT u.id, COALESCE(u.name, u.username, u.email) AS name, u.email,
                r.role
           FROM users u
           LEFT JOIN crm_company_bgp_roles r ON r.user_id = u.id AND r.company_id = $2
          WHERE u.id = ANY($1::text[]) ORDER BY u.name`,
        [c.bgp_contact_user_ids, companyId]
      ).catch(() => empty);
      coverers = cov.rows;
    }

    // Email senders we've corresponded with at this company's domain
    // who AREN'T yet CRM contacts. Surfaced under Key contacts so the
    // user can promote them with one click. Excludes BGP's own staff
    // (anything @brucegillinghampollard.com).
    const companyDomain = (c.domain || c.domain_url || "").toString().replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/.*$/, "").toLowerCase();
    // Derived from BGP's correspondence log (crm_interactions) — staff-only,
    // like /api/interactions and the interactions field. Clients get none.
    let pendingContactSuggestions: Array<{ email: string; touches: number; last_touch: string | null }> = [];
    if (companyDomain && !bpScope) {
      try {
        const ps = await pool.query(
          `SELECT p AS email,
                  COUNT(*)::int AS touches,
                  MAX(interaction_date) AS last_touch
             FROM crm_interactions
             CROSS JOIN LATERAL unnest(participants) AS p
            WHERE participants IS NOT NULL
              AND p ILIKE $1
              AND p NOT ILIKE '%@brucegillinghampollard.com'
              AND p NOT IN (
                SELECT LOWER(email) FROM crm_contacts
                 WHERE company_id = $2 AND email IS NOT NULL
              )
            GROUP BY p
            ORDER BY touches DESC, last_touch DESC
            LIMIT 20`,
          [`%@${companyDomain}`, companyId]
        );
        pendingContactSuggestions = ps.rows;
      } catch {
        // Older databases may not have the participants column populated —
        // not fatal; just don't surface suggestions.
      }
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
    if (/^tenant/i.test(c.company_type || "") && !c.ai_disabled && !c.brand_analysis) {
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
    const completedDeals = deals.rows.filter((d: any) => d.status === "COM" || d.status === "INV" || d.status === "completed" || d.completed_at);
    // BGP deal lifecycle: WIT (withdrawn) / COM (completed) / INV
    // (invoiced) = terminal. Anything else (REP, NEG, AGT, EXC, …) is
    // still live. Matches the /api/company-portfolio convention.
    const TERMINAL_DEAL_STATUSES = new Set(["WIT", "COM", "INV"]);
    const activeDeals = deals.rows.filter((d: any) => !TERMINAL_DEAL_STATUSES.has(String(d.status || "").toUpperCase()));

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
    const { articleLooksRelevantForBrand, aiJudgeSignalRelevance } = await import("./news-brand-linking");
    const filteredSignals = signals.rows.filter((s: any) => {
      if (s.ai_relevant === false) return false;
      // Heuristic collision filter on every type — junk reaches opening/
      // closure rows too (the classifier links cross-topic articles), and it
      // also backstops AI-judged-relevant rows the judge got wrong.
      return articleLooksRelevantForBrand(c.name, c.industry, s.headline || "", s.detail || null);
    }).slice(0, 20);

    // Any news signal Haiku hasn't judged yet gets judged in the background —
    // the hardcoded collision lists above only cover known ambiguous names,
    // so a brand like Bills can drown in "energy bills" headlines until its
    // rows are judged. Verdicts land in ai_relevant; next load drops them.
    const unjudged = signals.rows.filter((s: any) => s.ai_relevant == null);
    if (unjudged.length && (!signalJudgeFired.has(sweepId) || Date.now() - signalJudgeFired.get(sweepId)! > 6 * 3600_000)) {
      signalJudgeFired.set(sweepId, Date.now());
      aiJudgeSignalRelevance(
        { id: sweepId, name: c.name, industry: c.industry, domain: c.domain || c.domain_url },
        unjudged.map((s: any) => ({ id: s.id, headline: s.headline, detail: s.detail })),
      ).catch(() => {});
    }

    res.json({
      company: c,
      signals: filteredSignals,
      // Client accounts only see tenant-rep representation — landlord-side
      // and investment agent relationships are BGP-internal.
      representedBy: bpScope
        ? repsForBrand.rows.filter((r: any) => r.agent_type === "tenant_rep")
        : repsForBrand.rows,
      representing: brandsForAgent.rows,
      kyc: kyc.rows[0] || { doc_count: 0, last_uploaded_at: null },
      images: images.rows,
      deals: deals.rows,
      completedDeals,
      activeDeals,
      parentGroup: parentGroup.rows[0] || null,
      siblings: siblings.rows,
      // Same collision filter as the signals — the News & Media zone was
      // showing NFL fixture coverage on Bills the restaurant.
      news: (news.rows as any[]).filter((n: any) =>
        articleLooksRelevantForBrand(c.name, c.industry, n.title || n.headline || "", n.summary || null)
      ),
      requirements: requirements.rows,
      pitchedTo: pitchedTo.rows,
      liveLocations: liveLocations.rows,
      contacts: (() => {
        // Decorate each contact with interaction counts so the
        // key-contacts panel can show BGP-relationship strength.
        const statsByContact = new Map<string, { touches: number; last_touch: string | null }>();
        for (const r of contactInteractionStats.rows as any[]) {
          statsByContact.set(r.contact_id, { touches: r.touches, last_touch: r.last_touch });
        }
        return (contacts.rows as any[]).map(c => ({
          ...c,
          interaction_count: statsByContact.get(c.id)?.touches || 0,
          last_interaction_at: statsByContact.get(c.id)?.last_touch || null,
        }));
      })(),
      stores: await (async () => {
        // Tag each brand store with the nearest BGP-instructed property
        // within 150m. Lets the brand map render gold dots where BGP is
        // active rather than the generic open/closed colouring.
        const raw = stores.rows;
        const withCoords = raw.filter((s: any) => typeof s.lat === "number" && typeof s.lng === "number");
        if (withCoords.length === 0) return raw;
        try {
          // Pull every BGP-instructed property with coords. "Instructed"
          // = has at least one active deal OR an internal-agent allocation.
          // Cheap (<1k rows in practice) so we do the haversine in JS.
          const { rows: props } = await pool.query<{ id: string; name: string; lat: number; lng: number; active_deals: string }>(
            `SELECT p.id, p.name,
                    NULLIF(p.latitude, '')::float8 AS lat,
                    NULLIF(p.longitude, '')::float8 AS lng,
                    (SELECT COUNT(*)::text FROM crm_deals d
                       WHERE d.property_id = p.id
                         AND d.status NOT IN ('ARCH', 'WIT', 'INV')) AS active_deals
               FROM crm_properties p
              WHERE NULLIF(p.latitude, '') IS NOT NULL
                AND NULLIF(p.longitude, '') IS NOT NULL`
          );
          const properties = props.filter((p: any) =>
            Number.isFinite(p.lat) && Number.isFinite(p.lng)
          );
          if (properties.length === 0) return raw;

          const toRad = (d: number) => (d * Math.PI) / 180;
          const distM = (lat1: number, lng1: number, lat2: number, lng2: number) => {
            const R = 6371000;
            const dLat = toRad(lat2 - lat1);
            const dLng = toRad(lng2 - lng1);
            const a = Math.sin(dLat / 2) ** 2
              + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
            return 2 * R * Math.asin(Math.sqrt(a));
          };

          const THRESHOLD_M = 150;
          return raw.map((s: any) => {
            if (typeof s.lat !== "number" || typeof s.lng !== "number") return s;
            let best: { id: string; name: string; distance_m: number; active_deals: number } | null = null;
            for (const p of properties) {
              const d = distM(s.lat, s.lng, p.lat, p.lng);
              if (d > THRESHOLD_M) continue;
              if (!best || d < best.distance_m) {
                best = { id: p.id, name: p.name, distance_m: Math.round(d), active_deals: Number(p.active_deals) || 0 };
              }
            }
            return best ? { ...s, bgpProperty: best } : s;
          });
        } catch (e: any) {
          console.warn(`[brand-profile] BGP-property proximity tagging failed for ${companyId}:`, e?.message);
          return raw;
        }
      })(),
      ownedProperties: ownedProperties.rows,
      landRegistryTitles: landRegistry.rows,
      landlordWebsiteFindings: landlordFindings.rows[0] || null,
      dismissedDiscoveries: (dismissedDiscoveries.rows || []).map((r: any) => r.discovery_key),
      turnover: turnover.rows,
      covenant,
      coverers,
      pendingContactSuggestions,
      // Raw correspondence (subjects/previews/bgp_user) is staff-only — clients
      // get no interaction log, matching /api/interactions being sealed.
      interactions: bpScope ? [] : bgpInteractionsList.rows,
      socialStats,
      rolloutVelocity,
      rentAffordability,
      rentComps: rentComps.rows,
      // Strip BGP fee / internal team columns from the relationship-history
      // deals for client viewers (query is already counterparty-scoped above).
      bgpDeals: bpScope
        ? bgpDeals.rows.map((d: any) => { const { fee, team, internal_agent, ...rest } = d; return rest; })
        : bgpDeals.rows,
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
      "brand_group_id",
      "concept_pitch", "store_count", "rollout_status", "backers",
      "instagram_handle", "tiktok_handle", "x_handle", "dept_store_presence",
      "franchise_activity", "hunter_flag", "stock_ticker", "uk_entity_name", "agent_type",
      "concept_status",
      "domain", "domain_url",
      "folder_teams", "sharepoint_folder_url",
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
    const { brandCompanyId, agentType, region, primaryContactId, startDate, notes } = req.body || {};
    let { agentCompanyId } = req.body || {};
    if (!brandCompanyId || !agentType) {
      return res.status(400).json({ error: "brandCompanyId and agentType required" });
    }
    // Resolve the agent FIRM from the picked agent CONTACT when no company was
    // chosen — the representation table is keyed on the agent company, but the
    // user often just picks the agent person. Use the contact's own company;
    // if they have none, mint a lightweight Agent company from their name and
    // link it, so "add this agent to the brand" always lands.
    if (!agentCompanyId && primaryContactId) {
      const ct = await pool.query(`SELECT company_id, name FROM crm_contacts WHERE id = $1`, [primaryContactId]);
      agentCompanyId = ct.rows[0]?.company_id || null;
      if (!agentCompanyId && ct.rows[0]?.name) {
        const created = await pool.query(
          `INSERT INTO crm_companies (name, company_type, agent_type) VALUES ($1, 'Agent', $2) RETURNING id`,
          [`${ct.rows[0].name} (Agent)`, agentType]
        );
        agentCompanyId = created.rows[0].id;
        await pool.query(`UPDATE crm_contacts SET company_id = $1 WHERE id = $2 AND company_id IS NULL`, [agentCompanyId, primaryContactId]);
      }
    }
    if (!agentCompanyId) {
      return res.status(400).json({ error: "Pick an agent firm or an agent contact." });
    }
    const r = await pool.query(
      `INSERT INTO brand_agent_representations (brand_company_id, agent_company_id, agent_type, region, primary_contact_id, start_date, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [brandCompanyId, agentCompanyId, agentType, region || null, primaryContactId || null, startDate || null, notes || null]
    );
    // Self-heal: stamp the sub-type on the agent company so it shows in the
    // agent pickers next time (the blank agent_type is what hid it before).
    await pool.query(
      `UPDATE crm_companies SET agent_type = $1 WHERE id = $2 AND (agent_type IS NULL OR agent_type = '')`,
      [agentType, agentCompanyId]
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

// ─── Brand credit check — house covenant engine ─────────────────────────
// Served by the covenant engine (Companies House + The Gazette + filed
// accounts). Replaces the never-built Red Flag integration: GET returns the
// cached report, POST forces a fresh check and adds the brand to the watch.
async function brandCompanyNumber(companyId: string): Promise<string | null> {
  const { rows } = await pool.query(`SELECT companies_house_number FROM crm_companies WHERE id = $1`, [companyId]);
  return rows[0]?.companies_house_number || null;
}

router.get("/api/brand/:companyId/credit-check", requireAuth, async (req: Request, res: Response) => {
  try {
    const num = await brandCompanyNumber(String(req.params.companyId));
    if (!num) return res.json({ latest: null, configured: true, reason: "No Companies House number on this brand" });
    const { rows } = await pool.query(
      `SELECT report, computed_at FROM covenant_reports WHERE company_number = $1`,
      [num.trim().toUpperCase().padStart(8, "0")]
    );
    res.json({ latest: rows[0]?.report || null, computedAt: rows[0]?.computed_at || null, configured: true, provider: "house_covenant_engine" });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/brand/:companyId/credit-check", requireAuth, async (req: any, res: Response) => {
  try {
    const num = await brandCompanyNumber(String(req.params.companyId));
    if (!num) return res.status(400).json({ error: "No Companies House number on this brand — link one first" });
    const { getCovenantReport, addToWatchlist } = await import("./covenant-engine");
    const report = await getCovenantReport(num, { refresh: true });
    await addToWatchlist(num, report.companyName).catch(() => {});
    res.json({ report, provider: "house_covenant_engine" });
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
// Zero-substance brand rows for the manual cull review (Woody, 2026-08-19
// "give me the spread sheet"). Server-internal token gate (same secret as
// chatbgp-internal) — used by tooling to export the list; no session needed.
router.get("/api/brand-cull/export", async (req: Request, res: Response) => {
  try {
    const { internalStaffToken } = await import("./chatbgp-internal");
    if (req.headers["x-bgp-internal"] !== internalStaffToken()) return res.status(403).json({ error: "forbidden" });
    const { rows } = await pool.query(`
      SELECT c.id, c.name, c.industry, c.company_type, c.store_count, c.domain,
             c.instagram_handle, c.created_at, c.last_enriched_at, c.enrichment_source
        FROM crm_companies c
       WHERE c.company_type ILIKE 'tenant%'
         AND c.merged_into_id IS NULL
         AND NOT EXISTS (SELECT 1 FROM crm_deals d WHERE d.tenant_id = c.id OR d.purchaser_id = c.id)
         AND NOT EXISTS (SELECT 1 FROM crm_requirements_leasing r WHERE r.company_id = c.id)
         AND NOT EXISTS (SELECT 1 FROM crm_contacts ct WHERE ct.company_id = c.id)
         AND NOT EXISTS (SELECT 1 FROM brand_agent_representations br WHERE br.brand_company_id = c.id)
         AND NOT EXISTS (SELECT 1 FROM brand_signals bs WHERE bs.brand_company_id = c.id)
       ORDER BY lower(c.name)`);
    res.json({ count: rows.length, rows });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "failed" });
  }
});

// Apply the brand cull (Woody, 2026-08-20: "cull them all apart from riding
// house cafe"). Internal-token gated, tooling-only. Re-checks zero-substance
// SERVER-SIDE at delete time, spares excludeNames and any brand a client
// self-added (crm_extra_brand_ids), archives full row snapshots to
// brand_cull_archive before deleting, and removes orphaned news feeds.
router.post("/api/brand-cull/apply", async (req: Request, res: Response) => {
  const client = await pool.connect();
  try {
    const { internalStaffToken } = await import("./chatbgp-internal");
    if (req.headers["x-bgp-internal"] !== internalStaffToken()) return res.status(403).json({ error: "forbidden" });
    const excludeNorms: string[] = (Array.isArray(req.body?.excludeNames) ? req.body.excludeNames : [])
      .map((s: any) => String(s).toLowerCase().replace(/[^a-z0-9]/g, ""))
      .filter(Boolean);

    await client.query(`
      CREATE TABLE IF NOT EXISTS brand_cull_archive (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id VARCHAR NOT NULL,
        company_name TEXT,
        snapshot JSONB NOT NULL,
        deleted_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);

    await client.query("BEGIN");
    const sel = await client.query(
      `SELECT c.id, c.name FROM crm_companies c
        WHERE c.company_type ILIKE 'tenant%'
          AND c.merged_into_id IS NULL
          AND NOT EXISTS (SELECT 1 FROM crm_deals d WHERE d.tenant_id = c.id OR d.purchaser_id = c.id)
          AND NOT EXISTS (SELECT 1 FROM crm_requirements_leasing r WHERE r.company_id = c.id)
          AND NOT EXISTS (SELECT 1 FROM crm_contacts ct WHERE ct.company_id = c.id)
          AND NOT EXISTS (SELECT 1 FROM brand_agent_representations br WHERE br.brand_company_id = c.id)
          AND NOT EXISTS (SELECT 1 FROM brand_signals bs WHERE bs.brand_company_id = c.id)
          AND NOT EXISTS (SELECT 1 FROM crm_companies cl WHERE cl.crm_extra_brand_ids @> ARRAY[c.id::text])
          AND NOT (regexp_replace(lower(c.name), '[^a-z0-9]', '', 'g') = ANY($1::text[]))`,
      [excludeNorms]
    );
    const ids = sel.rows.map((r: any) => r.id);
    if (!ids.length) {
      await client.query("ROLLBACK");
      return res.json({ deleted: 0, spared: excludeNorms.length, names: [] });
    }
    await client.query(
      `INSERT INTO brand_cull_archive (company_id, company_name, snapshot)
       SELECT id, name, to_jsonb(c.*) FROM crm_companies c WHERE c.id = ANY($1)`,
      [ids]
    );
    await client.query(
      `DELETE FROM news_articles a USING news_sources ns
        WHERE a.source_id = ns.id AND ns.category = ANY(SELECT 'brand:' || unnest($1::varchar[]))`,
      [ids]
    );
    await client.query(
      `DELETE FROM news_sources ns WHERE ns.category = ANY(SELECT 'brand:' || unnest($1::varchar[]))`,
      [ids]
    );
    const del = await client.query(`DELETE FROM crm_companies WHERE id = ANY($1)`, [ids]);
    await client.query("COMMIT");
    console.log(`[brand-cull apply] deleted ${del.rowCount} brand row(s), archived to brand_cull_archive`);
    res.json({ deleted: del.rowCount, names: sel.rows.map((r: any) => r.name) });
  } catch (e: any) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[brand-cull apply] failed:", e?.message);
    res.status(500).json({ error: e?.message || "failed" });
  } finally {
    client.release();
  }
});

router.get("/api/brand/tracked", requireAuth, async (_req: Request, res: Response) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, store_count, rollout_status, concept_pitch,
              brand_group_id, last_enriched_at, instagram_handle
         FROM crm_companies
        WHERE company_type ILIKE 'tenant%' AND merged_into_id IS NULL
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
// Trade descriptors a CRM company name often carries but the shopfront
// doesn't ("Watchhouse Coffee" trades as "WatchHouse"; "Gymbox Fitness" as
// "Gymbox"). Used twice in researchBrandStores: stripped from the search
// query for an extra high-yield variant, and OPTIONAL in the listing-name
// match gate — requiring them rejected every real store of any brand named
// this way (WatchHouse came back "0 stores found" with 18 open sites,
// Woody 2026-08-25).
const TRADE_DESCRIPTORS = new Set([
  "coffee", "cafe", "caffe", "espresso", "roasters", "roastery", "coffeehouse",
  "bakery", "restaurant", "restaurants", "kitchen", "bar", "grill", "pizzeria",
  "eatery", "deli", "brewing", "brewery", "taproom",
  "gym", "fitness", "studio", "studios", "wellness", "spa",
  "clothing", "fashion", "apparel", "jewellery", "jewelry", "opticians",
  "store", "stores", "shop", "shops", "boutique", "supermarkets",
  "hotel", "hotels", "books", "bookshop",
]);

export async function researchBrandStores(
  companyId: string,
  opts: { scope?: "uk" | "global" } = {},
): Promise<{
  found: number; upserted: number; openCount: number; companyName: string;
  diagnostics: Array<{ step: string; outcome: string; detail?: string }>;
}> {
  const googleKey = process.env.GOOGLE_API_KEY || process.env.GOOGLE_MAPS_API_KEY;
  if (!googleKey) throw new Error("GOOGLE_API_KEY not configured");
  const scope = opts.scope === "global" ? "global" : "uk";

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
  const ukCities = [
    "London", "Manchester", "Birmingham", "Edinburgh", "Glasgow",
    "Leeds", "Liverpool", "Bristol", "Belfast", "Cardiff",
    "Newcastle", "Sheffield", "Nottingham",
  ];
  // Global hubs picked for retail / fashion / hospitality store concentration.
  // Each query yields up to ~60 results so 25 cities ≈ 1500 candidates per
  // brand (deduped by place_id). Costs a bit of Google Places quota when run
  // — that's why this is opt-in via the Research global button.
  const globalCities = [
    "New York", "Los Angeles", "Miami", "Chicago", "San Francisco",
    "Paris", "Milan", "Rome", "Madrid", "Barcelona", "Berlin", "Munich",
    "Amsterdam", "Brussels", "Zurich", "Geneva", "Vienna", "Copenhagen",
    "Stockholm", "Dublin",
    "Tokyo", "Hong Kong", "Singapore", "Seoul", "Shanghai", "Bangkok",
    "Sydney", "Melbourne", "Toronto", "Vancouver",
    "Dubai", "Abu Dhabi", "Doha", "Riyadh",
  ];
  // Query with the cleaned trading name — deal-tranche tags ("Bancone T1")
  // and parenthetical asides ("Body Fit Training (BFT)") drag Google
  // textsearch relevance down and never appear on the shopfront.
  const queryName = company.name
    .replace(/\([^)]*\)/g, " ")
    .replace(/\bT\d\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim() || company.name;
  // Shopfront name — the CRM name minus trailing trade descriptors
  // ("Watchhouse Coffee" trades as "WatchHouse"). Searched as an extra
  // query when it differs; the match gate below makes the same words
  // optional. TRADE_DESCRIPTORS is shared by both.
  const shopfrontName = queryName
    .split(/\s+/)
    .filter((w: string, i: number) => i === 0 || !TRADE_DESCRIPTORS.has(w.toLowerCase().replace(/[^a-z0-9]/g, "")))
    .join(" ")
    .trim();
  const queries = scope === "global"
    ? [
        queryName,
        ...(shopfrontName !== queryName ? [shopfrontName] : []),
        `${queryName} flagship store`,
        ...globalCities.map((c) => `${queryName} ${c}`),
      ]
    : [
        queryName,
        ...(shopfrontName !== queryName ? [shopfrontName, `${shopfrontName} London`] : []),
        `${queryName} UK`,
        ...ukCities.map((c) => `${queryName} ${c}`),
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
  // Fold diacritics (Caffè → caffe) and & → "and" (Burger & Lobster ↔
  // Burger and Lobster) before comparing — Google names and CRM names
  // disagree on both, and the old strip-non-ascii regex deleted accented
  // letters outright, so "Caffè Nero" never matched "Caffe Nero".
  const fold = (s: string) => s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const STOPWORDS = new Set([
    "and", "the", "of", "at",
    // Corporate suffixes Google never puts on the shopfront — "Prezzo Plc"
    // and "Play Padel UK" must still match "Prezzo" / "Play Padel".
    "ltd", "limited", "plc", "llp", "holdings", "holding", "group", "uk", "company", "retail",
  ]);
  const brandToken = fold(queryName);
  const allBrandWords = brandToken.split(" ").filter((w: string) => w.length > 1);
  const significantWords = allBrandWords.filter((w: string) => !STOPWORDS.has(w));
  const brandWords = significantWords.length > 0 ? significantWords : allBrandWords;
  // Words that MUST appear in the listing name: the brand words minus pure
  // trade descriptors — unless that empties the list (e.g. "Coffee Shop"),
  // in which case all words stay required.
  const nonDescriptorWords = brandWords.filter((w: string) => !TRADE_DESCRIPTORS.has(w));
  const requiredWords = nonDescriptorWords.length > 0 ? nonDescriptorWords : brandWords;
  const brandFirstWord = requiredWords[0] || brandToken;
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
    const n = fold(placeName);
    if (!n) return false;
    // Exact match or starts-with: always accept (cheap, high precision)
    if (n === brandToken || n.startsWith(brandToken + " ")) return true;
    // Multi-word requirement: every required token (descriptors excluded)
    // must appear somewhere in the place name. Catches "BrandName -
    // Westfield London" and "BrandName at Selfridges" without
    // false-positives on single-token coincidence.
    if (requiredWords.length > 1) {
      return requiredWords.every((w: string) => n.includes(w));
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
    const country = inferCountryFromAddress(p.formatted_address);
    await pool.query(
      `INSERT INTO brand_stores (brand_company_id, name, address, lat, lng, place_id, status, country, source_type, researched_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'google_places', now(), now())
       ON CONFLICT (brand_company_id, place_id) DO UPDATE SET
         name = EXCLUDED.name, address = EXCLUDED.address,
         lat = EXCLUDED.lat, lng = EXCLUDED.lng,
         status = EXCLUDED.status,
         country = COALESCE(EXCLUDED.country, brand_stores.country),
         researched_at = now(), updated_at = now()`,
      [company.id, p.name, p.formatted_address, p.geometry?.location?.lat, p.geometry?.location?.lng, p.place_id, status, country]
    ).catch(async () => {
      const exists = await pool.query(
        `SELECT id FROM brand_stores WHERE brand_company_id = $1 AND place_id = $2`,
        [company.id, p.place_id]
      );
      if (exists.rowCount === 0) {
        await pool.query(
          `INSERT INTO brand_stores (brand_company_id, name, address, lat, lng, place_id, status, country, source_type, researched_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'google_places', now())`,
          [company.id, p.name, p.formatted_address, p.geometry?.location?.lat, p.geometry?.location?.lng, p.place_id, status, country]
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

    // readPersistedImage falls back to the DB-persisted copy (and restores
    // the file to disk) when a redeploy wiped the ephemeral filesystem —
    // checking existsSync alone made every gallery tile 404 after deploys.
    const { readPersistedImage } = await import("./image-studio");
    const buf = await readPersistedImage(img.local_path);
    if (buf) {
      res.setHeader("Content-Type", img.mime_type || "image/jpeg");
      res.setHeader("Cache-Control", "public, max-age=86400");
      return res.send(buf);
    }
    if (img.thumbnail_data) {
      const buf = Buffer.from(img.thumbnail_data, "base64");
      res.setHeader("Content-Type", img.mime_type || "image/jpeg");
      res.setHeader("Cache-Control", "public, max-age=86400");
      return res.send(buf);
    }
    // No disk file, no DB copy, no thumbnail — the row is a phantom (its
    // file pre-dates DB persistence and died with a redeploy). Delete it so
    // the gallery stops advertising an image it can never show; the
    // auto-refresh re-imports a real one on its next pass.
    await pool.query(`DELETE FROM image_studio_images WHERE id = $1`, [req.params.imageId]).catch(() => {});
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
    const apiKey = process.env.GOOGLE_API_KEY || process.env.GOOGLE_MAPS_API_KEY;
    const companyId = String(req.params.companyId);

    const sendImage = (buf: Buffer, mime: string = "image/jpeg") => {
      res.setHeader("Content-Type", mime);
      res.setHeader("Cache-Control", "public, max-age=86400");
      res.send(buf);
    };

    // 1. Try Google Places Photos for the brand's most recently researched
    //    open store. These are user-uploaded photos vetted by Google and are
    //    usually high-quality flagship shots.
    if (apiKey) {
      const { rows } = await pool.query(
        `SELECT lat, lng, name, place_id FROM brand_stores
          WHERE brand_company_id = $1 AND lat IS NOT NULL AND lng IS NOT NULL
            AND status = 'open'
          ORDER BY researched_at DESC NULLS LAST LIMIT 1`,
        [companyId]
      );
      const store = rows[0];
      if (store?.place_id) {
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
          console.warn("[brand-flagship] place photo failed:", e?.message);
        }
      }
    }

    // 2. Fall back to the highest-quality auto-fetched brand image.
    //    Priority order from best to worst:
    //      - landlord-website: curated portfolio photos from the brand's
    //        own /portfolio + /our-places pages (landlord brands)
    //      - press: official press kit
    //      - wikipedia: often useful for retail brand flagship shots
    //      - homepage: basic homepage scrape
    //      - cse: paid Google Custom Search, last resort
    //    Street View NOT used — road-level snapshots looked terrible.
    //    Loop the top matches so we can skip rows whose local file has
    //    been wiped on a deploy without falling through to 204 when
    //    other valid images are sitting right behind them.
    // The banner renders this endpoint NEXT TO a gallery image — the client
    // passes ?exclude=<imageId> for the pane it's already showing so the
    // fallback can't serve the same photo twice side by side ("images are
    // in here twice", Woody).
    const excludeId = typeof req.query.exclude === "string" && req.query.exclude ? req.query.exclude : null;
    const fb = await pool.query(
      `SELECT i.local_path, i.mime_type
         FROM image_studio_images i
         JOIN crm_companies c ON LOWER(i.brand_name) = LOWER(c.name)
        WHERE c.id = $1
          AND 'brand-auto' = ANY(i.tags)
          AND ($2::text IS NULL OR i.id::text <> $2::text)
        ORDER BY
          CASE
            WHEN 'landlord-website' = ANY(i.tags) THEN 1
            WHEN 'press'            = ANY(i.tags) THEN 2
            WHEN 'wikipedia'        = ANY(i.tags) THEN 3
            WHEN 'homepage'         = ANY(i.tags) THEN 4
            WHEN 'cse'              = ANY(i.tags) THEN 5
            ELSE 6
          END,
          i.created_at DESC
        LIMIT 8`,
      [companyId, excludeId]
    );
    if (fb.rows.length > 0) {
      // readPersistedImage falls back to a DB-stored copy when the local
      // file is gone (Railway redeploys can wipe the disk). The old
      // implementation called fs.readFile directly, so deploy-evicted
      // images returned 204 even when there were stored fallbacks.
      const { readPersistedImage } = await import("./image-studio");
      for (const row of fb.rows) {
        if (!row.local_path) continue;
        try {
          const buf = await readPersistedImage(row.local_path);
          if (buf) {
            return sendImage(buf, row.mime_type || "image/jpeg");
          }
        } catch (e: any) {
          console.warn("[brand-flagship] image read failed:", e?.message);
        }
      }
    }

    return res.status(204).end();
  } catch (err: any) {
    console.error("[brand-flagship]", err.message);
    res.status(500).end();
  }
});

// Brand store research kicks off in the background so a long Google
// Places + scrape sweep (e.g. H&M with hundreds of stores) doesn't hit
// Railway's edge proxy timeout. Client polls /status until done.
router.post("/api/brand/:companyId/research-stores", requireAuth, async (req: Request, res: Response) => {
  const { startJob, getJobStatus } = await import("./brand-jobs");
  const companyId = String(req.params.companyId);
  const scope = req.body?.scope === "global" || req.query?.scope === "global" ? "global" : "uk";
  const key = `research-stores:${companyId}:${scope}`;
  const { alreadyRunning } = startJob(key, async () => {
    const out = await researchBrandStores(companyId, { scope });
    return { ...out, scope, company: { id: companyId, name: out.companyName } };
  });
  const status = getJobStatus(key);
  res.status(202).json({ accepted: true, inFlight: true, alreadyRunning, jobKey: key, startedAt: status?.startedAt });
});

router.get("/api/brand/:companyId/research-stores/status", requireAuth, async (req: Request, res: Response) => {
  const { getJobStatus } = await import("./brand-jobs");
  const scope = req.query?.scope === "global" ? "global" : "uk";
  const key = `research-stores:${req.params.companyId}:${scope}`;
  const status = getJobStatus(key);
  if (!status) return res.json({ state: "idle" });
  res.json(status);
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

// Menu / best-sellers refresh — Perplexity-sourced. F&B brands get menu
// items; retailers get best-sellers. Detection from company_type +
// industry text (keyword match). Result cached in crm_companies.menu_intel
// as { type, items:[{name,description?,price?,category?}], source_url? }.
function isFoodBrand(companyType: string | null, industry: string | null): boolean {
  const blob = `${companyType || ""} ${industry || ""}`.toLowerCase();
  return /(restaurant|cafe|café|food|f\s*&\s*b|fnb|bakery|coffee|qsr|fast.?food|dining|kitchen|pub|bar|brewery|hospitality|takeaway|dessert|ice.?cream|juice|smoothie|sandwich|pizza|burger|chicken|sushi|noodle|ramen)/.test(blob);
}

// For each menu/best-seller item without a Perplexity-provided image, run a
// Google CSE image search anywhere on the web — quality enforced via:
//   - imgSize=large + imgType=photo (no clipart / illustrations / icons)
//   - denylist of stock-photo / craft / scraper hosts
//   - brand-relevance check via looksLikeBrandImage (image must clearly
//     reference the brand by domain or distinctive name token)
// Mutates the items array in place. Silently noops if CSE env vars aren't set.
const PRODUCT_HOST_DENYLIST = [
  "pinterest.", "tumblr.", "redbubble.", "etsy.", "alamy.", "shutterstock.",
  "istockphoto.", "dreamstime.", "gettyimages.", "cartoon", "clipart",
  "fairy", "storybook", "childrens", "kindergarten", "wikiart.", "depositphotos.",
];

async function enrichMenuItemImagesWithCse(
  brandName: string,
  brandDomain: string | null,
  items: Array<{ name: string; image?: string | null }>,
): Promise<void> {
  const key = process.env.GOOGLE_CSE_KEY || process.env.GOOGLE_API_KEY;
  const cx = process.env.GOOGLE_CSE_ID;
  if (!key || !cx) {
    console.warn(`[menu-intel ${brandName}] CSE skipped — env vars missing (cx=${!!cx} key=${!!key})`);
    return;
  }

  const { looksLikeBrandImage } = await import("./brand-images");
  const cleanDomain = (brandDomain || "")
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0]
    .trim() || null;

  const isAcceptable = (link: string, page: string, title: string): boolean => {
    const linkLower = link.toLowerCase();
    const pageLower = page.toLowerCase();
    for (const bad of PRODUCT_HOST_DENYLIST) {
      if (linkLower.includes(bad) || pageLower.includes(bad)) return false;
    }
    return looksLikeBrandImage(brandName, cleanDomain, page, title);
  };

  let attempted = 0, filled = 0, errors = 0, rejected = 0;
  for (const it of items) {
    if (it.image && /^https?:\/\//i.test(it.image)) continue;
    attempted++;
    try {
      const q = cleanDomain
        ? `"${brandName}" "${it.name}" "${cleanDomain}"`
        : `"${brandName}" "${it.name}"`;
      const url = `https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(key)}&cx=${encodeURIComponent(cx)}&q=${encodeURIComponent(q)}&searchType=image&num=10&safe=active&imgSize=large&imgType=photo`;
      const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!r.ok) {
        errors++;
        const errBody = await r.text().catch(() => "");
        console.warn(`[menu-intel ${brandName}] CSE ${r.status} for "${it.name}": ${errBody.slice(0, 200)}`);
        continue;
      }
      const d: any = await r.json();
      let chosen: string | null = null;
      for (const row of d?.items || []) {
        const link = String(row?.link || "");
        const page = String(row?.image?.contextLink || "");
        const title = String(row?.title || "");
        if (link && /^https?:\/\//i.test(link) && isAcceptable(link, page, title)) {
          chosen = link;
          break;
        }
      }
      if (chosen) {
        it.image = chosen;
        filled++;
      } else if ((d?.items || []).length > 0) {
        rejected++;
      }
    } catch (err: any) {
      errors++;
      console.warn(`[menu-intel ${brandName}] CSE exception for "${it.name}": ${err?.message || err}`);
    }
  }
  console.log(`[menu-intel ${brandName}] CSE: ${filled}/${attempted} filled (${rejected} rejected by relevance filter), ${errors} errors, ${items.length} items total, domain="${cleanDomain || "(none)"}"`);
}

// Callable form — used by the refresh route below AND the profile-load
// auto-kick (a brand first opened by a client otherwise never gets its
// menu: the refresh button is a staff research POST).
export async function refreshMenuIntelForCompany(companyId: string): Promise<any> {
    const r = await pool.query(
      `SELECT id, name, company_type, industry, domain FROM crm_companies WHERE id = $1`,
      [companyId]
    );
    const c = r.rows[0];
    if (!c) throw new Error("company not found");

    const { askPerplexity, isPerplexityConfigured } = await import("./perplexity");
    if (!isPerplexityConfigured()) {
      throw new Error("Perplexity not configured");
    }

    const isFood = isFoodBrand(c.company_type, c.industry);
    const kind: "menu" | "bestsellers" = isFood ? "menu" : "bestsellers";
    const prompt = isFood
      ? `List 8 to 12 of the most popular / signature menu items at ${c.name} (UK), with a one-line description, approximate price in GBP, and a direct image URL if one is available on the brand's own website (skip stock photos / supermarket sites). Respond as JSON only: {"items":[{"name":"...","description":"...","price":"£X","image":"https://..."}],"source_url":"..."} — no prose, no markdown fences. Use null for image if you can't find a brand-hosted photo.`
      : `List 8 to 12 of the best-selling or signature products at ${c.name} (UK), with a one-line description, approximate price in GBP, category, and a direct image URL from the brand's own website if available. Respond as JSON only: {"items":[{"name":"...","description":"...","price":"£X","category":"...","image":"https://..."}],"source_url":"..."} — no prose, no markdown fences. Use null for image if you can't find a brand-hosted photo.`;

    const out = await askPerplexity(prompt, {
      systemPrompt: "You are a UK retail / hospitality analyst. Reply with valid JSON only — no markdown code fences, no commentary.",
      maxTokens: 1200,
      temperature: 0.1,
    });

    // Strip fences if Perplexity added them anyway, then parse.
    const cleaned = out.answer.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
    let parsed: { items?: any[]; source_url?: string } = {};
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      // Salvage attempt: find first { ... } block.
      const m = cleaned.match(/\{[\s\S]*\}/);
      if (m) {
        try { parsed = JSON.parse(m[0]); } catch {}
      }
    }
    const items = Array.isArray(parsed.items) ? parsed.items.slice(0, 14) : [];
    if (items.length === 0) {
      throw new Error("Couldn't parse menu items from Perplexity response");
    }

    // Fill any missing per-item image via Google Custom Search (image mode).
    // Perplexity often won't return image URLs reliably, so we run a CSE call
    // per item that came back without one. Skipped silently if CSE isn't
    // configured. ~10 calls per brand refresh = within the 100/day free tier
    // for a single refresh; bulk refreshes will burn through fast.
    await enrichMenuItemImagesWithCse(c.name, c.domain, items);

    const payload = {
      type: kind,
      items,
      source_url: parsed.source_url || out.citations[0]?.url || null,
      citations: out.citations.slice(0, 6),
    };

    await pool.query(
      `UPDATE crm_companies SET menu_intel = $1::jsonb, menu_intel_at = NOW() WHERE id = $2`,
      [JSON.stringify(payload), companyId]
    );
    return payload;
}

router.post("/api/brand/:companyId/menu-intel/refresh", requireAuth, async (req: Request, res: Response) => {
  try {
    const payload = await refreshMenuIntelForCompany(String(req.params.companyId));
    res.json({ ...payload, refreshed_at: new Date().toISOString() });
  } catch (err: any) {
    console.error(`[brand menu-intel ${req.params.companyId}]`, err?.message || err);
    const msg = String(err?.message || "");
    // Perplexity billing/limit failures came through as a bare 500 — say
    // what's actually wrong so the toast is actionable.
    if (/401|quota|exceeded|billing|credit/i.test(msg)) {
      return res.status(503).json({ error: "Perplexity account is out of credit — menu intel is paused until the Perplexity plan is topped up." });
    }
    const code = /not found/.test(msg) ? 404 : /not configured/.test(msg) ? 503 : /parse/.test(msg) ? 502 : 500;
    res.status(code).json({ error: msg || "menu-intel refresh failed" });
  }
});

export default router;
