/**
 * HMLR bulk-dataset fetcher.
 *
 * Uses the gov.uk "Use land and property data" API
 * (https://use-land-property-data.service.gov.uk/api-documentation) to
 * pull the latest CCOD (UK companies) or OCOD (overseas companies)
 * monthly snapshot, unzip it, and stream-ingest the inner CSV into
 * hmlr_proprietors via the same logic the CLI script uses.
 *
 * Authentication: header `Authorization: <HMLR_API_KEY>` (NOT Bearer —
 * the gov.uk service accepts the raw key). Key is read from
 * process.env.HMLR_API_KEY at call time so a rotation in Railway is
 * picked up on the next sync.
 *
 * Why we re-implement the CSV ingest logic instead of importing it:
 * scripts/ingest-hmlr-proprietors.ts calls main() at module load, so
 * importing it would fire the CLI parser and crash the server. Cleaner
 * to keep the script as a CLI tool and have one focused server module.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import AdmZip from "adm-zip";
import { parse } from "csv-parse";
import { pool } from "./db";

const HMLR_API_BASE = "https://use-land-property-data.service.gov.uk/api/v1";

export type HmlrDataset = "ccod" | "ocod";

interface HmlrDatasetListResponse {
  result: {
    public_resources?: Array<{
      file_name: string;
      file_url: string;
      last_updated: string;
      size_bytes: number;
      resource_id: string;
    }>;
  };
}

interface HmlrDownloadResponse {
  result: {
    download_url: string;
  };
}

function requireApiKey(): string {
  const key = process.env.HMLR_API_KEY;
  if (!key) throw new Error("HMLR_API_KEY is not set. Add it to Railway env vars.");
  return key.trim();
}

/**
 * Pick the file to download for a dataset. HMLR publishes monthly
 * snapshots; the API exposes them under public_resources. Historically
 * each dataset had two files per month — "FULL" (snapshot) + "COU"
 * (change-only update since last full) — but the naming convention has
 * varied: sometimes `OCOD_FULL_YYYY_MM.zip`, sometimes a single file
 * with no FULL/COU token at all.
 *
 * Strategy: prefer anything matching /FULL/i (older convention), fall
 * back to anything that doesn't match /COU/i (newer convention where
 * only one file is published), then by last_updated DESC. Never picks
 * a known COU delta unless that's literally the only thing available.
 *
 * Always logs the full filename list so a future shape change is
 * visible in the error message (see the syncHmlrDataset failRun path).
 */
async function getLatestFullFilename(dataset: HmlrDataset): Promise<{ filename: string; sizeBytes: number; lastUpdated: string }> {
  const apiKey = requireApiKey();
  const url = `${HMLR_API_BASE}/datasets/${dataset}`;
  const res = await fetch(url, { headers: { Authorization: apiKey, Accept: "application/json" } });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`HMLR list ${dataset} failed: HTTP ${res.status} ${res.statusText}${body ? ` — ${body.slice(0, 200)}` : ""}`);
  }
  const data = (await res.json()) as HmlrDatasetListResponse;
  const allFiles = data?.result?.public_resources || [];
  if (allFiles.length === 0) {
    throw new Error(`HMLR ${dataset} response had no resources. Response keys: ${Object.keys(data?.result || data || {}).join(", ")}`);
  }
  // Filter out HMLR's "example.csv" placeholder — that's what their API
  // hands back to accounts that haven't yet signed the dataset licence,
  // or which only have a free-tier preview. Trying to download it gets
  // us a tiny sample CSV (not a real monthly snapshot) which then fails
  // ZIP extraction with the unhelpful "No END header found" error. Bail
  // out with a clear message instead.
  const seenAllNames = allFiles.map((f) => f.file_name);
  const realFiles = allFiles.filter((f) => !/^example\.csv$/i.test(f.file_name.trim()));
  if (realFiles.length === 0) {
    throw new Error(
      `HMLR ${dataset} only exposed the placeholder "example.csv" — your account either hasn't signed the dataset licence (Personal-use tier is free, ~2-min sign-up at https://use-land-property-data.service.gov.uk/dataset/${dataset}) or the chosen licence tier doesn't include bulk-data access. After signing, the resource list should include a real monthly file like "${dataset.toUpperCase()}_FULL_YYYY_MM.zip".`,
    );
  }
  // Sort newest first.
  const sorted = [...realFiles].sort((a, b) => new Date(b.last_updated).getTime() - new Date(a.last_updated).getTime());
  const fulls = sorted.filter((f) => /full/i.test(f.file_name));
  const nonCou = sorted.filter((f) => !/cou|change|delta/i.test(f.file_name));
  const pick = fulls[0] || nonCou[0] || sorted[0];
  if (!pick) {
    throw new Error(`HMLR ${dataset} had ${realFiles.length} real resources but none looked like a snapshot. Filenames: ${realFiles.map((f) => f.file_name).join(", ")}`);
  }
  console.log(`[hmlr-fetch] ${dataset} resources: [${seenAllNames.join(", ")}] → picked ${pick.file_name}`);
  return { filename: pick.file_name, sizeBytes: pick.size_bytes, lastUpdated: pick.last_updated };
}

/**
 * Resolve a filename to its signed download URL. The HMLR API hands out
 * short-lived signed S3-style URLs; we download immediately after.
 */
async function getSignedDownloadUrl(dataset: HmlrDataset, filename: string): Promise<string> {
  const apiKey = requireApiKey();
  const url = `${HMLR_API_BASE}/datasets/${dataset}/${encodeURIComponent(filename)}`;
  const res = await fetch(url, { headers: { Authorization: apiKey, Accept: "application/json" } });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`HMLR download URL for ${filename} failed: HTTP ${res.status}${body ? ` — ${body.slice(0, 200)}` : ""}`);
  }
  const data = (await res.json()) as HmlrDownloadResponse;
  if (!data?.result?.download_url) {
    throw new Error(`HMLR download URL response missing download_url for ${filename}`);
  }
  return data.result.download_url;
}

/** Download the ZIP to /tmp (Railway tmpfs handles ~2 GB fine) so we
 *  can extract without holding the whole archive in memory. */
async function downloadToTmp(url: string, filename: string): Promise<string> {
  const tmpPath = path.join(os.tmpdir(), `hmlr-${Date.now()}-${filename}`);
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`HMLR file download failed: HTTP ${res.status}`);
  if (!res.body) throw new Error("HMLR file download had no response body");
  const fileStream = fs.createWriteStream(tmpPath);
  await pipeline(res.body as any, fileStream);
  return tmpPath;
}

// ── CSV ingest (same shape as scripts/ingest-hmlr-proprietors.ts) ──────────

interface ProprietorRow {
  titleNumber: string;
  dataset: HmlrDataset;
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

function normalisePostcode(pc: string | null): string | null {
  if (!pc) return null;
  const cleaned = pc.toUpperCase().replace(/\s+/g, "").trim();
  return cleaned || null;
}

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
  const m = t.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  return null;
}

function explodeRow(row: Record<string, any>, dataset: HmlrDataset): ProprietorRow[] {
  const titleNumber = clean(row["Title Number"]);
  if (!titleNumber) return [];
  const propertyAddress = clean(row["Property Address"]);
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

async function ingestCsvFile(csvPath: string, dataset: HmlrDataset, sourceFilename: string, sourceUrl: string, batchSize: number, existingRunId?: string): Promise<{ runId: string; processed: number; inserted: number; updated: number; skipped: number }> {
  let runId: string;
  if (existingRunId) {
    runId = existingRunId;
  } else {
    const runRes = await pool.query<{ id: string }>(
      `INSERT INTO hmlr_ingest_runs (dataset, source_url, source_filename, status)
       VALUES ($1, $2, $3, 'running')
       RETURNING id`,
      [dataset, sourceUrl, sourceFilename],
    );
    runId = runRes.rows[0].id;
  }

  let processed = 0, inserted = 0, updated = 0, skipped = 0;
  let batch: ProprietorRow[] = [];

  const parser = parse({ columns: true, skip_empty_lines: true, trim: true, bom: true, relax_column_count_less: true });
  const stream = fs.createReadStream(csvPath).pipe(parser);

  try {
    for await (const row of stream as any) {
      processed++;
      const exploded = explodeRow(row as Record<string, any>, dataset);
      if (exploded.length === 0) { skipped++; continue; }
      batch.push(...exploded);
      if (batch.length >= batchSize) {
        const f = await flushBatch(batch, runId);
        inserted += f.inserted;
        updated += f.updated;
        batch = [];
        if (processed % 10_000 === 0) {
          await pool.query(
            `UPDATE hmlr_ingest_runs SET rows_processed = $1, rows_inserted = $2, rows_updated = $3, rows_skipped = $4 WHERE id = $5`,
            [processed, inserted, updated, skipped, runId],
          );
        }
      }
    }
    if (batch.length > 0) {
      const f = await flushBatch(batch, runId);
      inserted += f.inserted;
      updated += f.updated;
    }
    await pool.query(
      `UPDATE hmlr_ingest_runs SET status='ok', rows_processed=$1, rows_inserted=$2, rows_updated=$3, rows_skipped=$4, finished_at=now() WHERE id=$5`,
      [processed, inserted, updated, skipped, runId],
    );
    return { runId, processed, inserted, updated, skipped };
  } catch (err: any) {
    await pool.query(
      `UPDATE hmlr_ingest_runs SET status='error', error=$1, rows_processed=$2, rows_inserted=$3, rows_updated=$4, rows_skipped=$5, finished_at=now() WHERE id=$6`,
      [err?.message || String(err), processed, inserted, updated, skipped, runId],
    );
    throw err;
  }
}

/**
 * End-to-end sync for one dataset. Fetches the latest FULL file via
 * the HMLR API, downloads the ZIP, extracts the CSV, runs the ingest,
 * and cleans up tmp files. Returns the run summary.
 *
 * Writes a tracking row to hmlr_ingest_runs IMMEDIATELY (status='running')
 * before doing any work — so if the HMLR API auth fails or the response
 * shape is wrong, the user can still see the error in /api/admin/hmlr/runs
 * instead of silence. Without this, every pre-ingest failure (API key
 * rejected, list-datasets call errored, download failed, ZIP parse
 * failed) would just disappear into Railway logs.
 */
export async function syncHmlrDataset(dataset: HmlrDataset, batchSize = 500): Promise<{
  runId: string;
  filename: string;
  sizeBytes: number;
  processed: number;
  inserted: number;
  updated: number;
  skipped: number;
}> {
  console.log(`[hmlr-fetch] starting sync for ${dataset}`);

  // Reserve a run id so any failure below has somewhere to record itself.
  const runRes = await pool.query<{ id: string }>(
    `INSERT INTO hmlr_ingest_runs (dataset, status) VALUES ($1, 'running') RETURNING id`,
    [dataset],
  );
  const runId = runRes.rows[0].id;

  const failRun = async (err: any) => {
    const msg = err?.message || String(err);
    console.error(`[hmlr-fetch] sync failed for ${dataset}:`, msg);
    try {
      await pool.query(
        `UPDATE hmlr_ingest_runs SET status='error', error=$1, finished_at=now() WHERE id=$2`,
        [msg, runId],
      );
    } catch (e: any) {
      console.error(`[hmlr-fetch] also failed to write error row:`, e?.message);
    }
  };

  let meta: { filename: string; sizeBytes: number; lastUpdated: string };
  let downloadUrl: string;
  let zipPath: string;
  try {
    meta = await getLatestFullFilename(dataset);
  } catch (err: any) {
    await failRun(new Error(`getLatestFullFilename failed (likely HMLR API key / response shape): ${err?.message}`));
    throw err;
  }
  console.log(`[hmlr-fetch] latest ${dataset} = ${meta.filename} (${(meta.sizeBytes / 1024 / 1024).toFixed(1)} MB)`);

  try {
    downloadUrl = await getSignedDownloadUrl(dataset, meta.filename);
  } catch (err: any) {
    await failRun(new Error(`getSignedDownloadUrl(${meta.filename}) failed: ${err?.message}`));
    throw err;
  }

  try {
    zipPath = await downloadToTmp(downloadUrl, meta.filename);
  } catch (err: any) {
    await failRun(new Error(`downloadToTmp failed: ${err?.message}`));
    throw err;
  }

  // Now we have the file — update the run row with the source info so
  // the user can see what we got.
  await pool.query(
    `UPDATE hmlr_ingest_runs SET source_url = $1, source_filename = $2 WHERE id = $3`,
    [downloadUrl, meta.filename, runId],
  );
  console.log(`[hmlr-fetch] downloaded ${dataset} zip to ${zipPath}`);

  let csvPath: string | null = null;
  try {
    // HMLR mostly ships datasets as ZIP-wrapped CSVs but a few are
    // delivered as a raw CSV. If the filename ends .csv (and isn't
    // .zip), skip the unzip step and ingest the file directly.
    const isRawCsv = /\.csv$/i.test(meta.filename) && !/\.zip$/i.test(meta.filename);
    if (isRawCsv) {
      csvPath = zipPath; // already the CSV
      console.log(`[hmlr-fetch] ${meta.filename} is a raw CSV — ingesting directly`);
    } else {
      const zip = new AdmZip(zipPath);
      const entries = zip.getEntries();
      const csvEntry = entries.find((e) => /\.csv$/i.test(e.entryName) && !e.isDirectory);
      if (!csvEntry) throw new Error(`No CSV found inside ${meta.filename}`);
      csvPath = path.join(os.tmpdir(), `hmlr-${Date.now()}-${csvEntry.entryName}`);
      zip.extractEntryTo(csvEntry, path.dirname(csvPath), false, true, false, path.basename(csvPath));
      console.log(`[hmlr-fetch] extracted CSV to ${csvPath}`);
    }

    const result = await ingestCsvFile(csvPath, dataset, meta.filename, downloadUrl, batchSize, runId);
    console.log(`[hmlr-fetch] ${dataset} sync done — processed=${result.processed} inserted=${result.inserted} updated=${result.updated} skipped=${result.skipped}`);
    return { ...result, filename: meta.filename, sizeBytes: meta.sizeBytes };
  } catch (err: any) {
    await failRun(new Error(`ZIP/ingest failed: ${err?.message}`));
    throw err;
  } finally {
    // Best-effort cleanup. Railway tmpfs is ephemeral so leftovers
    // disappear on restart anyway, but tidy up to avoid filling /tmp.
    try { if (csvPath && fs.existsSync(csvPath)) fs.unlinkSync(csvPath); } catch { /* ignore */ }
    try { if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath); } catch { /* ignore */ }
  }
}

/**
 * Direct ingest from a locally-uploaded CSV file. Used by the
 * /api/admin/hmlr/upload endpoint as a workaround when gov.uk's API is
 * being stale about licence acceptance and still serving example.csv —
 * the user downloads the real CSV from the website and uploads it
 * here. Handles raw CSV directly OR a ZIP-wrapped CSV (gov.uk usually
 * gives raw .csv but ZIP support is cheap to keep).
 *
 * Writes the same hmlr_ingest_runs row + uses the same flushBatch
 * upsert logic as the API-driven path.
 */
export async function ingestUploadedCsv(
  localPath: string,
  dataset: HmlrDataset,
  originalFilename: string,
): Promise<{ runId: string; processed: number; inserted: number; updated: number; skipped: number }> {
  console.log(`[hmlr-fetch] uploaded ingest for ${dataset} from ${originalFilename}`);
  const runRes = await pool.query<{ id: string }>(
    `INSERT INTO hmlr_ingest_runs (dataset, source_filename, status) VALUES ($1, $2, 'running') RETURNING id`,
    [dataset, originalFilename],
  );
  const runId = runRes.rows[0].id;

  const failRun = async (err: any) => {
    const msg = err?.message || String(err);
    console.error(`[hmlr-fetch] uploaded ingest failed for ${dataset}:`, msg);
    try {
      await pool.query(
        `UPDATE hmlr_ingest_runs SET status='error', error=$1, finished_at=now() WHERE id=$2`,
        [msg, runId],
      );
    } catch { /* ignore */ }
  };

  let csvPath: string | null = null;
  try {
    // If the upload is a ZIP, extract the inner CSV first. Otherwise
    // treat the upload as a raw CSV.
    if (/\.zip$/i.test(originalFilename)) {
      const zip = new AdmZip(localPath);
      const entries = zip.getEntries();
      const csvEntry = entries.find((e) => /\.csv$/i.test(e.entryName) && !e.isDirectory);
      if (!csvEntry) throw new Error(`No CSV found inside uploaded ${originalFilename}`);
      csvPath = path.join(os.tmpdir(), `hmlr-upload-${Date.now()}-${csvEntry.entryName}`);
      zip.extractEntryTo(csvEntry, path.dirname(csvPath), false, true, false, path.basename(csvPath));
    } else {
      csvPath = localPath;
    }
    return await ingestCsvFile(csvPath, dataset, originalFilename, "uploaded", 500, runId);
  } catch (err: any) {
    await failRun(err);
    throw err;
  } finally {
    // Clean up any extracted CSV (if we unzipped). The original upload
    // is removed by the route handler after this returns.
    if (csvPath && csvPath !== localPath) {
      try { fs.unlinkSync(csvPath); } catch { /* ignore */ }
    }
  }
}
