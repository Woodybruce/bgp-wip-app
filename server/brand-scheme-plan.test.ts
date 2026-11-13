// Brand CRM plan: grouping, stages and what each kind of viewer is sent
// (docs/brand-crm-spec-2026-11-12.md, 2.6).
//
// The first part runs against a fake database that answers each query by its
// tag. The last test runs the real SQL in a throwaway schema and is skipped
// unless BRAND_PLAN_DATABASE_URL names a local PostgreSQL database that holds
// the app's tables, for example:
//   BRAND_PLAN_DATABASE_URL=postgresql://postgres:qa-local-pg@127.0.0.1:5432/bgpsmoke \
//     node --import tsx --test server/brand-scheme-plan.test.ts
import test, { before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import pg from "pg";

let api: typeof import("./brand-scheme-plan");
let access: typeof import("./landsec-access");
before(async () => {
  process.env.DATABASE_URL ||= "postgres://test:test@127.0.0.1:1/test";
  api = await import("./brand-scheme-plan");
  access = await import("./landsec-access");
});

const NOW = new Date("2026-11-12T12:00:00Z");
const LANDSEC = "landsec-co";
const BRAND = "brand-jm";
const SCHEMES = [
  { key: "bluewater", name: "Bluewater", town: "Kent", group: "South", regions: ["South East"], canonicalId: "p-blue", propertyIds: ["p-blue", "p-blue-2"] },
  { key: "liverpool-one", name: "Liverpool ONE", town: "Liverpool", group: "North", regions: ["North West"], canonicalId: "p-liv", propertyIds: ["p-liv"] },
  { key: "gunwharf-quays", name: "Gunwharf Quays", town: "Portsmouth", group: "Outlets", regions: ["South East"], canonicalId: null, propertyIds: [] },
];
const STAFF = { kind: "staff" as const, clientCompanyId: null, schemes: null };
const LANDSEC_FULL = { kind: "landsec" as const, clientCompanyId: LANDSEC, schemes: null };
const ASSET_MANAGER = { kind: "asset_manager" as const, clientCompanyId: LANDSEC, schemes: new Set(["bluewater"]) };
const JOINT_AGENT = { kind: "joint_agent" as const, clientCompanyId: LANDSEC, schemes: new Set(["bluewater"]) };

// One evidence row as the evidence query returns it.
const ev = (over: Record<string, any>) => ({
  company_id: BRAND, property_id: "p-blue", property_name: "Bluewater Shopping Centre", property_address: null, property_postcode: "DA9 9ST",
  spine: null, tracker_id: null, lsu_id: null, deal_id: null, tracker_deal_id: null, src: "target_list", st: null, at: null, x: null,
  premises: null, unit_number: null, unit_status: null, occupier: null, lease_expiry: null, sqft: null, tracker_unit: null, lsu_unit: null,
  ...over,
});
const unit = (spine: string, label: string, over: Record<string, any> = {}) => ({ spine, premises: label, sqft: 2000, occupier: "Burger King", lease_expiry: "2027-06-24", ...over });

type Answers = Record<string, any[] | Error | ((values: any[]) => any[])>;
function fakeDb(answers: Answers) {
  const calls: Array<{ tag: string; sql: string; values: any[] }> = [];
  return {
    calls,
    tags: () => calls.map(c => c.tag),
    async query(sql: string, values: any[] = []) {
      const tag = sql.match(/\/\* brand-plan:([a-z-]+) \*\//)?.[1] || "untagged";
      calls.push({ tag, sql, values });
      // The evidence query asks for units sent to brands when the viewer is staff.
      const answer = tag === "evidence" && /unit_shares/.test(sql) && "evidence-with-shares" in answers ? answers["evidence-with-shares"] : answers[tag];
      if (answer instanceof Error) throw answer;
      return { rows: typeof answer === "function" ? answer(values) : answer || [] };
    },
  };
}
const brandRow = { id: BRAND, name: "Jersey Mike's", logo_url: "/logo.png", concept_status: "parked", bgp_contact_user_ids: ["u-lead"] };
const baseAnswers = (over: Answers = {}): Answers => ({
  brand: [brandRow], "brand-names": [{ id: BRAND, name: "Jersey Mike's" }], lead: [{ id: "u-lead", name: "Alex Todd" }], aim: [{ reason: "Three UK openings in 2027" }],
  users: [{ id: "u-agent", name: "Charlotte Roberts" }, { id: "u-lead", name: "Alex Todd" }], ...over,
});
const missingTable = (name: string) => Object.assign(new Error(`relation "${name}" does not exist`), { code: "42P01" });

test("records for one physical unit merge into one line; an unlinked tracker row stays apart and says so", async () => {
  const db = fakeDb(baseAnswers({
    evidence: [
      // The tenancy schedule row names the brand as a target.
      ev({ ...unit("ts-1", "Unit L104"), src: "target_list" }),
      // A viewing and an offer on the Letting Tracker row, walked to the same tenancy row.
      ev({ ...unit("ts-1", "Unit L104"), tracker_id: "au-1", tracker_deal_id: "d-1", src: "viewing", st: "completed", at: "2026-10-20", x: { viewingId: "v-1" } }),
      ev({ ...unit("ts-1", "Unit L104"), tracker_id: "au-1", tracker_deal_id: "d-1", src: "offer", st: "Pending", at: "2026-11-02", x: { offerId: "o-1" } }),
      // A tracker row nothing ties to the tenancy schedule.
      ev({ tracker_id: "au-9", tracker_unit: "Kiosk 3", sqft: 300, src: "interest", at: "2026-11-01" }),
    ],
  }));
  const plan = (await api.brandPlan(db, BRAND, STAFF, SCHEMES, NOW))!;
  assert.equal(plan.rows.length, 2);
  const linked = plan.rows.find(r => r.unit?.tenancyUnitId === "ts-1")!;
  assert.equal(linked.key, `${BRAND}|bluewater|ts-1`);
  assert.equal(linked.stage, "negotiating");
  assert.equal(linked.stageLabel, "Negotiating");
  assert.equal(linked.daysAtStage, 10);
  assert.deepEqual(linked.evidence.map(e => e.src), ["offer", "viewing", "target_list"]);
  assert.deepEqual(linked.unit, { key: "ts-1", tenancyUnitId: "ts-1", trackerId: "au-1", label: "Unit L104", sqft: 2000, occupier: "Burger King", leaseExpiry: "2027-06-24", splitKey: false });
  assert.deepEqual(linked.links, {
    tracker: "/available?propertyId=p-blue&unitId=au-1", deal: "/deals/d-1", unitPage: "/landsec/unit/ts-1",
    property: "/properties/p-blue", scheme: "/landsec/scheme/bluewater", brandCase: null,
  });
  const apart = plan.rows.find(r => r.unit?.key === "au:au-9")!;
  assert.equal(apart.unit?.splitKey, true);
  assert.equal(apart.unit?.tenancyUnitId, null);
  assert.equal(apart.links.unitPage, null);
  assert.equal(apart.stage, "approached");
  assert.equal(plan.brand.headline, "1 scheme: 1 negotiating, 1 approached");
});

test("staff get BGP's header and every source; a property outside the schemes is its own 'scheme'", async () => {
  const db = fakeDb(baseAnswers({
    "evidence-with-shares": [
      ev({ ...unit("ts-1", "Unit L104"), src: "target_list" }),
      ev({ ...unit("ts-1", "Unit L104"), tracker_id: "au-1", src: "share", st: "pdf", at: "2026-11-05T09:00:00Z" }),
      ev({ property_id: "p-other", property_name: "Bullring", ...unit("ts-b", "Unit 12"), src: "trading", st: "Occupied" }),
    ],
    "name-keys": [{ k: "jerseymikes" }],
    "name-matches": [ev({ ...unit("ts-2", "Unit U220"), src: "name_match", x: { via: "the leasing schedule" } })],
    actions: [{ company_id: BRAND, link: { company_id: BRAND }, id: "t-1", title: "Call their agent", due_at: "2026-11-20T00:00:00Z", status: "todo", owner_name: "Alex Todd" }],
  }));
  const plan = (await api.brandPlan(db, BRAND, STAFF, SCHEMES, NOW))!;
  assert.deepEqual(plan.brand, {
    id: BRAND, name: "Jersey Mike's", logoUrl: "/logo.png", headline: "2 schemes: 1 trading, 1 approached, 1 unit identified",
    onHold: true, lead: { id: "u-lead", name: "Alex Todd" }, aim: "Three UK openings in 2027",
    nextAction: { id: "t-1", title: "Call their agent", dueAt: "2026-11-20T00:00:00Z", ownerName: "Alex Todd" },
  });
  assert.equal(plan.canEdit, true);
  assert.equal(plan.rows.find(r => r.unit?.key === "ts-1")?.stage, "approached");          // the unit was sent to the brand
  const byName = plan.rows.find(r => r.unit?.key === "ts-2")!;
  assert.equal(byName.stage, "unit_identified");
  assert.deepEqual(byName.evidence, [{ src: "name_match", label: "Named in a target list, in the leasing schedule", at: null, byName: true }]);
  const other = plan.rows.find(r => r.scheme.key === null)!;
  assert.deepEqual(other.scheme, { key: null, name: "Bullring", group: null, propertyId: "p-other" });
  assert.equal(other.links.unitPage, null);
  assert.equal(other.links.scheme, null);
  // Staff read every property: the evidence query is not limited to the schemes.
  assert.deepEqual(db.calls.find(c => c.tag === "evidence")!.values, [[BRAND], null]);
});

test("a Landsec login sees its schemes only and nothing of BGP's own, and its stage comes from what it may see", async () => {
  const rows = [
    ev({ ...unit("ts-1", "Unit L104"), src: "target_list" }),
    ev({ ...unit("ts-1", "Unit L104"), tracker_id: "au-1", src: "viewing", st: "completed", at: "2026-10-20", x: { viewingId: "v-1", followUp: "2026-11-25", nextAction: "Chase their property director, he is wavering", ownerId: "u-agent", requirementId: "req-private" } }),
    // Another landlord's property: never part of a Landsec view.
    ev({ property_id: "p-other", property_name: "Bullring", ...unit("ts-b", "Unit 12"), src: "trading", st: "Occupied" }),
  ];
  const answers = baseAnswers({
    evidence: rows,
    "evidence-with-shares": [...rows, ev({ ...unit("ts-1", "Unit L104"), tracker_id: "au-1", src: "share", st: "pdf", at: "2026-11-05T09:00:00Z" })],
    wishes: [
      { id: "w-hidden", company_id: BRAND, property_id: "p-liv", tenancy_unit_id: null, unit_label: null, note: "Quietly sounding them out", requirement_id: null, visible_to_client: false, ruled_out_at: null, ruled_out_reason: null, created_by: "u-lead", created_by_name: "Alex Todd", created_at: "2026-11-10T10:00:00Z" },
      { id: "w-shown", company_id: BRAND, property_id: "p-blue", tenancy_unit_id: null, unit_label: null, note: "Landsec keen, BGP fee still to agree", requirement_id: null, visible_to_client: true, ruled_out_at: null, ruled_out_reason: null, created_by: "u-lead", created_by_name: "Alex Todd", created_at: "2026-11-10T10:00:00Z" },
    ],
    "case-units": [{ company_id: BRAND, case_status: "draft", at: "2026-11-11T10:00:00Z", pu: { id: "c1", schemeKey: "liverpool-one", tenancyUnitId: null, unitLabel: "The Byron unit", status: "Proposed" } }],
    requirements: [
      { id: "req-private", company_id: BRAND, name: "Jersey Mike's", size: ["1,500-3,000 sq ft"], use: ["Restaurant"], requirement_locations: ["South East", "North West"], status: "Active", sources: ["BGP"], deal_id: null, at: "2026-10-01T00:00:00Z" },
    ],
    actions: [{ company_id: BRAND, link: { company_id: BRAND }, id: "t-1", title: "Call their agent about the fee", due_at: "2026-11-20T00:00:00Z", status: "todo", owner_name: "Alex Todd" }],
    "name-keys": [{ k: "jerseymikes" }],
    "name-matches": [ev({ ...unit("ts-2", "Unit U220"), src: "name_match", x: { via: "the leasing schedule" } })],
  });

  const staffDb = fakeDb(answers);
  const staff = (await api.brandPlan(staffDb, BRAND, STAFF, SCHEMES, NOW))!;
  assert.equal(staff.rows.length, 5);
  assert.equal(staff.rows.find(r => r.unit?.key === "ts-1")?.nextStep?.title, "Chase their property director, he is wavering");
  assert.equal(staff.rows.find(r => r.wish?.id === "w-shown")?.wish?.note, "Landsec keen, BGP fee still to agree");
  assert.equal(staff.rows.find(r => r.scheme.key === "liverpool-one")?.links.brandCase, `/landsec/brand-case/${BRAND}`);
  assert.equal(staff.requirements[0].summary, "1,500–3,000 sq ft · Restaurant · South East, North West");
  // Gunwharf Quays has no property record in this fixture: staff are told a line cannot be added there yet.
  assert.deepEqual(staff.askedNoTarget, [{ place: "South East", schemes: [{ key: "gunwharf-quays", name: "Gunwharf Quays", noProperty: true }] }]);

  const db = fakeDb(answers);
  const plan = (await api.brandPlan(db, BRAND, LANDSEC_FULL, SCHEMES, NOW))!;
  // Only the 14 schemes are read at all, and no BGP-only query runs.
  assert.deepEqual(db.calls.find(c => c.tag === "evidence")!.values, [[BRAND], ["p-blue", "p-blue-2", "p-liv"]]);
  assert.ok(!/unit_shares/.test(db.calls.find(c => c.tag === "evidence")!.sql));
  for (const tag of ["name-keys", "name-matches", "lead", "aim"]) assert.ok(!db.tags().includes(tag), tag);
  // Bullring, the hidden Wanted line, the draft brand case and the name-only match are gone.
  assert.deepEqual(plan.rows.map(r => [r.scheme.key, r.unit?.key || null, r.stage]), [["bluewater", "ts-1", "viewed"], ["bluewater", null, "wanted"]]);
  // BGP's header is not sent.
  assert.deepEqual(plan.brand, { id: BRAND, name: "Jersey Mike's", logoUrl: "/logo.png", headline: "1 scheme: 1 viewed, 1 wanted" });
  assert.equal(plan.canEdit, false);
  const unitRow = plan.rows[0];
  // The viewing's typed next action is BGP's note; the follow-up date and the agent stay.
  assert.deepEqual(unitRow.nextStep, { kind: "viewing_followup", title: "Follow up the viewing", dueAt: "2026-11-25", daysWaiting: null, who: "Charlotte Roberts", refId: "v-1" });
  assert.deepEqual(unitRow.owner, { id: "u-agent", name: "Charlotte Roberts", source: "viewing" });
  // The chip is sent; the requirement behind it is not one this client may read.
  assert.deepEqual(unitRow.requirement, { chip: "linked", requirementId: null, unitSqft: 2000, range: null });
  assert.deepEqual(plan.requirements, [{ id: "held-1", summary: "Requirement held", ageDays: null, source: null, detailHidden: true }]);
  assert.deepEqual(plan.askedNoTarget, []);
  // A Wanted line BGP ticked is shown, without BGP's note.
  assert.deepEqual(plan.rows[1].wish, { id: "w-shown", note: null, visibleToClient: true, ruledOut: false, createdByName: "Alex Todd", requirementId: null });
  assert.equal(plan.rows[1].links.brandCase, null);                                          // the case is a draft
  const sent = JSON.stringify(plan);
  for (const secret of ["wavering", "Quietly", "fee", "Three UK openings", "Bullring", "The Byron unit", "Call their agent", "parked", "U220"]) assert.ok(!sent.includes(secret), secret);
  assert.equal("otherSchemeCount" in plan, false);
});

test("requirement detail reaches a client only for a PIPnet listing or its own requirement", async () => {
  const db = fakeDb(baseAnswers({
    evidence: [ev({ ...unit("ts-1", "Unit L104"), src: "target_list" })],
    requirements: [
      { id: "req-pip", company_id: BRAND, name: "JM", size: ["1,500-3,000 sq ft"], use: ["Restaurant"], requirement_locations: ["South East", "North West"], status: null, sources: ["PIPnet"], deal_id: null, at: "2026-11-02T12:00:00Z" },
      { id: "req-bgp", company_id: BRAND, name: "JM", size: ["900"], use: null, requirement_locations: ["Scotland"], status: "Active", sources: null, deal_id: null, at: "2026-10-01T00:00:00Z" },
    ],
  }));
  const plan = (await api.brandPlan(db, BRAND, LANDSEC_FULL, SCHEMES, NOW))!;
  assert.deepEqual(plan.requirements, [
    { id: "req-pip", summary: "1,500–3,000 sq ft · Restaurant · South East, North West", ageDays: 10, source: "PIPnet", detailHidden: false },
    { id: "held-2", summary: "Requirement held", ageDays: null, source: null, detailHidden: true },   // not even its id
  ]);
  assert.deepEqual(plan.rows[0].requirement, { chip: "fits", requirementId: "req-pip", unitSqft: 2000, range: { min: 1200, max: 3600 } });
  // Asked for, no target yet: from the PIPnet places only, and only schemes with no line.
  assert.deepEqual(plan.askedNoTarget, [
    { place: "South East", schemes: [{ key: "gunwharf-quays", name: "Gunwharf Quays" }] },
    { place: "North West", schemes: [{ key: "liverpool-one", name: "Liverpool ONE" }] },
  ]);
  assert.equal(api.requirementDetailHidden({ company_id: LANDSEC, sources: null }, LANDSEC_FULL), false);
  assert.equal(api.requirementDetailHidden({ company_id: BRAND, sources: ["PIPnet"] }, JOINT_AGENT), true);
  assert.equal(api.requirementDetailHidden({ company_id: BRAND, sources: null }, STAFF), false);
});

test("an asset manager gets own-scheme lines and a count of the other schemes, with no tracker, deal or property links", async () => {
  const db = fakeDb(baseAnswers({
    evidence: [
      ev({ ...unit("ts-1", "Unit L104"), tracker_id: "au-1", tracker_deal_id: "d-1", src: "offer", st: "Pending", at: "2026-11-02", x: { offerId: "o-1" } }),
      ev({ property_id: "p-liv", property_name: "Liverpool ONE", ...unit("ts-l", "Unit 7"), src: "target_list" }),
      ev({ property_id: "p-liv", property_name: "Liverpool ONE", ...unit("ts-m", "Unit 9"), src: "tracker_target", st: "Passed", at: "2026-09-01T00:00:00Z" }),
    ],
    "case-units": [{ company_id: BRAND, case_status: "sent", at: "2026-11-11T10:00:00Z", pu: null }],
    brands: [{ ...brandRow }],
  }));
  const plan = (await api.brandPlan(db, BRAND, ASSET_MANAGER, SCHEMES, NOW))!;
  assert.deepEqual(plan.rows.map(r => r.scheme.key), ["bluewater"]);
  assert.deepEqual(plan.notProceeding, []);
  assert.equal(plan.otherSchemeCount, 1);            // Liverpool ONE once: the passed line there is not counted again
  assert.deepEqual(plan.rows[0].links, {
    tracker: null, deal: null, unitPage: "/landsec/unit/ts-1", property: null, scheme: "/landsec/scheme/bluewater", brandCase: `/landsec/brand-case/${BRAND}`,
  });
  assert.equal(plan.brand.id, BRAND);                // asset managers open brand pages
  // The grid tells an asset manager the same count; the brand is theirs to open.
  const grid = await api.brandGrid(db, ASSET_MANAGER, SCHEMES, "(TRUE)", NOW);
  assert.deepEqual(grid.brands.map(x => [x.id, x.otherSchemeCount, Object.keys(x.cells)]), [[BRAND, 1, ["bluewater"]]]);
  assert.ok(!JSON.stringify(plan).includes("Liverpool"));
});

test("a joint agent gets brand names and stages on its own schemes: no company id, no brand case, no BGP notes, and only the actions BGP shared at its schemes", async () => {
  const action = (id: string, title: string, link: Record<string, any>, over: Record<string, any> = {}) =>
    ({ company_id: BRAND, link: { company_id: BRAND, ...link }, id, title, due_at: "2026-11-18T00:00:00Z", status: "todo", owner_name: "Alex Todd", raised_by_role: "Staff", ...over });
  // None of these may reach a joint agent at Bluewater.
  const withheld = [
    action("t-private", "Agree our fee before Landsec hear", { property_id: "p-blue", tenancy_unit_id: "ts-1", shared_with_company_id: null }),
    action("t-unplaced", "Shared with Landsec but at no scheme", { shared_with_company_id: LANDSEC }),
    action("t-elsewhere", "Shared at another scheme", { property_id: "p-liv", tenancy_unit_id: "ts-l", shared_with_company_id: LANDSEC }),
    action("t-other", "Shared with Hammerson", { property_id: "p-blue", tenancy_unit_id: "ts-1", shared_with_company_id: "hammerson-co" }),
    action("t-client", "A client login typed this", { property_id: "p-blue", tenancy_unit_id: "ts-1", shared_with_company_id: LANDSEC }, { raised_by_role: "Client" }),
  ];
  const answers = baseAnswers({
    evidence: [
      ev({ ...unit("ts-1", "Unit L104"), tracker_id: "au-1", tracker_deal_id: "d-1", src: "offer", st: "Pending", at: "2026-11-02", x: { offerId: "o-1" } }),
      ev({ property_id: "p-liv", property_name: "Liverpool ONE", ...unit("ts-l", "Unit 7"), src: "target_list" }),
      ev({ company_id: "brand-2", ...unit("ts-3", "Unit L300"), src: "trading", st: "Occupied" }),
    ],
    wishes: [{ id: "w-shown", company_id: BRAND, property_id: "p-blue", tenancy_unit_id: null, unit_label: null, note: "BGP note", requirement_id: null, visible_to_client: true, ruled_out_at: null, ruled_out_reason: null, created_by: "u-lead", created_by_name: "Alex Todd", created_at: "2026-11-10T10:00:00Z" }],
    "case-units": new Error("the brand case must not be read for a joint agent"),
    actions: withheld,
    clocks: [{ deal_id: "d-1", waiting_on_party: "Tenant", waiting_on_name: "Sam Brand-Contact", waiting_since: "2026-11-05T00:00:00Z" }],
    brands: [{ id: BRAND, name: "Jersey Mike's", logo_url: null, concept_status: "parked", bgp_contact_user_ids: ["u-lead"] }, { id: "brand-2", name: "Wingstop", logo_url: null, concept_status: null, bgp_contact_user_ids: null }],
    "brand-names": [{ id: BRAND, name: "Jersey Mike's" }, { id: "brand-2", name: "Wingstop" }],
  });
  const db = fakeDb(answers);
  const grid = await api.brandGrid(db, JOINT_AGENT, SCHEMES, "(TRUE)", NOW);
  assert.ok(!db.tags().includes("case-units") && !db.tags().includes("strategy-brands"));
  assert.deepEqual(grid.schemes, [{ key: "bluewater", name: "Bluewater", group: "South" }]);
  assert.equal(grid.canEdit, false);
  assert.deepEqual(grid.brands.map(b => [b.key, b.id, b.name, b.furthest, b.otherSchemeCount]), [["b1", null, "Jersey Mike's", "negotiating", undefined], ["b2", null, "Wingstop", "trading", undefined]]);   // no count of schemes outside its own
  const jm = grid.brands[0];
  assert.deepEqual(jm.cells, { bluewater: { stage: "negotiating", count: 2, rowKeys: ["b1|bluewater|ts-1", "b1|bluewater|none"], wanted: 1 } });   // no owners, no "no next step" count
  assert.equal(jm.wantedNoUnit, 1);
  assert.equal(jm.rows?.length, 2);
  for (const row of jm.rows!) {
    assert.equal(row.companyId, null);
    assert.equal(row.brandName, "Jersey Mike's");
    assert.equal(row.links.brandCase, null);
    assert.equal(row.links.tracker, null);
    assert.equal(row.links.deal, null);
  }
  // The deal clock says who it waits on, never the brand contact's name.
  assert.deepEqual(jm.rows![0].nextStep, { kind: "deal_waiting", title: "Waiting on Tenant", dueAt: null, daysWaiting: 7, who: null, refId: "d-1" });
  // The Wanted line BGP ticked shows who at BGP wrote it, never the note.
  assert.deepEqual(jm.rows![1].wish, { id: "w-shown", note: null, visibleToClient: true, ruledOut: false, createdByName: "Alex Todd", requirementId: null });
  const sent = JSON.stringify(grid);
  for (const secret of [BRAND, "brand-2", "BGP note", "Sam Brand-Contact", "parked", "Liverpool", "onHold", "\"lead\"", "openActions", "nextAction", ...withheld.map(a => a.title)]) assert.ok(!sent.includes(secret), secret);
  // An action BGP raised, shared with Landsec and placed at the joint agent's scheme is that line's next step: title, date and owner only.
  const shared = action("t-shared", "Send the unit plans", { property_id: "p-blue", tenancy_unit_id: "ts-1", shared_with_company_id: LANDSEC });
  const withShared = await api.brandGrid(fakeDb({ ...answers, actions: [...withheld, shared] }), JOINT_AGENT, SCHEMES, "(TRUE)", NOW);
  assert.deepEqual(withShared.brands[0].rows![0].nextStep, { kind: "action", title: "Send the unit plans", dueAt: "2026-11-18T00:00:00Z", daysWaiting: null, who: "Alex Todd", refId: "t-shared" });
  assert.equal(withShared.brands[0].rows![1].nextStep, null);
  for (const a of withheld) assert.ok(!JSON.stringify(withShared).includes(a.title), a.title);
  // Asked for one brand's plan directly, the same stripping holds.
  const plan = (await api.brandPlan(db, BRAND, JOINT_AGENT, SCHEMES, NOW))!;
  assert.equal(plan.brand.id, null);
  assert.ok(plan.rows.every(r => r.companyId === null && !r.key.includes(BRAND)));
});

test("a ruled-out Wanted line: Landsec reads BGP's reason, a joint agent only that BGP ruled it out; a not-proceeding scheme is not offered again", async () => {
  const answers = () => baseAnswers({
    evidence: [ev({ ...unit("ts-1", "Unit L104"), src: "viewing", st: "completed", at: "2026-10-20", x: { viewingId: "v-1" } })],
    "evidence-with-shares": [],
    wishes: [{ id: "w-out", company_id: BRAND, property_id: "p-blue", tenancy_unit_id: null, unit_label: null, note: null, requirement_id: null, visible_to_client: true,
      ruled_out_at: "2026-11-02T00:00:00Z", ruled_out_reason: "Centre already has two dessert kiosks", created_by: "u-lead", created_by_name: "Alex Todd", created_at: "2026-11-01T10:00:00Z" }],
    requirements: [{ id: "req-own", company_id: LANDSEC, name: "JM", size: null, use: null, requirement_locations: ["South East"], status: "Active", sources: ["PIPnet"], deal_id: null, at: "2026-11-01T00:00:00Z" }],
    brands: [{ ...brandRow }],
  });
  const full = (await api.brandPlan(fakeDb(answers()), BRAND, LANDSEC_FULL, SCHEMES, NOW))!;
  assert.equal(full.notProceeding[0].notProceedingReason, "Centre already has two dessert kiosks");
  const grid = await api.brandGrid(fakeDb(answers()), JOINT_AGENT, SCHEMES, "(TRUE)", NOW);
  const dead = grid.brands[0].rows!.find(r => r.stage === "not_proceeding")!;
  assert.equal(dead.notProceedingReason, "Ruled out by BGP");
  assert.ok(!JSON.stringify(grid).includes("dessert"));
  // The number beside the stage is the live line only.
  assert.deepEqual([grid.brands[0].cells.bluewater.stage, grid.brands[0].cells.bluewater.count, grid.brands[0].cells.bluewater.rowKeys.length], ["viewed", 1, 2]);
  // Staff: Bluewater has only a ruled-out line, so it is under Not proceeding and not under "Asked for, no target yet".
  const staff = (await api.brandPlan(fakeDb(answers()), BRAND, STAFF, SCHEMES, NOW))!;
  assert.deepEqual(staff.rows.map(r => r.scheme.key), []);
  assert.deepEqual(staff.notProceeding.map(r => r.scheme.key), ["bluewater"]);
  assert.ok(staff.askedNoTarget.every(a => a.schemes.every(sc => sc.key !== "bluewater")));
  // With nothing live at a scheme the cell still says how many lines it holds.
  const staffGrid = await api.brandGrid(fakeDb(answers()), STAFF, SCHEMES, null, NOW);
  assert.deepEqual([staffGrid.brands[0].cells.bluewater.stage, staffGrid.brands[0].cells.bluewater.count], ["not_proceeding", 1]);
});

test("the grid: one cell per scheme with the furthest stage; staff also see strategy brands with no line yet", async () => {
  const answers = baseAnswers({
    "evidence-with-shares": [
      ev({ ...unit("ts-1", "Unit L104"), src: "target_list" }),
      ev({ ...unit("ts-2", "Unit U220"), tracker_id: "au-2", src: "viewing", st: "completed", at: "2026-10-20", x: { viewingId: "v-1" } }),
      ev({ ...unit("ts-4", "Unit K1"), src: "tracker_target", st: "Passed", at: "2026-09-01T00:00:00Z" }),
    ],
    wishes: [{ id: "w-1", company_id: BRAND, property_id: "p-liv", tenancy_unit_id: null, unit_label: null, note: null, requirement_id: null, visible_to_client: false, ruled_out_at: null, ruled_out_reason: null, created_by: "u-lead", created_by_name: "Alex Todd", created_at: "2026-11-10T10:00:00Z" }],
    "strategy-brands": [{ company_id: "brand-new" }],
    brands: [{ ...brandRow }, { id: "brand-new", name: "Yo Chi", logo_url: null, concept_status: null, bgp_contact_user_ids: null }],
    leads: [{ id: "u-lead", name: "Alex Todd" }],
    requirements: (values: any[]) => (values[0].includes("brand-new") ? [{ id: "r-9", company_id: "brand-new", size: null, use: null, requirement_locations: null, status: "Active", sources: null, deal_id: null, at: null }] : []),
    actions: [{ company_id: "brand-new", link: {}, id: "t-9", title: "First call", due_at: null, status: "todo", owner_name: "Alex Todd" }],
  });
  const db = fakeDb(answers);
  const grid = await api.brandGrid(db, STAFF, SCHEMES, null, NOW);
  assert.deepEqual(grid.schemes.map(s => s.key), ["bluewater", "liverpool-one", "gunwharf-quays"]);
  assert.equal(grid.canEdit, true);
  const jm = grid.brands.find(b => b.id === BRAND)!;
  assert.deepEqual(jm.cells, {
    // The number is the two live lines: the passed target (ts-4) is not counted.
    bluewater: { stage: "viewed", count: 2, rowKeys: [`${BRAND}|bluewater|ts-2`, `${BRAND}|bluewater|ts-1`, `${BRAND}|bluewater|ts-4`], wanted: 0, owners: [], noNextStep: 2 },
    "liverpool-one": { stage: "wanted", count: 1, rowKeys: [`${BRAND}|liverpool-one|none`], wanted: 1, owners: ["Alex Todd"], noNextStep: 1 },
  });
  assert.equal(jm.furthest, "viewed");
  assert.equal(jm.wantedNoUnit, 1);
  assert.equal(jm.onHold, true);
  assert.deepEqual(jm.lead, { id: "u-lead", name: "Alex Todd" });
  assert.equal(jm.rows, undefined);
  const fresh = grid.brands.find(b => b.id === "brand-new")!;
  assert.deepEqual([fresh.furthest, fresh.cells, fresh.requirementHeld, fresh.openActions], [null, {}, true, 1]);
  // The grid is read by property, never by scanning every brand.
  assert.deepEqual(db.calls.find(c => c.tag === "evidence")!.values, [null, ["p-blue", "p-blue-2", "p-liv"]]);

  // The Landsec grid: the client slice is applied to the brand list and BGP's columns are absent.
  const clientDb = fakeDb({ ...answers, evidence: answers["evidence-with-shares"], brands: [{ ...brandRow }] });
  const client = await api.brandGrid(clientDb, LANDSEC_FULL, SCHEMES, "(c.company_type ILIKE ANY(ARRAY['Tenant - Restaurants']))", NOW);
  assert.match(clientDb.calls.find(c => c.tag === "brands")!.sql, /AND \(c\.company_type ILIKE ANY\(ARRAY\['Tenant - Restaurants'\]\)\)/);
  assert.match(clientDb.calls.find(c => c.tag === "brands")!.sql, /c\.archived_at IS NULL/);
  assert.ok(!clientDb.tags().includes("strategy-brands"));
  assert.deepEqual(Object.keys(client.brands[0]).sort(), ["cells", "furthest", "id", "key", "logoUrl", "name", "requirementHeld", "wantedNoUnit"]);
  assert.deepEqual(Object.keys(client.brands[0].cells.bluewater).sort(), ["count", "rowKeys", "stage", "wanted"]);
  assert.deepEqual(Object.keys(client.brands[0].cells), ["bluewater"]);                      // the hidden Wanted line at Liverpool ONE is not there
});

test("a missing Wanted table, or any other side table, is a warning and not an error", async () => {
  const db = fakeDb(baseAnswers({
    "evidence-with-shares": missingTable("unit_shares"),
    evidence: [ev({ ...unit("ts-1", "Unit L104"), tracker_id: "au-1", src: "offer", st: "Pending", at: "2026-11-02", x: { offerId: "o-1" } })],
    wishes: missingTable("brand_scheme_targets"),
    "case-units": missingTable("landsec_brand_cases"),
    hots: new Error('column "hots_offer_id" does not exist'),
    rounds: missingTable("unit_offer_rounds"),
    "name-keys": [{ k: "jerseymikes" }],
    "name-matches": missingTable("landsec_units"),
    clocks: missingTable("landsec_deal_clock"),
  }));
  const plan = (await api.brandPlan(db, BRAND, STAFF, SCHEMES, NOW))!;
  assert.equal(plan.rows.length, 1);
  assert.equal(plan.rows[0].stage, "negotiating");
  assert.deepEqual(plan.warnings, [
    "Units sent to brands could not be read and are left out of this view.",
    "Target lists that name the brand without a link could not be read and are left out of this view.",
    "Heads of terms could not be read and are left out of this view.",
    "Offer rounds could not be read and are left out of this view.",
    "Landsec brand cases could not be read and are left out of this view.",
    "Wanted lines could not be read and are left out of this view.",
  ]);
  // A failure of the evidence query itself is not swallowed.
  await assert.rejects(api.brandPlan(fakeDb(baseAnswers({ "evidence-with-shares": new Error("connection lost") })), BRAND, STAFF, SCHEMES, NOW), /connection lost/);
  assert.equal(await api.brandPlan(fakeDb({ brand: [] }), "nobody", STAFF, SCHEMES, NOW), null);
});

test("heads of terms issued from the brand's offer count before the deal names its tenant; the unit's lettings correct the stage", async () => {
  const offer = (over: Record<string, any> = {}) => ev({ ...unit("ts-1", "Unit L104"), tracker_id: "au-1", tracker_deal_id: "d-1", src: "offer", st: "Agreed", at: "2026-10-28", x: { offerId: "o-1" }, ...over });
  // HOTs issued from this offer; the deal has no tenant yet.
  let db = fakeDb(baseAnswers({
    "evidence-with-shares": [offer()],
    hots: [{ id: "au-1", hots_offer_id: "o-1", hots_issued_at: "2026-11-06T10:00:00Z", hots_final_at: null }],
    rounds: [{ offer_id: "o-1", party: "landlord", round_date: "2026-11-03", round_no: 3 }],
    "unit-deals": [{ id: "d-1", tenant_id: null, status: "HOT", deal_type: "New Letting", deal_ref: 4012, tenancy_unit_id: "ts-1", internal_agent: ["Charlotte Roberts"], internal_agent_ids: ["u-agent"], closed_at: null, stage_at: "2026-11-06T10:00:00Z" }],
  }));
  let row = (await api.brandPlan(db, BRAND, STAFF, SCHEMES, NOW))!.rows[0];
  assert.equal(row.stage, "hots");
  assert.equal(row.stageSince, "2026-11-06T10:00:00.000Z");
  assert.ok(row.evidence.some(e => e.label === "Heads of terms issued"));
  assert.ok(row.evidence.some(e => e.label === "Offer agreed, landlord countered 3 Nov"));
  assert.deepEqual(row.owner, { id: "u-agent", name: "Charlotte Roberts", source: "deal" });

  // HOTs issued from a different offer on the unit: this brand is not at HOTs, and the unit has gone to the other brand.
  db = fakeDb(baseAnswers({
    "evidence-with-shares": [offer({ st: "Pending" })],
    hots: [{ id: "au-1", hots_offer_id: "o-other", hots_issued_at: "2026-11-06T10:00:00Z", hots_final_at: null }],
    "unit-deals": [{ id: "d-1", tenant_id: "other-brand", status: "SOL", deal_type: "New Letting", deal_ref: 4012, tenancy_unit_id: "ts-1", internal_agent: null, internal_agent_ids: null, closed_at: null, stage_at: "2026-11-08T10:00:00Z" }],
  }));
  const plan = (await api.brandPlan(db, BRAND, STAFF, SCHEMES, NOW))!;
  assert.deepEqual(plan.rows, []);
  assert.equal(plan.notProceeding[0].stage, "not_proceeding");
  assert.equal(plan.notProceeding[0].notProceedingReason, "Unit went to another brand");
  assert.equal(plan.notProceeding[0].nextStep, null);

  // A viewing from before the unit was last let to someone else belongs to that letting; an advisory deal on the unit is not a letting.
  db = fakeDb(baseAnswers({
    "evidence-with-shares": [
      ev({ ...unit("ts-1", "Unit L104"), tracker_id: "au-1", tracker_deal_id: "d-2", src: "viewing", st: "completed", at: "2024-03-01", x: { viewingId: "v-old" } }),
      ev({ ...unit("ts-1", "Unit L104"), src: "target_list" }),
    ],
    "unit-deals": [
      { id: "d-0", tenant_id: "other-brand", status: "COM", deal_type: "New Letting", deal_ref: 1, tenancy_unit_id: "ts-1", internal_agent: null, internal_agent_ids: null, closed_at: "2024-09-01T00:00:00Z", stage_at: "2024-09-01T00:00:00Z" },
      { id: "d-rr", tenant_id: "other-brand", status: "SOL", deal_type: "Rent Review", deal_ref: 2, tenancy_unit_id: "ts-1", internal_agent: null, internal_agent_ids: null, closed_at: null, stage_at: "2026-11-01T00:00:00Z" },
    ],
  }));
  row = (await api.brandPlan(db, BRAND, STAFF, SCHEMES, NOW))!.rows[0];
  assert.equal(row.stage, "unit_identified");
  assert.deepEqual(row.evidence.map(e => e.src), ["target_list"]);
});

test("a BGP action reaches a client only when its share marker names that client's company, and then without notes", async () => {
  const actions = [
    { company_id: BRAND, link: { company_id: BRAND, property_id: "p-blue", tenancy_unit_id: "ts-1", shared_with_company_id: LANDSEC }, id: "t-shared", title: "Send Landsec the trading figures", due_at: "2026-11-18T00:00:00Z", status: "todo", owner_name: "Alex Todd" },
    { company_id: BRAND, link: { company_id: BRAND, property_id: "p-blue", tenancy_unit_id: "ts-1", shared_with_company_id: null }, id: "t-private", title: "Agree our fee before Landsec hear", due_at: "2026-11-14T00:00:00Z", status: "todo", owner_name: "Alex Todd" },
    { company_id: BRAND, link: { company_id: BRAND, property_id: "p-blue", tenancy_unit_id: "ts-1", shared_with_company_id: "hammerson-co" }, id: "t-other", title: "Shared with Hammerson", due_at: "2026-11-13T00:00:00Z", status: "todo", owner_name: "Alex Todd" },
  ];
  const answers = baseAnswers({ evidence: [ev({ ...unit("ts-1", "Unit L104"), src: "target_list" })], "evidence-with-shares": [ev({ ...unit("ts-1", "Unit L104"), src: "target_list" })], actions });
  const staffDb = fakeDb(answers);
  const staff = (await api.brandPlan(staffDb, BRAND, STAFF, SCHEMES, NOW))!;
  assert.equal(staff.rows[0].nextStep?.refId, "t-other");            // staff: the earliest of all three
  assert.equal(staff.brand.nextAction?.id, "t-shared");              // the query's own order
  const client = (await api.brandPlan(fakeDb(answers), BRAND, LANDSEC_FULL, SCHEMES, NOW))!;
  assert.deepEqual(client.rows[0].nextStep, { kind: "action", title: "Send Landsec the trading figures", dueAt: "2026-11-18T00:00:00Z", daysWaiting: null, who: "Alex Todd", refId: "t-shared" });
  assert.equal(client.brand.nextAction, undefined);
  assert.ok(!JSON.stringify(client).includes("fee") && !JSON.stringify(client).includes("Hammerson"));
  // The actions query reads the scheme and share columns through to_jsonb, so it holds before they exist.
  const actionsSql = staffDb.calls.find(c => c.tag === "actions")!.sql;
  assert.match(actionsSql, /to_jsonb\(l\) AS link/);
  assert.doesNotMatch(actionsSql, /shared_with_company_id|l\.property_id|l\.tenancy_unit_id/);
});

test("Wanted lines: staff create, change and rule out; nothing is ever a deal", async () => {
  const sqls: Array<{ sql: string; values: any[] }> = [];
  const store = (handlers: Array<[RegExp, (values: any[]) => any[] | Error]>) => ({
    async query(sql: string, values: any[] = []) {
      sqls.push({ sql, values });
      for (const [re, fn] of handlers) if (re.test(sql)) { const out = fn(values); if (out instanceof Error) throw out; return { rows: out }; }
      throw new Error(`unexpected query: ${sql}`);
    },
  });
  const actor = { id: "u-lead", name: "Alex Todd" };
  const brandOk: [RegExp, (v: any[]) => any[]] = [/FROM crm_companies WHERE id/, () => [{ id: BRAND, company_type: "Tenant - Restaurants", merged_into_id: null }]];
  const propertyOk: [RegExp, (v: any[]) => any[]] = [/FROM crm_properties WHERE id/, v => (v[0] === "p-blue" ? [{ "?column?": 1 }] : [])];

  // A scheme wish lands on the scheme's main property record, hidden from the client until ticked.
  let q = store([brandOk, propertyOk, [/INSERT INTO brand_scheme_targets/, () => [{ id: "w-1" }]]]);
  assert.deepEqual(await api.createWish(q, SCHEMES, { companyId: BRAND, schemeKey: "bluewater", note: "Burger King unit when it comes back" }, actor), { ok: true, id: "w-1" });
  const insert = sqls.find(s => /INSERT INTO brand_scheme_targets/.test(s.sql))!;
  assert.deepEqual(insert.values, [BRAND, "p-blue", null, null, "Burger King unit when it comes back", null, false, "u-lead", "Alex Todd"]);
  assert.ok(sqls.every(s => !/crm_deals|available_units/.test(s.sql)));

  // A scheme with no property record yet, an unknown scheme, a landlord, and extra fields are refused.
  await assert.rejects(api.createWish(q, SCHEMES, { companyId: BRAND, schemeKey: "gunwharf-quays" }, actor), (e: any) => e.status === 400 && /no property record/.test(e.message));
  await assert.rejects(api.createWish(q, SCHEMES, { companyId: BRAND, schemeKey: "nowhere" }, actor), (e: any) => e.status === 400);
  await assert.rejects(api.createWish(q, SCHEMES, { companyId: BRAND }, actor), (e: any) => e.status === 400 && /scheme or a property/.test(e.message));
  await assert.rejects(api.createWish(q, SCHEMES, { companyId: BRAND, schemeKey: "bluewater", createdByCompanyId: "x" }, actor), (e: any) => e.status === 400);
  const landlord = store([[/FROM crm_companies WHERE id/, () => [{ id: LANDSEC, company_type: "Landlord", merged_into_id: null }]]]);
  await assert.rejects(api.createWish(landlord, SCHEMES, { companyId: LANDSEC, schemeKey: "bluewater" }, actor), (e: any) => e.status === 400 && /Landlord CRM/.test(e.message));
  await assert.rejects(api.createWish(store([[/FROM crm_companies WHERE id/, () => []]]), SCHEMES, { companyId: "gone", schemeKey: "bluewater" }, actor), (e: any) => e.status === 404);

  // A unit pins the line to the unit's own property record, which must be in the scheme chosen.
  q = store([brandOk, propertyOk, [/FROM tenancy_schedule_units WHERE id/, v => (v[0] === "ts-1" ? [{ id: "ts-1", property_id: "p-blue-2" }] : v[0] === "ts-l" ? [{ id: "ts-l", property_id: "p-liv" }] : [])], [/INSERT INTO brand_scheme_targets/, v => [{ id: `w-${v[1]}` }]]]);
  assert.deepEqual(await api.createWish(q, SCHEMES, { companyId: BRAND, schemeKey: "bluewater", tenancyUnitId: "ts-1", visibleToClient: true }, actor), { ok: true, id: "w-p-blue-2" });
  await assert.rejects(api.createWish(q, SCHEMES, { companyId: BRAND, schemeKey: "bluewater", tenancyUnitId: "ts-l" }, actor), (e: any) => e.status === 400 && /not in the scheme/.test(e.message));
  await assert.rejects(api.createWish(q, SCHEMES, { companyId: BRAND, schemeKey: "bluewater", tenancyUnitId: "ts-none" }, actor), (e: any) => e.status === 400);

  // The same brand, place and unit twice is a 409, not a second line.
  q = store([brandOk, propertyOk, [/INSERT INTO brand_scheme_targets/, () => Object.assign(new Error("duplicate key"), { code: "23505" })]]);
  await assert.rejects(api.createWish(q, SCHEMES, { companyId: BRAND, schemeKey: "bluewater" }, actor), (e: any) => e.status === 409);

  // Tick "show to Landsec"; rule out with a reason (kept, never deleted); bring back.
  sqls.length = 0;
  q = store([[/FROM brand_scheme_targets WHERE id/, v => (v[0] === "w-1" ? [{ id: "w-1", company_id: BRAND, property_id: "p-blue" }] : [])], [/UPDATE brand_scheme_targets/, () => []]]);
  await api.updateWish(q, SCHEMES, "w-1", { visibleToClient: true });
  assert.match(sqls.at(-1)!.sql, /SET visible_to_client = \$2, updated_at = now\(\) WHERE id = \$1/);
  assert.deepEqual(sqls.at(-1)!.values, ["w-1", true]);
  await api.updateWish(q, SCHEMES, "w-1", { ruledOut: { reason: "Landsec want a local operator" } });
  assert.match(sqls.at(-1)!.sql, /ruled_out_at = COALESCE\(ruled_out_at, now\(\)\), ruled_out_reason = \$2/);
  assert.deepEqual(sqls.at(-1)!.values, ["w-1", "Landsec want a local operator"]);
  await api.updateWish(q, SCHEMES, "w-1", { ruledOut: null });
  assert.match(sqls.at(-1)!.sql, /ruled_out_at = NULL, ruled_out_reason = \$2/);
  assert.ok(sqls.every(s => !/DELETE/i.test(s.sql)));
  await assert.rejects(api.updateWish(q, SCHEMES, "w-1", { ruledOut: { reason: " " } }), (e: any) => e.status === 400);
  await assert.rejects(api.updateWish(q, SCHEMES, "w-1", {}), (e: any) => e.status === 400);
  await assert.rejects(api.updateWish(q, SCHEMES, "w-1", { companyId: "other" }), (e: any) => e.status === 400);
  await assert.rejects(api.updateWish(q, SCHEMES, "w-gone", { note: "x" }), (e: any) => e.status === 404);
});

test("the gateway: asset managers and joint agents reach the Landsec Brand CRM door and never the staff one", async () => {
  const req = (role: string, method = "GET") => ({ method, _landsecAccessResolved: true, _landsecAccess: { role, schemes: ["bluewater"], firm: null } }) as any;
  for (const role of ["asset_manager", "joint_agent"]) {
    assert.equal(await access.restrictedLandsecApiDecision(req(role), "/api/landsec/brand-crm/plan"), "allow", role);
    assert.equal(await access.restrictedLandsecApiDecision(req(role), "/api/brand-crm/plan"), "deny", role);
    assert.equal(await access.restrictedLandsecApiDecision(req(role), "/api/brand-crm/plan/abc"), "deny", role);
    assert.equal(await access.restrictedLandsecApiDecision(req(role, "POST"), "/api/brand-crm/targets"), "deny", role);
  }
  // Brand cases stay closed to a joint agent.
  assert.equal(await access.restrictedLandsecApiDecision(req("joint_agent"), "/api/landsec/brand-case/abc"), "deny");
  // /api/brand-crm is on no client allowlist in server/index.ts, so every other client login is refused by default.
  const index = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  const lists = index.slice(index.indexOf("const CLIENT_ALLOWED_API = ["), index.indexOf("app.use(\"/api\", (req: any, res, next) => {", index.indexOf("const CLIENT_ALLOWED_WRITES = [")));
  assert.ok(lists.includes('"/api/landsec/"'));
  assert.ok(!lists.includes("/api/brand-crm"));
  assert.match(index, /setupBrandCrmPlanRoutes\(app\);/);
});

test("the Wanted table is on the boot list, in the merge references and in the brand tidy", async () => {
  const drift = await import("./schema-drift");
  assert.ok(drift.IDEMPOTENT_SQL_MIGRATIONS.includes("0057_brand_scheme_targets.sql"));
  const sql = readFileSync(new URL("../migrations/0057_brand_scheme_targets.sql", import.meta.url), "utf8");
  const statements = sql.replace(/--[^\n]*/g, "").split(";").map(s => s.trim()).filter(Boolean);
  assert.equal(statements.length, 3);
  for (const s of statements) assert.match(s, /^CREATE (TABLE|UNIQUE INDEX|INDEX) IF NOT EXISTS /);      // additive, safe to run again
  const dedupe = await import("./brand-dedupe");
  assert.ok(dedupe.COMPANY_REFS.some(r => r.table === "brand_scheme_targets" && r.column === "company_id"));
  assert.equal(dedupe.LATE_COMPANY_REFS[0].column, "joint_agent_id");                                    // the one-off repair list is unchanged
  assert.ok(!dedupe.LATE_COMPANY_REFS.some(r => r.table === "brand_scheme_targets"));
  const relevance = await import("./brand-relevance");
  // A live wish keeps a brand; any wish at all, ruled out or not, stops a permanent delete.
  assert.equal(relevance.SIGNALS.schemeTarget.deleteOnly, undefined);
  assert.match(relevance.SIGNALS.schemeTarget.sql, /FROM brand_scheme_targets WHERE ruled_out_at IS NULL/);
  assert.equal(relevance.SIGNALS.anyWish.deleteOnly, true);
  assert.doesNotMatch(relevance.SIGNALS.anyWish.sql, /ruled_out_at/);
});

// ── The real SQL, in a throwaway schema ──────────────────────────────────
const databaseUrl = process.env.BRAND_PLAN_DATABASE_URL;
const skip = !databaseUrl ? "set BRAND_PLAN_DATABASE_URL to a local PostgreSQL database that holds the app's tables to run the SQL checks"
  : !/@(localhost|127\.0\.0\.1)[:/]|host=%2F|@%2F/.test(databaseUrl) ? "BRAND_PLAN_DATABASE_URL must be a local database" : false;

test("the real queries: every join walks a record to its tenancy row; the Wanted table, its index and its tidy signals work", { skip }, async () => {
  const schema = "brand_plan_" + randomUUID().replaceAll("-", "");
  // Every connection of this pool sees the throwaway schema and nothing else:
  // the pool opens a new connection after any failed statement, so a
  // search_path set by hand would be lost and later statements would reach
  // the real tables.
  const admin = new pg.Client({ connectionString: databaseUrl });
  const db = new pg.Pool({ connectionString: databaseUrl, max: 1, options: `-c search_path=${schema},pg_catalog` });
  const TABLES = ["crm_companies", "crm_properties", "users", "tenancy_schedule_units", "leasing_schedule_units", "available_units", "crm_deals", "unit_offers",
    "unit_offer_rounds", "unit_viewings", "unit_interest", "unit_shares", "unit_briefs", "unit_target_operators", "target_tenants", "landsec_units",
    "landsec_brand_cases", "landsec_deal_clock", "crm_requirements_leasing", "crm_engagement_actions", "user_tasks", "crm_strategy_targets", "marketing_campaigns"];
  try {
    await admin.connect();
    await admin.query(`CREATE SCHEMA ${schema}`);
    // Same columns as the real tables, none of their rows.
    for (const t of TABLES) await admin.query(`CREATE TABLE ${schema}.${t} (LIKE public.${t} INCLUDING DEFAULTS)`);
    await admin.query(`ALTER TABLE ${schema}.crm_companies ADD PRIMARY KEY (id)`);
    assert.deepEqual((await db.query(`SHOW search_path`)).rows, [{ search_path: `${schema},pg_catalog` }]);
    await db.query(readFileSync(new URL("../migrations/0057_brand_scheme_targets.sql", import.meta.url), "utf8"));
    await db.query(readFileSync(new URL("../migrations/0057_brand_scheme_targets.sql", import.meta.url), "utf8"));   // safe to run again

    // Insert with only the columns a fixture needs; anything NOT NULL without a default is filled by type.
    const insert = async (table: string, row: Record<string, any>) => {
      const cols = (await db.query(
        `SELECT column_name, data_type, udt_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 AND is_nullable = 'NO' AND column_default IS NULL`, [schema, table])).rows;
      const full: Record<string, any> = { ...row };
      for (const c of cols) if (!(c.column_name in full)) {
        full[c.column_name] = /int|real|double|numeric/.test(c.data_type) ? 0 : c.data_type === "boolean" ? false : c.data_type === "ARRAY" ? [] : /json/.test(c.data_type) ? "{}" : /timestamp|date/.test(c.data_type) ? "2026-01-01" : `${table}-${c.column_name}`;
      }
      const keys = Object.keys(full);
      await db.query(`INSERT INTO ${table} (${keys.join(", ")}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(", ")})`, keys.map(k => full[k]));
    };
    const B = "b-jm";
    await insert("crm_companies", { id: B, name: "Jersey Mike's Ltd", company_type: "Tenant - Restaurants" });
    await insert("crm_companies", { id: "b-other", name: "Wingstop", company_type: "Tenant - Restaurants" });
    await insert("crm_companies", { id: "b-hidden", name: "Old Brand", company_type: "Tenant - Restaurants", archived_at: "2026-11-01" });
    await insert("crm_properties", { id: "p1", name: "Bluewater Shopping Centre", postcode: "DA9 9ST" });
    await insert("users", { id: "u1", name: "Alex Todd", username: "alex", password: "x" });
    // Six tenancy rows, each reached from a Letting Tracker row by a different join.
    for (const n of [1, 2, 3, 4, 5, 6, 7]) await insert("tenancy_schedule_units", { id: `ts${n}`, property_id: "p1", premises: `Unit ${n}`, nia_sqft: 1000 * n, status: "Vacant" });
    // 1. available_units.tenancy_unit_id
    await insert("available_units", { id: "au1", property_id: "p1", unit_name: "T1", tenancy_unit_id: "ts1" });
    // 2. tenancy_schedule_units.letting_tracker_unit_id
    await insert("available_units", { id: "au2", property_id: "p1", unit_name: "T2" });
    await db.query(`UPDATE tenancy_schedule_units SET letting_tracker_unit_id = 'au2' WHERE id = 'ts2'`);
    // 3. the leasing schedule row both point at
    await insert("leasing_schedule_units", { id: "ls3", property_id: "p1", unit_name: "LS3", tenancy_unit_id: "ts3" });
    await insert("available_units", { id: "au3", property_id: "p1", unit_name: "T3", leasing_schedule_unit_id: "ls3" });
    // 4. the tracker row's deal carries the tenancy unit
    await insert("crm_deals", { id: "d4", name: "Deal 4", property_id: "p1", tenancy_unit_id: "ts4", status: "AVA", deal_type: "New Letting" });
    await insert("available_units", { id: "au4", property_id: "p1", unit_name: "T4", deal_id: "d4" });
    // 5. the tenancy row names the tracker row's deal
    await insert("crm_deals", { id: "d5", name: "Deal 5", property_id: "p1", status: "AVA", deal_type: "New Letting" });
    await insert("available_units", { id: "au5", property_id: "p1", unit_name: "T5", deal_id: "d5" });
    await db.query(`UPDATE tenancy_schedule_units SET deal_id = 'd5' WHERE id = 'ts5'`);
    // 6. the master unit record (property_units) both carry
    await insert("available_units", { id: "au6", property_id: "p1", unit_name: "T6", unit_id: "pu6" });
    await db.query(`UPDATE tenancy_schedule_units SET property_unit_id = 'pu6' WHERE id = 'ts6'`);
    // 8. a tracker row nothing ties to the schedule
    await insert("available_units", { id: "au8", property_id: "p1", unit_name: "Kiosk 8", sqft: 250 });
    for (const n of [1, 2, 3, 4, 5, 6, 8]) await insert("unit_interest", { id: `i${n}`, unit_id: `au${n}`, company_id: B, company_name: "Jersey Mike's", interest_date: "2026-11-01" });
    // Spine evidence for the same six units, so each pair must merge into one line.
    await db.query(`UPDATE tenancy_schedule_units SET target_company_ids = ARRAY['${B}'] WHERE id IN ('ts1','ts2','ts3','ts4','ts5','ts6')`);
    // Unit 7: trading there, plus a name-only match on unit 1's free-text list.
    await db.query(`UPDATE tenancy_schedule_units SET tenant_company_id = '${B}', status = 'Occupied' WHERE id = 'ts7'`);
    await db.query(`UPDATE tenancy_schedule_units SET target_tenants = 'Wingstop; Jersey Mikes' WHERE id = 'ts1'`);
    await insert("unit_shares", { id: "s1", unit_id: "au1", company_id: B, company_name: "Jersey Mike's", mode: "pdf" });
    await insert("unit_offers", { id: "o1", unit_id: "au2", company_id: B, company_name: "Jersey Mike's", offer_date: "2026-11-03", status: "Negotiating" });
    await insert("unit_offer_rounds", { id: "r1", offer_id: "o1", unit_id: "au2", round_no: 1, party: "tenant", round_date: "2026-11-03" });
    await insert("unit_offer_rounds", { id: "r2", offer_id: "o1", unit_id: "au2", round_no: 2, party: "landlord", round_date: "2026-11-06" });
    await insert("unit_viewings", { id: "v1", unit_id: "au3", company_id: B, company_name: "Jersey Mike's", viewing_date: "2026-11-20", status: "scheduled", owner_user_id: "u1" });
    await insert("unit_briefs", { id: "br4", unit_id: "au4", property_id: "p1" });
    await insert("unit_target_operators", { id: "t4", brief_id: "br4", operator_name: "Jersey Mike's", company_id: B, status: "Meeting Held", agent_user_ids: ["u1"] });
    await insert("target_tenants", { id: "tt3", unit_id: "ls3", property_id: "p1", company_id: B, brand_name: "Jersey Mike's", status: "suggested" });
    await insert("landsec_brand_cases", { id: "c1", company_id: B, status: "sent", proposed_units: JSON.stringify([{ id: "x", schemeKey: "bluewater", tenancyUnitId: null, unitLabel: "", status: "Proposed" }]) });
    await insert("crm_requirements_leasing", { id: "rq1", name: "JM", company_id: B, status: "Active", size: ["900-1,200 sq ft"], requirement_locations: ["South East"], sources: ["PIPnet"] });
    await insert("user_tasks", { id: "task1", user_id: "u1", title: "Ring their agent", status: "todo" });
    await insert("crm_engagement_actions", { task_id: "task1", company_id: B });

    const schemes = [{ key: "bluewater", name: "Bluewater", town: "Kent", group: "South", regions: ["South East"], canonicalId: "p1", propertyIds: ["p1"] }];
    const actor = { id: "u1", name: "Alex Todd" };
    assert.deepEqual(Object.keys(await api.createWish(db, schemes, { companyId: B, schemeKey: "bluewater" }, actor)), ["ok", "id"]);
    await assert.rejects(api.createWish(db, schemes, { companyId: B, schemeKey: "bluewater" }, actor), (e: any) => e.status === 409);
    await api.createWish(db, schemes, { companyId: "b-hidden", schemeKey: "bluewater", unitLabel: "The old kiosk" }, actor);
    const ruledOut = await api.createWish(db, schemes, { companyId: "b-other", schemeKey: "bluewater", tenancyUnitId: "ts1" }, actor);
    await api.updateWish(db, schemes, ruledOut.id, { ruledOut: { reason: "Landsec said no" } });

    const plan = (await api.brandPlan(db, B, STAFF, schemes, NOW))!;
    assert.deepEqual(plan.warnings, []);
    const byUnit = new Map(plan.rows.map(r => [r.unit?.key || "none", r]));
    // Six pairs, six lines: none split, each carrying both its tracker record and its schedule record.
    for (const n of [1, 2, 3, 4, 5, 6]) {
      const row = byUnit.get(`ts${n}`);
      assert.ok(row, `unit ${n} has one line on its tenancy row`);
      assert.equal(row!.unit!.splitKey, false);
      assert.equal(row!.unit!.trackerId, `au${n}`);
      assert.ok(row!.evidence.some(e => e.src === "interest") && row!.evidence.some(e => e.src === "target_list"), `unit ${n} merged`);
    }
    assert.equal(plan.rows.filter(r => r.unit).length, 8);
    assert.equal(byUnit.get("au:au8")!.unit!.splitKey, true);
    assert.equal(byUnit.get("au:au8")!.unit!.label, "Kiosk 8");
    assert.deepEqual([1, 2, 3, 4, 5, 6, 7].map(n => byUnit.get(`ts${n}`)!.stage), ["approached", "negotiating", "approached", "approached", "approached", "approached", "trading"]);
    assert.ok(byUnit.get("ts1")!.evidence.some(e => e.src === "share"));
    assert.ok(byUnit.get("ts1")!.evidence.some(e => e.byName && e.label === "Named in a target list, in the tenancy schedule"));
    assert.ok(byUnit.get("ts2")!.evidence.some(e => e.label === "Offer in, landlord countered 6 Nov"));
    assert.deepEqual(byUnit.get("ts3")!.nextStep, { kind: "viewing_booked", title: "Viewing booked", dueAt: "2026-11-20", daysWaiting: null, who: "Alex Todd", refId: "v1" });
    assert.ok(!byUnit.get("ts3")!.evidence.some(e => e.src === "schedule_target"));         // the AI suggestion made no evidence
    assert.deepEqual(byUnit.get("ts4")!.owner, { id: "u1", name: "Alex Todd", source: "target" });
    assert.equal(byUnit.get("ts4")!.links.deal, "/deals/d4");
    assert.equal(byUnit.get("ts1")!.requirement.chip, "fits");                             // 1,000 sq ft in the South East
    assert.equal(byUnit.get("ts6")!.requirement.chip, "place_fits_size_out");
    // The scheme-level line: the Wanted line and the brand case unit together.
    const wanted = byUnit.get("none")!;
    assert.equal(wanted.stage, "wanted");
    assert.deepEqual(wanted.evidence.map(e => e.src).sort(), ["case_unit", "wish"]);
    assert.equal(wanted.wish?.visibleToClient, false);
    assert.equal(plan.brand.nextAction?.title, "Ring their agent");
    assert.equal(plan.brand.headline, "1 scheme: 1 trading, 1 negotiating, 6 approached, 1 wanted");

    // The Landsec view of the same data: the share, the name match and the unticked Wanted line are gone.
    const client = (await api.brandPlan(db, B, LANDSEC_FULL, schemes, NOW))!;
    assert.ok(client.rows.every(r => r.evidence.every(e => e.src !== "share" && e.src !== "name_match" && e.src !== "wish")));
    assert.deepEqual(client.rows.find(r => !r.unit)?.evidence.map(e => e.src), ["case_unit"]);

    // The grid reads by property and lists unhidden tenant brands only.
    const grid = await api.brandGrid(db, STAFF, schemes, null, NOW);
    assert.deepEqual(grid.brands.map(b => [b.name, b.furthest]), [["Jersey Mike's Ltd", "trading"], ["Wingstop", "not_proceeding"]]);   // the hidden brand is not listed
    assert.equal(grid.brands[0].cells.bluewater.count, 9);
    assert.equal(grid.brands[1].cells.bluewater.stage, "not_proceeding");

    // Brand tidy: a live Wanted line keeps a brand; any line at all stops a permanent delete.
    const relevance = await import("./brand-relevance");
    const ids = async (sql: string) => (await db.query(sql)).rows.map((r: any) => r.id).sort();
    assert.deepEqual(await ids(relevance.SIGNALS.schemeTarget.sql), ["b-hidden", B]);
    assert.deepEqual(await ids(relevance.SIGNALS.anyWish.sql), ["b-hidden", B, "b-other"]);
  } finally {
    await db.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => undefined);
    await admin.end().catch(() => undefined);
  }
});
