// The AML box's Next line (Woody, 20 November 2026: "minimise each section
// with the detail to pop out so people can clearly see whats happening and
// whats needed"; 22 November 2026: "there is a large amount of text some of
// which is very AI", then "yes go ahead" to the short Next line: a bold lead
// and a few words). Rules: shared/aml-box.ts; box:
// client/src/components/deal-aml-status.tsx.
import test from "node:test";
import assert from "node:assert/strict";
import { amlNextStep, andList, firmShort, shortReason, type AmlBoxFacts, type AmlNextStep } from "../shared/aml-box";

const base: AmlBoxFacts = {
  role: "tenant", stage: "bgp_checked", due: true, approvedBy: null, expiresAt: null, notRequiredWords: null,
  company: true, companyMissing: false, gaps: [], askName: "Jack Barratt", precheckRunning: false,
  redFlags: 0, factors: 0, sanctionsOnly: false, clientChecks: true, request: null, people: [], kyc4u: "none",
  canSignOff: true, canDecide: false, signOffBlocked: "the client checks are not finished", needsNote: true,
};
const next = (over: Partial<AmlBoxFacts>) => amlNextStep({ ...base, ...over });
// The line as it reads on the screen.
const line = (s: AmlNextStep) => `${s.lead}${s.words ? ` · ${s.words}` : ""}`;

test("every line is short: a lead and a few words", () => {
  const cases: Array<Partial<AmlBoxFacts>> = [
    {}, { companyMissing: true }, { redFlags: 2 }, { factors: 1 }, { kyc4u: "queued" }, { kyc4u: "raised" },
    { sanctionsOnly: true, signOffBlocked: null }, { due: false }, { request: { status: "sent", to: "Jack Barratt" } },
    { request: { status: "finished", to: "Jack Barratt" }, signOffBlocked: null }, { stage: "approved", expiresAt: "2029-11-20T00:00:00Z" },
    { ownersAbroad: "Example Holding A/S, Denmark" }, { trust: true },
  ];
  for (const c of cases) {
    const text = line(next(c));
    assert.ok(text.split(/\s+/).length <= 12, `${text} is twelve words or fewer`);
    assert.doesNotMatch(text, /AMLG|reg \d|MLR 2017|HMRC/, "no regulation numbers on the line");
  }
});

test("a decision ends it: approved, not required and rejected ask nothing more of BGP", () => {
  const ok = next({ stage: "approved", approvedBy: "Jack Barratt", expiresAt: "2029-11-20T00:00:00Z" });
  assert.equal(ok.tone, "done");
  assert.equal(ok.action, null);
  assert.equal(line(ok), "Cleared · until 20 Nov 2029");
  assert.equal(line(next({ stage: "not_required", notRequiredReason: "joint_agent" })), "Not required · the joint agent's party");
  const no = next({ stage: "rejected" });
  assert.equal(no.tone, "flag");
  assert.equal(no.who, "officers");
  assert.equal(no.lead, "Rejected");
});

test("an approval running out asks for the checks again", () => {
  const soon = next({ stage: "expiring", expiresAt: "2026-12-01T00:00:00Z" });
  assert.equal(soon.action, "send_client_checks");
  assert.equal(line(soon), "Expires 1 Dec 2026 · check again");
  assert.equal(next({ stage: "expired", clientChecks: false }).action, "request_kyc4u");
});

test("nothing starts until the company that signs is set", () => {
  const step = next({ companyMissing: true, redFlags: 2, request: { status: "sent", to: "Jack Barratt" } });
  assert.equal(step.action, "fill_in");
  assert.equal(line(step), "To do · Set the company that signs");
  // A private individual has no company to set.
  assert.notEqual(next({ company: false, companyMissing: true }).action, "fill_in");
});

test("red flags and higher-risk factors go to KYC4U, with a red mark; once raised, it waits on KYC4U", () => {
  const flagged = next({ redFlags: 2, canDecide: true });
  assert.equal(flagged.action, "request_kyc4u");
  assert.equal(flagged.tone, "flag");
  assert.equal(line(flagged), "Not yet with KYC4U · 2 red flags");
  assert.equal(line(next({ factors: 1 })), "Not yet with KYC4U · higher risk");
  const queued = next({ redFlags: 1, kyc4u: "queued" });
  assert.equal(queued.action, "kyc4u_form");
  assert.equal(line(queued), "Not yet with KYC4U · submit it on their portal");
  const raised = next({ redFlags: 1, kyc4u: "raised", canDecide: true });
  assert.equal(raised.who, "kyc4u");
  assert.equal(raised.action, "kyc4u_result");
  assert.equal(line(raised), "Waiting on KYC4U · add their result when it comes");
  assert.equal(next({ stage: "with_kyc4u" }).action, null, "an agent waits; the officers add the result");
});

test("a letting under £10,000 a month is signed off on the sanctions checks", () => {
  const ready = next({ sanctionsOnly: true, signOffBlocked: null });
  assert.equal(ready.action, "sign_off");
  assert.equal(line(ready), "Ready to sign off · sanctions only, all clear");
  const waiting = next({ sanctionsOnly: true, signOffBlocked: "BGP's checks before asking have not run in the last 30 days." });
  assert.equal(waiting.action, null);
  assert.equal(line(waiting), "Not ready to sign off · BGP's checks before asking have not run in the last 30 days");
});

test("a tenant before Heads of Terms is not due yet", () => {
  const step = next({ due: false });
  assert.equal(step.who, "nobody");
  assert.equal(line(step), "Not due yet · once the landlord accepts their offer");
  // Once a request is out, the request leads.
  assert.notEqual(next({ due: false, request: { status: "sent", to: "Jack Barratt" } }).lead, "Not due yet");
});

test("the client checks: who to ask, then send, then the people with no details, then a link each", () => {
  assert.equal(next({ gaps: ["Set who to ask"] }).action, "fill_in");
  assert.equal(line(next({ gaps: ["Set who to ask"] })), "To do · Set who to ask");
  const send = next({});
  assert.equal(send.action, "send_client_checks");
  assert.equal(line(send), "To do · Send the client checks to Jack Barratt");
  const huseyn = { name: "Huseyn Mirhadiyev", needs: ["identity check", "proof of address"], reachable: false, linked: false };
  const add = next({ request: { status: "sent", to: "Jack Barratt" }, people: [huseyn] });
  assert.equal(add.action, "add_details");
  assert.equal(line(add), "To do · Add contact details for Huseyn Mirhadiyev");
  const link = next({ request: { status: "sent", to: "Jack Barratt" }, people: [{ ...huseyn, reachable: true }] });
  assert.equal(link.action, "people");
  assert.equal(line(link), "To do · Send Huseyn Mirhadiyev their own link");
  assert.equal(line(next({ request: { status: "not_sent", to: "Jack Barratt" } })), "To do · The client checks email didn't go: send it again");
  assert.equal(next({ request: { status: "expired", to: "Jack Barratt" } }).action, "send_client_checks");
});

test("waiting on the client names who it waits on", () => {
  const jack = { name: "Jack Barratt", needs: ["proof of address"], reachable: true, linked: true };
  const huseyn = { name: "Huseyn Mirhadiyev", needs: ["identity check"], reachable: true, linked: true };
  const open = next({ request: { status: "opened", to: "jack Barrat" }, people: [jack, huseyn] });
  assert.equal(open.who, "client");
  // The person acting is not named twice, however the register spells them.
  assert.equal(line(open), "Waiting on jack Barrat · and Huseyn Mirhadiyev");
  assert.equal(line(next({ request: { status: "finished", to: "Jack Barratt" }, people: [huseyn] })), "Waiting on Huseyn Mirhadiyev");
});

test("everything in: sign it off, or say why not", () => {
  const done = { request: { status: "finished" as const, to: "Jack Barratt" } };
  assert.equal(next({ ...done, signOffBlocked: null }).action, "sign_off");
  assert.equal(line(next({ ...done, signOffBlocked: null, needsNote: true })), "Ready to sign off · add a note");
  assert.equal(line(next({ ...done, signOffBlocked: null, needsNote: false })), "Ready to sign off");
  const blocked = next({ ...done, signOffBlocked: "Enhanced due diligence: only the Nominated Officer or a Deputy signs it off." });
  assert.equal(blocked.action, null);
  assert.equal(line(blocked), "Not ready to sign off · Enhanced due diligence");
  assert.equal(next({ ...done, signOffBlocked: "x", canSignOff: false }).who, "officers");
});

test("billed to another company: asked before sign-off, never ahead of the checks", () => {
  const done = { request: { status: "finished" as const, to: "Jack Barratt" }, signOffBlocked: null, billingDiffers: true };
  const step = next(done);
  assert.equal(step.action, "billing");
  assert.equal(line(step), "To do · Say who pays BGP's invoice");
  assert.equal(next({ ...done, billingDiffers: false }).action, "sign_off");
  // Sending the client checks still comes first.
  assert.equal(next({ billingDiffers: true }).action, "send_client_checks");
  assert.equal(next({ sanctionsOnly: true, signOffBlocked: null, billingDiffers: true }).action, "billing");
});

test("BGP's checks running say so first", () => {
  assert.equal(next({ precheckRunning: true }).tone, "wait");
  assert.equal(next({ precheckRunning: true }).action, null);
  assert.equal(line(next({ precheckRunning: true })), "Screening · running now");
});

test("without the client checks, KYC4U does them", () => {
  assert.equal(next({ clientChecks: false }).action, "request_kyc4u");
});

test("names read as a list; a firm without its legal form; a reason to its first clause", () => {
  assert.equal(andList(["A"]), "A");
  assert.equal(andList(["A", "B"]), "A and B");
  assert.equal(andList(["A", "B", "C"]), "A, B and C");
  assert.equal(firmShort("Savills (UK) Limited"), "Savills");
  assert.equal(firmShort("Knight Frank LLP"), "Knight Frank");
  assert.equal(firmShort("Cushman & Wakefield Debenham Tie Leung Ltd"), "Cushman & Wakefield Debenham Tie Leung");
  assert.equal(firmShort("CBRE"), "CBRE");
  assert.equal(shortReason("Possible sanctions match: check it first. Then the rest."), "Possible sanctions match");
  assert.ok(shortReason("a".repeat(30) + " " + "b".repeat(60), 40).endsWith("…"));
});

test("a party owned through a company registered abroad goes to KYC4U (Woody, 21 November 2026)", () => {
  const step = amlNextStep({ ...base, ownersAbroad: "Example Holding A/S, Denmark" });
  assert.equal(step.action, "request_kyc4u");
  assert.equal(step.who, "bgp");
  assert.equal(line(step), "Not yet with KYC4U · owned from abroad (Example Holding A/S, Denmark)");
  // Once raised with KYC4U, it waits on them as any party does.
  assert.equal(amlNextStep({ ...base, ownersAbroad: "Example Holding A/S, Denmark", kyc4u: "raised" }).who, "kyc4u");
  assert.notEqual(amlNextStep({ ...base, ownersAbroad: null }).action, "request_kyc4u");
});
