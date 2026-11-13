import test from "node:test";
import assert from "node:assert/strict";
import {
  parseMoney, normaliseCommercials, commercialsHaveContent, briefApproval, briefApprovalLabel, briefRoleLabel, EMPTY_COMMERCIALS,
  targetForJointAgent, jointAgentTargetBody, targetHasBgpNotes, JOINT_AGENT_TARGET_FIELDS, JOINT_AGENT_HIDDEN_TARGET_FIELDS,
} from "../shared/unit-brief";

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

test("sign-off: only signatures on the current version count, and both sides must be on the brief", () => {
  const at = "2026-11-12T10:00:00.000Z";
  const agent = (v: number | null) => ({ agreedAt: v ? at : null, agreedVersion: v, role: "bgp_agent" });
  const client = (v: number | null) => ({ agreedAt: v ? at : null, agreedVersion: v, role: "asset_manager" });
  assert.deepEqual(briefApproval(1, []), { state: "none", total: 0, agreed: 0, stale: 0, missing: [] });
  assert.equal(briefApproval(1, [agent(null), client(null)]).state, "draft");
  assert.deepEqual(briefApproval(2, [agent(2), client(null)]), { state: "awaiting", total: 2, agreed: 1, stale: 0, missing: [] });
  assert.deepEqual(briefApproval(2, [agent(2), client(2)]), { state: "agreed", total: 2, agreed: 2, stale: 0, missing: [] });
  // The terms changed after both agreed: nobody has agreed version 3.
  assert.deepEqual(briefApproval(3, [agent(2), client(2)]), { state: "awaiting", total: 2, agreed: 0, stale: 2, missing: [] });
  // One side alone cannot make a brief agreed, however many of them sign:
  // taking the people who have not signed off the brief must not agree it.
  assert.deepEqual(briefApproval(2, [client(2)]), { state: "awaiting", total: 1, agreed: 1, stale: 0, missing: ["agent"] });
  assert.deepEqual(briefApproval(2, [agent(2)]), { state: "awaiting", total: 1, agreed: 1, stale: 0, missing: ["client"] });
  // A joint agent is neither side: BGP and the client are still both needed.
  assert.deepEqual(briefApproval(2, [{ agreedAt: at, agreedVersion: 2, role: "joint_agent" }]).missing, ["agent", "client"]);
});

test("money: a monthly or per-square-foot figure is refused, and so is an absurd one", () => {
  assert.equal(parseMoney("£8,000 pcm"), undefined);
  assert.equal(parseMoney("£12.50 psf"), undefined);
  assert.equal(parseMoney(1e308), undefined);
  assert.equal(parseMoney({} as any), undefined);
  assert.deepEqual(normaliseCommercials("hello").value, EMPTY_COMMERCIALS);
  assert.deepEqual(normaliseCommercials({ breakOption: { a: 1 } }).invalid, ["Break"]);
});

test("labels read plainly", () => {
  assert.equal(briefApprovalLabel({ state: "agreed", total: 4, agreed: 4 }), "Brief agreed");
  assert.equal(briefApprovalLabel({ state: "awaiting", total: 5, agreed: 2 }), "Awaiting sign-off · 2 of 5");
  assert.equal(briefApprovalLabel({ state: "draft", total: 3, agreed: 0 }), "Not yet signed · 0 of 3");
  assert.equal(briefApprovalLabel({ state: "none", total: 0, agreed: 0 }), "No one added yet");
  assert.equal(briefRoleLabel("senior_asset_manager"), "Senior asset manager");
  assert.equal(briefRoleLabel("nonsense"), "Involved");
});

// A joint agent on their scheme works the targets as BGP does (Woody,
// 2026-11-12), but BGP's side of a target is never sent to them and never
// taken from them.
const bgpTarget = {
  id: "t1", briefId: "b1", operatorName: "Dishoom", category: "Restaurant", priority: "A", rationale: "Anchors the terrace", status: "Approached", sortOrder: 2,
  companyId: "crm-company-1", existingRelationship: "Woody knows the property director", feedback: "Keen, wants 4,000 sq ft",
  comments: [{ userId: "u1", userName: "Victoria", text: "Call booked", at: "2026-11-10T09:00:00.000Z" }],
  clientContactId: "crm-contact-9", agentUserIds: ["u1", "u2"],
};

test("a joint agent receives a target without BGP's notes, people or brand link", () => {
  const seen = targetForJointAgent(bgpTarget);
  for (const k of JOINT_AGENT_HIDDEN_TARGET_FIELDS) assert.equal((seen as any)[k], null, `${k} is blanked`);
  // What they work on is all there.
  assert.equal(seen.operatorName, "Dishoom");
  assert.equal(seen.category, "Restaurant");
  assert.equal(seen.priority, "A");
  assert.equal(seen.status, "Approached");
  assert.equal(seen.rationale, "Anchors the terrace");
  // The stored row is not touched.
  assert.equal(bgpTarget.comments.length, 1);
  assert.equal(bgpTarget.companyId, "crm-company-1");
  // Nothing of BGP's survives anywhere in what is sent.
  const sent = JSON.stringify(seen);
  for (const secret of ["crm-company-1", "crm-contact-9", "Woody knows", "Keen, wants", "Call booked", "u2"]) assert.equal(sent.includes(secret), false, secret);
});

test("a joint agent's target write carries only their own fields", () => {
  // The whole row sent back, as a table holding blanked fields would send it:
  // none of the blanks (or anything typed over them) reaches the save.
  const body = jointAgentTargetBody({ ...targetForJointAgent(bgpTarget), status: "Meeting Held", comments: [{ text: "mine" }], agentUserIds: [], clientContactId: "x", companyId: "y", feedback: "", existingRelationship: null, briefId: "other-brief", id: "t2" });
  assert.deepEqual(Object.keys(body).sort(), ["category", "operatorName", "priority", "rationale", "sortOrder", "status"]);
  assert.equal(body.status, "Meeting Held");
  for (const k of JOINT_AGENT_HIDDEN_TARGET_FIELDS) assert.equal(k in body, false, `${k} is dropped`);
  assert.equal("briefId" in body, false);
  assert.equal("id" in body, false);
  // A field that was not sent is not invented.
  assert.deepEqual(jointAgentTargetBody({ priority: "B" }), { priority: "B" });
  // Not an object: nothing to write.
  assert.deepEqual(jointAgentTargetBody(null), {});
  assert.deepEqual(jointAgentTargetBody([{ comments: [] }]), {});
  assert.deepEqual(jointAgentTargetBody("status"), {});
  // The two lists never overlap.
  for (const k of JOINT_AGENT_TARGET_FIELDS) assert.equal((JOINT_AGENT_HIDDEN_TARGET_FIELDS as readonly string[]).includes(k), false);
});

test("a target with BGP's notes on it is known, so a joint agent does not delete it unseen", () => {
  assert.equal(targetHasBgpNotes(bgpTarget), true);
  assert.equal(targetHasBgpNotes({ existingRelationship: "Known to Nick" }), true);
  assert.equal(targetHasBgpNotes({ feedback: " Not for them " }), true);
  assert.equal(targetHasBgpNotes({ comments: [{ text: "x" }] }), true);
  // Who is on a target is not a note; blanks are not notes.
  assert.equal(targetHasBgpNotes({ existingRelationship: "  ", feedback: "", comments: [] }), false);
  assert.equal(targetHasBgpNotes({ comments: null }), false);
  assert.equal(targetHasBgpNotes({ ...targetForJointAgent(bgpTarget) }), false);
  assert.equal(targetHasBgpNotes(null), false);
});
