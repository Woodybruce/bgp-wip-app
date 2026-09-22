-- Migration 0016 — crm_requirements_leasing.sources
--
-- Track which external feed(s) contributed to a CRM requirement row so the
-- team can see, at a glance, whether a brand came from PIPnet, TRL, both,
-- or was entered manually. Powers source-pill badges on the requirements
-- table and lets us filter by source without joining external_requirements.
--
-- Backfill is intentionally light: any existing row stays NULL (treated as
-- "Manual" in the UI). Next PIPnet/TRL sync will populate sources for rows
-- that get re-enriched.
ALTER TABLE crm_requirements_leasing
  ADD COLUMN IF NOT EXISTS sources text[];
