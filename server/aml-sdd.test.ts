// Simplified due diligence said out loud, and the public body record
// (Layla, 23 November 2026, on #3965, The Crown Estate).
import test from "node:test";
import assert from "node:assert/strict";
import { knownPublicBody, publicBodyMarkInName, publicBodyCase, sddNoteDraft, sddNoteProblem, signsItself, isPublicBodyRecord } from "../shared/aml-sdd";
import { dueDiligenceLevel, simplifiedCase } from "../shared/aml-policy";
import { amlNextStep, type AmlBoxFacts } from "../shared/aml-box";
import { defaultKycDocs } from "../shared/kyc-request";
import { precheckAsks } from "../shared/kyc-prechecks";
import { partyGaps } from "../shared/deal-parties";

test("The Crown Estate is known by its own name only, never a vehicle with the words in it", () => {
  assert.equal(knownPublicBody("The Crown Estate")?.key, "crown_estate");
  assert.equal(knownPublicBody("Crown Estate Commissioners")?.key, "crown_estate");
  assert.equal(knownPublicBody("The Crown Estate Regent Street Partnership"), null);
  assert.equal(knownPublicBody("Crown Estate Pension Scheme"), null);
  assert.equal(publicBodyMarkInName("The Crown Estate"), true);
  assert.equal(publicBodyMarkInName("Westminster City Council"), true);
  assert.equal(publicBodyMarkInName("Design Council Enterprises Limited"), false);
  assert.equal(publicBodyMarkInName("Regent Street LP"), false);
});

test("a recorded public body is simplified, with what the file should hold and the joint venture caveat", () => {
  const sdd = simplifiedCase({ precheck: null, partyName: "The Crown Estate", subjectType: "public_body" });
  assert.equal(sdd?.kind, "public_body");
  assert.equal(sdd?.confirmed, true);
  assert.match(sdd!.basis, /Crown Estate Act 1961/);
  assert.equal(sdd!.fileHolds.length, 4);
  assert.match(sdd!.fileHolds[2], /authority to act/);
  assert.match(sdd!.caveat, /joint venture/);
  const level = dueDiligenceLevel({ partyFlags: [], dealFlags: [], simplifiedBasis: sdd!.basis, sdd });
  assert.equal(level.level, "simplified");
  assert.equal(level.sdd?.kind, "public_body");
  // By its name alone it is simplified to confirm; a red flag makes it enhanced and drops the SDD case.
  assert.equal(simplifiedCase({ precheck: null, partyName: "The Crown Estate" })?.confirmed, false);
  const flagged = dueDiligenceLevel({ partyFlags: [{ label: "Possible sanctions match" }], dealFlags: [], simplifiedBasis: sdd!.basis, sdd });
  assert.equal(flagged.level, "enhanced");
  assert.equal(flagged.sdd, undefined);
  assert.equal(simplifiedCase({ precheck: null, partyName: "Bill's Restaurants" }), null);
});

test("a public body is checked on its own record and asked only for authority to act", () => {
  assert.equal(isPublicBodyRecord("Public_Body"), true);
  assert.equal(signsItself("public_body"), true);
  assert.equal(signsItself(null), false);
  assert.deepEqual(defaultKycDocs("company", "landlord", true, false, true), ["authority"]);
  const asks = precheckAsks(null, { kind: "company", role: "tenant", idCheck: false, contactName: "Sam Lee", publicBody: true });
  assert.deepEqual(asks.docs, ["authority"]);
  assert.equal(asks.confirmOwners, null);
  assert.deepEqual(partyGaps({ role: "landlord", kind: "company", brandName: "The Crown Estate", companySet: false, person: { name: "Sam Lee", email: "sam@example.org" }, trust: true }), []);
});

test("the drafted note names the party, the statute and the transaction, and cannot be saved with blanks", () => {
  const sdd = publicBodyCase("The Crown Estate", true);
  const note = sddNoteDraft({ sdd, partyName: "The Crown Estate", roleLabel: "Landlord", dealName: "The Crown Estate", dealRef: 3965, contactName: "Sam Lee", isClient: true, today: new Date("2026-11-23T12:00:00Z") });
  assert.match(note, /23 November 2026/);
  assert.match(note, /BGP's client and the landlord on The Crown Estate \(ref 3965\)/);
  assert.match(note, /statutory corporation under the Crown Estate Act 1961/);
  assert.match(note, /net revenue profit paid to the Treasury/);
  assert.match(note, /Sam Lee instructs us/);
  assert.match(note, /not a joint venture/);
  assert.match(sddNoteProblem(note) || "", /Fill in \[/);
  assert.equal(sddNoteProblem(note.replace(/\[[^\]]+\]/g, "done")), null);
  assert.match(sddNoteProblem("SDD") || "", /sentence or two/);
});

const facts = (over: Partial<AmlBoxFacts>): AmlBoxFacts => ({
  role: "landlord", stage: "not_started", due: true, approvedBy: null, expiresAt: null, notRequiredWords: null,
  company: true, companyMissing: true, gaps: [], askName: null, precheckRunning: false, redFlags: 0, factors: 0,
  sanctionsOnly: false, clientChecks: true, request: null, people: [], canSignOff: true, canDecide: false,
  signOffBlocked: null, needsNote: true, ...over,
} as AmlBoxFacts);

test("the Next line asks to confirm a public body before looking for a company", () => {
  const hint = amlNextStep(facts({ publicBodyHint: true }));
  assert.match(hint.words, /public body \(SDD\)/);
  assert.equal(hint.action, "fill_in");
  assert.ok(`${hint.lead} ${hint.words}`.split(/\s+/).length <= 13);
  assert.equal(amlNextStep(facts({})).words, "Set the contracting entity");
  // Recorded: no company is asked for, and the client checks go to the person instructing us.
  assert.match(amlNextStep(facts({ companyMissing: false, askName: "Sam Lee" })).words, /Send the client checks to Sam Lee/);
});
