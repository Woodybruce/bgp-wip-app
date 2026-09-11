-- Migration 0017 — CPD log + extended APC tracking
--
-- BGP graduates need 96 CPD hours over the 24 months before sitting their
-- APC; qualified MRICS members need 20 hours/year ongoing. Until now the
-- grad handbook lived as Word + the only "tracker" was a points constant
-- in Brucey Bonuses, so this gives every RICS member a real CPD log on
-- their HR profile.
--
-- New staff_profiles columns surface the three dates Woody wants visible
-- per grad (planned sitting, submission deadline, confirmed assessment),
-- plus the external APC counsellor (typically Mark Hoffman at apc-training
-- .co.uk, but stored per-grad in case that changes).
ALTER TABLE staff_profiles ADD COLUMN IF NOT EXISTS apc_planned_sitting TEXT;
ALTER TABLE staff_profiles ADD COLUMN IF NOT EXISTS apc_submission_deadline TEXT;
ALTER TABLE staff_profiles ADD COLUMN IF NOT EXISTS apc_counsellor_name TEXT;
ALTER TABLE staff_profiles ADD COLUMN IF NOT EXISTS apc_counsellor_email TEXT;

CREATE TABLE IF NOT EXISTS cpd_entries (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR NOT NULL,
  entry_date DATE NOT NULL,
  hours REAL NOT NULL,
  kind TEXT NOT NULL DEFAULT 'informal',
  activity TEXT NOT NULL,
  competency TEXT,
  created_at TIMESTAMP DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cpd_entries_user_idx ON cpd_entries(user_id, entry_date DESC);
