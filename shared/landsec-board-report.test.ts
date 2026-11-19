// The board report's rules: what is counted on which day, what is left out,
// rental growth, deal speed, brands by stage and the market report's checks.
import test from "node:test";
import assert from "node:assert/strict";
import { parseReportPeriod } from "./landsec-reports";
import {
  average, boardActivity, boardMarketSection, boardMarketSettingsKey, boardSchemeSet, boardWhen, brandEngagement, categoryRows, cleanMarketDraft, cleanMarketText,
  daysBetween, dealSpeed, draftFiguresNotSent, median, rentalGrowth, BOARD_MARKET_MAX, BOARD_MARKET_SECTIONS,
  industryFigures, industryHeadlines, industryLines, siteName, storeChange, storySource, targetEvent, targetTenants, viewingHeld, INDUSTRY_COUNTED, TARGET_STAGES,
  type BoardTargetLine,
  type BoardBrandLine, type BoardDeal, type IndustryInput, type IndustrySignal,
} from "./landsec-board-report";

const period = (from: string, to: string) => {
  const r = parseReportPeriod(from, to);
  if (!r.ok) throw new Error(r.error);
  return r.period;
};
const Q = period("2026-08", "2026-10");
const deal = (over: Partial<BoardDeal>): BoardDeal => ({
  id: over.id || "d", ref: 1, scheme: "bluewater", unit: "Unit 1", brand: "Brand", category: "restaurants_bars", rentPa: null,
  instructed: null, created: null, marketing: null, hotsIssued: null, hotsMoved: null, exchangedOn: null, exchangeMoved: null, completedOn: null, completeMoved: null,
  passingRent: null, erv: null, scheduleShowsTenant: false, ...over,
});

test("a day is in the period by its London day, and an unconfirmed day is neither in nor out", () => {
  assert.equal(boardWhen({ day: "2026-08-01", confirmed: true }, Q), "in");
  assert.equal(boardWhen({ day: "2026-10-31", confirmed: true }, Q), "in");
  assert.equal(boardWhen({ day: "2026-11-01", confirmed: true }, Q), "out");
  assert.equal(boardWhen({ day: "2026-07-31", confirmed: true }, Q), "out");
  assert.equal(boardWhen({ day: "2026-09-10", confirmed: false }, Q), "unconfirmed");
  assert.equal(boardWhen({ day: "2026-11-10", confirmed: false }, Q), "out");
  assert.equal(boardWhen(null, Q), "out");
});

test("days between, median and average", () => {
  assert.equal(daysBetween("2026-08-01", "2026-08-31"), 30);
  assert.equal(daysBetween("2026-03-28", "2026-03-30"), 2, "the clocks going forward do not lose a day");
  assert.equal(daysBetween("2026-08-10", "2026-08-10"), 0);
  assert.equal(daysBetween("2026-08-10", "2026-08-09"), null, "out of order is not a duration");
  assert.equal(daysBetween(null, "2026-08-09"), null);
  assert.equal(median([]), null);
  assert.equal(median([30]), 30);
  assert.equal(median([10, 90, 30]), 30);
  assert.equal(median([10, 20, 31, 90]), 25.5);
  assert.equal(average([10, 20, 31]), 20.3);
  assert.equal(average([]), null);
});

test("activity: lettings, heads of terms and instructions are counted on their own day, at the period's edges", () => {
  const a = boardActivity({
    deals: [
      deal({ id: "a", exchangedOn: "2026-08-01", completedOn: "2026-10-31" }),                    // both in: one letting
      deal({ id: "b", scheme: "trinity", exchangedOn: "2026-07-31", completedOn: "2026-08-15" }), // exchanged before, completed in
      deal({ id: "c", exchangedOn: "2026-11-01" }),                                              // the day after the period
      deal({ id: "d", hotsIssued: "2026-09-02", instructed: "2026-08-03" }),
      deal({ id: "e", hotsMoved: { day: "2026-09-05", confirmed: true }, created: { day: "2026-09-01", confirmed: true }, category: null }),
    ],
    viewings: [], offers: [],
  }, Q, "2026-11-19");
  assert.deepEqual([a.total.lettings, a.total.exchanged, a.total.completed], [2, 1, 2]);
  assert.equal(a.total.hots, 2);
  assert.equal(a.total.instructions, 2, "a typed instructed date, and a letting added on its own");
  assert.deepEqual([a.byScheme.bluewater.lettings, a.byScheme.trinity.lettings], [1, 1]);
  assert.equal(a.byCategory.none.hots, 1, "a letting with no brand is counted under no brand");
  assert.deepEqual(a.leftOut, { stageMoves: 0, instructions: 0, offersNotConfirmed: 0, offersNoDate: 0 });
});

test("activity: a date from a bulk update is left out and counted as left out", () => {
  const a = boardActivity({
    deals: [
      deal({ id: "a", exchangeMoved: { day: "2026-09-10", confirmed: false }, hotsMoved: { day: "2026-09-01", confirmed: false } }),
      deal({ id: "b", created: { day: "2026-09-10", confirmed: false } }),
      // A typed date wins over a bulk stamp, and a typed instructed date over a bulk load.
      deal({ id: "c", exchangedOn: "2026-09-12", exchangeMoved: { day: "2026-09-10", confirmed: false }, instructed: "2026-08-20", created: { day: "2026-09-10", confirmed: false } }),
      // A bulk stamp outside the period is nothing.
      deal({ id: "d", completeMoved: { day: "2026-07-01", confirmed: false } }),
    ],
    viewings: [], offers: [],
  }, Q, "2026-11-19");
  assert.equal(a.total.lettings, 1);
  assert.equal(a.total.hots, 0);
  assert.equal(a.total.instructions, 1);
  assert.equal(a.leftOut.stageMoves, 2);
  assert.equal(a.leftOut.instructions, 1);
});

test("activity: viewings held and offers received", () => {
  const a = boardActivity({
    deals: [],
    viewings: [
      { scheme: "bluewater", day: "2026-08-01", status: "completed", category: "cafe_qsr" },
      { scheme: "bluewater", day: "2026-10-31", status: "scheduled", category: "cafe_qsr" },
      { scheme: "bluewater", day: "2026-10-31", status: "cancelled", category: "cafe_qsr" },
      { scheme: "bluewater", day: "2026-09-09", status: "no_show", category: null },
      { scheme: "bluewater", day: "2026-09-09", status: "not_leasing", category: null },
      { scheme: "bluewater", day: "2026-11-01", status: "completed", category: null },
      { scheme: "bluewater", day: "2026-07-31", status: "completed", category: null },
      { scheme: "bluewater", day: null, status: "completed", category: null },
    ],
    offers: [
      { scheme: "bluewater", day: "2026-10-31", logged: true, category: "cafe_qsr" },
      { scheme: "bluewater", day: "2026-11-01", logged: true, category: "cafe_qsr" },
      { scheme: "bluewater", day: "2026-09-01", logged: false, category: null },
      { scheme: "bluewater", day: null, logged: true, category: null },
    ],
  }, Q, "2026-11-19");
  assert.deepEqual([a.total.viewings, a.total.viewingsCompleted], [2, 1]);
  assert.equal(a.total.offers, 1);
  assert.deepEqual([a.leftOut.offersNotConfirmed, a.leftOut.offersNoDate], [1, 1]);
  assert.equal(a.byCategory.cafe_qsr.viewings, 2);
  // A viewing booked for a day that has not come is not held yet.
  const early = boardActivity({ deals: [], offers: [], viewings: [{ scheme: "s", day: "2026-10-20", status: "scheduled", category: null }] }, Q, "2026-10-15");
  assert.equal(early.total.viewings, 0);
});

test("the category table: each category under its group with a total, then other and no brand", () => {
  const a = boardActivity({
    deals: [deal({ id: "a", exchangedOn: "2026-09-01", category: "cafe_qsr" }), deal({ id: "b", exchangedOn: "2026-09-02", category: "restaurants_bars" }),
      deal({ id: "c", exchangedOn: "2026-09-03", category: "cinema" }), deal({ id: "d", exchangedOn: "2026-09-04", category: "other" }), deal({ id: "e", exchangedOn: "2026-09-05", category: null })],
    viewings: [], offers: [],
  }, Q, "2026-11-19");
  const rows = categoryRows(a.byCategory);
  assert.deepEqual(rows.map(r => [r.label, r.counts.lettings]), [
    ["Restaurants & Bars", 1], ["Café, Grab & Go and QSR", 1], ["Hospitality: all", 2], ["Leisure: all", 0], ["Cinema", 1], ["Cinema & entertainment: all", 1], ["London retail: all", 0],
    ["Other brand types", 1], ["No brand recorded", 1],
  ]);
});

test("rental growth: each comparison only where both of its figures are held, and nothing estimated", () => {
  const g = rentalGrowth([
    deal({ id: "a", exchangedOn: "2026-09-01", rentPa: 110000, passingRent: 100000, erv: 105000 }),                       // both
    deal({ id: "b", exchangedOn: "2026-09-02", rentPa: 90000, passingRent: 100000 }),                                     // no ERV
    deal({ id: "c", completedOn: "2026-10-31", rentPa: 60000, erv: 50000 }),                                              // no previous rent
    deal({ id: "d", exchangedOn: "2026-09-04", rentPa: 80000, passingRent: 80000, erv: 80000, scheduleShowsTenant: true }), // the schedule shows the new tenant
    deal({ id: "e", exchangedOn: "2026-09-05", passingRent: 70000, erv: 70000 }),                                         // no agreed rent
    deal({ id: "f", exchangedOn: "2026-09-06", rentPa: 50000, passingRent: 0 }),                                          // a zero is not a rent
    deal({ id: "g", exchangedOn: "2026-11-01", rentPa: 1, passingRent: 1, erv: 1 }),                                      // after the period
    deal({ id: "h", exchangeMoved: { day: "2026-09-07", confirmed: false }, rentPa: 1, passingRent: 1, erv: 1 }),         // a bulk date
  ], Q);
  assert.equal(g.lettings, 6);
  assert.deepEqual([g.withPrevious, g.withErv, g.withBoth, g.leftOut], [2, 3, 1, 2]);
  const row = (id: string) => g.rows.find(r => r.id === id)!;
  assert.deepEqual([row("a").vsPreviousPct, row("a").vsErvPct, row("a").missing], [10, 4.8, null]);
  assert.deepEqual([row("b").vsPreviousPct, row("b").vsErvPct, row("b").missing], [-10, null, "no ERV"]);
  assert.deepEqual([row("c").vsPreviousPct, row("c").vsErvPct], [null, 20]);
  assert.deepEqual([row("d").previousRent, row("d").vsPreviousPct, row("d").vsErvPct], [null, null, 0]);
  assert.match(row("d").missing!, /schedule now shows the new tenant/);
  assert.deepEqual([row("e").agreedRent, row("e").vsPreviousPct, row("e").vsErvPct], [null, null, null]);
  assert.equal(row("f").previousRent, null);
  assert.equal(g.avgVsPreviousPct, 0, "(+10 and -10) / 2");
  assert.equal(g.avgVsErvPct, 8.3, "(4.8 + 20 + 0) / 3");
  assert.deepEqual([g.agreedForPrevious, g.previousTotal, g.totalVsPreviousPct], [200000, 200000, 0]);
  assert.deepEqual([g.agreedForErv, g.ervTotal, g.totalVsErvPct], [250000, 235000, 6.4]);
  const none = rentalGrowth([], Q);
  assert.deepEqual([none.lettings, none.avgVsPreviousPct, none.avgVsErvPct, none.totalVsErvPct], [0, null, null, null]);
});

test("deal speed: measured only between confirmed days, the rest counted as left out", () => {
  const s = dealSpeed([
    deal({ id: "a", instructed: "2026-08-01", hotsIssued: "2026-08-31", exchangedOn: "2026-10-10" }),                                   // 30 to HoTs, 40 to exchange
    deal({ id: "b", marketing: { day: "2026-06-01", confirmed: true }, hotsMoved: { day: "2026-08-10", confirmed: true } }),              // 70 to HoTs
    deal({ id: "c", marketing: { day: "2026-06-01", confirmed: false }, hotsIssued: "2026-09-01" }),                                    // start not confirmed
    deal({ id: "d", created: { day: "2026-06-01", confirmed: true }, hotsIssued: "2026-09-01" }),                                       // the day it was added is never the start
    deal({ id: "e", instructed: "2026-08-01", hotsMoved: { day: "2026-09-01", confirmed: false } }),                                    // HoTs day not confirmed
    deal({ id: "f", instructed: "2026-09-20", hotsIssued: "2026-09-01" }),                                                              // out of order
    deal({ id: "g", hotsIssued: "2026-07-01", exchangedOn: "2026-08-20" }),                                                             // 50 to exchange; HoTs before the period
    deal({ id: "h", exchangedOn: "2026-08-25" }),                                                                                       // exchanged with no HoTs day
    deal({ id: "i", hotsMoved: { day: "2026-08-01", confirmed: false }, exchangedOn: "2026-09-25" }),                                   // HoTs day not confirmed
    deal({ id: "j", instructed: "2026-01-01", hotsIssued: "2026-11-02" }),                                                              // HoTs after the period
  ], Q);
  assert.deepEqual(s.toHots.rows.map(r => [r.id, r.days]), [["b", 70], ["a", 30]]);
  // Left out of the first measure: c, d, e, f, and i (its Heads of Terms day falls in the period but is not confirmed).
  assert.deepEqual([s.toHots.count, s.toHots.median, s.toHots.average, s.toHots.leftOut], [2, 50, 50, 5]);
  assert.deepEqual(s.toExchange.rows.map(r => [r.id, r.days]), [["g", 50], ["a", 40]]);
  assert.deepEqual([s.toExchange.count, s.toExchange.median, s.toExchange.average, s.toExchange.leftOut], [2, 45, 45, 2]);
  const empty = dealSpeed([], Q);
  assert.deepEqual([empty.toHots.count, empty.toHots.median, empty.toHots.average, empty.toHots.leftOut], [0, null, null, 0]);
});

test("brand engagements: one stage per brand, the furthest; newly in play by the earliest dated record", () => {
  const line = (over: Partial<BoardBrandLine>): BoardBrandLine => ({ brand: "A", category: null, scheme: "bluewater", unit: null, stage: "approached", firstSeen: null, ...over });
  const e = brandEngagement([
    line({ brand: "Alpha", stage: "viewed", firstSeen: "2026-09-01", unit: "U1" }),
    line({ brand: "Alpha", stage: "hots", scheme: "trinity", firstSeen: "2026-08-15", unit: "T4" }),
    line({ brand: "Beta", stage: "approached", firstSeen: "2026-07-31" }),
    line({ brand: "Gamma", stage: "let", firstSeen: "2026-10-31" }),
    line({ brand: "Delta", stage: "wanted" }),
    line({ brand: "Echo", stage: "not_proceeding", firstSeen: "2026-09-09" }),
    line({ brand: "Foxtrot", stage: "trading", firstSeen: "2019-01-01" }),
  ], Q);
  assert.equal(e.brands, 6);
  assert.deepEqual(e.byStage.map(s => [s.label, s.brands]), [["Approached", 1], ["Viewed", 0], ["Negotiating", 0], ["HOTs", 1], ["Solicitors", 0], ["Let", 1]]);
  assert.equal(e.otherStages, 3);
  assert.deepEqual(e.newlyInPlay.map(n => [n.brand, n.firstSeen, n.stage]), [["Alpha", "2026-08-15", "HOTs"], ["Echo", "2026-09-09", "Not proceeding"], ["Gamma", "2026-10-31", "Let"]]);
  assert.deepEqual(e.newlyInPlay[0].schemes.sort(), ["bluewater", "trinity"]);
  assert.equal(e.undated, 1);
  assert.deepEqual(e.furthestByScheme.bluewater.map(b => [b.brand, b.stage]), [["Gamma", "Let"], ["Alpha", "Viewed"], ["Beta", "Approached"]]);
  assert.deepEqual(e.furthestByScheme.trinity, [{ brand: "Alpha", unit: "T4", stage: "HOTs" }]);
});

test("the market report: five sections, a key per period and scheme set, text kept plain", () => {
  assert.deepEqual(BOARD_MARKET_SECTIONS.map(s => s.key), ["overall", "hospitality", "leisure", "cinema_entertainment", "london_retail"]);
  assert.equal(boardMarketSection("leisure")!.group, "Leisure");
  assert.equal(boardMarketSection("fees"), null);
  assert.equal(boardSchemeSet(["trinity", "bluewater", "trinity"]), "bluewater,trinity");
  assert.equal(boardMarketSettingsKey("2026-08", "2026-10", "abc123"), "landsec_board_report:2026-08:2026-10:abc123");
  assert.equal(cleanMarketText("  One.\r\n\r\n\r\n\r\nTwo   words. \n"), "One.\n\nTwo words.");
  assert.equal(cleanMarketText("x".repeat(BOARD_MARKET_MAX + 50)).length, BOARD_MARKET_MAX);
  assert.equal(cleanMarketText(null), "");
});

test("a draft is made plain before a person edits it, and its unknown figures are listed", () => {
  const raw = "## Hospitality\n\n**Demand** held up across the quarter with 3 lettings and rents 4.8% ahead of ERV (propelinfo.com). See https://evil.example/x for more.\n\n- Operators took 12,500 sq ft.\n- Footfall rose 9%.";
  const text = cleanMarketDraft(raw)!;
  assert.doesNotMatch(text, /[#*`]|https?:/);
  assert.match(text, /^Hospitality\n\nDemand held up/);
  assert.equal(cleanMarketDraft("Too short."), null);
  assert.equal(cleanMarketDraft(""), null);
  const material = "FACTS\n- 3 lettings exchanged or completed\n- Average against ERV: +4.8%\n- 12500 sq ft";
  assert.deepEqual(draftFiguresNotSent(text, material), ["9%"]);
  assert.deepEqual(draftFiguresNotSent("Two or 3 operators and £95,000 a year.", "rent 95000"), []);
});

// ── The industry in the period ───────────────────────────────────────────

const sig = (over: Partial<IndustrySignal>): IndustrySignal => ({ brandId: "b1", brand: "Wingstop", category: "cafe_qsr", type: "opening", headline: "Wingstop opens in Leeds", source: "https://www.propelinfo.com/a", date: "2026-09-01", ...over });

test("store change: two good counts of the same list, the later one in the period, at least 20 days apart", () => {
  const snap = (day: string, count: number, basis = "sitemap|/stores|uk") => ({ day, basis, count });
  assert.equal(storeChange([snap("2026-07-20", 100), snap("2026-10-15", 108)], Q), 8, "the count before the period against the latest in it");
  assert.equal(storeChange([snap("2026-06-01", 90), snap("2026-07-30", 100), snap("2026-09-01", 104), snap("2026-10-15", 97)], Q), -3, "the latest count on or before the first day is the start");
  assert.equal(storeChange([snap("2026-08-10", 50), snap("2026-10-20", 55)], Q), 5, "with none before the period, the earliest inside it");
  assert.equal(storeChange([snap("2026-10-01", 50), snap("2026-10-15", 55)], Q), null, "fewer than 20 days apart");
  assert.equal(storeChange([snap("2026-07-20", 100)], Q), null, "one count is not a change");
  assert.equal(storeChange([snap("2026-07-01", 100), snap("2026-07-25", 104)], Q), null, "no count in the period");
  assert.equal(storeChange([snap("2026-07-20", 100, "website_list||"), snap("2026-10-15", 108)], Q), null, "a different list is not compared");
  assert.equal(storeChange([snap("2026-07-20", 100), snap("2026-10-15", 108), snap("2026-11-03", 300)], Q), 8, "a count after the period is not used");
});

test("industry figures: brands counted once, by section, by London day, and a list that was not read is not available", () => {
  const input: IndustryInput = {
    signals: [
      sig({}), sig({ headline: "Wingstop signs in Hull", date: "2026-10-31" }),                                    // one brand, two opening stories
      sig({ brandId: "b2", brand: "Bowl Co", category: "competitive_socialising", type: "closure", headline: "Bowl Co enters administration" }),
      sig({ brandId: "b3", brand: "Other Co", category: "other", type: "opening", headline: "Other Co opens" }),
      sig({ brandId: "b4", brand: "Late Co", type: "opening", headline: "Late", date: "2026-11-01" }),            // after the period
      sig({ brandId: "b5", brand: "News Co", type: "news", headline: "News Co trading update" }),
    ],
    snapshots: [
      { brandId: "b1", category: "cafe_qsr", day: "2026-07-20", basis: "s", count: 60 }, { brandId: "b1", category: "cafe_qsr", day: "2026-10-20", basis: "s", count: 66 },
      { brandId: "b2", category: "competitive_socialising", day: "2026-07-20", basis: "s", count: 40 }, { brandId: "b2", category: "competitive_socialising", day: "2026-10-20", basis: "s", count: 37 },
      { brandId: "b5", category: "cafe_qsr", day: "2026-10-20", basis: "s", count: 9 },
    ],
    pipeline: [
      { brandId: "b1", category: "cafe_qsr", kind: "planning", day: "2026-08-01" }, { brandId: "b1", category: "cafe_qsr", kind: "planning", day: "2026-10-31" },
      { brandId: "b1", category: "cafe_qsr", kind: "planning", day: "2026-07-31" }, { brandId: "b2", category: "competitive_socialising", kind: "job", day: "2026-09-09" },
      { brandId: "b9", category: "cafe_qsr", kind: "planning", day: null },
    ],
    requirements: [
      { brandId: "b1", category: "cafe_qsr", day: "2026-09-01" }, { brandId: "b1", category: "cafe_qsr", day: "2026-09-02" }, { brandId: "b2", category: "competitive_socialising", day: "2026-08-01" },
      { brandId: null, category: null, day: "2026-08-05" }, { brandId: "b1", category: "cafe_qsr", day: "2026-11-02" },
    ],
  };
  const all = industryFigures(input, null, Q);
  assert.deepEqual(all.signals, { opening: 2, closure: 1, net: 1, stories: 5 });
  assert.deepEqual(all.stores, { brands: 2, net: 3, up: 1, down: 1 });
  assert.deepEqual(all.planning, { applications: 2, brands: 1 });
  assert.deepEqual(all.jobs, { adverts: 1, brands: 1 });
  assert.deepEqual(all.requirements, { added: 3, brands: 2, noBrand: 1 });
  const hospitality = industryFigures(input, "Hospitality", Q);
  assert.deepEqual(hospitality.signals, { opening: 1, closure: 0, net: 1, stories: 3 });
  assert.deepEqual(hospitality.stores, { brands: 1, net: 6, up: 1, down: 0 });
  assert.deepEqual(hospitality.requirements, { added: 2, brands: 1, noBrand: 0 });
  const leisure = industryFigures(input, "Leisure", Q);
  assert.deepEqual([leisure.signals!.opening, leisure.signals!.closure, leisure.signals!.net], [0, 1, -1]);
  assert.deepEqual(leisure.jobs, { adverts: 1, brands: 1 });
  assert.deepEqual(industryFigures(input, "London retail", Q).signals, { opening: 0, closure: 0, net: 0, stories: 0 });
  // A list that could not be read is "not available", never a zero.
  const none = industryFigures({ signals: null, snapshots: null, pipeline: null, requirements: null }, null, Q);
  assert.deepEqual([none.signals, none.stores, none.planning, none.jobs, none.requirements, none.headlines], [null, null, null, null, null, []]);
  assert.deepEqual(industryLines(none, "Overall").map(l => /not available\.$/.test(l)), [true, true, true, true, true]);
  const lines = industryLines(all, "Overall");
  assert.equal(lines[0], "Brands with an opening story across all brands: 2; with a closure, CVA or administration story: 1; net +1 (5 dated stories).");
  assert.equal(lines[1], "Net change in stores across all brands, counted on the brands' own websites: +3 across 2 brands with two good counts (1 up, 1 down).");
  assert.equal(lines[4], "Leasing requirements added to the app across all brands: 3, for 2 brands; 1 more is not tied to a brand record.");
  assert.match(industryLines(industryFigures({ ...input, snapshots: [] }, "Leisure", Q), "Leisure")[1], /no brand has two good counts/);
  assert.match(INDUSTRY_COUNTED, /It holds no footfall, sales, turnover, consumer spending or rental index: the app holds none\.$/);
});

test("headline stories: a headline, its source's site and its date only; ten at most, two a brand, no rumour, nothing without a link", () => {
  const many = Array.from({ length: 14 }, (_, i) => sig({ brandId: `x${i}`, brand: `Brand ${String(i).padStart(2, "0")}`, type: "news", headline: `Story ${i}`, date: `2026-09-${String(i + 1).padStart(2, "0")}` }));
  const out = industryHeadlines([
    ...many,
    sig({ brandId: "c", brand: "Closer", type: "closure", headline: "Closer to shut 12 sites", source: "https://www.thecaterer.com/x?y=1", magnitude: "large" }),
    sig({ brandId: "w", headline: "One" }), sig({ brandId: "w", headline: "Two", date: "2026-09-02" }), sig({ brandId: "w", headline: "Three", date: "2026-09-03" }),
    sig({ brandId: "r", type: "rumour", headline: "A rumour" }), sig({ brandId: "n", headline: "No link", source: "manual" }), sig({ brandId: "d", headline: "one" }),
  ]);
  assert.equal(out.length, 10);
  assert.deepEqual(out[0], { date: "2026-09-01", brand: "Closer", headline: "Closer to shut 12 sites", site: "thecaterer.com" });
  assert.deepEqual(Object.keys(out[0]).sort(), ["brand", "date", "headline", "site"]);
  assert.equal(out.filter(h => ["One", "Two", "Three"].includes(h.headline)).length, 2, "at most two a brand");
  assert.ok(!out.some(h => /rumour|No link/.test(h.headline)));
  assert.ok(!out.some(h => /https?:/.test(h.site)));
  assert.equal(siteName("not a link"), "");
});

// Woody's first populated samples showed "news.google.com" as the source of every story.
test("a Google News link names the publisher at the end of its headline, never news.google.com", () => {
  const google = "https://news.google.com/rss/articles/CBMiabc?oc=5";
  assert.deepEqual(storySource("Jersey Mike's opens first restaurant in the United Kingdom - ROI-NJ", google), { headline: "Jersey Mike's opens first restaurant in the United Kingdom", site: "ROI-NJ" });
  assert.deepEqual(storySource("Flat Iron Birmingham opens on Temple Street, October 2026", google), { headline: "Flat Iron Birmingham opens on Temple Street, October 2026", site: "Google News" });
  // Too short a headline to cut, or an ending that is a sentence: left whole.
  assert.deepEqual(storySource("Opens - today.", google), { headline: "Opens - today.", site: "Google News" });
  // Any other link is named by its site, and its headline is left as it is.
  assert.deepEqual(storySource("Wingstop to open 20 sites - a big year", "https://www.propelinfo.com/story/1"), { headline: "Wingstop to open 20 sites - a big year", site: "propelinfo.com" });
  assert.deepEqual(storySource("  Spaces   tidied ", null), { headline: "Spaces tidied", site: "" });
  // The printed stories use it, and two links to one story are one story.
  const out = industryHeadlines([
    { brandId: "a", brand: "Jersey Mike's", category: null, type: "opening", headline: "Jersey Mike's opens first UK restaurant - ROI-NJ", source: google, date: "2026-09-09" },
    { brandId: "a", brand: "Jersey Mike's", category: null, type: "opening", headline: "Jersey Mike's opens first UK restaurant", source: "https://roi-nj.com/x", date: "2026-09-08" },
  ]);
  assert.deepEqual(out, [{ date: "2026-09-09", brand: "Jersey Mike's", headline: "Jersey Mike's opens first UK restaurant", site: "ROI-NJ" }]);
});

test("a viewing held: dated in the period, not later than today, and not cancelled, a no-show or not a leasing viewing", () => {
  const parsed = parseReportPeriod("2026-08", "2026-10");
  assert.ok(parsed.ok);
  const p = parsed.period;
  assert.equal(viewingHeld({ day: "2026-09-02", status: "completed" }, p, "2026-11-19"), true);
  assert.equal(viewingHeld({ day: "2026-09-02", status: null }, p, "2026-11-19"), true);
  assert.equal(viewingHeld({ day: "2026-09-02", status: "Cancelled" }, p, "2026-11-19"), false);
  assert.equal(viewingHeld({ day: "2026-09-02", status: "no_show" }, p, "2026-11-19"), false);
  assert.equal(viewingHeld({ day: "2026-09-02", status: "not_leasing" }, p, "2026-11-19"), false);
  assert.equal(viewingHeld({ day: "2026-10-30", status: "booked" }, p, "2026-10-15"), false, "booked for a later day");
  assert.equal(viewingHeld({ day: "2026-11-01", status: "completed" }, p, "2026-11-19"), false);
  assert.equal(viewingHeld({ day: null, status: "completed" }, p, "2026-11-19"), false);
});

// Woody, 2026-11-19: "should be a section on leasing activity on target tenants."
test("a plan record as an event: only a dated thing that happened, read from the plan's own labels", async () => {
  const { readEvidence } = await import("./brand-stage");
  const event = (e: Parameters<typeof readEvidence>[0]) => { const r = readEvidence(e); return r ? targetEvent(e.src, r.label) : null; };
  // Fed through the stage engine's own reading, so a change of its wording fails here.
  assert.equal(event({ src: "viewing", status: "completed" }), "viewed");
  assert.equal(event({ src: "viewing", status: "scheduled" }), "approached");
  assert.equal(event({ src: "viewing", status: "no_show" }), "approached");
  assert.equal(event({ src: "viewing", status: "cancelled" }), null);
  assert.equal(event({ src: "interest" }), "approached");
  assert.equal(event({ src: "offer", status: "Pending", detail: "landlord countered 3 Nov" }), "offer");
  assert.equal(event({ src: "offer", status: "Agreed" }), "offer");
  assert.equal(event({ src: "offer", status: "Rejected" }), null);
  assert.equal(event({ src: "offer", status: "Withdrawn" }), null);
  assert.equal(event({ src: "hots", status: "issued" }), "hots");
  assert.equal(event({ src: "deal", status: "Solicitors", dealType: "New Letting", dealRef: 3550 }), "stage");
  assert.equal(event({ src: "tracker_target", status: "Approached" }), "approached");
  assert.equal(event({ src: "tracker_target", status: "Meeting held" }), "approached");
  assert.equal(event({ src: "tracker_target", status: "Inspection done" }), "viewed");
  // Being named as a target, a Wanted line and a brand case say where a brand is wanted, not that something happened.
  assert.equal(event({ src: "tracker_target", status: "Identified" }), null);
  assert.equal(event({ src: "target_list" }), null);
  assert.equal(event({ src: "wish", hasUnit: true }), null);
  assert.equal(event({ src: "case_unit", hasUnit: true }), null);
  assert.equal(event({ src: "trading" }), null);
});

test("target tenants: a brand once at its furthest line between Wanted and Let, and the period counted only from dated records", () => {
  const parsed = parseReportPeriod("2026-08", "2026-10");
  assert.ok(parsed.ok);
  const p = parsed.period;
  const line = (over: Partial<BoardTargetLine>): BoardTargetLine => ({ brand: "A", category: null, scheme: "bluewater", unit: null, stage: "wanted", firstSeen: null, since: null, events: [], next: null, requirementHeld: false, ...over });
  const t = targetTenants([
    // Jersey Mike's: viewed and offered in the period, heads of terms on 16 October; also wanted at a second scheme.
    line({ brand: "Jersey Mike's", unit: "L057", stage: "hots", firstSeen: "2026-09-11", since: "2026-10-16", requirementHeld: true, next: { title: "Waiting on tenant", due: null, who: "R Willcox" },
      events: [{ kind: "viewed", day: "2026-09-11" }, { kind: "offer", day: "2026-10-02" }, { kind: "hots", day: "2026-10-16" }] }),
    line({ brand: "Jersey Mike's", scheme: "lucent", stage: "wanted" }),
    // Approached before the period and nothing since.
    line({ brand: "Gail's", scheme: "lucent", stage: "approached", firstSeen: "2026-03-01", since: "2026-03-01", events: [{ kind: "approached", day: "2026-03-01" }] }),
    // A viewing booked in the period for a day after today is not yet activity.
    line({ brand: "Sushidog", stage: "approached", firstSeen: "2026-10-30", since: "2026-10-30", events: [{ kind: "approached", day: "2026-10-30" }] }),
    // No dated record at all.
    line({ brand: "Wingstop", stage: "unit_identified", unit: "U1" }),
    // Trading here, and a target at another scheme: counted for the target line only.
    line({ brand: "Nando's", stage: "trading", firstSeen: "2020-01-01", since: "2020-01-01" }),
    line({ brand: "Nando's", scheme: "lucent", stage: "solicitors", firstSeen: "2026-07-01", since: "2026-07-20", events: [{ kind: "stage", day: "2026-07-20" }] }),
    // Not proceeding, and only trading: not targets.
    line({ brand: "Byron", stage: "not_proceeding", firstSeen: "2026-09-01", since: "2026-09-01" }),
    line({ brand: "Costa", stage: "trading" }),
  ], p, "2026-10-20");
  assert.equal(t.inPlay, 5);
  assert.deepEqual(t.byStage.map(s => [s.stage, s.brands]), [["wanted", 0], ["unit_identified", 1], ["approached", 2], ["viewed", 0], ["negotiating", 0], ["hots", 1], ["solicitors", 1], ["let", 0]]);
  assert.deepEqual(t.byStage.map(s => s.stage), TARGET_STAGES);
  // By scheme: a brand at each scheme it has a target line at, by the furthest stage it has reached there.
  assert.deepEqual(t.byScheme, { bluewater: { early: 1, approached: 1, terms: 1, legal: 0 }, lucent: { early: 1, approached: 1, terms: 0, legal: 1 } });
  assert.equal(t.newly, 1, "Jersey Mike's earliest dated record is in the period; Sushidog's is after today");
  assert.equal(t.movedForward, 1, "reached Heads of Terms on a day in the period");
  assert.deepEqual([t.approached, t.viewed, t.offers], [0, 1, 1]);
  assert.equal(t.undated, 1, "Wingstop has no dated record and is in none of the period's figures");
  // The rows: furthest on first, then the latest dated activity; each with its step of eight.
  assert.deepEqual(t.rows.map(r => [r.brand, r.scheme, r.stageLabel, r.step, r.last?.kind ?? null, r.last?.day ?? null]), [
    ["Nando's", "lucent", "Solicitors", 7, null, null],
    ["Jersey Mike's", "bluewater", "HOTs", 6, "hots", "2026-10-16"],
    ["Gail's", "lucent", "Approached", 3, null, null],
    ["Sushidog", "bluewater", "Approached", 3, null, null],
    ["Wingstop", "bluewater", "Unit identified", 2, null, null],
  ]);
  const jm = t.rows[1];
  assert.deepEqual([jm.unit, jm.requirementHeld, jm.next], ["L057", true, { title: "Waiting on tenant", due: null, who: "R Willcox" }]);
  // The same lines read on 31 October: the booked viewing has now happened.
  const later = targetTenants([line({ brand: "Sushidog", stage: "approached", firstSeen: "2026-10-30", since: "2026-10-30", events: [{ kind: "approached", day: "2026-10-30" }] })], p, "2026-10-31");
  assert.deepEqual([later.newly, later.approached, later.movedForward], [1, 1, 1]);
  assert.deepEqual(targetTenants([], p, "2026-10-20"), { inPlay: 0, byStage: TARGET_STAGES.map(stage => ({ stage, label: t.byStage.find(s => s.stage === stage)!.label, brands: 0 })), byScheme: {}, newly: 0, movedForward: 0, approached: 0, viewed: 0, offers: 0, undated: 0, rows: [] });
});
