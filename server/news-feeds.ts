import type { Express, Request, Response } from "express";
import { requireAuth } from "./auth";
import { db } from "./db";
import { newsSources, newsArticles, newsEngagement, teamNewsPreferences, crmProperties, crmComps } from "@shared/schema";
import { eq, desc, sql, and, inArray, gte, isNull } from "drizzle-orm";
import { rssappHealth, createRssAppFeed, deleteRssAppFeed } from "./rssapp";
import { ensureBrandGoogleNewsFeeds, linkRecentArticlesToBrands, backfillSignalClassifications } from "./news-brand-linking";
import { users } from "@shared/schema";
import { callClaude, CHATBGP_HELPER_MODEL, safeParseJSON } from "./utils/anthropic-client";
import { getAppToken, graphRequest } from "./shared-mailbox";
import { getSharePointDriveId } from "./utils/sharepoint-operations";
import { extractTextFromFile } from "./utils/file-extractor";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const DEFAULT_SOURCES = [
  { name: "Property Week", url: "https://www.propertyweek.com", feedUrl: "https://www.propertyweek.com/rss", type: "rss", category: "Property" },
  { name: "Commercial News Media", url: "https://www.commercialnewsmedia.com", feedUrl: "https://www.commercialnewsmedia.com/feed", type: "rss", category: "Property" },
  { name: "Propel Hospitality", url: "https://www.propelhospitality.com", feedUrl: "https://www.propelhospitality.com/rss", type: "rss", category: "Hospitality" },
  { name: "Business of Fashion", url: "https://www.businessoffashion.com", feedUrl: "https://www.businessoffashion.com/feed", type: "rss", category: "Retail" },
  { name: "Retail Gazette", url: "https://www.retailgazette.co.uk", feedUrl: "https://www.retailgazette.co.uk/feed/", type: "rss", category: "Retail" },
  { name: "City AM Property", url: "https://www.cityam.com/category/property/", feedUrl: "https://www.cityam.com/category/property/feed/", type: "rss", category: "Property" },
  { name: "London Property News", url: "https://www.londonpropertynews.co.uk", feedUrl: "https://www.londonpropertynews.co.uk/feed/", type: "rss", category: "Property" },
  { name: "Property Investor Today", url: "https://www.propertyinvestortoday.co.uk", feedUrl: "https://www.propertyinvestortoday.co.uk/rss.xml", type: "rss", category: "Investment" },
  { name: "Drapers", url: "https://www.drapersonline.com", feedUrl: "https://www.drapersonline.com/rss", type: "rss", category: "Retail" },
  { name: "Retail Week", url: "https://www.retailweek.com", feedUrl: "https://www.retailweek.com/feed", type: "rss", category: "Retail" },
  { name: "Reuters Business", url: "https://www.reuters.com/business", feedUrl: "https://feeds.reuters.com/reuters/businessNews", type: "rss", category: "Retail" },
  { name: "The Guardian — Retail", url: "https://www.theguardian.com/business/retail", feedUrl: "https://www.theguardian.com/business/retail/rss", type: "rss", category: "Retail" },
  // Brand / fashion / retail press — added for Tenant Rep + Leasing brand-hunting
  { name: "Vogue Business", url: "https://www.voguebusiness.com", feedUrl: "https://www.voguebusiness.com/feed", type: "rss", category: "Retail" },
  { name: "Highsnobiety", url: "https://www.highsnobiety.com", feedUrl: "https://www.highsnobiety.com/feed/", type: "rss", category: "Retail" },
  // Google News searches for topics without a direct RSS feed
  { name: "Industry of Fashion (Google News)", url: "https://news.google.com/search?q=%22industry+of+fashion%22", feedUrl: "https://news.google.com/rss/search?q=%22industry+of+fashion%22&hl=en-GB&gl=GB&ceid=GB:en", type: "google_news", category: "Retail" },
  { name: "Industry of Beauty (Google News)", url: "https://news.google.com/search?q=%22industry+of+beauty%22", feedUrl: "https://news.google.com/rss/search?q=%22industry+of+beauty%22&hl=en-GB&gl=GB&ceid=GB:en", type: "google_news", category: "Retail" },
  { name: "UK Retail Expansion (Google News)", url: "https://news.google.com/search?q=%22new+store%22+%22UK%22+retail", feedUrl: "https://news.google.com/rss/search?q=%22new+store%22+UK+retail&hl=en-GB&gl=GB&ceid=GB:en", type: "google_news", category: "Retail" },
];

const TEAM_PROFILES: Record<string, { focus: string; keywords: string[] }> = {
  "Investment": {
    focus: "Property investment, capital markets, transactions, yields, returns, acquisitions, disposals",
    keywords: ["investment", "acquisition", "yield", "capital", "transaction", "portfolio", "fund", "IRR", "disposal", "buyer", "seller", "REIT", "valuation"],
  },
  "London F&B": {
    focus: "London food & beverage leasing, restaurant and hospitality lettings, new openings, rent reviews in Belgravia, Mayfair, Chelsea, Knightsbridge, West End. Also: new F&B operators, restaurant concepts, café chains, wellness and hospitality brands expanding into London.",
    keywords: ["restaurant", "café", "bar", "hospitality", "F&B", "food and beverage", "letting", "lease", "tenant", "rent", "Belgravia", "Mayfair", "Chelsea", "Knightsbridge", "West End", "Kensington", "flagship", "new opening", "new restaurant", "first UK restaurant", "brand expansion", "wellness", "operator"],
  },
  "London Retail": {
    focus: "London retail leasing, new lettings and rent reviews for retail units in Belgravia, Mayfair, Chelsea, Knightsbridge, West End. Also: brand expansion, new store openings, flagships, new UK operators, DTC brands opening physical retail, fashion expansion, high street repositioning — these identify prospective tenants for London retail instructions.",
    keywords: ["letting", "lease", "tenant", "rent", "Belgravia", "Mayfair", "Chelsea", "Knightsbridge", "West End", "Kensington", "retail unit", "prime pitch", "flagship", "new opening", "new store", "first UK store", "London flagship", "DTC", "direct to consumer", "digital native", "brand expansion", "new operator", "fashion brand", "brand performance", "global retail"],
  },
  "Lease Advisory": {
    focus: "Lease consultancy, rent reviews, lease renewals, dilapidations, break options, service charges",
    keywords: ["rent review", "lease renewal", "dilapidation", "break clause", "service charge", "arbitration", "lease term", "covenant"],
  },
  "National Leasing": {
    focus: "UK-wide commercial leasing outside London, regional retail and office markets, out-of-town, shopping centres. Also: brand expansion into regional cities, new store openings, flagships, new UK operators, rollout programmes, high street brand activity — these identify prospective tenants for regional instructions.",
    keywords: ["regional", "national", "Birmingham", "Manchester", "Leeds", "Bristol", "Edinburgh", "shopping centre", "retail park", "high street", "provincial", "new opening", "new store", "rollout", "brand expansion", "new operator", "flagship", "global retail", "fashion"],
  },
  "Tenant Rep": {
    focus: "Tenant representation, occupier requirements, search and acquisition, fit-out, relocations. Primary angle: spotting brands that are expanding, opening new stores or flagships, entering new markets (UK / London / US), DTC brands moving into physical retail, strong brand performance, wellness operators, high street repositioning — all are signals of brands who may need an acquiring agent.",
    keywords: ["occupier", "tenant requirement", "relocation", "fit-out", "requirement", "search", "representation", "workspace", "office move", "new opening", "new store", "flagship", "first UK store", "expansion", "entering UK", "DTC", "direct to consumer", "digital native", "brand expansion", "new operator", "wellness", "fashion", "global retail", "brand performance", "high street", "US expansion", "opening in London", "opening in Paris", "opening in New York", "rollout"],
  },
  "Development": {
    focus: "Property development, repurposing, planning applications, construction, change of use, mixed-use schemes",
    keywords: ["development", "planning", "construction", "repurposing", "change of use", "mixed-use", "regeneration", "refurbishment", "conversion"],
  },
};

async function seedNewsSources() {
  const existing = await db.select().from(newsSources);
  const existingNames = new Set(existing.map(s => s.name));
  let added = 0;
  for (const source of DEFAULT_SOURCES) {
    if (!existingNames.has(source.name)) {
      await db.insert(newsSources).values(source);
      added++;
    }
  }
  if (added > 0) console.log(`Seeded ${added} new news sources (${existing.length + added} total)`);
}

async function fetchRssFeeds(): Promise<{ fetched: number; errors: number }> {
  const Parser = (await import("rss-parser")).default;
  const parser = new Parser({
    timeout: 10000,
    headers: {
      "User-Agent": "BGP-Dashboard/1.0",
    },
  });

  const sources = await db.select().from(newsSources).where(eq(newsSources.active, true));
  let fetched = 0;
  let errors = 0;

  for (const source of sources) {
    if (!source.feedUrl) continue;

    try {
      const feed = await parser.parseURL(source.feedUrl);
      const items = feed.items?.slice(0, 20) || [];

      for (const item of items) {
        if (!item.title || !item.link) continue;

        const existingArr = await db.select({ id: newsArticles.id })
          .from(newsArticles)
          .where(eq(newsArticles.url, item.link))
          .limit(1);

        if (existingArr.length > 0) continue;

        let imgUrl = extractImageUrl(item);
        if (!imgUrl && item.link) {
          imgUrl = await fetchOgImage(item.link);
        }

        await db.insert(newsArticles).values({
          sourceId: source.id,
          sourceName: source.name,
          title: item.title,
          summary: item.contentSnippet?.slice(0, 500) || item.content?.slice(0, 500) || null,
          content: item.content || null,
          url: item.link,
          author: item.creator || item.author || null,
          imageUrl: imgUrl,
          publishedAt: item.pubDate ? new Date(item.pubDate) : new Date(),
          category: source.category || "general",
          processed: false,
        });
        fetched++;
      }

      await db.update(newsSources)
        .set({ lastFetchedAt: new Date() })
        .where(eq(newsSources.id, source.id));
    } catch (err: any) {
      console.error(`RSS fetch error for ${source.name}:`, err?.message?.slice(0, 100));
      errors++;
    }
  }

  return { fetched, errors };
}

// Google News RSS image redirects resolve to a Google-hosted logo, not the
// article image. Reject those so we fall back to a publisher favicon.
function isJunkImage(url: string | null | undefined): boolean {
  if (!url) return true;
  return /google\.com|gstatic\.com|googleusercontent\.com\/.*\/proxy/i.test(url);
}

function extractImageUrl(item: any): string | null {
  const pick = (u?: string | null) => (u && !isJunkImage(u) ? u : null);
  const candidates: (string | undefined)[] = [
    item.enclosure?.url,
    item["media:content"]?.url,
    item["media:thumbnail"]?.url,
    item["media:group"]?.["media:content"]?.url,
    item["media:group"]?.["media:thumbnail"]?.url,
  ];
  for (const c of candidates) {
    const v = pick(c);
    if (v) return v;
  }
  const imgMatch = item.content?.match(/<img[^>]+src="([^"]+)"/);
  if (imgMatch && !isJunkImage(imgMatch[1])) return imgMatch[1];
  return null;
}

async function fetchOgImage(url: string): Promise<string | null> {
  // Google News URLs redirect to a stub page with Google's logo as og:image.
  // Skip those — the frontend falls back to a newspaper icon.
  if (/^https?:\/\/(news\.)?google\.com\//i.test(url)) return null;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; BGPNewsBot/1.0)",
        "Accept": "text/html",
      },
      redirect: "follow",
    });
    clearTimeout(timeout);
    if (!resp.ok) return null;
    if (/^https?:\/\/(news\.)?google\.com\//i.test(resp.url)) return null;
    const html = await resp.text();
    const ogMatch = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
    if (ogMatch?.[1] && !isJunkImage(ogMatch[1])) return ogMatch[1];
    const twMatch = html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i);
    if (twMatch?.[1] && !isJunkImage(twMatch[1])) return twMatch[1];
    return null;
  } catch {
    return null;
  }
}

async function backfillMissingImages(): Promise<number> {
  const missing = await db.select({ id: newsArticles.id, url: newsArticles.url })
    .from(newsArticles)
    .where(sql`${newsArticles.imageUrl} IS NULL`)
    .orderBy(desc(newsArticles.publishedAt))
    .limit(30);

  if (missing.length === 0) return 0;
  let updated = 0;

  for (const article of missing) {
    if (!article.url) continue;
    const img = await fetchOgImage(article.url);
    if (img) {
      await db.update(newsArticles)
        .set({ imageUrl: img })
        .where(eq(newsArticles.id, article.id));
      updated++;
    }
    await new Promise(r => setTimeout(r, 500));
  }

  console.log(`[news] Backfilled ${updated}/${missing.length} article images`);
  return updated;
}

async function scoreArticlesWithAI(): Promise<number> {
  const unprocessed = await db.select()
    .from(newsArticles)
    .where(eq(newsArticles.processed, false))
    .limit(20);

  if (unprocessed.length === 0) return 0;

  const prefs = await db.select().from(teamNewsPreferences);
  const prefsMap: Record<string, any> = {};
  for (const p of prefs) {
    prefsMap[p.team] = p;
  }

  let scored = 0;

  const batchSize = 5;
  for (let i = 0; i < unprocessed.length; i += batchSize) {
    const batch = unprocessed.slice(i, i + batchSize);

    const articlesText = batch.map((a, idx) => 
      `Article ${idx + 1}:\nTitle: ${a.title}\nSummary: ${a.summary || "N/A"}\nSource: ${a.sourceName}\nCategory: ${a.category}`
    ).join("\n\n");

    const teamDescriptions = Object.entries(TEAM_PROFILES).map(([team, profile]) => {
      const extraKeywords = prefsMap[team]?.boostedTopics?.join(", ") || "";
      return `${team}: ${profile.focus}${extraKeywords ? `. Additional interests: ${extraKeywords}` : ""}`;
    }).join("\n");

    try {
      const response = await callClaude({
        model: CHATBGP_HELPER_MODEL,
        messages: [
          {
            role: "system",
            content: `You are a news relevance scoring engine for BGP, a London property consultancy. Score each article's relevance (0-100) for each team, generate tags, and write a concise AI summary.

Teams:
${teamDescriptions}

Respond in JSON format:
{
  "articles": [
    {
      "index": 1,
      "relevanceScores": { "Investment": 85, "London Retail": 60, "London F&B": 55, "Lease Advisory": 30, "National Leasing": 20, "Tenant Rep": 45, "Development": 10 },
      "tags": ["retail", "letting", "Mayfair"],
      "aiSummary": "Brief 1-2 sentence summary highlighting why this matters for property professionals"
    }
  ]
}`
          },
          { role: "user", content: articlesText },
        ],
        max_completion_tokens: 2048,
        response_format: { type: "json_object" },
      });

      const content = response.choices[0]?.message?.content;
      if (!content) continue;

      const { safeParseJSON } = await import("./utils/anthropic-client");
      const parsed = safeParseJSON(content);
      if (!parsed.articles) continue;

      for (const scored_article of parsed.articles) {
        const article = batch[scored_article.index - 1];
        if (!article) continue;

        await db.update(newsArticles)
          .set({
            aiRelevanceScores: scored_article.relevanceScores,
            aiTags: scored_article.tags || [],
            aiSummary: scored_article.aiSummary || null,
            processed: true,
          })
          .where(eq(newsArticles.id, article.id));

        scored++;
      }
    } catch (err: any) {
      console.error("AI scoring error:", err?.message?.slice(0, 100));
      for (const article of batch) {
        await db.update(newsArticles)
          .set({ processed: true })
          .where(eq(newsArticles.id, article.id));
      }
    }
  }

  return scored;
}

async function extractCompsFromArticles(): Promise<{ extracted: number; created: number }> {
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
  const recent = await db.select()
    .from(newsArticles)
    .where(and(
      eq(newsArticles.processed, true),
      gte(newsArticles.publishedAt, threeDaysAgo),
    ))
    .orderBy(desc(newsArticles.publishedAt))
    .limit(30);

  if (recent.length === 0) return { extracted: 0, created: 0 };

  const leasingArticles = recent.filter(a => {
    const tags = (a.aiTags || []).map((t: string) => t.toLowerCase());
    const scores = a.aiRelevanceScores as Record<string, number> | null;
    const leasingScore = Math.max(
      (scores?.["London F&B"] || 0),
      (scores?.["London Retail"] || 0),
      (scores?.["National Leasing"] || 0),
      (scores?.["Lease Advisory"] || 0),
      (scores?.["Tenant Rep"] || 0)
    );
    const hasLeasingTag = tags.some((t: string) =>
      ["letting", "lease", "rental", "tenant", "occupier", "rent", "leasing", "lettings"].includes(t)
    );
    return leasingScore >= 40 || hasLeasingTag;
  });

  if (leasingArticles.length === 0) return { extracted: 0, created: 0 };

  const articlesText = leasingArticles.map((a, idx) =>
    `Article ${idx + 1}:\nTitle: ${a.title}\nSource: ${a.sourceName}\nDate: ${a.publishedAt?.toISOString()?.split("T")[0] || "unknown"}\nSummary: ${a.aiSummary || a.summary || "N/A"}\nURL: ${a.url || "N/A"}`
  ).join("\n\n---\n\n");

  let extracted = 0;
  let created = 0;

  try {
    const response = await callClaude({
      model: CHATBGP_HELPER_MODEL,
      messages: [
        { role: "system", content: COMP_EXTRACTION_PROMPT },
        { role: "user", content: `Extract leasing comps from these news articles:\n\n${articlesText}` },
      ],
      max_completion_tokens: 4096,
      response_format: { type: "json_object" },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) return { extracted: 0, created: 0 };

    const parsed = safeParseJSON(content);
    const comps = parsed?.comps || [];
    extracted = comps.length;
    const articleRefs = leasingArticles.map(a => ({ url: a.url, title: a.title }));
    created = await saveExtractedComps(comps, "News", articleRefs);
  } catch (err: any) {
    console.error("[Comp Extract] AI extraction error:", err?.message?.slice(0, 200));
  }

  return { extracted, created };
}

const COMP_EXTRACTION_PROMPT = `You are a leasing comp extraction engine for BGP, a London commercial property consultancy. Analyse the text and extract any concrete leasing transactions (lettings, lease renewals, rent reviews, assignments).

Only extract transactions where you have at least a property name/address AND a tenant or a rent figure. Ignore vague mentions like "several lettings were agreed".

For each transaction found, extract as many of these fields as possible:
- name: property address or name
- tenant: tenant/occupier name
- landlord: landlord name
- transactionType: "Open Market Letting", "Rent Review", "Lease Renewal", "Assignment", "Sub-letting", "Surrender & Re-grant", or "Pre-let"
- useClass: "E(a) Retail", "E(b) F&B", "E(d) Gym/Leisure", "Sui Generis", "E Office", or other
- areaSqft: total floor area in sq ft (number only)
- headlineRent: annual headline rent in £ (number only)
- zoneARate: Zone A rate £ per sq ft (number only)
- overallRate: overall £ per sq ft (number only)
- term: lease term description (e.g. "10 years")
- rentFree: rent free period (e.g. "12 months")
- areaLocation: London area (e.g. "Mayfair", "Soho", "City", "Covent Garden")
- postcode: if mentioned
- completionDate: transaction date (YYYY-MM-DD if known)
- comments: any other useful detail
- sourceArticleIndex: integer — the 1-based article number this comp was extracted from

Respond in JSON:
{
  "comps": [
    { "name": "...", "tenant": "...", "sourceArticleIndex": 1, ... }
  ]
}

If no concrete transactions are found, return { "comps": [] }.`;

async function saveExtractedComps(comps: any[], sourceEvidence: string, articles?: { url: string; title: string }[]): Promise<number> {
  let created = 0;
  const cleanNum = (v: any) => { if (v == null) return null; const n = parseFloat(String(v).replace(/[^0-9.-]/g, "")); return isNaN(n) ? null : String(n); };

  for (const comp of comps) {
    if (!comp.name || (!comp.tenant && !comp.headlineRent)) continue;

    const conditions = [eq(crmComps.name, comp.name)];
    if (comp.tenant) conditions.push(eq(crmComps.tenant, comp.tenant));
    if (comp.postcode) conditions.push(eq(crmComps.postcode, comp.postcode));
    const existing = await db.select({ id: crmComps.id })
      .from(crmComps)
      .where(and(...conditions))
      .limit(1);

    if (existing.length > 0) continue;

    // Derive source URL/title from the article index
    const articleIdx = typeof comp.sourceArticleIndex === "number" ? comp.sourceArticleIndex - 1 : -1;
    const sourceArticle = articles && articleIdx >= 0 && articleIdx < articles.length ? articles[articleIdx] : null;

    await db.insert(crmComps).values({
      name: comp.name,
      tenant: comp.tenant || null,
      landlord: comp.landlord || null,
      transactionType: comp.transactionType || null,
      useClass: comp.useClass || null,
      areaSqft: cleanNum(comp.areaSqft),
      headlineRent: cleanNum(comp.headlineRent),
      zoneARate: cleanNum(comp.zoneARate),
      overallRate: cleanNum(comp.overallRate),
      term: comp.term || null,
      rentFree: comp.rentFree || null,
      areaLocation: comp.areaLocation || null,
      postcode: comp.postcode || null,
      completionDate: comp.completionDate || null,
      comments: comp.comments || null,
      sourceEvidence,
      sourceUrl: sourceArticle?.url || null,
      sourceTitle: sourceArticle?.title || null,
      verified: false,
      createdBy: "AI Auto-Extract",
    });
    created++;
  }
  return created;
}

async function extractCompsFromEmails(): Promise<{ extracted: number; created: number }> {
  let extracted = 0;
  let created = 0;

  try {
    const teamMembers = await db.select({ email: users.email }).from(users);
    const teamEmails = teamMembers
      .map(u => u.email)
      .filter(e => e && e.endsWith("@brucegillinghampollard.com"));

    if (teamEmails.length === 0) return { extracted: 0, created: 0 };

    // Search all-time for comp-related emails — no date restriction.
    // Use Graph $search so we only pull emails that mention these terms rather than
    // fetching everything and filtering client-side.
    const compSearchQuery = encodeURIComponent('"zone a" OR "net effective" OR "ITZA" OR "new letting" OR "rent free" OR "headline rent" OR "comparable" OR "sq ft" OR "psf" OR "lease renewal"');

    const emailTexts: string[] = [];

    for (const email of teamEmails.slice(0, 15)) {
      try {
        const searchPath = `/users/${email}/messages?$search=${compSearchQuery}&$top=50&$select=subject,bodyPreview,from,receivedDateTime&$orderby=receivedDateTime desc`;
        const data = await graphRequest(searchPath);
        const messages = data?.value || [];

        for (const msg of messages) {
          const preview = msg.bodyPreview || "";
          const subject = msg.subject || "";
          // Graph $search already filtered by comp keywords — push all results
          emailTexts.push(
            `Email from ${msg.from?.emailAddress?.name || "Unknown"} (${msg.from?.emailAddress?.address || ""}):\nSubject: ${subject}\nDate: ${msg.receivedDateTime?.split("T")[0] || "unknown"}\nPreview: ${preview.slice(0, 500)}`
          );
        }
      } catch (err: any) {
        console.error(`[Comp Extract] Error reading ${email}:`, err?.message?.slice(0, 100));
      }
    }

    if (emailTexts.length === 0) return { extracted: 0, created: 0 };

    const batchText = emailTexts.slice(0, 50).join("\n\n---\n\n");

    const response = await callClaude({
      model: CHATBGP_HELPER_MODEL,
      messages: [
        { role: "system", content: COMP_EXTRACTION_PROMPT },
        { role: "user", content: `Extract leasing comps from these team emails:\n\n${batchText}` },
      ],
      max_completion_tokens: 4096,
      response_format: { type: "json_object" },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) return { extracted: 0, created: 0 };

    const parsed = safeParseJSON(content);
    const comps = parsed?.comps || [];
    extracted = comps.length;
    created = await saveExtractedComps(comps, "Email");
  } catch (err: any) {
    console.error("[Comp Extract] Email extraction error:", err?.message?.slice(0, 200));
  }

  return { extracted, created };
}

async function extractCompsFromSharePoint(): Promise<{ extracted: number; created: number }> {
  let extracted = 0;
  let created = 0;

  try {
    const token = await getAppToken();
    const driveId = await getSharePointDriveId(token);
    if (!driveId) {
      console.log("[Comp Extract] No SharePoint drive found");
      return { extracted: 0, created: 0 };
    }

    const compsFolderPaths = ["Comps", "Comparables", "Leasing Comps", "Comp Data"];
    let files: any[] = [];

    for (const folderName of compsFolderPaths) {
      try {
        const encoded = encodeURIComponent(folderName);
        const resp = await fetch(`https://graph.microsoft.com/v1.0/drives/${driveId}/root:/${encoded}:/children?$select=id,name,size,lastModifiedDateTime,file&$top=20&$orderby=lastModifiedDateTime desc`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (resp.ok) {
          const data = await resp.json();
          const folderFiles = (data?.value || []).filter((f: any) => f.file);
          files = files.concat(folderFiles.map((f: any) => ({ ...f, driveId })));
          if (folderFiles.length > 0) {
            console.log(`[Comp Extract] Found ${folderFiles.length} files in SharePoint/${folderName}`);
          }
        }
      } catch { }
    }

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const recentFiles = files.filter(f => {
      const modified = new Date(f.lastModifiedDateTime || 0);
      return modified > sevenDaysAgo;
    });

    const supportedExts = [".xlsx", ".xls", ".csv", ".pdf", ".docx", ".doc"];
    const eligibleFiles = recentFiles.filter(f => {
      const ext = path.extname(f.name || "").toLowerCase();
      return supportedExts.includes(ext) && (f.size || 0) < 10 * 1024 * 1024;
    });

    if (eligibleFiles.length === 0) return { extracted: 0, created: 0 };

    for (const file of eligibleFiles.slice(0, 5)) {
      try {
        const downloadResp = await fetch(
          `https://graph.microsoft.com/v1.0/drives/${file.driveId}/items/${file.id}/content`,
          { headers: { Authorization: `Bearer ${token}` }, redirect: "follow" }
        );
        if (!downloadResp.ok) continue;

        const buffer = Buffer.from(await downloadResp.arrayBuffer());
        const tmpFile = path.join(os.tmpdir(), `bgp_comp_${Date.now()}_${file.name}`);
        fs.writeFileSync(tmpFile, buffer);

        try {
          const fileText = await extractTextFromFile(tmpFile, file.name);
          if (!fileText || fileText.length < 50) continue;

          const truncatedText = fileText.slice(0, 8000);

          const response = await callClaude({
            model: CHATBGP_HELPER_MODEL,
            messages: [
              { role: "system", content: COMP_EXTRACTION_PROMPT },
              { role: "user", content: `Extract leasing comps from this file (${file.name}):\n\n${truncatedText}` },
            ],
            max_completion_tokens: 4096,
            response_format: { type: "json_object" },
          });

          const content = response.choices[0]?.message?.content;
          if (content) {
            const parsed = safeParseJSON(content);
            const comps = parsed?.comps || [];
            extracted += comps.length;
            created += await saveExtractedComps(comps, "File");
          }
        } finally {
          try { fs.unlinkSync(tmpFile); } catch { }
        }
      } catch (err: any) {
        console.error(`[Comp Extract] Error processing SharePoint file ${file.name}:`, err?.message?.slice(0, 100));
      }
    }
  } catch (err: any) {
    console.error("[Comp Extract] SharePoint extraction error:", err?.message?.slice(0, 200));
  }

  return { extracted, created };
}

async function updateTeamPreferencesFromEngagement() {
  const teams = Object.keys(TEAM_PROFILES);

  for (const team of teams) {
    const engagements = await db.select({
      articleId: newsEngagement.articleId,
      action: newsEngagement.action,
    })
      .from(newsEngagement)
      .where(eq(newsEngagement.team, team))
      .limit(200);

    if (engagements.length < 5) continue;

    const viewedArticleIds = engagements
      .filter(e => e.action === "click" || e.action === "save")
      .map(e => e.articleId);

    if (viewedArticleIds.length === 0) continue;

    const viewedArticles = await db.select({
      aiTags: newsArticles.aiTags,
      category: newsArticles.category,
    })
      .from(newsArticles)
      .where(inArray(newsArticles.id, viewedArticleIds));

    const tagCounts: Record<string, number> = {};
    for (const a of viewedArticles) {
      if (a.aiTags) {
        for (const tag of a.aiTags) {
          tagCounts[tag] = (tagCounts[tag] || 0) + 1;
        }
      }
      if (a.category) {
        tagCounts[a.category] = (tagCounts[a.category] || 0) + 1;
      }
    }

    const topTopics = Object.entries(tagCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([tag]) => tag);

    const dismissedIds = engagements
      .filter(e => e.action === "dismiss")
      .map(e => e.articleId);

    let mutedTopics: string[] = [];
    if (dismissedIds.length > 0) {
      const dismissedArticles = await db.select({ aiTags: newsArticles.aiTags })
        .from(newsArticles)
        .where(inArray(newsArticles.id, dismissedIds));
      
      const dismissedTagCounts: Record<string, number> = {};
      for (const a of dismissedArticles) {
        if (a.aiTags) {
          for (const tag of a.aiTags) {
            dismissedTagCounts[tag] = (dismissedTagCounts[tag] || 0) + 1;
          }
        }
      }
      mutedTopics = Object.entries(dismissedTagCounts)
        .filter(([, count]) => count >= 3)
        .map(([tag]) => tag);
    }

    const existing = await db.select().from(teamNewsPreferences).where(eq(teamNewsPreferences.team, team)).limit(1);
    if (existing.length > 0) {
      await db.update(teamNewsPreferences)
        .set({ boostedTopics: topTopics, mutedTopics, updatedAt: new Date() })
        .where(eq(teamNewsPreferences.team, team));
    } else {
      await db.insert(teamNewsPreferences).values({
        team,
        keywords: TEAM_PROFILES[team]?.keywords || [],
        boostedTopics: topTopics,
        mutedTopics,
      });
    }
  }
}

const GSN_BASE = "https://web-news-service.greenstreet.com/api";

function getGsnToken(): string | null {
  return process.env.GREEN_STREET_API_TOKEN || null;
}

async function fetchGreenStreetArticles(): Promise<number> {
  const token = getGsnToken();
  if (!token) return 0;

  let fetched = 0;
  try {
    const res = await fetch(`${GSN_BASE}/articles?region=UK&page=1`, {
      headers: { Authorization: `Bearer ${token}`, "User-Agent": "BGP-Dashboard/1.0" },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      console.error(`[Green Street] API error: ${res.status} ${res.statusText}`);
      return 0;
    }
    const data = await res.json() as any;
    const articles = Array.isArray(data) ? data : data.data || data.articles || [];

    const gsSourceArr = await db.select({ id: newsSources.id }).from(newsSources).where(eq(newsSources.name, "Green Street News")).limit(1);
    let sourceId: string;
    if (gsSourceArr.length === 0) {
      const inserted = await db.insert(newsSources).values({
        name: "Green Street News",
        url: "https://greenstreetnews.com",
        feedUrl: `${GSN_BASE}/articles?region=UK`,
        type: "api",
        category: "Property",
        active: true,
      }).returning({ id: newsSources.id });
      sourceId = inserted[0].id;
    } else {
      sourceId = gsSourceArr[0].id;
    }

    for (const article of articles.slice(0, 30)) {
      const articleUrl = article.gsNewsUrl || article.gsApiUrl || `${GSN_BASE}/articles/${article.id}`;
      const existingArr = await db.select({ id: newsArticles.id }).from(newsArticles).where(eq(newsArticles.url, articleUrl)).limit(1);
      if (existingArr.length > 0) continue;

      const imgUrl = article.featuredImage || null;
      await db.insert(newsArticles).values({
        sourceId,
        sourceName: "Green Street News",
        title: article.title || "Untitled",
        summary: article.excerpt?.slice(0, 500) || null,
        content: article.content || article.excerpt || null,
        url: articleUrl,
        author: Array.isArray(article.writers) ? article.writers.join(", ") : null,
        imageUrl: imgUrl,
        publishedAt: article.createdAt ? new Date(article.createdAt) : new Date(),
        category: article.primaryCategory || "Property",
        processed: false,
      });
      fetched++;
    }

    await db.update(newsSources).set({ lastFetchedAt: new Date() }).where(eq(newsSources.id, sourceId));
  } catch (err: any) {
    console.error("[Green Street] Fetch error:", err?.message?.slice(0, 200));
  }
  return fetched;
}

export async function searchGreenStreet(query: string, limit: number = 10): Promise<any> {
  const token = getGsnToken();
  if (!token) return { error: "Green Street API token not configured. Add GREEN_STREET_API_TOKEN to environment secrets." };

  try {
    const url = `${GSN_BASE}/articles?region=UK&keyword=${encodeURIComponent(query)}&page=1`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, "User-Agent": "BGP-Dashboard/1.0" },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      return { error: `Green Street API returned ${res.status}: ${res.statusText}` };
    }
    const data = await res.json() as any;
    const articles = (Array.isArray(data) ? data : data.data || data.articles || []).slice(0, limit);

    return {
      success: true,
      source: "Green Street News",
      query,
      totalFound: articles.length,
      articles: articles.map((a: any) => ({
        id: a.id,
        title: a.title,
        excerpt: a.excerpt?.slice(0, 300),
        url: a.gsNewsUrl || `https://greenstreetnews.com`,
        sectors: Array.isArray(a.sector) ? a.sector.map((s: any) => s.name || s).join(", ") : null,
        regions: Array.isArray(a.region) ? a.region.map((r: any) => r.name || r).join(", ") : null,
        publishedAt: a.createdAt || a.updatedAt,
        writers: Array.isArray(a.writers) ? a.writers.join(", ") : null,
      })),
    };
  } catch (err: any) {
    return { error: `Green Street API error: ${err?.message}` };
  }
}

export function setupNewsFeedRoutes(app: Express) {
  seedNewsSources().catch(console.error);

  app.get("/api/news-feed/sources", requireAuth, async (_req: Request, res: Response) => {
    const sources = await db.select().from(newsSources).orderBy(newsSources.name);
    res.json(sources);
  });

  app.post("/api/news-feed/sources", requireAuth, async (req: Request, res: Response) => {
    try {
      const { name, url, feedUrl, type, category } = req.body;
      if (!name || !url) return res.status(400).json({ message: "Name and URL required" });
      const [source] = await db.insert(newsSources).values({ name, url, feedUrl, type: type || "rss", category: category || "general" }).returning();
      res.json(source);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Create a source using RSS.app — given a page URL, generate an RSS feed
  // via the RSS.app API and save the source with feedUrl filled in.
  app.post("/api/news-feed/sources/rssapp", requireAuth, async (req: Request, res: Response) => {
    try {
      const { url, name, category } = req.body || {};
      if (!url) return res.status(400).json({ message: "URL required" });
      const feed = await createRssAppFeed(url);
      const [source] = await db.insert(newsSources).values({
        name: name || feed.title || url,
        url,
        feedUrl: feed.rss_feed_url,
        type: "rssapp",
        category: category || "general",
        active: true,
      }).returning();
      res.json({ source, rssappFeed: feed });
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed to create RSS.app feed" });
    }
  });

  // Toggle active flag on a source
  app.patch("/api/news-feed/sources/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { active, name, category } = req.body || {};
      const updates: any = {};
      if (typeof active === "boolean") updates.active = active;
      if (typeof name === "string") updates.name = name;
      if (typeof category === "string") updates.category = category;
      if (Object.keys(updates).length === 0) return res.status(400).json({ message: "No updates provided" });
      const [updated] = await db.update(newsSources).set(updates).where(eq(newsSources.id, id)).returning();
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Delete source — if it's an RSS.app-generated feed, also delete on RSS.app side.
  app.delete("/api/news-feed/sources/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const [existing] = await db.select().from(newsSources).where(eq(newsSources.id, id)).limit(1);
      if (!existing) return res.status(404).json({ message: "Not found" });
      if (existing.type === "rssapp" && existing.feedUrl) {
        const m = existing.feedUrl.match(/\/feeds\/([a-zA-Z0-9_-]+)/);
        if (m?.[1]) {
          try { await deleteRssAppFeed(m[1]); } catch (e: any) {
            console.warn("[rssapp] delete failed:", e?.message);
          }
        }
      }
      await db.delete(newsSources).where(eq(newsSources.id, id));
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // RSS.app health probe
  app.get("/api/rssapp/health", requireAuth, async (_req: Request, res: Response) => {
    const health = await rssappHealth();
    res.status(health.ok ? 200 : 503).json(health);
  });

  // Ensure one Google News RSS feed per tracked brand
  app.post("/api/news-feed/ensure-brand-feeds", requireAuth, async (_req: Request, res: Response) => {
    try {
      const result = await ensureBrandGoogleNewsFeeds();
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Re-link existing articles to tracked brands → brand_signals
  app.post("/api/news-feed/link-brands", requireAuth, async (req: Request, res: Response) => {
    try {
      const limit = Number(req.query.limit) || 500;
      const result = await linkRecentArticlesToBrands({ limit });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Backfill AI classification over existing generic "news" brand_signals.
  // Call repeatedly — each run processes up to ?limit=50 rows.
  app.post("/api/news-feed/backfill-signals", requireAuth, async (req: Request, res: Response) => {
    try {
      const limit = Number(req.query.limit) || 50;
      const result = await backfillSignalClassifications({ limit });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/news-feed/fetch", requireAuth, async (_req: Request, res: Response) => {
    try {
      const { fetched, errors } = await fetchRssFeeds();
      const scored = await scoreArticlesWithAI();
      const backfilled = await backfillMissingImages();
      res.json({ fetched, errors, scored, backfilled, message: `Fetched ${fetched} new articles, scored ${scored} with AI, backfilled ${backfilled} images` });
    } catch (err: any) {
      console.error("News fetch error:", err);
      res.status(500).json({ message: "Failed to fetch news" });
    }
  });

  app.get("/api/news-feed/articles", requireAuth, async (req: Request, res: Response) => {
    try {
      const { team, limit: limitStr, search } = req.query;
      const limit = parseInt(limitStr as string) || 50;

      let articles = await db.select()
        .from(newsArticles)
        .orderBy(desc(newsArticles.publishedAt))
        .limit(limit);

      if (search) {
        const searchLower = (search as string).toLowerCase();
        articles = articles.filter(a => 
          a.title.toLowerCase().includes(searchLower) ||
          a.summary?.toLowerCase().includes(searchLower) ||
          a.aiSummary?.toLowerCase().includes(searchLower) ||
          a.sourceName?.toLowerCase().includes(searchLower)
        );
      }

      if (team && team !== "All" && team !== "All Teams") {
        const teamStr = team as string;
        articles = articles.filter(a => {
          const score = (a.aiRelevanceScores as any)?.[teamStr];
          return score === undefined || score === null || score >= 30;
        });
        articles.sort((a, b) => {
          const scoreA = (a.aiRelevanceScores as any)?.[teamStr] || 0;
          const scoreB = (b.aiRelevanceScores as any)?.[teamStr] || 0;
          return scoreB - scoreA;
        });
      }

      res.json(articles);
    } catch (err: any) {
      console.error("News articles error:", err);
      res.status(500).json({ message: "Failed to fetch articles" });
    }
  });

  app.post("/api/news-feed/engage", requireAuth, async (req: Request, res: Response) => {
    try {
      const { articleId, action } = req.body;
      if (!articleId || !action) return res.status(400).json({ message: "articleId and action required" });
      
      const userId = (req.session as any)?.userId || null;
      const user = userId ? await db.select().from(users).where(eq(users.id, userId)).limit(1) : [];
      const team = user[0]?.team || null;

      await db.insert(newsEngagement).values({ articleId, userId, team, action });
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/news-feed/saved", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = (req.session as any)?.userId || null;
      if (!userId) return res.status(401).json({ message: "Not authenticated" });

      const savedEngagements = await db.select({ articleId: newsEngagement.articleId })
        .from(newsEngagement)
        .where(and(eq(newsEngagement.userId, userId), eq(newsEngagement.action, "save")))
        .orderBy(desc(newsEngagement.createdAt));

      const articleIdSet = new Set(savedEngagements.map(e => e.articleId));
      const articleIds = Array.from(articleIdSet);
      if (articleIds.length === 0) return res.json([]);

      const unsavedEngagements = await db.select({ articleId: newsEngagement.articleId })
        .from(newsEngagement)
        .where(and(eq(newsEngagement.userId, userId), eq(newsEngagement.action, "unsave")));
      const unsavedSet = new Set(unsavedEngagements.map(e => e.articleId));

      const filteredIds = articleIds.filter(id => !unsavedSet.has(id));
      if (filteredIds.length === 0) return res.json([]);

      const articles = await db.select()
        .from(newsArticles)
        .where(inArray(newsArticles.id, filteredIds));

      const orderMap = new Map(filteredIds.map((id, idx) => [id, idx]));
      articles.sort((a, b) => (orderMap.get(a.id) ?? 0) - (orderMap.get(b.id) ?? 0));

      res.json(articles);
    } catch (err: any) {
      console.error("Saved articles error:", err);
      res.status(500).json({ message: "Failed to fetch saved articles" });
    }
  });

  app.post("/api/news-feed/unsave", requireAuth, async (req: Request, res: Response) => {
    try {
      const { articleId } = req.body;
      if (!articleId) return res.status(400).json({ message: "articleId required" });

      const userId = (req.session as any)?.userId || null;
      if (!userId) return res.status(401).json({ message: "Not authenticated" });

      const user = await db.select().from(users).where(eq(users.id, userId)).limit(1);
      const team = user[0]?.team || null;

      await db.insert(newsEngagement).values({ articleId, userId, team, action: "unsave" });
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/news-feed/preferences", requireAuth, async (_req: Request, res: Response) => {
    const prefs = await db.select().from(teamNewsPreferences);
    res.json(prefs);
  });

  app.get("/api/properties/:id/news", requireAuth, async (req: Request, res: Response) => {
    try {
      const propertyId = req.params.id;
      const [property] = await db.select().from(crmProperties).where(eq(crmProperties.id, propertyId)).limit(1);
      if (!property) return res.status(404).json({ message: "Property not found" });

      const propertyName = property.name;
      const addr = property.address as any;
      const addressStr = addr?.address || "";

      const dbArticles = await db.select()
        .from(newsArticles)
        .orderBy(desc(newsArticles.publishedAt))
        .limit(200);

      const nameLower = propertyName.toLowerCase();
      const nameWords = nameLower.split(/\s+/).filter((w: string) => w.length > 3);
      const matchedArticles = dbArticles.filter(a => {
        const text = `${a.title} ${a.summary || ""} ${a.aiSummary || ""}`.toLowerCase();
        return text.includes(nameLower) || nameWords.filter((w: string) => text.includes(w)).length >= 2;
      }).slice(0, 10);

      const searchQuery = addressStr
        ? `"${propertyName}" ${addressStr.split(",")[0]} property news`
        : `"${propertyName}" London property news`;

      let webResults: Array<{ title: string; url: string; snippet: string; sourceName: string; publishedAt: string | null; imageUrl: string | null }> = [];
      try {
        const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(searchQuery)}`;
        const searchRes = await fetch(searchUrl, {
          headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
          signal: AbortSignal.timeout(10000),
        });
        const html = await searchRes.text();
        const resultBlocks = html.split(/class="result\s/);
        for (let i = 1; i < resultBlocks.length && webResults.length < 10; i++) {
          const block = resultBlocks[i];
          const titleMatch = block.match(/class="result__a"[^>]*>([^<]+)</);
          const urlMatch = block.match(/class="result__url"[^>]*href="([^"]*)"/) || block.match(/href="\/\/duckduckgo\.com\/l\/\?uddg=([^&"]+)/);
          const snippetMatch = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\//);
          if (titleMatch && urlMatch) {
            let resultUrl = urlMatch[1];
            if (resultUrl.startsWith("//duckduckgo.com/l/?uddg=")) {
              resultUrl = decodeURIComponent(resultUrl.replace("//duckduckgo.com/l/?uddg=", ""));
            } else if (!resultUrl.startsWith("http")) {
              resultUrl = decodeURIComponent(resultUrl.trim());
              if (!resultUrl.startsWith("http")) resultUrl = "https://" + resultUrl;
            }
            try {
              const domain = new URL(resultUrl).hostname.replace("www.", "");
              webResults.push({
                title: titleMatch[1].trim(),
                url: resultUrl,
                snippet: (snippetMatch?.[1] || "").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').trim(),
                sourceName: domain,
                publishedAt: null,
                imageUrl: null,
              });
            } catch {}
          }
        }
      } catch (err: any) {
        console.error("[Property News] Web search error:", err?.message);
      }

      const existingUrls = new Set(matchedArticles.map(a => a.url));
      const dedupedWeb = webResults.filter(r => !existingUrls.has(r.url));

      const combined = [
        ...matchedArticles.map(a => ({
          id: a.id,
          title: a.title,
          url: a.url,
          sourceName: a.sourceName,
          summary: a.aiSummary || a.summary,
          publishedAt: a.publishedAt,
          imageUrl: a.imageUrl,
          source: "database" as const,
        })),
        ...dedupedWeb.map((r, i) => ({
          id: `web-${i}`,
          title: r.title,
          url: r.url,
          sourceName: r.sourceName,
          summary: r.snippet,
          publishedAt: r.publishedAt,
          imageUrl: r.imageUrl,
          source: "web" as const,
        })),
      ];

      res.json({ articles: combined, propertyName, searchQuery });
    } catch (err: any) {
      console.error("[Property News] Error:", err);
      res.status(500).json({ message: "Failed to fetch property news" });
    }
  });

  app.post("/api/news-feed/learn", requireAuth, async (_req: Request, res: Response) => {
    try {
      await updateTeamPreferencesFromEngagement();
      res.json({ success: true, message: "Team preferences updated from engagement data" });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/news-feed/extract-comps", requireAuth, async (req: Request, res: Response) => {
    try {
      const source = (req.query.source as string) || "all";
      let newsResult = { extracted: 0, created: 0 };
      let emailResult = { extracted: 0, created: 0 };
      let spResult = { extracted: 0, created: 0 };

      if (source === "all" || source === "news") {
        newsResult = await extractCompsFromArticles();
      }
      if (source === "all" || source === "email") {
        emailResult = await extractCompsFromEmails();
      }
      if (source === "all" || source === "sharepoint") {
        spResult = await extractCompsFromSharePoint();
      }

      res.json({
        success: true,
        extracted: newsResult.extracted + emailResult.extracted + spResult.extracted,
        created: newsResult.created + emailResult.created + spResult.created,
        sources: {
          news: newsResult,
          email: emailResult,
          sharepoint: spResult,
        },
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  setTimeout(async () => {
    try {
      const backfilled = await backfillMissingImages();
      if (backfilled > 0) console.log(`[News Feed] Startup backfill: ${backfilled} images`);
    } catch (err: any) {
      console.error("[News Feed] Startup backfill error:", err?.message);
    }
  }, 15000);

  setTimeout(async () => {
    try {
      console.log("[News Feed] Startup fetch...");
      try {
        const brandFeeds = await ensureBrandGoogleNewsFeeds();
        if (brandFeeds.created > 0) console.log(`[News Feed] Seeded ${brandFeeds.created} brand Google News feeds (of ${brandFeeds.total} tracked brands)`);
      } catch (e: any) {
        console.warn("[News Feed] brand feed seed failed:", e?.message);
      }
      const { fetched, errors } = await fetchRssFeeds();
      const gsFetched = await fetchGreenStreetArticles();
      if (fetched > 0 || gsFetched > 0) {
        const scored = await scoreArticlesWithAI();
        console.log(`[News Feed] Startup: ${fetched} RSS articles, ${errors} errors, Green Street ${gsFetched}, scored ${scored}`);
      } else {
        console.log(`[News Feed] Startup: no new articles (${errors} errors)`);
      }
      try {
        const linked = await linkRecentArticlesToBrands({ limit: 500 });
        if (linked.linked > 0) console.log(`[News Feed] Linked ${linked.linked} brand signals from ${linked.articles} articles`);
      } catch (e: any) {
        console.warn("[News Feed] brand linking failed:", e?.message);
      }
      const compResult = await extractCompsFromArticles();
      if (compResult.created > 0) {
        console.log(`[Comp Extract] Startup news: ${compResult.extracted} found, ${compResult.created} new comps`);
      }
      const emailCompResult = await extractCompsFromEmails();
      if (emailCompResult.created > 0) {
        console.log(`[Comp Extract] Startup emails: ${emailCompResult.extracted} found, ${emailCompResult.created} new comps`);
      }
      const spCompResult = await extractCompsFromSharePoint();
      if (spCompResult.created > 0) {
        console.log(`[Comp Extract] Startup SharePoint: ${spCompResult.extracted} found, ${spCompResult.created} new comps`);
      }
    } catch (err: any) {
      console.error("[News Feed] Startup fetch error:", err?.message);
    }
  }, 20000);

  setInterval(async () => {
    try {
      console.log("[News Feed] Auto-fetching news...");
      try {
        const brandFeeds = await ensureBrandGoogleNewsFeeds();
        if (brandFeeds.created > 0) console.log(`[News Feed] Auto-seeded ${brandFeeds.created} new brand Google News feeds`);
      } catch {}
      const { fetched, errors } = await fetchRssFeeds();
      const gsFetched = await fetchGreenStreetArticles();
      if (fetched > 0 || gsFetched > 0) {
        const scored = await scoreArticlesWithAI();
        console.log(`[News Feed] Fetched ${fetched} articles, ${errors} errors, Green Street ${gsFetched}, scored ${scored}`);
        const { logActivity } = await import("./activity-logger");
        await logActivity("news-feed", "articles_fetched", `${fetched + gsFetched} articles fetched, ${scored} scored for relevance`, fetched + gsFetched);
      }
      try {
        const linked = await linkRecentArticlesToBrands({ limit: 500 });
        if (linked.linked > 0) console.log(`[News Feed] Auto-linked ${linked.linked} brand signals from ${linked.articles} articles`);
      } catch (e: any) {
        console.warn("[News Feed] brand linking failed:", e?.message);
      }
      await backfillMissingImages();
      await updateTeamPreferencesFromEngagement();
      const compResult = await extractCompsFromArticles();
      if (compResult.created > 0) {
        console.log(`[Comp Extract] Auto news: ${compResult.extracted} found, ${compResult.created} new comps`);
      }
      const emailCompResult = await extractCompsFromEmails();
      if (emailCompResult.created > 0) {
        console.log(`[Comp Extract] Auto emails: ${emailCompResult.extracted} found, ${emailCompResult.created} new comps`);
      }
      const spCompResult = await extractCompsFromSharePoint();
      if (spCompResult.created > 0) {
        console.log(`[Comp Extract] Auto SharePoint: ${spCompResult.extracted} found, ${spCompResult.created} new comps`);
      }
      const totalComps = (compResult.created || 0) + (emailCompResult.created || 0) + (spCompResult.created || 0);
      if (totalComps > 0) {
        const { logActivity } = await import("./activity-logger");
        await logActivity("comp-extract", "comps_extracted", `${totalComps} new comps: ${compResult.created} from news, ${emailCompResult.created} from emails, ${spCompResult.created} from SharePoint`, totalComps);
      }
    } catch (err: any) {
      console.error("[News Feed] Auto-fetch error:", err?.message);
    }
  }, 4 * 60 * 60 * 1000);
}
