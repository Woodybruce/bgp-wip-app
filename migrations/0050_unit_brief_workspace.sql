-- Migration 0050 — the Targeting Brief workspace (Woody, 2026-11-12).
-- A unit's brief gains its commercials, the agency basis, the plans and
-- scheme brochures attached to it, a version (a change to the terms raises
-- it, and a signature on an earlier version no longer counts) and the date
-- everyone agreed. Two new tables: the people involved in the brief (BGP
-- agents, a joint agent, the client's leasing team and asset managers) with
-- each person's "agree brief" signature, and each person's attributed
-- comments. Additive, idempotent.

ALTER TABLE unit_briefs ADD COLUMN IF NOT EXISTS agency_basis text;
ALTER TABLE unit_briefs ADD COLUMN IF NOT EXISTS commercials jsonb;
ALTER TABLE unit_briefs ADD COLUMN IF NOT EXISTS plan_ids text[];
ALTER TABLE unit_briefs ADD COLUMN IF NOT EXISTS brochure_ids text[];
ALTER TABLE unit_briefs ADD COLUMN IF NOT EXISTS version integer DEFAULT 1;
ALTER TABLE unit_briefs ADD COLUMN IF NOT EXISTS terms_updated_at timestamp;
ALTER TABLE unit_briefs ADD COLUMN IF NOT EXISTS terms_updated_by_name text;
ALTER TABLE unit_briefs ADD COLUMN IF NOT EXISTS agreed_at timestamp;
UPDATE unit_briefs SET version = 1 WHERE version IS NULL;

CREATE TABLE IF NOT EXISTS unit_brief_people (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  brief_id varchar NOT NULL,
  role text NOT NULL,
  user_id varchar,
  contact_id varchar,
  company_id varchar,
  name text NOT NULL,
  email text,
  firm text,
  agreed_at timestamp,
  agreed_version integer,
  agreed_by_user_id varchar,
  agreed_by_name text,
  sort_order integer DEFAULT 0,
  created_by_name text,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_unit_brief_people_brief ON unit_brief_people (brief_id);
CREATE INDEX IF NOT EXISTS idx_unit_brief_people_user ON unit_brief_people (user_id);

CREATE TABLE IF NOT EXISTS unit_brief_comments (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  brief_id varchar NOT NULL,
  user_id varchar,
  user_name text,
  role_label text,
  kind text NOT NULL DEFAULT 'comment',
  body text NOT NULL,
  ai_assisted boolean DEFAULT false,
  created_at timestamp DEFAULT now(),
  updated_at timestamp
);
CREATE INDEX IF NOT EXISTS idx_unit_brief_comments_brief ON unit_brief_comments (brief_id, created_at);
