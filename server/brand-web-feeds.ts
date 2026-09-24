// Brand channels beyond Instagram, followed through RSS.app (Woody,
// 2026-09-24: "spin up all of this ... combined ... then some AI commentary"):
//   • the brand's own locations / openings page, news page and careers page
//     (found on its verified website) and its LinkedIn company page;
//   • market sources — London openings sites and landlord press pages.
// Brand channels land as news_sources with category 'brand:<id>' so their
// items become that brand's signals; everything shows on the brand page's
// Brand feed card and on News → Brand watch, each with a short AI read.
import Anthropic from "@anthropic-ai/sdk";
import type { Express } from "express";
import { requireAuth, requireAdmin } from "./auth";
import { startJob, getJobStatus } from "./brand-jobs";
import { pool } from "./db";
import { createRssAppFeed, deleteRssAppFeed, rssappHealth } from "./rssapp";
import { getBrandIdentity, normalizeBrandDomain } from "./brand-identity";
import { BRAND_FEED_TABS, BRAND_WATCH_FILTERS, BRAND_WEB_FEED_TYPES, MARKET_FEED_TYPES, type BrandWebFeedKind } from "../shared/brand-feed-types";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODELS = ["claude-haiku-4-5-20251001", "claude-sonnet-4-6"];
// Slots kept free on the plan for brand Instagram feeds created on demand.
const RESERVE_SLOTS = 8;

// ─── Finding the pages ──────────────────────────────────────────────────

const PAGE_PATTERNS: Record<Exclude<BrandWebFeedKind, "linkedin">, { re: RegExp; external: boolean }> = {
  locations: { re: /\b(locations?|restaurants?|find[\s-]*(us|a[\s-]*\w+|your[\s-]*nearest)|our[\s-]*(sites|venues|cafes|restaurants|stores|shops|bakeries|coffee[\s-]*shops|pubs|hotels|gyms|clubs|studios)|store[\s-]*(locator|finder)s?|venues|visit[\s-]*us|cafes|bakeries|pubs|clubs|gyms|studios|opening[\s-]*soon|coming[\s-]*soon|new[\s-]*openings?)\b/i, external: false },
  website: { re: /\b(news|press|blog|journal|stories|magazine|updates|latest|whats[\s-]*on|what-s-on)\b/i, external: false },
  careers: { re: /\b(careers?|jobs|join[\s-]*(us|the[\s-]*team|our[\s-]*team|the[\s-]*family)|work[\s-]*(with|for)[\s-]*us|vacanc(y|ies)|recruit(ment)?|opportunities)\b/i, external: true },
};
const NOT_A_PAGE = /newsletter|sign[\s-]*up|subscribe|login|account|basket|cart|checkout|privacy|cookie|terms|gift[\s-]*card|order[\s-]*online|delivery|mailto:|tel:|\.(pdf|jpg|png)$/i;
const SOCIAL_HOSTS = /(instagram|facebook|twitter|x|tiktok|youtube|pinterest|linkedin)\.com$/i;

export function pickBrandFeedPages(links: Array<{ url: string; text: string }>, homeUrl: string, domain: string) {
  const depth = (url: string) => new URL(url).pathname.split("/").filter(Boolean).length;
  const out: Partial<Record<BrandWebFeedKind, string>> = {};
  for (const [kind, { re, external }] of Object.entries(PAGE_PATTERNS) as Array<[Exclude<BrandWebFeedKind, "linkedin">, { re: RegExp; external: boolean }]>) {
    const candidates = links.filter(link => {
      let host: string;
      try { host = new URL(link.url).hostname.replace(/^www\./, ""); } catch { return false; }
      // The brand's own site and its subdomains (jobs.brand.co.uk).
      const own = host === domain || host.endsWith(`.${domain}`);
      if (!own && (!external || SOCIAL_HOSTS.test(host))) return false;
      const path = new URL(link.url).pathname;
      if (link.url.replace(/\/+$/, "") === homeUrl.replace(/\/+$/, "")) return false;
      // A bare "/" only counts as its own page on a jobs subdomain / ATS.
      if (path === "/" && (host === domain || kind !== "careers")) return false;
      if (NOT_A_PAGE.test(`${link.url} ${link.text}`)) return false;
      // Match on the link's own words: the path's last segment or its text.
      const last = decodeURIComponent(path.split("/").filter(Boolean).at(-1) || "");
      // Link text only counts when it reads like a menu item, not a paragraph
      // on a promo tile ("Visit our studio to create your own perfume…").
      return re.test(last.replace(/[-_]/g, " ")) || (link.text.split(/\s+/).length <= 4 && re.test(link.text));
    });
    // The index page (shallowest) beats single-venue / single-post pages;
    // English beats other languages on multi-language sites.
    // An index word as the whole last segment (/locations, /careers,
    // /journal) beats a loose text match ("Find a halal Nando's").
    const exact = (url: string) => {
      const last = decodeURIComponent(new URL(url).pathname.split("/").filter(Boolean).at(-1) || "").replace(/[-_]/g, " ").trim();
      return !!last && new RegExp(`^(${re.source})$`, "i").test(last);
    };
    candidates.sort((a, b) => Number(exact(b.url)) - Number(exact(a.url)) || depth(a.url) - depth(b.url) || Number(!/\/en(\/|$)/.test(a.url)) - Number(!/\/en(\/|$)/.test(b.url)) || a.url.length - b.url.length);
    if (candidates[0]) out[kind] = candidates[0].url;
    // No index page, but the homepage itself lists the venues
    // (/restaurants/soho, /restaurants/born …) — follow the homepage.
    if (kind === "locations" && !out.locations) {
      const venueLinks = links.filter(link => {
        try {
          const url = new URL(link.url);
          const parts = url.pathname.split("/").filter(Boolean);
          return url.hostname.replace(/^www\./, "") === domain && parts.length >= 2 && re.test(decodeURIComponent(parts.at(-2) || "").replace(/[-_]/g, " "));
        } catch { return false; }
      });
      if (venueLinks.length >= 4) out.locations = homeUrl;
    }
  }
  const linkedin = links.find(link => /linkedin\.com\/company\/[^/?#]+/i.test(link.url));
  if (linkedin) out.linkedin = linkedin.url.replace(/[?#].*$/, "");
  return out;
}

async function discoverBrandFeedPages(company: any) {
  const identity = getBrandIdentity(company);
  if (identity.status !== "verified" || !identity.domain) throw new Error("Confirm the brand's official website first.");
  const { readBrandHomepage, pageLinks } = await import("./brand-identity-verification");
  const home = await readBrandHomepage(identity.domain);
  const pages = pickBrandFeedPages(pageLinks(home.html, home.url), home.url, identity.domain);
  if (company.linkedin_url && /linkedin\.com\/company\//i.test(company.linkedin_url)) pages.linkedin = String(company.linkedin_url).replace(/[?#].*$/, "");
  return { domain: identity.domain, pages };
}

// ─── Creating feeds (only ones that actually produce items) ─────────────

async function planRoom() {
  const health = await rssappHealth();
  if (!health.ok) throw new Error(`RSS.app not ready: ${health.error}`);
  const quota = Number(process.env.RSSAPP_FEED_QUOTA || 100);
  return { used: health.feedCount ?? 0, quota, free: quota - RESERVE_SLOTS - (health.feedCount ?? 0) };
}

async function feedItemCount(feedUrl: string) {
  const Parser = (await import("rss-parser")).default;
  const feed = await new Parser({ timeout: 15_000 }).parseURL(feedUrl);
  return (feed.items || []).filter(item => item.title && item.link).length;
}

// A feed that comes back empty is deleted at once so it never holds a slot.
async function createCheckedFeed(url: string) {
  const feed = await createRssAppFeed(url);
  let items = 0;
  try { items = await feedItemCount(feed.rss_feed_url); } catch { items = 0; }
  if (!items) {
    await deleteRssAppFeed(feed.id).catch(() => {});
    throw new Error("RSS.app found nothing to follow on that page");
  }
  return { ...feed, items };
}

async function insertSource(values: { name: string; url: string; feedUrl: string; type: string; category: string }) {
  const row = (await pool.query(
    `INSERT INTO news_sources (name, url, feed_url, type, category, active) VALUES ($1, $2, $3, $4, $5, true) RETURNING id`,
    [values.name, values.url, values.feedUrl, values.type, values.category])).rows[0];
  return row.id as string;
}

async function fetchNow(ids: string[]) {
  if (!ids.length) return;
  const { fetchNewsSourcesNow } = await import("./news-feeds");
  await fetchNewsSourcesNow(ids).catch(err => console.warn("[brand-web-feeds] first fetch failed:", err?.message));
}

export async function ensureBrandWebFeeds(companyId: string, kinds: BrandWebFeedKind[] = ["locations", "website", "careers", "linkedin"], opts: { dryRun?: boolean } = {}) {
  const company = (await pool.query(`SELECT * FROM crm_companies WHERE id = $1 AND merged_into_id IS NULL`, [companyId])).rows[0];
  if (!company) throw Object.assign(new Error("Company not found"), { status: 404 });
  const existing = (await pool.query(`SELECT type, url FROM news_sources WHERE category = $1`, [`brand:${companyId}`])).rows;
  const have = new Set(existing.map((r: any) => r.type));
  const { domain, pages } = await discoverBrandFeedPages(company);
  const results: Array<{ kind: BrandWebFeedKind; url?: string; status: "created" | "exists" | "not_found" | "no_items" | "no_room" | "would_create"; items?: number; error?: string }> = [];
  const created: string[] = [];
  let room = opts.dryRun ? null : await planRoom();
  for (const kind of kinds) {
    const type = BRAND_WEB_FEED_TYPES[kind];
    if (have.has(type)) { results.push({ kind, status: "exists", url: existing.find((r: any) => r.type === type)?.url }); continue; }
    const url = pages[kind];
    if (!url) { results.push({ kind, status: "not_found" }); continue; }
    if (opts.dryRun) { results.push({ kind, url, status: "would_create" }); continue; }
    if (!room || room.free <= 0) { results.push({ kind, url, status: "no_room" }); continue; }
    try {
      const feed = await createCheckedFeed(url);
      room.free--;
      const label = BRAND_FEED_TABS.find(tab => tab.type === type)?.label || kind;
      created.push(await insertSource({ name: `${company.name} (${label.toLowerCase()})`, url, feedUrl: feed.rss_feed_url, type, category: `brand:${companyId}` }));
      results.push({ kind, url, status: "created", items: feed.items });
    } catch (err: any) {
      results.push({ kind, url, status: /nothing to follow|find any posts|400/i.test(err?.message || "") ? "no_items" : "not_found", error: String(err?.message || err).slice(0, 200) });
      if (/rate limit|429/i.test(err?.message || "")) await new Promise(r => setTimeout(r, 20_000));
    }
    await new Promise(r => setTimeout(r, 3000));
  }
  await fetchNow(created);
  return { company: company.name, domain, pages, results };
}

// London openings + landlord press. Native RSS where the publisher has it
// (no plan slot); RSS.app for pages without a feed.
export const MARKET_SOURCES: Array<{ name: string; url: string; feedUrl?: string; type: string; category: string }> = [
  { name: "Eater London", url: "https://london.eater.com", feedUrl: "https://london.eater.com/rss/index.xml", type: MARKET_FEED_TYPES.openings, category: "Hospitality" },
  { name: "Hot Dinners — latest openings", url: "https://www.hot-dinners.com/Gastroblog/Latest-news", type: MARKET_FEED_TYPES.openings, category: "Hospitality" },
  { name: "Time Out London — news", url: "https://www.timeout.com/london/news", type: MARKET_FEED_TYPES.openings, category: "Hospitality" },
  { name: "Landsec — news", url: "https://www.landsec.com/media/news", type: MARKET_FEED_TYPES.landlords, category: "Property" },
  { name: "British Land — news", url: "https://www.britishland.com/news/", type: MARKET_FEED_TYPES.landlords, category: "Property" },
  { name: "Shaftesbury Capital — news", url: "https://www.shaftesburycapital.com/en/media/news.html", type: MARKET_FEED_TYPES.landlords, category: "Property" },
  { name: "Grosvenor — news", url: "https://www.grosvenor.com/news-insights", type: MARKET_FEED_TYPES.landlords, category: "Property" },
];

export async function seedMarketFeeds(opts: { dryRun?: boolean } = {}) {
  const existing = new Set((await pool.query(`SELECT name FROM news_sources`)).rows.map((r: any) => r.name));
  const results: Array<{ name: string; status: string; items?: number; error?: string }> = [];
  const created: string[] = [];
  const room = opts.dryRun ? null : await planRoom();
  for (const source of MARKET_SOURCES) {
    if (existing.has(source.name)) { results.push({ name: source.name, status: "exists" }); continue; }
    if (opts.dryRun) { results.push({ name: source.name, status: source.feedUrl ? "would_add (native RSS)" : "would_create (RSS.app)" }); continue; }
    try {
      let feedUrl = source.feedUrl;
      let items: number | undefined;
      if (!feedUrl) {
        if (!room || room.free <= 0) { results.push({ name: source.name, status: "no_room" }); continue; }
        const feed = await createCheckedFeed(source.url);
        room.free--;
        feedUrl = feed.rss_feed_url;
        items = feed.items;
        await new Promise(r => setTimeout(r, 3000));
      }
      created.push(await insertSource({ name: source.name, url: source.url, feedUrl, type: source.type, category: source.category }));
      results.push({ name: source.name, status: "created", items });
    } catch (err: any) { results.push({ name: source.name, status: "failed", error: String(err?.message || err).slice(0, 200) }); }
  }
  await fetchNow(created);
  return { results };
}

// ─── Reading: brand feed card and News → Brand watch ────────────────────

const ALL_BRAND_FEED_TYPES = BRAND_FEED_TABS.map(tab => tab.type);

// "Baseline" = what was already on a page the first time we read it (a
// locations page's existing sites, a jobs page's standing roles): undated
// items from the source's first fetch. They show on the brand's tab but
// aren't news — only later additions are.
const BASELINE_SQL = `(a.fetched_at < first.at + interval '30 minutes'
    AND abs(extract(epoch FROM (COALESCE(a.published_at, a.fetched_at) - a.fetched_at))) < 600)`;
// Each source's first fetch, computed once per source (not per row).
const FIRST_FETCH_JOIN = `LEFT JOIN (SELECT f.source_id, min(f.fetched_at) AS at FROM news_articles f
    WHERE f.source_id IN (SELECT id FROM news_sources WHERE type = ANY($TYPES)) GROUP BY f.source_id) first ON first.source_id = ns.id`;

// Page feeds often give every item the page's own title ("Greggs Careers"
// ×6) — show the item's first sentence instead.
export function withDisplayTitles<T extends { title: string; summary: string | null; url: string; source_key?: string; type: string }>(items: T[]): T[] {
  const counts = new Map<string, number>();
  const keyOf = (item: T) => `${item.source_key || item.type}|${item.title.trim().toLowerCase()}`;
  for (const item of items) counts.set(keyOf(item), (counts.get(keyOf(item)) || 0) + 1);
  return items.map(item => {
    if ((counts.get(keyOf(item)) || 0) < 2) return item;
    const sentence = (item.summary || "").replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s/)[0]?.slice(0, 110);
    const slug = decodeURIComponent(new URL(item.url).pathname.split("/").filter(Boolean).at(-1) || "").replace(/[-_]+/g, " ").replace(/\ben\b$/i, "").trim();
    if (sentence && sentence.length > 12) {
      // The first sentence becomes the title — don't repeat it underneath.
      const rest = (item.summary || "").replace(/\s+/g, " ").trim().slice(sentence.length).trim();
      return { ...item, title: sentence, summary: rest || null };
    }
    return { ...item, title: slug ? slug.replace(/\b\w/g, ch => ch.toUpperCase()) : item.title };
  });
}

async function brandFeedItems(companyId: string) {
  const rows = (await pool.query(
    `SELECT a.id, a.title, a.summary, a.url, a.image_url, COALESCE(a.published_at, a.fetched_at) AS at, ns.type, ns.url AS source_url,
            ns.id AS source_key, ${BASELINE_SQL} AS baseline, first.at AS followed_at
       FROM news_articles a JOIN news_sources ns ON ns.id = a.source_id ${FIRST_FETCH_JOIN.replace("$TYPES", "$2")}
      WHERE ns.category = $1 AND ns.type = ANY($2)
      ORDER BY COALESCE(a.published_at, a.fetched_at) DESC NULLS LAST
      LIMIT 240`, [`brand:${companyId}`, ALL_BRAND_FEED_TYPES])).rows;
  return withDisplayTitles(rows);
}

async function callClaude(prompt: string) {
  let lastErr: any = null;
  for (const model of MODELS) {
    try {
      const msg = await anthropic.messages.create({ model, max_tokens: 450, messages: [{ role: "user", content: prompt }] }, { timeout: 30_000, maxRetries: 0 });
      const text = msg.content.map((b: any) => (b.type === "text" ? b.text : "")).join("").trim();
      if (text) return text;
    } catch (e: any) { lastErr = e; }
  }
  throw new Error(`AI read unavailable: ${lastErr?.message || "no response"}`);
}

const tabLabel = (type: string) => BRAND_FEED_TABS.find(tab => tab.type === type)?.label || BRAND_WATCH_FILTERS.find(f => f.key !== "all" && f.types.includes(type))?.label || type;
const clip = (text: string | null, n: number) => (text || "").replace(/\s+/g, " ").trim().slice(0, n);

export function brandFeedPrompt(brand: string, items: Array<{ title: string; summary: string | null; at: string; type: string; baseline?: boolean }>) {
  const line = (item: (typeof items)[number]) => `- [${tabLabel(item.type)}${item.baseline ? "" : ` · ${String(item.at).slice(0, 10)}`}] ${clip(item.title, 140)}${item.summary ? ` — ${clip(item.summary, 160)}` : ""}`;
  const fresh = items.filter(item => !item.baseline).slice(0, 35).map(line);
  const standing = items.filter(item => item.baseline).slice(0, 30).map(line);
  return `You are briefing a London retail/leisure property agent (BGP) on what ${brand} has been saying on its own channels.

NEW — posted or added since BGP started following (newest first):
${fresh.join("\n") || "(nothing yet)"}

ALREADY THERE — what the brand's pages listed when BGP started following (its current sites, standing roles, older posts). This is NOT news:
${standing.join("\n") || "(none)"}

Write 2-4 bullets, each starting "- **Label:** " (e.g. **Openings:**, **Hiring:**, **Campaigns:**, **Estate:**). Lead with anything property-relevant: new or coming-soon sites (name the place), closures, hiring for new locations or property/expansion roles, new formats. Everything under ALREADY THERE is the current estate or standing roles — at most one short **Estate:** line saying where it trades; never describe it as expansion, opening or new. Then one line on brand activity if useful. State only what the items say — no guesses about intentions or what something "suggests". Give dates as given. No headings, no preamble. Under 90 words.`;
}

export function brandWatchPrompt(items: Array<{ title: string; summary: string | null; at: string; type: string; brand: string | null; source: string }>) {
  const lines = items.slice(0, 70).map(item => `- [${tabLabel(item.type)} · ${item.brand || item.source} · ${String(item.at).slice(0, 10)}] ${clip(item.title, 140)}${item.summary ? ` — ${clip(item.summary, 120)}` : ""}`);
  return `You are writing the weekly "brand watch" note for BGP, a London retail and leisure property agency. Items from brands' own channels (websites, jobs, LinkedIn) and London openings / landlord press, newest first:
${lines.join("\n")}

Write 4-6 bullets, each starting "- **Label:** " where Label is a brand, landlord or theme. Pick what matters to property agents: brands opening or announcing sites (name the location), expansion hiring, landlord lettings and schemes, notable London openings. Name brands and places exactly as written. No headings, no preamble. Under 150 words.`;
}

async function cachedRead(key: string, latest: string | null, build: () => Promise<string>, force = false) {
  const saved = (await pool.query(`SELECT value FROM system_settings WHERE key = $1`, [key])).rows[0]?.value;
  if (!force && saved?.text && saved.latest === latest) return saved;
  const value = { text: await build(), at: new Date().toISOString(), latest };
  await pool.query(`INSERT INTO system_settings (key, value, updated_at) VALUES ($1, $2::jsonb, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [key, JSON.stringify(value)]);
  return value;
}

async function readCache(key: string) {
  return (await pool.query(`SELECT value FROM system_settings WHERE key = $1`, [key])).rows[0]?.value || null;
}

async function brandWatchItems(filterKey: string, days = 60) {
  const filter = BRAND_WATCH_FILTERS.find(f => f.key === filterKey) || BRAND_WATCH_FILTERS[0];
  // A page's baseline (what was listed when we started following — a
  // brand's sites, a landlord site's menu links) is not news: Brand watch
  // shows dated items and what was added since, never the page itself.
  const rows = (await pool.query(
    `SELECT a.id, a.title, a.summary, a.url, a.image_url, COALESCE(a.published_at, a.fetched_at) AS at, ns.type, ns.name AS source,
            ns.id AS source_key, c.id AS brand_id, c.name AS brand
       FROM news_articles a JOIN news_sources ns ON ns.id = a.source_id ${FIRST_FETCH_JOIN.replace("$TYPES", "$1")}
       LEFT JOIN crm_companies c ON ns.category LIKE 'brand:%' AND c.id = substring(ns.category from 7)
      WHERE ns.type = ANY($1) AND COALESCE(a.published_at, a.fetched_at) > now() - ($2 || ' days')::interval
        AND NOT ${BASELINE_SQL}
        AND rtrim(a.url, '/') <> rtrim(ns.url, '/')
      ORDER BY COALESCE(a.published_at, a.fetched_at) DESC NULLS LAST
      LIMIT 200`, [filter.types, String(days)])).rows;
  return withDisplayTitles(rows);
}

async function staffOnly(req: any, res: any) {
  const { resolveCompanyScope } = await import("./company-scope");
  if (await resolveCompanyScope(req)) { res.status(403).json({ error: "Available in the staff view." }); return false; }
  return true;
}

export function registerBrandWebFeedRoutes(app: Express) {
  // Brand page: every channel's items, grouped by tab, plus the saved AI read.
  app.get("/api/brand/:companyId/feed", requireAuth, async (req, res) => {
    try {
      const companyId = String(req.params.companyId);
      const items = await brandFeedItems(companyId);
      const sources = (await pool.query(`SELECT type, url FROM news_sources WHERE category = $1 AND active`, [`brand:${companyId}`])).rows;
      const tabs = BRAND_FEED_TABS.map(tab => ({ ...tab, sourceUrl: sources.find((s: any) => s.type === tab.type)?.url || null, items: items.filter((i: any) => i.type === tab.type).slice(0, 60) }))
        .filter(tab => tab.sourceUrl || tab.items.length);
      const read = await readCache(`brand-feed-read:${companyId}`);
      res.json({ tabs, read: read && read.latest === (items[0]?.at ? new Date(items[0].at).toISOString() : null) ? read : null, stale: !!read, latest: items[0]?.at || null });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/brand/:companyId/feed/read", requireAuth, async (req, res) => {
    try {
      const companyId = String(req.params.companyId);
      const company = (await pool.query(`SELECT name FROM crm_companies WHERE id = $1`, [companyId])).rows[0];
      const items = (await brandFeedItems(companyId)).filter((i: any) => Date.now() - new Date(i.at).getTime() < 120 * 864e5);
      if (!company || !items.length) return res.json({ read: null });
      const latest = new Date(items[0].at).toISOString();
      res.json({ read: await cachedRead(`brand-feed-read:${companyId}`, latest, () => callClaude(brandFeedPrompt(company.name, items)), req.body?.force === true) });
    } catch (e: any) { res.status(502).json({ error: e.message }); }
  });

  // Staff: find and follow this brand's openings / news / careers / LinkedIn.
  app.post("/api/brand/:companyId/feed/setup", requireAuth, async (req, res) => {
    try {
      if (!(await staffOnly(req, res))) return;
      const kinds = Array.isArray(req.body?.kinds) ? req.body.kinds : undefined;
      const companyId = String(req.params.companyId);
      // Reading the site and checking each feed takes a minute — run it in
      // the background and poll GET …/feed/setup.
      const key = `brand-web-feeds:${companyId}`;
      const { alreadyRunning } = startJob(key, () => ensureBrandWebFeeds(companyId, kinds, { dryRun: req.body?.dryRun === true }));
      res.status(202).json({ accepted: true, alreadyRunning, jobKey: key });
    } catch (e: any) { res.status(e.status || 500).json({ error: e.message }); }
  });

  app.get("/api/brand/:companyId/feed/setup", requireAuth, async (req, res) => {
    if (!(await staffOnly(req, res))) return;
    res.json(getJobStatus(`brand-web-feeds:${req.params.companyId}`) || { state: "idle" });
  });

  // News → Brand watch.
  app.get("/api/news/brand-watch", requireAuth, async (req, res) => {
    try {
      if (!(await staffOnly(req, res))) return;
      const filter = String(req.query.filter || "all");
      const items = await brandWatchItems(filter);
      const read = await readCache("brand-watch-read");
      res.json({ filters: BRAND_WATCH_FILTERS.map(({ key, label }) => ({ key, label })), items: items.map((i: any) => ({ ...i, label: tabLabel(i.type) })), read });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/news/brand-watch/read", requireAuth, async (req, res) => {
    try {
      if (!(await staffOnly(req, res))) return;
      const items = (await brandWatchItems("all", 14));
      if (!items.length) return res.json({ read: null });
      const latest = new Date(items[0].at).toISOString();
      res.json({ read: await cachedRead("brand-watch-read", latest, () => callClaude(brandWatchPrompt(items)), req.body?.force === true) });
    } catch (e: any) { res.status(502).json({ error: e.message }); }
  });

  // Admin: roll out to deal brands / seed market sources (dry run unless confirm).
  app.post("/api/admin/brand-web-feeds/deal-brands", requireAuth, requireAdmin, async (req, res) => {
    try {
      const limit = Math.min(Number(req.body?.limit) || 5, 40);
      const kinds = Array.isArray(req.body?.kinds) ? req.body.kinds : undefined;
      const brands = (await pool.query(
        `SELECT c.id, c.name FROM crm_companies c
          WHERE c.merged_into_id IS NULL AND c.company_type ILIKE 'tenant%'
            AND c.ai_generated_fields->'brand_identity'->>'status' = 'verified'
            AND EXISTS (SELECT 1 FROM crm_deals d WHERE d.tenant_id = c.id)
            AND NOT EXISTS (SELECT 1 FROM news_sources ns WHERE ns.category = 'brand:' || c.id AND ns.type = ANY($2))
            ${Array.isArray(req.body?.ids) && req.body.ids.length ? "AND c.id = ANY($3)" : ""}
          ORDER BY (SELECT count(*) FROM crm_deals d WHERE d.tenant_id = c.id) DESC, c.name
          LIMIT $1`, Array.isArray(req.body?.ids) && req.body.ids.length ? [limit, Object.values(BRAND_WEB_FEED_TYPES), req.body.ids] : [limit, Object.values(BRAND_WEB_FEED_TYPES)])).rows;
      const dryRun = req.body?.confirm !== true;
      const { alreadyRunning } = startJob("brand-web-feeds:deal-brands", async () => {
        const out = [];
        for (const brand of brands) {
          try { out.push(await ensureBrandWebFeeds(brand.id, kinds, { dryRun })); }
          catch (e: any) { out.push({ company: brand.name, error: e.message }); }
        }
        return { dryRun, brands: out };
      });
      res.status(202).json({ accepted: true, alreadyRunning, dryRun, brands: brands.map((b: any) => b.name) });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/admin/brand-web-feeds/deal-brands", requireAuth, requireAdmin, async (_req, res) => {
    res.json(getJobStatus("brand-web-feeds:deal-brands") || { state: "idle" });
  });

  app.post("/api/admin/market-feeds/seed", requireAuth, requireAdmin, async (req, res) => {
    const { alreadyRunning } = startJob("market-feeds:seed", () => seedMarketFeeds({ dryRun: req.body?.confirm !== true }));
    res.status(202).json({ accepted: true, alreadyRunning });
  });

  app.get("/api/admin/market-feeds/seed", requireAuth, requireAdmin, async (_req, res) => {
    res.json(getJobStatus("market-feeds:seed") || { state: "idle" });
  });
}
