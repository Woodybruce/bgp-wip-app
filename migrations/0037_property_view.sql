-- A presentation preference, separate from the asset's classification.
-- Existing properties remain in automatic mode until someone chooses a view.
ALTER TABLE crm_properties ADD COLUMN IF NOT EXISTS property_view TEXT;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'crm_properties_property_view_check'
      AND conrelid = 'crm_properties'::regclass
  ) THEN
    ALTER TABLE crm_properties ADD CONSTRAINT crm_properties_property_view_check
      CHECK (property_view IS NULL OR property_view IN ('building', 'multi_let', 'centre'));
  END IF;
END $$;
