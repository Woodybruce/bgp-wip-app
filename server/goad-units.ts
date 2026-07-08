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
// Reprojection: OSGB36 National Grid (EPSG:27700) → WGS84 lat/lng.
// Airy-1830 inverse transverse Mercator, then an approximate OSGB36→WGS84
// datum shift. Accurate to a few metres — fine for plan display. (Full OSTN15
// accuracy would need the shift grid; not worth it for a rendered map.)
// ---------------------------------------------------------------------------
export function bngToWgs84(E: number, N: number): [number, number] {
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

// WGS84 lat/lng → BNG easting/northing (forward), needed to build the WKT
// query polygon the Edozo WFS expects.
export function wgs84ToBng(lat: number, lng: number): [number, number] {
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
export async function ensureGoadTables(): Promise<void> {
  if (ensured) return;
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
