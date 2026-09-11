-- Migration 0018 — Staff CV fields
--
-- Per-person CV data that the HR dashboard renders into a downloadable
-- BGP-house-style PDF + Word doc. The name / title / photo / education /
-- RICS / tenure all reuse existing staff_profile fields; the four new
-- columns hold the bits we can't infer:
--   • cv_summary — personal statement (longer than the existing bio)
--   • cv_specialisms — short bullets shown as expertise tags
--   • cv_notable_clients — text array, agency CV staple
--   • cv_career_history — JSONB array of {role, employer, startYear, endYear?}
--     for roles before BGP. The BGP role itself is auto-filled from
--     staff_profiles.start_date + title.
ALTER TABLE staff_profiles ADD COLUMN IF NOT EXISTS cv_summary TEXT;
ALTER TABLE staff_profiles ADD COLUMN IF NOT EXISTS cv_specialisms TEXT[];
ALTER TABLE staff_profiles ADD COLUMN IF NOT EXISTS cv_notable_clients TEXT[];
ALTER TABLE staff_profiles ADD COLUMN IF NOT EXISTS cv_career_history JSONB;
