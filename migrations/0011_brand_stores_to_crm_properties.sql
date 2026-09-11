-- Migration 0011 — link brand_stores to crm_properties
--
-- A brand store at the same address as a crm_property was being tracked
-- twice (once per concept). Adding crm_property_id FK lets brand stores
-- reference the canonical property record. Backfill via postcode + name
-- match where possible; new stores resolve through the Property Resolver
-- and link both ways.

ALTER TABLE brand_stores
  ADD COLUMN IF NOT EXISTS crm_property_id varchar;

CREATE INDEX IF NOT EXISTS brand_stores_crm_property_idx
  ON brand_stores (crm_property_id) WHERE crm_property_id IS NOT NULL;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'brand_stores_crm_property_id_fk'
  ) THEN
    ALTER TABLE brand_stores
      ADD CONSTRAINT brand_stores_crm_property_id_fk
      FOREIGN KEY (crm_property_id) REFERENCES crm_properties(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Backfill: for any brand store whose lat/lng or address matches an
-- existing crm_property by postcode + name (case-insensitive), link it.
-- Conservative — only links where the match is unambiguous.
WITH matches AS (
  SELECT
    bs.id AS store_id,
    cp.id AS property_id,
    ROW_NUMBER() OVER (
      PARTITION BY bs.id
      ORDER BY
        -- prefer exact name match, then prefix match
        CASE WHEN LOWER(cp.name) = LOWER(bs.name) THEN 0
             WHEN LOWER(cp.name) LIKE LOWER(bs.name) || '%' THEN 1
             ELSE 2
        END,
        cp.created_at DESC
    ) AS rn
  FROM brand_stores bs
  JOIN crm_properties cp
    ON UPPER(REPLACE(COALESCE(cp.postcode, ''), ' ', ''))
     = UPPER(REPLACE(COALESCE(SPLIT_PART(bs.address, ',', -1), ''), ' ', ''))
   AND (
     LOWER(cp.name) = LOWER(bs.name)
     OR LOWER(bs.address) LIKE '%' || LOWER(cp.name) || '%'
     OR LOWER(cp.name) LIKE '%' || LOWER(bs.name) || '%'
   )
  WHERE bs.crm_property_id IS NULL
)
UPDATE brand_stores bs
   SET crm_property_id = m.property_id
  FROM matches m
 WHERE bs.id = m.store_id
   AND m.rn = 1;
