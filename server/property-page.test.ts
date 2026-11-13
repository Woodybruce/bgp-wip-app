// The property page's unit feed and its plan matching: server/property-units.ts,
// server/property-plan-match.ts and the rules in shared/property-plan-match.ts.
//
// The first part needs no database: which schedule row a scan's proposal is
// suggested for, and which proposals are still waiting for a person. The
// second part runs the real SQL in a throwaway schema and is skipped unless
// PROPERTY_PAGE_DATABASE_URL names a LOCAL PostgreSQL database that holds the
// app's tables, for example:
//   PROPERTY_PAGE_DATABASE_URL=postgresql://postgres:qa-local-pg@127.0.0.1:5432/bgpdev \
//     node --import tsx --test server/property-page.test.ts
import test, { before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { bulkAcceptable, floorKey, floorsDisagree, planMatchCounts, sameFloor, type PlanMatchProposal } from "@shared/property-plan-match";
import type { PropertyPlanPolygon } from "@shared/property-plan-scan";
import type { PropertyUnit } from "@shared/property-units";

let match: typeof import("./property-plan-match");
let units: typeof import("./property-units");
before(async () => {
  process.env.DATABASE_URL ||= "postgres://test:test@127.0.0.1:1/test";
  match = await import("./property-plan-match");
  units = await import("./property-units");
});

type Row = import("./property-plan-match").PlanMatchScheduleRow;
type Match = import("./property-plan-match").PlanLabelMatch;

// A schedule row as the matcher is handed it. Labels are spelt as a centre's
// schedule spells them: the unit code, then the scheme and the level.
const row = (id: string, label: string, over: Partial<Row> = {}): Row => ({
  id, property_id: "plan", unit_number: label, premises: null, tenant_name: null, trading_name: null, permitted_use: "Shop", floor: "Lower Level", ...over,
});
const SCHEDULE: Row[] = [
  row("nandos", "WVL22 Bluewater - Lower Level", { tenant_name: "Nando's Chickenland Limited", trading_name: "Nando's", permitted_use: "Restaurant" }),
  row("costa", "SVL02 Bluewater - Lower Level", { tenant_name: "Costa Limited", trading_name: "Costa", permitted_use: "Restaurant" }),
  row("empty", "L200 Bluewater - Lower Level"),
  row("void", "L201 Bluewater - Lower Level", { tenant_name: "VACANT" }),
  row("next", "L101/L102 Bluewater - Lower Level", { tenant_name: "Next Retail Ltd", trading_name: "Next" }),
  row("jd", "U036", { tenant_name: "JD Sports Fashion PLC", floor: "Upper Level" }),
  row("zizzi", "RU10", { tenant_name: "Azzurri Restaurants Limited", trading_name: "Zizzi", permitted_use: "Restaurant", floor: "Upper Level" }),
];
const LOWER = "Lower Level", UPPER = "Upper Level";
const NO_MATCH: Match = { rowId: null, method: null, possible: [], tenantDiffers: false, floorDiffers: false };
const suggested = (rowId: string, method: Match["method"], over: Partial<Match> = {}): Match => ({ ...NO_MATCH, rowId, method, ...over });
const on = (label: string | null, tenant: string | null = null, rows: Row[] = SCHEDULE, floor: string | null = LOWER) => match.matchPlanLabel(label, tenant, rows, floor);

const box = (x: number, y: number, w = 0.1, h = 0.1): PropertyPlanPolygon => ({ points: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]] });
const candidate = (n: number, label: string, tenant: string | null, polygon: PropertyPlanPolygon = box(0.05 + 0.12 * ((n - 1) % 7), 0.05 + 0.15 * Math.floor((n - 1) / 7)), extra: Record<string, unknown> = {}) =>
  ({ id: `candidate-${n}`, label, tenant, polygon, tenancy_unit_id: null, unit_id: null, requiresReview: false, warning: null, ...extra });
// One proposal as the Match screen is sent it.
const proposalFor = (label: string, tenant: string | null, rows: Row[] = SCHEDULE, floor: string | null = LOWER): PlanMatchProposal =>
  match.suggestPlanMatches([candidate(1, label, tenant)], rows, floor)[0];

// ── Part 1: the rules ────────────────────────────────────────────────────

test("the number printed on the plan names its row: the row's own label, or the code a longer label starts with", () => {
  assert.deepEqual(on("RU10", null, SCHEDULE, UPPER), suggested("zizzi", "code"));
  // Case, a "Unit" in front, zero padding and stray spaces around it do not matter.
  for (const printed of ["WVL22", "wvl22", "Unit WVL22", "WVL022", "  WVL22 "]) assert.deepEqual(on(printed), suggested("nandos", "code"), printed);
  for (const printed of ["SVL02", "SVL2", "svl002"]) assert.deepEqual(on(printed), suggested("costa", "code"), printed);
  for (const printed of ["U036", "U36", "Unit U36"]) assert.deepEqual(on(printed, null, SCHEDULE, UPPER), suggested("jd", "code"), printed);
  // A double unit, however the plan joins its two numbers.
  for (const printed of ["L101/L102", "L101/102", "L101-L102", "L101 & L102", "L101, L102"]) assert.deepEqual(on(printed), suggested("next", "code"), printed);
});

test("a number never borrows a row it only resembles", () => {
  for (const printed of ["22", "WVL2", "WVL220", "VL22", "WVL22A", "Unit 36", "36"]) assert.deepEqual(on(printed, null, SCHEDULE, null), NO_MATCH, printed);
  // Printed with a gap or a dash it may go unread, but it is never read as another unit.
  for (const printed of ["WVL 22", "WVL-22", "W VL22"]) assert.ok([null, "nandos"].includes(on(printed).rowId), printed);
});

test("a code printed with a gap or a dash is still that unit", { todo: "the shared matcher (server/evidence-plan-schedule.ts reference()) reads \"WVL 22\" and \"WVL-22\" as other codes than \"WVL22\", so these outlines get no suggestion" }, () => {
  for (const printed of ["WVL 22", "WVL-22"]) assert.deepEqual(on(printed), suggested("nandos", "code"), printed);
});

test("the number is the unit: a different tenant on the plan is reported, and that match is taken one at a time", () => {
  const moved = proposalFor("WVL22", "Zizzi");
  assert.deepEqual([moved.suggestedRowId, moved.method, moved.tenantDiffers, moved.floorDiffers, moved.possibleRowIds], ["nandos", "code", true, false, []]);
  assert.equal(bulkAcceptable(moved), false);
  // The same tenant, as the plan would shorten it or the lease would spell it.
  for (const printed of ["Nando's", "NANDOS", "Nando's Chickenland Limited", "nandos chickenland ltd"]) {
    const same = proposalFor("WVL22", printed);
    assert.deepEqual([same.suggestedRowId, same.method, same.tenantDiffers], ["nandos", "code", false], printed);
    assert.equal(bulkAcceptable(same), true, printed);
  }
  assert.deepEqual(on("U036", "JD", SCHEDULE, UPPER), suggested("jd", "code"), "a short trading name leads the legal name");
  assert.deepEqual(on("U036", "JDX", SCHEDULE, UPPER), suggested("jd", "code", { tenantDiffers: true }));
});

test("a row with no tenant recorded cannot disagree with the plan, so its number alone is enough", () => {
  for (const [printed, id] of [["L200", "empty"], ["L201", "void"]] as const) {
    const proposal = proposalFor(printed, "Pret A Manger");
    assert.deepEqual([proposal.suggestedRowId, proposal.method, proposal.tenantDiffers], [id, "code", false], printed);
    assert.equal(bulkAcceptable(proposal), true, printed);
  }
  // The plan says the shop is empty; the schedule names a tenant. The number still decides.
  assert.deepEqual(on("WVL22", "VACANT"), suggested("nandos", "code"));
  assert.deepEqual(on("WVL22", "TO LET"), suggested("nandos", "code"));
});

test("a printed number that matches nothing is never overridden by a name", () => {
  assert.deepEqual(on("WVL99", "Nando's"), { ...NO_MATCH, possible: ["nandos"] });
  assert.deepEqual(on("WVL99", "Nando's Chickenland Limited"), { ...NO_MATCH, possible: ["nandos"] });
  const proposal = proposalFor("WVL99", "Nando's");
  assert.deepEqual([proposal.suggestedRowId, proposal.method, proposal.possibleRowIds], [null, null, ["nandos"]]);
  assert.equal(bulkAcceptable(proposal), false);
});

test("nor by a name that two rows carry, even when only one of them is on this floor", () => {
  const two = [...SCHEDULE, row("costa-upper", "U050 Bluewater - Upper Level", { tenant_name: "Costa Limited", trading_name: "Costa", floor: UPPER })];
  assert.deepEqual(on("WVL99", "Costa", two, LOWER), { ...NO_MATCH, possible: ["costa", "costa-upper"] });
  assert.deepEqual(on("WVL99", "Costa", two, UPPER), { ...NO_MATCH, possible: ["costa", "costa-upper"] });
});

test("a lettered unit is a printed reference too: \"Kiosk C\" is not Kiosk A because the same brand trades from both", () => {
  const kiosks = [
    row("kiosk-a", "Kiosk A", { tenant_name: "Costa Limited", trading_name: "Costa", permitted_use: "Kiosks" }),
    row("kiosk-b", "Kiosk B", { tenant_name: "Krispy Kreme UK Limited", trading_name: "Krispy Kreme", permitted_use: "Kiosks" }),
  ];
  assert.deepEqual(on("Kiosk A", "Costa", kiosks), suggested("kiosk-a", "code"));
  for (const printed of ["Kiosk C", "Unit C", "C"]) {
    assert.deepEqual(on(printed, "Costa", kiosks), { ...NO_MATCH, possible: ["kiosk-a"] }, printed);
    assert.equal(bulkAcceptable(match.suggestPlanMatches([candidate(1, printed, "Costa")], kiosks, LOWER)[0]), false, printed);
  }
});

test("a tenant's name alone suggests the one row that carries it, by trading name or by the name on the lease", () => {
  // A scan labels an outline with the tenant when the plan prints no number, or "Unlabelled n" when it reads nothing.
  for (const [label, tenant] of [["Nando's", "Nando's"], ["Unlabelled 3", "Nando's"], ["NANDOS", "NANDOS"], ["Unlabelled 3", "Nando's Chickenland Limited"], ["Unlabelled 3", "nandos chickenland ltd"]] as const) {
    const proposal = proposalFor(label, tenant);
    assert.deepEqual([proposal.suggestedRowId, proposal.method, proposal.tenantDiffers, proposal.floorDiffers, proposal.possibleRowIds], ["nandos", "tenant", false, false, []], `${label} / ${tenant}`);
    assert.equal(bulkAcceptable(proposal), true, `${label} / ${tenant}`);
  }
  assert.deepEqual(on("Costa", "Costa"), suggested("costa", "tenant"));
  assert.deepEqual(on("Unlabelled 9", "Costa Limited"), suggested("costa", "tenant"));
  assert.deepEqual(on("Unlabelled 9", "Zizzi", SCHEDULE, UPPER), suggested("zizzi", "tenant"), "the trading name, where the lease names another company");
  assert.deepEqual(on("Unlabelled 9", "Azzurri Restaurants Ltd", SCHEDULE, UPPER), suggested("zizzi", "tenant"));
  assert.deepEqual(on("JD Sports Fashion", "JD Sports Fashion", SCHEDULE, UPPER), suggested("jd", "tenant"));
  // Only the whole name: a longer one, a shorter one or two letters is not it.
  for (const name of ["Costa Coffee", "Cost", "JD", "Nando"]) assert.deepEqual(on(name, name, SCHEDULE, null), NO_MATCH, name);
});

test("a tenant whose name has a number in it is still a name when it is all the plan prints", () => {
  const rows = [
    ...SCHEDULE,
    row("future", "L052 Bluewater - Lower Level", { tenant_name: "Future 62 Ltd" }),
    row("mankind", "L053 Bluewater - Lower Level", { tenant_name: "Seven For All Mankind UK Limited", trading_name: "7 For All Mankind" }),
    row("store21", "L054 Bluewater - Lower Level", { tenant_name: "Store Twenty One" }),
  ];
  for (const [name, id] of [["Future 62", "future"], ["Future 62 Ltd", "future"], ["7 For All Mankind", "mankind"], ["Store Twenty One", "store21"]] as const) {
    assert.deepEqual(on("Unlabelled 4", name, rows), suggested(id, "tenant"), `Unlabelled / ${name}`);
    assert.deepEqual(on(name, name, rows), suggested(id, "tenant"), `${name} / ${name}`);
  }
  // A code the scan filed under tenant is still read as the unit's number.
  assert.deepEqual(on("WVL22", "WVL22", rows), suggested("nandos", "code", { tenantDiffers: true }));
});

test("a name that two rows carry is a choice for a person, unless exactly one of them is on this floor", () => {
  const two = [...SCHEDULE, row("costa-upper", "U050 Bluewater - Upper Level", { tenant_name: "Costa Limited", trading_name: "Costa", floor: UPPER })];
  for (const [label, tenant] of [["Costa", "Costa"], ["Unlabelled 2", "Costa"], ["Unlabelled 2", "Costa Limited"]] as const) {
    assert.deepEqual(on(label, tenant, two, null), { ...NO_MATCH, possible: ["costa", "costa-upper"] }, `${label} / ${tenant}, floor unknown`);
    assert.deepEqual(on(label, tenant, two, "Ground Floor"), { ...NO_MATCH, possible: ["costa", "costa-upper"] }, `${label} / ${tenant}, neither on this floor`);
    assert.deepEqual(on(label, tenant, two, "upper mall"), suggested("costa-upper", "floor", { possible: ["costa", "costa-upper"] }), `${label} / ${tenant}, upper`);
    const lower = match.suggestPlanMatches([candidate(1, label, tenant)], two, LOWER)[0];
    assert.deepEqual([lower.suggestedRowId, lower.method, lower.possibleRowIds], ["costa", "floor", ["costa", "costa-upper"]], `${label} / ${tenant}, lower`);
    assert.equal(bulkAcceptable(lower), false, "a floor tie-break is accepted one at a time");
  }
  // Both on this floor: the floor settles nothing.
  const sameFloorRows = [...SCHEDULE, row("costa-2", "L300 Bluewater - Lower Level", { tenant_name: "Costa Limited", trading_name: "Costa" })];
  assert.deepEqual(on("Costa", "Costa", sameFloorRows, LOWER), { ...NO_MATCH, possible: ["costa", "costa-2"] });
});

test("a name on two rows stays a choice however the two rows are labelled", () => {
  // One label starts with a code and has a suffix, the other is a bare code or a name: the first is not preferred.
  for (const other of ["RU12", "Blue Welcome Hall Bluewater", "Kiosk 4"]) {
    const rows = [...SCHEDULE, row("costa-other", other, { tenant_name: "Costa Limited", trading_name: "Costa", floor: UPPER })];
    for (const [label, tenant] of [["Costa", "Costa"], ["Unlabelled 2", "Costa"]] as const) {
      const proposal = match.suggestPlanMatches([candidate(1, label, tenant)], rows, null)[0];
      assert.deepEqual([proposal.suggestedRowId, proposal.method, [...proposal.possibleRowIds].sort()], [null, null, ["costa", "costa-other"]], `${other}: ${label} / ${tenant}`);
      assert.equal(bulkAcceptable(proposal), false, other);
    }
  }
});

test("the same number on two floors is settled by the plan's floor, and is still one for a person to accept", () => {
  const rows = [row("lower-5", "Unit 5", { tenant_name: "Lush Retail Ltd", floor: LOWER }), row("upper-5", "Unit 5", { tenant_name: "Smiggle UK Limited", floor: UPPER })];
  assert.deepEqual(on("5", null, rows, null), { ...NO_MATCH, possible: ["lower-5", "upper-5"] });
  assert.deepEqual(on("Unit 5", null, rows, UPPER), suggested("upper-5", "floor", { possible: ["lower-5", "upper-5"] }));
  const proposal = match.suggestPlanMatches([candidate(1, "5", "Smiggle")], rows, LOWER)[0];
  assert.deepEqual([proposal.suggestedRowId, proposal.method, proposal.tenantDiffers], ["lower-5", "floor", true]);
  assert.equal(bulkAcceptable(proposal), false);
});

test("placeholders are never a number or a name", () => {
  const rows = [...SCHEDULE, row("tolet", "L400 Bluewater - Lower Level", { tenant_name: "TO LET" }), row("avail", "L401 Bluewater - Lower Level", { tenant_name: "Available" })];
  for (const label of ["VACANT", "vacant", "TO LET", "To Let", "LET", "VOID", "Available", "TBC", "N/A", "-", "—", "–", "Unlabelled 7", "UNLABELLED 12", "  ", ""]) {
    for (const tenant of [null, label, "VACANT", "TO LET", "-", " "]) assert.deepEqual(on(label, tenant, rows, LOWER), NO_MATCH, `${JSON.stringify(label)} / ${JSON.stringify(tenant)}`);
  }
  assert.deepEqual(on(null, null, rows), NO_MATCH);
  assert.deepEqual(match.suggestPlanMatches([candidate(1, "Unlabelled 1", null), candidate(2, "VACANT", "VACANT"), candidate(3, "TO LET", null)], rows, LOWER)
    .map(p => [p.suggestedRowId, p.method, p.possibleRowIds]), [[null, null, []], [null, null, []], [null, null, []]]);
});

test("two proposals that point at the same row are nobody's suggestion: both list it as possible", () => {
  const proposals = match.suggestPlanMatches([candidate(1, "WVL22", "Zizzi"), candidate(2, "Nando's", "Nando's"), candidate(3, "SVL02", null), candidate(4, "Unlabelled 4", null)], SCHEDULE, UPPER);
  assert.deepEqual(proposals.map(p => [p.id, p.suggestedRowId, p.method, p.possibleRowIds, p.tenantDiffers, p.floorDiffers]), [
    ["candidate-1", null, null, ["nandos"], false, false],
    ["candidate-2", null, null, ["nandos"], false, false],
    ["candidate-3", "costa", "code", [], false, true],
    ["candidate-4", null, null, [], false, false],
  ]);
  assert.deepEqual(proposals.map(bulkAcceptable), [false, false, false, false]);
  // What the scan read is passed on untouched.
  assert.deepEqual([proposals[0].label, proposals[0].tenant, proposals[0].polygon], ["WVL22", "Zizzi", candidate(1, "", null).polygon]);
  // A floor tie-break that lands on a row another proposal names is withdrawn too, and keeps its other possible rows.
  const two = [...SCHEDULE, row("costa-upper", "U050 Bluewater - Upper Level", { tenant_name: "Costa Limited", trading_name: "Costa", floor: UPPER })];
  assert.deepEqual(match.suggestPlanMatches([candidate(1, "Costa", "Costa"), candidate(2, "SVL02", null)], two, LOWER).map(p => [p.suggestedRowId, p.method, p.possibleRowIds]),
    [[null, null, ["costa", "costa-upper"]], [null, null, ["costa"]]]);
});

test("a row the schedule puts on another floor is still suggested by its number, and flagged", () => {
  const upstairs = proposalFor("U036", null, SCHEDULE, LOWER);
  assert.deepEqual([upstairs.suggestedRowId, upstairs.method, upstairs.floorDiffers], ["jd", "code", true]);
  assert.equal(bulkAcceptable(upstairs), false);
  assert.equal(on("U036", null, SCHEDULE, "UPPER MALL").floorDiffers, false, "the same floor under another name");
  assert.equal(on("U036", null, SCHEDULE, null).floorDiffers, false, "the plan's floor is not known");
  assert.equal(on("U036", null, SCHEDULE, "  ").floorDiffers, false);
  const noFloor = [row("jd", "U036", { tenant_name: "JD Sports Fashion PLC", floor: null })];
  assert.equal(on("U036", null, noFloor, LOWER).floorDiffers, false, "the row's floor is not recorded");
  assert.deepEqual(on("JD Sports Fashion", "JD Sports Fashion", SCHEDULE, LOWER), suggested("jd", "tenant", { floorDiffers: true }));
  assert.equal(bulkAcceptable(proposalFor("JD Sports Fashion", "JD Sports Fashion", SCHEDULE, LOWER)), false);
});

test("storage, cash machines and car parks are not matched by the tenant's name, only by their own number", () => {
  const boots = { tenant_name: "Boots UK Limited", trading_name: "Boots" };
  const ancillary = [
    row("store", "STOL8 Storage Bluewater", { ...boots, permitted_use: "Storage" }),
    row("atm", "ATM 3", { ...boots, permitted_use: "ATM" }),
    row("carpark", "Car Park Level 2", boots),
    row("cage", "L061 Bluewater - Lower Level", { ...boots, premises: "Store cage behind L060" }),
  ];
  const shop = row("shop", "L060 Bluewater - Lower Level", boots);
  assert.deepEqual(on("Boots", "Boots", [...ancillary, shop]), suggested("shop", "tenant"));
  assert.deepEqual(on("Unlabelled 5", "Boots UK Limited", [...ancillary, shop]), suggested("shop", "tenant"));
  assert.deepEqual(on("Boots", "Boots", ancillary), NO_MATCH);
  assert.deepEqual(on("Unlabelled 5", "Boots", ancillary), NO_MATCH);
  assert.deepEqual(on("STOL8", null, ancillary), suggested("store", "code"));
  assert.deepEqual(on("ATM 3", "Boots", ancillary), suggested("atm", "code"));
});

test("the proposals still waiting: not marked not a unit, not saved, not under something drawn since", () => {
  const outline = (id: string, polygon: PropertyPlanPolygon, tenancy_unit_id: string | null = null) => ({ id, label: null, polygon, tenancy_unit_id, unit_id: null });
  const candidates = [
    candidate(1, "A1", null, box(0.05, 0.05)),
    candidate(2, "A2", null, box(0.20, 0.05), { dismissed: true }),
    candidate(3, "A3", null, box(0.35, 0.05), { acceptedOutlineId: "outline-3" }),
    candidate(4, "A4", null, box(0.50, 0.05), { acceptedOutlineId: "outline-removed" }),
    candidate(5, "A5", null, box(0.65, 0.05)),
    candidate(6, "A6", null, { points: [[0.80, 0.05], [0.90, 0.05]] }),
    candidate(7, "A7", null, box(0.80, 0.20)),
    candidate(8, "A8", null, box(0.05, 0.40), { acceptedOutlineId: "outline-removed", dismissed: true }),
    candidate(9, "A9", null, box(0.20, 0.40), { dismissed: false }),
  ];
  const drawn = [
    outline("outline-3", box(0.35, 0.05), "row-3"),
    outline("drawn-by-hand", box(0.67, 0.07, 0.05, 0.05)),          // inside candidate 5
    outline("next-door", box(0.90, 0.20)),                          // shares a wall with candidate 7
  ];
  assert.deepEqual(match.openPlanCandidates(candidates, drawn).map(c => c.id), ["candidate-1", "candidate-4", "candidate-7", "candidate-9"]);
  // With nothing drawn, only the dismissed and the unreadable are left out; a saved one whose outline is gone is back.
  assert.deepEqual(match.openPlanCandidates(candidates, []).map(c => c.id), ["candidate-1", "candidate-3", "candidate-4", "candidate-5", "candidate-7", "candidate-9"]);
  // Once the removed outline's place is drawn again, its proposal is not offered a second time.
  assert.deepEqual(match.openPlanCandidates([candidates[3]], [outline("redrawn", box(0.52, 0.07, 0.2, 0.2))]), []);
  for (const shape of [null, {}, { points: [] }, { points: [[0.1, 0.1], [0.2, 0.2], [0.3, 0.3]] }, { points: [[0.1, 0.1], [0.3, 0.3], [0.3, 0.1], [0.1, 0.3]] }, { points: [[0.1, 0.1], [1.2, 0.1], [1.2, 0.3]] }]) {
    assert.deepEqual(match.openPlanCandidates([candidate(1, "A1", null, shape as any)], []), [], JSON.stringify(shape));
  }
  assert.deepEqual(match.openPlanCandidates(null, drawn), []);
  assert.deepEqual(match.openPlanCandidates(undefined, drawn), []);
  assert.deepEqual(match.openPlanCandidates([null as any, candidates[0]], []).map(c => c.id), ["candidate-1"]);
});

test("floors: one floor under its different names, and an unknown floor agrees and disagrees with nothing", () => {
  for (const name of ["Upper Level", "upper mall", "UPPER", "The Upper Floor", " upper  storey "]) assert.equal(floorKey(name), "upper", name);
  assert.equal(floorKey("Lower Ground Floor"), "lower ground");
  assert.equal(floorKey("Ground & First"), "ground and first");
  assert.notEqual(floorKey("Level 1"), floorKey("Level 2"));
  for (const blank of [null, undefined, "", "  ", "Level", "The Mall", "-"]) assert.equal(floorKey(blank), "", String(blank));
  assert.equal(sameFloor("Upper Level", "upper mall"), true);
  assert.equal(sameFloor("Upper Level", "Lower Level"), false);
  assert.equal(sameFloor("Level 1", "Level 2"), false);
  for (const [a, b] of [[null, null], ["", ""], ["Level", "Mall"], ["Upper Level", null], [undefined, "Upper Level"]]) assert.equal(sameFloor(a, b), false, `${a} / ${b}`);
  assert.equal(floorsDisagree("Upper Level", "Lower Level"), true);
  assert.equal(floorsDisagree("Level 1", "Level 2"), true);
  assert.equal(floorsDisagree("Upper Level", "UPPER MALL"), false);
  for (const [a, b] of [[null, "Lower Level"], ["Upper Level", null], ["", "Lower Level"], ["Upper Level", "  "], [null, null], ["Level", "Upper Level"]]) assert.equal(floorsDisagree(a, b), false, `${a} / ${b}`);
});

test("the bulk button takes a number or a name with nothing against it, and nothing else", () => {
  const proposal = (over: Partial<PlanMatchProposal>) => ({ suggestedRowId: "row", method: "code" as const, tenantDiffers: false, floorDiffers: false, ...over });
  assert.equal(bulkAcceptable(proposal({})), true);
  assert.equal(bulkAcceptable(proposal({ method: "tenant" })), true);
  assert.equal(bulkAcceptable(proposal({ method: "floor" })), false);
  assert.equal(bulkAcceptable(proposal({ tenantDiffers: true })), false);
  assert.equal(bulkAcceptable(proposal({ floorDiffers: true })), false);
  assert.equal(bulkAcceptable(proposal({ method: "tenant", floorDiffers: true })), false);
  assert.equal(bulkAcceptable(proposal({ suggestedRowId: null })), false);
  assert.equal(bulkAcceptable(proposal({ suggestedRowId: null, method: null })), false);
  assert.equal(bulkAcceptable(proposal({ method: null })), false);
});

test("the Match screen's counts", () => {
  const proposal = (id: string, over: Partial<PlanMatchProposal>): PlanMatchProposal =>
    ({ id, label: id, tenant: null, polygon: box(0.1, 0.1), suggestedRowId: null, method: null, possibleRowIds: [], tenantDiffers: false, floorDiffers: false, ...over });
  const planRow = (id: string, outlinedHere: boolean, outlinedElsewhere: boolean) => ({ id, label: id, tenant: null, floor: null, use: null, outlinedHere, outlinedElsewhere });
  assert.deepEqual(planMatchCounts({
    outlines: [
      { id: "o1", label: "WVL22", polygon: box(0.1, 0.1), scheduleRowId: "r1" },
      { id: "o2", label: "SVL02", polygon: box(0.3, 0.1), scheduleRowId: "r2" },
      { id: "o3", label: "Mall", polygon: box(0.5, 0.1), scheduleRowId: null },
    ],
    proposals: [
      proposal("p1", { suggestedRowId: "r3", method: "code" }),
      proposal("p2", { suggestedRowId: "r4", method: "tenant" }),
      proposal("p3", { suggestedRowId: "r5", method: "code", tenantDiffers: true }),
      proposal("p4", { suggestedRowId: "r6", method: "floor", possibleRowIds: ["r6", "r7"] }),
      proposal("p5", { possibleRowIds: ["r8"] }),
      proposal("p6", {}),
    ],
    rows: [planRow("r1", true, false), planRow("r2", true, true), planRow("r9", false, true), planRow("r3", false, false), planRow("r4", false, false)],
  }), { matched: 2, context: 1, toCheck: 6, suggested: 2, rowsNotDrawn: 2 });
  assert.deepEqual(planMatchCounts({ outlines: [], proposals: [], rows: [] }), { matched: 0, context: 0, toCheck: 0, suggested: 0, rowsNotDrawn: 0 });
});
