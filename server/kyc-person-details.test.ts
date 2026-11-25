// A private individual's date of birth and nationality, typed in by BGP
// (Woody, 24 November 2026): the rules in shared/kyc-person-details.ts, the
// sanctions-only sign-off waiting for the date, and the Next lines.
import test from "node:test";
import assert from "node:assert/strict";
import {
  PERSON_DOB_AFTER_RUN, PERSON_DOB_NEEDED, ageOn, dobParts, personDetailsInput, personDetailsWords, personDobNeeded,
} from "../shared/kyc-person-details";
import { signOffDenial, type SignOffFacts } from "../shared/party-kyc";
import { amlNextStep, type AmlBoxFacts } from "../shared/aml-box";
import { clientKycNextStep, type ClientKycNextFacts } from "../shared/client-kyc";

const today = new Date("2026-11-24T12:00:00Z");

test("what a person types is checked: a real date, 16 to 110 years ago, a nationality in words", () => {
  assert.deepEqual(personDetailsInput({ dateOfBirth: "1971-03-12", nationality: " British " }, today), { ok: true, dateOfBirth: "1971-03-12", nationality: "British" });
  assert.deepEqual(personDetailsInput({ dateOfBirth: "1971-03-12" }, today), { ok: true, dateOfBirth: "1971-03-12", nationality: null });
  assert.equal(personDetailsInput({}, today).ok, false);
  assert.equal(personDetailsInput({ dateOfBirth: "12/03/1971" }, today).ok, false, "the date box sends yyyy-mm-dd");
  assert.deepEqual(personDetailsInput({ dateOfBirth: "1971-02-30" }, today), { ok: false, message: "That date does not exist." });
  assert.deepEqual(personDetailsInput({ dateOfBirth: "2015-01-01" }, today), { ok: false, message: "That makes them under 16: check the date." });
  assert.deepEqual(personDetailsInput({ dateOfBirth: "1890-01-01" }, today), { ok: false, message: "Check the year of birth." });
  assert.equal(personDetailsInput({ dateOfBirth: "1971-03-12", nationality: "<script>" }, today).ok, false);
  assert.equal(personDetailsInput({ dateOfBirth: "1971-03-12", nationality: "Côte d'Ivoire" }, today).ok, true);
  assert.equal(ageOn("2010-11-25", today), 15, "a day before their birthday");
  assert.equal(ageOn("2010-11-24", today), 16);
});

test("the screening takes the year and month; the screens say it plainly", () => {
  assert.deepEqual(dobParts("1971-03-12"), { year: 1971, month: 3 });
  assert.equal(dobParts(null), null);
  assert.equal(personDetailsWords({ dateOfBirth: "1971-03-12", nationality: "British" }), "Born 12 Mar 1971 · British");
  assert.equal(personDetailsWords({ dateOfBirth: "1971-03-12", nationality: null }), "Born 12 Mar 1971");
  assert.equal(personDetailsWords(null), null);
});

test("only a private individual on sanctions checks only needs it before sign-off", () => {
  assert.equal(personDobNeeded({ kind: "individual", sanctionsOnly: true }), true);
  assert.equal(personDobNeeded({ kind: "individual", sanctionsOnly: false }), false, "the full checks take it from the identity check");
  assert.equal(personDobNeeded({ kind: "company", sanctionsOnly: true }), false);
  assert.equal(personDobNeeded({ kind: "individual", sanctionsOnly: true, trust: true }), false);
});

const base: SignOffFacts = {
  rejected: false, current: null, withKyc4u: false, redFlags: 0, dealRedFlags: 0, unchecked: [], higherRisk: false,
  precheck: { ranAt: "2026-11-24T09:00:00Z" }, precheckRunning: false, clientChecksFinished: false, sanctionsOnly: true, note: "", now: today,
};

test("the sanctions-only sign-off of a private individual waits for the date, then for a run with it", () => {
  assert.equal(signOffDenial(base), null, "a company or a person with the date: as before");
  assert.equal(signOffDenial({ ...base, dobNeeded: true }), PERSON_DOB_NEEDED);
  // The date first, before a possible sanctions match: it is what sets a namesake aside.
  assert.equal(signOffDenial({ ...base, dobNeeded: true, sanctionsFlags: 1 }), PERSON_DOB_NEEDED);
  assert.equal(signOffDenial({ ...base, dobAfterRun: true }), PERSON_DOB_AFTER_RUN);
  // Still running with it: the running words.
  assert.match(signOffDenial({ ...base, dobAfterRun: true, precheckRunning: true }) || "", /still running/);
  // The full checks do not ask for it.
  assert.equal(signOffDenial({ ...base, sanctionsOnly: false, clientChecksFinished: true, dobNeeded: false }), null);
});

test("the Next lines ask for the date of birth first", () => {
  const facts: AmlBoxFacts = {
    role: "tenant", stage: "bgp_checked", due: true, approvedBy: null, expiresAt: null, notRequiredWords: null,
    company: false, companyMissing: false, gaps: [], askName: null, precheckRunning: false, redFlags: 0, factors: 0,
    sanctionsOnly: true, clientChecks: true, request: null, people: [], canSignOff: true, canDecide: false,
    signOffBlocked: PERSON_DOB_NEEDED, needsNote: false, dobNeeded: true,
  };
  assert.deepEqual(amlNextStep(facts), { tone: "act", who: "bgp", lead: "To do", words: "Add their date of birth", action: "person_details" });
  assert.equal(amlNextStep({ ...facts, dobNeeded: false, signOffBlocked: null }).lead, "Ready to sign off");
  const client: ClientKycNextFacts = {
    rejected: false, cleared: null, sanctionsOnly: false, precheck: "done", redFlags: 0, canDecide: false, whoToAsk: null,
    request: "none", waitingOn: [], signOffBlocked: PERSON_DOB_NEEDED, sanctionsChecks: true, dobNeeded: true,
  };
  assert.equal(clientKycNextStep(client).action, "person_details");
  assert.equal(clientKycNextStep({ ...client, dobNeeded: false, signOffBlocked: null }).action, "sign_off");
});
