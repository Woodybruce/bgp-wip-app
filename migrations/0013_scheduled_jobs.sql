-- Migration 0013 — scheduled_jobs table
--
-- ChatBGP can author scheduled jobs by inserting rows into this table
-- (via sql_write). A worker in server/scheduled-jobs.ts polls every
-- minute, picks rows where next_run_at <= now() AND enabled = true,
-- runs the action_payload, and recomputes next_run_at.
--
-- Action kinds:
--   sql_query — run a SELECT, store first 5KB of stringified rows
--   sql_write — run insert/update/delete via the same path as the
--               sql_write tool, with audit log
--   send_chat_message — post a message to a thread (e.g. daily digest)
--   send_email — hand off to the email send pipeline
--
-- Schedule kinds:
--   daily — schedule_value is "HH:MM" (24h, server tz)
--   weekly — schedule_value is "DOW:HH:MM" e.g. "MON:09:00"
--   hourly — schedule_value is "MM" e.g. "00" (top of every hour)
--   cron — schedule_value is a 5-field cron expression
--
-- Idempotent — DO blocks check before adding constraints.

CREATE TABLE IF NOT EXISTS scheduled_jobs (
  id              VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  description     TEXT,
  schedule_kind   TEXT NOT NULL,
  schedule_value  TEXT NOT NULL,
  action_kind     TEXT NOT NULL,
  action_payload  JSONB NOT NULL,
  enabled         BOOLEAN NOT NULL DEFAULT true,
  created_by      VARCHAR,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  next_run_at     TIMESTAMPTZ NOT NULL,
  last_run_at     TIMESTAMPTZ,
  last_run_status TEXT,        -- 'ok' | 'error' | 'skipped'
  last_run_output TEXT,        -- truncated to 5000 chars
  last_run_ms     INTEGER,
  run_count       INTEGER NOT NULL DEFAULT 0,
  error_count     INTEGER NOT NULL DEFAULT 0
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'scheduled_jobs_schedule_kind_check'
  ) THEN
    ALTER TABLE scheduled_jobs
      ADD CONSTRAINT scheduled_jobs_schedule_kind_check
      CHECK (schedule_kind IN ('daily', 'weekly', 'hourly', 'cron'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'scheduled_jobs_action_kind_check'
  ) THEN
    ALTER TABLE scheduled_jobs
      ADD CONSTRAINT scheduled_jobs_action_kind_check
      CHECK (action_kind IN ('sql_query', 'sql_write', 'send_chat_message', 'send_email'));
  END IF;
END $$;

-- Hot path: worker polls "enabled AND next_run_at <= now()" every minute.
CREATE INDEX IF NOT EXISTS scheduled_jobs_next_run_idx
  ON scheduled_jobs (next_run_at)
  WHERE enabled = true;
