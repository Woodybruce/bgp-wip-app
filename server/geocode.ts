// Google Geocoding helper with caching. Used by the landlord Ownership
// flow to plot scraped + Land Registry properties on the map.
//
// We hit /maps/api/geocode/json (cheaper than Places text-search:
// ~$5/1000 vs $17/1000) and cache forever per input query in a
// geocode_cache table — same postcode resolved 500 times across the
// landlord roster costs one API call.
//
// Cache key normalises: lowercase, collapse whitespace, plus the country
// hint when one is given — so a poisoned legacy entry ("dundrum town
// centre, uk" → Newcastle BT33) is simply never hit again once discovery
// passes hint=IE, with no cache purge needed. Misses are cached too (with
// lat/lng=NULL) so we don't pay to re-lookup a genuinely-unfindable
// address every render.
//
// Country hints (Delivery 2): with a hint we bias to that country
// (region=<iso>, components=country:<ISO>) and VALIDATE the result's
// country against the hint — a mismatch is treated as unresolved and
// cached as a NULL miss. Uncertain matches stay unplotted rather than
// acquiring a guessed location. With no hint, the legacy UK bias
// (region=uk, components=country:GB) is preserved so existing UK-only
// callers are untouched.

type Querier = { query(sql: string, params?: any[]): Promise<{ rows: any[]; rowCount?: number | null }> };

let _querier: Querier | null = null;
export function setGeocodeQuerierForTests(q: Querier | null): void {
  _querier = q;
  _tableEnsured = false;
}

async function dbq(sql: string, params?: any[]) {
  const q = _querier ?? (await import("./db")).pool;
  return q.query(sql, params);
}

let _tableEnsured = false;
async function ensureCache() {
  if (_tableEnsured) return;
  await dbq(`
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

export interface GeocodeOptions {
  countryHint?: string | null;
}

export async function geocodeOne(query: string, opts: GeocodeOptions = {}): Promise<GeocodeResult> {
  await ensureCache();
  const hint = opts.countryHint?.trim().toUpperCase() || null;
  const base = cacheKey(query);
  const key = `${base}|${hint ?? ""}`;
  if (!base) return { query, lat: null, lng: null, formattedAddress: null };

  // Cache hit?
  const cached = await dbq(
    `SELECT lat, lng, formatted_address FROM geocode_cache WHERE query = $1`,
    [key]
  );
  if (cached.rows.length > 0) {
    const r = cached.rows[0];
    return { query, lat: r.lat, lng: r.lng, formattedAddress: r.formatted_address };
  }

  const GOOGLE_KEY = process.env.GOOGLE_API_KEY;
  if (!GOOGLE_KEY) {
    // Stash a NULL miss so callers don't loop. Avoids hard-error
    // surface when the env var is missing in dev.
    await dbq(
      `INSERT INTO geocode_cache (query, lat, lng, formatted_address) VALUES ($1, NULL, NULL, NULL) ON CONFLICT (query) DO NOTHING`,
      [key]
    );
    return { query, lat: null, lng: null, formattedAddress: null };
  }

  // With a hint: bias to that country and validate the result against it.
  // Without: the legacy UK bias — address-quality results ranked over POI
  // matches (we want "Bluewater, Greenhithe" to land on the actual
  // shopping centre, not a coffee shop nearby).
  const region = hint ? hint.toLowerCase() : "uk";
  const countryFilter = hint ?? "GB";
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}&region=${region}&components=country:${countryFilter}&key=${GOOGLE_KEY}`;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const body: any = await r.json().catch(() => ({}));
    const first = body?.results?.[0];
    const loc = first?.geometry?.location;
    const resultCountry = first?.address_components
      ?.find((c: any) => Array.isArray(c?.types) && c.types.includes("country"))
      ?.short_name?.toUpperCase();
    // Hint/result country mismatch (or an unverifiable result when a hint
    // was given): unresolved. This is the Dundrum→Newcastle fix — with
    // hint IE, a BT33 (GB) result fails validation and the asset stays
    // unplotted instead of wrongly plotted.
    const mismatch = hint != null && resultCountry !== hint;
    if (!first || !loc || typeof loc.lat !== "number" || mismatch) {
      await dbq(
        `INSERT INTO geocode_cache (query, lat, lng, formatted_address) VALUES ($1, NULL, NULL, NULL) ON CONFLICT (query) DO NOTHING`,
        [key]
      );
      return { query, lat: null, lng: null, formattedAddress: null };
    }
    await dbq(
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

export interface GeocodeItem {
  query: string;
  countryHint?: string | null;
}

// Geocode in parallel (capped concurrency so we don't blow through
// Google's per-second quota or rate-limit ourselves into a 429).
export async function geocodeBatch(items: Array<string | GeocodeItem>, concurrency = 4): Promise<GeocodeResult[]> {
  const results: GeocodeResult[] = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      const item = items[idx];
      results[idx] = typeof item === "string"
        ? await geocodeOne(item)
        : await geocodeOne(item.query, { countryHint: item.countryHint });
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}
