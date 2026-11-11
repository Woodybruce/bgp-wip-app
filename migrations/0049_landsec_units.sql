-- Migration 0049 — Landsec unit workspace fields (docs/landsec-pitch-plan.md,
-- item 2). One row per tenancy unit on a Landsec scheme holding the fields
-- Victoria's list needs that no existing table carries: who BGP reports to,
-- who checks heads of terms, the leasing plan, marketing details, legal
-- progress and the solicitor catch-up log. Everything else on the unit page
-- reads from tenancy_schedule_units, leasing_schedule_units, available_units,
-- unit_briefs and crm_deals. Additive, idempotent.

CREATE TABLE IF NOT EXISTS landsec_units (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  tenancy_unit_id varchar NOT NULL UNIQUE,
  property_id varchar NOT NULL,
  report_to_contact_id varchar,
  report_to_name text,
  hots_checker_contact_id varchar,
  hots_checker_name text,
  incentives text,
  leasing_plan text,
  marketing_details text,
  legal_progress text,
  solicitor_catchups jsonb,
  updated_by varchar,
  updated_by_name text,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_landsec_units_property ON landsec_units (property_id);
