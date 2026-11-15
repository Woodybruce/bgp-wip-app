// Count the stores: the pure rules for reading a brand's store pages out of
// its own sitemap and for comparing dated snapshots of that list. No I/O.

export type StoreCountMethod = "sitemap" | "website_list";
export type StoreSite = { key: string; label: string; town: string; url: string | null };
export type StoreSet = { prefix: string | null; uk: boolean | null; sites: StoreSite[]; comingSoon: StoreSite[] };
export type ShownSite = { label: string; town: string; url: string | null };

export interface StoreCountSummary {
  count: number | null;
  countedAt: string | null;
  method: StoreCountMethod | null;
  sourceUrl: string | null;
  uk: boolean | null;
  comingSoon: ShownSite[];
  change: null | { since: string; months: number; opened: ShownSite[]; closed: ShownSite[]; net: number };
  history: { countedAt: string; count: number }[];
}

export const MIN_SITES = 3;
export const PARTIAL_SHARE = 0.6;
export const MIN_GAP_DAYS = 20;
export const PARTIAL_FLAG = "partial?";
const DAY = 86_400_000;

// ─── Sitemap files ───────────────────────────────────────────────────────

const unescapeXml = (s: string) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'");

/** The <loc> values of a sitemap file: child sitemaps for an index, pages otherwise. */
export function readSitemapXml(xml: string): { sitemaps: string[]; pages: string[] } {
  const locs: string[] = [];
  const re = /<loc>\s*(?:<!\[CDATA\[)?\s*([^<\]\s][^<\]]*?)\s*(?:\]\]>)?\s*<\/loc>/gi;
  for (let m = re.exec(xml); m; m = re.exec(xml)) locs.push(unescapeXml(m[1]));
  return /<sitemapindex[\s>]/i.test(xml) ? { sitemaps: locs, pages: [] } : { sitemaps: [], pages: locs };
}

export function sitemapsFromRobots(text: string): string[] {
  const out: string[] = [];
  for (const line of String(text || "").split(/\r?\n/)) {
    const m = /^\s*sitemap\s*:\s*(\S+)/i.exec(line);
    if (m) out.push(m[1]);
  }
  return [...new Set(out)];
}

const MULTI_PART_SUFFIX = /^(?:co|com|org|net|ac|gov|ltd|plc|me)\.[a-z]{2}$/;
export function registrableDomain(host: string): string {
  const parts = String(host || "").toLowerCase().replace(/\.$/, "").split(".");
  return parts.slice(parts.length >= 3 && MULTI_PART_SUFFIX.test(parts.slice(-2).join(".")) ? -3 : -2).join(".");
}

/** A URL on the brand's own site. Sitemap files must be https; page URLs may be listed as http. */
export function onSite(url: string, domain: string, httpsOnly = true): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && (httpsOnly || u.protocol !== "http:")) return false;
    if (u.username || u.password || u.port) return false;
    return registrableDomain(u.hostname) === registrableDomain(domain);
  } catch { return false; }
}

const COUNTRIES = new Set("uk gb ie us ca au nz fr de es it nl be pt ch at se no dk fi pl cz hu ro gr tr ae sa qa kw bh om in cn hk sg my jp kr th ph id vn mx br ar cl za il eg ma lu is ee lv lt sk si hr bg rs ua cy mt".split(" "));
const LANGUAGES = new Set("en fr de es it nl pt sv da fi nb no pl cs hu ro el tr ar zh ja ko cy ga".split(" "));
const STORE_FILE = /stor|shop-?finder|location|restaurant|branch|pub|venue|hotel|gym|club|cinema|clinic|showroom|salon|baker|cafe/;
const BULK_FILE = /product|image|video|blog|news|post|article|categor|collection|tag|author|recipe|job|career|review|brand|sku/;
/** Which sitemap files to read first: 0 names store pages, 2 is catalogue or editorial, 1 the rest. */
export function sitemapRank(url: string): 0 | 1 | 2 {
  let name = url.toLowerCase();
  try { const u = new URL(url); name = (u.pathname + u.search).toLowerCase(); } catch {}
  const store = STORE_FILE.test(name), bulk = BULK_FILE.test(name);
  return store && !bulk ? 0 : bulk && !store ? 2 : 1;
}

const FILE_LOCALE = /(?:^|[\/_.=-])([a-z]{2})[-_]([a-z]{2})(?=[\/_.-]|$)/g;
/** Whether a sitemap file is named for the UK edition, another country's, or neither. */
export function sitemapLocale(url: string): "uk" | "other" | null {
  let name = url.toLowerCase();
  try { const u = new URL(url); name = (u.pathname + u.search).toLowerCase(); } catch {}
  const first = name.split("/").filter(Boolean)[0] || "";
  const codes: string[] = COUNTRIES.has(first) ? [first] : [];
  for (const m of name.matchAll(FILE_LOCALE)) if ([m[1], m[2]].every(c => COUNTRIES.has(c) || LANGUAGES.has(c))) codes.push(m[1], m[2]);
  return codes.some(c => c === "uk" || c === "gb") ? "uk" : codes.length ? "other" : null;
}

/** Reading order: UK files, then unlabelled, then other countries', catalogue and editorial last (6). */
export function sitemapOrder(url: string): number {
  const rank = sitemapRank(url), locale = sitemapLocale(url);
  return rank === 2 ? 6 : rank + (locale === "uk" ? 0 : locale === "other" ? 4 : 2);
}

// ─── Store pages from page URLs ──────────────────────────────────────────

const PLURAL = "stores|shops|restaurants|locations|pubs|bakeries|branches|cafes|venues|clubs|gyms|hotels|studios|salons|cinemas|bars|kitchens|outlets|showrooms|clinics|centres|centers";
const SINGULAR = "store|shop|restaurant|location|pub|bakery|branch|cafe|venue|club|gym|hotel|studio|salon|cinema|bar|kitchen|outlet|showroom|clinic|centre|center";
const LOCATION_WORD = new RegExp(
  `^(?:(?:our|all|uk|find|find-a|find-an|find-your|find-our)-)?(?:${PLURAL}|${SINGULAR})$`
  + `|^find-us$|^(?:${SINGULAR})-(?:locator|finder|locations|directory)$|^(?:${PLURAL})-list$`);
// Words that are as often a product range or an online shop as a list of sites.
const AMBIGUOUS_WORD = /^(?:shop|store|outlet|kitchens?|bars?|clubs?|studio|centre|center)$/;
const NOISE_SEGMENT = /^(?:blog|blogs|news|press|careers?|jobs|articles?|stories|recipes?|products?|collections?|categor(?:y|ies)|help|support|legal|media|tags?|author|events?|offers?|account|wp-content)$/;
const ECOMMERCE_SEGMENT = /^(?:products?|collections?|basket|cart|checkout|categor(?:y|ies)|pdp|sku)$/;
const NON_SITE_LEAF = /^(?:\d+|page|page-?\d+|p\d+|search|map|maps|all|view-all|near-me|nearby|book|booking|bookings|book-a-table|menu|menus|faq|faqs|index|list|results|directory|a-z|contact|contact-us|about|sitemap|coming-soon|opening-soon)$/;
const COMING_SOON = /(?:coming|opening)[-_]soon/;

const isLocale = (seg: string) => {
  const parts = seg.split(/[-_]/);
  return parts.length <= 2 && parts.every(p => p.length === 2) && parts.some(p => COUNTRIES.has(p) || LANGUAGES.has(p))
    && (parts.length === 2 || COUNTRIES.has(seg) || LANGUAGES.has(seg));
};

export const ukLocale = (locale: string) => locale.split(/[\/_-]/).some(p => p === "uk" || p === "gb");

/** Leading country or language segments (/uk/, /en-gb/, /gb/en/) split off a path. */
export function splitLocale(segments: string[]): { locale: string; uk: boolean; rest: string[] } {
  let n = 0;
  if (segments[0] && isLocale(segments[0])) n = segments[1] && isLocale(segments[1]) ? 2 : 1;
  const taken = segments.slice(0, n);
  return { locale: taken.join("/"), uk: ukLocale(taken.join("/")), rest: segments.slice(n) };
}

/** Lower-case path with no query, trailing slash or file extension: the same page reads the same. */
export function normalisePath(url: string): string | null {
  let path: string;
  try { path = new URL(url).pathname; } catch { return null; }
  try { path = decodeURIComponent(path); } catch {}
  return path.toLowerCase().replace(/\/{2,}/g, "/").replace(/\/(?:index|default)\.(?:html?|php|aspx?)$/, "")
    .replace(/\.(?:html?|php|aspx?)$/, "").replace(/\/+$/, "") || "/";
}

const SMALL_WORDS = new Set(["and", "of", "on", "upon", "the", "in", "at", "by", "under", "le", "la", "de", "next"]);
export function slugLabel(slug: string): string {
  const words = String(slug || "").toLowerCase().replace(/\.(?:html?|php|aspx?)$/, "").replace(/(?:coming|opening)[-_]soon/g, " ").split(/[-_+\s]+/).filter(Boolean);
  return words.map((w, i) => (i > 0 && SMALL_WORDS.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))).join(" ");
}

type Entry = { locale: string; uk: boolean; tail: string[]; url: string; real: boolean };

function leavesOf(entries: Entry[], keyBase: string): { sites: StoreSite[]; comingSoon: StoreSite[] } {
  const byTail = new Map<string, Entry>();
  const ordered = [...entries].sort((a, b) => Number(b.real) - Number(a.real) || a.locale.localeCompare(b.locale));
  for (const e of ordered) if (!byTail.has(e.tail.join("/"))) byTail.set(e.tail.join("/"), e);
  // /gyms/aberdare/timetable and /restaurants/soho/private-dining are a
  // site's own sub-pages: the first level made of the same few names under
  // many parents is cut off, and everything below it. County folders hold
  // near-unique names, so /pubs/kent/the-ship is left alone.
  let depth = 0;
  for (const e of byTail.values()) depth = Math.max(depth, e.tail.length);
  for (let d = 1; d < depth; d++) {
    const parents = new Set<string>(), names = new Set<string>();
    for (const e of byTail.values()) if (e.tail.length > d) { parents.add(e.tail.slice(0, d + 1).join("/")); names.add(e.tail[d]); }
    if (parents.size < 4 || names.size / parents.size >= 0.34) continue;
    for (const [k, e] of [...byTail.entries()]) {
      if (e.tail.length <= d) continue;
      byTail.delete(k);
      const parent = e.tail.slice(0, d);
      if (!byTail.has(parent.join("/"))) byTail.set(parent.join("/"), { ...e, tail: parent, url: e.url.replace(/\/+$/, "").split("/").slice(0, d - e.tail.length).join("/"), real: false });
    }
    break;
  }
  const folders = new Set<string>();
  for (const e of byTail.values()) for (let i = 1; i < e.tail.length; i++) folders.add(e.tail.slice(0, i).join("/"));
  const sites: StoreSite[] = [], comingSoon: StoreSite[] = [];
  for (const [k, e] of byTail) {
    if (folders.has(k)) continue;
    const leaf = e.tail[e.tail.length - 1], parent = e.tail[e.tail.length - 2];
    const label = slugLabel(leaf);
    if (!label) continue;
    const town = parent && !/^\d+$/.test(parent) && !COMING_SOON.test(parent) && !LOCATION_WORD.test(parent) ? slugLabel(parent) : label;
    (e.tail.some(s => COMING_SOON.test(s)) ? comingSoon : sites).push({ key: `${keyBase}/${k}`, label, town, url: e.url });
  }
  const byKey = (a: StoreSite, b: StoreSite) => a.key.localeCompare(b.key);
  return { sites: sites.sort(byKey), comingSoon: comingSoon.sort(byKey) };
}

function resolveGroup(prefix: string, entries: Entry[], domain: string): StoreSet | null {
  const dotUk = /\.uk$/.test(domain.toLowerCase());
  const byLocale = new Map<string, Entry[]>();
  for (const e of entries) { const list = byLocale.get(e.locale); if (list) list.push(e); else byLocale.set(e.locale, [e]); }
  const ukEdition = [...byLocale.entries()].filter(([, es]) => es[0].uk).sort((a, b) => b[1].length - a[1].length)[0];
  const tries: Array<{ entries: Entry[]; locale: string; uk: boolean | null }> = [];
  if (ukEdition) tries.push({ entries: ukEdition[1], locale: ukEdition[0], uk: true });
  // On a .uk domain the pages with no country segment are the UK ones.
  if (dotUk && byLocale.size > 1 && byLocale.has("")) tries.push({ entries: byLocale.get("")!, locale: "", uk: true });
  tries.push({ entries, locale: byLocale.size === 1 ? [...byLocale.keys()][0] : "", uk: dotUk ? true : null });
  for (const t of tries) {
    const base = `${t.locale ? `/${t.locale}` : ""}${prefix}`;
    const found = leavesOf(t.entries, base);
    if (found.sites.length && found.sites.length + found.comingSoon.length >= MIN_SITES) return { prefix: base, uk: t.uk, ...found };
  }
  return null;
}

const looksLikePlaces = (sites: StoreSite[]) => {
  const odd = sites.filter(s => { const words = s.key.split("/").pop()!.split(/[-_]/); return words.length > 5 || words.some(w => /^\d{3,}$/.test(w)); }).length;
  return odd / Math.max(1, sites.length) < 0.15;
};

/** The store pages among a site's page URLs: the largest group of leaf pages under a location word. */
export function pickStoreSet(pageUrls: string[], domain: string): StoreSet | null {
  const groups = new Map<string, { ambiguous: boolean; entries: Entry[] }>();
  const seen = new Set<string>();
  let ecommerce = false;
  for (const raw of pageUrls) {
    if (!onSite(raw, domain, false)) continue;
    const path = normalisePath(raw);
    if (!path || seen.has(path)) continue;
    seen.add(path);
    const { locale, uk, rest } = splitLocale(path.split("/").filter(Boolean));
    if (rest.some(s => ECOMMERCE_SEGMENT.test(s))) ecommerce = true;
    const word = rest.findIndex(s => LOCATION_WORD.test(s));
    if (word < 0 || rest.slice(0, word).some(s => NOISE_SEGMENT.test(s))) continue;
    let tail = rest.slice(word + 1);
    const full = tail.length;
    // /stores/belfast/events/quiz-night belongs to the Belfast store.
    const aside = tail.findIndex(s => NOISE_SEGMENT.test(s));
    if (aside >= 0) tail = tail.slice(0, aside);
    while (tail.length && (NON_SITE_LEAF.test(tail[tail.length - 1]) || (tail[tail.length - 1].length === 2 && LANGUAGES.has(tail[tail.length - 1])))) tail.pop();
    if (!tail.length) continue;
    const prefix = `/${rest.slice(0, word + 1).join("/")}`;
    const group = groups.get(prefix) || { ambiguous: AMBIGUOUS_WORD.test(rest[word]), entries: [] };
    const clean = raw.replace(/[?#].*$/, "");
    const url = tail.length === full ? clean : clean.replace(/\/+$/, "").split("/").slice(0, tail.length - full).join("/");
    group.entries.push({ locale, uk, tail, url, real: tail.length === full });
    groups.set(prefix, group);
  }
  let best: { set: StoreSet; clear: boolean; size: number } | null = null;
  for (const [prefix, group] of groups) {
    const set = resolveGroup(prefix, group.entries, domain);
    if (!set) continue;
    const size = set.sites.length + set.comingSoon.length;
    // "/shop/red-dress" is a catalogue: a bare shop, store, bar, kitchen
    // and the like counts only when nothing clearer exists, the site shows
    // no sign of selling online, and the leaves read as places.
    if (group.ambiguous && (ecommerce || size > 1000 || !looksLikePlaces(set.sites))) continue;
    const clear = !group.ambiguous;
    if (!best || (clear && !best.clear) || (clear === best.clear && (size > best.size || (size === best.size && prefix.length < (best.set.prefix || "").length)))) best = { set, clear, size };
  }
  return best ? best.set : null;
}

// ─── The website list (fallback) ─────────────────────────────────────────

const slug = (s: string) => String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const UK_POSTCODE = /\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i;

export function townFromAddress(address: string | null | undefined, fallback: string): string {
  const parts = String(address || "").split(",").map(p => p.replace(UK_POSTCODE, "").trim())
    .filter(p => p && !/^(?:uk|gb|united kingdom|great britain|england|scotland|wales|northern ireland)$/i.test(p) && !/^\d+$/.test(p));
  return parts[parts.length - 1] || fallback;
}

export type WebsiteListRow = { name: string; address?: string | null; country?: string | null; status?: string | null; notes?: string | null };

/** Sites from the rows already read off the brand's own website (brand_stores, source official_website). */
export function sitesFromWebsiteList(rows: WebsiteListRow[]): StoreSet {
  const named = rows.filter(r => r && String(r.name || "").trim());
  const gb = named.filter(r => String(r.country || "").toUpperCase() === "GB");
  const used = gb.length ? gb : named;
  const uk = gb.length ? true : used.length && used.every(r => String(r.country || "").trim()) ? false : null;
  const sites: StoreSite[] = [], comingSoon: StoreSite[] = [], keys = new Set<string>();
  for (const r of used) {
    const soon = String(r.notes || "").includes('"status":"coming_soon"');
    if (!soon && r.status !== "open") continue;
    let key = `${String(r.country || "xx").toLowerCase()}:${slug(r.name)}`;
    if (keys.has(key)) key = `${key}:${slug(r.address || "")}`;
    if (keys.has(key)) continue;
    keys.add(key);
    let url: string | null = null;
    try { url = JSON.parse(String(r.notes || "{}"))?.officialWebsite?.url || null; } catch {}
    const label = String(r.name).trim();
    (soon ? comingSoon : sites).push({ key, label, town: townFromAddress(r.address, label), url: typeof url === "string" ? url : null });
  }
  const byKey = (a: StoreSite, b: StoreSite) => a.key.localeCompare(b.key);
  return { prefix: null, uk, sites: sites.sort(byKey), comingSoon: comingSoon.sort(byKey) };
}

// ─── Comparing snapshots ─────────────────────────────────────────────────

/** A count well under the last good one is taken for a half-read site, unless a second, later read agrees with it. */
export function looksPartial(count: number, lastGood: number | null | undefined, lastFlagged?: number | null): boolean {
  if (!lastGood || count >= lastGood * PARTIAL_SHARE) return false;
  if (lastFlagged && Math.abs(count - lastFlagged) <= Math.max(1, lastFlagged * 0.1)) return false;
  return true;
}

const sortedWords = (s: string) => s.toLowerCase().split(/\s+/).sort().join(" ");
const wordsKey = (s: StoreSite) => `${sortedWords(s.label)}|${sortedWords(s.town)}`;

/** Sites that appeared and disappeared between two snapshots of the same list. */
export function diffSites(before: StoreSite[], after: StoreSite[]): { opened: StoreSite[]; closed: StoreSite[]; net: number } {
  const was = new Set(before.map(s => s.key)), now = new Set(after.map(s => s.key));
  let opened = after.filter(s => !was.has(s.key)), closed = before.filter(s => !now.has(s.key));
  // A page renamed "london-soho" → "soho-london" is the same site.
  const renamed = new Set(opened.map(wordsKey).filter(k => closed.some(c => wordsKey(c) === k)));
  opened = opened.filter(s => !renamed.has(wordsKey(s)));
  closed = closed.filter(s => !renamed.has(wordsKey(s)));
  const net = after.length - before.length;
  // Most of the list gone and as many new names in its place is a website
  // rebuild, not a year's trading: only the net figure is reported.
  if (before.length >= MIN_SITES && closed.length >= before.length * 0.5 && opened.length >= after.length * 0.5) return { opened: [], closed: [], net };
  const byLabel = (a: StoreSite, b: StoreSite) => a.label.localeCompare(b.label);
  return { opened: opened.sort(byLabel), closed: closed.sort(byLabel), net };
}

export type SnapshotMeta = {
  id: number; countedAt: string | Date; method: string; sourceUrl: string | null;
  pathPrefix: string | null; uk: boolean | null; siteCount: number; error: string | null;
};

const at = (s: SnapshotMeta) => new Date(s.countedAt).getTime();
export const sameBasis = (a: Pick<SnapshotMeta, "method" | "pathPrefix" | "uk">, b: Pick<SnapshotMeta, "method" | "pathPrefix" | "uk">) =>
  a.method === b.method && (a.pathPrefix ?? null) === (b.pathPrefix ?? null) && (a.uk ?? null) === (b.uk ?? null);

export function monthsBetween(from: string | Date, to: string | Date): number {
  return Math.max(1, Math.round((new Date(to).getTime() - new Date(from).getTime()) / (30.44 * DAY)));
}

/** The latest good snapshot, the one to compare it with, and the run of counts on the same basis. */
export function chooseSnapshots(rows: SnapshotMeta[]): { latest: SnapshotMeta | null; baseline: SnapshotMeta | null; history: { countedAt: string; count: number }[] } {
  const good = rows.filter(r => !r.error).sort((a, b) => at(a) - at(b));
  const latest = good[good.length - 1] || null;
  if (!latest) return { latest: null, baseline: null, history: [] };
  const same = good.filter(r => sameBasis(r, latest));
  const target = at(latest) - 365 * DAY;
  let baseline: SnapshotMeta | null = null;
  for (const r of same) {
    if (at(latest) - at(r) < MIN_GAP_DAYS * DAY) continue;
    if (!baseline || Math.abs(at(r) - target) < Math.abs(at(baseline) - target)) baseline = r;
  }
  const byDay = new Map<string, SnapshotMeta>();
  for (const r of same) byDay.set(new Date(r.countedAt).toISOString().slice(0, 10), r);
  const history = [...byDay.values()].slice(-24).map(r => ({ countedAt: new Date(r.countedAt).toISOString(), count: r.siteCount }));
  return { latest, baseline, history };
}

export const EMPTY_SUMMARY: StoreCountSummary = { count: null, countedAt: null, method: null, sourceUrl: null, uk: null, comingSoon: [], change: null, history: [] };

const shown = (s: StoreSite): ShownSite => ({ label: s.label, town: s.town, url: s.url ?? null });
const siteList = (v: unknown): StoreSite[] => (Array.isArray(v) ? v.filter(s => s && typeof s.key === "string" && typeof s.label === "string") : []);

export function buildSummary(
  rows: SnapshotMeta[],
  detail: (id: number) => { sites: unknown; comingSoon: unknown } | undefined,
): StoreCountSummary {
  const { latest, baseline, history } = chooseSnapshots(rows);
  if (!latest) return { ...EMPTY_SUMMARY };
  const now = detail(latest.id), then = baseline ? detail(baseline.id) : undefined;
  const diff = baseline && now && then ? diffSites(siteList(then.sites), siteList(now.sites)) : null;
  return {
    count: latest.siteCount,
    countedAt: new Date(latest.countedAt).toISOString(),
    method: latest.method === "sitemap" || latest.method === "website_list" ? latest.method : null,
    sourceUrl: latest.sourceUrl || null,
    uk: latest.uk ?? null,
    comingSoon: siteList(now?.comingSoon).map(shown),
    change: baseline && diff ? {
      since: new Date(baseline.countedAt).toISOString(),
      months: monthsBetween(baseline.countedAt, latest.countedAt),
      opened: diff.opened.map(shown), closed: diff.closed.map(shown), net: diff.net,
    } : null,
    history,
  };
}
