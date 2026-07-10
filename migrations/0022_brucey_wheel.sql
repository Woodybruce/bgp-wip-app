-- Migration 0022 — Brucey Bonus Wheel
--
-- Adds the prize pool + winners history for the monthly/quarterly Brucey
-- Bonus prize wheel. The leaderboard query itself doesn't change — it's
-- just parameterised on a period window. brucey_prizes seeds an initial
-- pool which Woody can edit on the admin page.

CREATE TABLE IF NOT EXISTS brucey_prizes (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  label TEXT NOT NULL,
  description TEXT,
  emoji TEXT,
  tier TEXT NOT NULL DEFAULT 'monthly',
  sort_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT now()
);
CREATE INDEX IF NOT EXISTS brucey_prizes_tier_idx ON brucey_prizes (tier, sort_order) WHERE is_active = true;

CREATE TABLE IF NOT EXISTS brucey_winners (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR NOT NULL,
  period_type TEXT NOT NULL,       -- 'month' | 'quarter'
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  points INTEGER NOT NULL,
  prize_id VARCHAR,
  prize_label TEXT,
  spun_at TIMESTAMP DEFAULT now(),
  spun_by_user_id VARCHAR,
  notes TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS brucey_winners_period_idx ON brucey_winners (period_type, period_start);
CREATE INDEX IF NOT EXISTS brucey_winners_user_idx ON brucey_winners (user_id, spun_at DESC);

-- Seed a starter prize pool. Woody can edit/extend/disable via the admin UI.
INSERT INTO brucey_prizes (label, description, emoji, tier, sort_order) VALUES
  ('Watch House lunch',        'Sandwich + coffee on the firm',                       '☕', 'monthly',   1),
  ('Half-day Friday',          'Knock off at lunch on the Friday of your choosing',   '🌴', 'monthly',   2),
  ('£50 voucher',              'Amazon / John Lewis / whoever',                       '💷', 'monthly',   3),
  ('Bottle of bubbles',        'Decent fizz, your desk on Monday',                    '🍾', 'monthly',   4),
  ('Cinema tickets x2',        'Cineworld pair',                                      '🎬', 'monthly',   5),
  ('Coffee for the team',      'Watch House run on you, on us',                       '🫖', 'monthly',   6),
  ('Restaurant for two',       'Dinner for two at a Tom-and-Pete-approved spot',      '🍽️', 'quarterly', 1),
  ('Spa half-day',             'Treat yourself',                                      '💆', 'quarterly', 2),
  ('Theatre tickets',          'Two tickets to a West End show',                      '🎭', 'quarterly', 3),
  ('£250 voucher',             'Quarterly grand prize',                               '💰', 'quarterly', 4)
ON CONFLICT DO NOTHING;
