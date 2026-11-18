// The AML dashboard's rules (Woody, 18 November 2026: step 6 of
// docs/deal-page-review-2026-11-18.md): where a party has got to, whether
// HMRC expects its checks yet, which pill it is on and who it waits on.
import test from "node:test";
import assert from "node:assert/strict";
import {
  amlBucket, amlDue, amlStage, amlWaitingOn, bucketCounts, daysSince, rowMatches,
  type AmlDashboardRow, type AmlPartyFacts,
} from "../shared/aml-dashboard";

const now = new Date("2026-11-18T12:00:00Z");
const facts = (over: Partial<AmlPartyFacts> = {}): AmlPartyFacts => ({
  role: "tenant", dealStatus: "NEG", kyc: { status: null, expiresAt: null },
  precheckAt: null, clientSentAt: null, clientFinishedAt: null, kyc4uOpen: false, ...over,
});

test("a party's stage: a decision first, then the furthest step on the way", () => {
  assert.equal(amlStage(facts(), now), "not_started");
  assert.equal(amlStage(facts({ precheckAt: "2026-11-10T09:00:00Z" }), now), "bgp_checked");
  // Checks before asking older than 30 days do not count as done.
  assert.equal(amlStage(facts({ precheckAt: "2026-09-01T09:00:00Z" }), now), "not_started");
  assert.equal(amlStage(facts({ precheckAt: "2026-11-10", clientSentAt: "2026-11-12" }), now), "client_sent");
  assert.equal(amlStage(facts({ clientSentAt: "2026-11-12", clientFinishedAt: "2026-11-14" }), now), "client_finished");
  assert.equal(amlStage(facts({ clientFinishedAt: "2026-11-14", kyc4uOpen: true }), now), "with_kyc4u");
  assert.equal(amlStage(facts({ kyc: { status: "in_review", expiresAt: null } }), now), "with_kyc4u");
  assert.equal(amlStage(facts({ kyc4uOpen: true, kyc: { status: "approved", expiresAt: "2027-05-01" } }), now), "approved");
  assert.equal(amlStage(facts({ kyc: { status: "approved", expiresAt: "2026-12-01" } }), now), "expiring");
  assert.equal(amlStage(facts({ kyc: { status: "approved", expiresAt: "2026-11-01" } }), now), "expired");
  assert.equal(amlStage(facts({ kyc: { status: "rejected", expiresAt: "2027-05-01" }, clientFinishedAt: "2026-11-14" }), now), "rejected");
  // An approval with no re-check date stays approved.
  assert.equal(amlStage(facts({ kyc: { status: "approved", expiresAt: null } }), now), "approved");
});

test("HMRC's timing: landlord and seller on any live deal, tenant and buyer from Heads of Terms", () => {
  assert.ok(amlDue("landlord", "AVA"));
  assert.ok(amlDue("vendor", null));
  assert.ok(!amlDue("tenant", "NEG"));
  assert.ok(!amlDue("tenant", "Marketing"));
  assert.ok(amlDue("tenant", "HOT"));
  assert.ok(amlDue("tenant", "SOL"));
  assert.ok(!amlDue("purchaser", "NEG"));
  assert.ok(amlDue("purchaser", "EXC"));
});

test("the pills", () => {
  assert.equal(amlBucket("not_started", true), "todo");
  assert.equal(amlBucket("bgp_checked", true), "todo");
  assert.equal(amlBucket("not_started", false), "not_due");
  assert.equal(amlBucket("client_sent", false), "in_progress");
  assert.equal(amlBucket("client_finished", true), "in_progress");
  assert.equal(amlBucket("with_kyc4u", true), "in_progress");
  assert.equal(amlBucket("approved", true), "done");
  assert.equal(amlBucket("rejected", false), "done");
  assert.equal(amlBucket("expiring", true), "expiring");
  assert.equal(amlBucket("expired", true), "expiring");
  assert.deepEqual(bucketCounts([{ bucket: "todo" }, { bucket: "todo" }, { bucket: "done" }]), { todo: 2, in_progress: 0, done: 1, expiring: 0, not_due: 0 });
});

test("who a party waits on", () => {
  assert.equal(amlWaitingOn("not_started", 0), "BGP: start the checks");
  assert.equal(amlWaitingOn("bgp_checked", 0), "BGP: send the client checks or sign off");
  assert.equal(amlWaitingOn("bgp_checked", 1), "BGP: raise it with KYC4U");
  assert.equal(amlWaitingOn("client_sent", 2), "The client");
  assert.equal(amlWaitingOn("client_finished", 0), "BGP: sign off");
  assert.equal(amlWaitingOn("client_finished", 1), "BGP: raise it with KYC4U");
  assert.equal(amlWaitingOn("with_kyc4u", 1), "KYC4U");
  assert.equal(amlWaitingOn("approved", 0), "Nobody");
  assert.equal(amlWaitingOn("rejected", 0), "The MLRO");
  assert.equal(amlWaitingOn("expired", 0), "BGP: check it again");
});

test("days since anything moved, and the search", () => {
  assert.equal(daysSince([null, undefined, "2026-11-15T09:00:00Z", "2026-11-01"], now), 3);
  assert.equal(daysSince(["2026-11-18T11:00:00Z"], now), 0);
  assert.equal(daysSince([null, "not a date"], now), null);
  const row = {
    brandName: "The Test Bakery", signsAs: "The Test Bakery Operations Limited", dealName: "Unit 9", propertyName: "Westgate",
    dealRef: 1234, agents: ["Victoria Broadhead"],
  } as AmlDashboardRow;
  for (const q of ["bakery", "OPERATIONS", "unit 9", "westgate", "#1234", "victoria", ""]) assert.ok(rowMatches(row, q), q);
  assert.ok(!rowMatches(row, "pret"));
});
