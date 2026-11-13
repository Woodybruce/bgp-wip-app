-- Letting transaction recommendation (Woody, 2026-11-12): once Heads of
-- Terms have been issued to a tenant, BGP recommends the transaction to the
-- client in the form Landsec asked for (the Landsec x BGP Offer template),
-- and the client's leasing and asset managers record their decision.
-- Additive and safe to run again.

-- One recommendation per letting: the tracker unit and its current deal.
CREATE TABLE IF NOT EXISTS unit_recommendations (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id varchar NOT NULL,
  deal_id varchar,
  offer_id varchar,                     -- the agreed offer it recommends
  version integer NOT NULL DEFAULT 1,   -- raised by every change after issue
  terms jsonb,                          -- the transaction as recommended (the Offer template's fields)
  comparables jsonb,                    -- rows of comparable evidence
  commentary jsonb,                     -- the Offer template's commentary headings
  recommendation text,                  -- proceed | proceed_with_conditions | do_not_proceed
  summary text,                         -- the recommendation in a paragraph
  issued_at timestamp,                  -- when BGP issued it to the client
  issued_version integer,
  issued_by_user_id varchar,
  issued_by_name text,
  decided_at timestamp,                 -- set while every client decision-maker has approved the current version
  created_by_user_id varchar,
  created_by_name text,
  updated_by_name text,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_unit_recommendations_unit_deal ON unit_recommendations (unit_id, COALESCE(deal_id, ''));

-- One row per client decision-maker (a client-side person on the unit's
-- Targeting Brief). A decision counts only on the current version.
CREATE TABLE IF NOT EXISTS unit_recommendation_decisions (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  recommendation_id varchar NOT NULL,
  brief_person_id varchar NOT NULL,
  version integer NOT NULL,
  decision text NOT NULL,               -- approved | declined | query
  comment text,
  decided_at timestamp NOT NULL DEFAULT now(),
  decided_by_user_id varchar,
  decided_by_name text
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_unit_recommendation_decisions_person ON unit_recommendation_decisions (recommendation_id, brief_person_id);

CREATE TABLE IF NOT EXISTS unit_recommendation_events (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  recommendation_id varchar NOT NULL,
  kind text NOT NULL,
  body text,
  version integer,
  author_user_id varchar,
  author_name text,
  author_role text,
  created_at timestamp DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_unit_recommendation_events_rec ON unit_recommendation_events (recommendation_id, created_at);
