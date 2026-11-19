// The three Landsec report decks, as slides (Woody, 2026-11-19: "we dont need
// complicated excels just visual PDF which can also be power point"):
//
//   - the Board report (the ticked schemes, a period),
//   - the Asset profile (one scheme, as recorded today),
//   - Leasing activity (the ticked schemes, a period).
//
// Each function here turns figures the server has already gathered from the
// pages' own feeds into a Deck (shared/landsec-deck.ts): charts and big
// figures first, a short table only where a chart cannot say it. It counts
// nothing new: the board report's figures are worked out by
// shared/landsec-board-report.ts, and these functions only lay them out.
//
// A figure the app does not hold is never estimated: its tile reads "Not
// held", and a chart with nothing to draw is replaced by a plain card saying
// so. Pure. Tests: shared/landsec-decks.test.ts.
import {
  DECK_PAGE, DECK_SERIES, chartOrCard, deckValue, freeHeight, pageWords, pages, pagesEven, stepsCell, tableRowsThatFit, withoutEmptyCategories, charsPerLine,
  type Deck, type DeckBlock, type DeckChart, type DeckColour, type DeckColumn, type DeckSlide, type DeckTable,
} from "./landsec-deck";
import { shortReportDay, reportMonths, type ReportPeriod } from "./landsec-reports";
import {
  BOARD_MARKET_SECTIONS, INDUSTRY_COUNTED, TARGET_BANDS, TARGET_EVENT_WORDS, TARGET_STAGES, categoryRows,
  type BoardActivity, type BoardCounts, type BoardMarket, type BoardMarketKey, type DealSpeed, type IndustryFigures, type RentalGrowth, type SpeedStat, type TargetRow, type TargetTenants,
} from "./landsec-board-report";
import { landsecCategoryLabel } from "./landsec";

// ── Shared pieces ────────────────────────────────────────────────────────

const count = (n: number | null | undefined): string => deckValue(n ?? 0, "count");
const money = (n: number | null | undefined): string => (n == null ? "Not held" : deckValue(n, "money"));
const plural = (n: number, one: string, many: string): string => `${count(n)} ${n === 1 ? one : many}`;
const pct = (n: number | null | undefined): string => (n == null ? "Not held" : deckValue(n, "pct"));
const days = (n: number | null | undefined): string => (n == null ? "None measured" : deckValue(n, "days"));
const share = (n: number, of: number): string => (of > 0 ? `${Math.round((n / of) * 100)}%` : "Not held");
const listed = (names: string[]): string => (names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`);

/** The live stages of a letting, in order, each with the one colour it has on every slide. */
export const DECK_LIVE_STAGES: Array<{ code: string; name: string; colour: DeckColour }> = [
  { code: "AVA", ...DECK_SERIES.marketing }, { code: "NEG", ...DECK_SERIES.negotiating }, { code: "HOT", ...DECK_SERIES.hots }, { code: "SOL", ...DECK_SERIES.solicitors },
];

export interface DeckRollYear { year: number; expiries: number; breaks: number; expiryRent: number | null; breakRent: number | null }
export interface DeckSchemeRow { key: string; name: string; units: number; occupied: number; vacant: number; unknown: number; live: Record<string, number> }

/** The lease roll as a slide: expiries and breaks for ten years from this one, and what falls in the first two. */
function rollSlide(roll: DeckRollYear[], thisYear: number, subtitle: string): DeckSlide {
  const years = Array.from({ length: 10 }, (_, i) => thisYear + i);
  const at = (y: number) => roll.find(r => r.year === y);
  const chart: DeckChart = {
    kind: "chart", chart: "column", categories: years.map(String), format: "count",
    series: [{ ...DECK_SERIES.expiries, values: years.map(y => at(y)?.expiries || 0) }, { ...DECK_SERIES.breaks, values: years.map(y => at(y)?.breaks || 0) }],
  };
  const soon = [at(thisYear), at(thisYear + 1)];
  const sum = (key: "expiries" | "breaks") => soon.reduce((n, r) => n + (r?.[key] || 0), 0);
  const rents = soon.map(r => r?.expiryRent).filter((v): v is number => typeof v === "number");
  const before = roll.filter(r => r.year < thisYear).reduce((n, r) => n + r.expiries, 0);
  const after = roll.filter(r => r.year > thisYear + 9).reduce((n, r) => n + r.expiries, 0);
  const span = `${thisYear} and ${thisYear + 1}`;
  return {
    layout: "content", title: "Lease roll", subtitle,
    rows: [{
      widths: [3.1, 1],
      blocks: [
        chartOrCard(chart, { title: "No lease expiry or break is recorded for the next ten years", lines: ["The tenancy schedule holds no expiry or break date in those years."] }),
        { kind: "tiles", perRow: 1, tiles: [
          { label: `Leases expiring in ${span}`, value: count(sum("expiries")) },
          { label: "Passing rent on them, a year", value: rents.length ? deckValue(rents.reduce((n, v) => n + v, 0), "money") : "Not held" },
          { label: `Breaks in ${span}`, value: count(sum("breaks")) },
        ] },
      ],
    }],
    caveat: [
      "Expiry and break dates as the tenancy schedule holds them today. A unit with both a tenant's and a landlord's break is counted once, in the year of the tenant's.",
      before || after ? `Not drawn: ${[before ? `${plural(before, "expiry", "expiries")} dated before ${thisYear}` : "", after ? `${plural(after, "expiry", "expiries")} after ${thisYear + 9}` : ""].filter(Boolean).join(" and ")}.` : "",
    ].filter(Boolean).join(" "),
  };
}

/** Live lettings by stage for each scheme, stacked: the schemes with none are left off and named. */
function liveByScheme(schemes: DeckSchemeRow[]): { chart: DeckChart; quiet: string[] } {
  const chart: DeckChart = {
    kind: "chart", chart: "stackedBar", title: "By scheme", categories: schemes.map(s => s.name), format: "count",
    series: DECK_LIVE_STAGES.map(st => ({ name: st.name, colour: st.colour, values: schemes.map(s => s.live[st.code] || 0) })),
  };
  return { chart: withoutEmptyCategories(chart), quiet: schemes.filter(s => DECK_LIVE_STAGES.every(st => !s.live[st.code])).map(s => s.name) };
}

const titleSlide = (title: string, subtitle: string, lines: string[]): DeckSlide => ({ layout: "title", title, subtitle, lines, rows: [] });

/** A table continued over as many slides as it needs, each a slide of its own. */
function tableSlides(base: Omit<DeckSlide, "rows" | "layout">, table: Omit<DeckTable, "rows" | "kind">, rows: string[][], empty: { title: string; lines: string[] }): DeckSlide[] {
  if (rows.length === 0) return [{ ...base, layout: "content", rows: [{ blocks: [{ kind: "card", ...empty }] }] }];
  const fit = tableRowsThatFit(freeHeight(!!base.caveat), !!table.title);
  const cut = pagesEven(rows, fit);
  return cut.map((page, i) => ({
    ...base, layout: "content",
    title: i === 0 ? base.title : `${base.title} (continued)`,
    subtitle: cut.length > 1 ? [base.subtitle, `${i + 1} of ${cut.length}`].filter(Boolean).join(" · ") : base.subtitle,
    rows: [{ blocks: [{ kind: "table", ...table, rows: page }] }],
  }));
}

// ── Target tenants ───────────────────────────────────────────────────────
//
// Woody, 2026-11-19: "should be a section on leasing activity on target
// tenants." What is counted is shared/landsec-board-report.ts (targetTenants),
// from the Brand CRM plan as a Landsec login reads it. Here it is laid out:
// the figures, the targets by furthest stage and by scheme, and a grid of the
// targets furthest on, each with its stage as a strip of eight steps.

const TARGET_BAND_SERIES = [DECK_SERIES.targetEarly, DECK_SERIES.targetApproached, DECK_SERIES.targetTerms, DECK_SERIES.targetLegal];
const targetStageChart = (t: TargetTenants): DeckBlock => chartOrCard(
  { kind: "chart", chart: "bar", title: "Targets by the furthest stage reached", format: "count", categories: t.byStage.map(s => s.label), series: [{ ...DECK_SERIES.one, name: "Target brands", values: t.byStage.map(s => s.brands) }] },
  { title: "No target brand is in play", lines: ["The Brand CRM plan holds no brand between Wanted and Let here, as a Landsec login reads it."] });
const lastWords = (r: TargetRow): string => (r.last ? `${TARGET_EVENT_WORDS[r.last.kind]} ${shortReportDay(r.last.day)}` : "None in the period");
const nextWords = (r: TargetRow): string => (r.next ? [r.next.title, r.next.who].filter(Boolean).join(", ") : "");
const targetCaveat = (t: TargetTenants, shown: number, periodLabel: string): string => [
  `As a Landsec login reads the Brand CRM plan today. A brand is counted once, at its furthest line; activity is a dated viewing, approach, offer or stage date in ${periodLabel}.`,
  t.undated ? `${plural(t.undated, "target has", "targets have")} no dated record.` : "",
  t.rows.length > shown ? `${count(t.rows.length - shown)} more ${t.rows.length - shown === 1 ? "target is" : "targets are"} not listed.` : "",
].filter(Boolean).join(" ");
/**
 * The grid's order: the targets still in play (not yet let) lead, furthest on first, and the brands already let follow.
 * A board reads what is moving before what is done. The order within each half is the counting rule's own.
 */
export function inPlayFirst(rows: TargetRow[]): TargetRow[] {
  const let_ = TARGET_STAGES.length;
  return [...rows.filter(r => r.step < let_), ...rows.filter(r => r.step >= let_)];
}
/** A column marked optional is left out when no row shown has a word in it: an empty column is not printed. */
export function columnsWithWords<R>(all: Array<{ column: DeckColumn; cell: (r: R) => string; optional?: boolean }>, rows: R[]) {
  return all.filter(c => !c.optional || rows.some(r => c.cell(r).trim() !== ""));
}
const NO_PLAN: DeckBlock = { kind: "card", title: "The Brand CRM plan could not be read", lines: ["The target tenants are not in this copy. Make the deck again in a moment."] };

/** The board report's target section: the figures and two charts, then the targets furthest on over one or two slides. */
function targetSlides(t: TargetTenants | null, o: { periodLabel: string; schemes: Array<{ key: string; name: string }>; rule: string }): DeckSlide[] {
  const subtitle = `Leasing activity on target brands, ${o.periodLabel}`;
  if (!t) return [{ layout: "content", title: "Target tenants", subtitle, rows: [{ blocks: [NO_PLAN] }] }];
  const schemeName = (key: string) => o.schemes.find(s => s.key === key)?.name || key;
  const withTargets = o.schemes.filter(s => t.byScheme[s.key]);
  const byScheme: DeckChart = {
    kind: "chart", chart: "stackedBar", title: "By scheme", format: "count", categories: withTargets.map(s => s.name),
    series: TARGET_BANDS.map((band, i) => ({ ...TARGET_BAND_SERIES[i], values: withTargets.map(s => t.byScheme[s.key][band.key]) })),
  };
  const slides: DeckSlide[] = [{
    layout: "content", title: "Target tenants", subtitle,
    rows: [
      { blocks: [{ kind: "tiles", tiles: [
        { label: "Target brands in play", value: count(t.inPlay) }, { label: "New in the period", value: count(t.newly) },
        { label: "Reached their present stage in the period", value: count(t.movedForward) }, { label: "Approached in the period", value: count(t.approached) },
        { label: "Viewed in the period", value: count(t.viewed) }, { label: "Made an offer in the period", value: count(t.offers) },
      ] }] },
      { widths: [1, 1.25], blocks: [targetStageChart(t), chartOrCard(byScheme, { title: "No target is in play at any scheme", lines: ["Nothing to draw by scheme."] })] },
    ],
    caveat: targetCaveat(t, t.rows.length, o.periodLabel),
    rules: [o.rule],
  }];
  if (t.rows.length === 0) return slides;
  // The grid: about twelve a slide, three slides at most.
  const perSlide = Math.min(12, tableRowsThatFit(freeHeight(true)));
  const shown = inPlayFirst(t.rows).slice(0, perSlide * 3);
  const all: Array<{ column: DeckColumn; cell: (r: TargetRow) => string; optional?: boolean }> = [
    { column: { header: "Brand", width: 1.9 }, cell: r => r.brand },
    { column: { header: "Category", width: 2.1 }, cell: r => landsecCategoryLabel(r.category) || "" },
    { column: { header: "Scheme and unit", width: 2.8 }, cell: r => [schemeName(r.scheme), r.unit].filter(Boolean).join(", ") },
    { column: { header: "Stage", width: 2.3, steps: TARGET_STAGES.length }, cell: r => stepsCell(r.step, r.stageLabel) },
    { column: { header: "Last activity in the period", width: 2.6 }, cell: r => lastWords(r) },
    { column: { header: "Next step", width: 1.75 }, cell: r => nextWords(r), optional: true },
    { column: { header: "Requirement", width: 1.25 }, cell: r => (r.requirementHeld ? "Held" : ""), optional: true },
  ];
  const kept = columnsWithWords(all, shown);
  const cut = pagesEven(shown, perSlide);
  cut.forEach((page, i) => slides.push({
    layout: "content", title: i === 0 ? "Target tenants: in play" : "Target tenants: in play (continued)",
    subtitle: ["Targets still in play first, furthest on at the top, then those let", cut.length > 1 ? `${i + 1} of ${cut.length}` : ""].filter(Boolean).join(" · "),
    rows: [{ blocks: [{ kind: "table", columns: kept.map(c => c.column), rows: page.map(r => kept.map(c => c.cell(r))) }] }],
    caveat: targetCaveat(t, shown.length, o.periodLabel),
  }));
  return slides;
}

/** The asset profile's one slide of target tenants: the stages as bars, and the targets furthest on at the scheme. */
function assetTargetSlide(t: TargetTenants | null, scheme: string, periodLabel: string): DeckSlide {
  const title = "Target tenants";
  if (!t) return { layout: "content", title, subtitle: scheme, rows: [{ blocks: [NO_PLAN] }] };
  const fit = Math.min(12, tableRowsThatFit(freeHeight(true), true));
  const shown = inPlayFirst(t.rows).slice(0, fit);
  const kept = columnsWithWords<TargetRow>([
    { column: { header: "Brand", width: 1.6 }, cell: r => r.brand },
    { column: { header: "Unit", width: 2.2 }, cell: r => r.unit || "No unit yet" },
    { column: { header: "Stage", width: 2.1, steps: TARGET_STAGES.length }, cell: r => stepsCell(r.step, r.stageLabel) },
    { column: { header: "Last activity in the period", width: 2.4 }, cell: r => lastWords(r) },
    { column: { header: "Next step", width: 1.5 }, cell: r => nextWords(r), optional: true },
  ], shown);
  return {
    layout: "content", title, subtitle: `${plural(t.inPlay, "target brand", "target brands")} in play at ${scheme} · activity in ${periodLabel}`,
    rows: [{
      widths: [1, 3],
      blocks: [targetStageChart(t), shown.length
        ? { kind: "table", title: "In play first, then let", columns: kept.map(c => c.column), rows: shown.map(r => kept.map(c => c.cell(r))) }
        : { kind: "card", title: "No target brand is in play at this scheme", lines: ["Nothing to list."] }],
    }],
    caveat: targetCaveat(t, shown.length, periodLabel),
  };
}

// ── The board report ─────────────────────────────────────────────────────

export interface BoardDeckInput {
  period: Pick<ReportPeriod, "label" | "from" | "to">;
  schemes: Array<{ key: string; name: string }>;
  footer: string;
  /** The year the deck is made in: the lease roll starts there. */
  thisYear: number;
  activity: BoardActivity;
  growth: RentalGrowth;
  speed: DealSpeed;
  schemeRows: DeckSchemeRow[];
  /** The target tenants. Null when the Brand CRM plan could not be read. */
  targets: TargetTenants | null;
  roll: DeckRollYear[];
  industry: Array<{ key: BoardMarketKey; title: string; figures: IndustryFigures }>;
  /** The words people saved for the market report. */
  market: BoardMarket;
  /** How each figure is counted, in full (BOARD_COUNTED on the server). */
  counted: Record<"lettings" | "hots" | "instructions" | "viewings" | "offers" | "occupancy" | "bulk" | "growth" | "speed" | "targets", string>;
}

const ACTIVITY_SERIES = (rows: Array<BoardCounts | undefined>) => [
  { ...DECK_SERIES.exchanged, values: rows.map(c => c?.lettings || 0) },
  { ...DECK_SERIES.hotsAgreed, values: rows.map(c => c?.hots || 0) },
  { ...DECK_SERIES.instructions, values: rows.map(c => c?.instructions || 0) },
];

function speedBlock(title: string, stat: SpeedStat, schemeName: (key: string) => string, reached: string): DeckBlock {
  const rows = stat.rows.slice(0, 10);
  const chart: DeckChart = {
    kind: "chart", chart: "bar", title, format: "days",
    categories: rows.map(r => [r.brand || r.unit || "Letting", schemeName(r.scheme)].filter(Boolean).join(", ")),
    series: [{ ...DECK_SERIES.one, name: "Days", values: rows.map(r => r.days) }],
  };
  return chartOrCard(chart, {
    title: `${title}: none measured`,
    lines: [stat.leftOut
      ? `${plural(stat.leftOut, "letting", "lettings")} ${reached} in the period, but a day is missing, not confirmed or out of order, so ${stat.leftOut === 1 ? "it is" : "they are"} not measured.`
      : `No letting ${reached} in the period.`],
  });
}

export function boardDeck(input: BoardDeckInput): Deck {
  const a = input.activity, t = a.total, g = input.growth, sp = input.speed;
  const schemeName = (key: string) => input.schemes.find(s => s.key === key)?.name || key;
  const occupied = input.schemeRows.reduce((n, s) => n + s.occupied, 0), vacant = input.schemeRows.reduce((n, s) => n + s.vacant, 0);
  const units = input.schemeRows.reduce((n, s) => n + s.units, 0);
  const liveAt = (code: string) => input.schemeRows.reduce((n, s) => n + (s.live[code] || 0), 0);
  const liveNow = DECK_LIVE_STAGES.reduce((n, st) => n + liveAt(st.code), 0);
  const leftOut = [a.leftOut.stageMoves ? plural(a.leftOut.stageMoves, "stage move", "stage moves") : "", a.leftOut.instructions ? plural(a.leftOut.instructions, "new instruction", "new instructions") : ""].filter(Boolean);
  const slides: DeckSlide[] = [];

  slides.push(titleSlide("Landsec Hospitality & Leisure", `Board report, ${input.period.label}`, [
    input.schemes.length === 1 ? input.schemes[0].name : `${count(input.schemes.length)} schemes: ${input.schemes.map(s => s.name).join(", ")}`,
  ]));

  // Headlines.
  slides.push({
    layout: "content", title: "Headlines", subtitle: input.period.label,
    rows: [{
      fill: true,
      blocks: [{ kind: "tiles", perRow: 4, tiles: [
        { label: "Lettings exchanged or completed", value: count(t.lettings) }, { label: "Heads of Terms agreed", value: count(t.hots) },
        { label: "New instructions", value: count(t.instructions) }, { label: "Viewings held", value: count(t.viewings) },
        { label: "Offers received", value: count(t.offers) }, { label: "Units occupied today", value: count(occupied) },
        { label: "Units vacant today", value: count(vacant) }, { label: "Live lettings today", value: count(liveNow) },
      ] }],
    }],
    caveat: [
      "The first five are counted in the period, by the day on the deal or the day its status was moved. Occupancy and live lettings are as recorded today.",
      leftOut.length ? `Left out as bulk updates, not the day a letting moved: ${leftOut.join(" and ")}.` : "",
    ].filter(Boolean).join(" "),
    rules: [input.counted.lettings, input.counted.hots, input.counted.instructions, input.counted.viewings, input.counted.offers, input.counted.occupancy, input.counted.bulk],
  });

  // Letting activity by scheme.
  const byScheme = withoutEmptyCategories({
    kind: "chart", chart: "stackedBar", format: "count", categories: input.schemeRows.map(s => s.name),
    series: ACTIVITY_SERIES(input.schemeRows.map(s => a.byScheme[s.key])),
  });
  const quiet = input.schemeRows.filter(s => { const c = a.byScheme[s.key]; return !c || (!c.lettings && !c.hots && !c.instructions); }).map(s => s.name);
  slides.push({
    layout: "content", title: "Letting activity by scheme", subtitle: input.period.label,
    rows: [{
      widths: [3.4, 1],
      blocks: [
        chartOrCard(byScheme, { title: "No letting activity is dated in the period", lines: ["No letting exchanged or completed, no Heads of Terms were agreed and no unit was put to market on a day the app can confirm."] }),
        { kind: "tiles", perRow: 1, tiles: [{ label: "Viewings held", value: count(t.viewings) }, { label: "Offers received", value: count(t.offers) }, { label: "Of the lettings, completed", value: count(t.completed) }] },
      ],
    }],
    caveat: quiet.length && quiet.length < input.schemeRows.length ? `Nothing dated in the period at ${listed(quiet)}.` : "Counted in the period, by the day on the deal or the day its status was moved.",
    rules: [input.counted.lettings, input.counted.hots, input.counted.instructions],
  });

  // By brief category: only when something is recorded.
  const cats = categoryRows(a.byCategory).filter(r => !r.total);
  const byCategory: DeckChart = { kind: "chart", chart: "stackedBar", format: "count", categories: cats.map(r => r.label), series: ACTIVITY_SERIES(cats.map(r => r.counts)) };
  if (cats.some(r => r.counts.lettings || r.counts.hots || r.counts.instructions)) {
    slides.push({
      layout: "content", title: "Letting activity by brief category", subtitle: input.period.label,
      rows: [{ blocks: [withoutEmptyCategories(byCategory)] }],
      caveat: "The category is read from the brand's type, by the categories of Landsec's agency brief. A letting with no brand recorded is under No brand recorded.",
    });
  }

  // Live lettings today.
  const live = liveByScheme(input.schemeRows);
  slides.push({
    layout: "content", title: "Live lettings today", subtitle: `${plural(liveNow, "live letting", "live lettings")} across ${plural(input.schemeRows.length, "scheme", "schemes")}`,
    rows: [{
      widths: [1, 1.7],
      blocks: [
        chartOrCard({ kind: "chart", chart: "bar", title: "By stage", format: "count", categories: DECK_LIVE_STAGES.map(st => st.name), series: [{ ...DECK_SERIES.one, name: "Live lettings", values: DECK_LIVE_STAGES.map(st => liveAt(st.code)) }] },
          { title: "No letting is live", lines: ["The Deals page lists no live letting at these schemes today."] }),
        chartOrCard(live.chart, { title: "No letting is live at any scheme", lines: ["Nothing to draw by scheme."] }),
      ],
    }],
    caveat: `As the Deals page lists them today${live.quiet.length && live.quiet.length < input.schemeRows.length ? `. None at ${listed(live.quiet)}` : ""}.`,
    rules: [input.counted.occupancy],
  });

  // Target tenants: leasing activity on the brands being targeted.
  slides.push(...targetSlides(input.targets, { periodLabel: input.period.label, schemes: input.schemes, rule: input.counted.targets }));

  // Occupancy today.
  slides.push({
    layout: "content", title: "Occupancy today", subtitle: "Units on the tenancy schedule",
    rows: [
      { blocks: [{ kind: "tiles", tiles: [{ label: "Units", value: count(units) }, { label: "Occupied", value: count(occupied) }, { label: "Vacant", value: count(vacant) }, { label: "Share occupied", value: share(occupied, units) }] }] },
      { blocks: [chartOrCard({
        kind: "chart", chart: "shareBar", format: "count", categories: input.schemeRows.map(s => s.name),
        series: [
          { ...DECK_SERIES.occupied, values: input.schemeRows.map(s => s.occupied) }, { ...DECK_SERIES.vacant, values: input.schemeRows.map(s => s.vacant) },
          { ...DECK_SERIES.notRecorded, values: input.schemeRows.map(s => s.unknown) },
        ],
      }, { title: "No unit is recorded", lines: ["The tenancy schedules of these schemes hold no units."] })] },
    ],
    caveat: "Each bar is the scheme's units as a share: the figures on it are units. The app does not keep occupancy by date, so this is today and not the last day of the period.",
    rules: [input.counted.occupancy],
  });

  slides.push(rollSlide(input.roll, input.thisYear, "Expiries and breaks, the next ten years"));

  // Rental growth.
  const measured = g.rows.filter(r => r.vsPreviousPct != null || r.vsErvPct != null);
  const growthChart: DeckChart = {
    kind: "chart", chart: "bar", format: "pct",
    categories: measured.slice(0, 9).map(r => [r.brand || r.unit || "Letting", schemeName(r.scheme)].join(", ")),
    series: [{ ...DECK_SERIES.vsPrevious, values: measured.slice(0, 9).map(r => r.vsPreviousPct) }, { ...DECK_SERIES.vsErv, values: measured.slice(0, 9).map(r => r.vsErvPct) }],
  };
  const unheld = g.rows.filter(r => r.vsPreviousPct == null && r.vsErvPct == null);
  slides.push({
    layout: "content", title: "Rental growth", subtitle: "Rent agreed on the lettings that exchanged or completed in the period",
    rows: [
      { blocks: [{ kind: "tiles", tiles: [
        { label: "Lettings exchanged or completed", value: count(g.lettings) },
        { label: `Against the previous rent (${plural(g.withPrevious, "letting", "lettings")})`, value: pct(g.avgVsPreviousPct) },
        { label: `Against ERV (${plural(g.withErv, "letting", "lettings")})`, value: pct(g.avgVsErvPct) },
      ] }] },
      { blocks: [chartOrCard(growthChart, g.lettings === 0
        ? { title: "No letting exchanged or completed in the period", lines: ["There is no agreed rent to compare, on a day the app can confirm."] }
        : {
          title: `Not held for ${count(unheld.length)} of ${plural(g.lettings, "letting", "lettings")}`,
          lines: [
            "Rental growth needs the rent agreed on the deal and either the unit's previous passing rent or its ERV. Nothing is estimated.",
            ...unheld.slice(0, 6).map(r => `${[r.brand || r.unit || "Letting", schemeName(r.scheme)].join(", ")}: ${r.missing || "a figure is not held"}.`),
            unheld.length > 6 ? `And ${count(unheld.length - 6)} more.` : "",
          ].filter(Boolean),
        })] },
    ],
    caveat: [
      "The average is the average of each letting's own change.",
      measured.length && unheld.length ? `${plural(unheld.length, "letting is", "lettings are")} left out for want of a figure.` : "",
      measured.length > 9 ? `The nine earliest of ${count(measured.length)} are drawn.` : "",
    ].filter(Boolean).join(" "),
    rules: [input.counted.growth],
  });

  // Deal speed.
  slides.push({
    layout: "content", title: "Deal speed", subtitle: "Whole days between two confirmed days",
    rows: [
      { blocks: [{ kind: "tiles", tiles: [
        { label: "Instruction to Heads of Terms, median", value: days(sp.toHots.median) }, { label: "Lettings measured", value: count(sp.toHots.count) },
        { label: "Heads of Terms to exchange, median", value: days(sp.toExchange.median) }, { label: "Lettings measured", value: count(sp.toExchange.count) },
      ] }] },
      { blocks: [speedBlock("Instruction to Heads of Terms", sp.toHots, schemeName, "reached Heads of Terms"), speedBlock("Heads of Terms to exchange", sp.toExchange, schemeName, "exchanged")] },
    ],
    caveat: "Instruction is the instructed date on the deal, else the day it was first moved to Marketing. A letting with a day missing, not confirmed or out of order is left out.",
    rules: [input.counted.speed],
  });

  // The market report: the industry's figures always, the words only where a
  // person saved them. The overall slide, then every section's figures side by
  // side, then a slide for each section that has words or a story to show.
  const figuresOf = (key: BoardMarketKey) => input.industry.find(i => i.key === key)?.figures;
  const parts = BOARD_MARKET_SECTIONS.filter(sec => sec.key !== "overall");
  const bySection: DeckSlide = {
    layout: "content", title: "Market report: by section", subtitle: `The industry in ${input.period.label}, by the groups of Landsec's agency brief`,
    rows: [{
      widths: [1.7, 1],
      blocks: [
        { kind: "table", title: "The figures, section by section", columns: [
          { header: "Section", width: 2.3 }, { header: "Openings", width: 1.05, align: "right" }, { header: "Closures", width: 1.05, align: "right" },
          { header: "Net stores", width: 1.3, align: "right" }, { header: "Planning", width: 1, align: "right" }, { header: "Requirements", width: 1.3, align: "right" },
        ], rows: parts.map(sec => {
          const f = figuresOf(sec.key);
          return [sec.title, f?.signals ? count(f.signals.opening) : "Not available", f?.signals ? count(f.signals.closure) : "Not available",
            !f?.stores ? "Not available" : f.stores.brands ? `${f.stores.net > 0 ? "+" : ""}${count(f.stores.net)}` : "No counts",
            f?.planning ? count(f.planning.applications) : "Not available", f?.requirements ? count(f.requirements.added) : "Not available"];
        }) },
        chartOrCard({ kind: "chart", chart: "bar", title: "Leasing requirements added, by section", format: "count", categories: parts.map(sec => sec.title), series: [{ ...DECK_SERIES.one, name: "Requirements added", values: parts.map(sec => figuresOf(sec.key)?.requirements?.added ?? 0) }] },
          { title: "No requirement was added in the period", lines: ["No leasing requirement tied to a brand in these sections was added to the app in the period."] }),
      ],
    }],
    caveat: "Brands with an opening story, and with a closure, CVA or administration story; the net change in stores on brands' own websites; planning applications naming a brand; requirements added. A brand is in a section by its type.",
    rules: [INDUSTRY_COUNTED],
  };
  for (const section of BOARD_MARKET_SECTIONS) {
    const f = figuresOf(section.key);
    const saved = input.market[section.key];
    if (section.key !== "overall" && !saved?.text && !(f?.headlines || []).length) continue;
    const title = section.key === "overall" ? "Market report" : `Market report: ${section.title}`;
    const subtitle = section.key === "overall" ? "The industry this period, across every brand on the app" : `The industry this period: ${section.title}`;
    const signed = (n: number) => `${n > 0 ? "+" : ""}${count(n)}`;
    const tiles: DeckBlock = { kind: "tiles", tiles: [
      { label: "Brands with an opening story", value: f?.signals ? count(f.signals.opening) : "Not available" },
      { label: "Brands with a closure story", value: f?.signals ? count(f.signals.closure) : "Not available" },
      { label: "Net change in stores", value: !f?.stores ? "Not available" : f.stores.brands ? signed(f.stores.net) : "No counts yet" },
      { label: "Planning applications", value: f?.planning ? count(f.planning.applications) : "Not available" },
      { label: "Requirements added", value: f?.requirements ? count(f.requirements.added) : "Not available" },
    ] };
    const caveat = "Counted across every brand on the app from public records: a story is its headline, source and date only. No footfall, sales, turnover, spending or rental index is held.";
    const body = freeHeight(true, DECK_PAGE.tileH + DECK_PAGE.rowGap);
    const fit = tableRowsThatFit(body, true);
    const stories = (f?.headlines || []).slice(0, fit);
    const storyColumns = saved?.text
      ? [{ header: "Date", width: 1.25 }, { header: "Brand", width: 1.7 }, { header: "Story", width: 3.6 }, { header: "Source", width: 1.5 }]
      : [{ header: "Date", width: 1.2 }, { header: "Brand", width: 2.2 }, { header: "Story", width: 6.4 }, { header: "Source", width: 2.2 }];
    const storyBlock: DeckBlock = stories.length
      ? { kind: "table", title: "In the news", columns: storyColumns, rows: stories.map(h => [shortReportDay(h.date), h.brand, h.headline, h.site]) }
      : { kind: "card", title: "No dated story is recorded for the period", lines: ["The app holds no story with a link and a date in the period for this section."] };
    if (!saved?.text) {
      slides.push({ layout: "content", title, subtitle, rows: [{ blocks: [tiles] }, { blocks: [storyBlock] }], caveat, rules: [INDUSTRY_COUNTED] });
      continue;
    }
    // The words beside the stories; what does not fit carries on over further slides.
    const half = (DECK_PAGE.w - DECK_PAGE.side * 2 - DECK_PAGE.blockGap) / 2;
    const lineChars = (width: number) => charsPerLine(width, 11);
    const linesIn = (height: number) => Math.max(4, Math.floor(((height - DECK_PAGE.blockTitleH - 0.3) * 72) / 15.4));
    const first = Math.floor(lineChars(half) * linesIn(body) * 0.82);
    const next = Math.floor(lineChars(DECK_PAGE.w - DECK_PAGE.side * 2) * linesIn(freeHeight(false)) * 0.82);
    const cut = pageWords(saved.text.split(/\n+/).map(p => p.trim()).filter(Boolean), first, next);
    const credit = `Written by ${saved.savedBy} (${saved.savedByFirm})`;
    slides.push({
      layout: "content", title, subtitle,
      rows: [{ blocks: [tiles] }, { blocks: [{ kind: "words", title: section.key === "overall" ? "The market" : section.title, paragraphs: cut[0], credit }, storyBlock] }],
      caveat, rules: [INDUSTRY_COUNTED],
    });
    cut.slice(1).forEach((page, i) => slides.push({
      layout: "content", title: `${title} (continued)`, subtitle: `${i + 2} of ${cut.length}`,
      rows: [{ blocks: [{ kind: "words", paragraphs: page, credit }] }],
    }));
  }
  // Every section's figures, straight after the overall slide and anything it carried over.
  const overallEnd = slides.reduce((last, s, i) => (s.title === "Market report" || s.title === "Market report (continued)" ? i : last), -1);
  slides.splice(overallEnd + 1, 0, bySection);

  // The rules, in full, at the back.
  const rules = [
    "What this deck holds: what is recorded in ChatBGP on the day it was made. A letting Landsec did without BGP is in it only if it is on the app. Nothing in it is estimated: a figure the app does not hold is shown as not held and left out of the averages.",
    input.counted.lettings, input.counted.hots, input.counted.instructions, input.counted.viewings, input.counted.offers, input.counted.bulk,
    input.counted.occupancy, input.counted.targets, input.counted.growth, input.counted.speed,
    `The industry figures: ${INDUSTRY_COUNTED}`,
    "The market report's words are written by BGP and Landsec. A section with nothing saved prints its figures and no words.",
  ];
  const column = (DECK_PAGE.w - DECK_PAGE.side * 2 - DECK_PAGE.blockGap) / 2;
  const perColumn = Math.floor(charsPerLine(column, 9.5) * Math.floor((freeHeight(false) * 72) / 13) * 0.92);
  const columns = pageWords(rules, perColumn, perColumn);
  pages(columns, 2).forEach((pair, i) => slides.push({
    layout: "content", title: i === 0 ? "How the figures are counted" : "How the figures are counted (continued)", subtitle: "And what the app does not hold",
    rows: [{ blocks: pair.map(paragraphs => ({ kind: "words" as const, paragraphs, dense: true })) }],
  }));

  return { title: "Landsec Hospitality & Leisure: board report", subtitle: input.period.label, footer: input.footer, slides };
}

// ── The asset profile ────────────────────────────────────────────────────

export interface AssetLetting { unit: string; inUnit: string; stage: string; stageCode: string; lettingTo: string; ref: number | null; days: number | null; daysConfirmed: boolean }
export interface AssetDeckInput {
  scheme: { name: string; town: string; group: string };
  footer: string;
  /** "19 November 2026". */
  madeOn: string;
  thisYear: number;
  units: number; occupied: number; vacant: number; unknown: number;
  sqft: { all: number | null; occupied: number | null; vacant: number | null; unknown: number | null };
  passingRent: number | null;
  /** Trading units by brief category: null when the count could not be read. */
  mix: Array<{ label: string; units: number }> | null;
  roll: DeckRollYear[];
  lettings: AssetLetting[];
  /** The target tenants at this scheme, and the period their activity is counted in. Null when the Brand CRM plan could not be read. */
  targets: TargetTenants | null;
  periodLabel: string;
}

export function assetDeck(input: AssetDeckInput): Deck {
  const slides: DeckSlide[] = [];
  slides.push(titleSlide(input.scheme.name, "Asset profile", [[input.scheme.town, input.scheme.group ? `${input.scheme.group} group` : ""].filter(Boolean).join(" · "), `As recorded on ${input.madeOn}`]));

  const occupancy = chartOrCard({
    kind: "chart", chart: "shareBar", title: "Occupancy", format: "count", categories: ["By units", "By sq ft"],
    series: [
      { ...DECK_SERIES.occupied, values: [input.occupied, input.sqft.occupied ?? 0] }, { ...DECK_SERIES.vacant, values: [input.vacant, input.sqft.vacant ?? 0] },
      { ...DECK_SERIES.notRecorded, values: [input.unknown, input.sqft.unknown ?? 0] },
    ],
  }, { title: "No unit is recorded", lines: ["This scheme's tenancy schedule holds no units."] });
  const mix: DeckBlock = !input.mix
    ? { kind: "card", title: "Trading units by brief category", lines: ["The category count could not be read. Make the deck again in a moment."] }
    : chartOrCard({ kind: "chart", chart: "bar", title: "Trading units by brief category", format: "count", categories: input.mix.map(m => m.label), series: [{ ...DECK_SERIES.one, name: "Trading units", values: input.mix.map(m => m.units) }] },
      { title: "No trading unit is recorded", lines: ["No occupied unit on the tenancy schedule could be counted by category."] });
  slides.push({
    layout: "content", title: "At a glance", subtitle: input.scheme.name,
    rows: [
      { blocks: [{ kind: "tiles", tiles: [
        { label: "Units", value: count(input.units) }, { label: "Occupied", value: count(input.occupied) }, { label: "Vacant", value: count(input.vacant) },
        { label: "Sq ft recorded", value: input.sqft.all == null ? "Not held" : count(input.sqft.all) }, { label: "Passing rent a year", value: money(input.passingRent) },
        { label: "Live lettings", value: count(input.lettings.length) },
      ] }] },
      { widths: [1, 1.25], blocks: [occupancy, mix] },
    ],
    caveat: "As the tenancy schedule holds it today. The category is read from the brand's type, by the categories of Landsec's agency brief; No brand is a trading unit with no brand recorded.",
  });

  slides.push(rollSlide(input.roll, input.thisYear, `${input.scheme.name}: expiries and breaks, the next ten years`));

  // Live lettings: the stages as bars, then the lettings themselves.
  const order = ["SOL", "HOT", "NEG", "AVA", "OPP"];
  const sorted = input.lettings.slice().sort((x, y) => order.indexOf(x.stageCode) - order.indexOf(y.stageCode) || (y.days ?? -1) - (x.days ?? -1));
  const early = sorted.filter(l => l.stageCode === "AVA" || l.stageCode === "OPP");
  // A long run of units that are only being marketed is counted on the chart and not listed.
  const shown = early.length > 12 ? sorted.filter(l => !early.includes(l)) : sorted;
  const stageChart = chartOrCard({
    kind: "chart", chart: "bar", title: "By stage", format: "count", categories: DECK_LIVE_STAGES.map(st => st.name),
    series: [{ ...DECK_SERIES.one, name: "Live lettings", values: DECK_LIVE_STAGES.map(st => input.lettings.filter(l => l.stageCode === st.code).length) }],
  }, { title: "No letting is running", lines: ["The Letting Tracker holds no live letting at this scheme."] });
  const columns = [{ header: "Unit", width: 2.7 }, { header: "In the unit now", width: 2.1 }, { header: "Stage", width: 1.3 }, { header: "Letting to", width: 2.1 }, { header: "Days at stage", width: 1.2, align: "right" as const }];
  const cells = (l: AssetLetting) => [l.unit, l.inUnit, l.stage, l.lettingTo, l.days == null ? "" : `${count(l.days)}${l.daysConfirmed ? "" : "*"}`];
  const caveat = [
    shown.length < sorted.length ? `${plural(early.length, "unit is", "units are")} being marketed with no negotiation yet: counted on the chart, not listed.` : "",
    shown.some(l => l.days != null && !l.daysConfirmed) ? "* The day it reached its stage is not confirmed." : "",
  ].filter(Boolean).join(" ") || "Live lettings as the Letting Tracker holds them today.";
  const firstFit = tableRowsThatFit(freeHeight(true), true);
  const subtitle = `${plural(input.lettings.length, "live letting", "live lettings")} at ${input.scheme.name}`;
  slides.push({
    layout: "content", title: "Live lettings", subtitle,
    rows: [{
      widths: [1, 2.3],
      blocks: [stageChart, shown.length
        ? { kind: "table", title: shown.length < sorted.length ? "In negotiation or further on" : "The lettings", columns, rows: shown.slice(0, firstFit).map(cells) }
        : { kind: "card", title: input.lettings.length ? "No letting has reached negotiation" : "No letting is running at this scheme", lines: [input.lettings.length ? "Every live letting is still being marketed." : "Nothing to list."] }],
    }],
    caveat,
  });
  if (shown.length > firstFit) {
    slides.push(...tableSlides({ title: "Live lettings (continued)", subtitle, caveat }, { columns }, shown.slice(firstFit).map(cells), { title: "", lines: [] })
      .map((s, i) => ({ ...s, title: "Live lettings (continued)", subtitle: i === 0 ? subtitle : s.subtitle })));
  }
  slides.push(assetTargetSlide(input.targets, input.scheme.name, input.periodLabel));
  return { title: `${input.scheme.name}: asset profile`, subtitle: `As recorded on ${input.madeOn}`, footer: input.footer, slides };
}

// ── Leasing activity ─────────────────────────────────────────────────────

export interface ActivityDeckRow {
  scheme: string; unit: string | null; brand: string | null; deal: string | null;
  stage: string | null; stageCode: string | null; live: boolean; daysAtStage: number | null; daysConfirmed: boolean;
  waitingOn: string | null; movedInPeriod: string | null;
}
export interface ActivityDeckInput {
  period: Pick<ReportPeriod, "label" | "from" | "to">;
  schemes: Array<{ key: string; name: string }>;
  footer: string;
  rows: ActivityDeckRow[];
  /** Viewings held in the period (the board report's own test): the day and the scheme's name. */
  viewings: Array<{ day: string; scheme: string }>;
}

export function activityDeck(input: ActivityDeckInput): Deck {
  const slides: DeckSlide[] = [];
  const live = input.rows.filter(r => r.live);
  const at = (code: string, rows = live) => rows.filter(r => r.stageCode === code).length;
  slides.push(titleSlide("Leasing activity", input.period.label, [
    input.schemes.length === 1 ? input.schemes[0].name : `${count(input.schemes.length)} schemes: ${input.schemes.map(s => s.name).join(", ")}`,
  ]));

  const schemeRows: DeckSchemeRow[] = input.schemes.map(s => {
    const mine = live.filter(r => r.scheme === s.name);
    return { key: s.key, name: s.name, units: 0, occupied: 0, vacant: 0, unknown: 0, live: Object.fromEntries(DECK_LIVE_STAGES.map(st => [st.code, at(st.code, mine)])) };
  });
  const byScheme = liveByScheme(schemeRows);
  const none = input.schemes.filter(s => !input.rows.some(r => r.scheme === s.name)).map(s => s.name);
  slides.push({
    layout: "content", title: "Live lettings", subtitle: `As the Deals page lists them today, and what changed stage in ${input.period.label}`,
    rows: [
      { blocks: [{ kind: "tiles", tiles: [
        { label: "Live lettings", value: count(live.length) }, ...DECK_LIVE_STAGES.map(st => ({ label: st.name, value: count(at(st.code)) })),
        { label: "Changed stage in the period", value: count(input.rows.filter(r => r.movedInPeriod).length) },
      ] }] },
      { blocks: [chartOrCard({ ...byScheme.chart, title: "Live lettings by stage, by scheme" }, { title: "No letting is live", lines: ["The Deals page lists no live letting at these schemes today."] })] },
    ],
    caveat: none.length && none.length < input.schemes.length ? `No live letting, and no deal changed stage in the period, at ${listed(none)}.` : "Live lettings as the Deals page lists them today.",
  });

  // Viewings held in the period.
  const months = reportMonths(input.period);
  const byMonth: DeckChart = { kind: "chart", chart: "column", title: "By month", format: "count", categories: months.map(m => m.label), series: [{ ...DECK_SERIES.one, name: "Viewings held", values: months.map(m => input.viewings.filter(v => v.day.slice(0, 7) === m.ym).length) }] };
  const viewed = input.schemes.map(s => ({ name: s.name, n: input.viewings.filter(v => v.scheme === s.name).length })).filter(s => s.n > 0).sort((x, y) => y.n - x.n);
  const bySchemeViewings: DeckChart = { kind: "chart", chart: "bar", title: "By scheme", format: "count", categories: viewed.map(s => s.name), series: [{ ...DECK_SERIES.one, name: "Viewings held", values: viewed.map(s => s.n) }] };
  slides.push({
    layout: "content", title: "Viewings held", subtitle: `${plural(input.viewings.length, "viewing", "viewings")} in ${input.period.label}`,
    rows: [input.viewings.length
      ? { blocks: [byMonth, bySchemeViewings] }
      : { blocks: [{ kind: "card", title: "No viewing is recorded in the period", lines: ["The viewings list holds no viewing held at these schemes on a day in the period."] }] }],
    caveat: "Viewings dated in the period and not later than today, leaving out cancelled viewings, no-shows and diary entries marked as not a leasing viewing.",
  });

  // The lettings themselves, scheme by scheme in one table that carries on over
  // as many slides as it needs. A long run of units that are only being
  // marketed is counted on the chart above and not listed (the asset profile's
  // own rule): the Excel export lists every one.
  const order = ["SOL", "HOT", "NEG", "AVA", "OPP"];
  const rank = (r: ActivityDeckRow) => (r.live ? (order.indexOf(r.stageCode || "") + 1 || order.length + 1) : order.length + 2);
  const early = input.rows.filter(r => r.live && (r.stageCode === "AVA" || r.stageCode === "OPP"));
  const kept = early.length > 12 ? input.rows.filter(r => !early.includes(r)) : input.rows;
  const position = new Map(input.schemes.map((s, i) => [s.name, i]));
  const sorted = kept.slice().sort((x, y) => (position.get(x.scheme) ?? 99) - (position.get(y.scheme) ?? 99) || rank(x) - rank(y) || (y.daysAtStage ?? -1) - (x.daysAtStage ?? -1));
  const columns = [{ header: "Scheme", width: 2.2 }, { header: "Unit", width: 3.3 }, { header: "Brand", width: 2.3 }, { header: "Stage", width: 1.9 }, { header: "Days at stage", width: 1.1, align: "right" as const }, { header: "Waiting on", width: 2.5 }];
  const closed = sorted.filter(r => !r.live).length;
  const caveat = [
    kept.length < input.rows.length ? `${plural(early.length, "unit is", "units are")} being marketed with no negotiation yet: counted on the chart, not listed here. The Leasing activity Excel export lists every one.` : "",
    sorted.some(r => r.daysAtStage != null && !r.daysConfirmed) ? "* The day it reached its stage is not confirmed (the app greys it)." : "",
  ].filter(Boolean).join(" ") || "Live lettings as the Deals page lists them today, then the deals that changed stage in the period and have since closed.";
  if (sorted.length) {
    const fit = tableRowsThatFit(freeHeight(true));
    const cut = pagesEven(sorted, fit);
    cut.forEach((page, i) => {
      const names = Array.from(new Set(page.map(r => r.scheme)));
      slides.push({
        layout: "content",
        title: i === 0 ? (kept.length < input.rows.length ? "Lettings in negotiation or further on" : "The lettings") : `${kept.length < input.rows.length ? "Lettings in negotiation or further on" : "The lettings"} (continued)`,
        subtitle: [
          i === 0 ? [plural(sorted.length - closed, "live letting", "live lettings"), closed ? `${count(closed)} that changed stage in the period and since closed` : ""].filter(Boolean).join(" and ") : (names.length > 1 ? `${names[0]} to ${names[names.length - 1]}` : names[0]),
          cut.length > 1 ? `${i + 1} of ${cut.length}` : "",
        ].filter(Boolean).join(" · "),
        // The scheme is written on its first row of each slide.
        rows: [{ blocks: [{ kind: "table", columns, rows: page.map((r, k) => [
          k === 0 || page[k - 1].scheme !== r.scheme ? r.scheme : "", r.unit || "", r.brand || "No brand yet", [r.stage, r.live ? "" : "(closed)"].filter(Boolean).join(" "),
          r.daysAtStage == null ? "" : `${count(r.daysAtStage)}${r.daysConfirmed ? "" : "*"}`, r.waitingOn || "",
        ]) }] }],
        caveat,
      });
    });
  }
  return { title: "Landsec leasing activity", subtitle: input.period.label, footer: input.footer, slides };
}
