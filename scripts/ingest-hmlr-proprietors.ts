/**
 * Ingest HMLR CCOD (UK Companies) or OCOD (Overseas Companies) data into
 * Postgres. Both datasets ship as CSVs from
 * use-land-property-data.service.gov.uk on a monthly schedule.
 *
 * Standard HMLR column headers (match exactly — case-sensitive):
 *   Title Number
 *   Tenure                         ('Freehold' | 'Leasehold')
 *   Property Address
 *   District / County / Region / Postcode
 *   Multiple Address Indicator     ('Y' | '')
 *   Price Paid                     ('GBP 1,234,567' | '')
 *   Proprietor Name (1)..(4)
 *   Company Registration No. (1)..(4)
 *   Proprietorship Category (1)..(4)
 *   Country Incorporated (1)..(4)
 *   Proprietor (1)..(4) Address (1)..(3)
 *   Date Proprietor Added
 *   Additional Proprietor Indicator
 *
 * One CSV row → up to 4 rows in hmlr_proprietors (one per proprietor slot).
 *
 * Run:
 *   npx tsx scripts/ingest-hmlr-proprietors.ts <csv-file> --dataset ccod
 *   npx tsx scripts/ingest-hmlr-proprietors.ts <csv-file> --dataset ocod
 *
 *   --batch <n>   Insert batch size (default 500)
 *   --dry         Parse only, don't write
 */

import * as fs from "fs";
import { parse } from "csv-parse";
import { pool } from "../server/db";

interface CliArgs {
  file: string;
  dataset: "ccod" | "ocod";
  batch: number;
  dry: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { file: "", dataset: "ccod", batch: 500, dry: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dataset") {
      const d = argv[++i];
      if (d !== "ccod" && d !== "ocod") {
        console.error(`--dataset must be 'ccod' or 'ocod' (got '${d}')`);
        process.exit(2);
      }
      args.dataset = d;
    } else if (a === "--batch") args.batch = parseInt(argv[++i], 10) || 500;
    else if (a === "--dry") args.dry = true;
    else if (!args.file) args.file = a;
  }
  if (!args.file) {
    console.error("Usage: tsx scripts/ingest-hmlr-proprietors.ts <csv-file> --dataset ccod|ocod [--batch <n>] [--dry]");
    process.exit(2);
  }
  if (!fs.existsSync(args.file)) {
    console.error(`File not found: ${args.file}`);
    process.exit(2);
  }
  return args;
}

interface ProprietorRow {
  titleNumber: string;
  dataset: "ccod" | "ocod";
  position: number;
  proprietorName: string | null;
  proprietorCategory: string | null;
  companyRegistrationNo: string | null;
  countryIncorporated: string | null;
  proprietorAddress1: string | null;
  proprietorAddress2: string | null;
  proprietorAddress3: string | null;
  dateProprietorAdded: string | null;
  pricePaid: string | null;
  propertyAddress: string | null;
  postcode: string | null;
  postcodeNormalised: string | null;
  tenure: string | null;
  multipleAddressIndicator: string | null;
  additionalProprietorIndicator: string | null;
}

/** Normalise a postcode to uppercase, no whitespace — what we index on. */
function normalisePostcode(pc: string | null): string | null {
  if (!pc) return null;
  const cleaned = pc.toUpperCase().replace(/\s+/g, "").trim();
  return cleaned || null;
}

/** If CCOD/OCOD doesn't have a separate Postcode column for some rows,
 *  pull the postcode out of the property_address text as a fallback. */
function extractPostcode(s: string | null): string | null {
  if (!s) return null;
  const m = s.toUpperCase().match(/\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/);
  return m ? `${m[1]} ${m[2]}` : null;
}

function clean(s: any): string | null {
  if (s == null) return null;
  const t = String(s).trim();
  return t === "" ? null : t;
}

function parseDate(s: any): string | null {
  const t = clean(s);
  if (!t) return null;
  // HMLR uses DD-MM-YYYY in CCOD/OCOD
  const m = t.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  // ISO already
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  return null;
}

function explodeRow(row: Record<string, any>, dataset: "ccod" | "ocod"): ProprietorRow[] {
  const titleNumber = clean(row["Title Number"]);
  if (!titleNumber) return [];
  const propertyAddress = clean(row["Property Address"]);
  // CCOD has a separate Postcode column; OCOD historically didn't, so we
  // fall back to extracting it from property_address text.
  const postcodeRaw = clean(row["Postcode"]) || extractPostcode(propertyAddress);
  const postcodeNormalised = normalisePostcode(postcodeRaw);
  const out: ProprietorRow[] = [];
  for (let i = 1; i <= 4; i++) {
    const name = clean(row[`Proprietor Name (${i})`]);
    if (!name) continue;
    out.push({
      titleNumber,
      dataset,
      position: i,
      proprietorName: name,
      proprietorCategory: clean(row[`Proprietorship Category (${i})`]),
      companyRegistrationNo: clean(row[`Company Registration No. (${i})`]),
      countryIncorporated: clean(row[`Country Incorporated (${i})`]),
      proprietorAddress1: clean(row[`Proprietor (${i}) Address (1)`]),
      proprietorAddress2: clean(row[`Proprietor (${i}) Address (2)`]),
      proprietorAddress3: clean(row[`Proprietor (${i}) Address (3)`]),
      dateProprietorAdded: parseDate(row["Date Proprietor Added"]),
      pricePaid: clean(row["Price Paid"]),
      propertyAddress,
      postcode: postcodeRaw,
      postcodeNormalised,
      tenure: clean(row["Tenure"]),
      multipleAddressIndicator: clean(row["Multiple Address Indicator"]),
      additionalProprietorIndicator: clean(row["Additional Proprietor Indicator"]),
    });
  }
  return out;
}

async function startRun(file: string, dataset: string): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO hmlr_ingest_runs (dataset, source_filename, status)
     VALUES ($1, $2, 'running')
     RETURNING id`,
    [dataset, file],
  );
  return r.rows[0].id;
}

async function finishRun(
  id: string,
  status: "ok" | "error",
  counts: { processed: number; inserted: number; updated: number; skipped: number },
  error?: string,
): Promise<void> {
  await pool.query(
    `UPDATE hmlr_ingest_runs
        SET status = $1,
            rows_processed = $2,
            rows_inserted = $3,
            rows_updated = $4,
            rows_skipped = $5,
            error = $6,
            finished_at = now()
      WHERE id = $7`,
    [status, counts.processed, counts.inserted, counts.updated, counts.skipped, error || null, id],
  );
}

async function flushBatch(batch: ProprietorRow[], runId: string): Promise<{ inserted: number; updated: number }> {
  if (batch.length === 0) return { inserted: 0, updated: 0 };
  const values: string[] = [];
  const params: any[] = [];
  let p = 1;
  for (const r of batch) {
    values.push(`($${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++})`);
    params.push(
      r.titleNumber, r.dataset, r.position, r.proprietorName, r.proprietorCategory,
      r.companyRegistrationNo, r.countryIncorporated,
      r.proprietorAddress1, r.proprietorAddress2, r.proprietorAddress3,
      r.dateProprietorAdded, r.pricePaid, r.propertyAddress,
      r.postcode, r.postcodeNormalised,
      r.tenure, r.multipleAddressIndicator, r.additionalProprietorIndicator,
      runId,
    );
  }
  const sql = `
    INSERT INTO hmlr_proprietors (
      title_number, dataset, proprietor_position, proprietor_name, proprietor_category,
      company_registration_no, country_incorporated,
      proprietor_address_1, proprietor_address_2, proprietor_address_3,
      date_proprietor_added, price_paid, property_address,
      postcode, postcode_normalised,
      tenure, multiple_address_indicator, additional_proprietor_indicator,
      ingest_run_id
    ) VALUES ${values.join(",")}
    ON CONFLICT (title_number, dataset, proprietor_position) DO UPDATE
      SET proprietor_name = EXCLUDED.proprietor_name,
          proprietor_category = EXCLUDED.proprietor_category,
          company_registration_no = EXCLUDED.company_registration_no,
          country_incorporated = EXCLUDED.country_incorporated,
          proprietor_address_1 = EXCLUDED.proprietor_address_1,
          proprietor_address_2 = EXCLUDED.proprietor_address_2,
          proprietor_address_3 = EXCLUDED.proprietor_address_3,
          date_proprietor_added = EXCLUDED.date_proprietor_added,
          price_paid = EXCLUDED.price_paid,
          property_address = EXCLUDED.property_address,
          postcode = EXCLUDED.postcode,
          postcode_normalised = EXCLUDED.postcode_normalised,
          tenure = EXCLUDED.tenure,
          multiple_address_indicator = EXCLUDED.multiple_address_indicator,
          additional_proprietor_indicator = EXCLUDED.additional_proprietor_indicator,
          ingest_run_id = EXCLUDED.ingest_run_id,
          updated_at = now()
    RETURNING (xmax = 0) AS inserted
  `;
  const r = await pool.query<{ inserted: boolean }>(sql, params);
  let inserted = 0, updated = 0;
  for (const row of r.rows) (row.inserted ? inserted++ : updated++);
  return { inserted, updated };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(`[ingest-hmlr-proprietors] file=${args.file} dataset=${args.dataset} batch=${args.batch} dry=${args.dry}`);

  const runId = args.dry ? "00000000-0000-0000-0000-000000000000" : await startRun(args.file, args.dataset);
  let processed = 0, inserted = 0, updated = 0, skipped = 0;
  let batch: ProprietorRow[] = [];

  const parser = parse({ columns: true, skip_empty_lines: true, trim: true, bom: true });
  const stream = fs.createReadStream(args.file).pipe(parser);

  try {
    for await (const row of stream as any) {
      processed++;
      const exploded = explodeRow(row as Record<string, any>, args.dataset);
      if (exploded.length === 0) {
        skipped++;
        continue;
      }
      batch.push(...exploded);
      if (batch.length >= args.batch) {
        if (!args.dry) {
          const f = await flushBatch(batch, runId);
          inserted += f.inserted;
          updated += f.updated;
        }
        batch = [];
        if (processed % 10_000 === 0) {
          console.log(`[ingest-hmlr-proprietors] processed=${processed} inserted=${inserted} updated=${updated} skipped=${skipped}`);
        }
      }
    }
    if (batch.length > 0 && !args.dry) {
      const f = await flushBatch(batch, runId);
      inserted += f.inserted;
      updated += f.updated;
    }
    if (!args.dry) await finishRun(runId, "ok", { processed, inserted, updated, skipped });
    console.log(`[ingest-hmlr-proprietors] DONE — processed=${processed} inserted=${inserted} updated=${updated} skipped=${skipped}`);
  } catch (err: any) {
    console.error("[ingest-hmlr-proprietors] FAILED:", err?.message);
    if (!args.dry) await finishRun(runId, "error", { processed, inserted, updated, skipped }, err?.message || String(err));
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
