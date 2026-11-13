import test from "node:test";
import assert from "node:assert/strict";
import {
  namedTenant, nextLeaseEvent, propertyUnitCounts, unitFlags, unitMatchesFilter, unitOccupancy, unitStage, unitStateKey, unitStateLabel,
  UNIT_STATE_HEX, UNIT_STATE_ORDER, type PropertyUnit,
} from "./property-units";

const TODAY = "2026-11-13";

function unit(over: Partial<PropertyUnit> = {}): PropertyUnit {
  const base: PropertyUnit = {
    id: "row-1", scheduleRowId: "row-1", trackerId: null, label: "U036", floor: "Upper Level", grouping: null, use: "Restaurant", scheduleStatus: "Occupied",
    tenant: { name: "Nando's", tradingName: "Nando's", legalName: "Nando's Chickenland Limited", companyId: "co-1", companyName: "Nando's" },
    sqft: 3200, passingRent: 180000, erv: 200000, quotingRent: null,
    leaseStart: "2018-03-25", leaseExpiry: "2033-03-24", breakDate: null, landlordBreakDate: null, nextReview: "2028-03-25",
    occupancy: "occupied", stage: null, deal: null, brief: null, counts: { viewings: 0, offers: 0, targets: 0 }, outlines: [],
    flags: { expiryOrBreakSoon: false, vacantNoLetting: false, stuck: false, noAgreedBrief: false, notOnSchedule: false, notOnPlan: false, duplicateOutline: false },
  };
  const merged = { ...base, ...over };
  return { ...merged, flags: unitFlags(merged, { today: TODAY, propertyHasPlans: true }) };
}

test("occupancy reads the schedule's known words, live Bluewater spellings included", () => {
  for (const status of ["Occupied", "Let", "Trading", "Not Vacant", "Holding Over", "TAW", "Lease Event"]) assert.equal(unitOccupancy({ status }), "occupied", status);
  for (const status of ["Vacant", "Void", "Available", "AVA", "Marketing", "Held", "In Negotiation", "Under Offer", " vacant "]) assert.equal(unitOccupancy({ status }), "vacant", status);
});

test("a word that says neither falls to the tenant and the rent, and missing data stays unknown", () => {
  assert.equal(unitOccupancy({ status: "Opportunity", tenant_name: "Gravity Rocks" }), "occupied");
  assert.equal(unitOccupancy({ status: "Opportunity", passing_rent_pa: 55000 }), "occupied");
  assert.equal(unitOccupancy({ status: "Opportunity" }), "unknown");
  assert.equal(unitOccupancy({ status: null, tenant_name: "VACANT" }), "unknown");
  assert.equal(unitOccupancy({ status: "", trading_name: "Zara" }), "occupied");
  assert.equal(unitOccupancy({}), "unknown");
});

test("the backfilled occupancy column is only a fallback for a status that says nothing", () => {
  assert.equal(unitOccupancy({ status: "Vacant", occupancy_status: "Trading" }), "vacant");
  assert.equal(unitOccupancy({ status: "Opportunity", occupancy_status: "Vacant" }), "vacant");
  assert.equal(unitOccupancy({ status: null, occupancy_status: "Trading" }), "occupied");
});

test("a placeholder is not a tenant", () => {
  assert.equal(namedTenant("", "VACANT", "-", "Wagamama"), "Wagamama");
  assert.equal(namedTenant(null, " TBC "), null);
});

test("the stage comes from the tracker row and its deal, never from the schedule's word", () => {
  assert.equal(unitStage({ hasTracker: true, trackerStatus: "AVA" }), "AVA");
  assert.equal(unitStage({ hasTracker: true, trackerStatus: "AVA", dealStatus: "SOL" }), "SOL", "the deal's status wins");
  assert.equal(unitStage({ hasTracker: true, trackerStatus: "Under Offer" }), "SOL", "legacy spellings read as codes");
  assert.equal(unitStage({ hasTracker: true, trackerStatus: "AVA", dealStatus: "COM" }), null, "a completed letting is not live");
  assert.equal(unitStage({ hasTracker: true, trackerStatus: "WIT" }), null);
  assert.equal(unitStage({}), null);
});

test("with no tracker row only a live letting deal gives a stage; advisory deals never do", () => {
  assert.equal(unitStage({ dealStatus: "NEG", dealType: "New Letting" }), "NEG");
  assert.equal(unitStage({ dealStatus: "HOT", dealType: "Licence" }), "HOT");
  assert.equal(unitStage({ dealStatus: "NEG", dealType: "Rent Review" }), null);
  assert.equal(unitStage({ dealStatus: "SOL", dealType: "Lease Renewal" }), null);
  assert.equal(unitStage({ dealStatus: "NEG", dealType: null }), null);
  assert.equal(unitStage({ dealStatus: "INV", dealType: "New Letting" }), null);
});

test("one state per unit: the live stage, else the occupancy, in the tracker's words", () => {
  assert.equal(unitStateKey({ stage: "HOT", occupancy: "vacant" }), "HOT");
  assert.equal(unitStateKey({ stage: null, occupancy: "vacant" }), "vacant");
  assert.deepEqual(UNIT_STATE_ORDER.map(unitStateLabel), ["Vacant", "Opportunity", "Marketing", "Negotiating", "HOTs", "Solicitors", "Occupied", "Not recorded"]);
  for (const key of UNIT_STATE_ORDER) assert.match(UNIT_STATE_HEX[key], /^#[0-9a-f]{6}$/);
});

test("expiry or break inside 12 months, as the Units and lettings pill counted it", () => {
  assert.equal(unit({ leaseExpiry: "2027-06-30" }).flags.expiryOrBreakSoon, true);
  assert.equal(unit({ leaseExpiry: "2026-09-29" }).flags.expiryOrBreakSoon, true, "a passed expiry still needs dealing with");
  assert.equal(unit({ leaseExpiry: "2027-11-13" }).flags.expiryOrBreakSoon, false, "exactly 12 months out is not inside 12 months");
  assert.equal(unit({ leaseExpiry: "2033-03-24", breakDate: "2027-03-25" }).flags.expiryOrBreakSoon, true);
  assert.equal(unit({ leaseExpiry: "2033-03-24", breakDate: "2024-03-25" }).flags.expiryOrBreakSoon, false, "a break that has passed is no longer an event");
  assert.equal(unit({ leaseExpiry: "2033-03-24", landlordBreakDate: "2027-01-01" }).flags.expiryOrBreakSoon, true);
  assert.equal(unit({ occupancy: "vacant", leaseExpiry: "2026-12-01" }).flags.expiryOrBreakSoon, false, "a vacant unit has no lease event");
  assert.equal(unit({ leaseExpiry: null }).flags.expiryOrBreakSoon, false);
});

test("vacant with nothing live, stuck deals and missing briefs are flagged", () => {
  assert.equal(unit({ occupancy: "vacant" }).flags.vacantNoLetting, true);
  assert.equal(unit({ occupancy: "vacant", stage: "AVA" }).flags.vacantNoLetting, false);
  const deal = (days: number | null) => ({ id: "d", ref: 12, name: "x", type: "New Letting", tenant: null, code: "SOL" as const, days, daysConfirmed: true, letting: true });
  assert.equal(unit({ stage: "SOL", deal: deal(30) }).flags.stuck, true);
  assert.equal(unit({ stage: "SOL", deal: deal(29) }).flags.stuck, false);
  assert.equal(unit({ stage: "SOL", deal: deal(null) }).flags.stuck, false);
  assert.equal(unit({ stage: "AVA", deal: { ...deal(200), code: "AVA" } }).flags.stuck, false, "Marketing is a void, not a stuck deal");
  assert.equal(unit({ occupancy: "vacant", brief: "drafted" }).flags.noAgreedBrief, true);
  assert.equal(unit({ occupancy: "vacant", brief: "agreed" }).flags.noAgreedBrief, false);
  assert.equal(unit({ occupancy: "occupied", stage: "NEG", brief: null }).flags.noAgreedBrief, true);
  assert.equal(unit({ occupancy: "occupied" }).flags.noAgreedBrief, false, "a let unit with nothing live needs no brief");
});

test("plan and schedule coverage flags", () => {
  assert.equal(unit().flags.notOnPlan, true);
  assert.equal(unit({ outlines: [{ planId: "p1", outlineId: "o1" }] }).flags.notOnPlan, false);
  const noPlans = unit();
  assert.equal(unitFlags(noPlans, { today: TODAY, propertyHasPlans: false }).notOnPlan, false, "no plan loaded means nothing is missing from it");
  assert.equal(unit({ outlines: [{ planId: "p1", outlineId: "o1" }, { planId: "p2", outlineId: "o2" }] }).flags.duplicateOutline, false, "one outline on each of two floors is a two-level unit");
  assert.equal(unit({ outlines: [{ planId: "p1", outlineId: "o1" }, { planId: "p1", outlineId: "o2" }] }).flags.duplicateOutline, true);
  const trackerOnly = unit({ id: "tracker:au-1", scheduleRowId: null, trackerId: "au-1" });
  assert.equal(trackerOnly.flags.notOnSchedule, true);
  assert.equal(trackerOnly.flags.notOnPlan, false, "only a schedule row can be drawn, so a tracker-only unit is not on schedule, not not on plan");
});

test("the next lease event is the first dated one on or after today", () => {
  assert.deepEqual(nextLeaseEvent(unit({ leaseExpiry: "2033-03-24", breakDate: "2027-03-25", nextReview: "2026-12-25" }), TODAY), { kind: "review", date: "2026-12-25" });
  assert.deepEqual(nextLeaseEvent(unit({ leaseExpiry: "2026-11-13", nextReview: null }), TODAY), { kind: "expiry", date: "2026-11-13" });
  assert.equal(nextLeaseEvent(unit({ leaseExpiry: "2020-01-01", nextReview: null }), TODAY), null);
});

test("counts and filters agree with each other", () => {
  const units = [
    unit({ id: "a" }),
    unit({ id: "b", occupancy: "vacant", stage: "AVA", outlines: [{ planId: "p1", outlineId: "o1" }] }),
    unit({ id: "c", occupancy: "vacant" }),
    unit({ id: "d", leaseExpiry: "2027-01-01", stage: "NEG" }),
    unit({ id: "tracker:e", scheduleRowId: null, trackerId: "e", occupancy: "vacant", stage: "SOL" }),
    unit({ id: "f", occupancy: "unknown" }),
  ];
  const plans = [{ id: "p1", floor: "Upper Level", outlines: 3, unlinkedOutlines: 2, proposals: 10 }, { id: "p2", floor: "Lower Level", outlines: 0, unlinkedOutlines: 0, proposals: 4 }];
  const counts = propertyUnitCounts(units, plans);
  assert.equal(counts.units, 6);
  assert.deepEqual([counts.occupied, counts.vacant, counts.unknown], [2, 3, 1]);
  assert.equal(counts.liveLettings, 3);
  assert.deepEqual(counts.stages, { OPP: 0, AVA: 1, NEG: 1, HOT: 0, SOL: 1 });
  assert.equal(counts.onPlan, 1);
  assert.equal(counts.notOnPlan, 4);
  assert.equal(counts.notOnSchedule, 1);
  assert.equal(counts.unlinkedOutlines, 2);
  assert.equal(counts.proposals, 14);
  assert.equal(units.filter(u => unitMatchesFilter(u, "vacant")).length, counts.vacant);
  assert.equal(units.filter(u => unitMatchesFilter(u, "live")).length, counts.liveLettings);
  assert.equal(units.filter(u => unitMatchesFilter(u, "expiring")).length, counts.expiryOrBreakSoon);
  assert.equal(units.filter(u => unitMatchesFilter(u, "nobrief")).length, counts.noAgreedBrief);
  assert.equal(units.filter(u => unitMatchesFilter(u, "notonplan")).length, counts.notOnPlan);
  assert.equal(units.filter(u => unitMatchesFilter(u, "all")).length, 6);
});
