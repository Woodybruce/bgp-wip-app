// Simplified due diligence said out loud, and the public body record
// (Layla, 23 November 2026, on #3965, The Crown Estate).
import test from "node:test";
import assert from "node:assert/strict";
import { knownPublicBody, publicBodyMarkInName, publicBodyCase, sddNoteDraft, sddNoteProblem, signsItself, isPublicBodyRecord, wrongCompaniesHouseLink, filedFromWrongLink } from "../shared/aml-sdd";
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

// Woody, 25 November 2026, on #4600: "its a public body this and cant be found
// on companies house but its suggesting a random company name".
test("a local authority's corporate name reads as a public body; the City of London Corporation is known", () => {
  for (const n of ["The Mayor and Commonalty and Citizens of the City of London", "City of London", "City of London Corporation", "Corporation of London"]) {
    assert.equal(knownPublicBody(n)?.key, "city_of_london", n);
    assert.equal(publicBodyMarkInName(n), true, n);
  }
  for (const n of ["The Lord Mayor and Citizens of the City of Westminster", "The Mayor and Burgesses of the London Borough of Camden",
    "The Mayor, Aldermen and Burgesses of the Borough of Reading", "The Secretary of State for Transport", "London Borough of Hackney"]) {
    assert.equal(publicBodyMarkInName(n), true, n);
  }
  // The body acting as trustee of a trust is the trust's case, and a company is never the body.
  assert.equal(publicBodyMarkInName("The Mayor and Commonalty and Citizens of the City of London as Trustees of The Bridge House Estates"), false);
  assert.equal(publicBodyMarkInName("City of London Investment Trust plc"), false);
  assert.equal(knownPublicBody("City of London Investment Trust"), null);
  assert.equal(publicBodyMarkInName("The Mayor Gallery"), false);
});

test("a Companies House number on a public body's record naming another company is a mistake", () => {
  const city = "The Mayor and Commonalty and Citizens of the City of London";
  const link = wrongCompaniesHouseLink(city, { number: "07932290", name: "ALAXIA LIMITED" });
  assert.deepEqual(link, { number: "07932290", name: "ALAXIA LIMITED" });
  assert.deepEqual(wrongCompaniesHouseLink("Westminster City Council", { number: "04383394", name: "CITYWEST HOMES LIMITED" }), { number: "04383394", name: "CITYWEST HOMES LIMITED" });
  // Its own name on the register (a Royal Charter body), a number with no name, or a company record: not this.
  assert.equal(wrongCompaniesHouseLink("Arts Council England", { number: "RC000748", name: "ARTS COUNCIL ENGLAND" }), null);
  assert.equal(wrongCompaniesHouseLink(city, { number: "07932290", name: "" }), null);
  assert.equal(wrongCompaniesHouseLink("Bill's Restaurants", { number: "05722125", name: "BILLS RESTAURANTS LTD." }), null);
  assert.equal(wrongCompaniesHouseLink(city, { number: "", name: "ALAXIA LIMITED" }), null);
  // The company filed from it: by its number (padded), else by its name.
  assert.equal(filedFromWrongLink({ name: "ALAXIA LIMITED", companiesHouseNumber: "7932290" }, link), true);
  assert.equal(filedFromWrongLink({ name: "Alaxia Ltd", companiesHouseNumber: null }, link), true);
  assert.equal(filedFromWrongLink({ name: "City Surveyor's Department", companiesHouseNumber: null }, link), false);
  assert.equal(filedFromWrongLink({ name: "ALAXIA LIMITED", companiesHouseNumber: "01234567" }, link), false);
  assert.equal(filedFromWrongLink({ name: "ALAXIA LIMITED", companiesHouseNumber: "07932290" }, null), false);
});

test("the SDD note for the City of London Corporation uses its own words; The Crown Estate's are unchanged", () => {
  const city = "The Mayor and Commonalty and Citizens of the City of London";
  const sdd = publicBodyCase(city, true);
  assert.match(sdd.basis, /the local authority for the City of London/);
  const note = sddNoteDraft({ sdd, partyName: city, roleLabel: "Landlord", dealName: "Z to A Enterprises – TBC London", dealRef: 4600, isClient: true, today: new Date("2026-11-25T12:00:00Z") });
  assert.match(note, /the City of London Corporation itself, not a joint venture/);
  assert.match(note, /\[names of the officers, such as the City Surveyor\]/);
  assert.doesNotMatch(note, /Crown Estate|Commissioners/);
  const crown = sddNoteDraft({ sdd: publicBodyCase("The Crown Estate", true), partyName: "The Crown Estate", roleLabel: "Landlord", dealName: "The Crown Estate", today: new Date("2026-11-25T12:00:00Z") });
  assert.match(crown, /The Crown Estate Commissioners themselves, not a joint venture/);
  assert.match(crown, /\[names of the Commissioners or officers\]/);
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
  assert.equal(amlNextStep(facts({})).words, "Set the company that signs");
  // Recorded: no company is asked for, and the client checks go to the person instructing us.
  assert.match(amlNextStep(facts({ companyMissing: false, askName: "Sam Lee" })).words, /Send the client checks to Sam Lee/);
});
