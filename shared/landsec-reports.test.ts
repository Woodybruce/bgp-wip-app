import test from "node:test";
import assert from "node:assert/strict";
import {
  LANDSEC_REPORTS, REPORT_MAX_MONTHS, defaultReportMonths, inReportPeriod, landsecReportByKey, landsecReportFileName,
  londonMonth, parseReportPeriod, reportDay, reportMonths, reportPeriodLabel, shortReportDay,
} from "./landsec-reports";

const period = (from: unknown, to: unknown, now?: Date) => {
  const r = parseReportPeriod(from, to, now);
  assert.equal(r.ok, true, r.ok ? "" : r.error);
  return (r as Extract<typeof r, { ok: true }>).period;
};

test("one month: the first of the month to the first of the next", () => {
  assert.deepEqual(period("2026-10", "2026-10"), { from: "2026-10", to: "2026-10", start: "2026-10-01", end: "2026-11-01", months: 1, label: "Oct 2026" });
});

test("several months are inclusive of both ends", () => {
  const p = period("2026-08", "2026-10");
  assert.equal(p.start, "2026-08-01");
  assert.equal(p.end, "2026-11-01");
  assert.equal(p.months, 3);
  assert.equal(p.label, "Aug to Oct 2026");
});

test("a period across a year end, and one ending in December", () => {
  const p = period("2025-11", "2026-01");
  assert.equal(p.label, "Nov 2025 to Jan 2026");
  assert.equal(p.end, "2026-02-01");
  assert.equal(period("2026-10", "2026-12").end, "2027-01-01");
});

test("with no months given it is the last three whole months", () => {
  const now = new Date("2026-11-19T10:00:00Z");
  assert.deepEqual(defaultReportMonths(now), { from: "2026-08", to: "2026-10" });
  assert.equal(period(undefined, "", now).label, "Aug to Oct 2026");
  assert.deepEqual(defaultReportMonths(new Date("2026-02-03T10:00:00Z")), { from: "2025-11", to: "2026-01" });
});

test("the month we are in is read in London, not UTC", () => {
  // 23:30 UTC on 31 May is 00:30 on 1 June in London.
  assert.equal(londonMonth(new Date("2026-05-31T23:30:00Z")), "2026-06");
  assert.equal(londonMonth(new Date("2026-12-31T23:30:00Z")), "2026-12");
});

test("one month given is that month", () => {
  assert.equal(period("2026-09", "").label, "Sep 2026");
  assert.equal(period(null, "2026-09").label, "Sep 2026");
});

test("a reversed period is refused", () => {
  const r = parseReportPeriod("2026-10", "2026-08");
  assert.equal(r.ok, false);
  assert.match((r as any).error, /before the first/);
});

test("more than 36 months is refused, 36 is allowed", () => {
  assert.equal(period("2024-01", "2026-12").months, REPORT_MAX_MONTHS);
  const r = parseReportPeriod("2023-12", "2026-12");
  assert.equal(r.ok, false);
  assert.match((r as any).error, /at most 36 months/);
});

test("anything that is not a month is refused", () => {
  for (const bad of ["2026-13", "2026-00", "2026-1", "Oct 2026", "2026-10-01", "26-10", "2026-10; drop table", "../2026-10"]) {
    assert.equal(parseReportPeriod(bad, "2026-10").ok, false, bad);
    assert.equal(parseReportPeriod("2026-01", bad).ok, false, bad);
  }
  assert.equal(parseReportPeriod(["2026-10"], "2026-10").ok, true, "an array is read as not given, so the other month stands");
});

test("a date is in the period by its London day", () => {
  const p = period("2026-08", "2026-10");
  assert.equal(inReportPeriod("2026-08-01", p), true);
  assert.equal(inReportPeriod("2026-10-31", p), true);
  assert.equal(inReportPeriod("2026-11-01", p), false);
  assert.equal(inReportPeriod("2026-07-31", p), false);
  // 23:30 UTC on 31 July is already 1 August in London (BST).
  assert.equal(inReportPeriod("2026-07-31T23:30:00Z", p), true);
  assert.equal(inReportPeriod(new Date("2026-10-31T23:59:00Z"), p), true);
  assert.equal(inReportPeriod(null, p), false);
  assert.equal(inReportPeriod("not a date", p), false);
});

test("a stored day stays the day it is", () => {
  assert.equal(reportDay("2026-03-29"), "2026-03-29");
  assert.equal(reportDay("2026-03-29T00:00:00.000Z"), "2026-03-29");
  assert.equal(reportDay(""), null);
  assert.equal(reportDay("tbc"), null);
});

test("labels", () => {
  assert.equal(reportPeriodLabel("2026-01", "2026-12"), "Jan to Dec 2026");
  assert.equal(reportPeriodLabel("bad", "2026-12"), "");
});

test("the registry: the board report's two files, the market report's two, then nine reports, unique keys, a format each, and no budgets", () => {
  assert.equal(LANDSEC_REPORTS.length, 13);
  assert.equal(new Set(LANDSEC_REPORTS.map(r => r.key)).size, 13);
  assert.deepEqual(LANDSEC_REPORTS.filter(r => r.card === "market").map(r => [r.key, r.format]), [["market-report", "pdf"], ["market-report-items", "xlsx"]]);
  assert.match(landsecReportByKey("market-report")!.note || "", /never the text of the story/);
  assert.deepEqual(LANDSEC_REPORTS.filter(r => r.card === "board").map(r => [r.key, r.format]), [["board-report", "pdf"], ["board-report-figures", "xlsx"]]);
  assert.deepEqual(LANDSEC_REPORTS.slice(0, 2).map(r => r.card), ["board", "board"], "the board report leads the list");
  assert.match(landsecReportByKey("board-report")!.note || "", /only if it is on the app/);
  for (const r of LANDSEC_REPORTS) {
    assert.match(r.key, /^[a-z][a-z-]*$/);
    assert.ok(r.format === "xlsx" || r.format === "pdf");
    assert.ok(r.title && r.description && r.period);
    assert.equal(landsecReportByKey(r.key), r);
  }
  assert.deepEqual(LANDSEC_REPORTS.filter(r => r.format === "pdf").map(r => r.key), ["board-report", "market-report", "leasing-activity-pdf", "asset-profile"]);
  // The three reports to present are decks (a PDF, or a PowerPoint of the same slides); every other entry is an Excel data export.
  assert.deepEqual(LANDSEC_REPORTS.filter(r => r.deck).map(r => [r.key, r.title]), [["board-report", "Board report"], ["market-report", "Market report"], ["leasing-activity-pdf", "Leasing activity"], ["asset-profile", "Asset profile"]]);
  for (const r of LANDSEC_REPORTS) assert.equal(!!r.deck, r.format === "pdf", `${r.key}: a deck is a PDF, an export is Excel`);
  assert.deepEqual(LANDSEC_REPORTS.filter(r => r.schemes === "one").map(r => r.key), ["asset-profile"]);
  assert.match(landsecReportByKey("portfolio")!.note || "", /No budgets/);
  assert.equal(landsecReportByKey("budgets"), null);
  assert.equal(landsecReportByKey(undefined), null);
});

test("file names", () => {
  const p = period("2026-08", "2026-10");
  assert.equal(landsecReportFileName(landsecReportByKey("tenancy-schedule")!, p), "Landsec Tenancy schedule - Aug to Oct 2026.xlsx");
  assert.equal(landsecReportFileName(landsecReportByKey("leasing-activity-pdf")!, p), "Landsec Leasing activity - Aug to Oct 2026.pdf");
  assert.equal(landsecReportFileName(landsecReportByKey("asset-profile")!, p, "St David's, Cardiff"), "Landsec St David's Cardiff Asset profile - Aug to Oct 2026.pdf");
  // A deck asked for as a PowerPoint.
  assert.equal(landsecReportFileName(landsecReportByKey("board-report")!, p, null, "pptx"), "Landsec Board report - Aug to Oct 2026.pptx");
  assert.equal(landsecReportFileName(landsecReportByKey("asset-profile")!, p, "Bluewater", "pptx"), "Landsec Bluewater Asset profile - Aug to Oct 2026.pptx");
  assert.equal(landsecReportFileName(landsecReportByKey("leasing-activity-pdf")!, p, null, "pdf"), "Landsec Leasing activity - Aug to Oct 2026.pdf");
});

test("a day is written with a three-letter month, and a period lists its months", () => {
  assert.equal(shortReportDay("2026-09-02"), "2 Sep 2026");
  assert.equal(shortReportDay("2026-06-21T10:00:00Z"), "21 Jun 2026");
  assert.equal(shortReportDay("2026-12-31"), "31 Dec 2026");
  assert.equal(shortReportDay(null), "");
  assert.equal(shortReportDay("Q1 2026"), "");
  assert.equal(shortReportDay("2026-13-01"), "");
  assert.deepEqual(reportMonths(period("2025-11", "2026-01")), [{ ym: "2025-11", label: "Nov 2025" }, { ym: "2025-12", label: "Dec 2025" }, { ym: "2026-01", label: "Jan 2026" }]);
  assert.deepEqual(reportMonths({ from: "2026-10", to: "2026-10" }), [{ ym: "2026-10", label: "Oct 2026" }]);
  assert.deepEqual(reportMonths({ from: "2026-10", to: "2026-09" }), []);
});
