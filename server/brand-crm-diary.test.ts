// Brand CRM diary: what each kind of login is sent
// (docs/brand-crm-spec-2026-11-12.md, 2.6, with Woody's decision 4: an asset
// manager and a joint agent get a diary for their own schemes).
//
// Runs against a fake database that answers each query by its tag. The brand
// actions come from the CRM plan's own reader, handed in here as staff see them.
//   node --import tsx --test server/brand-crm-diary.test.ts
import test, { before } from "node:test";
import assert from "node:assert/strict";
import { addDiaryDays, diaryBucket, diaryCounts, diaryDay, londonDayOf } from "../shared/brand-diary";
import type { EngagementAction, EngagementData } from "../shared/crm-engagement";

let api: typeof import("./brand-crm-diary");
before(async () => {
  process.env.DATABASE_URL ||= "postgres://test:test@127.0.0.1:1/test";
  api = await import("./brand-crm-diary");
});

const NOW = new Date("2026-11-12T12:00:00Z");      // a Thursday
const LANDSEC = "landsec-co";
const SCHEMES = [
  { key: "bluewater", name: "Bluewater", town: "Kent", group: "South", regions: ["South East"], canonicalId: "p-blue", propertyIds: ["p-blue", "p-blue-2"] },
  { key: "liverpool-one", name: "Liverpool ONE", town: "Liverpool", group: "North", regions: ["North West"], canonicalId: "p-liv", propertyIds: ["p-liv"] },
];
const STAFF = { kind: "staff" as const, clientCompanyId: null, schemes: null, userId: "u-bgp" };
const LANDSEC_FULL = { kind: "landsec" as const, clientCompanyId: LANDSEC, schemes: null, userId: "u-ls" };
// An asset manager is a full Landsec login (Woody, 2026-11-13): the Landsec
// door gives it the "landsec" viewer with no scheme list, whatever schemes
// are stored on the login.
const ASSET_MANAGER = { ...LANDSEC_FULL, userId: "u-am" };
const JOINT_AGENT = { kind: "joint_agent" as const, clientCompanyId: LANDSEC, schemes: new Set(["bluewater"]), userId: "u-ja" };
const SLICE = "(company_type ILIKE ANY(ARRAY['Tenant - Restaurant']))";

type Answers = Record<string, any[] | Error | ((values: any[]) => any[])>;
function fakeDb(answers: Answers) {
  const calls: Array<{ tag: string; sql: string; values: any[] }> = [];
  return {
    calls,
    tags: () => calls.map(c => c.tag),
    async query(sql: string, values: any[] = []) {
      const tag = sql.match(/\/\* brand-diary:([a-z-]+) \*\//)?.[1] || "untagged";
      calls.push({ tag, sql, values });
      const answer = answers[tag];
      if (answer instanceof Error) throw answer;
      return { rows: typeof answer === "function" ? answer(values) : answer || [] };
    },
  };
}

// A brand action as the CRM plan gives it to BGP staff.
const action = (over: Partial<EngagementAction>): EngagementAction => ({
  id: "a-1", title: "Send the Bluewater plans", notes: "BGP's own note", dueAt: "2026-11-16T09:00:00.000Z", status: "todo", canEdit: false,
  ownerId: "u-bgp", ownerName: "Charlotte Roberts", companyId: "b-jm", companyName: "Jersey Mike's", strategyId: "s-1", eventId: null, source: null,
  propertyId: null, schemeName: null, tenancyUnitId: null, unitLabel: null, sharedWithCompanyId: null, sharedWithName: null,
  waitingOnParty: null, waitingSince: null, raisedBy: "bgp", ...over,
});
const ACTIONS: EngagementAction[] = [
  // BGP's own, not shared.
  action({ id: "a-bgp", title: "Chase the franchisee's accountant", waitingOnParty: "Tenant", waitingSince: "2026-11-02T09:00:00.000Z" }),
  // BGP's, shown to Landsec, placed at a Bluewater unit, marked as waiting on Landsec.
  action({ id: "a-shared-blue", title: "Agree the extraction route", propertyId: "p-blue", schemeName: "Bluewater Shopping Centre", tenancyUnitId: "ts-1", unitLabel: "Unit L104",
    sharedWithCompanyId: LANDSEC, sharedWithName: "Landsec", waitingOnParty: "Landsec asset manager", waitingSince: "2026-11-05T09:00:00.000Z", dueAt: "2026-11-10T09:00:00.000Z" }),
  // BGP's, shown to Landsec, placed at Liverpool ONE.
  action({ id: "a-shared-liv", title: "Confirm the Byron unit dates", propertyId: "p-liv", schemeName: "Liverpool ONE", sharedWithCompanyId: LANDSEC, sharedWithName: "Landsec", dueAt: "2026-11-20T09:00:00.000Z" }),
  // BGP's, shown to Landsec, at no scheme.
  action({ id: "a-shared-nowhere", title: "Share the UK store list", sharedWithCompanyId: LANDSEC, sharedWithName: "Landsec", dueAt: "2026-12-10T09:00:00.000Z" }),
  // A Landsec login's own request.
  action({ id: "a-ls", title: "Can BGP introduce the brand to Trinity?", raisedBy: "client", notes: "Landsec's own words", canEdit: false, dueAt: "2026-11-13T09:00:00.000Z" }),
  // Another client's request on the same brand.
  action({ id: "a-hammerson", title: "Hammerson wants them at Bullring", raisedBy: "client", dueAt: "2026-11-14T09:00:00.000Z" }),
  // A Landsec request on a brand outside its list, and one on a hidden brand.
  action({ id: "a-ls-retail", title: "A request on a fashion brand", companyId: "b-retail", companyName: "Fashion Co", raisedBy: "client" }),
  action({ id: "a-ls-hidden", title: "A request on a hidden brand", companyId: "b-hidden", companyName: "Hidden Co", raisedBy: "client" }),
  // Done.
  action({ id: "a-done", title: "Already done", status: "done" }),
];
const engagement = (actions: EngagementAction[] = ACTIONS) => async (): Promise<EngagementData> => ({ strategies: [], events: [], actions });
const AUTHORS = [
  { id: "a-bgp", assigned_by_user_id: "u-bgp", team: "Leasing", role: "Agent" },
  { id: "a-shared-blue", assigned_by_user_id: "u-bgp", team: "Leasing", role: "Agent" },
  { id: "a-ls", assigned_by_user_id: "u-ls-2", team: "Landsec", role: "Client" },
  { id: "a-hammerson", assigned_by_user_id: "u-ham", team: "Hammerson", role: "Client" },
  { id: "a-ls-retail", assigned_by_user_id: "u-ls", team: "Landsec", role: "Client" },
  { id: "a-ls-hidden", assigned_by_user_id: "u-ls", team: "Landsec", role: "Client" },
];
const teamCompany = async (team: string) => (team === "Landsec" ? LANDSEC : team === "Hammerson" ? "hammerson-co" : null);
// The brand list: Jersey Mike's and Wingstop are on it; the fashion brand is not and the hidden brand is hidden.
const slice = (values: any[]) => (values[0] as string[]).filter(id => ["b-jm", "b-wing"].includes(id)).map(id => ({ id }));

const viewing = (over: Record<string, any>) => ({
  id: "v-1", company_id: "b-jm", brand_name: "Jersey Mike's", viewing_date: "2026-11-18", status: "scheduled", follow_up_date: null, next_action: null,
  owner_name: "Alex Todd", tracker_id: "au-1", property_id: "p-blue", property_name: "Bluewater Shopping Centre", tenancy_unit_id: "ts-1", unit_label: "Unit L104", task_status: null, ...over,
});
const clock = (over: Record<string, any>) => ({
  deal_id: "d-1", waiting_on_party: "Landsec asset manager", waiting_on_name: "Jo Bloggs", waiting_since: "2026-11-01T09:00:00Z", status: "HOTs", tenant_id: "b-wing", brand_name: "Wingstop",
  property_id: "p-blue", property_name: "Bluewater Shopping Centre", tenancy_unit_id: "ts-2", unit_label: "Unit U20", owner_name: "Alex Todd", ...over,
});
const agreedBrief = (over: Record<string, any>) => ({
  tenancy_unit_id: "ts-3", property_id: "p-blue", property_name: "Bluewater Shopping Centre", unit_label: "Unit K2", brief_use: "QSR", brief_category: null, brief_ner_floor: 90000,
  brief_incentive_ceiling: null, brief_capex_envelope: null, brief_target_brands: null, brief_signed_leasing_at: "2026-11-03T10:00:00Z", brief_signed_am_at: null, since: "2026-11-03T10:00:00Z", ...over,
});
const BASE: Answers = {
  viewings: [
    viewing({}),
    viewing({ id: "v-liv", property_id: "p-liv", property_name: "Liverpool ONE", tenancy_unit_id: "ts-9", unit_label: "Unit 12" }),
    viewing({ id: "v-follow", viewing_date: "2026-11-04", status: "completed", follow_up_date: "2026-11-11", next_action: "Ring their agent about the rent" }),
  ],
  "deal-clocks": [clock({}), clock({ deal_id: "d-liv", property_id: "p-liv", property_name: "Liverpool ONE", tenancy_unit_id: "ts-8", unit_label: "Unit 4", waiting_on_party: "Tenant's agent", waiting_on_name: "Sam Agent" })],
  "agreed-briefs": [agreedBrief({})],
  "targeting-briefs": [{ id: "tb-1", property_id: "p-blue", property_name: "Bluewater Shopping Centre", tracker_id: "au-5", tenancy_unit_id: "ts-5", unit_label: "Unit M1", since: "2026-11-06T10:00:00Z",
    waiting_names: ["Jo Bloggs", "Pat Leasing"], waiting_roles: ["asset_manager", "client_leasing"] }],
  cases: [{ id: "case-1", company_id: "b-jm", brand_name: "Jersey Mike's", sent_at: "2026-11-09T10:00:00Z" }],
  "case-responses": [{ case_id: "case-1", user_id: "u-am-other" }],
  "asset-managers": [{ user_id: "u-am", name: "Jo Bloggs" }, { user_id: "u-am-other", name: "Kit Other" }],
  "action-authors": AUTHORS,
  slice,
};
const load = (viewer: any, answers: Answers = BASE, actions?: EngagementAction[]) => {
  const db = fakeDb(answers);
  const client = viewer.kind !== "staff";
  return api.loadDiary(db, viewer, SCHEMES, { now: NOW, engagement: engagement(actions), brandSliceSql: client ? SLICE : null, companyIdForClientTeam: teamCompany }).then(diary => ({ diary, db }));
};
const ids = (diary: { items: Array<{ id: string }> }) => diary.items.map(i => i.id).sort();
const byId = (diary: { items: any[] }, id: string) => diary.items.find(i => i.id === id);

test("date helpers: only real dates count, and the buckets run Monday to Sunday", () => {
  assert.equal(diaryDay("2026-11-18"), "2026-11-18");
  assert.equal(diaryDay("2026-11-18T10:30:00Z"), "2026-11-18");
  for (const bad of ["", null, undefined, "tbc", "18/11/2026", "2026-13-40", "2026-02-30", "2026-11-1", "next week"]) assert.equal(diaryDay(bad), null, String(bad));
  assert.equal(londonDayOf("2026-11-12T23:30:00Z"), "2026-11-12");
  assert.equal(londonDayOf("2026-07-01T23:30:00Z"), "2026-07-02");      // British Summer Time
  assert.equal(londonDayOf("not a date"), null);
  assert.equal(addDiaryDays("2026-11-30", 2), "2026-12-02");
  const today = "2026-11-12";                                             // Thursday
  const landsec = { side: "landsec" as const, name: "Landsec asset manager" };
  const at = (date: string | null, waitingOn: typeof landsec | null = null) => ({ date, waitingOn });
  assert.equal(diaryBucket(at(null, landsec), today), "waiting");
  assert.equal(diaryBucket(at(null), today), "later");                    // undated, and nobody is waited on
  assert.equal(diaryBucket(at("2026-11-11", landsec), today), "overdue"); // a date wins over waiting
  assert.equal(diaryBucket(at("2026-11-12"), today), "thisWeek");
  assert.equal(diaryBucket(at("2026-11-15"), today), "thisWeek");         // Sunday
  assert.equal(diaryBucket(at("2026-11-16"), today), "nextWeek");         // Monday
  assert.equal(diaryBucket(at("2026-11-22"), today), "nextWeek");
  assert.equal(diaryBucket(at("2026-11-23"), today), "later");
  assert.deepEqual(diaryCounts([at(null, landsec), at(null), at("2026-11-01"), at("2026-11-13")], today), { overdue: 1, thisWeek: 1, nextWeek: 0, later: 1, waiting: 1 });
});

test("BGP staff get everything: every action with its waiting-on, viewings, deals, both briefs and unanswered brand cases", async () => {
  const { diary, db } = await load(STAFF);
  assert.deepEqual(ids(diary), [
    "brief_signature:agreed:ts-3", "brief_signature:targeting:tb-1", "case_response:case-1",
    "crm_action:a-bgp", "crm_action:a-hammerson", "crm_action:a-ls", "crm_action:a-ls-hidden", "crm_action:a-ls-retail",
    "crm_action:a-shared-blue", "crm_action:a-shared-liv", "crm_action:a-shared-nowhere",
    "deal_waiting:d-1", "deal_waiting:d-liv", "viewing_booked:v-1", "viewing_booked:v-liv", "viewing_followup:v-follow",
  ]);
  assert.equal(diary.canAddAction, true);
  assert.equal(diary.canAddRequest, false);
  assert.equal(diary.today, "2026-11-12");
  // Staff read every property: no property filter, no brand list query.
  assert.equal(db.calls.find(c => c.tag === "viewings")!.values[0], null);
  assert.ok(!db.tags().includes("slice") && !db.tags().includes("action-authors"));

  const shared = byId(diary, "crm_action:a-shared-blue");
  assert.deepEqual(shared.scheme, { key: "bluewater", name: "Bluewater" });
  assert.equal(shared.unitLabel, "Unit L104");
  assert.deepEqual(shared.waitingOn, { side: "landsec", name: "Landsec asset manager" });
  assert.equal(shared.daysWaiting, 7);
  assert.equal(shared.overdue, true);
  assert.equal(shared.url, "/brands?tab=crm&view=strategies&company=b-jm&action=a-shared-blue");
  assert.equal(byId(diary, "crm_action:a-ls").raisedBy, "client");
  assert.deepEqual(byId(diary, "crm_action:a-bgp").waitingOn, { side: "other", name: "Tenant" });

  const follow = byId(diary, "viewing_followup:v-follow");
  assert.equal(follow.title, "Ring their agent about the rent");
  assert.equal(follow.date, "2026-11-11");
  assert.equal(follow.url, "/available?propertyId=p-blue&unitId=au-1");
  const deal = byId(diary, "deal_waiting:d-1");
  assert.deepEqual(deal.waitingOn, { side: "landsec", name: "Landsec asset manager (Jo Bloggs)" });
  assert.equal(deal.date, null);
  assert.equal(deal.daysWaiting, 11);
  assert.equal(deal.url, "/deals/d-1");
  assert.deepEqual(byId(diary, "brief_signature:agreed:ts-3").waitingOn, { side: "landsec", name: "Landsec asset manager" });
  assert.deepEqual(byId(diary, "brief_signature:targeting:tb-1").waitingOn, { side: "landsec", name: "Jo Bloggs, Pat Leasing" });
  // One asset manager has answered the case; the other has not.
  const brandCase = byId(diary, "case_response:case-1");
  assert.equal(brandCase.title, "Brand case awaiting 1 asset manager reply");
  assert.deepEqual(brandCase.waitingOn, { side: "landsec", name: "Jo Bloggs" });
  assert.deepEqual(diary.counts, { overdue: 2, thisWeek: 2, nextWeek: 6, later: 1, waiting: 5 });
});

test("staff tick off only an action they own or raised", async () => {
  const { diary } = await load(STAFF, BASE, [action({ id: "a-mine", canEdit: true }), action({ id: "a-theirs", canEdit: false })]);
  assert.deepEqual([byId(diary, "crm_action:a-mine").canComplete, byId(diary, "crm_action:a-mine").actionId], [true, "a-mine"]);
  assert.deepEqual([byId(diary, "crm_action:a-theirs").canComplete, byId(diary, "crm_action:a-theirs").actionId], [false, null]);
});

test("a full Landsec login: its own company's requests and the shared actions, on its brand list only", async () => {
  const { diary, db } = await load(LANDSEC_FULL);
  const actionIds = ids(diary).filter(id => id.startsWith("crm_action:"));
  // Its colleague's request, and the three BGP chose to show. Never BGP's own, never Hammerson's,
  // and nothing on a brand outside its list or a hidden brand, even one it raised itself.
  assert.deepEqual(actionIds, ["crm_action:a-ls", "crm_action:a-shared-blue", "crm_action:a-shared-liv", "crm_action:a-shared-nowhere"]);
  assert.equal(diary.canAddAction, false);
  assert.equal(diary.canAddRequest, true);

  const shared = byId(diary, "crm_action:a-shared-blue");
  assert.deepEqual(shared.scheme, { key: "bluewater", name: "Bluewater" });
  assert.equal(shared.unitLabel, "Unit L104");
  assert.equal(shared.owner, "Charlotte Roberts");
  assert.equal(shared.raisedBy, "bgp");
  // Who BGP marked it as waiting on stays with BGP, and a client cannot tick BGP's action.
  assert.equal(shared.waitingOn, null);
  assert.equal(shared.daysWaiting, null);
  assert.deepEqual([shared.canComplete, shared.actionId], [false, null]);
  assert.equal(shared.url, "/companies/b-jm");
  assert.equal(byId(diary, "crm_action:a-shared-nowhere").scheme, null);
  const own = byId(diary, "crm_action:a-ls");
  assert.equal(own.raisedBy, "client");
  assert.equal(own.scheme, null);
  // Nothing of BGP's notes anywhere in what is sent.
  assert.doesNotMatch(JSON.stringify(diary), /BGP's own note|Landsec's own words|Chase the franchisee|Hammerson|Fashion Co|Hidden Co|Ring their agent/);

  // Every scheme, both briefs and the case it has not answered itself.
  assert.ok(ids(diary).includes("deal_waiting:d-liv") && ids(diary).includes("viewing_booked:v-liv"));
  assert.ok(ids(diary).includes("brief_signature:agreed:ts-3") && ids(diary).includes("brief_signature:targeting:tb-1"));
  assert.equal(byId(diary, "case_response:case-1").title, "Brand case awaiting your reply");
  assert.equal(byId(diary, "viewing_followup:v-follow").title, "Follow up the viewing");
  assert.equal(byId(diary, "viewing_booked:v-1").url, "/landsec/unit/ts-1");
  assert.equal(byId(diary, "deal_waiting:d-1").url, "/landsec/unit/ts-2");
  // The queries were held to the scheme properties, and the asset manager list is BGP's.
  assert.deepEqual(db.calls.find(c => c.tag === "viewings")!.values[0], ["p-blue", "p-blue-2", "p-liv"]);
  assert.deepEqual(db.calls.find(c => c.tag === "deal-clocks")!.values[0], ["p-blue", "p-blue-2", "p-liv"]);
  assert.ok(!db.tags().includes("asset-managers"));
});

test("BGP staff looking through the Landsec door get what Landsec gets: their own BGP actions are not Landsec's requests", async () => {
  const real = await load(LANDSEC_FULL);
  // u-bgp raised a-bgp (unshared) as BGP staff, then opens the Landsec diary.
  const preview = await load({ ...LANDSEC_FULL, userId: "u-bgp" });
  const actionIds = (d: any) => ids(d).filter(id => id.startsWith("crm_action:"));
  assert.deepEqual(actionIds(preview.diary), actionIds(real.diary));
  assert.ok(!actionIds(preview.diary).includes("crm_action:a-bgp"));
  assert.doesNotMatch(JSON.stringify(preview.diary), /BGP's own note/);
});

test("a Landsec login that raised an action itself may tick it off; one a colleague raised it may not", async () => {
  const mine = action({ id: "a-mine", raisedBy: "client", canEdit: true });
  const colleague = action({ id: "a-colleague", raisedBy: "client", canEdit: false });
  const { diary } = await load(LANDSEC_FULL, { ...BASE, "action-authors": [
    { id: "a-mine", assigned_by_user_id: "u-ls", team: "Landsec", role: "Client" }, { id: "a-colleague", assigned_by_user_id: "u-ls-2", team: "Landsec", role: "Client" },
  ] }, [mine, colleague]);
  assert.deepEqual([byId(diary, "crm_action:a-mine").canComplete, byId(diary, "crm_action:a-mine").actionId], [true, "a-mine"]);
  assert.equal(byId(diary, "crm_action:a-colleague").canComplete, false);
});

test("a viewing or a deal for a brand outside the client's list is left out; a deal with no brand yet stays", async () => {
  const answers: Answers = { ...BASE,
    viewings: [viewing({ id: "v-retail", company_id: "b-retail", brand_name: "Fashion Co" }), viewing({ id: "v-noname", company_id: null, brand_name: "Typed name only" }), viewing({})],
    "deal-clocks": [clock({ deal_id: "d-retail", tenant_id: "b-retail", brand_name: "Fashion Co" }), clock({ deal_id: "d-nobrand", tenant_id: null, brand_name: null }), clock({ deal_id: "d-dead", status: "Withdrawn" })],
    cases: [{ id: "case-retail", company_id: "b-retail", brand_name: "Fashion Co", sent_at: "2026-11-09T10:00:00Z" }], "case-responses": [],
  };
  const client = (await load(LANDSEC_FULL, answers, [])).diary;
  assert.deepEqual(ids(client).filter(id => /^(viewing|deal|case)/.test(id)), ["deal_waiting:d-nobrand", "viewing_booked:v-1"]);
  assert.equal(byId(client, "deal_waiting:d-nobrand").brand, null);
  assert.doesNotMatch(JSON.stringify(client), /Fashion Co|Typed name only/);
  // BGP staff see them all, except the withdrawn deal.
  const staff = (await load(STAFF, answers, [])).diary;
  assert.deepEqual(ids(staff).filter(id => /^(viewing|deal|case)/.test(id)), ["case_response:case-retail", "deal_waiting:d-nobrand", "deal_waiting:d-retail", "viewing_booked:v-1", "viewing_booked:v-noname", "viewing_booked:v-retail"]);
  assert.deepEqual(byId(staff, "viewing_booked:v-noname").brand, { id: null, name: "Typed name only" });
});

test("an asset manager gets the full Landsec diary: every scheme, Add request, and its own brand case reply", async () => {
  const full = await load(LANDSEC_FULL);
  const { diary, db } = await load(ASSET_MANAGER);
  // The same list as the full login; what differs is per person (who raised a request).
  assert.deepEqual(ids(diary), ids(full.diary));
  assert.equal(diary.canAddRequest, true);
  assert.equal(diary.canAddAction, false);
  assert.ok(diary.items.some(i => i.scheme?.key === "liverpool-one"), "not held to the schemes on the login");
  // Every scheme's properties are asked for, and who raised each action is read as for a full login.
  assert.deepEqual(db.calls.find(c => c.tag === "viewings")!.values[0], ["p-blue", "p-blue-2", "p-liv"]);
  assert.ok(db.tags().includes("action-authors"));
  assert.equal(byId(diary, "case_response:case-1").title, "Brand case awaiting your reply");
});

test("a joint agent: deals waiting, viewings and shared actions on own schemes; no briefs, no brand cases, no brand ids, no contact names", async () => {
  const { diary, db } = await load(JOINT_AGENT, BASE, ACTIONS.map(a => ({ ...a, canEdit: true })));
  assert.deepEqual(ids(diary), ["crm_action:a-shared-blue", "deal_waiting:d-1", "viewing_booked:v-1", "viewing_followup:v-follow"]);
  // Briefs and brand cases are not even asked for.
  for (const tag of ["agreed-briefs", "targeting-briefs", "cases", "case-responses", "asset-managers", "action-authors"]) assert.ok(!db.tags().includes(tag), tag);
  assert.ok(diary.items.every(i => !i.brand || i.brand.id === null));
  assert.ok(diary.items.every(i => !i.canComplete && i.actionId === null));
  assert.equal(diary.canAddRequest, false);
  // The person named on the deal clock is dropped; the party stays.
  assert.deepEqual(byId(diary, "deal_waiting:d-1").waitingOn, { side: "landsec", name: "Landsec asset manager" });
  assert.equal(byId(diary, "deal_waiting:d-1").brand.name, "Wingstop");
  // No link to a brand page: a shared action opens the scheme, a viewing the unit page.
  assert.equal(byId(diary, "crm_action:a-shared-blue").url, "/landsec/scheme/bluewater");
  assert.equal(byId(diary, "viewing_booked:v-1").url, "/landsec/unit/ts-1");
  assert.ok(diary.items.every(i => !String(i.url || "").startsWith("/companies") && !String(i.url || "").startsWith("/deals")));
  assert.doesNotMatch(JSON.stringify(diary), /Jo Bloggs|Sam Agent|b-jm|b-wing|BGP's own note|Ring their agent/);
});

test("a client login with no readable brand list is shown no brand at all", async () => {
  const db = fakeDb(BASE);
  const diary = await api.loadDiary(db, LANDSEC_FULL, SCHEMES, { now: NOW, engagement: engagement(), brandSliceSql: null, companyIdForClientTeam: teamCompany });
  assert.deepEqual(ids(diary), ["brief_signature:agreed:ts-3", "brief_signature:targeting:tb-1"]);
  const failed = await load(LANDSEC_FULL, { ...BASE, slice: new Error("boom") });
  assert.deepEqual(ids(failed.diary), ["brief_signature:agreed:ts-3", "brief_signature:targeting:tb-1"]);
  assert.match(failed.diary.warnings.join(" "), /The brand list could not be read/);
});

test("text dates that are not real dates are skipped, never thrown", async () => {
  const { diary } = await load(STAFF, { ...BASE, "deal-clocks": [clock({ waiting_since: "garbage" })], "agreed-briefs": [], "targeting-briefs": [], cases: [],
    viewings: [
      viewing({ id: "v-bad", viewing_date: "TBC" }),
      viewing({ id: "v-bad-2", viewing_date: "2026-13-45" }),
      viewing({ id: "v-uk", viewing_date: "18/11/2026" }),
      viewing({ id: "v-past", viewing_date: "2026-11-01" }),                               // booked, but already gone by
      viewing({ id: "v-bad-follow", viewing_date: "2026-11-01", status: "completed", follow_up_date: "soon" }),
      viewing({ id: "v-old-follow", viewing_date: "2026-08-01", status: "completed", follow_up_date: "2026-09-01" }),   // more than 30 days back
      viewing({ id: "v-ok", viewing_date: "2026-11-19T10:00" }),
    ] }, [action({ id: "a-undated", dueAt: null }), action({ id: "a-bad-date", dueAt: "not a date" })]);
  assert.deepEqual(ids(diary), ["crm_action:a-bad-date", "crm_action:a-undated", "deal_waiting:d-1", "viewing_booked:v-ok"]);
  assert.equal(byId(diary, "viewing_booked:v-ok").date, "2026-11-19");
  assert.equal(byId(diary, "crm_action:a-bad-date").date, null);
  assert.equal(byId(diary, "deal_waiting:d-1").daysWaiting, null);
  assert.equal(diary.warnings.length, 0);
});

test("a viewing follow-up that has a task appears once, and not at all once the task is done", async () => {
  const followUp = (over: Record<string, any>) => viewing({ viewing_date: "2026-11-04", status: "completed", follow_up_date: "2026-11-13", ...over });
  const { diary, db } = await load(STAFF, { ...BASE, "deal-clocks": [], "agreed-briefs": [], "targeting-briefs": [], cases: [],
    viewings: [followUp({ id: "v-task", task_status: "todo" }), followUp({ id: "v-done", task_status: "done" }), followUp({ id: "v-no-task" })] }, []);
  assert.deepEqual(ids(diary), ["viewing_followup:v-no-task", "viewing_followup:v-task"]);
  // The task is read with the viewing, through its viewing_followup: marker.
  assert.match(db.calls.find(c => c.tag === "viewings")!.sql, /source_ref = 'viewing_followup:' \|\| v\.id/);
});

test("the agreed brief: only a drafted brief missing a signature is listed, and it says whose", async () => {
  const { diary } = await load(STAFF, { ...BASE, viewings: [], "deal-clocks": [], "targeting-briefs": [], cases: [],
    "agreed-briefs": [
      agreedBrief({ tenancy_unit_id: "ts-am" }),
      agreedBrief({ tenancy_unit_id: "ts-leasing", brief_signed_leasing_at: null, brief_signed_am_at: "2026-11-03T10:00:00Z" }),
      agreedBrief({ tenancy_unit_id: "ts-none", brief_signed_leasing_at: null }),
      agreedBrief({ tenancy_unit_id: "ts-empty", brief_use: null, brief_ner_floor: null, brief_signed_leasing_at: null }),     // nothing drafted
    ] }, []);
  assert.deepEqual(diary.items.map(i => [i.id, i.waitingOn?.name]).sort(), [
    ["brief_signature:agreed:ts-am", "Landsec asset manager"],
    ["brief_signature:agreed:ts-leasing", "Landsec leasing manager"],
    ["brief_signature:agreed:ts-none", "Landsec leasing manager and asset manager"],
  ]);
});

test("a source that cannot be read costs that source and a warning, not the diary", async () => {
  const missing = Object.assign(new Error('relation "landsec_deal_clock" does not exist'), { code: "42P01" });
  const { diary } = await load(STAFF, { ...BASE, "deal-clocks": missing });
  assert.ok(!ids(diary).some(id => id.startsWith("deal_waiting")));
  assert.ok(ids(diary).includes("viewing_booked:v-1"));
  assert.match(diary.warnings.join(" "), /Deals waiting on someone could not be read/);
  const db = fakeDb(BASE);
  const noActions = await api.loadDiary(db, STAFF, SCHEMES, { now: NOW, engagement: async () => { throw new Error("CRM planning is not ready"); } });
  assert.ok(!ids(noActions).some(id => id.startsWith("crm_action")));
  assert.match(noActions.warnings.join(" "), /CRM actions could not be read/);
});

test("the gateway: a joint agent reaches the Landsec diary and never the staff one, an asset manager is left to the client gateway, and the diary registers no write", async () => {
  const access = await import("./landsec-access");
  const { readFileSync } = await import("node:fs");
  const req = (role: string, method = "GET") => ({ method, _landsecAccessResolved: true, _landsecAccess: { role, schemes: ["bluewater"], firm: null } }) as any;
  for (const role of ["joint_agent"]) {
    assert.equal(await access.restrictedLandsecApiDecision(req(role), "/api/landsec/diary"), "allow", role);
    assert.equal(await access.restrictedLandsecApiDecision(req(role), "/api/brand-crm/diary"), "deny", role);
    // The tick-off and Add request go through the CRM plan's routes, which a joint agent cannot reach.
    assert.equal(await access.restrictedLandsecApiDecision(req(role, "PATCH"), "/api/crm/engagement/actions/abc"), "deny", role);
    assert.equal(await access.restrictedLandsecApiDecision(req(role, "POST"), "/api/crm/engagement/actions"), "deny", role);
  }
  // An asset manager is not decided by the restricted rule: null hands every
  // path to the ordinary client gateway, as for a Landsec login with no role.
  for (const [method, path] of [["GET", "/api/landsec/diary"], ["GET", "/api/brand-crm/diary"], ["PATCH", "/api/crm/engagement/actions/abc"], ["POST", "/api/crm/engagement/actions"]]) {
    assert.equal(await access.restrictedLandsecApiDecision(req("asset_manager", method), path), null, `asset manager ${method} ${path}`);
  }
  const index = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  assert.match(index, /setupBrandCrmDiaryRoutes\(app\);/);
  const source = readFileSync(new URL("./brand-crm-diary.ts", import.meta.url), "utf8");
  assert.deepEqual([...source.matchAll(/app\.(get|post|put|patch|delete|all)\(/g)].map(m => m[1]), ["get", "get"]);
  // The staff door turns a client login away; the Landsec door answers only a Landsec viewer.
  assert.match(source, /if \(!\(await staffDoor\(req, res\)\)\) return;/);
  assert.match(source, /if \(!viewer\) return res\.status\(403\)/);
  // Nothing in the diary writes to the database.
  assert.doesNotMatch(source, /\b(INSERT|UPDATE|DELETE)\b/);
});
