// Deck → editable PowerPoint assembler (the unified presentation pipeline).
//
// WHY THIS EXISTS
// One source for every Pave deliverable: it takes a Deck (the card model) and
// generates a NATIVE, EDITABLE PowerPoint in the Pave Investment-Memorandum
// house style — navy #14253b ground, bone #e8e1d3 accent, Tiempos throughout.
//
// WHY GENERATED (not injected into a hand master)
// IM layouts are data-dense: heatmapped ranking tables, asset-overview
// dashboards, row-band executive summaries. Those need native tables with
// per-cell fills and variable row counts, which injecting text into a fixed
// master can't do. So we generate each slide with pptxgenjs (full control of
// tables/shapes/fills) and then EMBED the Tiempos faces into the .pptx
// (OOXML embeddedFontLst) so it renders on-brand on any machine.
import PptxGenJSImport from "pptxgenjs";
import JSZip from "jszip";
// pptxgenjs is CommonJS; default-import interop differs between esbuild and tsx,
// so resolve the constructor from either shape.
const PptxGenJS: any = (PptxGenJSImport as any)?.default || PptxGenJSImport;
type pptxgen = any;
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { execFile } from "child_process";
import sharp from "sharp";
import { randomUUID } from "node:crypto";
import { saveFile, getFile } from "./file-storage";

// Bundled static Tiempos TTFs (instantiated from the brand VFs) embedded into
// each .pptx so PowerPoint renders the brand serif even where Tiempos isn't
// installed. (The server's Nix LibreOffice can't see them, which is why the
// deliverable is the PPTX, not a LibreOffice PDF.)
const FONTS_DIR = path.join(process.cwd(), "server", "assets", "fonts");
const EMBED_FONTS: Array<{ typeface: string; regular: string; bold: string }> = [
  { typeface: "Tiempos Headline", regular: "TiemposHeadline-Regular.ttf", bold: "TiemposHeadline-Bold.ttf" },
  { typeface: "Tiempos Text", regular: "TiemposText-Regular.ttf", bold: "TiemposText-Bold.ttf" },
];

// ── BGP brand (Why Buy palette — green/gold, Georgia/Calibri) ──────────────
// The ENTIRE deck look is driven from this block (+ the WORDMARK paths / WM_AR
// below). Swap these values for the official Marketing brand pack when it's
// available — nothing else in the engine needs to change.
const NAVY = "2E5E3F", NAVY2 = "1A3A28", BONE = "EFEDE6", BONE2 = "E7E5DF",
  INK = "232323", PAPER = "FFFFFF", STONE = "F2F0E8", LINE = "D7DAD3",
  MUTE = "5A6468", MIDBLUE = "6E8F79", FOOT = "8A9088", SUBNAVY = "9DB3A6";
const GOLD = "C4A35A";
const DISP = "Georgia", BODY = "Calibri";
const W = 13.333, H = 7.5, MX = 0.62, CW = W - MX * 2;

// Sequential green heat scale for index/percentile cells (darker = stronger).
function heat(v: number): { fill: string; color: string } {
  if (v >= 88) return { fill: NAVY, color: PAPER };
  if (v >= 75) return { fill: MIDBLUE, color: PAPER };
  if (v >= 62) return { fill: "9DB89F", color: NAVY };
  if (v >= 50) return { fill: "C4D4C7", color: NAVY };
  return { fill: "E6EDE7", color: NAVY };
}
const RISK: Record<string, { fill: string; color: string }> = {
  H: { fill: "F0DCDA", color: "8A2B26" }, M: { fill: "EFE7D2", color: "7A5B14" }, L: { fill: "DFEAE1", color: "2F6D49" },
};

// The BGP wordmark as an image, so the logo renders correctly regardless of
// which fonts are installed where the deck is opened. `bone` = the light
// (white) mark used on dark grounds; `navy` = the dark (black) mark on light.
const WORDMARK = {
  bone: path.join(process.cwd(), "server", "assets", "branding", "BGP_WhiteWordmark_trimmed.png"),
  navy: path.join(process.cwd(), "server", "assets", "branding", "BGP_BlackWordmark_trimmed.png"),
};
const WM_AR = 2.53; // width:height of the BGP wordmark PNG
// A missing/empty/mislabelled wordmark file becomes a broken image part that
// PowerPoint "repairs" by stripping content — verify the bytes are a real PNG
// once, and fall back to the text wordmark otherwise.
const wmChecked = new Map<string, boolean>();
function isPngFile(file: string): boolean {
  if (wmChecked.has(file)) return wmChecked.get(file)!;
  let ok = false;
  try {
    const b = fs.readFileSync(file);
    ok = b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
  } catch { /* missing/unreadable → text fallback */ }
  wmChecked.set(file, ok);
  return ok;
}
function wordmark(s: any, x: number, y: number, h: number, onDark: boolean, rightEdge?: number) {
  const w = h * WM_AR;
  const xx = rightEdge != null ? rightEdge - w : x;
  const file = onDark ? WORDMARK.bone : WORDMARK.navy;
  if (isPngFile(file)) {
    try { s.addImage({ path: file, x: xx, y, w, h }); return; } catch { /* fall through */ }
  }
  s.addText("BGP", { x: xx, y, w, h, fontFace: DISP, bold: true, fontSize: h * 34, color: onDark ? BONE : NAVY });
}

// Parse **bold** spans into pptxgenjs text runs.
function runs(text: string, base: any): any[] {
  return String(text).split("**").map((seg, i) => ({ text: seg, options: { ...base, bold: i % 2 === 1 || base.bold } }));
}

// ── Card spec the renderers consume ───────────────────────────────────────
export interface DeckCard { type: string; [k: string]: any }
export interface DeckSpec { cards: DeckCard[]; linkUrl?: string }

// Set per-deck in assembleDeckPptx; footer() renders a "View in Pave" hyperlink
// back to the deck/deal in the app when present. Read only during the synchronous
// render loop, so it's safe across concurrent assembles.
let DECK_LINK: string | undefined;

type Slide = any;

// ── Shared furniture ───────────────────────────────────────────────────────
function lightHeader(s: Slide, kick: string, title: string, sub?: string) {
  s.background = { color: PAPER };
  wordmark(s, 0, 0.5, 0.52, false, W - MX);
  s.addText(kick.toUpperCase(), { x: MX, y: 0.52, w: CW - 2.2, h: 0.3, fontFace: BODY, fontSize: 7, bold: true, charSpacing: 2.5, color: MUTE });
  s.addText(title, { x: MX, y: 0.82, w: CW - 0.8, h: 0.62, fontFace: DISP, bold: true, fontSize: 18.1, color: NAVY });
  let y = 1.5;
  if (sub) { s.addText(sub, { x: MX, y: 1.46, w: CW - 0.8, h: 0.5, fontFace: BODY, fontSize: 8.4, color: "3A424D", lineSpacingMultiple: 1.15 }); y = 1.92; }
  return y;
}
function footer(s: Slide, note?: string) {
  s.addShape("line" as any, { x: MX, y: 7.02, w: CW, h: 0, line: { color: LINE, width: 1 } });
  // No wordmark here: content slides already carry the top-right wordmark from
  // lightHeader — a second, bottom-left logo doubled the branding on every page.
  s.addText("Strictly private & confidential", { x: W - MX - 4, y: 7.08, w: 4, h: 0.26, align: "right", fontFace: BODY, fontSize: 6.5, color: FOOT });
  if (DECK_LINK) s.addText("View in Pave ↗", { x: MX, y: 7.08, w: 2.6, h: 0.26, fontFace: BODY, fontSize: 6.8, color: MIDBLUE, hyperlink: { url: DECK_LINK, tooltip: "Open in Pave" } });
  if (note) s.addText(note, { x: MX, y: 6.62, w: CW, h: 0.36, fontFace: BODY, fontSize: 6.5, italic: true, color: FOOT, lineSpacingMultiple: 1.1 });
}
function bulletText(items: string[], base: any) {
  // Paragraph-level options (bullet, paraSpaceAfter, lineSpacingMultiple) may
  // ONLY ride on the FIRST run of a paragraph: pptxgenjs emits an <a:pPr> for
  // any run that carries them, and OOXML requires pPr to be the paragraph's
  // first child. A **bold** span used to split a bullet into runs that each
  // carried bullet:false + line spacing — producing mid-paragraph <a:pPr>
  // elements, which is exactly what made PowerPoint demand a "repair".
  const { lineSpacingMultiple, ...runBase } = base || {};
  const out: any[] = [];
  items.forEach((it) => {
    const segs = runs(it, runBase);
    segs.forEach((r, j) => {
      out.push({ text: r.text, options: { ...r.options,
        ...(j === 0 ? { bullet: { indent: 14 }, paraSpaceAfter: 5, ...(lineSpacingMultiple ? { lineSpacingMultiple } : {}) } : {}),
        breakLine: j === segs.length - 1 } });
    });
  });
  return out;
}

// ── Renderers ──────────────────────────────────────────────────────────────
function rCover(p: pptxgen, c: DeckCard) {
  const s = p.addSlide(); s.background = { color: NAVY };
  wordmark(s, MX, 0.6, 0.84, true);
  s.addText("STRICTLY PRIVATE & CONFIDENTIAL", { x: W - MX - 5, y: 0.74, w: 5, h: 0.3, align: "right", fontFace: BODY, fontSize: 6.5, charSpacing: 2.5, color: SUBNAVY });
  s.addText((c.eyebrow || "Investment Memorandum").toUpperCase(), { x: MX, y: 3.5, w: CW, h: 0.34, fontFace: BODY, fontSize: 7.7, bold: true, charSpacing: 3, color: BONE });
  s.addShape("rect" as any, { x: MX, y: 3.95, w: 2.0, h: 0.03, fill: { color: BONE }, line: { type: "none" } as any });
  s.addText(c.title || "Investment Memorandum", { x: MX, y: 4.12, w: CW * 0.86, h: 1.5, fontFace: DISP, bold: true, fontSize: 28.1, color: PAPER, lineSpacingMultiple: 1.02 });
  if (c.subtitle) s.addText(c.subtitle, { x: MX, y: 5.55, w: CW * 0.8, h: 0.5, fontFace: BODY, fontSize: 10.7, color: BONE });
  const meta: Array<{ label: string; value: string }> = Array.isArray(c.meta) ? c.meta : [];
  meta.slice(0, 4).forEach((m, i) => {
    const x = MX + i * 2.7;
    s.addText(m.value || "", { x, y: 6.1, w: 2.55, h: 0.3, fontFace: DISP, bold: true, fontSize: 8.4, color: PAPER });
    s.addText((m.label || "").toUpperCase(), { x, y: 6.38, w: 2.55, h: 0.26, fontFace: BODY, fontSize: 6.5, charSpacing: 1.5, color: "AEB9C7" });
  });
}

function rContents(p: pptxgen, c: DeckCard) {
  const s = p.addSlide(); s.background = { color: NAVY };
  s.addText("CONTENTS", { x: MX, y: 0.7, w: CW, h: 0.34, fontFace: BODY, fontSize: 7.4, bold: true, charSpacing: 3, color: BONE });
  const items: Array<any> = Array.isArray(c.items) ? c.items : [];
  let y = 1.45; const rowH = (6.6 - 1.45) / Math.max(items.length, 1);
  items.forEach((it, i) => {
    const n = it.n || String(i + 1).padStart(2, "0");
    s.addText(n, { x: MX, y, w: 1.0, h: rowH, valign: "middle", fontFace: DISP, bold: true, fontSize: 13.4, color: BONE });
    s.addText(it.title || "", { x: MX + 1.1, y, w: 6.5, h: rowH, valign: "middle", fontFace: DISP, fontSize: 13.4, color: PAPER });
    if (it.desc) s.addText(it.desc, { x: W - MX - 4.6, y, w: 4.6, h: rowH, align: "right", valign: "middle", fontFace: BODY, fontSize: 7.4, color: SUBNAVY });
    s.addShape("line" as any, { x: MX, y: y + rowH, w: CW, h: 0, line: { color: "2A3B52", width: 1 } });
    y += rowH;
  });
}

function rSection(p: pptxgen, c: DeckCard) {
  const s = p.addSlide(); s.background = { color: NAVY };
  s.addText("SECTION", { x: MX, y: 0.7, w: CW, h: 0.3, fontFace: BODY, fontSize: 7, bold: true, charSpacing: 3, color: SUBNAVY });
  s.addText(c.number || "01", { x: MX, y: 2.4, w: 6, h: 1.8, fontFace: DISP, bold: true, fontSize: 59, color: BONE });
  s.addShape("rect" as any, { x: MX + 0.05, y: 4.35, w: 1.9, h: 0.03, fill: { color: BONE }, line: { type: "none" } as any });
  s.addText(c.title || "Section", { x: MX, y: 4.55, w: CW * 0.8, h: 0.9, fontFace: DISP, fontSize: 22.8, color: PAPER });
  if (c.indexLine) s.addText(c.indexLine, { x: MX, y: 6.3, w: CW * 0.7, h: 0.4, fontFace: BODY, fontSize: 7.4, color: SUBNAVY });
  wordmark(s, 0, 6.35, 0.64, true, W - MX);
}

function rExecSummary(p: pptxgen, c: DeckCard) {
  const s = p.addSlide();
  lightHeader(s, c.kick || "Section 01 · Executive summary", c.title || "Executive summary");
  const bands: Array<any> = Array.isArray(c.bands) ? c.bands : [];
  const top = 1.62, bottom = 6.55, gap = 0.12;
  const labW = 2.7;
  const weights = bands.map((b) => Math.max(1, (b.bullets || []).length));
  const totalW = weights.reduce((a, b) => a + b, 0) || 1;
  const avail = bottom - top - gap * (bands.length - 1);
  let y = top;
  bands.forEach((b, i) => {
    const bh = Math.max(0.7, (weights[i] / totalW) * avail);
    s.addShape("rect" as any, { x: MX, y, w: labW, h: bh, fill: { color: NAVY }, line: { type: "none" } as any });
    s.addText([
      { text: b.label || "", options: { fontFace: DISP, bold: true, fontSize: 9, color: PAPER, breakLine: true } },
      ...(b.pageRef ? [{ text: b.pageRef, options: { fontFace: BODY, fontSize: 6.5, color: BONE, charSpacing: 1 } }] : []),
    ], { x: MX + 0.18, y, w: labW - 0.34, h: bh, valign: "middle" });
    s.addShape("rect" as any, { x: MX + labW, y, w: CW - labW, h: bh, fill: { color: PAPER }, line: { color: LINE, width: 1 } });
    s.addText(bulletText(b.bullets || [], { fontFace: BODY, fontSize: 7.4, color: "26303C", lineSpacingMultiple: 1.12 }),
      { x: MX + labW + 0.22, y: y + 0.08, w: CW - labW - 0.44, h: bh - 0.16, valign: "middle" });
    y += bh + gap;
  });
  if (c.footnote) footer(s, c.footnote); else footer(s);
}

// OOXML requires every table row to have exactly colW.length cells. pptxgenjs
// emits whatever it's given, so a short/long row makes the .pptx invalid →
// PowerPoint "found a problem with content → Repair", which strips the slide
// (the blue-screen bug). Pad short rows with blanks, drop any overflow.
function rectify(rows: any[][], ncol: number, blank: any = {}): any[][] {
  return rows.map((r) => {
    const row = r.slice(0, ncol);
    while (row.length < ncol) row.push({ text: "", options: { ...blank } });
    return row;
  });
}

function rRankedTable(p: pptxgen, c: DeckCard) {
  const s = p.addSlide();
  const y0 = lightHeader(s, c.kick || "Underwrite", c.title || "Comparable transactions — ranked", c.sub);
  const headers: string[] = c.headers || ["Rank", "Asset", "Location", "Index", "Index", "Index", "Risk", "Commentary"];
  const rows: Array<any> = Array.isArray(c.rows) ? c.rows : [];
  const head = headers.map((h, i) => ({ text: h, options: { fill: { color: NAVY }, color: BONE, bold: true, fontFace: BODY, fontSize: 6.5,
    align: (i >= 3 && i <= headers.length - 2) ? "center" : "left", valign: "bottom", margin: [4, 4, 4, 4] } }));
  const body = rows.map((r) => {
    const isSubj = !!r.subject;
    const cells: any[] = [];
    cells.push({ text: String(r.rank ?? ""), options: { fontFace: DISP, bold: true, color: NAVY, align: "center", valign: "middle" } });
    cells.push({ text: r.asset || "", options: { fontFace: BODY, bold: isSubj, color: NAVY, valign: "middle" } });
    cells.push({ text: r.location || "", options: { fontFace: BODY, color: "26303C", valign: "middle" } });
    (r.indices || []).slice(0, 3).forEach((v: number) => {
      const h = heat(Number(v)); cells.push({ text: String(v), options: { fill: { color: h.fill }, color: h.color, bold: true, align: "center", valign: "middle", fontFace: BODY } });
    });
    const rk = RISK[(r.risk || "M").toUpperCase()] || RISK.M;
    cells.push({ text: (r.risk || "M").toUpperCase() === "H" ? "High" : (r.risk || "M").toUpperCase() === "L" ? "Low" : "Med",
      options: { fill: { color: rk.fill }, color: rk.color, bold: true, align: "center", valign: "middle", fontFace: BODY, fontSize: 6.5 } });
    cells.push({ text: r.commentary || "", options: { fontFace: BODY, fontSize: 6.5, color: "4A525D", valign: "middle" } });
    return cells;
  });
  const rankedColW = [0.7, 2.5, 1.6, 1.15, 1.15, 1.15, 0.95, CW - 9.2];
  s.addTable(rectify([head, ...body], rankedColW.length, { fontFace: BODY }), { x: MX, y: y0 + 0.08, w: CW, colW: rankedColW,
    border: { type: "solid", pt: 0.5, color: LINE }, fontSize: 6.5, valign: "middle", rowH: 0.42, autoPage: false });
  footer(s, c.footnote);
}

function rCatchment(p: pptxgen, c: DeckCard) {
  const s = p.addSlide();
  const y0 = lightHeader(s, c.kick || "The asset", c.title || "Catchment & competitive position", c.sub);
  const mapW = 4.7, gap = 0.45;
  s.addShape("rect" as any, { x: MX, y: y0 + 0.1, w: mapW, h: 3.7, fill: { color: STONE }, line: { color: LINE, width: 1 } });
  s.addText((c.mapLabel || "15-min drive-time · catchment").toUpperCase(), { x: MX + 0.12, y: y0 + 0.22, w: mapW - 0.24, h: 0.3, fontFace: BODY, fontSize: 6.5, charSpacing: 1.5, color: NAVY });
  s.addText("[ map ]", { x: MX, y: y0 + 1.6, w: mapW, h: 0.4, align: "center", fontFace: BODY, fontSize: 7.4, italic: true, color: MUTE });
  const tx = MX + mapW + gap, tw = CW - mapW - gap;
  const trows: Array<any> = Array.isArray(c.table) ? c.table : [];
  const head = (c.tableHeaders || ["Catchment metric", "Site", "Regional %ile", "vs comp set"]).map((h: string, i: number) =>
    ({ text: h, options: { fill: { color: NAVY }, color: BONE, bold: true, fontFace: BODY, fontSize: 6.5, align: i ? "center" : "left", margin: [4, 4, 4, 4] } }));
  const body = trows.map((r) => {
    const cells: any[] = [{ text: r.label || "", options: { fontFace: BODY, bold: true, color: NAVY, valign: "middle" } }];
    (r.values || []).forEach((v: any, i: number) => {
      if (i < 2 && typeof v === "number") { const h = heat(v); cells.push({ text: String(v), options: { fill: { color: h.fill }, color: h.color, bold: true, align: "center", valign: "middle" } }); }
      else cells.push({ text: String(v), options: { align: "center", valign: "middle", fontFace: BODY, color: "26303C" } });
    });
    return cells;
  });
  s.addTable(rectify([head, ...body], 4, { fontFace: BODY }), { x: tx, y: y0 + 0.1, w: tw, colW: [tw - 4.05, 1.35, 1.35, 1.35], border: { type: "solid", pt: 0.5, color: LINE }, fontSize: 6.5, rowH: 0.36, autoPage: false });
  const by = y0 + 0.1 + (body.length + 1) * 0.36 + 0.2;
  s.addText(bulletText(c.bullets || [], { fontFace: BODY, fontSize: 7, color: "26303C", lineSpacingMultiple: 1.15 }),
    { x: tx, y: by, w: tw, h: 3.7 - (by - y0), valign: "top" });
  footer(s, c.footnote);
}

function rAssetOverview(p: pptxgen, c: DeckCard) {
  const s = p.addSlide();
  const y0 = lightHeader(s, c.kick || "The asset", c.title || "Asset overview", c.sub);
  const strip: Array<any> = Array.isArray(c.strip) ? c.strip : [];
  const n = Math.min(strip.length, 6) || 1, sw = (CW - (n - 1) * 0.12) / n;
  strip.slice(0, 6).forEach((m, i) => {
    const x = MX + i * (sw + 0.12);
    s.addShape("rect" as any, { x, y: y0 + 0.1, w: sw, h: 0.92, fill: { color: NAVY }, line: { type: "none" } as any });
    s.addText((m.label || "").toUpperCase(), { x: x + 0.12, y: y0 + 0.2, w: sw - 0.24, h: 0.26, fontFace: BODY, fontSize: 6.5, charSpacing: 1, color: BONE });
    s.addText(String(m.value ?? ""), { x: x + 0.12, y: y0 + 0.46, w: sw - 0.24, h: 0.46, fontFace: DISP, bold: true, fontSize: 10.1, color: PAPER });
  });
  const dy = y0 + 1.2, colW = (CW - 0.8) / 2.8;
  const tbl = (tx: number, tw: number, title: string, trows: Array<any>) => {
    s.addText(title.toUpperCase(), { x: tx, y: dy, w: tw, h: 0.28, fontFace: BODY, fontSize: 6.5, bold: true, charSpacing: 1.5, color: MUTE });
    const head = ["Metric", "Value", "%ile"].map((h, i) => ({ text: h, options: { fill: { color: NAVY }, color: BONE, bold: true, fontFace: BODY, fontSize: 6.5, align: i ? "center" : "left", margin: [3, 3, 3, 3] } }));
    const body = (trows || []).map((r) => {
      const h = heat(Number(r.pct) || 0);
      return [
        { text: r.label || "", options: { fontFace: BODY, bold: true, color: NAVY, valign: "middle" } },
        { text: String(r.value ?? ""), options: { align: "center", valign: "middle", fontFace: BODY, color: "26303C" } },
        { text: String(r.pct ?? ""), options: { fill: { color: h.fill }, color: h.color, bold: true, align: "center", valign: "middle" } },
      ];
    });
    s.addTable(rectify([head, ...body], 3, { fontFace: BODY }), { x: tx, y: dy + 0.32, w: tw, colW: [tw - 2.0, 1.0, 1.0], border: { type: "solid", pt: 0.5, color: LINE }, fontSize: 6.5, rowH: 0.32, autoPage: false });
  };
  const tables: Array<any> = Array.isArray(c.tables) ? c.tables : [];
  tbl(MX, colW, tables[0]?.title || "Trading", tables[0]?.rows || []);
  tbl(MX + colW + 0.4, colW, tables[1]?.title || "Valuation & optionality", tables[1]?.rows || []);
  const vx = MX + 2 * (colW + 0.4), vw = CW - (vx - MX);
  s.addText("PAVE VERDICT", { x: vx, y: dy, w: vw, h: 0.28, fontFace: BODY, fontSize: 6.5, bold: true, charSpacing: 1.5, color: MUTE });
  const verdict: Array<any> = Array.isArray(c.verdict) ? c.verdict : [];
  s.addText(verdict.map((v) => ({ text: `${v.ok ? "✓" : "✗"}  ${v.text || ""}`,
    options: { fontFace: BODY, fontSize: 6.7, color: v.ok ? "2F6D49" : "8A2B26", bold: false, breakLine: true, paraSpaceAfter: 7 } })),
    { x: vx, y: dy + 0.34, w: vw, h: 2.4, valign: "top" });
  footer(s, c.footnote);
}

function rKpi(p: pptxgen, c: DeckCard) {
  const s = p.addSlide();
  const y0 = lightHeader(s, c.kick || "Key numbers", c.title || "Key numbers", c.sub);
  const kpis: Array<any> = Array.isArray(c.kpis) ? c.kpis : [];
  const n = Math.min(kpis.length, 4) || 1, colW = CW / n;
  kpis.slice(0, 4).forEach((k, i) => {
    const x = MX + i * colW;
    if (i > 0) s.addShape("line" as any, { x, y: y0 + 0.5, w: 0, h: 2.4, line: { color: LINE, width: 1 } });
    const px = x + (i ? 0.3 : 0);
    s.addText(String(k.value ?? "—"), { x: px, y: y0 + 0.7, w: colW - 0.4, h: 1.0, fontFace: DISP, bold: true, fontSize: 26.8, color: NAVY });
    s.addShape("rect" as any, { x: px + 0.02, y: y0 + 1.78, w: 0.32, h: 0.03, fill: { color: BONE }, line: { type: "none" } as any });
    s.addText(k.label || "", { x: px, y: y0 + 1.95, w: colW - 0.5, h: 0.9, fontFace: BODY, fontSize: 7.4, color: MUTE, lineSpacingMultiple: 1.2 });
  });
  footer(s, c.footnote);
}

function rContent(p: pptxgen, c: DeckCard) {
  const s = p.addSlide();
  const y0 = lightHeader(s, c.kick || c.section || "Analysis", c.title || "");
  const data: string | undefined = c.dataUri || c.image;
  const hasImg = !!(data && RASTER_RE.test(data));
  const textW = hasImg ? CW * 0.56 : CW * 0.82;
  let y = y0 + 0.1;
  if (c.lead) { s.addText(c.lead, { x: MX, y, w: textW, h: 1.2, fontFace: DISP, fontSize: 14.1, color: NAVY, lineSpacingMultiple: 1.18 }); y += 1.4; }
  if (Array.isArray(c.bullets) && c.bullets.length) {
    s.addText(bulletText(c.bullets, { fontFace: BODY, fontSize: 8.7, color: "1D2733", lineSpacingMultiple: 1.3 }), { x: MX, y, w: textW, h: 6.4 - y, valign: "top" });
  } else if (c.body) {
    s.addText(c.body, { x: MX, y, w: textW, h: 6.4 - y, fontFace: BODY, fontSize: 9.4, color: "1D2733", lineSpacingMultiple: 1.4, valign: "top" });
  }
  if (hasImg) {
    const ix = MX + CW * 0.6, iw = CW * 0.4, iy = y0 + 0.1, ih = 6.25 - (y0 + 0.1);
    const ar = (c.w && c.h) ? c.w / c.h : 1.4;
    let w = iw, h = w / ar; if (h > ih) { h = ih; w = h * ar; }
    try { s.addImage({ data, x: ix + (iw - w) / 2, y: iy + (ih - h) / 2, w, h }); } catch {}
    if (c.caption) s.addText(c.caption, { x: ix, y: 6.3, w: iw, h: 0.24, align: "center", fontFace: BODY, fontSize: 6.5, italic: true, color: FOOT });
  }
  footer(s, c.footnote);
}

function rTable(p: pptxgen, c: DeckCard) {
  const s = p.addSlide();
  const y0 = lightHeader(s, c.kick || "Data", c.title || "Table", c.sub);
  const headers: string[] = c.headers || [];
  const rows: string[][] = Array.isArray(c.rows) ? c.rows : [];
  const ncol = headers.length || (rows[0] ? rows[0].length : 1);
  const head = headers.map((h, i) => ({ text: h, options: { fill: { color: NAVY }, color: BONE, bold: true, fontFace: BODY, fontSize: 6.5, align: i ? "center" : "left", margin: [5, 5, 5, 5] } }));
  const body = rows.map((r, ri) => r.map((cell, i) => ({ text: String(cell ?? ""), options: { fontFace: BODY, fontSize: 7.4, color: i ? "26303C" : NAVY, bold: i === 0, align: i ? "center" : "left", valign: "middle", fill: ri % 2 ? { color: STONE } : { color: PAPER } } })));
  s.addTable(rectify(head.length ? [head, ...body] : body, ncol, { fontFace: BODY, fontSize: 7.4 }), { x: MX, y: y0 + 0.1, w: CW, colW: Array(ncol).fill(CW / ncol), border: { type: "solid", pt: 0.5, color: LINE }, valign: "middle", rowH: 0.45, autoPage: false });
  footer(s, c.footnote);
}

function rRisk(p: pptxgen, c: DeckCard) {
  const s = p.addSlide();
  const y0 = lightHeader(s, c.kick || "Risk & mitigation", c.title || "Where the thesis breaks", c.sub);
  const items: Array<any> = Array.isArray(c.items) ? c.items : [];
  const head = ["Risk", "Severity", "Mitigant"].map((h, i) => ({ text: h, options: { fill: { color: NAVY }, color: BONE, bold: true, fontFace: BODY, fontSize: 6.5, align: i === 1 ? "center" : "left", margin: [5, 5, 5, 5] } }));
  const body = items.map((it) => {
    const lvl = (it.severity || "M").toString().toUpperCase().startsWith("H") ? "H" : (it.severity || "M").toString().toUpperCase().startsWith("L") ? "L" : "M";
    const rk = RISK[lvl];
    return [
      { text: it.risk || "", options: { fontFace: BODY, fontSize: 7.7, bold: true, color: NAVY, valign: "middle" } },
      { text: lvl === "H" ? "High" : lvl === "L" ? "Low" : "Med", options: { fill: { color: rk.fill }, color: rk.color, bold: true, align: "center", valign: "middle", fontFace: BODY, fontSize: 6.5 } },
      { text: it.mitigant || "", options: { fontFace: BODY, fontSize: 7.4, color: "26303C", valign: "middle" } },
    ];
  });
  s.addTable(rectify([head, ...body], 3, { fontFace: BODY }), { x: MX, y: y0 + 0.1, w: CW, colW: [4.6, 1.4, CW - 6.0], border: { type: "solid", pt: 0.5, color: LINE }, valign: "middle", rowH: 0.5, autoPage: false });
  footer(s, c.footnote);
}

function rClosing(p: pptxgen, c: DeckCard) {
  const s = p.addSlide(); s.background = { color: NAVY };
  s.addText((c.eyebrow || "In closing").toUpperCase(), { x: MX, y: 2.2, w: CW, h: 0.34, fontFace: BODY, fontSize: 7.4, bold: true, charSpacing: 3, color: BONE });
  s.addText(c.heading || c.title || "Recommendation", { x: MX, y: 2.65, w: CW * 0.88, h: 1.4, fontFace: DISP, bold: true, fontSize: 22.8, color: PAPER, lineSpacingMultiple: 1.05 });
  if (c.body) s.addText(c.body, { x: MX, y: 4.2, w: CW * 0.7, h: 1.4, fontFace: BODY, fontSize: 10.1, color: BONE, lineSpacingMultiple: 1.3 });
  s.addShape("line" as any, { x: MX, y: 6.35, w: CW, h: 0, line: { color: "33445B", width: 1 } });
  wordmark(s, MX, 6.3, 0.68, true);
  s.addText(c.contacts || "Bruce Gillingham Pollard", { x: W - MX - 6, y: 6.58, w: 6, h: 0.32, align: "right", fontFace: BODY, fontSize: 7, color: SUBNAVY });
}

// Only embed image payloads whose BYTES are genuinely PNG/JPEG/GIF — a data URI
// with the right label but broken/empty content becomes an image part PowerPoint
// "repairs" by stripping (which is how the site photos vanished).
function isRasterDataUri(data?: string | null): boolean {
  const m = /^data:image\/(png|jpe?g|gif);base64,([A-Za-z0-9+/=]{8,})/i.exec(data || "");
  if (!m) return false;
  try {
    const head = Buffer.from(m[2].slice(0, 12), "base64");
    return (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) // PNG
      || (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff)                        // JPEG
      || (head[0] === 0x47 && head[1] === 0x49 && head[2] === 0x46);                       // GIF
  } catch { return false; }
}

// Image slide: a photo/chart carried across from a source deck. The data URI is
// resolved from the card's `ref` at assemble time. Fits the image into the
// content area preserving its aspect ratio.
function rImage(p: pptxgen, c: DeckCard) {
  const s = p.addSlide();
  const y0 = c.title ? lightHeader(s, c.kick || "Exhibit", c.title, c.sub) : 0.6;
  const data: string | undefined = c.dataUri || c.image;
  if (data && isRasterDataUri(data)) {
    const availW = CW, availH = H - y0 - 0.8;
    const ar = (c.w && c.h) ? c.w / c.h : 1.5;
    let w = availW, h = w / ar;
    if (h > availH) { h = availH; w = h * ar; }
    const x = MX + (CW - w) / 2, y = y0 + 0.1 + (availH - h) / 2;
    try { s.addImage({ data, x, y, w, h }); } catch {}
  }
  if (c.caption) footer(s, c.caption);
}

// Two-column bullets (e.g. strengths | upside, covenant | location).
function rTwoCol(p: pptxgen, c: DeckCard) {
  const s = p.addSlide();
  const y0 = lightHeader(s, c.kick || "Overview", c.title || "", c.sub);
  const colW = (CW - 0.5) / 2;
  const cols = [{ title: c.leftTitle, items: c.left }, { title: c.rightTitle, items: c.right }];
  cols.forEach((col, i) => {
    const x = MX + i * (colW + 0.5);
    let y = y0 + 0.1;
    if (col.title) {
      s.addText(String(col.title).toUpperCase(), { x, y, w: colW, h: 0.3, fontFace: BODY, fontSize: 7, bold: true, charSpacing: 2, color: MUTE });
      s.addShape("rect" as any, { x: x + 0.02, y: y + 0.34, w: 0.32, h: 0.03, fill: { color: BONE }, line: { type: "none" } as any });
      y += 0.52;
    }
    if (Array.isArray(col.items) && col.items.length) {
      s.addText(bulletText(col.items, { fontFace: BODY, fontSize: 8.7, color: "1D2733", lineSpacingMultiple: 1.3 }), { x, y, w: colW, h: 6.3 - y, valign: "top" });
    }
  });
  footer(s, c.footnote);
}

// Labelled stat panels side by side (e.g. Day one vs Reversion returns).
function rReturns(p: pptxgen, c: DeckCard) {
  const s = p.addSlide();
  const y0 = lightHeader(s, c.kick || "Returns", c.title || "Returns", c.sub);
  const groups: Array<any> = Array.isArray(c.groups) ? c.groups.slice(0, 3) : [];
  const n = groups.length || 1, gap = 0.4, panelW = (CW - gap * (n - 1)) / n, panelH = 3.5;
  groups.forEach((g, i) => {
    const x = MX + i * (panelW + gap);
    s.addShape("rect" as any, { x, y: y0 + 0.1, w: panelW, h: panelH, fill: { color: STONE }, line: { color: LINE, width: 1 } });
    s.addText(String(g.label || "").toUpperCase(), { x: x + 0.25, y: y0 + 0.32, w: panelW - 0.5, h: 0.34, fontFace: BODY, fontSize: 7.4, bold: true, charSpacing: 2, color: NAVY });
    s.addShape("rect" as any, { x: x + 0.27, y: y0 + 0.7, w: 0.34, h: 0.03, fill: { color: BONE }, line: { type: "none" } as any });
    const items: Array<any> = Array.isArray(g.items) ? g.items.slice(0, 6) : [];
    let yy = y0 + 0.94;
    items.forEach((it) => {
      s.addText(String(it.k ?? it.label ?? ""), { x: x + 0.25, y: yy, w: panelW - 1.7, h: 0.36, fontFace: BODY, fontSize: 7.7, color: MUTE, valign: "middle" });
      s.addText(String(it.v ?? it.value ?? ""), { x: x + panelW - 1.65, y: yy, w: 1.4, h: 0.36, fontFace: DISP, bold: true, fontSize: 9.4, color: NAVY, align: "right", valign: "middle" });
      yy += 0.42;
    });
  });
  if (c.note) s.addText(c.note, { x: MX, y: y0 + 0.1 + panelH + 0.25, w: CW, h: 1.1, fontFace: BODY, fontSize: 8.4, italic: true, color: "3A424D", lineSpacingMultiple: 1.25, valign: "top" });
  footer(s, c.footnote);
}

// Schedule table on the left + a hero image on the right, optional spec bullets.
function rScheduleHero(p: pptxgen, c: DeckCard) {
  const s = p.addSlide();
  const y0 = lightHeader(s, c.kick || "The asset", c.title || "Accommodation", c.sub);
  const tableW = CW * 0.56, imgX = MX + tableW + 0.4, imgW = CW - tableW - 0.4, imgY = y0 + 0.1, imgH = 3.6;
  const headers: string[] = c.headers || [];
  const rows: string[][] = Array.isArray(c.rows) ? c.rows : [];
  const ncol = headers.length || (rows[0] ? rows[0].length : 1);
  if (ncol && (headers.length || rows.length)) {
    const head = headers.map((h, i) => ({ text: h, options: { fill: { color: NAVY }, color: BONE, bold: true, fontFace: BODY, fontSize: 6.5, align: i ? "center" : "left", margin: [5, 5, 5, 5] } }));
    const body = rows.map((r, ri) => r.map((cell, i) => ({ text: String(cell ?? ""), options: { fontFace: BODY, fontSize: 7, color: i ? "26303C" : NAVY, bold: i === 0, align: i ? "center" : "left", valign: "middle", fill: ri % 2 ? { color: STONE } : { color: PAPER } } })));
    s.addTable(rectify(head.length ? [head, ...body] : body, ncol, { fontFace: BODY }), { x: MX, y: y0 + 0.1, w: tableW, colW: Array(ncol).fill(tableW / ncol), border: { type: "solid", pt: 0.5, color: LINE }, valign: "middle", rowH: 0.42, autoPage: false });
  }
  const data: string | undefined = c.dataUri || c.image;
  if (data && /^data:image\/(png|jpe?g|gif);base64,/i.test(data)) {
    const ar = (c.w && c.h) ? c.w / c.h : 1.4;
    let w = imgW, h = w / ar; if (h > imgH) { h = imgH; w = h * ar; }
    try { s.addImage({ data, x: imgX + (imgW - w) / 2, y: imgY + (imgH - h) / 2, w, h }); } catch {}
  } else {
    s.addShape("rect" as any, { x: imgX, y: imgY, w: imgW, h: imgH, fill: { color: STONE }, line: { color: LINE, width: 1 } });
    s.addText(c.caption || "Image", { x: imgX, y: imgY + imgH / 2 - 0.2, w: imgW, h: 0.4, align: "center", fontFace: BODY, fontSize: 7.4, color: MUTE });
  }
  if (Array.isArray(c.bullets) && c.bullets.length) {
    s.addText(bulletText(c.bullets, { fontFace: BODY, fontSize: 7.7, color: "1D2733", lineSpacingMultiple: 1.25 }), { x: MX, y: 5.35, w: CW, h: 1.25, valign: "top" });
  }
  footer(s, c.footnote);
}

// Large pull-quote / testimonial.
function rQuote(p: pptxgen, c: DeckCard) {
  const s = p.addSlide(); s.background = { color: STONE };
  s.addText("“", { x: MX - 0.05, y: 0.9, w: 2, h: 1.6, fontFace: DISP, bold: true, fontSize: 87.1, color: BONE });
  s.addText(c.quote || c.body || c.title || "", { x: MX + 0.1, y: 2.4, w: CW - 1.0, h: 2.7, fontFace: DISP, italic: true, fontSize: 17.4, color: NAVY, lineSpacingMultiple: 1.2, valign: "top" });
  if (c.attribution || c.author) s.addText("— " + (c.attribution || c.author), { x: MX + 0.1, y: 5.3, w: CW - 1.0, h: 0.5, fontFace: BODY, fontSize: 8.7, bold: true, color: MUTE });
  footer(s, c.footnote);
}

// Full-bleed navy statement for section transitions / key messages.
function rStatement(p: pptxgen, c: DeckCard) {
  const s = p.addSlide(); s.background = { color: NAVY };
  if (c.kick || c.eyebrow) s.addText(String(c.kick || c.eyebrow).toUpperCase(), { x: MX, y: 2.55, w: CW, h: 0.34, align: "center", fontFace: BODY, fontSize: 7.4, bold: true, charSpacing: 3, color: BONE });
  s.addText(c.title || c.heading || c.body || "", { x: MX + 0.8, y: 2.95, w: CW - 1.6, h: 1.9, align: "center", fontFace: DISP, bold: true, fontSize: 22.8, color: PAPER, lineSpacingMultiple: 1.08, valign: "middle" });
  if (c.sub) s.addText(c.sub, { x: MX + 1.6, y: 4.85, w: CW - 3.2, h: 0.9, align: "center", fontFace: BODY, fontSize: 9.4, color: SUBNAVY, lineSpacingMultiple: 1.25 });
  wordmark(s, 0, 6.75, 0.42, true, W / 2 + (WM_AR * 0.42) / 2);
}

// Horizontal milestone timeline / roadmap.
function rTimeline(p: pptxgen, c: DeckCard) {
  const s = p.addSlide();
  const y0 = lightHeader(s, c.kick || "Roadmap", c.title || "Timeline", c.sub);
  const ms: Array<any> = Array.isArray(c.milestones) ? c.milestones.slice(0, 5) : [];
  const n = ms.length || 1, step = CW / n, y = y0 + 1.1;
  s.addShape("line" as any, { x: MX, y, w: CW, h: 0, line: { color: LINE, width: 2 } });
  ms.forEach((m, i) => {
    const cx = MX + i * step + step / 2;
    s.addShape("ellipse" as any, { x: cx - 0.1, y: y - 0.1, w: 0.2, h: 0.2, fill: { color: NAVY }, line: { color: BONE, width: 1.5 } });
    s.addText(String(m.date || m.label || ""), { x: cx - step / 2 + 0.1, y: y - 0.72, w: step - 0.2, h: 0.34, align: "center", fontFace: BODY, fontSize: 7, bold: true, charSpacing: 1, color: MUTE });
    s.addText(String(m.title || ""), { x: cx - step / 2 + 0.1, y: y + 0.28, w: step - 0.2, h: 0.6, align: "center", fontFace: DISP, bold: true, fontSize: 8.7, color: NAVY, valign: "top" });
    if (m.body) s.addText(String(m.body), { x: cx - step / 2 + 0.15, y: y + 0.92, w: step - 0.3, h: 1.6, align: "center", fontFace: BODY, fontSize: 6.7, color: "3A424D", lineSpacingMultiple: 1.15, valign: "top" });
  });
  footer(s, c.footnote);
}

// Team / people grid.
function rTeam(p: pptxgen, c: DeckCard) {
  const s = p.addSlide();
  const y0 = lightHeader(s, c.kick || "Team", c.title || "Team", c.sub);
  const ppl: Array<any> = Array.isArray(c.people) ? c.people.slice(0, 8) : [];
  const cols = ppl.length <= 4 ? (ppl.length || 1) : 4;
  const cw = (CW - (cols - 1) * 0.4) / cols, chh = 1.7;
  ppl.forEach((m, i) => {
    const r = Math.floor(i / cols), col = i % cols;
    const x = MX + col * (cw + 0.4), yy = y0 + 0.2 + r * (chh + 0.3);
    s.addShape("rect" as any, { x, y: yy, w: cw, h: chh, fill: { color: STONE }, line: { color: LINE, width: 1 } });
    s.addText(String(m.name || ""), { x: x + 0.22, y: yy + 0.22, w: cw - 0.44, h: 0.42, fontFace: DISP, bold: true, fontSize: 9.4, color: NAVY });
    s.addText(String(m.role || "").toUpperCase(), { x: x + 0.22, y: yy + 0.66, w: cw - 0.44, h: 0.32, fontFace: BODY, fontSize: 6.5, bold: true, charSpacing: 1.2, color: MUTE });
    if (m.note) s.addText(String(m.note), { x: x + 0.22, y: yy + 1.02, w: cw - 0.44, h: 0.58, fontFace: BODY, fontSize: 6.5, color: "3A424D", lineSpacingMultiple: 1.12, valign: "top" });
  });
  footer(s, c.footnote);
}

// Comparison matrix — options across the top, criteria down the side.
function rComparison(p: pptxgen, c: DeckCard) {
  const s = p.addSlide();
  const y0 = lightHeader(s, c.kick || "Comparison", c.title || "How we compare", c.sub);
  const cols: string[] = Array.isArray(c.columns) ? c.columns : [];
  const rows: Array<any> = Array.isArray(c.rows) ? c.rows : [];
  const ncol = cols.length + 1;
  const head = ["", ...cols].map((h, i) => ({ text: h, options: { fill: { color: i ? NAVY : PAPER }, color: i ? BONE : NAVY, bold: true, fontFace: BODY, fontSize: 6.7, align: (i ? "center" : "left") as any, margin: [5, 5, 5, 5] } }));
  const mark = (v: any): { t: string; c: string } => {
    const sv = String(v ?? "").trim().toLowerCase();
    if (["true", "yes", "y", "1", "✓"].includes(sv)) return { t: "✓", c: "2F6D49" };
    if (["false", "no", "n", "0", "✗", "-", ""].includes(sv)) return { t: "—", c: MUTE };
    return { t: String(v), c: "26303C" };
  };
  const body = rows.map((r, ri) => {
    const cells: any[] = Array.isArray(r.cells) ? r.cells : [];
    const fill = ri % 2 ? { color: STONE } : { color: PAPER };
    return [
      { text: r.label || "", options: { fontFace: BODY, fontSize: 7.4, bold: true, color: NAVY, valign: "middle", fill } },
      ...cols.map((_, ci) => { const m = mark(cells[ci]); return { text: m.t, options: { align: "center" as any, valign: "middle" as any, fontFace: BODY, fontSize: m.t.length <= 1 ? 14 : 10.5, bold: m.t.length <= 1, color: m.c, fill } }; }),
    ];
  });
  const rest = (CW * 0.66) / (cols.length || 1);
  s.addTable(rectify([head, ...body], ncol, { fontFace: BODY }), { x: MX, y: y0 + 0.1, w: CW, colW: [CW * 0.34, ...cols.map(() => rest)], border: { type: "solid", pt: 0.5, color: LINE }, valign: "middle", rowH: 0.5, autoPage: false });
  footer(s, c.footnote);
}

// Native chart (bar / line / pie / doughnut / area).
function rChart(p: pptxgen, c: DeckCard) {
  const s = p.addSlide();
  const y0 = lightHeader(s, c.kick || "Data", c.title || "Chart", c.sub);
  const allowed = ["bar", "line", "pie", "doughnut", "area"];
  const ct = allowed.includes(String(c.chartType || "bar").toLowerCase()) ? String(c.chartType).toLowerCase() : "bar";
  let data: any[] = [];
  if (Array.isArray(c.series) && c.series.length) data = c.series.map((sr: any) => ({ name: sr.name || "", labels: sr.labels || c.labels || [], values: (sr.values || []).map(Number) }));
  else if (Array.isArray(c.labels) && Array.isArray(c.values)) data = [{ name: c.title || "Series", labels: c.labels, values: c.values.map(Number) }];
  if (!data.length) { footer(s, c.footnote); return; }
  const palette = ["2E5E3F", "6E8F79", "9DB89F", "C4D4C7", "1A3A28", "C4A35A"];
  const multi = data.length > 1 || ct === "pie" || ct === "doughnut";
  try {
    s.addChart(ct as any, data, { x: MX, y: y0 + 0.15, w: CW, h: 4.6, chartColors: palette, showLegend: multi, legendPos: "b", legendFontFace: BODY, legendColor: MUTE, catAxisLabelColor: MUTE, valAxisLabelColor: MUTE, catAxisLabelFontFace: BODY, valAxisLabelFontFace: BODY, catAxisLabelFontSize: 10, valAxisLabelFontSize: 10, showTitle: false, dataLabelColor: NAVY, dataLabelFontFace: BODY } as any);
  } catch { /* bad chart data — skip rather than abort the deck */ }
  footer(s, c.footnote);
}

const RASTER_RE = /^data:image\/(png|jpe?g|gif);base64,/i;

// One tile inside a board, drawn into an absolute rect (inches).
function renderBlock(p: pptxgen, s: Slide, b: any, x: number, y: number, w: number, h: number) {
  const kind = String(b.kind || b.type || "text").toLowerCase();
  const pad = 0.18;
  if (kind === "image" || kind === "photo") {
    const data = b.dataUri || b.image;
    if (data && RASTER_RE.test(data)) {
      const ar = (b.w && b.h) ? b.w / b.h : w / h;
      let iw = w, ih = iw / ar; if (ih > h) { ih = h; iw = ih * ar; }
      try { s.addImage({ data, x: x + (w - iw) / 2, y: y + (h - ih) / 2, w: iw, h: ih }); } catch {}
    } else {
      s.addShape("rect" as any, { x, y, w, h, fill: { color: STONE }, line: { color: LINE, width: 1 } });
      s.addText(b.caption || "Image", { x, y: y + h / 2 - 0.15, w, h: 0.3, align: "center", fontFace: BODY, fontSize: 6.7, color: MUTE });
    }
    return;
  }
  if (kind === "stat" || kind === "kpi") {
    s.addShape("rect" as any, { x, y, w, h, fill: { color: STONE }, line: { color: LINE, width: 1 } });
    s.addText(String(b.value ?? "—"), { x: x + pad, y: y + h * 0.14, w: w - pad * 2, h: h * 0.5, fontFace: DISP, bold: true, fontSize: Math.max(20, Math.min(40, h * 46)), color: NAVY, valign: "middle" });
    s.addText(b.label || "", { x: x + pad, y: y + h * 0.64, w: w - pad * 2, h: h * 0.32, fontFace: BODY, fontSize: 7, color: MUTE, valign: "top", lineSpacingMultiple: 1.1 });
    return;
  }
  if (kind === "chart") {
    const allowed = ["bar", "line", "pie", "doughnut", "area"];
    const ct = allowed.includes(String(b.chartType || "bar").toLowerCase()) ? String(b.chartType).toLowerCase() : "bar";
    let data: any[] = [];
    if (Array.isArray(b.series) && b.series.length) data = b.series.map((sr: any) => ({ name: sr.name || "", labels: sr.labels || b.labels || [], values: (sr.values || []).map(Number) }));
    else if (Array.isArray(b.labels) && Array.isArray(b.values)) data = [{ name: b.title || "", labels: b.labels, values: b.values.map(Number) }];
    let cy = y, chh = h;
    if (b.title) { s.addText(b.title, { x: x + pad, y, w: w - pad * 2, h: 0.3, fontFace: BODY, bold: true, fontSize: 7, color: NAVY }); cy = y + 0.34; chh = h - 0.34; }
    if (data.length) try { s.addChart(ct as any, data, { x, y: cy, w, h: chh, chartColors: ["2E5E3F", "6E8F79", "9DB89F", "C4D4C7"], showLegend: false, showTitle: false, catAxisLabelColor: MUTE, valAxisLabelColor: MUTE, catAxisLabelFontFace: BODY, valAxisLabelFontFace: BODY, catAxisLabelFontSize: 8, valAxisLabelFontSize: 8 } as any); } catch {}
    return;
  }
  if (kind === "table") {
    const headers: string[] = b.headers || [];
    const rows: string[][] = Array.isArray(b.rows) ? b.rows : [];
    const ncol = headers.length || (rows[0] ? rows[0].length : 1);
    const head = headers.map((hh, i) => ({ text: hh, options: { fill: { color: NAVY }, color: BONE, bold: true, fontFace: BODY, fontSize: 6.5, align: (i ? "center" : "left") as any, margin: [3, 3, 3, 3] } }));
    const body = rows.map((r, ri) => r.map((cell, i) => ({ text: String(cell ?? ""), options: { fontFace: BODY, fontSize: 6.5, color: i ? "26303C" : NAVY, bold: i === 0, align: (i ? "center" : "left") as any, valign: "middle" as any, fill: ri % 2 ? { color: STONE } : { color: PAPER } } })));
    s.addTable(rectify(head.length ? [head, ...body] : body, ncol, { fontFace: BODY }), { x, y, w, colW: Array(ncol).fill(w / ncol), border: { type: "solid", pt: 0.5, color: LINE }, valign: "middle", rowH: Math.min(0.4, h / ((rows.length || 1) + 1)), autoPage: false });
    return;
  }
  if (kind === "quote") {
    s.addShape("rect" as any, { x, y, w, h, fill: { color: NAVY }, line: { type: "none" } as any });
    s.addText(b.quote || b.body || "", { x: x + pad, y: y + pad, w: w - pad * 2, h: h - pad * 3, fontFace: DISP, italic: true, fontSize: 9, color: PAPER, valign: "top", lineSpacingMultiple: 1.2 });
    if (b.attribution) s.addText("— " + b.attribution, { x: x + pad, y: y + h - 0.46, w: w - pad * 2, h: 0.32, fontFace: BODY, fontSize: 6.5, color: BONE });
    return;
  }
  // text tile: optional label + bullets or body
  let ty = y;
  if (b.title) { s.addText(String(b.title).toUpperCase(), { x: x + pad, y: ty, w: w - pad * 2, h: 0.32, fontFace: BODY, bold: true, charSpacing: 1.5, fontSize: 6.7, color: MUTE }); ty += 0.4; }
  if (Array.isArray(b.bullets) && b.bullets.length) s.addText(bulletText(b.bullets, { fontFace: BODY, fontSize: 7, color: "1D2733", lineSpacingMultiple: 1.25 }), { x: x + pad, y: ty, w: w - pad * 2, h: y + h - ty, valign: "top" });
  else if (b.body || b.lead) s.addText(b.body || b.lead, { x: x + pad, y: ty, w: w - pad * 2, h: y + h - ty, fontFace: b.lead && !b.body ? DISP : BODY, fontSize: b.lead && !b.body ? 15 : 11, color: b.lead && !b.body ? NAVY : "1D2733", lineSpacingMultiple: 1.3, valign: "top" });
}

// A dense composite "board": multiple tiles (text / stat / chart / image /
// table / quote) placed on a 12-column grid — one slide, many elements, like a
// real PowerPoint content board. Each block: {kind, col, colSpan, row, rowSpan, …}.
function rBoard(p: pptxgen, c: DeckCard) {
  const s = p.addSlide();
  const y0 = lightHeader(s, c.kick || "Overview", c.title || "", c.sub);
  const blocks: any[] = Array.isArray(c.blocks) ? c.blocks : [];
  const bodyTop = y0 + 0.12, bodyBottom = 6.45, bodyH = bodyBottom - bodyTop;
  const rowsTotal = Math.max(1, ...blocks.map((b) => (b.row || 0) + (b.rowSpan || 1)));
  const colW = CW / 12, rowH = bodyH / rowsTotal, gap = 0.14;
  for (const b of blocks) {
    const col = Math.max(0, Math.min(11, b.col ?? 0));
    const cs = Math.max(1, Math.min(12 - col, b.colSpan ?? 6));
    const row = Math.max(0, b.row ?? 0), rs = Math.max(1, b.rowSpan ?? 1);
    const x = MX + col * colW + gap / 2, y = bodyTop + row * rowH + gap / 2;
    const w = cs * colW - gap, h = rs * rowH - gap;
    try { renderBlock(p, s, b, x, y, w, h); } catch { /* skip a bad tile */ }
  }
  footer(s, c.footnote);
}

// Fine-print / legal slide (disclaimer, important information).
function rDisclaimer(p: pptxgen, c: DeckCard) {
  const s = p.addSlide();
  const y0 = lightHeader(s, c.kick || "Important information", c.title || "Disclaimer", c.sub);
  const paras: string[] = Array.isArray(c.paragraphs) ? c.paragraphs : (c.body ? String(c.body).split(/\n\n+/) : []);
  const twoCol = paras.length > 4;
  const runsOut = paras.map((para) => ({ text: para, options: { fontFace: BODY, fontSize: 6.5, color: "3A424D", lineSpacingMultiple: 1.2, paraSpaceAfter: 6 } }));
  if (twoCol) {
    const mid = Math.ceil(paras.length / 2), colW = (CW - 0.5) / 2;
    s.addText(runsOut.slice(0, mid) as any, { x: MX, y: y0 + 0.1, w: colW, h: 6.35 - y0, valign: "top" });
    s.addText(runsOut.slice(mid) as any, { x: MX + colW + 0.5, y: y0 + 0.1, w: colW, h: 6.35 - y0, valign: "top" });
  } else {
    s.addText((runsOut.length ? runsOut : [{ text: c.body || "", options: { fontFace: BODY, fontSize: 6.5, color: "3A424D" } }]) as any, { x: MX, y: y0 + 0.1, w: CW, h: 6.35 - y0, valign: "top" });
  }
  footer(s, c.footnote);
}

// Key-highlights callout grid — several equal titled cards (e.g. teaser "why
// this asset" boxes).
function rHighlights(p: pptxgen, c: DeckCard) {
  const s = p.addSlide();
  const y0 = lightHeader(s, c.kick || "Highlights", c.title || "Investment highlights", c.sub);
  const items: Array<any> = Array.isArray(c.items) ? c.items.slice(0, 6) : [];
  const n = items.length || 1, cols = n <= 2 ? n : n <= 4 ? 2 : 3, rows = Math.ceil(n / cols);
  const gap = 0.35, areaTop = y0 + 0.15, areaBottom = 6.4, areaH = areaBottom - areaTop;
  const cw = (CW - (cols - 1) * gap) / cols, chh = (areaH - (rows - 1) * gap) / rows;
  items.forEach((it, i) => {
    const r = Math.floor(i / cols), col = i % cols;
    const x = MX + col * (cw + gap), y = areaTop + r * (chh + gap);
    s.addShape("rect" as any, { x, y, w: cw, h: chh, fill: { color: STONE }, line: { color: LINE, width: 1 } });
    s.addText(it.title || "", { x: x + 0.28, y: y + 0.28, w: cw - 0.56, h: 0.5, fontFace: DISP, bold: true, fontSize: 10.1, color: NAVY });
    s.addShape("rect" as any, { x: x + 0.3, y: y + 0.82, w: 0.34, h: 0.035, fill: { color: BONE }, line: { type: "none" } as any });
    if (it.body) s.addText(it.body, { x: x + 0.28, y: y + 1.0, w: cw - 0.56, h: chh - 1.2, fontFace: BODY, fontSize: 7.4, color: "1D2733", lineSpacingMultiple: 1.25, valign: "top" });
  });
  footer(s, c.footnote);
}

// Gantt-style phasing chart: phase rows with bars spanning period columns.
function rPhasing(p: pptxgen, c: DeckCard) {
  const s = p.addSlide();
  const y0 = lightHeader(s, c.kick || "Delivery", c.title || "Phasing", c.sub);
  const periods: string[] = Array.isArray(c.periods) ? c.periods : [];
  const phases: Array<any> = Array.isArray(c.phases) ? c.phases : [];
  const labW = 3.0, gridX = MX + labW, gridW = CW - labW;
  const nCols = Math.max(1, periods.length), colW = gridW / nCols;
  const top = y0 + 0.62;
  const rowH = Math.min(0.62, (6.25 - top) / Math.max(1, phases.length));
  const gridBottom = top + phases.length * rowH;
  // period axis + vertical gridlines
  periods.forEach((pd, i) => {
    s.addText(String(pd), { x: gridX + i * colW, y: y0 + 0.14, w: colW, h: 0.34, align: "center", fontFace: BODY, fontSize: 6.5, bold: true, color: MUTE });
    s.addShape("line" as any, { x: gridX + i * colW, y: top, w: 0, h: gridBottom - top, line: { color: LINE, width: 1 } });
  });
  s.addShape("line" as any, { x: gridX + nCols * colW, y: top, w: 0, h: gridBottom - top, line: { color: LINE, width: 1 } });
  const shades = [NAVY, MIDBLUE, "9DB89F"];
  phases.forEach((ph, i) => {
    const y = top + i * rowH;
    s.addText(ph.label || "", { x: MX, y, w: labW - 0.2, h: rowH, fontFace: BODY, fontSize: 7, bold: true, color: NAVY, valign: "middle" });
    const start = Math.max(0, ph.start ?? 0), span = Math.max(0.2, ph.span ?? 1);
    const bx = gridX + start * colW + 0.06;
    const bw = Math.max(0.12, Math.min(gridW - start * colW, span * colW) - 0.12);
    s.addShape("roundRect" as any, { x: bx, y: y + rowH * 0.22, w: bw, h: rowH * 0.54, fill: { color: shades[i % 3] }, line: { type: "none" } as any, rectRadius: 0.04 });
    if (ph.note) s.addText(String(ph.note), { x: bx + 0.1, y: y + rowH * 0.22, w: bw - 0.2, h: rowH * 0.54, fontFace: BODY, fontSize: 6.5, color: PAPER, valign: "middle" });
  });
  footer(s, c.footnote);
}

// Map with labelled callout pins (optional real basemap image) + a side list.
function rMap(p: pptxgen, c: DeckCard) {
  const s = p.addSlide();
  const y0 = lightHeader(s, c.kick || "Location", c.title || "Site map", c.sub);
  const top = y0 + 0.15, bottom = 6.35, mh = bottom - top;
  const list: Array<any> = Array.isArray(c.list) ? c.list : [];
  const hasList = list.length > 0;
  const mapW = hasList ? CW * 0.66 : CW, mapX = MX, mapY = top;
  const data: string | undefined = c.dataUri || c.image;
  if (data && RASTER_RE.test(data)) {
    try { s.addImage({ data, x: mapX, y: mapY, w: mapW, h: mh, sizing: { type: "cover", w: mapW, h: mh } as any }); } catch {}
    s.addShape("rect" as any, { x: mapX, y: mapY, w: mapW, h: mh, fill: { type: "none" } as any, line: { color: LINE, width: 1 } });
  } else {
    s.addShape("rect" as any, { x: mapX, y: mapY, w: mapW, h: mh, fill: { color: STONE }, line: { color: LINE, width: 1 } });
    s.addText(c.caption || "Map", { x: mapX, y: mapY + mh / 2 - 0.2, w: mapW, h: 0.4, align: "center", fontFace: BODY, fontSize: 7.4, color: MUTE });
  }
  (Array.isArray(c.pins) ? c.pins : []).forEach((pin: any) => {
    const px = mapX + Math.max(0, Math.min(1, pin.x ?? 0.5)) * mapW;
    const py = mapY + Math.max(0, Math.min(1, pin.y ?? 0.5)) * mh;
    s.addShape("ellipse" as any, { x: px - 0.09, y: py - 0.09, w: 0.18, h: 0.18, fill: { color: NAVY }, line: { color: PAPER, width: 1.5 } });
    if (pin.label) s.addText(String(pin.label), { x: px + 0.13, y: py - 0.13, w: 2.4, h: 0.3, fontFace: BODY, fontSize: 6.5, bold: true, color: data && RASTER_RE.test(data) ? PAPER : NAVY });
  });
  if (hasList) {
    const lx = MX + mapW + 0.4, lw = CW - mapW - 0.4; let ly = top + 0.02;
    list.slice(0, 8).forEach((it: any) => {
      s.addShape("ellipse" as any, { x: lx, y: ly + 0.06, w: 0.16, h: 0.16, fill: { color: NAVY }, line: { type: "none" } as any });
      s.addText(String(it.label ?? it), { x: lx + 0.28, y: ly, w: lw - 0.3, h: 0.32, fontFace: BODY, fontSize: 7.4, bold: true, color: NAVY, valign: "middle" });
      ly += 0.36;
      if (it.sub) { s.addText(String(it.sub), { x: lx + 0.28, y: ly, w: lw - 0.3, h: 0.5, fontFace: BODY, fontSize: 6.5, color: MUTE, valign: "top", lineSpacingMultiple: 1.15 }); ly += 0.5; }
      ly += 0.12;
    });
  }
  footer(s, c.footnote);
}

const RENDERERS: Record<string, (p: pptxgen, c: DeckCard) => void> = {
  cover: rCover, contents: rContents, section: rSection, exec_summary: rExecSummary,
  ranked_table: rRankedTable, catchment: rCatchment, asset_overview: rAssetOverview,
  kpi: rKpi, content: rContent, table: rTable, risk: rRisk, closing: rClosing, image: rImage,
  two_col: rTwoCol, returns: rReturns, schedule_hero: rScheduleHero,
  quote: rQuote, statement: rStatement, timeline: rTimeline, team: rTeam, comparison: rComparison, chart: rChart,
  board: rBoard, composite: rBoard, disclaimer: rDisclaimer, highlights: rHighlights,
  phasing: rPhasing, gantt: rPhasing, map: rMap,
};

// PowerPoint rejects XML-1.0-invalid control characters (endemic in text carried
// across from PDFs and uploaded decks) with a "repair this file?" prompt that
// strips content. pptxgenjs escapes XML entities but passes control characters
// through, so scrub every string in the card spec before it reaches a renderer.
// Data-URI/storage-key fields are exempt: base64 carries no control characters
// and copying megabyte payloads through a regex is wasted work.
const OFFICE_CTRL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\uFFFE\uFFFF]/g;
const CLEAN_EXEMPT = new Set(["dataUri", "image", "ref"]);
function cleanCardValue(v: any, key?: string): any {
  if (typeof v === "string") return key && CLEAN_EXEMPT.has(key) ? v : v.replace(OFFICE_CTRL, "");
  if (Array.isArray(v)) return v.map((x) => cleanCardValue(x));
  if (v && typeof v === "object") {
    const o: any = {};
    for (const k of Object.keys(v)) o[k] = cleanCardValue(v[k], k);
    return o;
  }
  return v;
}

/** Assemble a deck spec into an editable, on-brand .pptx (Tiempos embedded). */
export async function assembleDeckPptx(deck: DeckSpec): Promise<Buffer> {
  const p = new PptxGenJS();
  p.defineLayout({ name: "PAVE", width: W, height: H });
  p.layout = "PAVE";
  const cards = (deck.cards || []).map((c) => cleanCardValue(c) as DeckCard);
  for (const card of cards) {
    // Resolve any card's stored image ref → data URI for embedding (any card
    // can carry an image via `ref`; board tiles resolve their own refs).
    if (card.ref && !card.dataUri) { try { card.dataUri = await resolveDeckImage(card.ref); } catch {} }
    if ((card.type === "board" || card.type === "composite") && Array.isArray(card.blocks)) {
      for (const b of card.blocks) {
        if (b && b.ref && !b.dataUri) { try { b.dataUri = await resolveDeckImage(b.ref); } catch {} }
      }
    }
    DECK_LINK = deck.linkUrl; // set right before the synchronous render (concurrency-safe)
    const r = RENDERERS[card.type] || rContent;
    try { r(p, card); } catch { /* skip a bad card rather than abort the deck */ }
  }
  DECK_LINK = undefined;
  if (!cards.length) rContent(p, { type: "content", title: "Empty deck", body: "No cards to render." });
  // DO NOT inject the embeddedFontLst here. Verified against real PowerPoint: the
  // font surgery produces a file PowerPoint flags as needing "Repair", and the
  // repair blanks the content slides. (rectify() above fixes the *real* OOXML
  // corruption — ragged table rows — which is PowerPoint-safe.) Tiempos renders
  // via the font reference wherever it's installed (the in-app OnlyOffice editor
  // and previews have it baked in). Portable embedding needs a correct rewrite.
  const out = (await p.write({ outputType: "nodebuffer" })) as Buffer;
  return fixPptxSchemaViolations(out);
}

// pptxgenjs emits two OOXML schema violations that make PowerPoint demand a
// "repair" (verified with Microsoft's OpenXmlValidator):
//  1. presentation.xml children come out as sldMasterIdLst, sldIdLst,
//     notesMasterIdLst — but CT_Presentation requires notesMasterIdLst BEFORE
//     sldIdLst.
//  2. In a multi-run paragraph (runs joined with breakLine:false — e.g. a
//     **bold** span inside a bullet), pptxgenjs writes an <a:pPr> before EVERY
//     run; pPr is only legal as the paragraph's first child.
// Fix both by direct surgery on the generated parts.
export async function fixPptxSchemaViolations(pptx: Buffer): Promise<Buffer> {
  try {
    const zip = await JSZip.loadAsync(pptx);
    const presPath = "ppt/presentation.xml";
    let pres = await zip.file(presPath)?.async("string");
    if (pres) {
      const m = pres.match(/<p:notesMasterIdLst>[\s\S]*?<\/p:notesMasterIdLst>/);
      if (m && pres.indexOf(m[0]) > pres.indexOf("<p:sldIdLst")) {
        pres = pres.replace(m[0], "").replace("<p:sldIdLst", `${m[0]}<p:sldIdLst`);
        zip.file(presPath, pres);
      }
    }
    for (const name of Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))) {
      const xml = await zip.file(name)!.async("string");
      const fixed = xml.replace(/<a:p>([\s\S]*?)<\/a:p>/g, (_whole, inner: string) =>
        `<a:p>${inner.replace(/<a:pPr(?:\s[^>]*)?(?:\/>|>[\s\S]*?<\/a:pPr>)/g, (pp, off: number) => (off === 0 ? pp : ""))}</a:p>`);
      if (fixed !== xml) zip.file(name, fixed);
    }
    return await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  } catch {
    return pptx; // never fail assembly over schema polish
  }
}

/**
 * Embed the bundled Tiempos TTFs into the .pptx (OOXML embeddedFontLst) so the
 * file renders the brand serif on any machine. Also strips any orphan slide
 * parts. No-op if the font bundle is missing.
 */
export async function embedFontsInPptx(pptx: Buffer): Promise<Buffer> {
  try {
    if (!fs.existsSync(FONTS_DIR)) return pptx;
    const zip = await JSZip.loadAsync(pptx);
    const relsPath = "ppt/_rels/presentation.xml.rels";
    const presPath = "ppt/presentation.xml";
    const ctPath = "[Content_Types].xml";
    let relsXml = await zip.file(relsPath)?.async("string");
    let presXml = await zip.file(presPath)?.async("string");
    let ctXml = await zip.file(ctPath)?.async("string");
    if (!relsXml || !presXml || !ctXml) return pptx;

    // Strip orphan slide parts (not referenced by sldIdLst).
    try {
      const sldRids = [...presXml.matchAll(/<p:sldId\b[^>]*\sr:id="([^"]+)"/g)].map((m) => m[1]);
      const relTargets = new Map<string, string>();
      for (const m of relsXml.matchAll(/Id="([^"]+)"[^>]*?Target="([^"]+)"/g)) relTargets.set(m[1], m[2]);
      const referenced = new Set(sldRids.map((r) => (relTargets.get(r) || "").split("/").pop()).filter(Boolean));
      for (const name of Object.keys(zip.files)) {
        if (!/^ppt\/slides\/slide\d+\.xml$/.test(name)) continue;
        const base = name.split("/").pop()!;
        if (referenced.has(base)) continue;
        zip.remove(name);
        zip.remove(`ppt/slides/_rels/${base}.rels`);
        ctXml = ctXml.replace(new RegExp(`<Override PartName="/ppt/slides/${base}"[^>]*/>`), "");
        relsXml = relsXml.replace(new RegExp(`<Relationship[^>]*Target="slides/${base}"[^>]*/>`), "");
      }
    } catch { /* leave orphans rather than risk corrupting the package */ }

    const usedIds = [...relsXml.matchAll(/Id="rId(\d+)"/g)].map((m) => +m[1]);
    let nextId = (usedIds.length ? Math.max(...usedIds) : 0) + 1;
    const FONT_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/font";
    const newRels: string[] = [];
    const fontEntries: string[] = [];
    let partIdx = 0;
    for (const fam of EMBED_FONTS) {
      const slots: string[] = [];
      for (const style of ["regular", "bold"] as const) {
        const file = path.join(FONTS_DIR, (fam as any)[style]);
        if (!fs.existsSync(file)) continue;
        partIdx++;
        const part = `fonts/font${partIdx}.fntdata`;
        zip.file(`ppt/${part}`, fs.readFileSync(file));
        const rid = `rId${nextId++}`;
        newRels.push(`<Relationship Id="${rid}" Type="${FONT_REL}" Target="${part}"/>`);
        slots.push(`<p:${style} r:id="${rid}"/>`);
      }
      if (slots.length) fontEntries.push(`<p:embeddedFont><p:font typeface="${fam.typeface}"/>${slots.join("")}</p:embeddedFont>`);
    }
    if (!fontEntries.length) return pptx;

    relsXml = relsXml.replace("</Relationships>", `${newRels.join("")}</Relationships>`);
    zip.file(relsPath, relsXml);
    if (!/Extension="fntdata"/.test(ctXml)) {
      ctXml = ctXml.replace("</Types>", `<Default Extension="fntdata" ContentType="application/x-fontdata"/></Types>`);
      zip.file(ctPath, ctXml);
    }
    const presTag = (presXml.match(/<p:presentation\b[^>]*>/) || [""])[0];
    if (presTag && !/xmlns:r=/.test(presTag)) {
      presXml = presXml.replace(/<p:presentation\b/, `<p:presentation xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"`);
    }
    if (!/embedTrueTypeFonts=/.test(presXml)) {
      presXml = presXml.replace(/<p:presentation\b([^>]*)>/, (_m, attrs) => `<p:presentation${attrs} embedTrueTypeFonts="1">`);
    }
    const lst = `<p:embeddedFontLst>${fontEntries.join("")}</p:embeddedFontLst>`;
    if (/<p:notesSz[^>]*\/>/.test(presXml)) presXml = presXml.replace(/(<p:notesSz[^>]*\/>)/, `$1${lst}`);
    else if (/<\/p:sldIdLst>/.test(presXml)) presXml = presXml.replace(/(<\/p:sldIdLst>)/, `$1${lst}`);
    else presXml = presXml.replace("</p:presentation>", `${lst}</p:presentation>`);
    zip.file(presPath, presXml);

    return await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  } catch {
    return pptx;
  }
}

// ── Extract text + tables from an existing .pptx (Node/jszip, no python) ──────
// Lets ChatPave read an uploaded PowerPoint so it can convert it into a Pave IM
// deck. Returns per-slide text lines and reconstructed tables.
function decodeXml(s: string): string {
  return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(parseInt(d, 10)));
}
function shapeLines(xml: string): string[] {
  const lines: string[] = [];
  for (const para of xml.match(/<a:p>[\s\S]*?<\/a:p>/g) || []) {
    const t = (para.match(/<a:t>([\s\S]*?)<\/a:t>/g) || []).map((x) => x.replace(/<\/?a:t>/g, "")).join("");
    const clean = decodeXml(t).trim();
    if (clean) lines.push(clean);
  }
  return lines;
}
export interface ExtractedImage { key: string; w: number; h: number }
const EMU_PER_INCH = 914400;
// Content photos/charts/maps are placed large on a slide; logos/icons sit in a
// small box. Filter by ON-SLIDE DISPLAY SIZE (not the image's intrinsic pixel
// resolution — a logo can be a high-res PNG shrunk into a corner, which is
// exactly why the old intrinsic-size filter let logos through as big images).
const MIN_DISPLAY_EMU = Math.round(2.2 * EMU_PER_INCH); // ~2.2" longest side

// Map each picture's relationship id → its displayed size (EMU) on the slide.
function picDisplaySizes(xml: string): Map<string, { w: number; h: number }> {
  const out = new Map<string, { w: number; h: number }>();
  for (const pic of xml.match(/<p:pic>[\s\S]*?<\/p:pic>/g) || []) {
    const rid = pic.match(/r:embed="([^"]+)"/)?.[1];
    const ext = pic.match(/<a:ext\s+cx="(\d+)"\s+cy="(\d+)"/);
    if (rid && ext) out.set(rid, { w: parseInt(ext[1], 10), h: parseInt(ext[2], 10) });
  }
  return out;
}

export async function extractPptxContent(pptx: Buffer): Promise<{ slideCount: number; slides: Array<{ index: number; lines: string[]; tables: string[][][]; images: ExtractedImage[] }> }> {
  const zip = await JSZip.loadAsync(pptx);
  const names = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => parseInt(a.match(/(\d+)/)![1], 10) - parseInt(b.match(/(\d+)/)![1], 10));
  const batch = randomUUID().slice(0, 8);
  const slides: Array<{ index: number; lines: string[]; tables: string[][][]; images: ExtractedImage[] }> = [];

  // First pass: text + tables per slide, plus collect image candidates (defer
  // the keep/skip decision until we know how often each media file recurs — a
  // logo/branding element repeats across many slides).
  type Cand = { slideIdx: number; base: string; buf: Buffer; dispMax: number | null };
  const cands: Cand[] = [];
  const targetCount = new Map<string, number>();

  for (let i = 0; i < names.length; i++) {
    const xml = (await zip.file(names[i])!.async("string")) || "";
    const tables: string[][][] = [];
    for (const tbl of xml.match(/<a:tbl>[\s\S]*?<\/a:tbl>/g) || []) {
      const rows: string[][] = [];
      for (const tr of tbl.match(/<a:tr[\s\S]*?<\/a:tr>/g) || []) {
        const cells: string[] = [];
        for (const tc of tr.match(/<a:tc>[\s\S]*?<\/a:tc>/g) || []) {
          cells.push(shapeLines(tc).join(" ").trim());
        }
        if (cells.some((c) => c)) rows.push(cells);
      }
      if (rows.length) tables.push(rows);
    }
    const noTbl = xml.replace(/<a:tbl>[\s\S]*?<\/a:tbl>/g, "");
    const lines: string[] = [];
    for (const sp of noTbl.match(/<p:sp>[\s\S]*?<\/p:sp>/g) || []) lines.push(...shapeLines(sp));
    slides.push({ index: i + 1, lines, tables, images: [] });

    try {
      const relsName = names[i].replace(/slides\/(slide\d+)\.xml$/, "slides/_rels/$1.xml.rels");
      const relsXml = (await zip.file(relsName)?.async("string")) || "";
      const relMap = new Map<string, string>();
      for (const m of relsXml.matchAll(/Id="([^"]+)"[^>]*?Target="([^"]+)"[^>]*?(?:\/>|>)/g)) {
        if (/image/i.test(m[0])) relMap.set(m[1], m[2]);
      }
      const dispSizes = picDisplaySizes(xml);
      const embeds = Array.from(new Set([...xml.matchAll(/r:embed="([^"]+)"/g)].map((m) => m[1])));
      for (const rid of embeds) {
        const target = relMap.get(rid); if (!target) continue;
        const base = target.split("/").pop() || target;
        const mediaPath = ("ppt/slides/" + target).replace(/\/[^/]+\/\.\.\//g, "/").replace("ppt/slides/../", "ppt/");
        const file = zip.file(mediaPath) || zip.file("ppt/media/" + base);
        if (!file) continue;
        const disp = dispSizes.get(rid);
        const dispMax = disp ? Math.max(disp.w, disp.h) : null;
        targetCount.set(base, (targetCount.get(base) || 0) + 1);
        cands.push({ slideIdx: i, base, buf: await file.async("nodebuffer"), dispMax });
      }
    } catch { /* no rels / no images on this slide */ }
  }

  // Second pass: keep photos/charts/maps; drop logos/icons and anything that
  // recurs across the deck (branding). A media file used on many slides is
  // branding, not content, no matter how it's sized on any one slide.
  const recurThreshold = Math.max(3, Math.ceil(names.length * 0.4));
  const perSlide = new Map<number, number>();
  for (const c of cands) {
    if ((targetCount.get(c.base) || 0) >= recurThreshold) continue; // repeated → branding/logo
    try {
      const meta = await sharp(c.buf).metadata();
      const w = meta.width || 0, h = meta.height || 0;
      if (w < 64 || h < 64) continue; // truly tiny asset
      // If we know the on-slide size, use it; else fall back to a generous
      // intrinsic gate so a background/fill photo still comes through.
      if (c.dispMax != null) { if (c.dispMax < MIN_DISPLAY_EMU) continue; }
      else if (w < 400 || h < 300) continue;
      const png = await sharp(c.buf).png().toBuffer();
      const k = (perSlide.get(c.slideIdx) || 0);
      perSlide.set(c.slideIdx, k + 1);
      const key = `deck-media/${batch}/s${c.slideIdx + 1}-${k}.png`;
      await saveFile(key, png, "image/png", `slide${c.slideIdx + 1}.png`);
      slides[c.slideIdx].images.push({ key, w, h });
    } catch { /* not a raster sharp can read — skip */ }
  }
  return { slideCount: names.length, slides };
}

// Resolve a deck-media key back to a data URI for embedding at assemble time.
// Returns null (image skipped) unless the stored bytes are a real PNG/JPEG —
// labelling junk bytes image/png is exactly what triggers PowerPoint's repair.
export async function resolveDeckImage(key: string): Promise<string | null> {
  try {
    const f = await getFile(key);
    const b = f?.data;
    if (!b || b.length < 12) return null;
    const isPng = b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
    const isJpg = b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
    if (!isPng && !isJpg) return null;
    return `data:image/${isPng ? "png" : "jpeg"};base64,${b.toString("base64")}`;
  } catch { return null; }
}

// ── Map the deck_cards model onto the IM card specs ──────────────────────────
interface DeckCardRow { type: string; title: string | null; content: any }
function asObj(content: any): Record<string, any> {
  if (!content) return {};
  if (typeof content === "string") { try { return JSON.parse(content) || {}; } catch { return {}; } }
  return content;
}

export function deckCardsToSpec(deckName: string, rows: DeckCardRow[]): DeckSpec {
  const cards: DeckCard[] = [];
  for (const row of rows) {
    const c = asObj(row.content);
    const title = row.title || "";
    switch (row.type) {
      case "cover":
        cards.push({ type: "cover", eyebrow: c.eyebrow || c.hero || "Investment Memorandum", title: title || deckName, subtitle: c.subtitle || "", meta: c.meta || [] });
        break;
      case "contents": case "toc":
        cards.push({ type: "contents", items: (c.items || []).map((it: any, i: number) => typeof it === "string" ? { n: String(i + 1).padStart(2, "0"), title: it } : it) });
        break;
      case "section": case "divider":
        cards.push({ type: "section", number: c.number || c.n || "", title: title || c.title, indexLine: c.indexLine || c.contents });
        break;
      case "exec_summary": case "executive_summary":
        cards.push({ type: "exec_summary", kick: c.kick, title: title || "Executive summary", bands: c.bands || [], footnote: c.footnote });
        break;
      case "ranked_table": case "comparables":
        cards.push({ type: "ranked_table", kick: c.kick, title: title || "Ranked comparables", sub: c.subtitle || c.sub, headers: c.headers, rows: c.rows || [], footnote: c.footnote });
        break;
      case "catchment": case "analysis":
        cards.push({ type: "catchment", kick: c.kick, title: title || "Catchment analysis", sub: c.subtitle || c.sub, mapLabel: c.mapLabel, tableHeaders: c.tableHeaders, table: c.table || [], bullets: c.bullets || [], footnote: c.footnote });
        break;
      case "asset_overview": case "asset":
        cards.push({ type: "asset_overview", kick: c.kick, title: title || "Asset overview", sub: c.subtitle || c.sub, strip: c.strip || [], tables: c.tables || [], verdict: c.verdict || [], footnote: c.footnote });
        break;
      case "kpi_block": case "kpi":
        cards.push({ type: "kpi", kick: c.kick, title: title || "Key numbers", sub: c.subtitle, kpis: (c.kpis || []).slice(0, 4), footnote: c.footnote });
        break;
      case "data_table": case "table":
        cards.push({ type: "table", kick: c.kick, title: title || "Table", sub: c.subtitle, headers: c.headers || [], rows: c.rows || [], footnote: c.footnote });
        break;
      case "risk_register": case "risk":
        cards.push({ type: "risk", kick: c.kick, title: title || "Where the thesis breaks", sub: c.subtitle, items: c.items || [], footnote: c.footnote });
        break;
      case "signature_block": case "closing":
        cards.push({ type: "closing", eyebrow: c.eyebrow || "In closing", heading: title || c.heading || "Recommendation", body: c.body || c.fee || "", contacts: c.contacts });
        break;
      case "next_steps":
        cards.push({ type: "content", title: title || "Next steps", bullets: (c.items || []).map((it: any) => typeof it === "string" ? it : `${it.action || ""}${it.owner ? ` (${it.owner})` : ""}`) });
        break;
      case "two_col": case "two_column":
        cards.push({ type: "two_col", kick: c.kick, title, sub: c.subtitle || c.sub, leftTitle: c.leftTitle, left: c.left || [], rightTitle: c.rightTitle, right: c.right || [], footnote: c.footnote });
        break;
      case "returns":
        cards.push({ type: "returns", kick: c.kick, title: title || "Returns", sub: c.subtitle || c.sub, groups: c.groups || [], note: c.note, footnote: c.footnote });
        break;
      case "schedule_hero": case "accommodation":
        cards.push({ type: "schedule_hero", kick: c.kick, title, sub: c.subtitle || c.sub, headers: c.headers || [], rows: c.rows || [], ref: c.ref, dataUri: c.dataUri, image: c.image, w: c.w, h: c.h, caption: c.caption, bullets: c.bullets || [], footnote: c.footnote });
        break;
      case "quote": case "testimonial":
        cards.push({ type: "quote", quote: c.quote || c.body || title, attribution: c.attribution || c.author, footnote: c.footnote });
        break;
      case "statement": case "big_statement":
        cards.push({ type: "statement", kick: c.kick || c.eyebrow, title: title || c.heading, sub: c.subtitle || c.sub });
        break;
      case "timeline": case "roadmap":
        cards.push({ type: "timeline", kick: c.kick, title, sub: c.subtitle || c.sub, milestones: c.milestones || c.items || [], footnote: c.footnote });
        break;
      case "team": case "people":
        cards.push({ type: "team", kick: c.kick, title: title || "Team", sub: c.subtitle || c.sub, people: c.people || c.members || [], footnote: c.footnote });
        break;
      case "comparison": case "matrix":
        cards.push({ type: "comparison", kick: c.kick, title, sub: c.subtitle || c.sub, columns: c.columns || [], rows: c.rows || [], footnote: c.footnote });
        break;
      case "chart":
        cards.push({ type: "chart", kick: c.kick, title, sub: c.subtitle || c.sub, chartType: c.chartType, series: c.series, labels: c.labels, values: c.values, footnote: c.footnote });
        break;
      case "board": case "composite":
        cards.push({ type: "board", kick: c.kick, title, sub: c.subtitle || c.sub, blocks: c.blocks || [], footnote: c.footnote });
        break;
      case "disclaimer": case "legal":
        cards.push({ type: "disclaimer", kick: c.kick, title: title || "Disclaimer", sub: c.subtitle || c.sub, paragraphs: c.paragraphs, body: c.body, footnote: c.footnote });
        break;
      case "highlights": case "callouts":
        cards.push({ type: "highlights", kick: c.kick, title: title || "Investment highlights", sub: c.subtitle || c.sub, items: c.items || [], footnote: c.footnote });
        break;
      case "phasing": case "gantt":
        cards.push({ type: "phasing", kick: c.kick, title: title || "Phasing", sub: c.subtitle || c.sub, periods: c.periods || [], phases: c.phases || [], footnote: c.footnote });
        break;
      case "map":
        cards.push({ type: "map", kick: c.kick, title: title || "Site map", sub: c.subtitle || c.sub, ref: c.ref, dataUri: c.dataUri, image: c.image, caption: c.caption, pins: c.pins || [], list: c.list || [], footnote: c.footnote });
        break;
      case "narrative": default: {
        const bullets = Array.isArray(c.bullets) ? c.bullets : [];
        cards.push({ type: "content", section: c.section, title, lead: c.lead, bullets, body: bullets.length ? "" : (c.markdown || c.summary || c.caption || "") });
        break;
      }
    }
  }
  return { cards };
}

/**
 * Best-effort PPTX→PDF via headless LibreOffice. NOTE: the Nix LibreOffice on
 * the image renders a non-brand fallback font (it can't see Tiempos), so the
 * PDF is for quick viewing only — the editable PPTX is the on-brand deliverable.
 */
export async function deckPptxToPdf(pptx: Buffer): Promise<Buffer> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "deckpdf-"));
  const inPath = path.join(tmp, "deck.pptx");
  const outPath = path.join(tmp, "deck.pdf");
  fs.writeFileSync(inPath, pptx);
  try {
    if (fs.existsSync(FONTS_DIR) && fs.readdirSync(FONTS_DIR).some((f) => /\.(ttf|otf)$/i.test(f))) {
      const userConfDir = path.join(tmp, ".config", "fontconfig");
      fs.mkdirSync(userConfDir, { recursive: true });
      fs.writeFileSync(path.join(userConfDir, "fonts.conf"),
        `<?xml version="1.0"?>\n<!DOCTYPE fontconfig SYSTEM "fonts.dtd">\n<fontconfig>\n  <dir>${FONTS_DIR}</dir>\n</fontconfig>\n`);
    }
  } catch { /* noop */ }
  try {
    await new Promise<void>((resolve, reject) => {
      execFile("soffice", [
        "--headless", "--nologo", "--nofirststartwizard", "--norestore",
        `-env:UserInstallation=file://${path.join(tmp, "lo")}`,
        "--convert-to", "pdf:impress_pdf_Export", "--outdir", tmp, inPath,
      ], { timeout: 120000, env: { ...process.env, HOME: tmp, XDG_CACHE_HOME: path.join(tmp, ".cache"), OSFONTDIR: FONTS_DIR } },
        (err) => (err ? reject(err) : resolve()));
    });
    if (!fs.existsSync(outPath)) throw new Error("soffice produced no PDF");
    return fs.readFileSync(outPath);
  } finally {
    fs.promises.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}
