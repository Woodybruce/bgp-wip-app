-- Migration 0014 — HMLR data foundation
--
-- Direct ingestion of three free HMLR datasets, replacing PropertyData's
-- postcode-level wrappers for ownership lookups:
--
--   hmlr_title_polygons — INSPIRE Index Polygons (every freehold title
--   boundary in England & Wales). PostGIS GIST-indexed. Use ST_Contains
--   (polygon, ST_MakePoint(lng, lat)) to find titles at a point.
--
--   hmlr_proprietors — CCOD (UK companies) + OCOD (overseas companies).
--   title_number → proprietor name + company number + tenure. Free,
--   monthly refresh from use-land-property-data.service.gov.uk.
--
--   hmlr_ingest_runs — audit log of every ingest run so we know when
--   each dataset was last refreshed.
--
-- Coverage: England & Wales only (HMLR jurisdiction). Scotland uses
-- Registers of Scotland (different format, separate ingest later).

CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS hmlr_title_polygons (
  inspire_id        BIGINT PRIMARY KEY,
  title_number      TEXT NOT NULL,
  polygon           GEOMETRY(MultiPolygon, 4326) NOT NULL,
  region            TEXT,                                       -- e.g. "Westminster_City_of"
  ingest_run_id     UUID,
  inserted_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS hmlr_title_polygons_geom_idx
  ON hmlr_title_polygons USING GIST (polygon);

CREATE INDEX IF NOT EXISTS hmlr_title_polygons_title_idx
  ON hmlr_title_polygons (title_number);

CREATE INDEX IF NOT EXISTS hmlr_title_polygons_region_idx
  ON hmlr_title_polygons (region);

CREATE TABLE IF NOT EXISTS hmlr_proprietors (
  title_number                       TEXT NOT NULL,
  dataset                            TEXT NOT NULL,             -- 'ccod' | 'ocod'
  proprietor_position                INTEGER NOT NULL DEFAULT 1, -- 1..4 (HMLR allows up to 4 per title)
  proprietor_name                    TEXT,
  proprietor_category                TEXT,
  company_registration_no            TEXT,
  country_incorporated               TEXT,
  proprietor_address_1               TEXT,
  proprietor_address_2               TEXT,
  proprietor_address_3               TEXT,
  date_proprietor_added              DATE,
  price_paid                         TEXT,                      -- HMLR ships as "GBP 4,500,000" or empty
  property_address                   TEXT,
  tenure                             TEXT,                      -- 'Freehold' | 'Leasehold'
  multiple_address_indicator         TEXT,
  additional_proprietor_indicator    TEXT,
  ingest_run_id                      UUID,
  inserted_at                        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (title_number, dataset, proprietor_position)
);

CREATE INDEX IF NOT EXISTS hmlr_proprietors_company_idx
  ON hmlr_proprietors (company_registration_no)
  WHERE company_registration_no IS NOT NULL;

CREATE INDEX IF NOT EXISTS hmlr_proprietors_name_idx
  ON hmlr_proprietors (lower(proprietor_name));

CREATE INDEX IF NOT EXISTS hmlr_proprietors_dataset_idx
  ON hmlr_proprietors (dataset);

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
