// News that drives requirements: the strong-story rule, the "still live?"
// rule and the readers' checks. No database and no AI call. The list query
// runs on real PostgreSQL in server/requirement-news-postgres.test.ts.
//   node --import tsx --test server/requirement-news.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  strongStory, storyIsRecent, closureStory, stillLiveQuestion, parseStoryRead, checkStoryRead, statedText,
  splitIntoSections, newsletterStoryText, parseReaderItems, signalSource, newsletterPublisher, newsReaderDailyCap, newsStoriesRead,
  EXPANDING_SIGNAL_TYPES, SECTION_CHARS, MAX_SECTIONS, type StoryRead,
} from "./requirement-news";

const NOW = new Date("2026-11-12T10:00:00Z");
const days = (n: number) => new Date(NOW.getTime() + n * 86400000);
const read = (extra: Partial<StoryRead> = {}): StoryRead => ({ sites: null, uk: null, size: null, places: [], timing: null, ...extra });
const story = (extra: Partial<Parameters<typeof strongStory>[0]> = {}) => strongStory({ matched: true, signalType: "opening", sentiment: "positive", read: read({ sites: 20, uk: true }), ...extra });

// ── The strong-story rule ──────────────────────────────────────────────────

test("a matched brand with a stated number of UK sites is a strong story", () => {
  assert.deepEqual(story(), { strong: true, why: "states 20 UK sites", confidence: "high" });
  assert.equal(story({ signalType: "funding" }).strong, true, "whatever the story's type: the type is never changed");
  assert.equal(story({ signalType: "news", read: read({ sites: 2, uk: true }) }).strong, true);
});

test("one site is an opening, not a requirement, and a number with no UK in the story is not enough by itself", () => {
  assert.equal(story({ read: read({ sites: 1, uk: true }) }).strong, false);
  assert.equal(story({ read: read({ sites: 20, uk: null }) }).strong, false);
  assert.equal(story({ read: read({ sites: 20, uk: null }) }).why, "no stated number of UK sites and no stated size or place");
});

test("a stated requirement is strong: a size, named places, or a stated-requirement fact", () => {
  assert.deepEqual(story({ read: read({ size: "2,000 to 3,000 sq ft" }) }), { strong: true, why: "states the space the brand wants", confidence: "medium" });
  assert.deepEqual(story({ read: read({ places: ["Leeds", "York"], uk: true }) }), { strong: true, why: "states the space the brand wants", confidence: "high" });
  assert.deepEqual(story({ signalType: "requirement", read: read() }), { strong: true, why: "a stated requirement", confidence: "medium" });
  assert.equal(story({ signalType: "opening", read: read({ timing: "next year" }) }).strong, false, "a date alone says nothing about the space");
});

test("never strong: an unmatched or new brand, no stated space, a plan abroad, a rumour, a closure", () => {
  assert.equal(story({ matched: false }).strong, false);
  assert.equal(story({ matched: false }).why, "the brand is not matched to a brand in the CRM");
  assert.equal(story({ read: null }).strong, false);
  assert.equal(story({ read: read({ sites: 500, uk: false }) }).strong, false);
  assert.equal(story({ read: read({ places: ["Dubai"], uk: false }) }).strong, false);
  assert.equal(story({ confidence: "rumour" }).strong, false);
  assert.equal(story({ signalType: "rumour" }).strong, false);
  assert.equal(story({ signalType: "closure" }).strong, false);
  assert.equal(story({ sentiment: "negative" }).strong, false);
  assert.equal(story({ confidence: "reported" }).strong, true);
});

test("only a story dated in the last 30 days is ever raised", () => {
  assert.equal(storyIsRecent(days(-1), NOW), true);
  assert.equal(storyIsRecent(days(-30), NOW), true);
  assert.equal(storyIsRecent(days(-31), NOW), false);
  assert.equal(storyIsRecent(days(5), NOW), false, "a planned date in the future is not a publication date");
  assert.equal(storyIsRecent(null, NOW), false);
  assert.equal(storyIsRecent(new Date("nonsense"), NOW), false);
});

// ── What the reader reports, checked against the text ──────────────────────

test("the extra answer is read from a reader's item; no answer means the story states nothing", () => {
  assert.deepEqual(parseStoryRead({ statesSpace: true, sites: "20", uk: true, size: " 2,000 sq ft ", places: ["Leeds", "", 7, "York"], timing: "by 2027" }),
    { sites: 20, uk: true, size: "2,000 sq ft", places: ["Leeds", "7", "York"], timing: "by 2027" });
  assert.deepEqual(parseStoryRead({ states_space: true, sites: null, places: "Leeds" }), read());
  assert.equal(parseStoryRead({ statesSpace: false, sites: 20 }), null);
  assert.equal(parseStoryRead({ statesSpace: "true", sites: 20 }), null);
  assert.equal(parseStoryRead({ sites: 20 }), null);
  assert.equal(parseStoryRead(null), null);
  assert.equal(parseStoryRead({ statesSpace: true, sites: -3 })!.sites, null);
});

test("what the reader reports is kept only where the text itself says it", () => {
  const text = "Pret plans to open 20 new UK shops by 2027, taking units of 1,500 to 2,500 sq ft in Leeds and York.";
  const said = read({ sites: 20, uk: true, size: "1,500 to 2,500 sq ft", places: ["Leeds", "York", "Bath"], timing: "by 2027" });
  assert.deepEqual(checkStoryRead(said, text), { sites: 20, uk: true, size: "1,500 to 2,500 sq ft", places: ["Leeds", "York"], timing: "by 2027" });
  // A number, a size or a date the text does not contain is dropped: the reader may not fill gaps.
  assert.deepEqual(checkStoryRead(read({ sites: 50, size: "5,000 sq ft", places: ["Bath"], timing: "2030" }), text), read());
  assert.equal(checkStoryRead(read({ sites: 20 }), "It opened in 2026 with 120 staff.")!.sites, null, "20 inside 2026 or 120 does not count");
  assert.equal(checkStoryRead(read({ sites: 12 }), "Twelve new sites are planned.")!.sites, 12, "a number written as a word");
  assert.equal(checkStoryRead(read({ sites: 1000 }), "a target of 1,000 stores")!.sites, 1000);
  assert.equal(checkStoryRead(read({ timing: "next year" }), "opening next year in Leeds")!.timing, "next year");
  assert.equal(checkStoryRead(null, text), null);
});

test("the stated figures are written as one line for the signal's detail text", () => {
  assert.equal(statedText(read({ sites: 20, uk: true, size: "2,000 sq ft", places: ["Leeds", "York"], timing: "by 2027" })), "Stated: 20 UK sites; 2,000 sq ft; Leeds, York; by 2027.");
  assert.equal(statedText(read({ sites: 1 })), "Stated: 1 site.");
  assert.equal(statedText(read()), null);
  assert.equal(statedText(null), null);
});

// ── "Still live?" ──────────────────────────────────────────────────────────

test("a closure, CVA or administration story; one small branch closing is not one", () => {
  assert.equal(closureStory({ signalType: "closure", headline: "Byron to close 12 restaurants", magnitude: "large" }), true);
  assert.equal(closureStory({ signalType: "closure", headline: "Byron closes its Leeds branch", magnitude: "small" }), false);
  assert.equal(closureStory({ signalType: "closure", headline: "Byron enters administration", magnitude: "small" }), true);
  assert.equal(closureStory({ signalType: "news", headline: "Byron launches CVA to cut rents", sentiment: "negative" }), true);
  assert.equal(closureStory({ signalType: "funding", headline: "Byron bought out of administration", sentiment: "positive" }), false, "a rescue is not a closure story");
  assert.equal(closureStory({ signalType: "news", headline: "Tariffs from the Trump administration hit Byron", sentiment: "neutral" }), false);
  assert.equal(closureStory({ signalType: "opening", headline: "Byron opens in Leeds" }), false);
});

const closure = { signalType: "closure", headline: "Byron enters administration", magnitude: "large", sentiment: "negative" };

test("a closure story about a brand with a live requirement asks 'still live?' of that requirement", () => {
  assert.deepEqual(stillLiveQuestion({ story: closure, storyDate: days(-1), now: NOW, liveRequirements: [{ id: "r1", lastConfirmedAt: days(-20) }] }),
    { ask: true, requirementId: "r1", why: "a closure story about a brand with a live requirement" });
  // Two live requirements: the reviewer says which.
  assert.deepEqual(stillLiveQuestion({ story: closure, storyDate: days(-1), now: NOW, liveRequirements: [{ id: "r1", lastConfirmedAt: days(-20) }, { id: "r2", lastConfirmedAt: days(-40) }] }).requirementId, null);
});

test("no question: no live requirement, a requirement confirmed after the story, an old or undated story, or not a closure", () => {
  const ask = (extra: Partial<Parameters<typeof stillLiveQuestion>[0]>) => stillLiveQuestion({ story: closure, storyDate: days(-1), now: NOW, liveRequirements: [{ id: "r1", lastConfirmedAt: days(-20) }], ...extra });
  assert.equal(ask({ liveRequirements: [] }).ask, false);
  assert.equal(ask({ liveRequirements: [] }).why, "the brand has no live requirement");
  assert.equal(ask({ liveRequirements: [{ id: "r1", lastConfirmedAt: NOW }] }).why, "the requirement was confirmed after the story");
  assert.deepEqual(ask({ liveRequirements: [{ id: "r1", lastConfirmedAt: NOW }, { id: "r2", lastConfirmedAt: days(-9) }] }).requirementId, "r2", "only the one confirmed before the story is asked about");
  assert.equal(ask({ storyDate: days(-45) }).ask, false);
  assert.equal(ask({ storyDate: null }).ask, false);
  assert.equal(ask({ story: { signalType: "opening", headline: "Byron opens in Leeds" } }).ask, false);
});

test("stories that pass neither rule never reach the database", async () => {
  // No database is configured in this test: these return without importing one.
  const base = { companyId: "c1", knownBrand: true, headline: "Pret opens in Leeds", storyDate: days(-1), sourceLabel: "Propel", storyKey: "k", read: null as StoryRead | null };
  assert.deepEqual(await newsStoriesRead([{ ...base, signalType: "opening" }], NOW), { suggestions: 0, questions: 0 });
  assert.deepEqual(await newsStoriesRead([{ ...base, signalType: "opening", read: read({ sites: 20, uk: true }), storyDate: days(-90) }], NOW), { suggestions: 0, questions: 0 });
  assert.deepEqual(await newsStoriesRead([{ ...base, signalType: "opening", read: read({ sites: 20, uk: true }), knownBrand: false }], NOW), { suggestions: 0, questions: 0 });
  assert.deepEqual(await newsStoriesRead([], NOW), { suggestions: 0, questions: 0 });
});

// ── Reading a long newsletter in sections ──────────────────────────────────

test("a long edition is cut into sections between stories, and nothing is lost before the cap", () => {
  const stories = Array.from({ length: 60 }, (_, i) => `Story ${i + 1}: Operator ${i + 1} is to open ${i + 2} new sites across the UK next year, its chief executive has told Propel. ${"More detail on the plan. ".repeat(12)}`.trim());
  const text = stories.join("\n");
  const sections = splitIntoSections(text);
  assert.ok(sections.length > 1 && sections.length <= MAX_SECTIONS);
  assert.ok(sections.every(s => s.length <= SECTION_CHARS));
  assert.equal(sections.join("\n"), text, "every story is in exactly one section");
  assert.ok(sections.every(s => s.startsWith("Story ")), "each cut falls between stories");
  assert.ok(sections[sections.length - 1].includes("Story 60:"), "the last story is read, where it used to be cut off at 8,000 characters");
  // A short email is one section, read as before.
  assert.deepEqual(splitIntoSections("One short email."), ["One short email."]);
  assert.deepEqual(splitIntoSections(""), []);
  // With no line breaks the cut falls at the end of a sentence, never mid-word.
  const flat = splitIntoSections("Alpha beta gamma. ".repeat(1000), 1000, 3);
  assert.equal(flat.length, 3, "the cap on sections holds");
  assert.ok(flat.every(s => s.endsWith(".") && s.length <= 1000));
});

test("a newsletter's HTML becomes text with one line per paragraph, without styles or scripts", () => {
  const html = `<html><head><style>p { color: red }</style></head><body><!-- preheader --><p>Pret to open   20 sites</p><table><tr><td>Leon</td><td>closes two</td></tr></table><div>Gail's<br>expands</div><script>track()</script></body></html>`;
  assert.equal(newsletterStoryText(html), "Pret to open 20 sites\nLeon closes two\nGail's\nexpands");
  assert.equal(newsletterStoryText("x".repeat(100), 10).length, 10);
  assert.equal(newsletterStoryText(null), "");
});

test("a reply cut off part-way keeps its complete items", () => {
  assert.deepEqual(parseReaderItems('Here you go: [{"brand":"Pret","places":["Leeds"]},{"brand":"Leon"}] done'), [{ brand: "Pret", places: ["Leeds"] }, { brand: "Leon" }]);
  assert.deepEqual(parseReaderItems('[{"brand":"Pret","places":["Leeds"]},{"brand":"Leon","headline":"Leon to op'), [{ brand: "Pret", places: ["Leeds"] }]);
  assert.deepEqual(parseReaderItems("[]"), []);
  assert.equal(parseReaderItems("no json here"), null);
  assert.equal(parseReaderItems('[{"brand":'), null);
});

test("a signal's source in words: a link has its publisher, a newsletter item has no link", () => {
  assert.deepEqual(signalSource("https://www.thecaterer.com/news/pret?utm_source=x", null, null), { label: "thecaterer.com", url: "https://www.thecaterer.com/news/pret" });
  assert.deepEqual(signalSource("https://news.google.com/rss/articles/abc", null, "The Caterer"), { label: "The Caterer", url: "https://news.google.com/rss/articles/abc" });
  assert.deepEqual(signalSource("newsletter:2026-11-12:Propel Morning Briefing", "Via newsletter: Propel Morning Briefing (news@propelinfo.com)"), { label: "Propel", url: null });
  assert.deepEqual(signalSource("newsletter:2026-11-12:Retail round-up", "Via newsletter: Retail round-up (news@retail-week.com)"), { label: "Newsletter: Retail round-up", url: null });
  assert.deepEqual(signalSource(null), { label: null, url: null });
  assert.deepEqual(signalSource("apollo"), { label: "Apollo", url: null });
  assert.equal(newsletterPublisher("paul.charity@propelinfo.com"), "Propel");
  assert.equal(newsletterPublisher("no-reply@email.propertyweek.com"), "Propertyweek newsletter");
  assert.equal(newsletterPublisher(""), "Newsletter");
});

test("the allowance for extra sections: a default, an override, and 0 for the first section only", () => {
  const before = process.env.REQUIREMENT_NEWS_READER_DAILY_CAP;
  try {
    delete process.env.REQUIREMENT_NEWS_READER_DAILY_CAP;
    assert.equal(newsReaderDailyCap(), 150);
    process.env.REQUIREMENT_NEWS_READER_DAILY_CAP = "40";
    assert.equal(newsReaderDailyCap(), 40);
    process.env.REQUIREMENT_NEWS_READER_DAILY_CAP = "0";
    assert.equal(newsReaderDailyCap(), 0);
    process.env.REQUIREMENT_NEWS_READER_DAILY_CAP = "lots";
    assert.equal(newsReaderDailyCap(), 150);
  } finally {
    if (before === undefined) delete process.env.REQUIREMENT_NEWS_READER_DAILY_CAP; else process.env.REQUIREMENT_NEWS_READER_DAILY_CAP = before;
  }
});

// ── The readers keep each story's type, and news never confirms ────────────

test("both readers ask the extra question without touching the story's type, and read through Anthropic only", () => {
  const newsletter = readFileSync(new URL("./news-brand-linking.ts", import.meta.url), "utf8");
  const reader = newsletter.slice(newsletter.indexOf("async function readNewsletterSection"), newsletter.indexOf("export async function ensureBrandGoogleNewsFeeds"));
  assert.match(reader, /"statesSpace": true\|false/);
  assert.match(reader, /"signalType": "opening"\|"closure"\|"funding"\|"exec_change"\|"sector_move"\|"news"/, "the newsletter's type list is unchanged: no requirement type");
  assert.match(reader, /\["opening", "closure", "funding", "exec_change", "sector_move", "news"\]\.includes\(it\.signalType\)/, "the insert still allows only the old types");
  assert.match(reader, /getAnthropicClient\(true\)\.messages\.create/);
  assert.doesNotMatch(reader, /callClaude\(/, "not the switchable provider helper");
  assert.match(reader, /splitIntoSections\(opts\.fullText \|\| opts\.bodyText\)/);
  assert.match(reader, /i > 0 && !\(await claimNewsSection\(\)/, "extra sections are capped per day; the first is read as before");
  assert.match(reader, /if \(!\(process\.env\.ANTHROPIC_API_KEY \|\| process\.env\.AI_INTEGRATIONS_ANTHROPIC_API_KEY\)\) return 0;/, "no key: quiet");

  const nightly = readFileSync(new URL("./expansion-intel.ts", import.meta.url), "utf8");
  assert.match(nightly, /"states_space":true\|false/);
  assert.match(nightly, /a separate answer that never changes "kind"/);
  assert.match(nightly, /const FACT_KINDS = \["opening", "closure", "funding", "requirement", "hiring", "exec_change", "sector_move", "news"\];/);
  assert.match(nightly, /companyId, f\.kind, String\(f\.headline\)/, "the fact is stored under the kind the reader gave it");

  // The feed raises suggestions and nothing else: it never writes a requirement or a confirmation.
  const feed = readFileSync(new URL("./requirement-news.ts", import.meta.url), "utf8");
  const handOver = feed.slice(feed.indexOf("export async function newsStoriesRead"));
  assert.doesNotMatch(handOver, /confirm\(|insertRequirement|updateRequirement|last_confirmed_at\s*=|UPDATE |INSERT /);
  assert.match(handOver, /await suggest\(store/);
  assert.deepEqual([...EXPANDING_SIGNAL_TYPES], ["opening", "funding", "requirement", "hiring"]);
});
