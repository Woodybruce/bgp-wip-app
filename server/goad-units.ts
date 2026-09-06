/**
 * Shared data layer for the occupier plan (goad_units).
 *
 * Both sources — Edozo (live WFS) and Experian (shapefile import) — normalise
 * into the same `goad_units` rows through here, so the map/renderer never has
 * to care where a unit came from. Responsibilities:
 *   - British National Grid (EPSG:27700) → WGS84 reprojection
 *   - runtime table + index creation (mirrors the voa_*_cache pattern so we
 *     don't depend on the drizzle migration journal in production)
 *   - bulk upsert keyed on external_key
 *   - viewport (bbox) query
 *   - category normalisation via the existing goad-taxonomy resolver
 */
import { pool } from "./db";
import {
  categoriseFromBrand,
  categoriseFromVoaDescription,
  type RetailCategory,
} from "./goad-taxonomy";

export interface NormalisedUnit {
  externalKey: string;
  source: "edozo" | "experian";
  toid?: string | null;
  goadNumber?: string | null;
  centreCode?: string | null;
  floorLevel?: string | null;
  occupierName?: string | null;
  classification?: "occupied" | "vacant" | "unknown" | null;
  category?: string | null;
  categoryGroup?: RetailCategory | null;
  useClass?: string | null;
  tradeType?: string | null;
  streetNum?: string | null;
  streetName?: string | null;
  postcode?: string | null;
  precName?: string | null;
  areaFt2?: number | null;
  areaM2?: number | null;
  geometry: any; // WGS84 GeoJSON geometry (Polygon | MultiPolygon)
  labelRotation?: number | null;
  labelSize?: number | null;
  surveyDate?: string | null;
  pubDate?: string | null;
  rawProps?: any;
}

// ---------------------------------------------------------------------------
// Reprojection: OSGB36 National Grid (EPSG:27700) ↔ WGS84 lat/lng.
//
// Two genuinely separate steps, and both matter:
//   1. The transverse-Mercator projection maths (Airy 1830 ellipsoid) turns
//      easting/northing into OSGB36 latitude/longitude.
//   2. A Helmert 7-parameter datum shift turns OSGB36 into WGS84.
// The original implementation did step 1 only and labelled the result WGS84 —
// that misplaces everything in London by ~110 m (the "plan isn't in the right
// position" bug). Helmert accuracy is ~5 m nationwide — fine for plan display;
// full OSTN15 grid accuracy isn't worth it for a rendered map.
// ---------------------------------------------------------------------------

const AIRY_1830 = { a: 6377563.396, b: 6356256.909 };
const WGS84_ELL = { a: 6378137.0, b: 6356752.3141 };

// OSGB36 → WGS84 Helmert parameters (tx/ty/tz metres, rx/ry/rz arc-seconds,
// s ppm). Reverse the signs for WGS84 → OSGB36.
const OSGB36_TO_WGS84 = { tx: 446.448, ty: -125.157, tz: 542.06, rx: 0.1502, ry: 0.247, rz: 0.8421, s: -20.4894 };

function latLngToCartesian(latDeg: number, lngDeg: number, ell: { a: number; b: number }): [number, number, number] {
  const phi = (latDeg * Math.PI) / 180, lam = (lngDeg * Math.PI) / 180;
  const e2 = 1 - (ell.b * ell.b) / (ell.a * ell.a);
  const nu = ell.a / Math.sqrt(1 - e2 * Math.sin(phi) ** 2);
  return [nu * Math.cos(phi) * Math.cos(lam), nu * Math.cos(phi) * Math.sin(lam), nu * (1 - e2) * Math.sin(phi)];
}

function cartesianToLatLng(x: number, y: number, z: number, ell: { a: number; b: number }): [number, number] {
  const e2 = 1 - (ell.b * ell.b) / (ell.a * ell.a);
  const p = Math.sqrt(x * x + y * y);
  let phi = Math.atan2(z, p * (1 - e2));
  for (let i = 0; i < 8; i++) {
    const nu = ell.a / Math.sqrt(1 - e2 * Math.sin(phi) ** 2);
    phi = Math.atan2(z + e2 * nu * Math.sin(phi), p);
  }
  return [(phi * 180) / Math.PI, (Math.atan2(y, x) * 180) / Math.PI];
}

function helmert(x: number, y: number, z: number, t: typeof OSGB36_TO_WGS84, invert = false): [number, number, number] {
  const sign = invert ? -1 : 1;
  const s = 1 + sign * t.s * 1e-6;
  const asRad = (sec: number) => (sign * sec * Math.PI) / (180 * 3600);
  const rx = asRad(t.rx), ry = asRad(t.ry), rz = asRad(t.rz);
  return [
    sign * t.tx + s * x - rz * y + ry * z,
    sign * t.ty + rz * x + s * y - rx * z,
    sign * t.tz - ry * x + rx * y + s * z,
  ];
}

// Step 1 only: inverse transverse Mercator. Output is OSGB36 lat/lng —
// exported for the one-off stored-data repair, which uses it to recover the
// exact values the buggy converter wrote.
export function bngToOsgb36LatLng(E: number, N: number): [number, number] {
  const a = 6377563.396, b = 6356256.909; // Airy 1830
  const F0 = 0.9996012717;
  const lat0 = (49 * Math.PI) / 180, lon0 = (-2 * Math.PI) / 180;
  const N0 = -100000, E0 = 400000;
  const e2 = 1 - (b * b) / (a * a);
  const n = (a - b) / (a + b);

  let lat = lat0, M = 0;
  do {
    lat = (N - N0 - M) / (a * F0) + lat;
    const Ma = (1 + n + 1.25 * n * n + 1.25 * n ** 3) * (lat - lat0);
    const Mb = (3 * n + 3 * n * n + 2.625 * n ** 3) * Math.sin(lat - lat0) * Math.cos(lat + lat0);
    const Mc = (1.875 * n * n + 1.875 * n ** 3) * Math.sin(2 * (lat - lat0)) * Math.cos(2 * (lat + lat0));
    const Md = (35 / 24) * n ** 3 * Math.sin(3 * (lat - lat0)) * Math.cos(3 * (lat + lat0));
    M = b * F0 * (Ma - Mb + Mc - Md);
  } while (Math.abs(N - N0 - M) >= 0.0001);

  const nu = (a * F0) / Math.sqrt(1 - e2 * Math.sin(lat) ** 2);
  const rho = (a * F0 * (1 - e2)) / (1 - e2 * Math.sin(lat) ** 2) ** 1.5;
  const eta2 = nu / rho - 1;
  const tlat = Math.tan(lat), clat = Math.cos(lat);
  const VII = tlat / (2 * rho * nu);
  const VIII = (tlat / (24 * rho * nu ** 3)) * (5 + 3 * tlat ** 2 + eta2 - 9 * tlat ** 2 * eta2);
  const IX = (tlat / (720 * rho * nu ** 5)) * (61 + 90 * tlat ** 2 + 45 * tlat ** 4);
  const X = 1 / (clat * nu);
  const XI = (1 / (clat * 6 * nu ** 3)) * (nu / rho + 2 * tlat ** 2);
  const XII = (1 / (clat * 120 * nu ** 5)) * (5 + 28 * tlat ** 2 + 24 * tlat ** 4);
  const dE = E - E0;
  const latOut = lat - VII * dE ** 2 + VIII * dE ** 4 - IX * dE ** 6;
  const lonOut = lon0 + X * dE - XI * dE ** 3 + XII * dE ** 5;
  return [(latOut * 180) / Math.PI, (lonOut * 180) / Math.PI];
}

// BNG easting/northing → WGS84 lat/lng: projection inverse + datum shift.
export function bngToWgs84(E: number, N: number): [number, number] {
  const [lat36, lng36] = bngToOsgb36LatLng(E, N);
  const [x, y, z] = latLngToCartesian(lat36, lng36, AIRY_1830);
  const [wx, wy, wz] = helmert(x, y, z, OSGB36_TO_WGS84);
  return cartesianToLatLng(wx, wy, wz, WGS84_ELL);
}

// Step 1 only (forward): OSGB36 lat/lng → easting/northing. Exported for the
// stored-data repair (see bngToOsgb36LatLng).
export function osgb36LatLngToBng(lat: number, lng: number): [number, number] {
  const a = 6377563.396, b = 6356256.909;
  const F0 = 0.9996012717;
  const lat0 = (49 * Math.PI) / 180, lon0 = (-2 * Math.PI) / 180;
  const N0 = -100000, E0 = 400000;
  const e2 = 1 - (b * b) / (a * a);
  const n = (a - b) / (a + b);
  const phi = (lat * Math.PI) / 180, lam = (lng * Math.PI) / 180;
  const nu = (a * F0) / Math.sqrt(1 - e2 * Math.sin(phi) ** 2);
  const rho = (a * F0 * (1 - e2)) / (1 - e2 * Math.sin(phi) ** 2) ** 1.5;
  const eta2 = nu / rho - 1;
  const Ma = (1 + n + 1.25 * n * n + 1.25 * n ** 3) * (phi - lat0);
  const Mb = (3 * n + 3 * n * n + 2.625 * n ** 3) * Math.sin(phi - lat0) * Math.cos(phi + lat0);
  const Mc = (1.875 * n * n + 1.875 * n ** 3) * Math.sin(2 * (phi - lat0)) * Math.cos(2 * (phi + lat0));
  const Md = (35 / 24) * n ** 3 * Math.sin(3 * (phi - lat0)) * Math.cos(3 * (phi + lat0));
  const M = b * F0 * (Ma - Mb + Mc - Md);
  const slat = Math.sin(phi), clat = Math.cos(phi), tlat = Math.tan(phi);
  const I = M + N0;
  const II = (nu / 2) * slat * clat;
  const III = (nu / 24) * slat * clat ** 3 * (5 - tlat ** 2 + 9 * eta2);
  const IIIA = (nu / 720) * slat * clat ** 5 * (61 - 58 * tlat ** 2 + tlat ** 4);
  const IV = nu * clat;
  const V = (nu / 6) * clat ** 3 * (nu / rho - tlat ** 2);
  const VI = (nu / 120) * clat ** 5 * (5 - 18 * tlat ** 2 + tlat ** 4 + 14 * eta2 - 58 * tlat ** 2 * eta2);
  const dl = lam - lon0;
  const N = I + II * dl ** 2 + III * dl ** 4 + IIIA * dl ** 6;
  const E = E0 + IV * dl + V * dl ** 3 + VI * dl ** 5;
  return [E, N];
}

// WGS84 lat/lng → BNG easting/northing: datum shift + projection forward.
// Used to build the WKT query polygon the Edozo WFS expects.
export function wgs84ToBng(lat: number, lng: number): [number, number] {
  const [x, y, z] = latLngToCartesian(lat, lng, WGS84_ELL);
  const [ox, oy, oz] = helmert(x, y, z, OSGB36_TO_WGS84, true);
  const [lat36, lng36] = cartesianToLatLng(ox, oy, oz, AIRY_1830);
  return osgb36LatLngToBng(lat36, lng36);
}

// ---------------------------------------------------------------------------
// One-off stored-data repair. Harvested goad_units rows were written with the
// datum-shift-less converter, so every stored lat/lng (geometry, centroid,
// bbox) is OSGB36 mislabelled as WGS84 — ~110 m off in London. The old
// converter is exactly invertible (pure TM), so each stored value can be
// recovered to precise easting/northing and re-projected correctly. Runs once,
// guarded by a system_settings key; batched so boot isn't blocked.
// ---------------------------------------------------------------------------
export async function fixGoadUnitsDatumOnce(): Promise<void> {
  const FLAG = "migration:goad_units_datum_v2";
  try {
    const { rows: flag } = await pool.query(`SELECT value FROM system_settings WHERE key = $1 LIMIT 1`, [FLAG]);
    if (flag.length > 0) return;
  } catch { return; } // system_settings missing — very fresh DB, nothing harvested yet

  const fixPair = (lat: number, lng: number): [number, number] => {
    const [E, N] = osgb36LatLngToBng(lat, lng); // recover exact BNG the harvest saw
    return bngToWgs84(E, N);                    // re-project with the datum shift
  };
  const fixGeom = (geom: any): any => {
    const conv = (c: any): any => {
      if (typeof c[0] === "number") {
        const [lat, lng] = fixPair(c[1], c[0]); // GeoJSON coords are [lng, lat]
        return [lng, lat];
      }
      return c.map(conv);
    };
    if (!geom?.coordinates) return geom;
    return { type: geom.type, coordinates: geom.coordinates.map(conv) };
  };

  // The repair is NOT idempotent (re-fixing a fixed row shifts it again), so
  // it runs in a single transaction with the flag written before COMMIT:
  // either every row is fixed exactly once, or none are and the next boot
  // retries cleanly.
  const client = await pool.connect();
  let cursor = 0, fixed = 0;
  try {
    await client.query("BEGIN");
    for (;;) {
      const { rows } = await client.query(
        `SELECT id, geometry, centroid_lat, centroid_lng, min_lat, min_lng, max_lat, max_lng
           FROM goad_units WHERE id > $1 ORDER BY id LIMIT 500`,
        [cursor],
      );
      if (rows.length === 0) break;
      for (const r of rows) {
        cursor = r.id;
        const geom = typeof r.geometry === "string" ? JSON.parse(r.geometry) : r.geometry;
        const newGeom = geom ? fixGeom(geom) : null;
        const c = r.centroid_lat != null ? fixPair(Number(r.centroid_lat), Number(r.centroid_lng)) : null;
        const lo = r.min_lat != null ? fixPair(Number(r.min_lat), Number(r.min_lng)) : null;
        const hi = r.max_lat != null ? fixPair(Number(r.max_lat), Number(r.max_lng)) : null;
        await client.query(
          `UPDATE goad_units SET geometry = $2,
                  centroid_lat = $3, centroid_lng = $4,
                  min_lat = $5, min_lng = $6, max_lat = $7, max_lng = $8
            WHERE id = $1`,
          [r.id, newGeom ? JSON.stringify(newGeom) : r.geometry,
           c ? c[0] : r.centroid_lat, c ? c[1] : r.centroid_lng,
           lo ? lo[0] : r.min_lat, lo ? lo[1] : r.min_lng,
           hi ? hi[0] : r.max_lat, hi ? hi[1] : r.max_lng],
        );
        fixed++;
      }
      if (fixed % 5000 < 500) console.log(`[goad datum fix] ${fixed} units repaired so far…`);
    }
    await client.query(
      `INSERT INTO system_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2`,
      [FLAG, JSON.stringify({ fixedAt: new Date().toISOString(), rows: fixed })],
    );
    await client.query("COMMIT");
    console.log(`[goad datum fix] complete — ${fixed} units re-projected onto WGS84`);
  } catch (e: any) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[goad datum fix] failed — rolled back, no rows changed; next boot retries:", e?.message);
  } finally {
    client.release();
  }
}

export function bboxOfGeometry(geom: any): { minLat: number; minLng: number; maxLat: number; maxLng: number; centroidLat: number; centroidLng: number } | null {
  let minLat = Infinity, minLng = Infinity, maxLat = -Infinity, maxLng = -Infinity;
  const walk = (c: any) => {
    if (typeof c[0] === "number") {
      const [lng, lat] = c;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
    } else for (const x of c) walk(x);
  };
  if (!geom?.coordinates) return null;
  walk(geom.coordinates);
  if (!isFinite(minLat)) return null;
  return { minLat, minLng, maxLat, maxLng, centroidLat: (minLat + maxLat) / 2, centroidLng: (minLng + maxLng) / 2 };
}

// ---------------------------------------------------------------------------
// Category normalisation
// ---------------------------------------------------------------------------
export function normaliseCategory(opts: {
  occupierName?: string | null;
  rawCategory?: string | null;
  classification?: string | null;
}): RetailCategory {
  const name = (opts.occupierName || "").trim();
  const nameUpper = name.toUpperCase();
  if (opts.classification === "vacant" || nameUpper === "VACANT" || nameUpper === "VAC") return "vacant";
  // Non-retail placeholders Edozo/Goad use for the base layer.
  if (["OFFICE", "DWELLINGS", "DWLLINGS", "ENT", "ENTRANCE", "CAR PARK", "SERVICE AREA", "STORES"].includes(nameUpper)) return "other";
  const byBrand = categoriseFromBrand(name);
  if (byBrand) return byBrand;
  // Experian carries a rich category string; run it through the VOA-text matcher.
  const byCat = categoriseFromVoaDescription(opts.rawCategory);
  if (byCat && byCat !== "other") return byCat;
  // A real fascia we can't classify is still a retail unit, not "other".
  if (name && !["OFFICE", "DWELLINGS"].includes(nameUpper)) return "fashion";
  return "other";
}

// ---------------------------------------------------------------------------
// Table + indexes (runtime-created; idempotent)
// ---------------------------------------------------------------------------
let ensured = false;
// Concurrent callers share one in-flight promise: CREATE TABLE IF NOT EXISTS
// is not concurrency-safe in pg (duplicate pg_type race on a fresh DB).
let ensuring: Promise<void> | null = null;
export async function ensureGoadTables(): Promise<void> {
  if (ensured) return;
  if (!ensuring) {
    ensuring = doEnsureGoadTables().finally(() => {
      ensuring = null;
    });
  }
  return ensuring;
}

async function doEnsureGoadTables(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS goad_units (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      external_key TEXT NOT NULL UNIQUE,
      source TEXT NOT NULL,
      toid TEXT,
      goad_number TEXT,
      centre_code TEXT,
      floor_level TEXT DEFAULT 'GF',
      occupier_name TEXT,
      classification TEXT,
      category TEXT,
      category_group TEXT,
      use_class TEXT,
      trade_type TEXT,
      street_num TEXT,
      street_name TEXT,
      postcode TEXT,
      prec_name TEXT,
      area_ft2 INTEGER,
      area_m2 INTEGER,
      centroid_lat DOUBLE PRECISION,
      centroid_lng DOUBLE PRECISION,
      min_lat DOUBLE PRECISION,
      min_lng DOUBLE PRECISION,
      max_lat DOUBLE PRECISION,
      max_lng DOUBLE PRECISION,
      label_rotation REAL,
      label_size REAL,
      geometry JSONB,
      survey_date TEXT,
      pub_date TEXT,
      raw_props JSONB,
      fetched_at TIMESTAMP DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_goad_units_bbox ON goad_units (min_lat, max_lat, min_lng, max_lng)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_goad_units_toid ON goad_units (toid)`);
  ensured = true;
}

export async function upsertGoadUnits(units: NormalisedUnit[]): Promise<number> {
  if (units.length === 0) return 0;
  await ensureGoadTables();
  let written = 0;
  // Chunk to keep parameter counts sane.
  const CHUNK = 200;
  for (let i = 0; i < units.length; i += CHUNK) {
    const slice = units.slice(i, i + CHUNK);
    const values: any[] = [];
    const rows: string[] = [];
    slice.forEach((u, j) => {
      const bb = bboxOfGeometry(u.geometry);
      const base = j * 28;
      rows.push(`(${Array.from({ length: 28 }, (_, k) => `$${base + k + 1}`).join(",")})`);
      values.push(
        u.externalKey, u.source, u.toid ?? null, u.goadNumber ?? null, u.centreCode ?? null,
        u.floorLevel ?? "GF", u.occupierName ?? null, u.classification ?? null, u.category ?? null,
        u.categoryGroup ?? null, u.useClass ?? null, u.tradeType ?? null, u.streetNum ?? null,
        u.streetName ?? null, u.postcode ?? null, u.precName ?? null, u.areaFt2 ?? null, u.areaM2 ?? null,
        bb?.centroidLat ?? null, bb?.centroidLng ?? null, bb?.minLat ?? null, bb?.minLng ?? null,
        bb?.maxLat ?? null, bb?.maxLng ?? null, u.labelRotation ?? null, u.labelSize ?? null,
        JSON.stringify(u.geometry ?? null), JSON.stringify(u.rawProps ?? null),
      );
    });
    const res = await pool.query(
      `INSERT INTO goad_units (
        external_key, source, toid, goad_number, centre_code, floor_level, occupier_name,
        classification, category, category_group, use_class, trade_type, street_num, street_name,
        postcode, prec_name, area_ft2, area_m2, centroid_lat, centroid_lng, min_lat, min_lng,
        max_lat, max_lng, label_rotation, label_size, geometry, raw_props
      ) VALUES ${rows.join(",")}
      ON CONFLICT (external_key) DO UPDATE SET
        occupier_name = EXCLUDED.occupier_name,
        classification = EXCLUDED.classification,
        category = EXCLUDED.category,
        category_group = EXCLUDED.category_group,
        geometry = EXCLUDED.geometry,
        label_rotation = EXCLUDED.label_rotation,
        label_size = EXCLUDED.label_size,
        raw_props = EXCLUDED.raw_props,
        fetched_at = NOW()`,
      values,
    );
    written += res.rowCount || 0;
  }
  return written;
}

export interface GoadUnitOut {
  toid: string | null;
  occupierName: string | null;
  classification: string | null;
  categoryGroup: string | null;
  streetNum: string | null;
  labelRotation: number | null;
  geometry: any;
  source: string;
}

export async function queryGoadUnitsByBbox(bbox: { south: number; west: number; north: number; east: number }): Promise<GoadUnitOut[]> {
  await ensureGoadTables();
  // A unit overlaps the viewport if their bounding boxes intersect.
  const { rows } = await pool.query(
    `SELECT toid, occupier_name, classification, category_group, street_num, label_rotation, geometry, source
       FROM goad_units
      WHERE min_lat <= $1 AND max_lat >= $2 AND min_lng <= $3 AND max_lng >= $4
      LIMIT 4000`,
    [bbox.north, bbox.south, bbox.east, bbox.west],
  );
  return rows.map((r: any) => ({
    toid: r.toid,
    occupierName: r.occupier_name,
    classification: r.classification,
    categoryGroup: r.category_group,
    streetNum: r.street_num,
    labelRotation: r.label_rotation,
    geometry: r.geometry,
    source: r.source,
  }));
}

export async function countGoadUnitsInBbox(bbox: { south: number; west: number; north: number; east: number }): Promise<number> {
  await ensureGoadTables();
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM goad_units
      WHERE min_lat <= $1 AND max_lat >= $2 AND min_lng <= $3 AND max_lng >= $4`,
    [bbox.north, bbox.south, bbox.east, bbox.west],
  );
  return rows[0]?.n || 0;
}
