// Client KYC with no transaction (Woody, 24 November 2026: "Yes build it
// within companies and show in the CRM boards and we will want to be able to
// aml all the sub companies within each company"). The rules in
// shared/client-kyc.ts; the routes are guarded in
// qa/regression/client-kyc-guards.test.mjs.
import "./test-database-url";
import test from "node:test";
import assert from "node:assert/strict";
import {
  CLIENT_INSTRUCTIONS, CLIENT_KYC_BULK_MAX, CLIENT_SELF, bulkCheckList, clientFileName, clientFileRole, clientInstructionLabel, clientKycBucket, clientKycNextStep,
  clientKycSummary, clientKycWords, clientSubjectEntity, clientSubjectParam, isClientInstruction, recordIsOwnSubject, type ClientKycNextFacts,
} from "../shared/client-kyc";

const NOW = new Date("2026-11-24T12:00:00Z");
const inDays = (n: number) => new Date(NOW.getTime() + n * 86400000).toISOString();

test("what BGP is instructed on: the four Woody named, and other work", () => {
  assert.deepEqual(CLIENT_INSTRUCTIONS.map(i => i.key), ["letting", "sale", "purchase", "tenant_rep", "other"]);
  assert.equal(isClientInstruction("tenant_rep"), true);
  assert.equal(isClientInstruction("deal"), false);
  assert.equal(clientInstructionLabel("purchase"), "Advising on a purchase");
  assert.equal(clientInstructionLabel(null), null);
  // The side BGP's client is on: a buyer or tenant is asked where the money comes from.
  assert.equal(clientFileRole("purchase"), "purchaser");
  assert.equal(clientFileRole("tenant_rep"), "tenant");
  assert.equal(clientFileRole("letting"), "landlord");
  assert.equal(clientFileRole("sale"), "vendor");
  assert.equal(clientFileRole("other"), "client");
  assert.equal(clientFileRole(null), "client");
});

test("the client file reads where a transaction's name goes", () => {
  assert.equal(clientFileName("Landsec"), "our instruction from Landsec");
  assert.equal(clientFileName("  Bill's  Restaurants "), "our instruction from Bill's Restaurants");
  assert.equal(clientFileName(null), "our instruction from you");
});

test("a subject is a sub company's id, or self for the account's own record", () => {
  assert.equal(clientSubjectParam("e1"), "e1");
  assert.equal(clientSubjectParam(null), CLIENT_SELF);
  assert.equal(clientSubjectEntity("self"), null);
  assert.equal(clientSubjectEntity(""), null);
  assert.equal(clientSubjectEntity("e1"), "e1");
  // Only a person, trust or public body is checked on its own record: a company's checks are about a company filed under it.
  assert.equal(recordIsOwnSubject("individual"), true);
  assert.equal(recordIsOwnSubject("Trust"), true);
  assert.equal(recordIsOwnSubject("public_body"), true);
  assert.equal(recordIsOwnSubject(null), false);
  assert.equal(recordIsOwnSubject("company"), false);
});

test("each company's bucket: cleared, due soon, expired, sanctions only, in progress, not checked", () => {
  assert.equal(clientKycBucket({ status: "approved", expiresAt: inDays(400) }, NOW), "cleared");
  assert.equal(clientKycBucket({ status: "approved", expiresAt: inDays(10) }, NOW), "expiring");
  assert.equal(clientKycBucket({ status: "approved", expiresAt: inDays(-1) }, NOW), "expired");
  assert.equal(clientKycBucket({ status: "approved", expiresAt: inDays(400), scope: "sanctions_only" }, NOW), "sanctions_only");
  assert.equal(clientKycBucket({ status: "rejected", expiresAt: null }, NOW), "rejected");
  // Only a sign-off counts: an old "in review" is not checked unless work has started.
  assert.equal(clientKycBucket({ status: "in_review", expiresAt: null }, NOW), "not_checked");
  assert.equal(clientKycBucket({ status: "in_review", expiresAt: null, started: true }, NOW), "in_progress");
  assert.equal(clientKycBucket({ status: null, expiresAt: null, started: true }, NOW), "in_progress");
  assert.equal(clientKycBucket({ status: null, expiresAt: null }, NOW), "not_checked");
});

test("the CRM chip: all cleared, some of many, in progress, expired, rejected, none", () => {
  const all = clientKycSummary([{ status: "approved", expiresAt: inDays(400) }, { status: "approved", expiresAt: inDays(200) }], NOW);
  assert.deepEqual(clientKycWords(all).label, "KYC cleared");
  assert.equal(clientKycWords(all).tone, "ok");
  assert.equal(all.nextExpiry, inDays(200));
  const soon = clientKycSummary([{ status: "approved", expiresAt: inDays(400) }, { status: "approved", expiresAt: inDays(5) }], NOW);
  assert.equal(clientKycWords(soon).label, "KYC due soon");
  const some = clientKycSummary([{ status: "approved", expiresAt: inDays(400) }, { status: null, expiresAt: null }, { status: null, expiresAt: null, started: true }], NOW);
  assert.equal(clientKycWords(some).label, "KYC 1 of 3");
  assert.match(clientKycWords(some).title, /1 cleared, 1 in progress, 1 not checked/);
  assert.equal(clientKycWords(clientKycSummary([{ status: null, expiresAt: null, started: true }], NOW)).label, "KYC in progress");
  assert.equal(clientKycWords(clientKycSummary([{ status: "approved", expiresAt: inDays(-3) }], NOW)).label, "KYC expired");
  assert.equal(clientKycWords(clientKycSummary([{ status: "rejected", expiresAt: null }, { status: "approved", expiresAt: inDays(400) }], NOW)).label, "KYC rejected");
  assert.equal(clientKycWords(clientKycSummary([{ status: null, expiresAt: null }], NOW)).label, "No KYC");
  assert.equal(clientKycWords(clientKycSummary([], NOW)).label, "No KYC");
  // Signed off for sanctions checks only is not cleared for a client: it does not cover a sale or a large letting.
  const small = clientKycSummary([{ status: "approved", expiresAt: inDays(400), scope: "sanctions_only" }], NOW);
  assert.equal(small.sanctionsOnly, 1);
  assert.equal(clientKycWords(small).label, "Sanctions only");
  assert.match(clientKycWords(small).title, /not a sale or a bigger letting/);
  assert.equal(clientKycWords(clientKycSummary([{ status: "approved", expiresAt: inDays(400), scope: "sanctions_only" }, { status: "approved", expiresAt: inDays(400) }], NOW)).label, "Cleared, some sanctions only");
  assert.equal(clientKycWords(clientKycSummary([{ status: "approved", expiresAt: inDays(400), scope: "sanctions_only" }, { status: null, expiresAt: null }], NOW)).label, "KYC 0 of 2");
});

const base: ClientKycNextFacts = {
  rejected: false, cleared: null, sanctionsOnly: false, precheck: "done", redFlags: 0, canDecide: false,
  whoToAsk: "Jane Smith", request: "finished", waitingOn: [], signOffBlocked: null,
};

test("the client file's Next line, in order", () => {
  assert.deepEqual(clientKycNextStep({ ...base, rejected: true }).lead, "Rejected");
  assert.equal(clientKycNextStep({ ...base, cleared: { until: "2029-11-24T00:00:00.000Z" } }).words, "until 2029-11-24");
  assert.equal(clientKycNextStep({ ...base, sanctionsOnly: true }).action, "full_checks");
  assert.equal(clientKycNextStep({ ...base, precheck: "running" }).lead, "Checking");
  assert.equal(clientKycNextStep({ ...base, precheck: "not_run" }).action, "run_checks");
  const flagged = clientKycNextStep({ ...base, redFlags: 2 });
  assert.equal(flagged.lead, "Red flag");
  assert.equal(flagged.action, null);
  assert.equal(clientKycNextStep({ ...base, redFlags: 2, canDecide: true }).action, "sign_off");
  assert.equal(clientKycNextStep({ ...base, request: "none", whoToAsk: null }).action, "pick_person");
  assert.equal(clientKycNextStep({ ...base, request: "none" }).action, "send_checks");
  assert.match(clientKycNextStep({ ...base, request: "none" }).words, /Jane Smith/);
  assert.equal(clientKycNextStep({ ...base, request: "not_sent" }).action, "send_checks");
  assert.equal(clientKycNextStep({ ...base, request: "sent" }).lead, "Waiting on Jane Smith");
  assert.equal(clientKycNextStep({ ...base, waitingOn: ["Ann Owner", "Bob Owner", "Cy Owner"] }).lead, "Waiting on Ann Owner and Bob Owner and 1 more");
  assert.equal(clientKycNextStep({ ...base, signOffBlocked: "Run BGP's checks first." }).lead, "Not ready to sign off");
  const ready = clientKycNextStep(base);
  assert.equal(ready.lead, "Ready to sign off");
  assert.equal(ready.action, "sign_off");
  // Twelve words or fewer, as the transaction box's Next line.
  for (const f of [base, { ...base, request: "none" as const }, { ...base, precheck: "not_run" as const }, { ...base, sanctionsOnly: true }]) {
    const n = clientKycNextStep(f);
    assert.ok(`${n.lead} ${n.words}`.split(/\s+/).length <= 14, `${n.lead} ${n.words}`);
  }
});

test("many sub companies at once: only those filed under the account, no repeats, capped", () => {
  assert.deepEqual(bulkCheckList(["a", "b", "a", " c ", "x"], ["a", "b", "c"]), { ids: ["a", "b", "c"], unknown: 1, over: 0 });
  assert.deepEqual(bulkCheckList("a", ["a"]), { ids: [], unknown: 0, over: 0 });
  const many = Array.from({ length: CLIENT_KYC_BULK_MAX + 5 }, (_v, i) => `e${i}`);
  const plan = bulkCheckList(many, many);
  assert.equal(plan.ids.length, CLIENT_KYC_BULK_MAX);
  assert.equal(plan.over, 5);
});

test("people sent their own links, with nobody acting asked: the file waits on them, not 'pick who to ask'", () => {
  const base = { rejected: false, cleared: null, sanctionsOnly: false, precheck: "done" as const, redFlags: 0, canDecide: false, whoToAsk: null, request: "none" as const, signOffBlocked: null };
  assert.equal(clientKycNextStep({ ...base, waitingOn: ["Maximilian Alexander Bassadone", "Sanjay Sethi"], ownLinks: 2 }).lead, "Waiting on Maximilian Alexander Bassadone and Sanjay Sethi");
  assert.equal(clientKycNextStep({ ...base, waitingOn: [], ownLinks: 0 }).words, "pick who to ask");
});
