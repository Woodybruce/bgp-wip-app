-- Property Resolver foundation (May 2026)
-- Extends crm_properties with the canonical identifiers every property feature
-- needs: UPRN (the spine), TOID + OS NGD feature id (polygons), USRN (street),
-- INSPIRE polygon id (HMLR), VOA BA reference (rating list), FHRS id (food
-- hygiene), plus admin geography (ward, LPA, constituency), aliases for fuzzy
-- match memory, and provenance.
--
-- All additive, all nullable, idempotent. No existing FK or column changes.
--
-- Used by server/property-resolver.ts as the canonical property entity.
-- Pathway, ChatBGP, KYC Clouseau, Land Registry, comps, contacts and
-- everything else read/write through the resolver.

ALTER TABLE crm_properties
  ADD COLUMN IF NOT EXISTS uprn text,
  ADD COLUMN IF NOT EXISTS toid text,
  ADD COLUMN IF NOT EXISTS usrn text,
  ADD COLUMN IF NOT EXISTS os_ngd_feature_id text,
  ADD COLUMN IF NOT EXISTS inspire_polygon_id text,
  ADD COLUMN IF NOT EXISTS voa_ba_reference text,
  ADD COLUMN IF NOT EXISTS fhrs_id text,
  ADD COLUMN IF NOT EXISTS ward text,
  ADD COLUMN IF NOT EXISTS lpa text,
  ADD COLUMN IF NOT EXISTS parl_constituency text,
  ADD COLUMN IF NOT EXISTS aliases jsonb,
  ADD COLUMN IF NOT EXISTS resolution_status text,
  ADD COLUMN IF NOT EXISTS resolved_at timestamp,
  ADD COLUMN IF NOT EXISTS resolved_by varchar;

-- UPRN is the most-queried lookup key — index for resolver hot path.
CREATE INDEX IF NOT EXISTS crm_properties_uprn_idx ON crm_properties (uprn) WHERE uprn IS NOT NULL;
CREATE INDEX IF NOT EXISTS crm_properties_toid_idx ON crm_properties (toid) WHERE toid IS NOT NULL;
CREATE INDEX IF NOT EXISTS crm_properties_voa_idx  ON crm_properties (voa_ba_reference) WHERE voa_ba_reference IS NOT NULL;
CREATE INDEX IF NOT EXISTS crm_properties_inspire_idx ON crm_properties (inspire_polygon_id) WHERE inspire_polygon_id IS NOT NULL;
