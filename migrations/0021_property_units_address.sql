-- Migration 0021 — Unit-level address fields on property_units
--
-- Sub-units inside a property (Unit 4A in a shopping centre, kiosks,
-- pop-ups, sub-divided shops) often have their own postal address with
-- their own UPRN and rateable value — distinct from the parent property's
-- address. These four columns capture that:
--
--   unit_address           — structured line1+town (Royal Mail format)
--   unit_postcode          — separated so rates/EPC lookups can key on it
--   unit_uprn              — Unique Property Reference Number (OS / LR / Rates anchor)
--   unit_address_free_text — fallback when the unit isn't on PAF
--
-- Optional everywhere; the heading on the deal-detail page is the entry
-- point for editing them.

ALTER TABLE property_units ADD COLUMN IF NOT EXISTS unit_address TEXT;
ALTER TABLE property_units ADD COLUMN IF NOT EXISTS unit_postcode TEXT;
ALTER TABLE property_units ADD COLUMN IF NOT EXISTS unit_uprn TEXT;
ALTER TABLE property_units ADD COLUMN IF NOT EXISTS unit_address_free_text TEXT;
