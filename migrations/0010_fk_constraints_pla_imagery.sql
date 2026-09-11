-- Migration 0010 — add FK constraints to prevent silent orphans
--
-- The PLA matters tables and property_imagery_assets reference
-- crm_properties / image_studio_images via varchar columns with no FK
-- constraint. If a property is hard-deleted (bulk-delete on the
-- properties page), child rows orphan silently. Adding RESTRICT on the
-- parent edges stops the delete; CASCADE on the matter→children edges
-- ensures cleanup if a matter is hard-deleted (rare — soft-close is
-- the normal path).
--
-- Idempotent — drops any existing constraint with the same name first
-- so re-running is safe. Wrapped in DO blocks because Postgres can't
-- IF EXISTS on ADD CONSTRAINT.

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'pla_matters_property_id_fk'
  ) THEN
    ALTER TABLE pla_matters
      ADD CONSTRAINT pla_matters_property_id_fk
      FOREIGN KEY (property_id) REFERENCES crm_properties(id) ON DELETE RESTRICT;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'pla_matter_comps_matter_id_fk'
  ) THEN
    ALTER TABLE pla_matter_comps
      ADD CONSTRAINT pla_matter_comps_matter_id_fk
      FOREIGN KEY (matter_id) REFERENCES pla_matters(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'pla_matter_workbooks_matter_id_fk'
  ) THEN
    ALTER TABLE pla_matter_workbooks
      ADD CONSTRAINT pla_matter_workbooks_matter_id_fk
      FOREIGN KEY (matter_id) REFERENCES pla_matters(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'pla_matter_events_matter_id_fk'
  ) THEN
    ALTER TABLE pla_matter_events
      ADD CONSTRAINT pla_matter_events_matter_id_fk
      FOREIGN KEY (matter_id) REFERENCES pla_matters(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'property_imagery_assets_property_id_fk'
  ) THEN
    ALTER TABLE property_imagery_assets
      ADD CONSTRAINT property_imagery_assets_property_id_fk
      FOREIGN KEY (property_id) REFERENCES crm_properties(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'property_imagery_assets_image_studio_id_fk'
  ) THEN
    ALTER TABLE property_imagery_assets
      ADD CONSTRAINT property_imagery_assets_image_studio_id_fk
      FOREIGN KEY (image_studio_id) REFERENCES image_studio_images(id) ON DELETE SET NULL;
  END IF;
END $$;
