import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { isBrandNewsRelevant } from "../../server/brand-news-relevance.ts";
import { publicNewsSourceSql } from "../../server/news-ingestion.ts";

const require = createRequire(import.meta.url);
const { find, evaluate, ts } = require("./source-harness.cjs");
const functionSource = (file, name) => find(file, node => ts.isFunctionDeclaration(node) && node.name?.text === name);
const cook = { id: "cook", brand_company_id: "cook", name: "COOK", company_type: "Tenant", industry: "Food retail", domain: "cookfood.net",
  ai_generated_fields: { brand_identity: { status: "verified", domain: "cookfood.net", aliases: ["COOK Trading Ltd"] } } };
const story = (title, extra = {}) => ({ title, summary: null, url: "https://trade.example/story", source_name: "Trade press", published_at: "2026-10-27", ...extra });

test("AI Lead Finder uses the shared public-source policy, including curated Google feeds and excluding own/social sources", async () => {
  const declaration = find("server/leads.ts", node => ts.isVariableDeclaration(node) && node.name.getText() === "recentNews");
  let query;
  const api = evaluate(`export async function read() { const ${declaration}; return recentNews; }`, {
    publicNewsSourceSql,
    pool: { query: async sql => { query = sql; return { rows: [{ title: "Public trade report" }] }; } },
  });
  assert.equal((await api.read())[0].title, "Public trade report");
  assert.ok(query.includes(publicNewsSourceSql("ns")), "the engine and lead generator must share the same policy");
  assert.match(query, /JOIN news_sources ns ON ns\.id = a\.source_id/);
  assert.match(query, /a\.published_at <= now\(\)/);
  assert.doesNotMatch(query, /NOT IN \([^)]*'google_news'/);
});

test("brand AI summary retains relevant coverage after newer namesake candidates instead of stopping at six raw matches", async () => {
  const candidates = [
    ...Array.from({ length: 8 }, (_, index) => story(`Tim Cook unveils new stores ${index}`)),
    story("Frozen food retailer COOK opens a new shop"),
    story("Thomas Cook opens new stores"),
  ];
  const api = evaluate(`${functionSource("server/brand-ai-take.ts", "loadIntelSlice")}\nexport { loadIntelSlice };`, {
    isBrandNewsRelevant, isBrandSignalRelevant: () => true, publicBrandProviderPayload: () => null,
    brandLegalEvidenceContext: () => ({ needs_review: false }),
    pool: { query: async sql => {
      if (sql.includes("SELECT * FROM crm_companies")) return { rows: [cook] };
      if (sql.includes("FROM news_articles")) return { rows: candidates.slice(0, Number(/LIMIT (\d+)/.exec(sql)?.[1])) };
      return { rows: [] };
    } },
  });
  const data = await api.loadIntelSlice("cook");
  assert.deepEqual(Array.from(data.news_headlines, row => row.title), ["Frozen food retailer COOK opens a new shop"]);
});

test("fortnightly digest includes verified press-only brands and drops namesake-only candidates without sending mail", async () => {
  const gap = { id: "gap", brand_company_id: "gap", name: "GAP", company_type: "Tenant", industry: "Fashion" };
  const queries = [];
  const api = evaluate(`${functionSource("server/brand-digest.ts", "loadDigestData")}\nexport { loadDigestData };`, {
    DIGEST_DAYS: 14, publicNewsSourceSql, isBrandNewsRelevant,
    sendSharedMailboxEmail: () => assert.fail("loading digest data must never send email"),
    pool: { query: async (sql, values) => {
      queries.push(sql);
      if (sql.startsWith("WITH recent_press")) return { rows: [cook, gap] };
      if (sql.includes("FROM brand_signals")) return { rows: [] };
      if (sql.includes("FROM news_articles")) return { rows: values[0] === "%COOK%"
        ? [story("Thomas Cook opens new stores"), story("Frozen food retailer COOK opens a new shop")]
        : [story("A gap in the fashion retail market")] };
      assert.fail(sql);
    } },
  });
  const digest = await api.loadDigestData();
  assert.equal(digest.totalBrands, 1);
  assert.equal(digest.brands[0].name, "COOK");
  assert.equal(digest.brands[0].signals.length, 0);
  assert.equal(digest.brands[0].press[0].title, "Frozen food retailer COOK opens a new shop");
  assert.match(queries[0], /UNION/);
  assert.match(queries[0], /LIMIT 500/);
  assert.ok(queries.filter(sql => sql.includes("FROM news_articles")).every(sql => sql.includes(publicNewsSourceSql("ns"))));
});
