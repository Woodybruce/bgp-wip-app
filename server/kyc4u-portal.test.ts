// KYC4U takes requests only on its portal (Jack, 20 November 2026).
import test from "node:test";
import assert from "node:assert/strict";
import { KYC4U_FORM_FIELDS, kyc4uDraftState, kyc4uSubmittedInput } from "../shared/kyc4u-portal";

const now = new Date("2026-11-20T12:00:00Z");

test("only a request submitted on KYC4U's portal is with KYC4U; a prepared one goes stale after 30 days", () => {
  assert.equal(kyc4uDraftState(null, now), "none");
  assert.equal(kyc4uDraftState({ status: "cancelled", created_at: "2026-11-19" }, now), "none");
  assert.equal(kyc4uDraftState({ status: "queued", created_at: "2026-11-19T10:00:00Z" }, now), "prepared");
  assert.equal(kyc4uDraftState({ status: "queued", created_at: "2026-10-07T10:00:00Z" }, now), "stale");
  assert.equal(kyc4uDraftState({ status: "submitted", created_at: "2026-10-07T10:00:00Z" }, now), "submitted");
  assert.equal(kyc4uDraftState({ status: "filled", created_at: "2026-11-19T10:00:00Z" }, now), "submitted");
});

test("what is recorded as submitted: a reference if given, and a day not in the future", () => {
  assert.deepEqual(kyc4uSubmittedInput({ reference: "  REQ 01234 ", date: "2026-11-20" }, now), { reference: "REQ 01234", date: "2026-11-20" });
  assert.deepEqual(kyc4uSubmittedInput({}, now), { reference: null, date: "2026-11-20" });
  assert.ok("error" in kyc4uSubmittedInput({ date: "2026-11-21" }, now));
  assert.ok("error" in kyc4uSubmittedInput({ date: "20/11/2026" }, now));
});

test("the request sheet follows KYC4U's own form", () => {
  assert.deepEqual(KYC4U_FORM_FIELDS.map(f => f.key), ["partyType", "partyName", "propertyAddress", "requestType", "metFaceToFace", "howLongKnown",
    "instructorName", "instructorDesignation", "jointAgent", "feeEarnerEmails", "clientEmails", "expectedCompletion", "note"]);
});
