/**
 * repair-landlord-geocodes.ts — reviewed, per-row repair of wrong landlord
 * discovery geocodes (Delivery 2, Task 4).
 *
 * Background: discovery used to append a literal "UK" to every geocode
 * query and hard-filter results to GB, so "Dundrum Town Centre" (Dublin)
 * plotted at "Dundrum, Newcastle BT33, UK" and French assets displayed as
 * "United Kingdom". Now that geocoding is country-aware, this script finds
 * the rows poisoned by the old behaviour.
 *
 * DEFAULT MODE IS READ-ONLY. It prints a report of:
 *   1. landlord_website_findings properties whose formatted_address tail
 *      country contradicts the item's scraped country, or whose formatted
 *      address says UK while the item name matches a known non-UK baseline
 *      destination (the Hammerson official list doubles as the checklist);
 *   2. crm_properties rows with country IS NULL and a postcode that isn't
 *      UK-shaped.
 *
 * --apply mode re-geocodes ONLY the flagged findings entries with the
 * evidenced country hint and writes back just those JSONB array elements;
 * an entry that comes back unresolved keeps its old formatted_address and
 * gets its coords nulled. For crm_properties rows created from flagged
 * discoveries (matched by normalised name), --apply sets
 * geocode_status='needs_review' and clears coords only where the hinted
 * re-geocode resolves (coords + country updated) or is confirmed
 * mismatched. Nothing is deleted; every write is logged with before/after;
 * there is no UPDATE without a per-row evidence line in the report.
 *
 * Run with:  npx tsx scripts/repair-landlord-geocodes.ts           # report
 *            npx tsx scripts/repair-landlord-geocodes.ts --apply   # repair
 */

import "dotenv/config";
import { pool } from "../server/db";
import { geocodeOne } from "../server/geocode";
import { buildGeocodeQuery, inferCountryFromAddress, UK_POSTCODE_RE } from "../shared/geo-country";
import { normalisePropertyName } from "../server/landlord-scraper";
import { HAMMERSON_OFFICIAL_DESTINATIONS } from "../server/reconciliation-baselines";

const APPLY = process.argv.includes("--apply");

interface FindingsFlag {
  companyId: string;
  index: number;
  name: string;
  reason: string;
  hint: string;                    // evidenced ISO-2 to re-geocode with
  before: { lat: number | null; lng: number | null; formatted_address: string | null; country: string | null };
}

interface PropertyFlag {
  id: string;
  name: string;
  postcode: string | null;
  reason: string;
  hint: string | null;             // from a flagged findings item, if matched
  before: { lat: string | null; lng: string | null; country: string | null };
}

// Baseline destinations outside GB, keyed by normalised name — the known
// answer for "this asset is not in the UK even though it geocoded there".
const NON_UK_BASELINE = new Map(
  HAMMERSON_OFFICIAL_DESTINATIONS
    .filter(d => d.country !== "GB")
    .map(d => [normalisePropertyName(d.destination_name), d.country])
);

async function collectFindingsFlags(): Promise<FindingsFlag[]> {
  const flags: FindingsFlag[] = [];
  const { rows } = await pool.query(
    `SELECT company_id, properties, home_country FROM landlord_website_findings WHERE properties IS NOT NULL`
  );
  for (const row of rows) {
    const items = Array.isArray(row.properties) ? row.properties : [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item?.name) continue;
      const formattedCountry = inferCountryFromAddress(item.formatted_address);
      const itemCountry = typeof item.country === "string" ? item.country.toUpperCase() : null;
      const baselineCountry = NON_UK_BASELINE.get(normalisePropertyName(item.name)) ?? null;
      if (!formattedCountry) continue; // nothing geocoded — nothing to contradict
      if (itemCountry && itemCountry !== formattedCountry) {
        flags.push({
          companyId: row.company_id, index: i, name: item.name,
          reason: `scraped country ${itemCountry} contradicts formatted address (${item.formatted_address})`,
          hint: itemCountry,
          before: { lat: item.lat ?? null, lng: item.lng ?? null, formatted_address: item.formatted_address ?? null, country: itemCountry },
        });
      } else if (!itemCountry && baselineCountry && formattedCountry === "GB") {
        flags.push({
          companyId: row.company_id, index: i, name: item.name,
          reason: `matches non-UK baseline destination (${baselineCountry}) but geocoded to UK (${item.formatted_address})`,
          hint: baselineCountry,
          before: { lat: item.lat ?? null, lng: item.lng ?? null, formatted_address: item.formatted_address ?? null, country: null },
        });
      }
    }
  }
  return flags;
}

async function collectPropertyFlags(findingsFlags: FindingsFlag[]): Promise<PropertyFlag[]> {
  // country may not exist until migration 0043 is applied — fall back to
  // treating every row as country-less.
  let rows: any[];
  try {
    ({ rows } = await pool.query(
      `SELECT id, name, postcode, latitude, longitude, country FROM crm_properties WHERE country IS NULL AND postcode IS NOT NULL`
    ));
  } catch (e: any) {
    if (e?.code !== "42703") throw e;
    ({ rows } = await pool.query(
      `SELECT id, name, postcode, latitude, longitude, NULL AS country FROM crm_properties WHERE postcode IS NOT NULL`
    ));
  }
  const hintByName = new Map(findingsFlags.map(f => [normalisePropertyName(f.name), f.hint]));
  const flags: PropertyFlag[] = [];
  for (const row of rows) {
    if (UK_POSTCODE_RE.test(String(row.postcode).trim())) continue;
    flags.push({
      id: row.id,
      name: row.name,
      postcode: row.postcode,
      reason: `country IS NULL and postcode "${row.postcode}" is not UK-shaped`,
      hint: hintByName.get(normalisePropertyName(row.name)) ?? null,
      before: { lat: row.latitude ?? null, lng: row.longitude ?? null, country: row.country ?? null },
    });
  }
  return flags;
}

async function main() {
  console.log(`[repair-landlord-geocodes] mode: ${APPLY ? "APPLY (writes enabled)" : "READ-ONLY report"}`);

  const findingsFlags = await collectFindingsFlags();
  const propertyFlags = await collectPropertyFlags(findingsFlags);

  console.log(`\n== landlord_website_findings: ${findingsFlags.length} flagged entries ==`);
  for (const f of findingsFlags) {
    console.log(`  [${f.companyId}] ${f.name} — ${f.reason}`);
    console.log(`    before: ${JSON.stringify(f.before)}`);
  }
  console.log(`\n== crm_properties: ${propertyFlags.length} flagged rows ==`);
  for (const f of propertyFlags) {
    console.log(`  [${f.id}] ${f.name} — ${f.reason}${f.hint ? ` (hint ${f.hint} from discovery)` : ""}`);
    console.log(`    before: ${JSON.stringify(f.before)}`);
  }

  if (!APPLY) {
    console.log(`\nRead-only. Re-run with --apply to repair the flagged rows above (per-row, logged).`);
    return;
  }

  // ── Findings entries: re-geocode with the evidenced hint, write back only
  //    the flagged JSONB elements. Unresolved keeps the old formatted_address
  //    and nulls the coords — nothing is deleted.
  const byCompany = new Map<string, FindingsFlag[]>();
  for (const f of findingsFlags) {
    if (!byCompany.has(f.companyId)) byCompany.set(f.companyId, []);
    byCompany.get(f.companyId)!.push(f);
  }
  for (const [companyId, flags] of byCompany) {
    const { rows } = await pool.query(
      `SELECT properties, home_country FROM landlord_website_findings WHERE company_id = $1`,
      [companyId]
    );
    const items = Array.isArray(rows[0]?.properties) ? [...rows[0].properties] : null;
    if (!items) continue;
    let dirty = false;
    for (const f of flags) {
      const item = items[f.index];
      if (!item) continue;
      const { query } = buildGeocodeQuery({ ...item, country: f.hint }, null);
      const geo = await geocodeOne(query, { countryHint: f.hint });
      if (geo.lat != null && geo.lng != null) {
        item.lat = geo.lat;
        item.lng = geo.lng;
        item.formatted_address = geo.formattedAddress;
        item.country = f.hint;
        console.log(`  WRITE findings[${companyId}][${f.index}] ${f.name}: resolved with hint ${f.hint} → ${JSON.stringify({ lat: geo.lat, lng: geo.lng, formatted_address: geo.formattedAddress })}`);
      } else {
        // Confirmed mismatch / unresolvable with the correct hint: unplot
        // rather than leave the wrong marker.
        item.lat = null;
        item.lng = null;
        item.country = f.hint;
        console.log(`  WRITE findings[${companyId}][${f.index}] ${f.name}: unresolved with hint ${f.hint} — coords nulled, formatted_address kept (${item.formatted_address})`);
      }
      dirty = true;
    }
    if (dirty) {
      await pool.query(
        `UPDATE landlord_website_findings SET properties = $2 WHERE company_id = $1`,
        [companyId, JSON.stringify(items)]
      );
    }
  }

  // ── CRM properties created from bad discoveries: needs_review always;
  //    coords touched only where the hinted re-geocode resolves or confirms
  //    the mismatch.
  for (const f of propertyFlags) {
    if (!f.hint) {
      await pool.query(
        `UPDATE crm_properties SET geocode_status = 'needs_review' WHERE id = $1`,
        [f.id]
      );
      console.log(`  WRITE crm_properties[${f.id}] ${f.name}: geocode_status='needs_review' (no country evidence — coords untouched)`);
      continue;
    }
    const geo = await geocodeOne(`${f.name}, ${f.postcode}`, { countryHint: f.hint });
    if (geo.lat != null && geo.lng != null) {
      await pool.query(
        `UPDATE crm_properties
            SET latitude = $2, longitude = $3, country = $4, geocode_status = 'resolved'
          WHERE id = $1`,
        [f.id, String(geo.lat), String(geo.lng), f.hint]
      );
      console.log(`  WRITE crm_properties[${f.id}] ${f.name}: resolved with hint ${f.hint} → ${JSON.stringify({ lat: geo.lat, lng: geo.lng, country: f.hint })}`);
    } else {
      await pool.query(
        `UPDATE crm_properties
            SET latitude = NULL, longitude = NULL, geocode_status = 'needs_review'
          WHERE id = $1`,
        [f.id]
      );
      console.log(`  WRITE crm_properties[${f.id}] ${f.name}: confirmed mismatch with hint ${f.hint} — coords cleared, geocode_status='needs_review'`);
    }
  }

  console.log(`\n[repair-landlord-geocodes] apply complete: ${findingsFlags.length} findings entries, ${propertyFlags.length} CRM rows.`);
}

main()
  .catch(e => { console.error(e); process.exitCode = 1; })
  .finally(() => pool.end());
