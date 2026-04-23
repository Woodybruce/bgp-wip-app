-- Property Pathway migration
--
-- Adds two new tables required by the 7-stage property investigation
-- orchestrator. Safe to re-run — uses IF NOT EXISTS everywhere.
-- Does NOT modify or drop anything that already exists.

CREATE TABLE IF NOT EXISTS property_pathway_runs (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id VARCHAR,
  address TEXT NOT NULL,
  postcode TEXT,
  current_stage INTEGER NOT NULL DEFAULT 1,
  stage_status JSONB NOT NULL DEFAULT '{}'::jsonb,
  stage_results JSONB NOT NULL DEFAULT '{}'::jsonb,
  sharepoint_folder_path TEXT,
  sharepoint_folder_url TEXT,
  model_run_id VARCHAR,
  why_buy_document_url TEXT,
  started_by VARCHAR,
  started_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now(),
  completed_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_property_pathway_runs_property_id ON property_pathway_runs(property_id);
CREATE INDEX IF NOT EXISTS idx_property_pathway_runs_updated_at ON property_pathway_runs(updated_at DESC);

CREATE TABLE IF NOT EXISTS excel_model_run_versions (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  model_run_id VARCHAR NOT NULL,
  version INTEGER NOT NULL,
  file_path TEXT NOT NULL,
  input_values JSONB,
  output_values JSONB,
  sharepoint_url TEXT,
  sharepoint_drive_item_id TEXT,
  saved_by VARCHAR,
  saved_by_name TEXT,
  notes TEXT,
  saved_at TIMESTAMP DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_excel_model_run_versions_model_run_id ON excel_model_run_versions(model_run_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_excel_model_run_versions_run_version ON excel_model_run_versions(model_run_id, version);
