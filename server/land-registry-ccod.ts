// HM Land Registry — Commercial & Corporate Ownership Data ingestion.
//
// Two free public datasets from HMLR (OGL v3 licence, commercial use OK
// with attribution):
//   CCOD — every UK title (freehold/leasehold) owned by a UK-registered
//          company. Keyed by Companies House number. ~3M+ rows.
//   UCOD — every UK title owned by a non-UK / offshore company. ~100k+ rows.
//
// Each is published as a monthly CSV at https://use-land-property-data.service.gov.uk/.
// Access pattern:
//   1. Sign up free, get an API key from /api-key
//   2. GET /api/v1/datasets/{ccod|ocod} → list of monthly files
//   3. GET /api/v1/datasets/{ccod|ocod}/{filename} → short-lived signed
//      S3 URL that returns the CSV
//
// We stream the CSV (the file is 100-200MB so we can't buffer), batch
// upsert into land_registry_titles keyed on (source, title_number), and
// index by companies house number + postcode so the Ownership block can
// fetch every title for a given landlord in <100ms.
//
// On the first ingest we expect ~3M rows; subsequent runs of the same
// month's file are idempotent (ON CONFLICT DO UPDATE). The CSV's
// "Change Indicator" + "Update Indicator" let HMLR ship monthly deltas
// only ("COU" files) but we always pull the FULL file for simplicity —
// 150MB once a month isn't worth the complexity of merge logic.

import { pool } from "./db";
import { parse } from "csv-parse";
import { Readable } from "stream";

const HMLR_API_KEY = process.env.HMLR_API_KEY || "";
const HMLR_BASE = "https://use-land-property-data.service.gov.uk";

export type CcodSource = "CCOD" | "UCOD";

let ingestProgress: {
  state: "idle" | "downloading" | "parsing" | "done" | "error";
  source: CcodSource | null;
  filename: string | null;
  rowsParsed: number;
  rowsInserted: number;
  rowsUpdated: number;
  rowsSkipped: number;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
} = {
  state: "idle",
  source: null,
  filename: null,
  rowsParsed: 0,
  rowsInserted: 0,
  rowsUpdated: 0,
  rowsSkipped: 0,
  startedAt: null,
  finishedAt: null,
  error: null,
};

export function getIngestProgress() {
  return ingestProgress;
}

let _tableEnsured = false;
async function ensureTitlesTable() {
  if (_tableEnsured) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS land_registry_titles (
      id BIGSERIAL PRIMARY KEY,
      source TEXT NOT NULL,
      title_number TEXT NOT NULL,
      tenure TEXT,
      property_address TEXT,
      district TEXT,
      county TEXT,
      region TEXT,
      postcode TEXT,
      price_paid BIGINT,
      proprietor_name TEXT,
      company_registration_number TEXT,
      proprietorship_category TEXT,
      country_incorporated TEXT,
      date_proprietor_added DATE,
      multiple_addresses BOOLEAN DEFAULT false,
      additional_proprietors BOOLEAN DEFAULT false,
      raw_proprietors JSONB,
      source_file TEXT,
      imported_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (source, title_number)
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_lrt_crn ON land_registry_titles (company_registration_number) WHERE company_registration_number IS NOT NULL`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_lrt_postcode ON land_registry_titles (postcode)`);
  // Trigram index on proprietor name so we can fall back to fuzzy match
  // when a landlord has no CH number (e.g. a partnership / LLP that's
  // not in our CRM yet).
  await pool.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`).catch(() => {});
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_lrt_prop_name_trgm ON land_registry_titles USING gin (proprietor_name gin_trgm_ops)`).catch(() => {});
  _tableEnsured = true;
}

// Normalise a CH number to the 8-char zero-padded form CH itself uses on
// the public profile, so we can index/match consistently regardless of
// whether the source put it in as "1234567" or "01234567".
function padCh(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = String(raw).trim().toUpperCase();
  if (!trimmed) return null;
  // CH numbers can be all digits, or prefixed (SC, NI, OC, FC, etc).
  // Only zero-pad the numeric ones.
  if (/^[0-9]+$/.test(trimmed)) return trimmed.padStart(8, "0");
  return trimmed;
}

function parseDate(s: string | null | undefined): string | null {
  if (!s) return null;
  // HMLR ships dates as DD-MM-YYYY in CCOD.
  const m = String(s).trim().match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return null;
}

function parsePrice(s: string | null | undefined): number | null {
  if (!s) return null;
  const n = Number(String(s).replace(/[£,\s]/g, ""));
  return Number.isFinite(n) ? Math.round(n) : null;
}

// Map a parsed CCOD row → INSERT shape. We keep only proprietor 1 in
// flat columns (the most common case — single-owner titles) and stash
// all four proprietors in raw_proprietors JSONB so joint ownership
// stays queryable without bloating the column count.
function rowToTitle(row: Record<string, string>, source: CcodSource, sourceFile: string) {
  const titleNumber = (row["Title Number"] || "").trim();
  if (!titleNumber) return null;

  const proprietors: Array<{ name: string; crn: string | null; category: string | null; country: string | null }> = [];
  for (let i = 1; i <= 4; i++) {
    const name = (row[`Proprietor Name (${i})`] || "").trim();
    if (!name) continue;
    proprietors.push({
      name,
      crn: padCh(row[`Company Registration No. (${i})`]),
      category: (row[`Proprietorship Category (${i})`] || "").trim() || null,
      country: (row[`Country Incorporated (${i})`] || "").trim() || null,
    });
  }
  if (proprietors.length === 0) return null;

  return {
    source,
    titleNumber,
    tenure: (row["Tenure"] || "").trim() || null,
    propertyAddress: (row["Property Address"] || "").trim() || null,
    district: (row["District"] || "").trim() || null,
    county: (row["County"] || "").trim() || null,
    region: (row["Region"] || "").trim() || null,
    postcode: (row["Postcode"] || "").trim().toUpperCase() || null,
    pricePaid: parsePrice(row["Price Paid"]),
    proprietorName: proprietors[0].name,
    crn: proprietors[0].crn,
    proprietorshipCategory: proprietors[0].category,
    countryIncorporated: proprietors[0].country,
    datesProprietorAdded: parseDate(row["Date Proprietor Added"]),
    multipleAddresses: /^Y$/i.test(row["Multiple Address Indicator"] || ""),
    additionalProprietors: /^Y$/i.test(row["Additional Proprietor Indicator"] || ""),
    rawProprietors: proprietors,
    sourceFile,
  };
}

const BATCH_SIZE = 500;

async function flushBatch(rows: ReturnType<typeof rowToTitle>[]) {
  const real = rows.filter((r): r is NonNullable<typeof r> => !!r);
  if (real.length === 0) return { inserted: 0, updated: 0 };

  // Build a multi-row VALUES clause for one round-trip per batch.
  const cols = [
    "source", "title_number", "tenure", "property_address", "district", "county", "region",
    "postcode", "price_paid", "proprietor_name", "company_registration_number",
    "proprietorship_category", "country_incorporated", "date_proprietor_added",
    "multiple_addresses", "additional_proprietors", "raw_proprietors", "source_file",
  ];
  const valuesSql: string[] = [];
  const params: any[] = [];
  for (const r of real) {
    const offset = params.length;
    const placeholders = cols.map((_, i) => `$${offset + i + 1}`).join(",");
    valuesSql.push(`(${placeholders})`);
    params.push(
      r.source, r.titleNumber, r.tenure, r.propertyAddress, r.district, r.county, r.region,
      r.postcode, r.pricePaid, r.proprietorName, r.crn,
      r.proprietorshipCategory, r.countryIncorporated, r.datesProprietorAdded,
      r.multipleAddresses, r.additionalProprietors, JSON.stringify(r.rawProprietors), r.sourceFile,
    );
  }
  const sql = `
    INSERT INTO land_registry_titles (${cols.join(", ")})
    VALUES ${valuesSql.join(", ")}
    ON CONFLICT (source, title_number) DO UPDATE SET
      tenure = EXCLUDED.tenure,
      property_address = EXCLUDED.property_address,
      district = EXCLUDED.district,
      county = EXCLUDED.county,
      region = EXCLUDED.region,
      postcode = EXCLUDED.postcode,
      price_paid = EXCLUDED.price_paid,
      proprietor_name = EXCLUDED.proprietor_name,
      company_registration_number = EXCLUDED.company_registration_number,
      proprietorship_category = EXCLUDED.proprietorship_category,
      country_incorporated = EXCLUDED.country_incorporated,
      date_proprietor_added = EXCLUDED.date_proprietor_added,
      multiple_addresses = EXCLUDED.multiple_addresses,
      additional_proprietors = EXCLUDED.additional_proprietors,
      raw_proprietors = EXCLUDED.raw_proprietors,
      source_file = EXCLUDED.source_file,
      imported_at = NOW()
    RETURNING (xmax = 0) AS inserted`;
  const res = await pool.query(sql, params);
  let inserted = 0, updated = 0;
  for (const row of res.rows) {
    if (row.inserted) inserted++; else updated++;
  }
  return { inserted, updated };
}

// Resolve a HMLR filename → short-lived signed S3 URL via their API.
// Filenames look like CCOD_FULL_2026_05.csv. The API requires the
// HMLR_API_KEY env var (free; sign up at /sign-up and grab one from the
// /api-key page).
export async function resolveHmlrDownloadUrl(source: CcodSource, filename: string): Promise<string> {
  if (!HMLR_API_KEY) throw new Error("HMLR_API_KEY env var not configured");
  const dataset = source.toLowerCase(); // ccod or ucod
  const url = `${HMLR_BASE}/api/v1/datasets/${dataset}/${encodeURIComponent(filename)}`;
  const r = await fetch(url, { headers: { Authorization: HMLR_API_KEY } });
  if (!r.ok) throw new Error(`HMLR resolve failed (${r.status}): ${await r.text().catch(() => "")}`);
  const body = await r.json() as { result?: { download_url?: string } };
  const downloadUrl = body?.result?.download_url;
  if (!downloadUrl) throw new Error("HMLR API didn't return a download_url");
  return downloadUrl;
}

// List the available monthly files for a dataset — useful so the user
// can hit "fetch latest" without knowing today's filename.
export async function listHmlrFiles(source: CcodSource): Promise<string[]> {
  if (!HMLR_API_KEY) throw new Error("HMLR_API_KEY env var not configured");
  const dataset = source.toLowerCase();
  const url = `${HMLR_BASE}/api/v1/datasets/${dataset}`;
  const r = await fetch(url, { headers: { Authorization: HMLR_API_KEY } });
  if (!r.ok) throw new Error(`HMLR list failed (${r.status})`);
  const body = await r.json() as { result?: { public_resources?: { name: string }[]; private_resources?: { name: string }[] } };
  const all = [...(body?.result?.public_resources || []), ...(body?.result?.private_resources || [])];
  return all.map(r => r.name).filter(n => /^CCOD_FULL|^OCOD_FULL/.test(n));
}

// Ingest a CCOD/UCOD CSV from a (signed S3) URL. Streams the body,
// parses with csv-parse in batches of BATCH_SIZE, and upserts. Updates
// the shared ingestProgress so the admin UI / status endpoint can
// follow along.
export async function ingestCcodFromUrl(downloadUrl: string, source: CcodSource, filename: string) {
  await ensureTitlesTable();
  ingestProgress = {
    state: "downloading",
    source, filename,
    rowsParsed: 0, rowsInserted: 0, rowsUpdated: 0, rowsSkipped: 0,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    error: null,
  };

  try {
    const res = await fetch(downloadUrl);
    if (!res.ok || !res.body) throw new Error(`download failed (${res.status})`);
    ingestProgress.state = "parsing";

    const parser = parse({ columns: true, skip_empty_lines: true, relax_quotes: true });
    const nodeStream = Readable.fromWeb(res.body as any);
    nodeStream.pipe(parser);

    let batch: ReturnType<typeof rowToTitle>[] = [];
    for await (const row of parser) {
      ingestProgress.rowsParsed++;
      const mapped = rowToTitle(row, source, filename);
      if (!mapped) { ingestProgress.rowsSkipped++; continue; }
      batch.push(mapped);
      if (batch.length >= BATCH_SIZE) {
        const { inserted, updated } = await flushBatch(batch);
        ingestProgress.rowsInserted += inserted;
        ingestProgress.rowsUpdated += updated;
        batch = [];
      }
    }
    if (batch.length > 0) {
      const { inserted, updated } = await flushBatch(batch);
      ingestProgress.rowsInserted += inserted;
      ingestProgress.rowsUpdated += updated;
    }
    ingestProgress.state = "done";
    ingestProgress.finishedAt = new Date().toISOString();
    return { ...ingestProgress };
  } catch (err: any) {
    ingestProgress.state = "error";
    ingestProgress.error = err?.message || String(err);
    ingestProgress.finishedAt = new Date().toISOString();
    throw err;
  }
}

// Convenience runner: pull the latest FULL file for a dataset and
// ingest it end-to-end. The user just hits this each month (or we
// schedule it).
export async function ingestLatestFor(source: CcodSource) {
  const files = await listHmlrFiles(source);
  const fulls = files.filter(f => /^CCOD_FULL|^OCOD_FULL/.test(f)).sort();
  if (fulls.length === 0) throw new Error(`No FULL files available for ${source}`);
  const latest = fulls[fulls.length - 1];
  const url = await resolveHmlrDownloadUrl(source, latest);
  return ingestCcodFromUrl(url, source, latest);
}

// Titles owned by a company, matched by Companies House number.
// Padded both sides so 1234567 and 01234567 collide. Limit defaults to
// 500 — big REITs (Land Securities, British Land) own hundreds of titles
// so this isn't unreasonable to render in one go.
export async function getTitlesForCompany(chNumber: string | null | undefined, limit = 500) {
  if (!chNumber) return [];
  await ensureTitlesTable();
  const padded = padCh(chNumber);
  if (!padded) return [];
  const { rows } = await pool.query(
    `SELECT title_number, tenure, property_address, district, county, region, postcode,
            price_paid, proprietor_name, proprietorship_category, date_proprietor_added,
            additional_proprietors, source
       FROM land_registry_titles
      WHERE company_registration_number = $1
      ORDER BY postcode NULLS LAST, property_address
      LIMIT $2`,
    [padded, limit]
  );
  return rows;
}

export async function countTitlesForCompany(chNumber: string | null | undefined): Promise<number> {
  if (!chNumber) return 0;
  await ensureTitlesTable();
  const padded = padCh(chNumber);
  if (!padded) return 0;
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM land_registry_titles WHERE company_registration_number = $1`,
    [padded]
  );
  return rows[0]?.n || 0;
}
