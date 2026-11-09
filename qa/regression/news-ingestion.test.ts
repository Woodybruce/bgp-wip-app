import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { PUBLIC_NEWS_SOURCE_TYPES, publicNewsSourceSql, isPublicNewsSource, canPromotePublicNewsSource, newsArticleUrl, newsPublicationDate, isRssNewsSource,
  greenStreetArticleUrl, singleFlight, forEachNewsItem, newsScoringLimit, validateNewsScores, scoreNewsBatches, newsViewerId } from "../../server/news-ingestion.ts";

const teams = ["Investment", "Leasing"];
const vocabulary = ["retail", "new openings"];
const score = (index: number, extra: any = {}) => ({ index, relevanceScores: { Investment: 72.6, Leasing: 35 }, tags: ["retail"], aiSummary: "The source reports a new letting.", ...extra });

test("public-news policy restores curated topic searches without admitting company/social/private sources", () => {
  for (const type of PUBLIC_NEWS_SOURCE_TYPES) assert.equal(isPublicNewsSource({ type, category: "Property", active: true }), true);
  for (const type of ["rssapp_instagram", "rssapp_linkedin", "rssapp_web_news", "rssapp_web_locations", "rssapp_careers", "email", "private", null]) {
    assert.equal(isPublicNewsSource({ type, active: true }), false, type || "no source");
  }
  assert.equal(isPublicNewsSource({ type: "google_news", category: "brand:company" }), false);
  assert.equal(isPublicNewsSource({ type: "google_news", category: "BRAND:company" }), false);
  assert.equal(isPublicNewsSource({ type: "rss", active: false }), false);
});

test("URLs remove tracking noise for deduplication but retain meaningful article query identifiers", () => {
  const a = newsArticleUrl("https://publisher.example/story?id=23&utm_campaign=a&fbclid=x#comments");
  const b = newsArticleUrl("https://publisher.example/story?utm_source=b&id=23");
  assert.equal(a, b);
  assert.notEqual(a, newsArticleUrl("https://publisher.example/story?id=24"));
  for (const value of ["javascript:alert(1)", "data:text/html,hi", "https://user:pass@publisher.example/story", "http://127.0.0.1:3000/private", "http://192.168.0.1", "http://localhost", "", null]) assert.equal(newsArticleUrl(value), null);
});

test("missing/invalid publication dates stay unknown; alternate source metadata can supply an actual date", () => {
  assert.equal(newsPublicationDate(), null);
  assert.equal(newsPublicationDate(undefined, null, "invalid"), null);
  assert.equal(newsPublicationDate("", "2026-10-20T10:00:00+01:00")?.toISOString(), "2026-10-20T09:00:00.000Z");
  assert.equal(newsPublicationDate("2024-01-01")?.toISOString(), "2024-01-01T00:00:00.000Z");
});

test("Green Street cards need a genuine public reader URL, never an API fallback or publication homepage", () => {
  assert.equal(greenStreetArticleUrl({ gsNewsUrl: "https://greenstreetnews.com/article/test?utm_source=api" }), "https://greenstreetnews.com/article/test");
  for (const article of [
    { gsApiUrl: "https://web-news-service.greenstreet.com/api/articles/1" },
    { gsNewsUrl: "https://web-news-service.greenstreet.com/api/articles/1" },
    { gsNewsUrl: "https://greenstreetnews.com/" },
    { gsNewsUrl: "https://greenstreetnews.com.evil.example/article" },
    { gsNewsUrl: "https://greenstreetnews.com/api/articles/1" },
  ]) assert.equal(greenStreetArticleUrl(article as any), null);
});

test("API sources never enter the XML parser; RSS and social RSS still do", () => {
  assert.equal(isRssNewsSource({ type: "api", feedUrl: "https://provider.example/api" }), false);
  assert.equal(isRssNewsSource({ type: "rssapp_instagram", feedUrl: "https://rss.app/feeds/example.xml" }), true);
  assert.equal(isRssNewsSource({ type: "rss", feedUrl: "https://publisher.example/feed" }), true);
  assert.equal(isRssNewsSource({ type: "rss", feedUrl: null }), false);
});

test("one malformed feed item cannot discard later valid items", async () => {
  const saved: number[] = [], errors: unknown[] = [];
  const count = await forEachNewsItem([1, 2, 3], async item => { if (item === 2) throw new Error("Malformed date"); saved.push(item); }, error => errors.push(error));
  assert.deepEqual(saved, [1, 3]); assert.equal(count, 1); assert.equal(errors.length, 1);
});

test("overlapping manual/startup/scheduled refreshes share one pass, with failures retryable later", async () => {
  const run = singleFlight<number>();
  let calls = 0, release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const task = async () => { calls++; await gate; return 3; };
  const startup = run(task), manual = run(task), scheduled = run(task);
  assert.equal(startup, manual); assert.equal(startup, scheduled);
  await Promise.resolve(); assert.equal(calls, 1); release();
  assert.deepEqual(await Promise.all([startup, manual, scheduled]), [3, 3, 3]);
  await assert.rejects(run(async () => { throw new Error("temporary outage"); }), /temporary outage/);
  assert.equal(await run(async () => 4), 4);
});

test("score validation rejects fabricated indexes, missing teams and out-of-range/non-numeric scores", () => {
  const output = validateNewsScores({ articles: [score(1, { tags: ["retail", "invented tag", "retail"] }), score(1), score(0), score(8), score(2, { relevanceScores: { Investment: 101, Leasing: 2 } }), score(3, { relevanceScores: { Investment: "90", Leasing: 2 } }), score(4, { relevanceScores: { Investment: 75 } })] }, 4, teams, vocabulary);
  assert.equal(output.length, 1); assert.equal(output[0].index, 1);
  assert.deepEqual(output[0].tags, ["retail"]);
  assert.deepEqual(output[0].relevanceScores, { Investment: 73, Leasing: 35 });
});

test("provider outage stops after one batch without falsely marking any article processed", async () => {
  let calls = 0, saved = 0; const errors: unknown[] = [];
  const count = await scoreNewsBatches(Array.from({ length: 100 }, (_, id) => ({ id })), {
    teams, vocabulary, score: async () => { calls++; throw new Error("provider unavailable"); }, save: async () => { saved++; }, onError: e => errors.push(e),
  });
  assert.equal(count, 0); assert.equal(calls, 1); assert.equal(saved, 0); assert.equal(errors.length, 1);
});

test("partial model output saves only validated rows and leaves missing rows for a later pass", async () => {
  let calls = 0; const saved: number[] = [];
  const count = await scoreNewsBatches([0, 1, 2, 3, 4, 5], { teams, vocabulary,
    score: async () => { calls++; return { articles: [score(2), score(3, { relevanceScores: null })] }; },
    save: async article => { saved.push(article); }, onError: () => {},
  });
  assert.equal(count, 1); assert.equal(calls, 1); assert.deepEqual(saved, [1]);
});

test("scoring is capped at 100 articles and 20 provider calls; configuration can lower or disable it", async () => {
  assert.equal(newsScoringLimit(""), 100); assert.equal(newsScoringLimit("1000"), 100);
  assert.equal(newsScoringLimit("25"), 25); assert.equal(newsScoringLimit("0"), 0); assert.equal(newsScoringLimit("bad"), 100);
  let calls = 0, saved = 0;
  const count = await scoreNewsBatches(Array.from({ length: 140 }, (_, id) => id), { teams, vocabulary,
    score: async batch => { calls++; return { articles: batch.map((_, index) => score(index + 1)) }; },
    save: async () => { saved++; }, onError: error => { throw error; },
  });
  assert.equal(count, 100); assert.equal(saved, 100); assert.equal(calls, 20);
});

test("authenticated app token sessions use the same personal saved/dismissed state as web sessions", () => {
  assert.equal(newsViewerId({ tokenUserId: "mobile-person" }), "mobile-person");
  assert.equal(newsViewerId({ session: { userId: "web-person" } }), "web-person");
  assert.equal(newsViewerId({}), null);
  const source = readFileSync(new URL("../../server/news-feeds.ts", import.meta.url), "utf8");
  assert.match(source, /ne\.user_id = \$\{viewerId\} AND ne\.action = 'dismiss'/);
  assert.equal((source.match(/const userId = newsViewerId\(req\)/g) || []).length, 3);
});

test("production refresh/scoring wiring keeps all triggers coalesced and fresh public news prioritised", () => {
  const source = readFileSync(new URL("../../server/news-feeds.ts", import.meta.url), "utf8");
  assert.equal((source.match(/await refreshSharedNews\(\)/g) || []).length, 3);
  assert.match(source, /Promise\.allSettled\(\[fetchRssFeeds\(\), fetchGreenStreetArticles\(\), scoreArticlesWithAI\(\)\]\)/);
  assert.match(source, /interval '14 days'/);
  assert.match(source, /newsArticleTitleFilter\(\), publicNewsArticleFilter\(\)/);
  assert.match(source, /publishedAt: pubDate/);
  assert.doesNotMatch(source, /publishedAt: item\.pubDate \? new Date\(item\.pubDate\) : new Date\(\)/);
  const scoring = source.slice(source.indexOf("async function scoreArticlesWithAI"), source.indexOf("async function extractCompsFromArticles"));
  assert.match(scoring, /\.limit\(cap\)/);
  assert.doesNotMatch(scoring, /catch[\s\S]*processed: true/);
});


test("all general-news consumers can share a safe source policy without raw aliases", () => {
  const sql = publicNewsSourceSql("source");
  assert.match(sql, /source\.active IS NOT FALSE/);
  assert.match(sql, /'google_news'/);
  assert.match(sql, /NOT LIKE 'brand:%'/);
  assert.throws(() => publicNewsSourceSql("ns; DROP TABLE users"), /Invalid/);
});


test("curated duplicates promote only public brand-query provenance and preserve IDs/bookmarks", () => {
  const incoming = { type: "rss", category: "Property", active: true };
  assert.equal(canPromotePublicNewsSource({ type: "google_news", category: "brand:aew" }, incoming), true);
  assert.equal(canPromotePublicNewsSource({ type: "google_news", category: "brand:aew" }, { ...incoming, type: "api" }), true);
  for (const previous of [{ type: "rss", category: "Property" }, { type: "email", category: "private" }, { type: null, category: null }, { type: "rssapp_instagram", category: "brand:aew" }]) {
    assert.equal(canPromotePublicNewsSource(previous, incoming), false);
  }
  assert.equal(canPromotePublicNewsSource({ type: "google_news", category: "brand:aew" }, { ...incoming, active: false }), false);
  assert.equal(canPromotePublicNewsSource({ type: "google_news", category: "brand:aew" }, { ...incoming, type: "google_news", category: "brand:other" }), false);
  const source = readFileSync(new URL("../../server/news-feeds.ts", import.meta.url), "utf8");
  const promotion = source.slice(source.indexOf("async function promotePublicNewsSource"), source.indexOf("const runNewsRefreshOnce"));
  assert.match(promotion, /where\(and\(eq\(newsArticles.id, existing.id\)/);
  assert.match(promotion, /type = 'google_news' AND lower\(category\) LIKE 'brand:%'/, "recheck provenance in the update to avoid overwriting a concurrent public attribution");
  assert.match(promotion, /processed: false, aiRelevanceScores: null/);
  assert.equal((source.match(/await promotePublicNewsSource\(existingArr\[0\]/g) || []).length, 2, "RSS and Green Street duplicates share the same promotion path");
});
