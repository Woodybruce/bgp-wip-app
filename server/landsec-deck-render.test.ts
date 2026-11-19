// The two files of a Landsec report deck are the same slides: the PDF and the
// PowerPoint are drawn from one Deck, so they must agree on how many slides
// there are and what each is called, in order. The PowerPoint's charts and
// tables are native (editable), and neither file carries any logo but
// Landsec's.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";
import JSZip from "jszip";
import { PDFArray, PDFDocument, PDFRawStream, decodePDFRawStream } from "pdf-lib";
import { deckPdf } from "./landsec-deck-pdf";
import { deckPptx } from "./landsec-deck-pptx";
import { landsecLogoBytes } from "./landsec-report-logo";
import { DECK_PAGE, DECK_SERIES, deckOutline, type Deck } from "@shared/landsec-deck";
import { parseReportPeriod } from "@shared/landsec-reports";
import { activityDeck } from "@shared/landsec-decks";

const deck: Deck = {
  title: "Landsec Hospitality & Leisure: board report", subtitle: "Aug to Oct 2026",
  footer: "Made in ChatBGP on 19 November 2026 by A Person. It holds what is recorded in ChatBGP on that day.",
  slides: [
    { layout: "title", title: "Landsec Hospitality & Leisure", subtitle: "Board report, Aug to Oct 2026", lines: ["3 schemes: Bluewater, Trinity Leeds, Lucent"], rows: [] },
    { layout: "content", title: "Headlines", subtitle: "Aug to Oct 2026", caveat: "Counted in the period.", rules: ["The rule for lettings, in full.", "The rule for viewings, in full."],
      rows: [{ fill: true, blocks: [{ kind: "tiles", perRow: 2, tiles: [{ label: "Lettings", value: "3" }, { label: "Against ERV", value: "Not held" }, { label: "Passing rent", value: "£21,911,284" }, { label: "Median", value: "None measured" }] }] }] },
    { layout: "content", title: "Live lettings today", rows: [{ widths: [1, 1.7], blocks: [
      { kind: "chart", chart: "bar", title: "By stage", categories: ["Marketing", "Negotiating", "HOTs", "Solicitors"], series: [{ ...DECK_SERIES.one, name: "Live lettings", values: [73, 17, 7, 20] }] },
      { kind: "chart", chart: "stackedBar", title: "By scheme", categories: ["Bluewater", "Trinity Leeds"], series: [
        { ...DECK_SERIES.marketing, values: [12, 14] }, { ...DECK_SERIES.negotiating, values: [3, 1] }, { ...DECK_SERIES.hots, values: [2, 0] }, { ...DECK_SERIES.solicitors, values: [7, 2] }] }] }] },
    { layout: "content", title: "Occupancy today", caveat: "As recorded today.", rows: [{ blocks: [{ kind: "chart", chart: "shareBar", categories: ["Bluewater", "Lucent"], series: [
      { ...DECK_SERIES.occupied, values: [130, 16] }, { ...DECK_SERIES.vacant, values: [63, 18] }, { ...DECK_SERIES.notRecorded, values: [0, 0] }] }] }] },
    { layout: "content", title: "Lease roll", rows: [{ blocks: [{ kind: "chart", chart: "column", categories: ["2026", "2027", "2028"], series: [{ ...DECK_SERIES.expiries, values: [10, 14, 5] }, { ...DECK_SERIES.breaks, values: [5, 6, 0] }] }] }] },
    { layout: "content", title: "Rental growth", rows: [{ blocks: [
      { kind: "chart", chart: "bar", format: "pct", categories: ["Prezzo, Liverpool ONE", "Gail's, Victoria"], series: [{ ...DECK_SERIES.vsPrevious, values: [10, -10] }, { ...DECK_SERIES.vsErv, values: [4.8, null] }] },
      { kind: "card", title: "Not held for 1 of 3 lettings", lines: ["Nothing is estimated."] }] }] },
    { layout: "content", title: "Market report: Hospitality & “quotes” <tags>", rows: [{ blocks: [
      { kind: "words", title: "Hospitality", paragraphs: ["Quick service led demand.", "Casual dining was quieter — but steady."], credit: "Written by A Person (BGP)" },
      { kind: "table", title: "In the news", columns: [{ header: "Date", width: 1 }, { header: "Brand", width: 2 }, { header: "Story", width: 4 }, { header: "Source", width: 1.5, align: "right" }],
        rows: [["9 Sep 2026", "Jersey Mike's", "Jersey Mike's opens first UK restaurant, and a headline long enough that it cannot fit the width of its column on the slide", "ROI-NJ"], ["11 Oct 2026", "Flat Iron", "Flat Iron opens in Birmingham", "propelinfo.com"]] }] }] },
    { layout: "content", title: "Target tenants: furthest on", caveat: "As a Landsec login reads the Brand CRM plan today.", rows: [{ blocks: [{ kind: "table",
      columns: [{ header: "Brand", width: 2 }, { header: "Stage", width: 2.5, steps: 8 }, { header: "Last activity in the period", width: 2 }],
      rows: [["Jersey Mike's", "6:HOTs", "Heads of Terms 16 Oct 2026"], ["Sushidog", "1:Wanted", "None in the period"], ["Gail's", "8:Let", "None in the period"]] }] }] },
    { layout: "content", title: "How the figures are counted", rows: [{ blocks: [{ kind: "words", dense: true, paragraphs: ["Rule one.", "Rule two."] }, { kind: "words", dense: true, paragraphs: ["Rule three."] }] }] },
  ],
};

/** The decoded drawing instructions of each page, as text. */
async function pdfPages(bytes: Uint8Array): Promise<Array<{ width: number; height: number; drawn: string }>> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map(page => {
    const contents = page.node.Contents();
    const streams = contents instanceof PDFArray ? contents.asArray().map(ref => doc.context.lookup(ref)) : [contents];
    const drawn = streams.filter((s): s is PDFRawStream => s instanceof PDFRawStream).map(s => Buffer.from(decodePDFRawStream(s).decode()).toString("latin1")).join("\n");
    return { ...page.getSize(), drawn };
  });
}
// pdf-lib writes text drawn in a standard font as the hex of its WinAnsi codes.
const drawnAs = (words: string): string => Buffer.from(words, "latin1").toString("hex").toUpperCase();
const xmlOf = (words: string): string => words.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const slideXml = async (zip: JSZip, n: number): Promise<string> => zip.file(`ppt/slides/slide${n}.xml`)!.async("string");
const sha = (bytes: Uint8Array | Buffer): string => crypto.createHash("sha256").update(bytes).digest("hex");

test("the PDF and the PowerPoint are the same slides: the same number, the same titles, in order", async () => {
  const pdf = await deckPdf(deck), pptx = await deckPptx(deck);
  const titles = deckOutline(deck);
  // The PDF: one 16:9 page a slide, each with its title drawn on it.
  const pages = await pdfPages(pdf);
  assert.equal(pages.length, titles.length);
  for (const page of pages) assert.deepEqual([Math.round(page.width), Math.round(page.height)], [Math.round(DECK_PAGE.w * 72), Math.round(DECK_PAGE.h * 72)]);
  assert.ok(pages[1].drawn.includes(drawnAs("Headlines")), "the second page is Headlines");
  assert.ok(pages[2].drawn.includes(drawnAs("Live lettings today")));
  assert.ok(pages[8].drawn.includes(drawnAs("How the figures are counted")));
  assert.ok(!pages[1].drawn.includes(drawnAs("Live lettings today")), "a title is on its own page only");
  // The PowerPoint: the same count, and slide n carries title n.
  const zip = await JSZip.loadAsync(pptx);
  const slides = Object.keys(zip.files).filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n));
  assert.equal(slides.length, titles.length);
  for (let i = 0; i < titles.length; i++) {
    const xml = await slideXml(zip, i + 1);
    assert.ok(xml.includes(`<a:t>${xmlOf(titles[i])}</a:t>`), `slide ${i + 1} is "${titles[i]}"`);
    if (i > 0) assert.ok(xml.includes(`<a:t>${i + 1} of ${titles.length}</a:t>`), "and says which slide it is");
  }
  const presentation = await zip.file("ppt/presentation.xml")!.async("string");
  assert.match(presentation, /<p:sldSz cx="12192000" cy="6858000"/, "a 16:9 deck");
});

test("the PowerPoint's charts and tables are native, so they can be edited", async () => {
  const zip = await JSZip.loadAsync(await deckPptx(deck));
  const charts = Object.keys(zip.files).filter(n => /^ppt\/charts\/chart\d+\.xml$/.test(n));
  const blocks = deck.slides.flatMap(s => s.rows.flatMap(r => r.blocks));
  assert.equal(charts.length, blocks.filter(b => b.kind === "chart").length, "one chart part a chart block");
  assert.equal(Object.keys(zip.files).filter(n => /^ppt\/embeddings\/.*\.xlsx$/.test(n)).length, charts.length, "each with its figures in a workbook behind it");
  let tables = 0;
  for (let i = 1; i <= deck.slides.length; i++) tables += ((await slideXml(zip, i)).match(/<a:tbl>/g) || []).length;
  assert.equal(tables, blocks.filter(b => b.kind === "table").length);
  // A cell too long for its column is cut to one line, as in the PDF.
  const market = await slideXml(zip, 7);
  assert.ok(market.includes("ROI-NJ") && /s opens first UK[^<]*\.\.\.<\/a:t>/.test(market) && !market.includes("cannot fit the width"));
  // A stage is a strip of eight small squares, the first few navy and the rest grey, with the word beside it: text, so it can be edited.
  const targets = await slideXml(zip, 8);
  const square = "\u25A0";
  assert.ok(targets.includes(`<a:t>${square.repeat(6)}</a:t>`) && targets.includes(`<a:t>${square.repeat(2)}</a:t>`) && targets.includes("<a:t> HOTs</a:t>"), "six of eight filled for HOTs");
  assert.ok(targets.includes(`<a:t>${square.repeat(1)}</a:t>`) && targets.includes(`<a:t>${square.repeat(7)}</a:t>`) && targets.includes("<a:t> Wanted</a:t>"));
  assert.ok(targets.includes(`<a:t>${square.repeat(8)}</a:t>`) && targets.includes("<a:t> Let</a:t>"), "all eight for Let, and no empty run");
  assert.ok(!targets.includes("6:HOTs"), "the cell's code is never printed");
  // The kinds of chart: stacked, a share of 100%, and columns.
  const xml = await Promise.all(charts.sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0])).map(n => zip.file(n)!.async("string")));
  assert.match(xml[0], /<c:barDir val="bar"\/>[\s\S]*<c:grouping val="clustered"\/>/);
  assert.match(xml[1], /<c:grouping val="stacked"\/>/);
  assert.match(xml[2], /<c:grouping val="percentStacked"\/>/);
  assert.match(xml[3], /<c:barDir val="col"\/>/);
  // A figure inside a stacked bar is white on a dark series and dark on a light one.
  const labels = Array.from(xml[1].matchAll(/<c:ser>[\s\S]*?<c:dLbls>[\s\S]*?<a:srgbClr val="([0-9A-F]{6})"/g)).map(m => m[1]);
  assert.deepEqual(labels, ["141414", "FFFFFF", "141414", "FFFFFF"], "Marketing (pale), Negotiating (blue), HOTs (gold), Solicitors (navy)");
  // Every series is in the Landsec report palette.
  assert.match(xml[1], /<a:srgbClr val="DBE5FE"\/>[\s\S]*<a:srgbClr val="C0B283"\/>[\s\S]*<a:srgbClr val="082862"\/>/);
});

test("the rule behind a slide's figures goes under the slide in the PowerPoint, and the PDF prints the line at the foot", async () => {
  const pdf = await deckPdf(deck), zip = await JSZip.loadAsync(await deckPptx(deck));
  const under = Object.keys(zip.files).filter(n => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(n));
  assert.ok(under.length >= 2);
  const all = (await Promise.all(under.map(n => zip.file(n)!.async("string")))).join("\n");
  assert.ok(all.includes("The rule for lettings, in full.") && all.includes("The rule for viewings, in full.") && all.includes("Counted in the period."));
  const pages = await pdfPages(pdf);
  assert.ok(pages[1].drawn.includes(drawnAs("Counted in the period.")));
  assert.ok(pages[1].drawn.includes(drawnAs("Made in ChatBGP on 19 November 2026 by A Person.")), "the line at the foot is words, and stays");
  // The PDF draws the stage strip as shapes and writes the word, never the cell's code.
  assert.ok(pages[7].drawn.includes(drawnAs("HOTs")) && pages[7].drawn.includes(drawnAs("Wanted")) && !pages[7].drawn.includes(drawnAs("6:HOTs")));
  assert.ok(pages[1].drawn.includes(drawnAs("2 of 9")));
});

test("both files carry Landsec's logo and no other picture", async () => {
  const light = landsecLogoBytes("light"), dark = landsecLogoBytes("dark");
  assert.ok(light && dark, "both logo files are in server/assets");
  const zip = await JSZip.loadAsync(await deckPptx(deck));
  const media = Object.keys(zip.files).filter(n => /^ppt\/media\//.test(n) && !zip.files[n].dir);
  assert.ok(media.length >= 2);
  const allowed = new Set([sha(light!), sha(dark!)]);
  for (const name of media) assert.ok(allowed.has(sha(await zip.file(name)!.async("nodebuffer"))), `${name} is one of Landsec's two logo files`);
  // The PDF embeds the same two images and nothing else.
  const doc = await PDFDocument.load(await deckPdf(deck));
  const images = doc.context.enumerateIndirectObjects().map(([, o]) => o).filter((o): o is PDFRawStream => o instanceof PDFRawStream && /\/Subtype\s*\/Image/.test(o.dict.toString()));
  assert.ok(images.length >= 2 && images.length <= 4, "two logos (each may carry a mask), no other image");
  for (const file of ["BGP_WhiteHolder.png", "BGP_BlackHolder.png"]) {
    const p = `${process.cwd()}/server/assets/${file}`;
    if (fs.existsSync(p)) assert.ok(!allowed.has(sha(fs.readFileSync(p))));
  }
});

test("a composed deck renders to both files with the same outline", async () => {
  const parsed = parseReportPeriod("2026-08", "2026-10");
  assert.ok(parsed.ok);
  const composed = activityDeck({
    period: parsed.period, schemes: [{ key: "bluewater", name: "Bluewater" }, { key: "lucent", name: "Lucent" }], footer: "Made in ChatBGP.",
    rows: Array.from({ length: 20 }, (_, i) => ({ scheme: "Bluewater", unit: `Unit ${i}`, brand: i % 2 ? "Sushidog" : null, deal: null, stage: "Negotiating", stageCode: "NEG", live: true, daysAtStage: 12, daysConfirmed: i % 3 === 0, waitingOn: null, movedInPeriod: null })),
    viewings: [],
  });
  const titles = deckOutline(composed);
  assert.deepEqual(titles, ["Leasing activity", "Live lettings", "Viewings held", "The lettings", "The lettings (continued)"]);
  const pages = await pdfPages(await deckPdf(composed));
  const zip = await JSZip.loadAsync(await deckPptx(composed));
  assert.equal(pages.length, titles.length);
  assert.equal(Object.keys(zip.files).filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n)).length, titles.length);
  for (let i = 0; i < titles.length; i++) {
    assert.ok(pages[i].drawn.includes(drawnAs(titles[i])), `page ${i + 1} is "${titles[i]}"`);
    assert.ok((await slideXml(zip, i + 1)).includes(`<a:t>${xmlOf(titles[i])}</a:t>`), `slide ${i + 1} is "${titles[i]}"`);
  }
});
