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

test("a code printed with a gap or a dash is still that unit", () => {
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

// ── Part 2: the real SQL, in a throwaway schema ──────────────────────────
const databaseUrl = process.env.PROPERTY_PAGE_DATABASE_URL;
const skip = !databaseUrl ? "set PROPERTY_PAGE_DATABASE_URL to a local PostgreSQL database that holds the app's tables to run the SQL checks"
  : !/@(localhost|127\.0\.0\.1)[:/]|host=%2F|@%2F/.test(databaseUrl) ? "PROPERTY_PAGE_DATABASE_URL must be a local database" : false;

// Every table the feed, the board and the three writes read, with what they
// call: resolveBrandIdSubquery (crm_companies), stageSinceFor (deal_audit_log)
// and validatePlanUnitLink (property_units).
const TABLES = ["crm_companies", "crm_properties", "tenancy_schedule_units", "available_units", "crm_deals", "unit_briefs", "landsec_units", "unit_viewings",
  "unit_offers", "unit_target_operators", "property_plans", "property_plan_units", "property_plan_scans", "deal_audit_log", "property_units"];
type Pool = InstanceType<typeof pg.Pool>;
type Insert = (table: string, row: Record<string, any>) => Promise<void>;

// One throwaway schema per test, so each starts empty; dropped whatever happens.
async function withSchema(work: (db: Pool, insert: Insert) => Promise<void>) {
  const schema = "property_page_" + randomUUID().replaceAll("-", "");
  const admin = new pg.Client({ connectionString: databaseUrl });
  // Every connection of this pool sees the throwaway schema and nothing else
  // (the pool opens a new connection after a failed statement, so a
  // search_path set by hand would be lost). Two or more connections: the
  // writes take one for their transaction while the plan is read on another.
  const db = new pg.Pool({ connectionString: databaseUrl, max: 4, options: `-c search_path=${schema},pg_catalog` });
  try {
    await admin.connect();
    await admin.query(`CREATE SCHEMA ${schema}`);
    // Same columns, defaults, checks and indexes as the real tables, none of their rows.
    for (const t of TABLES) await admin.query(`CREATE TABLE ${schema}.${t} (LIKE public.${t} INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES)`);
    // Two defaults draw on the real tables' sequences: never move those.
    await admin.query(`ALTER TABLE ${schema}.crm_deals ALTER COLUMN deal_ref DROP DEFAULT`);
    await admin.query(`ALTER TABLE ${schema}.deal_audit_log ALTER COLUMN id DROP DEFAULT`);
    // The outline's link to its schedule row, as on the real table (deleting the row clears the link).
    await admin.query(`ALTER TABLE ${schema}.property_plan_units ADD FOREIGN KEY (tenancy_unit_id) REFERENCES ${schema}.tenancy_schedule_units(id) ON DELETE SET NULL`);
    assert.deepEqual((await db.query(`SHOW search_path`)).rows, [{ search_path: `${schema},pg_catalog` }]);
    const insert: Insert = async (table, row) => {
      const cols = (await db.query(
        `SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 AND is_nullable = 'NO' AND column_default IS NULL`, [schema, table])).rows;
      const full: Record<string, any> = { ...row };
      for (const c of cols) if (!(c.column_name in full)) {
        full[c.column_name] = /int|real|double|numeric/.test(c.data_type) ? 0 : c.data_type === "boolean" ? false : c.data_type === "ARRAY" ? [] : /json/.test(c.data_type) ? "{}" : /timestamp|date/.test(c.data_type) ? "2026-01-01" : `${table}-${c.column_name}`;
      }
      const keys = Object.keys(full);
      await db.query(`INSERT INTO ${table} (${keys.join(", ")}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(", ")})`, keys.map(k => full[k]));
    };
    await work(db, insert);
  } finally {
    await db.end().catch(() => {});
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => {});
    await admin.end().catch(() => {});
  }
}

const TODAY = "2026-11-13";
const P = "prop-bluewater", OTHER = "prop-other";
const unitById = (feed: any, id: string) => feed.units.find((u: PropertyUnit) => u.id === id);
const failsWith = async (work: Promise<unknown>, status: number, pattern?: RegExp) => {
  const error: any = await work.then(() => null, e => e);
  assert.ok(error, `expected a ${status}, got success`);
  assert.equal(error.status, status, error.message);
  if (pattern) assert.match(error.message, pattern);
};

// A property with one unit for each thing the feed has to get right.
async function seedProperty(insert: Insert, db: Pool) {
  await insert("crm_properties", { id: P, name: "Bluewater" });
  await insert("crm_properties", { id: OTHER, name: "Elsewhere" });
  await insert("crm_companies", { id: "co-nandos", name: "Nando's" });
  await insert("crm_companies", { id: "co-tenant", name: "Pret A Manger" });
  const ts = (id: string, unit_number: string, over: Record<string, any> = {}) => insert("tenancy_schedule_units", { id, property_id: P, unit_number, floor_level: "Lower Level", ...over });
  // Let, with the lease ending inside a year; the brand found by its trading name.
  await ts("ts-let", "L001", { tenant_name: "Nando's Chickenland Limited", trading_name: "Nando's", status: "Occupied", passing_rent_pa: 50000, lease_expiry: "2027-03-01" });
  // Empty, nothing on the tracker.
  await ts("ts-empty", "L002", { status: "Vacant" });
  // Each of the four ways a tracker row belongs to a schedule row.
  await ts("ts-by-tracker-fk", "L003", { status: "Vacant" });
  await insert("available_units", { id: "au-fk", property_id: P, unit_name: "L003", tenancy_unit_id: "ts-by-tracker-fk", marketing_status: "AVA", deal_id: "d-fk", asking_rent: 42000, updated_at: "2026-11-01" });
  await insert("crm_deals", { id: "d-fk", name: "L003 letting", property_id: P, tenancy_unit_id: "ts-by-tracker-fk", deal_type: "New Letting", status: "NEG", deal_ref: 101, updated_at: "2026-11-01" });
  await ts("ts-by-row-link", "L004", { status: "Vacant", letting_tracker_unit_id: "au-row" });
  await insert("available_units", { id: "au-row", property_id: P, unit_name: "Something else", marketing_status: "AVA" });
  await insert("property_units", { id: "pu-5", property_id: P, unit_name: "L005" });
  await ts("ts-by-physical", "L005", { status: "Vacant", property_unit_id: "pu-5" });
  await insert("available_units", { id: "au-physical", property_id: P, unit_name: "Kiosk by the lifts", unit_id: "pu-5", marketing_status: "HOT" });
  await ts("ts-by-name", "L006", { status: "Vacant" });
  await insert("available_units", { id: "au-name", property_id: P, unit_name: "Unit L06", marketing_status: "NEG" });
  // Archived: not a unit, and its tracker row is not a tracker-only unit either.
  await ts("ts-archived", "L007", { status: "Archived" });
  await ts("ts-archived2", "L007A", { status: "Vacant", occupancy_status: "archived" });
  // Two live deals on one row: the letting is the unit's deal, the rent review sits on the unit too.
  await ts("ts-two-deals", "L008", { tenant_name: "Pret A Manger", status: "Occupied" });
  await insert("crm_deals", { id: "d-review", name: "L008 review", property_id: P, tenancy_unit_id: "ts-two-deals", deal_type: "Rent Review", status: "NEG", deal_ref: 102, updated_at: "2026-11-10" });
  await insert("crm_deals", { id: "d-letting", name: "L008 letting", property_id: P, tenancy_unit_id: "ts-two-deals", deal_type: "New Letting", status: "AVA", deal_ref: 103, updated_at: "2026-10-01" });
  // A deal the row names, carrying no property.
  await ts("ts-row-deal", "L009", { status: "Vacant", deal_id: "d-rowdeal" });
  await insert("crm_deals", { id: "d-rowdeal", name: "L009 letting", deal_type: "New Letting", status: "SOL", deal_ref: 104 });
  // On the tracker only.
  await insert("available_units", { id: "au-only", property_id: P, unit_name: "Kiosk 1", marketing_status: "AVA", deal_id: "d-only", sqft: 250, created_at: "2026-10-01" });
  await insert("crm_deals", { id: "d-only", name: "Kiosk 1 letting", property_id: P, deal_type: "New Letting", status: "NEG", deal_ref: 105 });
  await insert("available_units", { id: "au-only-noprop", property_id: P, unit_name: "Kiosk 2", marketing_status: "AVA", deal_id: "d-only-noprop" });
  await insert("crm_deals", { id: "d-only-noprop", name: "Kiosk 2 letting", deal_type: "New Letting", status: "HOT", deal_ref: 106 });
  await insert("available_units", { id: "au-only-let", property_id: P, unit_name: "Kiosk 3", marketing_status: "AVA", deal_id: "d-only-let" });
  await insert("crm_deals", { id: "d-only-let", name: "Kiosk 3 letting", property_id: P, deal_type: "New Letting", status: "COM", deal_ref: 107, tenant_id: "co-tenant" });
  // Open deals on the property on no unit; closed ones are not listed.
  await insert("crm_deals", { id: "d-loose", name: "Car park licence", property_id: P, deal_type: "Licence", status: "NEG", deal_ref: 108 });
  await insert("crm_deals", { id: "d-done", name: "Old letting", property_id: P, deal_type: "New Letting", status: "COM", deal_ref: 109 });
  // Days at stage come from the audit log.
  await insert("deal_audit_log", { id: 1, deal_id: "d-fk", field: "status", new_value: "NEG", created_at: "2026-01-05" });
  // The tracker row's brief, viewings, offers and targets.
  await insert("unit_briefs", { id: "br-fk", unit_id: "au-fk", property_id: P, title: "L003 brief", agreed_at: "2026-11-02" });
  await insert("unit_target_operators", { id: "tg-1", brief_id: "br-fk", operator_name: "Wingstop", status: "Approached" });
  await insert("landsec_units", { id: "lu-row", tenancy_unit_id: "ts-by-row-link", property_id: P, brief_use: "Food" });
  await insert("unit_viewings", { id: "v-1", unit_id: "au-fk", company_name: "Wingstop", contact_name: "Jane Brand", viewing_date: "2026-11-05", status: "completed" });
  await insert("unit_viewings", { id: "v-2", unit_id: "au-fk", company_name: "Five Guys", contact_name: "Sam Agent", viewing_date: "2026-11-06", status: "scheduled" });
  await insert("unit_viewings", { id: "v-gone", unit_id: "au-fk", company_name: "Deleted", viewing_date: "2026-11-07", deleted_at: "2026-11-08" });
  await insert("unit_offers", { id: "of-1", unit_id: "au-fk", company_name: "Wingstop", offer_date: "2026-11-09", rent_pa: 40000, status: "Negotiating" });
  await insert("unit_offers", { id: "of-old", unit_id: "au-fk", company_name: "Earlier", offer_date: "2025-01-01", status: "Closed" });
  // A row on the other property.
  await insert("tenancy_schedule_units", { id: "ts-elsewhere", property_id: OTHER, unit_number: "L001" });
  void db;
}

const shape = (n: number) => box(0.05 + 0.12 * ((n - 1) % 7), 0.05 + 0.15 * Math.floor((n - 1) / 7));
async function plan(insert: Insert, id: string, floor: string, storage_key: string, display_order = 0) {
  await insert("property_plans", { id, property_id: P, floor, storage_key, display_order });
}
async function scan(insert: Insert, id: string, planId: string, image_key: string, candidates: any[], over: Record<string, any> = {}) {
  await insert("property_plan_scans", { id, plan_id: planId, image_key, status: "ready", candidates: JSON.stringify(candidates), ...over });
}
const outline = (insert: Insert, id: string, planId: string, polygon: PropertyPlanPolygon, tenancy_unit_id: string | null = null, unit_id: string | null = null) =>
  insert("property_plan_units", { id, plan_id: planId, polygon: JSON.stringify(polygon), tenancy_unit_id, unit_id, label: id });
const PLAN_A = "00000000-0000-4000-8000-00000000000a", PLAN_B = "00000000-0000-4000-8000-00000000000b";
const SCAN_A = "00000000-0000-4000-8000-0000000000a1", SCAN_B = "00000000-0000-4000-8000-0000000000b1";
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const all = async () => true;

test("the unit feed from real rows: occupancy, stage, flags, the tracker's four links, archived rows, the live deal, unplaced deals", { skip }, async () => {
  await withSchema(async (db, insert) => {
    await seedProperty(insert, db);
    const feed = (await units.loadPropertyUnits(db, P, TODAY))!;
    assert.deepEqual(feed.property, { id: P, name: "Bluewater" });
    assert.equal(await units.loadPropertyUnits(db, "no-such-property", TODAY), null);
    // Each unit once: no archived row, no tracker row that belongs to a schedule row.
    assert.deepEqual(feed.units.map(u => u.id), ["ts-let", "ts-empty", "ts-by-tracker-fk", "ts-by-row-link", "ts-by-physical", "ts-by-name", "ts-two-deals", "ts-row-deal",
      "tracker:au-only", "tracker:au-only-noprop", "tracker:au-only-let"]);

    const let_ = unitById(feed, "ts-let");
    assert.deepEqual([let_.occupancy, let_.stage, let_.tenant.name, let_.tenant.legalName, let_.tenant.companyId, let_.passingRent], ["occupied", null, "Nando's", "Nando's Chickenland Limited", "co-nandos", 50000]);
    assert.equal(let_.leaseExpiry, "2027-03-01");
    assert.equal(let_.flags.expiryOrBreakSoon, true);
    const empty = unitById(feed, "ts-empty");
    assert.deepEqual([empty.occupancy, empty.stage, empty.trackerId, empty.flags.vacantNoLetting, empty.flags.noAgreedBrief], ["vacant", null, null, true, true]);

    // Linked by the tracker row's own tenancy link: its deal decides the stage.
    const fk = unitById(feed, "ts-by-tracker-fk");
    assert.deepEqual([fk.trackerId, fk.stage, fk.deal?.id, fk.deal?.ref, fk.deal?.code, fk.deal?.letting, fk.quotingRent, fk.brief], ["au-fk", "NEG", "d-fk", 101, "NEG", true, 42000, "agreed"]);
    assert.ok(fk.deal.days >= 300, `days at stage from the audit log, not the deal row: ${fk.deal.days}`);
    assert.equal(fk.flags.stuck, true);
    assert.deepEqual(fk.counts, { viewings: 2, offers: 1, targets: 1 });
    // Linked by the schedule row naming its tracker row; the older two-signature brief reads as drafted.
    const rowLink = unitById(feed, "ts-by-row-link");
    assert.deepEqual([rowLink.trackerId, rowLink.stage, rowLink.brief, rowLink.flags.noAgreedBrief], ["au-row", "AVA", "drafted", true]);
    // Linked through the physical unit both carry, and by the unit's name: the
    // tracker row is not a second unit, and its stage is this unit's stage.
    const physical = unitById(feed, "ts-by-physical");
    assert.deepEqual([physical.trackerId, physical.stage], ["au-physical", "HOT"], "the tracker row matched by the physical unit is this unit's");
    const byName = unitById(feed, "ts-by-name");
    assert.deepEqual([byName.trackerId, byName.stage], ["au-name", "NEG"], "the tracker row matched by the unit's name is this unit's");

    // Two live deals: the letting is the unit's deal and the rent review is not an unplaced deal.
    const two = unitById(feed, "ts-two-deals");
    assert.deepEqual([two.deal?.id, two.stage, two.occupancy], ["d-letting", "AVA", "occupied"]);
    // The deal the row itself names, though it carries no property.
    const rowDeal = unitById(feed, "ts-row-deal");
    assert.deepEqual([rowDeal.deal?.id, rowDeal.stage], ["d-rowdeal", "SOL"]);

    // On the tracker only.
    const only = unitById(feed, "tracker:au-only");
    assert.deepEqual([only.scheduleRowId, only.trackerId, only.label, only.sqft, only.stage, only.occupancy, only.deal?.id, only.flags.notOnSchedule, only.tenant.name],
      [null, "au-only", "Kiosk 1", 250, "NEG", "vacant", "d-only", true, null]);
    const noProp = unitById(feed, "tracker:au-only-noprop");
    assert.deepEqual([noProp.stage, noProp.deal?.id], ["HOT", "d-only-noprop"], "a live deal the stage is read from is the unit's deal, whatever property the deal row carries");
    const done = unitById(feed, "tracker:au-only-let");
    assert.deepEqual([done.stage, done.occupancy, done.deal, done.tenant.name], [null, "occupied", null, "Pret A Manger"]);

    assert.deepEqual(feed.unplacedDeals.map(d => d.id), ["d-loose"], "only the open deal that sits on no unit");
    assert.equal(feed.counts.units, feed.units.length);
    assert.equal(feed.counts.liveLettings, feed.units.filter(u => u.stage).length);
    assert.deepEqual(feed.counts.stages, { OPP: 0, AVA: 2, NEG: 3, HOT: 2, SOL: 1 });
  });
});

test("a plan's proposals in the feed are the board's proposals: not dismissed, not saved, not under a drawn outline, from the current scan", { skip }, async () => {
  await withSchema(async (db, insert) => {
    await seedProperty(insert, db);
    await plan(insert, PLAN_A, "Lower Level", "key-a");
    await plan(insert, PLAN_B, "Upper Level", "key-b", 1);
    await outline(insert, uuid(1), PLAN_A, shape(10), "ts-let");
    await outline(insert, uuid(3), PLAN_A, shape(3), "ts-by-tracker-fk");
    await outline(insert, uuid(5), PLAN_A, box(shape(5).points[0][0] + 0.02, shape(5).points[0][1] + 0.02, 0.05, 0.05));   // drawn by hand over candidate 5
    await scan(insert, SCAN_A, PLAN_A, "key-a", [
      candidate(1, "L002", null, shape(1)),
      candidate(2, "Mall", null, shape(2), { dismissed: true }),
      candidate(3, "L003", null, shape(3), { acceptedOutlineId: uuid(3) }),
      candidate(4, "L004", null, shape(4), { acceptedOutlineId: uuid(4) }),     // its outline was removed
      candidate(5, "L005", null, shape(5)),
    ]);
    const count = async () => (await units.loadPropertyUnits(db, P, TODAY))!.plans.map(p => [p.id, p.proposals, p.outlines, p.unlinkedOutlines]);
    const board = async (id: string) => (await match.loadPlanMatchBoard(db, (await db.query("SELECT * FROM property_plans WHERE id = $1", [id])).rows[0], { canScan: false })).proposals.map(p => p.id);
    assert.deepEqual(await board(PLAN_A), ["candidate-1", "candidate-4"]);
    assert.deepEqual(await count(), [[PLAN_A, 2, 3, 1], [PLAN_B, 0, 0, 0]], "the feed counts what the board lists");
    // The saved outline is deleted: its proposal is back, in both.
    await db.query("DELETE FROM property_plan_units WHERE id = $1", [uuid(3)]);
    assert.deepEqual(await board(PLAN_A), ["candidate-1", "candidate-3", "candidate-4"]);
    assert.deepEqual((await count())[0], [PLAN_A, 3, 2, 1]);
    // A newer scan of the same image that failed: the board shows no proposals, nor does the feed.
    await scan(insert, uuid(90), PLAN_A, "key-a", [], { status: "failed", created_at: "2099-01-01" });
    assert.deepEqual(await board(PLAN_A), []);
    assert.deepEqual((await count())[0], [PLAN_A, 0, 2, 1]);
    // A scan of an image the plan no longer shows proposes nothing.
    await scan(insert, SCAN_B, PLAN_B, "key-old", [candidate(1, "L002", null, shape(1))]);
    assert.deepEqual(await board(PLAN_B), []);
    assert.deepEqual((await count())[1], [PLAN_B, 0, 0, 0]);
    // The outlines on the units, and the not-on-plan flag.
    const feed = (await units.loadPropertyUnits(db, P, TODAY))!;
    assert.deepEqual(unitById(feed, "ts-let").outlines, [{ planId: PLAN_A, outlineId: uuid(1) }]);
    assert.equal(unitById(feed, "ts-let").flags.notOnPlan, false);
    assert.equal(unitById(feed, "ts-empty").flags.notOnPlan, true);
    assert.equal(feed.counts.onPlan, 1);
  });
});

test("the feed runs the same number of queries for 3 units as for 30", { skip }, async () => {
  await withSchema(async (db, insert) => {
    await insert("crm_properties", { id: P, name: "Bluewater" });
    await insert("crm_properties", { id: OTHER, name: "Elsewhere" });
    for (const [property, n] of [[P, 3], [OTHER, 30]] as const) {
      await insert("property_plans", { id: property === P ? PLAN_A : PLAN_B, property_id: property, floor: "Ground", storage_key: "k" });
      for (let i = 1; i <= n; i++) {
        const id = `${property}-${i}`;
        await insert("tenancy_schedule_units", { id: `ts-${id}`, property_id: property, unit_number: `U${i}`, status: "Vacant" });
        await insert("available_units", { id: `au-${id}`, property_id: property, unit_name: `U${i}`, tenancy_unit_id: `ts-${id}`, marketing_status: "AVA", deal_id: `d-${id}` });
        await insert("crm_deals", { id: `d-${id}`, name: `Deal ${id}`, property_id: property, tenancy_unit_id: `ts-${id}`, deal_type: "New Letting", status: "NEG", deal_ref: (property === P ? 0 : 1000) + i });
        await insert("unit_viewings", { id: `v-${id}`, unit_id: `au-${id}`, viewing_date: "2026-11-01" });
        await insert("available_units", { id: `only-${id}`, property_id: property, unit_name: `Kiosk ${i}`, marketing_status: "AVA" });
      }
    }
    const counted = () => { const c = { n: 0, query: (sql: string, values?: any[]) => { c.n++; return db.query(sql, values); } }; return c; };
    const small = counted(), large = counted();
    const a = (await units.loadPropertyUnits(small, P, TODAY))!, b = (await units.loadPropertyUnits(large, OTHER, TODAY))!;
    assert.deepEqual([a.units.length, b.units.length], [6, 60]);
    assert.equal(small.n, large.n);
    assert.ok(small.n <= 10, `${small.n} queries`);
  });
});

test("the unit panel: found by schedule row or tracker row, the brand's contact for BGP staff only, nothing from another property", { skip }, async () => {
  await withSchema(async (db, insert) => {
    await seedProperty(insert, db);
    const staff = (await units.loadPropertyUnitDetail(db, P, "ts-by-tracker-fk", { staff: true }, TODAY))!;
    assert.equal(staff.unit.id, "ts-by-tracker-fk");
    assert.deepEqual(staff.tracker?.viewings.map(v => [v.company, v.contact]), [["Five Guys", "Sam Agent"], ["Wingstop", "Jane Brand"]]);
    assert.deepEqual(staff.tracker?.offers.map(o => [o.company, o.rentPa, o.status]), [["Wingstop", 40000, "Negotiating"]]);
    assert.deepEqual(staff.brief?.targets.map(t => t.name), ["Wingstop"]);
    assert.deepEqual(staff.deals.map(d => d.id), ["d-fk"]);
    const client = (await units.loadPropertyUnitDetail(db, P, "ts-by-tracker-fk", { staff: false }, TODAY))!;
    assert.deepEqual(client.tracker?.viewings.map(v => [v.company, v.contact]), [["Five Guys", null], ["Wingstop", null]]);
    assert.ok(!JSON.stringify(client).includes("Jane Brand") && !JSON.stringify(client).includes("Sam Agent"));
    // By the tracker row's id, and as a tracker-only unit.
    assert.equal((await units.loadPropertyUnitDetail(db, P, "au-fk", { staff: true }, TODAY))?.unit.id, "ts-by-tracker-fk");
    const only = (await units.loadPropertyUnitDetail(db, P, "tracker:au-only", { staff: true }, TODAY))!;
    assert.deepEqual([only.unit.id, only.schedule, only.tracker?.id, only.deals.map(d => d.id)], ["tracker:au-only", null, "au-only", ["d-only"]]);
    // Every open deal on the unit, the letting first.
    assert.deepEqual((await units.loadPropertyUnitDetail(db, P, "ts-two-deals", { staff: true }, TODAY))!.deals.map(d => d.id), ["d-letting", "d-review"]);
    // The panel lists the deal the feed's line shows.
    for (const id of ["ts-row-deal", "tracker:au-only-noprop"]) {
      const detail = (await units.loadPropertyUnitDetail(db, P, id, { staff: true }, TODAY))!;
      assert.ok(detail.unit.deal, id);
      assert.deepEqual(detail.deals.map(d => d.id), [detail.unit.deal!.id], id);
    }
    // Another property's unit, an archived row and nonsense are not found.
    for (const [property, id] of [[OTHER, "ts-let"], [P, "ts-elsewhere"], [OTHER, "au-fk"], [P, "ts-archived"], [P, "nope"]]) {
      assert.equal(await units.loadPropertyUnitDetail(db, property, id, { staff: true }, TODAY), null, `${property} / ${id}`);
    }
  });
});

test("the Match board from real rows: live rows only, what is outlined here and elsewhere, suggestions against the free rows", { skip }, async () => {
  await withSchema(async (db, insert) => {
    await seedProperty(insert, db);
    await plan(insert, PLAN_A, "Lower Level", "key-a");
    await plan(insert, PLAN_B, "Upper Level", "key-b", 1);
    await outline(insert, uuid(1), PLAN_A, shape(10), "ts-let");
    await outline(insert, uuid(2), PLAN_B, shape(10), "ts-empty");
    await outline(insert, uuid(3), PLAN_A, shape(11));
    await scan(insert, SCAN_A, PLAN_A, "key-a", [candidate(1, "L001", "Nando's", shape(1)), candidate(2, "L002", null, shape(2)), candidate(3, "L007", null, shape(3)), candidate(4, "Unlabelled 4", null, shape(4), { dismissed: true })]);
    const planA = (await db.query("SELECT * FROM property_plans WHERE id = $1", [PLAN_A])).rows[0];
    const b = await match.loadPlanMatchBoard(db, planA, { canScan: true });
    assert.deepEqual([b.plan.id, b.plan.propertyId, b.plan.floor, b.scan?.id, b.scan?.status, b.dismissed, b.canScan], [PLAN_A, P, "Lower Level", SCAN_A, "ready", 1, true]);
    assert.deepEqual(b.outlines.map(o => [o.id, o.scheduleRowId]), [[uuid(1), "ts-let"], [uuid(3), null]]);
    assert.ok(!b.rows.some(r => r.id.startsWith("ts-archived") || r.id === "ts-elsewhere"), "no archived row, no other property's row");
    const flags = Object.fromEntries(b.rows.map(r => [r.id, [r.outlinedHere, r.outlinedElsewhere]]));
    assert.deepEqual([flags["ts-let"], flags["ts-empty"], flags["ts-by-name"]], [[true, false], [false, true], [false, false]]);
    // L001 is already outlined here, so it is no one's suggestion; L002 is; the archived L007 matches nothing.
    assert.deepEqual(b.proposals.map(p => [p.id, p.suggestedRowId, p.method]), [["candidate-1", null, null], ["candidate-2", "ts-empty", "code"], ["candidate-3", null, null]]);
    assert.deepEqual(planMatchCounts(b), { matched: 1, context: 1, toCheck: 3, suggested: 1, rowsNotDrawn: b.rows.length - 2 });
  });
});

test("saving one proposal: linked, as context, asked twice, and every refusal", { skip }, async () => {
  await withSchema(async (db, insert) => {
    await seedProperty(insert, db);
    await plan(insert, PLAN_A, "Lower Level", "key-a");
    await scan(insert, SCAN_A, PLAN_A, "key-a", [
      candidate(1, "L002", null, shape(1)),
      candidate(2, "Mall", null, shape(2)),
      candidate(3, "L003", null, box(shape(1).points[0][0] + 0.05, shape(1).points[0][1] + 0.05)),   // overlaps candidate 1
      candidate(4, "L002 again", null, shape(4)),
      candidate(5, "Elsewhere", null, shape(5)),
      candidate(6, "Bad", null, { points: [[0.1, 0.1], [0.2, 0.2]] }),
      candidate(7, "L005", null, shape(7)),
      candidate(8, "L007", null, shape(8)),
      candidate(9, "L006", null, shape(9), { dismissed: true }),
    ]);
    const accept = (choice: any, scanId = SCAN_A, access = all) => match.acceptPlanProposal(db, PLAN_A, scanId, choice, access);
    const outlines = async () => (await db.query("SELECT id, tenancy_unit_id, unit_id, label FROM property_plan_units WHERE plan_id = $1 ORDER BY created_at, id", [PLAN_A])).rows;
    const stored = async (scanId = SCAN_A) => (await db.query("SELECT candidates FROM property_plan_scans WHERE id = $1", [scanId])).rows[0].candidates;

    const first = await accept({ candidateId: "candidate-1", scheduleRowId: "ts-empty" });
    assert.equal(first.reused, false);
    assert.deepEqual(await outlines(), [{ id: first.outlineId, tenancy_unit_id: "ts-empty", unit_id: null, label: "L002" }]);
    assert.equal((await stored()).find((c: any) => c.id === "candidate-1").acceptedOutlineId, first.outlineId);
    // The same call again hands back the same outline.
    assert.deepEqual(await accept({ candidateId: "candidate-1", scheduleRowId: "ts-empty" }), { outlineId: first.outlineId, reused: true });
    // The same proposal for a different row is not quietly the first outline.
    await failsWith(accept({ candidateId: "candidate-1", scheduleRowId: "ts-by-name" }), 409);
    await failsWith(accept({ candidateId: "candidate-1" }), 409);
    assert.equal((await outlines()).length, 1);

    // As context, with the label a person typed.
    const context = await accept({ candidateId: "candidate-2", scheduleRowId: null, label: "  Mall walkway " });
    assert.deepEqual((await outlines()).find((o: any) => o.id === context.outlineId), { id: context.outlineId, tenancy_unit_id: null, unit_id: null, label: "Mall walkway" });
    // A physical unit behind the row comes with the link.
    const physical = await accept({ candidateId: "candidate-7", scheduleRowId: "ts-by-physical" });
    assert.deepEqual((await outlines()).find((o: any) => o.id === physical.outlineId)?.unit_id, "pu-5");
    // A dismissed proposal can still be saved, and is no longer dismissed.
    await accept({ candidateId: "candidate-9", scheduleRowId: "ts-by-name" });
    assert.equal((await stored()).find((c: any) => c.id === "candidate-9").dismissed, false);

    await failsWith(accept({ candidateId: "candidate-3", scheduleRowId: "ts-by-tracker-fk" }), 409, /already drawn/);
    await failsWith(accept({ candidateId: "candidate-4", scheduleRowId: "ts-empty" }), 409, /already has an outline/);
    await failsWith(accept({ candidateId: "candidate-5", scheduleRowId: "ts-elsewhere" }), 400, /belonging to this property/);
    await failsWith(accept({ candidateId: "candidate-8", scheduleRowId: "ts-archived" }), 400);
    await failsWith(accept({ candidateId: "candidate-6", scheduleRowId: null }), 409, /could not be read/);
    await failsWith(accept({ candidateId: "candidate-99" }), 404);
    await failsWith(accept({ candidateId: "candidate-x" }), 400);
    await failsWith(accept({ candidateId: "candidate-5", scheduleRowId: "" }), 400);
    await failsWith(accept({ candidateId: "candidate-5", label: "x".repeat(161) }), 400);
    await failsWith(accept({ candidateId: "candidate-5" }, "not-a-uuid"), 400);
    await failsWith(accept({ candidateId: "candidate-5" }, uuid(77)), 404);
    await failsWith(accept({ candidateId: "candidate-5" }, SCAN_A, async () => false), 403);
    await failsWith(match.acceptPlanProposal(db, uuid(78), SCAN_A, { candidateId: "candidate-5" }, all), 404);
    // A scan of an older image, an applied scan and an unfinished one are not saved from.
    await scan(insert, uuid(91), PLAN_A, "key-old", [candidate(1, "L002", null, shape(20))]);
    await failsWith(accept({ candidateId: "candidate-1" }, uuid(91)), 409, /image changed/);
    await scan(insert, uuid(92), PLAN_A, "key-a", [candidate(1, "L002", null, shape(20))], { status: "applied" });
    await failsWith(accept({ candidateId: "candidate-1" }, uuid(92)), 409, /already been saved/);
    await scan(insert, uuid(93), PLAN_A, "key-a", [candidate(1, "L002", null, shape(20))], { status: "failed" });
    await failsWith(accept({ candidateId: "candidate-1" }, uuid(93)), 409, /Wait for this scan/);
    // Nothing a refusal touched was written.
    assert.equal((await outlines()).length, 4);
    assert.equal((await outlines()).filter((o: any) => o.tenancy_unit_id === "ts-empty").length, 1);
  });
});

test("Accept the suggested matches: only the clean ones, the rest skipped with a reason, never two outlines for one row", { skip }, async () => {
  await withSchema(async (db, insert) => {
    await seedProperty(insert, db);
    await plan(insert, PLAN_A, "Lower Level", "key-a");
    // A physical unit already drawn by hand on this plan, with no schedule row picked.
    await outline(insert, uuid(1), PLAN_A, shape(14), null, "pu-5");
    await scan(insert, SCAN_A, PLAN_A, "key-a", [
      candidate(1, "L002", null, shape(1)),                       // clean: saved
      candidate(2, "L001", "Costa", shape(2)),                    // the plan names another tenant: one at a time
      candidate(3, "L004", null, shape(3)),                       // clean: saved
      candidate(4, "L006", null, box(shape(3).points[0][0] + 0.05, shape(3).points[0][1] + 0.05)),   // overlaps candidate 3
      candidate(5, "L005", null, shape(5)),                       // its physical unit is already drawn
      candidate(6, "L008", null, shape(6)),                       // two proposals for one row
      candidate(7, "L008", null, shape(7)),
      candidate(8, "L009", null, shape(8), { dismissed: true }),  // dismissed
      candidate(9, "Unlabelled 9", null, shape(9)),               // nothing to go on
    ]);
    const run = () => match.acceptSuggestedPlanProposals(db, PLAN_A, SCAN_A, all);
    const result = await run();
    assert.equal(result.created, 2);
    assert.deepEqual(result.skipped, [{ label: "L006", reason: "It overlaps another outline." }, { label: "L005", reason: "Its unit already has an outline on this floor." }]);
    const rows = (await db.query("SELECT tenancy_unit_id, label FROM property_plan_units WHERE plan_id = $1 AND tenancy_unit_id IS NOT NULL ORDER BY label", [PLAN_A])).rows;
    assert.deepEqual(rows, [{ tenancy_unit_id: "ts-empty", label: "L002" }, { tenancy_unit_id: "ts-by-row-link", label: "L004" }]);
    const stored = (await db.query("SELECT candidates FROM property_plan_scans WHERE id = $1", [SCAN_A])).rows[0].candidates;
    assert.deepEqual(stored.filter((c: any) => c.acceptedOutlineId).map((c: any) => c.id), ["candidate-1", "candidate-3"]);
    assert.equal(stored.find((c: any) => c.id === "candidate-8").dismissed, true);
    // Again: nothing new, and no row with two outlines.
    const again = await run();
    assert.equal(again.created, 0);
    const per = (await db.query("SELECT tenancy_unit_id, count(*)::int AS n FROM property_plan_units WHERE plan_id = $1 AND tenancy_unit_id IS NOT NULL GROUP BY 1", [PLAN_A])).rows;
    assert.ok(per.every((r: any) => r.n === 1));
    // The board and the feed agree on what is left; the one skipped for overlapping now sits under a saved outline.
    const planA = (await db.query("SELECT * FROM property_plans WHERE id = $1", [PLAN_A])).rows[0];
    const left = (await match.loadPlanMatchBoard(db, planA, { canScan: false })).proposals.map(p => p.id);
    assert.deepEqual(left, ["candidate-2", "candidate-5", "candidate-6", "candidate-7", "candidate-9"]);
    assert.equal((await units.loadPropertyUnits(db, P, TODAY))!.plans[0].proposals, left.length);
    // An applied scan or an older image is refused.
    await scan(insert, uuid(92), PLAN_A, "key-a", [], { status: "applied" });
    await failsWith(match.acceptSuggestedPlanProposals(db, PLAN_A, uuid(92), all), 409);
  });
});

test("two outlines of one height, one half over the other, overlap", async () => {
  const { planPolygonsOverlap } = await import("./plan-unit-detection");
  const corners = (b: PropertyPlanPolygon) => b.points.map(([x, y]) => ({ x, y }));
  assert.equal(planPolygonsOverlap(corners(box(0.3, 0.2)), corners(box(0.35, 0.2))), true);
});

test("Not a unit: dismiss, put one back, put all back, and never dismiss a saved outline", { skip }, async () => {
  await withSchema(async (db, insert) => {
    await seedProperty(insert, db);
    await plan(insert, PLAN_A, "Lower Level", "key-a");
    await scan(insert, SCAN_A, PLAN_A, "key-a", [candidate(1, "Mall", null, shape(1)), candidate(2, "Void", null, shape(2)), candidate(3, "L002", null, shape(3)), candidate(4, "L004", null, shape(4))]);
    const dismiss = (body: any) => match.dismissPlanProposal(db, PLAN_A, SCAN_A, body, all);
    const planA = (await db.query("SELECT * FROM property_plans WHERE id = $1", [PLAN_A])).rows[0];
    const open = async () => (await match.loadPlanMatchBoard(db, planA, { canScan: false })).proposals.map(p => p.id);
    assert.deepEqual(await dismiss({ candidateId: "candidate-1" }), { dismissed: 1 });
    assert.deepEqual(await dismiss({ candidateId: "candidate-1" }), { dismissed: 1 }, "twice is still one");
    assert.deepEqual(await open(), ["candidate-2", "candidate-3", "candidate-4"]);
    assert.equal((await units.loadPropertyUnits(db, P, TODAY))!.plans[0].proposals, 3);
    assert.deepEqual(await dismiss({ candidateId: "candidate-1", dismissed: false }), { dismissed: 0 });
    assert.deepEqual(await dismiss({ candidateId: "candidate-2" }), { dismissed: 1 });
    assert.deepEqual(await dismiss({ candidateId: "candidate-1" }), { dismissed: 2 });
    assert.deepEqual(await dismiss({ restoreAll: true }), { dismissed: 0 });
    assert.deepEqual(await open(), ["candidate-1", "candidate-2", "candidate-3", "candidate-4"]);
    // A saved proposal cannot be dismissed; once its outline is removed it can.
    const saved = await match.acceptPlanProposal(db, PLAN_A, SCAN_A, { candidateId: "candidate-3", scheduleRowId: "ts-empty" }, all);
    await failsWith(dismiss({ candidateId: "candidate-3" }), 409, /has been saved/);
    await db.query("DELETE FROM property_plan_units WHERE id = $1", [saved.outlineId]);
    assert.deepEqual(await dismiss({ candidateId: "candidate-3" }), { dismissed: 1 });
    await failsWith(dismiss({ candidateId: "candidate-99" }), 404);
    await failsWith(dismiss({}), 400);
    await failsWith(match.dismissPlanProposal(db, PLAN_A, SCAN_A, { candidateId: "candidate-1" }, async () => false), 403);
    await scan(insert, uuid(92), PLAN_A, "key-a", [candidate(1, "Mall", null, shape(1))], { status: "applied" });
    await failsWith(match.dismissPlanProposal(db, PLAN_A, uuid(92), { candidateId: "candidate-1" }, all), 409);
  });
});

test("an outline kept as context is marked unlinked on purpose; one on a schedule row is not", { skip }, async () => {
  await withSchema(async (db, insert) => {
    await seedProperty(insert, db);
    await plan(insert, PLAN_A, "Lower Level", "key-a");
    await scan(insert, SCAN_A, PLAN_A, "key-a", [candidate(1, "Mall", null, shape(1)), candidate(2, "L002", null, shape(2))]);
    const context = await match.acceptPlanProposal(db, PLAN_A, SCAN_A, { candidateId: "candidate-1", scheduleRowId: null }, all);
    const linked = await match.acceptPlanProposal(db, PLAN_A, SCAN_A, { candidateId: "candidate-2", scheduleRowId: "ts-empty" }, all);
    const saved = (await db.query("SELECT id, tenancy_unit_id, status_override FROM property_plan_units WHERE plan_id = $1", [PLAN_A])).rows;
    assert.deepEqual(saved.find((o: any) => o.id === context.outlineId), { id: context.outlineId, tenancy_unit_id: null, status_override: "unlinked" });
    assert.deepEqual(saved.find((o: any) => o.id === linked.outlineId), { id: linked.outlineId, tenancy_unit_id: "ts-empty", status_override: null });
  });
});

test("the stage is the letting's: a rent review on a let unit is not a live letting", { skip }, async () => {
  await withSchema(async (db, insert) => {
    await insert("crm_properties", { id: P, name: "Bluewater" });
    const ts = (id: string, unit_number: string, over: Record<string, any> = {}) => insert("tenancy_schedule_units", { id, property_id: P, unit_number, floor_level: "Lower Level", ...over });
    // Let: the letting that put the tenant in is complete, and a rent review is now running on the row.
    await ts("ts-pret", "L003", { tenant_name: "Pret A Manger", status: "Occupied" });
    await insert("available_units", { id: "au-pret", property_id: P, unit_name: "L003", tenancy_unit_id: "ts-pret", marketing_status: "COM", deal_id: "d-pret-let" });
    await insert("crm_deals", { id: "d-pret-let", name: "L003 letting", property_id: P, tenancy_unit_id: "ts-pret", deal_type: "New Letting", status: "COM", deal_ref: 201 });
    await insert("crm_deals", { id: "d-pret-review", name: "L003 rent review", property_id: P, tenancy_unit_id: "ts-pret", deal_type: "Rent Review", status: "NEG", deal_ref: 202, stage_entered_at: "2026-08-01" });
    // A tracker row whose own deal is not a letting type still takes its stage from that deal.
    await ts("ts-own", "L004", { status: "Vacant" });
    await insert("available_units", { id: "au-own", property_id: P, unit_name: "L004", tenancy_unit_id: "ts-own", marketing_status: "AVA", deal_id: "d-own" });
    await insert("crm_deals", { id: "d-own", name: "L004", property_id: P, tenancy_unit_id: "ts-own", deal_type: null, status: "HOT", deal_ref: 203 });
    const feed = (await units.loadPropertyUnits(db, P, TODAY))!;
    const pret = unitById(feed, "ts-pret");
    assert.deepEqual([pret.occupancy, pret.stage, pret.deal?.id, pret.flags.stuck, pret.flags.noAgreedBrief], ["occupied", null, "d-pret-review", false, false]);
    assert.equal(unitById(feed, "ts-own").stage, "HOT");
    assert.deepEqual([feed.counts.liveLettings, feed.counts.stages.NEG, feed.counts.stages.HOT], [1, 0, 1]);
  });
});

test("an archived row: kept only for a live letting of its own, never as a second copy of the row that replaced it", { skip }, async () => {
  await withSchema(async (db, insert) => {
    await insert("crm_properties", { id: P, name: "Bluewater" });
    await plan(insert, PLAN_A, "Lower Level", "key-a");
    const ts = (id: string, unit_number: string, over: Record<string, any> = {}) => insert("tenancy_schedule_units", { id, property_id: P, unit_number, floor_level: "Lower Level", ...over });
    // The old row still points at the tracker row that now belongs to its replacement.
    await insert("available_units", { id: "au-5", property_id: P, unit_name: "L005", tenancy_unit_id: "ts-new", marketing_status: "AVA", deal_id: "d-5" });
    await insert("crm_deals", { id: "d-5", name: "L005 letting", property_id: P, tenancy_unit_id: "ts-new", deal_type: "New Letting", status: "AVA", deal_ref: 301 });
    await ts("ts-old", "L005", { status: "Archived", letting_tracker_unit_id: "au-5" });
    await ts("ts-new", "L005", { status: "Vacant" });
    // An archived row with only a rent review on it is history.
    await ts("ts-old-review", "L006", { status: "Archived" });
    await insert("crm_deals", { id: "d-6", name: "L006 review", property_id: P, tenancy_unit_id: "ts-old-review", deal_type: "Rent Review", status: "NEG", deal_ref: 302 });
    // An archived row whose own letting is still running is kept, says nothing of occupancy and is never "not on the plan".
    await ts("ts-old-live", "L007", { status: "Archived", tenant_name: "Old Tenant Ltd" });
    await insert("available_units", { id: "au-7", property_id: P, unit_name: "L007", tenancy_unit_id: "ts-old-live", marketing_status: "NEG", deal_id: "d-7" });
    await insert("crm_deals", { id: "d-7", name: "L007 letting", property_id: P, tenancy_unit_id: "ts-old-live", deal_type: "New Letting", status: "NEG", deal_ref: 303 });
    const feed = (await units.loadPropertyUnits(db, P, TODAY))!;
    assert.deepEqual(feed.units.map(u => u.id).sort(), ["ts-new", "ts-old-live"]);
    assert.deepEqual([feed.counts.units, feed.counts.liveLettings, feed.counts.stages.AVA, feed.counts.stages.NEG], [2, 2, 1, 1]);
    const kept = unitById(feed, "ts-old-live");
    assert.deepEqual([kept.occupancy, kept.stage, kept.flags.notOnPlan], ["unknown", "NEG", false]);
    assert.equal(unitById(feed, "ts-new").flags.notOnPlan, true, "a live row with no outline is not on the plan");
  });
});
