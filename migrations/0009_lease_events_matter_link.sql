-- Migration 0009 — link lease_events to PLA matters
--
-- When a PLA matter is created or its key dates change, we now auto-write
-- corresponding lease_events rows. This means the property dashboard, the
-- lease-events board and any "what's coming up" view automatically reflect
-- matter activity (review due, break notice deadline, expiry approaching).
-- The matter_id column lets us delete-and-rewrite atomically when a
-- matter's dates change, without leaving orphan events behind.

ALTER TABLE lease_events
  ADD COLUMN IF NOT EXISTS matter_id varchar;

CREATE INDEX IF NOT EXISTS lease_events_matter_idx
  ON lease_events (matter_id) WHERE matter_id IS NOT NULL;
