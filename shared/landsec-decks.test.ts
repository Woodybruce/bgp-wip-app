import test from "node:test";
import assert from "node:assert/strict";
import { parseReportPeriod } from "./landsec-reports";
import { DECK_PAGE, chartHasData, deckOutline, freeHeight, layoutSlide, tableRowsThatFit, type Deck, type DeckBlock, type DeckChart, type DeckTable } from "./landsec-deck";
import { boardActivity, dealSpeed, rentalGrowth, targetTenants, type BoardDeal, type BoardTargetLine } from "./landsec-board-report";
import { marketItems, type MarketData, type MarketInput } from "./landsec-market-report";
import { activityDeck, assetDeck, boardDeck, type ActivityDeckRow, type AssetLetting, type BoardDeckInput } from "./landsec-decks";

const parsed = parseReportPeriod("2026-08", "2026-10");
assert.ok(parsed.ok);
const period = parsed.period;
const SCHEMES = [{ key: "bluewater", name: "Bluewater" }, { key: "trinity-leeds", name: "Trinity Leeds" }, { key: "lucent", name: "Lucent" }];
const counted = Object.fromEntries(["lettings", "hots", "instructions", "viewings", "offers", "occupancy", "bulk", "growth", "speed", "targets"].map(k => [k, `How ${k} is counted, in full.`])) as BoardDeckInput["counted"];
const target = (over: Partial<BoardTargetLine>): BoardTargetLine => ({ brand: "Jersey Mike's", category: "cafe_qsr" as BoardDeal["category"], scheme: "bluewater", unit: "L057", stage: "hots", firstSeen: "2026-09-01", since: "2026-10-16", events: [], next: null, requirementHeld: false, ...over });
const TARGET_LINES: BoardTargetLine[] = [
  target({ events: [{ kind: "viewed", day: "2026-09-11" }, { kind: "offer", day: "2026-10-02" }, { kind: "hots", day: "2026-10-16" }], next: { title: "Waiting on Tenant's solicitors", due: null, who: "R Willcox" }, requirementHeld: true }),
  target({ brand: "Gail's", category: null, scheme: "trinity-leeds", unit: null, stage: "approached", firstSeen: "2026-03-01", since: "2026-03-01", events: [{ kind: "approached", day: "2026-03-01" }] }),
  target({ brand: "Sushidog", category: null, scheme: "bluewater", unit: "EVL02", stage: "wanted", firstSeen: null, since: null }),
];

const deal = (over: Partial<BoardDeal>): BoardDeal => ({
  id: "d", ref: 1, scheme: "bluewater", unit: "L057", brand: "Jersey Mike's", category: "cafe_qsr" as BoardDeal["category"], rentPa: 110000,
  instructed: "2026-06-01", created: { day: "2026-06-01", confirmed: true }, marketing: null,
  hotsIssued: "2026-08-10", hotsMoved: null, exchangedOn: "2026-09-19", exchangeMoved: null, completedOn: null, completeMoved: null,
  passingRent: 100000, erv: 105000, scheduleShowsTenant: false, ...over,
});
const NO_MARKET: MarketData = { level: "live", items: [], competition: [], research: [], themes: [], notAvailable: [] };
const marketOf = (over: Partial<MarketInput>): MarketData => ({ ...NO_MARKET, items: marketItems({ signals: [], snapshots: [], pipeline: [], owners: [], requirements: [], ownActivity: [], lettings: [], trading: new Set(), targets: new Set(), ...over }, period) });

function boardInput(over: Partial<BoardDeckInput> = {}, deals: BoardDeal[] = [deal({})]): BoardDeckInput {
  return {
    period, schemes: SCHEMES, footer: "Made in ChatBGP on 19 November 2026 by A Person. It holds what is recorded in ChatBGP on that day.", thisYear: 2026,
    activity: boardActivity({ deals, viewings: [{ scheme: "bluewater", day: "2026-09-02", status: "completed", category: null }], offers: [] }, period, "2026-11-19"),
    growth: rentalGrowth(deals, period), speed: dealSpeed(deals, period),
    schemeRows: [
      { key: "bluewater", name: "Bluewater", units: 193, occupied: 130, vacant: 63, unknown: 0, live: { AVA: 12, NEG: 3, HOT: 2, SOL: 7 } },
      { key: "trinity-leeds", name: "Trinity Leeds", units: 94, occupied: 80, vacant: 14, unknown: 0, live: { AVA: 14, SOL: 2 } },
      { key: "lucent", name: "Lucent", units: 34, occupied: 16, vacant: 18, unknown: 0, live: {} },
    ],
    targets: targetTenants(TARGET_LINES, period, "2026-11-19"),
    roll: [{ year: 2024, expiries: 2, breaks: 0, expiryRent: 5000, breakRent: null }, { year: 2026, expiries: 10, breaks: 5, expiryRent: 900000, breakRent: 100000 }, { year: 2027, expiries: 14, breaks: 6, expiryRent: null, breakRent: null }, { year: 2040, expiries: 3, breaks: 0, expiryRent: null, breakRent: null }],
    marketData: NO_MARKET, market: {}, counted, ...over,
  };
}

const blocksOf = (deck: Deck): DeckBlock[] => deck.slides.flatMap(s => s.rows.flatMap(r => r.blocks));
const chartsOf = (deck: Deck): DeckChart[] => blocksOf(deck).filter((b): b is DeckChart => b.kind === "chart");
/** What every deck must hold to: no empty chart, no table longer than its box, each series as long as its categories, a short line at the foot. */
function sound(deck: Deck) {
  for (const c of chartsOf(deck)) {
    assert.ok(chartHasData(c), `"${c.title || c.chart}" has something to draw`);
    for (const s of c.series) assert.equal(s.values.length, c.categories.length);
  }
  for (const slide of deck.slides) {
    assert.ok(slide.title.trim(), "every slide has a title");
    if (slide.layout === "title") { assert.equal(slide.rows.length, 0); continue; }
    assert.ok(slide.rows.length > 0, `"${slide.title}" has something on it`);
    assert.ok((slide.caveat || "").length <= 360, `"${slide.title}": the line at the foot is two lines at most`);
    for (const placed of layoutSlide(slide)) {
      assert.ok(placed.y + placed.h <= (slide.caveat ? DECK_PAGE.bottomWithCaveat : DECK_PAGE.bottom) + 1e-6);
      if (placed.block.kind === "table") {
        const t = placed.block as DeckTable;
        assert.ok(t.rows.length <= tableRowsThatFit(placed.h, !!t.title, t.lines === 2 ? 2 : 1), `"${slide.title}": ${t.rows.length} rows fit their box`);
        for (const row of t.rows) assert.equal(row.length, t.columns.length);
      }
    }
  }
}

test("the board deck: its slides, in order, ending on the market report in short and the rules", () => {
  const deck = boardDeck(boardInput());
  sound(deck);
  assert.deepEqual(deckOutline(deck), [
    "Landsec Hospitality & Leisure", "Headlines", "Letting activity by scheme", "Letting activity by brief category", "Live lettings today",
    "Target tenants", "Target tenants: in play", "Occupancy today", "Lease roll", "Rental growth", "Deal speed", "Market report", "Market report: competition", "How the figures are counted",
  ]);
  const at = (title: string) => deck.slides.find(s => s.title === title)!;
  assert.equal(deck.slides[0].layout, "title");
  assert.equal(deck.slides[0].subtitle, "Board report, Aug to Oct 2026");
  // The headline figures are the board report's own counts.
  const headline = deck.slides[1].rows[0].blocks[0];
  assert.equal(headline.kind, "tiles");
  if (headline.kind === "tiles") {
    assert.deepEqual(headline.tiles.map(t => t.value), ["1", "1", "0", "1", "0", "226", "95", "40"]);
    assert.equal(headline.perRow, 4);
  }
  // The rule in full travels with the slide.
  assert.deepEqual(deck.slides[1].rules, ["lettings", "hots", "instructions", "viewings", "offers", "occupancy", "bulk"].map(k => `How ${k} is counted, in full.`));
  // A scheme with nothing dated is left off the chart and named.
  const activity = deck.slides[2].rows[0].blocks[0] as DeckChart;
  assert.deepEqual(activity.categories, ["Bluewater"]);
  assert.match(deck.slides[2].caveat || "", /Nothing dated in the period at Trinity Leeds and Lucent\./);
  // Occupancy: each scheme's units as a share, in the colours they always have.
  const share = at("Occupancy today").rows[1].blocks[0] as DeckChart;
  assert.equal(share.chart, "shareBar");
  assert.deepEqual(share.series.map(s => [s.name, s.colour]), [["Occupied", "navy"], ["Vacant", "grey"], ["Not recorded", "pale"]]);
  // The lease roll is ten years from this one; earlier and later expiries are counted in the line at the foot.
  const roll = at("Lease roll").rows[0].blocks[0] as DeckChart;
  assert.deepEqual(roll.categories, ["2026", "2027", "2028", "2029", "2030", "2031", "2032", "2033", "2034", "2035"]);
  assert.match(at("Lease roll").caveat || "", /Not drawn: 2 expiries dated before 2026 and 3 expiries after 2035\./);
  const soon = at("Lease roll").rows[0].blocks[1];
  if (soon.kind === "tiles") assert.deepEqual(soon.tiles.map(t => t.value), ["24", "£900,000", "11"]);
  // Rental growth and deal speed are drawn from the letting that has the figures.
  const growth = at("Rental growth").rows[1].blocks[0] as DeckChart;
  assert.deepEqual(growth.series.map(s => s.values), [[10], [4.8]]);
  assert.equal(growth.format, "pct");
  // The rules are printed in full at the back.
  const words = deck.slides.filter(sl => sl.title.startsWith("How the figures are counted")).flatMap(sl => sl.rows[0].blocks).flatMap(b => (b.kind === "words" ? b.paragraphs : [])).join(" ");
  for (const k of Object.values(counted)) assert.ok(words.includes(k));
  assert.match(words, /It holds no footfall, sales, turnover, consumer spending or rental index: the app holds none\./);
  assert.match(words, /A letting Landsec did without BGP is in it only if it is on the app\./);
});

test("the board deck never draws an empty chart: a figure that is not held is a card, and its tile reads Not held", () => {
  const bare = deal({ rentPa: null, passingRent: null, erv: null, instructed: null, created: null, hotsIssued: null });
  const deck = boardDeck(boardInput({ targets: null, roll: [] }, [bare]));
  sound(deck);
  const growth = deck.slides.find(s => s.title === "Rental growth")!;
  const tiles = growth.rows[0].blocks[0];
  if (tiles.kind === "tiles") assert.deepEqual(tiles.tiles.map(t => t.value), ["1", "Not held", "Not held"]);
  const card = growth.rows[1].blocks[0];
  assert.equal(card.kind, "card");
  if (card.kind === "card") {
    assert.equal(card.title, "Not held for 1 of 1 letting");
    assert.match(card.lines.join(" "), /Nothing is estimated\./);
    assert.match(card.lines.join(" "), /Jersey Mike's, Bluewater: no rent on the deal; no previous passing rent; no ERV\./);
  }
  const speed = deck.slides.find(s => s.title === "Deal speed")!;
  assert.deepEqual(speed.rows[1].blocks.map(b => b.kind), ["card", "card"]);
  const speedTiles = speed.rows[0].blocks[0];
  if (speedTiles.kind === "tiles") assert.equal(speedTiles.tiles[0].value, "None measured");
  assert.equal(deck.slides.find(s => s.title === "Lease roll")!.rows[0].blocks[0].kind, "card");
  assert.equal(deck.slides.find(s => s.title === "Target tenants")!.rows[0].blocks[0].kind, "card", "a plan that could not be read is said, not drawn");
  assert.ok(!deckOutline(deck).includes("Target tenants: in play"));
  // Nothing dated at all: no chart of activity, and no category slide.
  const quiet = boardDeck(boardInput({}, []));
  sound(quiet);
  assert.equal(quiet.slides.find(s => s.title === "Letting activity by scheme")!.rows[0].blocks[0].kind, "card");
  assert.ok(!deckOutline(quiet).includes("Letting activity by brief category"));
});

test("target tenants: the figures, the targets by stage and by scheme, and the targets furthest on with the stage as a strip", () => {
  const deck = boardDeck(boardInput());
  const first = deck.slides.find(s => s.title === "Target tenants")!;
  assert.equal(first.subtitle, "Leasing activity on target brands, Aug to Oct 2026");
  const tiles = first.rows[0].blocks[0];
  if (tiles.kind === "tiles") assert.deepEqual(tiles.tiles.map(t => [t.label, t.value]), [
    ["Target brands in play", "3"], ["New in the period", "1"], ["Reached their present stage in the period", "1"],
    ["Approached in the period", "0"], ["Viewed in the period", "1"], ["Made an offer in the period", "1"],
  ]);
  const [byStage, byScheme] = first.rows[1].blocks as DeckChart[];
  assert.deepEqual(byStage.categories, ["Wanted", "Unit identified", "Approached", "Viewed", "Negotiating", "HOTs", "Solicitors", "Let"]);
  assert.deepEqual(byStage.series[0].values, [1, 0, 1, 0, 0, 1, 0, 0]);
  assert.equal(byScheme.chart, "stackedBar");
  assert.deepEqual(byScheme.categories, ["Bluewater", "Trinity Leeds"], "a scheme with no target is left off");
  assert.deepEqual(byScheme.series.map(s => [s.name, s.colour, s.values]), [
    ["Wanted or unit identified", "pale", [1, 0]], ["Approached or viewed", "blue", [0, 1]], ["Negotiating or HOTs", "gold", [1, 0]], ["Solicitors or let", "navy", [0, 0]],
  ]);
  assert.match(first.caveat || "", /1 target has no dated record\./);
  assert.deepEqual(first.rules, ["How targets is counted, in full."]);
  // The grid: furthest on first; the stage is a strip of eight steps with the word beside it.
  const grid = deck.slides.find(s => s.title === "Target tenants: in play")!.rows[0].blocks[0] as DeckTable;
  assert.deepEqual(grid.columns.map(c => c.header), ["Brand", "Category", "Scheme and unit", "Stage", "Last activity in the period", "Next step", "Requirement"]);
  assert.equal(grid.columns[3].steps, 8);
  assert.deepEqual(grid.rows, [
    ["Jersey Mike's", "Café, Grab & Go and QSR", "Bluewater, L057", "6:HOTs", "Heads of Terms 16 Oct 2026", "Waiting on Tenant's solicitors, R Willcox", "Held"],
    ["Gail's", "", "Trinity Leeds", "3:Approached", "None in the period", "", ""],
    ["Sushidog", "", "Bluewater, EVL02", "1:Wanted", "None in the period", "", ""],
  ]);
  // Targets still in play lead and the brands already let follow; a column no row has a word in is not printed.
  const mixed = boardDeck(boardInput({ targets: targetTenants([
    target({ brand: "Let One", stage: "let" }), target({ brand: "Viewed One", stage: "viewed" }), target({ brand: "Sols One", stage: "solicitors" }),
  ], period, "2026-11-19") }));
  sound(mixed);
  const mixedGrid = mixed.slides.find(s => s.title === "Target tenants: in play")!.rows[0].blocks[0] as DeckTable;
  assert.deepEqual(mixedGrid.rows.map(r => r[0]), ["Sols One", "Viewed One", "Let One"]);
  assert.deepEqual(mixedGrid.columns.map(c => c.header), ["Brand", "Category", "Scheme and unit", "Stage", "Last activity in the period"]);
  assert.ok(mixedGrid.rows.every(r => r.length === mixedGrid.columns.length));
  // Many targets: twelve a slide, three slides, and the rest counted in the line at the foot.
  const many = boardDeck(boardInput({ targets: targetTenants(Array.from({ length: 40 }, (_, i) => target({ brand: `Brand ${String(i).padStart(2, "0")}`, stage: "viewed" })), period, "2026-11-19") }));
  sound(many);
  const grids = many.slides.filter(s => s.title.startsWith("Target tenants: in play"));
  assert.deepEqual(grids.map(s => (s.rows[0].blocks[0] as DeckTable).rows.length), [12, 12, 12]);
  assert.match(grids[2].caveat || "", /4 more targets are not listed\./);
  // No target at all: the figures read nought, the charts are cards, and there is no grid.
  const none = boardDeck(boardInput({ targets: targetTenants([], period, "2026-11-19") }));
  sound(none);
  assert.deepEqual(none.slides.find(s => s.title === "Target tenants")!.rows[1].blocks.map(b => b.kind), ["card", "card"]);
  assert.ok(!deckOutline(none).includes("Target tenants: in play"));
});

test("the board report's market part: the overview, a slide for a sector with something in it, the competition, and saved words carried over", () => {
  const signals = [
    { brandId: "b1", brand: "Jersey Mike's", category: "cafe_qsr" as BoardDeal["category"], type: "opening", headline: "Jersey Mike's opens first UK restaurant - ROI-NJ", detail: null, publisher: null, source: "https://news.google.com/rss/articles/abc", date: "2026-09-09" },
    { brandId: "b2", brand: "Flat Iron", category: "restaurants_bars" as BoardDeal["category"], type: "opening", headline: "Flat Iron opens in Birmingham", detail: null, publisher: null, source: "https://www.propelinfo.com/story", date: "2026-10-11" },
  ];
  const long = Array.from({ length: 9 }, (_, i) => `Paragraph ${i + 1}. ${"Quick service continued to lead demand through the quarter. ".repeat(7)}`).join("\n\n");
  const deck = boardDeck(boardInput({ marketData: marketOf({ signals }), market: { overall: { text: long, savedBy: "A Person", savedByFirm: "BGP", savedAt: "2026-11-01T10:00:00Z" } } }));
  sound(deck);
  const titles = deckOutline(deck);
  assert.ok(titles.indexOf("Market report") > 0);
  assert.ok(titles.includes("Market report (continued)"), "words that do not fit carry on");
  assert.deepEqual(titles.filter(t => t.startsWith("Market report: ")), ["Market report: Hospitality", "Market report: competition"], "Leisure, cinema and London retail have nothing to show, so no slide");
  // Every word saved is on a slide, in order, with who wrote it.
  const market = deck.slides.filter(sl => sl.title === "Market report" || sl.title === "Market report (continued)");
  const printed = market.flatMap(sl => sl.rows.flatMap(r => r.blocks)).filter(b => b.kind === "words").flatMap(b => (b.kind === "words" ? b.paragraphs : [])).join(" ").replace(/\s+/g, " ");
  assert.equal(printed, long.replace(/\s+/g, " ").trim());
  const words = market[0].rows[1].blocks[0];
  if (words.kind === "words") assert.equal(words.credit, "Written by A Person (BGP)");
  // A sector's slide lists its top items: day, brand, what happened and the source. A Google News link names the publisher, never news.google.com.
  const stories = deck.slides.find(sl => sl.title === "Market report: Hospitality")!.rows[1].blocks[0] as DeckTable;
  assert.equal(stories.lines, 2);
  assert.deepEqual(stories.rows, [["11 Oct 2026", "Flat Iron", "Opening: Flat Iron opens in Birmingham", "propelinfo.com"], ["9 Sep 2026", "Jersey Mike's", "Opening: Jersey Mike's opens first UK restaurant", "ROI-NJ"]]);
  assert.ok(!JSON.stringify(deck).includes("news.google.com"));
  const strip = deck.slides.find(sl => sl.title === "Market report: Hospitality")!.rows[0].blocks[0];
  if (strip.kind === "tiles") assert.deepEqual(strip.tiles.map(t => t.value), ["2", "0", "No counts yet", "0", "0", "0"]);
});

const letting = (i: number, over: Partial<AssetLetting> = {}): AssetLetting => ({ unit: `Unit ${i}`, inUnit: "Vacant", stage: "Marketing", stageCode: "AVA", lettingTo: "", ref: 3000 + i, days: 10 + i, daysConfirmed: true, ...over });

test("the asset profile: figures, occupancy, the category count, the lease roll and the lettings, continued as they need", () => {
  const lettings = [
    ...Array.from({ length: 20 }, (_, i) => letting(i)),
    letting(30, { stage: "Solicitors", stageCode: "SOL", lettingTo: "Sushidog", days: 107, daysConfirmed: false }), letting(31, { stage: "HOTs", stageCode: "HOT", lettingTo: "Jersey Mike's", days: 1 }),
  ];
  const input = {
    scheme: { name: "Bluewater", town: "Kent", group: "South" }, footer: "Made in ChatBGP.", madeOn: "19 November 2026", thisYear: 2026,
    units: 193, occupied: 130, vacant: 63, unknown: 0, sqft: { all: 620657, occupied: 487642, vacant: 133015, unknown: null }, passingRent: 21911284,
    mix: [{ label: "Restaurants & Bars", units: 32 }, { label: "No brand", units: 71 }], roll: [{ year: 2026, expiries: 10, breaks: 5, expiryRent: 1881416, breakRent: 872470 }], lettings,
    targets: targetTenants(TARGET_LINES.filter(l => l.scheme === "bluewater"), period, "2026-11-19"), periodLabel: period.label,
  };
  const deck = assetDeck(input);
  sound(deck);
  assert.deepEqual(deckOutline(deck), ["Bluewater", "At a glance", "Lease roll", "Live lettings", "Target tenants"]);
  // The scheme's target tenants: the stages as bars, and the targets furthest on with the stage as a strip of eight steps.
  const targets = deck.slides[4];
  assert.equal(targets.subtitle, "2 target brands in play at Bluewater · activity in Aug to Oct 2026");
  const grid = targets.rows[0].blocks[1] as DeckTable;
  assert.equal(grid.columns[2].steps, 8);
  assert.deepEqual(grid.rows, [
    ["Jersey Mike's", "L057", "6:HOTs", "Heads of Terms 16 Oct 2026", "Waiting on Tenant's solicitors, R Willcox"],
    ["Sushidog", "EVL02", "1:Wanted", "None in the period", ""],
  ]);
  assert.match(targets.caveat || "", /1 target has no dated record\./);
  assert.deepEqual(deck.slides[0].lines, ["Kent · South group", "As recorded on 19 November 2026"]);
  const glance = deck.slides[1].rows[0].blocks[0];
  if (glance.kind === "tiles") assert.deepEqual(glance.tiles.map(t => t.value), ["193", "130", "63", "620,657", "£21,911,284", "22"]);
  // More than twelve units only being marketed: counted on the chart, not listed.
  const live = deck.slides[3];
  const stages = live.rows[0].blocks[0] as DeckChart;
  assert.deepEqual(stages.series[0].values, [20, 0, 1, 1]);
  const table = live.rows[0].blocks[1] as DeckTable;
  assert.equal(table.title, "In negotiation or further on");
  assert.deepEqual(table.rows.map(r => r[0]), ["Unit 30", "Unit 31"], "furthest on first");
  assert.equal(table.rows[0][4], "107*");
  assert.match(live.caveat || "", /20 units are being marketed with no negotiation yet: counted on the chart, not listed\. \* The day it reached its stage is not confirmed\./);
  // A long list of lettings past marketing carries on over further slides, and none is lost.
  const many = assetDeck({ ...input, lettings: Array.from({ length: 40 }, (_, i) => letting(i, { stage: "Negotiating", stageCode: "NEG" })) });
  sound(many);
  const listed = many.slides.filter(s => s.title.startsWith("Live lettings")).flatMap(s => s.rows.flatMap(r => r.blocks)).filter((b): b is DeckTable => b.kind === "table").flatMap(t => t.rows);
  assert.equal(listed.length, 40);
  assert.ok(many.slides.filter(s => s.title === "Live lettings (continued)").length >= 1);
  // No units, no category count: said, not drawn.
  const empty = assetDeck({ ...input, units: 0, occupied: 0, vacant: 0, sqft: { all: null, occupied: null, vacant: null, unknown: null }, passingRent: null, mix: null, roll: [], lettings: [], targets: null });
  sound(empty);
  assert.equal(empty.slides[empty.slides.length - 1].rows[0].blocks[0].kind, "card", "a plan that could not be read is said, not drawn");
  const noTargets = assetDeck({ ...input, targets: targetTenants([], period, "2026-11-19") });
  sound(noTargets);
  assert.deepEqual(noTargets.slides[noTargets.slides.length - 1].rows[0].blocks.map(b => b.kind), ["card", "card"]);
  assert.deepEqual(empty.slides[1].rows[1].blocks.map(b => b.kind), ["card", "card"]);
  const none = empty.slides[1].rows[0].blocks[0];
  if (none.kind === "tiles") assert.deepEqual(none.tiles.map(t => t.value).slice(3, 5), ["Not held", "Not held"]);
});

const row = (scheme: string, i: number, over: Partial<ActivityDeckRow> = {}): ActivityDeckRow => ({ scheme, unit: `Unit ${i}`, brand: null, deal: `${scheme} - Unit ${i}`, stage: "Marketing", stageCode: "AVA", live: true, daysAtStage: 99, daysConfirmed: false, waitingOn: null, movedInPeriod: null, ...over });

test("leasing activity: live lettings by stage, viewings held, then the lettings scheme by scheme in one table", () => {
  const rows = [
    ...Array.from({ length: 30 }, (_, i) => row("Bluewater", i)),
    row("Bluewater", 40, { brand: "Sushidog", stage: "Solicitors", stageCode: "SOL", daysAtStage: 107, daysConfirmed: true, waitingOn: "Tenant's solicitors" }),
    row("Bluewater", 41, { brand: "Jersey Mike's", stage: "HOTs", stageCode: "HOT", daysAtStage: 1, daysConfirmed: true }),
    row("Trinity Leeds", 1, { brand: "Iced by Bean", stage: "Invoiced", stageCode: "INV", live: false, daysAtStage: null, movedInPeriod: "2026-09-21" }),
    row("Trinity Leeds", 2, { brand: "Mr Pretzels", stage: "Negotiating", stageCode: "NEG", daysAtStage: 105 }),
  ];
  const deck = activityDeck({ period, schemes: SCHEMES, footer: "Made in ChatBGP.", rows, viewings: [{ day: "2026-09-02", scheme: "Bluewater" }, { day: "2026-10-20", scheme: "Bluewater" }] });
  sound(deck);
  assert.deepEqual(deckOutline(deck), ["Leasing activity", "Live lettings", "Viewings held", "Lettings in negotiation or further on"]);
  assert.match(deck.slides[1].caveat || "", /at Lucent\./);
  const tiles = deck.slides[1].rows[0].blocks[0];
  if (tiles.kind === "tiles") assert.deepEqual(tiles.tiles.map(t => [t.label, t.value]), [["Live lettings", "33"], ["Marketing", "30"], ["Negotiating", "1"], ["HOTs", "1"], ["Solicitors", "1"], ["Changed stage in the period", "1"]]);
  // Viewings by month over the months of the period, and by scheme.
  const [byMonth, byScheme] = deck.slides[2].rows[0].blocks as DeckChart[];
  assert.deepEqual([byMonth.categories, byMonth.series[0].values], [["Aug 2026", "Sep 2026", "Oct 2026"], [0, 1, 1]]);
  assert.deepEqual([byScheme.categories, byScheme.series[0].values], [["Bluewater"], [2]]);
  // More than twelve units only being marketed: counted on the chart, not listed. The rest are in scheme order, furthest on first, a closed one last.
  const table = deck.slides[3].rows[0].blocks[0] as DeckTable;
  assert.deepEqual(table.rows, [
    ["Bluewater", "Unit 40", "Sushidog", "Solicitors", "107", "Tenant's solicitors"],
    ["", "Unit 41", "Jersey Mike's", "HOTs", "1", ""],
    ["Trinity Leeds", "Unit 2", "Mr Pretzels", "Negotiating", "105*", ""],
    ["", "Unit 1", "Iced by Bean", "Invoiced (closed)", "", ""],
  ]);
  assert.equal(deck.slides[3].subtitle, "3 live lettings and 1 that changed stage in the period and since closed");
  assert.match(deck.slides[3].caveat || "", /^30 units are being marketed with no negotiation yet: counted on the chart, not listed here\. The Leasing activity Excel export lists every one\. \* The day it reached its stage is not confirmed/);
  // Twelve or fewer being marketed: every letting is listed, over as many slides as it needs, each once, the scheme named on its first row of a slide.
  const few = activityDeck({ period, schemes: SCHEMES, footer: "f", viewings: [], rows: [...Array.from({ length: 12 }, (_, i) => row("Bluewater", i)), ...Array.from({ length: 9 }, (_, i) => row("Lucent", i, { stage: "Solicitors", stageCode: "SOL" }))] });
  sound(few);
  assert.deepEqual(deckOutline(few).slice(3), ["The lettings", "The lettings (continued)"]);
  const tables = few.slides.slice(3).map(s => s.rows[0].blocks[0] as DeckTable);
  assert.equal(tables.flatMap(t => t.rows).length, 21);
  for (const t of tables) assert.ok(t.rows.length <= tableRowsThatFit(freeHeight(true)));
  assert.equal(tables[0].rows[0][0], "Bluewater");
  assert.equal(tables[0].rows[1][0], "");
  assert.equal(tables[0].rows[0][2], "No brand yet");
  assert.deepEqual(tables.map(t => t.rows.length), [11, 10], "cut evenly, not fourteen and seven");
  assert.equal(tables[1].rows[0][0], "Bluewater", "a scheme that runs on is named again at the head of the next slide");
  assert.equal(tables[1].rows[1][0], "Lucent", "and the next scheme where it starts");
  assert.equal(tables[1].rows[2][0], "");
  assert.match(few.slides[4].subtitle || "", /^Bluewater to Lucent · 2 of 2$/);
  // Nothing at all: cards, not charts, and no table.
  const empty = activityDeck({ period, schemes: SCHEMES, footer: "f", rows: [], viewings: [] });
  sound(empty);
  assert.deepEqual(deckOutline(empty), ["Leasing activity", "Live lettings", "Viewings held"]);
  assert.equal(empty.slides[2].rows[0].blocks[0].kind, "card");
});
