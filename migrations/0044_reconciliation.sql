-- Migration 0044 — Account reconciliation tables (Delivery 2)
--
-- account_reconciliation_baselines holds the official destination list an
-- account is checked against (e.g. Hammerson's published destinations);
-- account_reconciliation_runs stores a snapshot per generated report.
--
-- The Hammerson seed rows are inserted by server/account-reconciliation.ts
-- (baseline rows are keyed to a company_id, which migrations can't know).
-- All additive, idempotent.

CREATE TABLE IF NOT EXISTS account_reconciliation_baselines (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id text NOT NULL,               -- the account this baseline belongs to (Hammerson row id)
  baseline_name text NOT NULL,            -- 'hammerson-official-destinations'
  destination_name text NOT NULL,         -- official name as published
  official_group_key text,                -- e.g. 'bullring-grand-central' — NULL when standalone
  expected_crm_property_count int NOT NULL DEFAULT 1,  -- 2 for Bullring & Grand Central
  category text NOT NULL DEFAULT 'destination',        -- destination | development | disposed
  country text,                           -- ISO-2 from the official source
  source_url text,
  source_date date,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_account_recon_baselines_company
  ON account_reconciliation_baselines(company_id, baseline_name);

CREATE TABLE IF NOT EXISTS account_reconciliation_runs (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id text NOT NULL,
  baseline_name text NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),
  generated_by text,
  rows jsonb NOT NULL                     -- one object per baseline row; see server/account-reconciliation.ts
);
CREATE INDEX IF NOT EXISTS idx_account_recon_runs_company
  ON account_reconciliation_runs(company_id, baseline_name, generated_at DESC);
