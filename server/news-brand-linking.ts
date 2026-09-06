// Links ingested news articles to tracked brands and creates brand_signals.
// Also auto-maintains a Google News RSS feed per tracked brand.
import { db, pool } from "./db";
import { crmCompanies, newsSources, newsArticles, brandSignals } from "@shared/schema";
import { eq, and, sql, desc, isNotNull, ilike } from "drizzle-orm";
import { googleNewsRssUrl, createRssAppFeed, rssappHealth } from "./rssapp";
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
// Category guess from the extraction → crm company_type. Unknown/other
// falls back to a bare "Tenant" brand for the team to categorise.
const NEWSLETTER_CATEGORY_TO_TYPE: Record<string, string> = {
  "restaurant": "Tenant - Restaurant",
  "cafe": "Tenant - Café",
  "bar": "Tenant - Bar",
  "pub": "Tenant - Bar",
  "quick service": "Tenant - Quick Service",
  "bakery": "Tenant - Bakery",
  "gym": "Tenant - Gym",
  "wellness": "Tenant - Wellness",
  "cinema": "Tenant - Cinema",
  "leisure": "Tenant - Leisure",
  "grocery": "Tenant - Grocery",
  "fashion": "Tenant - Fashion",
  "retail": "Tenant - Retail",
};

// Sanity gate before minting a CRM row from a newsletter mention — the
// extraction is good but not infallible, and a junk brand poisons feeds,
// scores and the brand book until someone notices.
function plausibleNewBrandName(name: string): boolean {
  const t = name.trim();
  if (t.length < 3 || t.length > 60) return false;
  if (!/[a-zA-Z]/.test(t)) return false;
  const norm = normalizeBrandName(t);
  if (!norm || norm.length < 3) return false;
  if (COMMON_WORD_BRAND_TOKENS.has(norm)) return false;
  // Sector phrases masquerading as names ("Hospitality Sector", "QSR Market")
  if (/^(the )?(uk |british )?(hospitality|restaurant|pub|retail|leisure|grocery|qsr|f&b)s? ?(sector|industry|market|operators?|report)?$/i.test(t)) return false;
  return true;
}

export async function extractBrandSignalsFromNewsletter(opts: {
  subject: string;
  from: string;
  bodyText: string;
  receivedAt?: string;
}): Promise<number> {
  // All live companies, not just Tenant-typed brands — an unmatched operator
  // may exist in the CRM as another type (adopt the Tenant type) or not at
  // all (auto-add).
  const all = await db
    .select({ id: crmCompanies.id, name: crmCompanies.name, companyType: crmCompanies.companyType })
    .from(crmCompanies)
    .where(sql`${crmCompanies.mergedIntoId} IS NULL`);
  const isBrandType = (t: string | null | undefined) => /^tenant/i.test(t || "");
  const byNorm = new Map<string, { id: string; name: string; companyType: string | null }>();
  for (const c of all) {
    const k = normalizeBrandName(c.name);
    const prev = byNorm.get(k);
    if (!prev || (!isBrandType(prev.companyType) && isBrandType(c.companyType))) byNorm.set(k, c);
  }

  let items: any[] = [];
  try {
    const r = await callClaude({
      model: CHATBGP_HELPER_MODEL,
      max_completion_tokens: 2000,
      temperature: 0,
      messages: [{
        role: "user",
        content: `Extract the brand/operator-specific events from this trade newsletter. Return STRICT JSON array only (possibly empty):\n` +
          `[{"brand": "operator name exactly as written", "brandKind": "operator"|"landlord_or_investor"|"other", "category": "restaurant"|"cafe"|"bar"|"pub"|"quick service"|"bakery"|"gym"|"wellness"|"cinema"|"leisure"|"grocery"|"fashion"|"retail"|"other", "headline": "one-line event summary", "signalType": "opening"|"closure"|"funding"|"exec_change"|"sector_move"|"news", "magnitude": "small"|"medium"|"large", "sentiment": "positive"|"neutral"|"negative"}]\n` +
          `"brandKind": "operator" = a business that occupies/trades from premises (restaurant group, retailer, gym chain); "landlord_or_investor" = landlord, REIT, investor, developer or property agent; "other" = anything else.\n` +
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

  // Match extracted names against the CRM locally — the model names the
  // brand explicitly, so exact normalised-name equality is safe (no
  // substring collisions possible here).
  await ensureAiRelevantColumn();
  const sourceKey = `newsletter:${(opts.receivedAt || "").slice(0, 10)}:${opts.subject.slice(0, 100)}`;
  // A material event about an operator we don't track is precisely the
  // intel Propel is for — operators surface here BEFORE they're on anyone's
  // radar. Auto-add them (capped per email).
  const materialFor = (it: any) =>
    ["opening", "closure", "funding", "exec_change", "sector_move"].includes(it.signalType) &&
    ["medium", "large"].includes(it.magnitude || "medium");
  let autoCreated = 0;
  const AUTO_CREATE_CAP = 5;
  let inserted = 0;
  for (const it of items) {
    if (!it.headline) continue;
    const rawName = String(it.brand || "").trim();
    const norm = normalizeBrandName(rawName);
    let brand = byNorm.get(norm);
    const isOperator = (it.brandKind || "operator") === "operator";

    if (brand && !isBrandType(brand.companyType) && isOperator && materialFor(it)) {
      // Known company without a Tenant type — adopt one instead of
      // duplicating, but never reclassify a row that's deliberately
      // something else (landlord/agent/client/investor).
      if (!brand.companyType || !/landlord|agent|client|investor/i.test(brand.companyType)) {
        const companyType = NEWSLETTER_CATEGORY_TO_TYPE[String(it.category || "").toLowerCase()] || "Tenant";
        await db.update(crmCompanies)
          .set({ companyType })
          .where(eq(crmCompanies.id, brand.id))
          .catch((e: any) => console.warn("[newsletter-signals] type adopt failed:", e?.message));
        brand.companyType = companyType;
        console.log(`[newsletter-signals] typed existing company "${brand.name}" as ${companyType} (${it.signalType})`);
      }
    }

    if (!brand) {
      if (!isOperator || !materialFor(it) || !plausibleNewBrandName(rawName) || autoCreated >= AUTO_CREATE_CAP) continue;
      try {
        const companyType = NEWSLETTER_CATEGORY_TO_TYPE[String(it.category || "").toLowerCase()] || "Tenant";
        const [created] = await db.insert(crmCompanies)
          .values({
            name: rawName,
            companyType,
          } as any)
          .returning({ id: crmCompanies.id, name: crmCompanies.name });
        if (!created) continue;
        brand = { id: created.id, name: created.name, companyType };
        byNorm.set(norm, brand);
        autoCreated++;
        console.log(`[newsletter-signals] auto-added brand "${rawName}" (${companyType}) — ${it.signalType}: ${String(it.headline).slice(0, 120)}`);
      } catch (e: any) {
        console.warn(`[newsletter-signals] auto-add failed for "${rawName}":`, e?.message);
        continue;
      }
    }
    if (!isBrandType(brand.companyType)) continue; // non-material mention of a non-brand company — not signal-worthy
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
    .where(and(ilike(crmCompanies.companyType, "tenant%"), sql`${crmCompanies.mergedIntoId} IS NULL`));

  let created = 0;
  let refreshed = 0;
  for (const brand of tracked) {
    const categoryTag = `${BRAND_CATEGORY_PREFIX}${brand.id}`;
    const query = googleNewsQueryForBrand(brand.name, brand.industry);
    const feedUrl = googleNewsRssUrl(query);
    const url = `https://news.google.com/search?q=${encodeURIComponent(query)}`;
    // Type filter is load-bearing: a brand's category is shared by its
    // Instagram feed rows, and matching on category alone made the
    // "refresh" below overwrite RSS.app feed urls with Google News queries
    // on every cycle — estate-wide (found via Bill's, 2026-08-19).
    const existing = await db
      .select({ id: newsSources.id, feedUrl: newsSources.feedUrl })
      .from(newsSources)
      .where(and(eq(newsSources.category, categoryTag), eq(newsSources.type, "google_news")))
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

// Repair Instagram sources clobbered by ensureBrandGoogleNewsFeeds (it
// matched brand sources by category alone and overwrote the RSS.app
// url/feed_url with Google News queries on every cycle — estate-wide,
// found via Bill's, 2026-08-19). Re-derive the right RSS.app feed from
// the account by matching the brand's Instagram handle; rows we can't
// match are deleted so the curated top-up recreates them cleanly.
// Idempotent and cheap when nothing is broken.
export async function repairClobberedInstagramSources(): Promise<{ repaired: number; deleted: number } | null> {
  const broken = await pool.query(`
    SELECT ns.id, c.instagram_handle
      FROM news_sources ns
      JOIN crm_companies c ON ns.category = 'brand:' || c.id
     WHERE ns.type = 'rssapp_instagram'
       AND (ns.url ILIKE '%news.google.com%' OR ns.feed_url ILIKE '%news.google.com%')`);
  if (!broken.rows.length) return { repaired: 0, deleted: 0 };
  const key = process.env.RSSAPP_API_KEY;
  const secret = process.env.RSSAPP_API_SECRET;
  if (!key || !secret) return null;
  const byUrl = new Map<string, string>();
  for (let offset = 0; offset < 1000; offset += 100) {
    const res = await fetch(`https://api.rss.app/v1/feeds?limit=100&offset=${offset}`, {
      headers: { Authorization: `Bearer ${key}:${secret}` },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) break;
    const data: any = await res.json();
    for (const f of data.data || []) {
      if (f.source_url && f.rss_feed_url) {
        byUrl.set(String(f.source_url).toLowerCase().replace(/\/+$/, ""), f.rss_feed_url);
      }
    }
    if (!data.data || data.data.length < 100) break;
  }
  let repaired = 0;
  let deleted = 0;
  for (const row of broken.rows) {
    const h = cleanIgHandle(row.instagram_handle);
    const srcUrl = h ? `https://www.instagram.com/${h}` : null;
    const feedUrl = srcUrl ? byUrl.get(srcUrl.toLowerCase()) : null;
    if (srcUrl && feedUrl) {
      await pool.query(`UPDATE news_sources SET url = $1, feed_url = $2, last_fetched_at = NULL WHERE id = $3`,
        [`${srcUrl}/`, feedUrl, row.id]);
      repaired++;
    } else {
      await pool.query(`DELETE FROM news_sources WHERE id = $1`, [row.id]);
      deleted++;
    }
  }
  console.log(`[ig-source repair] repaired ${repaired}, deleted ${deleted} clobbered Instagram source(s)`);
  return { repaired, deleted };
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
    .where(and(ilike(crmCompanies.companyType, "tenant%"), sql`${crmCompanies.mergedIntoId} IS NULL`));

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

// ─── Curated Instagram feed selection ─────────────────────────────────────
// The raw preview above is 1,700+ brand×platform candidates; the RSS.app
// plan carries ~100 feeds. This layer picks the 100 that matter: junk
// handles out, scraper-poisoned duplicates out, then ranked so brands on
// live deals and brands generating news signals get the paid slots.

// Instagram URL path words the old website scraper mistook for profile
// handles (instagram.com/v/…, /s/…, /reel/…), plus spam stamped onto brand
// rows by hacked or parked websites. None of these may ever become a feed.
const IG_JUNK_HANDLES = new Set([
  "v", "s", "p", "explore", "reel", "reels", "tv", "stories", "accounts",
  "share", "about", "developer", "directory", "legal", "web", "api",
  "oauth", "invites", "graphql", "static",
]);

function cleanIgHandle(raw: string | null): string | null {
  const h = (raw || "").replace(/^@/, "").trim().toLowerCase().replace(/\/+$/, "");
  if (h.length < 2 || h.length > 30) return null;
  if (!/^[a-z0-9._]+$/.test(h)) return null;
  if (IG_JUNK_HANDLES.has(h)) return null;
  if (h.includes("togel")) return null; // gambling spam from compromised sites
  return h;
}

const normBrandName = (name: string) => (name || "").toLowerCase().replace(/[^a-z0-9]/g, "");

// Ledger of feed-creation failures. RSS.app can't generate a feed for a
// dead / renamed / private Instagram account — without this, those handles
// were retried on every deploy forever (148 of 248 attempts on the first
// full run), starving working brands below them of quota slots. Three
// strikes and a handle stops being tried; pinned operators are exempt.
let failTableEnsured = false;
async function ensureFailureTable() {
  if (failTableEnsured) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS rssapp_feed_failures (
      url TEXT PRIMARY KEY,
      attempts INT NOT NULL DEFAULT 0,
      last_error TEXT,
      last_attempt TIMESTAMP DEFAULT now()
    )`);
  failTableEnsured = true;
}

// Operators Woody wants watched no matter what the ranking says
// (2026-08-18). Matched on normalised brand name — groups are listed
// alongside their consumer brands since either may hold the tracked row,
// and common name spellings are included so a rename doesn't unpin.
const PINNED_IG_GROUPS: Record<string, string[]> = {
  "Nando's": ["nandos"],
  "Wagamama": ["wagamama"],
  "Five Guys": ["fiveguys"],
  "Wingstop": ["wingstop"],
  "Pizza Express": ["pizzaexpress"],
  "Boparan / Slim Chickens": ["boparan", "boparangroup", "boparanrestaurantgroup", "slimchickens"],
  "Azzurri / Zizzi": ["azzurri", "azzurrigroup", "zizzi"],
  "Troia / Ivy / Bills": ["troia", "troiagroup", "theivy", "ivy", "theivycollection", "ivycollection", "bills", "billsrestaurants"],
  "Arcturus / Pho / Mowgli / Rosa's": ["arcturus", "arcturusgroup", "pho", "mowgli", "mowglistreetfood", "rosas", "rosasthai", "rosasthaicafe"],
  "Big Table (Bella Italia, Banana Tree, F&Bs, Las Iguanas, Chiquito)": ["bigtable", "bigtablegroup", "bellaitalia", "bananatree", "frankiebennys", "frankieandbennys", "lasiguanas", "chiquito"],
};
const PINNED_IG_BRANDS = new Set(Object.values(PINNED_IG_GROUPS).flat());

// Self-heal + report for the pinned list. Ensures every pinned brand row
// is Tenant-typed (non-brand rows never reach the curated plan), then says
// where each requested group stands. Logged at boot so gaps — a group with
// no CRM row at all, or a row with no usable handle — are visible in the
// deploy logs instead of silently unfed.
export async function ensurePinnedIgBrands(): Promise<{ group: string; status: string; detail?: string }[]> {
  const pinnedArr = [...PINNED_IG_BRANDS];
  await pool.query(
    `UPDATE crm_companies
        SET company_type = 'Tenant'
      WHERE merged_into_id IS NULL AND (company_type IS NULL OR company_type NOT ILIKE 'tenant%')
        AND regexp_replace(lower(name), '[^a-z0-9]', '', 'g') = ANY($1::text[])`,
    [pinnedArr],
  );
  const rows = await pool.query(
    `SELECT c.name, c.instagram_handle,
            regexp_replace(lower(c.name), '[^a-z0-9]', '', 'g') AS norm,
            EXISTS (SELECT 1 FROM news_sources ns
                     WHERE ns.category = 'brand:' || c.id AND ns.type = 'rssapp_instagram') AS fed
       FROM crm_companies c
      WHERE c.merged_into_id IS NULL
        AND regexp_replace(lower(c.name), '[^a-z0-9]', '', 'g') = ANY($1::text[])`,
    [pinnedArr],
  );
  const byNorm = new Map<string, any[]>();
  for (const r of rows.rows) {
    const list = byNorm.get(r.norm) || [];
    list.push(r);
    byNorm.set(r.norm, list);
  }
  return Object.entries(PINNED_IG_GROUPS).map(([group, norms]) => {
    const matches = norms.flatMap(n => byNorm.get(n) || []);
    if (!matches.length) return { group, status: "NO CRM ROW" };
    const fed = matches.filter(m => m.fed);
    if (fed.length) return { group, status: "live", detail: fed.map(m => m.name).join(", ") };
    const ready = matches.filter(m => cleanIgHandle(m.instagram_handle));
    if (ready.length) return { group, status: "handle ready — feed on next run", detail: ready.map(m => `${m.name} (@${cleanIgHandle(m.instagram_handle)})`).join(", ") };
    return { group, status: "NO USABLE HANDLE", detail: matches.map(m => m.name).join(", ") };
  });
}

export interface CuratedIgPreview {
  plan: (BrandSocialFeedPlan & { score: number })[];
  totalCandidates: number;
  excluded: { junkHandle: number; duplicateHandle: number; alreadyFed: number; failedRepeatedly: number; overLimit: number };
}

// Read-only: which Instagram feeds WOULD be created, best-first. Dedupe
// rule: the same handle on 3+ brands is scraper poisoning (t2tea,
// workwithatom) — only a brand whose own name matches the handle keeps it.
export async function previewCuratedInstagramFeeds(limit = 100): Promise<CuratedIgPreview> {
  const tracked = await db
    .select({
      id: crmCompanies.id,
      name: crmCompanies.name,
      instagramHandle: crmCompanies.instagramHandle,
    })
    .from(crmCompanies)
    .where(and(ilike(crmCompanies.companyType, "tenant%"), sql`${crmCompanies.mergedIntoId} IS NULL`));

  const excluded = { junkHandle: 0, duplicateHandle: 0, alreadyFed: 0, failedRepeatedly: 0, overLimit: 0 };

  const withHandle = tracked.filter(b => (b.instagramHandle || "").trim() !== "");
  const cleaned = withHandle
    .map(b => ({ ...b, handle: cleanIgHandle(b.instagramHandle) }))
    .filter(b => {
      if (!b.handle) { excluded.junkHandle++; return false; }
      return true;
    }) as ({ id: string; name: string; instagramHandle: string | null; handle: string })[];

  const byHandle = new Map<string, typeof cleaned>();
  for (const b of cleaned) {
    const list = byHandle.get(b.handle) || [];
    list.push(b);
    byHandle.set(b.handle, list);
  }
  const deduped = cleaned.filter(b => {
    const shared = byHandle.get(b.handle)!;
    if (shared.length < 3) return true;
    const nn = normBrandName(b.name);
    const ok = nn.length >= 2 && (b.handle.includes(nn) || nn.includes(b.handle));
    if (!ok) excluded.duplicateHandle++;
    return ok;
  });

  const existingRows = await db
    .select({ category: newsSources.category, type: newsSources.type })
    .from(newsSources)
    .where(sql`${newsSources.category} LIKE 'brand:%'`);
  const alreadyFed = new Set(
    existingRows.filter(r => r.type === SOCIAL_TYPE.instagram).map(r => r.category)
  );
  const fresh = deduped.filter(b => {
    if (alreadyFed.has(`${BRAND_CATEGORY_PREFIX}${b.id}`)) { excluded.alreadyFed++; return false; }
    return true;
  });

  // Skip handles that already failed creation 3+ times — their slots go
  // to brands that work. Pinned operators keep retrying regardless.
  await ensureFailureTable();
  const failedRows = await pool.query(`SELECT url FROM rssapp_feed_failures WHERE attempts >= 3`);
  const failedUrls = new Set(failedRows.rows.map((r: any) => String(r.url)));
  const retryable = fresh.filter(b => {
    if (PINNED_IG_BRANDS.has(normBrandName(b.name))) return true;
    if (failedUrls.has(`https://www.instagram.com/${b.handle}/`)) { excluded.failedRepeatedly++; return false; }
    return true;
  });

  // Rank: pinned operators first (never lose their slot), then brands
  // sitting on a deal, then brands whose news feeds have produced signals
  // recently (they're moving), then name.
  const dealRows = await pool.query(
    `SELECT DISTINCT tenant_id FROM crm_deals WHERE tenant_id IS NOT NULL`
  );
  const onDeal = new Set(dealRows.rows.map((r: any) => String(r.tenant_id)));
  const signalRows = await pool.query(
    `SELECT brand_company_id, COUNT(*)::int AS n FROM brand_signals
      WHERE created_at > now() - interval '180 days'
      GROUP BY brand_company_id`
  );
  const signalCount = new Map<string, number>(signalRows.rows.map((r: any) => [String(r.brand_company_id), r.n]));

  const scored = retryable.map(b => ({
    brandId: b.id,
    brandName: b.name,
    platform: "instagram" as SocialPlatform,
    url: `https://www.instagram.com/${b.handle}/`,
    score: (PINNED_IG_BRANDS.has(normBrandName(b.name)) ? 1000 : 0)
      + (onDeal.has(b.id) ? 10 : 0) + Math.min(5, signalCount.get(b.id) || 0),
  }));
  scored.sort((a, b) => b.score - a.score || a.brandName.localeCompare(b.brandName));

  const plan = scored.slice(0, Math.max(0, limit));
  excluded.overLimit = scored.length - plan.length;
  return { plan, totalCandidates: withHandle.length, excluded };
}

// Create the curated feeds, respecting the RSS.app plan quota (100 feeds
// unless RSSAPP_FEED_QUOTA says otherwise) — existing feeds on the account
// count against it, so this never buys past the plan.
export async function ensureCuratedInstagramFeeds(limit = 100): Promise<{
  created: number; skipped: number; quotaRemaining: number;
  excluded: CuratedIgPreview["excluded"];
  errors: { brandName: string; platform: SocialPlatform; error: string }[];
}> {
  const health = await rssappHealth();
  if (!health.ok) throw new Error(`RSS.app not ready: ${health.error}`);
  const quota = Number(process.env.RSSAPP_FEED_QUOTA || 100);
  const room = Math.max(0, quota - (health.feedCount ?? 0));
  const { plan, excluded } = await previewCuratedInstagramFeeds(Math.min(limit, room));

  let created = 0;
  let skipped = 0;
  const errors: { brandName: string; platform: SocialPlatform; error: string }[] = [];
  for (const item of plan) {
    try {
      const feed = await createRssAppFeed(item.url);
      await db.insert(newsSources).values({
        name: `${item.brandName} (instagram)`,
        url: item.url,
        feedUrl: feed.rss_feed_url,
        type: SOCIAL_TYPE.instagram,
        category: `${BRAND_CATEGORY_PREFIX}${item.brandId}`,
        active: true,
      });
      created++;
      await pool.query(`DELETE FROM rssapp_feed_failures WHERE url = $1`, [item.url]).catch(() => {});
    } catch (err: any) {
      const msg = (err?.message || "unknown").slice(0, 200);
      errors.push({ brandName: item.brandName, platform: "instagram", error: msg });
      skipped++;
      await pool.query(
        `INSERT INTO rssapp_feed_failures (url, attempts, last_error, last_attempt)
         VALUES ($1, 1, $2, now())
         ON CONFLICT (url) DO UPDATE SET attempts = rssapp_feed_failures.attempts + 1, last_error = $2, last_attempt = now()`,
        [item.url, msg],
      ).catch(() => {});
    }
    await new Promise(r => setTimeout(r, 300)); // soft pace the RSS.app API
  }
  return { created, skipped, quotaRemaining: Math.max(0, room - created), excluded, errors };
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
  // The URL is an unstable key for Google News articles (the wrapped RSS URL
  // gets unwrapped to the publisher URL by the image backfill, and the next
  // fetch pass re-ingests the story under the other form). Same headline on
  // the same published timestamp for the same brand is the same story.
  if (article.publishedAt) {
    const sameStory = await pool.query(
      `SELECT 1 FROM brand_signals WHERE brand_company_id = $1 AND headline = $2 AND signal_date = $3 LIMIT 1`,
      [brandId, article.title.slice(0, 500), article.publishedAt]
    );
    if (sameStory.rows.length > 0) return;
  }

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
    .where(and(ilike(crmCompanies.companyType, "tenant%"), sql`${crmCompanies.mergedIntoId} IS NULL`));
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
