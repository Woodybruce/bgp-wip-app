import test from "node:test";
import assert from "node:assert/strict";
import {
  BRAND_STAGES, BRAND_STAGE_LABELS, NOT_PROCEEDING_REASONS, askedNoTarget, brandStageRank, conceptStatusForSave, furthestStage, isOnHold,
  placeFits, planHeadline, readEvidence, requirementChip, resolveStage, type ChipPlace, type StageEvidence,
} from "./brand-stage";

const stageOf = (evidence: StageEvidence[], ctx?: Parameters<typeof resolveStage>[1]) => resolveStage(evidence, ctx)?.stage ?? null;
const BRAND = "brand-1";

test("the full stage set, in Woody's words", () => {
  assert.deepEqual(BRAND_STAGES.map(s => BRAND_STAGE_LABELS[s]),
    ["Wanted", "Unit identified", "Approached", "Viewed", "Negotiating", "HOTs", "Solicitors", "Let", "Trading", "Not proceeding", "Disposing"]);
  assert.equal(brandStageRank("wanted"), 1);
  assert.equal(brandStageRank("trading"), 9);
  assert.equal(brandStageRank("not_proceeding"), 0);
  assert.equal(brandStageRank("disposing"), 0);
});

test("each kind of record maps to its stage", () => {
  const cases: Array<[StageEvidence, string]> = [
    [{ src: "wish", hasUnit: false }, "wanted"],
    [{ src: "case_unit", status: "Proposed", hasUnit: false }, "wanted"],
    [{ src: "case_unit", status: "Agreed", hasUnit: false }, "wanted"],
    [{ src: "wish", hasUnit: true }, "unit_identified"],
    [{ src: "case_unit", status: "Proposed", hasUnit: true }, "unit_identified"],
    [{ src: "tracker_target", status: "Identified" }, "unit_identified"],
    [{ src: "target_list" }, "unit_identified"],
    [{ src: "schedule_target", status: "approved" }, "unit_identified"],
    [{ src: "schedule_target", status: "converted" }, "unit_identified"],
    [{ src: "name_match", byName: true }, "unit_identified"],
    [{ src: "tracker_target", status: "Approached" }, "approached"],
    [{ src: "tracker_target", status: "Meeting Held" }, "approached"],
    [{ src: "interest" }, "approached"],
    [{ src: "share", status: "pdf" }, "approached"],
    [{ src: "viewing", status: "scheduled" }, "approached"],
    [{ src: "deal", status: "OPP", dealType: "New Letting" }, "approached"],
    [{ src: "deal", status: "AVA", dealType: "New Letting" }, "approached"],
    [{ src: "viewing", status: "completed" }, "viewed"],
    [{ src: "tracker_target", status: "Inspection Done" }, "viewed"],
    [{ src: "offer", status: "Pending" }, "negotiating"],
    [{ src: "offer", status: null }, "negotiating"],
    [{ src: "offer", status: "Negotiating" }, "negotiating"],
    [{ src: "offer", status: "Agreed" }, "negotiating"],
    [{ src: "offer", status: "Accepted" }, "negotiating"],
    [{ src: "tracker_target", status: "Offer" }, "negotiating"],
    [{ src: "tracker_target", status: "Negotiating" }, "negotiating"],
    [{ src: "deal", status: "NEG", dealType: "New Letting" }, "negotiating"],
    [{ src: "deal", status: "HOT", dealType: "New Letting" }, "hots"],
    [{ src: "hots", status: "issued" }, "hots"],
    [{ src: "tracker_target", status: "Heads of Terms" }, "hots"],
    [{ src: "deal", status: "SOL", dealType: "New Letting" }, "solicitors"],
    [{ src: "tracker_target", status: "In Sols" }, "solicitors"],
    [{ src: "deal", status: "EXC", dealType: "New Letting" }, "let"],
    [{ src: "deal", status: "COM", dealType: "Temp Lease" }, "let"],
    [{ src: "deal", status: "INV", dealType: "Licence" }, "let"],
    [{ src: "tracker_target", status: "Let" }, "let"],
    [{ src: "schedule_target", status: "approved", outcome: "signed" }, "let"],
    [{ src: "trading", status: "Occupied" }, "trading"],
  ];
  for (const [evidence, stage] of cases) assert.equal(stageOf([evidence]), stage, JSON.stringify(evidence));
});

test("deal statuses are read through the legacy spellings", () => {
  assert.equal(stageOf([{ src: "deal", status: "Under Offer", dealType: "New Letting" }]), "solicitors");
  assert.equal(stageOf([{ src: "deal", status: "Under Negotiation", dealType: "Letting" }]), "negotiating");
  assert.equal(stageOf([{ src: "deal", status: "Heads of Terms", dealType: "New Letting" }]), "hots");
  assert.equal(stageOf([{ src: "deal", status: "Let", dealType: "New Letting" }]), "let");
  assert.equal(stageOf([{ src: "deal", status: "Marketing", dealType: "New Letting" }]), "approached");
  assert.equal(stageOf([{ src: "deal", status: "Dead", dealType: "New Letting" }]), "not_proceeding");
  // A status that is not one of the codes, and advisory or investment work, say nothing.
  assert.equal(stageOf([{ src: "deal", status: "Leasing Comps", dealType: "New Letting" }]), null);
  assert.equal(stageOf([{ src: "deal", status: "COM", dealType: "Rent Review" }]), null);
  assert.equal(stageOf([{ src: "deal", status: "SOL", dealType: "Sale" }]), null);
  // A tenant-rep acquisition and a deal with no type are read as lettings.
  assert.equal(stageOf([{ src: "deal", status: "SOL", dealType: "Lease Acquisition" }]), "solicitors");
  assert.equal(stageOf([{ src: "deal", status: "NEG", dealType: null }]), "negotiating");
});

test("the furthest live evidence wins", () => {
  const result = resolveStage([
    { src: "tracker_target", status: "Identified", at: "2026-09-01T00:00:00Z" },
    { src: "viewing", status: "completed", at: "2026-10-01" },
    { src: "offer", status: "Pending", at: "2026-10-20" },
    { src: "interest", at: "2026-09-10" },
  ]);
  assert.equal(result?.stage, "negotiating");
  assert.equal(result?.stageSince, "2026-10-20T00:00:00.000Z");
  assert.deepEqual(result?.evidence.map(e => e.src), ["offer", "viewing", "interest", "tracker_target"]);
  // The stage dates from the first record that reached it.
  assert.equal(resolveStage([{ src: "viewing", status: "completed", at: "2026-10-09" }, { src: "viewing", status: "completed", at: "2026-10-02" }])?.stageSince, "2026-10-02T00:00:00.000Z");
});

test("a completed deal alone is Let; a tenancy row is Trading", () => {
  assert.equal(stageOf([{ src: "deal", status: "COM", dealType: "New Letting" }]), "let");
  assert.equal(stageOf([{ src: "deal", status: "COM", dealType: "New Letting" }, { src: "trading", status: "Occupied" }]), "trading");
});

test("a booked viewing is Approached; a completed viewing is Viewed", () => {
  assert.equal(stageOf([{ src: "viewing", status: "scheduled", at: "2026-12-01" }]), "approached");
  assert.equal(stageOf([{ src: "viewing", status: "no_show", at: "2026-11-01" }]), "approached");
  assert.equal(stageOf([{ src: "viewing", status: "completed", at: "2026-11-01" }]), "viewed");
  assert.equal(stageOf([{ src: "viewing", status: "cancelled" }]), null);
  assert.equal(stageOf([{ src: "viewing", status: "not_leasing" }]), null);
});

test("Not proceeding only when nothing live remains, with the reason", () => {
  const passed = resolveStage([{ src: "tracker_target", status: "Passed", at: "2026-10-01T00:00:00Z" }]);
  assert.equal(passed?.stage, "not_proceeding");
  assert.equal(passed?.notProceedingReason, NOT_PROCEEDING_REASONS.brandPassed);
  assert.equal(resolveStage([{ src: "offer", status: "Rejected" }])?.notProceedingReason, NOT_PROCEEDING_REASONS.landlordDeclined);
  assert.equal(resolveStage([{ src: "offer", status: "Withdrawn" }])?.notProceedingReason, NOT_PROCEEDING_REASONS.withdrawn);
  assert.equal(resolveStage([{ src: "deal", status: "WIT", dealType: "New Letting" }])?.notProceedingReason, NOT_PROCEEDING_REASONS.withdrawn);
  assert.equal(resolveStage([{ src: "deal", status: "ARCH", dealType: "New Letting" }])?.notProceedingReason, NOT_PROCEEDING_REASONS.withdrawn);
  assert.equal(resolveStage([{ src: "case_unit", status: "Declined", hasUnit: true }])?.notProceedingReason, NOT_PROCEEDING_REASONS.landlordDeclined);
  assert.equal(resolveStage([{ src: "schedule_target", status: "approved", outcome: "passed" }])?.notProceedingReason, NOT_PROCEEDING_REASONS.brandPassed);
  assert.equal(resolveStage([{ src: "schedule_target", status: "approved", outcome: "withdrawn" }])?.notProceedingReason, NOT_PROCEEDING_REASONS.withdrawn);
  assert.equal(resolveStage([{ src: "wish", hasUnit: false, ruledOut: true, reason: "Landsec want a local operator" }])?.notProceedingReason, "Landsec want a local operator");
  // A rejected offer beside a live target: the line is still live.
  assert.equal(stageOf([{ src: "offer", status: "Rejected" }, { src: "tracker_target", status: "Approached" }]), "approached");
  // The latest thing that stopped it gives the reason.
  assert.equal(resolveStage([{ src: "tracker_target", status: "Passed", at: "2026-09-01T00:00:00Z" }, { src: "offer", status: "Rejected", at: "2026-10-01" }])?.notProceedingReason, NOT_PROCEEDING_REASONS.landlordDeclined);
});

test("an offer from an earlier letting (Closed) is never evidence", () => {
  assert.equal(readEvidence({ src: "offer", status: "Closed" }), null);
  assert.equal(stageOf([{ src: "offer", status: "Closed" }]), null);
  assert.equal(stageOf([{ src: "offer", status: "Closed" }, { src: "target_list" }]), "unit_identified");
});

test("evidence from before the unit's last closed letting is ignored, unless the letting was the brand's own", () => {
  const old: StageEvidence[] = [
    { src: "viewing", status: "completed", at: "2025-03-01" },
    { src: "offer", status: "Pending", at: "2025-03-20" },
    { src: "interest", at: "2025-02-01" },
    { src: "tracker_target", status: "Approached", at: "2025-02-10T00:00:00Z" },
  ];
  const letToOther = { brandId: BRAND, lastClosedLetting: { at: "2025-06-01T00:00:00Z", tenantId: "other-brand" } };
  const gone = resolveStage(old, letToOther);
  assert.equal(gone?.stage, "not_proceeding");
  assert.equal(gone?.notProceedingReason, NOT_PROCEEDING_REASONS.otherBrand);
  // New evidence after that letting starts a fresh line.
  assert.equal(stageOf([...old, { src: "viewing", status: "scheduled", at: "2026-11-20" }], letToOther), "approached");
  // The same records count when the closed letting is the brand's own.
  assert.equal(stageOf([...old, { src: "deal", status: "COM", dealType: "New Letting", at: "2025-06-01T00:00:00Z" }],
    { brandId: BRAND, lastClosedLetting: { at: "2025-06-01T00:00:00Z", tenantId: BRAND } }), "let");
  // Tenant not recorded on the closed letting: the old records are dropped, and no claim is made about who took it.
  assert.equal(resolveStage(old, { brandId: BRAND, lastClosedLetting: { at: "2025-06-01T00:00:00Z", tenantId: null } }), null);
  // A brand that once took the unit and has since been replaced is history, not a line.
  assert.equal(resolveStage([{ src: "deal", status: "COM", dealType: "New Letting", at: "2019-05-01T00:00:00Z" }],
    { brandId: BRAND, lastClosedLetting: { at: "2024-05-01T00:00:00Z", tenantId: "other-brand" } }), null);
});

test("a different tenant on the unit's live deal gives Not proceeding, with no name in the reason", () => {
  const result = resolveStage([{ src: "viewing", status: "completed", at: "2026-10-01" }, { src: "offer", status: "Pending", at: "2026-10-05" }],
    { brandId: BRAND, liveDealTenantId: "other-brand" });
  assert.equal(result?.stage, "not_proceeding");
  assert.equal(result?.notProceedingReason, "Unit went to another brand");
  // The brand's own live deal or tenancy is not overridden.
  assert.equal(stageOf([{ src: "deal", status: "NEG", dealType: "New Letting" }], { brandId: BRAND, liveDealTenantId: "other-brand" }), "negotiating");
  assert.equal(stageOf([{ src: "trading", status: "Occupied" }], { brandId: BRAND, liveDealTenantId: "other-brand" }), "trading");
  assert.equal(stageOf([{ src: "offer", status: "Pending" }], { brandId: BRAND, liveDealTenantId: BRAND }), "negotiating");
});

test("Lease Disposal and Sub-Letting give Disposing, never a target", () => {
  assert.equal(stageOf([{ src: "deal", status: "AVA", dealType: "Lease Disposal" }]), "disposing");
  assert.equal(stageOf([{ src: "deal", status: "SOL", dealType: "Sub-Letting" }]), "disposing");
  // Disposing wins over the tenancy it is giving up, and over any target evidence.
  assert.equal(stageOf([{ src: "trading", status: "Occupied" }, { src: "deal", status: "NEG", dealType: "Lease Disposal" }, { src: "target_list" }]), "disposing");
  // A finished or withdrawn disposal says nothing.
  assert.equal(stageOf([{ src: "deal", status: "COM", dealType: "Lease Disposal" }]), null);
  assert.equal(stageOf([{ src: "deal", status: "WIT", dealType: "Sub-Letting" }]), null);
});

test("brand case 'Under offer' is a note and does not move the stage", () => {
  const result = resolveStage([{ src: "case_unit", status: "Under offer", hasUnit: true }]);
  assert.equal(result?.stage, "unit_identified");
  assert.deepEqual(result?.notes, ["Marked under offer on the brand case"]);
  assert.equal(stageOf([{ src: "case_unit", status: "Under offer", hasUnit: false }]), "wanted");
});

test("AI-suggested and rejected leasing schedule targets do not make a line", () => {
  assert.equal(stageOf([{ src: "schedule_target", status: "suggested" }]), null);
  assert.equal(stageOf([{ src: "schedule_target", status: "rejected" }]), null);
});

test("the headline counts lines, furthest first", () => {
  assert.equal(planHeadline([
    { stage: "wanted", schemeId: "bluewater" }, { stage: "hots", schemeId: "liverpool-one" }, { stage: "viewed", schemeId: "gunwharf-quays" },
    { stage: "not_proceeding", schemeId: "st-davids" },
  ]), "3 schemes: 1 at HOTs, 1 viewed, 1 wanted");
  assert.equal(planHeadline([{ stage: "trading", schemeId: "bluewater" }, { stage: "trading", schemeId: "bluewater" }]), "1 scheme: 2 trading");
  assert.equal(planHeadline([{ stage: "not_proceeding", schemeId: "bluewater" }]), "No schemes or units yet");
  assert.equal(furthestStage(["wanted", "not_proceeding", "viewed"]), "viewed");
  assert.equal(furthestStage(["not_proceeding", "disposing"]), "disposing");
  assert.equal(furthestStage(["not_proceeding"]), "not_proceeding");
  assert.equal(furthestStage([]), null);
});

// ── Requirement chip ─────────────────────────────────────────────────────
const bluewater = (sqft: number | null, extra: Partial<ChipPlace> = {}): ChipPlace => ({ regions: ["South East"], text: "Bluewater Kent Bluewater Shopping Centre DA9 9ST", sqft, ...extra });
const london: ChipPlace = { regions: ["London"], text: "One New Change London EC4", sqft: 2000 };

test("requirement chip: every key", () => {
  assert.equal(requirementChip([], bluewater(2000)).chip, "no_requirement");
  assert.equal(requirementChip([{ id: "r1", size: ["1,500-3,000 sq ft"], locations: ["South East"] }], bluewater(2000)).chip, "fits");
  assert.equal(requirementChip([{ id: "r1", size: ["1,500-3,000 sq ft"], locations: ["South East"] }], bluewater(null)).chip, "place_fits_size_unknown");
  const out = requirementChip([{ id: "r1", size: ["1,500-3,000 sq ft"], locations: ["South East"] }], bluewater(9000));
  assert.equal(out.chip, "place_fits_size_out");
  assert.equal(out.unitSqft, 9000);
  assert.deepEqual(out.range, { min: 1200, max: 3600 });   // both figures come back
  assert.equal(requirementChip([{ id: "r1", size: ["1,500-3,000 sq ft"], locations: [] }], bluewater(2000)).chip, "size_fits_no_places");
  assert.equal(requirementChip([{ id: "r1", size: ["1,500-3,000 sq ft"], locations: ["Scotland", "North West"] }], bluewater(2000)).chip, "not_on_list");
  // Region chips cannot be judged for a property outside the scheme registry.
  assert.equal(requirementChip([{ id: "r1", size: ["2000"], locations: ["Midlands"] }], { regions: null, text: "Bullring Birmingham B5 4BU", sqft: 2000 }).chip, "place_unknown");
  // A named place still matches such a property by its address.
  assert.equal(requirementChip([{ id: "r1", size: ["2000"], locations: ["Birmingham"] }], { regions: null, text: "Bullring Birmingham B5 4BU", sqft: 2000 }).chip, "fits");
  // Linked: a viewing or a Wanted line pins the requirement, or the requirement's deal is this line's deal.
  assert.equal(requirementChip([{ id: "r1", size: ["500"], locations: ["Scotland"] }], bluewater(9000, { linkedRequirementIds: ["r1"] })).chip, "linked");
  assert.equal(requirementChip([{ id: "r1", locations: ["Scotland"], dealId: "d1" }], bluewater(9000, { dealId: "d1" })).chip, "linked");
});

test("requirement chip: regions and named places", () => {
  assert.equal(placeFits("South East", bluewater(null)), true);
  assert.equal(placeFits("National", bluewater(null)), true);
  assert.equal(placeFits("national", { regions: null, text: "" }), true);
  assert.equal(placeFits("Kent", bluewater(null)), true);          // the town
  assert.equal(placeFits("Wales", bluewater(null)), false);
  // "London" is kept as a region here (requirementFitsUnit discards it).
  assert.equal(requirementChip([{ id: "r1", size: ["2000"], locations: ["London"] }], london).chip, "fits");
  assert.equal(requirementChip([{ id: "r1", size: ["2000"], locations: ["London"] }], bluewater(2000)).chip, "not_on_list");
  assert.equal(requirementChip([{ id: "r1", size: ["2000"], locations: ["National"] }], london).chip, "fits");
});

test("requirement chip: known size-parsing quirks stay visible", () => {
  // "Under 500 sq ft" reads as a single figure: 300 to 800.
  const under = requirementChip([{ id: "r1", size: ["Under 500 sq ft"], locations: ["South East"] }], bluewater(700));
  assert.equal(under.chip, "fits");
  assert.deepEqual(under.range, { min: 300, max: 800 });
  // A second size band is ignored: only the first range is tested.
  assert.equal(requirementChip([{ id: "r1", size: ["500-1000", "4000-6000"], locations: ["South East"] }], bluewater(5000)).chip, "place_fits_size_out");
  // No places and no unit area: only "size not known" can be said.
  assert.equal(requirementChip([{ id: "r1", size: ["2000"], locations: null }], bluewater(null)).chip, "size_unknown_no_places");
  // No places: the chip never claims the place was checked.
  assert.equal(requirementChip([{ id: "r1", size: ["2000"], locations: [] }], bluewater(9000)).chip, "size_out_no_places");
  // Neither a size nor a place on the requirement: nothing was checked, whatever the unit's size.
  assert.equal(requirementChip([{ id: "r1", size: null, locations: null }], bluewater(1530)).chip, "held_no_detail");
  assert.equal(requirementChip([{ id: "r1", size: [], locations: [] }], bluewater(null)).chip, "held_no_detail");
  assert.equal(requirementChip([{ id: "r1" }, { id: "r2", size: ["2000"], locations: ["Scotland"] }], bluewater(2000)).chip, "not_on_list");
  // A requirement with no size cannot be judged on size.
  assert.equal(requirementChip([{ id: "r1", size: null, locations: ["South East"] }], bluewater(2000)).chip, "place_fits_size_unknown");
});

test("requirement chip: the best of several live requirements, with the one that produced it", () => {
  const best = requirementChip([
    { id: "far", size: ["2000"], locations: ["Scotland"] },
    { id: "near", size: ["1,500-3,000"], locations: ["South East"] },
    { id: "big", size: ["10000"], locations: ["South East"] },
  ], bluewater(2000));
  assert.equal(best.chip, "fits");
  assert.equal(best.requirementId, "near");
});

test("asked for, no target yet", () => {
  const schemes = [
    { key: "bluewater", name: "Bluewater", regions: ["South East"], text: "Bluewater Kent" },
    { key: "westgate-oxford", name: "Westgate Oxford", regions: ["South East"], text: "Westgate Oxford Oxford" },
    { key: "liverpool-one", name: "Liverpool ONE", regions: ["North West"], text: "Liverpool ONE Liverpool" },
  ];
  const asked = askedNoTarget([{ id: "r1", locations: ["South East", "Liverpool", "Scotland"] }, { id: "r2", locations: ["south east"] }], schemes, new Set(["bluewater"]));
  assert.deepEqual(asked, [
    { place: "South East", schemes: [{ key: "westgate-oxford", name: "Westgate Oxford" }] },
    { place: "Liverpool", schemes: [{ key: "liverpool-one", name: "Liverpool ONE" }] },
  ]);
  assert.deepEqual(askedNoTarget([{ id: "r1", locations: ["South East"] }], schemes, new Set(["bluewater", "westgate-oxford"])), []);
});

test("On hold is the one hand-set flag: only null or parked can be saved", () => {
  assert.equal(conceptStatusForSave("parked"), "parked");
  assert.equal(conceptStatusForSave(null), null);
  assert.equal(conceptStatusForSave(""), null);
  assert.equal(conceptStatusForSave(undefined), null);
  for (const old of ["watching", "pitching", "won_deal", "lost_deal", "Parked", true, 1]) assert.throws(() => conceptStatusForSave(old), /On hold/);
  assert.equal(isOnHold("parked"), true);
  for (const other of ["watching", "pitching", "won_deal", "lost_deal", null, undefined]) assert.equal(isOnHold(other), false);
});
