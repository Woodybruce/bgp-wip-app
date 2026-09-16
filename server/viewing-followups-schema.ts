export const VIEWING_FOLLOWUP_SCHEMA_SQL = `
ALTER TABLE user_tasks ADD COLUMN IF NOT EXISTS source TEXT;
ALTER TABLE user_tasks ADD COLUMN IF NOT EXISTS source_ref TEXT;
ALTER TABLE user_tasks ADD COLUMN IF NOT EXISTS assigned_by_user_id VARCHAR;
ALTER TABLE user_tasks ADD COLUMN IF NOT EXISTS assigned_by_name TEXT;
CREATE INDEX IF NOT EXISTS idx_user_tasks_source_ref ON user_tasks(source_ref);
CREATE TABLE IF NOT EXISTS viewing_reminder_deliveries (
  id BIGSERIAL PRIMARY KEY,
  owner_user_id VARCHAR NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('overdue', 'weekly')),
  period_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'claimed' CHECK (status IN ('claimed', 'sent', 'failed')),
  task_count INTEGER NOT NULL,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ,
  error TEXT,
  UNIQUE (owner_user_id, kind, period_key)
);
`;
