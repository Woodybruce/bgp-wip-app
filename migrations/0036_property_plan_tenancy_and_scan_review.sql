-- Additive only: existing outlines and links remain intact.
-- The startup schema mirrors these statements for existing installations.

ALTER TABLE property_plan_units ADD COLUMN IF NOT EXISTS tenancy_unit_id VARCHAR REFERENCES tenancy_schedule_units(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_property_plan_units_tenancy ON property_plan_units(tenancy_unit_id) WHERE tenancy_unit_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS property_plan_scans (
       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       plan_id UUID NOT NULL REFERENCES property_plans(id) ON DELETE CASCADE,
       image_key TEXT NOT NULL,
       status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','ready','failed','applied')),
       total INT NOT NULL DEFAULT 0,
       completed INT NOT NULL DEFAULT 0,
       message TEXT NOT NULL DEFAULT '',
       candidates JSONB NOT NULL DEFAULT '[]'::jsonb,
       applied_request JSONB,
       applied_count INT NOT NULL DEFAULT 0,
       created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
       updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
     );

CREATE INDEX IF NOT EXISTS idx_property_plan_scans_plan ON property_plan_scans(plan_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_property_plan_scans_running ON property_plan_scans(plan_id) WHERE status = 'running';
