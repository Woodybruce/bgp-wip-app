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

// ─── Freeholder + head-leaseholder chain identification ─────────────────
//
// `findProprietorsByAddress` already returns the UNIT-LEVEL leasehold (e.g.
// Mayfair Spirit Ltd at 43 Curzon Street). It does NOT reliably find:
//   1) The FREEHOLDER — usually registered against a blanket estate
//      description (e.g. "Curzon Street, Mayfair") that doesn't match a
//      street-number ILIKE.
//   2) The HEAD-LEASEHOLDER — an intermediate party holding a long lease
//      (99/150/999 years) over multiple units, registered with
//      multiple_address_indicator='Y' and an older date than the unit lease.
//
// This widens the search to postcode-level and ranks candidates by
// inferred role.

export interface ChainCandidate {
  titleNumber: string;
  tenure: string | null;
  proprietorName: string | null;
  proprietorCategory: string | null;
  companyRegistrationNo: string | null;
  countryIncorporated: string | null;
  proprietorAddress: string | null;
  propertyAddress: string | null;
  dateProprietorAdded: string | null;
  pricePaid: string | null;
  multipleAddressIndicator: string | null;
  score: number;
  reasons: string[];
  // CRM cross-reference — non-null when this proprietor matches a BGP
  // landlord/freeholder/investor company. Lets the client deep-link.
  crmCompanyId: string | null;
}

export interface FreeholderChain {
  freeholder: ChainCandidate | null;
  headLeaseholder: ChainCandidate | null;
  // Runners-up — surfaced when the top candidate's score is low so the
  // user can pick manually rather than trust an ambiguous ranking.
  freeholderRunnersUp: ChainCandidate[];
  headLeaseholderRunnersUp: ChainCandidate[];
}

export async function findFreeholderChain(
  postcode: string,
  street: string | null,
  excludeTitleNumbers: string[] = [],
  unitLeaseDate?: string | null,
): Promise<FreeholderChain> {
  const pcNormalised = postcode.toUpperCase().replace(/\s+/g, "").trim();
  if (!pcNormalised) {
    return { freeholder: null, headLeaseholder: null, freeholderRunnersUp: [], headLeaseholderRunnersUp: [] };
  }
  const streetLower = (street || "").toLowerCase().trim();
  const excludeSet = new Set(excludeTitleNumbers);

  // Pull every title in the postcode in one query — cheap (indexed),
  // then partition + score in JS. Same-proprietor counting needs all
  // titles loaded anyway, so a single query beats two.
  const r = await pool.query<any>(
    `SELECT title_number, dataset, proprietor_position,
            proprietor_name, proprietor_category,
            company_registration_no, country_incorporated,
            proprietor_address_1, proprietor_address_2, proprietor_address_3,
            to_char(date_proprietor_added, 'YYYY-MM-DD') AS date_proprietor_added,
            price_paid, property_address, tenure,
            multiple_address_indicator
       FROM hmlr_proprietors
      WHERE postcode_normalised = $1
      ORDER BY title_number, dataset, proprietor_position
      LIMIT 400`,
    [pcNormalised],
  );

  // Group rows by title.
  type Row = typeof r.rows[number];
  const byTitle = new Map<string, Row>();
  for (const row of r.rows) {
    if (excludeSet.has(row.title_number)) continue;
    if (!byTitle.has(row.title_number)) byTitle.set(row.title_number, row);
  }

  // Count titles per proprietor across the whole postcode — a freeholder
  // that holds 8 titles on the street is almost certainly the estate owner.
  const titleCountByProprietor = new Map<string, number>();
  for (const row of byTitle.values()) {
    const key = (row.proprietor_name || "").toLowerCase().trim();
    if (!key) continue;
    titleCountByProprietor.set(key, (titleCountByProprietor.get(key) || 0) + 1);
  }

  // BGP CRM cross-reference — landlord/freeholder/investor companies the
  // firm already knows. Match by company_registration_no (exact) first,
  // then fuzzy name match. +50 score boost when found.
  const proprietorRegNos = Array.from(new Set(
    Array.from(byTitle.values()).map((r) => r.company_registration_no).filter(Boolean),
  ));
  const proprietorNames = Array.from(new Set(
    Array.from(byTitle.values()).map((r) => (r.proprietor_name || "").trim()).filter(Boolean),
  ));
  const crmMatches = new Map<string, string>(); // key (lowercase name or CH#) → crm_companies.id
  if (proprietorRegNos.length > 0 || proprietorNames.length > 0) {
    try {
      const crmRows = await pool.query<{ id: string; name: string; companies_house_number: string | null; company_type: string | null }>(
        `SELECT id, name, companies_house_number, company_type
           FROM crm_companies
          WHERE (companies_house_number = ANY($1::text[]))
             OR (lower(name) = ANY($2::text[]))
            AND (lower(coalesce(company_type, '')) LIKE '%landlord%'
                 OR lower(coalesce(company_type, '')) LIKE '%freeholder%'
                 OR lower(coalesce(company_type, '')) LIKE '%investor%'
                 OR lower(coalesce(company_type, '')) LIKE '%developer%'
                 OR lower(coalesce(company_type, '')) LIKE '%reit%'
                 OR lower(coalesce(company_type, '')) LIKE '%fund%')`,
        [proprietorRegNos, proprietorNames.map((n) => n.toLowerCase())],
      );
      for (const cr of crmRows.rows) {
        if (cr.companies_house_number) crmMatches.set(cr.companies_house_number, cr.id);
        if (cr.name) crmMatches.set(cr.name.toLowerCase(), cr.id);
      }
    } catch (e: any) {
      // Soft-fail — ranking still works without the CRM signal.
    }
  }

  function rowToCandidate(row: any, score: number, reasons: string[]): ChainCandidate {
    const crmId = row.company_registration_no && crmMatches.get(row.company_registration_no)
      || (row.proprietor_name && crmMatches.get(row.proprietor_name.toLowerCase()))
      || null;
    return {
      titleNumber: row.title_number,
      tenure: row.tenure || null,
      proprietorName: row.proprietor_name || null,
      proprietorCategory: row.proprietor_category || null,
      companyRegistrationNo: row.company_registration_no || null,
      countryIncorporated: row.country_incorporated || null,
      proprietorAddress: [row.proprietor_address_1, row.proprietor_address_2, row.proprietor_address_3].filter(Boolean).join(", ") || null,
      propertyAddress: row.property_address || null,
      dateProprietorAdded: row.date_proprietor_added || null,
      pricePaid: row.price_paid || null,
      multipleAddressIndicator: row.multiple_address_indicator || null,
      score,
      reasons,
      crmCompanyId: crmId,
    };
  }

  const freeholdCandidates: ChainCandidate[] = [];
  const leaseholdCandidates: ChainCandidate[] = [];
  const unitDateMs = unitLeaseDate ? Date.parse(unitLeaseDate) : NaN;

  for (const row of byTitle.values()) {
    const tenure = (row.tenure || "").toLowerCase();
    const propName = row.proprietor_name || "";
    const propAddr = (row.property_address || "").toLowerCase();
    const titleCount = titleCountByProprietor.get(propName.toLowerCase()) || 1;
    const reasons: string[] = [];
    let score = 0;

    // Both branches: BGP CRM cross-reference is the strongest signal.
    const crmHit = (row.company_registration_no && crmMatches.has(row.company_registration_no))
                || (propName && crmMatches.has(propName.toLowerCase()));
    if (crmHit) { score += 50; reasons.push("BGP CRM landlord"); }

    // Street-name match — title address mentions our street (not just postcode).
    if (streetLower && propAddr.includes(streetLower)) {
      score += 15;
      reasons.push("title address contains street");
    }

    if (tenure === "freehold") {
      // Estate pattern: same proprietor holds multiple titles in the postcode.
      if (titleCount >= 3) { score += 30; reasons.push(`holds ${titleCount} titles in postcode`); }
      else if (titleCount === 2) { score += 10; reasons.push("holds 2 titles in postcode"); }

      // Proprietor name suggests an estate owner.
      if (/estate|properties|investments|group|trust/i.test(propName)) {
        score += 10;
        reasons.push("estate-style proprietor name");
      }

      // Age — older registration = longer-established holding.
      if (row.date_proprietor_added) {
        const yrs = (Date.now() - Date.parse(row.date_proprietor_added)) / (365.25 * 86400_000);
        if (yrs >= 20) { score += 10; reasons.push(`${Math.floor(yrs)} years held`); }
        else if (yrs >= 10) { score += 5; reasons.push(`${Math.floor(yrs)} years held`); }
      }

      freeholdCandidates.push(rowToCandidate(row, score, reasons));
    } else if (tenure === "leasehold") {
      // Multiple-address indicator — strongest head-lease signal.
      if (row.multiple_address_indicator === "Y") {
        score += 25;
        reasons.push("covers multiple addresses");
      }

      // Significantly older than the unit lease → likely head-lease.
      if (!isNaN(unitDateMs) && row.date_proprietor_added) {
        const candidateMs = Date.parse(row.date_proprietor_added);
        const gapYrs = (unitDateMs - candidateMs) / (365.25 * 86400_000);
        if (gapYrs >= 10) { score += 20; reasons.push(`${Math.floor(gapYrs)} yrs older than unit lease`); }
        else if (gapYrs >= 5) { score += 10; reasons.push(`${Math.floor(gapYrs)} yrs older than unit lease`); }
      }

      // Property name suggests an intermediate landlord rather than an occupier.
      if (/properties|investments|holdings|estates|trust/i.test(propName)) {
        score += 10;
        reasons.push("intermediate-style proprietor name");
      }

      // Only consider as a head-lease candidate if it scored above zero
      // — otherwise it's almost certainly another unit lease in the postcode.
      if (score > 0) leaseholdCandidates.push(rowToCandidate(row, score, reasons));
    }
  }

  freeholdCandidates.sort((a, b) => b.score - a.score);
  leaseholdCandidates.sort((a, b) => b.score - a.score);

  return {
    freeholder: freeholdCandidates[0] || null,
    headLeaseholder: leaseholdCandidates[0] || null,
    freeholderRunnersUp: freeholdCandidates.slice(1, 4),
    headLeaseholderRunnersUp: leaseholdCandidates.slice(1, 4),
  };
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
