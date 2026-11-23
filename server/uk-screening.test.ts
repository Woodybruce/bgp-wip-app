// UK screening without KYC4U (Woody, 21 November 2026: "We need screening on
// GLEIF and foundations in the uk as I'm trying to set this up without using
// kyc4u"). The Charity Commission's register read from small zips built here
// in its own format (a BOM, "[", one object a line starting ","), GLEIF's UK
// registers, a charity's trustees on the people list and in who is screened,
// and the officers' in-house enhanced due diligence. Nothing here goes to the
// network.
import "./test-database-url";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";

import {
  charityConcerns, charityLines, charityNameKey, charityRecordFrom, chTypeMayBeCharity, pickCharity, readsLikeCharity, trusteePersonName,
  type CharityRecord, type PrecheckCharity,
} from "../shared/charity-register";
import { gleifEntityFrom, gleifPartyWords, gleifUkRegister, pickGleifRecord, COMPANIES_HOUSE_AUTHORITIES, type GleifEntity, type PrecheckGleif } from "../shared/foreign-owners";
import { chooseScreened, countryFromCode, gleifOwnerAbroad, precheckRedFlags, abroadTraceLines, gleifPartyLine } from "../shared/kyc-prechecks";
import { partyPeople } from "../shared/kyc-people";
import { signOffDenial, signOffEnhanced, IN_HOUSE_EDD_NOTE_MIN, type SignOffFacts } from "../shared/party-kyc";
import { amlNextStep, type AmlBoxFacts } from "../shared/aml-box";
import { isSanctionsFlag } from "../shared/kyc-red-flags";
import { amlStage, amlWaitingOn } from "../shared/aml-dashboard";

const { lookupCharities } = await import("./charity-register");

// ── The register's download, in its own format ──────────────────────────────

const charityRow = (o: Record<string, unknown>) => ({
  date_of_extract: "2026-11-21T00:00:00", linked_charity_number: 0, charity_type: "Other", charity_registration_status: "Registered",
  date_of_registration: "1961-06-07T00:00:00", date_of_removal: null, charity_reporting_status: "Submission Received",
  latest_acc_fin_period_end_date: "2025-12-31T00:00:00", latest_income: 8898000.0, charity_contact_address1: "6TH FLOOR", charity_contact_postcode: "N1 9JY",
  charity_company_registration_number: null, charity_insolvent: false, charity_in_administration: false, charity_is_cio: null, cio_is_dissolved: null, ...o,
});
const lines = (rows: unknown[]) => `﻿[${rows.map((r, i) => `${i ? "," : ""}${JSON.stringify(r)}`).join("\n")}\n]`;
function zipOf(dir: string, name: string, rows: unknown[]): string {
  const zip = new AdmZip();
  zip.addFile(`${name}.json`, Buffer.from(lines(rows), "utf8"));
  const file = path.join(dir, `${name}.zip`);
  zip.writeZip(file);
  return file;
}
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bgp-charity-test-"));
const files = {
  charity: zipOf(dir, "charity", [
    charityRow({ organisation_number: 200051, registered_charity_number: 200051, charity_name: "ESMEE FAIRBAIRN FOUNDATION" }),
    charityRow({ organisation_number: 210183, registered_charity_number: 210183, charity_name: "WELLCOME TRUST" }),
    charityRow({ organisation_number: 5050001, registered_charity_number: 1100001, charity_name: "THE LIBRARY FOUNDATION", charity_type: "Charitable company", charity_company_registration_number: "4512345" }),
    charityRow({ organisation_number: 300001, registered_charity_number: 300001, charity_name: "ST MARY'S CHURCH" }),
    charityRow({ organisation_number: 300002, registered_charity_number: 300002, charity_name: "St Mary's Church" }),
    charityRow({ organisation_number: 400001, registered_charity_number: 400001, charity_name: "OLD ALMSHOUSE TRUST", charity_registration_status: "Removed", date_of_removal: "2019-03-01T00:00:00" }),
    charityRow({ organisation_number: 400002, registered_charity_number: 400001, linked_charity_number: 1, charity_name: "OLD ALMSHOUSE TRUST FUND" }),
  ]),
  trustee: zipOf(dir, "trustee", [
    { organisation_number: 200051, registered_charity_number: 200051, linked_charity_number: 0, trustee_id: 1, trustee_name: "BEATRICE HANNAH MILLICENT HOLLOND", trustee_is_chair: true, individual_or_organisation: "P", trustee_date_of_appointment: "2009-03-26T00:00:00" },
    { organisation_number: 200051, registered_charity_number: 200051, linked_charity_number: 0, trustee_id: 2, trustee_name: "Professor David Hill", trustee_is_chair: false, individual_or_organisation: "P", trustee_date_of_appointment: null },
    { organisation_number: 210183, registered_charity_number: 210183, linked_charity_number: 0, trustee_id: 3, trustee_name: "THE WELLCOME TRUST LIMITED", trustee_is_chair: false, individual_or_organisation: "O", trustee_date_of_appointment: "1992-04-24T00:00:00" },
    { organisation_number: 5050001, registered_charity_number: 1100001, linked_charity_number: 0, trustee_id: 4, trustee_name: "Sir John Smith OBE", trustee_is_chair: true, individual_or_organisation: "P", trustee_date_of_appointment: null },
  ]),
  other: zipOf(dir, "other", [
    { organisation_number: 200051, registered_charity_number: 200051, linked_charity_number: 0, charity_name_id: 9, charity_name_type: "Previous name", charity_name: "THE ESMEE FAIRBAIRN CHARITABLE TRUST" },
  ]),
};

test("the register's download is read: a name with an accent, a number, a company number and a previous name", async () => {
  const [byName, byNumber, byCompany, byOldName] = await lookupCharities([
    { names: ["Esmée Fairbairn Foundation"] },
    { number: "0210183" },
    { companyNumber: "4512345" },
    { names: ["The Esmée Fairbairn Charitable Trust"] },
  ], { files });
  assert.equal(byName.status, "found");
  assert.equal(byName.via, "name");
  assert.equal(byName.charity?.number, "200051");
  assert.equal(byName.extractDate, "2026-11-21");
  assert.deepEqual(byName.trustees.map(t => [t.name, t.chair]), [["BEATRICE HANNAH MILLICENT HOLLOND", true], ["Professor David Hill", false]]);
  assert.deepEqual(byName.otherNames, ["THE ESMEE FAIRBAIRN CHARITABLE TRUST"]);
  assert.equal(byNumber.charity?.name, "WELLCOME TRUST");
  assert.equal(byNumber.via, "number");
  assert.equal(byCompany.charity?.name, "THE LIBRARY FOUNDATION");
  assert.equal(byCompany.via, "company");
  assert.equal(byCompany.charity?.companyNumber, "04512345");
  assert.equal(byOldName.charity?.number, "200051");
});

test("a company that is a charity's trustee is read as acting for it; two charities of one name are not chosen between", async () => {
  const [wellcome, stMarys, nothing] = await lookupCharities([
    { companyNumber: "02711000", names: ["THE WELLCOME TRUST LIMITED"] },
    { names: ["St Mary's Church"] },
    { names: ["Nobody's Foundation"] },
  ], { files });
  assert.equal(wellcome.status, "found");
  assert.equal(wellcome.via, "trustee");
  assert.equal(wellcome.charity?.name, "WELLCOME TRUST");
  assert.deepEqual(wellcome.trusteeOf?.map(t => t.number), ["210183"]);
  assert.match(charityLines(wellcome)[0], /lists it as a trustee of WELLCOME TRUST \(charity 210183\): it acts for that charity/);
  assert.equal(stMarys.status, "ambiguous");
  assert.equal(stMarys.candidates, 2);
  assert.match(charityLines(stMarys)[0], /2 charities .* the charity number is needed to choose/);
  assert.equal(nothing.status, "not_found");
  assert.match(charityLines(nothing)[0], /Not on the Charity Commission's register under the name Nobody's Foundation/);
});

test("switched off, or not downloadable, the look-up says so and never throws", async () => {
  const before = process.env.CHARITY_REGISTER;
  process.env.CHARITY_REGISTER = "off";
  try {
    const [off] = await lookupCharities([{ names: ["Esmée Fairbairn Foundation"] }]);
    assert.equal(off.status, "skipped");
  } finally {
    if (before === undefined) delete process.env.CHARITY_REGISTER; else process.env.CHARITY_REGISTER = before;
  }
  const [broken] = await lookupCharities([{ names: ["x"] }], { files: { charity: path.join(dir, "missing.zip"), trustee: files.trustee, other: files.other } });
  assert.equal(broken.status, "error");
  assert.match(charityLines(broken)[0], /could not be read/);
});

// ── The rules ───────────────────────────────────────────────────────────────

const rec = (o: Partial<CharityRecord>): CharityRecord => ({
  organisationNumber: 1, number: "100001", linked: 0, name: "X", type: null, status: "registered", registeredOn: null, removedOn: null, reporting: null,
  accountsTo: null, income: null, companyNumber: null, insolvent: false, inAdministration: false, cio: false, cioDissolved: false, address: null, web: null, activities: null, ...o,
});

test("a registered charity wins over a removed one of the same name; one removed charity alone is still found", () => {
  const removed = rec({ organisationNumber: 2, name: "OLD TRUST", status: "removed", removedOn: "2019-03-01" });
  const live = rec({ organisationNumber: 3, name: "OLD TRUST" });
  assert.equal(pickCharity({ names: ["Old Trust"] }, [removed, live]).pick?.organisationNumber, 3);
  assert.equal(pickCharity({ names: ["Old Trust"] }, [removed]).pick?.organisationNumber, 2);
  assert.equal(charityNameKey("The Esmée Fairbairn & Co Foundation"), "esmee fairbairn and co foundation");
  assert.equal(charityRecordFrom({ organisation_number: 9, registered_charity_number: "", charity_name: "X" }), null);
});

test("removed, insolvent, in administration and a dissolved CIO are red flags; overdue returns are warnings", () => {
  const c = rec({ status: "removed", removedOn: "2019-03-01", insolvent: true, inAdministration: true, cioDissolved: true, reporting: "Submission Double Default" });
  const concerns = charityConcerns(c);
  assert.deepEqual(concerns.filter(x => x.red).map(x => x.key), ["removed", "insolvent", "administration", "cio_dissolved"]);
  assert.deepEqual(concerns.filter(x => !x.red).map(x => x.key), ["double_default"]);
  const pc: PrecheckCharity = { status: "found", lookedFor: "the name X", via: "name", candidates: 1, error: null, charity: c, otherNames: [], trustees: [], extractDate: null };
  const flags = precheckRedFlags({
    kind: "precheck", version: 1, ranAt: "2026-11-21T10:00:00Z", party: { companyId: "c1", name: "X", subjectKind: "company", contactName: null },
    companiesHouse: null, notAtCompaniesHouse: null, sanctions: { ran: true, lists: ["UK"], lines: [], error: null },
    web: { ran: false, lines: [], skipped: null }, complyAdvantage: { ran: false, lines: [], skipped: null }, charity: pc, errors: [],
  } as any, { sanctionsCurrent: true });
  assert.deepEqual(flags.filter(f => f.kind === "charity_status").map(f => f.key), ["cc:removed", "cc:insolvent", "cc:administration", "cc:cio_dissolved"]);
  assert.match(flags[0].facts![0].url!, /charity-details\/1$/);
});

test("a trustee's name loses its titles and letters, never a surname; the words that trigger a look-up", () => {
  assert.equal(trusteePersonName("Professor David Hill"), "David Hill");
  assert.equal(trusteePersonName("Sir John Smith OBE"), "John Smith");
  assert.equal(trusteePersonName("The Rt Hon Lady Jane Brown CBE"), "Jane Brown");
  assert.equal(trusteePersonName("Dr Wanda Wyporska"), "Wanda Wyporska");
  assert.equal(trusteePersonName("Jack Ma"), "Jack Ma");
  assert.equal(trusteePersonName("Dr Smith"), "Dr Smith");
  assert.ok(readsLikeCharity("The Esmée Fairbairn Foundation"));
  assert.ok(readsLikeCharity("Guy's Almshouses"));
  assert.ok(!readsLikeCharity("Hammerson plc"));
  assert.ok(chTypeMayBeCharity("private-limited-guarant-nsc"));
  assert.ok(chTypeMayBeCharity("private-limited-guarant-nsc-limited-exemption"));
  assert.ok(!chTypeMayBeCharity("ltd"));
});

// ── GLEIF in the UK ─────────────────────────────────────────────────────────

const gleifRecord = (lei: string, name: string, registeredAs: string, ra: string, jurisdiction = "GB"): any => ({
  id: lei, attributes: { lei, entity: { legalName: { name }, jurisdiction, legalAddress: { country: jurisdiction.split("-")[0] }, registeredAs, registeredAt: { id: ra }, status: "ACTIVE" }, registration: { status: "ISSUED", lastUpdateDate: "2026-06-01T00:00:00Z" } },
});

test("GLEIF records the register: a Companies House number is not the same number on the charity register", () => {
  const company = gleifEntityFrom(gleifRecord("549300YQJTZ9YPHW5V73", "THE WELLCOME TRUST LIMITED", "02711000", "RA000585"))!;
  const charity = gleifEntityFrom(gleifRecord("213800ABCDEFGHIJKL12", "ESMEE FAIRBAIRN FOUNDATION", "200051", "RA000589"))!;
  assert.equal(company.registeredAt, "RA000585");
  assert.equal(gleifUkRegister(company)?.register, "companies_house");
  assert.equal(gleifUkRegister(charity)?.register, "charity_commission");
  const clash = gleifEntityFrom(gleifRecord("213800CLASHCLASHCL99", "SOME CHARITY", "2711000", "RA000589"))!;
  const pick = pickGleifRecord({ name: "THE WELLCOME TRUST LIMITED", country: "GB", registrationNumber: "02711000", authorities: COMPANIES_HOUSE_AUTHORITIES }, [company, clash]);
  assert.equal(pick.pick?.lei, company.lei);
  // By name, still only on the registers asked for.
  const byName = pickGleifRecord({ name: "SOME CHARITY", country: "GB", registrationNumber: null, authorities: COMPANIES_HOUSE_AUTHORITIES }, [clash]);
  assert.equal(byName.pick, null);
});

const ukTrace = (parents: GleifEntity[]): PrecheckGleif => ({
  by: "number", name: "UKCO LIMITED", checkedAt: "2026-11-21T10:00:00Z",
  trace: { status: "found", entity: gleifEntityFrom(gleifRecord("5493001KJTIIGC8Y1R12", "UKCO LIMITED", "01234567", "RA000585"))!, parents, top: { kind: "people", reason: "NATURAL_PERSONS", words: "owned or controlled by individuals; GLEIF does not name them" }, candidates: 1, error: null },
});
const ch = (over: Record<string, unknown> = {}): any => ({
  number: "01234567", name: "UKCO LIMITED", status: "active", type: "ltd", owners: [], peopleUpChain: [], listing: null, ownersAbroad: [], officers: [], statements: [], chain: [], ...over,
});

test("a UK company's top parent abroad in GLEIF joins the owners abroad only when the register names no owner", () => {
  const ukParent = gleifEntityFrom(gleifRecord("5493002UKPARENT00012", "UKCO HOLDINGS LIMITED", "07654321", "RA000585"))!;
  const dk = gleifEntityFrom(gleifRecord("5493005XXPWUMR2E5305", "KIRKBI A/S", "12345678", "", "DK"))!;
  const g = ukTrace([ukParent, dk]);
  const added = gleifOwnerAbroad(ch(), g);
  assert.deepEqual(added && { name: added.name, country: added.country, via: added.via }, { name: "KIRKBI A/S", country: "Denmark", via: "gleif" });
  // The register names a person: nothing is added.
  assert.equal(gleifOwnerAbroad(ch({ owners: [{ name: "Mr A Person", kind: "individual", controls: [] }] }), g), null);
  // Only UK parents: nothing abroad to add.
  assert.equal(gleifOwnerAbroad(ch(), ukTrace([ukParent])), null);
  assert.equal(countryFromCode("US-DE"), "United States");
  assert.match(gleifPartyWords(g), /^GLEIF: UKCO LIMITED, LEI 5493001KJTIIGC8Y1R12, on Companies House \(England and Wales\) as 01234567, found by its Companies House number; its parents in GLEIF: UKCO HOLDINGS LIMITED \(GB\), then KIRKBI A\/S \(DK\); at the top, owned or controlled by individuals/);
  // The party's own GLEIF line is apart from the owners-abroad trace.
  assert.equal(gleifPartyLine({ gleif: g }), gleifPartyWords(g));
  assert.deepEqual(abroadTraceLines({ abroad: null }), []);
});

// ── A charity's trustees: who is screened, and the people list ─────────────

test("trustees are screened in full as the charity's controllers when no owner is named", () => {
  const screen = chooseScreened([
    { name: "ESMEE FAIRBAIRN FOUNDATION", role: "the company", person: false },
    { name: "Beatrice Hollond", role: "trustee (chair)", person: true, trustee: true },
    { name: "David Hill", role: "trustee", person: true, trustee: true },
    { name: "THE WELLCOME TRUST LIMITED", role: "corporate trustee", person: false },
    { name: "Ann Clerk", role: "the deal's contact", person: true },
  ], { individual: false, listed: false, maxPeople: 10 });
  assert.equal(screen.basis, "trustees");
  assert.deepEqual(screen.full.map(s => s.name), ["ESMEE FAIRBAIRN FOUNDATION", "THE WELLCOME TRUST LIMITED", "Beatrice Hollond", "David Hill"]);
  assert.deepEqual(screen.sanctionsOnly.map(s => s.name), ["Ann Clerk"]);
});

test("People to check lists a charity's trustees with their sanctions result; a director who is a trustee is listed once", () => {
  const pc: PrecheckCharity = {
    status: "found", lookedFor: "the name X", via: "company", candidates: 1, error: null, extractDate: null, otherNames: [],
    charity: rec({ name: "THE LIBRARY FOUNDATION", number: "1100001", companyNumber: "04512345" }),
    trustees: [{ name: "Sir John Smith OBE", chair: true, organisation: false, appointedOn: null }, { name: "Mary Jones", chair: false, organisation: false, appointedOn: null }, { name: "TRUSTEE CO LIMITED", chair: false, organisation: true, appointedOn: null }],
  };
  const people = partyPeople({
    companyId: "c1", kind: "company", requests: [],
    precheck: {
      companiesHouse: ch({ type: "private-limited-guarant-nsc", officers: [{ name: "SMITH, John", role: "director", appointedOn: null, dob: null, nationality: null }, { name: "BROWN, Peter", role: "director", appointedOn: null, dob: null, nationality: null }] }),
      sanctions: { ran: true, lists: ["UK"], error: null, lines: [{ name: "John Smith", role: "trustee (chair)", person: true, outcome: "clear", matches: [] }] as any },
      charity: pc,
    },
  });
  assert.equal(people.basis, "charity");
  assert.deepEqual(people.trustees?.map(t => [t.name, t.chair, t.sanctions]), [["John Smith", true, "clear"], ["Mary Jones", false, "not_screened"]]);
  assert.deepEqual(people.directors.map(d => d.name), ["Peter Brown"]);
  assert.deepEqual(people.charity, { name: "THE LIBRARY FOUNDATION", number: "1100001", actsAsTrustee: false });
  assert.deepEqual(people.outstanding, []);
});

// ── In-house enhanced due diligence ─────────────────────────────────────────

const facts = (over: Partial<SignOffFacts> = {}): SignOffFacts => ({
  rejected: false, current: null, withKyc4u: false, redFlags: 1, dealRedFlags: 0, unchecked: [], higherRisk: false,
  precheck: { ranAt: "2026-11-20T10:00:00Z" }, precheckRunning: false, clientChecksFinished: true, note: "", now: new Date("2026-11-21T10:00:00Z"), ...over,
});
const eddNote = "Trust deed and TRS excerpt seen; settlor's source of wealth is a 2019 property sale, completion statement on file; trustees screened clear.";

test("an enhanced party: the officers sign it off with a note, after any sanctions match (KYC4U is no longer used, 23 November 2026)", () => {
  // Read as it stood before then, it went to KYC4U.
  assert.match(signOffDenial(facts({ inHouseEdd: false })) || "", /KYC4U/);
  assert.match(signOffDenial(facts({ inHouseEdd: false, ownersAbroad: ["KIRKBI A/S, Denmark"] })) || "", /KYC4U/);
  assert.match(signOffDenial(facts()) || "", /Enhanced due diligence by BGP: say what was checked/);
  assert.ok(signOffEnhanced(facts({ redFlags: 0, higherRisk: true })));
  assert.ok(!signOffEnhanced(facts({ redFlags: 0 })));
  const on = { inHouseEdd: true };
  assert.match(signOffDenial(facts({ ...on, sanctionsFlags: 1, note: eddNote })) || "", /possible sanctions match stands/);
  assert.match(signOffDenial(facts({ ...on, note: "Checked it." })) || "", /Enhanced due diligence by BGP: say what was checked/);
  assert.ok(eddNote.length >= IN_HOUSE_EDD_NOTE_MIN);
  assert.equal(signOffDenial(facts({ ...on, note: eddNote })), null);
  assert.equal(signOffDenial(facts({ ...on, redFlags: 0, ownersAbroad: ["KIRKBI A/S, Denmark"], note: eddNote })), null);
  // The same freshness rules as any sign-off.
  assert.match(signOffDenial(facts({ ...on, precheck: null, note: eddNote })) || "", /have not run/);
  // A KYC4U request raised earlier no longer holds the party; read as before 23 November 2026, it did.
  assert.equal(signOffDenial(facts({ withKyc4u: true, note: eddNote })), null);
  assert.match(signOffDenial(facts({ withKyc4u: true, inHouseEdd: false, note: eddNote })) || "", /raised with KYC4U/);
  assert.ok(isSanctionsFlag({ kind: "provider_screen", evidence: ["type:sanctions"] }));
  assert.ok(!isSanctionsFlag({ kind: "provider_screen", evidence: ["type:pep"] }));
});

const box = (over: Partial<AmlBoxFacts> = {}): AmlBoxFacts => ({
  role: "vendor", stage: "not_started", due: true, approvedBy: null, expiresAt: null, notRequiredWords: null,
  company: true, companyMissing: false, gaps: [], askName: "Jane Trustee", precheckRunning: false,
  redFlags: 0, factors: 1, sanctionsOnly: false, clientChecks: true, request: null, people: [], kyc4u: "none",
  // An enhanced company (a factor): a trust never goes to KYC4U since 23 November 2026 (server/trust-structure.test.ts).
  canSignOff: true, canDecide: false, signOffBlocked: null, needsNote: true, trust: false, ...over,
});

test("the Next line: the client checks and then the officers (KYC4U is no longer used)", () => {
  assert.equal(amlNextStep(box()).action, "send_client_checks");
  const sent = amlNextStep(box({ inHouseEdd: true }));
  assert.equal(sent.action, "send_client_checks");
  assert.match(sent.words, /Send the client checks to Jane Trustee/);
  assert.equal(amlNextStep(box({ inHouseEdd: true, sanctionsFlags: 1 })).action, "red_flags");
  const done = { inHouseEdd: true, request: { status: "finished" as const, to: "Jane Trustee" } };
  // An agent cannot sign off enhanced due diligence: it waits on the officers.
  const agent = amlNextStep(box({ ...done, canDecide: false }));
  assert.equal(agent.action, null);
  assert.equal(agent.who, "officers");
  const officer = amlNextStep(box({ ...done, canDecide: true }));
  assert.equal(officer.action, "sign_off");
  assert.equal(`${officer.lead} · ${officer.words}`, "Ready to sign off · enhanced: add a note");
  assert.equal(officer.who, "officers");
});

test("in-house, KYC4U holds nothing up: the Next line, the board's stage and who it waits on (22 November 2026)", () => {
  // A request prepared or raised with KYC4U earlier: the checks carry on.
  assert.equal(amlNextStep(box({ kyc4u: "queued" })).action, "send_client_checks");
  assert.equal(amlNextStep(box({ kyc4u: "raised" })).action, "send_client_checks");
  assert.equal(amlNextStep(box({ kyc4u: "queued", inHouseEdd: true })).action, "send_client_checks");
  assert.equal(amlNextStep(box({ kyc4u: "raised", inHouseEdd: true })).action, "send_client_checks");
  assert.equal(amlNextStep(box({ stage: "with_kyc4u", inHouseEdd: true })).action, "send_client_checks");
  // Client checks switched off: the officers with a note.
  assert.equal(amlNextStep(box({ clientChecks: false, trust: false, factors: 0 })).action, null);
  assert.equal(amlNextStep(box({ clientChecks: false, trust: false, factors: 0, inHouseEdd: true, canDecide: true })).action, "sign_off");
  // An approval running out never sends anyone to KYC4U in-house.
  assert.equal(amlNextStep(box({ stage: "expired", clientChecks: false, inHouseEdd: true })).action, null);
  const facts = { role: "landlord", dealStatus: "SOL", kyc: { status: "in_review", expiresAt: null }, precheckAt: null, clientSentAt: null, clientFinishedAt: null, kyc4uOpen: true, kyc4uInReview: true };
  assert.equal(amlStage(facts as any), "not_started");
  assert.equal(amlStage({ ...facts, inHouse: false } as any), "with_kyc4u", "as it stood before 23 November 2026");
  assert.equal(amlWaitingOn("client_finished", 2), "Officers: sign off");
  assert.equal(amlWaitingOn("bgp_checked", 1), "BGP: send the client checks");
});
