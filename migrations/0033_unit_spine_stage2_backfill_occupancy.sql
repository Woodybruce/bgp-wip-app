-- Migration 0033 — Unit spine (Stage 2, part 1): back-fill occupancy/marketing
--
-- Stage 1 (migration 0032) added occupancy_status / marketing_active /
-- marketing_reason to tenancy_schedule_units, all NULL/default. This migration
-- populates them from the legacy `status` column, splitting the single old
-- status into the two-axis model:
--   occupancy_status — is the unit let? (Trading vs Vacant)
--   marketing_active — is it being marketed, independent of occupancy?
--
-- Mapping (from the live status vocabulary, 2026-06-08):
--   Occupied (170) -> occupancy_status=Trading, marketing_active=false
--   Vacant   (9)   -> occupancy_status=Vacant,  marketing_active=true,  reason=Vacant
--   Marketing(8)   -> occupancy_status=Vacant,  marketing_active=true,  reason=Vacant
--   Under Offer(8) -> occupancy_status=Vacant,  marketing_active=true,  reason=Vacant
--   Held     (3)   -> occupancy_status=Vacant,  marketing_active=false
--
-- SAFE: writes only the new columns, only where occupancy_status IS NULL
-- (so re-running is a no-op and any later manual correction is preserved).
-- The legacy `status` column is left completely untouched — dual-state until
-- Stage 6 drops it.

UPDATE tenancy_schedule_units
SET
  occupancy_status = CASE
    WHEN status = 'Occupied' THEN 'Trading'
    ELSE 'Vacant'
  END,
  marketing_active = CASE
    WHEN status IN ('Vacant', 'Marketing', 'Under Offer') THEN TRUE
    ELSE FALSE
  END,
  marketing_reason = CASE
    WHEN status IN ('Vacant', 'Marketing', 'Under Offer') THEN 'Vacant'
    ELSE NULL
  END
WHERE status IS NOT NULL
  AND occupancy_status IS NULL;
