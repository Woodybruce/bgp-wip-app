import test from "node:test";
import assert from "node:assert/strict";
import {
  DEAL_PAGE_STATUSES, DEAL_STATUS_CODES, DEAL_STATUS_LABELS, INVESTMENT_ONLY_PICKS, INVESTMENT_STATUSES,
  LETTING_PICK_STATUSES, LETTING_STATUSES, SYSTEM_SET_STATUSES, legacyToCode,
} from "./deal-status";

// Woody, 2026-11-20: "only chase live deals actually delete the Withdrawn
// option generally delete is good enough". The Investment Tracker keeps it.
test("Withdrawn and U/O - Not BGP are picked on the Investment Tracker only", () => {
  assert.deepEqual(INVESTMENT_ONLY_PICKS, ["UOX", "WIT"]);
  for (const code of INVESTMENT_ONLY_PICKS) {
    assert.ok(INVESTMENT_STATUSES.includes(code), `the Investment Tracker offers ${code}`);
    assert.ok(!DEAL_PAGE_STATUSES.includes(code), `the deal pickers offer ${code}`);
    assert.ok(!LETTING_PICK_STATUSES.includes(code), `the Letting Tracker offers ${code}`);
  }
});

test("the Letting Tracker offers its headings less Withdrawn, in the same order, and still shows Withdrawn", () => {
  assert.deepEqual(LETTING_PICK_STATUSES, ["OPP", "AVA", "NEG", "HOT", "SOL", "EXC", "COM", "INV"]);
  assert.deepEqual(LETTING_PICK_STATUSES, LETTING_STATUSES.filter(c => c !== "WIT"));
  assert.ok(LETTING_STATUSES.includes("WIT"));
});

test("the deal pickers offer every code but Archived, U/O - Not BGP and Withdrawn", () => {
  assert.deepEqual(DEAL_PAGE_STATUSES, DEAL_STATUS_CODES.filter(c => !["ARCH", "UOX", "WIT"].includes(c)));
  assert.ok(DEAL_PAGE_STATUSES.includes("INV"), "Invoiced is shown in the deal form, where it cannot be picked");
  assert.ok(SYSTEM_SET_STATUSES.includes("INV") && !SYSTEM_SET_STATUSES.includes("WIT"), "Withdrawn is not system-set: a save may still carry it");
});

test("a Withdrawn deal still reads Withdrawn, whatever it was stored as", () => {
  assert.equal(DEAL_STATUS_LABELS.WIT, "Withdrawn");
  for (const raw of ["WIT", "wit", "Withdrawn", "lost", "dead"]) assert.equal(legacyToCode(raw), "WIT", raw);
});
