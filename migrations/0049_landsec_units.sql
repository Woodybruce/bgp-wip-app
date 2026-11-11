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

-- Item 3: the agreed brief, signed by the Landsec leasing manager and the
-- asset manager before marketing starts. Editing the brief clears both
-- signatures.
ALTER TABLE landsec_units ADD COLUMN IF NOT EXISTS brief_use text;
ALTER TABLE landsec_units ADD COLUMN IF NOT EXISTS brief_category text;
ALTER TABLE landsec_units ADD COLUMN IF NOT EXISTS brief_ner_floor real;
ALTER TABLE landsec_units ADD COLUMN IF NOT EXISTS brief_incentive_ceiling text;
ALTER TABLE landsec_units ADD COLUMN IF NOT EXISTS brief_capex_envelope real;
ALTER TABLE landsec_units ADD COLUMN IF NOT EXISTS brief_target_brands text;
ALTER TABLE landsec_units ADD COLUMN IF NOT EXISTS brief_notes text;
ALTER TABLE landsec_units ADD COLUMN IF NOT EXISTS brief_updated_at timestamp;
ALTER TABLE landsec_units ADD COLUMN IF NOT EXISTS brief_updated_by_name text;
ALTER TABLE landsec_units ADD COLUMN IF NOT EXISTS brief_signed_leasing_by text;
ALTER TABLE landsec_units ADD COLUMN IF NOT EXISTS brief_signed_leasing_user_id varchar;
ALTER TABLE landsec_units ADD COLUMN IF NOT EXISTS brief_signed_leasing_at timestamp;
ALTER TABLE landsec_units ADD COLUMN IF NOT EXISTS brief_signed_am_by text;
ALTER TABLE landsec_units ADD COLUMN IF NOT EXISTS brief_signed_am_user_id varchar;
ALTER TABLE landsec_units ADD COLUMN IF NOT EXISTS brief_signed_am_at timestamp;

-- Item 4: the deal clock — who a deal is waiting on and what it depends on.
-- Stage and days at stage come from crm_deals + deal_audit_log; only the
-- waiting-on and dependency fields need a home of their own.
CREATE TABLE IF NOT EXISTS landsec_deal_clock (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id varchar NOT NULL UNIQUE,
  waiting_on_party text,
  waiting_on_name text,
  waiting_since timestamp,
  waiting_note text,
  depends_on_deal_id varchar,
  updated_by varchar,
  updated_by_name text,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

-- Item 5: the brand case — one per rollout brand (Jersey Mike's first):
-- the UK evidence, covenant summary, proposed Landsec units, and each
-- asset manager's response (seen / supportive / concerns / store visit).
CREATE TABLE IF NOT EXISTS landsec_brand_cases (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id varchar NOT NULL UNIQUE,
  headline text,
  uk_story text,
  covenant_summary text,
  evidence jsonb,
  proposed_units jsonb,
  status text DEFAULT 'draft',
  sent_at timestamp,
  created_by varchar,
  created_by_name text,
  updated_by varchar,
  updated_by_name text,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);
CREATE TABLE IF NOT EXISTS landsec_brand_case_responses (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id varchar NOT NULL,
  user_id varchar NOT NULL,
  user_name text,
  user_role text,
  response text NOT NULL,
  note text,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now(),
  UNIQUE (case_id, user_id)
);
