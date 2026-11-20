// The AML box's Next line (Woody, 20 November 2026: "minimise each section
// with the detail to pop out so people can clearly see whats happening and
// whats needed"). Rules: shared/aml-box.ts; box:
// client/src/components/deal-aml-status.tsx.
import test from "node:test";
import assert from "node:assert/strict";
import { amlNextStep, andList, type AmlBoxFacts } from "../shared/aml-box";

const base: AmlBoxFacts = {
  role: "tenant", stage: "bgp_checked", due: true, approvedBy: null, expiresAt: null, notRequiredWords: null,
  company: true, companyMissing: false, gaps: [], askName: "Jack Barratt", precheckRunning: false,
  redFlags: 0, factors: 0, sanctionsOnly: false, clientChecks: true, request: null, people: [], kyc4u: "none",
  canSignOff: true, canDecide: false, signOffBlocked: "the client checks are not finished", needsNote: true,
};
const next = (over: Partial<AmlBoxFacts>) => amlNextStep({ ...base, ...over });

test("a decision ends it: approved, not required and rejected ask nothing more of BGP", () => {
  const ok = next({ stage: "approved", approvedBy: "Jack Barratt", expiresAt: "2029-11-20T00:00:00Z" });
  assert.equal(ok.tone, "done");
  assert.equal(ok.action, null);
  assert.match(ok.words, /^Approved by Jack Barratt, valid until 20 Nov 2029\./);
  assert.equal(next({ stage: "not_required", notRequiredWords: "The other side of a deal a joint agent negotiated" }).words,
    "Not required: the other side of a deal a joint agent negotiated. No checks are needed on this party.");
  const no = next({ stage: "rejected" });
  assert.equal(no.tone, "flag");
  assert.equal(no.who, "officers");
});

test("an approval running out asks for the checks again", () => {
  assert.equal(next({ stage: "expiring", expiresAt: "2026-12-01T00:00:00Z" }).action, "send_client_checks");
  assert.equal(next({ stage: "expired", clientChecks: false }).action, "request_kyc4u");
});

test("nothing starts until the company that signs is set", () => {
  const step = next({ companyMissing: true, redFlags: 2, request: { status: "sent", to: "Jack Barratt" } });
  assert.equal(step.action, "fill_in");
  assert.match(step.words, /^Set the company that signs/);
  // A private individual has no company to set.
  assert.notEqual(next({ company: false, companyMissing: true }).action, "fill_in");
});

test("red flags and higher-risk factors go to KYC4U; once raised, it waits on KYC4U", () => {
  const flagged = next({ redFlags: 2, canDecide: true });
  assert.equal(flagged.action, "request_kyc4u");
  assert.match(flagged.words, /^2 red flags: raise it with KYC4U, or set aside any that do not apply, with a comment\.$/);
  assert.doesNotMatch(next({ redFlags: 1 }).words, /set aside/, "only an officer is told to set one aside");
  assert.match(next({ factors: 1 }).words, /^Enhanced due diligence \(1 higher-risk factor/);
  assert.equal(next({ redFlags: 1, kyc4u: "queued" }).action, "kyc4u_form");
  const raised = next({ redFlags: 1, kyc4u: "raised", canDecide: true });
  assert.equal(raised.who, "kyc4u");
  assert.equal(raised.action, "kyc4u_result");
  assert.equal(next({ stage: "with_kyc4u" }).action, null, "the agent is told the officers add the result");
});

test("a letting under £10,000 a month is signed off on the sanctions checks", () => {
  assert.equal(next({ sanctionsOnly: true, signOffBlocked: null }).action, "sign_off");
  const waiting = next({ sanctionsOnly: true, signOffBlocked: "BGP's checks before asking have not run in the last 30 days." });
  assert.equal(waiting.action, null);
  assert.match(waiting.words, /Before it can be signed off: BGP's checks before asking have not run in the last 30 days\.$/);
});

test("a tenant before Heads of Terms is not due yet", () => {
  const step = next({ due: false });
  assert.equal(step.who, "nobody");
  assert.match(step.words, /^Not due yet\. HMRC expects the tenant's checks once the landlord accepts their offer/);
  // Once a request is out, the request leads.
  assert.notEqual(next({ due: false, request: { status: "sent", to: "Jack Barratt" } }).words.slice(0, 11), "Not due yet");
});

test("the client checks: who to ask, then send, then the people with no details, then a link each", () => {
  assert.equal(next({ gaps: ["Who to ask: nobody set"] }).action, "fill_in");
  const send = next({});
  assert.equal(send.action, "send_client_checks");
  assert.equal(send.words, "Send the client checks to Jack Barratt.");
  const huseyn = { name: "Huseyn Mirhadiyev", needs: ["identity check", "proof of address"], reachable: false, linked: false };
  assert.match(next({ people: [huseyn] }).words, /Huseyn Mirhadiyev also needs an email or mobile for a link of their own\.$/);
  const add = next({ request: { status: "sent", to: "Jack Barratt" }, people: [huseyn] });
  assert.equal(add.action, "add_details");
  assert.equal(add.words, "Huseyn Mirhadiyev needs to do their own checks: no email or mobile is held for them yet.");
  const link = next({ request: { status: "sent", to: "Jack Barratt" }, people: [{ ...huseyn, reachable: true }] });
  assert.equal(link.action, "people");
  assert.equal(link.words, "Send Huseyn Mirhadiyev a link of their own.");
  assert.equal(next({ request: { status: "not_sent", to: "Jack Barratt" } }).words, "The client checks email did not go: send it again.");
  assert.equal(next({ request: { status: "expired", to: "Jack Barratt" } }).action, "send_client_checks");
});

test("waiting on the client names who still owes what", () => {
  const jack = { name: "Jack Barratt", needs: ["proof of address"], reachable: true, linked: true };
  const huseyn = { name: "Huseyn Mirhadiyev", needs: ["identity check"], reachable: true, linked: true };
  const open = next({ request: { status: "opened", to: "jack Barrat" }, people: [jack, huseyn] });
  assert.equal(open.who, "client");
  // The person acting is not named twice, however the register spells them.
  assert.equal(open.words, "Waiting on jack Barrat to finish the client checks, and on Huseyn Mirhadiyev (identity check).");
  assert.equal(next({ request: { status: "finished", to: "Jack Barratt" }, people: [huseyn] }).words, "Waiting on Huseyn Mirhadiyev (identity check).");
});

test("everything in: sign it off, or say why not", () => {
  const done = { request: { status: "finished" as const, to: "Jack Barratt" } };
  assert.equal(next({ ...done, signOffBlocked: null }).action, "sign_off");
  assert.equal(next({ ...done, signOffBlocked: null, needsNote: true }).words, "Everything asked for is in: sign it off, with a note.");
  const blocked = next({ ...done, signOffBlocked: "Enhanced due diligence: only the Nominated Officer or a Deputy signs it off." });
  assert.equal(blocked.action, null);
  assert.match(blocked.words, /^Everything asked for is in\. Before it can be signed off: enhanced due diligence/);
  assert.equal(next({ ...done, signOffBlocked: "x", canSignOff: false }).who, "officers");
});

test("billed to another company: asked before sign-off, never ahead of the checks", () => {
  const done = { request: { status: "finished" as const, to: "Jack Barratt" }, signOffBlocked: null, billingDiffers: true };
  const step = next(done);
  assert.equal(step.action, "billing");
  assert.match(step.words, /^BGP's invoice goes to another company than the one that signs/);
  assert.equal(next({ ...done, billingDiffers: false }).action, "sign_off");
  // Sending the client checks still comes first.
  assert.equal(next({ billingDiffers: true }).action, "send_client_checks");
  assert.equal(next({ sanctionsOnly: true, signOffBlocked: null, billingDiffers: true }).action, "billing");
});

test("BGP's checks running say so first", () => {
  assert.equal(next({ precheckRunning: true }).tone, "wait");
  assert.equal(next({ precheckRunning: true }).action, null);
});

test("without the client checks, KYC4U does them", () => {
  assert.equal(next({ clientChecks: false }).action, "request_kyc4u");
});

test("names read as a list", () => {
  assert.equal(andList(["A"]), "A");
  assert.equal(andList(["A", "B"]), "A and B");
  assert.equal(andList(["A", "B", "C"]), "A, B and C");
});
