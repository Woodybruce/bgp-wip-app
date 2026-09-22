-- Org chart enhancement (May 2026)
-- Adds the fields Layla called out as missing from /hr — DOB, address, WFH days,
-- employment type, CV link — plus board / management flags so the chart can
-- pip them. All additive, all nullable, idempotent.

ALTER TABLE staff_profiles
  ADD COLUMN IF NOT EXISTS dob text,
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS wfh_days text[],
  ADD COLUMN IF NOT EXISTS employment_type text,
  ADD COLUMN IF NOT EXISTS cv_sharepoint_url text,
  ADD COLUMN IF NOT EXISTS board_member boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS management_team boolean DEFAULT false;
