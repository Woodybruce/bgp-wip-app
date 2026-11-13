-- Days at stage (Woody, 2026-11-13: "they are there but make no sense").
-- A person can set the date a deal reached its current stage. It applies only
-- while the deal is still at the stage it was set for (stage_since_code).
-- Additive and safe to run again. Nothing is back-filled.
ALTER TABLE landsec_deal_clock ADD COLUMN IF NOT EXISTS stage_since date;
ALTER TABLE landsec_deal_clock ADD COLUMN IF NOT EXISTS stage_since_code text;
ALTER TABLE landsec_deal_clock ADD COLUMN IF NOT EXISTS stage_since_by_name text;
