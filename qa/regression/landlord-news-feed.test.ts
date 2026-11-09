import assert from "node:assert/strict";
import test from "node:test";
import { mergeLandlordNewsTabs, type FeedTab, type LandlordNewsArticle } from "../../client/src/lib/landlord-news-feed.ts";

const context = { companyName: "AEW", domain: "aew.com", instagramHandle: "@aew_global" };
const article = (overrides: Partial<LandlordNewsArticle>): LandlordNewsArticle => ({
  id: "article", title: "AEW completes the purchase of Manchester offices", url: "https://www.aew.com/news/manchester", published_at: "2026-10-27", ...overrides,
});
const website: FeedTab = {
  type: "rssapp_web_news", label: "Website news", sourceUrl: "https://www.aew.com/news",
  items: [{ id: "original", title: "AEW completes the purchase of Manchester offices", url: "https://www.aew.com/news/manchester", summary: "Original summary", image_url: null, at: "2026-10-27", type: "rssapp_web_news" }],
};

test("merges press into website news once, preserving connected sources and input data", () => {
  const original = structuredClone(website);
  const result = mergeLandlordNewsTabs([website], [
    article({ id: "tracking", url: "http://aew.com/news/manchester/?utm_source=email&fbclid=tracking#main" }),
    article({ id: "google", title: "AEW completes the purchase of Manchester offices - AEW", url: "https://news.google.com/articles/proxy", source_name: "AEW (Google News)" }),
    article({ id: "different", title: "AEW agrees the purchase of Birmingham offices", url: "https://eu.aew.com/news/birmingham", summary: "The transaction comprises three buildings." }),
  ], context);
  assert.deepEqual(website, original, "merge must not mutate cached query data");
  const merged = result.find(tab => tab.type === "rssapp_web_news")!;
  assert.equal(merged.sourceUrl, website.sourceUrl);
  assert.equal(merged.items.length, 2);
  assert.equal(merged.items[0].summary, "Original summary");
  assert.equal(merged.items[1].publisher, "AEW");
  assert.equal(result.some(tab => tab.type === "landlord_media"), false);
});

test("external coverage retains its publisher, date, summary and destination", () => {
  const result = mergeLandlordNewsTabs([], [article({
    title: "AEW reports the latest quarterly office market figures - Property Week",
    url: "https://news.google.com/articles/coverage", source_name: "AEW (Google News)",
    ai_summary: "Office vacancy fell to 6% in the reported sample.", published_at: "2026-10-20T10:00:00Z",
  })], context);
  const item = result.find(tab => tab.type === "landlord_media")!.items[0];
  assert.equal(item.publisher, "Property Week");
  assert.equal(item.title, "AEW reports the latest quarterly office market figures");
  assert.equal(item.at, "2026-10-20T10:00:00Z");
  assert.equal(item.summary, "Office vacancy fell to 6% in the reported sample.");
  assert.equal(item.url, "https://news.google.com/articles/coverage");
});

test("does not mistake similar names or attacker-controlled domain suffixes for official press", () => {
  const result = mergeLandlordNewsTabs([], [
    article({ id: "other", title: "Coverage from another outlet", url: "https://aew.com.example.org/story", source_name: "AEW Wrestling" }),
    article({ id: "query", title: "A separately sourced report", url: "https://example.org/news?company=aew.com", source_name: "Property Week" }),
    article({ id: "own", title: "Company announcement", url: "https://news.google.com/articles/own", source_name: "AEW — news" }),
  ], context);
  assert.equal(result.find(tab => tab.type === "landlord_media")!.items.length, 3);
  assert.equal(result.some(tab => tab.type === "rssapp_web_news"), false, "a source label alone cannot verify the destination");
});

test("Instagram and LinkedIn stay in their channel tabs, and verified Instagram is available without posts", () => {
  const linkedIn: FeedTab = { type: "rssapp_linkedin", label: "LinkedIn", sourceUrl: "https://www.linkedin.com/company/aew-global", items: [] };
  const result = mergeLandlordNewsTabs([linkedIn], [
    article({ id: "ig", title: "Our team at the conference", url: "https://www.instagram.com/p/officialpost/" }),
    article({ id: "li", title: "European property market research", url: "https://www.linkedin.com/posts/aew-global_research" }),
  ], context);
  assert.equal(result.find(tab => tab.type === "rssapp_instagram")!.sourceUrl, "https://www.instagram.com/aew_global/");
  assert.equal(result.find(tab => tab.type === "rssapp_instagram")!.items.length, 1);
  assert.equal(result.find(tab => tab.type === "rssapp_linkedin")!.sourceUrl, linkedIn.sourceUrl);
  assert.equal(result.find(tab => tab.type === "rssapp_linkedin")!.items.length, 1);
  assert.equal(result.some(tab => tab.type === "landlord_media"), false);
  assert.equal(mergeLandlordNewsTabs([], [], context)[0].sourceUrl, "https://www.instagram.com/aew_global/");
});

test("missing dates and summaries remain missing, while error pages and unsafe links stay out", () => {
  const result = mergeLandlordNewsTabs([], [
    article({ id: "unknown", published_at: null, summary: null }),
    article({ id: "bad-date", title: "AEW expands its asset management team", url: "https://www.aew.com/team", published_at: "not a date", image_url: "javascript:alert(1)" }),
    article({ id: "blocked", title: "Just a moment…", url: "https://aew.com/blocked" }),
    article({ id: "unsafe", url: "javascript:alert(1)" }),
    article({ id: "credentials", url: "https://name:secret@example.org/story" }),
  ], { ...context, instagramHandle: null });
  assert.equal(result.length, 1);
  assert.equal(result[0].items.length, 2);
  for (const item of result[0].items) { assert.equal(item.at, ""); assert.equal(item.summary, null); assert.equal(item.image_url, null); }
});

test("distinct stories with similar headlines and meaningful query IDs remain visible", () => {
  const result = mergeLandlordNewsTabs([], [
    article({ id: "one", title: "Market update", url: "https://aew.com/article?id=1" }),
    article({ id: "two", title: "Market update", url: "https://aew.com/article?id=2" }),
    article({ id: "manchester", title: "AEW completes the purchase of Manchester offices", url: "https://aew.com/manchester" }),
    article({ id: "london", title: "AEW completes the purchase of London offices", url: "https://aew.com/london" }),
  ], { ...context, instagramHandle: null });
  assert.equal(result[0].items.length, 4);
});

test("invalid Instagram handles never generate a profile link", () => {
  for (const instagramHandle of ["https://instagram.com/p/post", "https://instagram.com.evil.test/aew", "p", "javascript:alert(1)", "aew global", ""]) {
    assert.deepEqual(mergeLandlordNewsTabs([], [], { ...context, instagramHandle }), [], instagramHandle);
  }
  assert.equal(mergeLandlordNewsTabs([], [], { ...context, instagramHandle: "https://www.instagram.com/aew_global/" })[0].sourceUrl, "https://www.instagram.com/aew_global/");
});


test("industry tab preserves company coverage priority while own channels remain chronological", () => {
  const tabs = mergeLandlordNewsTabs([], [
    { id: "industry", title: "UK office market investment update", url: "https://propertyweek.com/market", published_at: "2026-10-27", coverage: "industry" },
    { id: "company", title: "AEW announces a new office investment", url: "https://propertyweek.com/aew", published_at: "2026-10-20", coverage: "company" },
    { id: "own-old", title: "Our portfolio update", url: "https://aew.com/news/old", published_at: "2026-10-20", coverage: "company" },
    { id: "own-new", title: "Our latest report", url: "https://aew.com/news/new", published_at: "2026-10-27" },
  ], { companyName: "AEW", domain: "aew.com" });
  assert.deepEqual(tabs.find(tab => tab.type === "landlord_media")?.items.map(item => item.id), ["media-company", "media-industry"]);
  assert.deepEqual(tabs.find(tab => tab.type === "rssapp_web_news")?.items.map(item => item.id), ["media-own-new", "media-own-old"]);
});

test("Landsec search-feed labels do not turn third-party coverage into official Website news", () => {
  const result = mergeLandlordNewsTabs([], [
    { id: "google", title: "Landsec announces its latest retail destination update - Retail Times", url: "https://news.google.com/rss/articles/example", source_name: "Landsec", published_at: "2026-10-27" },
    { id: "publisher", title: "Landsec announces a new letting at Bluewater", url: "https://365retail.co.uk/landsec-bluewater-letting/", source_name: "Landsec", published_at: "2026-10-26" },
    { id: "own", title: "Landsec announces its full-year results", url: "https://www.landsec.com/media/news/results", source_name: "Landsec", published_at: "2026-10-25" },
  ], { companyName: "Landsec", domain: "landsec.com" });
  const media = result.find(tab => tab.type === "landlord_media")!.items;
  assert.equal(media.length, 2);
  assert.equal(media[0].publisher, "Retail Times");
  assert.equal(media[0].title, "Landsec announces its latest retail destination update");
  assert.equal(media[1].publisher, "365retail.co.uk");
  assert.ok(media.every(item => item.coverage === "company"));
  const own = result.find(tab => tab.type === "rssapp_web_news")!.items;
  assert.deepEqual(own.map(item => item.id), ["media-own"]);
  assert.equal(own[0].publisher, "Landsec");
});

test("an official channel's outgoing press link is moved to Industry news without losing the connection", () => {
  const tab: FeedTab = { type: "rssapp_web_news", label: "Website news", sourceUrl: "https://www.landsec.com/media/news", items: [{
    id: "outgoing", title: "Landsec's latest retail update - Retail Times", summary: "A sourced excerpt.", url: "https://news.google.com/rss/articles/coverage", image_url: null, at: "2026-10-27", type: "rssapp_web_news",
  }] };
  const result = mergeLandlordNewsTabs([tab], [], { companyName: "Landsec", domain: "landsec.com" });
  assert.equal(result.find(item => item.type === "rssapp_web_news")?.sourceUrl, tab.sourceUrl);
  assert.equal(result.find(item => item.type === "rssapp_web_news")?.items.length, 0);
  const media = result.find(item => item.type === "landlord_media")!.items[0];
  assert.equal(media.publisher, "Retail Times");
  assert.equal(media.at, "2026-10-27");
  assert.equal(media.summary, "A sourced excerpt.");
  assert.equal(tab.items.length, 1, "cached source data remains unchanged");
});
