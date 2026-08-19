// Instagram Business Discovery integration.
//
// Uses the Meta Graph API to fetch any public Business / Creator IG
// account's profile + recent posts. This is the legit, ToS-compliant
// path — no scraping, no banned accounts. Replaces the old fragile
// instagram.com HTML scraper (server/brand-social-scraper.ts) for the
// IG side; that file still drives TikTok which has no equivalent API.
//
// Setup (one-off, README in repo root):
//   1. Meta for Developers → create / use an existing App in Business mode
//   2. Add 'Instagram Graph API' product
//   3. Connect a Facebook Page → its linked Business/Creator IG account
//   4. Generate a long-lived (or system user) access token with
//      `instagram_basic` + `pages_show_list` + `pages_read_engagement`
//   5. Find the IG Business Account ID (Graph API Explorer: GET /me/accounts → page ID → GET /{page-id}?fields=instagram_business_account)
//   6. Drop into Railway env vars:
//        META_ACCESS_TOKEN=EAAB...
//        INSTAGRAM_BUSINESS_ACCOUNT_ID=178...
//
// Cached in DB for 24h (brand_instagram_cache table created in
// auto-migrate block, server/index.ts). Manual refresh from the
// brand profile UI bypasses the cache via ?force=1.

import { Router, type Request, type Response } from "express";
import { requireAuth } from "./auth";
import { pool } from "./db";
import { storeImageFromBuffer } from "./image-studio";

const router = Router();

const GRAPH_VERSION = "v21.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export interface InstagramPost {
  id: string;
  caption: string | null;
  permalink: string;
  mediaType: "IMAGE" | "VIDEO" | "CAROUSEL_ALBUM" | string;
  mediaUrl: string;
  thumbnailUrl: string | null;
  timestamp: string;
  likeCount: number | null;
  commentsCount: number | null;
}

export interface InstagramProfile {
  username: string;
  name: string | null;
  biography: string | null;
  followersCount: number | null;
  followsCount: number | null;
  mediaCount: number | null;
  profilePictureUrl: string | null;
  posts: InstagramPost[];
  fetchedAt: string;
}

function isConfigured(): boolean {
  return !!(process.env.META_ACCESS_TOKEN && process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID);
}

function extractUsername(input: string | null | undefined): string | null {
  if (!input) return null;
  const s = String(input).trim();
  if (!s) return null;
  // Accept "@handle", "handle", or "https://instagram.com/handle/?…"
  const urlMatch = s.match(/instagram\.com\/([^/?#]+)/i);
  const raw = (urlMatch ? urlMatch[1] : s).replace(/^@/, "").split(/[/?#]/)[0];
  if (!raw || /^(p|reel|explore|stories|tv)$/i.test(raw)) return null;
  return raw.toLowerCase();
}

async function ensureCacheTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS brand_instagram_cache (
      brand_company_id VARCHAR PRIMARY KEY,
      username TEXT NOT NULL,
      profile_data JSONB NOT NULL,
      fetched_at TIMESTAMP NOT NULL DEFAULT now()
    );
  `);
}

async function readCache(brandCompanyId: string): Promise<InstagramProfile | null> {
  try {
    const r = await pool.query<{ profile_data: any; fetched_at: Date }>(
      `SELECT profile_data, fetched_at FROM brand_instagram_cache WHERE brand_company_id = $1`,
      [brandCompanyId]
    );
    const row = r.rows[0];
    if (!row) return null;
    if (Date.now() - new Date(row.fetched_at).getTime() > CACHE_TTL_MS) return null;
    return row.profile_data as InstagramProfile;
  } catch {
    return null;
  }
}

async function writeCache(brandCompanyId: string, profile: InstagramProfile): Promise<void> {
  await pool.query(
    `INSERT INTO brand_instagram_cache (brand_company_id, username, profile_data, fetched_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (brand_company_id) DO UPDATE
       SET username = EXCLUDED.username,
           profile_data = EXCLUDED.profile_data,
           fetched_at = EXCLUDED.fetched_at`,
    [brandCompanyId, profile.username, profile]
  );
}

// Single Business Discovery call. We ask the Meta API:
//   "From OUR Business IG account, look up @username and give us their
//    profile + last 25 media items."
async function fetchProfile(username: string): Promise<InstagramProfile | null> {
  if (!isConfigured()) return null;
  const accessToken = process.env.META_ACCESS_TOKEN!;
  const igBusinessId = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID!;

  const mediaFields = "id,caption,permalink,media_type,media_url,thumbnail_url,timestamp,like_count,comments_count";
  const fields =
    `business_discovery.username(${username}){` +
    `username,name,biography,followers_count,follows_count,media_count,profile_picture_url,` +
    `media.limit(25){${mediaFields}}` +
    `}`;

  const url = `${GRAPH_BASE}/${igBusinessId}?fields=${encodeURIComponent(fields)}&access_token=${encodeURIComponent(accessToken)}`;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.warn(`[instagram] HTTP ${res.status} for @${username}: ${body.slice(0, 200)}`);
      return null;
    }
    const data = await res.json();
    const bd = data?.business_discovery;
    if (!bd) {
      // Common case: username doesn't exist as a Business/Creator account
      // (personal account, doesn't exist, or doesn't permit discovery).
      return null;
    }
    const posts: InstagramPost[] = (bd.media?.data || []).map((m: any) => ({
      id: m.id,
      caption: m.caption || null,
      permalink: m.permalink,
      mediaType: m.media_type,
      mediaUrl: m.media_url,
      thumbnailUrl: m.thumbnail_url || null,
      timestamp: m.timestamp,
      likeCount: m.like_count ?? null,
      commentsCount: m.comments_count ?? null,
    }));
    return {
      username: bd.username,
      name: bd.name || null,
      biography: bd.biography || null,
      followersCount: bd.followers_count ?? null,
      followsCount: bd.follows_count ?? null,
      mediaCount: bd.media_count ?? null,
      profilePictureUrl: bd.profile_picture_url || null,
      posts,
      fetchedAt: new Date().toISOString(),
    };
  } catch (e: any) {
    console.warn(`[instagram] fetch failed for @${username}: ${e?.message}`);
    return null;
  }
}

// Main entry — used by the brand profile endpoint + ChatBGP + news scorer.
export async function getBrandInstagram(
  brandCompanyId: string,
  opts: { force?: boolean } = {},
): Promise<InstagramProfile | null> {
  if (!isConfigured()) return null;

  if (!opts.force) {
    const hit = await readCache(brandCompanyId);
    if (hit) return hit;
  }

  const handleRow = await pool.query<{ instagram_handle: string | null }>(
    `SELECT instagram_handle FROM crm_companies WHERE id = $1`,
    [brandCompanyId]
  );
  const username = extractUsername(handleRow.rows[0]?.instagram_handle);
  if (!username) return null;

  const profile = await fetchProfile(username);
  if (!profile) return null;

  await writeCache(brandCompanyId, profile);

  // Mirror the follower count into brand_social_stats so the old UI
  // surfaces (and digests) still see the freshest number.
  try {
    await pool.query(
      `INSERT INTO brand_social_stats (brand_company_id, platform, handle, followers, posts)
       VALUES ($1, 'instagram', $2, $3, $4)`,
      [brandCompanyId, username, profile.followersCount, profile.mediaCount]
    );
  } catch {}

  return profile;
}

// Imports up to N photos from the brand's recent grid into image_studio_images
// as gallery candidates. Skipped if we already have ≥cap auto-instagram images.
export async function importInstagramImagesIntoGallery(
  brandCompanyId: string,
  cap = 4,
): Promise<{ imported: number }> {
  const brandQ = await pool.query<{ name: string }>(
    `SELECT name FROM crm_companies WHERE id = $1`,
    [brandCompanyId]
  );
  const brandName = brandQ.rows[0]?.name;
  if (!brandName) return { imported: 0 };

  const existingQ = await pool.query<{ cnt: number }>(
    `SELECT COUNT(*)::int AS cnt FROM image_studio_images
       WHERE LOWER(brand_name) = LOWER($1)
         AND 'brand-auto' = ANY(tags)
         AND 'instagram'  = ANY(tags)`,
    [brandName]
  );
  if ((existingQ.rows[0]?.cnt ?? 0) >= cap) return { imported: 0 };

  const profile = await getBrandInstagram(brandCompanyId);
  if (!profile || profile.posts.length === 0) return { imported: 0 };

  const slots = cap - (existingQ.rows[0]?.cnt ?? 0);
  const eligible = profile.posts
    .filter(p => p.mediaType === "IMAGE" || p.mediaType === "CAROUSEL_ALBUM")
    .slice(0, slots);

  let imported = 0;
  for (const p of eligible) {
    const url = p.thumbnailUrl || p.mediaUrl;
    if (!url) continue;
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!r.ok) continue;
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length < 8000) continue;
      const mime = r.headers.get("content-type") || "image/jpeg";
      if (!mime.startsWith("image/")) continue;
      await storeImageFromBuffer({
        buffer: buf,
        fileName: `${brandName} — instagram${p.caption ? `: ${p.caption.slice(0, 80)}` : ""}`,
        category: "Brands",
        tags: ["brand-auto", brandName, "instagram"],
        description: `Auto-imported from Instagram (${p.permalink}) for ${brandName}`,
        source: "instagram",
        brandName,
        mimeType: mime,
        filenameHint: `${brandName}-instagram`,
      });
      imported++;
    } catch (e: any) {
      console.warn(`[instagram] image import failed for ${brandName}: ${e?.message}`);
    }
  }
  return { imported };
}

// ─── Routes ──────────────────────────────────────────────────────────────

// Same-origin image proxy for Instagram CDN photos. The CDN serves these
// fine server-side, but browser-side loads proved flaky enough (referrer
// policies, signed-URL quirks) that the profile card now loads post images
// through us: verified fetch, cached, no third-party games (2026-08-19).
router.get("/api/ig-image", requireAuth, async (req: Request, res: Response) => {
  try {
    const raw = String(req.query.u || "");
    const u = new URL(raw);
    if (!/(^|\.)cdninstagram\.com$|(^|\.)fbcdn\.net$/i.test(u.hostname)) {
      return res.status(400).end();
    }
    const r = await fetch(u.toString(), { signal: AbortSignal.timeout(15_000) });
    if (!r.ok) return res.status(502).end();
    res.setHeader("Content-Type", r.headers.get("content-type") || "image/jpeg");
    res.setHeader("Cache-Control", "public, max-age=21600");
    res.send(Buffer.from(await r.arrayBuffer()));
  } catch {
    res.status(502).end();
  }
});

router.get("/api/instagram/health", requireAuth, async (_req: Request, res: Response) => {
  res.json({
    configured: isConfigured(),
    hasAccessToken: !!process.env.META_ACCESS_TOKEN,
    hasBusinessAccountId: !!process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID,
  });
});

// Diagnostic — runs three Meta calls in sequence and returns each raw
// response so we can pinpoint exactly where the lookup is failing:
//   1. Can the token read /me ?                (token validity + identity)
//   2. Can the token read the configured Business Account ID ? (perms on it)
//   3. Can it do Business Discovery on @<handle> ?              (BD itself)
router.get("/api/instagram/probe", requireAuth, async (req: Request, res: Response) => {
  const token = process.env.META_ACCESS_TOKEN || "";
  const igBusinessId = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID || "";
  const handle = String(req.query.handle || "andotherstories").replace(/^@/, "");
  if (!token || !igBusinessId) {
    return res.json({ ok: false, error: "Missing META_ACCESS_TOKEN or INSTAGRAM_BUSINESS_ACCOUNT_ID" });
  }
  const callMeta = async (url: string) => {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
      const body = await r.text();
      let parsed: any = null;
      try { parsed = JSON.parse(body); } catch {}
      return { status: r.status, ok: r.ok, body: parsed || body.slice(0, 500) };
    } catch (e: any) {
      return { status: 0, ok: false, body: `fetch error: ${e?.message}` };
    }
  };
  const GRAPH = "https://graph.facebook.com/v18.0";
  // Step 1 — token identity
  const me = await callMeta(`${GRAPH}/me?fields=id,name&access_token=${encodeURIComponent(token)}`);
  // Step 2 — can the token see the configured Business IG account
  const accountSelf = await callMeta(`${GRAPH}/${encodeURIComponent(igBusinessId)}?fields=id,username,name&access_token=${encodeURIComponent(token)}`);
  // Step 3 — Business Discovery on the test handle
  const fields = `business_discovery.username(${handle}){username,name,followers_count}`;
  const businessDiscovery = await callMeta(`${GRAPH}/${encodeURIComponent(igBusinessId)}?fields=${encodeURIComponent(fields)}&access_token=${encodeURIComponent(token)}`);
  res.json({
    configured: { igBusinessId, tokenLength: token.length },
    step1_token_identity: me,
    step2_business_account: accountSelf,
    step3_business_discovery_handle: businessDiscovery,
    handleTested: handle,
  });
});

// Brand profile Instagram card — fed by the brand's RSS.app Instagram feed
// (Meta rejected Public Content Access, so Business Discovery never went
// live for lookups; getBrandInstagram above remains for anything Meta does
// still serve from cache). Three states for the UI:
//   feed        → latest posts from the RSS.app feed (news_articles rows)
//   handle_only → handle on file but no paid feed slot yet
//   no_handle   → nothing to show; the card hides itself
// Follower counts come from brand_social_stats — the weekly scrape.
router.get("/api/brand/:companyId/instagram", requireAuth, async (req: Request, res: Response) => {
  try {
    const companyId = String(req.params.companyId);
    const handleRow = await pool.query<{ instagram_handle: string | null }>(
      `SELECT instagram_handle FROM crm_companies WHERE id = $1`, [companyId]
    );
    const handle = extractUsername(handleRow.rows[0]?.instagram_handle);
    if (!handle) return res.json({ status: "no_handle", handle: null, posts: [] });

    // brand_social_stats is created lazily by the weekly scraper — on a
    // fresh DB it doesn't exist yet, which 500'd the whole card. Treat a
    // missing table as "no stats yet".
    const stats = await pool.query<{ followers: number | null; posts: number | null }>(
      `SELECT followers, posts FROM brand_social_stats
        WHERE brand_company_id = $1 AND platform = 'instagram'
        ORDER BY fetched_at DESC LIMIT 1`, [companyId]
    ).catch((e: any) => {
      if (e?.code === "42P01") return { rows: [] } as any;
      throw e;
    });
    const followers = stats.rows[0]?.followers ?? null;
    const postCount = stats.rows[0]?.posts ?? null;

    const src = await pool.query<{ id: string }>(
      `SELECT id FROM news_sources
        WHERE category = $1 AND type = 'rssapp_instagram' AND active = true
        LIMIT 1`, [`brand:${companyId}`]
    );
    if (!src.rows[0]) {
      return res.json({ status: "handle_only", handle, followers, postCount, posts: [] });
    }

    const posts = await pool.query(
      `SELECT title, url, image_url AS "imageUrl", published_at AS "publishedAt", content
         FROM news_articles
        WHERE source_id = $1
        ORDER BY published_at DESC NULLS LAST
        LIMIT 24`, [src.rows[0].id]
    );
    // Videos: RSS.app embeds a playable file in the item body when it has
    // one — surface it for inline playback. Reels detected by URL get a
    // play badge linking out even when only a thumbnail is available.
    const shaped = posts.rows.map((p: any) => {
      const videoMatch = (p.content || "").match(/<(?:video|source)[^>]+src="([^"]+)"/i);
      const videoUrl = videoMatch ? videoMatch[1] : null;
      return {
        title: p.title,
        url: p.url,
        imageUrl: p.imageUrl,
        publishedAt: p.publishedAt,
        videoUrl,
        isVideo: !!videoUrl || /\/reel\//i.test(p.url || ""),
      };
    });
    // Caption-only tiles read as broken — prefer posts with actual media
    // (posts ingested before the feed window moved on have no image left
    // to fetch). Fall back to captions only when NOTHING has media.
    const withMedia = shaped.filter((p) => p.imageUrl || p.videoUrl);
    const visible = (withMedia.length ? withMedia : shaped).slice(0, 9);
    res.json({ status: "feed", handle, followers, postCount, posts: visible });
  } catch (e: any) {
    console.error("[/api/brand/:companyId/instagram]", e?.message);
    res.status(500).json({ error: e?.message || "failed" });
  }
});

router.post("/api/brand/:companyId/instagram/import-images", requireAuth, async (req: Request, res: Response) => {
  try {
    const cap = Math.min(Number(req.body?.cap ?? 4), 10);
    const result = await importInstagramImagesIntoGallery(String(req.params.companyId), cap);
    res.json(result);
  } catch (e: any) {
    console.error("[/api/brand/:companyId/instagram/import-images]", e?.message);
    res.status(500).json({ error: e?.message || "failed" });
  }
});

// Wire-up: ensure cache table exists at module load time.
ensureCacheTable().catch(e => console.warn("[instagram] ensureCacheTable failed:", e?.message));

export default router;
