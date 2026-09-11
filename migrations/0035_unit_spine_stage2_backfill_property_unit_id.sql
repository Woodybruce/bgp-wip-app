-- Migration 0035 — Unit spine (Stage 2, part 3): back-fill property_unit_id
--
-- Stage 1 added tenancy_schedule_units.property_unit_id (the missing link up
-- to the physical master, property_units). It's been NULL on every row since.
--
-- The integrity gate proved name-matching is a dead end (0 matches). But it
-- also proved every available_units row already has unit_id → property_units
-- populated. So for any tenancy row reachable from an available_units row,
-- we can copy the physical link across the bridge.
--
--   tenancy_schedule_units  ◄──tenancy_unit_id──  available_units ──unit_id──►  property_units
--                                                       (already populated)
--
-- Expected reach: ~29 tenancy rows (the 54 - 25 NO-spine-link available_units
-- rows). The remaining tenancy rows (the ~170 not on any available_units)
-- stay NULL and become a manual reconcile workstream (Path B), which doesn't
-- block any later stages.
--
-- SAFE: only updates tenancy rows that are currently NULL — re-running is a
-- no-op and any manual correction is preserved. DISTINCT ON picks the most
-- recently updated available_units row per tenancy in case of duplicates,
-- but in practice they should all point at the same physical anyway.

UPDATE tenancy_schedule_units t
SET property_unit_id = av.unit_id
FROM (
  SELECT DISTINCT ON (tenancy_unit_id)
         tenancy_unit_id,
         unit_id
  FROM available_units
  WHERE tenancy_unit_id IS NOT NULL
    AND unit_id IS NOT NULL
  ORDER BY tenancy_unit_id, updated_at DESC NULLS LAST
) av
WHERE av.tenancy_unit_id = t.id
  AND t.property_unit_id IS NULL;
