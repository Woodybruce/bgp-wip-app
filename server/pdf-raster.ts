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
