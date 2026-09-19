// Startup equivalent of migrations/0038_leasing_viewings.sql.
import { pool } from "./db";

export const LEASING_VIEWING_DDL = [
  "ALTER TABLE unit_viewings ALTER COLUMN unit_id DROP NOT NULL",
  "ALTER TABLE unit_viewings ADD COLUMN IF NOT EXISTS booking_id TEXT",
  "ALTER TABLE unit_viewings ADD COLUMN IF NOT EXISTS agent_contact_id VARCHAR",
  "ALTER TABLE unit_viewings ADD COLUMN IF NOT EXISTS owner_user_id VARCHAR",
  "ALTER TABLE unit_viewings ADD COLUMN IF NOT EXISTS requirement_id VARCHAR",
  "ALTER TABLE unit_viewings ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'scheduled'",
  "ALTER TABLE unit_viewings ADD COLUMN IF NOT EXISTS details_confirmed_at TIMESTAMPTZ",
  "ALTER TABLE unit_viewings ADD COLUMN IF NOT EXISTS outcome_recorded_at TIMESTAMPTZ",
  "ALTER TABLE unit_viewings ADD COLUMN IF NOT EXISTS outcome_by_user_id VARCHAR",
  "ALTER TABLE unit_viewings ADD COLUMN IF NOT EXISTS next_action TEXT",
  "ALTER TABLE unit_viewings ADD COLUMN IF NOT EXISTS follow_up_date TEXT",
  "ALTER TABLE unit_viewings ADD COLUMN IF NOT EXISTS source_details JSONB",
  "ALTER TABLE unit_viewings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now()",
  "ALTER TABLE unit_viewings ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ",
  "ALTER TABLE unit_offers ADD COLUMN IF NOT EXISTS viewing_id VARCHAR",
  "ALTER TABLE unit_offers ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ",
  "CREATE INDEX IF NOT EXISTS unit_viewings_booking_idx ON unit_viewings (booking_id)",
  "CREATE INDEX IF NOT EXISTS unit_viewings_requirement_idx ON unit_viewings (requirement_id)",
  "CREATE INDEX IF NOT EXISTS unit_viewings_owner_date_idx ON unit_viewings (owner_user_id, viewing_date)",
  "CREATE INDEX IF NOT EXISTS unit_offers_viewing_idx ON unit_offers (viewing_id)",
  "UPDATE unit_viewings SET\n  status = CASE WHEN status='scheduled' AND outcome='No Show' THEN 'no_show'\n    WHEN status='scheduled' AND outcome IN ('Interested','Not Interested','Follow Up','Offer Expected','Second Viewing','Offer Received') THEN 'completed'\n    ELSE status END,\n  outcome = CASE WHEN outcome='No Show' THEN NULL ELSE NULLIF(btrim(outcome),'') END,\n  source_details = COALESCE(source_details,'{}'::jsonb) || '{\"workflowVersion\":1}'::jsonb\nWHERE NOT (COALESCE(source_details,'{}'::jsonb) ? 'workflowVersion')"
] as const;

export async function ensureLeasingViewingSchema() {
  for (const statement of LEASING_VIEWING_DDL) await pool.query(statement);
}
