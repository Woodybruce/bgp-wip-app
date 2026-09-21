-- CRM Meetings — Phase 1 Heads of Team interviews from the BGP CRM Strategy
-- doc (Sept 2026). One row per interview; responses keyed by question id.
CREATE TABLE IF NOT EXISTS crm_interviews (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  team TEXT NOT NULL,
  interviewee TEXT,
  meeting_date TEXT,
  responses JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by VARCHAR,
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);
