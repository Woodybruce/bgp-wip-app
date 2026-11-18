// Brand site pipeline: which planning record and which job advert count for a
// brand, and what a run reads, stores and reports.
//
// No network and no database: the fetch, the database, the clock, the
// environment and the pause are all handed in.
//   node --import tsx --test server/brand-pipeline.test.ts
import test, { before } from "node:test";
import assert from "node:assert/strict";
import {
  TOO_COMMON_REASON, advertCompanyMatches, advertTown, brandNames, classifyAdvert, jobRowsFrom,
  nameTooCommon, normCompany, planningRecordCounts, planningRowsFrom, planningSearchTerm,
  planningSiteKey, planningTown, planningVerdict,
} from "../shared/brand-pipeline";

let api: typeof import("./brand-pipeline");
before(async () => {
  process.env.DATABASE_URL ||= "postgres://test:test@127.0.0.1:1/test";
  api = await import("./brand-pipeline");
});

const NOW = new Date("2026-11-15T12:00:00Z");
const rec = (description: string, more: Record<string, unknown> = {}) => ({
  name: "Reading/26/0001/FUL", address: "12 Broad Street Reading RG1 2AB", area_name: "Reading",
  start_date: "2026-09-01", app_state: "Undecided", app_type: "Full",
  link: "https://www.planit.org.uk/planapplic/Reading/26/0001/FUL/", description, ...more,
});
const counts = (description: string, names: string[], more: Record<string, unknown> = {}) =>
  planningRecordCounts(rec(description, more), { names, now: NOW });

// ─── Planning: the rule ──────────────────────────────────────────────────

test("apostrophes and curly quotes do not matter, case does not matter", () => {
  for (const written of ["Gail's", "Gails", "GAIL's", "GAIL’S", "‘Gail’s’"]) {
    assert.equal(counts(`New shopfront and fascia signage for ${written} bakery`, ["Gail's"]), true, written);
  }
  assert.equal(counts("New shopfront for Gail's", ["Gails"]), true);
});

test("the name must be a whole phrase in the description", () => {
  assert.equal(counts("New shopfront for Greggson and Sons", ["Greggs"]), false);
  assert.equal(counts("Change of use to a restaurant for Black Sheep Coffee", ["Black Sheep Coffee"]), true);
  assert.equal(counts("Change of use to a cafe; black sheep grazing and coffee", ["Black Sheep Coffee"]), false);
  // In the address only: not enough.
  assert.equal(counts("New shopfront and signage", ["Greggs"], { address: "Greggs, 12 Broad Street, Reading" }), false);
});

test("an alias counts as the name does", () => {
  assert.equal(counts("Fit-out of the unit for occupation by PLK Chicken", ["Popeyes", "PLK Chicken UK Ltd"]), false);
  assert.equal(counts("Fit-out of the unit for occupation by PLK Chicken", ["Popeyes", "PLK Chicken"]), true);
});

test("the description must be about commercial premises", () => {
  assert.deepEqual(planningVerdict(rec("Fibre ethernet service for Wingstop"), { names: ["Wingstop"], now: NOW }), { counts: false, reason: "not about commercial premises" });
  for (const d of [
    "Installation of 2no. ‘Popeyes’ fascia lettering",
    "Advertisement consent for Popeyes",
    "Change of use to Class E(b) for Popeyes",
    "Fit out for Popeyes",
    "Installation of extraction flue for Popeyes",
    "Popeyes drive-thru",
    "Premises licence for Popeyes",
    "Use as sui generis hot food takeaway (Popeyes)",
  ]) assert.equal(counts(d, ["Popeyes"]), true, d);
  // Works at a shop the brand already trades from are not a new site (seen on the live register for Greggs).
  for (const d of [
    "Renewal of pavement licence for Greggs",
    "Small extension to the side of a Greggs shop to provide a staff toilet",
    "Replacement air conditioning units at Greggs premises",
    "Tables and chairs outside Greggs, with new signage",
  ]) assert.equal(counts(d, ["Greggs"]), false, d);
});

test("dated within 12 months, and dated at all", () => {
  assert.equal(counts("New Wingstop shopfront", ["Wingstop"], { start_date: "2025-11-20" }), true);
  assert.deepEqual(planningVerdict(rec("New Wingstop shopfront", { start_date: "2025-11-01" }), { names: ["Wingstop"], now: NOW }), { counts: false, reason: "older than 12 months" });
  assert.deepEqual(planningVerdict(rec("New Wingstop shopfront", { start_date: null }), { names: ["Wingstop"], now: NOW }), { counts: false, reason: "no date" });
  assert.equal(counts("New Wingstop shopfront", ["Wingstop"], { start_date: "2027-03-01" }), false);
  assert.equal(counts("New Wingstop shopfront", ["Wingstop"], { start_date: "not a date" }), false);
});

test("the last, the present or the neighbouring occupier is not an arrival", () => {
  for (const d of [
    "Change of use of former Wingstop unit to a nail bar",
    "New shopfront to unit adjacent to Wingstop",
    "Replacement signage to existing Wingstop restaurant",
    "Change of use of unit previously occupied by Wingstop to a gym",
    "Flat above Wingstop: new shop entrance",
  ]) {
    assert.deepEqual(planningVerdict(rec(d), { names: ["Wingstop"], now: NOW }), { counts: false, reason: "brand named only as a former, existing or neighbouring occupier" }, d);
  }
  assert.equal(counts("Refurbishment to facilitate the site's occupation by Wingstop, new shopfront", ["Wingstop"]), true);
  assert.equal(counts("Former bank: change of use to restaurant for Wingstop", ["Wingstop"]), true);
});

test("names too common to search", () => {
  for (const n of ["Next", "Boots", "Reserved", "Mango", "Office", "Leon", "LEON", "Wasabi", "Joe", "Honest", "Space", "Mint", "Oak",
    "Jigsaw", "Monsoon", "Oasis", "Coast", "Whistles", "Gap", "Evans", "Burton", "Dune", "Three", "EE", "O2", "Cook", "Paul",
    "Tortilla", "Côte", "Bill's", "The Range", "Zara", "KFC"]) {
    assert.equal(nameTooCommon(n), true, n);
  }
  for (const n of ["Schuh", "Itsu", "Pret", "Flight Club", "White Stuff", "Zizzi", "Seasalt", "Phase Eight", "Reiss", "Clarks",
    "Vodafone", "Paperchase", "Smiggle", "Giggling Squid", "The Ivy", "Gail's", "Greggs", "Wingstop", "Honest Burgers", "Pret A Manger"]) {
    assert.equal(nameTooCommon(n), false, n);
  }
  assert.deepEqual(planningSearchTerm(["Next", "Next Retail Limited"]), { skip: TOO_COMMON_REASON });
  assert.deepEqual(planningSearchTerm(["Gail’s  Bakery"]), { search: "Gail's Bakery" });
  assert.deepEqual(planningSearchTerm([]), { skip: TOO_COMMON_REASON });
});

test("a common name counts only with a capital and a sector word straight after it", () => {
  assert.equal(counts("New shopfront for the Next store", ["Next"]), true);
  assert.equal(counts("Signage for Boots pharmacy", ["Boots"]), true);
  assert.equal(counts("Fit-out of unit as a LEON restaurant", ["Leon"]), true);
  assert.equal(counts("Change of use to two Leon restaurants", ["Leon"]), true);
  assert.equal(counts("Signage for KFC drive-thru", ["KFC"]), true);
  // An ordinary word in an ordinary sentence.
  assert.equal(counts("New shopfront; the next store along is unaffected", ["Next"]), false);
  assert.equal(counts("New shopfront next to the store", ["Next"]), false);
  assert.equal(counts("Change of use of shop to Leon Smith's office", ["Leon"]), false);
  // The caller's own sector words replace the default list.
  assert.equal(planningRecordCounts(rec("New shopfront for Mint Velvet and Mint boutique"), { names: ["Mint"], now: NOW }), false);
  assert.equal(planningRecordCounts(rec("New shopfront for Mint boutique"), { names: ["Mint"], sectorWords: ["boutique"], now: NOW }), true);
});

test("where a planning record is", () => {
  assert.equal(planningTown("226-228, High Street, Slough, Berkshire, SL1 1JS", "Slough"), "Slough");
  assert.equal(planningTown("102 High Street Winchester Hampshire SO23 9AH", "Winchester"), "Winchester");
  assert.equal(planningTown("Tesco Stores Ltd, Coniston Road, Flitwick, Bedford, MK45 1LX", "Central Bedfordshire"), "Bedford");
  assert.equal(planningTown("1 Angel Hill, Bury St Edmunds, Suffolk IP33 1UZ", "West Suffolk"), "Bury St Edmunds");
  assert.equal(planningTown("14 MARKET PLACE, ST ALBANS, AL3 5DG", "St Albans"), "St Albans");
  assert.equal(planningTown("12 High St Reading RG1 2AB", "Reading"), "Reading");
  assert.equal(planningTown("1 - 3 New Bristol Road Weston-super-Mare BS22 6AD", "North Somerset"), "Weston-super-Mare");
  assert.equal(planningTown("107 Dunton Road London Southwark SE1 5HG", "Southwark"), "London");
  // Not plain from the address: the planning authority.
  assert.equal(planningTown("103-111 Mitcham Road SW17 9PF", "Wandsworth"), "Wandsworth");
  assert.equal(planningTown("65 - 67 London Road North Lowestoft Suffolk", "East Suffolk"), "East Suffolk");
  assert.equal(planningTown("Unit 5, The Broadway", "Bexley"), "Bexley");
  assert.equal(planningTown(null, null), null);
});

test("one site is its postcode, else its address", () => {
  assert.equal(planningSiteKey("Unit 5 The Broadway DA6 7JN"), planningSiteKey("5, Broadway Shopping Centre, Bexleyheath", "da6 7jn"));
  assert.notEqual(planningSiteKey("12 Broad Street Reading"), planningSiteKey("14 Broad Street Reading"));
});

test("the rows a search gives: kept ones only, one per application, newest first", () => {
  const rows = planningRowsFrom([
    rec("New shopfront for Wingstop", { name: "Reading/26/1", start_date: "2026-03-01" }),
    rec("Signage for Wingstop", { name: "Reading/26/2", start_date: "2026-10-01", app_state: "Permitted" }),
    rec("Signage for Wingstop", { name: "Reading/26/2", start_date: "2026-10-01" }),
    rec("Single storey rear extension", { name: "Reading/26/3" }),
    rec("New shopfront for Wingstop", { name: "Reading/24/9", start_date: "2024-01-01" }),
    null, "junk",
  ], { names: ["Wingstop"], now: NOW });
  assert.deepEqual(rows.map((r) => r.key), ["Reading/26/2", "Reading/26/1"]);
  assert.deepEqual({ ...rows[0], detail: undefined }, {
    kind: "planning", key: "Reading/26/2", title: "Signage for Wingstop", town: "Reading", authority: "Reading",
    address: "12 Broad Street Reading RG1 2AB", date: "2026-10-01",
    url: "https://www.planit.org.uk/planapplic/Reading/26/0001/FUL/", state: "Permitted", detail: undefined,
  });
  assert.equal(rows[0].detail.postcode, "RG1 2AB");
  assert.deepEqual(planningRowsFrom(undefined, { names: ["Wingstop"], now: NOW }), []);
  // A link that is not a web address is not stored.
  const odd = planningRowsFrom([rec("Signage for Wingstop", { link: "javascript:alert(1)", name: "A/1" })], { names: ["Wingstop"], now: NOW });
  assert.equal(odd[0].url, "https://www.planit.org.uk/planapplic/A/1");
});

// ─── Job adverts: the rule ───────────────────────────────────────────────

test("the advertiser must be the brand", () => {
  assert.equal(normCompany("Greggs PLC"), "greggs");
  assert.equal(normCompany("Boots UK Limited"), "boots");
  const gails = { names: ["Gail's"] };
  for (const c of ["GAIL's", "Gails Ltd", "Gail’s Limited", "GAIL's Bakery", "Gail's UK"]) assert.equal(advertCompanyMatches(c, gails), true, c);
  for (const c of ["Gail Smith Recruitment", "Abigail's", "Gail's Bakery Suppliers", "", null]) assert.equal(advertCompanyMatches(c, gails), false, String(c));
  assert.equal(advertCompanyMatches("PLK Chicken UK Ltd", { names: ["Popeyes", "PLK Chicken UK Limited"] }), true);
  // A common word is the brand only when it is the whole name.
  assert.equal(advertCompanyMatches("PAUL", { names: ["Paul"] }), true);
  assert.equal(advertCompanyMatches("Paul Bakery", { names: ["Paul"] }), false);
  assert.equal(advertCompanyMatches("Paul Smith", { names: ["Paul"] }), false);
});

test("which adverts are a new opening, a property role or neither", () => {
  for (const [title, description] of [
    ["General Manager - New Opening", ""],
    ["Assistant Manager", "Join the launch team for our Reading bakery."],
    ["Chef de Partie", "Our new restaurant in Bath is opening soon."],
    ["Team Member", "We are opening in Reading this spring."],
    ["Barista - Pre-Opening", ""],
    ["Store Manager, new store", ""],
    ["General Manager (New Site)", ""],
    ["New Openings Manager", ""],
  ]) assert.equal(classifyAdvert(title, description), "new_opening", title);
  for (const title of ["Acquisitions Surveyor", "Estates Manager", "Property Director", "Head of Property", "Real Estate Analyst", "Store Development Manager", "Acquisition Manager - new sites"]) {
    assert.equal(classifyAdvert(title, "Finding each new site for the brand."), "property_role", title);
  }
  for (const [title, description] of [
    ["Talent Acquisition Partner", ""],
    ["Team Member", "With new restaurants opening across the UK there has never been a better time to join."],
    ["Shift Manager", "Opening and closing the store."],
    ["Kitchen Porter", "Opening in 2026."],
  ]) assert.equal(classifyAdvert(title, description), "other", title);
});

test("an advert's town", () => {
  assert.equal(advertTown({ display_name: "Reading, Berkshire", area: ["UK", "South East England", "Berkshire", "Reading"] }), "Reading");
  assert.equal(advertTown({ display_name: "Leeds, West Yorkshire", area: ["UK"] }), "Leeds, West Yorkshire");
  assert.equal(advertTown({ display_name: "UK", area: ["UK"] }), null);
  assert.equal(advertTown({ display_name: "Bath", area: "nonsense" }), "Bath");
  assert.equal(advertTown(null), null);
});

const advert = (id: string, title: string, town: string, more: Record<string, unknown> = {}) => ({
  id, title, description: "", created: "2026-11-01T09:00:00Z", redirect_url: `https://www.adzuna.co.uk/jobs/details/${id}`,
  company: { display_name: "Wingstop UK" }, location: { display_name: `${town}, UK`, area: ["UK", "England", town] }, ...more,
});

test("one page of adverts: ours only, other adverts counted by town but not kept row by row", () => {
  const read = jobRowsFrom({ count: 9, results: [
    advert("1", "General Manager - New Opening", "Reading"),
    advert("2", "Team Member", "Reading"),
    advert("3", "Acquisitions Surveyor", "London", { created: "2026-11-10T09:00:00Z" }),
    advert("4", "Team Member", "Leeds"),
    advert("4", "Team Member", "Leeds"),                                              // the same advert twice
    advert("5", "General Manager - New Opening", "Bath", { company: { display_name: "Wingstop Recruitment Agency" } }),
    advert("6", "General Manager - New Opening", "York", { created: "2026-06-01T09:00:00Z" }), // too old
    advert("7", "Shift Leader", "Derby", { redirect_url: "ftp://odd" }),
    { nonsense: true }, null,
  ] }, { names: ["Wingstop"], now: NOW });
  assert.equal(read.total, 5);
  assert.deepEqual(read.byTown, [{ town: "Reading", adverts: 2 }, { town: "Derby", adverts: 1 }, { town: "Leeds", adverts: 1 }, { town: "London", adverts: 1 }]);
  assert.deepEqual(read.rows.map((r) => [r.kind, r.key, r.town, r.date]), [
    ["job_property_role", "3", "London", "2026-11-10"],
    ["job_new_opening", "1", "Reading", "2026-11-01"],
  ]);
  assert.equal(read.rows[1].url, "https://www.adzuna.co.uk/jobs/details/1");
});

test("the API's own count is used only when every advert on the page is the brand's", () => {
  const all = jobRowsFrom({ count: 180, results: [advert("1", "Team Member", "Reading"), advert("2", "Team Member", "Bath")] }, { names: ["Wingstop"], now: NOW });
  assert.equal(all.total, 180);
  const mixed = jobRowsFrom({ count: 180, results: [advert("1", "Team Member", "Reading"), advert("2", "Team Member", "Bath", { company: { display_name: "Another Firm" } })] }, { names: ["Wingstop"], now: NOW });
  assert.equal(mixed.total, 1);
  for (const odd of [null, undefined, "text", {}, { results: "no" }, { results: [] }]) {
    assert.deepEqual(jobRowsFrom(odd, { names: ["Wingstop"], now: NOW }), { rows: [], total: 0, byTown: [] });
  }
});

test("a brand's names: the name, then its trading entities, at most five", () => {
  assert.deepEqual(brandNames("Popeyes", ["PLK Chicken UK Ltd", { name: "Popeyes UK" }, { name: "Popeyes Louisiana Kitchen" }, 7, null, { other: "x" }, "Popeyes Ltd"]),
    ["Popeyes", "PLK Chicken UK Ltd", "Popeyes Louisiana Kitchen"]);
  assert.deepEqual(brandNames("A Co", ["B Co", "C Co", "D Co", "E Co", "F Co", "G Co"]), ["A Co", "B Co", "C Co", "D Co", "E Co"]);
  assert.deepEqual(brandNames("Wingstop", { name: "not an array" }), ["Wingstop"]);
  assert.deepEqual(brandNames(null, null), []);
});

// ─── A run ───────────────────────────────────────────────────────────────

interface Call { url: string; headers: Record<string, string> }

function fakeFetch(answers: { planit?: any; adzuna?: any }) {
  const calls: Call[] = [];
  const fn = (async (url: any, init: any) => {
    calls.push({ url: String(url), headers: init?.headers ?? {} });
    const which = String(url).includes("planit.org.uk") ? answers.planit : answers.adzuna;
    if (which instanceof Error) throw which;
    if (typeof which === "number") return { ok: false, status: which, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => which };
  }) as unknown as typeof fetch;
  return { fn, calls };
}

function fakeDb(brands: Record<string, { name: string; trading_entities?: unknown } | Error>, answer: (text: string, params: any[]) => any[] | undefined = () => undefined) {
  const queries: { text: string; params: any[] }[] = [];
  return {
    queries,
    query: async (text: string, params: any[] = []) => {
      queries.push({ text, params });
      if (/FROM crm_companies WHERE id = \$1/.test(text)) {
        const b = brands[params[0]];
        if (b instanceof Error) throw b;
        return { rows: b ? [{ id: params[0], ...b }] : [] };
      }
      return { rows: answer(text, params) ?? [] };
    },
  };
}

const savedRows = (db: ReturnType<typeof fakeDb>) => db.queries.filter((q) => /INSERT INTO brand_pipeline_items/.test(q.text)).flatMap((q) => JSON.parse(q.params[1]));
const savedCheck = (db: ReturnType<typeof fakeDb>) => db.queries.find((q) => /INSERT INTO brand_pipeline_checks/.test(q.text))?.params;

const PLANIT_REPLY = { total: 2, records: [
  rec("Installation of Wingstop fascia signage", { name: "Reading/26/0001/ADV" }),
  rec("Single storey rear extension", { name: "Reading/26/0002/HSE" }),
] };

test("without the jobs keys: planning is read and stored, the jobs API is never called", async () => {
  const net = fakeFetch({ planit: PLANIT_REPLY });
  const db = fakeDb({ c1: { name: "Wingstop" } });
  const r = await api.refreshBrandPipeline("c1", { fetch: net.fn, db, env: {}, now: () => NOW });
  assert.deepEqual(r, { planning: { ok: true, found: 1 }, jobs: { configured: false, ok: false, reason: "not configured", found: 0 } });

  assert.equal(net.calls.length, 1);
  const url = new URL(net.calls[0].url);
  assert.equal(url.origin + url.pathname, "https://www.planit.org.uk/api/applics/json");
  assert.equal(url.searchParams.get("search"), "Wingstop");
  assert.equal(url.searchParams.get("pg_sz"), "100");
  assert.equal(url.searchParams.get("start_date"), "2025-11-15");
  assert.equal(net.calls[0].headers["User-Agent"], "BGP-Dashboard/1.0 (brand pipeline)");

  const rows = savedRows(db);
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].kind, rows[0].item_key, rows[0].town, rows[0].item_date], ["planning", "Reading/26/0001/ADV", "Reading", "2026-09-01"]);
  assert.match(db.queries.find((q) => /INSERT INTO brand_pipeline_items/.test(q.text))!.text, /ON CONFLICT \(brand_company_id, kind, item_key\) DO UPDATE[\s\S]*last_seen_at = now\(\)/);
  assert.deepEqual(savedCheck(db), ["c1", "ok", "not configured", null, null]);
  // Nothing is ever deleted.
  assert.equal(db.queries.some((q) => /\bDELETE\b/i.test(q.text)), false);
});

test("with the jobs keys: one request to each source, the keys only ever go to the jobs API", async () => {
  const net = fakeFetch({ planit: { records: [], total: null }, adzuna: { count: 3, results: [
    advert("11", "General Manager - New Opening", "Reading"),
    advert("12", "Team Member", "Reading"),
    advert("13", "Head of Property", "London"),
  ] } });
  const db = fakeDb({ c1: { name: "Wingstop", trading_entities: [{ name: "Wingstop UK Ltd" }] } });
  const r = await api.refreshBrandPipeline("c1", { fetch: net.fn, db, env: { ADZUNA_APP_ID: "the-id", ADZUNA_APP_KEY: "the-key" }, now: () => NOW });
  assert.deepEqual(r, { planning: { ok: true, found: 0 }, jobs: { configured: true, ok: true, found: 2 } });

  assert.equal(net.calls.length, 2);
  const planit = net.calls.find((c) => c.url.includes("planit.org.uk"))!;
  assert.equal(/the-id|the-key/.test(planit.url), false);
  const jobs = new URL(net.calls.find((c) => c.url.includes("adzuna.com"))!.url);
  assert.equal(jobs.origin + jobs.pathname, "https://api.adzuna.com/v1/api/jobs/gb/search/1");
  assert.deepEqual([jobs.searchParams.get("app_id"), jobs.searchParams.get("app_key"), jobs.searchParams.get("company"), jobs.searchParams.get("max_days_old"), jobs.searchParams.get("results_per_page"), jobs.searchParams.get("content-type")],
    ["the-id", "the-key", "Wingstop", "60", "50", "application/json"]);

  assert.deepEqual(savedRows(db).map((x: any) => [x.kind, x.item_key, x.town]), [["job_new_opening", "11", "Reading"], ["job_property_role", "13", "London"]]);
  const check = savedCheck(db)!;
  assert.deepEqual(check.slice(0, 4), ["c1", "ok", "ok", 3]);
  assert.deepEqual(JSON.parse(check[4]), [{ town: "Reading", adverts: 2 }, { town: "London", adverts: 1 }]);
});

test("a name too common to search is skipped: no request to the register", async () => {
  const net = fakeFetch({ planit: PLANIT_REPLY });
  const db = fakeDb({ c1: { name: "Next" } });
  const r = await api.refreshBrandPipeline("c1", { fetch: net.fn, db, env: {}, now: () => NOW });
  assert.deepEqual(r.planning, { ok: false, reason: TOO_COMMON_REASON, found: 0 });
  assert.equal(net.calls.length, 0);
  assert.deepEqual(savedCheck(db)!.slice(0, 3), ["c1", `skipped: ${TOO_COMMON_REASON}`, "not configured"]);
});

test("a source that fails is reported, never thrown, and a key never reaches the reason", async () => {
  const net = fakeFetch({ planit: 503, adzuna: new Error("connect failed for https://api.adzuna.com/?app_key=the-key&app_id=the-id") });
  const db = fakeDb({ c1: { name: "Wingstop" } });
  const r = await api.refreshBrandPipeline("c1", { fetch: net.fn, db, env: { ADZUNA_APP_ID: "the-id", ADZUNA_APP_KEY: "the-key" }, now: () => NOW });
  assert.deepEqual(r.planning, { ok: false, reason: "HTTP 503", found: 0 });
  assert.equal(r.jobs.configured, true);
  assert.equal(r.jobs.ok, false);
  assert.equal(/the-key|the-id/.test(r.jobs.reason!), false);
  const check = savedCheck(db)!;
  assert.equal(check[1], "failed: HTTP 503");
  assert.match(check[2], /^failed: /);
  assert.equal(/the-key|the-id/.test(JSON.stringify(check)), false);
  // The stored jobs figures from the last good read are kept.
  assert.match(db.queries.find((q) => /INSERT INTO brand_pipeline_checks/.test(q.text))!.text, /CASE WHEN EXCLUDED\.jobs_status = 'ok' THEN EXCLUDED\.jobs_total ELSE brand_pipeline_checks\.jobs_total END/);

  const odd = fakeFetch({ planit: { records: "no" }, adzuna: { error: "AUTH_FAIL" } });
  const r2 = await api.refreshBrandPipeline("c1", { fetch: odd.fn, db: fakeDb({ c1: { name: "Wingstop" } }), env: { ADZUNA_APP_ID: "a", ADZUNA_APP_KEY: "b" }, now: () => NOW });
  assert.deepEqual(r2, { planning: { ok: true, found: 0 }, jobs: { configured: true, ok: false, reason: "unexpected reply", found: 0 } });
});

test("a brand that is not there: nothing is asked and nothing is written", async () => {
  const net = fakeFetch({ planit: PLANIT_REPLY });
  const db = fakeDb({});
  const r = await api.refreshBrandPipeline("nope", { fetch: net.fn, db, env: {}, now: () => NOW });
  assert.deepEqual(r, { planning: { ok: false, reason: "brand not found", found: 0 }, jobs: { configured: false, ok: false, reason: "brand not found", found: 0 } });
  assert.equal(net.calls.length, 0);
  assert.equal(db.queries.some((q) => /INSERT/.test(q.text)), false);
});

// ─── Reading it back ─────────────────────────────────────────────────────

const missing = () => Object.assign(new Error('relation "brand_pipeline_items" does not exist'), { code: "42P01" });

test("the summary", async () => {
  const towns = Array.from({ length: 15 }, (_v, i) => ({ town: `Town ${String(i).padStart(2, "0")}`, adverts: i + 1 }));
  const db = fakeDb({}, (text) => {
    if (/kind = 'planning'/.test(text)) return [{ kind: "planning", title: "Signage for Wingstop", town: "Reading", authority: "Reading", address: "12 Broad Street", item_date: "2026-10-01", url: "https://x", state: "Permitted" }];
    if (/job_new_opening/.test(text)) return [{ kind: "job_new_opening", title: "GM - New Opening", town: "Bath", authority: null, address: "Bath, Somerset", item_date: "2026-11-01", url: null, state: null }];
    if (/FROM brand_pipeline_checks/.test(text)) return [{ checked_at: new Date("2026-11-14T02:00:00Z"), planning_status: "ok", jobs_status: "ok", jobs_total: "42", jobs_by_town: towns }];
  });
  const s = await api.pipelineSummary("c1", { db, env: { ADZUNA_APP_ID: "a", ADZUNA_APP_KEY: "b" }, now: () => NOW });
  assert.equal(s.checkedAt, "2026-11-14T02:00:00.000Z");
  assert.deepEqual(s.planning, [{ kind: "planning", title: "Signage for Wingstop", town: "Reading", authority: "Reading", address: "12 Broad Street", date: "2026-10-01", url: "https://x", state: "Permitted" }]);
  assert.deepEqual(s.jobs, [{ kind: "job_new_opening", title: "GM - New Opening", town: "Bath", authority: null, address: "Bath, Somerset", date: "2026-11-01", url: null }]);
  assert.equal(s.jobsConfigured, true);
  assert.equal(s.jobsTotal, 42);
  assert.equal(s.jobTowns.length, 12);
  assert.deepEqual(s.jobTowns[0], { town: "Town 14", adverts: 15 });
  assert.equal(s.planningSkipped, null);
  // The windows are passed as dates: 12 months of planning, 60 days of adverts, 40 of each.
  const planningQ = db.queries.find((q) => /kind = 'planning'/.test(q.text))!;
  const jobsQ = db.queries.find((q) => /job_new_opening/.test(q.text))!;
  assert.deepEqual(planningQ.params, ["c1", "2025-11-15"]);
  assert.deepEqual(jobsQ.params, ["c1", "2026-09-16"]);
  assert.match(planningQ.text, /LIMIT 40/);
  assert.match(jobsQ.text, /LIMIT 40/);
});

test("the summary for a skipped brand, a brand never checked and a database with no tables", async () => {
  const skipped = await api.pipelineSummary("c1", { env: {}, now: () => NOW, db: fakeDb({}, (text) =>
    /FROM brand_pipeline_checks/.test(text) ? [{ checked_at: "2026-11-14T02:00:00Z", planning_status: `skipped: ${TOO_COMMON_REASON}`, jobs_status: "not configured", jobs_total: null, jobs_by_town: null }] : undefined) });
  assert.equal(skipped.planningSkipped, TOO_COMMON_REASON);
  assert.equal(skipped.jobsConfigured, false);
  assert.equal(skipped.jobsTotal, null);
  assert.deepEqual(skipped.jobTowns, []);

  const empty = { checkedAt: null, planning: [], jobs: [], jobsConfigured: false, jobsTotal: null, jobTowns: [], planningSkipped: null };
  assert.deepEqual(await api.pipelineSummary("c1", { env: {}, db: fakeDb({}) }), empty);
  assert.deepEqual(await api.pipelineSummary("c1", { env: {}, db: { query: async () => { throw missing(); } } }), empty);
  await assert.rejects(api.pipelineSummary("c1", { env: {}, db: { query: async () => { throw new Error("connection lost"); } } }), /connection lost/);
});

test("evidence counts sites, not applications, and never throws", async () => {
  const none = { planning12m: 0, planning90d: 0, planningTowns: [], newOpeningJobs: 0, propertyRoles: 0, jobTowns: [] };
  assert.deepEqual(await api.pipelineEvidence("c1", { db: { query: async () => { throw missing(); } } }), none);
  assert.deepEqual(await api.pipelineEvidence("c1", { db: { query: async () => { throw new Error("connection lost"); } } }), none);
  assert.deepEqual(await api.pipelineEvidence("c1", { db: fakeDb({}) }), none);

  const p = (address: string, postcode: string | null, item_date: string, town: string | null, authority = "Reading") => ({ kind: "planning", title: "Signage", town, authority, address, item_date, postcode });
  const j = (kind: string, title: string, town: string | null) => ({ kind, title, town, authority: null, address: null, item_date: "2026-11-01", postcode: null });
  const db = fakeDb({}, () => [
    p("12 Broad Street Reading RG1 2AB", "RG1 2AB", "2026-10-20", "Reading"),
    p("12-14 Broad St, Reading, RG1 2AB", "RG1 2AB", "2026-03-02", "Reading"),          // the same site, months earlier
    p("5 Milsom Street Bath", null, "2026-02-01", "Bath"),
    p("5 Milsom Street, Bath", null, "2026-01-15", "Bath"),                              // the same address, no postcode
    p("103 Mitcham Road SW17 9PF", "SW17 9PF", "2026-09-30", null, "Wandsworth"),
    j("job_new_opening", "General Manager - New Opening", "Leeds"),
    j("job_new_opening", "General Manager – New Opening", "Leeds"),                      // a repost
    j("job_new_opening", "Chef - New Opening", "Leeds"),
    j("job_new_opening", "General Manager - New Opening", "York"),
    j("job_property_role", "Acquisitions Surveyor", "London"),
  ]);
  assert.deepEqual(await api.pipelineEvidence("c1", { db, now: () => NOW }), {
    planning12m: 3, planning90d: 2, planningTowns: ["Reading", "Bath", "Wandsworth"],
    newOpeningJobs: 3, propertyRoles: 1, jobTowns: ["Leeds", "York"],
  });
  assert.deepEqual(db.queries[0].params, ["c1", "2025-11-15", "2026-09-16"]);
});

// ─── Nightly ─────────────────────────────────────────────────────────────

test("the nightly pass: tenant brands due a check, a pause between them, one failure never stops the run", async () => {
  const net = fakeFetch({ planit: PLANIT_REPLY });
  const sleeps: number[] = [];
  const db = fakeDb(
    { a: { name: "Wingstop" }, b: new Error("row unreadable"), c: { name: "Next" }, d: { name: "Wingstop" } },
    (text) => (/FROM crm_companies c/.test(text) ? [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }] : undefined),
  );
  const log = console.log, warn = console.warn;
  const lines: string[] = [];
  console.log = (...a: any[]) => { lines.push(a.join(" ")); };
  console.warn = () => {};
  let out;
  try {
    out = await api.nightlyPipelinePass(60, { fetch: net.fn, db, env: {}, now: () => NOW, sleep: async (ms) => { sleeps.push(ms); } });
  } finally { console.log = log; console.warn = warn; }
  assert.deepEqual(out, { attempted: 4, planningFound: 2, jobsFound: 0, failed: 1 });
  // a asked the register, b failed, c (too common) asked nothing so d follows without a pause.
  assert.deepEqual(sleeps, [2000, 2000]);
  assert.equal(net.calls.length, 2);
  assert.deepEqual(lines, ["[brand-pipeline] nightly pass: 4 brands, 2 planning records, 0 job adverts, 1 failed"]);

  const pick = db.queries.find((q) => /FROM crm_companies c/.test(q.text))!;
  assert.match(pick.text, /company_type ILIKE 'tenant%' AND c\.merged_into_id IS NULL AND c\.archived_at IS NULL/);
  assert.match(pick.text, /interval '30 days'/);
  // A brand on a running strategy, or a Super Brand (17 November 2026), first.
  assert.match(pick.text, /ORDER BY \(EXISTS \(SELECT 1 FROM crm_strategy_targets[^)]*\) OR COALESCE\(c\.hunter_flag, false\)\) DESC, k\.checked_at ASC NULLS FIRST/);
  assert.deepEqual(pick.params, [60, false]);
});

test("the nightly pass survives a database that will not answer", async () => {
  const log = console.log, warn = console.warn;
  console.log = () => {}; console.warn = () => {};
  try {
    const out = await api.nightlyPipelinePass(60, { db: { query: async () => { throw new Error("connection lost"); } }, env: {} });
    assert.deepEqual(out, { attempted: 0, planningFound: 0, jobsFound: 0, failed: 0 });
  } finally { console.log = log; console.warn = warn; }
});

test("the router has the two routes and nothing else", () => {
  const routes = (api.default as any).stack.filter((l: any) => l.route).map((l: any) => `${Object.keys(l.route.methods)[0].toUpperCase()} ${l.route.path}`);
  assert.deepEqual(routes, ["GET /api/brand/:companyId/pipeline", "POST /api/brand/:companyId/pipeline/refresh"]);
});
