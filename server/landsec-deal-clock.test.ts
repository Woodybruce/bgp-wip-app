// The Landsec deal clock as the Deals page, its board, the deal page and the
// unit page read it (docs/landsec-menu-plan-2026-11-12.md, part 4):
//  - stuck counts only Negotiating, HOTs and Solicitors;
//  - a Net Effective Rent with no rent free or capital recorded is given no
//    pass or fail;
//  - "depends on" naming a deal the viewer cannot see is sent as "another deal";
//  - the floor comes from the Targeting Brief first, then the older Agreed brief.
//   node --import tsx --test server/landsec-deal-clock.test.ts
import test, { before } from "node:test";
import assert from "node:assert/strict";
import {
  landsecIsStuck, landsecInNegotiation, landsecBriefCheck, landsecIncentivesRecorded, landsecNer, LANDSEC_STUCK_DAYS,
} from "@shared/landsec";

let api: typeof import("./landsec-unit");
before(async () => {
  process.env.DATABASE_URL ||= "postgres://test:test@127.0.0.1:1/test";
  api = await import("./landsec-unit");
});

test("stuck is Negotiating, HOTs or Solicitors at 30 days: never Marketing", () => {
  assert.equal(LANDSEC_STUCK_DAYS, 30);
  for (const code of ["NEG", "HOT", "SOL"]) {
    assert.equal(landsecIsStuck(code, 30), true, code);
    assert.equal(landsecIsStuck(code, 29), false, code);
    assert.equal(landsecIsStuck(code, null), false, code);
  }
  // Every tracker unit has a Marketing deal: a long void is not a stuck deal.
  assert.equal(landsecIsStuck("AVA", 400), false);
  assert.equal(landsecIsStuck("EXC", 400), false);
  assert.equal(landsecIsStuck(null, 400), false);
  assert.equal(landsecInNegotiation("AVA"), false);
  assert.equal(landsecInNegotiation("SOL"), true);
});

test("no rent free or capital recorded: no pass and no fail", () => {
  // The sum would only repeat the headline rent, which reads as "meets floor".
  const ner = landsecNer({ headlinePa: 100000, rentFreeMonths: null, capital: null, leaseLength: "10" });
  assert.equal(ner?.nerPa, 100000);
  const recorded = landsecIncentivesRecorded(null, undefined, "");
  assert.equal(recorded, false);
  assert.equal(landsecBriefCheck(ner?.nerPa, 90000, recorded), "unchecked");
  assert.equal(landsecBriefCheck(ner?.nerPa, 120000, recorded), "unchecked");
});

test("a recorded 0 counts as recorded, and the check then passes or fails", () => {
  assert.equal(landsecIncentivesRecorded(0, null), true);
  assert.equal(landsecIncentivesRecorded(null, 25000), true);
  assert.equal(landsecBriefCheck(100000, 90000, true), "pass");
  assert.equal(landsecBriefCheck(80000, 90000, true), "fail");
  // No floor on the brief, or no Net Effective Rent: nothing to check.
  assert.equal(landsecBriefCheck(100000, null, true), null);
  assert.equal(landsecBriefCheck(100000, 0, true), null);
  assert.equal(landsecBriefCheck(null, 90000, true), null);
});

test("depends on: a deal the viewer cannot see is 'another deal', with no id, ref, name or unit", () => {
  const visible = new Set(["p-bluewater"]);
  const dep = { depends_on_deal_id: "d9", dep_ref: 412, dep_name: "Nando's", dep_unit: "Unit 12", dep_property_id: "p-trinity" };
  assert.deepEqual(api.dependsOnFor(dep, visible), { dependsOnDealId: null, dependsOn: null, dependsOnHidden: true });
  // A deal with no property, or one that has since been deleted, is hidden too.
  assert.deepEqual(api.dependsOnFor({ depends_on_deal_id: "d9", dep_property_id: null }, visible), { dependsOnDealId: null, dependsOn: null, dependsOnHidden: true });
  assert.deepEqual(api.dependsOnFor({ depends_on_deal_id: "d9" }, visible), { dependsOnDealId: null, dependsOn: null, dependsOnHidden: true });
});

test("depends on: a deal on a property the viewer can see is named and linked; none is none", () => {
  const visible = new Set(["p-bluewater"]);
  assert.deepEqual(
    api.dependsOnFor({ depends_on_deal_id: "d9", dep_ref: 412, dep_name: "Nando's", dep_unit: "Unit 12", dep_property_id: "p-bluewater" }, visible),
    { dependsOnDealId: "d9", dependsOn: { id: "d9", ref: 412, name: "Nando's", unit: "Unit 12" }, dependsOnHidden: false });
  assert.deepEqual(api.dependsOnFor({ depends_on_deal_id: null }, visible), { dependsOnDealId: null, dependsOn: null, dependsOnHidden: false });
});

test("the floor is the Targeting Brief's first, else the older Agreed brief's", () => {
  assert.equal(api.nerFloorOf({ nerFloorPa: 95000 }, 80000), 95000);
  assert.equal(api.nerFloorOf({ nerFloorPa: "95000" }, null), 95000);
  assert.equal(api.nerFloorOf({}, 80000), 80000);
  assert.equal(api.nerFloorOf(null, "80000"), 80000);
  assert.equal(api.nerFloorOf({ nerFloorPa: 0 }, null), null);
  assert.equal(api.nerFloorOf(null, null), null);
});

test("the brief state is the Targeting Brief's when the unit has one", () => {
  assert.equal(api.briefStateOf({ id: "b1", agreedAt: "2026-11-01" }, null), "agreed");
  // An unsigned Targeting Brief is not made "agreed" by an old two-signature brief.
  assert.equal(api.briefStateOf({ id: "b1", agreedAt: null }, { signedLeasingAt: "2026-10-01", signedAmAt: "2026-10-02" }), "drafted");
  assert.equal(api.briefStateOf(null, { signedLeasingAt: "2026-10-01", signedAmAt: "2026-10-02" }), "agreed");
  assert.equal(api.briefStateOf(null, { signedLeasingAt: "2026-10-01", signedAmAt: null, drafted: true }), "drafted");
  assert.equal(api.briefStateOf(null, { drafted: false }), null);
  assert.equal(api.briefStateOf(null, null), null);
});

test("a scheme is found from any of its property records, never from a record outside it", () => {
  // The property page's "Units and lettings" section asks by property id.
  const scheme = (key: string, ids: string[]) => ({ key, name: key, town: "", group: "South" as const, regions: [], canonicalId: ids[0] || null,
    properties: ids.map(id => ({ id, name: id, address: null, status: null, asset_class: null, lat: null, lng: null, units: 0, vacant: 0, passing_rent: 0, rent_units: 0, deals: 0, files: 0 })) });
  const portfolio = { schemes: [scheme("bluewater", ["p1"]), scheme("victoria", ["p2", "p3"]), scheme("lucent", [])] };
  assert.equal(api.schemeOfProperty(portfolio, "p1")?.key, "bluewater");
  // A duplicate record of a scheme is still that scheme.
  assert.equal(api.schemeOfProperty(portfolio, "p3")?.key, "victoria");
  // A Landsec record outside the 14 schemes, an unknown id and an empty id have no scheme.
  assert.equal(api.schemeOfProperty(portfolio, "outside"), undefined);
  assert.equal(api.schemeOfProperty(portfolio, ""), undefined);
});
