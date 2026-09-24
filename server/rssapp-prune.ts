// Frees RSS.app plan slots (Woody, 2026-09-24: "free up some space please" —
// the plan was full at 450/450, so new brand Instagram feeds were refused).
// GET  /api/admin/rssapp/audit  — every feed on the plan, matched to the app,
//                                 with a prune reason where one applies.
// POST /api/admin/rssapp/prune  — deletes those feeds on RSS.app (dry run
//                                 unless confirm:true) and retires the app rows.
// Feeds for brands on a BGP deal are never pruned.
import type { Express } from "express";
import { requireAuth, requireAdmin } from "./auth";
import { startJob, getJobStatus } from "./brand-jobs";
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

  // Runs as a background job: RSS.app allows only a few deletes a minute.
  // makeRoom: N also frees the N quietest Instagram feeds of brands that
  // aren't on a BGP deal (their brand page just loses the posts grid).
  app.post("/api/admin/rssapp/prune", requireAuth, requireAdmin, async (req, res) => {
    try {
      const wanted: PruneReason[] = Array.isArray(req.body?.reasons) && req.body.reasons.length
        ? req.body.reasons : ["unlinked", "switched_off", "brand_deleted", "never_posted", "quiet_180d"];
      const makeRoom = Math.max(0, Math.min(Number(req.body?.makeRoom) || 0, 100));
      const report = await audit();
      const targets: Array<(typeof report.rows)[number] & { why: string }> = report.rows
        .filter(r => r.reason && wanted.includes(r.reason) && !r.onDeal).map(r => ({ ...r, why: r.reason as string }));
      if (makeRoom) {
        const quiet = report.rows
          .filter(r => !r.reason && !r.onDeal && r.sourceId && r.type === "rssapp_instagram")
          .sort((a, b) => (a.lastArticle ? Date.parse(a.lastArticle) : 0) - (b.lastArticle ? Date.parse(b.lastArticle) : 0) || a.articles - b.articles)
          .slice(0, makeRoom);
        targets.push(...quiet.map(r => ({ ...r, why: "make_room" })));
      }
      if (req.body?.confirm !== true) return res.json({ dryRun: true, onPlan: report.onPlan, wouldDelete: targets.length, targets: targets.map(t => ({ name: t.sourceName || t.title, why: t.why, lastArticle: t.lastArticle })) });
      const { alreadyRunning } = startJob("rssapp-prune", async () => {
        const deleted: string[] = [];
        const failed: Array<{ feedId: string; error: string }> = [];
        for (const t of targets) {
          for (let attempt = 1; attempt <= 4; attempt++) {
            try {
              await deleteRssAppFeed(t.feedId);
              if (t.sourceId) {
                // A deleted brand's row goes; otherwise keep the row (and its
                // articles) but switch it off so nothing polls a dead feed.
                if (t.reason === "brand_deleted") await pool.query(`DELETE FROM news_sources WHERE id = $1`, [t.sourceId]);
                else await pool.query(`UPDATE news_sources SET active = false WHERE id = $1`, [t.sourceId]);
              }
              deleted.push(t.feedId);
              break;
            } catch (e: any) {
              if (/429|rate limit/i.test(String(e?.message)) && attempt < 4) { await new Promise(r => setTimeout(r, 20_000 * attempt)); continue; }
              failed.push({ feedId: t.feedId, error: String(e?.message || e).slice(0, 200) });
              break;
            }
          }
          await new Promise(r => setTimeout(r, 12_000));
        }
        // Brands refused while the plan was full get their three tries back.
        if (deleted.length) await pool.query(`DELETE FROM rssapp_feed_failures WHERE last_error LIKE 'RSS.app plan is full%'`).catch(() => {});
        return { onPlanBefore: report.onPlan, deleted: deleted.length, failed };
      });
      res.status(202).json({ accepted: true, alreadyRunning, targets: targets.length });
    } catch (e: any) { res.status(500).json({ message: e?.message || "RSS.app prune failed" }); }
  });

  app.get("/api/admin/rssapp/prune", requireAuth, requireAdmin, async (_req, res) => {
    res.json(getJobStatus("rssapp-prune") || { state: "idle" });
  });
}
