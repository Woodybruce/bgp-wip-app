import { pool } from "../db";

// Simple Postgres-backed cache for paid property-intelligence API calls.
// TTL defaults to 30 days — planning, Land Registry, VOA all change slowly,
// and a fresh Pathway run costs real money if we re-hit every endpoint.

const DEFAULT_TTL_HOURS = 24 * 30;

let purgeTimer: NodeJS.Timeout | null = null;

async function purgeExpired() {
  try {
    const res = await pool.query(`DELETE FROM property_intelligence_cache WHERE expires_at < NOW()`);
    if (res.rowCount && res.rowCount > 0) {
      console.log(`[intel-cache] purged ${res.rowCount} expired entries`);
    }
  } catch (err: any) {
    // Table may not exist yet on first boot — ignore
    if (!/does not exist/i.test(err?.message || "")) {
      console.error("[intel-cache] purge error:", err?.message);
    }
  }
}

export function startIntelCachePurge() {
  if (purgeTimer) return;
  setTimeout(() => purgeExpired(), 2 * 60 * 1000);
  purgeTimer = setInterval(purgeExpired, 6 * 60 * 60 * 1000);
}

// Wrap an async fetcher with cache-then-fetch logic. `key` should uniquely identify
// the query (e.g. "planning:SW1A1AA"). Stored payload must be JSON-serialisable.
export async function cached<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttlHours: number = DEFAULT_TTL_HOURS
): Promise<T> {
  try {
    const hit = await pool.query(
      `SELECT payload FROM property_intelligence_cache WHERE cache_key = $1 AND expires_at > NOW() LIMIT 1`,
      [key]
    );
    if (hit.rows.length) {
      return hit.rows[0].payload as T;
    }
  } catch (err: any) {
    // Table missing / connection issue — fall through to fetch
    if (!/does not exist/i.test(err?.message || "")) {
      console.warn("[intel-cache] read failed:", err?.message);
    }
  }

  const fresh = await fetcher();

  try {
    const expires = new Date(Date.now() + ttlHours * 60 * 60 * 1000);
    await pool.query(
      `INSERT INTO property_intelligence_cache (cache_key, payload, expires_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (cache_key) DO UPDATE SET payload = EXCLUDED.payload, expires_at = EXCLUDED.expires_at, created_at = NOW()`,
      [key, JSON.stringify(fresh ?? null), expires]
    );
  } catch (err: any) {
    console.warn("[intel-cache] write failed:", err?.message);
  }

  return fresh;
}

// Read a cached value without triggering a fetch. Returns null on miss.
export async function getCachedOnly<T>(key: string): Promise<T | null> {
  try {
    const hit = await pool.query(
      `SELECT payload FROM property_intelligence_cache WHERE cache_key = $1 AND expires_at > NOW() LIMIT 1`,
      [key]
    );
    if (hit.rows.length) return hit.rows[0].payload as T;
  } catch {}
  return null;
}

// Manually invalidate a single key (e.g. user requests a fresh pull).
export async function invalidateIntelCache(keyPrefix: string): Promise<number> {
  try {
    const res = await pool.query(
      `DELETE FROM property_intelligence_cache WHERE cache_key LIKE $1`,
      [`${keyPrefix}%`]
    );
    return res.rowCount || 0;
  } catch (err: any) {
    console.warn("[intel-cache] invalidate failed:", err?.message);
    return 0;
  }
}
