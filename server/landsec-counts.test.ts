// One set of numbers for the Landsec view (docs/landsec-menu-plan-2026-11-12.md,
// part 7): a live letting is a letting-type deal at Marketing, Negotiating,
// HOTs or Solicitors, counted from the deal; days at stage come from the deal
// clock; the tracker and the deals are compared, never repaired.
//
// Runs against a fake database that answers each query by its tag.
//   node --import tsx --test server/landsec-counts.test.ts
import test, { before } from "node:test";
import assert from "node:assert/strict";

let api: typeof import("./landsec-counts");
before(async () => {
  process.env.DATABASE_URL ||= "postgres://test:test@127.0.0.1:1/test";
  api = await import("./landsec-counts");
});

const NOW = new Date("2026-11-12T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86400000).toISOString();

type Deal = { id: string; property_id: string | null; status: string | null; deal_type: string | null; stage_entered_at?: string | null; created_at?: string | null };
type Row = { id: string; property_id: string; marketing_status: string | null; deal_id: string | null };

function fakeDb(input: { deals?: Deal[]; rows?: Row[]; audit?: Record<string, string>; outside?: any[]; outsideTracker?: any[] }) {
  const calls: Array<{ tag: string; values: any[] }> = [];
  const deals = input.deals || [];
  return {
    calls,
    async query(sql: string, values: any[] = []) {
      const tag = sql.match(/\/\* landsec-counts:([a-z-]+) \*\//)?.[1] || (/deal_audit_log/.test(sql) ? "stage-since" : "untagged");
      calls.push({ tag, values });
      if (tag === "deals") return { rows: deals.filter(d => d.property_id && values[0].includes(d.property_id) && d.status !== null) };
      if (tag === "tracker") {
        return { rows: (input.rows || []).filter(r => values[0].includes(r.property_id))
          .map(r => ({ ...r, deal_status: deals.find(d => d.id === r.deal_id)?.status ?? null })) };
      }
      if (tag === "stage-since") return { rows: Object.entries(input.audit || {}).filter(([id]) => values[0].includes(id)).map(([deal_id, latest]) => ({ deal_id, latest })) };
      if (tag === "outside") return { rows: input.outside || [] };
      if (tag === "outside-tracker") return { rows: input.outsideTracker || [] };
      throw new Error(`unexpected query: ${sql.slice(0, 80)}`);
    },
  };
}

test("a live letting is counted from the deal, not the tracker row's own status", async () => {
  const db = fakeDb({
    deals: [
      { id: "d1", property_id: "p1", status: "SOL", deal_type: "New Letting", created_at: daysAgo(5) },
      { id: "d2", property_id: "p1", status: "AVA", deal_type: "New Letting", created_at: daysAgo(400) },
      { id: "d3", property_id: "p1", status: "Under Offer", deal_type: "Leasing", created_at: daysAgo(1) },   // legacy words
      { id: "d4", property_id: "p1", status: "HOTs", deal_type: "Licence", created_at: daysAgo(1) },
    ],
    rows: [
      { id: "r1", property_id: "p1", marketing_status: "Available", deal_id: "d1" },   // stale row status
      { id: "r2", property_id: "p1", marketing_status: "NEG", deal_id: "d2" },          // stale the other way
      { id: "r3", property_id: "p1", marketing_status: "SOL", deal_id: "d3" },
      { id: "r4", property_id: "p1", marketing_status: "HOT", deal_id: "d4" },
    ],
  });
  const { total } = await api.landsecCounts(["p1"], db, NOW);
  assert.deepEqual(total.stages, { AVA: 1, NEG: 0, HOT: 1, SOL: 2 });
  assert.equal(total.liveLettings, 4);
  assert.equal(total.trackerRows, 4);
  assert.equal(api.trackerAndDealsDiffer(total), false);
});

test("only letting types at the four stages are live lettings; every open deal is a live deal", async () => {
  const db = fakeDb({
    deals: [
      { id: "let", property_id: "p1", status: "NEG", deal_type: "New Letting" },
      { id: "review", property_id: "p1", status: "NEG", deal_type: "Rent Review" },
      { id: "acq", property_id: "p1", status: "SOL", deal_type: "Lease Acquisition" },
      { id: "opp", property_id: "p1", status: "OPP", deal_type: "New Letting" },
      { id: "exc", property_id: "p1", status: "EXC", deal_type: "New Letting" },
      { id: "done", property_id: "p1", status: "COM", deal_type: "New Letting" },
      { id: "dead", property_id: "p1", status: "Withdrawn", deal_type: "New Letting" },
      { id: "junk", property_id: "p1", status: "Leasing Comps", deal_type: "New Letting" },
      { id: "nostatus", property_id: "p1", status: null, deal_type: "New Letting" },
    ],
    rows: [{ id: "r1", property_id: "p1", marketing_status: "NEG", deal_id: "let" }],
  });
  const { total } = await api.landsecCounts(["p1"], db, NOW);
  assert.deepEqual(total.stages, { AVA: 0, NEG: 1, HOT: 0, SOL: 0 });
  assert.equal(total.liveLettings, 1);
  assert.equal(total.liveDeals, 5);   // let, review, acq, opp, exc
});

test("a deal with no type is a letting only when a tracker row points at it", async () => {
  const db = fakeDb({
    deals: [
      { id: "backing", property_id: "p1", status: "AVA", deal_type: null },
      { id: "loose", property_id: "p1", status: "AVA", deal_type: "  " },
    ],
    rows: [{ id: "r1", property_id: "p1", marketing_status: "AVA", deal_id: "backing" }],
  });
  const { total } = await api.landsecCounts(["p1"], db, NOW);
  assert.equal(total.liveLettings, 1);
  assert.equal(total.liveDeals, 2);
  assert.equal(api.trackerAndDealsDiffer(total), false);
});

test("stuck is counted as Deals counts it: every open deal in negotiation, a letting or not", async () => {
  // The Stuck pill on Properties opens Deals at its Stuck filter, which reads
  // the deal clock feed (every open deal on the scheme properties).
  const db = fakeDb({
    deals: [
      { id: "let", property_id: "p1", status: "NEG", deal_type: "New Letting", stage_entered_at: daysAgo(40) },
      { id: "review", property_id: "p1", status: "HOT", deal_type: "Rent Review", stage_entered_at: daysAgo(60) },
      { id: "fresh", property_id: "p1", status: "SOL", deal_type: "Lease Renewal", stage_entered_at: daysAgo(3) },
      { id: "opp", property_id: "p1", status: "OPP", deal_type: "Rent Review", stage_entered_at: daysAgo(90) },
      { id: "done", property_id: "p1", status: "COM", deal_type: "Rent Review", stage_entered_at: daysAgo(90) },
    ],
    rows: [{ id: "r1", property_id: "p1", marketing_status: "NEG", deal_id: "let" }],
  });
  const { total } = await api.landsecCounts(["p1"], db, NOW);
  assert.equal(total.stuck, 2);                  // the letting and the rent review
  assert.equal(total.oldestStageDays, 60);
  // The stage counts are still live lettings only.
  assert.deepEqual(total.stages, { AVA: 0, NEG: 1, HOT: 0, SOL: 0 });
  assert.equal(total.liveLettings, 1);
});

test("days at stage come from the deal clock, and Marketing is never stuck", async () => {
  const db = fakeDb({
    deals: [
      // Status changed 45 days ago (audit log) though the stage timestamp says 2 days.
      { id: "audit", property_id: "p1", status: "NEG", deal_type: "New Letting", stage_entered_at: daysAgo(2), created_at: daysAgo(300) },
      // No audit row: the deal's own stage timestamp.
      { id: "stamp", property_id: "p1", status: "HOT", deal_type: "New Letting", stage_entered_at: daysAgo(30), created_at: daysAgo(300) },
      // Neither: its creation.
      { id: "born", property_id: "p2", status: "SOL", deal_type: "New Letting", stage_entered_at: null, created_at: daysAgo(29) },
      // A void marketed for a year is a void, not a stuck deal.
      { id: "void", property_id: "p2", status: "AVA", deal_type: "New Letting", stage_entered_at: daysAgo(365), created_at: daysAgo(365) },
    ],
    rows: ["audit", "stamp", "born", "void"].map((id, i) => ({ id: `r${i}`, property_id: id === "born" || id === "void" ? "p2" : "p1", marketing_status: "AVA", deal_id: id })),
    audit: { audit: daysAgo(45), void: daysAgo(1) },
  });
  const { total, byProperty } = await api.landsecCounts(["p1", "p2"], db, NOW);
  assert.equal(byProperty.p1.oldestStageDays, 45);
  assert.equal(byProperty.p1.stuck, 2);          // 45 days and exactly 30 days
  assert.equal(byProperty.p2.oldestStageDays, 29);
  assert.equal(byProperty.p2.stuck, 0);
  assert.equal(total.oldestStageDays, 45);
  assert.equal(total.stuck, 2);
  // The clock is only asked about deals in negotiation.
  const asked = db.calls.find(c => c.tag === "stage-since")!.values[0];
  assert.deepEqual([...asked].sort(), ["audit", "born", "stamp"]);
});

test("where the tracker and the deals disagree, both counts come back", async () => {
  const db = fakeDb({
    deals: [
      { id: "ok", property_id: "p1", status: "NEG", deal_type: "New Letting" },
      { id: "norow", property_id: "p1", status: "HOT", deal_type: "New Letting" },          // live letting, no tracker row
      { id: "wrongtype", property_id: "p1", status: "AVA", deal_type: "Rent Review" },       // row's deal is not a letting
      { id: "let", property_id: "p1", status: "COM", deal_type: "New Letting" },             // row is historic: not a live row
      { id: "elsewhere", property_id: "p9", status: "AVA", deal_type: "New Letting" },       // row's deal sits on another property
    ],
    rows: [
      { id: "r-ok", property_id: "p1", marketing_status: "NEG", deal_id: "ok" },
      { id: "r-nodeal", property_id: "p1", marketing_status: "Available", deal_id: null },
      { id: "r-blank", property_id: "p1", marketing_status: null, deal_id: null },           // the tracker shows it as Marketing
      { id: "r-dangling", property_id: "p1", marketing_status: "SOL", deal_id: "gone" },
      { id: "r-wrongtype", property_id: "p1", marketing_status: "AVA", deal_id: "wrongtype" },
      { id: "r-let", property_id: "p1", marketing_status: "AVA", deal_id: "let" },
      { id: "r-elsewhere", property_id: "p1", marketing_status: "AVA", deal_id: "elsewhere" },
      { id: "r-historic", property_id: "p1", marketing_status: "Withdrawn", deal_id: null },
    ],
  });
  const { total } = await api.landsecCounts(["p1"], db, NOW);
  assert.equal(total.liveLettings, 2);           // ok, norow
  assert.equal(total.trackerRows, 6);            // every row but r-let and r-historic
  assert.equal(total.rowsWithoutLetting, 5);     // nodeal, blank, dangling, wrongtype, elsewhere
  assert.equal(total.lettingsWithoutRow, 1);     // norow
  assert.equal(api.trackerAndDealsDiffer(total), true);
  // The two headers reconcile: rows less the unbacked ones = lettings less the rowless ones.
  assert.equal(total.trackerRows - total.rowsWithoutLetting, total.liveLettings - total.lettingsWithoutRow);
});

test("counts are per property, add up, and ignore anything outside the list", async () => {
  const db = fakeDb({
    deals: [
      { id: "a", property_id: "p1", status: "AVA", deal_type: "New Letting" },
      { id: "b", property_id: "p2", status: "SOL", deal_type: "Temp Lease" },
      { id: "c", property_id: "p3", status: "SOL", deal_type: "New Letting" },
    ],
    rows: [
      { id: "ra", property_id: "p1", marketing_status: "AVA", deal_id: "a" },
      { id: "rb", property_id: "p2", marketing_status: "AVA", deal_id: "b" },
      { id: "rc", property_id: "p3", marketing_status: "AVA", deal_id: "c" },
    ],
  });
  const { total, byProperty } = await api.landsecCounts(["p1", "p2", "p2", ""], db, NOW);
  assert.deepEqual(Object.keys(byProperty).sort(), ["p1", "p2"]);
  assert.deepEqual(byProperty.p1.stages, { AVA: 1, NEG: 0, HOT: 0, SOL: 0 });
  assert.deepEqual(byProperty.p2.stages, { AVA: 0, NEG: 0, HOT: 0, SOL: 1 });
  assert.deepEqual(total, api.sumLandsecCounts([byProperty.p1, byProperty.p2]));
  assert.equal(total.liveLettings, 2);
  // A scheme with two records is the sum of its records; a missing one adds nothing.
  assert.equal(api.sumLandsecCounts([byProperty.p1, undefined, byProperty.p2]).trackerRows, 2);
});

test("no properties, no queries", async () => {
  const db = fakeDb({});
  const { total, byProperty } = await api.landsecCounts([], db, NOW);
  assert.deepEqual(total, api.emptyLandsecCount());
  assert.deepEqual(byProperty, {});
  assert.equal(db.calls.length, 0);
});

test("the 14-scheme report lists what would leave, live deals first, with no fee", async () => {
  const portfolio: any = {
    companyId: "landsec",
    schemes: [{ key: "bluewater", properties: [{ id: "p-blue" }] }, { key: "lucent", properties: [] }],
    outOfScope: [
      { id: "p-wiq", name: "West India Quay", units: 12, deals: 3 },
      { id: "p-marina", name: "Brighton Marina", units: 0, deals: 0 },
    ],
  };
  const db = fakeDb({
    outside: [
      { id: "d1", deal_ref: 101, name: "Old letting", deal_type: "New Letting", status: "COM", property_id: "p-wiq", property_name: "West India Quay", fee: 9999 },
      { id: "d2", deal_ref: 102, name: "Unit 4", deal_type: "New Letting", status: "Under Offer", property_id: "p-wiq", property_name: "West India Quay", fee: 9999 },
      { id: "d3", deal_ref: 103, name: "Unit 5", deal_type: "New Letting", status: "AVA", property_id: "p-wiq", property_name: "West India Quay" },
      { id: "d4", deal_ref: null, name: "Sale", deal_type: "Sale", status: "LIVE", property_id: "p-other", property_name: "Somewhere else" },
      { id: "d5", deal_ref: 105, name: "No property", deal_type: null, status: "WIT", property_id: null, property_name: null },
    ],
    outsideTracker: [{ property_id: "p-wiq", n: 4 }],
  });
  const report = await api.landsecOutsideSchemes(portfolio, db);
  assert.deepEqual(db.calls[0].values, ["landsec", ["p-wiq", "p-marina"], ["p-blue"]]);
  assert.deepEqual(report.counts, { properties: 2, deals: 5, liveDeals: 3, onOutsideProperties: 3, byCompanyLink: 2, listed: 5, trackerRows: 4 });
  assert.deepEqual(report.properties, [
    { id: "p-wiq", name: "West India Quay", units: 12, deals: 3, liveDeals: 2, trackerRows: 4 },
    { id: "p-marina", name: "Brighton Marina", units: 0, deals: 0, liveDeals: 0, trackerRows: 0 },
  ]);
  assert.deepEqual(report.deals.map(d => [d.id, d.status, d.live, d.via]), [
    ["d2", "SOL", true, "property"], ["d3", "AVA", true, "property"], ["d4", "LIVE", true, "company"],
    ["d1", "COM", false, "property"], ["d5", "WIT", false, "company"],
  ]);
  assert.ok(report.deals.every(d => !("fee" in d)));
});
