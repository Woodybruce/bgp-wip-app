// A trust checked by BGP, never KYC4U (Jack, 23 November 2026: "Remove KYC4u
// on trusts. We need you to build the trust structuring").
import test from "node:test";
import assert from "node:assert/strict";
import {
  checkTrustStructure, trustPersonOwesChecks, trustStructureGaps, trustStructureLines, trustRoleWords, type TrustStructure,
} from "../shared/trust-structure";
import { partyPeople } from "../shared/kyc-people";
import { chooseScreened, precheckAsks } from "../shared/kyc-prechecks";
import { defaultKycDocs, kycPersonRoleWords } from "../shared/kyc-request";
import { signOffDenial, signOffEnhanced, type SignOffFacts } from "../shared/party-kyc";
import { amlNextStep, type AmlBoxFacts } from "../shared/aml-box";

const structure = (over: Partial<TrustStructure> = {}): TrustStructure => {
  const checked = checkTrustStructure({
    kind: "discretionary", trsStatus: "registered", trsReference: "XATRUST80000001", settlorWealth: "Sale of the family business in 2003.",
    beneficiaryClass: "The settlor's children and remoter issue",
    people: [
      { name: "Margaret Ellis", roles: ["settlor"], dob: { month: 4, year: 1951 } },
      { name: "David Ellis", roles: ["trustee", "beneficiary"] },
      { name: "Sarah Ellis", roles: ["beneficiary"] },
      { name: "Ellis Trustees Limited", roles: ["trustee"], corporate: true, companyNumber: "01234567" },
    ],
    ...over,
  });
  if ("error" in checked) throw new Error(checked.error);
  return checked;
};

test("a structure is checked field by field: full names, a role each, the same person once", () => {
  assert.match((checkTrustStructure({ people: [{ name: "Margaret", roles: ["settlor"] }] }) as any).error, /full name/);
  assert.match((checkTrustStructure({ people: [{ name: "Margaret Ellis", roles: [] }] }) as any).error, /what Margaret Ellis is to the trust/);
  const s = checkTrustStructure({ kind: "nonsense", people: [{ name: "Margaret Ellis", roles: ["settlor"] }, { name: "ELLIS, Margaret", roles: ["trustee"] }] }) as TrustStructure;
  assert.equal(s.kind, "unknown");
  assert.equal(s.people.length, 1);
  assert.deepEqual(s.people[0].roles, ["settlor", "trustee"]);
  assert.equal(trustRoleWords(["trustee", "settlor", "beneficiary"]), "settlor, trustee and beneficiary");
});

test("who is verified: settlor, trustees, protector and control; beneficiaries only when not discretionary; a company never", () => {
  assert.equal(trustPersonOwesChecks({ roles: ["settlor"], corporate: false }, "discretionary"), true);
  assert.equal(trustPersonOwesChecks({ roles: ["beneficiary"], corporate: false }, "discretionary"), false);
  assert.equal(trustPersonOwesChecks({ roles: ["beneficiary"], corporate: false }, "fixed"), true);
  assert.equal(trustPersonOwesChecks({ roles: ["trustee"], corporate: true }, "fixed"), false);
});

test("what the file still needs: the structure recorded, then the deed and HMRC's registration", () => {
  assert.deepEqual(trustStructureGaps(null, { deed: false, trs: false }).map(g => g.key), ["structure", "deed", "trs_excerpt"]);
  assert.deepEqual(trustStructureGaps(structure(), { deed: true, trs: true }), []);
  const thin = checkTrustStructure({ kind: "fixed", trsStatus: "not_required", people: [{ name: "Margaret Ellis", roles: ["settlor"] }] }) as TrustStructure;
  assert.deepEqual(trustStructureGaps(thin, { deed: true, trs: false }).map(g => g.key), ["trustee", "beneficiaries", "wealth"]);
  assert.ok(trustStructureLines(structure(), "The Ellis Settlement").some(l => /Margaret Ellis: settlor, born 4\/1951/.test(l)));
});

test("People to check on a trust: the ones to verify each get a link; the rest are screened only", () => {
  const people = partyPeople({ companyId: "t1", kind: "company", precheck: null, requests: [], trust: structure() });
  assert.equal(people.basis, "trust");
  assert.deepEqual(people.people.map(p => [p.name, p.roles]), [["Margaret Ellis", ["settlor"]], ["David Ellis", ["trustee", "beneficiary"]]]);
  assert.equal(people.people[0].born, "April 1951");
  assert.deepEqual(people.people[0].outstanding, ["identity check", "proof of address"]);
  assert.deepEqual(people.trustNamed?.map(t => t.name), ["Sarah Ellis", "Ellis Trustees Limited"]);
  assert.ok(people.outstanding.some(o => o.startsWith("Margaret Ellis")));
  assert.equal(partyPeople({ companyId: "t1", kind: "company", precheck: null, requests: [], trust: null }).basis, "trust_unrecorded");
  assert.equal(kycPersonRoleWords(["settlor"], "The Ellis Settlement"), "the settlor of The Ellis Settlement");
});

test("the client checks for a trust ask for its own documents, and skip what the file holds", () => {
  assert.deepEqual(defaultKycDocs("company", "vendor", true, true), ["proof_of_address", "trust_deed", "trs_excerpt", "trust_authority", "trust_wealth"]);
  const asks = precheckAsks(null, { kind: "company", role: "purchaser", idCheck: true, contactName: "David Ellis", trust: { deed: true, trs: false, trsNotRequired: false, trustees: ["David Ellis"] } });
  assert.deepEqual(asks.docs, ["proof_of_address", "trs_excerpt", "trust_wealth", "source_of_funds"]);
  assert.deepEqual(asks.notAsked.map(n => n.key), ["trust_deed", "trust_authority"]);
});

test("screening a trust: the people on its structure in full, under reg 6", () => {
  const s = chooseScreened([
    { name: "The Ellis Settlement", role: "the company", person: false },
    { name: "Margaret Ellis", role: "settlor of the trust", person: true, trustPerson: true },
    { name: "Ellis Trustees Limited", role: "company on the trust (trustee)", person: false },
    { name: "Adam Harvey", role: "the deal's contact", person: true },
  ], { individual: false, listed: false, maxPeople: 10 });
  assert.equal(s.basis, "trust");
  assert.deepEqual(s.full.map(x => x.name), ["The Ellis Settlement", "Ellis Trustees Limited", "Margaret Ellis"]);
  assert.deepEqual(s.sanctionsOnly.map(x => x.name), ["Adam Harvey"]);
});

const facts = (over: Partial<SignOffFacts> = {}): SignOffFacts => ({
  rejected: false, current: null, withKyc4u: false, redFlags: 0, dealRedFlags: 0, unchecked: [], higherRisk: false,
  precheck: { ranAt: "2026-11-22T10:00:00Z" }, precheckRunning: false, clientChecksFinished: true, note: "", now: new Date("2026-11-23T10:00:00Z"),
  trust: true, trustGaps: [], ...over,
});
const note = "Deed and HMRC excerpt seen; settlor's wealth from a 2003 business sale, accountant's letter on file; all five screened clear.";

test("a trust is signed off by the officers in-house, whatever the switch, once its file is complete", () => {
  assert.ok(signOffEnhanced(facts()));
  // No KYC4U: a request raised earlier holds nothing up, and the switch need not be on.
  assert.equal(signOffDenial(facts({ withKyc4u: true, note })), null);
  assert.match(signOffDenial(facts({ trustGaps: ["Record the settlor"], note })) || "", /trust's file is not complete: Record the settlor/);
  assert.match(signOffDenial(facts({ clientChecksOutstanding: ["Margaret Ellis: identity check"], note })) || "", /still owe their checks/);
  assert.match(signOffDenial(facts({ note: "ok" })) || "", /say what was checked/);
});

test("the Next line for a trust: the structure first, never KYC4U", () => {
  const box: AmlBoxFacts = {
    role: "vendor", stage: "bgp_checked", due: true, approvedBy: null, expiresAt: null, notRequiredWords: null,
    company: true, companyMissing: false, gaps: [], askName: "David Ellis", precheckRunning: false, redFlags: 0, factors: 1,
    sanctionsOnly: false, clientChecks: false, request: null, people: [], kyc4u: "none", canSignOff: true, canDecide: true,
    signOffBlocked: null, needsNote: true, trust: true, trustGaps: ["Record the trustees"],
  };
  assert.equal(amlNextStep(box).action, "trust");
  assert.equal(amlNextStep({ ...box, trustGaps: [] }).action, "sign_off");
  assert.notEqual(amlNextStep({ ...box, trustGaps: [], kyc4u: "queued" }).action, "kyc4u_form");
});
