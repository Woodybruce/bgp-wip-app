/**
 * HMLR-direct property lookups — replaces PropertyData postcode-level
 * wrappers with deterministic queries against locally-ingested HMLR data.
 *
 * Free datasets:
 *   - hmlr_proprietors (CCOD + OCOD): title_number → proprietor +
 *     property_address text. Loaded by ingest-hmlr-proprietors.ts.
 *     PRIMARY ownership lookup path: postcode_normalised + property_address
 *     ILIKE on the resolved street number.
 *   - hmlr_title_polygons (INSPIRE Index Polygons, free): polygons WITHOUT
 *     title_number. Useful for map visualisation. Loaded by
 *     ingest-hmlr-polygons.ts. Not used for ownership lookups in v1
 *     because the free INSPIRE dataset has no title link.
 *
 * Paid (not used unless we subscribe):
 *   - National Polygon Service (£20k/yr): polygons WITH title_number.
 *     Would let us do point-in-polygon → title. Skipped for now.
 *   - Registered Leases (fee-dependent): leasehold title detail. Maybe v2.
 *
 * PropertyData stays as a fallback for:
 *   - Properties outside CCOD/OCOD coverage (residential, very fresh
 *     registrations, Scotland)
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

let _hmlrPolygonsAvailable: boolean | null = null;
let _hmlrProprietorsAvailable: boolean | null = null;

/** True iff hmlr_title_polygons has rows. Polygons are optional in v1. */
export async function isHmlrPolygonsAvailable(): Promise<boolean> {
  if (_hmlrPolygonsAvailable !== null) return _hmlrPolygonsAvailable;
  try {
    const r = await pool.query<{ exists: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM hmlr_title_polygons LIMIT 1) AS exists`,
    );
    _hmlrPolygonsAvailable = !!r.rows[0]?.exists;
  } catch {
    _hmlrPolygonsAvailable = false;
  }
  return _hmlrPolygonsAvailable;
}

/**
 * True iff hmlr_proprietors has rows — i.e. CCOD/OCOD has been ingested.
 * This is the gate for the address-match-based ownership lookup. When
 * false, callers fall through to PropertyData.
 */
export async function isHmlrProprietorsAvailable(): Promise<boolean> {
  if (_hmlrProprietorsAvailable !== null) return _hmlrProprietorsAvailable;
  try {
    const r = await pool.query<{ exists: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM hmlr_proprietors LIMIT 1) AS exists`,
    );
    _hmlrProprietorsAvailable = !!r.rows[0]?.exists;
  } catch {
    _hmlrProprietorsAvailable = false;
  }
  return _hmlrProprietorsAvailable;
}

/** Force re-check on the next call (e.g. after a fresh ingest run). */
export function resetHmlrAvailabilityCache(): void {
  _hmlrPolygonsAvailable = null;
  _hmlrProprietorsAvailable = null;
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
 * PRIMARY OWNERSHIP LOOKUP (free path) — match a resolved property to
 * CCOD/OCOD by postcode + street number. Returns rows grouped by
 * title_number, each with its proprietor list.
 *
 * postcode is normalised internally (uppercase, no whitespace).
 * streetNumber should be like "18" or "18-22" — extracted by the caller
 * from the resolved address.
 *
 * Range matching: when streetNumber is "18-22", we match any CCOD row
 * whose property_address starts with 18, 19, 20, 21 or 22 — covers the
 * case where HMLR has split a multi-unit block into per-door titles.
 */
export async function findProprietorsByAddress(
  postcode: string,
  streetNumber: string | null,
): Promise<Array<{ titleNumber: string; tenure: string | null; propertyAddress: string | null; pricePaid: string | null; dateProprietorAdded: string | null; proprietors: HmlrProprietor[] }>> {
  if (!postcode) return [];
  const pcNormalised = postcode.toUpperCase().replace(/\s+/g, "").trim();
  if (!pcNormalised) return [];

  // Build the address filter. If we have a street number we do an ILIKE
  // anchored at the start of property_address — fast with the trigram
  // index. If we have a range like "18-22", we expand to the individual
  // numbers in the range.
  let addressFilter = "TRUE";
  const params: any[] = [pcNormalised];
  if (streetNumber) {
    const sn = streetNumber.toLowerCase();
    const range = sn.match(/^(\d+)([a-z]?)-(\d+)([a-z]?)$/);
    const numbers: string[] = [];
    if (range) {
      const lo = parseInt(range[1], 10);
      const hi = parseInt(range[3], 10);
      // Push the canonical "18-22" form first plus each individual number.
      numbers.push(sn);
      for (let n = lo; n <= hi; n++) numbers.push(String(n));
    } else {
      numbers.push(sn);
    }
    const placeholders: string[] = [];
    for (const n of numbers) {
      params.push(`${n} %`);
      placeholders.push(`lower(property_address) LIKE $${params.length}`);
      params.push(`${n}, %`);
      placeholders.push(`lower(property_address) LIKE $${params.length}`);
      params.push(`${n}-%`);
      placeholders.push(`lower(property_address) LIKE $${params.length}`);
    }
    addressFilter = `(${placeholders.join(" OR ")})`;
  }

  const r = await pool.query<any>(
    `SELECT title_number, dataset, proprietor_position,
            proprietor_name, proprietor_category,
            company_registration_no, country_incorporated,
            proprietor_address_1, proprietor_address_2, proprietor_address_3,
            to_char(date_proprietor_added, 'YYYY-MM-DD') AS date_proprietor_added,
            price_paid, property_address, tenure
       FROM hmlr_proprietors
      WHERE postcode_normalised = $1
        AND ${addressFilter}
      ORDER BY title_number, dataset, proprietor_position
      LIMIT 50`,
    params,
  );

  // Group by title_number — one title can have up to 4 proprietor rows
  // across the two datasets.
  const byTitle = new Map<string, ReturnType<typeof groupTemplate>>();
  function groupTemplate() {
    return {
      titleNumber: "",
      tenure: null as string | null,
      propertyAddress: null as string | null,
      pricePaid: null as string | null,
      dateProprietorAdded: null as string | null,
      proprietors: [] as HmlrProprietor[],
    };
  }
  for (const row of r.rows) {
    const tn = row.title_number;
    if (!byTitle.has(tn)) {
      byTitle.set(tn, {
        titleNumber: tn,
        tenure: row.tenure || null,
        propertyAddress: row.property_address || null,
        pricePaid: row.price_paid || null,
        dateProprietorAdded: row.date_proprietor_added || null,
        proprietors: [],
      });
    }
    byTitle.get(tn)!.proprietors.push({
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
  return Array.from(byTitle.values());
}

/**
 * Postcode-wide FREEHOLD titles from CCOD/OCOD — free, local, context-only.
 *
 * The street-number address match (findProprietorsByAddress) reliably finds a
 * unit's LEASEHOLDS because each long lease is registered to the specific unit
 * address ("103 Mount Street"). It MISSES the superior FREEHOLD when that
 * freehold is an estate-level title registered to a blanket description (e.g.
 * Grosvenor's Mayfair freehold), because its property_address doesn't start
 * with the unit number. This returns every freehold title in the postcode so
 * the caller can surface the likely estate freeholder as context.
 *
 * NEVER assert unit ownership from these — a postcode can span many buildings.
 * excludeTitleNumbers drops titles already matched to the exact unit.
 */
export async function findFreeholdsByPostcode(
  postcode: string,
  excludeTitleNumbers: string[] = [],
): Promise<Array<{ titleNumber: string; tenure: string | null; propertyAddress: string | null; pricePaid: string | null; dateProprietorAdded: string | null; proprietors: HmlrProprietor[] }>> {
  if (!postcode) return [];
  const pcNormalised = postcode.toUpperCase().replace(/\s+/g, "").trim();
  if (!pcNormalised) return [];
  const r = await pool.query<any>(
    `SELECT title_number, dataset, proprietor_position,
            proprietor_name, proprietor_category,
            company_registration_no, country_incorporated,
            proprietor_address_1, proprietor_address_2, proprietor_address_3,
            to_char(date_proprietor_added, 'YYYY-MM-DD') AS date_proprietor_added,
            price_paid, property_address, tenure
       FROM hmlr_proprietors
      WHERE postcode_normalised = $1
        AND lower(tenure) = 'freehold'
      ORDER BY title_number, dataset, proprietor_position
      LIMIT 100`,
    [pcNormalised],
  );
  const exclude = new Set(excludeTitleNumbers);
  const byTitle = new Map<string, { titleNumber: string; tenure: string | null; propertyAddress: string | null; pricePaid: string | null; dateProprietorAdded: string | null; proprietors: HmlrProprietor[] }>();
  for (const row of r.rows) {
    const tn = row.title_number;
    if (exclude.has(tn)) continue;
    if (!byTitle.has(tn)) {
      byTitle.set(tn, {
        titleNumber: tn,
        tenure: row.tenure || null,
        propertyAddress: row.property_address || null,
        pricePaid: row.price_paid || null,
        dateProprietorAdded: row.date_proprietor_added || null,
        proprietors: [],
      });
    }
    byTitle.get(tn)!.proprietors.push({
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
  return Array.from(byTitle.values());
}

/**
 * Last-completed ingest run for a dataset — used by the admin UI / health
 * check to show "CCOD last refreshed: 3 days ago".
 */
export async function lastIngestRun(dataset: string): Promise<{ startedAt: string; finishedAt: string | null; rowsProcessed: number; status: string; error: string | null } | null> {
  const r = await pool.query<any>(
    `SELECT to_char(started_at, 'YYYY-MM-DD"T"HH24:MI:SSOF') AS started_at,
            to_char(finished_at, 'YYYY-MM-DD"T"HH24:MI:SSOF') AS finished_at,
            rows_processed, status, error
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
    error: row.error || null,
  };
}
