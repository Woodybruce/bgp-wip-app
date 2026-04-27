// ─────────────────────────────────────────────────────────────────────────
// Brand social scraper — weekly cron.
//
// For each tracked brand with an instagram_handle or tiktok_handle, fetches
// the public profile page via ScraperAPI and parses follower counts from
// the og:description meta tag. No login required, but Instagram/TikTok
// occasionally change their HTML — caller should expect ~10% miss rate.
//
// LinkedIn is login-walled and is intentionally skipped.
//
// Storage: brand_social_stats (one row per brand × platform × scrape).
// Reads typically take the most recent row per (brand, platform).
//
// Endpoints (admin):
//   POST /api/brand/:companyId/social-scrape   — one brand, both platforms
//   POST /api/brand-social-scraper/run         — kick the weekly batch
// ─────────────────────────────────────────────────────────────────────────
import { Router, type Request, type Response } from "express";
import { requireAuth } from "./auth";
import { pool } from "./db";
import { scraperFetch, isScraperApiAvailable } from "./utils/scraperapi";

const router = Router();

const MAX_BRANDS_PER_RUN = 100;
const STALE_DAYS = 7;

async function ensureSocialStatsTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS brand_social_stats (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      brand_company_id VARCHAR NOT NULL,
      platform TEXT NOT NULL,
      handle TEXT NOT NULL,
      followers INTEGER,
      following INTEGER,
      posts INTEGER,
      fetched_at TIMESTAMP DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_brand_social_stats_brand_platform_time
      ON brand_social_stats(brand_company_id, platform, fetched_at DESC);
  `);
}

// ─── Parsers ─────────────────────────────────────────────────────────────

// Instagram public profile pages embed: <meta property="og:description"
// content="42K Followers, 320 Following, 1,234 Posts - See Instagram photos
// and videos from H&M (@hm)">
function parseInstagram(html: string): { followers: number | null; following: number | null; posts: number | null } {
  const ogMatch = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i);
  const desc = ogMatch?.[1] || "";
  const followers = parseCount(desc.match(/([\d.,KMm]+)\s+Followers/i)?.[1]);
  const following = parseCount(desc.match(/([\d.,KMm]+)\s+Following/i)?.[1]);
  const posts = parseCount(desc.match(/([\d.,KMm]+)\s+Posts/i)?.[1]);
  return { followers, following, posts };
}

// TikTok profile pages embed: <strong title="Followers" data-e2e="followers-count">42M</strong>
// or in og:description: "@hm 12.3M Followers. Watch the latest video..."
function parseTikTok(html: string): { followers: number | null; following: number | null; posts: number | null } {
  // Try data-e2e markup first (most reliable)
  const followersMatch = html.match(/data-e2e=["']followers-count["'][^>]*>([\d.,KMm]+)</i);
  const followingMatch = html.match(/data-e2e=["']following-count["'][^>]*>([\d.,KMm]+)</i);
  const likesMatch = html.match(/data-e2e=["']likes-count["'][^>]*>([\d.,KMm]+)</i);

  if (followersMatch) {
    return {
      followers: parseCount(followersMatch[1]),
      following: parseCount(followingMatch?.[1]),
      posts: parseCount(likesMatch?.[1]),
    };
  }

  // Fallback: og:description
  const ogMatch = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i);
  const desc = ogMatch?.[1] || "";
  const f = desc.match(/([\d.,KMm]+)\s+Followers/i)?.[1];
  return {
    followers: parseCount(f),
    following: null,
    posts: null,
  };
}

function parseCount(s: string | undefined): number | null {
  if (!s) return null;
  const cleaned = s.replace(/,/g, "").trim();
  const m = cleaned.match(/^([\d.]+)\s*([KMm]?)$/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!isFinite(n)) return null;
  const suffix = m[2]?.toUpperCase() || "";
  if (suffix === "K") return Math.round(n * 1_000);
  if (suffix === "M") return Math.round(n * 1_000_000);
  return Math.round(n);
}

// ─── Per-brand scrape ────────────────────────────────────────────────────

interface ScrapeResult {
  brandId: string;
  brandName: string;
  instagram?: { followers: number | null; success: boolean };
  tiktok?: { followers: number | null; success: boolean };
  errors: string[];
}

export async function scrapeBrandSocial(brandId: string): Promise<ScrapeResult> {
  await ensureSocialStatsTable();

  const brandQ = await pool.query(
    `SELECT id, name, instagram_handle, tiktok_handle FROM crm_companies WHERE id = $1`,
    [brandId]
  );
  const brand = brandQ.rows[0];
  if (!brand) return { brandId, brandName: "?", errors: ["not found"] };

  const out: ScrapeResult = { brandId, brandName: brand.name, errors: [] };

  if (!isScraperApiAvailable()) {
    out.errors.push("ScraperAPI not configured");
    return out;
  }

  // Instagram
  if (brand.instagram_handle) {
    const handle = brand.instagram_handle.replace(/^@/, "").trim();
    try {
      const url = `https://www.instagram.com/${handle}/`;
      const res = await scraperFetch(url, { render: false });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const html = await res.text();
      const stats = parseInstagram(html);
      if (stats.followers != null) {
        await pool.query(
          `INSERT INTO brand_social_stats (brand_company_id, platform, handle, followers, following, posts)
           VALUES ($1, 'instagram', $2, $3, $4, $5)`,
          [brandId, handle, stats.followers, stats.following, stats.posts]
        );
        out.instagram = { followers: stats.followers, success: true };
      } else {
        out.instagram = { followers: null, success: false };
        out.errors.push("instagram: parse failed");
      }
    } catch (e: any) {
      out.errors.push(`instagram: ${e.message}`);
    }
  }

  // TikTok
  if (brand.tiktok_handle) {
    const handle = brand.tiktok_handle.replace(/^@/, "").trim();
    try {
      const url = `https://www.tiktok.com/@${handle}`;
      const res = await scraperFetch(url, { render: false });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const html = await res.text();
      const stats = parseTikTok(html);
      if (stats.followers != null) {
        await pool.query(
          `INSERT INTO brand_social_stats (brand_company_id, platform, handle, followers, following, posts)
           VALUES ($1, 'tiktok', $2, $3, $4, $5)`,
          [brandId, handle, stats.followers, stats.following, stats.posts]
        );
        out.tiktok = { followers: stats.followers, success: true };
      } else {
        out.tiktok = { followers: null, success: false };
        out.errors.push("tiktok: parse failed");
      }
    } catch (e: any) {
      out.errors.push(`tiktok: ${e.message}`);
    }
  }

  return out;
}

// ─── Bulk runner ────────────────────────────────────────────────────────

export async function runWeeklySocialScrape(): Promise<{ scanned: number; igOk: number; tkOk: number; errors: number }> {
  await ensureSocialStatsTable();

  const brands = await pool.query(
    `SELECT c.id FROM crm_companies c
      WHERE c.is_tracked_brand = true
        AND c.merged_into_id IS NULL
        AND (c.instagram_handle IS NOT NULL OR c.tiktok_handle IS NOT NULL)
        AND NOT EXISTS (
          SELECT 1 FROM brand_social_stats s
          WHERE s.brand_company_id = c.id
            AND s.fetched_at >= now() - interval '${STALE_DAYS} days'
        )
      ORDER BY c.name LIMIT $1`,
    [MAX_BRANDS_PER_RUN]
  );

  let igOk = 0, tkOk = 0, errors = 0;
  for (const b of brands.rows) {
    const r = await scrapeBrandSocial(b.id);
    if (r.instagram?.success) igOk++;
    if (r.tiktok?.success) tkOk++;
    if (r.errors.length > 0) errors++;
    // Soft rate-limit
    await new Promise(res => setTimeout(res, 1500));
  }

  console.log(`[brand-social-scraper] scanned ${brands.rows.length} brands · ig=${igOk} tk=${tkOk} errors=${errors}`);
  return { scanned: brands.rows.length, igOk, tkOk, errors };
}

// ─── Endpoints ──────────────────────────────────────────────────────────

router.post("/api/brand/:companyId/social-scrape", requireAuth, async (req: Request, res: Response) => {
  try {
    const result = await scrapeBrandSocial(String(req.params.companyId));
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/brand-social-scraper/run", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId as string;
    const adminCheck = await pool.query(`SELECT is_admin FROM users WHERE id = $1`, [userId]);
    if (!adminCheck.rows[0]?.is_admin) return res.status(403).json({ error: "Admin only" });
    runWeeklySocialScrape().catch(e => console.error("[social-scraper] bulk run failed:", e?.message));
    res.json({ started: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
