/**
 * Build a local SQLite snapshot of the VOA rating list.
 *
 * Usage:
 *   tsx scripts/build-voa-sqlite.ts                          # 2023 list, London + home counties
 *   tsx scripts/build-voa-sqlite.ts --year 2023
 *   tsx scripts/build-voa-sqlite.ts --year 2026
 *   tsx scripts/build-voa-sqlite.ts --areas EC,WC,W,SW       # filter to specific postcode areas
 *   tsx scripts/build-voa-sqlite.ts --all                    # no postcode filter (entire England+Wales)
 *   tsx scripts/build-voa-sqlite.ts --out data/voa-2023.sqlite
 *
 * Output: a single `.sqlite` file ready to drop onto Railway (or into any
 * /data mount). The server reads it via server/voa-sqlite.ts.
 *
 * This script is intended to run on a developer laptop (plenty of RAM, no
 * memory constraint) and takes ~3-5 minutes end to end:
 *   1. Download VOA ZIP (~450 MB) from the public Azure blob store
 *   2. Stream the CSV out of the ZIP line by line
 *   3. Insert into SQLite with prepared statements + WAL mode
 *   4. Build indexes on postcode, ba_code, uarn, description_code
 *
 * The output file stays in repo-local /data which is gitignored.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import Database from "better-sqlite3";

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const DOWNLOAD_URLS: Record<string, string> = {
  "2023": "https://voaratinglists.blob.core.windows.net/downloads/uk-englandwales-ndr-2023-listentries-compiled-epoch-0019-baseline-csv.zip",
  "2026": "https://voaratinglists.blob.core.windows.net/downloads/uk-englandwales-ndr-2026-draft-listentries-epoch-0002-baseline-csv.zip",
};

const LONDON_AND_HOME_COUNTIES_POSTCODE_AREAS = [
  "EC", "WC", "NW", "SE", "SW", "W", "N", "E",
  "BR", "CR", "DA", "EN", "HA", "IG", "KT", "RM", "SM", "TW", "UB",
  "AL", "CB", "CM", "CO", "CT", "GU", "HP", "LU", "ME", "MK", "OX",
  "PO", "RG", "RH", "SG", "SL", "SO", "SS", "TN", "WD", "BN",
];

function parseArgs(): { year: string; areas: string[] | null; out: string } {
  const args = process.argv.slice(2);
  let year = "2023";
  let areas: string[] | null = LONDON_AND_HOME_COUNTIES_POSTCODE_AREAS;
  let out: string | null = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--year") year = args[++i];
    else if (a === "--areas") areas = args[++i].split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
    else if (a === "--all") areas = null;
    else if (a === "--out") out = args[++i];
    else if (a === "--help" || a === "-h") {
      console.log("Usage: tsx scripts/build-voa-sqlite.ts [--year 2023|2026] [--areas EC,WC,...] [--all] [--out data/voa.sqlite]");
      process.exit(0);
    }
  }
  return { year, areas, out: out || `data/voa-${year}.sqlite` };
}

function postcodeMatchesAreas(postcode: string, areas: string[]): boolean {
  if (!postcode) return false;
  const pc = postcode.toUpperCase().replace(/\s+/g, "");
  const sorted = [...areas].sort((a, b) => b.length - a.length);
  for (const a of sorted) {
    if (pc.startsWith(a)) {
      const next = pc[a.length];
      if (next && next >= "0" && next <= "9") return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// CSV parsing — 22-field star-delimited VOA line, same shape as server/voa.ts
// ---------------------------------------------------------------------------

interface VoaRow {
  uarn: string;
  baCode: string;
  baRef: string;
  scatCode: string;
  descriptionCode: string;
  descriptionText: string;
  firmName: string;
  numberOrName: string;
  street: string;
  town: string;
  locality: string;
  county: string;
  postcode: string;
  effectiveDate: string;
  rateableValue: number | null;
  listAlterationDate: string;
  compositeBillingAuthority: string;
}

function parseVoaLine(line: string): VoaRow | null {
  const fields = line.split("*");
  if (fields.length < 22) return null;
  const baCode = fields[1]?.trim();
  const uarn = fields[6]?.trim();
  if (!uarn || !baCode) return null;
  const rv = fields[17]?.trim();
  return {
    uarn,
    baCode,
    baRef: fields[3]?.trim() || "",
    scatCode: fields[2]?.trim() || "",
    descriptionCode: fields[4]?.trim() || "",
    descriptionText: fields[5]?.trim() || "",
    firmName: fields[7]?.trim() || "",
    numberOrName: fields[9]?.trim() || "",
    street: fields[10]?.trim() || "",
    town: fields[11]?.trim() || "",
    locality: fields[12]?.trim() || "",
    county: fields[13]?.trim() || "",
    postcode: fields[14]?.trim() || "",
    effectiveDate: fields[15]?.trim() || "",
    rateableValue: rv ? parseInt(rv, 10) || null : null,
    listAlterationDate: fields[20]?.trim() || "",
    compositeBillingAuthority: fields[21]?.trim() || "",
  };
}

// ---------------------------------------------------------------------------
// Download
// ---------------------------------------------------------------------------

async function downloadZip(year: string): Promise<string> {
  const url = DOWNLOAD_URLS[year];
  if (!url) throw new Error(`No download URL for year ${year}`);
  const tmpDir = path.join(process.cwd(), ".voa-cache");
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  const zipPath = path.join(tmpDir, `voa-${year}.zip`);
  const MIN_MB = 400;
  if (fs.existsSync(zipPath) && fs.statSync(zipPath).size >= MIN_MB * 1024 * 1024) {
    console.log(`[build] Using cached ZIP at ${zipPath} (${(fs.statSync(zipPath).size / 1024 / 1024).toFixed(1)} MB)`);
    return zipPath;
  }
  console.log(`[build] Downloading ${year} list from ${url}...`);
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Download failed: ${resp.status} ${resp.statusText}`);
  if (!resp.body) throw new Error("No response body");
  const declaredLen = Number(resp.headers.get("content-length") || 0);
  await pipeline(Readable.fromWeb(resp.body as any), fs.createWriteStream(zipPath));
  const size = fs.statSync(zipPath).size;
  if (declaredLen > 0 && size !== declaredLen) {
    fs.unlinkSync(zipPath);
    throw new Error(`Download truncated — got ${size}, expected ${declaredLen}`);
  }
  console.log(`[build] Downloaded ${(size / 1024 / 1024).toFixed(1)} MB → ${zipPath}`);
  return zipPath;
}

// ---------------------------------------------------------------------------
// SQLite write
// ---------------------------------------------------------------------------

function openDb(outPath: string): Database.Database {
  const dir = path.dirname(outPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (fs.existsSync(outPath)) {
    console.log(`[build] Removing existing ${outPath}`);
    fs.unlinkSync(outPath);
  }
  const db = new Database(outPath);
  // Journal mode + sync off for bulk load — we rebuild from scratch each time
  db.pragma("journal_mode = OFF");
  db.pragma("synchronous = OFF");
  db.pragma("temp_store = MEMORY");
  db.pragma("cache_size = -200000"); // 200 MB page cache
  db.exec(`
    CREATE TABLE voa_ratings (
      uarn TEXT NOT NULL,
      ba_code TEXT NOT NULL,
      ba_ref TEXT,
      scat_code TEXT,
      description_code TEXT,
      description_text TEXT,
      firm_name TEXT,
      number_or_name TEXT,
      street TEXT,
      town TEXT,
      locality TEXT,
      county TEXT,
      postcode TEXT,
      postcode_norm TEXT,
      effective_date TEXT,
      rateable_value INTEGER,
      list_alteration_date TEXT,
      composite_billing_authority TEXT,
      list_year TEXT
    );
    CREATE TABLE meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);
  return db;
}

function buildIndexes(db: Database.Database) {
  console.log("[build] Building indexes...");
  const t0 = Date.now();
  db.exec(`
    CREATE INDEX idx_voa_postcode_norm ON voa_ratings(postcode_norm);
    CREATE INDEX idx_voa_ba_code ON voa_ratings(ba_code, list_year);
    CREATE INDEX idx_voa_uarn ON voa_ratings(uarn);
    CREATE INDEX idx_voa_description_code ON voa_ratings(description_code);
  `);
  console.log(`[build] Indexes built in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

function normalisePostcode(pc: string | null | undefined): string {
  if (!pc) return "";
  return String(pc).toUpperCase().replace(/\s+/g, "");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const { year, areas, out } = parseArgs();
  console.log(`[build] Target: VOA ${year} list → ${out}`);
  console.log(`[build] Filter: ${areas ? `postcode areas ${areas.join(",")}` : "ALL England+Wales"}`);

  const zipPath = await downloadZip(year);

  // @ts-ignore - unzipper has no types
  const unzipper = (await import("unzipper")).default || (await import("unzipper"));
  const directory: any = await unzipper.Open.file(zipPath);
  const csvEntry: any = directory.files.find((f: any) =>
    !f.type?.includes("Directory") && /\.csv$/i.test(f.path) && /baseline|listentries|compiled/i.test(f.path)
  );
  if (!csvEntry) {
    const names = directory.files.slice(0, 20).map((f: any) => f.path).join(", ");
    throw new Error(`No CSV file found in ZIP. Contents: ${names}`);
  }
  console.log(`[build] Streaming ${csvEntry.path}`);

  const db = openDb(out);
  const insert = db.prepare(`
    INSERT INTO voa_ratings
      (uarn, ba_code, ba_ref, scat_code, description_code, description_text,
       firm_name, number_or_name, street, town, locality, county,
       postcode, postcode_norm, effective_date, rateable_value,
       list_alteration_date, composite_billing_authority, list_year)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertMany = db.transaction((rows: VoaRow[]) => {
    for (const r of rows) {
      insert.run(
        r.uarn, r.baCode, r.baRef, r.scatCode,
        r.descriptionCode, r.descriptionText,
        r.firmName, r.numberOrName, r.street, r.town,
        r.locality, r.county,
        r.postcode, normalisePostcode(r.postcode),
        r.effectiveDate, r.rateableValue,
        r.listAlterationDate, r.compositeBillingAuthority,
        year
      );
    }
  });

  const csvStream = csvEntry.stream();
  csvStream.setEncoding("utf-8");
  const rl = createInterface({ input: csvStream, crlfDelay: Infinity });

  const BATCH = 5000;
  let batch: VoaRow[] = [];
  let imported = 0;
  let skipped = 0;
  let read = 0;
  const t0 = Date.now();

  for await (const line of rl) {
    read++;
    if (!line.trim()) continue;
    const parsed = parseVoaLine(line);
    if (!parsed) { skipped++; continue; }
    if (areas && !postcodeMatchesAreas(parsed.postcode, areas)) { skipped++; continue; }
    batch.push(parsed);
    if (batch.length >= BATCH) {
      insertMany(batch);
      imported += batch.length;
      batch = [];
      if (imported % 50000 === 0) {
        const mps = Math.round(read / ((Date.now() - t0) / 1000));
        console.log(`[build] ${imported.toLocaleString()} imported (${read.toLocaleString()} read, ${mps.toLocaleString()} lines/s)`);
      }
    }
  }
  if (batch.length > 0) {
    insertMany(batch);
    imported += batch.length;
  }

  // Meta + indexes + vacuum
  const setMeta = db.prepare(`INSERT INTO meta (key, value) VALUES (?, ?)`);
  setMeta.run("list_year", year);
  setMeta.run("built_at", new Date().toISOString());
  setMeta.run("areas", areas ? areas.join(",") : "ALL");
  setMeta.run("row_count", String(imported));

  buildIndexes(db);

  console.log("[build] Running ANALYZE + VACUUM...");
  db.exec("ANALYZE;");
  db.exec("VACUUM;");
  db.close();

  const finalSize = fs.statSync(out).size;
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log("");
  console.log(`[build] DONE in ${elapsed}s`);
  console.log(`[build] Imported: ${imported.toLocaleString()} rows`);
  console.log(`[build] Skipped:  ${skipped.toLocaleString()} rows`);
  console.log(`[build] Output:   ${out} (${(finalSize / 1024 / 1024).toFixed(1)} MB)`);
  console.log("");
  console.log("Next: upload to Railway volume at /data/voa.sqlite, or set VOA_SQLITE_PATH to the file location.");
}

main().catch((err) => {
  console.error("[build] FAILED:", err?.stack || err?.message || err);
  process.exit(1);
});
