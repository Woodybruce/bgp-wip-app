// ─────────────────────────────────────────────────────────────────────────
// Project Demeter — c.300 wet-led suburban pubs (Stonegate / Eastdil
// process; ~£300m headline; BGP advising Related/Farallon).
//
// Business plan: buy all 300 → dispose progressively over 5–10 years
// following AM initiatives (operational re-tenanting, refurbs, change of
// use, resi conversion, demolition-and-rebuild). This module is the
// underwriting + AM tracker, not a one-off tool — every column is either
// a day-one underwriting input or a live AM tracking field.
//
// Phase 1 scope (this file):
//   • Lazy CREATE TABLE IF NOT EXISTS for demeter_sites, demeter_site_events,
//     demeter_enrichment_jobs, demeter_config — keeps deploys self-healing
//     when the schema doesn't roll through migrations cleanly.
//   • Seed demeter_config with sensible defaults so the rules engine and
//     the daily spend cap are usable on first boot.
//
// Phase 1 endpoints (slice b onwards):
//   GET    /api/demeter/sites                  list with filters/sort/pagination
//   GET    /api/demeter/sites/:id              single site
//   POST   /api/demeter/sites/import           ingest Eastdil datatape (xlsx)
//   PATCH  /api/demeter/sites/:id              update bucket / AM fields
//   POST   /api/demeter/sites/:id/events       log AM event
//   GET    /api/demeter/sites/:id/events
//   POST   /api/demeter/enrich                 trigger Tier 1/2/3 enrichment
//   GET    /api/demeter/enrich/status          job queue status
//   GET    /api/demeter/portfolio/summary      bucket counts, total value
//   GET    /api/demeter/portfolio/waterfall    10-year disposal projection
//   GET    /api/demeter/export                 export to Excel (Eastdil-format)
//
// Bucket allocation runs after Tier 1 enrichment completes — the rules
// engine reads thresholds from demeter_config so they're tunable without
// a deploy. See PHASE-2 worker for the actual enrichment pipeline.
// ─────────────────────────────────────────────────────────────────────────
import type { Express } from "express";
import { pool } from "./db";

// Default tunable config the brief calls out, plus the RBAC allow-list.
// The brief left some thresholds abstract ("industry_benchmark",
// "national_avg") — sensible numeric defaults seeded here, tweak via
// SQL or a future config UI without a redeploy.
const DEFAULT_CONFIG: Record<string, { value: any; description: string }> = {
  tier1_max_daily_spend_gbp: {
    value: 200,
    description: "Hard cap on PropertyData spend per UTC day across all Demeter enrichment jobs. Worker pauses when exceeded.",
  },
  tier1_cost_per_site_gbp: {
    value: 0.5,
    description: "Approx PropertyData cost for a Tier 1 enrichment pass on one site. Used for pre-flight cost estimates.",
  },
  tier2_cost_per_site_gbp: {
    value: 2,
    description: "Approx PropertyData cost for a Tier 2 enrichment pass. Tier 2 must be triggered by an explicit user click.",
  },
  tier3_cost_per_site_gbp: {
    value: 10,
    description: "Approx PropertyData + Companies House cost for a Tier 3 deep dive. Tier 3 also auto-creates a CRM property and spawns a Property Pathway run.",
  },
  bucket_thresholds: {
    value: {
      // Rent / FMT below this ratio with RPI-linked = bucket 1 (hold for income).
      rent_to_fmt_strong: 0.45,
      // Above this ratio + weak covenant = bucket 2 (operational uplift required).
      rent_to_fmt_weak: 0.7,
      // National median household income (ONS 2024) — pubs above this in a
      // town-centre catchment favour bucket 4 alt-use.
      national_avg_household_income: 35000,
      // D&B band cap for a "weak" covenant — anything above 3 (i.e. 4/5) is weak.
      weak_covenant_dnb_max: 3,
      // Resi/redevelop trigger: estimated resi GDV / Eastdil pub value.
      resi_uplift_multiple: 1.3,
      // Min lease tail (years) before a site is considered for bucket 3
      // ("stabilised investment dispose") — anything shorter goes to bucket 2.
      min_stabilised_lease_years: 3,
    },
    description: "Numeric thresholds for the bucket allocation rules engine. See server/demeter-bucket-rules.ts (phase 2) for how they're applied.",
  },
  rbac: {
    value: {
      // Members of these teams get read+write on the board.
      allowed_teams: ["Investment"],
      // Specific named users with explicit access regardless of team. Fill in
      // production emails — placeholders here so the deploy doesn't silently
      // grant blanket access.
      allowed_emails: [
        "woody@brucegillinghampollard.com",
        "jack@brucegillinghampollard.com",
        "ollie@brucegillinghampollard.com",
        "jonny@brucegillinghampollard.com",
      ],
    },
    description: "Who can see / edit the Demeter board. Investment team + Woody/Jack/Ollie/Jonny by default per the brief; extend the email list to onboard more users.",
  },
};

let demeterTablesEnsured = false;

/**
 * Lazy schema bootstrap. Same pattern as brand_score_history /
 * client_templates — the first call to any /api/demeter endpoint runs
 * CREATE TABLE IF NOT EXISTS for all four tables and seeds default config
 * keys that don't yet exist. Idempotent.
 */
export async function ensureDemeterTables(): Promise<void> {
  if (demeterTablesEnsured) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS demeter_sites (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      site_id TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      address TEXT,
      town TEXT,
      postcode TEXT,
      county TEXT,
      region TEXT,
      lat DOUBLE PRECISION,
      lng DOUBLE PRECISION,
      google_maps_url TEXT,

      tenure TEXT,
      lease_type TEXT,
      current_rent REAL,
      rpi_linked BOOLEAN,
      lease_expiry TEXT,
      publican_name TEXT,
      publican_company_number TEXT,
      p_and_l_share_pct REAL,
      fair_maintainable_trade REAL,
      eastdil_pub_value REAL,
      eastdil_alt_use_value REAL,
      eastdil_notes TEXT,

      enrichment_tier INTEGER DEFAULT 0,
      enrichment_last_run TIMESTAMP,

      listed_status TEXT,
      conservation_area BOOLEAN,
      green_belt BOOLEAN,
      aonb BOOLEAN,
      flood_risk TEXT,
      article_4 BOOLEAN,

      area_type TEXT,
      household_income REAL,
      population_1mile INTEGER,
      ptal TEXT,

      pd_pub_value REAL,
      pd_retail_value REAL,
      pd_restaurant_value REAL,
      pd_office_value REAL,
      pd_resi_psf REAL,
      pd_resi_per_unit REAL,
      rebuild_cost REAL,

      bucket INTEGER,
      bucket_rationale TEXT,
      bucket_confidence TEXT,

      disposal_year INTEGER,
      underwritten_exit_value REAL,
      capex_required REAL,
      am_status TEXT DEFAULT 'Not started',
      am_notes TEXT,
      am_owner TEXT,

      crm_property_id VARCHAR,
      crm_intel_summary TEXT,
      pathway_run_id VARCHAR,

      created_at TIMESTAMP DEFAULT now(),
      updated_at TIMESTAMP DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_demeter_sites_postcode ON demeter_sites(postcode);
    CREATE INDEX IF NOT EXISTS idx_demeter_sites_region ON demeter_sites(region);
    CREATE INDEX IF NOT EXISTS idx_demeter_sites_bucket ON demeter_sites(bucket);
    CREATE INDEX IF NOT EXISTS idx_demeter_sites_disposal_year ON demeter_sites(disposal_year);
    CREATE INDEX IF NOT EXISTS idx_demeter_sites_crm_property_id ON demeter_sites(crm_property_id);

    CREATE TABLE IF NOT EXISTS demeter_site_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      site_id UUID NOT NULL REFERENCES demeter_sites(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL,
      event_date TEXT,
      amount REAL,
      notes TEXT,
      created_by TEXT,
      created_at TIMESTAMP DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_demeter_site_events_site_id ON demeter_site_events(site_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS demeter_enrichment_jobs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      site_id UUID NOT NULL REFERENCES demeter_sites(id) ON DELETE CASCADE,
      tier INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      api_calls_made INTEGER DEFAULT 0,
      cost_estimate REAL DEFAULT 0,
      error TEXT,
      started_at TIMESTAMP,
      finished_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_demeter_enrichment_jobs_status ON demeter_enrichment_jobs(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_demeter_enrichment_jobs_site_id ON demeter_enrichment_jobs(site_id);

    CREATE TABLE IF NOT EXISTS demeter_config (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL,
      description TEXT,
      updated_at TIMESTAMP DEFAULT now()
    );
  `);

  // Seed default config keys that don't exist yet. ON CONFLICT DO NOTHING so
  // re-running this never overwrites a value the user has tuned.
  for (const [key, { value, description }] of Object.entries(DEFAULT_CONFIG)) {
    await pool.query(
      `INSERT INTO demeter_config (key, value, description) VALUES ($1, $2, $3) ON CONFLICT (key) DO NOTHING`,
      [key, JSON.stringify(value), description]
    );
  }

  demeterTablesEnsured = true;
  console.log("[demeter] tables ensured + default config seeded");
}

/**
 * Phase 1 endpoint registration — only the bootstrap probe right now so
 * we can verify the tables exist on a deployed env. Full endpoint surface
 * (list / detail / import / enrich / portfolio / export) lands in slice b
 * onwards as separate commits.
 */
export function registerDemeterRoutes(app: Express) {
  // Bootstrap probe. GET /api/demeter/health → ensures tables exist and
  // returns config keys so we can confirm the schema is live.
  app.get("/api/demeter/health", async (_req, res) => {
    try {
      await ensureDemeterTables();
      const config = await pool.query(`SELECT key, description FROM demeter_config ORDER BY key`);
      const counts = await pool.query(`
        SELECT
          (SELECT COUNT(*)::int FROM demeter_sites) AS sites,
          (SELECT COUNT(*)::int FROM demeter_site_events) AS events,
          (SELECT COUNT(*)::int FROM demeter_enrichment_jobs) AS jobs
      `);
      res.json({
        ok: true,
        tables: ["demeter_sites", "demeter_site_events", "demeter_enrichment_jobs", "demeter_config"],
        counts: counts.rows[0] || {},
        configKeys: config.rows.map(r => ({ key: r.key, description: r.description })),
      });
    } catch (err: any) {
      console.error("[demeter] health check failed:", err?.message);
      res.status(500).json({ error: err?.message || "Demeter bootstrap failed" });
    }
  });
}
