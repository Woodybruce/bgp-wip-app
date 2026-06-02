-- Unified Schedule rollout — Bluewater re-tag (0030 didn't take).
--
-- Migration 0030 hit a race: it ran BEFORE the boot-DDL added the
-- unified_schedule column to crm_properties, so the UPDATE silently
-- no-op'd (no error — Postgres accepts UPDATEs that match zero rows).
-- The column was then created with DEFAULT false by the boot-DDL,
-- which is why /api/crm/properties/by-name/bluewater currently shows
-- unified_schedule:false.
--
-- This migration:
--   1. Creates the column itself (idempotent — boot-DDL might have
--      already done it; both paths are safe).
--   2. Re-runs the UPDATE against the now-guaranteed column.

ALTER TABLE crm_properties ADD COLUMN IF NOT EXISTS unified_schedule BOOLEAN DEFAULT false;

UPDATE crm_properties
   SET unified_schedule = true
 WHERE lower(name) LIKE '%bluewater%';
