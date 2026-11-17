import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkResearchAnswer, figureInQuote, quoteInText, insightCategoryForSector } from "../shared/research-read";

const paper = `UK Retail Parks Q3 2026
Prime retail park yields held at 5.25% in Q3, with investment volumes reaching £1.2bn for the quarter.
Vacancy fell to 4.8% across the UK, the lowest since 2008.`;

test("a figure is kept only when its quote is in the paper and the figure in the quote", () => {
  const r = checkResearchAnswer({
    publisher: "Savills", published: "2026-09", headline: "Retail park yields steady", summary: "Yields held and vacancy fell.",
    facts: [
      { topic: "Prime yield", figure: "5.25%", place: "UK", period: "Q3 2026", quote: "Prime retail park yields held at 5.25% in Q3" },
      { topic: "Volume", figure: "£1.2bn", place: null, period: "Q3 2026", quote: "investment volumes reaching £1.2bn for the quarter" },
      { topic: "Vacancy", figure: "4.5%", place: "UK", period: null, quote: "Vacancy fell to 4.8% across the UK" },
      { topic: "Rent", figure: "£30 psf", place: null, period: null, quote: "Prime rents rose to £30 psf" },
    ],
  }, paper, new Date(Date.UTC(2026, 10, 17)));
  assert.ok(r);
  assert.deepEqual(r!.facts.map((f) => f.figure), ["5.25%", "£1.2bn"]);
  assert.equal(r!.dropped, 2);
  assert.equal(r!.published, "2026-09");
});

test("a published month in the future or malformed is dropped; no headline is no reading", () => {
  const today = new Date(Date.UTC(2026, 10, 17));
  assert.equal(checkResearchAnswer({ headline: "x", summary: "y", published: "2027-03", facts: [] }, paper, today)!.published, null);
  assert.equal(checkResearchAnswer({ headline: "x", summary: "y", published: "Q3 2026", facts: [] }, paper, today)!.published, null);
  assert.equal(checkResearchAnswer({ headline: "", summary: "y" }, paper, today), null);
  assert.equal(checkResearchAnswer(null, paper, today), null);
});

test("quote and figure checks tolerate spacing, case and typographic marks", () => {
  assert.ok(quoteInText("prime  retail park YIELDS held at 5.25%", paper));
  assert.ok(!quoteInText("yields", paper));
  assert.ok(figureInQuote("1,200 sq ft", "a unit of 1200 sq ft"));
  assert.ok(!figureInQuote("no number", "anything 5"));
});

test("a sector maps to an Insights feed category", () => {
  assert.equal(insightCategoryForSector("Office London"), "offices");
  assert.equal(insightCategoryForSector("Retail Parks"), "retail");
  assert.equal(insightCategoryForSector("London Shopping Centre"), "retail");
  assert.equal(insightCategoryForSector("Leisure Schemes"), "leisure");
  assert.equal(insightCategoryForSector("F&B - High Street"), "hospitality");
  assert.equal(insightCategoryForSector("Industrial"), "investment");
});

test("research stays BGP's: staff-only tool, staff-only feed cards, both ChatBGP tool paths", () => {
  const chat = readFileSync(new URL("./chatbgp.ts", import.meta.url), "utf8");
  const blocked = chat.slice(chat.indexOf("export const CLIENT_BLOCKED_TOOLS"), chat.indexOf("]);", chat.indexOf("export const CLIENT_BLOCKED_TOOLS")));
  assert.match(blocked, /"get_market_research"/);
  const raw = chat.slice(chat.indexOf("const RAW_EXECUTOR_TOOLS = new Set(["), chat.indexOf("]);", chat.indexOf("const RAW_EXECUTOR_TOOLS = new Set([")));
  assert.match(raw, /"get_market_research"/, "handleCrmToolCall routes it to the raw executor");
  assert.match(chat, /fnName === "get_market_research"/, "executeCrmToolRaw runs it");
  const feed = readFileSync(new URL("./insights-feed.ts", import.meta.url), "utf8");
  assert.match(feed, /VALUES \(\$1, \$2, \$3, 'staff', 'research', \$4\)/);
  const intel = readFileSync(new URL("./investment-research-intel.ts", import.meta.url), "utf8");
  assert.match(intel, /isClientRequestUser\(req\)/);
  assert.doesNotMatch(intel, /setInterval|cron/i, "reads run on upload or on opening the tab, never on a timer");
});
