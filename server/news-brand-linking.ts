// Links ingested news articles to tracked brands and creates brand_signals.
// Also auto-maintains a Google News RSS feed per tracked brand.
import { db } from "./db";
import { crmCompanies, newsSources, newsArticles, brandSignals } from "@shared/schema";
import { eq, and, sql, desc, isNotNull } from "drizzle-orm";
import { googleNewsRssUrl, createRssAppFeed } from "./rssapp";
import { callClaude, CHATBGP_HELPER_MODEL, safeParseJSON } from "./utils/anthropic-client";

type SignalType = "opening" | "closure" | "funding" | "exec_change" | "sector_move" | "news" | "rumour";
type Magnitude = "small" | "medium" | "large";
type Sentiment = "positive" | "neutral" | "negative";

// Ask Haiku to classify an article headline into a brand_signals row.
// Returns null if AI unavailable / fails — caller falls back to plain "news".
async function classifySignal(brandName: string, title: string, summary: string | null): Promise<
  { signalType: SignalType; magnitude: Magnitude; sentiment: Sentiment } | null
> {
  const haveKey = !!(process.env.ANTHROPIC_API_KEY || process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY);
  if (!haveKey) return null;

  const prompt = `Classify this news headline about the brand "${brandName}" into a structured signal.

Headline: ${title}
${summary ? `Summary: ${summary.slice(0, 400)}` : ""}

Respond with JSON only:
{
  "signalType": one of ["opening","closure","funding","exec_change","sector_move","news","rumour"],
  "magnitude":  one of ["small","medium","large"],
  "sentiment":  one of ["positive","neutral","negative"]
}

Rules:
- "opening" = new store/flagship/branch opening
- "closure" = store closure, administration, bankruptcy
- "funding" = raise, investment, acquisition, IPO
- "exec_change" = new CEO/CFO/founder hire or departure
- "sector_move" = category expansion, strategic pivot, new product line
- "rumour" = unconfirmed/speculative story
- "news" = general brand mention that doesn't fit above
- magnitude "large" = national flagship, admin, >£10m deal; "small" = minor branch, small hire`;

  try {
    const r = await callClaude({
      model: CHATBGP_HELPER_MODEL,
      max_completion_tokens: 150,
      temperature: 0,
      messages: [{ role: "user", content: prompt }],
    });
    const txt = r.choices?.[0]?.message?.content || "";
    const parsed = safeParseJSON(txt);
    if (!parsed?.signalType) return null;
    return {
      signalType: parsed.signalType as SignalType,
      magnitude: (parsed.magnitude || "medium") as Magnitude,
      sentiment: (parsed.sentiment || "neutral") as Sentiment,
    };
  } catch {
    return null;
  }
}

const BRAND_CATEGORY_PREFIX = "brand:";

function normalizeBrandName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9& ]+/g, "")
    .replace(/\b(ltd|limited|plc|uk|holdings|group)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Picks a Google News search query that minimises false positives.
// Wraps brand in quotes, adds retail/UK context, and (for known ambiguous
// names) negates obvious unrelated topics. "Supreme UK" was returning a sea
// of US Supreme Court articles before this list was added.
function googleNewsQueryForBrand(brandName: string, industry?: string | null): string {
  const trimmed = brandName.trim();
  const lc = trimmed.toLowerCase();
  // Brand tokens that collide with everyday English / institutional names —
  // bolt on negative terms to keep Google News on-topic.
  const collisionExclusions: Record<string, string> = {
    supreme: ' -"supreme court" -justice -ruling -judge -judges',
    apple: ' -iphone -tim cook -macbook -ipad -ios',
    coach: ' -football -manager -hire -coachway -bus',
    monsoon: ' -rain -weather -monsoon-season -india',
    jigsaw: ' -puzzle -puzzles',
    diesel: ' -fuel -engine -truck',
    next: ' -week -year -month',
    pandora: ' -spotify -streaming -radio',
    boots: ' -football -wellington',
    river: ' -thames -nile -flood',
    mountain: ' -climbing -rescue',
    hollister: ' -fire -california',
    everlast: ' -boxing -mma -fight',
    burger: ' -recipe',
    base: ' -military -army',
  };
  const exclusion = collisionExclusions[lc] || "";
  // Industry context bias — adds a positive term that Google's ranker uses to
  // pick the retail/F&B sense of an ambiguous brand.
  const ind = (industry || "").toLowerCase();
  const industryHint = /fashion|apparel|retail|streetwear|luxury|denim/.test(ind) ? " (fashion OR retail OR store OR shop)"
    : /food|restaurant|qsr|hospitality|coffee|cafe/.test(ind) ? " (restaurant OR cafe OR food OR menu)"
    : /beauty|skincare|cosmetic/.test(ind) ? " (beauty OR skincare OR cosmetics)"
    : /fitness|gym|wellness/.test(ind) ? " (gym OR fitness OR studio)"
    : "";
  if (trimmed.length <= 3 || /^(ba|bp|hm|uk)$/i.test(trimmed)) {
    return `"${trimmed}" (retail OR store OR UK)${exclusion}`;
  }
  return `"${trimmed}" UK${industryHint}${exclusion}`;
}

// Article-level relevance filter for per-brand Google News feeds. Returns
// false for headlines that are obvious cross-topic noise (US Supreme Court
// matched on "Supreme", football "Coach", etc.) so they don't end up in the
// brand's signal list. Exported so the brand-profile API can re-apply it
// at read time to historical signals without a migration.
export function articleLooksRelevantForBrand(brandName: string, industry: string | null | undefined, title: string, summary: string | null): boolean {
  const lcBrand = brandName.toLowerCase().trim();
  const txt = `${title} ${summary || ""}`.toLowerCase();
  const ind = (industry || "").toLowerCase();
  const isFashionBrand = /fashion|apparel|retail|streetwear|luxury|denim|footwear|jewell|leather/.test(ind);
  const isFnbBrand = /food|restaurant|qsr|hospitality|coffee|cafe|bar|pub/.test(ind);

  // Hard exclusion lists per ambiguous token. If brand token matches AND text
  // contains any of these phrases, drop the article.
  const drop: Record<string, RegExp> = {
    supreme: /\bsupreme court\b|\bjustice\b|\bjudge\b|\bjudges\b|\bruling\b|\bscotus\b|\bjudicial\b/,
    apple: /\biphone\b|\bipad\b|\bmacbook\b|\bios\b|\btim cook\b/,
    coach: /\bfootball\b|\bmanager\b|\bcoach hire\b|\bcoachway\b|\bbus\b/,
    monsoon: /\bmonsoon season\b|\bindia\b.*\bweather\b|\brain\b.*\bforecast\b/,
    next: /\bnext (week|month|year)\b|\bwhat'?s next\b/,
    boots: /\bfootball boots\b|\bwellington boots\b|\bworking boots\b/,
    pandora: /\bspotify\b|\bpandora radio\b|\bstreaming\b/,
    river: /\bthames\b|\bnile\b|\bflood\b|\briverbank\b/,
  };
  const rx = drop[lcBrand];
  if (rx && rx.test(txt)) return false;

  // Soft positive bias for fashion/F&B brands: if the headline is clearly
  // political/legal/sports and we're tracking a retail brand, drop it.
  if (isFashionBrand || isFnbBrand) {
    const hardOffTopic = /\b(parliament|congress|senate|supreme court|impeach|election|primary results|scotus|prime minister|president biden|president trump|world cup|premier league|uefa)\b/;
    if (hardOffTopic.test(txt)) return false;
  }

  return true;
}

export async function ensureBrandGoogleNewsFeeds(): Promise<{ created: number; total: number; refreshed: number }> {
  const tracked = await db
    .select({ id: crmCompanies.id, name: crmCompanies.name, industry: crmCompanies.industry })
    .from(crmCompanies)
    .where(and(eq(crmCompanies.isTrackedBrand, true), sql`${crmCompanies.mergedIntoId} IS NULL`));

  let created = 0;
  let refreshed = 0;
  for (const brand of tracked) {
    const categoryTag = `${BRAND_CATEGORY_PREFIX}${brand.id}`;
    const query = googleNewsQueryForBrand(brand.name, brand.industry);
    const feedUrl = googleNewsRssUrl(query);
    const url = `https://news.google.com/search?q=${encodeURIComponent(query)}`;
    const existing = await db
      .select({ id: newsSources.id, feedUrl: newsSources.feedUrl })
      .from(newsSources)
      .where(eq(newsSources.category, categoryTag))
      .limit(1);
    if (existing.length > 0) {
      // Refresh URL when the query has changed (industry / collision-list
      // updates). Without this, stale "Supreme UK" feeds keep returning
      // Supreme Court articles forever.
      if (existing[0].feedUrl !== feedUrl) {
        await db.update(newsSources)
          .set({ feedUrl, url })
          .where(eq(newsSources.id, existing[0].id));
        refreshed++;
      }
      continue;
    }
    await db.insert(newsSources).values({
      name: `${brand.name} (Google News)`,
      url,
      feedUrl,
      type: "google_news",
      category: categoryTag,
      active: true,
    });
    created++;
  }
  return { created, total: tracked.length, refreshed };
}

// ─── Per-brand social feeds via RSS.app ──────────────────────────────────
// Mirrors ensureBrandGoogleNewsFeeds but creates RSS.app feeds for each
// brand's IG / X / LinkedIn handle. Reuses the same `brand:<id>` category
// tag so the existing brand-signal pipeline picks posts up automatically.

export type SocialPlatform = "instagram" | "x" | "linkedin";

const SOCIAL_TYPE: Record<SocialPlatform, string> = {
  instagram: "rssapp_instagram",
  x: "rssapp_x",
  linkedin: "rssapp_linkedin",
};

// Build a public profile URL for RSS.app to consume. Returns null if the
// stored handle isn't usable (empty, personal LinkedIn URL, etc.).
function socialProfileUrl(platform: SocialPlatform, brand: {
  instagramHandle: string | null;
  xHandle: string | null;
  linkedinUrl: string | null;
}): string | null {
  if (platform === "instagram") {
    const h = brand.instagramHandle?.replace(/^@/, "").trim();
    return h ? `https://www.instagram.com/${h}/` : null;
  }
  if (platform === "x") {
    const h = brand.xHandle?.replace(/^@/, "").trim();
    return h ? `https://x.com/${h}` : null;
  }
  if (platform === "linkedin") {
    const url = brand.linkedinUrl?.trim();
    if (!url) return null;
    // RSS.app reliably handles company pages but not personal profiles.
    if (!/linkedin\.com\/company\//i.test(url)) return null;
    return url;
  }
  return null;
}

export interface BrandSocialFeedPlan {
  brandId: string;
  brandName: string;
  platform: SocialPlatform;
  url: string;
}

// Returns the list of brand × platform feeds that *would* be created.
// Excludes brands that already have a feed for that platform. Read-only,
// makes no RSS.app calls — safe to run before paying for feeds.
export async function previewBrandSocialFeeds(opts?: {
  platforms?: SocialPlatform[];
  limit?: number;
}): Promise<{ plan: BrandSocialFeedPlan[]; existing: number }> {
  const platforms = opts?.platforms?.length ? opts.platforms : (["instagram", "x", "linkedin"] as SocialPlatform[]);

  const tracked = await db
    .select({
      id: crmCompanies.id,
      name: crmCompanies.name,
      instagramHandle: crmCompanies.instagramHandle,
      xHandle: crmCompanies.xHandle,
      linkedinUrl: crmCompanies.linkedinUrl,
    })
    .from(crmCompanies)
    .where(and(eq(crmCompanies.isTrackedBrand, true), sql`${crmCompanies.mergedIntoId} IS NULL`));

  const existingRows = await db
    .select({ category: newsSources.category, type: newsSources.type })
    .from(newsSources)
    .where(sql`${newsSources.category} LIKE 'brand:%'`);
  const existingKey = new Set(
    existingRows
      .filter(r => !!r.type && r.type.startsWith("rssapp_"))
      .map(r => `${r.category}|${r.type}`)
  );

  const plan: BrandSocialFeedPlan[] = [];
  for (const brand of tracked) {
    for (const platform of platforms) {
      const url = socialProfileUrl(platform, brand);
      if (!url) continue;
      const key = `brand:${brand.id}|${SOCIAL_TYPE[platform]}`;
      if (existingKey.has(key)) continue;
      plan.push({ brandId: brand.id, brandName: brand.name, platform, url });
    }
  }

  const limited = typeof opts?.limit === "number" ? plan.slice(0, opts.limit) : plan;
  return { plan: limited, existing: existingKey.size };
}

// Actually creates the RSS.app feeds and inserts news_sources rows. Honours
// the same dedupe logic as preview. Continues past per-feed failures so a
// single bad handle doesn't kill the batch.
export async function ensureBrandSocialFeeds(opts?: {
  platforms?: SocialPlatform[];
  limit?: number;
}): Promise<{ created: number; skipped: number; errors: { brandName: string; platform: SocialPlatform; error: string }[] }> {
  const { plan } = await previewBrandSocialFeeds(opts);
  let created = 0;
  let skipped = 0;
  const errors: { brandName: string; platform: SocialPlatform; error: string }[] = [];

  for (const item of plan) {
    try {
      const feed = await createRssAppFeed(item.url);
      await db.insert(newsSources).values({
        name: `${item.brandName} (${item.platform})`,
        url: item.url,
        feedUrl: feed.rss_feed_url,
        type: SOCIAL_TYPE[item.platform],
        category: `${BRAND_CATEGORY_PREFIX}${item.brandId}`,
        active: true,
      });
      created++;
    } catch (err: any) {
      errors.push({ brandName: item.brandName, platform: item.platform, error: (err?.message || "unknown").slice(0, 200) });
      skipped++;
    }
  }

  return { created, skipped, errors };
}

// For a single article, decides which tracked brands it mentions and writes
// brand_signals rows. De-duplicates on (brand, article_url).
async function linkArticleToBrands(article: {
  id: string;
  url: string;
  title: string;
  summary: string | null;
  sourceId: string | null;
  publishedAt: Date | null;
  aiSummary: string | null;
}, brandIndex: { id: string; name: string; normalized: string }[]): Promise<string[]> {
  const haystack = [article.title, article.summary || "", article.aiSummary || ""]
    .join(" ")
    .toLowerCase();
  const hits: string[] = [];
  for (const b of brandIndex) {
    if (b.normalized.length < 3) continue;
    const token = b.normalized;
    // word-boundary match against normalized brand name
    const re = new RegExp(`(^|[^a-z0-9])${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`, "i");
    if (re.test(haystack)) hits.push(b.id);
  }
  return hits;
}

async function upsertBrandSignal(brandId: string, brandName: string, article: {
  id: string;
  url: string;
  title: string;
  summary: string | null;
  publishedAt: Date | null;
  sourceName?: string | null;
}) {
  const existing = await db
    .select({ id: brandSignals.id })
    .from(brandSignals)
    .where(and(eq(brandSignals.brandCompanyId, brandId), eq(brandSignals.source, article.url)))
    .limit(1);
  if (existing.length > 0) return;

  const classified = await classifySignal(brandName, article.title, article.summary);

  await db.insert(brandSignals).values({
    brandCompanyId: brandId,
    signalType: classified?.signalType || "news",
    headline: article.title.slice(0, 500),
    detail: article.summary?.slice(0, 1000) || null,
    source: article.url,
    signalDate: article.publishedAt || new Date(),
    magnitude: classified?.magnitude || null,
    sentiment: classified?.sentiment || null,
    aiGenerated: !!classified,
  });
}

export async function linkRecentArticlesToBrands(opts?: { limit?: number }): Promise<{ linked: number; articles: number }> {
  const limit = opts?.limit || 200;

  // Load tracked brands for matching
  const brands = await db
    .select({ id: crmCompanies.id, name: crmCompanies.name, industry: crmCompanies.industry })
    .from(crmCompanies)
    .where(and(eq(crmCompanies.isTrackedBrand, true), sql`${crmCompanies.mergedIntoId} IS NULL`));
  const brandIndex = brands
    .map((b) => ({ id: b.id, name: b.name, industry: b.industry, normalized: normalizeBrandName(b.name) }))
    .filter((b) => b.normalized.length >= 3);
  const brandIndustryById = new Map(brandIndex.map((b) => [b.id, b.industry]));

  // Load recent articles + source info
  const articles = await db
    .select()
    .from(newsArticles)
    .where(isNotNull(newsArticles.publishedAt))
    .orderBy(desc(newsArticles.publishedAt))
    .limit(limit);

  // Load sources once for category lookup
  const sources = await db.select().from(newsSources);
  const sourceById = new Map(sources.map((s) => [s.id, s]));
  const brandNameById = new Map(brandIndex.map((b) => [b.id, b.name]));

  let linked = 0;
  for (const a of articles) {
    const src = a.sourceId ? sourceById.get(a.sourceId) : null;

    // Explicit brand feeds (Google News per-brand) — link directly by category tag
    if (src?.category?.startsWith(BRAND_CATEGORY_PREFIX)) {
      const brandId = src.category.slice(BRAND_CATEGORY_PREFIX.length);
      const brandName = brandNameById.get(brandId) || "";
      // Even though Google News was given a tighter query, RSS still slips in
      // off-topic articles for ambiguous tokens like "Supreme". Reject the
      // obvious noise before writing a brand_signals row.
      if (brandName && !articleLooksRelevantForBrand(brandName, brandIndustryById.get(brandId), a.title, a.summary)) {
        continue;
      }
      await upsertBrandSignal(brandId, brandName, {
        id: a.id,
        url: a.url,
        title: a.title,
        summary: a.summary,
        publishedAt: a.publishedAt,
        sourceName: a.sourceName,
      });
      linked++;
      continue;
    }

    // Generic feeds — fuzzy match against tracked brand names
    const hits = await linkArticleToBrands(
      {
        id: a.id,
        url: a.url,
        title: a.title,
        summary: a.summary,
        sourceId: a.sourceId,
        publishedAt: a.publishedAt,
        aiSummary: a.aiSummary,
      },
      brandIndex,
    );
    for (const brandId of hits) {
      await upsertBrandSignal(brandId, brandNameById.get(brandId) || "", {
        id: a.id,
        url: a.url,
        title: a.title,
        summary: a.summary,
        publishedAt: a.publishedAt,
        sourceName: a.sourceName,
      });
      linked++;
    }
  }

  return { linked, articles: articles.length };
}

// Re-classify existing generic "news" signals into specific types.
// Runs AI on each signal in small batches. Call via admin endpoint.
export async function backfillSignalClassifications(opts?: { limit?: number }): Promise<
  { scanned: number; reclassified: number; skipped: number }
> {
  const limit = opts?.limit || 50;
  const haveKey = !!(process.env.ANTHROPIC_API_KEY || process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY);
  if (!haveKey) return { scanned: 0, reclassified: 0, skipped: 0 };

  const brands = await db
    .select({ id: crmCompanies.id, name: crmCompanies.name })
    .from(crmCompanies);
  const brandNameById = new Map(brands.map((b) => [b.id, b.name]));

  const rows = await db
    .select()
    .from(brandSignals)
    .where(and(eq(brandSignals.signalType, "news"), eq(brandSignals.aiGenerated, false)))
    .limit(limit);

  let reclassified = 0;
  let skipped = 0;
  for (const r of rows) {
    const brandName = brandNameById.get(r.brandCompanyId) || "";
    if (!brandName) { skipped++; continue; }
    const classified = await classifySignal(brandName, r.headline, r.detail);
    if (!classified) { skipped++; continue; }
    await db
      .update(brandSignals)
      .set({
        signalType: classified.signalType,
        magnitude: classified.magnitude,
        sentiment: classified.sentiment,
        aiGenerated: true,
      })
      .where(eq(brandSignals.id, r.id));
    reclassified++;
  }
  return { scanned: rows.length, reclassified, skipped };
}
