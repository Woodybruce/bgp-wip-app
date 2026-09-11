-- Property Imagery Assets — curation/classification layer (May 2026)
--
-- Sits on top of image_studio_images: each row is an assertion that
-- "for property X, image studio image Y plays role Z" (hero, internal,
-- secondary_external, location_plan, floor_plan, comps_chart, erv_walk,
-- covenant_card, overlay).
--
-- Multiple rows can reference the same image_studio_id with different kinds
-- (e.g. a generated location-plan PNG might be the hero in a market report
-- and a section image in a Why Buy memo).
--
-- Discovery sources that haven't yet been imported into Image Studio (e.g.
-- a planning portal PDF page we just spotted) get a row with image_studio_id
-- NULL plus a source_url for provenance — when a user clicks "Use", the
-- image gets imported into Image Studio and the image_studio_id is filled.
--
-- Used by:
--   - Pathway Stage 8 + 9 (Studio Time + Why Buy)
--   - PLA Matter detail page (Lease Advisory imagery)
--   - Property Intelligence page (Imagery tab)
--   - Document Studio briefs (Brochure, HoT, Market Report etc)

CREATE TABLE IF NOT EXISTS property_imagery_assets (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id varchar NOT NULL,            -- → crm_properties.id (canonical via resolver)
  kind text NOT NULL,                      -- hero | internal | secondary_external |
                                           -- location_plan | floor_plan | covenant_card |
                                           -- comps_chart | erv_walk | overlay
  source text NOT NULL,                    -- brochure | sharepoint | street_view |
                                           -- planning_portal | os_ngd | google_static |
                                           -- edozo | cad_measure | image_studio |
                                           -- generated_chart | manual_upload
  -- One of these is set:
  image_studio_id varchar,                 -- → image_studio_images.id (when imported)
  source_url text,                         -- raw URL for provenance / re-fetch
  -- Classification / re-render
  generated_from jsonb,                    -- inputs snapshot (lat/lng, layers,
                                           -- input data) — lets us regenerate
                                           -- without losing the spec
  score real,                              -- ranking heuristic 0-1; higher = more relevant
  width int,
  height int,
  caption text,                            -- e.g. "View from the south, Knight Frank brochure 2019"
  -- Curation
  pinned boolean DEFAULT false,            -- "this is THE hero for this property"
  hidden boolean DEFAULT false,            -- soft-deleted: user said "not this one"
  -- Provenance
  generated_at timestamp DEFAULT now(),
  generated_by varchar,                    -- → users.id (or null for system-generated)
  -- Stage / context that produced it
  pathway_run_id varchar,                  -- → property_pathway_runs.id (when discovered via Pathway)
  matter_id varchar                        -- → pla_matters.id (when discovered for a matter)
);

-- Hot lookup paths
CREATE INDEX IF NOT EXISTS property_imagery_property_kind_idx
  ON property_imagery_assets (property_id, kind) WHERE hidden = false;

CREATE INDEX IF NOT EXISTS property_imagery_studio_idx
  ON property_imagery_assets (image_studio_id) WHERE image_studio_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS property_imagery_pinned_idx
  ON property_imagery_assets (property_id, kind) WHERE pinned = true;

CREATE INDEX IF NOT EXISTS property_imagery_pathway_idx
  ON property_imagery_assets (pathway_run_id) WHERE pathway_run_id IS NOT NULL;
