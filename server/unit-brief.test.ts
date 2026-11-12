import test from "node:test";
import assert from "node:assert/strict";
import { parseMoney, normaliseCommercials, commercialsHaveContent, briefApproval, briefApprovalLabel, briefRoleLabel, EMPTY_COMMERCIALS } from "../shared/unit-brief";

// The Targeting Brief's pure rules (shared/unit-brief.ts): money typed by a
// person is read or refused, never silently blanked; sign-off counts only
// signatures on the current version.

test("parseMoney reads the ways people type money", () => {
  assert.equal(parseMoney("95000"), 95000);
  assert.equal(parseMoney("£95,000"), 95000);
  assert.equal(parseMoney("£95,000 pa"), 95000);
  assert.equal(parseMoney("95k"), 95000);
  assert.equal(parseMoney("1.2m"), 1200000);
  assert.equal(parseMoney(82500), 82500);
  assert.equal(parseMoney(" 12 "), 12);
});

test("parseMoney: blank is null, unreadable is undefined (an error, not a blank)", () => {
  assert.equal(parseMoney(""), null);
  assert.equal(parseMoney(null), null);
  assert.equal(parseMoney(undefined), null);
  assert.equal(parseMoney("ninety"), undefined);
  assert.equal(parseMoney("95k-ish"), undefined);
  assert.equal(parseMoney(NaN), undefined);
});

test("normaliseCommercials keeps known fields, parses numbers and names the bad ones", () => {
  const { value, invalid } = normaliseCommercials({ quotingRentPa: "95k", nerFloorPa: "£82,500 pa", rentFreeMonthsMax: 9, turnoverRentPct: "8%", breakOption: "  Tenant break at year 5 ", otherTerms: "", hacked: "x" });
  assert.deepEqual(invalid, []);
  assert.equal(value.quotingRentPa, 95000);
  assert.equal(value.nerFloorPa, 82500);
  assert.equal(value.rentFreeMonthsMax, 9);
  assert.equal(value.turnoverRentPct, 8);
  assert.equal(value.breakOption, "Tenant break at year 5");
  assert.equal(value.otherTerms, null);
  assert.equal((value as any).hacked, undefined);
  const bad = normaliseCommercials({ quotingRentPa: "ninety", capexEnvelope: -5 });
  assert.deepEqual(bad.invalid, ["Quoting rent", "Landlord works budget"]);
});

test("normaliseCommercials of nothing is the empty set", () => {
  assert.deepEqual(normaliseCommercials(null).value, EMPTY_COMMERCIALS);
  assert.equal(commercialsHaveContent(normaliseCommercials(undefined).value), false);
  assert.equal(commercialsHaveContent(normaliseCommercials({ ervPa: 1 }).value), true);
});

test("sign-off: only signatures on the current version count", () => {
  const at = "2026-11-12T10:00:00.000Z";
  assert.deepEqual(briefApproval(1, []), { state: "none", total: 0, agreed: 0, stale: 0 });
  assert.equal(briefApproval(1, [{ agreedAt: null, agreedVersion: null }]).state, "draft");
  assert.deepEqual(briefApproval(2, [{ agreedAt: at, agreedVersion: 2 }, { agreedAt: null, agreedVersion: null }]), { state: "awaiting", total: 2, agreed: 1, stale: 0 });
  assert.deepEqual(briefApproval(2, [{ agreedAt: at, agreedVersion: 2 }, { agreedAt: at, agreedVersion: 2 }]), { state: "agreed", total: 2, agreed: 2, stale: 0 });
  // The terms changed after both agreed: nobody has agreed version 3.
  assert.deepEqual(briefApproval(3, [{ agreedAt: at, agreedVersion: 2 }, { agreedAt: at, agreedVersion: 2 }]), { state: "awaiting", total: 2, agreed: 0, stale: 2 });
});

test("labels read plainly", () => {
  assert.equal(briefApprovalLabel({ state: "agreed", total: 4, agreed: 4 }), "Brief agreed");
  assert.equal(briefApprovalLabel({ state: "awaiting", total: 5, agreed: 2 }), "Awaiting sign-off · 2 of 5");
  assert.equal(briefApprovalLabel({ state: "draft", total: 3, agreed: 0 }), "Not yet signed · 0 of 3");
  assert.equal(briefApprovalLabel({ state: "none", total: 0, agreed: 0 }), "No one added yet");
  assert.equal(briefRoleLabel("senior_asset_manager"), "Senior asset manager");
  assert.equal(briefRoleLabel("nonsense"), "Involved");
});
