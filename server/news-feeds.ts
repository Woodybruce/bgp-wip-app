import type { Express, Request, Response } from "express";
import { requireAuth } from "./auth";
import { db } from "./db";
import { newsSources, newsArticles, newsEngagement, teamNewsPreferences, crmProperties, crmComps, newsTags } from "@shared/schema";
import { DEFAULT_NEWS_TAGS } from "@shared/news-tags";
import { authHeadersForUrl, authCookieStatus, loadPaywallCookies, setPaywallCookie, clearPaywallCookie } from "./auth-cookies";
import { eq, desc, sql, and, inArray, gte, isNull } from "drizzle-orm";
import { rssappHealth, createRssAppFeed, deleteRssAppFeed } from "./rssapp";
import { ensureBrandGoogleNewsFeeds, linkRecentArticlesToBrands, backfillSignalClassifications, previewBrandSocialFeeds, ensureBrandSocialFeeds, previewCuratedInstagramFeeds, ensureCuratedInstagramFeeds, type SocialPlatform } from "./news-brand-linking";
import { users } from "@shared/schema";
import { callClaude, CHATBGP_HELPER_MODEL, safeParseJSON } from "./utils/anthropic-client";
import { getAppToken, graphRequest } from "./shared-mailbox";
import { getSharePointDriveId } from "./utils/sharepoint-operations";
import { extractTextFromFile } from "./utils/file-extractor";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const DEFAULT_SOURCES = [
  // Green Street News — their native /feed/ returns an empty channel even for
  // logged-in subscribers (verified Jul 2026), so headlines come from a Google
  // News site-scope like Property Week below. The subscriber cookie
  // (GREENSTREET_AUTH_COOKIE / News → Sources → Paywall logins) still applies
  // when fetching the article pages themselves — anonymous requests get a
  // ~600-word stub, authenticated ones get the full article.
  { name: "Green Street News (RSS)", url: "https://greenstreetnews.com", feedUrl: "https://news.google.com/rss/search?q=site:greenstreetnews.com&hl=en-GB&gl=GB&ceid=GB:en", type: "google_news", category: "Property" },
  // Property Week — their /rss returns malformed XML ("Invalid character in
  // entity name", unescaped & in URLs) which crashes rss-parser. Same fix as
  // Sourcing Journal below: Google News site-scope, which is clean XML and
  // unwraps the redirect. seedNewsSources heals the existing DB row in place.
  { name: "Property Week", url: "https://www.propertyweek.com", feedUrl: "https://news.google.com/rss/search?q=site:propertyweek.com&hl=en-GB&gl=GB&ceid=GB:en", type: "google_news", category: "Property" },
  { name: "Commercial News Media", url: "https://www.commercialnewsmedia.com", feedUrl: "https://www.commercialnewsmedia.com/feed", type: "rss", category: "Property" },
  { name: "Propel Hospitality", url: "https://www.propelhospitality.com", feedUrl: "https://www.propelhospitality.com/rss", type: "rss", category: "Hospitality" },
  { name: "Business of Fashion", url: "https://www.businessoffashion.com", feedUrl: "https://www.businessoffashion.com/feed", type: "rss", category: "Retail" },
  { name: "Retail Gazette", url: "https://www.retailgazette.co.uk", feedUrl: "https://www.retailgazette.co.uk/feed/", type: "rss", category: "Retail" },
  { name: "City AM Property", url: "https://www.cityam.com/category/property/", feedUrl: "https://www.cityam.com/category/property/feed/", type: "rss", category: "Property" },
  // London Property News removed — the domain no longer resolves (ENOTFOUND
  // on every fetch). The auto-migrate in index.ts deactivates the old DB row.
  { name: "Property Investor Today", url: "https://www.propertyinvestortoday.co.uk", feedUrl: "https://www.propertyinvestortoday.co.uk/rss.xml", type: "rss", category: "Investment" },
  { name: "Drapers", url: "https://www.drapersonline.com", feedUrl: "https://www.drapersonline.com/rss", type: "rss", category: "Retail" },
  { name: "Retail Week", url: "https://www.retailweek.com", feedUrl: "https://www.retailweek.com/feed", type: "rss", category: "Retail" },
  { name: "Modern Retail", url: "https://www.modernretail.co", feedUrl: "https://www.modernretail.co/feed/", type: "rss", category: "Retail" },
  { name: "Glossy", url: "https://www.glossy.co", feedUrl: "https://www.glossy.co/feed/", type: "rss", category: "Retail" },
  // Sourcing Journal — direct /feed/ returns malformed XML ("Invalid character
  // in entity name" — unescaped & in titles) which crashes rss-parser. Google
  // News with a site: scope is reliable and unwraps the redirect.
  { name: "Sourcing Journal", url: "https://sourcingjournal.com", feedUrl: "https://news.google.com/rss/search?q=site:sourcingjournal.com&hl=en-GB&gl=GB&ceid=GB:en", type: "google_news", category: "Retail" },
  { name: "Retail Dive", url: "https://www.retaildive.com", feedUrl: "https://www.retaildive.com/feeds/news/", type: "rss", category: "Retail" },
  { name: "WWD", url: "https://wwd.com", feedUrl: "https://wwd.com/feed/", type: "rss", category: "Retail" },
  { name: "The Industry Beauty", url: "https://www.theindustry.beauty", feedUrl: "https://www.theindustry.beauty/feed/", type: "rss", category: "Retail" },
  { name: "Hospitality Net", url: "https://www.hospitalitynet.org", feedUrl: "https://www.hospitalitynet.org/rss/news.xml", type: "rss", category: "Hospitality" },
  // Big Hospitality — site removed /feed (404). Google News site-scope fallback.
  { name: "Big Hospitality", url: "https://www.bighospitality.co.uk", feedUrl: "https://news.google.com/rss/search?q=site:bighospitality.co.uk&hl=en-GB&gl=GB&ceid=GB:en", type: "google_news", category: "Hospitality" },
  // Harry's curated luxury / fashion / lifestyle list — additions Nov 2026.
  // Condé Nast UK + Gentleman's Journal all return 404 on /feed — switched
  // to Google News site-scope so we still get their coverage.
  { name: "GQ (UK)", url: "https://www.gq-magazine.co.uk", feedUrl: "https://news.google.com/rss/search?q=site:gq-magazine.co.uk&hl=en-GB&gl=GB&ceid=GB:en", type: "google_news", category: "Retail" },
  { name: "Gentleman's Journal", url: "https://www.thegentlemansjournal.com", feedUrl: "https://news.google.com/rss/search?q=site:thegentlemansjournal.com&hl=en-GB&gl=GB&ceid=GB:en", type: "google_news", category: "Retail" },
  { name: "Vogue (UK)", url: "https://www.vogue.co.uk", feedUrl: "https://news.google.com/rss/search?q=site:vogue.co.uk&hl=en-GB&gl=GB&ceid=GB:en", type: "google_news", category: "Retail" },
  { name: "Vogue Runway", url: "https://www.vogue.com", feedUrl: "https://www.vogue.com/feed/rss", type: "rss", category: "Retail" },
  { name: "Reuters Business", url: "https://www.reuters.com/business", feedUrl: "https://feeds.reuters.com/reuters/businessNews", type: "rss", category: "Retail" },
  { name: "The Guardian — Retail", url: "https://www.theguardian.com/business/retail", feedUrl: "https://www.theguardian.com/business/retail/rss", type: "rss", category: "Retail" },
  // Brand / fashion / retail press — added for Tenant Rep + Leasing brand-hunting.
  // Vogue Business /feed → 404, same Condé Nast fix.
  { name: "Vogue Business", url: "https://www.voguebusiness.com", feedUrl: "https://news.google.com/rss/search?q=site:voguebusiness.com&hl=en-GB&gl=GB&ceid=GB:en", type: "google_news", category: "Retail" },
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
  const existingByName = new Map(existing.map(s => [s.name, s]));
  // Heal dead URLs: when DEFAULT_SOURCES has a different feedUrl/type for a
  // name that already exists in the DB (publication killed its RSS, we
  // pointed it at Google News instead), refresh the row in place. Without
  // this step, the original insert from a year ago keeps returning 404
  // forever and the fix here only helps fresh deploys.
  for (const source of DEFAULT_SOURCES) {
    const prev = existingByName.get(source.name);
    if (prev && (prev.feedUrl !== source.feedUrl || prev.type !== source.type)) {
      await db.update(newsSources)
        .set({ feedUrl: source.feedUrl, type: source.type })
        .where(eq(newsSources.id, prev.id));
    }
  }
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
    // rss-parser only exposes namespaced tags it's told about — without
    // this, RSS.app Instagram feeds parsed with NO media:content, so every
    // post ingested imageless (Woody, 2026-08-19: "instagram feeds no
    // images?"). Attributes land under item["media:content"].$ below.
    customFields: {
      item: [
        ["media:content", "media:content"],
        ["media:thumbnail", "media:thumbnail"],
        ["media:group", "media:group"],
      ],
    },
  });

  // Never-fetched sources first, then oldest-fetched: a fetch pass takes
  // ~40 min across ~1,200 feeds and every deploy kills it mid-run — with
  // arbitrary ordering, feeds late in the list (the new brand Instagram
  // ones) could starve for days. This order makes interrupted passes
  // resume where they left off.
  const sources = await db.select().from(newsSources)
    .where(eq(newsSources.active, true))
    .orderBy(sql`${newsSources.lastFetchedAt} ASC NULLS FIRST`);
  let fetched = 0;
  let errors = 0;

  for (const source of sources) {
    if (!source.feedUrl) continue;

    try {
      const feed = await parser.parseURL(source.feedUrl);
      const items = feed.items?.slice(0, 20) || [];

      for (const item of items) {
        if (!item.title || !item.link) continue;

        // Unwrap Google News redirect URLs to the real publisher URL. Done up
        // front so the stored URL is clickable and so og:image extraction has
        // something real to work with. Falls back to the wrapped URL if the
        // resolver fails — better than dropping the article.
        let articleUrl = item.link;
        if (/^https?:\/\/(news\.)?google\.com\//i.test(articleUrl)) {
          const real = await resolveGoogleNewsUrl(articleUrl);
          if (real) articleUrl = real;
        }

        const existingArr = await db.select({ id: newsArticles.id })
          .from(newsArticles)
          .where(eq(newsArticles.url, articleUrl))
          .limit(1);

        if (existingArr.length > 0) continue;

        // URL alone is an unstable dedupe key for Google News items: the
        // stored URL flips between the wrapped RSS form and the unwrapped
        // publisher form (backfillMissingImagesUpTo rewrites it), so the next
        // pass can re-ingest the same story under the other form. Same source
        // + title + published timestamp is the same article either way.
        const pubDate = item.pubDate ? new Date(item.pubDate) : null;
        if (pubDate && !isNaN(pubDate.getTime())) {
          const sameStory = await db.select({ id: newsArticles.id })
            .from(newsArticles)
            .where(and(
              eq(newsArticles.sourceId, source.id),
              eq(newsArticles.title, item.title),
              eq(newsArticles.publishedAt, pubDate),
            ))
            .limit(1);
          if (sameStory.length > 0) continue;
        }

        let imgUrl = extractImageUrl(item);
        if (!imgUrl) {
          imgUrl = await fetchOgImage(articleUrl);
        }
        if (!imgUrl) {
          imgUrl = faviconForUrl(articleUrl);
        }

        await db.insert(newsArticles).values({
          sourceId: source.id,
          sourceName: source.name,
          title: item.title,
          summary: item.contentSnippet?.slice(0, 500) || item.content?.slice(0, 500) || null,
          content: item.content || null,
          url: articleUrl,
          author: item.creator || (item as any).author || null,
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

    // Throttle between feed fetches to keep Google News happy. Without this,
    // hammering ~860 per-brand Google News feeds in sequence triggers their
    // abuse protection (503 partway through the run). 2s for Google News,
    // 250ms for other publishers — keeps a full cron pass under 30 min for
    // the brand-feed bulk plus tiny extra for direct RSS.
    const isGoogle = source.type === "google_news" || /google\.com/i.test(source.feedUrl || "");
    await new Promise(r => setTimeout(r, isGoogle ? 2000 : 250));
  }

  return { fetched, errors };
}

// Backfill images for Instagram posts ingested before the parser knew
// about media:content (2026-08-19 — posts landed imageless or with the
// generic favicon). Re-reads each affected feed and fills image_url by
// article url. Idempotent; capped per run; safe to call every boot.
export async function backfillInstagramImages(limitSources = 40): Promise<{ sources: number; filled: number }> {
  const Parser = (await import("rss-parser")).default;
  const parser = new Parser({
    timeout: 10000,
    customFields: {
      item: [
        ["media:content", "media:content"],
        ["media:thumbnail", "media:thumbnail"],
        ["media:group", "media:group"],
      ],
    },
  });
  const res: any = await db.execute(sql`
    SELECT DISTINCT ns.id, ns.feed_url
      FROM news_sources ns
      JOIN news_articles a ON a.source_id = ns.id
     WHERE ns.type = 'rssapp_instagram' AND ns.feed_url IS NOT NULL
       AND (a.image_url IS NULL OR a.image_url ILIKE '%/s2/favicons%')
     LIMIT ${limitSources}`);
  const rows: any[] = res.rows ?? res;
  let filled = 0;
  for (const s of rows) {
    try {
      const feed = await parser.parseURL(s.feed_url);
      let filledForSrc = 0;
      let sawImage = false;
      for (const item of feed.items || []) {
        if (!item.link) continue;
        const img = extractImageUrl(item);
        if (!img) continue;
        sawImage = true;
        const upd: any = await db.execute(sql`
          UPDATE news_articles SET image_url = ${img}
           WHERE source_id = ${s.id} AND url = ${item.link}
             AND (image_url IS NULL OR image_url ILIKE '%/s2/favicons%')`);
        filledForSrc += Number(upd?.rowCount || 0);
      }
      filled += filledForSrc;
      // Forensics: a source that fills nothing despite feed items tells us
      // WHERE the match breaks — no media parsed, or url mismatch.
      if (!filledForSrc && (feed.items || []).length) {
        const sample: any = await db.execute(sql`SELECT url FROM news_articles WHERE source_id = ${s.id} LIMIT 1`);
        const srow = (sample.rows ?? sample)[0];
        console.log(`[ig-image backfill] 0 filled for source ${s.id}: sawImage=${sawImage} feedLink="${String(feed.items?.[0]?.link || "").slice(0, 80)}" storedUrl="${String(srow?.url || "none").slice(0, 80)}"`);
      }
    } catch (e: any) {
      console.warn(`[ig-image backfill] source ${s.id} failed: ${e?.message}`);
    }
    await new Promise(r => setTimeout(r, 250));
  }
  console.log(`[ig-image backfill] filled ${filled} image(s) across ${rows.length} imageless source(s)`);
  return { sources: rows.length, filled };
}

// ── Real article images for Google News items ──────────────────────────────
// Google News RSS never carries the publisher's image (its redirects serve
// Google logos, which isJunkImage rejects), so brand news rows rendered as
// text-only ("why is that such a problem?" — Woody, 2026-08-19). Resolve the
// publisher URL, read its og:image / twitter:image, store it.
function decodeGoogleNewsUrl(url: string): string | null {
  try {
    const m = url.match(/news\.google\.com\/(?:rss\/)?articles\/([^?/]+)/i);
    if (!m) return null;
    const raw = Buffer.from(m[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("latin1");
    const um = raw.match(/https?:\/\/[\x21-\x7e]{8,500}/);
    if (!um) return null;
    // Trim trailing protobuf bytes that ride along after the URL
    return um[0].replace(/[^\x21-\x7e]+.*$/, "").replace(/[ -].*$/, "");
  } catch {
    return null;
  }
}

async function fetchWithCap(url: string, capBytes = 500_000, timeoutMs = 8000): Promise<string | null> {
  try {
    const r = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36" },
      redirect: "follow",
    });
    if (!r.ok || !r.body) return null;
    const reader = r.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (total < capBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.length;
    }
    reader.cancel().catch(() => {});
    return Buffer.concat(chunks).toString("utf8");
  } catch {
    return null;
  }
}

export async function backfillNewsOgImages(limit = 25): Promise<{ scanned: number; filled: number }> {
  // Raw ensure (no drizzle migration): tried-marker so dead links aren't
  // re-fetched every cycle.
  await db.execute(sql`ALTER TABLE news_articles ADD COLUMN IF NOT EXISTS og_image_tried BOOLEAN DEFAULT false`).catch(() => {});
  const res: any = await db.execute(sql`
    SELECT a.id, a.url
      FROM news_articles a
      JOIN news_sources ns ON ns.id = a.source_id
     WHERE ns.category LIKE 'brand:%' AND ns.type = 'google_news'
       AND a.published_at > now() - interval '60 days'
       AND (a.image_url IS NULL
            OR a.image_url ILIKE '%/s2/favicons%'
            OR a.image_url ~* 'google\\.com|gstatic\\.com|googleusercontent\\.com')
       AND COALESCE(a.og_image_tried, false) = false
     ORDER BY a.published_at DESC
     LIMIT ${limit}`);
  const rows: any[] = res.rows ?? res;
  let filled = 0;
  for (const a of rows) {
    try {
      // Resolve the publisher URL behind the Google redirect
      let target: string | null = /news\.google\.com/i.test(a.url) ? decodeGoogleNewsUrl(a.url) : a.url;
      if (!target) {
        // Fallback: the Google splash page carries the publisher link as a
        // plain anchor for non-JS clients.
        const splash = await fetchWithCap(a.url, 200_000, 6000);
        const hrefs = splash ? [...splash.matchAll(/href="(https?:\/\/[^"]+)"/g)].map((h) => h[1]) : [];
        target = hrefs.find((h) => !/google\.com|gstatic\.com|googleusercontent\.com|w3\.org/i.test(h)) || null;
      }
      let img: string | null = null;
      if (target) {
        const html = await fetchWithCap(target);
        if (html) {
          const og = html.match(/<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image)(?::src)?["'][^>]+content=["']([^"']+)["']/i)
            || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:og:image|twitter:image)(?::src)?["']/i);
          if (og?.[1] && /^https?:\/\//i.test(og[1])) img = og[1];
        }
      }
      if (img) {
        await db.execute(sql`UPDATE news_articles SET image_url = ${img}, og_image_tried = true WHERE id = ${a.id}`);
        filled++;
      } else {
        // Mark tried so a dead link isn't re-fetched every cycle
        await db.execute(sql`UPDATE news_articles SET og_image_tried = true WHERE id = ${a.id}`);
      }
    } catch {
      try { await db.execute(sql`UPDATE news_articles SET og_image_tried = true WHERE id = ${a.id}`); } catch {}
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  if (rows.length) console.log(`[news-og-image] filled ${filled}/${rows.length} article image(s)`);
  return { scanned: rows.length, filled };
}

// Google News RSS image redirects resolve to a Google-hosted logo, not the
// article image. Reject those so we fall back to a publisher favicon.
function isJunkImage(url: string | null | undefined): boolean {
  if (!url) return true;
  return /google\.com|gstatic\.com|googleusercontent\.com\/.*\/proxy/i.test(url);
}

function extractImageUrl(item: any): string | null {
  const pick = (u?: string | null) => (u && !isJunkImage(u) ? u : null);
  // rss-parser puts XML attributes under `$` — media:content's url lives at
  // item["media:content"].$.url (and arrays when a post has several images).
  const mediaUrl = (node: any): string | undefined => {
    if (!node) return undefined;
    const n = Array.isArray(node) ? node[0] : node;
    return n?.url || n?.$?.url;
  };
  const candidates: (string | undefined)[] = [
    item.enclosure?.url,
    mediaUrl(item["media:content"]),
    mediaUrl(item["media:thumbnail"]),
    mediaUrl(item["media:group"]?.["media:content"]),
    mediaUrl(item["media:group"]?.["media:thumbnail"]),
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
        ...authHeadersForUrl(url),
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

// Publisher favicon fallback. When og:image extraction fails we use a high-res
// favicon as a thumbnail so cards aren't blank. Better than nothing — the user
// at least sees the source.
function faviconForUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (/google\.com|gstatic\.com|googleusercontent\.com/i.test(u.hostname)) return null;
    // Google's s2 favicons endpoint returns higher-res icons than scraping
    // /favicon.ico directly. Used for the news-card thumbnail fallback only.
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(u.hostname)}&sz=128`;
  } catch {
    return null;
  }
}

// Publisher name → root domain map. Falls back from URL-based favicon lookup
// when the article URL is still a Google News wrapper (~95% of imports as of
// May 2026). Keep in sync with the same map in the brand-profile sidebar.
const PUBLISHER_DOMAINS: Record<string, string> = {
  "drapers": "drapersonline.com",
  "retail week": "retailweek.com",
  "retail gazette": "retailgazette.co.uk",
  "property week": "propertyweek.com",
  "estates gazette": "egi.co.uk",
  "vogue business": "voguebusiness.com",
  "business of fashion": "businessoffashion.com",
  "bof": "businessoffashion.com",
  "vogue": "vogue.co.uk",
  "bbc": "bbc.co.uk",
  "bbc news": "bbc.co.uk",
  "the times": "thetimes.co.uk",
  "times": "thetimes.co.uk",
  "the guardian": "theguardian.com",
  "guardian": "theguardian.com",
  "telegraph": "telegraph.co.uk",
  "the telegraph": "telegraph.co.uk",
  "financial times": "ft.com",
  "ft": "ft.com",
  "reuters": "reuters.com",
  "bloomberg": "bloomberg.com",
  "fashionunited": "fashionunited.uk",
  "who what wear": "whowhatwear.com",
  "elle": "elle.com",
  "harpers bazaar": "harpersbazaar.com",
  "harper's bazaar": "harpersbazaar.com",
  "gq": "gq.com",
  "wallpaper": "wallpaper.com",
  "metro": "metro.co.uk",
  "yahoo life": "uk.style.yahoo.com",
  "thisismoney": "thisismoney.co.uk",
  "daily mail": "dailymail.co.uk",
  "evening standard": "standard.co.uk",
  "city am": "cityam.com",
  "gentleman's journal": "thegentlemansjournal.com",
  "vogue runway": "vogue.com",
};

function publisherFavicon(sourceName: string | null | undefined): string | null {
  if (!sourceName) return null;
  const clean = sourceName.replace(/\s*\(Google News\)\s*$/i, "").trim().toLowerCase();
  const domain = PUBLISHER_DOMAINS[clean];
  if (!domain) return null;
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`;
}

// Fast backfill — sets a publisher-favicon thumbnail on every article without
// an image, mapping by source_name. No HTTP calls, runs in seconds even for
// 100k articles. Doesn't unwrap Google News URLs, doesn't fetch og:image; the
// per-article scrape (backfillMissingImages) is still available for richer
// thumbnails on the recent slice.
async function backfillFaviconsBySourceName(): Promise<{ updated: number; bySource: Record<string, number> }> {
  const rows = await db.execute(sql`
    SELECT id, source_name FROM news_articles
     WHERE (image_url IS NULL OR image_url = '')
       AND source_name IS NOT NULL AND source_name <> ''`);
  const bySource: Record<string, number> = {};
  let updated = 0;
  const updates: Array<{ id: string; url: string }> = [];
  for (const row of rows.rows as any[]) {
    const favicon = publisherFavicon(row.source_name);
    if (!favicon) continue;
    updates.push({ id: row.id, url: favicon });
    bySource[row.source_name] = (bySource[row.source_name] || 0) + 1;
  }
  for (const u of updates) {
    try {
      await db.update(newsArticles).set({ imageUrl: u.url }).where(eq(newsArticles.id, u.id));
      updated++;
    } catch {}
  }
  console.log(`[news] Favicon backfill: ${updated} articles updated across ${Object.keys(bySource).length} publishers`);
  return { updated, bySource };
}

// Most articles have source_name = "<brand> (Google News)" (the BGP brand the
// article was fetched for, not the publisher). Map those to the BGP brand-logo
// endpoint so each article gets the brand's own logo as a thumbnail. The
// img tag fetches /api/brand-logo/<name> with session cookies; 404s are
// hidden by the UI's onError handler.
async function backfillBrandLogosBySourceName(): Promise<{ updated: number; sampleNames: string[] }> {
  const rows = await db.execute(sql`
    SELECT id, source_name FROM news_articles
     WHERE (image_url IS NULL OR image_url = '')
       AND source_name IS NOT NULL AND source_name <> ''`);
  let updated = 0;
  const seen = new Set<string>();
  const sampleNames: string[] = [];
  for (const row of rows.rows as any[]) {
    const clean = String(row.source_name).replace(/\s*\(Google News\)\s*$/i, "").trim();
    if (!clean) continue;
    const url = `/api/brand-logo/${encodeURIComponent(clean)}`;
    try {
      await db.update(newsArticles).set({ imageUrl: url }).where(eq(newsArticles.id, row.id));
      updated++;
      if (!seen.has(clean) && sampleNames.length < 20) { seen.add(clean); sampleNames.push(clean); }
    } catch {}
  }
  console.log(`[news] Brand-logo backfill: ${updated} articles updated, ${seen.size} unique brands`);
  return { updated, sampleNames };
}

// Revert the brand-logo backfill. The user wants the actual article thumbnail
// (og:image / media:content) — the brand's logo is not what news cards show
// in other apps. Clears image_url for any row pointing at /api/brand-logo/...
async function clearBrandLogoBackfill(): Promise<number> {
  const r = await db.execute(sql`
    UPDATE news_articles SET image_url = NULL
     WHERE image_url ILIKE '/api/brand-logo/%'`);
  return (r.rowCount as number) ?? 0;
}

// Article-thumbnail backfill — for the most recent N articles, unwrap any
// Google News URL, fetch the real article, extract og:image (or twitter:image),
// save as image_url. Uses ScraperAPI when available so we get past geo / UA
// blocks that kill the direct fetch path. Slow but produces real thumbnails.
async function backfillArticleThumbnails(limit: number): Promise<{ scanned: number; updated: number; errors: number }> {
  let scraperFetch: any = null;
  try {
    const m = await import("./utils/scraperapi");
    if (m.isScraperApiAvailable()) scraperFetch = m.scraperFetch;
  } catch {}

  const missing = await db.select({ id: newsArticles.id, url: newsArticles.url })
    .from(newsArticles)
    .where(sql`${newsArticles.imageUrl} IS NULL OR ${newsArticles.imageUrl} = ''
               OR ${newsArticles.imageUrl} ILIKE '/api/brand-logo/%'`)
    .orderBy(desc(newsArticles.publishedAt))
    .limit(limit);

  let updated = 0, errors = 0;
  for (const article of missing) {
    if (!article.url) continue;
    let articleUrl = article.url;
    const updateFields: Record<string, any> = {};

    // Unwrap Google News if needed
    if (/^https?:\/\/(news\.)?google\.com\//i.test(articleUrl)) {
      const real = await resolveGoogleNewsUrl(articleUrl);
      if (real && real !== articleUrl) {
        articleUrl = real;
        updateFields.url = real;
      }
    }

    // Skip if still a Google wrapper after unwrap attempt — no usable og:image.
    if (/^https?:\/\/(news\.)?google\.com\//i.test(articleUrl)) {
      errors++;
      continue;
    }

    // Try direct fetch first (cheaper), fall back to ScraperAPI on failure.
    let img: string | null = await fetchOgImage(articleUrl);
    if (!img && scraperFetch) {
      try {
        const r = await scraperFetch(articleUrl, { uk: true, render: false, timeoutMs: 20000 });
        if (r.ok) {
          const html = await r.text();
          const og = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
            || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
          if (og?.[1] && !isJunkImage(og[1])) img = og[1];
          if (!img) {
            const tw = html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i)
              || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i);
            if (tw?.[1] && !isJunkImage(tw[1])) img = tw[1];
          }
        }
      } catch {}
    }

    if (img) {
      updateFields.imageUrl = img;
    } else {
      errors++;
      continue;
    }

    try {
      await db.update(newsArticles).set(updateFields).where(eq(newsArticles.id, article.id));
      updated++;
    } catch {
      // URL UNIQUE constraint hit — try just the image
      if (updateFields.imageUrl) {
        try {
          await db.update(newsArticles).set({ imageUrl: updateFields.imageUrl }).where(eq(newsArticles.id, article.id));
          updated++;
        } catch {}
      }
    }
    await new Promise(r => setTimeout(r, 150));
  }
  console.log(`[news] Thumbnail backfill: ${updated}/${missing.length} updated, ${errors} no-image`);
  return { scanned: missing.length, updated, errors };
}

// Google News RSS URLs (news.google.com/rss/articles/CBM…) are opaque wrappers
// that redirect to the real article. Without unwrapping, clicking them often
// dead-ends and og:image extraction is impossible. This function follows the
// redirect chain + parses the response for a canonical URL.
async function resolveGoogleNewsUrl(googleUrl: string): Promise<string | null> {
  if (!/^https?:\/\/(news\.)?google\.com\//i.test(googleUrl)) return googleUrl;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 7000);
    const resp = await fetch(googleUrl, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; BGPNewsBot/1.0)",
        "Accept": "text/html",
        ...authHeadersForUrl(googleUrl),
      },
      redirect: "follow",
    });
    clearTimeout(timeout);
    // If the server-side redirect actually landed off Google, we have the real URL.
    if (!/^https?:\/\/(news\.)?google\.com\//i.test(resp.url)) return resp.url;
    const html = await resp.text();
    // Google's article stub embeds the real URL in JS — pull the first non-Google
    // http(s) URL out of the response body.
    const m = html.match(/data-n-au=["']([^"']+)["']/i)
      || html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i)
      || html.match(/"(https?:\/\/(?!(?:news\.)?google\.com\/)[^"\s]+)"/);
    if (m?.[1]) return m[1];
    return null;
  } catch {
    return null;
  }
}

async function backfillMissingImages(): Promise<number> {
  return backfillMissingImagesUpTo(200);
}

async function backfillMissingImagesUpTo(limit: number): Promise<number> {
  // Pull articles where either the thumbnail is missing OR the URL is still a
  // raw Google News wrapper (so we can unwrap + thumb in one pass).
  const missing = await db.select({ id: newsArticles.id, url: newsArticles.url })
    .from(newsArticles)
    .where(sql`${newsArticles.imageUrl} IS NULL OR ${newsArticles.url} ILIKE 'https://news.google.com/%' OR ${newsArticles.url} ILIKE 'https://www.google.com/%'`)
    .orderBy(desc(newsArticles.publishedAt))
    .limit(limit);

  if (missing.length === 0) return 0;
  let updated = 0;

  for (const article of missing) {
    if (!article.url) continue;
    let articleUrl = article.url;
    const updateFields: Record<string, any> = {};

    if (/^https?:\/\/(news\.)?google\.com\//i.test(articleUrl)) {
      const real = await resolveGoogleNewsUrl(articleUrl);
      if (real && real !== articleUrl) {
        articleUrl = real;
        updateFields.url = real;
      }
    }

    let img = await fetchOgImage(articleUrl);
    if (!img) img = faviconForUrl(articleUrl);
    if (img) updateFields.imageUrl = img;

    if (Object.keys(updateFields).length > 0) {
      try {
        await db.update(newsArticles)
          .set(updateFields)
          .where(eq(newsArticles.id, article.id));
        updated++;
      } catch {
        // URL UNIQUE constraint — another article with the unwrapped URL
        // already exists. Just set the favicon on this row and move on.
        if (updateFields.imageUrl && !updateFields.url) continue;
        try {
          await db.update(newsArticles)
            .set({ imageUrl: updateFields.imageUrl })
            .where(eq(newsArticles.id, article.id));
        } catch {}
      }
    }
    await new Promise(r => setTimeout(r, 200));
  }

  console.log(`[news] Backfilled ${updated}/${missing.length} articles (images + Google News unwraps)`);
  return updated;
}

async function getActiveTagVocabulary(): Promise<string[]> {
  try {
    const rows = await db.select({ name: newsTags.name })
      .from(newsTags)
      .where(eq(newsTags.active, true))
      .orderBy(newsTags.sortOrder);
    if (rows.length > 0) return rows.map(r => r.name);
  } catch (e: any) {
    console.warn(`[news] tag vocab read failed, using defaults: ${e?.message}`);
  }
  return [...DEFAULT_NEWS_TAGS];
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

  const tagVocab = await getActiveTagVocabulary();
  const tagVocabStr = tagVocab.map(t => `"${t}"`).join(", ");

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
            content: `You are a news relevance scoring engine for BGP, a London property consultancy. Score each article's relevance (0-100) for each team, generate tags from the controlled vocabulary, and write a concise AI summary.

Teams:
${teamDescriptions}

TAGS — choose 0-4 from this exact list (use the exact spelling, lower-case):
[${tagVocabStr}]

Pick only tags that the article genuinely matches. Do not invent tags outside this list. If you also want to add ONE free-text location tag (e.g. "Mayfair", "Birmingham") because the article is geographically specific, append it after the controlled tags.

Respond in JSON format:
{
  "articles": [
    {
      "index": 1,
      "relevanceScores": { "Investment": 85, "London Retail": 60, "London F&B": 55, "Lease Advisory": 30, "National Leasing": 20, "Tenant Rep": 45, "Development": 10 },
      "tags": ["retail", "new openings", "Mayfair"],
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
    // Per-message webLink + label so each extracted comp can deep-link back to
    // the email it came from. Index aligns with the order pushed into emailTexts;
    // the AI returns sourceArticleIndex (1-based) for each comp.
    const emailArticles: { url: string; title: string }[] = [];

    for (const email of teamEmails.slice(0, 15)) {
      try {
        const searchPath = `/users/${email}/messages?$search=${compSearchQuery}&$top=50&$select=subject,bodyPreview,from,receivedDateTime,webLink&$orderby=receivedDateTime desc`;
        const data = await graphRequest(searchPath);
        const messages = data?.value || [];

        for (const msg of messages) {
          const preview = msg.bodyPreview || "";
          const subject = msg.subject || "";
          const fromName = msg.from?.emailAddress?.name || "Unknown";
          const fromAddr = msg.from?.emailAddress?.address || "";
          const idx = emailTexts.length + 1;
          emailTexts.push(
            `Source #${idx} — Email from ${fromName} (${fromAddr}):\nSubject: ${subject}\nDate: ${msg.receivedDateTime?.split("T")[0] || "unknown"}\nPreview: ${preview.slice(0, 500)}`
          );
          emailArticles.push({
            url: msg.webLink || "",
            title: `${fromName}: ${subject}`.slice(0, 200),
          });
        }
      } catch (err: any) {
        console.error(`[Comp Extract] Error reading ${email}:`, err?.message?.slice(0, 100));
      }
    }

    if (emailTexts.length === 0) return { extracted: 0, created: 0 };

    const batchText = emailTexts.slice(0, 50).join("\n\n---\n\n");
    const articleSlice = emailArticles.slice(0, 50);

    const response = await callClaude({
      model: CHATBGP_HELPER_MODEL,
      messages: [
        { role: "system", content: COMP_EXTRACTION_PROMPT },
        { role: "user", content: `Extract leasing comps from these team emails. Each one is labelled "Source #N — ..."; set sourceArticleIndex to that N so the comp deep-links back to its email.\n\n${batchText}` },
      ],
      max_completion_tokens: 4096,
      response_format: { type: "json_object" },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) return { extracted: 0, created: 0 };

    const parsed = safeParseJSON(content);
    const comps = parsed?.comps || [];
    extracted = comps.length;
    created = await saveExtractedComps(comps, "Email", articleSlice);
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
        // Include webUrl so each extracted comp can deep-link back to the SP
        // file it came from rather than just being labelled "File".
        const resp = await fetch(`https://graph.microsoft.com/v1.0/drives/${driveId}/root:/${encoded}:/children?$select=id,name,size,lastModifiedDateTime,file,webUrl&$top=20&$orderby=lastModifiedDateTime desc`, {
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
            // Single-file batch — every comp from this iteration links back to
            // this same SP file. Tag sourceArticleIndex=1 from the AI for safety.
            const fileArticle = file.webUrl
              ? [{ url: file.webUrl as string, title: file.name as string }]
              : [];
            // Default sourceArticleIndex to 1 so saveExtractedComps picks up the
            // article URL even if the AI omitted it for a single-file batch.
            for (const c of comps) {
              if (typeof c.sourceArticleIndex !== "number") c.sourceArticleIndex = 1;
            }
            extracted += comps.length;
            created += await saveExtractedComps(comps, "File", fileArticle);
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
  // Load DB-stored paywall cookies into the in-memory cache at startup.
  loadPaywallCookies().catch(console.error);

  // Diagnostic — which paywalled-publication auth cookies are configured.
  // Returns { label, envVar, domain, configured, source } per publication;
  // never leaks the cookie value itself. Drives the "Paywall logins" panel.
  app.get("/api/news-feed/auth-cookies/health", requireAuth, async (_req: Request, res: Response) => {
    res.json({ status: authCookieStatus() });
  });

  // Save / clear a paywall subscriber cookie for a publication (by envVar).
  // No redeploy needed — stored in system_settings and read on next scrape.
  app.post("/api/news-feed/auth-cookies", requireAuth, async (req: Request, res: Response) => {
    try {
      const { envVar, cookie } = req.body || {};
      if (!envVar) return res.status(400).json({ message: "envVar required" });
      await setPaywallCookie(envVar, cookie || "");
      res.json({ status: authCookieStatus() });
    } catch (err: any) {
      res.status(400).json({ message: err?.message || "failed" });
    }
  });

  app.delete("/api/news-feed/auth-cookies/:envVar", requireAuth, async (req: Request, res: Response) => {
    try {
      await clearPaywallCookie(req.params.envVar as string);
      res.json({ status: authCookieStatus() });
    } catch (err: any) {
      res.status(400).json({ message: err?.message || "failed" });
    }
  });

  // ─── Tag vocabulary CRUD ─────────────────────────────────────────────────
  // requireAuth only — any logged-in user can edit, not admin-gated.
  app.get("/api/news-feed/tags", requireAuth, async (_req: Request, res: Response) => {
    try {
      const rows = await db.select().from(newsTags).orderBy(newsTags.sortOrder, newsTags.name);
      res.json(rows);
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "failed" });
    }
  });

  app.post("/api/news-feed/tags", requireAuth, async (req: Request, res: Response) => {
    try {
      const rawName = String(req.body?.name || "").trim().toLowerCase();
      if (!rawName) return res.status(400).json({ error: "name is required" });
      if (rawName.length > 60) return res.status(400).json({ error: "tag too long (max 60 chars)" });
      const label = String(req.body?.label || rawName).trim().slice(0, 80);
      const sortOrder = Number(req.body?.sortOrder ?? 1000);
      const userId = (req as any).user?.id ? String((req as any).user.id) : null;
      const [created] = await db.insert(newsTags).values({
        name: rawName,
        label,
        sortOrder,
        createdBy: userId,
        active: true,
      }).onConflictDoNothing().returning();
      if (!created) return res.status(409).json({ error: "tag already exists" });
      res.json(created);
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "failed" });
    }
  });

  app.patch("/api/news-feed/tags/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const patch: any = {};
      if (req.body?.label !== undefined) patch.label = String(req.body.label).slice(0, 80);
      if (req.body?.active !== undefined) patch.active = !!req.body.active;
      if (req.body?.sortOrder !== undefined) patch.sortOrder = Number(req.body.sortOrder);
      if (Object.keys(patch).length === 0) return res.json({ ok: true });
      const [updated] = await db.update(newsTags).set(patch).where(eq(newsTags.id, req.params.id as string)).returning();
      res.json(updated);
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "failed" });
    }
  });

  app.delete("/api/news-feed/tags/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      await db.delete(newsTags).where(eq(newsTags.id, req.params.id as string));
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "failed" });
    }
  });

  // Re-tag the recent backlog so newly-added tags get applied without waiting
  // weeks for the cron to churn through. Marks last N articles as unprocessed
  // — the scoreArticlesWithAI cron will pick them up.
  app.post("/api/news-feed/retag", requireAuth, async (req: Request, res: Response) => {
    try {
      const limit = Math.min(Number(req.body?.limit ?? 500), 2000);
      const ids = await db.select({ id: newsArticles.id })
        .from(newsArticles)
        .orderBy(desc(newsArticles.publishedAt))
        .limit(limit);
      if (ids.length === 0) return res.json({ marked: 0 });
      await db.update(newsArticles)
        .set({ processed: false })
        .where(inArray(newsArticles.id, ids.map(r => r.id)));
      res.json({ marked: ids.length });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "failed" });
    }
  });

  app.get("/api/news-feed/sources", requireAuth, async (_req: Request, res: Response) => {
    const sources = await db.select().from(newsSources).orderBy(newsSources.name);
    // Health: how many articles each source has produced in the last 30 days,
    // so dead/silent feeds are obvious in the Sources tab.
    let countMap = new Map<string, number>();
    try {
      const counts = await db.execute(sql`SELECT source_id, COUNT(*)::int AS n FROM news_articles WHERE published_at > now() - interval '30 days' AND source_id IS NOT NULL GROUP BY source_id`);
      countMap = new Map((counts.rows as any[]).map((r) => [r.source_id, Number(r.n)]));
    } catch {}
    res.json(sources.map((s) => ({ ...s, recentCount: countMap.get(s.id) || 0 })));
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
      const id = req.params.id as string;
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
      const id = req.params.id as string;
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

  // Per-brand social feeds via RSS.app (Instagram / X / LinkedIn).
  // Preview shows what *would* be created without burning RSS.app quota.
  // ?platforms=instagram,x,linkedin (default: all). ?limit=N caps the plan.
  function parsePlatforms(raw: unknown): SocialPlatform[] | undefined {
    if (typeof raw !== "string" || !raw) return undefined;
    const allowed: SocialPlatform[] = ["instagram", "x", "linkedin"];
    const picked = raw.split(",").map(s => s.trim().toLowerCase()).filter((s): s is SocialPlatform => (allowed as string[]).includes(s));
    return picked.length ? picked : undefined;
  }

  app.get("/api/news-feed/brand-social/preview", requireAuth, async (req: Request, res: Response) => {
    try {
      const limit = req.query.limit ? Number(req.query.limit) : undefined;
      // ?curated=1 → the ranked Instagram-only shortlist that fits the paid
      // RSS.app plan (junk + duplicate handles excluded, deals-first order).
      if (req.query.curated) {
        const result = await previewCuratedInstagramFeeds(limit ?? 100);
        res.json({ count: result.plan.length, totalCandidates: result.totalCandidates, excluded: result.excluded, plan: result.plan });
        return;
      }
      const platforms = parsePlatforms(req.query.platforms);
      const result = await previewBrandSocialFeeds({ platforms, limit });
      res.json({ count: result.plan.length, existing: result.existing, plan: result.plan });
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Preview failed" });
    }
  });

  app.post("/api/news-feed/brand-social/refresh", requireAuth, async (req: Request, res: Response) => {
    try {
      const limit = req.query.limit ? Number(req.query.limit) : undefined;
      if (req.query.curated) {
        const result = await ensureCuratedInstagramFeeds(limit ?? 100);
        res.json(result);
        return;
      }
      const platforms = parsePlatforms(req.query.platforms);
      const result = await ensureBrandSocialFeeds({ platforms, limit });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Refresh failed" });
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

  // Diagnostic: how many articles currently have a thumbnail vs none?
  app.get("/api/news-feed/image-stats", requireAuth, async (_req: Request, res: Response) => {
    try {
      const total = await db.execute(sql`SELECT COUNT(*)::int AS n FROM news_articles`);
      const withImg = await db.execute(sql`SELECT COUNT(*)::int AS n FROM news_articles WHERE image_url IS NOT NULL AND image_url <> ''`);
      const stillGoogle = await db.execute(sql`SELECT COUNT(*)::int AS n FROM news_articles WHERE url ILIKE 'https://news.google.com/%' OR url ILIKE 'https://www.google.com/%'`);
      res.json({
        total: (total.rows[0] as any).n,
        with_image: (withImg.rows[0] as any).n,
        without_image: (total.rows[0] as any).n - (withImg.rows[0] as any).n,
        still_wrapped_google_news: (stillGoogle.rows[0] as any).n,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Bulk backfill — runs unrestricted (the regular fetch caps at 200 per call).
  // Async/fire-and-forget so the request doesn't time out on Railway's proxy.
  app.post("/api/news-feed/backfill-images", requireAuth, async (req: Request, res: Response) => {
    const limit = Math.min(parseInt(String(req.body?.limit || req.query.limit || 2000), 10) || 2000, 10000);
    (async () => {
      try {
        const updated = await backfillMissingImagesUpTo(limit);
        console.log(`[news] Bulk backfill done: ${updated} images updated (limit ${limit})`);
      } catch (e: any) {
        console.error("[news] Bulk backfill failed:", e?.message || e);
      }
    })();
    res.json({ started: true, limit });
  });

  // Fast favicon-only backfill — maps every imageless article's source_name to
  // a publisher domain favicon. No HTTP calls, completes in seconds. Use this
  // first; the slower og:image scraper (backfill-images) can upgrade the slice
  // we actually look at.
  app.post("/api/news-feed/backfill-favicons", requireAuth, async (_req: Request, res: Response) => {
    try {
      const result = await backfillFaviconsBySourceName();
      res.json({ ok: true, ...result });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Most articles are Google-News-sourced per BGP brand — source_name is the
  // brand name. Map each to its /api/brand-logo URL so the thumbnail shows the
  // brand's logo. Covers ~all articles in one shot.
  app.post("/api/news-feed/backfill-brand-logos", requireAuth, async (_req: Request, res: Response) => {
    // Fire-and-forget — 93k articles × per-row UPDATE blows the Railway proxy
    // timeout (~60s). Run in background and reply immediately.
    (async () => {
      try {
        const result = await backfillBrandLogosBySourceName();
        console.log(`[news] Brand-logo backfill done: ${result.updated} articles, ${result.sampleNames.length} sample brands`);
      } catch (e: any) {
        console.error("[news] Brand-logo backfill failed:", e?.message || e);
      }
    })();
    res.json({ started: true });
  });

  // Revert the brand-logo backfill — what we actually want is each article's
  // own og:image (the publisher-supplied thumbnail), not the BGP brand logo.
  app.post("/api/news-feed/clear-brand-logos", requireAuth, async (_req: Request, res: Response) => {
    try {
      const cleared = await clearBrandLogoBackfill();
      res.json({ ok: true, cleared });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Proper article-thumbnail backfill — unwraps Google News, fetches the real
  // article (via ScraperAPI when available), pulls og:image / twitter:image.
  // Slow (each row ~0.5–2s); fire-and-forget so the request doesn't time out.
  app.post("/api/news-feed/backfill-thumbnails", requireAuth, async (req: Request, res: Response) => {
    const limit = Math.min(parseInt(String(req.body?.limit || req.query.limit || 1000), 10) || 1000, 10000);
    (async () => {
      try {
        const r = await backfillArticleThumbnails(limit);
        console.log(`[news] Thumbnail backfill done: ${r.updated}/${r.scanned} updated, ${r.errors} no-image`);
      } catch (e: any) {
        console.error("[news] Thumbnail backfill failed:", e?.message || e);
      }
    })();
    res.json({ started: true, limit });
  });

  // Diagnostic: top source_name values amongst imageless articles. Tells us
  // which publishers to add to PUBLISHER_DOMAINS so the favicon backfill
  // actually covers the bulk of the data.
  app.get("/api/news-feed/source-names", requireAuth, async (_req: Request, res: Response) => {
    try {
      const rows = await db.execute(sql`
        SELECT source_name, COUNT(*)::int AS n
          FROM news_articles
         WHERE (image_url IS NULL OR image_url = '')
         GROUP BY source_name
         ORDER BY n DESC
         LIMIT 80`);
      res.json({ top: rows.rows });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Dismiss an article — hard-delete from the feed. The next news poll
  // can re-ingest if the source is still publishing it; for genuinely
  // off-topic articles, dismiss the source itself via news-sources-tab.
  app.delete("/api/news-feed/articles/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const id = String(req.params.id);
      const result = await db.delete(newsArticles).where(eq(newsArticles.id, id)).returning({ id: newsArticles.id });
      if (result.length === 0) return res.status(404).json({ error: "Article not found" });
      res.json({ ok: true, id });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/news-feed/articles", requireAuth, async (req: Request, res: Response) => {
    try {
      const { team, limit: limitStr, search } = req.query;
      const limit = parseInt(limitStr as string) || 50;
      const RELEVANCE_FLOOR = 30;

      // Fetch a WIDER pool than `limit` so relevance/team filtering below
      // doesn't starve the result (previously we limited to `limit` first,
      // then filtered — which let off-topic items survive simply by being
      // the newest, and shrank the list).
      const pool = Math.max(limit * 5, 80);
      // Google News is intentionally OFF for the general feed — it's not
      // specific enough and floods out the curated trade-press RSS. We exclude
      // every google_news-typed source (both the per-brand 'brand:<id>' feeds
      // that power Brand Intelligence and the topical query feeds). The feed is
      // now driven by direct RSS + RSS.app sources only.
      let articles = await db.select()
        .from(newsArticles)
        .where(sql`${newsArticles.sourceId} IS NULL OR ${newsArticles.sourceId} NOT IN (SELECT id FROM news_sources WHERE type = 'google_news')`)
        .orderBy(desc(newsArticles.publishedAt))
        .limit(pool);

      if (search) {
        const searchLower = (search as string).toLowerCase();
        articles = articles.filter(a =>
          a.title.toLowerCase().includes(searchLower) ||
          a.summary?.toLowerCase().includes(searchLower) ||
          a.aiSummary?.toLowerCase().includes(searchLower) ||
          a.sourceName?.toLowerCase().includes(searchLower)
        );
      }

      // Max relevance across all teams. null = never classified (keep it,
      // benefit of the doubt for freshly-ingested items).
      const maxRelevance = (a: any): number | null => {
        const s = a.aiRelevanceScores;
        if (!s || typeof s !== "object") return null;
        const vals = Object.values(s).map(Number).filter((n) => Number.isFinite(n));
        return vals.length ? Math.max(...vals) : null;
      };

      if (team && team !== "All" && team !== "All Teams") {
        const teamStr = team as string;
        articles = articles.filter(a => {
          const score = (a.aiRelevanceScores as any)?.[teamStr];
          return score === undefined || score === null || score >= RELEVANCE_FLOOR;
        });
        articles.sort((a, b) => {
          const scoreA = (a.aiRelevanceScores as any)?.[teamStr] || 0;
          const scoreB = (b.aiRelevanceScores as any)?.[teamStr] || 0;
          return scoreB - scoreA;
        });
      } else {
        // No team (e.g. the Dashboard default feed): drop articles that were
        // classified as irrelevant to every team — this is what keeps loose
        // Google-News keyword hits (e.g. an off-topic New York story) from
        // floating to the top just because they're the newest. Unscored
        // articles are kept. Order stays newest-first.
        articles = articles.filter(a => {
          const m = maxRelevance(a);
          return m === null || m >= RELEVANCE_FLOOR;
        });
      }

      res.json(articles.slice(0, limit));
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

      const savedEngagements = await db.select({ articleId: newsEngagement.articleId, createdAt: newsEngagement.createdAt })
        .from(newsEngagement)
        .where(and(eq(newsEngagement.userId, userId), eq(newsEngagement.action, "save")))
        .orderBy(desc(newsEngagement.createdAt));

      const articleIdSet = new Set(savedEngagements.map(e => e.articleId));
      const articleIds = Array.from(articleIdSet);
      if (articleIds.length === 0) return res.json([]);

      const unsavedEngagements = await db.select({ articleId: newsEngagement.articleId, createdAt: newsEngagement.createdAt })
        .from(newsEngagement)
        .where(and(eq(newsEngagement.userId, userId), eq(newsEngagement.action, "unsave")));

      // An unsave only wins over saves that came before it — a re-save after
      // an unsave brings the article back.
      const latestSave = new Map<string, number>();
      for (const e of savedEngagements) {
        const t = e.createdAt ? new Date(e.createdAt).getTime() : 0;
        if (t > (latestSave.get(e.articleId) ?? -1)) latestSave.set(e.articleId, t);
      }
      const latestUnsave = new Map<string, number>();
      for (const e of unsavedEngagements) {
        const t = e.createdAt ? new Date(e.createdAt).getTime() : 0;
        if (t > (latestUnsave.get(e.articleId) ?? -1)) latestUnsave.set(e.articleId, t);
      }

      const filteredIds = articleIds.filter(id => (latestSave.get(id) ?? 0) > (latestUnsave.get(id) ?? -1));
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
      const propertyId = req.params.id as string;
      const [property] = await db.select().from(crmProperties).where(eq(crmProperties.id, propertyId)).limit(1);
      if (!property) return res.status(404).json({ message: "Property not found" });
      const { resolveCompanyScope, isPropertyInScope } = await import("./company-scope");
      const newsScope = await resolveCompanyScope(req as any);
      if (newsScope && !(await isPropertyInScope(newsScope, propertyId))) {
        return res.status(403).json({ message: "Access denied" });
      }

      const propertyName = property.name;
      const addr = property.address as any;
      const addressStr = addr?.address || "";

      const dbArticles = await db.select()
        .from(newsArticles)
        .orderBy(desc(newsArticles.publishedAt))
        .limit(200);

      const nameLower = propertyName.toLowerCase();
      // Drop generic property words so "Shopping Centre" / "Retail Park"
      // don't match any old shopping-centre article — keep only the
      // distinctive tokens (e.g. "bluewater", "trafford").
      const GENERIC_PROP_WORDS = new Set(["shopping", "centre", "center", "retail", "park", "house",
        "estate", "street", "road", "square", "place", "court", "mall", "plaza", "tower", "building",
        "the", "and", "london", "quarter", "gardens", "wharf"]);
      const distinctiveWords = nameLower.split(/\s+/).filter((w: string) => w.length > 3 && !GENERIC_PROP_WORDS.has(w));
      const matchedArticles = dbArticles.filter(a => {
        const text = `${a.title} ${a.summary || ""} ${a.aiSummary || ""}`.toLowerCase();
        if (text.includes(nameLower)) return true;
        // Require at least one *distinctive* property word (not just two
        // generic ones like shopping + centre).
        return distinctiveWords.length > 0 && distinctiveWords.some((w: string) => text.includes(w));
      }).slice(0, 10);

      // Thumbnail the matched slice — DB pipeline articles often land with
      // image_url NULL, which left this panel as bare globe favicons while
      // the News page (whose backfill had run) showed real thumbnails. Same
      // og:image enrichment as backfillArticleThumbnails, persisted so each
      // article costs one fetch ever.
      await Promise.all(matchedArticles
        .filter(a => !a.imageUrl || a.imageUrl.startsWith("/api/brand-logo/"))
        .map(async a => {
          try {
            let articleUrl = a.url || "";
            if (/^https?:\/\/(news\.)?google\.com\//i.test(articleUrl)) {
              const real = await resolveGoogleNewsUrl(articleUrl);
              if (real) { articleUrl = real; (a as any).url = real; }
            }
            if (/^https?:\/\/(news\.)?google\.com\//i.test(articleUrl)) return;
            const img = await fetchOgImage(articleUrl) || faviconForUrl(articleUrl);
            if (img) {
              (a as any).imageUrl = img;
              await db.update(newsArticles)
                .set({ imageUrl: img, url: articleUrl })
                .where(eq(newsArticles.id, a.id));
            }
          } catch { /* panel still renders without a thumbnail */ }
        }));

      const searchQuery = `"${propertyName}"`;

      // Live search via Google News RSS — a stable XML feed, unlike the old
      // DuckDuckGo HTML scrape which silently returned 0 when DDG changed
      // markup or rate-limited (that's why the panel showed a single story).
      // Each result is unwrapped to the real publisher URL and given a real
      // og:image (falling back to twitter:image, then publisher favicon) so
      // the cards aren't blank.
      let webResults: Array<{ title: string; url: string; snippet: string; sourceName: string; publishedAt: string | null; imageUrl: string | null }> = [];
      try {
        const Parser = (await import("rss-parser")).default;
        const parser = new Parser({ timeout: 10000, headers: { "User-Agent": "BGP-Dashboard/1.0" } });
        const gnUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(searchQuery)}&hl=en-GB&gl=GB&ceid=GB:en`;
        const feed = await parser.parseURL(gnUrl);
        const items = (feed.items || []).slice(0, 8);
        webResults = await Promise.all(items.map(async (item: any) => {
          let articleUrl = item.link || "";
          if (/^https?:\/\/(news\.)?google\.com\//i.test(articleUrl)) {
            const real = await resolveGoogleNewsUrl(articleUrl);
            if (real) articleUrl = real;
          }
          // Google News titles are "Headline - Publisher" — split the
          // publisher off for the source label.
          let title = (item.title || "").trim();
          let sourceName = "";
          const dash = title.lastIndexOf(" - ");
          if (dash > 0) { sourceName = title.slice(dash + 3).trim(); title = title.slice(0, dash).trim(); }
          if (!sourceName) { try { sourceName = new URL(articleUrl).hostname.replace(/^www\./, ""); } catch {} }
          const imageUrl = extractImageUrl(item) || await fetchOgImage(articleUrl) || faviconForUrl(articleUrl);
          return {
            title,
            url: articleUrl,
            snippet: (item.contentSnippet || item.content || "").replace(/<[^>]+>/g, "").slice(0, 300).trim(),
            sourceName,
            publishedAt: item.pubDate || item.isoDate || null,
            imageUrl,
          };
        }));
      } catch (err: any) {
        console.error("[Property News] Google News RSS error:", err?.message);
      }

      const existingUrls = new Set(matchedArticles.map(a => a.url));
      const dedupedWeb = webResults.filter(r => r.url && !existingUrls.has(r.url));

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
      try { await backfillNewsOgImages(25); } catch (e: any) { console.warn("[news-og-image] startup pass failed:", e?.message); }
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
      try { await backfillNewsOgImages(25); } catch (e: any) { console.warn("[news-og-image] auto pass failed:", e?.message); }
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
