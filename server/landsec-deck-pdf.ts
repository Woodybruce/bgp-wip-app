// A Landsec report deck as a PDF: 16:9 pages, one a slide, the charts drawn
// by hand (Woody, 2026-11-19: "just visual PDF which can also be power
// point"). It draws the Deck it is given and nothing else: what is on each
// slide is shared/landsec-decks.ts, and where each block sits is
// layoutSlide in shared/landsec-deck.ts, which the PowerPoint renderer
// (server/landsec-deck-pptx.ts) draws from too.
//
// Landsec's logo only, in the Landsec report palette: never BGP's wordmark
// or BGP's colours.
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage, type RGB } from "pdf-lib";
import { LANDSEC_REPORT_PALETTE } from "@shared/landsec-reports";
import {
  DECK_COLOURS, DECK_PAGE, DECK_TINTS, deckValue, fitCell, layoutSlide, lightOn, readSteps, tableRowHeight, tileBoxes, tileValueSize,
  type Deck, type DeckBox, type DeckCard, type DeckChart, type DeckColour, type DeckSlide, type DeckTable, type DeckTiles, type DeckWords,
} from "@shared/landsec-deck";
import { landsecLogoBytes } from "./landsec-report-logo";

const colour = (hex: string): RGB => rgb(parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255);
const NAVY = colour(LANDSEC_REPORT_PALETTE.navy), PALE = colour(LANDSEC_REPORT_PALETTE.paleBlue), SAND = colour(LANDSEC_REPORT_PALETTE.sand), GOLD = colour(LANDSEC_REPORT_PALETTE.gold);
const TEXT = colour(LANDSEC_REPORT_PALETTE.text), MUTED = colour(LANDSEC_REPORT_PALETTE.muted), WHITE = rgb(1, 1, 1);
const BAND = colour(DECK_TINTS.band), CARD = colour(DECK_TINTS.card);
const SERIES: Record<DeckColour, RGB> = { navy: colour(DECK_COLOURS.navy), blue: colour(DECK_COLOURS.blue), gold: colour(DECK_COLOURS.gold), pale: colour(DECK_COLOURS.pale), grey: colour(DECK_COLOURS.grey) };

// Text the standard PDF fonts can draw: anything outside Latin-1 becomes a space.
const safe = (v: unknown): string =>
  String(v ?? "").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/…/g, "...").replace(/•/g, "-")
    .replace(/\s+/g, " ").replace(/[^\x20-\x7E\xA0-\xFF]/g, " ").trim();

const PT = 72;
const P = DECK_PAGE;

export async function deckPdf(deck: Deck): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  doc.setTitle(safe(deck.subtitle ? `${deck.title}, ${deck.subtitle}` : deck.title));
  doc.setAuthor("ChatBGP");
  const light = landsecLogoBytes("light"), dark = landsecLogoBytes("dark");
  const logoLight: PDFImage | null = light ? await doc.embedPng(light) : null;
  const logoDark: PDFImage | null = dark ? await doc.embedPng(dark) : null;
  const size: [number, number] = [P.w * PT, P.h * PT];
  const H = size[1];

  // Everything below is placed in inches from the slide's top left, as the layout gives it.
  let page: PDFPage = null as unknown as PDFPage;
  const rect = (b: DeckBox, fill: RGB, opacity = 1) => page.drawRectangle({ x: b.x * PT, y: H - (b.y + b.h) * PT, width: b.w * PT, height: b.h * PT, color: fill, opacity });
  const widthOf = (words: string, s: number, f: PDFFont = font) => f.widthOfTextAtSize(words, s) / PT;
  /** Words with their top at y (inches). */
  const write = (words: string, x: number, y: number, s: number, opts: { f?: PDFFont; color?: RGB; align?: "left" | "right" | "centre"; width?: number } = {}) => {
    const f = opts.f || font, t = safe(words);
    if (!t) return;
    const w = widthOf(t, s, f);
    const tx = opts.align === "right" ? x + (opts.width || 0) - w : opts.align === "centre" ? x + ((opts.width || 0) - w) / 2 : x;
    page.drawText(t, { x: tx * PT, y: H - y * PT - s * 0.78, size: s, font: f, color: opts.color || TEXT });
  };
  /** Words cut to a width, with "..." when cut. */
  const cutTo = (words: string, width: number, s: number, f: PDFFont = font): string => {
    let t = safe(words);
    if (widthOf(t, s, f) <= width) return t;
    while (t.length > 1 && widthOf(`${t}...`, s, f) > width) t = t.slice(0, -1);
    return `${t.trimEnd()}...`;
  };
  const wrap = (words: string, width: number, s: number, f: PDFFont = font): string[] => {
    const out: string[] = [];
    let line = "";
    for (const word of safe(words).split(" ")) {
      const next = line ? `${line} ${word}` : word;
      if (widthOf(next, s, f) <= width || !line) line = next; else { out.push(line); line = word; }
    }
    if (line) out.push(line);
    return out.map(l => (widthOf(l, s, f) > width ? cutTo(l, width, s, f) : l));
  };
  const mark = (img: PDFImage | null, x: number, y: number, h: number) => { if (img) page.drawImage(img, { x: x * PT, y: H - (y + h) * PT, width: (img.width / img.height) * h * PT, height: h * PT }); };

  // ── Blocks ──────────────────────────────────────────────────────────────

  const blockTitle = (title: string | undefined, b: DeckBox): DeckBox => {
    if (!title) return b;
    write(cutTo(title, b.w, 11.5, bold), b.x, b.y + 0.02, 11.5, { f: bold, color: NAVY });
    return { x: b.x, y: b.y + P.blockTitleH, w: b.w, h: b.h - P.blockTitleH };
  };

  const tiles = (t: DeckTiles, b: DeckBox) => {
    tileBoxes(t, b).forEach((box, i) => {
      const tile = t.tiles[i];
      rect(box, PALE);
      const s = tileValueSize(tile.value, box);
      const label = wrap(tile.label, box.w - 0.36, 9.5).slice(0, 2);
      const need = (s * 1.02 + 7 + label.length * 12) / PT;
      let y = box.y + Math.max(0.1, (box.h - need) / 2);
      write(cutTo(tile.value, box.w - 0.3, s, bold), box.x + 0.18, y, s, { f: bold, color: NAVY });
      y += (s * 1.02 + 7) / PT;
      label.forEach((line, k) => write(line, box.x + 0.18, y + (k * 12) / PT, 9.5, { color: TEXT }));
    });
  };

  const legend = (chart: DeckChart, b: DeckBox): DeckBox => {
    if (chart.series.length < 2) return b;
    // The series names, on as many lines as they need.
    let x = b.x, y = b.y;
    for (const s of chart.series) {
      const w = 0.2 + widthOf(safe(s.name), 9.5) + 0.3;
      if (x + w - 0.3 > b.x + b.w && x > b.x) { x = b.x; y += 0.21; }
      rect({ x, y: y + 0.06, w: 0.13, h: 0.13 }, SERIES[s.colour]);
      write(s.name, x + 0.2, y + 0.035, 9.5, { color: MUTED });
      x += w;
    }
    const used = (y - b.y) + P.legendH;
    return { x: b.x, y: b.y + used, w: b.w, h: b.h - used };
  };

  const num = (v: number | null | undefined): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

  const barChart = (chart: DeckChart, area: DeckBox) => {
    const n = chart.categories.length, k = chart.series.length;
    const labelS = 9.5;
    const labelW = Math.min(area.w * 0.36, Math.max(...chart.categories.map(c => widthOf(safe(c), labelS))) + 0.16);
    const rowH = Math.min(0.72, area.h / Math.max(1, n));
    const x0 = area.x + labelW, plotW = area.w - labelW;
    const label = (i: number) => write(cutTo(chart.categories[i], labelW - 0.12, labelS), area.x, area.y + i * rowH + rowH / 2 - 0.075, labelS, { color: TEXT });

    if (chart.chart === "bar") {
      const values = chart.series.flatMap(s => s.values.map(num));
      const max = Math.max(0, ...values), min = Math.min(0, ...values);
      const longest = Math.max(...chart.series.flatMap(s => s.values.map(v => widthOf(deckValue(v, chart.format) || "Not held", labelS, bold)))) + 0.14;
      const room = Math.min(plotW * 0.4, longest);
      const span = (max - min) || 1;
      const scale = (plotW - room - (min < 0 ? room : 0)) / span;
      const zero = x0 + (min < 0 ? room : 0) + (0 - min) * scale;
      const thick = (rowH * 0.62) / k;
      for (let i = 0; i < n; i++) {
        label(i);
        chart.series.forEach((s, j) => {
          const v = s.values[i];
          const y = area.y + i * rowH + (rowH - thick * k) / 2 + j * thick;
          if (v == null || !Number.isFinite(v)) { write("Not held", zero + 0.06, y + thick / 2 - 0.07, 8.5, { color: MUTED }); return; }
          const w = Math.abs(v) * scale;
          rect({ x: v < 0 ? zero - w : zero, y: y + thick * 0.08, w: Math.max(w, 0.012), h: thick * 0.84 }, SERIES[s.colour]);
          const words = deckValue(v, chart.format);
          if (v < 0) write(words, zero - w - 0.07 - widthOf(words, labelS, bold), y + thick / 2 - 0.075, labelS, { f: bold });
          else write(words, zero + w + 0.07, y + thick / 2 - 0.075, labelS, { f: bold });
        });
      }
      if (min < 0) page.drawLine({ start: { x: zero * PT, y: H - area.y * PT }, end: { x: zero * PT, y: H - (area.y + n * rowH) * PT }, thickness: 0.6, color: MUTED });
      return;
    }

    const totals = chart.categories.map((_, i) => chart.series.reduce((t, s) => t + Math.max(0, num(s.values[i])), 0));
    const room = Math.max(...totals.map(t => widthOf(deckValue(t, chart.format), labelS, bold))) + 0.14;
    const full = plotW - room;
    const maxTotal = Math.max(1, ...totals);
    const thick = rowH * (rowH < 0.32 ? 0.8 : 0.62);
    const insideS = Math.max(7, Math.min(9, thick * PT * 0.72));
    for (let i = 0; i < n; i++) {
      label(i);
      const y = area.y + i * rowH + (rowH - thick) / 2;
      let x = x0;
      const of = chart.chart === "shareBar" ? Math.max(1, totals[i]) : maxTotal;
      if (totals[i] === 0) { write(chart.chart === "shareBar" ? "None recorded" : "", x0 + 0.04, y + thick / 2 - 0.07, 8.5, { color: MUTED }); continue; }
      for (const s of chart.series) {
        const v = Math.max(0, num(s.values[i]));
        if (v === 0) continue;
        const w = (v / of) * full;
        rect({ x, y, w, h: thick }, SERIES[s.colour]);
        const words = chart.chart === "shareBar" && totals[i] > 0 && (v / totals[i]) >= 0.12 ? `${deckValue(v, chart.format)} (${Math.round((v / totals[i]) * 100)}%)` : deckValue(v, chart.format);
        const short = deckValue(v, chart.format);
        const fits = (t: string) => widthOf(t, insideS, bold) + 0.1 <= w;
        const inside = fits(words) ? words : fits(short) ? short : "";
        if (inside) write(inside, x, y + thick / 2 - (insideS * 0.39) / PT, insideS, { f: bold, color: lightOn(s.colour) ? WHITE : TEXT, align: "centre", width: w });
        x += w;
      }
      write(deckValue(totals[i], chart.format), x + 0.07, y + thick / 2 - 0.075, labelS, { f: bold, color: chart.chart === "shareBar" ? MUTED : TEXT });
    }
  };

  const columnChart = (chart: DeckChart, area: DeckBox) => {
    const n = chart.categories.length, k = chart.series.length;
    const labelH = 0.3, topRoom = 0.26;
    const plot: DeckBox = { x: area.x, y: area.y + topRoom, w: area.w, h: area.h - labelH - topRoom };
    const max = Math.max(1, ...chart.series.flatMap(s => s.values.map(num)));
    const group = plot.w / Math.max(1, n);
    const barW = Math.min(0.7, (group * 0.7) / k);
    const base = plot.y + plot.h;
    for (let i = 0; i < n; i++) {
      const gx = plot.x + i * group + (group - barW * k) / 2;
      chart.series.forEach((s, j) => {
        const v = Math.max(0, num(s.values[i]));
        const h = (v / max) * plot.h;
        if (v > 0) {
          rect({ x: gx + j * barW + barW * 0.06, y: base - h, w: barW * 0.88, h }, SERIES[s.colour]);
          write(deckValue(v, chart.format), gx + j * barW, base - h - 0.2, 9, { f: bold, align: "centre", width: barW });
        }
      });
      write(cutTo(chart.categories[i], group - 0.06, 9.5), plot.x + i * group, base + 0.08, 9.5, { color: TEXT, align: "centre", width: group });
    }
    page.drawLine({ start: { x: plot.x * PT, y: H - base * PT }, end: { x: (plot.x + plot.w) * PT, y: H - base * PT }, thickness: 0.8, color: MUTED });
  };

  const chartBlock = (chart: DeckChart, b: DeckBox) => {
    const area = legend(chart, blockTitle(chart.title, b));
    if (chart.chart === "column") columnChart(chart, area); else barChart(chart, { ...area, y: area.y + 0.04, h: area.h - 0.04 });
  };

  const table = (t: DeckTable, b: DeckBox) => {
    const area = blockTitle(t.title, b);
    const total = t.columns.reduce((n, c) => n + c.width, 0);
    const widths = t.columns.map(c => (c.width / total) * area.w);
    const pad = 0.07;
    rect({ x: area.x, y: area.y, w: area.w, h: P.tableHeadH }, NAVY);
    let x = area.x;
    t.columns.forEach((c, i) => {
      write(cutTo(c.header, widths[i] - pad * 2, 9, bold), x + pad, area.y + P.tableHeadH / 2 - 0.068, 9, { f: bold, color: WHITE, align: c.align === "right" ? "right" : "left", width: widths[i] - pad * 2 });
      x += widths[i];
    });
    const rowH = tableRowHeight(t.lines);
    t.rows.forEach((cells, r) => {
      const y = area.y + P.tableHeadH + r * rowH;
      if (y + rowH > b.y + b.h + 0.02) return;
      if (r % 2 === 1) rect({ x: area.x, y, w: area.w, h: rowH }, BAND);
      let cx = area.x;
      t.columns.forEach((c, i) => {
        if (c.steps) {
          // A progress strip: small steps, the first few filled, then the word.
          const { filled, word } = readSteps(cells[i]);
          const side = 0.085, gap = 0.022;
          for (let k = 0; k < c.steps; k++) rect({ x: cx + pad + k * (side + gap), y: y + rowH / 2 - side / 2, w: side, h: side }, k < filled ? NAVY : SERIES.grey);
          const after = c.steps * (side + gap) + 0.05;
          write(cutTo(word, widths[i] - pad * 2 - after, 9.5), cx + pad + after, y + rowH / 2 - 0.072, 9.5);
          cx += widths[i];
          return;
        }
        if (t.lines === 2) {
          // Up to two lines, set about the middle of the taller row.
          const two = wrap(fitCell(cells[i] ?? "", widths[i], 9.5, 2), widths[i] - pad * 2, 9.5).slice(0, 2);
          if (two.length === 2) two[1] = cutTo(two[1], widths[i] - pad * 2, 9.5);
          const lead = 0.165, top = y + rowH / 2 - 0.072 - ((two.length - 1) * lead) / 2;
          two.forEach((line, k) => write(line, cx + pad, top + k * lead, 9.5, { align: c.align === "right" ? "right" : "left", width: widths[i] - pad * 2 }));
          cx += widths[i];
          return;
        }
        const words = cutTo(fitCell(cells[i] ?? "", widths[i]), widths[i] - pad * 2, 9.5);
        write(words, cx + pad, y + rowH / 2 - 0.072, 9.5, { align: c.align === "right" ? "right" : "left", width: widths[i] - pad * 2 });
        cx += widths[i];
      });
    });
  };

  const card = (c: DeckCard, b: DeckBox) => {
    rect(b, CARD);
    rect({ x: b.x, y: b.y, w: 0.07, h: b.h }, GOLD);
    const inner = b.w - 0.75;
    const title = wrap(c.title, inner, 15, bold).slice(0, 3);
    const lines = c.lines.flatMap(l => [...wrap(l, inner, 11), ""]).slice(0, -1);
    const need = (title.length * 19 + 8 + lines.length * 15) / PT;
    let y = b.y + Math.max(0.22, (b.h - need) / 2);
    title.forEach(line => { write(line, b.x + 0.4, y, 15, { f: bold, color: NAVY }); y += 19 / PT; });
    y += 8 / PT;
    for (const line of lines) {
      if (y + 0.2 > b.y + b.h) break;
      if (line) write(line, b.x + 0.4, y, 11, { color: TEXT });
      y += (line ? 15 : 7) / PT;
    }
  };

  const words = (w: DeckWords, b: DeckBox) => {
    const area = blockTitle(w.title, b);
    const s = w.dense ? 9.5 : 11, lead = (w.dense ? 13 : 15.4) / PT;
    let y = area.y + 0.02;
    const floor = area.y + area.h - (w.credit ? 0.26 : 0);
    outer: for (const paragraph of w.paragraphs) {
      for (const line of wrap(paragraph, area.w, s)) {
        if (y + lead > floor + 0.02) break outer;
        write(line, area.x, y, s, { color: TEXT });
        y += lead;
      }
      y += (w.dense ? 6 : 7) / PT;
    }
    if (w.credit) write(cutTo(w.credit, area.w, 9), area.x, Math.min(y + 0.04, area.y + area.h - 0.2), 9, { color: MUTED });
  };

  // ── Slides ──────────────────────────────────────────────────────────────

  const titlePage = (slide: DeckSlide) => {
    rect({ x: 0, y: 0, w: P.w, h: P.h }, NAVY);
    mark(logoLight, P.side, 0.62, 1.15);
    let y = 2.75;
    for (const line of wrap(slide.title, P.w - P.side * 2, 40, bold).slice(0, 2)) { write(line, P.side, y, 40, { f: bold, color: WHITE }); y += 0.66; }
    if (slide.subtitle) { write(cutTo(slide.subtitle, P.w - P.side * 2, 20), P.side, y + 0.08, 20, { color: PALE }); y += 0.52; }
    rect({ x: P.side, y: y + 0.2, w: 1.6, h: 0.05 }, GOLD);
    y += 0.5;
    for (const text of slide.lines || []) for (const line of wrap(text, P.w - P.side * 2 - 2, 12).slice(0, 3)) { write(line, P.side, y, 12, { color: WHITE }); y += 0.24; }
    write(cutTo(deck.footer, P.w - P.side * 2, 8), P.side, P.footY, 8, { color: PALE });
  };

  const contentPage = (slide: DeckSlide, index: number, count: number) => {
    const logoH = 0.66, logoW = logoDark ? (logoDark.width / logoDark.height) * logoH : 0;
    mark(logoDark, P.w - P.side - logoW, 0.4, logoH);
    const room = P.w - P.side * 2 - logoW - 0.4;
    write(cutTo(slide.title, room, 24, bold), P.side, P.titleY, 24, { f: bold, color: NAVY });
    if (slide.subtitle) write(cutTo(slide.subtitle, room, 11.5), P.side, P.subtitleY, 11.5, { color: MUTED });
    rect({ x: P.side, y: P.ruleY, w: P.w - P.side * 2, h: 0.02 }, GOLD);
    for (const placed of layoutSlide(slide)) {
      const b = placed.block;
      if (b.kind === "tiles") tiles(b, placed);
      else if (b.kind === "chart") chartBlock(b, placed);
      else if (b.kind === "table") table(b, placed);
      else if (b.kind === "card") card(b, placed);
      else words(b, placed);
    }
    if (slide.caveat) wrap(slide.caveat, P.w - P.side * 2, 9).slice(0, 2).forEach((line, i) => write(line, P.side, P.caveatY + i * 0.17, 9, { color: MUTED }));
    rect({ x: P.side, y: P.footRuleY, w: P.w - P.side * 2, h: 0.012 }, SAND);
    write(cutTo(deck.footer, P.w - P.side * 2 - 1, 7.5), P.side, P.footY, 7.5, { color: MUTED });
    write(`${index + 1} of ${count}`, P.side, P.footY, 7.5, { color: MUTED, align: "right", width: P.w - P.side * 2 });
  };

  deck.slides.forEach((slide, i) => {
    page = doc.addPage(size);
    if (slide.layout === "title") titlePage(slide); else contentPage(slide, i, deck.slides.length);
  });
  return doc.save();
}
