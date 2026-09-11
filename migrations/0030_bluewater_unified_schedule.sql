-- Unified Schedule rollout — Bluewater opt-in.
--
-- The property detail page collapses Leasing Schedule + Tenancy Schedule
-- into a single "Schedule" panel with a Lettings / Tenancy lens toggle
-- when crm_properties.unified_schedule = true. Bluewater is the test
-- property — once the team's used the unified view for a week we flip
-- the firm-wide default to true and retire the two old panels.
--
-- Name-based UPDATE (no hardcoded UUID) so the migration's idempotent
-- across environments. Matches the canonical "Bluewater Shopping Centre"
-- naming plus any common variants.

UPDATE crm_properties
   SET unified_schedule = true
 WHERE lower(name) LIKE '%bluewater%';
