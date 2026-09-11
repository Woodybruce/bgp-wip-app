-- Migration 0024 — Menu / best-sellers intel
--
-- Cache for the "what does this brand actually sell" panel on the brand
-- profile. Restaurants / cafés get menu items; retailers get best
-- sellers; auto-switched by agent_type/company_type at render time.
-- Refreshed monthly via Perplexity. Single JSONB blob to keep the
-- schema flat — shape is {type, items[], refreshed_at, source_url}.

ALTER TABLE crm_companies
  ADD COLUMN IF NOT EXISTS menu_intel JSONB,
  ADD COLUMN IF NOT EXISTS menu_intel_at TIMESTAMP;
