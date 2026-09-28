-- Migration 0048 — Estate schemes, landlord unit codes, PO-required clients.
--
-- property_schemes: the named parts of one estate / centre (Canary Wharf:
-- Jubilee Place, Cabot Place …) with the per-scheme billing facts. Units
-- carry the scheme NAME as their label (tenancy_schedule_units.grouping,
-- leasing_schedule_units.zone, available_units.scheme, crm_deals.scheme).
-- leasing_schedule_units.unit_code: the landlord's own unit reference (CWG
-- Yardi code) so weekly minutes re-imports match the same row.
-- crm_companies.requires_po: invoices need a PO number (nullable on purpose —
-- NULL means "never set", which the one-time Canary Wharf pass keys on).
-- All additive, idempotent.

CREATE TABLE IF NOT EXISTS property_schemes (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id varchar NOT NULL,
  name text NOT NULL,
  code text,
  billing_entity_id varchar,
  invoicing_email text,
  sharepoint_folder_url text,
  plan_id varchar,
  sort_order integer DEFAULT 0,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_property_schemes_name
  ON property_schemes(property_id, lower(trim(name)));

ALTER TABLE tenancy_schedule_units ADD COLUMN IF NOT EXISTS grouping text;
ALTER TABLE leasing_schedule_units ADD COLUMN IF NOT EXISTS unit_code text;
ALTER TABLE available_units ADD COLUMN IF NOT EXISTS scheme text;
ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS scheme text;
ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS requires_po boolean;
