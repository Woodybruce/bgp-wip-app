// Plans from what the property already holds (Woody, 2026-09-28: "why are
// plans not being loaded up? you have them from the brochures"):
//   1. brochure pages that are floor or site plans, found by a cheap read of
//      each page — its text (plan titles, floors, "not to scale", unit
//      labels, areas) and how much vector drawing it carries — with no AI
//      call. The chosen pages are copied into their own PDF and go through
//      the plan PDF path (print-quality render, floor names, unit scan, the
//      original kept).
//   2. plan PDFs and images in the property's SharePoint folders (Floor
//      Plans / GA / Goad first — sharepoint-property-files.ts "plan"),
//      imported through the same path.
// Every plan made here carries a source_ref, so bringing the same page or
// file in twice adds nothing. Staff only.
//
//   GET  /api/properties/:propertyId/plans/brochure-pages
//   GET  /api/properties/:propertyId/plans/brochure-pages/:brochureId/:page/thumb
//   POST /api/properties/:propertyId/plans/from-brochure     { brochureId, pages: [11] }
//   GET  /api/properties/:propertyId/plans/sharepoint-candidates
//   POST /api/properties/:propertyId/plans/from-sharepoint   { driveId, itemId, webUrl }

import { Router, type Request, type Response } from "express";
import { requireAuth } from "./auth";
import { pool } from "./db";
import { getFile } from "./file-storage";
import { PropertyPlanInputError } from "./property-plan-links";

const router = Router();

// ─── Page classification (pure) ───────────────────────────────────────────

/** One PDF page as the classifier sees it: its text (lines separated by
 *  newlines) and the amount of vector path data it draws. */
export type PlanPageStats = { text: string; pathData: number };
export type PlanPageVerdict = { isPlan: boolean; score: number; name: string | null; kind: "floor" | "site" | null; reasons: string[] };

/** Text lines with brochure letter-spacing closed up ("F L O O R   P L A N"
 *  → "FLOOR PLAN") and runs of spaces collapsed. */
export function planPageLines(text: string): string[] {
  return String(text || "").split(/\r?\n|\f/).map(line => line.trim().split(/\s{2,}/)
    .map(group => /^(\S )+\S$/.test(group) ? group.replace(/ /g, "") : group).join(" ").replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

const LEVEL_RE = /\b(sub[- ]?basement|lower ground|upper ground|ground|basement|mezzanine|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|1st|2nd|3rd|4th|5th|6th|7th|8th|9th|10th|lower|upper|roof|terrace)\s+(floor|level|mall)s?\b|\b(basement|mezzanine|roof)\s+plans?\b|\blevel\s+(-?\d{1,2})\b/gi;
const LEVEL_ORDER = ["sub-basement", "basement", "lower ground", "lower", "ground", "upper ground", "mezzanine", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth", "upper", "terrace", "roof"];
const ORDINALS: Record<string, string> = { "1st": "first", "2nd": "second", "3rd": "third", "4th": "fourth", "5th": "fifth", "6th": "sixth", "7th": "seventh", "8th": "eighth", "9th": "ninth", "10th": "tenth" };
const title = (s: string) => s.replace(/\b[a-z]/g, c => c.toUpperCase());
const shortLines = (lines: string[], max = 6) => lines.filter(line => line.split(" ").length <= max);

/** The floors a page is titled with, in building order ("Ground Floor",
 *  "Lower Level", "Basement", "Level 2"). Only short, title-like lines count
 *  — prose that mentions "the ground and mezzanine floors" names nothing. */
export function planLevels(lines: string[]): Array<{ word: string; suffix: string | null; order: number }> {
  const found = new Map<string, { word: string; suffix: string | null; order: number }>();
  for (const line of shortLines(lines)) {
    for (const m of line.matchAll(LEVEL_RE)) {
      if (m[4] !== undefined) { found.set(`level ${Number(m[4])}`, { word: "level", suffix: String(Number(m[4])), order: 100 + Number(m[4]) }); continue; }
      const raw = (m[1] || m[3]).toLowerCase().replace(/sub[- ]?basement/, "sub-basement");
      const word = ORDINALS[raw] || raw;
      const suffix = m[2] ? m[2].toLowerCase() : null;
      const key = `${word} ${suffix || ""}`.trim();
      if (!found.has(key)) found.set(key, { word, suffix, order: LEVEL_ORDER.indexOf(word) });
    }
  }
  return [...found.values()].sort((a, b) => a.order - b.order);
}

/** A floor name from those levels: "Ground Floor", "Basement", "First,
 *  Second & Third Floors", "Lower Level / Upper Mall". */
export function planLevelName(lines: string[]): string | null {
  const levels = planLevels(lines);
  if (!levels.length) return null;
  const label = (l: { word: string; suffix: string | null }) => l.word === "level" ? `Level ${l.suffix}` : title(`${l.word}${l.suffix ? ` ${l.suffix}` : ""}`);
  if (levels.length === 1) return label(levels[0]);
  if (levels.every(l => l.suffix === "floor")) {
    const words = levels.map(l => title(l.word));
    return `${words.slice(0, -1).join(", ")} & ${words[words.length - 1]} Floors`.slice(0, 100);
  }
  return levels.map(label).join(" / ").slice(0, 100);
}

const TITLE_RE = /\b(floor ?plans?|(?:site|ground|basement|mezzanine|level|location|block|layout|demise|lease|tenancy|goad|accommodation|space|upper|lower|first|second|third|fourth|fifth)(?: floor| level)? plans?)\b|^plans?$/i;
const SCALE_RE = /\b(not to scale|do not scale|indicative (?:only|layout|plan)|for identification (?:purposes )?only|scale\s*1\s*:\s*\d+|crown copyright|ordnance survey|os sitemap|experian goad|goad)\b/i;
const SITE_RE = /\b(site plan|location plan|crown copyright|ordnance survey|os sitemap|goad|red line)\b/i;
const AREA_RE = /\d[\d,.]*\s*(?:sq\.?\s?ft|sq\.?\s?m|sqft|sqm|m²|m2|ft²|ft2)(?![a-z])/gi;
const UNIT_RE = /\b(?:unit|shop|kiosk|su|msu|suite)\s*[a-z]?\d{1,3}[a-z]?\b/gi;
const SCHEDULE_RE = /\b(lease expiry|expiry|break|rent review|passing rent|per annum|lease start|lease end|tenant)\b/gi;
const LOCATION_RE = /\b(minutes?|mins?)\s+(walk|drive|by)\b|\b(underground|station|airport)\b|\bby (tube|rail|car|train)\b|\btravel times?\b|\bconnectivity\b/gi;
// OS map extracts print house-number ranges ("15 to 22").
const HOUSE_RANGE_RE = /\b\d{1,3} to \d{1,3}\b/g;

/** Is this page a floor / site plan? Points for a plan title (+3), scale or
 *  map notes (+2), floor names (+1 each, up to 2), area labels on a sparse
 *  page (+1), unit labels (+1 for 3, +2 for 8), and heavy vector drawing
 *  (+3, or +1 for some); minus a tenancy-schedule table (-3), travel-time
 *  location copy (-2) or long prose without drawing (-2). A plan needs 3 or
 *  more AND drawing, a title or a scale note — so a floor-area table or a
 *  description that names floors never qualifies. */
export function classifyPlanPage(stats: PlanPageStats): PlanPageVerdict {
  const lines = planPageLines(stats.text);
  const text = lines.join("\n");
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  const reasons: string[] = [];
  let score = 0;
  const titled = shortLines(lines, 8).some(line => TITLE_RE.test(line));
  if (titled) { score += 3; reasons.push("plan title"); }
  const scaled = SCALE_RE.test(text);
  if (scaled) { score += 2; reasons.push("scale / map note"); }
  const levels = planLevels(lines);
  if (levels.length) { score += Math.min(2, levels.length); reasons.push("floor names"); }
  if (wordCount < 200 && (text.match(AREA_RE) || []).length) { score += 1; reasons.push("area labels"); }
  const units = (text.match(UNIT_RE) || []).length;
  if (units >= 3) { score += units >= 8 ? 2 : 1; reasons.push(`${units} unit labels`); }
  const drawing = stats.pathData >= 15_000 ? 3 : stats.pathData >= 5_000 ? 1 : 0;
  if (drawing) { score += drawing; reasons.push(drawing === 3 ? "heavy linework" : "some linework"); }
  if ((text.match(SCHEDULE_RE) || []).length >= 3 && (text.match(/£/g) || []).length >= 3) { score -= 3; reasons.push("tenancy table"); }
  if (!titled && (text.match(LOCATION_RE) || []).length >= 2) { score -= 2; reasons.push("location copy"); }
  if (!drawing && wordCount > 450) { score -= 2; reasons.push("long prose"); }
  const isPlan = score >= 3 && (drawing > 0 || titled || scaled);
  if (!isPlan) return { isPlan, score, name: null, kind: null, reasons };
  const site = !levels.length && (SITE_RE.test(text) || (text.match(HOUSE_RANGE_RE) || []).length >= 3);
  return { isPlan, score, name: planLevelName(lines), kind: site ? "site" : "floor", reasons };
}

/** The floor name a new plan from this page gets when the page doesn't title
 *  itself: its floors, else "Site plan" / "Floor plan", with " · p<n>" added
 *  when that name is already on the board. */
export function brochurePlanName(verdict: Pick<PlanPageVerdict, "name" | "kind"> | undefined, page: number, taken: Set<string>): string {
  const base = verdict?.name || (verdict?.kind === "site" ? "Site plan" : "Floor plan");
  const name = taken.has(base.toLowerCase()) ? `${base} · p${page}` : base;
  taken.add(name.toLowerCase());
  return name;
}

export const brochurePageRef = (brochureId: string, page: number) => `brochure:${brochureId}:p${page}`;
export const sharePointRef = (driveId: string, itemId: string) => `sharepoint:${driveId}:${itemId}`;

/** Which requested brochure pages still need importing: valid, unique page
 *  numbers (1–10 of them) not already made into plans. */
export function brochurePagesToImport(requested: unknown, pageCount: number | null, brochureId: string, existingRefs: Set<string>): { pages: number[]; skipped: number[] } {
  if (!Array.isArray(requested) || !requested.length || requested.length > 10) throw new PropertyPlanInputError("Pick between 1 and 10 brochure pages.");
  const pages = [...new Set(requested.map(Number))];
  if (pages.some(p => !Number.isInteger(p) || p < 1 || (pageCount != null && p > pageCount))) throw new PropertyPlanInputError("Those page numbers aren't in this brochure.");
  pages.sort((a, b) => a - b);
  return { pages: pages.filter(p => !existingRefs.has(brochurePageRef(brochureId, p))), skipped: pages.filter(p => existingRefs.has(brochurePageRef(brochureId, p))) };
}

// ─── Reading a PDF's pages (pdf.js, no rendering) ──────────────────────────

const MAX_ANALYSED_PAGES = 60;

export async function readPlanPageStats(pdfBuffer: Buffer, maxPages = MAX_ANALYSED_PAGES): Promise<Array<PlanPageStats & { page: number }>> {
  const pdfjs: any = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(pdfBuffer), disableFontFace: true, isEvalSupported: false }).promise;
  const out: Array<PlanPageStats & { page: number }> = [];
  try {
    for (let p = 1; p <= Math.min(doc.numPages, maxPages); p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      const text = content.items.map((item: any) => `${item.str || ""}${item.hasEOL ? "\n" : " "}`).join("");
      const ops = await page.getOperatorList();
      let pathData = 0;
      for (let i = 0; i < ops.fnArray.length; i++) {
        if (ops.fnArray[i] !== pdfjs.OPS.constructPath) continue;
        // pdf.js 5 packs each path as [paintOp, [Float32Array…], minMax].
        const raw = ops.argsArray[i]?.[1];
        const parts = Array.isArray(raw) && raw.length && typeof raw[0] !== "number" ? raw : [raw];
        for (const part of parts) pathData += part?.length || 0;
      }
      out.push({ page: p, text, pathData });
      page.cleanup();
      await new Promise(resolve => setImmediate(resolve));
    }
  } finally {
    await doc.destroy().catch(() => {});
  }
  return out;
}

type BrochureRow = { id: string; property_id: string; type: string; original_name: string; storage_key: string; page_count: number | null; archived?: boolean };
type AnalysedPage = PlanPageVerdict & { page: number };

// Page verdicts per brochure file, kept in memory: a brochure's pages don't
// change, and reading one takes a few seconds.
const analysed = new Map<string, Promise<{ pageCount: number; pages: AnalysedPage[] }>>();

function analyseBrochure(row: BrochureRow): Promise<{ pageCount: number; pages: AnalysedPage[] }> {
  const key = `${row.id}:${row.storage_key}`;
  let job = analysed.get(key);
  if (!job) {
    job = (async () => {
      const file = await getFile(row.storage_key);
      if (!file) throw new PropertyPlanInputError("The brochure file is missing — upload the brochure again.", 404);
      const stats = await readPlanPageStats(file.data);
      return { pageCount: row.page_count || stats.length, pages: stats.map(s => ({ page: s.page, ...classifyPlanPage(s) })) };
    })();
    job.catch(() => analysed.delete(key));
    analysed.set(key, job);
    if (analysed.size > 60) analysed.delete(analysed.keys().next().value!);
  }
  return job;
}

// ─── Routes ───────────────────────────────────────────────────────────────

async function staffOnly(req: Request, res: Response): Promise<boolean> {
  const { isClientRequestUser } = await import("./company-scope");
  if (await isClientRequestUser(req)) { res.status(403).json({ error: "Adding plans from brochures and SharePoint is for the BGP team." }); return false; }
  return true;
}
async function propertyExists(req: Request, res: Response): Promise<boolean> {
  const { rows } = await pool.query("SELECT 1 FROM crm_properties WHERE id = $1", [req.params.propertyId]);
  if (!rows.length) { res.status(404).json({ error: "Property not found." }); return false; }
  return true;
}
function fail(res: Response, err: any, fallback: string) {
  if (err instanceof PropertyPlanInputError) return res.status(err.status).json({ error: err.message });
  console.error("[property-plan-sources]", err?.message);
  return res.status(500).json({ error: fallback });
}
async function existingRefs(propertyId: string, prefix: string): Promise<Set<string>> {
  const { rows } = await pool.query(`SELECT source_ref FROM property_plans WHERE property_id = $1 AND left(source_ref, $3) = $2`, [propertyId, prefix, prefix.length]);
  return new Set(rows.map((r: any) => r.source_ref));
}
async function takenFloors(propertyId: string): Promise<Set<string>> {
  const { rows } = await pool.query(`SELECT floor FROM property_plans WHERE property_id = $1 AND COALESCE(is_geo, false) = false`, [propertyId]);
  return new Set(rows.map((r: any) => String(r.floor || "").toLowerCase()));
}
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
async function brochureFor(req: Request, res: Response, brochureId: unknown): Promise<BrochureRow | null> {
  if (typeof brochureId !== "string" || !UUID_RE.test(brochureId)) { res.status(400).json({ error: "Choose a brochure on this property." }); return null; }
  const { rows } = await pool.query(`SELECT id, property_id, type, original_name, storage_key, page_count FROM property_brochures WHERE id = $1 AND property_id = $2`, [brochureId, req.params.propertyId]);
  if (!rows[0]) { res.status(404).json({ error: "Brochure not found on this property." }); return null; }
  return rows[0];
}

// The property's live brochures, each with the pages that read as plans and
// whether each is already on the Plans board.
router.get("/api/properties/:propertyId/plans/brochure-pages", requireAuth, async (req: Request, res: Response) => {
  try {
    if (!await staffOnly(req, res) || !await propertyExists(req, res)) return;
    const propertyId = String(req.params.propertyId);
    const brochures = await pool.query<BrochureRow>(`SELECT id, property_id, type, original_name, storage_key, page_count FROM property_brochures
      WHERE property_id = $1 AND archived IS NOT TRUE ORDER BY created_at DESC`, [propertyId])
      .then(r => r.rows).catch((e: any) => { if (e?.code === "42P01") return [] as BrochureRow[]; throw e; });
    const refs = await existingRefs(propertyId, "brochure:");
    const out = [];
    for (const b of brochures) {
      try {
        const { pageCount, pages } = await analyseBrochure(b);
        out.push({ id: b.id, name: b.original_name, type: b.type, pageCount,
          pages: pages.filter(p => p.isPlan).map(p => ({ page: p.page, name: p.name, kind: p.kind, score: p.score, reasons: p.reasons, imported: refs.has(brochurePageRef(b.id, p.page)) })),
          imported: [...refs].filter(r => r.startsWith(`brochure:${b.id}:`)).map(r => Number(r.split(":p")[1])).filter(Boolean) });
      } catch (e: any) {
        out.push({ id: b.id, name: b.original_name, type: b.type, pageCount: b.page_count, pages: [], imported: [], error: e instanceof PropertyPlanInputError ? e.message : "Couldn't read this brochure's pages." });
      }
    }
    res.json({ brochures: out });
  } catch (err) { fail(res, err, "Couldn't look through the brochures."); }
});

// A small preview of one brochure page for the picker.
const thumbs = new Map<string, Buffer>();
router.get("/api/properties/:propertyId/plans/brochure-pages/:brochureId/:page/thumb", requireAuth, async (req: Request, res: Response) => {
  try {
    if (!await staffOnly(req, res)) return;
    const brochure = await brochureFor(req, res, req.params.brochureId);
    if (!brochure) return;
    const page = Number(req.params.page);
    if (!Number.isInteger(page) || page < 1 || (brochure.page_count != null && page > brochure.page_count)) return res.status(404).json({ error: "That page isn't in this brochure." });
    const key = `${brochure.id}:${brochure.storage_key}:${page}`;
    let jpeg = thumbs.get(key);
    if (!jpeg) {
      const file = await getFile(brochure.storage_key);
      if (!file) return res.status(404).json({ error: "The brochure file is missing — upload the brochure again." });
      const { rasterisePdfPage } = await import("./pdf-image-extract");
      const raw = await rasterisePdfPage({ pdfBuffer: file.data, page, dpi: 40 });
      if (!raw) return res.status(422).json({ error: "This page couldn't be previewed." });
      const sharp = (await import("sharp")).default;
      jpeg = await sharp(raw).resize({ width: 480, height: 480, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 75 }).toBuffer();
      thumbs.set(key, jpeg);
      if (thumbs.size > 200) thumbs.delete(thumbs.keys().next().value!);
    }
    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Cache-Control", "private, max-age=86400");
    res.end(jpeg);
  } catch (err) { fail(res, err, "Couldn't preview the page."); }
});

// Chosen brochure pages → their own PDF → the plan PDF path. Pages already
// made into plans are skipped, so running it twice adds nothing.
router.post("/api/properties/:propertyId/plans/from-brochure", requireAuth, async (req: Request, res: Response) => {
  try {
    if (!await staffOnly(req, res) || !await propertyExists(req, res)) return;
    const propertyId = String(req.params.propertyId);
    const brochure = await brochureFor(req, res, req.body?.brochureId);
    if (!brochure) return;
    const { pages, skipped } = brochurePagesToImport(req.body?.pages, brochure.page_count, brochure.id, await existingRefs(propertyId, `brochure:${brochure.id}:`));
    if (!pages.length) return res.json({ plans: [], pages: 0, skipped, duplicate: true });
    const file = await getFile(brochure.storage_key);
    if (!file) return res.status(404).json({ error: "The brochure file is missing — upload the brochure again." });
    const { PDFDocument } = await import("pdf-lib");
    let extracted: Buffer;
    try {
      const source = await PDFDocument.load(file.data, { ignoreEncryption: true });
      if (pages.some(p => p > source.getPageCount())) throw new PropertyPlanInputError("Those page numbers aren't in this brochure.");
      const out = await PDFDocument.create();
      for (const copied of await out.copyPages(source, pages.map(p => p - 1))) out.addPage(copied);
      extracted = Buffer.from(await out.save());
    } catch (e: any) {
      if (e instanceof PropertyPlanInputError) throw e;
      throw new PropertyPlanInputError("Couldn't copy the pages out of this brochure PDF.");
    }
    const verdicts = await analyseBrochure(brochure).then(a => new Map(a.pages.map(p => [p.page, p]))).catch(() => new Map<number, AnalysedPage>());
    const taken = await takenFloors(propertyId);
    const label = brochure.type === "investment" ? "investment" : "leasing";
    const { savePdfPlan } = await import("./property-plans");
    const result = await savePdfPlan(req, propertyId, { buffer: extracted, originalname: `${brochure.original_name.replace(/\.pdf$/i, "")} - plan pages.pdf` }, {
      source: "brochure",
      pages: pages.map(p => ({ floor: brochurePlanName(verdicts.get(p), p, taken), sourceRef: brochurePageRef(brochure.id, p), notes: `From the ${label} brochure "${brochure.original_name}", page ${p}` })),
    });
    res.json({ ...result, skipped, duplicate: false });
  } catch (err) { fail(res, err, "Couldn't add plans from the brochure."); }
});

// Plan PDFs and images in SharePoint for this property, ranked, with the ones
// already on the board marked.
router.get("/api/properties/:propertyId/plans/sharepoint-candidates", requireAuth, async (req: Request, res: Response) => {
  const sp = await import("./sharepoint-property-files");
  try {
    if (!await staffOnly(req, res)) return;
    const propertyId = String(req.params.propertyId);
    const result = await sp.findPropertyFiles(pool, propertyId, "plan");
    const refs = await existingRefs(propertyId, "sharepoint:");
    const items = new Set([...refs].map(r => r.split(":").slice(1, 3).join(":")));
    for (const c of result.candidates) c.imported = !!(c.driveId && c.itemId && items.has(`${c.driveId}:${c.itemId}`));
    res.json(result);
  } catch (e: any) {
    if (e?.status === 404) return res.status(404).json({ error: "Property not found." });
    console.error("[property-plan-sources sharepoint-candidates]", e?.message);
    res.status(502).json({ error: sp.plainGraphError(e) });
  }
});

const MAX_SHAREPOINT_PLAN_BYTES = 50 * 1024 * 1024;

// One SharePoint plan file → the plan PDF path (a PDF) or the image path.
router.post("/api/properties/:propertyId/plans/from-sharepoint", requireAuth, async (req: Request, res: Response) => {
  const sp = await import("./sharepoint-property-files");
  try {
    if (!await staffOnly(req, res) || !await propertyExists(req, res)) return;
    const propertyId = String(req.params.propertyId);
    let meta: Awaited<ReturnType<typeof sp.resolveFileRef>>;
    try { meta = await sp.resolveFileRef(req.body || {}); }
    catch (e: any) { return res.status(e?.status || 502).json({ error: e?.status ? e.message : sp.plainGraphError(e) }); }
    if (!sp.isPlanFile(meta.name)) return res.status(400).json({ error: "Pick a PDF, PNG, JPG or WebP plan." });
    if (meta.size > MAX_SHAREPOINT_PLAN_BYTES) return res.status(413).json({ error: "That file is over 50MB — too large to add as a plan." });
    const ref = sharePointRef(meta.driveId, meta.itemId);
    const already = await pool.query(`SELECT 1 FROM property_plans WHERE property_id = $1 AND (source_ref = $2 OR left(source_ref, $3) = $4) LIMIT 1`, [propertyId, ref, ref.length + 1, `${ref}:`]);
    if (already.rows.length) return res.json({ plans: [], pages: 0, duplicate: true, name: meta.name });
    let buffer: Buffer;
    try { buffer = await sp.downloadFile(meta); }
    catch (e: any) { return res.status(502).json({ error: sp.plainGraphError(e) }); }
    const base = meta.name.replace(/\.[a-z0-9]+$/i, "").replace(/[_]+/g, " ").trim().slice(0, 80) || "Plan";
    const notes = `From SharePoint: ${meta.name}`;
    const { savePdfPlan, savePlanImage } = await import("./property-plans");
    if (buffer.subarray(0, 5).toString() === "%PDF-") {
      const stats = await readPlanPageStats(buffer, 10).catch(() => [] as Array<PlanPageStats & { page: number }>);
      const verdicts = stats.map(classifyPlanPage);
      const single = stats.length <= 1;
      const result = await savePdfPlan(req, propertyId, { buffer, originalname: meta.name }, {
        source: "sharepoint",
        pages: Array.from({ length: Math.max(stats.length, 1) }, (_, i) => ({
          floor: verdicts[i]?.name || (verdicts[i]?.kind === "site" ? "Site plan" : single ? base : `${base} · page ${i + 1}`),
          sourceRef: `${ref}:p${i + 1}`, notes,
        })),
      });
      return res.json({ ...result, duplicate: false, name: meta.name });
    }
    const plan = await savePlanImage(req, propertyId, { buffer, originalname: meta.name }, { floor: planLevelName([base]) || base, source: "sharepoint", sourceRef: ref, notes });
    res.json({ plans: [plan], pages: 1, scanning: plan.scanning, duplicate: false, name: meta.name });
  } catch (err) { fail(res, err, "Couldn't add the plan from SharePoint."); }
});

export default router;
