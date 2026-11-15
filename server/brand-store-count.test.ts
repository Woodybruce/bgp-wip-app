/**
 * Count the stores: the sitemap rules, the snapshot comparison and the
 * counting run with its fetch and database stood in. No network, no DB.
 *
 * Run with: node --import tsx --test server/brand-store-count.test.ts
 */
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import {
  readSitemapXml, sitemapsFromRobots, registrableDomain, onSite, sitemapOrder, pickStoreSet, slugLabel, townFromAddress,
  sitesFromWebsiteList, looksPartial, diffSites, chooseSnapshots, buildSummary, monthsBetween, PARTIAL_FLAG,
  type StoreSite, type SnapshotMeta,
} from "@shared/store-count";

let mod: typeof import("./brand-store-count");

before(async () => {
  // The router imports ./auth → ./db, which needs DATABASE_URL to load. Nothing connects.
  process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://test:test@localhost:1/test";
  mod = await import("./brand-store-count");
});

const urls = (domain: string, paths: string[]) => paths.map(p => `https://www.${domain}${p}`);
const site = (key: string, label = slugLabel(key.split("/").pop()!), town = label): StoreSite => ({ key, label, town, url: `https://x.test${key}` });
const labels = (sites: { label: string }[]) => sites.map(s => s.label);

describe("sitemap files", () => {
  it("reads child sitemaps from an index and pages from a urlset", () => {
    const index = `<?xml version="1.0"?><sitemapindex xmlns="x"><sitemap><loc>https://a.com/s1.xml</loc></sitemap><sitemap><loc> https://a.com/s2.xml?a=1&amp;b=2 </loc></sitemap></sitemapindex>`;
    assert.deepEqual(readSitemapXml(index), { sitemaps: ["https://a.com/s1.xml", "https://a.com/s2.xml?a=1&b=2"], pages: [] });
    const set = `<urlset><url><loc><![CDATA[https://a.com/stores/leeds]]></loc><image:image><image:loc>https://cdn.a.com/x.jpg</image:loc></image:image></url><url>\n<loc>\nhttps://a.com/stores/york\n</loc></url></urlset>`;
    assert.deepEqual(readSitemapXml(set), { sitemaps: [], pages: ["https://a.com/stores/leeds", "https://a.com/stores/york"] });
    assert.deepEqual(readSitemapXml("<html><body>Not found</body></html>"), { sitemaps: [], pages: [] });
  });

  it("takes Sitemap lines from robots.txt", () => {
    assert.deepEqual(sitemapsFromRobots("User-agent: *\nDisallow: /basket\nSitemap: https://a.com/sitemap.xml\r\nsitemap:https://a.com/stores.xml\n# Sitemap: no"),
      ["https://a.com/sitemap.xml", "https://a.com/stores.xml"]);
    assert.deepEqual(sitemapsFromRobots("<html>hello</html>"), []);
  });

  it("keeps to the brand's own site, over https", () => {
    assert.equal(registrableDomain("www.nandos.co.uk"), "nandos.co.uk");
    assert.equal(registrableDomain("stores.example.com"), "example.com");
    assert.equal(onSite("https://www.example.co.uk/sitemap.xml", "example.co.uk"), true);
    assert.equal(onSite("https://locations.example.co.uk/sitemap.xml", "example.co.uk"), true);
    assert.equal(onSite("http://www.example.co.uk/sitemap.xml", "example.co.uk"), false);
    assert.equal(onSite("http://www.example.co.uk/stores/leeds", "example.co.uk", false), true);
    assert.equal(onSite("https://example.co.uk.evil.com/sitemap.xml", "example.co.uk"), false);
    assert.equal(onSite("https://other.co.uk/sitemap.xml", "example.co.uk"), false);
    assert.equal(onSite("https://user:pw@example.co.uk/sitemap.xml", "example.co.uk"), false);
    assert.equal(onSite("ftp://example.co.uk/sitemap.xml", "example.co.uk", false), false);
  });

  it("reads UK store files first and catalogue files last", () => {
    const files = [
      "https://a.com/sitemap-products-1.xml", "https://a.com/sitemaps/store-events-en-CZ_1.xml", "https://a.com/sitemap-pages.xml",
      "https://a.com/gb/en-gb/restaurant-sitemap.xml", "https://a.com/sitemap-stores.xml", "https://a.com/blog-sitemap.xml",
    ];
    assert.deepEqual([...files].sort((x, y) => sitemapOrder(x) - sitemapOrder(y)), [
      "https://a.com/gb/en-gb/restaurant-sitemap.xml", "https://a.com/sitemap-stores.xml", "https://a.com/sitemap-pages.xml",
      "https://a.com/sitemaps/store-events-en-CZ_1.xml", "https://a.com/sitemap-products-1.xml", "https://a.com/blog-sitemap.xml",
    ]);
  });
});

describe("store pages from a sitemap", () => {
  it("counts flat /restaurants/<slug> pages once each", () => {
    const set = pickStoreSet([
      ...urls("example.co.uk", ["/", "/about", "/menu", "/restaurants", "/restaurants/leeds", "/restaurants/leeds/", "/Restaurants/Leeds?utm=1",
        "/restaurants/york.html", "/restaurants/stratford-upon-avon", "/restaurants/search", "/restaurants/map", "/restaurants/all",
        "/restaurants/near-me", "/restaurants/page/2", "/restaurants/2", "/restaurants/faq", "/restaurants/en"]),
      "http://example.co.uk/restaurants/bath", "https://elsewhere.com/restaurants/paris",
    ], "example.co.uk");
    assert.ok(set);
    assert.equal(set.prefix, "/restaurants");
    assert.equal(set.uk, true);
    assert.deepEqual(labels(set.sites), ["Bath", "Leeds", "Stratford upon Avon", "York"]);
    assert.deepEqual(set.sites.map(s => s.key), ["/restaurants/bath", "/restaurants/leeds", "/restaurants/stratford-upon-avon", "/restaurants/york"]);
    assert.equal(set.sites[1].town, "Leeds");
    assert.equal(set.sites[1].url, "https://www.example.co.uk/restaurants/leeds");
  });

  it("needs three sites", () => {
    assert.equal(pickStoreSet(urls("example.com", ["/stores/leeds", "/stores/york", "/about"]), "example.com"), null);
    assert.equal(pickStoreSet(urls("example.com", ["/about", "/contact", "/menu"]), "example.com"), null);
  });

  it("counts the leaves of /pubs/<county>/<slug>; a county page is a folder", () => {
    const set = pickStoreSet(urls("example.co.uk", [
      "/pubs", "/pubs/kent", "/pubs/essex", "/pubs/surrey", "/pubs/kent/the-ship", "/pubs/kent/red-lion", "/pubs/essex/red-lion",
      "/pubs/surrey/red-lion", "/pubs/surrey/kings-arms", "/pubs/essex/white-hart",
    ]), "example.co.uk");
    assert.ok(set);
    assert.equal(set.prefix, "/pubs");
    assert.equal(set.sites.length, 6);
    assert.deepEqual(set.sites.find(s => s.key === "/pubs/kent/the-ship"), { key: "/pubs/kent/the-ship", label: "The Ship", town: "Kent", url: "https://www.example.co.uk/pubs/kent/the-ship" });
    assert.equal(set.sites.filter(s => s.label === "Red Lion").length, 3);
  });

  it("folds a site's own sub-pages into the site", () => {
    const gyms = ["aberdare", "leeds-north", "york", "bath", "hull"];
    const set = pickStoreSet(urls("example.com", gyms.flatMap(g => [
      `/gyms/${g}`, `/gyms/${g}/timetable`, `/gyms/${g}/personal-trainers`, `/gyms/${g}/personal-trainers/${g}-trainer-one`, `/gyms/${g}/personal-trainers/${g}-trainer-two`,
    ])), "example.com");
    assert.ok(set);
    assert.deepEqual(labels(set.sites), ["Aberdare", "Bath", "Hull", "Leeds North", "York"]);

    const nested = pickStoreSet(urls("example.co.uk", ["kent/the-ship", "kent/the-crown", "essex/the-bell", "essex/the-swan"].flatMap(p => [
      `/pubs/${p}`, `/pubs/${p}/christmas`, `/pubs/${p}/christmas/boxing-day`, `/pubs/${p}/find-us`, `/pubs/${p}/menu`,
    ])), "example.co.uk");
    assert.ok(nested);
    assert.deepEqual(labels(nested.sites), ["The Bell", "The Swan", "The Crown", "The Ship"]);
    assert.deepEqual(nested.sites.map(s => s.town), ["Essex", "Essex", "Kent", "Kent"]);
  });

  it("gives a store's events and a store listed only by a sub-page to the store", () => {
    const set = pickStoreSet(urls("example.com", [
      "/stores/belfast", "/stores/belfast/events/quiz-night", "/stores/events/summer-sale", "/stores/leeds/menu", "/stores/york",
      "/blog/stores/new-store-in-hull", "/careers/stores/manager", "/news/stores/a", "/news/stores/b", "/news/stores/c",
    ]), "example.com");
    assert.ok(set);
    assert.deepEqual(labels(set.sites), ["Belfast", "Leeds", "York"]);
    assert.equal(set.sites[1].url, "https://www.example.com/stores/leeds");
  });

  it("reports the UK edition when the site has one", () => {
    const set = pickStoreSet(urls("example.com", [
      "/uk/stores/leeds", "/uk/stores/york", "/uk/stores/bath", "/us/stores/boston", "/us/stores/austin", "/us/stores/denver", "/us/stores/miami",
    ]), "example.com");
    assert.ok(set);
    assert.equal(set.uk, true);
    assert.equal(set.prefix, "/uk/stores");
    assert.deepEqual(set.sites.map(s => s.key), ["/uk/stores/bath", "/uk/stores/leeds", "/uk/stores/york"]);

    const gb = pickStoreSet(urls("example.com", ["/gb/en/stores/leeds", "/gb/en/stores/york", "/gb/en/stores/bath", "/fr/fr/stores/paris"]), "example.com");
    assert.equal(gb?.prefix, "/gb/en/stores");
    assert.equal(gb?.uk, true);
    const enGb = pickStoreSet(urls("example.com", ["/en-gb/locations/leeds", "/en-gb/locations/york", "/en-gb/locations/bath", "/en-us/locations/boston"]), "example.com");
    assert.equal(enGb?.prefix, "/en-gb/locations");
    assert.equal(enGb?.sites.length, 3);
  });

  it("reports the whole set, UK unknown, when no edition is the UK's", () => {
    const set = pickStoreSet(urls("example.com", ["/us/stores/boston", "/us/stores/austin", "/fr/stores/paris", "/fr/stores/lyon"]), "example.com");
    assert.ok(set);
    assert.equal(set.uk, null);
    assert.equal(set.prefix, "/stores");
    assert.equal(set.sites.length, 4);
    assert.equal(pickStoreSet(urls("example.com", ["/stores/leeds", "/stores/york", "/stores/bath"]), "example.com")?.uk, null);
    assert.equal(pickStoreSet(urls("example.uk", ["/stores/leeds", "/stores/york", "/stores/bath"]), "example.uk")?.uk, true);
  });

  it("counts a store once across language versions", () => {
    const set = pickStoreSet(urls("example.com", [
      "/en/stores/leeds", "/en/stores/york", "/en/stores/bath", "/cy/stores/leeds", "/cy/stores/york", "/cy/stores/bath", "/stores/leeds",
    ]), "example.com");
    assert.ok(set);
    assert.deepEqual(set.sites.map(s => s.key), ["/stores/bath", "/stores/leeds", "/stores/york"]);
    assert.equal(set.sites[1].url, "https://www.example.com/stores/leeds");
  });

  it("on a .uk site treats pages with no country segment as the UK ones", () => {
    const set = pickStoreSet(urls("example.co.uk", ["/stores/leeds", "/stores/york", "/stores/bath", "/ie/stores/dublin", "/ie/stores/cork"]), "example.co.uk");
    assert.ok(set);
    assert.equal(set.uk, true);
    assert.deepEqual(labels(set.sites), ["Bath", "Leeds", "York"]);
  });

  it("chooses the largest group, and never a catalogue", () => {
    const hotels = ["a", "b", "c", "d", "e"].map(x => `/hotels/hotel-${x}`), bars = ["a", "b", "c"].map(x => `/restaurants/grill-${x}`);
    assert.equal(pickStoreSet(urls("example.com", [...hotels, ...bars]), "example.com")?.prefix, "/hotels");

    const catalogue = ["red-midi-dress", "blue-jeans", "wool-coat", "silk-scarf", "linen-shirt", "leather-belt"].map(p => `/shop/${p}`);
    assert.equal(pickStoreSet(urls("example.com", [...catalogue, "/products/red-midi-dress", "/basket"]), "example.com"), null);
    const withStores = pickStoreSet(urls("example.com", [...catalogue, "/stores/leeds", "/stores/york", "/stores/bath"]), "example.com");
    assert.equal(withStores?.prefix, "/stores");
    const skus = ["oak-worktop-600mm-3000", "white-gloss-door-715-pack-of-two", "chrome-tap-200123"].map(p => `/kitchens/${p}`);
    assert.equal(pickStoreSet(urls("example.com", skus), "example.com"), null);
    assert.equal(pickStoreSet(urls("example.com", ["/clubs/leeds", "/clubs/york", "/clubs/bath"]), "example.com")?.sites.length, 3);
  });

  it("keeps coming-soon sites apart from open ones", () => {
    const set = pickStoreSet(urls("example.co.uk", [
      "/restaurants/leeds", "/restaurants/york", "/restaurants/bath", "/restaurants/hull-coming-soon", "/restaurants/opening-soon/derby", "/restaurants/coming-soon",
    ]), "example.co.uk");
    assert.ok(set);
    assert.deepEqual(labels(set.sites), ["Bath", "Leeds", "York"]);
    assert.deepEqual(set.comingSoon.map(s => [s.label, s.town]), [["Hull", "Hull"], ["Derby", "Derby"]]);
  });

  it("makes a label and a town from a slug or an address", () => {
    assert.equal(slugLabel("kings-cross"), "Kings Cross");
    assert.equal(slugLabel("stratford-upon-avon"), "Stratford upon Avon");
    assert.equal(slugLabel("the_o2-arena.html"), "The O2 Arena");
    assert.equal(slugLabel("leeds-opening-soon"), "Leeds");
    assert.equal(townFromAddress("21 St Anne's Court, London W1F 0BJ, UK", "Soho"), "London");
    assert.equal(townFromAddress("Bristol", "Dream Factory"), "Bristol");
    assert.equal(townFromAddress("", "Soho"), "Soho");
  });
});

describe("the website list", () => {
  const note = (status: string) => JSON.stringify({ officialWebsite: { url: "https://example.com/locations", quote: "x", status } });
  it("counts open rows, keeps coming soon apart, and prefers the UK rows", () => {
    const set = sitesFromWebsiteList([
      { name: "Soho", address: "21 St Anne's Court, London", country: "GB", status: "open", notes: note("open") },
      { name: "Canary Wharf", address: "London", country: "GB", status: "unconfirmed", notes: note("coming_soon") },
      { name: "Leeds", address: "Leeds", country: "GB", status: "closed", notes: note("open") },
      { name: "Soho", address: "9 Broadwick St, London", country: "GB", status: "open", notes: "not json" },
      { name: "Madrid", address: "Madrid", country: "ES", status: "open", notes: note("open") },
    ]);
    assert.equal(set.prefix, null);
    assert.equal(set.uk, true);
    assert.deepEqual(set.sites.map(s => s.key), ["gb:soho", "gb:soho:9-broadwick-st-london"]);
    assert.deepEqual(set.sites[0], { key: "gb:soho", label: "Soho", town: "London", url: "https://example.com/locations" });
    assert.equal(set.sites[1].url, null);
    assert.deepEqual(labels(set.comingSoon), ["Canary Wharf"]);
  });

  it("says not UK when every row is abroad, unknown when countries are missing", () => {
    assert.equal(sitesFromWebsiteList([{ name: "Madrid", country: "ES", status: "open" }]).uk, false);
    assert.equal(sitesFromWebsiteList([{ name: "Somewhere", country: null, status: "open" }]).uk, null);
    assert.equal(sitesFromWebsiteList([]).sites.length, 0);
  });
});

describe("comparing snapshots", () => {
  it("lists what opened and what closed", () => {
    const before = [site("/stores/leeds"), site("/stores/york"), site("/stores/bath"), site("/stores/hull")];
    const after = [site("/stores/leeds"), site("/stores/york"), site("/stores/bath"), site("/stores/derby"), site("/stores/crewe")];
    const diff = diffSites(before, after);
    assert.deepEqual(labels(diff.opened), ["Crewe", "Derby"]);
    assert.deepEqual(labels(diff.closed), ["Hull"]);
    assert.equal(diff.net, 1);
    assert.deepEqual(diffSites(before, before), { opened: [], closed: [], net: 0 });
  });

  it("does not call a renamed page a closure and an opening", () => {
    const before = [site("/stores/london-soho"), site("/stores/york"), site("/stores/bath"), site("/stores/hull")];
    const after = [site("/stores/soho-london"), site("/stores/york"), site("/stores/bath"), site("/stores/hull")];
    assert.deepEqual(diffSites(before, after), { opened: [], closed: [], net: 0 });
  });

  it("reports only the net figure when the website was rebuilt", () => {
    const before = ["a", "b", "c", "d"].map(x => site(`/stores/old-${x}`));
    const after = ["a", "b", "c", "d", "e"].map(x => site(`/stores/new-${x}`));
    assert.deepEqual(diffSites(before, after), { opened: [], closed: [], net: 1 });
  });

  it("flags a count under 60% of the last good one as a partial read", () => {
    assert.equal(looksPartial(59, 100), true);
    assert.equal(looksPartial(60, 100), false);
    assert.equal(looksPartial(140, 100), false);
    assert.equal(looksPartial(5, null), false);
    assert.equal(looksPartial(5, 0), false);
    // The same low count a month later is the brand's real size.
    assert.equal(looksPartial(50, 100, 52), false);
    assert.equal(looksPartial(30, 100, 52), true);
  });

  const snap = (id: number, date: string, siteCount: number, over: Partial<SnapshotMeta> = {}): SnapshotMeta =>
    ({ id, countedAt: `${date}T03:00:00.000Z`, method: "sitemap", sourceUrl: "https://a.com/sitemap.xml", pathPrefix: "/stores", uk: true, siteCount, error: null, ...over });

  it("compares the latest good snapshot with the one nearest twelve months before it", () => {
    const rows = [snap(1, "2025-06-01", 80), snap(2, "2025-11-10", 90), snap(3, "2026-05-01", 95), snap(4, "2026-10-12", 99), snap(5, "2026-11-12", 100)];
    const picked = chooseSnapshots([...rows].reverse());
    assert.equal(picked.latest?.id, 5);
    assert.equal(picked.baseline?.id, 2);
    assert.deepEqual(picked.history.map(h => h.count), [80, 90, 95, 99, 100]);
    assert.equal(monthsBetween(picked.baseline!.countedAt, picked.latest!.countedAt), 12);
  });

  it("uses the oldest snapshot when none is a year old, and needs twenty days between the two", () => {
    const young = chooseSnapshots([snap(1, "2026-08-01", 90), snap(2, "2026-09-01", 92), snap(3, "2026-11-12", 100)]);
    assert.equal(young.baseline?.id, 1);
    assert.equal(monthsBetween(young.baseline!.countedAt, young.latest!.countedAt), 3);
    assert.equal(chooseSnapshots([snap(1, "2026-11-01", 90), snap(2, "2026-11-12", 100)]).baseline, null);
    assert.equal(chooseSnapshots([snap(1, "2026-11-12", 100)]).baseline, null);
    assert.equal(monthsBetween("2026-10-20T00:00:00Z", "2026-11-12T00:00:00Z"), 1);
    assert.deepEqual(chooseSnapshots([]), { latest: null, baseline: null, history: [] });
  });

  it("leaves flagged snapshots and other bases out of the comparison", () => {
    const rows = [
      snap(1, "2025-11-12", 40, { method: "website_list", pathPrefix: null }),
      snap(2, "2025-12-01", 300, { pathPrefix: "/us/stores", uk: null }),
      snap(3, "2026-01-05", 30, { error: PARTIAL_FLAG }),
      snap(4, "2026-06-01", 95),
      snap(5, "2026-11-12", 100),
      snap(6, "2026-11-14", 20, { error: PARTIAL_FLAG }),
    ];
    const picked = chooseSnapshots(rows);
    assert.equal(picked.latest?.id, 5);
    assert.equal(picked.baseline?.id, 4);
    assert.deepEqual(picked.history.map(h => h.count), [95, 100]);
    assert.equal(chooseSnapshots([snap(1, "2026-11-12", 20, { error: PARTIAL_FLAG })]).latest, null);
  });

  it("keeps at most 24 points of history, one a day", () => {
    const rows = Array.from({ length: 30 }, (_, i) => snap(i + 1, `20${24 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}-01`, 50 + i));
    rows.push({ ...snap(99, "2026-06-01", 500), countedAt: "2026-06-01T09:00:00.000Z" });
    const { history } = chooseSnapshots(rows);
    assert.equal(history.length, 24);
    assert.equal(history[history.length - 1].count, 500);
    assert.equal(history[0].count, 56);
  });

  it("builds the summary from the two snapshots", () => {
    const rows = [snap(1, "2025-11-12", 3), snap(2, "2026-11-12", 4)];
    const lists = new Map([
      [1, { sites: [site("/stores/leeds"), site("/stores/york"), site("/stores/hull")], comingSoon: [] }],
      [2, { sites: [site("/stores/leeds"), site("/stores/york"), site("/stores/derby"), site("/stores/crewe")], comingSoon: [site("/stores/bath-coming-soon", "Bath")] }],
    ]);
    const s = buildSummary(rows, id => lists.get(id));
    assert.equal(s.count, 4);
    assert.equal(s.method, "sitemap");
    assert.equal(s.uk, true);
    assert.equal(s.countedAt, "2026-11-12T03:00:00.000Z");
    assert.deepEqual(s.comingSoon, [{ label: "Bath", town: "Bath", url: "https://x.test/stores/bath-coming-soon" }]);
    assert.equal(s.change?.since, "2025-11-12T03:00:00.000Z");
    assert.equal(s.change?.months, 12);
    assert.deepEqual(labels(s.change!.opened), ["Crewe", "Derby"]);
    assert.deepEqual(s.change!.closed, [{ label: "Hull", town: "Hull", url: "https://x.test/stores/hull" }]);
    assert.equal(s.change?.net, 1);
    assert.equal(buildSummary([rows[1]], id => lists.get(id)).change, null);
    assert.equal(buildSummary([], () => undefined).count, null);
  });
});

// ─── The counting run, with fetch and the database stood in ──────────────

const COMPANY = {
  id: "c1", name: "Example", domain: "example.co.uk", domain_url: null, website: null, uk_entity_name: null, trading_entities: null,
  ai_generated_fields: { brand_identity: { status: "verified", domain: "example.co.uk" } },
};
const urlset = (paths: string[]) => `<urlset>${paths.map(p => `<url><loc>https://www.example.co.uk${p}</loc></url>`).join("")}</urlset>`;

function fakeSite(files: Record<string, string>) {
  const asked: string[] = [];
  const fetchFile = async (url: string) => { asked.push(url); return url in files ? { url, body: files[url] } : null; };
  return { asked, fetchFile };
}

function fakeDb(opts: { company?: any; earlier?: any[]; websiteRows?: any[]; snapshots?: any[]; lists?: any[]; due?: any[]; missing?: boolean; hadSitemap?: boolean } = {}) {
  const calls: { sql: string; params?: any[] }[] = [];
  const query = async (sql: string, params?: any[]) => {
    calls.push({ sql, params });
    if (opts.missing && /brand_store_count/.test(sql)) throw Object.assign(new Error('relation "brand_store_counts" does not exist'), { code: "42P01" });
    if (/LEFT JOIN brand_store_count_attempts/.test(sql)) return { rows: opts.due || [] };
    if (/FROM crm_companies WHERE id/.test(sql)) return { rows: opts.company === null ? [] : [{ ...(opts.company || COMPANY), id: params?.[0] }] };
    if (/FROM brand_stores/.test(sql)) return { rows: opts.websiteRows || [] };
    if (/SELECT 1 FROM brand_store_counts/.test(sql)) return { rows: opts.hadSitemap ? [{}] : [] };
    if (/SELECT site_count, error, counted_at/.test(sql)) return { rows: opts.earlier || [] };
    if (/SELECT id, sites, coming_soon/.test(sql)) return { rows: opts.lists || [] };
    if (/SELECT id, counted_at/.test(sql)) return { rows: opts.snapshots || [] };
    return { rows: [] };
  };
  const inserted = () => calls.filter(c => /INSERT INTO brand_store_counts /.test(c.sql));
  const attempts = () => calls.filter(c => /INSERT INTO brand_store_count_attempts/.test(c.sql));
  return { calls, query, inserted, attempts };
}

const STORES = ["/stores/leeds", "/stores/york", "/stores/bath", "/stores/hull"];
const NOW = () => new Date("2026-11-15T03:00:00Z");

describe("countBrandStores", () => {
  it("saves a sitemap snapshot", async () => {
    const web = fakeSite({
      "https://example.co.uk/robots.txt": "Sitemap: http://www.example.co.uk/sitemap.xml\nSitemap: https://evil.test/sitemap.xml",
      "https://www.example.co.uk/sitemap.xml": `<sitemapindex><sitemap><loc>https://www.example.co.uk/sitemap-products.xml</loc></sitemap><sitemap><loc>https://www.example.co.uk/sitemap-stores.xml</loc></sitemap><sitemap><loc>https://cdn.other.test/x.xml</loc></sitemap></sitemapindex>`,
      "https://www.example.co.uk/sitemap-stores.xml": urlset([...STORES, "/stores/derby-coming-soon"]),
      "https://www.example.co.uk/sitemap-products.xml": urlset(["/about"]),
    });
    const db = fakeDb();
    const r = await mod.countBrandStores("c1", { fetchFile: web.fetchFile, query: db.query, now: NOW });
    assert.deepEqual(r, { ok: true, count: 4, method: "sitemap" });
    // http is upgraded, another site's sitemap is never asked for, the store file is read before the catalogue.
    assert.deepEqual(web.asked, ["https://example.co.uk/robots.txt", "https://www.example.co.uk/sitemap.xml", "https://www.example.co.uk/sitemap-stores.xml", "https://www.example.co.uk/sitemap-products.xml"]);
    const [row] = db.inserted();
    assert.deepEqual(row.params!.slice(0, 7), ["c1", "sitemap", "https://www.example.co.uk/sitemap-stores.xml", "/stores", true, 4, 1]);
    assert.equal(JSON.parse(row.params![7]).length, 4);
    assert.deepEqual(JSON.parse(row.params![8]).map((s: any) => s.label), ["Derby"]);
    assert.equal(row.params![9], null);
    assert.equal(db.attempts().length, 1);
  });

  it("guesses /sitemap.xml when robots.txt names none", async () => {
    const web = fakeSite({ "https://www.example.co.uk/robots.txt": "User-agent: *", "https://www.example.co.uk/sitemap.xml": urlset(STORES) });
    const db = fakeDb();
    const r = await mod.countBrandStores("c1", { fetchFile: web.fetchFile, query: db.query, now: NOW });
    assert.equal(r.ok, true);
    assert.equal(db.inserted()[0].params![9], null);
    assert.deepEqual(web.asked, ["https://example.co.uk/robots.txt", "https://www.example.co.uk/robots.txt", "https://www.example.co.uk/sitemap.xml", "https://www.example.co.uk/sitemap_index.xml"]);
  });

  it("does not use a file the site redirected elsewhere for", async () => {
    const db = fakeDb();
    const fetchFile = async (url: string) => ({ url: "https://parked.test/sitemap.xml", body: urlset(STORES) });
    const r = await mod.countBrandStores("c1", { fetchFile, query: db.query, now: NOW });
    assert.equal(r.ok, false);
    assert.equal(db.inserted().length, 0);
  });

  it("falls back to the list read from the website", async () => {
    const db = fakeDb({ websiteRows: [
      { name: "Soho", address: "London", country: "GB", status: "open", notes: "{}" },
      { name: "Leeds", address: "Leeds", country: "GB", status: "open", notes: "{}" },
      { name: "Bath", address: "Bath", country: "GB", status: "unconfirmed", notes: '{"officialWebsite":{"status":"coming_soon"}}' },
    ] });
    const r = await mod.countBrandStores("c1", { fetchFile: fakeSite({}).fetchFile, query: db.query, now: NOW });
    assert.deepEqual(r, { ok: true, count: 2, method: "website_list" });
    assert.deepEqual(db.inserted()[0].params!.slice(0, 7), ["c1", "website_list", "https://example.co.uk/", null, true, 2, 1]);
  });

  it("does not swap a brand counted from its sitemap onto the website list when one read fails", async () => {
    const db = fakeDb({ hadSitemap: true, websiteRows: [{ name: "Soho", address: "London", country: "GB", status: "open", notes: "{}" }] });
    const r = await mod.countBrandStores("c1", { fetchFile: fakeSite({}).fetchFile, query: db.query, now: NOW });
    assert.equal(r.ok, false);
    assert.equal(db.inserted().length, 0);
    assert.equal(db.attempts().length, 1);
  });

  it("stores no count when nothing could be read", async () => {
    const db = fakeDb();
    const r = await mod.countBrandStores("c1", { fetchFile: fakeSite({}).fetchFile, query: db.query, now: NOW });
    assert.equal(r.ok, false);
    assert.equal(db.inserted().length, 0);
    assert.equal(db.attempts().length, 1);
  });

  it("does not read a website that is not verified, or a company that is not there", async () => {
    const web = fakeSite({});
    const db = fakeDb({ company: { ...COMPANY, ai_generated_fields: { brand_identity: { status: "review", domain: "example.co.uk" } } } });
    const r = await mod.countBrandStores("c1", { fetchFile: web.fetchFile, query: db.query, now: NOW });
    assert.deepEqual(r, { ok: false, reason: "Confirm the official website first" });
    assert.equal(web.asked.length, 0);
    assert.equal(db.inserted().length, 0);
    assert.equal(db.attempts().length, 1);
    const none = fakeDb({ company: null });
    assert.deepEqual(await mod.countBrandStores("nope", { fetchFile: web.fetchFile, query: none.query }), { ok: false, reason: "Company not found" });
    assert.equal(none.attempts().length, 0);
  });

  it("saves a count far below the last good one as flagged", async () => {
    const files = { "https://example.co.uk/robots.txt": "Sitemap: https://www.example.co.uk/sitemap.xml", "https://www.example.co.uk/sitemap.xml": urlset(STORES) };
    const db = fakeDb({ earlier: [{ site_count: 10, error: null, counted_at: "2026-10-12T03:00:00Z" }] });
    const r = await mod.countBrandStores("c1", { fetchFile: fakeSite(files).fetchFile, query: db.query, now: NOW });
    assert.deepEqual(r, { ok: true, count: 4, method: "sitemap", reason: PARTIAL_FLAG });
    assert.equal(db.inserted()[0].params![9], PARTIAL_FLAG);
    // The comparison is with snapshots of the same method, prefix and UK flag only.
    assert.deepEqual(db.calls.find(c => /SELECT site_count, error, counted_at/.test(c.sql))!.params, ["c1", "sitemap", "/stores", true]);

    const again = fakeDb({ earlier: [{ site_count: 4, error: PARTIAL_FLAG, counted_at: "2026-10-12T03:00:00Z" }, { site_count: 10, error: null, counted_at: "2026-09-12T03:00:00Z" }] });
    await mod.countBrandStores("c1", { fetchFile: fakeSite(files).fetchFile, query: again.query, now: NOW });
    assert.equal(again.inserted()[0].params![9], null);

    const tooSoon = fakeDb({ earlier: [{ site_count: 4, error: PARTIAL_FLAG, counted_at: "2026-11-10T03:00:00Z" }, { site_count: 10, error: null, counted_at: "2026-09-12T03:00:00Z" }] });
    await mod.countBrandStores("c1", { fetchFile: fakeSite(files).fetchFile, query: tooSoon.query, now: NOW });
    assert.equal(tooSoon.inserted()[0].params![9], PARTIAL_FLAG);
  });

  it("flags a count when a sitemap file that could hold stores was not read", async () => {
    const web = fakeSite({
      "https://example.co.uk/robots.txt": "Sitemap: https://www.example.co.uk/sitemap.xml",
      "https://www.example.co.uk/sitemap.xml": `<sitemapindex>${["stores-1", "stores-2", "products-1"].map(n => `<sitemap><loc>https://www.example.co.uk/${n}.xml</loc></sitemap>`).join("")}</sitemapindex>`,
      "https://www.example.co.uk/stores-1.xml": urlset(STORES),
    });
    const db = fakeDb();
    const r = await mod.countBrandStores("c1", { fetchFile: web.fetchFile, query: db.query, now: NOW });
    assert.equal(r.ok, true);
    assert.match(String(db.inserted()[0].params![9]), /^partial\?/);
  });

  it("stops at 40 sitemap files", async () => {
    const files: Record<string, string> = {
      "https://example.co.uk/robots.txt": "Sitemap: https://www.example.co.uk/sitemap.xml",
      "https://www.example.co.uk/sitemap.xml": `<sitemapindex>${Array.from({ length: 80 }, (_, i) => `<sitemap><loc>https://www.example.co.uk/pages-${i}.xml</loc></sitemap>`).join("")}</sitemapindex>`,
    };
    for (let i = 0; i < 80; i++) files[`https://www.example.co.uk/pages-${i}.xml`] = urlset([`/stores/town-${i}`]);
    const web = fakeSite(files);
    const found = await mod.readSitemapStoreSet("example.co.uk", { fetchFile: web.fetchFile });
    assert.equal(web.asked.filter(u => u.endsWith(".xml")).length, 40);
    assert.equal(found.set?.sites.length, 39);
    assert.equal(found.incomplete, true);
  });
});

describe("summary, evidence and the nightly pass", () => {
  it("reads the summary from two snapshots", async () => {
    const db = fakeDb({
      snapshots: [
        { id: 2, counted_at: "2026-11-12T03:00:00Z", method: "sitemap", source_url: "https://a/sitemap.xml", path_prefix: "/stores", uk: true, site_count: 3, error: null },
        { id: 1, counted_at: "2025-11-12T03:00:00Z", method: "sitemap", source_url: "https://a/sitemap.xml", path_prefix: "/stores", uk: true, site_count: 2, error: null },
      ],
      lists: [
        { id: 1, sites: [site("/stores/leeds"), site("/stores/hull")], coming_soon: [] },
        { id: 2, sites: [site("/stores/leeds"), site("/stores/york"), site("/stores/bath")], coming_soon: [site("/stores/derby-coming-soon", "Derby")] },
      ],
    });
    const s = await mod.storeCountSummary("c1", { query: db.query });
    assert.equal(s.count, 3);
    assert.equal(s.change?.net, 1);
    assert.deepEqual(db.calls[1].params, [[2, 1]]);
    assert.deepEqual(await mod.storeCountEvidence("c1", { query: db.query }), { count: 3, opened: 2, closed: 1, net: 1, months: 12, comingSoon: 1, uk: true });
  });

  it("gives an empty answer when the table is missing or empty", async () => {
    const empty = { count: null, opened: 0, closed: 0, net: 0, months: null, comingSoon: 0, uk: null };
    assert.deepEqual(await mod.storeCountEvidence("c1", { query: fakeDb({ missing: true }).query }), empty);
    assert.deepEqual(await mod.storeCountEvidence("c1", { query: fakeDb().query }), empty);
    assert.deepEqual(await mod.storeCountEvidence("c1", { query: async () => { throw new Error("down"); } }), empty);
    const s = await mod.storeCountSummary("c1", { query: fakeDb({ missing: true }).query });
    assert.deepEqual(s, { count: null, countedAt: null, method: null, sourceUrl: null, uk: null, comingSoon: [], change: null, history: [] });
  });

  it("carries on past a brand that fails", async () => {
    const files = { "https://example.co.uk/robots.txt": "Sitemap: https://www.example.co.uk/sitemap.xml", "https://www.example.co.uk/sitemap.xml": urlset(STORES) };
    const db = fakeDb({ due: [{ id: "a" }, { id: "boom" }, { id: "c" }] });
    const query = async (sql: string, params?: any[]) => {
      if (/FROM crm_companies WHERE id/.test(sql) && params?.[0] === "boom") throw new Error("connection lost");
      return db.query(sql, params);
    };
    const log = console.log;
    const lines: string[] = [];
    console.log = (...a: any[]) => { lines.push(a.join(" ")); };
    try {
      const r = await mod.nightlyStoreCountPass(90, { fetchFile: fakeSite(files).fetchFile, query, now: NOW, pauseMs: 0 });
      assert.deepEqual(r, { attempted: 3, counted: 2, failed: 1 });
    } finally { console.log = log; }
    assert.equal(lines.length, 1);
    assert.deepEqual(db.calls[0].params, [90]);
    assert.match(db.calls[0].sql, /company_type ILIKE 'tenant%' AND c\.merged_into_id IS NULL AND c\.archived_at IS NULL/);
    assert.equal(db.inserted().length, 2);
    assert.deepEqual(await mod.nightlyStoreCountPass(90, { query: async () => { throw new Error("down"); } }), { attempted: 0, counted: 0, failed: 0 });
  });
});
