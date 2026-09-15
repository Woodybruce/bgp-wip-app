-- Migration 0020 — pla_matters.unit_id
--
-- Lease advisory instructions are inherently unit-level (a rent review is on
-- a specific lease on a specific unit), but pla_matters has been property-
-- level since the table was introduced. Adding unit_id closes the loop so
-- the unit column on Deal CRM populates for PLA-originated deals, and the
-- "Available Units" panel on the property sidebar lists PLA work alongside
-- letting deals.
--
-- Optional for general advisory; the New Instruction dialog enforces it for
-- rent_review / lease_renewal / regear / dilapidations / service_charge.

ALTER TABLE pla_matters ADD COLUMN IF NOT EXISTS unit_id VARCHAR;
CREATE INDEX IF NOT EXISTS pla_matters_unit_idx ON pla_matters (unit_id) WHERE unit_id IS NOT NULL;
