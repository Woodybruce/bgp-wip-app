/**
 * Persistent Xero session for background processes (webhooks, scheduled jobs).
 *
 * The Xero OAuth flow is per-user-session, but background flows (Stripe
 * webhooks → expense auto-post, scheduled month-end imports) have no HTTP
 * request to attach to. This module persists the most recent Xero refresh
 * token in the system_settings table and rehydrates it on demand, refreshing
 * the access token as needed.
 *
 * Usage:
 *   - When an admin user connects Xero, captureSystemXeroSession(req.session)
 *     stores their refresh token system-wide.
 *   - Background jobs call getSystemXeroSession() to get a session-shaped
 *     object compatible with xeroApi() and refreshXeroToken().
 */
import { db, pool } from "./db";
import { sql } from "drizzle-orm";

const SYSTEM_KEY = "xero_system_session";

interface PersistedTokens {
  refreshToken: string;
  accessToken: string;
  expiresAt: number;
  tenantId?: string;
}

async function ensureTable(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value JSONB,
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);
}

export async function captureSystemXeroSession(session: any): Promise<void> {
  if (!session?.xeroTokens?.refreshToken) return;
  await ensureTable();

  const tokens: PersistedTokens = {
    refreshToken: session.xeroTokens.refreshToken,
    accessToken: session.xeroTokens.accessToken,
    expiresAt: session.xeroTokens.expiresAt,
    tenantId: session.xeroTokens.tenantId,
  };

  await db.execute(sql`
    INSERT INTO system_settings (key, value, updated_at)
    VALUES (${SYSTEM_KEY}, ${JSON.stringify(tokens)}::jsonb, NOW())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
  `);

  console.log("[xero-system] System Xero session captured");
}

/**
 * Returns a session-shaped object that xeroApi() and refreshXeroToken() can
 * read from and write back to. The returned object's xeroTokens are mutated
 * in place by refreshXeroToken() with new access tokens — we persist those
 * mutations back to system_settings so the next caller doesn't re-refresh.
 */
export async function getSystemXeroSession(): Promise<{ xeroTokens: PersistedTokens; save: () => Promise<void> } | null> {
  await ensureTable();
  const result = await db.execute(sql`SELECT value FROM system_settings WHERE key = ${SYSTEM_KEY} LIMIT 1`);
  const row = (result as any).rows?.[0];
  if (!row?.value) return null;

  const tokens: PersistedTokens = typeof row.value === "string" ? JSON.parse(row.value) : row.value;
  if (!tokens.refreshToken) return null;

  // Build a session-like object. xeroApi() does `session.xeroTokens.tenantId = ...`
  // so we wrap in a Proxy-free plain object and persist mutations after the call.
  const session = { xeroTokens: { ...tokens } };

  return {
    xeroTokens: session.xeroTokens,
    save: async () => {
      await db.execute(sql`
        UPDATE system_settings SET value = ${JSON.stringify(session.xeroTokens)}::jsonb, updated_at = NOW()
        WHERE key = ${SYSTEM_KEY} AND value->>'refreshToken' = ${tokens.refreshToken}
      `);
    },
  };
}

/** Latest persisted tokens, or null when nothing is stored. */
export async function readPersistedXeroTokens(): Promise<PersistedTokens | null> {
  await ensureTable();
  const result = await db.execute(sql`SELECT value FROM system_settings WHERE key = ${SYSTEM_KEY} LIMIT 1`);
  const row = (result as any).rows?.[0];
  if (!row?.value) return null;
  const tokens: PersistedTokens = typeof row.value === "string" ? JSON.parse(row.value) : row.value;
  return tokens.refreshToken ? tokens : null;
}

/**
 * Xero rotates the refresh token on every refresh. Whoever performs a
 * rotation — a background job on the system copy OR a director's browser
 * session holding the same token — must write the new pair back here, or
 * the other copy goes stale and its next refresh dies with "refresh token
 * has been consumed". Only updates when the stored token is the one that
 * was just consumed, so an unrelated lineage is never overwritten.
 */
export async function adoptRotatedXeroTokens(consumedRefreshToken: string, tokens: PersistedTokens): Promise<boolean> {
  await ensureTable();
  const result = await db.execute(sql`
    UPDATE system_settings SET value = ${JSON.stringify(tokens)}::jsonb, updated_at = NOW()
    WHERE key = ${SYSTEM_KEY} AND value->>'refreshToken' = ${consumedRefreshToken}
  `);
  return ((result as any).rowCount || 0) > 0;
}

/**
 * Serialises token refreshes across processes (two Railway containers
 * overlap on every deploy) with a Postgres advisory lock. Falls back to
 * running unlocked if the lock can't be taken, so a DB hiccup never
 * blocks a refresh outright.
 */
export async function withXeroRefreshLock<T>(fn: () => Promise<T>): Promise<T> {
  let client: any = null;
  try {
    client = await pool.connect();
    await client.query("SELECT pg_advisory_lock(hashtext('xero_token_refresh'))");
  } catch (e: any) {
    console.warn("[xero-system] refresh lock unavailable, continuing unlocked:", e?.message);
    if (client) { try { client.release(); } catch {} }
    client = null;
  }
  try {
    return await fn();
  } finally {
    if (client) {
      try { await client.query("SELECT pg_advisory_unlock(hashtext('xero_token_refresh'))"); } catch {}
      try { client.release(); } catch {}
    }
  }
}

/**
 * Wipes the persisted system Xero tokens. Called by refreshXeroToken
 * when Xero returns `invalid_grant` (the RT was consumed by a parallel
 * refresh, revoked, or expired) — keeps the system session from
 * silently retrying a dead token forever and makes the admin Reconnect
 * banner light up on the next status check.
 */
export async function clearSystemXeroSession(): Promise<void> {
  await ensureTable();
  await db.execute(sql`DELETE FROM system_settings WHERE key = ${SYSTEM_KEY}`);
  console.warn("[xero-system] Persisted Xero tokens cleared — admin must reconnect");
}

/**
 * Quick health check for the admin UI. Returns whether the system has
 * a Xero session stored and how stale the access token is so a banner
 * can prompt the admin to reconnect proactively.
 */
export async function getSystemXeroStatus(): Promise<{ connected: boolean; tenantId: string | null; expiresAt: number | null }> {
  await ensureTable();
  const result = await db.execute(sql`SELECT value FROM system_settings WHERE key = ${SYSTEM_KEY} LIMIT 1`);
  const row = (result as any).rows?.[0];
  if (!row?.value) return { connected: false, tenantId: null, expiresAt: null };
  const tokens: PersistedTokens = typeof row.value === "string" ? JSON.parse(row.value) : row.value;
  return { connected: !!tokens.refreshToken, tenantId: tokens.tenantId || null, expiresAt: tokens.expiresAt || null };
}

/**
 * Convenience wrapper — runs an xeroApi call with the system session,
 * persisting any token refresh that happens during the call.
 */
export async function withSystemXero<T>(fn: (session: any) => Promise<T>): Promise<T | null> {
  const sys = await getSystemXeroSession();
  if (!sys) {
    console.warn("[xero-system] No system Xero session available — skipping");
    return null;
  }
  const original = { ...sys.xeroTokens };
  const session = { xeroTokens: { ...sys.xeroTokens } };
  let operationFailed = false;
  try {
    return await fn(session);
  } catch (e: any) {
    operationFailed = true;
    console.error("[xero-system] call failed:", e?.message);
    throw e;
  } finally {
    // Refresh can succeed before the accounting request fails. Persist the
    // rotation either way, but never restore tokens cleared by invalid_grant.
    if (session.xeroTokens?.refreshToken && (
        session.xeroTokens.accessToken !== original.accessToken ||
        session.xeroTokens.refreshToken !== original.refreshToken ||
        session.xeroTokens.expiresAt !== original.expiresAt ||
        session.xeroTokens.tenantId !== original.tenantId)) {
      Object.assign(sys.xeroTokens, session.xeroTokens);
      try {
        await sys.save();
      } catch (e: any) {
        console.error("[xero-system] token persistence failed:", e?.message);
        if (!operationFailed) throw e;
      }
    }
  }
}
