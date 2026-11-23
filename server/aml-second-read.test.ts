// Trusts to KYC4U in full and the officers' second read (Jack, 20 November 2026).
import test from "node:test";
import assert from "node:assert/strict";
import { checkSecondRead, quoteInSource, secondReadItems, secondReadSystem } from "../shared/aml-second-read";
import { TRUST_CHECKLIST, policyFactorFlags, trustChecklistNote } from "../shared/aml-policy";
import { foundationMarkInName, isTrustRecord, partyGaps, trustMarkInName } from "../shared/deal-parties";
import { amlNextStep, type AmlBoxFacts } from "../shared/aml-box";

test("a name that reads like a trust is spotted, as a suggestion only", () => {
  assert.equal(trustMarkInName("URC Thames North Trust"), true);
  assert.equal(trustMarkInName("The Smith Family Settlement"), true);
  assert.equal(trustMarkInName("Trustees of the Grosvenor Estate"), true);
  assert.equal(trustMarkInName("Trustpilot Ltd"), false);
  assert.equal(trustMarkInName("Gail's Bakery"), false);
  assert.equal(isTrustRecord("trust"), true);
  assert.equal(isTrustRecord("Trust"), true);
  assert.equal(isTrustRecord("company"), false);
});

test("a foundation is spotted by name in its own languages, never a company that carries the word (21 November 2026)", () => {
  for (const n of ["Holm Fonden", "LEGO Fonden", "Stichting Pensioenfonds ABP", "Fondation Hoffmann", "Kirkbi Stiftung", "Stiftelsen Ikano", "Fundación Amancio Ortega"]) {
    assert.equal(foundationMarkInName(n), true, n);
  }
  for (const n of ["Foundation Coffee House Ltd", "The X Foundation Limited", "Holm Fonden A/S", "Fond Restaurant", "Gail's Bakery", "The Wellcome Trust"]) {
    assert.equal(foundationMarkInName(n), false, n);
  }
  // English law has no foundation: the English word counts only for one registered abroad
  // (Woody, 21 November 2026: "Don't want to break what we've built").
  assert.equal(foundationMarkInName("The Smith Foundation"), false);
  assert.equal(foundationMarkInName("The Smith Foundation", { abroad: true }), true);
  assert.equal(foundationMarkInName("Foundation Coffee House Ltd", { abroad: true }), false);
});

test("a foundation in the ownership, on the register, abroad or above a company abroad, is the trust factor", () => {
  const precheck = (over: Record<string, unknown>): any => ({
    kind: "precheck", version: 1, ranAt: "2026-11-21T10:00:00Z",
    party: { companyId: "b1", name: "Party", subjectKind: "company", contactName: null },
    companiesHouse: { number: "01234567", name: "PARTY LTD", status: "active", type: "ltd", incorporatedOn: null, registeredOffice: null, jurisdiction: "england-wales",
      sicCodes: [], accountsOverdue: false, confirmationOverdue: false, lastAccountsMadeUpTo: null, lastAccountsType: null, hasInsolvencyHistory: false, insolvencyCases: 0,
      officers: [], owners: [], statements: [], listing: null, chain: [], peopleUpChain: [], offshoreOwners: [], ownersAbroad: [], disqualified: [], covenant: null, documents: [], ...over },
    notAtCompaniesHouse: null, sanctions: { ran: true, lists: [], lines: [], error: null }, web: { ran: false, lines: [], skipped: null }, complyAdvantage: { ran: false, lines: [], skipped: null }, errors: [],
  });
  const onRegister = policyFactorFlags({ precheck: precheck({ owners: [{ name: "Stichting Administratiekantoor Holm", kind: "company", controls: ["voting-rights-75-to-100-percent"], notifiedOn: null, country: "Netherlands" }] }) });
  const f = onRegister.find(x => x.kind === "policy_trust");
  assert.ok(f, "a foundation owner is the trust factor");
  assert.match(f!.label, /^A foundation in the ownership: Stichting Administratiekantoor Holm/);
  assert.match(f!.detail || "", /charter and by-laws/);
  const abroad = policyFactorFlags({ precheck: precheck({ ownersAbroad: [{ name: "Holm Fonden", country: "Denmark", registrationNumber: null, controls: [], foundAt: null, via: "register" }] }) });
  assert.ok(abroad.some(x => x.kind === "policy_trust"));
  const company = policyFactorFlags({ precheck: precheck({ owners: [{ name: "Foundation Coffee Holdings Ltd", kind: "company", controls: [], notifiedOn: null, country: "England" }] }) });
  assert.ok(!company.some(x => x.kind === "policy_trust"), "a company with the word in its name is not a foundation");
  // A UK charity called "… Foundation" owning a UK company reads as it always did.
  const ukCharity = policyFactorFlags({ precheck: precheck({ owners: [{ name: "The Smith Family Foundation", kind: "company", controls: ["ownership-of-shares-75-to-100-percent"], notifiedOn: null, country: "England" }] }) });
  assert.ok(!ukCharity.some(x => x.kind === "policy_trust"), "a UK-registered foundation is read by the register's own rules");
  const jersey = policyFactorFlags({ precheck: precheck({ owners: [{ name: "The Smith Family Foundation", kind: "company", controls: ["ownership-of-shares-75-to-100-percent"], notifiedOn: null, country: "Jersey" }] }) });
  assert.ok(jersey.some(x => x.kind === "policy_trust"), "a Jersey foundation is one");
});

test("a party recorded as a trust is enhanced, and needs no company that signs", () => {
  const flags = policyFactorFlags({ precheck: null, companyType: "Vendor", subjectType: "trust" });
  assert.ok(flags.some(f => f.kind === "policy_trust" && f.factor));
  assert.deepEqual(partyGaps({ role: "vendor", kind: "company", brandName: "A Trust", companySet: false, person: { name: "A", email: "a@x.com" }, trust: true }), []);
  assert.deepEqual(partyGaps({ role: "vendor", kind: "company", brandName: "A Co", companySet: false, person: { name: "A", email: "a@x.com" } }).map(g => g.key), ["company"]);
});

test("a trust is the officers' in full: client checks, then their sign-off (KYC4U is no longer used, 23 November 2026)", () => {
  const facts: AmlBoxFacts = {
    role: "vendor", stage: "bgp_checked", due: true, approvedBy: null, expiresAt: null, notRequiredWords: null,
    company: true, companyMissing: false, gaps: [], askName: "Adam Harvey", precheckRunning: false, redFlags: 0, factors: 1,
    sanctionsOnly: false, clientChecks: true, request: null, people: [], canSignOff: true, canDecide: true,
    signOffBlocked: null, needsNote: false, trust: true,
  };
  const step = amlNextStep(facts);
  assert.equal(step.action, "send_client_checks");
  assert.doesNotMatch(`${step.lead} ${step.words}`, /KYC4U/);
  const done = amlNextStep({ ...facts, request: { status: "finished", to: "Adam Harvey" } });
  assert.equal(done.action, "sign_off");
  assert.equal(done.who, "officers");
  // A KYC4U request made before 23 November 2026 holds nothing up.
  assert.equal(amlNextStep({ ...facts, kyc4u: "raised" }).action, "send_client_checks");
});

test("KYC4U's note carries the trust checklist, without the officer's sign-off", () => {
  const note = trustChecklistNote();
  assert.match(note, /^TRUST: BGP's AML checklist for trusts/);
  assert.match(note, /2\. Trust Registration Service/);
  assert.doesNotMatch(note, /11\. Nominated Officer sign-off/);
  assert.equal(TRUST_CHECKLIST.length, 11);
});

test("the second read checks every item and sets each quote against its document", () => {
  const items = secondReadItems("trust");
  assert.equal(items.length, 10);
  assert.ok(!items.some(i => /sign-off/i.test(i.title)));
  assert.match(secondReadSystem("trust", "URC <x>"), /Never decide or advise/);
  const sources = [
    { id: "R", name: "BGP's record", text: "BGP check: Sanctions: 8 names screened, no match" },
    { id: "D1", name: "deed.pdf", text: "THIS DEED OF TRUST is made between the Settlor John Smith and the Trustees" },
    { id: "D2", name: "photo.jpg", text: null },
  ];
  const read = checkSecondRead({
    items: [
      { n: 1, status: "found", source: "D1", quote: "made between the Settlor John Smith", note: null },
      { n: 2, status: "found", source: "D1", quote: "registered with HMRC under URN XYZ", note: null },
      { n: 5, status: "found", source: "D2", quote: "PASSPORT JANE DOE", note: null },
      { n: 6, status: "found", source: null, quote: "x", note: null },
      { n: 10, status: "partly", source: "R", quote: "8 names screened, no match", note: "Settlor not screened." },
    ],
    concerns: [{ text: "The deed names three trustees, the record two.", source: "D1", quote: null }, { text: "", source: null, quote: null }],
  }, { checklist: "trust", sources, documents: [], readAt: "2026-11-20T12:00:00Z" });
  const by = (n: number) => read.items.find(i => i.n === n)!;
  assert.equal(by(1).status, "found"); assert.equal(by(1).quoteChecked, true); assert.equal(by(1).where, "deed.pdf");
  assert.equal(by(2).status, "partly"); assert.equal(by(2).quoteChecked, false); assert.match(by(2).note || "", /not found in deed\.pdf/);
  assert.equal(by(5).status, "found"); assert.equal(by(5).quoteChecked, null);
  assert.equal(by(6).status, "missing"); assert.equal(by(6).where, null);
  assert.equal(by(3).status, "missing"); assert.equal(by(3).quote, null);
  assert.equal(by(10).status, "partly");
  assert.equal(read.concerns.length, 1);
  assert.equal(quoteInSource("ab", sources[1]), false);
});
