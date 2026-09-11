// Google Geocoding helper with caching. Used by the landlord Ownership
// flow to plot scraped + Land Registry properties on the map.
//
// We hit /maps/api/geocode/json (cheaper than Places text-search:
// ~$5/1000 vs $17/1000). UK-biased and cached forever per input query
// in a geocode_cache table — same postcode resolved 500 times across
// the landlord roster costs one API call.
//
// Cache key normalises: lowercase, collapse whitespace. Misses are
// cached too (with lat/lng=NULL) so we don't pay to re-lookup a
// genuinely-unfindable address every render.
import { pool } from "./db";

const GOOGLE_KEY = process.env.GOOGLE_API_KEY;

let _tableEnsured = false;
async function ensureCache() {
  if (_tableEnsured) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS geocode_cache (
      query TEXT PRIMARY KEY,
      lat DOUBLE PRECISION,
      lng DOUBLE PRECISION,
      formatted_address TEXT,
      place_id TEXT,
      cached_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  _tableEnsured = true;
}

function cacheKey(q: string): string {
  return q.toLowerCase().replace(/\s+/g, " ").trim();
}

export interface GeocodeResult {
  query: string;
  lat: number | null;
  lng: number | null;
  formattedAddress: string | null;
}

export async function geocodeOne(query: string): Promise<GeocodeResult> {
  await ensureCache();
  const key = cacheKey(query);
  if (!key) return { query, lat: null, lng: null, formattedAddress: null };

  // Cache hit?
  const cached = await pool.query(
    `SELECT lat, lng, formatted_address FROM geocode_cache WHERE query = $1`,
    [key]
  );
  if (cached.rows.length > 0) {
    const r = cached.rows[0];
    return { query, lat: r.lat, lng: r.lng, formattedAddress: r.formatted_address };
  }

  if (!GOOGLE_KEY) {
    // Stash a NULL miss so callers don't loop. Avoids hard-error
    // surface when the env var is missing in dev.
    await pool.query(
      `INSERT INTO geocode_cache (query, lat, lng, formatted_address) VALUES ($1, NULL, NULL, NULL) ON CONFLICT (query) DO NOTHING`,
      [key]
    );
    return { query, lat: null, lng: null, formattedAddress: null };
  }

  // UK-biased — region=uk + ISO country filter. Address-quality results
  // ranked over POI matches (we want "Bluewater, Greenhithe" to land on
  // the actual shopping centre, not a coffee shop nearby).
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}&region=uk&components=country:GB&key=${GOOGLE_KEY}`;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const body: any = await r.json().catch(() => ({}));
    const first = body?.results?.[0];
    const loc = first?.geometry?.location;
    if (!first || !loc || typeof loc.lat !== "number") {
      await pool.query(
        `INSERT INTO geocode_cache (query, lat, lng, formatted_address) VALUES ($1, NULL, NULL, NULL) ON CONFLICT (query) DO NOTHING`,
        [key]
      );
      return { query, lat: null, lng: null, formattedAddress: null };
    }
    await pool.query(
      `INSERT INTO geocode_cache (query, lat, lng, formatted_address, place_id)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (query) DO UPDATE SET lat = $2, lng = $3, formatted_address = $4, place_id = $5, cached_at = NOW()`,
      [key, loc.lat, loc.lng, first.formatted_address || null, first.place_id || null]
    );
    return { query, lat: loc.lat, lng: loc.lng, formattedAddress: first.formatted_address || null };
  } catch {
    return { query, lat: null, lng: null, formattedAddress: null };
  }
}

// Geocode in parallel (capped concurrency so we don't blow through
// Google's per-second quota or rate-limit ourselves into a 429).
export async function geocodeBatch(queries: string[], concurrency = 4): Promise<GeocodeResult[]> {
  const results: GeocodeResult[] = new Array(queries.length);
  let i = 0;
  async function worker() {
    while (i < queries.length) {
      const idx = i++;
      results[idx] = await geocodeOne(queries[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, queries.length) }, () => worker()));
  return results;
}
