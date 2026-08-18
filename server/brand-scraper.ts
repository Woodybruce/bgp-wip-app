// ─────────────────────────────────────────────────────────────────────────
// Brand website scraper — daily job.
//
// For each tracked brand with a domain, probes a small set of common
// careers / newsroom paths via ScraperAPI, strips noise, runs Haiku to
// classify any new signals, and inserts them into brand_signals.
//
// Designed to be cheap and resilient:
//   - 4 path probes per brand (careers, jobs, press, newsroom)
//   - Skip render=true (most retail sites SSR these pages)
//   - Skip brands we scraped within the last 24h (idempotent re-runs ok)
//   - Skip pages that haven't changed since last scrape (content hash)
//   - Hard cap: 50 brands per run, 4 paths each = 200 ScraperAPI calls
//
// Path discovery is heuristic — we try common URLs rather than crawling.
// 90%+ of retail brands use one of these slugs.
//
// Endpoints:
//   POST /api/brand/:companyId/scrape        — one brand
//   POST /api/brand-scraper/run              — admin: kick a batch
// ─────────────────────────────────────────────────────────────────────────
import { Router, type Request, type Response } from "express";
import { requireAuth, requireAdmin } from "./auth";
import { pool } from "./db";
import { scraperFetch, isScraperApiAvailable } from "./utils/scraperapi";
import Anthropic from "@anthropic-ai/sdk";
import { safeParseJSON } from "./utils/anthropic-client";
import crypto from "crypto";

const router = Router();
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const HAIKU = "claude-haiku-4-5-20251001";

const PATHS_TO_TRY = [
  { path: "/careers", kind: "careers" },
  { path: "/jobs", kind: "careers" },
  { path: "/press", kind: "press" },
  { path: "/newsroom", kind: "press" },
];

const MAX_BRANDS_PER_RUN = 50;
const STALE_HOURS = 24;

// ─── Schema ──────────────────────────────────────────────────────────────

async function ensureScraperLogTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS brand_scraper_log (
      id SERIAL PRIMARY KEY,
      brand_company_id VARCHAR NOT NULL,
      url TEXT NOT NULL,
      kind TEXT NOT NULL,
      status_code INTEGER,
      content_hash TEXT,
      signals_added INTEGER DEFAULT 0,
      scraped_at TIMESTAMP DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_brand_scraper_log_brand ON brand_scraper_log(brand_company_id, scraped_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_brand_scraper_log_url ON brand_scraper_log(brand_company_id, url);
  `);
}

// ─── HTML utilities ──────────────────────────────────────────────────────

function htmlToText(html: string): string {
  // Quick + dirty: strip script/style, then tags. Good enough for AI input.
  let s = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  // Cap at 8KB — saves Haiku tokens; landing pages always paginate jobs/news
  if (s.length > 8000) s = s.slice(0, 8000);
  return s;
}

function hashContent(s: string): string {
  return crypto.createHash("sha1").update(s).digest("hex").slice(0, 16);
}

function buildBrandRoot(brand: { domain?: string | null; domain_url?: string | null }): string | null {
  const raw = brand.domain_url || brand.domain;
  if (!raw) return null;
  try {
    const url = raw.startsWith("http") ? new URL(raw) : new URL(`https://${raw}`);
    return `${url.protocol}//${url.hostname}`;
  } catch {
    return null;
  }
}

// ─── Per-brand scrape ────────────────────────────────────────────────────

interface ScrapeResult {
  brandId: string;
  brandName: string;
  pagesAttempted: number;
  pagesFetched: number;
  signalsAdded: number;
  error?: string;
}

export async function scrapeBrand(brandId: string): Promise<ScrapeResult> {
  await ensureScraperLogTable();

  const bq = await pool.query(
    `SELECT id, name, industry, domain, domain_url FROM crm_companies WHERE id = $1`,
    [brandId]
  );
  const brand = bq.rows[0];
  if (!brand) return { brandId, brandName: "?", pagesAttempted: 0, pagesFetched: 0, signalsAdded: 0, error: "not found" };

  const result: ScrapeResult = { brandId, brandName: brand.name, pagesAttempted: 0, pagesFetched: 0, signalsAdded: 0 };

  if (!isScraperApiAvailable()) {
    result.error = "ScraperAPI not configured";
    return result;
  }

  const root = buildBrandRoot(brand);
  if (!root) {
    result.error = "no domain";
    return result;
  }

  for (const { path, kind } of PATHS_TO_TRY) {
    const url = `${root}${path}`;
    result.pagesAttempted++;

    // Skip if scraped recently for this brand+url and no content change last time
    const recent = await pool.query(
      `SELECT scraped_at FROM brand_scraper_log
        WHERE brand_company_id = $1 AND url = $2
        ORDER BY scraped_at DESC LIMIT 1`,
      [brandId, url]
    );
    if (recent.rows[0] && new Date(recent.rows[0].scraped_at) > new Date(Date.now() - STALE_HOURS * 3600 * 1000)) {
      continue;
    }

    let res: globalThis.Response;
    try {
      res = await scraperFetch(url, { uk: true, render: false, timeoutMs: 25000 });
    } catch (err: any) {
      await pool.query(
        `INSERT INTO brand_scraper_log (brand_company_id, url, kind, status_code, content_hash, signals_added)
         VALUES ($1, $2, $3, $4, NULL, 0)
         ON CONFLICT (brand_company_id, url) DO UPDATE SET status_code = EXCLUDED.status_code, scraped_at = now()`,
        [brandId, url, kind, 0]
      );
      continue;
    }

    if (!res.ok) {
      await pool.query(
        `INSERT INTO brand_scraper_log (brand_company_id, url, kind, status_code, content_hash, signals_added)
         VALUES ($1, $2, $3, $4, NULL, 0)
         ON CONFLICT (brand_company_id, url) DO UPDATE SET status_code = EXCLUDED.status_code, scraped_at = now()`,
        [brandId, url, kind, res.status]
      );
      continue;
    }

    const html = await res.text().catch(() => "");
    if (html.length < 200) continue;

    const text = htmlToText(html);
    const hash = hashContent(text);

    // Skip if content unchanged since last scrape
    const prevHash = await pool.query(
      `SELECT content_hash FROM brand_scraper_log WHERE brand_company_id = $1 AND url = $2 LIMIT 1`,
      [brandId, url]
    );
    if (prevHash.rows[0]?.content_hash === hash) {
      await pool.query(
        `UPDATE brand_scraper_log SET scraped_at = now() WHERE brand_company_id = $1 AND url = $2`,
        [brandId, url]
      );
      continue;
    }

    result.pagesFetched++;

    // Haiku classification
    const signals = await classifyPageWithHaiku(brand.name, kind, text);
    let added = 0;
    for (const s of signals) {
      if (!s.headline || !s.signal_type) continue;
      const dup = await pool.query(
        `SELECT id FROM brand_signals
          WHERE brand_company_id = $1 AND headline = $2
            AND created_at >= now() - interval '60 days'`,
        [brandId, s.headline]
      );
      if (dup.rows.length > 0) continue;
      await pool.query(
        `INSERT INTO brand_signals (brand_company_id, signal_type, headline, detail, source, magnitude, sentiment, ai_generated)
         VALUES ($1, $2, $3, $4, $5, $6, $7, true)`,
        [brandId, s.signal_type, s.headline, s.detail || null, url, s.magnitude || "small", s.sentiment || "neutral"]
      );
      added++;
    }
    result.signalsAdded += added;

    await pool.query(
      `INSERT INTO brand_scraper_log (brand_company_id, url, kind, status_code, content_hash, signals_added)
         VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (brand_company_id, url) DO UPDATE SET
         status_code = EXCLUDED.status_code,
         content_hash = EXCLUDED.content_hash,
         signals_added = EXCLUDED.signals_added,
         scraped_at = now()`,
      [brandId, url, kind, 200, hash, added]
    );
  }

  return result;
}

async function classifyPageWithHaiku(brandName: string, kind: string, text: string): Promise<any[]> {
  const prompt = kind === "careers"
    ? `You are extracting retail-property-relevant signals from a brand's careers page.

Brand: ${brandName}
Page text:
${text}

Look for postings that signal:
- Property, real-estate, store-development, or expansion roles → "exec_change", magnitude=large
- Multiple new store-manager / sales-associate roles in one location → "opening", magnitude=medium
- UK-specific hiring when the brand isn't UK-resident → "sector_move", magnitude=large

Return a JSON array of signals using this schema (return [] if nothing material):
{
  "signal_type": "exec_change" | "opening" | "sector_move" | "news",
  "headline": "<short, e.g. 'Hiring Director of UK Real Estate'>",
  "detail": "<1-2 sentences quoting key info>",
  "magnitude": "small" | "medium" | "large",
  "sentiment": "positive"
}

Strict: ONLY valid JSON array. No commentary. Skip generic HQ corporate roles.`
    : `You are extracting retail-property-relevant signals from a brand's press / newsroom page.

Brand: ${brandName}
Page text:
${text}

Look for press releases that signal:
- New store openings, flagships, expansion announcements → "opening"
- Closures, restructuring → "closure"
- Funding, IPO, M&A → "funding"
- Leadership changes → "exec_change"
- Strategic pivots (new format, DTC→physical) → "sector_move"

Return a JSON array of signals using this schema (return [] if nothing material):
{
  "signal_type": "opening" | "closure" | "funding" | "exec_change" | "sector_move" | "news",
  "headline": "<one-line summary>",
  "detail": "<2 sentences>",
  "magnitude": "small" | "medium" | "large",
  "sentiment": "positive" | "neutral" | "negative"
}

Strict: ONLY valid JSON array. Skip product launches, sustainability fluff, sponsorship news.`;

  try {
    const msg = await anthropic.messages.create({
      model: HAIKU,
      max_tokens: 1200,
      messages: [{ role: "user", content: prompt }],
    });
    const out = msg.content.map((b: any) => b.type === "text" ? b.text : "").join("").trim();
    const parsed = safeParseJSON(out);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err: any) {
    console.warn(`[brand-scraper] Haiku classify failed (${brandName}/${kind}): ${err.message}`);
    return [];
  }
}

// ─── Bulk runner ─────────────────────────────────────────────────────────

export async function runDailyBrandScraper(): Promise<{ scanned: number; signalsAdded: number; errors: number }> {
  await ensureScraperLogTable();

  // Pick brands whose last scrape was longest ago (or never)
  const brands = await pool.query(
    `SELECT c.id FROM crm_companies c
        LEFT JOIN (
          SELECT brand_company_id, MAX(scraped_at) AS last_scrape
            FROM brand_scraper_log
           GROUP BY brand_company_id
        ) sl ON sl.brand_company_id = c.id
       WHERE c.is_tracked_brand = true
         AND c.merged_into_id IS NULL
         AND COALESCE(c.domain, c.domain_url) IS NOT NULL
       ORDER BY sl.last_scrape ASC NULLS FIRST
       LIMIT $1`,
    [MAX_BRANDS_PER_RUN]
  );

  let signalsAdded = 0;
  let errors = 0;

  for (const b of brands.rows) {
    const r = await scrapeBrand(b.id);
    if (r.error) errors++;
    signalsAdded += r.signalsAdded;
    await new Promise(r => setTimeout(r, 1000)); // soft pace
  }

  console.log(`[brand-scraper] scanned ${brands.rows.length} brands, +${signalsAdded} signals, ${errors} errors`);
  return { scanned: brands.rows.length, signalsAdded, errors };
}

// Extract the brand's Instagram handle from a homepage / footer HTML blob.
// Returns the bare handle (no @, no domain) or null. Skips obvious non-handle
// paths (instagram.com/p/..., /explore/, /reel/, etc).
function extractInstagramHandle(html: string): string | null {
  if (!html) return null;
  // Match instagram.com/handle — handle is 2-30 chars, letters/digits/._
  // (single-char "handles" are URL path segments like /v/ video and /s/
  // story-share links, which poisoned rows before — see ig_handle_poison_v1).
  const re = /instagram\.com\/([a-zA-Z0-9._]{2,30})/gi;
  const banned = new Set([
    "p", "explore", "reel", "reels", "tv", "stories", "accounts", "about",
    "developer", "directory", "legal", "share", "web", "api", "oauth",
    "invites", "graphql", "static",
  ]);
  for (const m of html.matchAll(re)) {
    const h = m[1].toLowerCase().replace(/[._]+$/, "");
    if (!h || h.length < 2 || banned.has(h) || h.includes("togel")) continue;
    return m[1];
  }
  return null;
}

// Backfill instagram_handle for brands that don't have one. Strategy:
//   1. Scrape the homepage WITH JS rendering (render: true) so SPA sites
//      like Aesop / Glossier hydrate their footer social links before we
//      look for them. The previous render=false hit only the initial HTML
//      and missed every modern brand site.
//   2. If the regex still finds nothing (some sites don't link IG from
//      the homepage at all), ask Haiku to suggest the handle for the
//      brand. We only accept the AI's answer if it's a plausible IG
//      handle string — letters/digits/dot/underscore, 1-30 chars.
//
// Covers every brand with a domain (no longer gated on is_tracked_brand)
// so we get full coverage rather than the slow auto-enrichment cycle.
// Scheduled weekly by the Sunday cron in server/index.ts.
export async function backfillInstagramHandles(limit = 500): Promise<{
  attempted: number; filled: number; filledFromHtml: number; filledFromAi: number; skipped: number; errors: number;
}> {
  const rows = await pool.query<{ id: string; name: string; domain: string | null; domain_url: string | null }>(
    `SELECT id, name, domain, domain_url FROM crm_companies
      WHERE (instagram_handle IS NULL OR instagram_handle = '')
        AND (domain IS NOT NULL OR domain_url IS NOT NULL)
        AND merged_into_id IS NULL
      ORDER BY is_tracked_brand DESC, name
      LIMIT $1`,
    [limit]
  );
  let filled = 0, filledFromHtml = 0, filledFromAi = 0, skipped = 0, errors = 0;

  for (const b of rows.rows) {
    const root = buildBrandRoot(b);
    if (!root) { skipped++; continue; }

    let handle: string | null = null;

    // Step 1 — render the homepage with JS so SPA footers materialise.
    // Requires ScraperAPI for the render proxy; if not configured, we'll
    // skip straight to the AI fallback.
    if (isScraperApiAvailable()) {
      try {
        const res = await scraperFetch(root, { uk: true, render: true, timeoutMs: 30000 });
        if (res.ok) {
          const html = await res.text().catch(() => "");
          handle = extractInstagramHandle(html);
          if (handle) filledFromHtml++;
        }
      } catch {
        // fall through to AI
      }
    }

    // Step 2 — ask Haiku. Cheap, well-known brands (Aesop, Glossier, etc)
    // are reliably resolved this way even when their site hides the link.
    if (!handle && process.env.ANTHROPIC_API_KEY) {
      try {
        handle = await askAiForInstagramHandle(b.name, root);
        if (handle) filledFromAi++;
      } catch {
        // fall through to skipped
      }
    }

    if (!handle) { skipped++; continue; }

    try {
      await pool.query(
        `UPDATE crm_companies SET instagram_handle = $1 WHERE id = $2 AND (instagram_handle IS NULL OR instagram_handle = '')`,
        [handle, b.id]
      );
      filled++;
    } catch {
      errors++;
    }
  }
  return { attempted: rows.rows.length, filled, filledFromHtml, filledFromAi, skipped, errors };
}

// AI fallback: ask Haiku for the brand's primary IG handle. We give it
// the brand name + website so it can disambiguate similarly-named brands.
// Strict validation on the way out — Haiku can hallucinate, so anything
// that isn't a plain a-z/0-9/./_ string gets rejected.
async function askAiForInstagramHandle(brandName: string, websiteUrl: string): Promise<string | null> {
  const prompt = `What is the primary Instagram handle for the brand "${brandName}" (website: ${websiteUrl})? Respond with just the handle, no @, no other text. If you don't know with high confidence, respond with the single word "unknown".`;
  const msg = await anthropic.messages.create({
    model: HAIKU,
    max_tokens: 50,
    messages: [{ role: "user", content: prompt }],
  });
  const txt = msg.content
    .map((b: any) => (b.type === "text" ? b.text : ""))
    .join("")
    .trim()
    .replace(/^@/, "");
  if (!txt || txt.toLowerCase() === "unknown") return null;
  if (!/^[a-zA-Z0-9._]{1,30}$/.test(txt)) return null;
  return txt;
}

// ─── Endpoints ───────────────────────────────────────────────────────────

router.post("/api/admin/backfill-instagram-handles", requireAuth, requireAdmin, async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(String(req.body?.limit || req.query.limit || 500), 10) || 500, 3000);
    // Run async so the request doesn't time out on Railway (~60s proxy limit).
    backfillInstagramHandles(limit)
      .then(r => console.log(`[ig backfill] ${r.filled}/${r.attempted} filled, ${r.skipped} skipped, ${r.errors} errors`))
      .catch(e => console.error("[ig backfill] failed:", e?.message));
    res.json({ started: true, limit });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/brand/:companyId/scrape", requireAuth, async (req: Request, res: Response) => {
  try {
    const r = await scrapeBrand(String(req.params.companyId));
    res.json(r);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/brand-scraper/run", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId as string;
    const adminCheck = await pool.query(`SELECT is_admin FROM users WHERE id = $1`, [userId]);
    if (!adminCheck.rows[0]?.is_admin) return res.status(403).json({ error: "Admin only" });
    runDailyBrandScraper().catch(e => console.error("[brand-scraper] run failed:", e?.message));
    res.json({ started: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
