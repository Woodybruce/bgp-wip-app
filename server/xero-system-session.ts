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
import { db } from "./db";
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
        WHERE key = ${SYSTEM_KEY}
      `);
    },
  };
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
  const session = { xeroTokens: sys.xeroTokens };
  try {
    const result = await fn(session);
    // Persist any token refresh that happened during the call
    if (session.xeroTokens?.accessToken !== sys.xeroTokens.accessToken ||
        session.xeroTokens?.expiresAt !== sys.xeroTokens.expiresAt ||
        session.xeroTokens?.tenantId !== sys.xeroTokens.tenantId) {
      Object.assign(sys.xeroTokens, session.xeroTokens);
      await sys.save();
    }
    return result;
  } catch (e: any) {
    console.error("[xero-system] call failed:", e?.message);
    throw e;
  }
}
