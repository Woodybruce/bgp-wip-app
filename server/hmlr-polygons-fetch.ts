/**
 * Ingest HMLR INSPIRE Index Polygons from a local file into
 * hmlr_title_polygons — the in-app counterpart to the manual
 * scripts/ingest-hmlr-polygons.ts CLI.
 *
 * The BGP team paste a SharePoint share link to the HMLR "Use Land and
 * Property Data" INSPIRE download; the fetch route streams the file here.
 * Supported inputs (optionally inside a .zip):
 *   - .gml             — raw INSPIRE Index Polygons (EPSG:27700 / BNG)
 *   - .geojson / .json — a GeoJSON FeatureCollection (EPSG:4326)
 *   - .ndjson          — one GeoJSON Feature per line (EPSG:4326), e.g.
 *                        ogr2ogr GeoJSONSeq output
 *
 * Reprojection is done in PostGIS, NOT in JS: geometry is inserted with
 * its source SRID and ST_Transform(...) converts it to 4326 on the way in.
 * That avoids a proj4 / GDAL dependency entirely.
 *
 * INSPIRE carries NO title numbers, so title_number is left NULL — this
 * powers map boundary shading only, not title-linked official plans (the
 * paid £20k/yr National Polygon Service is the title-linked version).
 *
 * NOTE: the GML parser below is written to the standard Land Registry
 * INSPIRE Index Polygons schema (GML2 <gml:coordinates> and GML3
 * <gml:posList>, one Polygon per feature). It streams the file so memory
 * stays bounded, and logs skip reasons so a schema mismatch on a real
 * file is diagnosable from the hmlr_ingest_runs row rather than silent.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as readline from "readline";
import { pool } from "./db";
import { isHmlrPolygonsAvailable, resetHmlrAvailabilityCache } from "./hmlr-direct";

interface PolygonRow {
  inspireId: number;
  titleNumber: string | null;
  /** GeoJSON geometry string (Polygon or MultiPolygon). */
  geometryJson: string;
}

export interface InspireIngestResult {
  runId: string;
  format: "gml" | "geojson" | "ndjson";
  processed: number;
  inserted: number;
  updated: number;
  skipped: number;
}

const BATCH = 500;

// ─── Coordinate parsing ────────────────────────────────────────────────

/** GML3 <gml:posList>: "e1 n1 e2 n2 …" (whitespace-separated). */
function parsePosList(text: string): number[][] {
  const nums = text.trim().split(/\s+/).map(Number).filter((n) => Number.isFinite(n));
  if (nums.length < 6 || nums.length % 2 !== 0) return [];
  const ring: number[][] = [];
  for (let i = 0; i < nums.length; i += 2) ring.push([nums[i], nums[i + 1]]);
  return ring;
}

/** GML2 <gml:coordinates>: "e1,n1 e2,n2 …" (comma within a point). */
function parseCoordinates(text: string): number[][] {
  const ring: number[][] = [];
  for (const tuple of text.trim().split(/\s+/)) {
    const parts = tuple.split(",").map(Number);
    if (parts.length >= 2 && Number.isFinite(parts[0]) && Number.isFinite(parts[1])) {
      ring.push([parts[0], parts[1]]);
    }
  }
  return ring.length >= 3 ? ring : [];
}

/** Ensure a linear ring is explicitly closed (GeoJSON requires it). */
function closeRing(ring: number[][]): number[][] {
  if (ring.length < 3) return ring;
  const a = ring[0], b = ring[ring.length - 1];
  if (a[0] !== b[0] || a[1] !== b[1]) ring.push([a[0], a[1]]);
  return ring;
}

function ringsFrom(block: string): number[][][] {
  // posList (GML3) first, fall back to coordinates (GML2).
  const rings: number[][][] = [];
  const posList = block.match(/<gml:posList[^>]*>([\s\S]*?)<\/gml:posList>/g);
  if (posList) {
    for (const m of posList) {
      const inner = m.replace(/<gml:posList[^>]*>/, "").replace(/<\/gml:posList>/, "");
      const ring = closeRing(parsePosList(inner));
      if (ring.length >= 4) rings.push(ring);
    }
    return rings;
  }
  const coords = block.match(/<gml:coordinates[^>]*>([\s\S]*?)<\/gml:coordinates>/g);
  if (coords) {
    for (const m of coords) {
      const inner = m.replace(/<gml:coordinates[^>]*>/, "").replace(/<\/gml:coordinates>/, "");
      const ring = closeRing(parseCoordinates(inner));
      if (ring.length >= 4) rings.push(ring);
    }
  }
  return rings;
}

/**
 * Turn one GML feature block into a GeoJSON Polygon. Exterior ring =
 * first ring inside exterior/outerBoundaryIs (or just the first ring
 * found); interior rings = those inside interior/innerBoundaryIs.
 */
function featureToGeometry(block: string): { inspireId: number; geometryJson: string } | { skip: string } {
  const idMatch = block.match(/<(?:[\w.]+:)?INSPIREID>\s*(\d+)\s*<\/(?:[\w.]+:)?INSPIREID>/);
  if (!idMatch) return { skip: "missing INSPIREID" };
  const inspireId = Number(idMatch[1]);
  if (!Number.isFinite(inspireId)) return { skip: "INSPIREID not numeric" };

  const exteriorBlock = block.match(/<gml:(?:exterior|outerBoundaryIs)>([\s\S]*?)<\/gml:(?:exterior|outerBoundaryIs)>/);
  const interiorBlocks = block.match(/<gml:(?:interior|innerBoundaryIs)>([\s\S]*?)<\/gml:(?:interior|innerBoundaryIs)>/g) || [];

  let exterior: number[][] | null = null;
  if (exteriorBlock) {
    exterior = ringsFrom(exteriorBlock[1])[0] || null;
  } else {
    // No boundary wrappers — take the first ring in the whole block.
    exterior = ringsFrom(block)[0] || null;
  }
  if (!exterior) return { skip: "no exterior ring" };

  const coordinates: number[][][] = [exterior];
  for (const ib of interiorBlocks) {
    const hole = ringsFrom(ib)[0];
    if (hole) coordinates.push(hole);
  }
  return { inspireId, geometryJson: JSON.stringify({ type: "Polygon", coordinates }) };
}

// ─── DB upsert (PostGIS reprojects via ST_Transform) ───────────────────

async function flushBatch(
  batch: PolygonRow[],
  srid: number,
  region: string | null,
  runId: string,
): Promise<{ inserted: number; updated: number; failed: number }> {
  if (batch.length === 0) return { inserted: 0, updated: 0, failed: 0 };
  const sridInt = srid === 4326 ? 4326 : 27700; // whitelist — inlined safely
  const buildSql = (rows: PolygonRow[]) => {
    const values: string[] = [];
    const params: any[] = [];
    let p = 1;
    for (const r of rows) {
      values.push(`($${p++}, $${p++}, ST_Multi(ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON($${p++}), ${sridInt}), 4326)), $${p++}, $${p++})`);
      params.push(r.inspireId, r.titleNumber, r.geometryJson, region, runId);
    }
    return {
      text: `INSERT INTO hmlr_title_polygons (inspire_id, title_number, polygon, region, ingest_run_id)
             VALUES ${values.join(",")}
             ON CONFLICT (inspire_id) DO UPDATE
               SET title_number = EXCLUDED.title_number,
                   polygon = EXCLUDED.polygon,
                   region = COALESCE(EXCLUDED.region, hmlr_title_polygons.region),
                   ingest_run_id = EXCLUDED.ingest_run_id,
                   updated_at = now()
             RETURNING (xmax = 0) AS inserted`,
      params,
    };
  };

  try {
    const q = buildSql(batch);
    const r = await pool.query<{ inserted: boolean }>(q.text, q.params);
    let inserted = 0, updated = 0;
    for (const row of r.rows) (row.inserted ? inserted++ : updated++);
    return { inserted, updated, failed: 0 };
  } catch {
    // One bad geometry fails the whole multi-row insert — retry row by row
    // so the rest still load and we can count (and skip) the offenders.
    let inserted = 0, updated = 0, failed = 0;
    for (const row of batch) {
      try {
        const q = buildSql([row]);
        const r = await pool.query<{ inserted: boolean }>(q.text, q.params);
        if (r.rows[0]?.inserted) inserted++; else updated++;
      } catch {
        failed++;
      }
    }
    return { inserted, updated, failed };
  }
}

// ─── Format detection + parsing ────────────────────────────────────────

/** Extract a single geometry file from a .zip to a temp path, by extension priority. */
async function unzipToTemp(zipPath: string): Promise<string> {
  const AdmZip = (await import("adm-zip")).default;
  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries().filter((e) => !e.isDirectory);
  const byPriority = [".geojson", ".ndjson", ".json", ".gml"];
  let chosen: typeof entries[number] | undefined;
  for (const ext of byPriority) {
    chosen = entries.find((e) => e.entryName.toLowerCase().endsWith(ext));
    if (chosen) break;
  }
  if (!chosen) {
    throw new Error(`No .gml/.geojson/.ndjson/.json inside zip. Entries: ${entries.map((e) => e.entryName).slice(0, 20).join(", ") || "(empty)"}`);
  }
  const out = path.join(os.tmpdir(), `inspire-${Date.now()}-${path.basename(chosen.entryName).replace(/[^a-zA-Z0-9._-]/g, "_")}`);
  fs.writeFileSync(out, chosen.getData());
  return out;
}

function detectFormat(filePath: string): "gml" | "geojson" | "ndjson" {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".gml")) return "gml";
  if (lower.endsWith(".ndjson")) return "ndjson";
  return "geojson";
}

/** Stream a GML file, emitting feature blocks split on the member end-tag. */
async function parseGml(
  filePath: string,
  onRow: (r: PolygonRow) => Promise<void>,
  onSkip: (reason: string) => void,
): Promise<void> {
  const END_TAGS = ["</gml:featureMember>", "</gml:member>", "</member>"];
  const stream = fs.createReadStream(filePath, { encoding: "utf-8" });
  let buf = "";
  const handleBlock = async (block: string) => {
    if (!/INSPIREID/.test(block)) return; // header / non-feature chunk
    const geom = featureToGeometry(block);
    if ("skip" in geom) { onSkip(geom.skip); return; }
    await onRow({ inspireId: geom.inspireId, titleNumber: null, geometryJson: geom.geometryJson });
  };
  for await (const chunk of stream) {
    buf += chunk;
    let cut = true;
    while (cut) {
      cut = false;
      let idx = -1, tagLen = 0;
      for (const t of END_TAGS) {
        const i = buf.indexOf(t);
        if (i !== -1 && (idx === -1 || i < idx)) { idx = i; tagLen = t.length; }
      }
      if (idx !== -1) {
        const block = buf.slice(0, idx + tagLen);
        buf = buf.slice(idx + tagLen);
        await handleBlock(block);
        cut = true;
      }
    }
  }
  if (/INSPIREID/.test(buf)) await handleBlock(buf);
}

/** Parse an NDJSON (one GeoJSON Feature per line) stream. */
async function parseNdjson(
  filePath: string,
  onRow: (r: PolygonRow) => Promise<void>,
  onSkip: (reason: string) => void,
): Promise<void> {
  const rl = readline.createInterface({ input: fs.createReadStream(filePath, { encoding: "utf-8" }), crlfDelay: Infinity });
  for await (const line of rl) {
    const t = line.trim();
    if (!t) continue;
    let f: any;
    try { f = JSON.parse(t); } catch { onSkip("invalid JSON line"); continue; }
    const row = featureFromGeoJson(f);
    if ("skip" in row) onSkip(row.skip); else await onRow(row);
  }
}

function featureFromGeoJson(f: any): PolygonRow | { skip: string } {
  if (f?.type !== "Feature") return { skip: "not a Feature" };
  const props = f.properties || {};
  const inspireRaw = props.INSPIREID ?? props.inspireid ?? props.INSPIRE_ID ?? props.inspire_id;
  if (inspireRaw == null) return { skip: "missing INSPIREID" };
  const inspireId = Number(inspireRaw);
  if (!Number.isFinite(inspireId)) return { skip: "INSPIREID not numeric" };
  const geom = f.geometry;
  if (!geom || (geom.type !== "Polygon" && geom.type !== "MultiPolygon")) {
    return { skip: `geometry not Polygon/MultiPolygon (${geom?.type})` };
  }
  const titleRaw = props.TITLE_NO ?? props.title_no ?? props.TITLE_NUMBER ?? props.title_number;
  const titleNumber = (titleRaw == null || String(titleRaw).trim() === "") ? null : String(titleRaw).trim();
  return { inspireId, titleNumber, geometryJson: JSON.stringify(geom) };
}

// ─── Orchestration ─────────────────────────────────────────────────────

/**
 * Ingest one INSPIRE polygon file (.zip/.gml/.geojson/.ndjson) into
 * hmlr_title_polygons. Tracks progress in hmlr_ingest_runs (dataset
 * 'inspire'). GML is treated as EPSG:27700 and reprojected by PostGIS;
 * GeoJSON/NDJSON is treated as EPSG:4326.
 */
export async function ingestInspirePolygonsFile(
  filePath: string,
  opts: { region?: string | null; sourceFilename?: string } = {},
): Promise<InspireIngestResult> {
  const region = opts.region ?? null;
  const sourceFilename = opts.sourceFilename ?? path.basename(filePath);

  const runRes = await pool.query<{ id: string }>(
    `INSERT INTO hmlr_ingest_runs (dataset, source_filename, status) VALUES ('inspire', $1, 'running') RETURNING id`,
    [sourceFilename],
  );
  const runId = runRes.rows[0].id;

  const tmpFiles: string[] = [];
  let processed = 0, inserted = 0, updated = 0, skipped = 0;
  const skipReasons: Record<string, number> = {};
  const note = (reason: string) => { skipped++; skipReasons[reason] = (skipReasons[reason] || 0) + 1; };

  try {
    // The table only exists once the PostGIS-guarded boot migration ran.
    if (!(await isHmlrPolygonsAvailable())) {
      resetHmlrAvailabilityCache();
      if (!(await isHmlrPolygonsAvailable())) {
        throw new Error("hmlr_title_polygons table not found — PostGIS may not be enabled on this database, or the app hasn't redeployed since the table was added. Check boot logs for '[auto-migrate] skipped (…postgis…)'.");
      }
    }

    let dataPath = filePath;
    if (filePath.toLowerCase().endsWith(".zip")) {
      dataPath = await unzipToTemp(filePath);
      tmpFiles.push(dataPath);
    }
    const format = detectFormat(dataPath);
    const srid = format === "gml" ? 27700 : 4326;

    let batch: PolygonRow[] = [];
    const onRow = async (r: PolygonRow) => {
      processed++;
      batch.push(r);
      if (batch.length >= BATCH) {
        const f = await flushBatch(batch, srid, region, runId);
        inserted += f.inserted; updated += f.updated; skipped += f.failed;
        if (f.failed) skipReasons["geometry rejected by PostGIS"] = (skipReasons["geometry rejected by PostGIS"] || 0) + f.failed;
        batch = [];
        if (processed % 10_000 === 0) {
          await pool.query(
            `UPDATE hmlr_ingest_runs SET rows_processed=$1, rows_inserted=$2, rows_updated=$3, rows_skipped=$4 WHERE id=$5`,
            [processed, inserted, updated, skipped, runId],
          );
          console.log(`[inspire-ingest] processed=${processed} inserted=${inserted} updated=${updated} skipped=${skipped}`);
        }
      }
    };

    if (format === "gml") await parseGml(dataPath, onRow, note);
    else if (format === "ndjson") await parseNdjson(dataPath, onRow, note);
    else {
      // Single GeoJSON FeatureCollection — parsed whole (memory note: fine
      // for per-LA extracts; convert huge files to NDJSON upstream).
      const fc = JSON.parse(fs.readFileSync(dataPath, "utf-8"));
      for (const f of fc?.features || []) {
        const row = featureFromGeoJson(f);
        if ("skip" in row) note(row.skip); else await onRow(row);
      }
    }

    if (batch.length > 0) {
      const f = await flushBatch(batch, srid, region, runId);
      inserted += f.inserted; updated += f.updated; skipped += f.failed;
    }

    const notes = Object.entries(skipReasons).map(([k, v]) => `${v}×${k}`).join("; ") || null;
    await pool.query(
      `UPDATE hmlr_ingest_runs SET status='ok', rows_processed=$1, rows_inserted=$2, rows_updated=$3, rows_skipped=$4, notes=$5, finished_at=now() WHERE id=$6`,
      [processed, inserted, updated, skipped, notes, runId],
    );
    resetHmlrAvailabilityCache(); // table now has rows — let the map see them
    console.log(`[inspire-ingest] DONE ${sourceFilename} (${format}) — processed=${processed} inserted=${inserted} updated=${updated} skipped=${skipped}${notes ? ` [${notes}]` : ""}`);
    return { runId, format, processed, inserted, updated, skipped };
  } catch (err: any) {
    await pool.query(
      `UPDATE hmlr_ingest_runs SET status='error', error=$1, rows_processed=$2, rows_inserted=$3, rows_updated=$4, rows_skipped=$5, finished_at=now() WHERE id=$6`,
      [err?.message || String(err), processed, inserted, updated, skipped, runId],
    ).catch(() => {});
    console.error(`[inspire-ingest] FAILED ${sourceFilename}:`, err?.message);
    throw err;
  } finally {
    for (const t of tmpFiles) { try { fs.unlinkSync(t); } catch { /* ignore */ } }
  }
}
