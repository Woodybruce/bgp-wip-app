-- Migration 0012 — close FK gaps and add hot-path indexes
--
-- crm_comps and available_units have *_id columns that look like
-- foreign keys but aren't constrained, so a bulk-delete on properties
-- or deals leaves orphans. Same story for lease_events.matter_id added
-- in 0009. Plus the lookup paths (property detail → comps, property
-- detail → units) currently full-scan because the FK columns aren't
-- indexed.
--
-- All FKs are added NOT VALID so the migration succeeds even if there
-- is legacy orphan data; new INSERT/UPDATE is constrained from this
-- point forward. Run a follow-up `ALTER TABLE ... VALIDATE CONSTRAINT`
-- once orphans are cleaned (do it manually so we can audit what gets
-- caught).
--
-- Idempotent — wrapped in DO blocks so re-running is safe.

-- ── crm_comps ─────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'crm_comps_property_id_fk'
  ) THEN
    ALTER TABLE crm_comps
      ADD CONSTRAINT crm_comps_property_id_fk
      FOREIGN KEY (property_id) REFERENCES crm_properties(id) ON DELETE SET NULL NOT VALID;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'crm_comps_deal_id_fk'
  ) THEN
    ALTER TABLE crm_comps
      ADD CONSTRAINT crm_comps_deal_id_fk
      FOREIGN KEY (deal_id) REFERENCES crm_deals(id) ON DELETE SET NULL NOT VALID;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS crm_comps_property_idx
  ON crm_comps (property_id) WHERE property_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS crm_comps_deal_idx
  ON crm_comps (deal_id) WHERE deal_id IS NOT NULL;

-- ── available_units ───────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'available_units_property_id_fk'
  ) THEN
    ALTER TABLE available_units
      ADD CONSTRAINT available_units_property_id_fk
      FOREIGN KEY (property_id) REFERENCES crm_properties(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'available_units_deal_id_fk'
  ) THEN
    ALTER TABLE available_units
      ADD CONSTRAINT available_units_deal_id_fk
      FOREIGN KEY (deal_id) REFERENCES crm_deals(id) ON DELETE SET NULL NOT VALID;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS available_units_property_idx
  ON available_units (property_id) WHERE property_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS available_units_deal_idx
  ON available_units (deal_id) WHERE deal_id IS NOT NULL;

-- ── lease_events.matter_id (added in 0009) ────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'lease_events_matter_id_fk'
  ) THEN
    ALTER TABLE lease_events
      ADD CONSTRAINT lease_events_matter_id_fk
      FOREIGN KEY (matter_id) REFERENCES pla_matters(id) ON DELETE SET NULL NOT VALID;
  END IF;
END $$;
