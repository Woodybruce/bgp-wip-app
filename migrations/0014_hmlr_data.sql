-- Migration 0014 — HMLR data foundation
--
-- Direct ingestion of free HMLR datasets, replacing PropertyData's
-- postcode-level wrappers for ownership lookups.
--
-- Available free datasets (use-land-property-data.service.gov.uk):
--
--   CCOD — UK Companies that Own Property in England and Wales (1.56GB CSV,
--          monthly). title_number → proprietor + property_address.
--   OCOD — Overseas Companies that Own Property in England and Wales
--          (37MB CSV, monthly). Same shape as CCOD.
--   INSPIRE Index Polygons — free GML, monthly, polygon shapes only.
--          NO title_number. Useful for map visualisation but not for
--          ownership lookups (the £20k/yr NPS is the version that
--          links polygons to title numbers).
--
-- Strategy: match resolved property (postcode + street number) against
-- CCOD/OCOD property_address text. CCOD ships a separate Postcode column
-- so we can index on it for fast filtering, then ILIKE on the address
-- text for the street-number match.
--
-- Coverage: England & Wales only. Scotland uses Registers of Scotland
-- (different format, separate ingest later). Out of scope for v1.

CREATE EXTENSION IF NOT EXISTS postgis;

-- INSPIRE polygons WITHOUT title_number (free path). Useful for map
-- visualisation; can also be linked to CCOD/OCOD rows later by
-- geocoding property_address to lat/lng and point-in-polygon. For
-- ownership lookups in v1 we use CCOD/OCOD address-text matching
-- directly — polygons are optional.
CREATE TABLE IF NOT EXISTS hmlr_title_polygons (
  inspire_id        BIGINT PRIMARY KEY,
  title_number      TEXT,                                       -- nullable: only present if loaded from paid NPS dataset
  polygon           GEOMETRY(MultiPolygon, 4326) NOT NULL,
  region            TEXT,
  ingest_run_id     UUID,
  inserted_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS hmlr_title_polygons_geom_idx
  ON hmlr_title_polygons USING GIST (polygon);

CREATE INDEX IF NOT EXISTS hmlr_title_polygons_title_idx
  ON hmlr_title_polygons (title_number)
  WHERE title_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS hmlr_title_polygons_region_idx
  ON hmlr_title_polygons (region);

-- CCOD + OCOD: every commercial title in E&W with proprietor info.
-- Combined into one table with a `dataset` column. property_address is
-- the text we match against the user's resolved address.
CREATE TABLE IF NOT EXISTS hmlr_proprietors (
  title_number                       TEXT NOT NULL,
  dataset                            TEXT NOT NULL,             -- 'ccod' | 'ocod'
  proprietor_position                INTEGER NOT NULL DEFAULT 1,
  proprietor_name                    TEXT,
  proprietor_category                TEXT,
  company_registration_no            TEXT,
  country_incorporated               TEXT,
  proprietor_address_1               TEXT,
  proprietor_address_2               TEXT,
  proprietor_address_3               TEXT,
  date_proprietor_added              DATE,
  price_paid                         TEXT,
  property_address                   TEXT,
  postcode                           TEXT,                      -- separate column from CCOD CSV — keyed for fast filter
  postcode_normalised                TEXT,                      -- uppercase, no whitespace — what we actually match on
  tenure                             TEXT,
  multiple_address_indicator         TEXT,
  additional_proprietor_indicator    TEXT,
  ingest_run_id                      UUID,
  inserted_at                        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (title_number, dataset, proprietor_position)
);

CREATE INDEX IF NOT EXISTS hmlr_proprietors_postcode_idx
  ON hmlr_proprietors (postcode_normalised)
  WHERE postcode_normalised IS NOT NULL;

CREATE INDEX IF NOT EXISTS hmlr_proprietors_company_idx
  ON hmlr_proprietors (company_registration_no)
  WHERE company_registration_no IS NOT NULL;

CREATE INDEX IF NOT EXISTS hmlr_proprietors_name_idx
  ON hmlr_proprietors (lower(proprietor_name));

CREATE INDEX IF NOT EXISTS hmlr_proprietors_dataset_idx
  ON hmlr_proprietors (dataset);

-- Trigram index on lowercased property_address for fast ILIKE / similarity
-- matching at query time (the street-number filter step).
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS hmlr_proprietors_address_trgm_idx
  ON hmlr_proprietors USING GIN (lower(property_address) gin_trgm_ops);

CREATE TABLE IF NOT EXISTS hmlr_ingest_runs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset           TEXT NOT NULL,                              -- 'inspire' | 'ccod' | 'ocod'
  source_url        TEXT,
  source_filename   TEXT,
  rows_processed    INTEGER NOT NULL DEFAULT 0,
  rows_inserted     INTEGER NOT NULL DEFAULT 0,
  rows_updated      INTEGER NOT NULL DEFAULT 0,
  rows_skipped      INTEGER NOT NULL DEFAULT 0,
  status            TEXT NOT NULL,                              -- 'running' | 'ok' | 'error'
  error             TEXT,
  notes             TEXT,
  started_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS hmlr_ingest_runs_dataset_idx
  ON hmlr_ingest_runs (dataset, started_at DESC);

