-- Requirements centre (Woody, 2026-11-12; docs/requirements-review-2026-11-12.md).
-- A requirement is LIVE only when a named BGP person confirmed it in the last
-- 90 days; imports are market listings until somebody does. The state is
-- worked out on read (shared/requirement-live.ts), never written by a job.
-- Additive and safe to run again. No back-fill here: existing rows keep
-- NULLs and read as "listed" or "last edited", never "confirmed".

-- Who last confirmed the requirement with the brand, when, and how.
ALTER TABLE crm_requirements_leasing ADD COLUMN IF NOT EXISTS last_confirmed_at timestamp;
ALTER TABLE crm_requirements_leasing ADD COLUMN IF NOT EXISTS last_confirmed_by varchar;        -- users.id
ALTER TABLE crm_requirements_leasing ADD COLUMN IF NOT EXISTS last_confirmed_by_name text;      -- the name as it was on the day
ALTER TABLE crm_requirements_leasing ADD COLUMN IF NOT EXISTS confirmed_how text;               -- created | still_live | call | meeting | email | chat | viewing | suggestion | press
-- Whose record it is: 'bgp' (made by a person at BGP), 'pipnet' or 'trl'
-- (made by that import). NULL = made before this column existed.
ALTER TABLE crm_requirements_leasing ADD COLUMN IF NOT EXISTS origin text;
-- The import row (external_requirements.id) this requirement was last matched to.
ALTER TABLE crm_requirements_leasing ADD COLUMN IF NOT EXISTS external_requirement_id varchar;
-- When the market listing was last issued, by the listing's own date, and
-- where. Refreshed by the imports each time the brand is listed again; only
-- ever moves forward.
ALTER TABLE crm_requirements_leasing ADD COLUMN IF NOT EXISTS last_listed_at timestamp;
ALTER TABLE crm_requirements_leasing ADD COLUMN IF NOT EXISTS last_listed_source text;          -- PIPnet | TRL

CREATE INDEX IF NOT EXISTS idx_crm_requirements_leasing_external ON crm_requirements_leasing (external_requirement_id);

-- One dated line of evidence that a brand is looking: a call, a chat post,
-- a viewing, a market listing, a press story. A line a machine detected is a
-- SUGGESTION (status 'open') until a person confirms it into a new
-- requirement, attaches it to an existing one, or dismisses it. BGP staff
-- only: never sent to a client login.
CREATE TABLE IF NOT EXISTS requirement_evidence (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  requirement_id varchar,               -- NULL while it is a suggestion with no requirement yet
  company_id varchar,                   -- the brand (crm_companies.id); NULL when the name could not be matched
  brand_name text,                      -- the brand's name as the source gave it
  candidate_company_ids text[],         -- when more than one brand is possible, for the reviewer to pick
  kind text NOT NULL,                   -- call | meeting | email | chat | team_chat | gossip | whatsapp | viewing | offer | deal | listing | press | note
  source_label text,                    -- shown to staff: "Propel", "PIPnet", "ChatBGP", "Team chat"
  source_ref text,                      -- the id of the record it came from (chat message, news article, viewing, import row)
  evidence_date timestamp,              -- when it was said or published, not when it was read
  headline text,
  excerpt text,                         -- a short quote; never a whole message
  url text,
  said_by text,                         -- who said it, where known
  details jsonb,                        -- what was read out of it: sites, size, locations, use, timing
  confidence text,                      -- high | medium | low
  status text NOT NULL DEFAULT 'open',  -- open | confirmed | attached | dismissed
  created_by_kind text NOT NULL DEFAULT 'machine', -- person | machine
  created_by_user_id varchar,           -- the person, when a person made it
  created_by_name text,                 -- the person's name, or the reader that detected it
  resolved_by_user_id varchar,
  resolved_by_name text,
  resolved_at timestamp,
  resolved_reason text,                 -- for a dismissal: wrong_brand | not_a_requirement | duplicate | free text
  dedupe_key text,                      -- one line per source record, so nothing is suggested twice
  suggestion_id varchar,                -- the first line of the open suggestion this later line joined (NULL on the first line itself)
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);
ALTER TABLE requirement_evidence ADD COLUMN IF NOT EXISTS suggestion_id varchar;
CREATE INDEX IF NOT EXISTS idx_requirement_evidence_suggestion ON requirement_evidence (suggestion_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_requirement_evidence_dedupe ON requirement_evidence (dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_requirement_evidence_requirement ON requirement_evidence (requirement_id);
CREATE INDEX IF NOT EXISTS idx_requirement_evidence_company ON requirement_evidence (company_id);
CREATE INDEX IF NOT EXISTS idx_requirement_evidence_status ON requirement_evidence (status);
