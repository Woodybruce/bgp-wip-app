// Relying on another firm's checks (Woody, 21 November 2026: MLR 2017 reg 39,
// "Yes go ahead"). The rules are shared/aml-reliance.ts; what it changes is
// read by shared/kyc-people.ts, shared/party-kyc.ts, shared/aml-box.ts and
// shared/aml-dashboard.ts.
import test from "node:test";
import assert from "node:assert/strict";
import { RELIANCE_TERMS, relianceInput, relianceWords, type PartyReliance } from "../shared/aml-reliance";
import { partyPeople, type PartyPeopleInput, type PeopleRequest } from "../shared/kyc-people";
import { signOffDenial, type SignOffFacts } from "../shared/party-kyc";
import { amlNextStep, type AmlBoxFacts } from "../shared/aml-box";
import { amlBucket, amlStage, amlWaitingOn } from "../shared/aml-dashboard";

const today = new Date("2026-11-21T10:00:00Z");
const form = {
  firm: "Smith & Co LLP", kind: "solicitor", where: "uk", regulator: "SRA", regulatorRef: "123456", contact: "Jane Smith",
  agreedOn: "2026-11-20", note: "The buyer's solicitors identified and verified the company, its two directors and its owner.",
  agreed: true, informationHeld: true, copiesOnRequest: true,
};
const refused = (over: Record<string, unknown>) => {
  const r = relianceInput({ ...form, ...over }, today);
  assert.equal(r.ok, false, JSON.stringify(over));
  return r.ok ? "" : r.message;
};

test("a UK firm under the regulations, with every condition confirmed, is recorded in its own words", () => {
  const r = relianceInput(form, today);
  assert.ok(r.ok);
  assert.deepEqual(r.value, {
    firm: "Smith & Co LLP", kind: "solicitor", where: "uk", country: null, regulator: "SRA", regulatorRef: "123456", contact: "Jane Smith",
    agreedOn: "2026-11-20", note: "The buyer's solicitors identified and verified the company, its two directors and its owner.",
  });
  assert.equal(relianceWords(r.value), "Relying on Smith & Co LLP's checks (solicitors, SRA 123456), agreed 20 Nov 2026");
  // The supervisor typed again with the number is not said twice.
  assert.equal(relianceWords({ ...r.value, regulatorRef: "SRA 123456" }), "Relying on Smith & Co LLP's checks (solicitors, SRA 123456), agreed 20 Nov 2026");
  assert.equal(relianceWords({ ...r.value, regulatorRef: null }), "Relying on Smith & Co LLP's checks (solicitors, SRA), agreed 20 Nov 2026");
  // A multipart form sends its ticks as "true".
  assert.ok(relianceInput({ ...form, agreed: "true", informationHeld: "true", copiesOnRequest: "true" }, today).ok);
});

test("each of the regulation's conditions must be confirmed, and the firm named with its supervisor and the day it agreed", () => {
  assert.match(refused({ firm: " " }), /Name the firm/);
  assert.match(refused({ kind: "bookmaker" }), /what kind of firm/);
  assert.match(refused({ where: "" }), /UK or abroad/);
  assert.match(refused({ regulator: "" }), /supervisor/);
  assert.match(refused({ agreedOn: "20/11/2026" }), /date the firm agreed/);
  assert.match(refused({ agreedOn: "2026-12-25" }), /cannot be in the future/);
  assert.match(refused({ agreed: false }), /agreed in writing/);
  assert.match(refused({ informationHeld: undefined }), /beneficial owners/);
  assert.match(refused({ copiesOnRequest: "no" }), /immediately on request/);
  assert.match(refused({ note: "Checked." }), /at least a sentence/);
});

test("a firm abroad names its country, confirms equivalent rules, and is never in a FATF call-for-action country (reg 39(4))", () => {
  assert.match(refused({ where: "abroad" }), /Name the country/);
  assert.match(refused({ where: "abroad", country: "France" }), /equivalent money laundering rules/);
  assert.match(refused({ where: "abroad", country: "Iran", equivalent: true }), /cannot rely on a firm in Iran: it is on FATF's call-for-action list\./);
  const fr = relianceInput({ ...form, where: "abroad", country: "France", regulator: "Ordre des avocats de Paris", regulatorRef: "", equivalent: true }, today);
  assert.ok(fr.ok);
  assert.equal(relianceWords(fr.value), "Relying on Smith & Co LLP's checks (solicitors in France, Ordre des avocats de Paris), agreed 20 Nov 2026");
});

test("the officers are told the regulation's terms: BGP stays responsible, copies at once, and no enhanced due diligence", () => {
  const all = RELIANCE_TERMS.join(" ");
  assert.match(all, /stays responsible/);
  assert.match(all, /immediately on request/);
  assert.match(all, /does not cover enhanced due diligence/);
  assert.doesNotMatch(all, /working days/);
});

// ── What it changes ─────────────────────────────────────────────────────────

const relied: PartyReliance = {
  id: "7", firm: "Smith & Co LLP", kind: "solicitor", where: "uk", country: null, regulator: "SRA", regulatorRef: "123456", contact: null,
  agreedOn: "2026-11-20", note: "Checked the company, its directors and its owner.", by: "Jack Barratt", at: "2026-11-21T10:00:00Z", documents: 1,
};

type Ch = NonNullable<NonNullable<PartyPeopleInput["precheck"]>["companiesHouse"]>;
const register: Ch = {
  number: "07600004", name: "TESTCO LIMITED", status: "active", type: "ltd", incorporatedOn: null, registeredOffice: null,
  jurisdiction: null, sicCodes: [], accountsOverdue: false, confirmationOverdue: false, lastAccountsMadeUpTo: null, lastAccountsType: null,
  hasInsolvencyHistory: false, insolvencyCases: 0, listing: null, chain: [], offshoreOwners: [], disqualified: [], covenant: null, documents: [], statements: [],
  officers: [{ name: "SMITH, Anna", role: "director", appointedOn: null, dob: { month: 3, year: 1980 }, nationality: "British" }],
  owners: [{ name: "Mr Ben Jones", kind: "individual", controls: ["ownership-of-shares-75-to-100-percent"], notifiedOn: "2020-01-01", dob: { month: 1, year: 1975 } } as any],
  peopleUpChain: [],
};
const request = (over: Partial<PeopleRequest> = {}): PeopleRequest => ({
  token: "t-main", ref: "ABC123", companyId: "brand-1", recipientName: "Anna Smith", person: null,
  cancelled: false, expired: false, finished: false, sentAt: "2026-11-20T10:00:00Z", needsIdCheck: true, docs: [], ownerNames: [], idChecks: [], files: [], ...over,
});

test("while it stands, the people to check owe nothing and each is marked as covered", () => {
  const input: PartyPeopleInput = { companyId: "brand-1", kind: "company", precheck: { companiesHouse: register, sanctions: null as any }, requests: [request()] };
  const before = partyPeople(input);
  assert.ok(before.people.length >= 1);
  assert.ok(before.outstanding.length >= 1);
  const after = partyPeople({ ...input, reliance: relied });
  assert.deepEqual(after.outstanding, []);
  for (const p of after.people) {
    assert.deepEqual(p.outstanding, [], p.name);
    assert.equal(p.reliedOn, "Relying on Smith & Co LLP's checks (solicitors, SRA 123456), agreed 20 Nov 2026");
    assert.equal(p.canSend, false);
  }
  assert.equal(after.reliance?.words, "Relying on Smith & Co LLP's checks (solicitors, SRA 123456), agreed 20 Nov 2026");
  assert.equal(after.reliance?.by, "Jack Barratt");
  // A private individual's side is covered the same way.
  const person = partyPeople({ companyId: "brand-2", kind: "individual", precheck: null, requests: [request({ companyId: "brand-2", recipientName: "Sam Lee" })], reliance: relied });
  assert.deepEqual(person.outstanding, []);
});

const facts = (over: Partial<SignOffFacts> = {}): SignOffFacts => ({
  rejected: false, current: null, withKyc4u: false, redFlags: 0, dealRedFlags: 0, unchecked: [], higherRisk: false,
  precheck: { ranAt: "2026-11-20T10:00:00Z" }, precheckRunning: false, clientChecksFinished: false, note: "", now: today, ...over,
});

test("the sign-off needs no note while BGP relies on the firm's checks, but a red flag needs the officers' note", () => {
  assert.match(signOffDenial(facts()) || "", /client checks are not finished/);
  assert.equal(signOffDenial(facts({ reliance: relianceWords(relied) })), null);
  // Reliance does not cover enhanced due diligence (HMRC): the officers do it, with a note (KYC4U is no longer used).
  assert.match(signOffDenial(facts({ reliance: relianceWords(relied), redFlags: 1 })) || "", /Enhanced due diligence by BGP/);
  assert.match(signOffDenial(facts({ reliance: relianceWords(relied), ownersAbroad: ["Kirkbi A/S, Denmark"] })) || "", /Enhanced due diligence by BGP/);
});

const box: AmlBoxFacts = {
  role: "purchaser", stage: "relied", due: true, approvedBy: null, expiresAt: null, notRequiredWords: null,
  company: true, companyMissing: false, gaps: [], askName: "Anna Smith", precheckRunning: false,
  redFlags: 0, factors: 0, sanctionsOnly: false, clientChecks: true, request: null, people: [], kyc4u: "none",
  canSignOff: true, canDecide: true, signOffBlocked: null, needsNote: false, reliance: relianceWords(relied), relianceFirm: relied.firm,
};

test("the Next line: sign it off on the firm's checks, after the red flag and billing steps", () => {
  const step = amlNextStep(box);
  assert.equal(step.action, "sign_off");
  // A short line (22 November 2026): the firm's details are in the Documents step.
  assert.equal(`${step.lead} · ${step.words}`, "Ready to sign off · relying on Smith & Co");
  // Enhanced: the officers sign it off with a note (KYC4U is no longer used, 23 November 2026).
  const flagged = amlNextStep({ ...box, redFlags: 2 });
  assert.equal(flagged.action, "sign_off");
  assert.equal(`${flagged.lead} · ${flagged.words}`, "Ready to sign off · relying on Smith & Co; add a note");
  assert.equal(amlNextStep({ ...box, ownersAbroad: "Kirkbi A/S, Denmark" }).action, "sign_off");
  assert.equal(amlNextStep({ ...box, redFlags: 2, canDecide: false }).action, null, "an agent cannot");
  assert.equal(amlNextStep({ ...box, kyc4u: "raised" }).action, "sign_off", "a past KYC4U request holds nothing up");
  assert.equal(amlNextStep({ ...box, billingDiffers: true }).action, "billing");
  const blocked = amlNextStep({ ...box, signOffBlocked: "BGP's checks before asking have not run for this party. Press Run again on the card first." });
  assert.equal(blocked.action, null);
  assert.equal(`${blocked.lead} · ${blocked.words}`, "Not ready to sign off · BGP's checks before asking have not run for this party");
  const agentOnly = amlNextStep({ ...box, canSignOff: false });
  assert.equal(agentOnly.who, "officers");
  assert.equal(`${agentOnly.lead} · ${agentOnly.words}`, "Relying on Smith & Co · an agent or an officer signs off");
});

test("the AML dashboard: its own stage, in progress, waiting on BGP's sign-off", () => {
  const stage = amlStage({
    role: "purchaser", dealStatus: "SOL", kyc: { status: null, expiresAt: null }, precheckAt: "2026-11-20T10:00:00Z",
    clientSentAt: null, clientFinishedAt: null, kyc4uOpen: false, kyc4uInReview: false, reliedAt: "2026-11-21T10:00:00Z",
  }, today);
  assert.equal(stage, "relied");
  assert.equal(amlBucket(stage, true), "in_progress");
  assert.equal(amlWaitingOn(stage, 0), "BGP: sign off");
  // A decision still comes first.
  assert.equal(amlStage({
    role: "purchaser", dealStatus: "SOL", kyc: { status: "approved", expiresAt: "2029-11-21T00:00:00Z" }, precheckAt: null,
    clientSentAt: null, clientFinishedAt: null, kyc4uOpen: false, kyc4uInReview: false, reliedAt: "2026-11-21T10:00:00Z",
  }, today), "approved");
});
