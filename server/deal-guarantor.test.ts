// Guarantors (Woody, 23 November 2026, on Inception T2: "one is signing
// cornhill bar and the other is guaranteeing so should be able to allocate
// add as the guarantor"). HMRC AMLG2300 s18: a guarantor is a party to the
// tenancy and a customer. The rules are shared/deal-guarantor.ts; its people
// join the party's (shared/kyc-people.ts) and the party's sign-off waits for
// BGP's checks on it (shared/party-kyc.ts).
import test from "node:test";
import assert from "node:assert/strict";
import {
  GUARANTEED_ROLES, guarantorChecksDenial, guarantorChecksState, guarantorLine, guarantorRedFlags, isGuaranteedRole,
} from "../shared/deal-guarantor";
import { partyPeople, type PartyPeopleInput } from "../shared/kyc-people";
import { signOffDenial, type SignOffFacts } from "../shared/party-kyc";
import { amlStillNeeded, type StillNeededInput } from "../shared/aml-file";
import { kycPersonRoleWords, kycRequestEmail } from "../shared/kyc-request";

type Ch = NonNullable<NonNullable<PartyPeopleInput["precheck"]>["companiesHouse"]>;
const register = (over: Partial<Ch>): Ch => ({
  number: "16694952", name: "CORNHILL BAR LTD", status: "active", type: "ltd", incorporatedOn: null, registeredOffice: null,
  jurisdiction: null, sicCodes: [], accountsOverdue: false, confirmationOverdue: false, lastAccountsMadeUpTo: null, lastAccountsType: null,
  hasInsolvencyHistory: false, insolvencyCases: 0, officers: [], owners: [], statements: [], listing: null, chain: [], peopleUpChain: [],
  offshoreOwners: [], disqualified: [], covenant: null, documents: [], ...over,
});
const sanctions = (names: string[]) => ({ ran: true, lists: ["UK", "US"], error: null, lines: names.map(name => ({ name, role: "director", outcome: "clear" as const, matches: [] })) });

// The tenant signs; its owners are two people up the chain. The guarantor, a
// group company, has the same two owners and a director of its own.
const tenant = register({
  officers: [{ name: "GILKES, Charles Nigel Heming", role: "director", appointedOn: null, dob: { month: 4, year: 1970 }, nationality: "British" }],
  peopleUpChain: [
    { name: "Mr Charles Nigel Heming Gilkes", foundAt: "D&C Group Holdings Ltd", controls: ["ownership-of-shares-25-to-50-percent"], dob: { month: 4, year: 1970 } },
    { name: "Mr Duncan Andrew Stirling", foundAt: "D&C Group Holdings Ltd", controls: ["ownership-of-shares-25-to-50-percent"], dob: { month: 9, year: 1972 } },
  ],
});
const guarantorCo = register({
  number: "07950473", name: "INCEPTION VENTURES GROUP LIMITED",
  officers: [
    { name: "STIRLING, Duncan Andrew", role: "director", appointedOn: null, dob: { month: 9, year: 1972 }, nationality: "British" },
    { name: "SMITH, Alex", role: "director", appointedOn: null, dob: { month: 1, year: 1980 }, nationality: "British" },
  ],
  owners: [
    { name: "Mr Duncan Andrew Stirling", kind: "individual", controls: ["ownership-of-shares-25-to-50-percent"], notifiedOn: null, dob: { month: 9, year: 1972 } } as any,
    { name: "Mrs Pat Jones", kind: "individual", controls: ["ownership-of-shares-25-to-50-percent"], notifiedOn: null, dob: { month: 2, year: 1965 } } as any,
  ],
});

test("a guarantor stands behind the tenant or the buyer", () => {
  assert.deepEqual([...GUARANTEED_ROLES], ["tenant", "purchaser"]);
  assert.ok(isGuaranteedRole("tenant"));
  assert.ok(!isGuaranteedRole("landlord"));
  assert.ok(!isGuaranteedRole("guarantor"));
});

test("where BGP's checks on a guarantor stand", () => {
  const now = new Date("2026-11-23T12:00:00Z");
  assert.equal(guarantorChecksState(null, false, now), "not_run");
  assert.equal(guarantorChecksState(null, true, now), "running");
  assert.equal(guarantorChecksState("2026-11-20T09:00:00Z", false, now), "done");
  assert.equal(guarantorChecksState("2026-10-01T09:00:00Z", false, now), "stale");
  assert.equal(guarantorLine({ name: "Inception Ventures Group Limited", kind: "company", companiesHouseNumber: "07950473", checks: { state: "done", ranAt: null, redFlags: 0 } }),
    "Inception Ventures Group Limited (07950473) · BGP's checks have run · no red flags");
  assert.equal(guarantorLine({ name: "Pat Jones", kind: "individual", companiesHouseNumber: null, checks: { state: "not_run", ranAt: null, redFlags: 0 } }),
    "Pat Jones (a person) · BGP's checks have not run");
});

test("the guarantor's findings are the party's red flags, under keys of their own", () => {
  const precheck: any = {
    kind: "precheck", ranAt: "2026-11-23T10:00:00Z", companiesHouse: guarantorCo,
    sanctions: { ran: true, lists: ["UK", "US"], error: null, lines: [{ name: "INCEPTION VENTURES GROUP LIMITED", role: "the company", outcome: "possible", matches: [{ source: "uk", name: "INCEPTION VENTURES GROUP LIMITED", why: "every word of the name" }] }] },
    web: { ran: true, lines: [], skipped: null }, complyAdvantage: { ran: false, lines: [], skipped: "not set up" }, notAtCompaniesHouse: null, errors: [],
  };
  const flags = guarantorRedFlags({ guarantor: { id: "ent-g", name: "Inception Ventures Group Limited" }, precheck });
  assert.ok(flags.length >= 1, "a sanctions match on the guarantor is a flag");
  for (const f of flags) {
    assert.match(f.key, /^guarantor:ent-g:/);
    assert.match(f.label, /^The guarantor, Inception Ventures Group Limited: /);
  }
  assert.deepEqual(guarantorRedFlags({ guarantor: { id: "ent-g", name: "X" }, precheck: null }), []);
});

test("the guarantor's owners and a person who guarantees are people to check; its other directors are screened only", () => {
  const out = partyPeople({
    companyId: "brand-1", kind: "company",
    precheck: { companiesHouse: tenant, sanctions: sanctions(["Charles Nigel Heming Gilkes", "Duncan Andrew Stirling"]) } as any,
    requests: [],
    guarantors: [
      { name: "Inception Ventures Group Limited", kind: "company", precheck: { companiesHouse: guarantorCo, sanctions: sanctions(["Duncan Andrew Stirling", "Pat Jones", "Alex Smith"]) } as any },
      { name: "Sam Guarantor", kind: "individual", precheck: null },
    ],
  });
  const byName = (n: string) => out.people.find(p => p.name.toLowerCase().includes(n.toLowerCase()));
  // The tenant's own owners first; one person however many roles.
  const stirling = byName("Stirling")!;
  assert.ok(stirling.roles.includes("owner"));
  assert.ok(stirling.roles.includes("guarantor_owner"));
  assert.equal(out.people.filter(p => /Stirling/i.test(p.name)).length, 1);
  // An owner of the guarantor only.
  const jones = byName("Pat Jones")!;
  assert.deepEqual(jones.roles, ["guarantor_owner"]);
  assert.match(jones.ownerDetail || "", /owns or controls the guarantor, Inception Ventures Group Limited/);
  assert.equal(jones.sanctions, "clear", "screened by BGP's checks on the guarantor");
  // An owner of the guarantor does an identity check only (25 November 2026: HMRC).
  assert.deepEqual(jones.outstanding, ["identity check"]);
  // A person who guarantees.
  const sam = byName("Sam Guarantor")!;
  assert.deepEqual(sam.roles, ["guarantor"]);
  assert.deepEqual(sam.outstanding, ["identity check", "proof of address"]);
  // The guarantor's other director is screened only, once.
  assert.deepEqual(out.directors.map(d => d.name), ["Alex Smith"]);
  // The party's own basis is still its own register's.
  assert.equal(out.basis, "owners");
});

test("a person's own link says why a guarantor is asked", () => {
  assert.equal(kycPersonRoleWords(["guarantor"], "Inception T2"), "the guarantor for Inception T2");
  assert.equal(kycPersonRoleWords(["guarantor_owner"], "Inception T2"), "an owner of the company guaranteeing Inception T2");
  const html = kycRequestEmail({
    recipientName: "Pat Jones", partyName: "Inception T2", dealName: "Royal Exchange, Unit 3", kind: "individual", needsIdCheck: true,
    docs: ["proof_of_address"], ref: "ABC123", link: "https://example.invalid/kyc", agents: [], expiresAt: "2026-12-07T00:00:00Z",
    person: { key: "pat jones", name: "Pat Jones", roles: ["guarantor_owner"] },
  } as any).html;
  assert.match(html, /owns or controls the company guaranteeing Inception T2/);
});

const facts = (over: Partial<SignOffFacts> = {}): SignOffFacts => ({
  rejected: false, current: null, withKyc4u: false, redFlags: 0, dealRedFlags: 0, unchecked: [], higherRisk: false,
  precheck: { ranAt: "2026-11-22T10:00:00Z" }, precheckRunning: false, clientChecksFinished: true, note: "",
  now: new Date("2026-11-23T12:00:00Z"), ...over,
});

test("the party is signed off only once BGP's checks on its guarantor have run", () => {
  assert.equal(signOffDenial(facts({ guarantorChecks: [{ name: "Inception Ventures Group Limited", state: "done" }] })), null);
  assert.match(signOffDenial(facts({ guarantorChecks: [{ name: "Inception Ventures Group Limited", state: "not_run" }] }))!,
    /Run BGP's checks on the guarantor first \(Inception Ventures Group Limited: have not run\)/);
  assert.match(signOffDenial(facts({ guarantorChecks: [{ name: "Inception Ventures Group Limited", state: "running" }] }))!, /still running/);
  assert.match(signOffDenial(facts({ guarantorChecks: [{ name: "A", state: "stale" }] }))!, /more than 30 days old/);
  // Enhanced (a red flag): the same wait, before the officer's note is asked for.
  assert.match(signOffDenial(facts({ redFlags: 1, guarantorChecks: [{ name: "A", state: "not_run" }] }))!, /Run BGP's checks on the guarantor first/);
  assert.equal(guarantorChecksDenial([]), null);
  assert.equal(guarantorChecksDenial(undefined), null);
});

test("the AML file says what is still needed on the guarantor", () => {
  const base: StillNeededInput = {
    deadline: null, settled: null, needsCompany: true, companySet: true, precheck: "done", flags: [], level: "standard",
    sanctionsOnly: false, peopleOutstanding: [], requests: [], anyRequest: true, jointGaps: [], trustGaps: [],
  };
  const out = amlStillNeeded({ ...base, guarantors: [{ name: "Inception Ventures Group Limited", state: "not_run" }, { name: "Pat Jones", state: "done" }] });
  assert.ok(out.includes("Run BGP's checks on the guarantor, Inception Ventures Group Limited."));
  assert.ok(!out.some(l => /Pat Jones/.test(l)));
});
