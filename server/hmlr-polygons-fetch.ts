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
 *   - .ndjson          — one GeoJSON Feature per line (EPSG:4326)
 *
 * STREAMING: zips are read with `unzipper` (random-access on the central
 * directory) and each data entry is piped straight into a streaming parser
 * — so a multi-GB national zip never gets buffered whole (Node's 2 GiB
 * Buffer limit) and the decompressed GML never lands on disk in full. GML
 * is parsed feature-block by feature-block, so memory stays bounded even
 * for the ~24M-parcel national set.
 *
 * POSTGIS-FREE: this database has no PostGIS, so geometry is stored as
 * GeoJSON in a jsonb column (WGS84) + a numeric min/max lng/lat bbox.
 * GML coords (EPSG:27700) are reprojected to 4326 in JS with proj4.
 *
 * INSPIRE carries NO title numbers, so title_number stays NULL — map
 * boundary shading only, not title-linked plans.
 */

import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import { PassThrough, Readable } from "stream";
import proj4 from "proj4";
import unzipper from "unzipper";
import { pool } from "./db";
import { isHmlrPolygonsAvailable, resetHmlrAvailabilityCache } from "./hmlr-direct";

// British National Grid (EPSG:27700) → WGS84. +towgs84 = the Ordnance
// Survey published Helmert params (~metre accuracy without OSTN15 — ample
// for map shading).
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
  processed: number;
  inserted: number;
  updated: number;
  skipped: number;
}

const BATCH = 1000;

// ─── Coordinate parsing ────────────────────────────────────────────────

function parsePosList(text: string): number[][] {
  const nums = text.trim().split(/\s+/).map(Number).filter((n) => Number.isFinite(n));
  if (nums.length < 6 || nums.length % 2 !== 0) return [];
  const ring: number[][] = [];
  for (let i = 0; i < nums.length; i += 2) ring.push([nums[i], nums[i + 1]]);
  return ring;
}

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

// ─── Streaming parsers (accept any Readable) ───────────────────────────

function formatOf(name: string): "gml" | "ndjson" | "geojson" | null {
  const n = name.toLowerCase();
  if (n.endsWith(".gml")) return "gml";
  if (n.endsWith(".ndjson")) return "ndjson";
  if (n.endsWith(".geojson") || n.endsWith(".json")) return "geojson";
  return null;
}

async function parseGmlStream(
  input: NodeJS.ReadableStream,
  onFeature: (inspireId: number, geometrySource: any) => Promise<void>,
  onSkip: (reason: string) => void,
): Promise<void> {
  // Land Registry's WFS 2.0 INSPIRE export wraps each parcel in <wfs:member>
  // (not the gml:featureMember tags older INSPIRE GML used) — keep all the
  // variants so any vintage parses.
  const END_TAGS = ["</wfs:member>", "</gml:featureMember>", "</gml:member>", "</member>"];
  input.setEncoding("utf8");
  let buf = "";
  const handleBlock = async (block: string) => {
    if (!/INSPIREID/.test(block)) return;
    const geom = featureToGeometry(block);
    if ("skip" in geom) { onSkip(geom.skip); return; }
    await onFeature(geom.inspireId, geom.geometry);
  };
  for await (const chunk of input as AsyncIterable<string>) {
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

async function parseNdjsonStream(
  input: NodeJS.ReadableStream,
  onRow: (r: { inspireId: number; titleNumber: string | null; geometry: any }) => Promise<void>,
  onSkip: (reason: string) => void,
): Promise<void> {
  input.setEncoding("utf8");
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  for await (const line of rl) {
    const t = line.trim();
    if (!t) continue;
    let f: any;
    try { f = JSON.parse(t); } catch { onSkip("invalid JSON line"); continue; }
    const row = featureFromGeoJson(f);
    if ("skip" in row) onSkip(row.skip); else await onRow(row);
  }
}

// ─── Orchestration ─────────────────────────────────────────────────────

/**
 * Ingest one INSPIRE polygon file (.zip/.gml/.geojson/.ndjson) into
 * hmlr_title_polygons. Tracks progress in hmlr_ingest_runs (dataset
 * 'inspire'). GML treated as EPSG:27700 and reprojected to 4326; GeoJSON
 * / NDJSON treated as already 4326. A .zip is streamed entry-by-entry.
 */
export async function ingestInspirePolygonsFile(
  filePath: string,
  opts: { region?: string | null; sourceFilename?: string; runId?: string } = {},
): Promise<InspireIngestResult> {
  const region = opts.region ?? null;
  const sourceFilename = opts.sourceFilename ?? path.basename(filePath);

  await ensurePolygonTable();

  let runId = opts.runId;
  if (!runId) {
    const runRes = await pool.query<{ id: string }>(
      `INSERT INTO hmlr_ingest_runs (dataset, source_filename, status) VALUES ('inspire', $1, 'running') RETURNING id`,
      [sourceFilename],
    );
    runId = runRes.rows[0].id;
  }

  let processed = 0, inserted = 0, updated = 0, skipped = 0;
  const skipReasons: Record<string, number> = {};
  const note = (reason: string) => { skipped++; skipReasons[reason] = (skipReasons[reason] || 0) + 1; };

  let batch: PolygonRow[] = [];
  const flush = async () => {
    if (batch.length === 0) return;
    const f = await flushBatch(batch, region, runId!);
    inserted += f.inserted; updated += f.updated; skipped += f.failed;
    if (f.failed) skipReasons["geometry rejected"] = (skipReasons["geometry rejected"] || 0) + f.failed;
    batch = [];
  };
  const handle = async (inspireId: number, titleNumber: string | null, geometrySource: any, srid: number) => {
    processed++;
    const geometry = reprojectGeometry(geometrySource, srid);
    const bbox = computeBbox(geometry);
    if (!bbox) { note("empty/invalid geometry"); return; }
    batch.push({ inspireId, titleNumber, geometry, bbox });
    if (batch.length >= BATCH) {
      await flush();
      if (processed % 50_000 === 0) {
        await pool.query(
          `UPDATE hmlr_ingest_runs SET rows_processed=$1, rows_inserted=$2, rows_updated=$3, rows_skipped=$4 WHERE id=$5`,
          [processed, inserted, updated, skipped, runId],
        );
        console.log(`[inspire-ingest] processed=${processed} inserted=${inserted} updated=${updated} skipped=${skipped}`);
      }
    }
  };

  const parseSource = async (stream: NodeJS.ReadableStream, format: "gml" | "ndjson" | "geojson") => {
    const srid = format === "gml" ? 27700 : 4326;
    if (format === "gml") await parseGmlStream(stream, (id, g) => handle(id, null, g, srid), note);
    else if (format === "ndjson") await parseNdjsonStream(stream, (r) => handle(r.inspireId, r.titleNumber, r.geometry, srid), note);
    else note("geojson FeatureCollection inside a zip isn't streamed — convert to .ndjson");
  };

  // The national download is a zip-of-per-local-authority-zips, so recurse
  // into nested .zip entries. Inner LA zips are small (tens of MB), so we
  // buffer + open each one in memory, then stream its GML.
  let dataEntriesSeen = 0;
  const processFiles = async (files: any[], depth: number): Promise<void> => {
    for (const f of files) {
      if (f.type !== "File") continue;
      const fmt = formatOf(f.path);
      if (fmt) {
        dataEntriesSeen++;
        console.log(`[inspire-ingest] entry ${f.path} (${fmt})`);
        await parseSource(f.stream(), fmt);
      } else if (/\.zip$/i.test(f.path) && depth < 3) {
        console.log(`[inspire-ingest] nested zip ${f.path} — opening`);
        const buf = await f.buffer();
        const innerDir = await unzipper.Open.buffer(buf);
        await processFiles(innerDir.files, depth + 1);
      }
    }
  };

  try {
    if (filePath.toLowerCase().endsWith(".zip")) {
      const dir = await unzipper.Open.file(filePath);
      await processFiles(dir.files, 0);
      if (dataEntriesSeen === 0) {
        throw new Error(`No .gml/.geojson/.ndjson found (incl. nested zips). Top-level entries: ${dir.files.slice(0, 20).map((f) => f.path).join(", ") || "(empty)"}`);
      }
    } else {
      const fmt = formatOf(filePath);
      if (fmt === "gml" || fmt === "ndjson") {
        await parseSource(fs.createReadStream(filePath), fmt);
      } else {
        // Single GeoJSON FeatureCollection — small files only (read whole).
        const fc = JSON.parse(fs.readFileSync(filePath, "utf-8"));
        for (const ft of fc?.features || []) {
          const r = featureFromGeoJson(ft);
          if ("skip" in r) note(r.skip); else await handle(r.inspireId, r.titleNumber, r.geometry, 4326);
        }
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
    console.log(`[inspire-ingest] DONE ${sourceFilename} — processed=${processed} inserted=${inserted} updated=${updated} skipped=${skipped}${notes ? ` [${notes}]` : ""}`);
    return { runId, processed, inserted, updated, skipped };
  } catch (err: any) {
    await pool.query(
      `UPDATE hmlr_ingest_runs SET status='error', error=$1, rows_processed=$2, rows_inserted=$3, rows_updated=$4, rows_skipped=$5, finished_at=now() WHERE id=$6`,
      [err?.message || String(err), processed, inserted, updated, skipped, runId],
    ).catch(() => {});
    console.error(`[inspire-ingest] FAILED ${sourceFilename}:`, err?.message);
    throw err;
  }
}

/**
 * Random-access source over an HTTP(S) URL using Range requests, so
 * unzipper can read a remote zip's directory + selected entries WITHOUT
 * downloading the whole file. Needs the server to honour Range (Azure
 * blob / SharePoint @microsoft.graph.downloadUrl do).
 */
function rangedSource(url: string, totalSize: number) {
  return {
    size: async () => totalSize,
    stream: (offset: number, length?: number) => {
      const pt = new PassThrough();
      const end = (typeof length === "number" && length >= 0) ? String(offset + length - 1) : "";
      fetch(url, { headers: { Range: `bytes=${offset}-${end}` } })
        .then((res) => {
          if (res.status !== 206 && res.status !== 200) { pt.destroy(new Error(`Range request unsupported (HTTP ${res.status})`)); return; }
          if (!res.body) { pt.end(); return; }
          Readable.fromWeb(res.body as any).pipe(pt);
        })
        .catch((e) => pt.destroy(e));
      return pt;
    },
  };
}

/**
 * Ingest only the NAMED local-authority councils out of the national
 * INSPIRE zip, read straight from the SharePoint share link via HTTP Range
 * requests — only those councils' chunks are fetched (tens of MB each),
 * never the whole 5GB, and nothing needs extracting or re-sharing.
 *
 * This is web-dyno-safe for a HANDFUL of councils. It is NOT a way to load
 * the whole national set — 24M parcels still can't be parsed on the web
 * dyno; that's the offline CLI job.
 */
export async function ingestInspireCouncilsFromShareLink(
  shareUrl: string,
  opts: { councils: string[]; region?: string | null; runId?: string },
): Promise<InspireIngestResult> {
  const wanted = opts.councils.map((c) => c.toLowerCase().trim()).filter(Boolean);
  const region = opts.region ?? "national";

  await ensurePolygonTable();
  let runId = opts.runId;
  if (!runId) {
    const rr = await pool.query<{ id: string }>(
      `INSERT INTO hmlr_ingest_runs (dataset, source_filename, status) VALUES ('inspire', $1, 'running') RETURNING id`,
      [`councils: ${wanted.join(",")}`],
    );
    runId = rr.rows[0].id;
  }

  let processed = 0, inserted = 0, updated = 0, skipped = 0;
  const skipReasons: Record<string, number> = {};
  const note = (r: string) => { skipped++; skipReasons[r] = (skipReasons[r] || 0) + 1; };
  let batch: PolygonRow[] = [];
  const flush = async () => {
    if (!batch.length) return;
    const f = await flushBatch(batch, region, runId!);
    inserted += f.inserted; updated += f.updated; skipped += f.failed;
    batch = [];
  };
  const handle = async (inspireId: number, titleNumber: string | null, geometrySource: any, srid: number) => {
    processed++;
    const geometry = reprojectGeometry(geometrySource, srid);
    const bbox = computeBbox(geometry);
    if (!bbox) { note("empty/invalid geometry"); return; }
    batch.push({ inspireId, titleNumber, geometry, bbox });
    if (batch.length >= BATCH) await flush();
  };

  try {
    const { resolveSharePointShareLinkMetadata } = await import("./sharepoint-resolver");
    const meta = await resolveSharePointShareLinkMetadata(shareUrl);
    if (!meta.downloadUrl || !meta.size) {
      throw new Error(`Share link didn't resolve to a downloadable file with a known size (isFolder=${meta.isFolder}).`);
    }
    const dir = await unzipper.Open.custom(rangedSource(meta.downloadUrl, meta.size));
    const councilZips = dir.files.filter((f) => f.type === "File" && /\.zip$/i.test(f.path) && wanted.some((w) => f.path.toLowerCase().includes(w)));
    if (councilZips.length === 0) {
      throw new Error(`No council zips matched [${wanted.join(", ")}]. Sample of ${dir.files.length} entries: ${dir.files.slice(0, 15).map((f) => f.path).join(", ")}`);
    }
    for (const cz of councilZips) {
      console.log(`[inspire-councils] ${cz.path} — fetching + ingesting`);
      const buf = await cz.buffer(); // ranged fetch of just this council's bytes
      const innerDir = await unzipper.Open.buffer(buf);
      for (const f of innerDir.files) {
        if (f.type !== "File") continue;
        const fmt = formatOf(f.path);
        if (fmt === "gml") await parseGmlStream(f.stream(), (id, g) => handle(id, null, g, 27700), note);
        else if (fmt === "ndjson") await parseNdjsonStream(f.stream(), (r) => handle(r.inspireId, r.titleNumber, r.geometry, 4326), note);
      }
      await flush();
      await pool.query(
        `UPDATE hmlr_ingest_runs SET rows_processed=$1, rows_inserted=$2, rows_updated=$3, rows_skipped=$4 WHERE id=$5`,
        [processed, inserted, updated, skipped, runId],
      );
      console.log(`[inspire-councils] ${cz.path} done — processed=${processed} inserted=${inserted}`);
    }
    await flush();
    const notes = Object.entries(skipReasons).map(([k, v]) => `${v}×${k}`).join("; ") || null;
    await pool.query(
      `UPDATE hmlr_ingest_runs SET status='ok', rows_processed=$1, rows_inserted=$2, rows_updated=$3, rows_skipped=$4, notes=$5, finished_at=now() WHERE id=$6`,
      [processed, inserted, updated, skipped, notes, runId],
    );
    resetHmlrAvailabilityCache();
    void isHmlrPolygonsAvailable();
    console.log(`[inspire-councils] DONE — councils=${councilZips.length} processed=${processed} inserted=${inserted} updated=${updated} skipped=${skipped}`);
    return { runId, processed, inserted, updated, skipped };
  } catch (err: any) {
    await pool.query(
      `UPDATE hmlr_ingest_runs SET status='error', error=$1, rows_processed=$2, rows_inserted=$3, rows_updated=$4, rows_skipped=$5, finished_at=now() WHERE id=$6`,
      [err?.message || String(err), processed, inserted, updated, skipped, runId],
    ).catch(() => {});
    console.error(`[inspire-councils] FAILED:`, err?.message);
    throw err;
  }
}
