// The requirements board's lists and feed (19 November 2026): the rules in
// shared/requirements-board.ts and loadRequirementsBoard in
// server/requirements-board.ts, against a stand-in for the database.
import "./test-database-url";
import test from "node:test";
import assert from "node:assert/strict";
import { requirementLive } from "../shared/requirement-live";
import {
  MARKET_UNSEEN_DAYS, boardListOf, clientList, compareCandidates, compareForClient, countPills, groupByBrand, onPill, wantsLine,
} from "../shared/requirements-board";
import { loadRequirementFits, loadRequirementsBoard, type Queryable } from "./requirements-board";

const NOW = new Date("2026-11-19T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86400000).toISOString();

test("the lists: BGP's own, market listings, older and closed", () => {
  const list = (row: Record<string, any>) => boardListOf(requirementLive(row, NOW));
  assert.equal(list({ origin: "bgp", last_confirmed_at: daysAgo(5), last_confirmed_by: "u1", last_confirmed_by_name: "Emily" }), "own");
  assert.equal(list({ origin: "bgp", created_at: daysAgo(40) }), "own", "BGP's own row nobody has confirmed is to confirm");
  assert.equal(list({ origin: "pipnet", sources: ["PIPnet"], last_listed_at: daysAgo(30) }), "market");
  // Decision 4: a listing PIPnet has not listed for six months reads as Older.
  assert.equal(list({ origin: "pipnet", sources: ["PIPnet"], last_listed_at: daysAgo(MARKET_UNSEEN_DAYS + 1) }), "older");
  assert.equal(list({ origin: "pipnet", sources: ["PIPnet"], requirement_date: "2026-01-04" }), "older", "dated by its listing date");
  assert.equal(list({ origin: "pipnet", sources: ["PIPnet"] }), "older", "a listing with no date cannot be shown current");
  assert.equal(list({ origin: "bgp", status: "Past" }), "closed");
  assert.equal(list({ origin: "bgp", last_confirmed_at: daysAgo(500), last_confirmed_by: "u1" }), "older", "BGP's own, over 12 months");
  // Open is BGP's own and the market listings; a client's rows read open or closed.
  assert.equal(onPill("own", "open"), true);
  assert.equal(onPill("market", "open"), true);
  assert.equal(onPill("older", "open"), false);
  assert.equal(onPill("open", "open"), true);
  assert.equal(onPill("open", "own"), false);
  assert.equal(clientList("market"), "open");
  assert.equal(clientList("closed"), "closed");
  assert.deepEqual(countPills([{ list: "own" }, { list: "market" }, { list: "older" }, { list: "closed" }, { list: "open" }]),
    { open: 3, own: 1, market: 1, older: 1, closed: 1 });
});

test("what it wants is one line, each value once", () => {
  assert.equal(wantsLine({ size: ["1,500-3,000 sq ft"], use: ["Restaurant", "Restaurant"], requirement_locations: ["Leeds", " York "] }), "1,500–3,000 sq ft · Restaurant · Leeds, York");
  assert.equal(wantsLine({ size: null, use: [], requirement_locations: null }), "");
});

test("one row per brand, BGP's own first, then market listings newest first", () => {
  const c = (id: string, companyId: string | null, list: any, state: any, days: number | null, name = id) =>
    ({ id, companyId, list, state, date: days == null ? null : new Date(daysAgo(days)), name });
  const items = [
    c("old-listing", "b1", "market", "background", 100),
    c("live", "b1", "own", "live", 3),
    c("to-confirm", "b2", "own", "to_confirm", 1),
    c("new-listing", "b3", "market", "background", 2),
    c("orphan", null, "market", "background", 50),
  ];
  const rows = groupByBrand(items);
  const b1 = rows.find(r => r.brandId === "b1")!;
  assert.equal(b1.shown.id, "live", "a brand's row shows its BGP requirement over its listing");
  assert.deepEqual(b1.others.map(o => o.id), ["old-listing"]);
  assert.ok(rows.some(r => r.key === "req:orphan"), "a requirement with no brand is a row of its own");
  const order = rows.map(r => r.shown).sort(compareCandidates).map(s => s.id);
  assert.deepEqual(order, ["live", "to-confirm", "new-listing", "orphan"]);
  // A client's order is by date only: it never shows which BGP confirmed.
  assert.deepEqual(rows.map(r => r.shown).sort(compareForClient).map(s => s.id), ["to-confirm", "new-listing", "live", "orphan"]);
});

// A stand-in for the database: answers each tagged query.
function fakeDb(answers: Record<string, any[]>, seen: Array<{ text: string; values: any[] }> = []): Queryable {
  return {
    async query(text: string, values: any[] = []) {
      seen.push({ text, values });
      const tag = /\/\* requirements-board:([a-z-]+) \*\//.exec(text)?.[1];
      if (!tag || !(tag in answers)) throw new Error(`unexpected query ${text.slice(0, 60)}`);
      return { rows: answers[tag] };
    },
  };
}

const REQUIREMENTS = [
  { id: "r-sb", name: "Starbucks", company_id: "b-sb", size: ["1,500-2,500 sq ft"], use: ["Restaurant"], requirement_locations: [], requirement_type: ["Lease"], group_name: "F&B",
    agent_contact_id: "c-agent", bgp_contact_user_ids: ["u-emily"], origin: "bgp", sources: ["BGP"], last_confirmed_at: daysAgo(5), last_confirmed_by: "u-emily",
    last_confirmed_by_name: "Emily Stone", created_at: daysAgo(30), status: "Active" },
  { id: "r-sb-listing", name: "Starbucks", company_id: "b-sb", size: ["5,000 sq ft"], use: ["Restaurant"], origin: "pipnet", sources: ["PIPnet"],
    last_listed_at: daysAgo(10), external_requirement_id: "PIP-1", requirement_date: "2026-11-02", created_at: daysAgo(10), status: "Active" },
  { id: "r-gym", name: "Gym Co", company_id: "b-gym", size: ["5,000-7,000"], use: ["Gym"], origin: "pipnet", sources: ["PIPnet"], last_listed_at: daysAgo(3), created_at: daysAgo(3), status: "Active" },
  { id: "r-gone", name: "Old Co", company_id: "b-old", size: null, use: null, origin: "bgp", status: "Archived", created_at: daysAgo(400) },
];
const ANSWERS = {
  requirements: REQUIREMENTS,
  brands: [{ id: "b-sb", name: "Starbucks", domain: "starbucks.co.uk", hunter_flag: true }, { id: "b-gym", name: "Gym Co" }, { id: "b-old", name: "Old Co" }],
  agents: [{ id: "c-agent", name: "Ann Agent", email: "ann@agents.example", phone: null, phone_mobile: "07000 000000", company_id: "f-1", firm_name: "Agents & Co" }],
  owners: [{ id: "u-emily", name: "Emily Stone" }],
  scores: [{ brand_company_id: "b-sb", hunter_score: 99, sub_scores: { ukMomentum: 10, pipeline: 8, capacity: 5, intent: 4, engagement: 20 } }],
  contact: [{ company_id: "b-sb", last_at: daysAgo(2) }],
  listings: [{ id: "PIP-1", source_url: "https://www.pipnet.co.uk/reqdetails.jsp?folderid=1" }],
  requirement: [{ id: "r-sb", size: ["1,500-2,500 sq ft"], use: ["Restaurant"], requirement_locations: [] }],
  units: [
    { id: "u1", unit_name: "Unit 4", sqft: 2000, use_class: "E(b)", property_id: "p1", property_name: "Bluewater", address: "Greenhithe", schedule_row_id: "ts-4" },
    { id: "u2", unit_name: "Unit 9", sqft: 1600, use_class: "E(b)", property_id: "p1", property_name: "Bluewater", address: "Greenhithe", schedule_row_id: null },
    { id: "u3", unit_name: "Unit 2", sqft: 2000, use_class: "E(a)", property_id: "p1", property_name: "Bluewater", address: "Greenhithe", schedule_row_id: null },
  ],
};
const deps = {
  schemeLimitSql: () => "",
  splitSubScores: (sub: any) => sub ? { expansion: sub.ukMomentum + sub.pipeline + sub.capacity + sub.intent, relationship: sub.engagement } : null,
};

test("the feed for BGP staff: one row per brand with its state, fits, agent, owner, score and last contact", async () => {
  const seen: Array<{ text: string; values: any[] }> = [];
  const out = await loadRequirementsBoard(fakeDb(ANSWERS, seen), { kind: "staff" }, deps, NOW);
  assert.equal(out.viewer, "staff");
  assert.deepEqual(out.rows.map(r => r.brandName), ["Starbucks", "Gym Co", "Old Co"]);
  const sb = out.rows[0];
  assert.equal(sb.superBrand, true);
  assert.equal(sb.list, "own");
  assert.equal(sb.requirement.id, "r-sb");
  assert.equal(sb.requirement.stateLabel, "Live");
  assert.equal(sb.requirement.dateLine, "confirmed 14 Nov by Emily");
  assert.equal(sb.requirement.wants, "1,500–2,500 sq ft · Restaurant");
  assert.equal(sb.requirement.type, "Lease");
  assert.equal(sb.requirement.group, "F&B");
  assert.equal(sb.requirement.date, daysAgo(5), "for staff, the date behind the dated line");
  assert.equal(sb.requirement.confirmedAt, daysAgo(5));
  assert.deepEqual(sb.others.map(o => [o.id, o.list, o.listingUrl]), [["r-sb-listing", "market", "https://www.pipnet.co.uk/reqdetails.jsp?folderid=1"]]);
  // The one fit rule: both restaurant units fit, the smaller first; the shop does not.
  assert.equal(sb.fits.count, 2);
  assert.deepEqual(sb.fits.best, { unitId: "u2", unitName: "Unit 9", propertyId: "p1", propertyName: "Bluewater", scheduleRowId: null, sqft: 1600, why: "Size and use fit" });
  assert.deepEqual(sb.agent, { contactId: "c-agent", name: "Ann Agent", firmId: "f-1", firmName: "Agents & Co", email: "ann@agents.example", phone: "07000 000000" });
  assert.deepEqual(sb.owners, [{ id: "u-emily", name: "Emily Stone" }]);
  assert.deepEqual(sb.expansion, { score: 27, band: "Hot" }, "the Expansion figure, never the old sum with Relationship");
  assert.equal(sb.lastContactAt, daysAgo(2));
  assert.equal(out.rows[1].list, "market");
  assert.equal(out.rows[1].fits.count, 0);
  assert.equal(out.rows[2].list, "closed");
  assert.deepEqual(out.counts, { open: 2, own: 1, market: 1, older: 0, closed: 1 });
  assert.equal(out.unitPool, 3);
  // The units are the ones on the market, for everyone (no company).
  const unitQuery = seen.find(q => /requirements-board:units/.test(q.text))!;
  assert.deepEqual(unitQuery.values, [null, ["AVA", "NEG"]]);
  assert.match(seen.find(q => /requirements-board:contact/.test(q.text))!.text, /!~\* \$2/, "the private mailbox is never read");
});

test("the feed for a client login: open or closed, its own units, and none of BGP's own record", async () => {
  const seen: Array<{ text: string; values: any[] }> = [];
  const out = await loadRequirementsBoard(fakeDb(ANSWERS, seen), { kind: "client", companyId: "landsec" }, deps, NOW);
  assert.equal(out.viewer, "client");
  const sb = out.rows.find(r => r.brandName === "Starbucks")!;
  assert.equal(sb.list, "open");
  for (const r of [sb.requirement, ...sb.others]) {
    assert.equal(r.list, "open");
    for (const key of ["state", "stateLabel", "sources", "listingUrl", "confirmedAt"]) assert.ok(!(key in r), `${key} sent to a client`);
    assert.doesNotMatch(r.dateLine, /confirmed|Emily/);
  }
  // A client's date is the requirement's own (added 30 days ago), never when BGP confirmed it (5 days ago).
  assert.equal(sb.requirement.date, daysAgo(30));
  assert.ok(!seen.some(q => /requirements-board:listings/.test(q.text)), "the listing addresses are not read for a client");
  for (const key of ["owners", "lastContactAt"]) assert.ok(!(key in sb), `${key} sent to a client`);
  assert.deepEqual(out.counts, { open: 2, own: 0, market: 0, older: 0, closed: 1 });
  // A client's order is by date, not by whether BGP confirmed it: the newest listing first.
  assert.deepEqual(out.rows.map(r => r.brandName), ["Gym Co", "Starbucks", "Old Co"]);
  // Its own units only, and nobody's last contact is read.
  assert.deepEqual(seen.find(q => /requirements-board:units/.test(q.text))!.values, ["landsec", ["AVA", "NEG"]]);
  assert.ok(!seen.some(q => /requirements-board:(contact|owners)/.test(q.text)));
});

test("a read that fails leaves its column empty and says so", async () => {
  const broken: Queryable = {
    async query(text: string, values: any[] = []) {
      if (/requirements-board:scores/.test(text)) throw new Error("no table");
      return fakeDb(ANSWERS).query(text, values);
    },
  };
  const out = await loadRequirementsBoard(broken, { kind: "staff" }, deps, NOW);
  assert.deepEqual(out.unavailable, ["scores"]);
  assert.equal(out.rows[0].expansion, null);
});

test("the panel's fits: every unit a requirement fits, against the viewer's units", async () => {
  const seen: Array<{ text: string; values: any[] }> = [];
  const staff = await loadRequirementFits(fakeDb(ANSWERS, seen), { kind: "staff" }, deps, "r-sb");
  assert.deepEqual(staff!.fits.map(f => [f.unitId, f.why]), [["u2", "Size and use fit"], ["u1", "Size and use fit"]]);
  assert.equal(staff!.unitPool, 3);
  await loadRequirementFits(fakeDb(ANSWERS, seen), { kind: "client", companyId: "landsec" }, deps, "r-sb");
  assert.deepEqual(seen.filter(q => /requirements-board:units/.test(q.text)).map(q => q.values[0]), [null, "landsec"]);
  assert.equal(await loadRequirementFits(fakeDb({ ...ANSWERS, requirement: [] }), { kind: "staff" }, deps, "nope"), null);
});

test("a linked deal: its name and stage for staff, and for a client only a deal it may open", async () => {
  const withDeal = { ...ANSWERS, requirements: REQUIREMENTS.map(r => r.id === "r-sb" ? { ...r, deal_id: "d-1" } : r.id === "r-gym" ? { ...r, deal_id: "d-2" } : r),
    deals: [{ id: "d-1", name: "Unit 4, Bluewater", status: "HOTs", fee: 50000 }, { id: "d-2", name: "Elsewhere", status: "NEG" }] };
  const staff = await loadRequirementsBoard(fakeDb(withDeal), { kind: "staff" }, deps, NOW);
  assert.deepEqual(staff.rows.find(r => r.brandName === "Starbucks")!.requirement.deal, { id: "d-1", name: "Unit 4, Bluewater", status: "HOTs" }, "never the fee");
  const asked: string[] = [];
  const client = await loadRequirementsBoard(fakeDb(withDeal), { kind: "client", companyId: "landsec" },
    { ...deps, dealInScope: async (company, deal) => { asked.push(`${company}:${deal}`); return deal === "d-1"; } }, NOW);
  assert.deepEqual(asked.sort(), ["landsec:d-1", "landsec:d-2"]);
  assert.equal(client.rows.find(r => r.brandName === "Starbucks")!.requirement.deal?.id, "d-1");
  assert.equal(client.rows.find(r => r.brandName === "Gym Co")!.requirement.deal, null, "a deal the client may not open is not sent");
  // Without the scope check a client is sent no deal, and the deals are not read.
  const seen: Array<{ text: string; values: any[] }> = [];
  const bare = await loadRequirementsBoard(fakeDb(withDeal, seen), { kind: "client", companyId: "landsec" }, deps, NOW);
  assert.ok(bare.rows.every(r => r.requirement.deal === null));
  assert.ok(!seen.some(q => /requirements-board:deals/.test(q.text)));
});
