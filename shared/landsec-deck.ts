// The Landsec report decks: the slide model (Woody, 2026-11-19, on the first
// populated samples: "we dont need complicated excels just visual PDF which
// can also be power point").
//
// A deck is DATA: a list of 16:9 slides, each a few rows of blocks (big
// figures, a chart with its series, a short table, a plain card, a few
// paragraphs). The same deck is drawn twice, by server/landsec-deck-pdf.ts
// (a PDF, charts drawn by hand) and server/landsec-deck-pptx.ts (a
// PowerPoint, with native charts and tables Landsec can edit). Where a block
// sits on its slide, how many table rows fit, how big a figure is written and
// what colour a series takes are all decided HERE, so the two files are the
// same slides.
//
// This file knows nothing of lettings or schemes: what goes on each slide is
// shared/landsec-decks.ts. Pure. Tests: shared/landsec-deck.test.ts.
import { LANDSEC_REPORT_PALETTE } from "./landsec-reports";

// ── Colours ──────────────────────────────────────────────────────────────

const mix = (a: string, b: string, t: number): string => {
  const part = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
  return `#${[0, 1, 2].map(i => Math.round(part(a, i) + (part(b, i) - part(a, i)) * t).toString(16).padStart(2, "0")).join("")}`;
};

/**
 * The colours a chart series may take, all from the Landsec report palette:
 * navy, a mid blue mixed from navy and the pale blue, the gold accent, the
 * pale blue itself, and one neutral grey mixed from the sand and the muted
 * text for "vacant" and "not held". A series keeps its colour on every slide
 * (DECK_SERIES below), so a colour always means the same thing.
 */
export const DECK_COLOURS = {
  navy: LANDSEC_REPORT_PALETTE.navy,
  blue: mix(LANDSEC_REPORT_PALETTE.navy, LANDSEC_REPORT_PALETTE.paleBlue, 0.48),
  gold: LANDSEC_REPORT_PALETTE.gold,
  pale: LANDSEC_REPORT_PALETTE.paleBlue,
  grey: mix(LANDSEC_REPORT_PALETTE.sand, LANDSEC_REPORT_PALETTE.muted, 0.28),
} as const;
export type DeckColour = keyof typeof DECK_COLOURS;
/** The two quiet grounds, mixed from the palette with white: the banding of a table's rows, and a card. */
export const DECK_TINTS = {
  band: mix(LANDSEC_REPORT_PALETTE.paleBlue, "#ffffff", 0.55),
  card: mix(LANDSEC_REPORT_PALETTE.sand, "#ffffff", 0.4),
} as const;
/** Whether a label written on a colour is white (else the dark text colour). */
export const lightOn = (colour: DeckColour): boolean => colour === "navy" || colour === "blue";

/** What each series is called and the one colour it has wherever it is drawn. */
export const DECK_SERIES = {
  occupied: { name: "Occupied", colour: "navy" },
  vacant: { name: "Vacant", colour: "grey" },
  notRecorded: { name: "Not recorded", colour: "pale" },
  marketing: { name: "Marketing", colour: "pale" },
  negotiating: { name: "Negotiating", colour: "blue" },
  hots: { name: "HOTs", colour: "gold" },
  solicitors: { name: "Solicitors", colour: "navy" },
  exchanged: { name: "Exchanged or completed", colour: "navy" },
  hotsAgreed: { name: "Heads of Terms agreed", colour: "gold" },
  instructions: { name: "New instructions", colour: "blue" },
  expiries: { name: "Lease expiries", colour: "navy" },
  breaks: { name: "Breaks", colour: "gold" },
  vsPrevious: { name: "Against the previous rent", colour: "navy" },
  vsErv: { name: "Against ERV", colour: "gold" },
  targetEarly: { name: "Wanted or unit identified", colour: "pale" },
  targetApproached: { name: "Approached or viewed", colour: "blue" },
  targetTerms: { name: "Negotiating or HOTs", colour: "gold" },
  targetLegal: { name: "Solicitors or let", colour: "navy" },
  one: { name: "", colour: "navy" },
} as const satisfies Record<string, { name: string; colour: DeckColour }>;

// ── The model ────────────────────────────────────────────────────────────

export interface DeckTile { label: string; value: string }
export interface DeckTiles { kind: "tiles"; tiles: DeckTile[]; /** Tiles on a line; the rest wrap under. Default: all on one line. */ perRow?: number }

export type DeckChartKind =
  /** Horizontal bars, one group per category (a funnel is this, in stage order). */
  | "bar"
  /** Horizontal bars, the series stacked to a total. */
  | "stackedBar"
  /** Horizontal bars, the series stacked to 100% of each category. */
  | "shareBar"
  /** Vertical columns, one group per category. */
  | "column";
export type DeckValueFormat = "count" | "pct" | "days" | "money";
export interface DeckSeries { name: string; colour: DeckColour; values: Array<number | null> }
export interface DeckChart { kind: "chart"; chart: DeckChartKind; title?: string; categories: string[]; series: DeckSeries[]; format?: DeckValueFormat }

export interface DeckColumn {
  header: string; /** A share of the table's width. */ width: number; align?: "left" | "right";
  /** A progress strip: this many small steps, the first few filled, then a word. Its cells are written with `stepsCell`. */
  steps?: number;
}
/** A cell of a progress-strip column: how many steps are filled, and the word beside them. */
export const stepsCell = (filled: number, word: string): string => `${Math.max(0, Math.floor(filled))}:${word}`;
export function readSteps(cell: string | null | undefined): { filled: number; word: string } {
  const m = /^(\d+):([\s\S]*)$/.exec(String(cell ?? ""));
  return m ? { filled: Number(m[1]), word: m[2].trim() } : { filled: 0, word: String(cell ?? "").trim() };
}
export interface DeckTable { kind: "table"; title?: string; columns: DeckColumn[]; rows: string[][] }
/** A plain box of words: what stands in for a chart that would be empty, or says a figure is not held. */
export interface DeckCard { kind: "card"; title: string; lines: string[] }
/** Words a person wrote (the market report), or the rules at the back. */
export interface DeckWords { kind: "words"; title?: string; paragraphs: string[]; credit?: string; /** Small type: the rules at the back. */ dense?: boolean }
export type DeckBlock = DeckTiles | DeckChart | DeckTable | DeckCard | DeckWords;

export interface DeckRow {
  blocks: DeckBlock[];
  /** A fixed height in inches. Without one, a row of tiles takes what its tiles need and any other row shares what is left. */
  height?: number;
  /** A row of tiles that should grow to fill the slide. */
  fill?: boolean;
  /** Shares of the width, one per block. Default: equal. */
  widths?: number[];
}

export interface DeckSlide {
  /** "title": the navy opening slide (title, subtitle, and `lines` under them). */
  layout: "title" | "content";
  title: string;
  subtitle?: string;
  /** Title slide only: a few short lines under the subtitle. */
  lines?: string[];
  rows: DeckRow[];
  /** One line at the foot of the slide: how the figures on it are counted. */
  caveat?: string;
  /** The rule in full. The PowerPoint carries it under the slide for whoever presents; the last slides print every rule. */
  rules?: string[];
}

export interface Deck {
  title: string;
  subtitle: string;
  /** "Made in ChatBGP on 19 November 2026 by Jonny Rushton. It holds what is recorded in ChatBGP on that day." */
  footer: string;
  slides: DeckSlide[];
}

// ── Where things sit (inches, on a 13.333 x 7.5 slide) ───────────────────

export const DECK_PAGE = {
  w: 13.333, h: 7.5, side: 0.6,
  titleY: 0.42, subtitleY: 0.93, ruleY: 1.3,
  top: 1.52, bottom: 6.78, bottomWithCaveat: 6.42, caveatY: 6.53,
  footRuleY: 7.02, footY: 7.1,
  rowGap: 0.22, blockGap: 0.34,
  tileH: 1.12, tileGap: 0.14,
  blockTitleH: 0.34, legendH: 0.28,
  tableHeadH: 0.32, tableRowH: 0.3,
} as const;

export interface DeckBox { x: number; y: number; w: number; h: number }
export interface DeckPlaced extends DeckBox { block: DeckBlock }

const tileLines = (t: DeckTiles): number => Math.max(1, Math.ceil(t.tiles.length / Math.max(1, t.perRow || t.tiles.length)));
const tilesNeed = (t: DeckTiles): number => tileLines(t) * DECK_PAGE.tileH + (tileLines(t) - 1) * DECK_PAGE.tileGap;

/** Where each block of a content slide sits. The one layout both renderers draw from. */
export function layoutSlide(slide: DeckSlide): DeckPlaced[] {
  const P = DECK_PAGE;
  const bottom = slide.caveat ? P.bottomWithCaveat : P.bottom;
  const rows = slide.rows.filter(r => r.blocks.length > 0);
  const fixed = rows.map(r => {
    if (typeof r.height === "number") return r.height;
    if (!r.fill && r.blocks.every(b => b.kind === "tiles")) return Math.max(...r.blocks.map(b => tilesNeed(b as DeckTiles)));
    return null;
  });
  const free = (bottom - P.top) - P.rowGap * Math.max(0, rows.length - 1) - fixed.reduce<number>((n, h) => n + (h ?? 0), 0);
  const flexible = fixed.filter(h => h == null).length;
  const out: DeckPlaced[] = [];
  let y = P.top;
  rows.forEach((row, i) => {
    const h = fixed[i] ?? Math.max(0.8, free / Math.max(1, flexible));
    const shares = row.blocks.map((_, k) => (row.widths && row.widths[k] > 0 ? row.widths[k] : 1));
    const total = shares.reduce((n, s) => n + s, 0);
    const inner = (P.w - P.side * 2) - P.blockGap * (row.blocks.length - 1);
    let x = P.side;
    row.blocks.forEach((block, k) => {
      const w = (shares[k] / total) * inner;
      out.push({ block, x, y, w, h });
      x += w + P.blockGap;
    });
    y += h + P.rowGap;
  });
  return out;
}

/** The boxes of a tiles block's tiles, inside its own box. */
export function tileBoxes(t: DeckTiles, box: DeckBox): DeckBox[] {
  const P = DECK_PAGE;
  const perRow = Math.max(1, t.perRow || t.tiles.length), lines = tileLines(t);
  const w = (box.w - P.tileGap * (perRow - 1)) / perRow;
  const h = (box.h - P.tileGap * (lines - 1)) / lines;
  return t.tiles.map((_, i) => ({ x: box.x + (i % perRow) * (w + P.tileGap), y: box.y + Math.floor(i / perRow) * (h + P.tileGap), w, h }));
}

/** The size, in points, a tile's figure is written at: big, but never wider than its tile. */
export function tileValueSize(value: string, tile: Pick<DeckBox, "w" | "h">): number {
  const byHeight = Math.min(46, Math.max(20, tile.h * 72 * 0.34));
  const byWidth = ((tile.w * 72) - 30) / (Math.max(1, value.length) * 0.58);
  return Math.round(Math.max(13, Math.min(byHeight, byWidth)));
}

/** How many rows of a table fit a block of this height (inches). */
export function tableRowsThatFit(height: number, titled = false): number {
  const P = DECK_PAGE;
  return Math.max(1, Math.floor((height - (titled ? P.blockTitleH : 0) - P.tableHeadH + 0.001) / P.tableRowH));
}
/** The height of the flexible rows of a slide: all of it for one, shared for more. */
export function freeHeight(caveat: boolean, rowsAbove = 0): number {
  const P = DECK_PAGE;
  return (caveat ? P.bottomWithCaveat : P.bottom) - P.top - rowsAbove;
}

/** A list cut into pages of at most `size`. An empty list is one empty page. */
export function pages<T>(list: T[], size: number): T[][] {
  const n = Math.max(1, Math.floor(size));
  if (list.length === 0) return [[]];
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  return out;
}

/** As `pages`, but the pages are of even length, so the last slide of a long table is not a few stray rows. */
export function pagesEven<T>(list: T[], size: number): T[][] {
  const n = Math.max(1, Math.floor(size));
  const count = Math.max(1, Math.ceil(list.length / n));
  return pages(list, Math.ceil(list.length / count) || n);
}

/** About how many characters of ordinary text fit one line of this width (inches) at this size (points). */
export const charsPerLine = (width: number, size: number): number => Math.max(4, Math.floor((width * 72) / (size * 0.5)));

/** A cell's words cut to one line of its column, with "..." when cut. Both renderers write this, so a row is one line in each. */
export function fitCell(words: string, width: number, size = 9.5): string {
  const text = String(words ?? "").replace(/\s+/g, " ").trim();
  const max = Math.max(3, Math.floor(charsPerLine(Math.max(0.2, width - 0.12), size) * 0.92));
  return text.length <= max ? text : `${text.slice(0, Math.max(1, max - 3)).trimEnd()}...`;
}

/** Paragraphs cut into pages by an estimate of what fits: the first page holds `first` characters, each later one `next`. A paragraph too long for a page is cut at a sentence or a space. */
export function pageWords(paragraphs: string[], first: number, next: number): string[][] {
  const out: string[][] = [[]];
  let room = Math.max(200, first);
  const push = (text: string) => { out[out.length - 1].push(text); room -= text.length + 60; };
  const turn = () => { out.push([]); room = Math.max(200, next); };
  for (const raw of paragraphs) {
    let rest = String(raw || "").trim();
    while (rest) {
      if (rest.length + 60 <= room || (out[out.length - 1].length === 0 && rest.length <= room)) { push(rest); rest = ""; break; }
      if (room < 260) { turn(); continue; }
      const window = rest.slice(0, room - 60);
      let cut = Math.max(window.lastIndexOf(". "), window.lastIndexOf("? "), window.lastIndexOf("! "));
      cut = cut > window.length * 0.4 ? cut + 1 : window.lastIndexOf(" ");
      if (cut <= 0) cut = window.length;
      push(rest.slice(0, cut).trim());
      rest = rest.slice(cut).trim();
      if (rest) turn();
    }
  }
  return out.filter((page, i) => page.length > 0 || i === 0);
}

// ── Charts ───────────────────────────────────────────────────────────────

/** A figure as it is written on a bar. */
export function deckValue(n: number | null | undefined, format: DeckValueFormat = "count"): string {
  if (n == null || !Number.isFinite(n)) return "";
  if (format === "pct") return `${n > 0 ? "+" : ""}${n.toFixed(1)}%`;
  if (format === "days") return `${Math.round(n).toLocaleString("en-GB")} ${Math.round(n) === 1 ? "day" : "days"}`;
  if (format === "money") return `£${Math.round(n).toLocaleString("en-GB")}`;
  return Math.round(n).toLocaleString("en-GB");
}

/** Whether a chart has anything to draw: at least one figure that is held and is not nought. */
export function chartHasData(chart: Pick<DeckChart, "series" | "categories">): boolean {
  return chart.categories.length > 0 && chart.series.some(s => s.values.some(v => typeof v === "number" && Number.isFinite(v) && v !== 0));
}

/** The chart, or the plain card that says why there is none. Never an empty chart. */
export function chartOrCard(chart: DeckChart, empty: { title: string; lines: string[] }): DeckChart | DeckCard {
  return chartHasData(chart) ? chart : { kind: "card", title: empty.title, lines: empty.lines };
}

/** A chart without the categories that are nought in every series (a scheme with nothing to show), unless that would leave none. */
export function withoutEmptyCategories(chart: DeckChart): DeckChart {
  const keep = chart.categories.map((_, i) => chart.series.some(s => typeof s.values[i] === "number" && s.values[i] !== 0));
  if (!keep.some(Boolean)) return chart;
  return { ...chart, categories: chart.categories.filter((_, i) => keep[i]), series: chart.series.map(s => ({ ...s, values: s.values.filter((_, i) => keep[i]) })) };
}

// ── What a deck is called ────────────────────────────────────────────────

export type DeckFileFormat = "pdf" | "pptx";
export const deckFormat = (asked: unknown): DeckFileFormat | null => {
  const f = String(asked ?? "").trim().toLowerCase();
  return f === "" || f === "pdf" ? "pdf" : f === "pptx" || f === "powerpoint" ? "pptx" : null;
};
export const DECK_MIME: Record<DeckFileFormat, string> = {
  pdf: "application/pdf",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

/** The slides' titles, in order: what the two files must agree on. */
export const deckOutline = (deck: Deck): string[] => deck.slides.map(s => s.title);
