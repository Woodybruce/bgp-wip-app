// New brands going into the top UK centres (Woody, 2026-09-27: "any news
// about new brands going into those shopping centres"). Three sources, one
// feed per centre: brand opening signals already on brand pages, news
// articles the feeds pulled in, and a Google News search per centre. A
// headline counts when it names the centre and reads as an opening; the
// brand is linked when a CRM brand is named in it. Cached per centre for a
// day in system_settings, so every property page shares one fetch.
import { Router, type Request, type Response } from "express";
import { requireAuth } from "./auth";
import { pool } from "./db";
import { UK_CENTRES, benchmarkCentresFor, centreAt, type UkCentre } from "../shared/uk-centres";
import { namesElsewhere, postcodeAnchors, type PlaceContext } from "./property-news-place";
import { POSITIONING_PROFILES } from "../shared/scheme-positioning";

const router = Router();
const OPENING = /\b(opens?|opening|opened|to open|coming (?:soon )?to|set to (?:open|launch|arrive)|launch(?:es|ed|ing)?|signs?|signed|joins?|joining|debuts?|arriv(?:es|ing)|new (?:store|restaurant|shop|site|unit|flagship|venue|outlet)|takes? (?:space|a unit|units?)|secures?|lets? to|unveil(?:s|ed)?|expan(?:ds?|sion) (?:in|into|at|to))\b/i;
const CLOSING = /\b(clos(?:e|es|ed|ing|ure)|shut(?:s|ting)?|administration|exit(?:s|ing)?|quits?|vacat(?:e|es|ing))\b/i;
// Property-market stories that read like openings ("launches £80m office sale").
const NOISE = /\b(office (?:sale|building|space|scheme)|refinanc\w*|acquisitions?|acquires?|homes|apartments?|flats|planning application|brunch|menu|pop-?up|masterclass|advent|giveaway|competition|festival|workshop)\b/i;
const DAY_MS = 24 * 60 * 60 * 1000;
// Single-word brand names that are ordinary words in a headline.
const COMMON = new Set(["next", "boots", "game", "office", "river", "space", "white", "black", "house", "coffee", "pizza", "burger", "kitchen", "store", "market", "grand", "central", "square", "lakeside", "bluewater", "trafford", "arndale", "meadowhall", "bullring", "highcross", "silverburn", "braehead", "oracle", "lexicon", "touchwood", "westfield", "trinity"]);

export interface CentreOpening { centre: string; title: string; url: string; source: string | null; date: string | null; brand: { id: string; name: string } | null; origin: "signal" | "centre" | "news" | "web" }

const escapeRe = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const namesCentre = (text: string, centre: UkCentre) => [centre.name, ...centre.aliases]
  .some(alias => new RegExp(`(^|[^a-z0-9])${escapeRe(alias.toLowerCase().replace(/['’]/g, "'"))}([^a-z0-9]|$)`).test(text.toLowerCase().replace(/[’]/g, "'")));
// "Landsec (LSE:LAND) Signs a Danish Fashion Name…" is investor clickbait
// retelling an opening already listed (Woody, 2026-09-28).
const TICKER = /\((?:LSE|LON|NYSE|NASDAQ|AIM|OTC)\s*:\s*[A-Z.]+\)/i;
export const isOpeningHeadline = (text: string) => OPENING.test(text) && !CLOSING.test(text) && !NOISE.test(text) && !TICKER.test(text);

type BrandIndex = Array<{ id: string; name: string; re: RegExp }>;
let brandIndex: { at: number; list: BrandIndex } | null = null;
async function brands(): Promise<BrandIndex> {
  if (brandIndex && Date.now() - brandIndex.at < 6 * 60 * 60 * 1000) return brandIndex.list;
  const rows = (await pool.query(
    `SELECT id, name FROM crm_companies
      WHERE merged_into_id IS NULL AND company_type ILIKE 'tenant%' AND length(name) >= 4`
  )).rows as Array<{ id: string; name: string }>;
  const list = rows
    .map(row => ({ id: row.id, name: row.name.trim() }))
    .filter(row => !(row.name.split(/\s+/).length === 1 && COMMON.has(row.name.toLowerCase())))
    // A centre's own company row ("Westfield London") isn't a brand going in.
    .filter(row => !UK_CENTRES.some(centre => [centre.name, ...centre.aliases].some(alias => alias.toLowerCase() === row.name.toLowerCase())))
    // Longest first so "Five Guys" beats "Guys", "Ivy Asia" beats "Ivy".
    .sort((a, b) => b.name.length - a.name.length)
    .map(row => ({ ...row, re: new RegExp(`(^|[^A-Za-z0-9])${escapeRe(row.name)}('s)?([^A-Za-z0-9]|$)`, row.name.includes(" ") ? "i" : "") }));
  brandIndex = { at: Date.now(), list };
  return list;
}
export function brandNamed(text: string, list: BrandIndex) {
  const hit = list.find(brand => brand.re.test(text));
  return hit ? { id: hit.id, name: hit.name } : null;
}

async function googleNews(centre: UkCentre): Promise<Array<{ title: string; url: string; source: string | null; date: string | null }>> {
  const Parser = (await import("rss-parser")).default;
  const parser = new Parser({ timeout: 10000, headers: { "User-Agent": "BGP-Dashboard/1.0" } });
  const q = `"${centre.aliases[0]}" (opens OR opening OR "coming to" OR "set to open" OR signs OR launches OR "new store" OR "new restaurant")`;
  const feed = await parser.parseURL(`https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-GB&gl=GB&ceid=GB:en`);
  return (feed.items || []).slice(0, 25).map((item: any) => {
    let title = String(item.title || "").trim(), source: string | null = null;
    const dash = title.lastIndexOf(" - ");
    if (dash > 0) { source = title.slice(dash + 3).trim(); title = title.slice(0, dash).trim(); }
    return { title, url: item.link || "", source, date: item.isoDate || item.pubDate || null };
  });
}

async function centreFeed(centre: UkCentre, list: BrandIndex, anchors: string[] = []): Promise<CentreOpening[]> {
  const key = `centre-openings:v9:${centre.name}`;
  const cached = (await pool.query("SELECT value, updated_at FROM system_settings WHERE key = $1", [key])).rows[0];
  if (cached && Date.now() - new Date(cached.updated_at).getTime() < DAY_MS && Array.isArray(cached.value?.items)) return cached.value.items;

  const since = new Date(Date.now() - 365 * DAY_MS);
  // "Anthropologie … in Manchester's Royal Exchange" names the centre but
  // another town's building of the same name (Woody, 2026-09-28).
  const place: PlaceContext = { names: [centre.name, ...centre.aliases], anchors, lat: centre.lat, lng: centre.lng };
  const elsewhere = (text: string) => namesElsewhere(text, place);
  const aliases = [centre.name, ...centre.aliases].map(alias => `%${alias}%`);
  const items: CentreOpening[] = [];
  const signals = await pool.query(
    `SELECT s.headline, s.detail, s.source, s.signal_date, s.created_at, c.id AS brand_id, c.name AS brand_name
       FROM brand_signals s JOIN crm_companies c ON c.id = s.brand_company_id
      WHERE s.signal_type = 'opening' AND COALESCE(s.signal_date, s.created_at) >= $1
        AND (s.headline ILIKE ANY($2::text[]) OR s.detail ILIKE ANY($2::text[]))
      ORDER BY COALESCE(s.signal_date, s.created_at) DESC LIMIT 30`, [since, aliases]
  ).then(r => r.rows).catch(() => [] as any[]);
  for (const s of signals) {
    // The headline must name the centre — a detail line mentioning it is
    // often "…also trades at Bluewater".
    if (!namesCentre(s.headline, centre) || !isOpeningHeadline(s.headline) || elsewhere(s.headline)) continue;
    items.push({ centre: centre.name, title: s.headline, url: /^https?:/i.test(s.source || "") ? s.source : "", source: /^https?:/i.test(s.source || "") ? null : s.source,
      date: (s.signal_date || s.created_at)?.toISOString?.() || null, brand: { id: s.brand_id, name: s.brand_name }, origin: "signal" });
  }
  const news = await pool.query(
    // Press only — brand Instagram / LinkedIn / jobs posts ("join us in
    // store…", influencer ads) aren't opening news.
    `SELECT a.title, a.summary, a.url, a.source_name, a.published_at FROM news_articles a
       LEFT JOIN news_sources ns ON ns.id = a.source_id
      WHERE a.published_at >= $1 AND (a.title ILIKE ANY($2::text[]) OR a.summary ILIKE ANY($2::text[]))
        AND COALESCE(ns.type, '') NOT IN ('rssapp_instagram', 'rssapp_linkedin', 'rssapp_careers')
      ORDER BY a.published_at DESC LIMIT 40`, [since, aliases]
  ).then(r => r.rows).catch(() => [] as any[]);
  for (const a of news) {
    if (!namesCentre(`${a.title} ${a.summary || ""}`, centre) || !isOpeningHeadline(a.title) || elsewhere(`${a.title} ${a.summary || ""}`)) continue;
    items.push({ centre: centre.name, title: a.title, url: a.url, source: a.source_name, date: a.published_at?.toISOString?.() || null, brand: brandNamed(a.title, list), origin: "news" });
  }
  // The centre's own "what's new" page, followed through RSS.app (market
  // sources, category 'centre:<name>') — its items needn't name the centre.
  const own = await pool.query(
    `SELECT a.title, a.summary, a.url, ns.name AS source_name, COALESCE(a.published_at, a.fetched_at) AS at
       FROM news_articles a JOIN news_sources ns ON ns.id = a.source_id
      WHERE ns.category = $1 AND COALESCE(a.published_at, a.fetched_at) >= $2
      ORDER BY COALESCE(a.published_at, a.fetched_at) DESC LIMIT 40`, [`centre:${centre.name}`, since]
  ).then(r => r.rows).catch(() => [] as any[]);
  for (const a of own) {
    const text = `${a.title} ${a.summary || ""}`;
    const brand = brandNamed(a.title, list) || brandNamed(text, list);
    if (!isOpeningHeadline(a.title)) continue;
    items.push({ centre: centre.name, title: a.title, url: a.url, source: a.source_name, date: a.at?.toISOString?.() || null, brand, origin: "centre" });
  }
  const web = await googleNews(centre).catch(() => []);
  for (const a of web) {
    if (a.date && new Date(a.date) < since) continue;
    if (!namesCentre(a.title, centre) || !isOpeningHeadline(a.title) || elsewhere(a.title)) continue;
    items.push({ centre: centre.name, title: a.title, url: a.url, source: a.source, date: a.date ? new Date(a.date).toISOString() : null, brand: brandNamed(a.title, list), origin: "web" });
  }
  // One story, one row: the brand signal wins, then feed news, the centre's
  // own page and the web search.
  const seen = new Set<string>();
  // A feed's future date (an event listing) isn't when the news broke.
  for (const item of items) if (item.date && Date.parse(item.date) > Date.now() + DAY_MS) item.date = null;
  // Several outlets covering one opening collapse onto the brand + month.
  const words = (title: string) => new Set(title.toLowerCase().replace(/\s+[-–|]\s+[^-–|]{2,40}$/, "").split(/[^a-z0-9&]+/).filter(w => w.length > 2));
  const kept: Array<{ w: Set<string>; at: number }> = [];
  const deduped = items.filter(item => {
    // The same story retold ("Next opens its largest UK store at Bluewater")
    // — most words shared within a fortnight.
    const w = words(item.title), at = item.date ? Date.parse(item.date) : 0;
    if (kept.some(k => Math.abs(k.at - at) < 14 * DAY_MS && [...w].filter(x => k.w.has(x)).length / Math.min(w.size, k.w.size) >= 0.6)) return false;
    kept.push({ w, at });
    const keys = [item.title.replace(/\s+[-–|]\s+[^-–|]{2,40}$/, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 70)];
    if (item.brand) keys.push(`${item.brand.id}:${(item.date || "").slice(0, 7)}`);
    if (keys.some(k => seen.has(k))) return false;
    keys.forEach(k => seen.add(k));
    return true;
  }).sort((a, b) => (b.date || "").localeCompare(a.date || "")).slice(0, 12)
    // The outlet sits on the source line — drop its " - Kent Online" /
    // " | LBBOnline" tail from the headline.
    .map(item => {
      let title = item.title.replace(/^News\s*[|:–-]?\s+/i, ""), source = item.source;
      // Strip every outlet tail (" - Little Black Book - Kent Online").
      for (let m = /\s+[-–|]\s+([^-–|]{2,40})$/.exec(title); m; m = /\s+[-–|]\s+([^-–|]{2,40})$/.exec(title)) {
        source = source || m[1].trim();
        title = title.slice(0, m.index).trim();
      }
      // A feed named after the brand ("Mulberry") or the centre's own "what's
      // new" page isn't a source worth printing beside the brand link.
      if (source && (item.brand && source.toLowerCase() === item.brand.name.toLowerCase() || /what['’]s new|^news$|\s[—–-]\s*news$/i.test(source))) source = null;
      return { ...item, title, source };
    });
  await pool.query(`INSERT INTO system_settings (key, value, updated_at) VALUES ($1, $2::jsonb, NOW())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`, [key, JSON.stringify({ items: deduped })]).catch(() => {});
  return deduped;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]); }
  }));
  return out;
}

// GET /api/property/:propertyId/centre-openings — this centre first, then
// the top-25 UK centres (the luxury destinations for a luxury scheme).
router.get("/api/property/:propertyId/centre-openings", requireAuth, async (req: Request, res: Response) => {
  try {
    const propertyId = String(req.params.propertyId);
    const { resolveCompanyScope, isPropertyInScope } = await import("./company-scope");
    const scope = await resolveCompanyScope(req as any);
    if (scope && !(await isPropertyInScope(scope, propertyId))) return res.status(403).json({ error: "Access denied" });
    const property = (await pool.query("SELECT name, latitude, longitude, postcode, address FROM crm_properties WHERE id = $1", [propertyId])).rows[0];
    if (!property) return res.status(404).json({ error: "Property not found" });
    const lat = parseFloat(property.latitude), lng = parseFloat(property.longitude);
    // Coordinates first, else the name ("Bluewater Shopping Centre").
    const plain = (v: string) => ` ${v.toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, " ").trim()} `;
    const listed = (Number.isFinite(lat) && Number.isFinite(lng) ? centreAt(lat, lng) : null)
      || UK_CENTRES.find(centre => [centre.name, ...centre.aliases].some(alias => plain(property.name).includes(plain(alias)))) || null;
    // A centre we don't list is searched by its own name.
    const here: UkCentre = listed || { name: property.name, lat, lng, aliases: [String(property.name).replace(/\s*(shopping cent(?:re|er)|retail park)\s*$/i, "").trim() || property.name] };
    // The same peer set as the Brand gap benchmark: the luxury destinations
    // for a luxury scheme, else the top 25.
    const { readPropertyResearchContext } = await import("./property-gap-analysis");
    const positioning = (await readPropertyResearchContext(propertyId).catch(() => null))?.positioning || "mainstream";
    const peers = benchmarkCentresFor(positioning).filter(centre => centre.name !== here.name);
    const list = await brands();
    const addr = property.address && typeof property.address === "object" ? property.address : {};
    const hereAnchors = listed ? [] : [addr.city, addr.town, ...String(addr.formatted || "").split(",").slice(1), ...postcodeAnchors(property.postcode || addr.postcode)]
      .map(v => String(v || "").trim()).filter(v => v.length > 2);
    const [hereItems, ...peerItems] = await mapLimit([here, ...peers], 6, centre => centreFeed(centre, list, centre === here ? hereAnchors : []).catch(() => [] as CentreOpening[]));
    res.json({
      centre: here.name,
      here: hereItems,
      peers: peerItems.flat().sort((a, b) => (b.date || "").localeCompare(a.date || "")).slice(0, 60),
      peerCount: peers.length,
      peerLabel: POSITIONING_PROFILES[positioning].peersShort,
    });
  } catch (error: any) {
    console.error("[centre-openings]", error?.message);
    res.status(500).json({ error: error?.message || "Could not load openings" });
  }
});

export default router;
