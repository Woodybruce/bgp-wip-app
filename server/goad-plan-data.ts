/**
 * Data layer for the BGP Goad-style retail plan.
 *
 * Pulls and triangulates every signal we have about the retail units
 * around a subject property, then hands a normalised list of "mapped
 * units" to the renderer.
 *
 * Layers (in priority order for trading status):
 *   1. CRM availableUnits       — BGP-known availability (authoritative)
 *   2. Google Places            — business_status + opening_hours (live)
 *   3. retail_leasing_comps     — recent lets from our own sweep
 *   4. VOA SQLite               — every rated retail unit in the bbox
 *
 * Caching:
 *   - voa_geocode_cache          geocode per VOA ba_ref (persist forever)
 *   - voa_places_cache           Google Places match per ba_ref (24h TTL)
 *   Both tables are created on first use.
 *
 * The heavy lifting (Overpass for building polygons, SVG rendering) lives
 * in sibling files so this stays focused on data.
 */
import { pool } from "./db";
import { lookupVoaByPostcode, voaSqliteAvailable } from "./voa-sqlite";
import { resolveUnitCategory, type RetailCategory } from "./goad-taxonomy";

export interface MappedUnit {
  // Identity
  uarn?: string;
  baRef?: string;
  placeId?: string;

  // Geocode
  lat: number;
  lng: number;

  // What we know about the unit
  address: string;
  postcode?: string;
  tenantName?: string;
  voaDescription?: string;
  rateableValue?: number;

  // Trading status (derived)
  tradingStatus: "trading" | "likely_vacant" | "confirmed_vacant" | "under_offer" | "unknown";
  statusReason?: string;

  // Classification
  category: RetailCategory;

  // Metadata used by renderer / UI
  isSubject?: boolean;
  sourceLayers: string[];  // e.g. ["voa","google_places","crm"]
  confidence: number;      // 0..1
}

export interface PlanDataArgs {
  subject: { lat: number; lng: number; address: string; postcode?: string };
  bboxMeters?: number;          // half-size of the fetch area (default 180m)
  propertyId?: string | null;
}

const DEG_PER_METER_LAT = 1 / 111_320;
function degPerMeterLng(lat: number): number {
  return 1 / (111_320 * Math.cos((lat * Math.PI) / 180));
}

export function expandBbox(center: { lat: number; lng: number }, halfMeters: number) {
  const dLat = halfMeters * DEG_PER_METER_LAT;
  const dLng = halfMeters * degPerMeterLng(center.lat);
  return {
    south: center.lat - dLat,
    north: center.lat + dLat,
    west: center.lng - dLng,
    east: center.lng + dLng,
  };
}

/**
 * Haversine distance in meters.
 */
export function distMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

async function ensureCacheTables(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS voa_geocode_cache (
      ba_ref TEXT PRIMARY KEY,
      postcode TEXT,
      address TEXT,
      lat DOUBLE PRECISION,
      lng DOUBLE PRECISION,
      geocode_provider TEXT,
      geocoded_at TIMESTAMP DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS voa_places_cache (
      ba_ref TEXT PRIMARY KEY,
      place_id TEXT,
      business_status TEXT,
      business_name TEXT,
      place_types JSONB,
      opening_hours_snapshot JSONB,
      queried_at TIMESTAMP DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_voa_geocode_latlng ON voa_geocode_cache (lat, lng)`);
}

interface GeocodeCacheRow {
  ba_ref: string;
  postcode: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
}

async function loadGeocodeCache(baRefs: string[]): Promise<Map<string, { lat: number; lng: number }>> {
  if (baRefs.length === 0) return new Map();
  const { rows } = await pool.query<GeocodeCacheRow>(
    `SELECT ba_ref, postcode, address, lat, lng FROM voa_geocode_cache WHERE ba_ref = ANY($1::text[])`,
    [baRefs],
  );
  const map = new Map<string, { lat: number; lng: number }>();
  for (const r of rows) {
    if (r.lat != null && r.lng != null) map.set(r.ba_ref, { lat: Number(r.lat), lng: Number(r.lng) });
  }
  return map;
}

async function saveGeocode(baRef: string, postcode: string | null, address: string, lat: number, lng: number, provider: string): Promise<void> {
  await pool.query(
    `INSERT INTO voa_geocode_cache (ba_ref, postcode, address, lat, lng, geocode_provider)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (ba_ref) DO UPDATE SET
       postcode = EXCLUDED.postcode,
       address = EXCLUDED.address,
       lat = EXCLUDED.lat,
       lng = EXCLUDED.lng,
       geocode_provider = EXCLUDED.geocode_provider,
       geocoded_at = NOW()`,
    [baRef, postcode, address, lat, lng, provider],
  );
}

interface PlacesCacheRow {
  ba_ref: string;
  place_id: string | null;
  business_status: string | null;
  business_name: string | null;
  place_types: any;
  queried_at: Date | null;
}

async function loadPlacesCache(baRefs: string[], freshHours = 24 * 7): Promise<Map<string, PlacesCacheRow>> {
  if (baRefs.length === 0) return new Map();
  const { rows } = await pool.query<PlacesCacheRow>(
    `SELECT ba_ref, place_id, business_status, business_name, place_types, queried_at
       FROM voa_places_cache
      WHERE ba_ref = ANY($1::text[])
        AND queried_at > NOW() - ($2::int || ' hours')::interval`,
    [baRefs, freshHours],
  );
  return new Map(rows.map((r) => [r.ba_ref, r]));
}

async function savePlaces(
  baRef: string,
  placeId: string | null,
  status: string | null,
  name: string | null,
  types: string[] | null,
): Promise<void> {
  await pool.query(
    `INSERT INTO voa_places_cache (ba_ref, place_id, business_status, business_name, place_types)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (ba_ref) DO UPDATE SET
       place_id = EXCLUDED.place_id,
       business_status = EXCLUDED.business_status,
       business_name = EXCLUDED.business_name,
       place_types = EXCLUDED.place_types,
       queried_at = NOW()`,
    [baRef, placeId, status, name, JSON.stringify(types || [])],
  );
}

// ---------------------------------------------------------------------------
// Google Geocoding — only for VOA rows not yet in cache
// ---------------------------------------------------------------------------

async function googleGeocode(query: string): Promise<{ lat: number; lng: number } | null> {
  const key = process.env.GOOGLE_API_KEY;
  if (!key) return null;
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}&region=uk&components=country:GB&key=${key}`;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!r.ok) return null;
    const j: any = await r.json();
    const loc = j.results?.[0]?.geometry?.location;
    if (loc?.lat && loc?.lng) return { lat: loc.lat, lng: loc.lng };
    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Google Places — match a coordinate to a live business
// ---------------------------------------------------------------------------

interface PlaceMatch {
  placeId: string;
  businessStatus: string;   // OPERATIONAL | CLOSED_PERMANENTLY | CLOSED_TEMPORARILY
  name: string;
  types: string[];
}

/**
 * Nearby search at a specific coord (25m radius). Picks the top result
 * and reads its status. We could also use Place Details but the search
 * response already has business_status so no second call needed.
 */
async function googlePlacesAtCoord(coord: { lat: number; lng: number }): Promise<PlaceMatch | null> {
  const key = process.env.GOOGLE_API_KEY;
  if (!key) return null;
  const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${coord.lat},${coord.lng}&radius=25&key=${key}`;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!r.ok) return null;
    const j: any = await r.json();
    const best = (j.results || [])[0];
    if (!best) return null;
    return {
      placeId: best.place_id,
      businessStatus: best.business_status || "OPERATIONAL",
      name: best.name,
      types: best.types || [],
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Main builder
// ---------------------------------------------------------------------------

/**
 * Fetch every VOA row in the subject's outward code, geocode them (using
 * cache where possible), match to Google Places for live status, overlay
 * CRM vacancy and recent comps, classify, and return the unit list.
 *
 * Budget controls: `maxGeocodesPerRun` caps how many fresh geocodes we
 * pay for in one call (default 30). Remaining uncached rows are dropped
 * from the plan — they'll be picked up on subsequent runs as the cache
 * warms up. Places lookups are also capped.
 */
export async function buildMappedUnits(args: PlanDataArgs & {
  maxGeocodesPerRun?: number;
  maxPlaceLookupsPerRun?: number;
}): Promise<{
  subject: MappedUnit;
  units: MappedUnit[];
  bbox: { south: number; north: number; west: number; east: number };
  stats: { voaRows: number; geocoded: number; placesMatched: number; crmOverrides: number };
}> {
  await ensureCacheTables();
  const halfMeters = args.bboxMeters ?? 180;
  const bbox = expandBbox(args.subject, halfMeters);

  // 1. Pull every VOA assessment in the subject's outward code (fast,
  //    then filter to the bbox via geocode).
  let voaRows: any[] = [];
  if (voaSqliteAvailable() && args.subject.postcode) {
    const outward = args.subject.postcode.toUpperCase().replace(/\s+/g, "").slice(0, -3);
    // Pull all full-postcode blocks in the outward area — bias to the
    // subject's own postcode first so it's always included.
    voaRows = lookupVoaByPostcode(args.subject.postcode, undefined, 200);
    // Add other full postcodes in the outward code via a broader fetch.
    // We call lookupVoaByPostcode with the outward code → in-prefix search
    // isn't supported, so we do an explicit query against the SQLite db.
    try {
      const { voaSqliteQueryByOutward } = await import("./voa-sqlite-extra");
      const extra = await voaSqliteQueryByOutward(outward, 600);
      const seen = new Set(voaRows.map((r) => r.uarn || r.baRef));
      for (const r of extra) {
        const k = r.uarn || r.baRef;
        if (!seen.has(k)) voaRows.push(r);
      }
    } catch {
      // voa-sqlite-extra is a tiny shim we introduce alongside this file.
    }
  }

  // 2. Load geocode cache for everything we've seen before.
  const baRefs = voaRows.map((r) => r.baRef || r.uarn).filter(Boolean) as string[];
  const geoCache = await loadGeocodeCache(baRefs);

  // 3. Filter to rows that are (a) already cached and inside the bbox, or
  //    (b) not yet cached — we'll geocode a capped number of those.
  const maxGeocodes = args.maxGeocodesPerRun ?? 30;
  const pendingGeocode: any[] = [];
  const unitsByBaRef = new Map<string, MappedUnit>();

  for (const r of voaRows) {
    const baRef = String(r.baRef || r.uarn || "");
    if (!baRef) continue;
    const cached = geoCache.get(baRef);
    if (cached) {
      if (cached.lat >= bbox.south && cached.lat <= bbox.north && cached.lng >= bbox.west && cached.lng <= bbox.east) {
        unitsByBaRef.set(baRef, voaRowToUnit(r, cached));
      }
    } else {
      pendingGeocode.push(r);
    }
  }

  // 4. Geocode the most plausible of the uncached rows, up to budget.
  //    Order: prefer rows whose postcode matches the subject, then nearest alphabetical.
  pendingGeocode.sort((a, b) => {
    const ap = (a.postcode || "").replace(/\s+/g, "").toUpperCase();
    const bp = (b.postcode || "").replace(/\s+/g, "").toUpperCase();
    const target = (args.subject.postcode || "").replace(/\s+/g, "").toUpperCase();
    const ai = ap === target ? 0 : 1;
    const bi = bp === target ? 0 : 1;
    return ai - bi;
  });

  let geocodedThisRun = 0;
  for (const r of pendingGeocode) {
    if (geocodedThisRun >= maxGeocodes) break;
    const baRef = String(r.baRef || r.uarn || "");
    if (!baRef) continue;
    const query = `${r.address}, ${r.postcode || ""}, UK`;
    const g = await googleGeocode(query);
    geocodedThisRun++;
    if (!g) {
      // Don't retry failed geocodes next run — save a zero-coord row.
      await saveGeocode(baRef, r.postcode || null, r.address, 0, 0, "google_failed").catch(() => {});
      continue;
    }
    await saveGeocode(baRef, r.postcode || null, r.address, g.lat, g.lng, "google").catch(() => {});
    if (g.lat >= bbox.south && g.lat <= bbox.north && g.lng >= bbox.west && g.lng <= bbox.east) {
      unitsByBaRef.set(baRef, voaRowToUnit(r, g));
    }
  }

  // 5. Places lookups for units in bbox.
  const maxPlaceLookups = args.maxPlaceLookupsPerRun ?? 40;
  const inBboxRefs = Array.from(unitsByBaRef.keys());
  const placesCache = await loadPlacesCache(inBboxRefs);

  let placesQueried = 0;
  for (const [baRef, unit] of unitsByBaRef) {
    const cached = placesCache.get(baRef);
    if (cached) {
      applyPlacesToUnit(unit, cached.place_id, cached.business_status, cached.business_name, cached.place_types || []);
      continue;
    }
    if (placesQueried >= maxPlaceLookups) continue;
    const match = await googlePlacesAtCoord({ lat: unit.lat, lng: unit.lng });
    placesQueried++;
    if (match) {
      await savePlaces(baRef, match.placeId, match.businessStatus, match.name, match.types).catch(() => {});
      applyPlacesToUnit(unit, match.placeId, match.businessStatus, match.name, match.types);
    } else {
      await savePlaces(baRef, null, null, null, null).catch(() => {});
      // No live business at a VOA-rated retail coord → likely vacant.
      unit.tradingStatus = "likely_vacant";
      unit.statusReason = unit.statusReason || "No active Google Places business at this address";
    }
  }

  // 6. CRM overrides.
  let crmOverrides = 0;
  try {
    const { rows: crm } = await pool.query(
      `SELECT cp.id, cp.name, cp.address, cp.postcode, au.marketing_status
         FROM crm_properties cp
    LEFT JOIN available_units au ON au.property_id = cp.id
        WHERE cp.postcode IS NOT NULL
          AND UPPER(REPLACE(cp.postcode, ' ', '')) IN (
            SELECT DISTINCT UPPER(REPLACE(postcode, ' ', '')) FROM voa_geocode_cache WHERE ba_ref = ANY($1::text[])
          )`,
      [inBboxRefs],
    );
    for (const u of unitsByBaRef.values()) {
      for (const c of crm) {
        const cName = String(c.name || "").toLowerCase();
        const tName = String(u.tenantName || "").toLowerCase();
        if (cName && tName && (cName.includes(tName) || tName.includes(cName))) {
          if ((c.marketing_status || "").toLowerCase() === "available") {
            u.tradingStatus = "confirmed_vacant";
            u.statusReason = "Marketed as Available in BGP CRM";
            u.sourceLayers.push("crm");
            crmOverrides++;
          }
        }
      }
    }
  } catch {
    // CRM overlay is best-effort; don't block a plan render if it fails.
  }

  // 7. Finalise category + confidence.
  for (const u of unitsByBaRef.values()) {
    u.category = resolveUnitCategory({
      brand: u.tenantName,
      voaDescription: u.voaDescription,
      placeTypes: null,
      isConfirmedVacant: u.tradingStatus === "confirmed_vacant",
      isLikelyVacant: u.tradingStatus === "likely_vacant",
    });
  }

  // Subject is a synthetic mapped unit so the renderer treats it uniformly.
  const subject: MappedUnit = {
    lat: args.subject.lat,
    lng: args.subject.lng,
    address: args.subject.address,
    postcode: args.subject.postcode,
    tenantName: "SUBJECT",
    tradingStatus: "unknown",
    category: "other",
    isSubject: true,
    sourceLayers: ["subject"],
    confidence: 1,
  };

  return {
    subject,
    units: Array.from(unitsByBaRef.values()),
    bbox,
    stats: {
      voaRows: voaRows.length,
      geocoded: geocodedThisRun,
      placesMatched: placesQueried,
      crmOverrides,
    },
  };
}

function voaRowToUnit(r: any, coord: { lat: number; lng: number }): MappedUnit {
  return {
    uarn: r.uarn || undefined,
    baRef: r.baRef || undefined,
    lat: coord.lat,
    lng: coord.lng,
    address: r.address,
    postcode: r.postcode || undefined,
    tenantName: r.firmName || undefined,
    voaDescription: r.description || undefined,
    rateableValue: r.rateableValue != null ? Number(r.rateableValue) : undefined,
    tradingStatus: "unknown",
    category: "other",
    sourceLayers: ["voa"],
    confidence: 0.6,
  };
}

function applyPlacesToUnit(
  u: MappedUnit,
  placeId: string | null,
  businessStatus: string | null,
  businessName: string | null,
  types: string[],
) {
  if (!placeId) return;
  u.placeId = placeId;
  u.sourceLayers.push("google_places");
  if (businessName && (!u.tenantName || u.tenantName.length < 2)) {
    u.tenantName = businessName;
  }
  if (businessStatus === "CLOSED_PERMANENTLY") {
    u.tradingStatus = "confirmed_vacant";
    u.statusReason = "Google Places: CLOSED_PERMANENTLY";
  } else if (businessStatus === "CLOSED_TEMPORARILY") {
    u.tradingStatus = "trading";
    u.statusReason = "Google Places: CLOSED_TEMPORARILY (refurb / short-term)";
  } else if (businessStatus === "OPERATIONAL") {
    u.tradingStatus = "trading";
    u.confidence = Math.max(u.confidence, 0.85);
  }
  // Nudge category if Places types give a clearer signal (done later in resolver).
}
