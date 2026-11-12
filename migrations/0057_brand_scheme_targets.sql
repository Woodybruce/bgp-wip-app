-- Brand CRM "Wanted" lines (Woody, 2026-11-12: the table is approved). One
-- row says BGP wants a brand at a scheme or property, with or without a
-- unit picked. It is the only store for "wanted, no unit yet": every other
-- line of a brand's plan is read from targets, viewings, offers, deals and
-- tenancies. A wish is never a deal. Additive and safe to run again.
CREATE TABLE IF NOT EXISTS brand_scheme_targets (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id varchar NOT NULL REFERENCES crm_companies(id) ON DELETE CASCADE,   -- the brand
  property_id varchar NOT NULL,              -- for a Landsec scheme, the scheme's main property record
  tenancy_unit_id varchar,                   -- tenancy_schedule_units.id once a unit is picked
  unit_label text,                           -- a unit named in words, when it is not on the schedule
  note text,                                 -- BGP's note
  requirement_id varchar,                    -- the requirement this answers, when pinned
  visible_to_client boolean NOT NULL DEFAULT false,   -- "show to Landsec"
  ruled_out_at timestamp,
  ruled_out_reason text,
  created_by varchar,
  created_by_name text,
  created_by_company_id varchar,             -- null = written by BGP
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS brand_scheme_targets_uq ON brand_scheme_targets (company_id, property_id, COALESCE(tenancy_unit_id, ''), lower(COALESCE(unit_label, '')));
CREATE INDEX IF NOT EXISTS brand_scheme_targets_property_idx ON brand_scheme_targets (property_id);
