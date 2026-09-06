-- Migration 0023 — News tag vocabulary
--
-- Editable controlled vocabulary used by the AI news scorer to tag every
-- article. Any logged-in user can add / remove / disable tags via the news
-- settings UI (not admin-gated). Seeded with Harry's initial wishlist.

CREATE TABLE IF NOT EXISTS news_tags (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,           -- lower-case identifier, e.g. "new openings"
  label TEXT NOT NULL,                 -- display label, e.g. "New openings"
  active BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  created_by VARCHAR,
  created_at TIMESTAMP DEFAULT now()
);

CREATE INDEX IF NOT EXISTS news_tags_active_idx ON news_tags (sort_order) WHERE active = true;

-- Seed with Harry's wishlist
INSERT INTO news_tags (name, label, sort_order) VALUES
  ('new openings',      'New openings',      10),
  ('flagships',         'Flagships',         20),
  ('dtc',               'DTC',               30),
  ('brand performance', 'Brand performance', 40),
  ('global retail',     'Global retail',     50),
  ('retail',            'Retail',            60),
  ('fashion',           'Fashion',           70),
  ('high street',       'High street',       80),
  ('wellness',          'Wellness',          90),
  ('new operators',     'New operators',    100)
ON CONFLICT (name) DO NOTHING;
