// Links ingested news articles to tracked brands and creates brand_signals.
// Also auto-maintains a Google News RSS feed per tracked brand.
import { db, pool } from "./db";
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
  { signalType: SignalType; magnitude: Magnitude; sentiment: Sentiment; aboutBrand: boolean | null } | null
> {
  const haveKey = !!(process.env.ANTHROPIC_API_KEY || process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY);
  if (!haveKey) return null;

  const prompt = `Classify this news headline about the brand "${brandName}" into a structured signal.

Headline: ${title}
${summary ? `Summary: ${summary.slice(0, 400)}` : ""}

Respond with JSON only:
{
  "aboutBrand": true or false,
  "signalType": one of ["opening","closure","funding","exec_change","sector_move","news","rumour"],
  "magnitude":  one of ["small","medium","large"],
  "sentiment":  one of ["positive","neutral","negative"]
}

Rules:
- "aboutBrand" = is this story genuinely about the company "${brandName}" (the brand a UK property advisor tracks)?
  false when the name only appears as an ordinary English word, a person's surname,
  a news publisher credit (e.g. "- Sky News"), a different company/institution, or when
  the story is really about ANOTHER company that merely gets compared or mentioned.
- "opening" = new store/flagship/branch opening
- "closure" = store closure, administration, bankruptcy
- "funding" = raise, investment, acquisition, IPO
- "exec_change" = new CEO/CFO/founder hire or departure AT THIS COMPANY
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
      aboutBrand: typeof parsed.aboutBrand === "boolean" ? parsed.aboutBrand : null,
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
    bills: ' -"food bills" -"energy bills" -"tax bill" -"tax bills" -"household bills" -"utility bills" -"vet bills" -"medical bills" -"grocery bills"',
    "bill's": ' -"food bills" -"energy bills" -"tax bills" -"household bills"',
    oliver: ' -"jamie oliver"',
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
    bills: /\b(food|energy|tax|household|utility|utilities|vet|medical|grocery|water|gas|electricity|phone|fuel|shopping|rising|heating) bills?\b|\bbills? (rise|rising|soar|surge|jump|hike)\b|\bbritish gas\b|\bcost of living\b|\bmartin lewis\b|\bheating or eating\b|\bbuffalo\b|\bbills (vs|at|@|gm|qb|wr|rb|te|coach|roster|draft|offense|defense)\b|\bespn\b|\bnfl\b|\bquarterback\b|\btouchdown\b|\bkeon coleman\b|\bjosh allen\b|\btrump\b|\bpresident\b|\bcongress\b|\bsenate\b/,
    "bill's": /\b(food|energy|tax|household|utility|vet|medical|grocery) bills?\b|\bcost of living\b/,
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

// ── AI relevance judge ──────────────────────────────────────────────────
// The hardcoded lists above catch known collisions, but every ambiguous
// brand name needs its own entry — "Bills" the restaurant drowned in food/
// energy/tax-bills headlines because nobody had added it. This judge asks
// Haiku once per stored signal whether the headline is really about THIS
// company; the verdict is written to brand_signals.ai_relevant so each row
// is judged exactly once. Callers exclude ai_relevant = false at read time.
let aiRelevantColumnEnsured = false;
async function ensureAiRelevantColumn() {
  if (aiRelevantColumnEnsured) return;
  await pool.query(`ALTER TABLE brand_signals ADD COLUMN IF NOT EXISTS ai_relevant BOOLEAN`).catch(() => {});
  aiRelevantColumnEnsured = true;
}

export async function aiJudgeSignalRelevance(
  brand: { id: string; name: string; industry?: string | null; domain?: string | null },
  rows: Array<{ id: string; headline: string | null; detail: string | null }>,
): Promise<number> {
  if (!rows.length) return 0;
  await ensureAiRelevantColumn();
  let totalJudged = 0;
  // Batches of 40 until every row is judged — a single capped batch left
  // brands with a deep junk backlog (Bills had 80) half-cleaned until the
  // per-brand cooldown expired.
  for (let off = 0; off < rows.length; off += 40) {
  const batch = rows.slice(off, off + 40);
  try {
    const { callClaude } = await import("./chatbgp");
    const completion = await callClaude({
      model: "claude-haiku-4-5-20251001",
      max_completion_tokens: 1200,
      messages: [
        {
          role: "system",
          content:
            "You judge whether news headlines are about a specific COMPANY, or merely contain its name as an ordinary " +
            "word / a different entity. Be strict: 'food bills rise' is NOT about the restaurant chain Bill's; a story " +
            "about a Bill's restaurant opening IS. Output STRICT JSON only: [{\"i\":number,\"relevant\":true|false}].",
        },
        {
          role: "user",
          content: `Company: ${brand.name}${brand.industry ? ` (${brand.industry})` : ""}${brand.domain ? ` — ${brand.domain}` : ""}\nHeadlines:\n` +
            JSON.stringify(batch.map((r, i) => ({ i, headline: r.headline, detail: (r.detail || "").slice(0, 140) }))),
        },
      ],
    });
    const text = completion.choices?.[0]?.message?.content || "";
    const js = JSON.parse(text.slice(text.indexOf("["), text.lastIndexOf("]") + 1)) as Array<{ i: number; relevant: boolean }>;
    let judged = 0;
    for (const v of js) {
      const row = batch[v.i];
      if (!row) continue;
      await pool.query(`UPDATE brand_signals SET ai_relevant = $1 WHERE id = $2`, [!!v.relevant, row.id]);
      judged++;
    }
    const dropped = js.filter((v) => !v.relevant).length;
    if (dropped) console.log(`[signal-judge] ${brand.name}: ${dropped}/${judged} signals marked irrelevant`);
    totalJudged += judged;
  } catch (e: any) {
    console.warn(`[signal-judge] ${brand.name} failed: ${e?.message}`);
    break;
  }
  }
  return totalJudged;
}

// ─── Newsletter → brand signals ──────────────────────────────────────────
// Trade newsletters (Propel's daily round-up especially) pack dozens of
// operator-specific items into one email. The insights feed distils the
// email into theme cards; this extracts the per-brand EVENTS and writes
// them as brand_signals so newsletter intelligence reaches the expansion
// engine and the daily alerts — not just the Insights page.
export async function extractBrandSignalsFromNewsletter(opts: {
  subject: string;
  from: string;
  bodyText: string;
  receivedAt?: string;
}): Promise<number> {
  const tracked = await db
    .select({ id: crmCompanies.id, name: crmCompanies.name })
    .from(crmCompanies)
    .where(and(eq(crmCompanies.isTrackedBrand, true), sql`${crmCompanies.mergedIntoId} IS NULL`));
  if (tracked.length === 0) return 0;
  const byNorm = new Map(tracked.map((b) => [normalizeBrandName(b.name), b]));

  let items: any[] = [];
  try {
    const r = await callClaude({
      model: CHATBGP_HELPER_MODEL,
      max_completion_tokens: 1500,
      temperature: 0,
      messages: [{
        role: "user",
        content: `Extract the brand/operator-specific events from this trade newsletter. Return STRICT JSON array only (possibly empty):\n` +
          `[{"brand": "operator name exactly as written", "headline": "one-line event summary", "signalType": "opening"|"closure"|"funding"|"exec_change"|"sector_move"|"news", "magnitude": "small"|"medium"|"large", "sentiment": "positive"|"neutral"|"negative"}]\n` +
          `Include ONLY material events: site openings/closings, expansion plans, funding/M&A/administration, leadership changes, major trading updates. Skip commentary, opinion pieces, people-round-up trivia, and sector statistics with no named operator. One entry per brand+event.\n\n` +
          `Subject: ${opts.subject}\nFrom: ${opts.from}\n\n${opts.bodyText.slice(0, 9000)}`,
      }],
    });
    const raw = r.choices?.[0]?.message?.content || "";
    const s = raw.indexOf("["), e = raw.lastIndexOf("]");
    if (s < 0 || e <= s) return 0;
    const parsed = JSON.parse(raw.slice(s, e + 1));
    items = Array.isArray(parsed) ? parsed.slice(0, 20) : [];
  } catch (e: any) {
    console.warn(`[newsletter-signals] extraction failed for "${opts.subject}":`, e?.message);
    return 0;
  }

  // Match extracted names against tracked brands locally — the model names
  // the brand explicitly, so exact normalised-name equality is safe (no
  // substring collisions possible here).
  await ensureAiRelevantColumn();
  const sourceKey = `newsletter:${(opts.receivedAt || "").slice(0, 10)}:${opts.subject.slice(0, 100)}`;
  let inserted = 0;
  for (const it of items) {
    const brand = byNorm.get(normalizeBrandName(String(it.brand || "")));
    if (!brand || !it.headline) continue;
    const { rows: dupe } = await pool.query(
      `SELECT 1 FROM brand_signals WHERE brand_company_id = $1 AND source = $2 AND headline = $3 LIMIT 1`,
      [brand.id, sourceKey, String(it.headline).slice(0, 500)],
    );
    if (dupe[0]) continue;
    await pool.query(
      `INSERT INTO brand_signals (brand_company_id, signal_type, headline, detail, source, signal_date, magnitude, sentiment, ai_generated, ai_relevant)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, true)`,
      [
        brand.id,
        ["opening", "closure", "funding", "exec_change", "sector_move", "news"].includes(it.signalType) ? it.signalType : "news",
        String(it.headline).slice(0, 500),
        `Via newsletter: ${opts.subject} (${opts.from})`,
        sourceKey,
        opts.receivedAt ? new Date(opts.receivedAt) : new Date(),
        ["small", "medium", "large"].includes(it.magnitude) ? it.magnitude : "medium",
        ["positive", "neutral", "negative"].includes(it.sentiment) ? it.sentiment : "neutral",
      ],
    ).catch(() => {});
    inserted++;
  }
  return inserted;
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
// Brand names that double as everyday English words. A lowercase word-boundary
// match on these pulled in publisher credits ("- Sky News" → Sky), surnames
// (Fed's Lisa Cook → COOK) and plain prose ("until", "next", "fuel", "pitch").
// For these we require the token to appear with the brand's own casing —
// "COOK" or "Sky" as a standalone capitalised token — before linking.
const COMMON_WORD_BRAND_TOKENS = new Set([
  "sky", "next", "cook", "until", "fuel", "pitch", "base", "oliver", "supreme",
  "coach", "monsoon", "jigsaw", "diesel", "pandora", "boots", "river", "bills",
  "mountain", "fat face", "gap", "mango", "space", "end", "size",
]);

// Google News (and most aggregators) append " - Publisher" to titles. Strip it
// before matching so "Story headline - Sky News" can't link the brand Sky.
function stripPublisherSuffix(title: string): string {
  return title.replace(/\s[-–—|·]\s[^-–—|·]{2,60}$/, "");
}

async function linkArticleToBrands(article: {
  id: string;
  url: string;
  title: string;
  summary: string | null;
  sourceId: string | null;
  publishedAt: Date | null;
  aiSummary: string | null;
}, brandIndex: { id: string; name: string; normalized: string }[]): Promise<string[]> {
  const rawHaystack = [stripPublisherSuffix(article.title), article.summary || "", article.aiSummary || ""].join(" ");
  const haystack = rawHaystack.toLowerCase();
  const hits: string[] = [];
  for (const b of brandIndex) {
    if (b.normalized.length < 3) continue;
    const token = b.normalized;
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (COMMON_WORD_BRAND_TOKENS.has(token)) {
      // Case-sensitive: the brand's own capitalisation, standalone.
      const brandCased = b.name.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const reCased = new RegExp(`(^|[^A-Za-z0-9])${brandCased}([^A-Za-z0-9]|$)`);
      if (reCased.test(rawHaystack)) hits.push(b.id);
      continue;
    }
    // word-boundary match against normalized brand name
    const re = new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i");
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

  const [inserted] = await db.insert(brandSignals).values({
    brandCompanyId: brandId,
    signalType: classified?.signalType || "news",
    headline: article.title.slice(0, 500),
    detail: article.summary?.slice(0, 1000) || null,
    source: article.url,
    signalDate: article.publishedAt || new Date(),
    magnitude: classified?.magnitude || null,
    sentiment: classified?.sentiment || null,
    aiGenerated: !!classified,
  }).returning({ id: brandSignals.id });

  // Ingest-time relevance verdict — the same ai_relevant column the lazy
  // profile-page judge writes, so alerts/profile/score all filter junk the
  // moment it lands instead of waiting for someone to open the profile.
  if (inserted && classified && classified.aboutBrand !== null) {
    await ensureAiRelevantColumn();
    await pool.query(`UPDATE brand_signals SET ai_relevant = $1 WHERE id = $2`, [classified.aboutBrand, inserted.id]).catch(() => {});
  }
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
      const brandName = brandNameById.get(brandId) || "";
      // The per-brand feeds get this filter above; the generic fuzzy path was
      // skipping it — which is how publisher credits and surnames became
      // brand signals. Apply it here too.
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
