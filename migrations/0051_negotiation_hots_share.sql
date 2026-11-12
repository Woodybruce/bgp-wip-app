-- Letting Tracker (Woody, 2026-11-12): the negotiation log on an offer, the
-- Heads of Terms flow (template, generate from the agreed offer, amend, sign
-- off, issue, final upload converts the deal to Solicitors), and sharing a
-- unit with a brand. Additive and safe to run again.

-- 1. Negotiation log -------------------------------------------------------
-- unit_offers keeps the CURRENT position of a bid; unit_offer_rounds keeps
-- every position it has been through, tenant offer and landlord counter.
ALTER TABLE unit_offers ADD COLUMN IF NOT EXISTS updated_at timestamp;
ALTER TABLE unit_offers ADD COLUMN IF NOT EXISTS agreed_at timestamp;
ALTER TABLE unit_offers ADD COLUMN IF NOT EXISTS agreed_by_user_id varchar;
ALTER TABLE unit_offers ADD COLUMN IF NOT EXISTS agreed_by_name text;
ALTER TABLE unit_offers ADD COLUMN IF NOT EXISTS rent_review text;
ALTER TABLE unit_offers ADD COLUMN IF NOT EXISTS rent_deposit text;
ALTER TABLE unit_offers ADD COLUMN IF NOT EXISTS turnover_rent_pct real;

CREATE TABLE IF NOT EXISTS unit_offer_rounds (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id varchar NOT NULL,
  unit_id varchar NOT NULL,
  round_no integer NOT NULL,
  party text NOT NULL,                 -- 'tenant' (their offer) | 'landlord' (our counter)
  round_date text NOT NULL,            -- yyyy-mm-dd
  rent_pa real,
  rent_free_months real,
  term_years real,
  break_option text,
  incentives text,
  premium real,
  fitting_out_contribution real,
  rent_review text,
  rent_deposit text,
  turnover_rent_pct real,
  note text,
  created_by_user_id varchar,
  created_by_name text,
  created_at timestamp DEFAULT now(),
  updated_at timestamp
);
CREATE INDEX IF NOT EXISTS idx_unit_offer_rounds_offer ON unit_offer_rounds (offer_id, round_no);
CREATE INDEX IF NOT EXISTS idx_unit_offer_rounds_unit ON unit_offer_rounds (unit_id);

-- 2. Heads of Terms flow ---------------------------------------------------
-- The text itself stays in available_units.hots_content (and the property's
-- standard in crm_properties.hots_template). These columns carry the flow.
ALTER TABLE available_units ADD COLUMN IF NOT EXISTS hots_version integer DEFAULT 0;
ALTER TABLE available_units ADD COLUMN IF NOT EXISTS hots_offer_id varchar;
ALTER TABLE available_units ADD COLUMN IF NOT EXISTS hots_agreed_at timestamp;
ALTER TABLE available_units ADD COLUMN IF NOT EXISTS hots_issued_at timestamp;
ALTER TABLE available_units ADD COLUMN IF NOT EXISTS hots_issued_by_name text;
ALTER TABLE available_units ADD COLUMN IF NOT EXISTS hots_final_file_id varchar;
ALTER TABLE available_units ADD COLUMN IF NOT EXISTS hots_final_at timestamp;
ALTER TABLE available_units ADD COLUMN IF NOT EXISTS hots_final_by_name text;

-- One row per person on the unit's Targeting Brief who has agreed the HOTs.
-- A signature counts only while `version` equals the unit's hots_version.
CREATE TABLE IF NOT EXISTS unit_hots_signoffs (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id varchar NOT NULL,
  brief_person_id varchar NOT NULL,
  version integer NOT NULL,
  agreed_at timestamp NOT NULL DEFAULT now(),
  agreed_by_user_id varchar,
  agreed_by_name text
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_unit_hots_signoffs_person ON unit_hots_signoffs (unit_id, brief_person_id);

-- What happened to the HOTs, in order: generated, amended, agreed, issued,
-- final uploaded, converted to Solicitors.
CREATE TABLE IF NOT EXISTS unit_hots_events (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id varchar NOT NULL,
  kind text NOT NULL,
  body text,
  version integer,
  author_user_id varchar,
  author_name text,
  author_role text,
  created_at timestamp DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_unit_hots_events_unit ON unit_hots_events (unit_id, created_at);

-- 3. Share a unit with a brand ---------------------------------------------
CREATE TABLE IF NOT EXISTS unit_shares (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id varchar NOT NULL,
  company_id varchar,
  company_name text,
  contact_id varchar,
  contact_name text,
  contact_email text,
  included jsonb,                      -- the tick list as sent
  mode text NOT NULL,                  -- 'pdf' | 'email'
  subject text,
  message text,
  pack_storage_key text,               -- the single PDF, when one was made
  pack_file_name text,
  email_draft_url text,                -- the Outlook draft, when one was made
  created_by_user_id varchar,
  created_by_name text,
  created_at timestamp DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_unit_shares_unit ON unit_shares (unit_id, created_at);
