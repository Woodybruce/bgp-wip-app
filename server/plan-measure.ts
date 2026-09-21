/**
 * Scale-aware measuring on architects' drawing PDFs — back-end for ChatBGP's
 * `measure_plan` tool.
 *
 * Woody, 2026-09-21: "Really important can measure scale plans." The planning
 * drawings we pull (RBKC publisher, chat uploads) are vector PDFs whose title
 * block states the drawn scale ("1 : 125@A1"). Combined with the physical page
 * size that gives an exact metres-per-point calibration, so any polygon or
 * line expressed in page coordinates converts to real metres / m² / sq ft —
 * no squinting at scale bars. The vector text layer also carries the
 * dimension strings ("8.9m", "12,450") and any area schedule figures, which
 * we hand back verbatim with positions.
 *
 * Flow for the model: call once to calibrate (+ optionally render a high-res
 * crop of the plan to look at); read corner positions off the render (or the
 * dimension strings); call again with `shapes` to get areas and lengths.
 */
import crypto from "node:crypto";
import { getFile, saveFile, findChatMediaByOriginalName } from "./file-storage";
import { pdfPageInfos, pdfPageText, rasterisePdfPageBuffer, sheetSizeName, sheetLongEdgePt, extractFilledPaths, unionAreaPt, paintedAreaByColour, type PdfTextItem } from "./pdf-raster";

const PT_TO_MM = 25.4 / 72;
const SQM_TO_SQFT = 10.7639;

export interface MeasureSource {
  chatMediaFilename?: string;
  storageKey?: string;
  url?: string;
}

export interface MeasureShape {
  label?: string;
  type: "area" | "length";
  points: Array<{ x: number; y: number }>;
}

export interface MeasurePlanArgs {
  source: MeasureSource;
  page?: number;
  /** Override the drawn scale, e.g. "1:100" or 100 (the denominator). */
  scale?: string | number;
  /** Override the sheet size the stated scale refers to (e.g. "A1") when the PDF was printed to a different size. */
  sheet?: string;
  /** Known real-world length between two points to calibrate from when no scale is printed. */
  calibrate?: { points: [{ x: number; y: number }, { x: number; y: number }]; metres: number };
  /** Render the page (or a fractional region of it) to a high-res PNG for the model / user to look at. */
  render?: boolean | { region?: { x: number; y: number; w: number; h: number }; targetDpi?: number };
  /** Shapes to measure. Coordinates default to fractions of the full page (0–1, origin top-left). */
  shapes?: MeasureShape[];
  /** Measure the sheet's solid colour fills (the shaded extent on GIA/NIA demise plans). */
  fills?: boolean;
  /** How shape/calibrate points are expressed. "pixel" needs `image`. */
  coords?: "fraction" | "point" | "pixel";
  /** For pixel coordinates: the rendered image they were read off (from a previous render result). */
  image?: { width: number; height: number; region?: { x: number; y: number; w: number; h: number } };
}

export interface ScaleReading {
  stated: string | null;
  denominator: number | null;
  statedSheet: string | null;
  effectiveDenominator: number | null;
  source: string;
  confidence: "high" | "medium" | "low" | "none";
  alternatives?: string[];
}

async function loadSourcePdf(src: MeasureSource): Promise<{ buffer: Buffer; name: string }> {
  if (src.chatMediaFilename) {
    const bare = src.chatMediaFilename.replace(/^.*\/api\/chat-media\//, "").replace(/^chat-media\//, "").trim();
    const direct = await getFile(`chat-media/${bare}`);
    if (direct) return { buffer: direct.data, name: direct.originalName || bare };
    const byName = await findChatMediaByOriginalName(bare);
    if (byName) return { buffer: byName.data, name: byName.originalName || bare };
    throw new Error(`Chat upload not found: ${bare}`);
  }
  if (src.storageKey) {
    const f = await getFile(src.storageKey);
    if (!f) throw new Error(`File not found in storage: ${src.storageKey}`);
    return { buffer: f.data, name: f.originalName || src.storageKey.split("/").pop() || "document.pdf" };
  }
  if (src.url) {
    const url = src.url.trim();
    const { isRbkcPublisherDocUrl, downloadRbkcPublisherUrl } = await import("./rbkc-planning");
    if (isRbkcPublisherDocUrl(url)) {
      const buf = await downloadRbkcPublisherUrl(url);
      if (!buf) throw new Error("Couldn't fetch that drawing from the RBKC planning register (session lapsed or portal unreachable) — list the documents again with get_planning_drawings and retry.");
      return { buffer: buf, name: "rbkc-drawing.pdf" };
    }
    if (url.startsWith("/api/chat-media/") || url.startsWith("chat-media/")) return loadSourcePdf({ chatMediaFilename: url });
    if (!/^https:\/\//i.test(url)) throw new Error("url must be https://, a chat-media path, or an RBKC register document link");
    const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`Fetch failed: HTTP ${res.status}`);
    return { buffer: Buffer.from(await res.arrayBuffer()), name: url.split("/").pop() || "document.pdf" };
  }
  throw new Error("Provide source.chatMediaFilename, source.storageKey or source.url");
}

const SCALE_RE = /(?:^|[^\d])1\s*[:∶]\s*(\d{1,4})(?:\s*@\s*(A[0-4]))?/i;

export function readScaleFromText(items: PdfTextItem[], widthPt: number, heightPt: number): ScaleReading {
  type Cand = { denominator: number; sheet: string | null; text: string; x: number; y: number; h: number; nearLabel: number };
  const labels = items.filter((it) => /^scales?$/i.test(it.str) || /^scale\s*[:\-]?$/i.test(it.str));
  const cands: Cand[] = [];
  for (const it of items) {
    const m = it.str.match(SCALE_RE);
    if (!m) continue;
    const den = parseInt(m[1], 10);
    if (!den || den < 2 || den > 5000) continue;
    // Distance to the nearest "Scale" label (title-block layout: label above/left of value).
    let near = Infinity;
    for (const l of labels) near = Math.min(near, Math.hypot(l.x - it.x, l.y - it.y));
    cands.push({ denominator: den, sheet: m[2] ? m[2].toUpperCase() : null, text: it.str, x: it.x, y: it.y, h: it.h, nearLabel: near });
  }
  // Multi-item title blocks: "Scale" label followed by a separate "1 : 125@A1" item.
  if (cands.length === 0) return { stated: null, denominator: null, statedSheet: null, effectiveDenominator: null, source: "no '1:N' text found on the sheet", confidence: "none" };

  // Prefer the candidate sitting next to a Scale label; then one carrying "@A1"; then the largest type.
  cands.sort((a, b) => (a.nearLabel - b.nearLabel) || ((b.sheet ? 1 : 0) - (a.sheet ? 1 : 0)) || (b.h - a.h));
  const best = cands[0];
  const distinct = [...new Set(cands.map((c) => c.denominator))];
  const alternatives = distinct.filter((d) => d !== best.denominator).map((d) => `1:${d}`);
  const confidence: ScaleReading["confidence"] = best.nearLabel < Math.max(widthPt, heightPt) * 0.03 || best.sheet ? (distinct.length === 1 ? "high" : "medium") : (distinct.length === 1 ? "medium" : "low");
  return {
    stated: best.sheet ? `1:${best.denominator} @ ${best.sheet}` : `1:${best.denominator}`,
    denominator: best.denominator,
    statedSheet: best.sheet,
    effectiveDenominator: best.denominator,
    source: best.nearLabel < Infinity && best.nearLabel < Math.max(widthPt, heightPt) * 0.03 ? `title block ("${best.text}")` : `sheet text ("${best.text}")`,
    confidence,
    ...(alternatives.length ? { alternatives } : {}),
  };
}

function parseScaleOverride(v: string | number | undefined): { denominator: number; sheet: string | null } | null {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v === "number") return v > 1 ? { denominator: v, sheet: null } : null;
  const m = String(v).match(/(\d{1,4})(?:\s*@\s*(A[0-4]))?\s*$/i);
  return m ? { denominator: parseInt(m[1], 10), sheet: m[2] ? m[2].toUpperCase() : null } : null;
}

const DIM_RE = /^(\d{1,3}(?:[.,]\d{1,3})?)\s*(m|M)$/;
const DIM_MM_RE = /^(\d{1,3}(?:[.,]\d{1,3})?)\s*(mm|MM)$/;
const BARE_MM_RE = /^\d{3,5}$/;
const AREA_RE = /(\d{1,3}(?:,\d{3})*(?:\.\d+)?|\d+(?:\.\d+)?)\s*(sq\.?\s*m\b|m²|m2\b|sqm\b|sq\.?\s*ft\b|ft²|ft2\b|sqft\b)/i;

function extractDimensions(items: PdfTextItem[]) {
  const dims: Array<{ text: string; metres: number; assumed?: string; fx: number; fy: number }> = [];
  const areas: Array<{ text: string; value: number; unit: "sq m" | "sq ft"; sqm: number; fx: number; fy: number }> = [];
  const scheduleLines: Array<{ text: string; fx: number; fy: number }> = [];
  for (const it of items) {
    const s = it.str.replace(/\s+/g, " ").trim();
    let m: RegExpMatchArray | null;
    if ((m = s.match(DIM_RE))) dims.push({ text: s, metres: parseFloat(m[1].replace(",", ".")), fx: it.fx, fy: it.fy });
    else if ((m = s.match(DIM_MM_RE))) dims.push({ text: s, metres: parseFloat(m[1].replace(",", ".")) / 1000, fx: it.fx, fy: it.fy });
    else if (BARE_MM_RE.test(s)) dims.push({ text: s, metres: parseInt(s, 10) / 1000, assumed: "bare number read as millimetres (CAD convention) — could be a level, reference or count", fx: it.fx, fy: it.fy });
    if ((m = s.match(AREA_RE))) {
      const value = parseFloat(m[1].replace(/,/g, ""));
      const isFt = /ft/i.test(m[2]);
      areas.push({ text: s, value, unit: isFt ? "sq ft" : "sq m", sqm: isFt ? value / SQM_TO_SQFT : value, fx: it.fx, fy: it.fy });
    }
    if (/\b(GIA|NIA|GEA|NSA|gross internal|net internal|floor area|area schedule|schedule of areas)\b/i.test(s)) scheduleLines.push({ text: s, fx: it.fx, fy: it.fy });
  }
  return { dims, areas, scheduleLines };
}

function titleFromText(items: PdfTextItem[], widthPt: number): { title: string | null; drawingNumber: string | null; titleBlock: string[] } {
  // Title blocks live in the right-hand strip; the drawing title is the largest
  // type near a "Title" label. Fall back to the largest text in that strip.
  const strip = items.filter((it) => it.fx > 0.78);
  const label = strip.find((it) => /^(drawing\s+)?title$/i.test(it.str));
  let title: string | null = null;
  if (label) {
    const below = strip.filter((it) => it !== label && Math.abs(it.x - label.x) < widthPt * 0.08 && it.y > label.y - 60 && it.y < label.y + 60 && it.h >= 9 && !/^(scale|date|drawn|checked|rev|status)$/i.test(it.str));
    below.sort((a, b) => b.h - a.h || Math.abs(a.y - label.y) - Math.abs(b.y - label.y));
    if (below[0]) {
      // Long titles wrap onto a second line in the title cell ("PROPOSED
      // GROUND FLOOR PLAN -" / "GIA") — join the lines in the same column.
      const first = below[0];
      const lines = strip.filter((it) => Math.abs(it.x - first.x) < 8 && Math.abs(it.h - first.h) < 2 && it.y <= first.y + first.h * 0.6 && it.y >= first.y - first.h * 2.6)
        .sort((a, b) => b.y - a.y || a.x - b.x);
      title = (lines.length ? lines : [first]).map((it) => it.str).join(" ").replace(/\s+/g, " ").trim();
    }
  }
  if (!title) {
    const big = [...strip].filter((it) => it.h >= 11 && it.str.length > 4 && !SCALE_RE.test(it.str)).sort((a, b) => b.h - a.h);
    title = big[0]?.str || null;
  }
  const dnLabel = strip.find((it) => /^drawing\s+(no\.?|number)$/i.test(it.str));
  let drawingNumber: string | null = null;
  if (dnLabel) {
    const near = strip.filter((it) => it !== dnLabel && Math.abs(it.x - dnLabel.x) < widthPt * 0.08 && Math.abs(it.y - dnLabel.y) < 40 && /\d/.test(it.str) && it.str.length <= 30 && !/^rev/i.test(it.str));
    near.sort((a, b) => Math.abs(a.y - dnLabel.y) - Math.abs(b.y - dnLabel.y));
    if (near[0]) {
      // Drawing numbers are often split across text items ("21846" + "-06-210") — join the row.
      const row = strip.filter((it) => Math.abs(it.y - near[0].y) < near[0].h * 0.6 && it.x >= near[0].x - 2 && it.x < near[0].x + widthPt * 0.12 && it.str.length <= 30 && !/^[A-Z]$/.test(it.str)).sort((a, b) => a.x - b.x);
      drawingNumber = row.map((it) => it.str).join(" ").replace(/\s+-/g, "-").replace(/-\s+/g, "-").trim() || near[0].str;
    }
  }
  const titleBlock = strip.filter((it) => it.h >= 7).sort((a, b) => b.y - a.y || a.x - b.x).map((it) => it.str).slice(0, 40);
  return { title, drawingNumber, titleBlock };
}

function polygonAreaPt(points: Array<{ x: number; y: number }>): number {
  let a = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i], q = points[(i + 1) % points.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

function pathLengthPt(points: Array<{ x: number; y: number }>, closed: boolean): number {
  let l = 0;
  const n = closed ? points.length : points.length - 1;
  for (let i = 0; i < n; i++) {
    const p = points[i], q = points[(i + 1) % points.length];
    l += Math.hypot(q.x - p.x, q.y - p.y);
  }
  return l;
}

export async function measurePlan(args: MeasurePlanArgs): Promise<any> {
  const { buffer, name } = await loadSourcePdf(args.source || {});
  return measurePlanFromBuffer(buffer, name, args);
}

export async function measurePlanFromBuffer(buffer: Buffer, name: string, args: MeasurePlanArgs): Promise<any> {
  if (buffer.subarray(0, 4).toString("latin1") !== "%PDF") {
    return { error: `${name} isn't a PDF. measure_plan works on drawing PDFs (vector sheets with a stated scale). For a photo or scan of a plan, use the Cann CAD page (/cad-measure) and calibrate on a known dimension.` };
  }
  const infos = await pdfPageInfos(buffer);
  const pageNo = Math.min(Math.max(1, Math.floor(args.page || 1)), infos.length);
  const { items, widthPt, heightPt } = await pdfPageText(buffer, pageNo);
  const isoSize = sheetSizeName(widthPt, heightPt);
  const notes: string[] = [];

  // ── Scale ────────────────────────────────────────────────────────────────
  let scale = readScaleFromText(items, widthPt, heightPt);
  const override = parseScaleOverride(args.scale);
  if (override) {
    scale = { stated: `1:${override.denominator}${override.sheet ? " @ " + override.sheet : ""}`, denominator: override.denominator, statedSheet: override.sheet, effectiveDenominator: override.denominator, source: "supplied by caller", confidence: "high" };
  }
  if (args.sheet && /^A[0-4]$/i.test(args.sheet)) scale.statedSheet = args.sheet.toUpperCase();

  // A "1:100 @ A1" drawing saved/printed at A3 is really 1:200 on the page we
  // hold — correct by the ratio of the stated sheet's long edge to ours.
  if (scale.denominator) {
    const statedLong = scale.statedSheet ? sheetLongEdgePt(scale.statedSheet) : null;
    const actualLong = Math.max(widthPt, heightPt);
    if (statedLong && Math.abs(statedLong - actualLong) / statedLong > 0.03) {
      scale.effectiveDenominator = scale.denominator * (statedLong / actualLong);
      notes.push(`Sheet states ${scale.stated} but this PDF page is ${isoSize || `${Math.round(widthPt * PT_TO_MM)}×${Math.round(heightPt * PT_TO_MM)}mm`}; measurements use the corrected scale 1:${scale.effectiveDenominator.toFixed(1)}.`);
    } else {
      scale.effectiveDenominator = scale.denominator;
    }
    if (scale.alternatives?.length) notes.push(`Other scales appear on this sheet (${scale.alternatives.join(", ")}) — details or inset plans. Measurements assume the main plan is at ${scale.stated}. Pass scale:"1:N" to override.`);
  }

  // ── Calibration ──────────────────────────────────────────────────────────
  const toPt = (p: { x: number; y: number }): { x: number; y: number } => {
    const mode = args.coords || "fraction";
    if (mode === "point") return { x: p.x, y: p.y };
    if (mode === "pixel") {
      if (!args.image?.width || !args.image?.height) throw new Error("coords:'pixel' needs image:{width,height,region?} from the render you read the points off");
      const r = args.image.region || { x: 0, y: 0, w: 1, h: 1 };
      return { x: (r.x + (p.x / args.image.width) * r.w) * widthPt, y: (r.y + (p.y / args.image.height) * r.h) * heightPt };
    }
    return { x: p.x * widthPt, y: p.y * heightPt };
  };

  let metresPerPoint: number | null = scale.effectiveDenominator ? (scale.effectiveDenominator * PT_TO_MM) / 1000 : null;
  let calibrationSource = metresPerPoint ? `drawn scale ${scale.stated}` : "none";
  if (args.calibrate?.points?.length === 2 && args.calibrate.metres > 0) {
    const [a, b] = args.calibrate.points.map(toPt);
    const distPt = Math.hypot(b.x - a.x, b.y - a.y);
    if (distPt > 0) {
      const calibrated = args.calibrate.metres / distPt;
      if (metresPerPoint) {
        const diff = Math.abs(calibrated - metresPerPoint) / metresPerPoint;
        notes.push(`Known-dimension calibration gives 1:${(calibrated * 1000 / PT_TO_MM).toFixed(1)} vs the stated ${scale.stated} (${(diff * 100).toFixed(1)}% apart)${diff > 0.05 ? " — CHECK the two points were placed on the right marks; using the known dimension." : "; the two agree, using the known dimension."}`);
      }
      metresPerPoint = calibrated;
      calibrationSource = `known dimension ${args.calibrate.metres} m between the supplied points`;
      scale.effectiveDenominator = (calibrated * 1000) / PT_TO_MM;
    }
  }
  if (!metresPerPoint) notes.push("No scale could be read from the sheet. Ask the user for the drawn scale (scale:\"1:100\") or give two points and the real distance between them (calibrate:{points,metres}) — a door (0.9 m) or a dimension string on the drawing works.");

  // ── Sheet text: dimensions, areas, title ─────────────────────────────────
  const { dims, areas, scheduleLines } = extractDimensions(items);
  const { title, drawingNumber, titleBlock } = titleFromText(items, widthPt);

  // ── Optional render ──────────────────────────────────────────────────────
  let render: any;
  if (args.render) {
    const ropt = typeof args.render === "object" ? args.render : {};
    const region = ropt.region && ropt.region.w > 0 && ropt.region.h > 0 ? ropt.region : { x: 0, y: 0, w: 1, h: 1 };
    const r = await rasterisePdfPageBuffer(buffer, pageNo, { targetDpi: ropt.targetDpi || 200, maxSide: 6000, format: "png", region });
    const safe = (title || name).replace(/[^a-zA-Z0-9-_ ]/g, "").trim().replace(/\s+/g, "_").slice(0, 50) || "plan";
    const file = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}-${safe}_p${pageNo}.png`;
    await saveFile(`chat-media/${file}`, r.buffer, "image/png", `${safe} p${pageNo}.png`);
    render = {
      downloadUrl: `/api/chat-media/${file}`,
      chatMediaFilename: file,
      width: r.width,
      height: r.height,
      dpi: Math.round(r.dpi),
      region,
      metresPerPixel: metresPerPoint ? metresPerPoint / r.scale : null,
      note: "Pixel coordinates read off this image convert back with coords:'pixel' + image:{width,height,region}. The image is the sheet region above at the stated DPI; for vision OCR pass chatMediaFilename to vision_describe_image (it tiles large images automatically).",
    };
  }

  // ── Measurements ─────────────────────────────────────────────────────────
  const measurements: any[] = [];
  if (Array.isArray(args.shapes) && args.shapes.length) {
    if (!metresPerPoint) return { error: "Can't measure without a calibration — see notes.", page: pageNo, scale, notes, dimensionsOnSheet: dims.slice(0, 80) };
    for (const s of args.shapes) {
      const pts = (s.points || []).map(toPt);
      if (s.type === "area") {
        if (pts.length < 3) { measurements.push({ label: s.label, type: "area", error: "need at least 3 points" }); continue; }
        const areaM2 = polygonAreaPt(pts) * metresPerPoint * metresPerPoint;
        measurements.push({ label: s.label || `Area ${measurements.length + 1}`, type: "area", sqm: round(areaM2, 2), sqft: round(areaM2 * SQM_TO_SQFT, 0), perimeterM: round(pathLengthPt(pts, true) * metresPerPoint, 2), vertices: pts.length });
      } else {
        if (pts.length < 2) { measurements.push({ label: s.label, type: "length", error: "need at least 2 points" }); continue; }
        const lenM = pathLengthPt(pts, false) * metresPerPoint;
        measurements.push({ label: s.label || `Length ${measurements.length + 1}`, type: "length", metres: round(lenM, 3), feet: round(lenM * 3.28084, 2), segments: pts.length - 1 });
      }
    }
    const totalSqm = measurements.filter((m) => m.type === "area" && m.sqm != null).reduce((a, m) => a + m.sqm, 0);
    if (measurements.filter((m) => m.type === "area").length > 1) measurements.push({ label: "Total of areas", type: "total", sqm: round(totalSqm, 2), sqft: round(totalSqm * SQM_TO_SQFT, 0) });
  }

  // ── Shaded regions (demise plans) ────────────────────────────────────────
  // Architects' GIA/NIA sheets rarely print figures — the shaded polygon IS
  // the area. Pull every solid fill off the vector page, group by colour,
  // union each colour's polygons (overlaps and holes handled by rasterising)
  // and convert at the drawn scale. White, black and greys are paper and
  // linework, not demise.
  let fillRegions: any[] | undefined;
  if (args.fills) {
    const { paths, patternFills } = await extractFilledPaths(buffer, pageNo);
    const isNeutral = (hex: string) => {
      const m = hex.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
      if (!m) return true;
      const [r, g, b] = [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
      const spread = Math.max(r, g, b) - Math.min(r, g, b);
      // True greys (white, black, #c0c0c0…) have zero spread; demise tints
      // can be very pale — the Plaza GIA lilac #ddd2df is only 13 apart.
      return spread < 6;
    };
    const byColour = new Map<string, typeof paths>();
    for (const p of paths) { if (isNeutral(p.colour)) continue; const list = byColour.get(p.colour) || []; list.push(p); byColour.set(p.colour, list); }
    fillRegions = [];
    // What is actually PAINTED in each colour (respects clips and white
    // overpaint of cores/voids) is the figure; the polygon union is the
    // cross-reference — a big gap between them means masks sit on the fill.
    const painted = byColour.size ? await paintedAreaByColour(buffer, pageNo, [...byColour.keys()], 1.25) : {};
    for (const [colour, list] of byColour) {
      const sumPt = list.reduce((s, p) => s + p.areaPt, 0);
      const { areaPt: unionPt } = await unionAreaPt(list.map((p) => p.subpaths), widthPt, heightPt, 1);
      const pix = painted[colour];
      const areaPt = pix && pix.areaPt > 0 ? pix.areaPt : unionPt;
      const bboxPt = pix?.bboxPt || null;
      const m2 = metresPerPoint ? areaPt * metresPerPoint * metresPerPoint : null;
      if (m2 !== null && m2 < 0.5) continue;
      const largest = [...list].sort((a, b) => b.areaPt - a.areaPt)[0];
      fillRegions.push({
        colour,
        polygons: list.length,
        sqm: m2 !== null ? round(m2, 1) : null,
        sqft: m2 !== null ? round(m2 * SQM_TO_SQFT, 0) : null,
        basis: pix && pix.areaPt > 0 ? "painted pixels (clips and overpaint respected)" : "vector polygon union",
        vectorUnionSqm: metresPerPoint ? round(unionPt * metresPerPoint * metresPerPoint, 1) : null,
        summedPolygonsSqm: metresPerPoint ? round(sumPt * metresPerPoint * metresPerPoint, 1) : null,
        largestPolygonSqm: metresPerPoint ? round(largest.areaPt * metresPerPoint * metresPerPoint, 1) : null,
        bboxFraction: bboxPt ? { x: round(bboxPt[0] / widthPt, 4), y: round(bboxPt[1] / heightPt, 4), w: round((bboxPt[2] - bboxPt[0]) / widthPt, 4), h: round((bboxPt[3] - bboxPt[1]) / heightPt, 4) } : null,
        // Fills sitting in the right-hand title-block strip are key swatches /
        // location keys, not demise — flag them so they aren't summed.
        inTitleStrip: bboxPt ? bboxPt[0] / widthPt > 0.78 : false,
        areaPt2: round(areaPt, 0),
      });
    }
    fillRegions.sort((a, b) => (b.areaPt2 || 0) - (a.areaPt2 || 0));
    if (patternFills) notes.push(`${patternFills} hatched/pattern fill${patternFills === 1 ? "" : "s"} on this sheet could not be measured (only solid colour fills are).`);
    if (!fillRegions.length) notes.push("No solid coloured fills on this sheet — it isn't a shaded demise plan (or the shading is a hatch pattern / raster image).");
    else if (!metresPerPoint) notes.push("Fill regions were found but can't be converted to metres without a scale — see the scale note above.");
    else notes.push("fillRegions: use `sqm` (painted pixels). The largest tinted fill outside the title strip on a GIA/GEA sheet is the demise; NIA sheets split the floor into several tints (retail / reception / BOH per the legend) — sum the non-title-strip tints for the floor NIA. vectorUnionSqm is only a cross-reference and is EXPECTED to be far larger where the fill polygon is a whole-footprint outline with the courtyard, cores and voids masked back to white on top of it — that gap is not an error.");
  }

  return {
    file: name,
    page: pageNo,
    pageCount: infos.length,
    sheet: { isoSize, widthMm: Math.round(widthPt * PT_TO_MM), heightMm: Math.round(heightPt * PT_TO_MM), widthPt: round(widthPt, 1), heightPt: round(heightPt, 1) },
    title,
    drawingNumber,
    scale,
    calibration: metresPerPoint ? {
      source: calibrationSource,
      metresPerPoint: round(metresPerPoint, 6),
      millimetresPerPoint: round(metresPerPoint * 1000, 3),
      pointsPerMetre: round(1 / metresPerPoint, 3),
      pageCoversMetres: { width: round(widthPt * metresPerPoint, 2), height: round(heightPt * metresPerPoint, 2) },
    } : null,
    dimensionsOnSheet: dims.slice(0, 120),
    areasOnSheet: areas.slice(0, 60),
    scheduleLines: scheduleLines.slice(0, 40),
    titleBlock,
    ...(render ? { render } : {}),
    ...(fillRegions ? { fillRegions } : {}),
    ...(measurements.length ? { measurements } : {}),
    notes,
    guidance: measurements.length
      ? "Report areas as approximate (scaled from the drawing, not a measured survey); state the drawn scale used."
      : "To measure: read the room/unit corners off the render as fractions of the page (0–1, origin top-left) or as pixels on the render, then call measure_plan again with shapes:[{type:'area',label,points:[…]}] (coords:'pixel' + image if using pixels). Dimension strings already on the sheet are listed in dimensionsOnSheet — prefer quoting those where they exist.",
  };
}

function round(n: number, dp: number): number {
  const f = Math.pow(10, dp);
  return Math.round(n * f) / f;
}
