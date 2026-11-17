// Count the stores: a monthly count of each tenant brand's sites, read from
// the brand's OWN website and kept as dated snapshots, so openings and
// closures are worked out by comparing two reads of the same list rather
// than from press headlines. The store pages come from the site's sitemap
// (no AI); a brand with no such pages falls back to the list the app
// already holds from its website (brand_stores, source official_website).
// A failed read stores no count: a brand is never recorded as having none.
//
// Routes:
//   GET  /api/brand/:companyId/store-count           — summary (any login)
//   POST /api/brand/:companyId/store-count/refresh   — count now (BGP staff)
import { watchedSql, WATCH_RECHECK_DAYS } from "./crm-watch";
import { Router, type Request, type Response } from "express";
import { gunzipSync } from "node:zlib";
import { requireAuth } from "./auth";
import { pool } from "./db";
import { getBrandIdentity } from "./brand-identity";
import {
  readSitemapXml, sitemapsFromRobots, sitemapOrder, onSite, splitLocale, ukLocale, pickStoreSet, normalisePath, sitesFromWebsiteList,
  looksPartial, chooseSnapshots, buildSummary, EMPTY_SUMMARY, MIN_GAP_DAYS, PARTIAL_FLAG,
  type StoreSet, type StoreCountSummary, type SnapshotMeta, type StoreCountMethod,
} from "@shared/store-count";

export type { StoreCountSummary } from "@shared/store-count";

const router = Router();

const USER_AGENT = "BGP-Dashboard/1.0 (store count)";
const MAX_FILES = 40;
const MAX_URLS = 60_000;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_UNZIPPED_BYTES = 50 * 1024 * 1024;
const FILE_TIMEOUT_MS = 15_000;
// The edge proxy gives up on a request at about 45s, and the staff refresh waits for the read.
const READ_BUDGET_MS = 40_000;
const RECOUNT_DAYS = 30;
const INCOMPLETE_FLAG = `${PARTIAL_FLAG} sitemap not read in full`;

type SiteFile = { url: string; body: string };
type Query = (sql: string, params?: any[]) => Promise<{ rows: any[] }>;
export type StoreCountDeps = {
  fetchFile?: (url: string, timeoutMs: number) => Promise<SiteFile | null>;
  query?: Query;
  now?: () => Date;
  budgetMs?: number;
};

const queryOf = (deps: StoreCountDeps): Query => deps.query || ((sql, params) => pool.query(sql, params));
const missingTable = (e: any) => e?.code === "42P01";

export async function ensureStoreCountTable(): Promise<void> {
  await pool.query(`CREATE TABLE IF NOT EXISTS brand_store_counts (
    id serial primary key,
    brand_company_id varchar not null,
    counted_at timestamp not null default now(),
    method text not null,
    source_url text,
    path_prefix text,
    uk boolean,
    site_count integer not null,
    coming_soon_count integer not null default 0,
    sites jsonb not null,
    coming_soon jsonb,
    error text
  )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS brand_store_counts_brand_counted_idx ON brand_store_counts (brand_company_id, counted_at DESC)`);
  // When a brand was last tried, whether or not it could be counted, so the
  // nightly pass does not go back to the same unreadable site every night.
  await pool.query(`CREATE TABLE IF NOT EXISTS brand_store_count_attempts (
    brand_company_id varchar primary key,
    attempted_at timestamp not null default now(),
    reason text
  )`);
}

async function fetchSiteFile(url: string, timeoutMs: number): Promise<SiteFile | null> {
  const { safePublicFetch, readBodyCapped } = await import("./safe-fetch");
  const res = await safePublicFetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/xml,text/xml,text/plain,*/*;q=0.5" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) { try { await res.body?.cancel(); } catch {} return null; }
  // 8MB is the cap on what is downloaded. A file the server sent compressed
  // is read up to the sitemap standard's own 50MB once unpacked.
  const packed = /gzip|br|deflate|zstd/i.test(res.headers.get("content-encoding") || "");
  let bytes = await readBodyCapped(res, packed ? MAX_UNZIPPED_BYTES : MAX_FILE_BYTES);
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = gunzipSync(bytes, { maxOutputLength: MAX_UNZIPPED_BYTES });
  return { url: res.url || url, body: bytes.toString("utf8") };
}

const toHttps = (url: string) => url.trim().replace(/^http:\/\//i, "https://");

/** The store pages listed by the brand's sitemap. `incomplete` means a sitemap file that could hold them was not read. */
export async function readSitemapStoreSet(domain: string, deps: StoreCountDeps = {}): Promise<{ set: StoreSet | null; sourceUrl: string | null; incomplete: boolean }> {
  const deadline = Date.now() + (deps.budgetMs ?? READ_BUDGET_MS);
  const get = async (url: string): Promise<SiteFile | null> => {
    if (!onSite(url, domain)) return null;
    const left = deadline - Date.now();
    if (left <= 0) return null;
    try {
      const file = await (deps.fetchFile || fetchSiteFile)(url, Math.min(FILE_TIMEOUT_MS, Math.max(3000, left)));
      // A redirect off the brand's own site is not followed.
      return file && onSite(file.url || url, domain) ? file : null;
    } catch { return null; }
  };

  let host: string | null = null;
  let queue: string[] = [];
  for (const h of [domain, `www.${domain}`]) {
    const robots = await get(`https://${h}/robots.txt`);
    if (!robots) continue;
    host = new URL(robots.url || `https://${h}/`).hostname;
    queue = sitemapsFromRobots(robots.body).map(toHttps).filter(u => onSite(u, domain));
    break;
  }
  const guessed = new Set<string>();
  if (!queue.length) {
    for (const h of host ? [host] : [domain, `www.${domain}`]) for (const p of ["/sitemap.xml", "/sitemap_index.xml"]) guessed.add(`https://${h}${p}`);
    queue = [...guessed];
  }

  const seen = new Set(queue);
  const files: Array<{ url: string; pages: string[] }> = [];
  // A missed file matters when it could hold the store pages: never a
  // catalogue file, and another country's only when no UK set is found.
  let read = 0, total = 0, failedInARow = 0, missed = false, missedAbroad = false;
  const miss = (url: string) => { const o = sitemapOrder(url); if (o < 4) missed = true; else if (o < 6) missedAbroad = true; };
  while (queue.length) {
    queue.sort((a, b) => sitemapOrder(a) - sitemapOrder(b));
    if (read >= MAX_FILES || total >= MAX_URLS || failedInARow >= 5 || Date.now() >= deadline) { queue.forEach(miss); break; }
    const url = queue.shift()!;
    read++;
    const file = await get(url);
    if (!file) { failedInARow++; if (!guessed.has(url)) miss(url); continue; }
    failedInARow = 0;
    const { sitemaps, pages } = readSitemapXml(file.body);
    for (const s of sitemaps.map(toHttps)) if (onSite(s, domain) && !seen.has(s)) { seen.add(s); queue.push(s); }
    if (pages.length > MAX_URLS - total) miss(url);
    const kept = pages.slice(0, MAX_URLS - total);
    total += kept.length;
    files.push({ url, pages: kept });
  }

  const set = pickStoreSet(files.flatMap(f => f.pages), domain);
  if (!set) return { set: null, sourceUrl: null, incomplete: missed || missedAbroad };
  const ukEdition = ukLocale(splitLocale((set.prefix || "").split("/").filter(Boolean)).locale);
  const marker = `${set.prefix}/`;
  const source = files.find(f => f.pages.some(p => (normalisePath(p) || "").includes(marker)));
  return { set, sourceUrl: source?.url || files[0]?.url || null, incomplete: missed || (missedAbroad && !ukEdition) };
}

async function noteAttempt(q: Query, companyId: string, reason: string | null): Promise<void> {
  await q(`INSERT INTO brand_store_count_attempts (brand_company_id, attempted_at, reason) VALUES ($1, now(), $2)
           ON CONFLICT (brand_company_id) DO UPDATE SET attempted_at = now(), reason = EXCLUDED.reason`, [companyId, reason]).catch(() => {});
}

export async function countBrandStores(companyId: string, deps: StoreCountDeps = {}): Promise<{ ok: boolean; reason?: string; count?: number; method?: string }> {
  const q = queryOf(deps);
  const company = (await q(
    `SELECT id, name, domain, domain_url, website, uk_entity_name, trading_entities, ai_generated_fields FROM crm_companies WHERE id = $1`, [companyId])).rows[0];
  if (!company) return { ok: false, reason: "Company not found" };
  const fail = async (reason: string) => { await noteAttempt(q, companyId, reason); return { ok: false, reason }; };
  const identity = getBrandIdentity(company);
  if (identity.status !== "verified" || !identity.domain) return fail("Confirm the official website first");

  const fromSitemap = await readSitemapStoreSet(identity.domain, deps);
  let method: StoreCountMethod = "sitemap";
  let set = fromSitemap.set, sourceUrl = fromSitemap.sourceUrl;
  let flag: string | null = set && fromSitemap.incomplete ? INCOMPLETE_FLAG : null;
  if (!set) {
    // A brand already counted from its sitemap is not switched to the shorter
    // website list because one read failed: the two are not the same list.
    const hadSitemap = (await q(`SELECT 1 FROM brand_store_counts WHERE brand_company_id = $1 AND method = 'sitemap' AND error IS NULL LIMIT 1`, [companyId])).rows.length > 0;
    if (hadSitemap) return fail("The website's sitemap could not be read this time");
    const rows = (await q(
      `SELECT name, address, country, status, notes FROM brand_stores WHERE brand_company_id = $1 AND source_type = 'official_website'`, [companyId])).rows;
    set = sitesFromWebsiteList(rows);
    method = "website_list";
    sourceUrl = `https://${identity.domain}/`;
  }
  if (!set.sites.length) return fail("No store pages in the website's sitemap and no list read from the website");

  const earlier = (await q(
    `SELECT site_count, error, counted_at FROM brand_store_counts
      WHERE brand_company_id = $1 AND method = $2 AND path_prefix IS NOT DISTINCT FROM $3::text AND uk IS NOT DISTINCT FROM $4::boolean
      ORDER BY counted_at DESC LIMIT 12`, [companyId, method, set.prefix, set.uk])).rows;
  const lastGood = earlier.find(r => !r.error);
  // A low count that an earlier month's read also found is the brand's real size.
  const now = (deps.now || (() => new Date()))().getTime();
  const lastLow = earlier[0]?.error === PARTIAL_FLAG && now - new Date(earlier[0].counted_at).getTime() >= MIN_GAP_DAYS * 86_400_000 ? Number(earlier[0].site_count) : null;
  if (!flag && looksPartial(set.sites.length, lastGood ? Number(lastGood.site_count) : null, lastLow)) flag = PARTIAL_FLAG;

  await q(
    `INSERT INTO brand_store_counts (brand_company_id, method, source_url, path_prefix, uk, site_count, coming_soon_count, sites, coming_soon, error)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10)`,
    [companyId, method, sourceUrl, set.prefix, set.uk, set.sites.length, set.comingSoon.length, JSON.stringify(set.sites), JSON.stringify(set.comingSoon), flag]);
  await noteAttempt(q, companyId, flag);
  return { ok: true, count: set.sites.length, method, ...(flag ? { reason: flag } : {}) };
}

const metaOf = (r: any): SnapshotMeta => ({
  id: Number(r.id), countedAt: r.counted_at, method: String(r.method), sourceUrl: r.source_url ?? null,
  pathPrefix: r.path_prefix ?? null, uk: r.uk ?? null, siteCount: Number(r.site_count), error: r.error ?? null,
});

async function summaryWith(q: Query, companyId: string): Promise<StoreCountSummary> {
  const rows = (await q(
    `SELECT id, counted_at, method, source_url, path_prefix, uk, site_count, error FROM brand_store_counts
      WHERE brand_company_id = $1 ORDER BY counted_at DESC LIMIT 240`, [companyId])).rows.map(metaOf);
  const { latest, baseline } = chooseSnapshots(rows);
  if (!latest) return { ...EMPTY_SUMMARY };
  // The site lists are large, so only the two snapshots being compared are loaded.
  const lists = (await q(`SELECT id, sites, coming_soon FROM brand_store_counts WHERE id = ANY($1::int[])`,
    [[latest.id, ...(baseline ? [baseline.id] : [])]])).rows;
  const byId = new Map<number, { sites: unknown; comingSoon: unknown }>(lists.map((r: any) => [Number(r.id), { sites: r.sites, comingSoon: r.coming_soon }]));
  return buildSummary(rows, id => byId.get(id));
}

export async function storeCountSummary(companyId: string, deps: StoreCountDeps = {}): Promise<StoreCountSummary> {
  try {
    return await summaryWith(queryOf(deps), companyId);
  } catch (e: any) {
    if (missingTable(e)) return { ...EMPTY_SUMMARY };
    throw e;
  }
}

export async function storeCountEvidence(companyId: string, deps: StoreCountDeps = {}): Promise<{ count: number | null; opened: number; closed: number; net: number; months: number | null; comingSoon: number; uk: boolean | null }> {
  try {
    const s = await summaryWith(queryOf(deps), companyId);
    return {
      count: s.count, opened: s.change?.opened.length ?? 0, closed: s.change?.closed.length ?? 0, net: s.change?.net ?? 0,
      months: s.change?.months ?? null, comingSoon: s.comingSoon.length, uk: s.uk,
    };
  } catch {
    return { count: null, opened: 0, closed: 0, net: 0, months: null, comingSoon: 0, uk: null };
  }
}

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export async function nightlyStoreCountPass(cap = 90, deps: StoreCountDeps & { pauseMs?: number } = {}): Promise<{ attempted: number; counted: number; failed: number }> {
  const q = queryOf(deps);
  let attempted = 0, counted = 0, failed = 0;
  let due: any[] = [];
  try {
    due = (await q(
      `SELECT c.id FROM crm_companies c
         LEFT JOIN brand_store_count_attempts a ON a.brand_company_id = c.id
        WHERE c.company_type ILIKE 'tenant%' AND c.merged_into_id IS NULL AND c.archived_at IS NULL
          AND c.ai_generated_fields->'brand_identity'->>'status' = 'verified'
          AND (a.attempted_at IS NULL OR a.attempted_at < now() - interval '${RECOUNT_DAYS} days'
            OR (${watchedSql("c")} AND a.attempted_at < now() - interval '${WATCH_RECHECK_DAYS} days'))
        ORDER BY ${watchedSql("c")} DESC, a.attempted_at ASC NULLS FIRST, c.id
        LIMIT $1`, [cap])).rows;
  } catch (e: any) {
    console.error(`[store-count] nightly pass could not list brands: ${e?.message}`);
    return { attempted, counted, failed };
  }
  for (const row of due) {
    if (attempted > 0) await pause(deps.pauseMs ?? 1500);
    attempted++;
    try {
      const r = await countBrandStores(String(row.id), deps);
      if (r.ok) counted++; else failed++;
    } catch (e: any) {
      failed++;
      await noteAttempt(q, String(row.id), String(e?.message || "error").slice(0, 200));
    }
  }
  console.log(`[store-count] nightly pass: ${attempted} brands tried, ${counted} counted, ${failed} not counted`);
  return { attempted, counted, failed };
}

// ─── Routes ──────────────────────────────────────────────────────────────

router.get("/api/brand/:companyId/store-count", requireAuth, async (req: Request, res: Response) => {
  try {
    res.json(await storeCountSummary(String(req.params.companyId)));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

const counting = new Map<string, ReturnType<typeof countBrandStores>>();

router.post("/api/brand/:companyId/store-count/refresh", requireAuth, async (req: Request, res: Response) => {
  try {
    const { resolveCompanyScope } = await import("./company-scope");
    if (await resolveCompanyScope(req)) return res.status(403).json({ error: "BGP staff only" });
    const companyId = String(req.params.companyId);
    // A second press while a count is running waits for the first.
    const job = counting.get(companyId) || countBrandStores(companyId).finally(() => counting.delete(companyId));
    counting.set(companyId, job);
    const refresh = await job;
    res.json({ ...(await storeCountSummary(companyId)), refresh });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
