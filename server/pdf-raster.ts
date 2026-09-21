/**
 * Shared PDF rasteriser — pdf.js (legacy build) drawing onto @napi-rs/canvas.
 *
 * Why this exists: the Image Studio capture-pdf route rendered every page at a
 * fixed pdf.js scale of 1.8 and saved JPEG, which is fine for an A4 brochure
 * but wrecks an A1 CAD sheet — the area schedule text ends up a couple of
 * pixels tall and JPEG artefacts chew the 1px linework. Rendering is now
 * DPI-aware (scale derives from the physical page size), capped so a huge
 * sheet can't blow memory, and vector-heavy pages come out as PNG.
 *
 * node-canvas ("canvas") fails on pages with transparency groups under the
 * current pdf.js ("Image or Canvas expected"); @napi-rs/canvas renders them.
 */

export interface PdfPageInfo { page: number; widthPt: number; heightPt: number }

export interface RasterisedPage {
  buffer: Buffer;
  mimeType: "image/png" | "image/jpeg";
  width: number;
  height: number;
  widthPt: number;
  heightPt: number;
  /** device pixels per PDF point */
  scale: number;
  /** effective dots per inch of the render */
  dpi: number;
  vectorHeavy: boolean;
}

export interface RasteriseOptions {
  /** Target effective DPI (default 220 — small CAD text survives). */
  targetDpi?: number;
  /** Cap on the longer image edge in pixels (default 8000). */
  maxSide?: number;
  /** Force an output format; default picks PNG for vector-heavy pages. */
  format?: "png" | "jpeg";
  jpegQuality?: number;
  /** Optional fractional crop of the page (0–1, origin top-left) rendered at full target scale. */
  region?: { x: number; y: number; w: number; h: number };
}

class NapiCanvasFactory {
  private createCanvas: (w: number, h: number) => any;
  constructor(createCanvas: (w: number, h: number) => any) { this.createCanvas = createCanvas; }
  create(w: number, h: number) { const canvas = this.createCanvas(Math.max(1, Math.ceil(w)), Math.max(1, Math.ceil(h))); return { canvas, context: canvas.getContext("2d") }; }
  reset(ca: any, w: number, h: number) { ca.canvas.width = Math.max(1, Math.ceil(w)); ca.canvas.height = Math.max(1, Math.ceil(h)); }
  destroy(ca: any) { ca.canvas.width = 0; ca.canvas.height = 0; }
}

async function libs() {
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs") as any;
  const { createCanvas } = await import("@napi-rs/canvas") as any;
  return { pdfjsLib, createCanvas };
}

export async function loadPdf(pdfBuffer: Buffer): Promise<any> {
  const { pdfjsLib } = await libs();
  return pdfjsLib.getDocument({ data: new Uint8Array(pdfBuffer), disableFontFace: true, isEvalSupported: false }).promise;
}

export async function pdfPageInfos(pdfBuffer: Buffer): Promise<PdfPageInfo[]> {
  const doc = await loadPdf(pdfBuffer);
  const out: PdfPageInfo[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const [x0, y0, x1, y1] = page.view;
    const rot = ((page.rotate || 0) % 180) !== 0;
    const w = Math.abs(x1 - x0), h = Math.abs(y1 - y0);
    out.push({ page: p, widthPt: rot ? h : w, heightPt: rot ? w : h });
  }
  return out;
}

/** Pixels-per-point scale that hits targetDpi without exceeding maxSide on the longer edge. */
export function scaleForPage(widthPt: number, heightPt: number, targetDpi = 220, maxSide = 8000): number {
  const wanted = targetDpi / 72;
  const longest = Math.max(widthPt, heightPt) || 1;
  return Math.min(wanted, maxSide / longest);
}

// Standard ISO sheet sizes in points (portrait), ±2.5% tolerance when matching.
const ISO_SHEETS: Array<{ name: string; w: number; h: number }> = [
  { name: "A0", w: 2384, h: 3370 },
  { name: "A1", w: 1684, h: 2384 },
  { name: "A2", w: 1191, h: 1684 },
  { name: "A3", w: 842, h: 1191 },
  { name: "A4", w: 595, h: 842 },
];

export function sheetSizeName(widthPt: number, heightPt: number): string | null {
  const s = Math.min(widthPt, heightPt), l = Math.max(widthPt, heightPt);
  for (const sh of ISO_SHEETS) {
    if (Math.abs(s - sh.w) / sh.w < 0.025 && Math.abs(l - sh.h) / sh.h < 0.025) return sh.name;
  }
  return null;
}

export function sheetLongEdgePt(name: string): number | null {
  const sh = ISO_SHEETS.find((s) => s.name === name.toUpperCase());
  return sh ? sh.h : null;
}

/**
 * Text items on a page with positions in PDF points (origin bottom-left, as
 * pdf.js reports) plus the same in top-left fractions of the page for callers
 * that think in image coordinates.
 */
export interface PdfTextItem { str: string; x: number; y: number; w: number; h: number; fx: number; fy: number }

export async function pdfPageText(pdfBuffer: Buffer, pageNo: number): Promise<{ items: PdfTextItem[]; widthPt: number; heightPt: number }> {
  const doc = await loadPdf(pdfBuffer);
  const page = await doc.getPage(pageNo);
  const vp = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  const items: PdfTextItem[] = [];
  for (const it of content.items as any[]) {
    if (!it?.str || !it.str.trim() || !it.transform) continue;
    // Map through the viewport so rotated pages land in display space.
    const [vx, vy] = vp.convertToViewportPoint(it.transform[4], it.transform[5]);
    const h = Math.hypot(it.transform[2], it.transform[3]) || 8;
    items.push({ str: it.str.trim(), x: vx, y: vp.height - vy, w: it.width || 0, h, fx: vx / vp.width, fy: vy / vp.height });
  }
  return { items, widthPt: vp.width, heightPt: vp.height };
}

/**
 * Filled vector paths on a page, with their fill colour, in display
 * coordinates (points, origin top-left after the page's own rotation). This
 * is how demise plans encode area: the shaded GIA/NIA extent is a solid fill,
 * so its polygon IS the measurement. pdf.js ≥5 folds the paint operator into
 * constructPath(paintOp, [Float32Array per subpath: op,x,y,…], minMax) with
 * draw ops moveTo 0 / lineTo 1 / curveTo 2 / closePath 3.
 */
export interface FilledPath { colour: string; subpaths: Array<Array<[number, number]>>; areaPt: number }

export async function extractFilledPaths(pdfBuffer: Buffer, pageNo: number): Promise<{ paths: FilledPath[]; widthPt: number; heightPt: number; patternFills: number }> {
  const { pdfjsLib } = await libs();
  const OPS = pdfjsLib.OPS;
  const doc = await loadPdf(pdfBuffer);
  const page = await doc.getPage(pageNo);
  const vp = page.getViewport({ scale: 1 });
  const ops = await page.getOperatorList();
  const FILL_OPS = new Set([OPS.fill, OPS.eoFill, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke]);
  type M = [number, number, number, number, number, number];
  const mul = (m: M, n: number[]): M => [m[0]*n[0]+m[2]*n[1], m[1]*n[0]+m[3]*n[1], m[0]*n[2]+m[2]*n[3], m[1]*n[2]+m[3]*n[3], m[0]*n[4]+m[2]*n[5]+m[4], m[1]*n[4]+m[3]*n[5]+m[5]];
  const toDisplay = (m: M, x: number, y: number): [number, number] => {
    const ux = m[0]*x + m[2]*y + m[4], uy = m[1]*x + m[3]*y + m[5];
    const [dx, dy] = vp.convertToViewportPoint(ux, uy);
    return [dx, dy];
  };
  const signedArea = (pts: Array<[number, number]>) => { let a = 0; for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p[0]*q[1] - q[0]*p[1]; } return a / 2; };
  const toHex = (args: any): string => {
    if (Array.isArray(args) && typeof args[0] === "string" && /^#/.test(args[0])) return args[0].toLowerCase();
    if (Array.isArray(args) && args.length >= 3 && typeof args[0] === "number") return "#" + [args[0], args[1], args[2]].map((v) => Math.round(v <= 1 ? v * 255 : v).toString(16).padStart(2, "0")).join("");
    if (Array.isArray(args) && args.length === 1 && typeof args[0] === "number") { const g = Math.round(args[0] <= 1 ? args[0] * 255 : args[0]).toString(16).padStart(2, "0"); return `#${g}${g}${g}`; }
    return String(args?.[0] ?? "unknown");
  };
  let ctm: M = [1, 0, 0, 1, 0, 0];
  let fill = "#000000";
  const stack: Array<{ ctm: M; fill: string }> = [];
  const paths: FilledPath[] = [];
  let patternFills = 0;
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i], args = ops.argsArray[i];
    if (fn === OPS.save) stack.push({ ctm, fill });
    else if (fn === OPS.restore) { const s = stack.pop(); if (s) { ctm = s.ctm; fill = s.fill; } }
    else if (fn === OPS.transform) ctm = mul(ctm, args as number[]);
    else if (fn === OPS.setFillRGBColor || fn === OPS.setFillGray || fn === OPS.setFillCMYKColor) fill = toHex(args);
    else if (fn === OPS.setFillColorN) fill = "pattern";
    else if (fn === OPS.constructPath) {
      const paintOp = args[0];
      if (!FILL_OPS.has(paintOp)) continue;
      if (fill === "pattern") { patternFills++; continue; }
      const raw = args[1];
      const segs: ArrayLike<number>[] = Array.isArray(raw) && raw.length && typeof raw[0] !== "number" ? raw : [raw];
      const subpaths: Array<Array<[number, number]>> = [];
      let cur: Array<[number, number]> = [];
      for (const d of segs) {
        for (let k = 0; k < d.length;) {
          const op = d[k];
          if (op === 0) { if (cur.length >= 3) subpaths.push(cur); cur = [toDisplay(ctm, d[k + 1], d[k + 2])]; k += 3; }
          else if (op === 1) { cur.push(toDisplay(ctm, d[k + 1], d[k + 2])); k += 3; }
          else if (op === 2) {
            // Bézier: sample the curve so curved demise lines keep their area.
            const p0 = cur[cur.length - 1] || toDisplay(ctm, d[k + 1], d[k + 2]);
            const c1 = toDisplay(ctm, d[k + 1], d[k + 2]), c2 = toDisplay(ctm, d[k + 3], d[k + 4]), p3 = toDisplay(ctm, d[k + 5], d[k + 6]);
            for (let t = 0.25; t <= 1.0001; t += 0.25) {
              const u = 1 - t;
              cur.push([u*u*u*p0[0] + 3*u*u*t*c1[0] + 3*u*t*t*c2[0] + t*t*t*p3[0], u*u*u*p0[1] + 3*u*u*t*c1[1] + 3*u*t*t*c2[1] + t*t*t*p3[1]]);
            }
            k += 7;
          }
          else if (op === 3) { if (cur.length >= 3) subpaths.push(cur); cur = []; k += 1; }
          else break;
        }
      }
      if (cur.length >= 3) subpaths.push(cur);
      if (!subpaths.length) continue;
      // Even-odd / nonzero both make opposite-wound inner rings subtract.
      const areaPt = Math.abs(subpaths.reduce((s, sp) => s + signedArea(sp), 0));
      paths.push({ colour: fill, subpaths, areaPt });
    }
  }
  return { paths, widthPt: vp.width, heightPt: vp.height, patternFills };
}

/**
 * Union area (in pt²) of a set of polygons, by rasterising them onto an
 * offscreen canvas and counting covered pixels — overlapping fills and
 * holes come out right without a polygon-clipping library.
 */
export async function unionAreaPt(polys: Array<Array<Array<[number, number]>>>, widthPt: number, heightPt: number, pxPerPt = 2): Promise<{ areaPt: number; bboxPt: [number, number, number, number] | null }> {
  const { createCanvas } = await libs();
  const w = Math.ceil(widthPt * pxPerPt), h = Math.ceil(heightPt * pxPerPt);
  const canvas = createCanvas(w, h); const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#000"; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#fff";
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const subpaths of polys) {
    ctx.beginPath();
    for (const sp of subpaths) {
      sp.forEach(([x, y], i) => { if (i === 0) ctx.moveTo(x * pxPerPt, y * pxPerPt); else ctx.lineTo(x * pxPerPt, y * pxPerPt); minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); });
      ctx.closePath();
    }
    ctx.fill("evenodd");
  }
  const data = ctx.getImageData(0, 0, w, h).data;
  let n = 0;
  for (let i = 0; i < data.length; i += 4) if (data[i] > 127) n++;
  return { areaPt: n / (pxPerPt * pxPerPt), bboxPt: isFinite(minX) ? [minX, minY, maxX, maxY] : null };
}

/**
 * Painted area per colour, from an actual render of the page. Unlike the
 * vector polygons this respects clipping and overpainting (cores, voids and
 * white masks drawn on top of a demise fill), so it is the figure to trust;
 * the polygon union is the cross-reference. Anti-aliased edge pixels are
 * assigned to the nearest listed colour within `tolerance` (0–441).
 */
export async function paintedAreaByColour(pdfBuffer: Buffer, pageNo: number, colours: string[], pxPerPt = 1.5, tolerance = 28): Promise<Record<string, { areaPt: number; bboxPt: [number, number, number, number] | null }>> {
  const { pdfjsLib, createCanvas } = await libs();
  const doc = await loadPdf(pdfBuffer);
  const page = await doc.getPage(pageNo);
  const vp = page.getViewport({ scale: pxPerPt });
  const factory = new NapiCanvasFactory(createCanvas);
  const w = Math.ceil(vp.width), h = Math.ceil(vp.height);
  const { canvas, context } = factory.create(w, h);
  context.fillStyle = "#ffffff"; context.fillRect(0, 0, w, h);
  await page.render({ canvasContext: context, viewport: vp, canvasFactory: factory }).promise;
  const data = context.getImageData(0, 0, w, h).data;
  const targets = colours.map((hex) => {
    const m = hex.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
    return m ? { hex, r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) } : null;
  }).filter(Boolean) as Array<{ hex: string; r: number; g: number; b: number }>;
  const counts: Record<string, { n: number; minX: number; minY: number; maxX: number; maxY: number }> = {};
  for (const t of targets) counts[t.hex] = { n: 0, minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const tol2 = tolerance * tolerance;
  void pdfjsLib;
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    if (r > 250 && g > 250 && b > 250) continue; // paper
    // Neutral pixels are linework and its anti-aliasing, never a tint —
    // without this a pale lilac fill "matches" every grey edge on the sheet.
    if (Math.max(r, g, b) - Math.min(r, g, b) < 5) continue;
    let best: { hex: string } | null = null, bestD = tol2;
    for (const t of targets) {
      const d = (r - t.r) ** 2 + (g - t.g) ** 2 + (b - t.b) ** 2;
      if (d <= bestD) { bestD = d; best = t; }
    }
    if (!best) continue;
    const c = counts[best.hex]; c.n++;
    const x = p % w, y = (p - x) / w;
    if (x < c.minX) c.minX = x; if (x > c.maxX) c.maxX = x; if (y < c.minY) c.minY = y; if (y > c.maxY) c.maxY = y;
  }
  factory.destroy({ canvas, context });
  const out: Record<string, { areaPt: number; bboxPt: [number, number, number, number] | null }> = {};
  for (const [hex, c] of Object.entries(counts)) {
    out[hex] = { areaPt: c.n / (pxPerPt * pxPerPt), bboxPt: c.n ? [c.minX / pxPerPt, c.minY / pxPerPt, c.maxX / pxPerPt, c.maxY / pxPerPt] : null };
  }
  return out;
}

/** Render one page (or a fractional region of it) to PNG/JPEG at a DPI-aware scale. */
export async function rasterisePdfPageBuffer(pdfBuffer: Buffer, pageNo: number, opts: RasteriseOptions = {}): Promise<RasterisedPage> {
  const { pdfjsLib, createCanvas } = await libs();
  const doc = await loadPdf(pdfBuffer);
  if (pageNo < 1 || pageNo > doc.numPages) throw new Error(`Page ${pageNo} is out of range — the PDF has ${doc.numPages} pages.`);
  const page = await doc.getPage(pageNo);
  const base = page.getViewport({ scale: 1 });
  const widthPt = base.width, heightPt = base.height;
  const targetDpi = opts.targetDpi ?? 220;
  const maxSide = opts.maxSide ?? 8000;

  // Vector-heavy = few/no raster XObjects relative to the page. Those pages
  // (CAD sheets, plans, typeset text) keep crisp linework as PNG.
  let imageOps = 0;
  try {
    const ops = await page.getOperatorList();
    for (const fn of ops.fnArray) if (fn === pdfjsLib.OPS.paintImageXObject || fn === pdfjsLib.OPS.paintJpegXObject || fn === pdfjsLib.OPS.paintInlineImageXObject) imageOps++;
  } catch {}
  const vectorHeavy = imageOps <= 2;

  const region = opts.region && opts.region.w > 0 && opts.region.h > 0
    ? { x: Math.max(0, Math.min(1, opts.region.x)), y: Math.max(0, Math.min(1, opts.region.y)), w: Math.min(1 - Math.max(0, opts.region.x), opts.region.w), h: Math.min(1 - Math.max(0, opts.region.y), opts.region.h) }
    : null;
  // A crop may render at the full-page target scale but is itself capped.
  const regionW = region ? widthPt * region.w : widthPt;
  const regionH = region ? heightPt * region.h : heightPt;
  const scale = scaleForPage(regionW, regionH, targetDpi, maxSide);

  const factory = new NapiCanvasFactory(createCanvas);
  const vp = page.getViewport({ scale });
  const outW = Math.ceil(regionW * scale), outH = Math.ceil(regionH * scale);
  const { canvas, context } = factory.create(outW, outH);
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, outW, outH);
  if (region) context.translate(-Math.round(region.x * widthPt * scale), -Math.round(region.y * heightPt * scale));
  await page.render({ canvasContext: context, viewport: vp, canvasFactory: factory }).promise;

  const format = opts.format || (vectorHeavy ? "png" : "jpeg");
  const buffer: Buffer = format === "png"
    ? canvas.toBuffer("image/png")
    : canvas.toBuffer("image/jpeg", opts.jpegQuality ?? 88);
  factory.destroy({ canvas, context });
  return { buffer, mimeType: format === "png" ? "image/png" : "image/jpeg", width: outW, height: outH, widthPt, heightPt, scale, dpi: scale * 72, vectorHeavy };
}
