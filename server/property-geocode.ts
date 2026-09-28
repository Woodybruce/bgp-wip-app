// Free geocoding for CRM properties — "dots not working on the map"
// (Woody, 2026-09-28). Ardent's Properties board listed 19 properties but
// plotted one: only rows entered through the Google address picker ever got
// latitude/longitude, so anything created by an import, ChatBGP, the
// landlord scraper or a typed postcode sat off every map for good.
//
// Postcode → postcodes.io (free, no key); otherwise the address text →
// Nominatim through os-data's shared 1 req/s queue. Never Google. Writes
// only when the row has no coordinates, and stamps geocode_status
// ('resolved' / 'unresolved') so the sweep doesn't retry a row it couldn't
// place — a later address edit re-runs it.

type Querier = { query(sql: string, params?: any[]): Promise<{ rows: any[]; rowCount?: number | null }> };
type Point = { lat: number; lng: number };

export interface PropertyGeocodeDeps {
  pool?: Querier;
  postcodeLookup?: (postcode: string) => Promise<Point | null>;
  addressLookup?: (query: string, country: string) => Promise<Point | null>;
  delayMs?: number;
}

export interface PropertyGeocodeRow {
  id: string;
  name?: string | null;
  address?: any;
  postcode?: string | null;
  country?: string | null;
}

const UK_POSTCODE = /\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/i;
const UK_COUNTRY = /^(uk|gb|gbr|united kingdom|great britain|england|scotland|wales|northern ireland)$/i;

function ukPostcode(...texts: Array<string | null | undefined>): string | null {
  for (const t of texts) {
    const m = String(t || "").match(UK_POSTCODE);
    if (m) return `${m[1]} ${m[2]}`.toUpperCase();
  }
  return null;
}

function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : null;
}

// What a row gives us to locate it: coordinates already sitting in the
// address JSON, a full UK postcode, and address text for Nominatim.
export function geocodeInputs(p: PropertyGeocodeRow): { stored: Point | null; country: string | null; postcode: string | null; queries: string[] } {
  const addr = p.address && typeof p.address === "object" ? p.address : {};
  const addrText = typeof p.address === "string" ? p.address : "";
  const lat = num(addr.lat), lng = num(addr.lng);
  const stored = lat != null && lng != null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0) ? { lat, lng } : null;

  const rawCountry = String(p.country || addr.country || "").trim();
  const country = !rawCountry || UK_COUNTRY.test(rawCountry) ? "GB" : /^[A-Z]{2}$/i.test(rawCountry) ? rawCountry.toUpperCase() : null;

  const line = addrText || addr.formatted || [addr.street || addr.line1 || addr.address, addr.city || addr.town, addr.postcode].filter(Boolean).join(", ");
  const postcode = country === "GB" ? ukPostcode(p.postcode, addr.postcode, line) : null;
  const locality = addr.city || addr.town || null;
  const queries: string[] = [];
  if (line.trim()) queries.push(line.trim());
  if (p.name && locality && !line.toLowerCase().includes(String(p.name).toLowerCase())) {
    queries.push(String(p.name).toLowerCase().includes(String(locality).toLowerCase()) ? String(p.name) : `${p.name}, ${locality}`);
  }
  return { stored, country, postcode, queries: Array.from(new Set(queries)) };
}

async function postcodesIo(postcode: string): Promise<Point | null> {
  const clean = encodeURIComponent(postcode.replace(/\s+/g, ""));
  // Terminated postcodes (redevelopments) still carry their old centroid.
  for (const path of ["postcodes", "terminated_postcodes"]) {
    try {
      const r = await fetch(`https://api.postcodes.io/${path}/${clean}`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(8000) });
      if (!r.ok) continue;
      const d = (await r.json())?.result;
      const lat = num(d?.latitude), lng = num(d?.longitude);
      if (lat != null && lng != null) return { lat, lng };
    } catch {
      return null;
    }
  }
  return null;
}

async function nominatim(query: string, country: string): Promise<Point | null> {
  const { nominatimFetch } = await import("./os-data");
  const data = await nominatimFetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=jsonv2&countrycodes=${country.toLowerCase()}&limit=1`).catch(() => null);
  const first = Array.isArray(data) ? data[0] : null;
  const lat = num(first?.lat), lng = num(first?.lon);
  return lat != null && lng != null ? { lat, lng } : null;
}

async function dbq(deps: PropertyGeocodeDeps): Promise<Querier> {
  return deps.pool ?? (await import("./db")).pool;
}

// Locate one property and persist it. Returns the point, or null when the
// row already had coordinates or couldn't be placed.
export async function geocodeProperty(p: PropertyGeocodeRow, deps: PropertyGeocodeDeps = {}): Promise<Point | null> {
  const q = await dbq(deps);
  const { stored, country, postcode, queries } = geocodeInputs(p);
  let point: Point | null = stored;
  if (!point && postcode) point = await (deps.postcodeLookup ?? postcodesIo)(postcode);
  if (!point && country) {
    for (const query of queries) {
      point = await (deps.addressLookup ?? nominatim)(query, country);
      if (point) break;
    }
  }
  const noCoords = `(latitude IS NULL OR latitude = '' OR longitude IS NULL OR longitude = '')`;
  if (point) {
    const r = await q.query(
      `UPDATE crm_properties SET latitude = $1, longitude = $2, geocode_status = 'resolved' WHERE id = $3 AND ${noCoords}`,
      [String(point.lat), String(point.lng), p.id],
    );
    return r.rowCount ? point : null;
  }
  await q.query(`UPDATE crm_properties SET geocode_status = 'unresolved' WHERE id = $1 AND ${noCoords}`, [p.id]);
  return null;
}

// By id — for create / open / edit hooks. No-op when the row already has a
// pin; an address edit passes retryUnresolved so a corrected address is tried.
export async function geocodePropertyById(id: string, deps: PropertyGeocodeDeps = {}, opts: { retryUnresolved?: boolean } = {}): Promise<Point | null> {
  const q = await dbq(deps);
  const { rows } = await q.query(
    `SELECT id, name, address, postcode, country FROM crm_properties
      WHERE id = $1 AND (latitude IS NULL OR latitude = '' OR longitude IS NULL OR longitude = '')
        AND ($2::boolean OR geocode_status IS DISTINCT FROM 'unresolved')`,
    [id, !!opts.retryUnresolved],
  );
  return rows[0] ? geocodeProperty(rows[0], deps) : null;
}

// Every property without coordinates that hasn't been tried yet. Serial, so
// Nominatim stays at ≤1 req/s (its queue) and postcodes.io gets a gap too.
export async function backfillPropertyCoordinates(deps: PropertyGeocodeDeps = {}, limit = 2000): Promise<{ checked: number; resolved: number; unresolved: number }> {
  const q = await dbq(deps);
  const { rows } = await q.query(
    `SELECT id, name, address, postcode, country FROM crm_properties
      WHERE (latitude IS NULL OR latitude = '' OR longitude IS NULL OR longitude = '')
        AND geocode_status IS NULL
      ORDER BY created_at DESC NULLS LAST
      LIMIT $1`,
    [limit],
  );
  let resolved = 0;
  for (const row of rows) {
    try {
      if (await geocodeProperty(row, deps)) resolved++;
    } catch (e: any) {
      console.warn(`[property-geocode] ${row.id}: ${e?.message || e}`);
    }
    if (deps.delayMs !== 0) await new Promise(r => setTimeout(r, deps.delayMs ?? 250));
  }
  return { checked: rows.length, resolved, unresolved: rows.length - resolved };
}
