// Links ingested news articles to tracked brands and creates brand_signals.
// Also auto-maintains a Google News RSS feed per tracked brand.
import { db } from "./db";
import { crmCompanies, newsSources, newsArticles, brandSignals } from "@shared/schema";
import { eq, and, sql, desc, isNotNull } from "drizzle-orm";
import { googleNewsRssUrl } from "./rssapp";
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
// Wraps brand in quotes and adds UK context.
function googleNewsQueryForBrand(brandName: string): string {
  const trimmed = brandName.trim();
  if (trimmed.length <= 3 || /^(ba|bp|hm|uk)$/i.test(trimmed)) {
    return `"${trimmed}" (retail OR store OR UK)`;
  }
  return `"${trimmed}" UK`;
}

export async function ensureBrandGoogleNewsFeeds(): Promise<{ created: number; total: number }> {
  const tracked = await db
    .select({ id: crmCompanies.id, name: crmCompanies.name })
    .from(crmCompanies)
    .where(and(eq(crmCompanies.isTrackedBrand, true), sql`${crmCompanies.mergedIntoId} IS NULL`));

  let created = 0;
  for (const brand of tracked) {
    const categoryTag = `${BRAND_CATEGORY_PREFIX}${brand.id}`;
    const existing = await db
      .select({ id: newsSources.id })
      .from(newsSources)
      .where(eq(newsSources.category, categoryTag))
      .limit(1);
    if (existing.length > 0) continue;

    const query = googleNewsQueryForBrand(brand.name);
    const feedUrl = googleNewsRssUrl(query);
    await db.insert(newsSources).values({
      name: `${brand.name} (Google News)`,
      url: `https://news.google.com/search?q=${encodeURIComponent(query)}`,
      feedUrl,
      type: "google_news",
      category: categoryTag,
      active: true,
    });
    created++;
  }
  return { created, total: tracked.length };
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
    .select({ id: crmCompanies.id, name: crmCompanies.name })
    .from(crmCompanies)
    .where(and(eq(crmCompanies.isTrackedBrand, true), sql`${crmCompanies.mergedIntoId} IS NULL`));
  const brandIndex = brands
    .map((b) => ({ id: b.id, name: b.name, normalized: normalizeBrandName(b.name) }))
    .filter((b) => b.normalized.length >= 3);

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
      await upsertBrandSignal(brandId, brandNameById.get(brandId) || "", {
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
