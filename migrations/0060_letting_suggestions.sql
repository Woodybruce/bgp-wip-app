-- Comments not yet logged (Woody, 2026-11-13: "yes to table"). A comment on a
-- target, a viewing, an interest note or a Targeting Brief comment that reads
-- as an offer or a viewing, but has no offer or viewing logged for it, is
-- kept here as a SUGGESTION for a person to log or dismiss. The reader never
-- writes an offer or a viewing: a person opens the normal form, checks it and
-- saves. Detection is the shorthand rules only (no AI). Rows are written when
-- a source is saved, or by an admin Preview then Apply; never at boot or on a
-- timer. Additive and safe to run again.
CREATE TABLE IF NOT EXISTS letting_suggestions (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id varchar NOT NULL,                 -- available_units.id
  kind text NOT NULL,                       -- offer | viewing
  company_id varchar,                       -- the brand (crm_companies.id) when the source links one
  brand_name text,                          -- the brand's name as the source gives it
  source_kind text NOT NULL,                -- target_comment | viewing | interest_note | brief_comment
  source_ref text NOT NULL,                 -- target id and the comment's time; viewing id; interest id; brief comment id
  dedupe_key text NOT NULL,                 -- source, kind and a hash of the words: nothing is raised twice
  excerpt text,                             -- the literal words that were read
  details jsonb,                            -- what the rules read out of them (terms, date, outcome)
  said_by text,                             -- who wrote it, where the source records that
  evidence_date date,                       -- when it was said or happened, not when it was read
  visibility text NOT NULL DEFAULT 'bgp',   -- bgp (BGP's own notes) | brief (everyone working the unit)
  status text NOT NULL DEFAULT 'open',      -- open | confirmed | dismissed
  resolved_by_user_id varchar,
  resolved_by_name text,
  resolved_at timestamp,
  resolved_reason text,
  record_kind text,                         -- offer | viewing: what a person logged from it
  record_id varchar,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_letting_suggestions_dedupe ON letting_suggestions (dedupe_key);
CREATE INDEX IF NOT EXISTS idx_letting_suggestions_unit ON letting_suggestions (unit_id);
CREATE INDEX IF NOT EXISTS idx_letting_suggestions_status ON letting_suggestions (status);
