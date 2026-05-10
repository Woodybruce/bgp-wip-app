/**
 * HMLR-direct property lookups — replaces PropertyData postcode-level
 * wrappers with deterministic queries against locally-ingested HMLR data:
 *
 *   - hmlr_title_polygons (INSPIRE / National Polygon Service)
 *     Loaded by scripts/ingest-hmlr-polygons.ts
 *   - hmlr_proprietors (CCOD + OCOD)
 *     Loaded by scripts/ingest-hmlr-proprietors.ts
 *
 * The whole point: given a lat/lng (or a UPRN we can resolve to lat/lng),
 * return the EXACT title(s) and proprietor(s) for THAT building. No
 * postcode noise, no API quota, no throttling. Sub-10ms queries.
 *
 * This is the primary path. PropertyData stays as a fallback for:
 *   - Properties not yet ingested (rare once monthly refresh is running)
 *   - Properties outside England & Wales (Scotland uses Registers of
 *     Scotland — different format, separate ingest)
 *   - Paid title register PDF orders (the actual deeds document)
 *   - Valuation tools (PropertyData blends multiple sources)
 */

import { pool } from "./db";

export interface HmlrTitleMatch {
  inspireId: number;
  titleNumber: string;
  region: string | null;
}

export interface HmlrProprietor {
  titleNumber: string;
  dataset: "ccod" | "ocod";
  position: number;
  proprietorName: string | null;
  proprietorCategory: string | null;
  companyRegistrationNo: string | null;
  countryIncorporated: string | null;
  proprietorAddress: string | null;
  dateProprietorAdded: string | null;
  pricePaid: string | null;
  propertyAddress: string | null;
  tenure: string | null;
}

let _hmlrAvailable: boolean | null = null;

/**
 * Returns true if hmlr_title_polygons has at least one row. Cached after
 * the first call. When false, callers should fall back to PropertyData.
 */
export async function isHmlrPolygonsAvailable(): Promise<boolean> {
  if (_hmlrAvailable !== null) return _hmlrAvailable;
  try {
    const r = await pool.query<{ exists: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM hmlr_title_polygons LIMIT 1) AS exists`,
    );
    _hmlrAvailable = !!r.rows[0]?.exists;
  } catch {
    // Table doesn't exist yet (migration pending) — treat as unavailable.
    _hmlrAvailable = false;
  }
  return _hmlrAvailable;
}

/** Force re-check on the next call (e.g. after a fresh ingest run). */
export function resetHmlrPolygonsAvailableCache(): void {
  _hmlrAvailable = null;
}

/**
 * Find every HMLR title polygon containing the given lat/lng. Returns
 * an empty array if no polygon contains the point (common for properties
 * outside England & Wales, very new registrations not yet in INSPIRE,
 * or unregistered land).
 *
 * EPSG:4326 (WGS84). lng comes first in ST_MakePoint by PostGIS convention.
 */
export async function findTitlesAtPoint(lat: number, lng: number): Promise<HmlrTitleMatch[]> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return [];
  if (!(await isHmlrPolygonsAvailable())) return [];
  const r = await pool.query<{ inspire_id: string; title_number: string; region: string | null }>(
    `SELECT inspire_id, title_number, region
       FROM hmlr_title_polygons
      WHERE ST_Contains(polygon, ST_SetSRID(ST_MakePoint($1, $2), 4326))
      ORDER BY ST_Area(polygon) ASC
      LIMIT 20`,
    [lng, lat],
  );
  return r.rows.map((row) => ({
    inspireId: Number(row.inspire_id),
    titleNumber: row.title_number,
    region: row.region,
  }));
}

/**
 * Look up proprietors for a specific title number from CCOD + OCOD. Returns
 * up to 8 rows (HMLR allows 4 proprietors per title × 2 datasets).
 */
export async function findProprietorsByTitle(titleNumber: string): Promise<HmlrProprietor[]> {
  if (!titleNumber) return [];
  const r = await pool.query<any>(
    `SELECT title_number, dataset, proprietor_position,
            proprietor_name, proprietor_category,
            company_registration_no, country_incorporated,
            proprietor_address_1, proprietor_address_2, proprietor_address_3,
            to_char(date_proprietor_added, 'YYYY-MM-DD') AS date_proprietor_added,
            price_paid, property_address, tenure
       FROM hmlr_proprietors
      WHERE title_number = $1
      ORDER BY dataset, proprietor_position`,
    [titleNumber],
  );
  return r.rows.map((row) => ({
    titleNumber: row.title_number,
    dataset: row.dataset as "ccod" | "ocod",
    position: row.proprietor_position,
    proprietorName: row.proprietor_name,
    proprietorCategory: row.proprietor_category,
    companyRegistrationNo: row.company_registration_no,
    countryIncorporated: row.country_incorporated,
    proprietorAddress: [row.proprietor_address_1, row.proprietor_address_2, row.proprietor_address_3].filter(Boolean).join(", ") || null,
    dateProprietorAdded: row.date_proprietor_added,
    pricePaid: row.price_paid,
    propertyAddress: row.property_address,
    tenure: row.tenure,
  }));
}

/**
 * Convenience: lat/lng → titles → proprietors, all from local data. Returns
 * a list of titles each with its proprietor rows attached. Empty array if
 * the point isn't inside any registered title polygon.
 *
 * This is the deterministic replacement for the PropertyData
 * uprn-title + freeholds(postcode) cascade. Sub-10ms total in practice.
 */
export async function findTitlesAndProprietorsAtPoint(lat: number, lng: number): Promise<Array<HmlrTitleMatch & { proprietors: HmlrProprietor[] }>> {
  const titles = await findTitlesAtPoint(lat, lng);
  if (titles.length === 0) return [];
  // One round-trip for all proprietor rows of the matched titles.
  const titleNumbers = titles.map((t) => t.titleNumber);
  const r = await pool.query<any>(
    `SELECT title_number, dataset, proprietor_position,
            proprietor_name, proprietor_category,
            company_registration_no, country_incorporated,
            proprietor_address_1, proprietor_address_2, proprietor_address_3,
            to_char(date_proprietor_added, 'YYYY-MM-DD') AS date_proprietor_added,
            price_paid, property_address, tenure
       FROM hmlr_proprietors
      WHERE title_number = ANY($1::text[])
      ORDER BY dataset, proprietor_position`,
    [titleNumbers],
  );
  const proprietorsByTitle = new Map<string, HmlrProprietor[]>();
  for (const row of r.rows) {
    const tn = row.title_number;
    if (!proprietorsByTitle.has(tn)) proprietorsByTitle.set(tn, []);
    proprietorsByTitle.get(tn)!.push({
      titleNumber: tn,
      dataset: row.dataset,
      position: row.proprietor_position,
      proprietorName: row.proprietor_name,
      proprietorCategory: row.proprietor_category,
      companyRegistrationNo: row.company_registration_no,
      countryIncorporated: row.country_incorporated,
      proprietorAddress: [row.proprietor_address_1, row.proprietor_address_2, row.proprietor_address_3].filter(Boolean).join(", ") || null,
      dateProprietorAdded: row.date_proprietor_added,
      pricePaid: row.price_paid,
      propertyAddress: row.property_address,
      tenure: row.tenure,
    });
  }
  return titles.map((t) => ({ ...t, proprietors: proprietorsByTitle.get(t.titleNumber) || [] }));
}

/**
 * Last-completed ingest run for a dataset — used by the admin UI / health
 * check to show "Title polygons last refreshed: 3 days ago".
 */
export async function lastIngestRun(dataset: string): Promise<{ startedAt: string; finishedAt: string | null; rowsProcessed: number; status: string } | null> {
  const r = await pool.query<any>(
    `SELECT to_char(started_at, 'YYYY-MM-DD"T"HH24:MI:SSOF') AS started_at,
            to_char(finished_at, 'YYYY-MM-DD"T"HH24:MI:SSOF') AS finished_at,
            rows_processed, status
       FROM hmlr_ingest_runs
      WHERE dataset = $1
      ORDER BY started_at DESC
      LIMIT 1`,
    [dataset],
  );
  const row = r.rows[0];
  if (!row) return null;
  return {
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    rowsProcessed: row.rows_processed,
    status: row.status,
  };
}
