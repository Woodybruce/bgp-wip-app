// ChatBGP's unit and waiting-on tools (server/chatbgp-unit-tools.ts): the
// argument handling, what the model is given, and that the answer is the
// feeds' own, cut for the caller, with nothing BGP keeps to itself in it.
//   node --import tsx --test server/chatbgp-unit-tools.test.ts
import test, { before } from "node:test";
import assert from "node:assert/strict";
import type { PropertyUnit, PropertyUnitsFeed, PropertyUnitDetail } from "@shared/property-units";
import { propertyUnitCounts } from "@shared/property-units";

let tools: typeof import("./chatbgp-unit-tools");
let feedApi: typeof import("./property-units");
before(async () => {
  process.env.DATABASE_URL ||= "postgres://test:test@127.0.0.1:1/test";
  tools = await import("./chatbgp-unit-tools");
  feedApi = await import("./property-units");
});

const FLAGS = { expiryOrBreakSoon: false, vacantNoLetting: false, stuck: false, noAgreedBrief: false, notOnSchedule: false, notOnPlan: false, duplicateOutline: false, noLeaseCompany: false };
function unit(over: Partial<PropertyUnit> & { tenant?: Partial<PropertyUnit["tenant"]> } = {}): PropertyUnit {
  const { tenant, ...rest } = over;
  return {
    id: "row-1", scheduleRowId: "row-1", trackerId: "tracker-1", label: "L057 Bluewater - Lower Level", floor: "Lower Level", grouping: null, use: "Restaurant", scheduleStatus: "Opportunity",
    tenant: { name: "Burger King", tradingName: "Burger King", legalName: "BKUK Flame Limited", companyId: "co-bk", companyName: "Burger King", entityId: null, entityName: null,
      companiesHouseNumber: null, leaseCompany: "none", kyc: { status: "approved", expiresAt: "2027-01-01" }, ...tenant },
    sqft: 3147, passingRent: 264537, erv: 300000, quotingRent: 280000, leaseStart: "2018-12-25", leaseExpiry: "2028-12-24", breakDate: null, landlordBreakDate: null, nextReview: null,
    occupancy: "occupied", stage: "HOT",
    deal: { id: "deal-jm", ref: 4821, name: "Bluewater – L057", type: "New Letting", tenant: "Jersey Mike's", code: "HOT", days: 6, daysConfirmed: true, letting: true },
    brief: "agreed", counts: { viewings: 2, offers: 1, targets: 4 }, outlines: [], flags: { ...FLAGS, noLeaseCompany: true },
    ...rest,
  };
}
const gbk = () => unit({ id: "row-2", scheduleRowId: "row-2", trackerId: null, label: "SVL05 Bluewater - Lower Level", stage: null, deal: null, brief: null,
  tenant: { name: "Gourmet Burger Kitchen", tradingName: "Gourmet Burger Kitchen", legalName: "Gourmet Burger Kitchen (UK) Limited", companyName: "Gourmet Burger Kitchen", leaseCompany: "own_name" as any },
  flags: FLAGS });
function feedOf(units: PropertyUnit[]): PropertyUnitsFeed {
  return { property: { id: "prop-bw", name: "Bluewater Shopping Centre" }, plans: [], units, unplacedDeals: [], counts: propertyUnitCounts(units, []) };
}
// One row of the clock feed, as GET /api/landsec/deals sends it to BGP staff (the fee included).
const clockRow = () => ({
  id: "deal-jm", ref: 4821, name: "Bluewater – L057", dealType: "New Letting", tenant: "Jersey Mike's", jointAgent: null,
  scheme: { key: "bluewater", name: "Bluewater" }, propertyId: "prop-bw", unitId: "row-1", unit: "L057 Bluewater - Lower Level", trackerId: "tracker-1",
  code: "HOT", since: "2026-11-09T10:00:00.000Z", days: 6, stageConfirmed: true, stageSet: null, waitingDays: 3,
  clock: { waitingOnParty: "Landsec leasing manager", waitingOnName: "Mark Warne", waitingSince: "2026-11-12T09:00:00.000Z", waitingNote: null,
    dependsOnDealId: null, dependsOn: null, dependsOnHidden: false, updatedAt: null, updatedByName: null,
    checklistItemId: "item-1", checklistItemLabel: "Covenant and credit risk review of the tenant", derived: false },
  ner: { nerPa: 251000 }, incentivesRecorded: true, briefCheck: "pass", brief: "agreed", fee: 55555,
});
const options = () => ({
  trackerUnitId: "tracker-1", started: true, canStart: false, canLink: true, stage: "negotiating" as const, people: [{ key: "user:1", userId: "1", briefPersonId: null, name: "Mark Warne", email: "someone@example.com", side: "client" as const, role: null, hasLogin: true, party: null }],
  items: [
    { id: "item-1", stage: "negotiating" as const, label: "Covenant and credit risk review of the tenant", required: true, person: { key: "user:1", name: "Mark Warne", side: "client" as const }, party: "Landsec leasing manager" as const, viaDeal: false },
    { id: "item-2", stage: "negotiating" as const, label: "Heads of Terms signed off", required: true, person: { key: "user:2", name: "Rupert Bentley-Smith", side: "bgp" as const }, party: null, viaDeal: true },
    { id: "item-3", stage: "under_offer" as const, label: "Solicitors instructed", required: true, person: null, party: null, viaDeal: false },
  ],
});

// Fake feeds: what the real ones would answer, with a record of what was asked.
function deps(over: Record<string, any> = {}) {
  const calls: string[] = [];
  const staffFeed = feedOf([unit(), gbk()]);
  const d: any = {
    calls,
    db: { query: async (sql: string) => { calls.push("db"); return { rows: /FROM crm_deals/.test(sql) ? [{ id: "deal-other", property_id: "prop-other" }] : [{ id: "prop-bw", name: "Bluewater Shopping Centre" }, { id: "prop-other", name: "Bluewater Retail Park (another landlord)" }] }; } },
    propertyReadBlocked: async (_req: any, id: string) => { calls.push(`blocked?${id}`); return id !== "prop-bw"; },
    unitViewerFor: async () => ({ staff: false, jointAgent: false }),
    loadPropertyUnits: async (_db: any, id: string) => { calls.push(`units:${id}`); return id === "prop-bw" ? staffFeed : feedOf([unit({ id: "x", tenant: { name: "Secret Tenant" } })]); },
    loadPropertyUnitDetail: async (_db: any, _p: string, id: string, viewer: any): Promise<PropertyUnitDetail> => ({
      unit: unit({ id }), schedule: null,
      tracker: { id: "tracker-1", quotingRent: 280000, rentOnApplication: false, leaseTerms: "15 years", availableDate: null, marketingStartDate: null, onWebsite: true,
        viewings: [{ id: "v1", company: "Jersey Mike's", contact: viewer.staff ? "Brand Contact" : null, date: "2026-10-20", outcome: "Offer Expected", status: "Completed" }],
        offers: [{ id: "o1", company: "Jersey Mike's", date: "2026-11-01", rentPa: 270000, rentFreeMonths: 6, termYears: 15, status: "Agreed" }] },
      brief: { id: "b1", title: "L057", agreed: true, targets: [{ id: "t1", name: "Jersey Mike's", companyId: "co-jm", status: "Offer", priority: "A" }] },
      deals: [], outlines: [],
    }),
    unitsForViewer: (feed: any, viewer: any) => { calls.push(`cut:${viewer.staff ? "staff" : "client"}`); return feedApi.unitsForViewer(feed, viewer); },
    landsecDealsFeed: async () => ({ deals: [clockRow()], parties: {} }),
    waitingOptionsForDeal: async (_req: any, dealId: string) => { calls.push(`options:${dealId}`); return options(); },
    ...over,
  };
  return d;
}

test("arguments: defaults, limits and the names the model may use", () => {
  assert.deepEqual(tools.unitToolArgs(null), { property: "", search: "", filter: "all", limit: 25 });
  assert.deepEqual(tools.unitToolArgs({ propertyName: " Bluewater ", tenant: "Burger King", filter: "nolease", limit: 900 }), { property: "Bluewater", search: "Burger King", filter: "all", limit: 60 });
  assert.equal(tools.unitToolArgs({ property: "x", limit: -4 }).limit, 1);
  assert.equal(tools.unitToolArgs({ property: "x", filter: "vacant" }).filter, "vacant");
  assert.deepEqual(tools.waitingToolArgs({ dealRef: "#4821", limit: 99 }), { dealRef: "4821", dealId: "", property: "", search: "", waitingOn: "", limit: 25 });
  assert.equal(tools.waitingToolArgs(["x"]).limit, 10);
});

test("a search finds the unit by its tenant, brand, label or deal, whatever filler is round it", () => {
  assert.equal(tools.unitMatches(unit(), "Burger King"), true);
  assert.equal(tools.unitMatches(unit(), "the Burger King unit"), true);
  assert.equal(tools.unitMatches(unit(), "l057"), true);
  assert.equal(tools.unitMatches(unit(), "BKUK Flame"), true);
  assert.equal(tools.unitMatches(unit(), "Jersey Mike's"), true, "the incoming tenant on the unit's deal");
  assert.equal(tools.unitMatches(gbk(), "Burger King"), false, "Gourmet Burger Kitchen is not Burger King");
  assert.equal(tools.unitMatches(gbk(), ""), true);
  assert.deepEqual(tools.searchWords("The Burger-King unit"), ["burger", "king"]);
});

test("a unit's line carries what the question needs and nothing the feed did not send", () => {
  const line: any = tools.unitLine(unit());
  assert.equal(line.unit, "L057 Bluewater - Lower Level");
  assert.equal(line.tenant, "Burger King");
  assert.equal(line.leaseName, "BKUK Flame Limited");
  assert.equal(line.sqft, 3147);
  assert.equal(line.passingRentPa, 264537);
  assert.equal(line.leaseExpiry, "2028-12-24");
  assert.equal(line.occupancy, "Occupied");
  assert.equal(line.lettingStage, "HOTs");
  assert.equal(line.brief, "Agreed");
  assert.deepEqual(line.deal, { dealId: "deal-jm", ref: 4821, name: "Bluewater – L057", type: "New Letting", tenant: "Jersey Mike's", stage: "HOTs", daysAtStage: 6, daysAtStageConfirmed: true });
  assert.equal("tenantBreak" in line, false, "a date not held is left out, not sent as null");
  const allowed = new Set(["unitId", "trackerUnitId", "unit", "floor", "grouping", "use", "occupancy", "tenant", "brand", "leaseName", "companyOnLease", "companiesHouseNumber", "sqft",
    "passingRentPa", "quotingRentPa", "leaseStart", "leaseExpiry", "tenantBreak", "landlordBreak", "nextReview", "lettingStage", "deal", "brief", "viewings", "offers", "targets", "flags"]);
  for (const key of Object.keys(line)) assert.ok(allowed.has(key), `unexpected field ${key}`);
});

test("BGP's work list on a unit reaches staff and never a client: the feed's own cut decides", () => {
  const staff = JSON.stringify(tools.unitLine(feedApi.unitsForViewer(feedOf([unit()]), { staff: true }).units[0]));
  const client = JSON.stringify(tools.unitLine(feedApi.unitsForViewer(feedOf([unit()]), { staff: false }).units[0]));
  assert.match(staff, /No company on the lease recorded/);
  assert.doesNotMatch(client, /No company on the lease/);
  for (const text of [staff, client]) assert.doesNotMatch(text, /leaseCompany|kyc|approved|"erv"|300000/);
});

test("the unit panel's detail: a brand's contact at a viewing is on it only when the feed sent one", async () => {
  const d = deps();
  const forClient: any = tools.unitDetailLines(await d.loadPropertyUnitDetail(null, "prop-bw", "row-1", { staff: false }));
  const forStaff: any = tools.unitDetailLines(await d.loadPropertyUnitDetail(null, "prop-bw", "row-1", { staff: true }));
  assert.equal("contact" in forClient.marketing.viewings[0], false);
  assert.equal(forStaff.marketing.viewings[0].contact, "Brand Contact");
  assert.deepEqual(forClient.targetingBrief.targets, [{ name: "Jersey Mike's", status: "Offer", priority: "A" }], "no brand id, no notes");
  assert.equal(forClient.marketing.offers[0].status, "Agreed");
});

test("a deal's clock: stage, days, who and since when, the checklist item, and never the fee", () => {
  const line: any = tools.waitingLine(clockRow(), options());
  assert.equal(line.stage, "HOTs");
  assert.equal(line.daysAtStage, 6);
  assert.equal(line.incomingTenant, "Jersey Mike's");
  assert.deepEqual(line.waitingOn, { person: "Mark Warne", party: "Landsec leasing manager", since: "2026-11-12", days: 3,
    checklistItem: "Covenant and credit risk review of the tenant", source: "Set on the deal" });
  assert.equal(line.checklist.stage, "Negotiating (covers Negotiating, HOTs)");
  assert.equal(line.checklist.openItemCount, 3);
  assert.deepEqual(line.checklist.nextOpenItems.map((i: any) => i.responsible), ["Mark Warne", "Rupert Bentley-Smith (responsible for the letting)", "Nobody yet"]);
  const text = JSON.stringify(line);
  assert.doesNotMatch(text, /fee|55555|ner|251000|someone@example\.com|canLink/);

  const derived: any = tools.waitingLine({ ...clockRow(), clock: { ...clockRow().clock, derived: true, dependsOnHidden: true } });
  assert.match(derived.waitingOn.source, /next open item on the deal checklist/);
  assert.equal(derived.dependsOn, "Another transaction");
  const nobody: any = tools.waitingLine({ ...clockRow(), clock: null, waitingDays: null });
  assert.equal("waitingOn" in nobody, false);
  assert.match(nobody.waitingOnNote, /Nobody is named/);
  assert.deepEqual(tools.checklistLines({ ...options(), started: false, items: [] }), { started: false, note: "No transaction checklist has been started for this letting." });
});

test("units tool: only a property the caller may open is read, and it is cut for the caller", async () => {
  const d = deps();
  const { data } = await tools.runUnitTool("get_property_units", { property: "Bluewater", search: "Burger King" }, {} as any, d);
  assert.equal(data.found, true);
  assert.equal(data.properties.length, 1, "the other landlord's Bluewater is not there");
  assert.equal(data.properties[0].property, "Bluewater Shopping Centre");
  assert.equal(data.properties[0].matched, 1);
  const [line] = data.properties[0].units;
  assert.equal(line.tenant, "Burger King");
  assert.equal(line.dealWaitingOn.waitingOn.person, "Mark Warne");
  assert.equal(line.marketing.offers.length, 1);
  assert.ok(d.calls.includes("blocked?prop-other") && !d.calls.includes("units:prop-other"), "a blocked property's units are never loaded");
  assert.ok(d.calls.includes("cut:client"));
  const text = JSON.stringify(data);
  assert.doesNotMatch(text, /another landlord|Secret Tenant|No company on the lease|fee|55555|Brand Contact|co-jm/);
});

test("units tool: nothing open to the caller reads the same as no such property", async () => {
  const d = deps({ propertyReadBlocked: async () => true });
  const blocked = await tools.runUnitTool("get_property_units", { property: "Bluewater" }, {} as any, d);
  const missing = await tools.runUnitTool("get_property_units", { property: "Nowhere" }, {} as any, deps({ db: { query: async () => ({ rows: [] }) } }));
  assert.deepEqual(blocked.data, missing.data);
  assert.equal(blocked.data.found, false);
  assert.equal(d.calls.some((c: string) => c.startsWith("units:")), false);
  assert.match((await tools.runUnitTool("get_property_units", {}, {} as any, d)).data.error, /which property/);
});

test("waiting-on tool: 'the Burger King unit at Bluewater' finds the letting running on that unit", async () => {
  const d = deps();
  const { data } = await tools.runUnitTool("get_deal_waiting_on", { property: "Bluewater", search: "Burger King" }, {} as any, d);
  assert.equal(data.found, true);
  assert.equal(data.deals.length, 1);
  assert.equal(data.deals[0].ref, 4821);
  assert.equal(data.deals[0].waitingOn.checklistItem, "Covenant and credit risk review of the tenant");
  assert.equal(data.deals[0].checklist.nextOpenItems.length, 3);
  assert.ok(d.calls.includes("options:deal-jm"));
  // The unit beside the deal: who is in it now, its lease and the offers on it.
  assert.equal(data.deals[0].unitNow.tenant, "Burger King");
  assert.equal(data.deals[0].unitNow.leaseExpiry, "2028-12-24");
  assert.equal(data.deals[0].unitNow.marketing.offers[0].company, "Jersey Mike's");
  assert.equal("deal" in data.deals[0].unitNow, false);
  assert.doesNotMatch(JSON.stringify(data), /fee|55555|No company on the lease|Brand Contact|co-jm/);
  // A unit with no live deal is said to be waiting on no one.
  const none = await tools.runUnitTool("get_deal_waiting_on", { property: "Bluewater", search: "Gourmet Burger Kitchen" }, {} as any, deps());
  assert.equal(none.data.found, false);
  assert.match(none.data.message, /No live transaction on: SVL05/);
});

test("waiting-on tool: by Ref, by who it waits on, and a deal the caller may not open is not found", async () => {
  const byRef = await tools.runUnitTool("get_deal_waiting_on", { dealRef: "#4821" }, {} as any, deps());
  assert.equal(byRef.data.deals[0].dealId, "deal-jm");
  const onMark = await tools.runUnitTool("get_deal_waiting_on", { waitingOn: "mark warne" }, {} as any, deps());
  assert.equal(onMark.data.matched, 1);
  const onTenant = await tools.runUnitTool("get_deal_waiting_on", { waitingOn: "Tenant's agent" }, {} as any, deps());
  assert.equal(onTenant.data.found, false);
  // Ref 9999 is on a property this caller is refused: its units are never loaded.
  const d = deps();
  const refused = await tools.runUnitTool("get_deal_waiting_on", { dealRef: "9999" }, {} as any, d);
  assert.deepEqual(refused.data, { found: false, message: "No live transaction with that reference is open to this account." });
  assert.equal(d.calls.includes("units:prop-other"), false);
  // No Landsec view (another client) and no property named: it asks, it does not guess.
  const noClock = await tools.runUnitTool("get_deal_waiting_on", { search: "Burger King" }, {} as any, deps({ landsecDealsFeed: async () => null }));
  assert.match(noClock.data.message, /which property/);
});

test("a failed read is one plain line, never a stack or a half answer", async () => {
  const d = deps({ landsecDealsFeed: async () => { throw new Error("role could not be read"); } });
  const { data } = await tools.runUnitTool("get_deal_waiting_on", { dealRef: "4821" }, {} as any, d);
  assert.deepEqual(data, { error: "That could not be read just now. Nothing was changed." });
});
