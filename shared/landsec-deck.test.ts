import test from "node:test";
import assert from "node:assert/strict";
import { LANDSEC_REPORT_PALETTE } from "./landsec-reports";
import {
  DECK_COLOURS, DECK_MIME, DECK_PAGE, DECK_SERIES, chartHasData, chartOrCard, charsPerLine, deckFormat, deckOutline, deckValue, fitCell, freeHeight, layoutSlide, lightOn,
  pageWords, pages, pagesEven, tableRowsThatFit, tileBoxes, tileValueSize, withoutEmptyCategories,
  type DeckChart, type DeckSlide, type DeckTiles,
} from "./landsec-deck";

const tiles = (n: number, perRow?: number): DeckTiles => ({ kind: "tiles", perRow, tiles: Array.from({ length: n }, (_, i) => ({ label: `Tile ${i}`, value: String(i) })) });
const chart = (values: Array<number | null>[]): DeckChart => ({ kind: "chart", chart: "bar", categories: values[0].map((_, i) => `C${i}`), series: values.map(v => ({ ...DECK_SERIES.one, values: v })) });

test("every chart colour comes from the Landsec report palette, and a series keeps one colour", () => {
  assert.equal(DECK_COLOURS.navy, LANDSEC_REPORT_PALETTE.navy);
  assert.equal(DECK_COLOURS.gold, LANDSEC_REPORT_PALETTE.gold);
  assert.equal(DECK_COLOURS.pale, LANDSEC_REPORT_PALETTE.paleBlue);
  for (const hex of Object.values(DECK_COLOURS)) assert.match(hex, /^#[0-9a-f]{6}$/);
  // The mid blue and the grey are mixed from the palette: neither is one of BGP's colours.
  assert.equal(new Set(Object.values(DECK_COLOURS)).size, 5);
  for (const never of ["#6e0c25", "#fc9f8d", "#fcf8f4", "#e4d8d3", "#c2baa3"]) assert.ok(!Object.values(DECK_COLOURS).includes(never as never));
  assert.equal(DECK_SERIES.occupied.colour, "navy");
  assert.equal(DECK_SERIES.vacant.colour, "grey");
  assert.equal(DECK_SERIES.expiries.colour, "navy");
  assert.equal(DECK_SERIES.breaks.colour, "gold");
  assert.deepEqual([lightOn("navy"), lightOn("blue"), lightOn("gold"), lightOn("pale"), lightOn("grey")], [true, true, false, false, false]);
});

test("the layout keeps every block inside the slide, in rows that do not overlap", () => {
  const slide: DeckSlide = {
    layout: "content", title: "T", caveat: "A line.",
    rows: [{ blocks: [tiles(4)] }, { widths: [2, 1], blocks: [chart([[1, 2]]), { kind: "card", title: "x", lines: [] }] }],
  };
  const placed = layoutSlide(slide);
  assert.equal(placed.length, 3);
  for (const b of placed) {
    assert.ok(b.x >= DECK_PAGE.side - 1e-9 && b.x + b.w <= DECK_PAGE.w - DECK_PAGE.side + 1e-9, "inside the side margins");
    assert.ok(b.y >= DECK_PAGE.top - 1e-9 && b.y + b.h <= DECK_PAGE.bottomWithCaveat + 1e-9, "above the line at the foot");
  }
  // The tiles take what they need; the row under them takes the rest.
  assert.ok(Math.abs(placed[0].h - DECK_PAGE.tileH) < 1e-9);
  assert.ok(Math.abs(placed[1].y - (placed[0].y + placed[0].h + DECK_PAGE.rowGap)) < 1e-9);
  assert.ok(Math.abs((placed[1].y + placed[1].h) - DECK_PAGE.bottomWithCaveat) < 1e-9);
  // Two blocks on a line share its width by their shares, with a gap between.
  assert.ok(Math.abs(placed[1].w / placed[2].w - 2) < 1e-9);
  assert.ok(Math.abs(placed[2].x - (placed[1].x + placed[1].w + DECK_PAGE.blockGap)) < 1e-9);
  // With no line at the foot the content runs lower.
  const lower = layoutSlide({ ...slide, caveat: undefined });
  assert.ok(Math.abs((lower[1].y + lower[1].h) - DECK_PAGE.bottom) < 1e-9);
});

test("tiles wrap by perRow, fill the slide when asked, and a figure is never wider than its tile", () => {
  const eight = tiles(8, 4);
  const [box] = layoutSlide({ layout: "content", title: "T", rows: [{ fill: true, blocks: [eight] }] });
  assert.ok(Math.abs(box.h - (DECK_PAGE.bottom - DECK_PAGE.top)) < 1e-9, "a filling row takes the whole height");
  const boxes = tileBoxes(eight, box);
  assert.equal(boxes.length, 8);
  assert.ok(Math.abs(boxes[4].y - (boxes[0].y + boxes[0].h + DECK_PAGE.tileGap)) < 1e-9, "the fifth tile starts the second line");
  assert.ok(Math.abs(boxes[3].x + boxes[3].w - (box.x + box.w)) < 1e-9);
  // Not filling: two lines of tiles are two tile heights and a gap.
  const [plain] = layoutSlide({ layout: "content", title: "T", rows: [{ blocks: [eight] }, { blocks: [{ kind: "card", title: "x", lines: [] }] }] });
  assert.ok(Math.abs(plain.h - (DECK_PAGE.tileH * 2 + DECK_PAGE.tileGap)) < 1e-9);
  // A long figure is written smaller, never under 13 points.
  const tile = { w: 2.3, h: 1.12 };
  assert.ok(tileValueSize("3", tile) > tileValueSize("None measured", tile));
  assert.ok(tileValueSize("£21,911,284", tile) * 0.58 * 11 <= tile.w * 72 - 30 + 1);
  assert.ok(tileValueSize("A very long figure that cannot fit a tile at all", tile) >= 13);
  assert.ok(tileValueSize("3", { w: 3, h: 2.4 }) <= 46);
});

test("tables: how many rows fit, and a list is cut into pages with nothing lost", () => {
  const full = freeHeight(true);
  const fit = tableRowsThatFit(full);
  assert.ok(fit >= 12 && fit <= 16);
  assert.ok(DECK_PAGE.tableHeadH + fit * DECK_PAGE.tableRowH <= full + 1e-9, "the rows that fit do fit");
  assert.equal(tableRowsThatFit(full, true), tableRowsThatFit(full - DECK_PAGE.blockTitleH));
  assert.equal(tableRowsThatFit(0.1), 1);
  const list = Array.from({ length: 31 }, (_, i) => i);
  const cut = pages(list, 14);
  assert.deepEqual(cut.map(p => p.length), [14, 14, 3]);
  assert.deepEqual(cut.flat(), list);
  assert.deepEqual(pages([], 14), [[]]);
  // A long table is cut evenly, so its last slide is not a few stray rows: the same number of slides, nothing lost.
  const even = pagesEven(list, 14);
  assert.deepEqual(even.map(p => p.length), [11, 11, 9]);
  assert.deepEqual(even.flat(), list);
  assert.deepEqual(pagesEven(Array.from({ length: 48 }, (_, i) => i), 15).map(p => p.length), [12, 12, 12, 12]);
  assert.deepEqual(pagesEven(list.slice(0, 14), 14).map(p => p.length), [14]);
  assert.deepEqual(pagesEven([], 14), [[]]);
});

test("a cell is one line: cut with dots when its column is too narrow", () => {
  assert.equal(fitCell("Nando's", 2), "Nando's");
  const cut = fitCell("EVL16 & Adjoining Premises Bluewater - Lower Level, and more", 1.6);
  assert.ok(cut.endsWith("...") && cut.length <= charsPerLine(1.6, 9.5));
  assert.equal(fitCell("  two   spaces ", 3), "two spaces");
  assert.equal(fitCell(null as unknown as string, 2), "");
});

test("words are cut into pages by what fits, at a sentence where there is one, and nothing is lost", () => {
  const paragraphs = ["One. ".repeat(100).trim(), "Two two two. ".repeat(60).trim(), "Short."];
  const cut = pageWords(paragraphs, 500, 900);
  assert.ok(cut.length >= 2);
  assert.equal(cut.flat().join(" ").replace(/\s+/g, " "), paragraphs.join(" ").replace(/\s+/g, " "), "every word is on some page, in order");
  assert.ok(cut[0].join(" ").length <= 500);
  for (const page of cut.slice(1)) assert.ok(page.join(" ").length <= 900);
  assert.ok(cut[0][cut[0].length - 1].endsWith("."), "a page ends at a sentence");
  assert.deepEqual(pageWords(["Short."], 500, 900), [["Short."]]);
  assert.deepEqual(pageWords([], 500, 900), [[]]);
});

test("a chart with nothing to draw is a card that says so, never an empty chart", () => {
  assert.equal(chartHasData(chart([[0, 0, null]])), false);
  assert.equal(chartHasData(chart([[0, 2]])), true);
  assert.equal(chartHasData({ categories: [], series: [] }), false);
  const empty = chartOrCard(chart([[0, 0]]), { title: "Nothing recorded", lines: ["Why."] });
  assert.deepEqual(empty, { kind: "card", title: "Nothing recorded", lines: ["Why."] });
  assert.equal(chartOrCard(chart([[1]]), { title: "x", lines: [] }).kind, "chart");
  // Categories that are nought in every series are left off; a chart that is all nought is left as it is.
  const some = withoutEmptyCategories(chart([[1, 0, 0], [0, 0, 3]]));
  assert.deepEqual(some.categories, ["C0", "C2"]);
  assert.deepEqual(some.series.map(s => s.values), [[1, 0], [0, 3]]);
  assert.deepEqual(withoutEmptyCategories(chart([[0, 0]])).categories, ["C0", "C1"]);
});

test("figures on a bar, the two file formats, and the outline", () => {
  assert.equal(deckValue(1234), "1,234");
  assert.equal(deckValue(4.84, "pct"), "+4.8%");
  assert.equal(deckValue(-10, "pct"), "-10.0%");
  assert.equal(deckValue(1, "days"), "1 day");
  assert.equal(deckValue(40, "days"), "40 days");
  assert.equal(deckValue(3653387.4, "money"), "£3,653,387");
  assert.equal(deckValue(null), "");
  assert.equal(deckFormat(undefined), "pdf");
  assert.equal(deckFormat("PDF"), "pdf");
  assert.equal(deckFormat("pptx"), "pptx");
  assert.equal(deckFormat("powerpoint"), "pptx");
  assert.equal(deckFormat("xlsx"), null);
  assert.equal(DECK_MIME.pptx, "application/vnd.openxmlformats-officedocument.presentationml.presentation");
  assert.deepEqual(deckOutline({ title: "t", subtitle: "s", footer: "f", slides: [{ layout: "title", title: "A", rows: [] }, { layout: "content", title: "B", rows: [] }] }), ["A", "B"]);
});
