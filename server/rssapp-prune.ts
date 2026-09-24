// Frees RSS.app plan slots (Woody, 2026-09-24: "free up some space please" —
// the plan was full at 450/450, so new brand Instagram feeds were refused).
// GET  /api/admin/rssapp/audit  — every feed on the plan, matched to the app,
//                                 with a prune reason where one applies.
// POST /api/admin/rssapp/prune  — deletes those feeds on RSS.app (dry run
//                                 unless confirm:true) and retires the app rows.
// Feeds for brands on a BGP deal are never pruned.
import type { Express } from "express";
import { requireAuth, requireAdmin } from "./auth";
import { pool } from "./db";
import { deleteRssAppFeed, listAllRssAppFeeds, type RssAppFeed } from "./rssapp";

export type PruneReason = "unlinked" | "switched_off" | "brand_deleted" | "never_posted" | "quiet_180d";

type SourceRow = {
  id: string; name: string; url: string; feed_url: string | null; type: string; category: string | null; active: boolean | null;
  last_fetched_at: string | null; brand_exists: boolean | null; brand_on_deal: boolean | null; articles: number; last_article: string | null;
};

const norm = (value: string | null | undefined) => (value || "").trim().replace(/\/+$/, "").toLowerCase();

export function classifyRssAppFeeds(feeds: RssAppFeed[], sources: SourceRow[], now = Date.now()) {
  const byFeed = new Map<string, SourceRow>();
  const byUrl = new Map<string, SourceRow>();
  for (const s of sources) {
    if (s.feed_url) byFeed.set(norm(s.feed_url), s);
    byUrl.set(norm(s.url), s);
  }
  return feeds.map(feed => {
    const source = byFeed.get(norm(feed.rss_feed_url)) || byUrl.get(norm(feed.source_url)) || null;
    let reason: PruneReason | null = null;
    if (!source) reason = "unlinked";
    else if (source.brand_on_deal) reason = null;
    else if (source.category?.startsWith("brand:") && source.brand_exists === false) reason = "brand_deleted";
    else if (source.active === false) reason = "switched_off";
    else if (source.last_fetched_at && !source.articles) reason = "never_posted";
    else if (source.last_article && now - new Date(source.last_article).getTime() > 180 * 864e5) reason = "quiet_180d";
    return { feedId: feed.id, title: feed.title, sourceUrl: feed.source_url, sourceId: source?.id || null, sourceName: source?.name || null,
      type: source?.type || null, articles: source?.articles ?? 0, lastArticle: source?.last_article || null, onDeal: !!source?.brand_on_deal, reason };
  });
}

const SOURCES_SQL = `
  SELECT ns.id, ns.name, ns.url, ns.feed_url, ns.type, ns.category, ns.active, ns.last_fetched_at,
         CASE WHEN ns.category LIKE 'brand:%' THEN EXISTS (
           SELECT 1 FROM crm_companies c WHERE c.id = substring(ns.category from 7) AND c.merged_into_id IS NULL) END AS brand_exists,
         CASE WHEN ns.category LIKE 'brand:%' THEN EXISTS (
           SELECT 1 FROM crm_deals d WHERE substring(ns.category from 7) IN (d.tenant_id, d.landlord_id)) END AS brand_on_deal,
         COALESCE(a.n, 0)::int AS articles, a.last_article
    FROM news_sources ns
    LEFT JOIN (SELECT source_id, COUNT(*) AS n, MAX(COALESCE(published_at, fetched_at)) AS last_article
                 FROM news_articles GROUP BY source_id) a ON a.source_id = ns.id
   WHERE ns.feed_url ILIKE '%rss.app%'`;

async function audit() {
  const feeds = await listAllRssAppFeeds();
  const sources = (await pool.query(SOURCES_SQL)).rows as SourceRow[];
  const rows = classifyRssAppFeeds(feeds, sources);
  const counts: Record<string, number> = {};
  for (const r of rows) if (r.reason) counts[r.reason] = (counts[r.reason] || 0) + 1;
  return { onPlan: feeds.length, quota: Number(process.env.RSSAPP_FEED_QUOTA || 100), prunable: rows.filter(r => r.reason).length, counts, rows };
}

export function registerRssAppPruneRoutes(app: Express) {
  app.get("/api/admin/rssapp/audit", requireAuth, requireAdmin, async (_req, res) => {
    try { res.json(await audit()); } catch (e: any) { res.status(500).json({ message: e?.message || "RSS.app audit failed" }); }
  });

  app.post("/api/admin/rssapp/prune", requireAuth, requireAdmin, async (req, res) => {
    try {
      const wanted: PruneReason[] = Array.isArray(req.body?.reasons) && req.body.reasons.length
        ? req.body.reasons : ["unlinked", "switched_off", "brand_deleted", "never_posted", "quiet_180d"];
      const report = await audit();
      const targets = report.rows.filter(r => r.reason && wanted.includes(r.reason) && !r.onDeal);
      if (req.body?.confirm !== true) return res.json({ dryRun: true, onPlan: report.onPlan, wouldDelete: targets.length, targets });
      const deleted: string[] = [];
      const failed: Array<{ feedId: string; error: string }> = [];
      for (const t of targets) {
        try {
          await deleteRssAppFeed(t.feedId);
          if (t.sourceId) {
            // A deleted brand's row goes; otherwise keep the row (and its
            // articles) but switch it off so nothing polls a dead feed.
            if (t.reason === "brand_deleted") await pool.query(`DELETE FROM news_sources WHERE id = $1`, [t.sourceId]);
            else await pool.query(`UPDATE news_sources SET active = false WHERE id = $1`, [t.sourceId]);
          }
          deleted.push(t.feedId);
          await new Promise(r => setTimeout(r, 250));
        } catch (e: any) { failed.push({ feedId: t.feedId, error: String(e?.message || e).slice(0, 200) }); }
      }
      res.json({ dryRun: false, onPlanBefore: report.onPlan, deleted: deleted.length, failed });
    } catch (e: any) { res.status(500).json({ message: e?.message || "RSS.app prune failed" }); }
  });
}
