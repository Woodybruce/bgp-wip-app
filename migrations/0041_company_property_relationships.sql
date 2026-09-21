-- Migration 0041 — Company↔property relationship roles (Delivery 2)
--
-- Annotates the existing crm_company_properties join with HOW the company
-- relates to the property (owner / JV / manager), instead of inventing a
-- parallel link table — the pair-unique index on (company_id, property_id)
-- is the identity we want to annotate.
--
-- All additive, all nullable, idempotent. NO backfill: existing rows stay
-- NULL on every new column and the account resolver renders NULL role as
-- "unknown". Writing "owner" onto rows created as generic links would be a
-- silent reinterpretation of existing data — relationship metadata is set
-- by a human (or an evidenced import) from here on.

ALTER TABLE crm_company_properties
  ADD COLUMN IF NOT EXISTS relationship_role text,        -- owner | jv | manager | unknown
  ADD COLUMN IF NOT EXISTS ownership_stake_pct real,      -- JV stake; NULL unless evidenced
  ADD COLUMN IF NOT EXISTS relationship_confidence text,  -- confirmed | inferred | unresolved
  ADD COLUMN IF NOT EXISTS relationship_source text,      -- e.g. 'manual', 'land-registry', 'website-scrape'
  ADD COLUMN IF NOT EXISTS valid_from timestamptz,
  ADD COLUMN IF NOT EXISTS valid_to timestamptz,
  ADD COLUMN IF NOT EXISTS relationship_notes text;
