/**
 * Ingest HMLR INSPIRE Index Polygons (free) or National Polygon Service
 * (paid, £20k/yr) into Postgres.
 *
 * IMPORTANT: free INSPIRE polygons do NOT include title_number — only the
 * paid NPS dataset links polygons to titles. So this ingest writes
 * polygons with title_number=NULL when fed INSPIRE, and populated when
 * fed NPS-derived data. Ownership lookups in v1 use CCOD/OCOD address
 * text-matching instead — see scripts/ingest-hmlr-proprietors.ts.
 *
 * Polygons here are useful for map visualisation only, until/unless we
 * pay for NPS.
 *
 * Input format: NDJSON (one GeoJSON feature per line). Convert from
 * source GML/GeoJSON like:
 *
 *   jq -c '.features[]' Land_Registry_Cadastral_Parcels.geojson > polygons.ndjson
 *   ogr2ogr -f GeoJSONSeq polygons.ndjson Land_Registry_Cadastral_Parcels.gml
 *
 * Each feature must have at minimum:
 *   properties.INSPIREID  (numeric INSPIRE polygon ID)
 *   properties.TITLE_NO   (HMLR title number — OPTIONAL, NPS only)
 *   geometry              (Polygon or MultiPolygon, EPSG:4326 / WGS84)
 *
 * Run:
 *   npx tsx scripts/ingest-hmlr-polygons.ts <ndjson-file> [--region <name>]
 */

import * as fs from "fs";
import * as readline from "readline";
import { pool } from "../server/db";

interface CliArgs {
  file: string;
  region: string | null;
  batch: number;
  dry: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { file: "", region: null, batch: 500, dry: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--region") args.region = argv[++i];
    else if (a === "--batch") args.batch = parseInt(argv[++i], 10) || 500;
    else if (a === "--dry") args.dry = true;
    else if (!args.file) args.file = a;
  }
  if (!args.file) {
    console.error("Usage: tsx scripts/ingest-hmlr-polygons.ts <ndjson-file> [--region <name>] [--batch <n>] [--dry]");
    process.exit(2);
  }
  if (!fs.existsSync(args.file)) {
    console.error(`File not found: ${args.file}`);
    process.exit(2);
  }
  return args;
}

interface FeatureRow {
  inspireId: number;
  titleNumber: string | null;
  geometryJson: string;
}

function parseFeature(line: string): FeatureRow | { skip: string } {
  let f: any;
  try { f = JSON.parse(line); } catch { return { skip: "invalid JSON" }; }
  if (f?.type !== "Feature") return { skip: "not a Feature" };
  const props = f.properties || {};
  const inspireRaw = props.INSPIREID ?? props.inspireid ?? props.INSPIRE_ID ?? props.inspire_id;
  const titleRaw = props.TITLE_NO ?? props.title_no ?? props.TITLE_NUMBER ?? props.title_number;
  if (inspireRaw == null) return { skip: "missing INSPIREID" };
  const inspireId = Number(inspireRaw);
  if (!Number.isFinite(inspireId)) return { skip: "INSPIREID not numeric" };
  const geom = f.geometry;
  if (!geom || (geom.type !== "Polygon" && geom.type !== "MultiPolygon")) {
    return { skip: `geometry not Polygon/MultiPolygon (${geom?.type})` };
  }
  const geometryJson = geom.type === "MultiPolygon"
    ? JSON.stringify(geom)
    : JSON.stringify({ type: "MultiPolygon", coordinates: [geom.coordinates] });
  // title_number is optional — populated only when ingest source is NPS,
  // null for free INSPIRE polygons.
  const titleNumber = (titleRaw == null || String(titleRaw).trim() === "") ? null : String(titleRaw).trim();
  return { inspireId, titleNumber, geometryJson };
}

async function startRun(file: string): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO hmlr_ingest_runs (dataset, source_filename, status)
     VALUES ('inspire', $1, 'running')
     RETURNING id`,
    [file],
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

async function flushBatch(batch: FeatureRow[], region: string | null, runId: string): Promise<{ inserted: number; updated: number }> {
  if (batch.length === 0) return { inserted: 0, updated: 0 };
  // Build a multi-row insert using ST_GeomFromGeoJSON for each polygon. We
  // upsert on inspire_id so re-running with a fresher file just overwrites.
  const values: string[] = [];
  const params: any[] = [];
  let p = 1;
  for (const r of batch) {
    values.push(`($${p++}, $${p++}, ST_Multi(ST_GeomFromGeoJSON($${p++})), $${p++}, $${p++})`);
    params.push(r.inspireId, r.titleNumber, r.geometryJson, region, runId);
  }
  const sql = `
    INSERT INTO hmlr_title_polygons (inspire_id, title_number, polygon, region, ingest_run_id)
    VALUES ${values.join(",")}
    ON CONFLICT (inspire_id) DO UPDATE
      SET title_number = EXCLUDED.title_number,
          polygon = EXCLUDED.polygon,
          region = COALESCE(EXCLUDED.region, hmlr_title_polygons.region),
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
  console.log(`[ingest-hmlr-polygons] file=${args.file} region=${args.region || "(none)"} batch=${args.batch} dry=${args.dry}`);

  const runId = args.dry ? "00000000-0000-0000-0000-000000000000" : await startRun(args.file);
  let processed = 0, inserted = 0, updated = 0, skipped = 0;
  const skipReasons: Record<string, number> = {};

  const stream = fs.createReadStream(args.file, { encoding: "utf-8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let batch: FeatureRow[] = [];
  let lineNo = 0;

  try {
    for await (const line of rl) {
      lineNo++;
      const trimmed = line.trim();
      if (!trimmed) continue;
      processed++;
      const r = parseFeature(trimmed);
      if ("skip" in r) {
        skipped++;
        skipReasons[r.skip] = (skipReasons[r.skip] || 0) + 1;
        continue;
      }
      batch.push(r);
      if (batch.length >= args.batch) {
        if (!args.dry) {
          const f = await flushBatch(batch, args.region, runId);
          inserted += f.inserted;
          updated += f.updated;
        }
        batch = [];
        if (processed % 10_000 === 0) {
          console.log(`[ingest-hmlr-polygons] processed=${processed} inserted=${inserted} updated=${updated} skipped=${skipped}`);
        }
      }
    }
    if (batch.length > 0 && !args.dry) {
      const f = await flushBatch(batch, args.region, runId);
      inserted += f.inserted;
      updated += f.updated;
    }
    if (!args.dry) await finishRun(runId, "ok", { processed, inserted, updated, skipped });
    console.log(`[ingest-hmlr-polygons] DONE — processed=${processed} inserted=${inserted} updated=${updated} skipped=${skipped}`);
    if (skipped > 0) {
      console.log("[ingest-hmlr-polygons] skip reasons:");
      for (const [k, v] of Object.entries(skipReasons)) console.log(`  ${v} × ${k}`);
    }
  } catch (err: any) {
    console.error("[ingest-hmlr-polygons] FAILED:", err?.message);
    if (!args.dry) await finishRun(runId, "error", { processed, inserted, updated, skipped }, err?.message || String(err));
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
