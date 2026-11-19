// A Landsec report deck as a PowerPoint: the same slides as the PDF
// (server/landsec-deck-pdf.ts), with NATIVE charts and tables so Landsec can
// edit them (Woody, 2026-11-19: "just visual PDF which can also be power
// point"). It draws the Deck it is given and nothing else; where each block
// sits is layoutSlide in shared/landsec-deck.ts.
//
// Landsec's logo only, in the Landsec report palette. The rule behind each
// slide's figures goes under the slide for whoever presents it.
import PptxGenJSImport from "pptxgenjs";
import JSZip from "jszip";
import { LANDSEC_REPORT_PALETTE } from "@shared/landsec-reports";
import {
  DECK_COLOURS, DECK_PAGE, DECK_TINTS, fitCell, layoutSlide, lightOn, readSteps, tableRowHeight, tileBoxes, tileValueSize,
  type Deck, type DeckBox, type DeckCard, type DeckChart, type DeckSlide, type DeckTable, type DeckTiles, type DeckValueFormat, type DeckWords,
} from "@shared/landsec-deck";
import { LANDSEC_LOGO_RATIO, landsecLogoBytes } from "./landsec-report-logo";

// pptxgenjs is CommonJS; the default import differs between esbuild and tsx.
const PptxGenJS: any = (PptxGenJSImport as any)?.default || PptxGenJSImport;

const hex = (c: string): string => c.replace("#", "").toUpperCase();
const NAVY = hex(LANDSEC_REPORT_PALETTE.navy), PALE = hex(LANDSEC_REPORT_PALETTE.paleBlue), SAND = hex(LANDSEC_REPORT_PALETTE.sand), GOLD = hex(LANDSEC_REPORT_PALETTE.gold);
const TEXT = hex(LANDSEC_REPORT_PALETTE.text), MUTED = hex(LANDSEC_REPORT_PALETTE.muted), WHITE = "FFFFFF";
const FACE = "Arial";
const P = DECK_PAGE;

// What PowerPoint cannot hold in its XML: control characters.
const clean = (v: unknown): string => String(v ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, " ").replace(/\s+/g, " ").trim();

// How a figure is written on its bar. The third part is nought: written as nothing, so an empty segment has no label.
const LABEL_FORMAT: Record<DeckValueFormat, string> = {
  count: "#,##0;-#,##0;",
  pct: '+0.0"%";-0.0"%";0.0"%"',
  days: '#,##0" days";;',
  money: "£#,##0;-£#,##0;",
};

export async function deckPptx(deck: Deck): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.title = clean(deck.subtitle ? `${deck.title}, ${deck.subtitle}` : deck.title);
  pptx.author = "ChatBGP";
  pptx.company = "Landsec";
  const light = landsecLogoBytes("light"), dark = landsecLogoBytes("dark");
  const image = (bytes: Uint8Array) => `image/png;base64,${Buffer.from(bytes).toString("base64")}`;

  const text = (slide: any, words: string, b: DeckBox, opts: Record<string, unknown> = {}) =>
    slide.addText(clean(words), { x: b.x, y: b.y, w: b.w, h: b.h, fontFace: FACE, fontSize: 11, color: TEXT, margin: 0, valign: "top", ...opts });
  const box = (slide: any, b: DeckBox, fill: string) => slide.addShape(pptx.ShapeType.rect, { x: b.x, y: b.y, w: b.w, h: b.h, fill: { color: fill }, line: { color: fill, width: 0 } });

  const blockTitle = (slide: any, title: string | undefined, b: DeckBox): DeckBox => {
    if (!title) return b;
    text(slide, title, { x: b.x, y: b.y, w: b.w, h: P.blockTitleH - 0.04 }, { fontSize: 11.5, bold: true, color: NAVY });
    return { x: b.x, y: b.y + P.blockTitleH, w: b.w, h: b.h - P.blockTitleH };
  };

  const tiles = (slide: any, t: DeckTiles, b: DeckBox) => {
    tileBoxes(t, b).forEach((tb, i) => {
      const tile = t.tiles[i];
      slide.addText([
        { text: clean(tile.value), options: { fontSize: tileValueSize(tile.value, tb), bold: true, color: NAVY, breakLine: true } },
        { text: clean(tile.label), options: { fontSize: 9.5, color: TEXT } },
      ], { x: tb.x, y: tb.y, w: tb.w, h: tb.h, fontFace: FACE, fill: { color: PALE }, valign: "middle", align: "left", margin: [13, 4, 10, 4] });
    });
  };

  const chartBlock = (slide: any, chart: DeckChart, b: DeckBox) => {
    const area = blockTitle(slide, chart.title, b);
    const many = chart.series.length > 1;
    const stacked = chart.chart === "stackedBar" || chart.chart === "shareBar";
    // PowerPoint draws nothing for a missing figure; a stacked bar treats it as nought.
    const data = chart.series.map(s => ({ name: clean(s.name) || "Figures", labels: chart.categories.map(clean), values: s.values.map(v => (typeof v === "number" && Number.isFinite(v) ? v : stacked ? 0 : null)) }));
    // A chart of a few bars does not stretch them to fill its box: the PDF caps a row at 0.72in too.
    const h = chart.chart === "column" ? area.h : Math.min(area.h, chart.categories.length * 0.72 * (stacked ? 1 : Math.max(1, chart.series.length * 0.6)) + (many ? 0.4 : 0) + 0.2);
    slide.addChart(pptx.ChartType.bar, data, {
      x: area.x, y: area.y, w: area.w, h,
      barDir: chart.chart === "column" ? "col" : "bar",
      barGrouping: chart.chart === "stackedBar" ? "stacked" : chart.chart === "shareBar" ? "percentStacked" : "clustered",
      barGapWidthPct: chart.chart === "column" ? 60 : 55,
      ...(stacked ? { barOverlapPct: 100 } : {}),
      chartColors: chart.series.map(s => hex(DECK_COLOURS[s.colour])),
      catAxisOrientation: chart.chart === "column" ? "minMax" : "maxMin",
      catAxisLabelFontFace: FACE, catAxisLabelFontSize: 10, catAxisLabelColor: TEXT, catAxisLabelPos: "low",
      catAxisLineShow: chart.chart === "column", catGridLine: { style: "none" },
      valAxisHidden: true, valAxisLineShow: false, valGridLine: { style: "none" },
      showValue: true, dataLabelFontFace: FACE, dataLabelFontSize: 10, dataLabelFontBold: true, dataLabelColor: TEXT,
      dataLabelPosition: stacked ? "ctr" : "outEnd", dataLabelFormatCode: LABEL_FORMAT[chart.format || "count"],
      showLegend: many, legendPos: "t", legendFontFace: FACE, legendFontSize: 10, legendColor: MUTED,
      showTitle: false, layout: undefined,
    });
  };

  const table = (slide: any, t: DeckTable, b: DeckBox) => {
    const area = blockTitle(slide, t.title, b);
    const total = t.columns.reduce((n, c) => n + c.width, 0);
    const widths = t.columns.map(c => (c.width / total) * area.w);
    const cell = (words: string, i: number, opts: Record<string, unknown>) => ({ text: clean(words), options: { align: t.columns[i].align === "right" ? "right" : "left", valign: "middle", fontFace: FACE, ...opts } });
    const band = (r: number) => (r % 2 === 1 ? { fill: { color: hex(DECK_TINTS.band) } } : {});
    // A progress strip is a run of small squares, the first few navy and the rest grey, then the word: text, so it can be edited.
    const strip = (words: string, steps: number, r: number) => {
      const { filled, word } = readSteps(words);
      const on = Math.min(steps, filled);
      return {
        text: [
          ...(on > 0 ? [{ text: "\u25A0".repeat(on), options: { color: NAVY, fontSize: 10 } }] : []),
          ...(steps - on > 0 ? [{ text: "\u25A0".repeat(steps - on), options: { color: hex(DECK_COLOURS.grey), fontSize: 10 } }] : []),
          { text: ` ${clean(word)}`, options: { color: TEXT, fontSize: 9.5 } },
        ],
        options: { align: "left", valign: "middle", fontFace: FACE, ...band(r) },
      };
    };
    const rows = [
      t.columns.map((c, i) => cell(c.header, i, { bold: true, color: WHITE, fill: { color: NAVY }, fontSize: 9 })),
      ...t.rows.map((cells, r) => t.columns.map((c, i) => (c.steps ? strip(cells[i] ?? "", c.steps, r) : cell(fitCell(cells[i] ?? "", widths[i], 9.5, t.lines === 2 ? 2 : 1), i, { color: TEXT, fontSize: 9.5, ...band(r) })))),
    ];
    slide.addTable(rows, {
      x: area.x, y: area.y, w: area.w, colW: widths, rowH: [P.tableHeadH, ...t.rows.map(() => tableRowHeight(t.lines))],
      border: { type: "none" }, margin: [0.02, 0.07, 0.02, 0.07], autoPage: false,
    });
  };

  const card = (slide: any, c: DeckCard, b: DeckBox) => {
    box(slide, b, hex(DECK_TINTS.card));
    box(slide, { x: b.x, y: b.y, w: 0.07, h: b.h }, GOLD);
    slide.addText([
      { text: clean(c.title), options: { fontSize: 15, bold: true, color: NAVY, breakLine: true, paraSpaceAfter: 8 } },
      ...c.lines.map((line, i) => ({ text: clean(line), options: { fontSize: 11, color: TEXT, breakLine: i < c.lines.length - 1, paraSpaceAfter: 6 } })),
    ], { x: b.x + 0.4, y: b.y + 0.15, w: b.w - 0.75, h: b.h - 0.3, fontFace: FACE, valign: "middle", margin: 0 });
  };

  const words = (slide: any, w: DeckWords, b: DeckBox) => {
    const area = blockTitle(slide, w.title, b);
    const size = w.dense ? 9.5 : 11;
    slide.addText([
      ...w.paragraphs.map((p, i) => ({ text: clean(p), options: { fontSize: size, color: TEXT, breakLine: i < w.paragraphs.length - 1 || !!w.credit, paraSpaceAfter: w.dense ? 6 : 7 } })),
      ...(w.credit ? [{ text: clean(w.credit), options: { fontSize: 9, color: MUTED } }] : []),
    ], { x: area.x, y: area.y, w: area.w, h: area.h, fontFace: FACE, valign: "top", margin: 0, lineSpacingMultiple: 1.08, fit: "shrink" });
  };

  const titleSlide = (slide: any, s: DeckSlide) => {
    slide.background = { color: NAVY };
    if (light) slide.addImage({ data: image(light), x: P.side, y: 0.62, w: 1.15 * LANDSEC_LOGO_RATIO, h: 1.15 });
    text(slide, s.title, { x: P.side, y: 2.6, w: P.w - P.side * 2, h: 1.1 }, { fontSize: 40, bold: true, color: WHITE, valign: "bottom", fit: "shrink" });
    if (s.subtitle) text(slide, s.subtitle, { x: P.side, y: 3.78, w: P.w - P.side * 2, h: 0.45 }, { fontSize: 20, color: PALE });
    box(slide, { x: P.side, y: 4.42, w: 1.6, h: 0.05 }, GOLD);
    if (s.lines?.length) slide.addText(s.lines.map((line, i) => ({ text: clean(line), options: { breakLine: i < s.lines!.length - 1 } })),
      { x: P.side, y: 4.72, w: P.w - P.side * 2 - 2, h: 1.4, fontFace: FACE, fontSize: 12, color: WHITE, valign: "top", margin: 0, paraSpaceAfter: 4 });
    text(slide, deck.footer, { x: P.side, y: P.footY, w: P.w - P.side * 2, h: 0.22 }, { fontSize: 8, color: PALE });
  };

  const contentSlide = (slide: any, s: DeckSlide, index: number, count: number) => {
    slide.background = { color: WHITE };
    const logoH = 0.66, logoW = dark ? logoH * LANDSEC_LOGO_RATIO : 0;
    if (dark) slide.addImage({ data: image(dark), x: P.w - P.side - logoW, y: 0.4, w: logoW, h: logoH });
    const room = P.w - P.side * 2 - logoW - 0.4;
    text(slide, s.title, { x: P.side, y: P.titleY - 0.05, w: room, h: 0.5 }, { fontSize: 24, bold: true, color: NAVY, valign: "middle", fit: "shrink" });
    if (s.subtitle) text(slide, s.subtitle, { x: P.side, y: P.subtitleY - 0.02, w: room, h: 0.28 }, { fontSize: 11.5, color: MUTED });
    box(slide, { x: P.side, y: P.ruleY, w: P.w - P.side * 2, h: 0.02 }, GOLD);
    for (const placed of layoutSlide(s)) {
      const b = placed.block;
      if (b.kind === "tiles") tiles(slide, b, placed);
      else if (b.kind === "chart") chartBlock(slide, b, placed);
      else if (b.kind === "table") table(slide, b, placed);
      else if (b.kind === "card") card(slide, b, placed);
      else words(slide, b, placed);
    }
    if (s.caveat) text(slide, s.caveat, { x: P.side, y: P.caveatY, w: P.w - P.side * 2, h: 0.4 }, { fontSize: 9, color: MUTED });
    box(slide, { x: P.side, y: P.footRuleY, w: P.w - P.side * 2, h: 0.012 }, SAND);
    text(slide, deck.footer, { x: P.side, y: P.footY, w: P.w - P.side * 2 - 1.2, h: 0.22 }, { fontSize: 7.5, color: MUTED });
    text(slide, `${index + 1} of ${count}`, { x: P.w - P.side - 1.1, y: P.footY, w: 1.1, h: 0.22 }, { fontSize: 7.5, color: MUTED, align: "right" });
  };

  deck.slides.forEach((s, i) => {
    const slide = pptx.addSlide();
    if (s.layout === "title") titleSlide(slide, s); else contentSlide(slide, s, i, deck.slides.length);
    // The rule in full, under the slide, for whoever presents it.
    const under = [s.caveat, ...(s.rules || [])].filter((line): line is string => !!line);
    if (under.length) slide.addNotes(Array.from(new Set(under)).map(clean).join("\n\n"));
  });

  const out = Buffer.from(await pptx.write({ outputType: "nodebuffer" }) as ArrayBuffer);
  return labelColours(out, deck);
}

/**
 * A figure written inside a stacked bar is white on a dark series and dark on
 * a light one. pptxgenjs gives a chart one label colour, so each series'
 * label colour is set here, in the chart's own XML, in the order the charts
 * were added.
 */
async function labelColours(file: Buffer, deck: Deck): Promise<Buffer> {
  const charts = deck.slides.flatMap(s => (s.layout === "title" ? [] : layoutSlide(s).map(p => p.block))).filter((b): b is DeckChart => b.kind === "chart");
  if (!charts.some(c => c.chart === "stackedBar" || c.chart === "shareBar")) return file;
  const zip = await JSZip.loadAsync(file);
  const names = Object.keys(zip.files).filter(n => /^ppt\/charts\/chart\d+\.xml$/.test(n)).sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
  if (names.length !== charts.length) return file;
  for (let i = 0; i < names.length; i++) {
    const chart = charts[i];
    if (chart.chart !== "stackedBar" && chart.chart !== "shareBar") continue;
    const xml = await zip.file(names[i])!.async("string");
    let n = -1;
    const next = xml.replace(/<c:ser>[\s\S]*?<\/c:ser>/g, ser => {
      n += 1;
      const series = chart.series[n];
      if (!series) return ser;
      const want = lightOn(series.colour) ? WHITE : TEXT;
      return ser.replace(/(<c:dLbls>[\s\S]*?<a:solidFill>\s*<a:srgbClr val=")[0-9A-Fa-f]{6}("\s*\/>)/, `$1${want}$2`);
    });
    zip.file(names[i], next);
  }
  return Buffer.from(await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
}
