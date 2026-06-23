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
 * POSTGIS-FREE: this database has no PostGIS, so we DON'T use geometry
 * types. Boundaries are stored as GeoJSON in a jsonb column (already in
 * WGS84 / EPSG:4326) plus a min/max lng/lat bounding box for fast viewport
 * queries. GML coordinates are British National Grid (EPSG:27700) and are
 * reprojected to 4326 in JS with proj4 at ingest time. ~metre accuracy,
 * invisible at map-shading zoom.
 *
 * INSPIRE carries NO title numbers, so title_number is left NULL — this
 * powers map boundary shading only, not title-linked official plans (the
 * paid £20k/yr National Polygon Service is the title-linked version).
 *
 * NOTE: the GML parser is written to the standard Land Registry INSPIRE
 * Index Polygons schema (GML2 <gml:coordinates> and GML3 <gml:posList>,
 * one Polygon per feature). It streams the file so memory stays bounded,
 * and logs skip reasons so a schema mismatch on a real file is diagnosable
 * from the hmlr_ingest_runs row rather than silent.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as readline from "readline";
import proj4 from "proj4";
import { pool } from "./db";
import { isHmlrPolygonsAvailable, resetHmlrAvailabilityCache } from "./hmlr-direct";

// British National Grid (EPSG:27700) → WGS84. The +towgs84 Helmert params
// are the Ordnance Survey published values (~metre accuracy without the
// OSTN15 grid — ample for map shading).
proj4.defs(
  "EPSG:27700",
  "+proj=tmerc +lat_0=49 +lon_0=-2 +k=0.9996012717 +x_0=400000 +y_0=-100000 +ellps=airy +towgs84=446.448,-125.157,542.06,0.1502,0.247,0.8421,-20.4894 +units=m +no_defs",
);
function toWgs84(easting: number, northing: number): [number, number] {
  const [lng, lat] = proj4("EPSG:27700", "WGS84", [easting, northing]) as [number, number];
  return [lng, lat];
}

interface PolygonRow {
  inspireId: number;
  titleNumber: string | null;
  geometry: any;                                   // GeoJSON Polygon/MultiPolygon, EPSG:4326
  bbox: [number, number, number, number];          // [minLng, minLat, maxLng, maxLat]
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
 * Turn one GML feature block into a GeoJSON Polygon in SOURCE coords
 * (reprojection happens later). Exterior = first ring inside
 * exterior/outerBoundaryIs (or the first ring found); interior rings =
 * those inside interior/innerBoundaryIs.
 */
function featureToGeometry(block: string): { inspireId: number; geometry: any } | { skip: string } {
  const idMatch = block.match(/<(?:[\w.]+:)?INSPIREID>\s*(\d+)\s*<\/(?:[\w.]+:)?INSPIREID>/);
  if (!idMatch) return { skip: "missing INSPIREID" };
  const inspireId = Number(idMatch[1]);
  if (!Number.isFinite(inspireId)) return { skip: "INSPIREID not numeric" };

  const exteriorBlock = block.match(/<gml:(?:exterior|outerBoundaryIs)>([\s\S]*?)<\/gml:(?:exterior|outerBoundaryIs)>/);
  const interiorBlocks = block.match(/<gml:(?:interior|innerBoundaryIs)>([\s\S]*?)<\/gml:(?:interior|innerBoundaryIs)>/g) || [];

  const exterior = exteriorBlock ? (ringsFrom(exteriorBlock[1])[0] || null) : (ringsFrom(block)[0] || null);
  if (!exterior) return { skip: "no exterior ring" };

  const coordinates: number[][][] = [exterior];
  for (const ib of interiorBlocks) {
    const hole = ringsFrom(ib)[0];
    if (hole) coordinates.push(hole);
  }
  return { inspireId, geometry: { type: "Polygon", coordinates } };
}

function featureFromGeoJson(f: any): { inspireId: number; titleNumber: string | null; geometry: any } | { skip: string } {
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
  return { inspireId, titleNumber, geometry: geom };
}

// ─── Reprojection + bounding box ───────────────────────────────────────

function reprojectGeometry(geom: any, srid: number): any {
  if (srid === 4326) return geom;
  const fn = (c: number[]) => toWgs84(c[0], c[1]);
  if (geom.type === "Polygon") {
    return { type: "Polygon", coordinates: geom.coordinates.map((ring: number[][]) => ring.map(fn)) };
  }
  if (geom.type === "MultiPolygon") {
    return { type: "MultiPolygon", coordinates: geom.coordinates.map((poly: number[][][]) => poly.map((ring: number[][]) => ring.map(fn))) };
  }
  return geom;
}

function computeBbox(geom: any): [number, number, number, number] | null {
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  const rings: number[][][] = geom.type === "Polygon" ? geom.coordinates
    : geom.type === "MultiPolygon" ? geom.coordinates.flat()
    : [];
  for (const ring of rings) {
    for (const c of ring) {
      const lng = c[0], lat = c[1];
      if (lng < minLng) minLng = lng;
      if (lat < minLat) minLat = lat;
      if (lng > maxLng) maxLng = lng;
      if (lat > maxLat) maxLat = lat;
    }
  }
  if (!Number.isFinite(minLng) || !Number.isFinite(minLat)) return null;
  return [minLng, minLat, maxLng, maxLat];
}

// ─── DB ─────────────────────────────────────────────────────────────────

/** Create the table + indexes if missing — keeps the ingest self-sufficient
 *  regardless of whether the boot migration has run on this deploy. No
 *  PostGIS: geometry lives in a jsonb column + numeric bbox. */
async function ensurePolygonTable(): Promise<void> {
  await pool.query(`CREATE TABLE IF NOT EXISTS hmlr_title_polygons (
    inspire_id    BIGINT PRIMARY KEY,
    title_number  TEXT,
    geojson       JSONB NOT NULL,
    min_lng       DOUBLE PRECISION NOT NULL,
    min_lat       DOUBLE PRECISION NOT NULL,
    max_lng       DOUBLE PRECISION NOT NULL,
    max_lat       DOUBLE PRECISION NOT NULL,
    region        TEXT,
    ingest_run_id UUID,
    inserted_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS hmlr_title_polygons_bbox_lng_idx ON hmlr_title_polygons (min_lng, max_lng)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS hmlr_title_polygons_bbox_lat_idx ON hmlr_title_polygons (min_lat, max_lat)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS hmlr_title_polygons_title_idx ON hmlr_title_polygons (title_number) WHERE title_number IS NOT NULL`);
  await pool.query(`CREATE INDEX IF NOT EXISTS hmlr_title_polygons_region_idx ON hmlr_title_polygons (region)`);
}

async function flushBatch(
  batch: PolygonRow[],
  region: string | null,
  runId: string,
): Promise<{ inserted: number; updated: number; failed: number }> {
  if (batch.length === 0) return { inserted: 0, updated: 0, failed: 0 };
  const buildSql = (rows: PolygonRow[]) => {
    const values: string[] = [];
    const params: any[] = [];
    let p = 1;
    for (const r of rows) {
      values.push(`($${p++}, $${p++}, $${p++}::jsonb, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++})`);
      params.push(r.inspireId, r.titleNumber, JSON.stringify(r.geometry), r.bbox[0], r.bbox[1], r.bbox[2], r.bbox[3], region, runId);
    }
    return {
      text: `INSERT INTO hmlr_title_polygons (inspire_id, title_number, geojson, min_lng, min_lat, max_lng, max_lat, region, ingest_run_id)
             VALUES ${values.join(",")}
             ON CONFLICT (inspire_id) DO UPDATE
               SET title_number = EXCLUDED.title_number,
                   geojson = EXCLUDED.geojson,
                   min_lng = EXCLUDED.min_lng, min_lat = EXCLUDED.min_lat,
                   max_lng = EXCLUDED.max_lng, max_lat = EXCLUDED.max_lat,
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
    // Retry row by row so one bad row can't sink the whole batch.
    let inserted = 0, updated = 0, failed = 0;
    for (const row of batch) {
      try {
        const q = buildSql([row]);
        const r = await pool.query<{ inserted: boolean }>(q.text, q.params);
        if (r.rows[0]?.inserted) inserted++; else updated++;
      } catch { failed++; }
    }
    return { inserted, updated, failed };
  }
}

// ─── Streaming parsers ─────────────────────────────────────────────────

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
  onFeature: (inspireId: number, geometrySource: any) => Promise<void>,
  onSkip: (reason: string) => void,
): Promise<void> {
  const END_TAGS = ["</gml:featureMember>", "</gml:member>", "</member>"];
  const stream = fs.createReadStream(filePath, { encoding: "utf-8" });
  let buf = "";
  const handleBlock = async (block: string) => {
    if (!/INSPIREID/.test(block)) return; // header / non-feature chunk
    const geom = featureToGeometry(block);
    if ("skip" in geom) { onSkip(geom.skip); return; }
    await onFeature(geom.inspireId, geom.geometry);
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

// ─── Orchestration ─────────────────────────────────────────────────────

/**
 * Ingest one INSPIRE polygon file (.zip/.gml/.geojson/.ndjson) into
 * hmlr_title_polygons. Tracks progress in hmlr_ingest_runs (dataset
 * 'inspire'). GML is treated as EPSG:27700 and reprojected to 4326 in JS;
 * GeoJSON/NDJSON is treated as already 4326.
 */
export async function ingestInspirePolygonsFile(
  filePath: string,
  opts: { region?: string | null; sourceFilename?: string; runId?: string } = {},
): Promise<InspireIngestResult> {
  const region = opts.region ?? null;
  const sourceFilename = opts.sourceFilename ?? path.basename(filePath);

  await ensurePolygonTable();

  // Reuse a run row reserved by the caller (the fetch route reserves it
  // before downloading, so download/size failures are visible too);
  // otherwise create one here.
  let runId = opts.runId;
  if (!runId) {
    const runRes = await pool.query<{ id: string }>(
      `INSERT INTO hmlr_ingest_runs (dataset, source_filename, status) VALUES ('inspire', $1, 'running') RETURNING id`,
      [sourceFilename],
    );
    runId = runRes.rows[0].id;
  }

  const tmpFiles: string[] = [];
  let processed = 0, inserted = 0, updated = 0, skipped = 0;
  const skipReasons: Record<string, number> = {};
  const note = (reason: string) => { skipped++; skipReasons[reason] = (skipReasons[reason] || 0) + 1; };

  try {
    let dataPath = filePath;
    if (filePath.toLowerCase().endsWith(".zip")) {
      dataPath = await unzipToTemp(filePath);
      tmpFiles.push(dataPath);
    }
    const format = detectFormat(dataPath);
    const srid = format === "gml" ? 27700 : 4326;

    let batch: PolygonRow[] = [];
    const flush = async () => {
      if (batch.length === 0) return;
      const f = await flushBatch(batch, region, runId);
      inserted += f.inserted; updated += f.updated; skipped += f.failed;
      if (f.failed) skipReasons["geometry rejected"] = (skipReasons["geometry rejected"] || 0) + f.failed;
      batch = [];
    };
    const handle = async (inspireId: number, titleNumber: string | null, geometrySource: any) => {
      processed++;
      const geometry = reprojectGeometry(geometrySource, srid);
      const bbox = computeBbox(geometry);
      if (!bbox) { note("empty/invalid geometry"); return; }
      batch.push({ inspireId, titleNumber, geometry, bbox });
      if (batch.length >= BATCH) {
        await flush();
        if (processed % 10_000 === 0) {
          await pool.query(
            `UPDATE hmlr_ingest_runs SET rows_processed=$1, rows_inserted=$2, rows_updated=$3, rows_skipped=$4 WHERE id=$5`,
            [processed, inserted, updated, skipped, runId],
          );
          console.log(`[inspire-ingest] processed=${processed} inserted=${inserted} updated=${updated} skipped=${skipped}`);
        }
      }
    };

    if (format === "gml") {
      await parseGml(dataPath, (id, geom) => handle(id, null, geom), note);
    } else if (format === "ndjson") {
      const rl = readline.createInterface({ input: fs.createReadStream(dataPath, { encoding: "utf-8" }), crlfDelay: Infinity });
      for await (const line of rl) {
        const t = line.trim();
        if (!t) continue;
        let f: any;
        try { f = JSON.parse(t); } catch { note("invalid JSON line"); continue; }
        const row = featureFromGeoJson(f);
        if ("skip" in row) note(row.skip); else await handle(row.inspireId, row.titleNumber, row.geometry);
      }
    } else {
      const fc = JSON.parse(fs.readFileSync(dataPath, "utf-8"));
      for (const f of fc?.features || []) {
        const row = featureFromGeoJson(f);
        if ("skip" in row) note(row.skip); else await handle(row.inspireId, row.titleNumber, row.geometry);
      }
    }
    await flush();

    const notes = Object.entries(skipReasons).map(([k, v]) => `${v}×${k}`).join("; ") || null;
    await pool.query(
      `UPDATE hmlr_ingest_runs SET status='ok', rows_processed=$1, rows_inserted=$2, rows_updated=$3, rows_skipped=$4, notes=$5, finished_at=now() WHERE id=$6`,
      [processed, inserted, updated, skipped, notes, runId],
    );
    resetHmlrAvailabilityCache();
    void isHmlrPolygonsAvailable();
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
