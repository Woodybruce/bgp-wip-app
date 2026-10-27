import { createCipheriv, createHash, randomBytes } from "node:crypto";
import type { Pool } from "pg";
import { PRIVATE_MAIL_POLICY_VERSION } from "./private-mail";

// Match a whole address in either the mailbox column or JSON participant data.
// Escaped + aliases are private too; similarly named external addresses are not.
const privateAddressPattern = '(^|[^a-zA-Z0-9_.+@-])equity([+][^@[:space:]<>"\\,;]+)?@brucegillinghampollard[.]com($|[^a-zA-Z0-9_.@-])';

export function sealPrivateMail(row: unknown, secret: string): string {
  if (!secret) throw new Error("A stable secret is required to quarantine private mail.");
  const key = createHash("sha256").update(`bgp-private-mail-archive:v1:${secret}`).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(row), "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), encrypted.toString("base64")].join(":");
}

// A trigger cannot use the application encryption key. Its private buffer
// makes newly identified copies inaccessible immediately; the app seals the
// buffer below. Neither private table is exposed by the app's SQL tools.
export async function flushPrivateMailQuarantine(pool: Pool, secret = process.env.SESSION_SECRET): Promise<number> {
  if (!secret) throw new Error("SESSION_SECRET is required to quarantine private mail.");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query("SELECT source_id, source_record FROM private_mail_pending_quarantine ORDER BY source_id LIMIT 500 FOR UPDATE SKIP LOCKED");
    if (rows.length) {
      await client.query(`INSERT INTO private_mail_quarantine(source_id, sealed_record, policy_version)
        SELECT source_id, sealed_record, $3 FROM unnest($1::text[], $2::text[]) AS r(source_id, sealed_record)
        ON CONFLICT(source_id) DO NOTHING`, [rows.map(r => r.source_id), rows.map(r => sealPrivateMail(r.source_record, secret)), PRIVATE_MAIL_POLICY_VERSION]);
      await client.query("DELETE FROM private_mail_pending_quarantine WHERE source_id = ANY($1::text[])", [rows.map(r => r.source_id)]);
    }
    await client.query("COMMIT");
    return rows.length;
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

export async function blockPrivateMailCopies(pool: Pool, record: Record<string, unknown>, mailbox: string | undefined, kind: "messages" | "events") {
  const id = typeof record.id === "string" ? record.id : "";
  const uid = typeof record.iCalUId === "string" ? record.iCalUId : id;
  const ids = kind === "messages" ? [id, id && `email_${id}`] : [id, id && `cal_${id}`, id && `calendar_${id}`, mailbox && uid && `cal_${mailbox}_${uid}`];
  for (const messageId of new Set(ids.filter(Boolean))) await pool.query("SELECT bgp_block_private_copies($1)", [messageId]);
}

// Run before accepting requests. Old mail is removed from every CRM consumer,
// with a recoverable encrypted archive and no change to the Outlook originals.
// The database trigger is a backstop for every ingestion path, not just sync.
export async function ensurePrivateMailBoundary(pool: Pool, secret = process.env.SESSION_SECRET): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(271027631)");
    await client.query(`CREATE TABLE IF NOT EXISTS private_mail_quarantine (
      source_id TEXT PRIMARY KEY, sealed_record TEXT NOT NULL,
      policy_version TEXT NOT NULL, quarantined_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
    await client.query(`CREATE OR REPLACE FUNCTION bgp_private_mail_record(mailbox TEXT, participants JSONB)
      RETURNS BOOLEAN LANGUAGE sql IMMUTABLE AS $$
      SELECT (coalesce(mailbox, '') || ' ' || coalesce(participants::text, '')) ~* '${privateAddressPattern.replaceAll("'", "''")}'
    $$`);
    await client.query(`CREATE TABLE IF NOT EXISTS private_mail_blocked_messages (microsoft_id TEXT PRIMARY KEY)`);
    await client.query(`CREATE TABLE IF NOT EXISTS private_mail_pending_quarantine (source_id TEXT PRIMARY KEY, source_record JSONB NOT NULL)`);
    await client.query(`CREATE OR REPLACE FUNCTION bgp_invalidate_private_mail_caches()
      RETURNS VOID LANGUAGE plpgsql AS $$ BEGIN
      UPDATE crm_companies SET ai_generated_fields = ai_generated_fields - 'email_summary' WHERE ai_generated_fields ? 'email_summary';
      DELETE FROM system_settings WHERE key LIKE 'brand-prepared-take:%';
      IF to_regclass('daily_briefings') IS NOT NULL THEN DELETE FROM daily_briefings; END IF;
      IF to_regclass('crm_activity_cache') IS NOT NULL THEN DELETE FROM crm_activity_cache; END IF;
      END $$`);
    await client.query(`CREATE OR REPLACE FUNCTION bgp_block_private_copies(message_id TEXT)
      RETURNS VOID LANGUAGE plpgsql AS $$ DECLARE moved INTEGER; BEGIN
      PERFORM pg_advisory_xact_lock(271027632, hashtext(message_id));
      INSERT INTO private_mail_blocked_messages VALUES (message_id) ON CONFLICT DO NOTHING;
      WITH removed AS (DELETE FROM crm_interactions WHERE microsoft_id = message_id RETURNING *)
      INSERT INTO private_mail_pending_quarantine(source_id, source_record)
        SELECT id, to_jsonb(removed) FROM removed ON CONFLICT(source_id) DO NOTHING;
      GET DIAGNOSTICS moved = ROW_COUNT;
      IF moved > 0 THEN
        PERFORM bgp_invalidate_private_mail_caches();
      END IF;
      END $$`);
    await client.query(`INSERT INTO private_mail_blocked_messages(microsoft_id)
      SELECT DISTINCT microsoft_id FROM crm_interactions
      WHERE microsoft_id IS NOT NULL AND bgp_private_mail_record(bgp_user, participants)
      ON CONFLICT DO NOTHING`);
    await client.query(`CREATE OR REPLACE FUNCTION bgp_reject_private_interaction()
      RETURNS TRIGGER LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.microsoft_id IS NOT NULL THEN PERFORM pg_advisory_xact_lock(271027632, hashtext(NEW.microsoft_id)); END IF;
      IF bgp_private_mail_record(NEW.bgp_user, NEW.participants) THEN
        IF NEW.microsoft_id IS NOT NULL THEN
          PERFORM bgp_block_private_copies(NEW.microsoft_id);
        END IF;
        IF TG_OP = 'UPDATE' THEN
          IF OLD.microsoft_id IS NOT NULL AND OLD.microsoft_id IS DISTINCT FROM NEW.microsoft_id THEN PERFORM bgp_block_private_copies(OLD.microsoft_id); END IF;
          WITH removed AS (DELETE FROM crm_interactions WHERE id = OLD.id RETURNING *)
          INSERT INTO private_mail_pending_quarantine(source_id, source_record)
            SELECT id, to_jsonb(removed) FROM removed ON CONFLICT(source_id) DO NOTHING;
          PERFORM bgp_invalidate_private_mail_caches();
        END IF;
        RETURN NULL;
      END IF;
      IF NEW.microsoft_id IS NOT NULL AND EXISTS (SELECT 1 FROM private_mail_blocked_messages WHERE microsoft_id=NEW.microsoft_id) THEN RETURN NULL; END IF;
      RETURN NEW; END $$`);
    await client.query("DROP TRIGGER IF EXISTS bgp_private_mail_boundary ON crm_interactions");
    await client.query(`CREATE TRIGGER bgp_private_mail_boundary BEFORE INSERT OR UPDATE ON crm_interactions
      FOR EACH ROW EXECUTE FUNCTION bgp_reject_private_interaction()`);
    // Find old private rows once; batching must not rescan the entire mail
    // archive for every 500 records during production startup.
    await client.query(`CREATE TEMP TABLE bgp_private_mail_migration_ids ON COMMIT DROP AS
      SELECT id FROM crm_interactions WHERE bgp_private_mail_record(bgp_user, participants)
        OR microsoft_id IN (SELECT microsoft_id FROM private_mail_blocked_messages)`);
    let removed = 0;
    while (true) {
      const { rows } = await client.query(`SELECT i.* FROM crm_interactions i
        JOIN bgp_private_mail_migration_ids p ON p.id=i.id
        ORDER BY i.id LIMIT 500 FOR UPDATE OF i`);
      if (!rows.length) break;
      // Never silently discard private source records if encryption cannot run.
      if (!secret) throw new Error("SESSION_SECRET is required to quarantine existing private mail.");
      const ids = rows.map(row => String(row.id));
      const sealed = rows.map(row => sealPrivateMail(row, secret));
      await client.query(`INSERT INTO private_mail_quarantine(source_id, sealed_record, policy_version)
        SELECT source_id, sealed_record, $3 FROM unnest($1::text[], $2::text[]) AS r(source_id, sealed_record)
        ON CONFLICT(source_id) DO NOTHING`, [ids, sealed, PRIVATE_MAIL_POLICY_VERSION]);
      const deleted = await client.query("DELETE FROM crm_interactions WHERE id = ANY($1::text[])", [ids]);
      await client.query("DELETE FROM bgp_private_mail_migration_ids WHERE id = ANY($1::text[])", [ids]);
      removed += deleted.rowCount || 0;
    }
    const { rows: applied } = await client.query("SELECT value FROM system_settings WHERE key = 'private-mail-policy'");
    if (removed || applied[0]?.value?.version !== PRIVATE_MAIL_POLICY_VERSION) {
      // These are generated caches, not user-authored business records.
      await client.query(`UPDATE crm_companies SET ai_generated_fields = ai_generated_fields - 'email_summary'
        WHERE ai_generated_fields ? 'email_summary'`);
      await client.query("DELETE FROM system_settings WHERE key LIKE 'brand-prepared-take:%'");
      // Briefings are generated from mail and calendars and can be regenerated.
      await client.query(`DO $$ BEGIN IF to_regclass('daily_briefings') IS NOT NULL THEN
        DELETE FROM daily_briefings;
      END IF; END $$`);
      await client.query(`DO $$ BEGIN IF to_regclass('crm_activity_cache') IS NOT NULL THEN
        DELETE FROM crm_activity_cache;
      END IF; END $$`);
      await client.query(`INSERT INTO system_settings(key, value, updated_at) VALUES ('private-mail-policy', $1::jsonb, now())
        ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
        [JSON.stringify({ version: PRIVATE_MAIL_POLICY_VERSION })]);
    }
    await client.query("COMMIT");
    return removed;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}
