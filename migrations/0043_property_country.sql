-- Migration 0043 — Property country + geocode provenance (Delivery 2)
--
-- Discovery used to assume the UK everywhere, which geocoded Dundrum Town
-- Centre (Dublin) to "Dundrum, Newcastle BT33, UK". The property now carries
-- its ISO 3166-1 alpha-2 country and a geocode status so country-aware
-- discovery (and the reviewed per-row repair script) has somewhere truthful
-- to write.
--
-- All additive, all nullable, idempotent. NO backfill: existing rows keep
-- NULL country / NULL geocode_status. Correction of known-wrong rows is the
-- reviewed, per-row repair in scripts/repair-landlord-geocodes.ts, not this
-- migration.

ALTER TABLE crm_properties
  ADD COLUMN IF NOT EXISTS country text,          -- ISO 3166-1 alpha-2, e.g. 'GB','IE','FR'
  ADD COLUMN IF NOT EXISTS geocode_status text;   -- resolved | unresolved | needs_review
