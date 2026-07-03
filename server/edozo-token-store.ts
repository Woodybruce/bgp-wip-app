/**
 * Persistent store for the Edozo API token (the 24h `edozo_jwt` the login
 * mints). The web server reads it here; the scheduled refresher writes it.
 * A single logical row keyed 'edozo_jwt'. Runtime-created, like the other
 * cache tables, so it needs no migration.
 */
import { pool } from "./db";

let ensured = false;
async function ensure(): Promise<void> {
  if (ensured) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS edozo_tokens (
      key TEXT PRIMARY KEY,
      token TEXT NOT NULL,
      expires_at TIMESTAMP,
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);
  ensured = true;
}

// Return a stored token only if it still has comfortable life left (2 min
// buffer), else null so the caller falls back / triggers a refresh.
export async function getStoredEdozoToken(): Promise<string | null> {
  await ensure();
  const { rows } = await pool.query(
    `SELECT token FROM edozo_tokens
      WHERE key = 'edozo_jwt' AND (expires_at IS NULL OR expires_at > NOW() + interval '2 minutes')`,
  );
  return rows[0]?.token || null;
}

export async function setStoredEdozoToken(token: string, expiresAt: Date | null): Promise<void> {
  await ensure();
  await pool.query(
    `INSERT INTO edozo_tokens (key, token, expires_at, updated_at)
     VALUES ('edozo_jwt', $1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET token = EXCLUDED.token, expires_at = EXCLUDED.expires_at, updated_at = NOW()`,
    [token, expiresAt],
  );
}

export async function getStoredEdozoTokenExpiry(): Promise<Date | null> {
  await ensure();
  const { rows } = await pool.query(`SELECT expires_at FROM edozo_tokens WHERE key = 'edozo_jwt'`);
  return rows[0]?.expires_at ? new Date(rows[0].expires_at) : null;
}
