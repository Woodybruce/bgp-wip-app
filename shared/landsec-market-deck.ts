// The Landsec market report as slides (Woody, 2026-11-19: "a comprehensive
// market report broken into sectors similar to our brands page ... also to
// include any competition news such as buying shopping centres or their
// leasing ie Hammerson and Canary Wharf").
//
//   marketDeck          the Market report deck: an overview, then each sector
//                       (its words, its most active brands, who is doing what
//                       category by category, what BGP's own records hold),
//                       the competition, the research read, and the sources.
//   boardMarketSlides   the shorter market part of the Board report.
//
// It counts nothing new: every item, mover and figure is worked out by
// shared/landsec-market-report.ts. Words are on a slide only where a person
// saved them. No AI is asked anything here. Pure.
// Tests: shared/landsec-market-deck.test.ts.
import {
  DECK_PAGE, DECK_SERIES, charsPerLine, chartOrCard, deckValue, freeHeight, pageWords, tableHeight, tableRowsThatFit,
  type Deck, type DeckBlock, type DeckChart, type DeckColumn, type DeckRow, type DeckSlide,
} from "./landsec-deck";
import { shortReportDay, type ReportPeriod } from "./landsec-reports";
import {
  COMPETITION_THEMES, MARKET_GROUPS, MARKET_OTHER_GROUP, MARKET_SOURCES, MARKET_WORD_SECTIONS, brandMark, itemsIn, marketCategories, marketKindLabel, marketMovers, marketStrip, sectionOfGroup,
  type CompetitionItem, type CompetitionTheme, type MarketData, type MarketItem, type MarketStrip, type MarketWordKey, type MarketWords,
} from "./landsec-market-report";

export interface MarketDeckInput {
  period: Pick<ReportPeriod, "label" | "from" | "to">;
  schemes: Array<{ key: string; name: string }>;
  footer: string;
  data: MarketData;
  /** The words people saved, by section. */
  words: MarketWords;
}

const count = (n: number | null | undefined): string => deckValue(n ?? 0, "count");
const signed = (n: number): string => `${n > 0 ? "+" : ""}${count(n)}`;
const plural = (n: number, one: string, many: string): string => `${count(n)} ${n === 1 ? one : many}`;
/** Items per category, and items of the competition per theme, that a deck prints: the rest are in the data export. */
export const MARKET_DECK_PER_CATEGORY = 12;
export const MARKET_DECK_PER_THEME = 18;
/** Rows of BGP's own records a sector's slides print. */
export const MARKET_DECK_OWN = 16;

const ITEM_COLUMNS: DeckColumn[] = [{ header: "Date", width: 1 }, { header: "Brand", width: 2.1 }, { header: "Kind", width: 1.5 }, { header: "What happened", width: 6.1 }, { header: "Source", width: 1.5 }];
const itemRow = (i: MarketItem): string[] => [shortReportDay(i.day), brandMark(i), marketKindLabel(i.kind), i.line, i.source];
const OWN_COLUMNS: DeckColumn[] = [{ header: "Date", width: 1 }, { header: "Brand", width: 2.1 }, { header: "Kind", width: 1.5 }, { header: "What BGP holds", width: 7.6 }];
const NARROW_COLUMNS: DeckColumn[] = [{ header: "Date", width: 1.05 }, { header: "Brand", width: 1.7 }, { header: "What happened", width: 4.3 }, { header: "Source", width: 1.25 }];
const narrowRow = (i: MarketItem): string[] => [shortReportDay(i.day), brandMark(i), `${marketKindLabel(i.kind)}: ${i.line}`, i.source];
const COMPETITION_COLUMNS: DeckColumn[] = [{ header: "Date", width: 1 }, { header: "Landlord or centre", width: 2.3 }, { header: "What happened", width: 7.3 }, { header: "Source", width: 1.6 }];
const competitionRow = (c: CompetitionItem): string[] => [shortReportDay(c.day), c.subject, c.line, c.source];

const stripTiles = (s: MarketStrip): DeckBlock => ({ kind: "tiles", tiles: [
  { label: "Brands with an opening story", value: count(s.opening) },
  { label: "Brands closing or in administration", value: count(s.closing) },
  { label: "Net change in stores", value: s.netStores == null ? "No counts yet" : signed(s.netStores) },
  { label: "Lettings BGP recorded elsewhere", value: count(s.lettings) },
  { label: "Planning applications", value: count(s.planning) },
  { label: "Requirements BGP added", value: count(s.requirements) },
] });

/** The brands with the most evidence, as stacked bars: what kind of evidence each has. */
function moversChart(items: MarketItem[], group: string | null, title: string, max = 8): DeckBlock {
  const movers = marketMovers(items, group, max);
  const chart: DeckChart = {
    kind: "chart", chart: "stackedBar", title, format: "count", categories: movers.map(m => m.brand),
    series: [
      { ...DECK_SERIES.moverGrowing, values: movers.map(m => m.growing) }, { ...DECK_SERIES.moverMoney, values: movers.map(m => m.money) },
      { ...DECK_SERIES.moverPipeline, values: movers.map(m => m.pipeline) }, { ...DECK_SERIES.moverShrinking, values: movers.map(m => m.shrinking) },
    ],
  };
  return chartOrCard(chart, { title: "No brand has evidence of a move in the period", lines: ["No opening, closure, funding, planning application, requirement or letting is recorded for a brand here in the period."] });
}

/** Saved words as one or more blocks of a slide: what does not fit the first carries on over further slides. */
function wordPages(text: string, firstWidth: number, firstHeight: number): string[][] {
  const lineChars = (width: number) => charsPerLine(width, 11);
  const linesIn = (height: number) => Math.max(4, Math.floor(((height - DECK_PAGE.blockTitleH - 0.3) * 72) / 15.4));
  const first = Math.floor(lineChars(firstWidth) * linesIn(firstHeight) * 0.82);
  const next = Math.floor(lineChars(DECK_PAGE.w - DECK_PAGE.side * 2) * linesIn(freeHeight(false)) * 0.82);
  return pageWords(text.split(/\n+/).map(p => p.trim()).filter(Boolean), first, next);
}

const FULL = DECK_PAGE.w - DECK_PAGE.side * 2;
const HALF = (FULL - DECK_PAGE.blockGap) / 2;

/** A summary slide: the strip, then the saved words (where there are some) beside the most active brands, or the top items beside them. */
function summarySlides(o: { title: string; subtitle: string; strip: MarketStrip; items: MarketItem[]; group: string | null; saved: MarketWords[MarketWordKey] | undefined; wordsTitle: string; caveat: string; perBrand: number }): DeckSlide[] {
  const body = freeHeight(true, DECK_PAGE.tileH + DECK_PAGE.rowGap);
  const chart = moversChart(o.items, o.group, "Most active brands");
  // Public reports and lettings lead; what else BGP's records hold follows.
  const all = itemsIn(o.items, { group: o.group, perBrand: o.perBrand });
  const top = [...all.filter(i => i.origin === "public" || i.kind === "letting"), ...all.filter(i => i.origin !== "public" && i.kind !== "letting")];
  const fit = tableRowsThatFit(body, true, 2);
  const table: DeckBlock = top.length
    ? { kind: "table", lines: 2, title: "Top items", columns: NARROW_COLUMNS, rows: top.slice(0, fit).map(narrowRow) }
    : { kind: "card", title: "Nothing is recorded for the period", lines: ["No public report and no record of BGP's is dated in the period for this sector."] };
  if (!o.saved?.text) {
    return [{ layout: "content", title: o.title, subtitle: o.subtitle, rows: [{ blocks: [stripTiles(o.strip)] }, { widths: [1.55, 1], blocks: [table, chart] }], caveat: o.caveat, rules: [MARKET_SOURCES] }];
  }
  const credit = `Written by ${o.saved.savedBy} (${o.saved.savedByFirm})`;
  const cut = wordPages(o.saved.text, HALF, body);
  const slides: DeckSlide[] = [{
    layout: "content", title: o.title, subtitle: o.subtitle,
    rows: [{ blocks: [stripTiles(o.strip)] }, { blocks: [{ kind: "words", title: o.wordsTitle, paragraphs: cut[0], credit }, chart] }],
    caveat: o.caveat, rules: [MARKET_SOURCES],
  }];
  cut.slice(1).forEach((page, i) => slides.push({ layout: "content", title: `${o.title} (continued)`, subtitle: `${i + 2} of ${cut.length}`, rows: [{ blocks: [{ kind: "words", paragraphs: page, credit }] }] }));
  return slides;
}

/**
 * Tables stacked down slides, each with its own heading: a table that does not
 * fit what is left of a slide carries on at the top of the next. So a sector's
 * categories read one under the other with no slide left mostly empty.
 */
export function stackTables(base: { title: string; subtitle?: string; caveat?: string; rules?: string[] }, tables: Array<{ title: string; columns: DeckColumn[]; rows: string[][] }>): DeckSlide[] {
  const P = DECK_PAGE;
  const room = freeHeight(!!base.caveat);
  const slides: DeckRow[][] = [[]];
  let left = room;
  for (const t of tables) {
    let rest = t.rows, part = 0;
    while (rest.length) {
      const gap = slides[slides.length - 1].length ? P.rowGap : 0;
      const fits = Math.floor((left - gap - tableHeight(0, true, 2) + 0.001) / P.tableRowH2);
      if (fits < Math.min(2, rest.length)) { slides.push([]); left = room; continue; }
      const now = rest.slice(0, fits);
      const height = tableHeight(now.length, true, 2);
      slides[slides.length - 1].push({ height, blocks: [{ kind: "table", lines: 2, title: part ? `${t.title} (continued)` : t.title, columns: t.columns, rows: now }] });
      left -= height + gap;
      rest = rest.slice(fits); part += 1;
    }
  }
  const used = slides.filter(rows => rows.length);
  return used.map((rows, i) => ({
    layout: "content" as const, title: i === 0 ? base.title : `${base.title} (continued)`,
    subtitle: used.length > 1 ? [base.subtitle, `${i + 1} of ${used.length}`].filter(Boolean).join(" · ") : base.subtitle,
    rows, caveat: base.caveat, rules: base.rules,
  }));
}

const moreLine = (more: number): string => (more > 0 ? `${plural(more, "more item is", "more items are")} in the data export.` : "");

/** One sector: its summary, then who is doing what category by category, then what BGP's own records hold. */
function groupSlides(input: MarketDeckInput, group: string): DeckSlide[] {
  const { data } = input;
  const all = itemsIn(data.items, { group });
  if (all.length === 0 && !input.words[sectionOfGroup(group) || "overall"]?.text) return [];
  const key = sectionOfGroup(group);
  const slides = summarySlides({
    title: group, subtitle: `Who is doing what, ${input.period.label}`, strip: marketStrip(data.items, group), items: data.items, group,
    saved: key ? input.words[key] : undefined, wordsTitle: group, perBrand: 2,
    caveat: "A brand is in a sector by its type. An item is a public report named by its source, or a record of BGP's. A brand marked (target) or (at your schemes) is listed first.",
  });
  // Public reports category by category, then what BGP's own records hold: one under the other, so no slide is left mostly empty.
  let more = 0;
  const tables = marketCategories(group).map(c => {
    const items = itemsIn(all, { category: c.key, origin: "public", perBrand: 3 });
    more += Math.max(0, itemsIn(all, { category: c.key, origin: "public" }).length - Math.min(items.length, MARKET_DECK_PER_CATEGORY));
    return { title: c.label, columns: ITEM_COLUMNS, rows: items.slice(0, MARKET_DECK_PER_CATEGORY).map(itemRow) };
  }).filter(t => t.rows.length);
  const own = itemsIn(all, { origin: "bgp" });
  more += Math.max(0, own.length - MARKET_DECK_OWN);
  if (own.length) tables.push({ title: "BGP intelligence: what BGP's own records hold", columns: OWN_COLUMNS, rows: own.slice(0, MARKET_DECK_OWN).map(i => [shortReportDay(i.day), brandMark(i), marketKindLabel(i.kind), i.line]) });
  slides.push(...stackTables({
    title: `${group}: who is doing what`, subtitle: input.period.label,
    caveat: ["A news item is its headline, publisher and date, never the story's text. BGP's records: lettings at other schemes (brand, scheme, landlord; never a rent or terms; Live is not done), requirements, and viewings and offers here.", moreLine(more)].filter(Boolean).join(" "),
    rules: [MARKET_SOURCES],
  }, tables));
  return slides;
}

const themeItems = (data: MarketData, theme: CompetitionTheme): CompetitionItem[] => data.competition.filter(c => c.theme === theme);

/** The competition: the saved words, then ownership and investment, leasing and openings, redevelopment, each as a table. */
function competitionSlides(input: MarketDeckInput, perTheme = MARKET_DECK_PER_THEME): DeckSlide[] {
  const { data } = input;
  const saved = input.words.competition;
  const slides: DeckSlide[] = [];
  const counts = COMPETITION_THEMES.map(t => ({ ...t, n: themeItems(data, t.key).length }));
  const tiles: DeckBlock = { kind: "tiles", tiles: counts.filter(t => t.key !== "other").map(t => ({ label: t.title, value: count(t.n) })) };
  const subjects = new Map<string, number>();
  for (const c of data.competition.filter(c => c.origin === "public" || !c.line.startsWith("Live"))) subjects.set(c.subject, (subjects.get(c.subject) || 0) + 1);
  const most = Array.from(subjects.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 9);
  const chart = chartOrCard(
    { kind: "chart", chart: "bar", title: "Most in the news", format: "count", categories: most.map(m => m[0]), series: [{ ...DECK_SERIES.one, name: "Items", values: most.map(m => m[1]) }] },
    { title: "No item about another landlord or a competing centre is recorded", lines: ["No public report in the period names a landlord or a competing centre, and BGP's records hold no letting or sale elsewhere in it."] });
  const body = freeHeight(true, DECK_PAGE.tileH + DECK_PAGE.rowGap);
  const caveat = "Other landlords and competing centres: public reports named by their source, the research on the benchmark centres, lettings BGP has recorded at other schemes and sales of centres. News about these schemes and their own landlord is left out.";
  if (saved?.text) {
    const credit = `Written by ${saved.savedBy} (${saved.savedByFirm})`;
    const cut = wordPages(saved.text, HALF, body);
    slides.push({ layout: "content", title: "Competition", subtitle: `Other landlords and competing centres, ${input.period.label}`, rows: [{ blocks: [tiles] }, { blocks: [{ kind: "words", title: "The competition", paragraphs: cut[0], credit }, chart] }], caveat, rules: [MARKET_SOURCES] });
    cut.slice(1).forEach((page, i) => slides.push({ layout: "content", title: "Competition (continued)", subtitle: `${i + 2} of ${cut.length}`, rows: [{ blocks: [{ kind: "words", paragraphs: page, credit }] }] }));
  } else {
    const fit = tableRowsThatFit(body, true, 2);
    const top = data.competition.filter(c => c.theme !== "other" && !c.line.startsWith("Live")).slice(0, fit);
    slides.push({
      layout: "content", title: "Competition", subtitle: `Other landlords and competing centres, ${input.period.label}`,
      rows: [{ blocks: [tiles] }, { widths: [1.55, 1], blocks: [top.length ? { kind: "table", lines: 2, title: "Top items", columns: [{ header: "Date", width: 1.05 }, { header: "Who", width: 1.8 }, { header: "What happened", width: 4.4 }, { header: "Source", width: 1.2 }], rows: top.map(competitionRow) } : { kind: "card", title: "Nothing is recorded for the period", lines: ["No item about another landlord or a competing centre is dated in the period."] }, chart] }],
      caveat, rules: [MARKET_SOURCES],
    });
  }
  let more = 0;
  const tables = COMPETITION_THEMES.filter(t => t.key !== "other").map(t => {
    const items = themeItems(data, t.key);
    more += Math.max(0, items.length - perTheme);
    return { title: t.title, columns: COMPETITION_COLUMNS, rows: items.slice(0, perTheme).map(competitionRow) };
  }).filter(t => t.rows.length);
  more += themeItems(data, "other").length;
  slides.push(...stackTables({
    title: "Competition: who is doing what", subtitle: input.period.label,
    caveat: ["A row from BGP's records marked Live is a letting or a sale that is not done: its stage is said and no terms are.", moreLine(more)].filter(Boolean).join(" "),
    rules: [MARKET_SOURCES],
  }, tables));
  return slides;
}

/** The research papers read in the period, and the market patterns the Insights feed drew: one table each. */
function researchSlides(input: MarketDeckInput): DeckSlide[] {
  const { data } = input;
  const sectionTitle = (key: MarketWordKey) => MARKET_WORD_SECTIONS.find(s => s.key === key)?.title || "Overall";
  const tables = [
    { title: "Research this period", columns: [{ header: "Publisher and month", width: 2.3 }, { header: "Sector", width: 1.5 }, { header: "What it says", width: 5 }, { header: "Checked figures", width: 3.4 }] as DeckColumn[],
      rows: data.research.slice(0, 16).map(r => [r.by, sectionTitle(r.section), r.headline, r.figures.join("; ")]) },
    { title: "Market themes", columns: [{ header: "Date", width: 1 }, { header: "Sector", width: 1.5 }, { header: "Theme", width: 8.1 }, { header: "Drawn from", width: 1.6 }] as DeckColumn[],
      rows: data.themes.slice(0, 14).map(t => [shortReportDay(t.day), sectionTitle(t.section), [t.headline, t.detail].filter(Boolean).join(". "), t.source]) },
  ].filter(t => t.rows.length);
  return stackTables({
    title: "Research and themes", subtitle: input.period.label,
    caveat: "A research paper is named by its publisher and month: its headline and the figures its reader checked against the paper, never its pages. A theme is a pattern the app drew from public news and the trade newsletters.",
    rules: [MARKET_SOURCES],
  }, tables);
}

function sourcesSlide(input: MarketDeckInput): DeckSlide {
  const failed = input.data.notAvailable;
  const paragraphs = [
    MARKET_SOURCES,
    "A brand is in a sector by its type, by the categories of Landsec's agency brief. A hidden brand is left out. One story is listed once, however many publishers carried it.",
    "The words on a sector's first slide are written by BGP and Landsec; a sector with nothing saved shows its items and no words.",
    input.data.level === "live" ? "Rows from BGP's records marked Live are lettings or sales that are not done. They say the stage and never the terms, and may not complete." : "",
    failed.length ? `Not available when this was made: ${failed.join(", ")}. Nothing was put in their place.` : "",
  ].filter(Boolean);
  return { layout: "content", title: "Sources, and what this report does not hold", subtitle: input.period.label, rows: [{ blocks: [{ kind: "words", paragraphs, dense: true }] }] };
}

function overviewSlides(input: MarketDeckInput, title: string): DeckSlide[] {
  const quiet = MARKET_GROUPS.filter(g => g !== MARKET_OTHER_GROUP && itemsIn(input.data.items, { group: g }).length === 0);
  return summarySlides({
    title, subtitle: `Across every sector, ${input.period.label}`, strip: marketStrip(input.data.items, null), items: input.data.items, group: null,
    saved: input.words.overall, wordsTitle: "The market", perBrand: 1,
    caveat: ["Counted across every brand on the app, not only the brands at these schemes. An item is a public report named by its source, or a record of BGP's.", quiet.length ? `Nothing is recorded in the period for ${quiet.join(", ")}.` : ""].filter(Boolean).join(" "),
  });
}

/** The Market report deck. */
export function marketDeck(input: MarketDeckInput): Deck {
  const slides: DeckSlide[] = [{
    layout: "title", title: "Landsec Hospitality & Leisure", subtitle: `Market report, ${input.period.label}`, rows: [],
    lines: [input.schemes.length === 1 ? input.schemes[0].name : `${count(input.schemes.length)} schemes: ${input.schemes.map(s => s.name).join(", ")}`],
  }];
  slides.push(...overviewSlides(input, "Overview"));
  for (const group of MARKET_GROUPS) slides.push(...groupSlides(input, group));
  slides.push(...competitionSlides(input));
  slides.push(...researchSlides(input));
  slides.push(sourcesSlide(input));
  return { title: "Landsec Hospitality & Leisure: market report", subtitle: input.period.label, footer: input.footer, slides };
}

/** The Board report's market part: the overview, a slide a sector, one for the competition, and where the rest is. */
export function boardMarketSlides(input: MarketDeckInput): DeckSlide[] {
  const { data } = input;
  const slides = overviewSlides(input, "Market report");
  for (const group of MARKET_GROUPS.filter(g => g !== MARKET_OTHER_GROUP)) {
    const key = sectionOfGroup(group);
    if (itemsIn(data.items, { group }).length === 0 && !(key && input.words[key]?.text)) continue;
    slides.push(...summarySlides({
      title: `Market report: ${group}`, subtitle: `Who is doing what, ${input.period.label}`, strip: marketStrip(data.items, group), items: data.items, group,
      saved: key ? input.words[key] : undefined, wordsTitle: group, perBrand: 2,
      caveat: "The top items of the sector. The Market report deck lists every item, category by category.",
    }));
  }
  const competition = competitionSlides(input, 0);
  slides.push(...competition.filter(s => s.title === "Competition" || s.title === "Competition (continued)").map(s => ({ ...s, title: s.title.replace("Competition", "Market report: competition"), caveat: s.caveat ? "Other landlords and competing centres. The Market report deck lists every item." : s.caveat })));
  return slides;
}
