import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { brandResearchSources, sourcedBrandResearchSignals, sourcedBrandResearchAnalysis } from "../../server/brand-research-evidence.ts";
import type { PerplexityResponse } from "../../server/perplexity.ts";

const company = { name: "Example Retail", industry: "Retail", company_type: "Tenant" };
const url = "https://retail-news.example/story/example-london";
const response = (extra: Partial<PerplexityResponse> = {}): PerplexityResponse => ({ model: "fixture", answer: "Generated and not evidence", citations: [{ url, title: "Example Retail confirms a new London store" }], ...extra });
const event = (extra: any = {}) => ({ headline: "Generated claim of 50 stores", detail: "Invented property strategy", signal_type: "opening", source_url: url, signal_date: "2026-10-15", magnitude: "small", sentiment: "positive", ...extra });

test("only provider source metadata can supply a saved headline/excerpt; generated assertions are not persisted", () => {
  const result = sourcedBrandResearchSignals(company, [event()], response());
  assert.equal(result.length, 1);
  assert.equal(result[0].headline, "Example Retail confirms a new London store");
  assert.equal(result[0].detail, null);
  assert.equal(result[0].source_url, url);
  assert.equal(result[0].signal_date, null);
  const analysis = sourcedBrandResearchAnalysis(result)!;
  assert.match(analysis, /Example Retail confirms/);
  assert.doesNotMatch(analysis, /Generated|Invented|50 stores/);
});

test("uncited URLs, unsafe links, root homepages and unrelated company citations are rejected", () => {
  assert.deepEqual(sourcedBrandResearchSignals(company, [event({ source_url: "https://retail-news.example/fabricated" }), event({ source_url: "javascript:alert(1)" })], response()), []);
  assert.deepEqual(brandResearchSources(response({ citations: [{ url: "https://retail-news.example/", title: "Retail news homepage" }, { url: "javascript:alert(1)", title: "Example Retail opens in London" }] })), []);
  assert.deepEqual(sourcedBrandResearchSignals(company, [event()], response({ citations: [{ url, title: "Unrelated Restaurants opens its first London cafe" }] })), []);
  assert.equal(sourcedBrandResearchAnalysis([]), null, "unsupported research must not overwrite existing analysis");
});

test("fuzzy dates and publication timestamps never become an event day", () => {
  const sourced = response({ raw: { search_results: [{ url, title: "Example Retail confirms a new London store", date: "2026-10-15", snippet: "The London store will open in late October 2026." }] } });
  for (const extra of [{}, { date_evidence: "The London store will open in late October 2026." }, { signal_date: "2026-10", date_evidence: "late October 2026" }, { signal_date: "2026-02-30", date_evidence: "2026-02-30" }]) {
    assert.equal(sourcedBrandResearchSignals(company, [event(extra)], sourced)[0].signal_date, null);
  }
});

test("an exact event day is retained only with a matching verbatim source phrase", () => {
  const snippet = "The Example Retail London store opens on 15 October 2026.";
  const sourced = response({ raw: { search_results: [{ url, title: "Example Retail confirms a new London store", snippet }] } });
  assert.equal(sourcedBrandResearchSignals(company, [event({ date_evidence: "opens on 15 October 2026" })], sourced)[0].signal_date, "2026-10-15");
  assert.equal(sourcedBrandResearchSignals(company, [event({ date_evidence: "opens on 16 October 2026" })], sourced)[0].signal_date, null);
  assert.equal(sourcedBrandResearchSignals(company, [event({ signal_date: "2026-10-16", date_evidence: "opens on 15 October 2026" })], sourced)[0].signal_date, null);
});

test("Agent metadata works and repeated/tracking variants of a citation produce one sourced signal", () => {
  const sourced = response({ citations: [], raw: { output: [{ type: "web_search_results", results: [{ url, title: "Example Retail announces a London store", description: "The retailer confirmed its London opening." }] }] } });
  const result = sourcedBrandResearchSignals(company, [event(), event({ source_url: `${url}?utm_source=research` })], sourced);
  assert.equal(result.length, 1);
  assert.equal(result[0].detail, "The retailer confirmed its London opening.");
  assert.deepEqual(sourcedBrandResearchSignals(company, [event({ signal_type: "invented-type" })], sourced), []);
});

test("monthly refresh uses sourced validation and citation-URL dedupe without adding a new research pass", () => {
  const source = readFileSync(new URL("../../server/brand-perplexity-refresh.ts", import.meta.url), "utf8");
  assert.match(source, /sourcedBrandResearchSignals\(brand, events, ppx\)/);
  assert.match(source, /sourcedBrandResearchAnalysis\(sourcedEvents\)/);
  assert.match(source, /headline = \$2 OR source = \$3/);
  assert.doesNotMatch(source, /pick the 15th|\[ppx.answer.trim\(\), brandId\]/);
  assert.equal((source.match(/await askPerplexity\(/g) || []).length, 1);
});
