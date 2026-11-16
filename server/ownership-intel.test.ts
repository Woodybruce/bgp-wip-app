/**
 * Who owns the brand: reading the London Food Money Matrix, matching its
 * names to the brand directory and what a read may write. The page fetch and
 * the database are stood in. No network, no DB.
 *
 * Run with: node --import tsx --test server/ownership-intel.test.ts
 */
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import {
  readOwnershipPage, ownershipNameKey, sameOwner, ownershipReadCutShort, planOwnership, ownershipKindLine, ownershipKindFits,
  OWNERSHIP_SOURCE_NAME, type OwnershipBrand, type OwnershipPlace, type OwnershipIntel,
} from "@shared/ownership-intel";

let mod: typeof import("./ownership-intel");
before(async () => {
  // The routes import ./auth → ./db, which needs DATABASE_URL to load. Nothing connects.
  process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://test:test@localhost:1/test";
  mod = await import("./ownership-intel");
});

const NOW = new Date("2026-11-16T03:00:00Z");
const row = (n: string, c: string, o: string, extra: Record<string, unknown> = {}) => ({ n, a: "Somewhere", area: "Soho", ll: [51.5, -0.1], cu: "x", k: "x", pr: 2, c, o, y: 2021, note: `${n} note.`, src: `https://example.com/${encodeURIComponent(n)}`, ...extra });
const page = (rows: unknown[]) => `<html><script>const CATS={"pe":1};const ORDER=["pe"];const PLACES=${JSON.stringify(rows)};const LM=[1,2];</script></html>`;
const place = (name: string, kind: OwnershipPlace["kind"], owner: string, extra: Partial<OwnershipPlace> = {}): OwnershipPlace =>
  ({ name, kind, owner, since: 2021, note: "", source: `https://example.com/${name}`, area: "Soho", ...extra });
const brand = (id: string, name: string, extra: Partial<OwnershipBrand> = {}): OwnershipBrand => ({ id, name, backers: null, hidden: false, fits: true, intel: null, ...extra });
const intelOf = (owner: string, extra: Partial<OwnershipIntel> = {}): OwnershipIntel =>
  ({ owner, kind: "pe", since: 2021, note: "", source: "https://example.com/Pret", via: OWNERSHIP_SOURCE_NAME, viaUrl: "https://x.test/", readAt: "2026-11-09T03:00:00.000Z", firstSeenAt: "2026-11-09T03:00:00.000Z", ...extra });

describe("reading the page", () => {
  it("reads the list, keeps only the fields it knows and drops what it cannot trust", () => {
    const places = readOwnershipPage(page([
      row("Pret A Manger", "pe", "JAB Holding", { y: 2018 }),
      row("Odd <b>Name</b>", "corp", "Parent <script>x</script>", { y: "2019", src: "javascript:alert(1)" }),
      row("No kind", "weird", "Someone"),
      row("Bad year", "ind", "Founder", { y: "circa 1990" }),
      { n: "", c: "pe" }, null, "text",
    ]), NOW)!;
    assert.deepEqual(places.map(p => p.name), ["Pret A Manger", "Odd bName/b", "Bad year"]);
    assert.deepEqual(places[0], { name: "Pret A Manger", kind: "pe", owner: "JAB Holding", since: 2018, note: "Pret A Manger note.", source: "https://example.com/Pret%20A%20Manger", area: "Soho" });
    assert.equal(places[1].owner, "Parent scriptx/script");
    assert.equal(places[1].since, 2019);
    assert.equal(places[1].source, null, "only an http(s) link is kept as a source");
    assert.equal(places[2].since, null);
  });
  it("is null when the page no longer holds its list as an array it can parse", () => {
    assert.equal(readOwnershipPage("<html>Not found</html>", NOW), null);
    assert.equal(readOwnershipPage("<script>const PLACES=[{n:'Pret'}];</script>", NOW), null);
    assert.equal(readOwnershipPage('<script>const PLACES=[{"n":"Pret"', NOW), null);
  });
  it("a bracket inside a note does not end the list early", () => {
    const places = readOwnershipPage(page([row("A", "pe", "X", { note: "Sold [again] in 2024]" }), row("B", "ind", "Founder")]), NOW)!;
    assert.equal(places.length, 2);
  });
  it("treats a short or shrunken read as cut short", () => {
    assert.equal(ownershipReadCutShort(50, null), true);
    assert.equal(ownershipReadCutShort(591, null), false);
    assert.equal(ownershipReadCutShort(300, 591), true);
    assert.equal(ownershipReadCutShort(560, 591), false);
  });
});

describe("matching names", () => {
  it("ignores case, accents, apostrophes, '&' and a leading The; nothing else", () => {
    assert.equal(ownershipNameKey("Gail's"), ownershipNameKey("GAILS"));
    assert.equal(ownershipNameKey("Côte"), ownershipNameKey("Cote"));
    assert.equal(ownershipNameKey("Joe & the Juice"), ownershipNameKey("Joe and The Juice"));
    assert.equal(ownershipNameKey("The Ivy"), ownershipNameKey("Ivy"));
    assert.equal(ownershipNameKey("Wahaca Ltd"), ownershipNameKey("Wahaca"));
    assert.notEqual(ownershipNameKey("Monmouth Coffee"), ownershipNameKey("Monmouth"));
    assert.notEqual(ownershipNameKey("Pizza Pilgrims"), ownershipNameKey("Pizza"));
  });
  it("knows when our Backers already names the page's owner", () => {
    assert.equal(sameOwner("BGF", "BGF (minority); founder Gordon Ker majority"), true);
    assert.equal(sameOwner("The Big Table Group", "Epiris (The Big Table Group)"), true, "a group named in brackets counts");
    assert.equal(sameOwner("Lemon Pepper Holdings, Wingstop Restaurants Inc.", "Sixth Street (Lemon Pepper Holdings)"), true);
    assert.equal(sameOwner("Cyrus Capital Partners, Bain Capital", "Bain Capital Credit, Cyrus Capital"), true, "a trailing Credit is not needed to agree");
    assert.equal(sameOwner("Bain Capital, McWin Capital Partners, Luke Johnson", "Bain Capital Credit"), true);
    assert.equal(sameOwner("Piper", "TriSpan + McWin"), false);
    assert.equal(sameOwner("", "JAB Holding"), false);
    assert.equal(sameOwner("Graphite", "Capital"), false, "a bare Capital names nobody");
  });
  it("takes a brand on its name only when it is recorded as food and drink, or as nothing in particular", () => {
    assert.equal(ownershipKindFits("Tenant - Restaurant", null), true);
    assert.equal(ownershipKindFits("Tenant - Café", ""), true);
    assert.equal(ownershipKindFits("Tenant", null), true);
    assert.equal(ownershipKindFits("Tenant - Retail", "Coffee shops"), true);
    assert.equal(ownershipKindFits("Tenant - Retail", null), false);
    assert.equal(ownershipKindFits("Tenant - Leisure", "Real Estate - General"), false);
    assert.equal(ownershipKindFits("Tenant", "Plumbing supplies"), false);
  });
});

describe("what a read may write", () => {
  const at = NOW.toISOString();
  it("saves the reading on the one matching brand and fills a blank Backers", () => {
    const { writes, report } = planOwnership([place("Pret A Manger", "pe", "JAB Holding", { since: 2018 })], [brand("b1", "Pret a Manger")], at);
    assert.equal(writes.length, 1);
    assert.equal(writes[0].setBackers, "JAB Holding");
    assert.equal(writes[0].backersWas, "");
    assert.deepEqual({ ...writes[0].intel }, { owner: "JAB Holding", kind: "pe", since: 2018, note: "", source: "https://example.com/Pret A Manger", via: OWNERSHIP_SOURCE_NAME, viaUrl: "https://london-food-money-matrix.vercel.app/", readAt: at, firstSeenAt: at, filledBackers: true });
    assert.equal(report.matched, 1);
    assert.equal(report.filledBackers, 1);
  });
  it("never overwrites a Backers someone set: a different one is listed, the same one is left", () => {
    const { writes, report } = planOwnership(
      [place("Flat Iron", "pe", "TriSpan + McWin"), place("Blacklock", "pe", "BGF (minority)")],
      [brand("b1", "Flat Iron", { backers: "Piper" }), brand("b2", "Blacklock", { backers: "BGF" })], at);
    assert.deepEqual(writes.map(w => w.setBackers), [null, null]);
    assert.ok(writes.every(w => !w.intel.filledBackers));
    assert.deepEqual(report.differs.map(d => [d.name, d.ours, d.theirs]), [["Flat Iron", "Piper", "TriSpan + McWin"]]);
    assert.equal(report.filledBackers, 0);
  });
  it("an independent's founders and a corporate parent are not backers: the reading is saved, Backers is left blank", () => {
    const { writes, report } = planOwnership(
      [place("St. JOHN", "ind", "Fergus Henderson & Trevor Gulliver"), place("Costa Coffee", "corp", "Coca-Cola"), place("Blank Street", "vc", "General Atlantic, General Catalyst")],
      [brand("b1", "St John"), brand("b2", "Costa Coffee"), brand("b3", "Blank Street")], at);
    assert.deepEqual(writes.map(w => [w.intel.kind, w.setBackers, !!w.intel.filledBackers]), [["ind", null, false], ["corp", null, false], ["vc", "General Atlantic, General Catalyst", true]]);
    assert.equal(report.filledBackers, 1);
  });
  it("a corporate parent never raises a disagreement with our Backers", () => {
    const { report } = planOwnership([place("Costa Coffee", "corp", "Coca-Cola")], [brand("b1", "Costa Coffee", { backers: "Whitbread" })], at);
    assert.equal(report.differs.length, 0);
  });
  it("a brand of that name recorded as another kind of business is left for a person", () => {
    const { writes, report } = planOwnership([place("The Wolseley", "corp", "Minor International")], [brand("b1", "Wolseley", { fits: false, recordedAs: "Tenant - Retail" })], at);
    assert.equal(writes.length, 0);
    assert.deepEqual(report.skipped, [{ name: "The Wolseley", why: "the brand of that name is recorded as Tenant - Retail" }]);
    assert.equal(report.matched, 0);
  });
  it("never adds a brand: a backed operator not in the directory is listed, an independent only counted", () => {
    const { writes, report } = planOwnership([place("Honest Burgers", "pe", "Active Partners (~50%)"), place("Monmouth Coffee", "ind", "Founder")], [brand("b1", "Monmouth")], at);
    assert.equal(writes.length, 0);
    assert.deepEqual(report.notInDirectory.map(r => r.name), ["Honest Burgers"]);
    assert.equal(report.independentsNotInDirectory, 1);
  });
  it("leaves alone a name that fits two brands, a hidden brand, and a name the page lists twice with different owners", () => {
    const { writes, report } = planOwnership(
      [place("Rosa's", "pe", "TriSpan"), place("Old Brand", "corp", "Parent"), place("Twin", "pe", "A"), place("TWIN", "corp", "B")],
      [brand("b1", "Rosas"), brand("b2", "Rosa's"), brand("b3", "Old Brand", { hidden: true }), brand("b4", "Twin")], at);
    assert.equal(writes.length, 0);
    assert.deepEqual(report.skipped.map(s => s.why).sort(), ["fits more than one brand record", "listed more than once with different owners", "the brand is hidden"]);
    assert.equal(report.notInDirectory.length, 0, "a hidden brand is not reported as missing");
  });
  it("a hidden duplicate does not block the one visible brand", () => {
    const { writes } = planOwnership([place("Pho", "pe", "TriSpan")], [brand("b1", "Pho"), brand("b2", "Pho", { hidden: true })], at);
    assert.deepEqual(writes.map(w => w.id), ["b1"]);
  });
  it("a second read that finds nothing new writes nothing", () => {
    const before = intelOf("JAB Holding", { since: 2018, source: "https://example.com/Pret", filledBackers: true });
    const { writes, report } = planOwnership([place("Pret", "pe", "JAB Holding", { since: 2018, source: "https://example.com/Pret" })], [brand("b1", "Pret", { backers: "JAB Holding", intel: before })], at);
    assert.equal(writes.length, 0);
    assert.equal(report.unchanged, 1);
    assert.equal(report.filledBackers, 0);
  });
  it("when the page names a new owner: it is reported, the old one is kept as previous, and a Backers this read filled follows", () => {
    const before = intelOf("Old Fund", { filledBackers: true });
    const { writes, report } = planOwnership([place("Pret", "pe", "New Fund")], [brand("b1", "Pret", { backers: "Old Fund", intel: before })], at);
    assert.deepEqual(report.ownerChanges.map(c => [c.name, c.was, c.now]), [["Pret", "Old Fund", "New Fund"]]);
    assert.equal(writes[0].setBackers, "New Fund");
    assert.equal(writes[0].backersWas, "Old Fund");
    assert.deepEqual(writes[0].intel.previous, { owner: "Old Fund", kind: "pe", until: at });
    assert.equal(writes[0].intel.firstSeenAt, before.firstSeenAt);
  });
  it("but a Backers a person changed since is not followed", () => {
    const before = intelOf("Old Fund", { filledBackers: true });
    const { writes, report } = planOwnership([place("Pret", "pe", "New Fund")], [brand("b1", "Pret", { backers: "Someone a person typed", intel: before })], at);
    assert.equal(writes[0].setBackers, null);
    assert.equal(writes[0].intel.filledBackers, undefined);
    assert.equal(report.differs.length, 1);
  });
  it("words the kind for the brand page", () => {
    assert.equal(ownershipKindLine({ kind: "pe", since: 2018 }), "private equity since 2018");
    assert.equal(ownershipKindLine({ kind: "corp", since: null }), "corporate owner");
  });
});

describe("the read itself", () => {
  const many = (n: number) => Array.from({ length: n }, (_, i) => row(`Filler ${i}`, "ind", "Founder"));
  function db(brands: any[], lastPlaces: number | null = null) {
    const calls: Array<{ sql: string; params?: any[] }> = [];
    const query = async (sql: string, params?: any[]) => {
      calls.push({ sql, params });
      if (/FROM system_settings/.test(sql)) return { rows: lastPlaces == null ? [] : [{ value: { readAt: "2026-11-09T03:00:00.000Z", places: lastPlaces } }] };
      if (/FROM crm_companies/.test(sql)) return { rows: brands };
      if (/^\s*UPDATE crm_companies/.test(sql)) return { rows: [{ id: params![0] }] };
      return { rows: [] };
    };
    return { calls, query };
  }
  it("fills a blank Backers only where it is still blank, marks it an automated fact and saves the report", async () => {
    const { calls, query } = db([{ id: "b1", name: "Pret A Manger", backers: null, company_type: "Tenant - Café", industry: null, hidden: false, intel: null }, { id: "b2", name: "Flat Iron", backers: "Piper", company_type: "Tenant", industry: null, hidden: false, intel: null }]);
    const html = page([row("Pret A Manger", "pe", "JAB Holding"), row("Flat Iron", "pe", "TriSpan + McWin"), ...many(120)]);
    const result = await mod.runOwnershipRead({ fetchPage: async () => html, query, now: () => NOW });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.written, 2);
    const updates = calls.filter(c => /^\s*UPDATE crm_companies/.test(c.sql));
    const fill = updates.find(c => /SET backers = \$2/.test(c.sql))!;
    assert.deepEqual([fill.params![0], fill.params![1], fill.params![4]], ["b1", "JAB Holding", ""]);
    assert.match(fill.sql, /WHERE id = \$1 AND coalesce\(btrim\(backers\), ''\) = \$5/);
    assert.match(fill.sql, /'backers', \$4::text/);
    const other = updates.find(c => c.params![0] === "b2")!;
    assert.doesNotMatch(other.sql, /SET backers/);
    assert.equal(JSON.parse(other.params![1]).owner, "TriSpan + McWin");
    const saved = calls.find(c => /INSERT INTO system_settings/.test(c.sql))!;
    assert.equal(JSON.parse(saved.params![1]).differs.length, 1);
    assert.ok(calls.every(c => !/INSERT INTO crm_companies/i.test(c.sql)), "the read never adds a brand");
  });
  it("changes nothing when the page cannot be fetched, has lost its list, or reads as cut short", async () => {
    for (const [html, last, words] of [[null, null, /could not be fetched/], ["<html>gone</html>", null, /no longer holds its list/], [page(many(200)), 591, /cut short/]] as const) {
      const { calls, query } = db([{ id: "b1", name: "Filler 1", backers: null, hidden: false, intel: null }], last);
      const result = await mod.runOwnershipRead({ fetchPage: async () => html, query, now: () => NOW });
      assert.equal(result.ok, false);
      if (!result.ok) assert.match(result.reason, words);
      assert.ok(calls.every(c => !/^\s*(UPDATE|INSERT)/.test(c.sql)));
    }
  });
  it("can be switched off or pointed elsewhere, https only", () => {
    const keep = process.env.OWNERSHIP_INTEL_URL;
    try {
      process.env.OWNERSHIP_INTEL_URL = "off"; assert.equal(mod.ownershipSourceUrl(), null);
      process.env.OWNERSHIP_INTEL_URL = "http://plain.test/"; assert.equal(mod.ownershipSourceUrl(), "https://london-food-money-matrix.vercel.app/");
      process.env.OWNERSHIP_INTEL_URL = "https://mirror.test/"; assert.equal(mod.ownershipSourceUrl(), "https://mirror.test/");
    } finally { if (keep == null) delete process.env.OWNERSHIP_INTEL_URL; else process.env.OWNERSHIP_INTEL_URL = keep; }
  });
});
