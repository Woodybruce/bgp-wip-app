import test from "node:test";
import assert from "node:assert/strict";
import { parseReportPeriod } from "./landsec-reports";
import { DECK_PAGE, chartHasData, deckOutline, layoutSlide, tableRowsThatFit, type Deck, type DeckTable } from "./landsec-deck";
import { marketItems, competitionItems, competitionSubjects, type MarketData, type MarketInput, type MarketSignalRow } from "./landsec-market-report";
import { MARKET_DECK_PER_CATEGORY, boardMarketSlides, marketDeck, stackTables, type MarketDeckInput } from "./landsec-market-deck";

const parsed = parseReportPeriod("2026-09", "2026-11");
assert.ok(parsed.ok);
const period = parsed.period;
const signal = (i: number, over: Partial<MarketSignalRow> = {}): MarketSignalRow => ({ brandId: `b${i}`, brand: `Brand ${String(i).padStart(2, "0")}`, category: "restaurants_bars", type: "opening", headline: `Brand ${i} opens a new restaurant in town number ${i}`, detail: null, source: `https://www.bighospitality.co.uk/${i}`, publisher: null, date: "2026-10-02", magnitude: null, ...over });
const base: MarketInput = { signals: [], snapshots: [], pipeline: [], owners: [], requirements: [], ownActivity: [], lettings: [], trading: new Set(), targets: new Set() };
const data = (over: Partial<MarketInput> = {}, more: Partial<MarketData> = {}): MarketData => ({ level: "live", items: marketItems({ ...base, ...over }, period), competition: [], research: [], themes: [], notAvailable: [], ...more });
const deckInput = (d: MarketData, words: MarketDeckInput["words"] = {}): MarketDeckInput => ({ period, schemes: [{ key: "bluewater", name: "Bluewater" }], footer: "Made in ChatBGP on 19 November 2026 by A Person.", data: d, words });

function sound(deck: Pick<Deck, "slides">) {
  for (const slide of deck.slides) {
    assert.ok(slide.title.trim());
    if (slide.layout === "title") continue;
    assert.ok(slide.rows.length > 0, `"${slide.title}" has something on it`);
    assert.ok((slide.caveat || "").length <= 360, `"${slide.title}": the line at the foot is two lines at most (${(slide.caveat || "").length})`);
    for (const placed of layoutSlide(slide)) {
      assert.ok(placed.y + placed.h <= (slide.caveat ? DECK_PAGE.bottomWithCaveat : DECK_PAGE.bottom) + 1e-6, `"${slide.title}" fits the slide`);
      const b = placed.block;
      if (b.kind === "chart") { assert.ok(chartHasData(b)); for (const s of b.series) assert.equal(s.values.length, b.categories.length); }
      if (b.kind === "table") {
        assert.ok(b.rows.length > 0 && b.rows.length <= tableRowsThatFit(placed.h, !!b.title, b.lines === 2 ? 2 : 1), `"${slide.title}": ${b.rows.length} rows fit their box`);
        for (const row of b.rows) assert.equal(row.length, b.columns.length);
      }
    }
  }
}

test("an empty period: the deck still stands, with cards in place of charts and nothing invented", () => {
  const deck = marketDeck(deckInput(data()));
  sound(deck);
  assert.deepEqual(deckOutline(deck), ["Landsec Hospitality & Leisure", "Overview", "Competition", "Sources, and what this report does not hold"]);
  assert.equal(deck.slides[0].subtitle, "Market report, Sep to Nov 2026");
  assert.match(deck.slides[1].caveat || "", /Nothing is recorded in the period for Hospitality, Leisure, Cinema & entertainment, London retail\./);
  const words = deck.slides[deck.slides.length - 1].rows[0].blocks[0];
  if (words.kind === "words") assert.match(words.paragraphs.join(" "), /It holds no footfall, sales, turnover, consumer spending or rental index: the app holds none\./);
});

test("the market report: an overview, each sector with its categories one under the other, BGP's own records, the competition, the research and the sources", () => {
  const subjects = competitionSubjects({ landlords: ["Hammerson plc"], centres: [], own: ["Landsec"] });
  const lettings = [{ brandId: "b90", brand: "Dishoom", category: "restaurants_bars" as const, scheme: "Bullring", landlord: "Hammerson", day: "2026-10-20", stage: "exchanged" as const }, { brandId: "b91", brand: "Nando's", category: "restaurants_bars" as const, scheme: "Brent Cross", landlord: "Hammerson", day: null, stage: "negotiating" as const }];
  const d = data({
    signals: [
      ...Array.from({ length: 30 }, (_, i) => signal(i)),
      ...Array.from({ length: 5 }, (_, i) => signal(40 + i, { category: "cafe_qsr" })),
      signal(60, { category: "cinema", type: "closure", headline: "Cinema chain to close six sites" }),
      signal(61, { category: "other", headline: "A retailer opens" }),
    ],
    requirements: [{ brandId: "b40", brand: "Brand 40", category: "cafe_qsr", day: "2026-10-08", wants: "Wants QSR; 1,500 sq ft", record: "requirement added 8 Oct" }],
    lettings, targets: new Set(["b7"]),
  }, {
    competition: competitionItems({ articles: [{ title: "Hammerson buys out Bullring partner for £319m", url: "https://www.cityam.com/x", sourceName: "City AM Property", day: "2026-10-03" }], research: [], lettings, sales: [], subjects }, period),
    research: [{ section: "overall", by: "Savills, Oct 2026", headline: "Shopping centre yields held", figures: ["Prime yield 7.75%"] }],
    themes: [{ section: "hospitality", headline: "QSR leads openings", detail: "American brands are arriving.", day: "2026-10-09", source: "Propel" }],
    notAvailable: ["store counts"],
  });
  const long = Array.from({ length: 8 }, (_, i) => `Paragraph ${i + 1}. ${"Operators kept opening through the quarter. ".repeat(8)}`).join("\n\n");
  const deck = marketDeck(deckInput(d, { hospitality: { text: long, savedBy: "Mark Warne", savedByFirm: "Landsec", savedAt: "2026-11-18T10:00:00Z" } }));
  sound(deck);
  const titles = deckOutline(deck);
  assert.equal(titles[1], "Overview");
  for (const t of ["Hospitality", "Hospitality (continued)", "Hospitality: who is doing what", "Hospitality: BGP intelligence", "Cinema & entertainment", "Other sectors", "Competition", "Competition: who is doing what", "Research and themes"]) assert.ok(titles.includes(t), `a slide called "${t}"`);
  assert.ok(!titles.includes("Leisure") && !titles.includes("London retail"), "a sector with nothing in it has no slide");
  assert.equal(titles[titles.length - 1], "Sources, and what this report does not hold");
  // Saved words are on the sector's first slide, with who wrote them, and every word is printed.
  const first = deck.slides.find(s => s.title === "Hospitality")!;
  const words = first.rows[1].blocks[0];
  assert.equal(words.kind, "words");
  if (words.kind === "words") assert.equal(words.credit, "Written by Mark Warne (Landsec)");
  const printed = deck.slides.filter(s => s.title === "Hospitality" || s.title === "Hospitality (continued)").flatMap(s => s.rows.flatMap(r => r.blocks)).flatMap(b => (b.kind === "words" ? b.paragraphs : [])).join(" ").replace(/\s+/g, " ");
  assert.equal(printed, long.replace(/\s+/g, " ").trim());
  // Who is doing what: a table a category, headed by the category, twelve at most, two lines a row; a target leads.
  const who = deck.slides.filter(s => s.title.startsWith("Hospitality: who is doing what"));
  const tables = who.flatMap(s => s.rows.flatMap(r => r.blocks)).filter((b): b is DeckTable => b.kind === "table");
  assert.deepEqual(Array.from(new Set(tables.map(t => (t.title || "").replace(" (continued)", "")))), ["Restaurants & Bars", "Café, Grab & Go and QSR"]);
  assert.ok(tables.every(t => t.lines === 2));
  const restaurants = tables.filter(t => (t.title || "").startsWith("Restaurants")).flatMap(t => t.rows);
  assert.equal(restaurants.length, MARKET_DECK_PER_CATEGORY);
  assert.equal(restaurants[0][1], "Brand 07 (target)");
  assert.deepEqual(restaurants[0].slice(2), ["Opening", "Brand 7 opens a new restaurant in town number 7", "bighospitality.co.uk"]);
  assert.match(who[0].caveat || "", /18 more items are in the data export\./);
  // BGP's own records: the requirement, and the lettings at another landlord's scheme, the live one marked.
  const own = deck.slides.find(s => s.title === "Hospitality: BGP intelligence")!.rows[0].blocks[0] as DeckTable;
  assert.deepEqual(own.rows.map(r => r[3]), ["Dishoom has exchanged at Bullring (Hammerson)", "Live, In negotiation: Nando's is in negotiation at Brent Cross (Hammerson)", "Wants QSR; 1,500 sq ft (requirement added 8 Oct)"]);
  // The competition: public news first, then what BGP's records hold, a live row last.
  const comp = deck.slides.filter(s => s.title.startsWith("Competition: who is doing what")).flatMap(s => s.rows.flatMap(r => r.blocks)).filter((b): b is DeckTable => b.kind === "table");
  assert.deepEqual(comp.map(t => t.title), ["Ownership and investment", "Leasing and openings"]);
  assert.deepEqual(comp[1].rows.map(r => r[2]), ["Dishoom has exchanged at Bullring", "Live, In negotiation: Nando's is in negotiation at Brent Cross"]);
  // What could not be read is said on the last slide.
  const last = deck.slides[deck.slides.length - 1].rows[0].blocks[0];
  if (last.kind === "words") assert.match(last.paragraphs.join(" "), /Not available when this was made: store counts\. Nothing was put in their place\./);
  // Nothing in the deck carries a link, and nothing a rent.
  assert.doesNotMatch(JSON.stringify(deck), /https?:\/\//);

  // The Board report's short form: the overview, a slide a sector that has something, and one for the competition.
  const board = boardMarketSlides(deckInput(d));
  sound({ slides: board });
  assert.deepEqual(board.map(s => s.title), ["Market report", "Market report: Hospitality", "Market report: Cinema & entertainment", "Market report: competition"]);
  assert.match(board[1].caveat || "", /The Market report deck lists every item/);
});

test("stacked tables: a table that does not fit what is left of a slide carries on at the top of the next, and none is cut", () => {
  const columns = [{ header: "A", width: 1 }];
  const rows = (n: number) => Array.from({ length: n }, (_, i) => [`row ${i}`]);
  const slides = stackTables({ title: "T", caveat: "c" }, [{ title: "One", columns, rows: rows(3) }, { title: "Two", columns, rows: rows(11) }, { title: "Three", columns, rows: rows(1) }]);
  sound({ slides });
  const tables = slides.map(s => s.rows.map(r => { const t = r.blocks[0] as DeckTable; return `${t.title}:${t.rows.length}`; }));
  assert.equal(tables.flat().filter(t => t.startsWith("One")).length, 1);
  assert.equal(tables.flat().reduce((n, t) => n + Number(t.split(":")[1]), 0), 15, "every row is on a slide");
  assert.ok(tables.flat().some(t => t.startsWith("Two (continued)")));
  assert.deepEqual(slides.map(s => s.title), ["T", ...slides.slice(1).map(() => "T (continued)")]);
  assert.deepEqual(stackTables({ title: "T" }, []), []);
});
