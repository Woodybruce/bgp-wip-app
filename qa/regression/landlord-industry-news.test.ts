import { canReadLandlordIndustryNews } from "../../shared/landlord-news.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { handleLandlordIndustryNews, landlordNewsCoverage, landlordResearchArticles, readLandlordNewsEngine, registerLandlordNewsRoutes, selectLandlordIndustryNews } from "../../server/landlord-news.ts";

const company = { id: "test-landlord", name: "AEW", domain: "aew.com", industry: "Real estate investment management" };
const now = Date.parse("2026-10-27T12:00:00Z");
const row = (extra: any = {}) => ({ id: "article", title: "UK commercial property investment volumes increase", url: "https://www.propertyweek.com/market/investment-increases", published_at: "2026-10-26", source_name: "Property Week", ...extra });

test("separates external company coverage from broader industry news without AEW wrestling collisions", () => {
  assert.equal(landlordNewsCoverage(company, row()), "industry");
  assert.equal(landlordNewsCoverage(company, row({ title: "AEW acquires Birmingham offices" })), "company");
  assert.equal(landlordNewsCoverage(company, row({ title: "AEW purchases Manchester asset", url: "https://example.org/article", summary: "The property investment manager has agreed a new lease." })), "company");
  for (const candidate of [
    row({ title: "AEW wrestling announces a stadium show" }),
    row({ title: "AEW Dynamite results", summary: "Wrestling property becomes available" }),
    row({ title: "AEW wins the summer event", url: "https://example.org/sport" }),
    row({ url: "https://www.aew.com/news/official" }),
    row({ url: "https://www.linkedin.com/posts/aew" }),
    row({ source_type: "rssapp_web_news" }),
    row({ title: "Just a moment..." }),
    row({ url: "javascript:alert(1)" }),
    row({ title: "New beauty product launch", ai_summary: "AEW property leasing opportunity" }),
    row({ ai_relevance_scores: { Investment: 10, Leasing: 20 } }),
  ]) assert.equal(landlordNewsCoverage(company, candidate), null, candidate.title);
});

test("industry feed keeps sourced dates, removes stale and duplicate URLs and never invents a date", () => {
  const result = selectLandlordIndustryNews(company, [
    row(), row({ id: "tracking", url: "https://propertyweek.com/market/investment-increases?utm_source=mail" }),
    row({ id: "old", url: "https://propertyweek.com/old", published_at: "2022-01-01" }),
    row({ id: "future", url: "https://propertyweek.com/future", published_at: "2027-01-01" }),
    row({ id: "unknown", url: "https://propertyweek.com/unknown", published_at: null }),
    row({ id: "aew", title: "AEW acquires Birmingham offices", url: "https://propertyweek.com/aew" }),
  ], now);
  assert.equal(result.length, 3);
  assert.equal(result[0].coverage, "company");
  assert.equal(result.find(item => item.id === "unknown")!.published_at, null);
  assert.equal(result.find(item => item.id === "article")!.source_name, "Property Week");
});

test("Perplexity enrichment uses citation metadata only, excluding generated answer claims and URLs", () => {
  const result = landlordResearchArticles(company, {
    answer: JSON.stringify([{ title: "Invented AEW acquisition", url: "https://propertyweek.com/fabricated", date: "2026-10-27" }]), model: "fixture",
    citations: [
      { title: "AEW acquires Birmingham offices", url: "https://www.propertyweek.com/news/aew-birmingham" },
      { title: "European office leasing activity improves", url: "https://reactnews.com/article/offices" },
      { title: "AEW wrestling results", url: "https://propertyweek.com/sports" },
      { title: "UK property market update", url: "https://evil.example/article" },
      { url: "https://propertyweek.com/no-title" },
    ],
    raw: { search_results: [{ url: "https://www.propertyweek.com/news/aew-birmingham", date: "2026-10-25" }] },
  }, now);
  assert.equal(result.length, 2);
  assert.ok(result.every(item => !item.url.includes("fabricated") && item.summary === null));
  assert.equal(result[0].published_at, "2026-10-25T00:00:00.000Z");
  assert.equal(result[1].published_at, null);
});

test("central engine uses separate public company and industry pools, preserving generic industry when names collide", async () => {
  const queries: Array<{ sql: string; params?: any[] }> = [];
  const q = { query: async (sql: string, params?: any[]) => {
    queries.push({ sql, params });
    return { rows: sql.includes("ILIKE $2") ? [row({ title: "AEW wrestling results" })] : [row({ published_at: new Date().toISOString() })] };
  } };
  const result = await readLandlordNewsEngine(company, q);
  assert.equal(queries.length, 2);
  assert.ok(queries.every(query => query.sql.includes("ns.type=ANY($1)") && query.sql.includes("90 days")));
  assert.deepEqual(queries[0].params![0], ["rss", "rssapp", "google_news", "api", "market_landlord", "market_centre", "market_openings"]);
  assert.match(queries[1].sql, /'property','investment'/);
  assert.equal(result.length, 1);
  assert.equal(result[0].coverage, "industry");
});

test("Perplexity Agent search-result metadata and Green Street API articles remain usable", () => {
  const url = "https://greenstreetnews.com/article/aew-acquires-office-building";
  const result = landlordResearchArticles(company, { model: "agent:fast", answer: "Cited research", citations: [{ url, title: "AEW acquires London office building" }], raw: {
    output: [{ type: "web_search_results", results: [{ url, title: "AEW acquires London office building", published_at: "2026-10-24" }] }],
  } }, now);
  assert.equal(result.length, 1);
  assert.equal(result[0].published_at, "2026-10-24T00:00:00.000Z");
  assert.equal(landlordNewsCoverage(company, row({ title: "London office leasing strengthens", source_type: "api", source_name: "Green Street News", url })), "industry");
});

test("routes require authentication and staff/landlord scope before querying articles or searching", async () => {
  const registered: any[][] = [], auth = () => {};
  registerLandlordNewsRoutes({ get: (...args: any[]) => registered.push(args), post: (...args: any[]) => registered.push(args) } as any, auth as any);
  assert.equal(registered.length, 2); assert.ok(registered.every(route => route[1] === auth));
  let status = 200, queries = 0, searches = 0;
  const res: any = { status: (value: number) => { status = value; return res; }, json: () => res };
  const q = { query: async (sql: string) => { queries++; assert.match(sql, /c\.merged_into_id IS NULL/); assert.match(sql, /NOT LIKE 'tenant%'/); return { rows: [] }; } };
  const req: any = { params: { companyId: company.id }, method: "POST" };
  const ask = async () => { searches++; return { answer: "", model: "fixture", citations: [] }; };
  await handleLandlordIndustryNews(req, res, { canRead: async () => false, q, configured: () => true, ask });
  assert.equal(status, 403); assert.equal(queries, 0); assert.equal(searches, 0);
  await handleLandlordIndustryNews(req, res, { canRead: async () => true, q, configured: () => true, ask });
  assert.equal(status, 404); assert.equal(queries, 1); assert.equal(searches, 0);
});

test("opening a landlord only reads existing news; manual refresh stores bounded citation results and reuses the cache", async () => {
  let saved: any = null, searches = 0, body: any; const writes: string[] = [];
  const q = { query: async (sql: string, params?: any[]) => {
    if (sql.includes("FROM crm_companies")) return { rows: [company] };
    if (sql.startsWith("INSERT")) { writes.push(sql); assert.equal(params![0], `landlord-news-research:v1:${company.id}`); saved = JSON.parse(params![1]); return { rows: [] }; }
    return { rows: saved ? [{ value: saved }] : [] };
  } };
  const res: any = { status: () => assert.fail("Unexpected route error"), json: (value: any) => { body = value; } };
  const deps = { canRead: async () => true, q, now: () => now, configured: () => true, engine: async () => [row({ coverage: "industry" })], ask: async (_prompt: string, options: any) => {
    searches++; assert.equal(options.searchRecency, "month"); assert.equal(options.maxTokens, 700); assert.ok(options.searchDomains.includes("propertyweek.com"));
    return { answer: "Do not display this generated answer", citations: [{ title: "AEW acquires Birmingham offices", url: "https://propertyweek.com/news/aew-offices" }], model: "fixture" };
  } };
  await handleLandlordIndustryNews({ method: "GET", params: { companyId: company.id } } as any, res, deps);
  assert.equal(searches, 0); assert.equal(writes.length, 0); assert.equal(body.research.status, "not-run");
  await handleLandlordIndustryNews({ method: "POST", params: { companyId: company.id } } as any, res, deps);
  assert.equal(searches, 1); assert.equal(writes.length, 1); assert.equal(body.research.status, "ready");
  await handleLandlordIndustryNews({ method: "POST", params: { companyId: company.id } } as any, res, deps);
  assert.equal(searches, 1); assert.equal(body.research.cached, true);
  assert.ok(writes.every(sql => sql.includes("system_settings") && !sql.includes("brand_signals") && !sql.includes("crm_companies")));
});

test("Landlord header source links are removed while Brand source and article links remain", () => {
  const source = readFileSync(new URL("../../client/src/components/brand-feed-card.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, />Open source</);
  assert.match(source, /!landlord && current\?\.sourceUrl/);
  assert.match(source, /href=\{item\.url\}/);
  assert.match(source, /enabled: canReadIndustry/);
});


test("industry UI capability requires loaded active staff identity rather than feed setup permission", () => {
  assert.equal(canReadLandlordIndustryNews(undefined), false);
  assert.equal(canReadLandlordIndustryNews({ email: "client@example.com", role: "Client" }), false);
  assert.equal(canReadLandlordIndustryNews({ email: "staff@brucegillinghampollard.com", role: "Staff" }), true);
  assert.equal(canReadLandlordIndustryNews({ email: "staff@brucegillinghampollard.com", companyScopeId: "client" }), false);
  assert.equal(canReadLandlordIndustryNews({ email: "staff@brucegillinghampollard.com", isActive: false }), false);
});

test("old undated research expires on GET without an automatic paid search", async () => {
  let searches = 0, body: any;
  const q = { query: async (sql: string) => ({ rows: sql.includes("FROM crm_companies") ? [company] : [{ value: {
    checkedAt: "2026-09-01T00:00:00Z", items: [row({ id: "old-research", published_at: null })],
  } }] }) };
  await handleLandlordIndustryNews({ method: "GET", params: { companyId: company.id } } as any,
    { status: () => assert.fail("Unexpected route error"), json: (value: any) => { body = value; } } as any,
    { q, canRead: async () => true, configured: () => true, now: () => now, engine: async () => [], ask: async () => { searches++; return { answer: "", model: "fixture", citations: [] }; } });
  assert.equal(searches, 0);
  assert.deepEqual(body.items, []);
  assert.equal(body.research.status, "not-run");
});
