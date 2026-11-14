// A property's own Instagram account (Woody, 2026-11-14: "add the instagram
// handle"). BGP staff only. The handle lives on crm_properties.instagram_handle;
// its posts come from one RSS.app feed, a news_sources row with category
// `property:<id>`, made the first time staff open the property's News & social
// after a handle is saved. Public news never reads it (a type allow-list), and
// the RSS.app prune treats it as kept (server/rssapp-prune.ts).
import type { Express, Request, Response } from "express";
import { requireAuth } from "./auth";
import { pool } from "./db";
import { contactViewer } from "./contact-viewer";
import { createRssAppFeed, isRssAppConfigured, rssappHealth } from "./rssapp";

const TYPE = "rssapp_instagram";
const inFlight = new Set<string>();

export function propertyInstagramHandle(raw: unknown): string | null {
  let s = String(raw ?? "").trim();
  if (!s) return null;
  const m = /^(?:https?:\/\/)?(?:www\.)?instagram\.com\/([^/?#]+)\/?(?:[?#].*)?$/i.exec(s);
  if (m) s = m[1];
  s = s.replace(/^@/, "");
  return /^[a-zA-Z0-9._]{1,30}$/.test(s) ? s.toLowerCase() : null;
}

async function staffOnly(req: Request, res: Response): Promise<boolean> {
  if ((await contactViewer(req)).staff) return true;
  res.status(403).json({ error: "Available to BGP staff only" });
  return false;
}

async function ensureFeed(propertyId: string, name: string, handle: string) {
  if (inFlight.has(propertyId)) return;
  inFlight.add(propertyId);
  const url = `https://www.instagram.com/${handle}/`;
  try {
    const failure = await pool.query(`SELECT attempts FROM rssapp_feed_failures WHERE url = $1`, [url]).catch(() => ({ rows: [] as any[] }));
    if ((failure.rows[0]?.attempts ?? 0) >= 3) return;
    const health = await rssappHealth();
    if (!health.ok) return;
    if ((health.feedCount ?? 0) >= Number(process.env.RSSAPP_FEED_QUOTA || 100)) return;
    const feed = await createRssAppFeed(url);
    const row = await pool.query(
      `INSERT INTO news_sources (name, url, feed_url, type, category, active) VALUES ($1, $2, $3, $4, $5, true) RETURNING id`,
      [`${name} (instagram)`, url, feed.rss_feed_url, TYPE, `property:${propertyId}`]);
    await pool.query(`DELETE FROM rssapp_feed_failures WHERE url = $1`, [url]).catch(() => {});
    const { fetchNewsSourcesNow } = await import("./news-feeds");
    await Promise.resolve(fetchNewsSourcesNow([row.rows[0].id])).catch(() => {});
  } catch (e: any) {
    await pool.query(
      `INSERT INTO rssapp_feed_failures (url, attempts, last_error, last_attempt) VALUES ($1, 1, $2, now())
       ON CONFLICT (url) DO UPDATE SET attempts = rssapp_feed_failures.attempts + 1, last_error = $2, last_attempt = now()`,
      [url, String(e?.message || "feed creation failed").slice(0, 200)]).catch(() => {});
    console.warn(`[property-instagram] feed for ${propertyId} not created: ${e?.message}`);
  } finally {
    inFlight.delete(propertyId);
  }
}

export function registerPropertyInstagramRoutes(app: Express) {
  app.get("/api/properties/:id/instagram", requireAuth, async (req, res) => {
    try {
      if (!(await staffOnly(req, res))) return;
      const id = String(req.params.id);
      const prop = (await pool.query(`SELECT id, name, instagram_handle FROM crm_properties WHERE id = $1`, [id])).rows[0];
      if (!prop) return res.status(404).json({ error: "Property not found" });
      const handle = propertyInstagramHandle(prop.instagram_handle);
      if (!handle) return res.json({ status: "no_handle", handle: null, posts: [] });
      const src = (await pool.query(
        `SELECT id FROM news_sources WHERE category = $1 AND type = $2 AND active = true AND url ILIKE $3 LIMIT 1`,
        [`property:${id}`, TYPE, `%instagram.com/${handle}/%`])).rows[0];
      if (!src) {
        if (isRssAppConfigured()) void ensureFeed(id, prop.name, handle);
        return res.json({ status: isRssAppConfigured() ? "pending" : "not_configured", handle, posts: [] });
      }
      const posts = await pool.query(
        `SELECT title, url, image_url AS "imageUrl", published_at AS "publishedAt"
           FROM news_articles WHERE source_id = $1 ORDER BY published_at DESC NULLS LAST LIMIT 12`, [src.id]);
      res.json({ status: "feed", handle, posts: posts.rows });
    } catch (e: any) { res.status(500).json({ error: e?.message || "failed" }); }
  });

  app.put("/api/properties/:id/instagram", requireAuth, async (req, res) => {
    try {
      if (!(await staffOnly(req, res))) return;
      const id = String(req.params.id);
      const raw = req.body?.handle;
      const handle = propertyInstagramHandle(raw);
      if (String(raw ?? "").trim() && !handle) return res.status(400).json({ error: "That is not an Instagram handle (letters, numbers, dots and underscores, up to 30)" });
      const r = await pool.query(`UPDATE crm_properties SET instagram_handle = $2 WHERE id = $1 RETURNING id`, [id, handle]);
      if (!r.rowCount) return res.status(404).json({ error: "Property not found" });
      // A changed or cleared handle switches the old feed off.
      await pool.query(
        `UPDATE news_sources SET active = false WHERE category = $1 AND type = $2 AND ($3::text IS NULL OR url NOT ILIKE '%instagram.com/' || $3 || '/%')`,
        [`property:${id}`, TYPE, handle]);
      res.json({ handle });
    } catch (e: any) { res.status(500).json({ error: e?.message || "failed" }); }
  });
}
