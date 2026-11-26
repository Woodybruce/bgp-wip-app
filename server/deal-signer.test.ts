// Another company that signs for the same party (Woody, 24 November 2026, on
// #4664's party box: "can we add 2 entities? maybe should disappear with just
// clear left and also add another entity"; then "yes"). Each one is a
// customer: its findings are the party's red flags, a company's owners (or the
// person) are people to check, the sign-off waits for BGP's checks on it, and
// the party reads cleared only once each one holds its own approval.
import test from "node:test";
import assert from "node:assert/strict";
import { SIGNER_ROLES, isSignerRole, signerChecksDenial, signerLine, signerRedFlags, signersNotCleared } from "../shared/deal-guarantor";
import { partyPeople, type PartyPeopleInput } from "../shared/kyc-people";
import { applySigners, kycVerdict, signOffDenial, type SignOffFacts } from "../shared/party-kyc";
import { amlStillNeeded, type StillNeededInput } from "../shared/aml-file";
import { kycPersonRoleWords, kycRequestEmail } from "../shared/kyc-request";

type Ch = NonNullable<NonNullable<PartyPeopleInput["precheck"]>["companiesHouse"]>;
const register = (over: Partial<Ch>): Ch => ({
  number: "OC443074", name: "ST JOHN'S HILL PH03 LLP", status: "active", type: "llp", incorporatedOn: null, registeredOffice: null,
  jurisdiction: null, sicCodes: [], accountsOverdue: false, confirmationOverdue: false, lastAccountsMadeUpTo: null, lastAccountsType: null,
  hasInsolvencyHistory: false, insolvencyCases: 0, officers: [], owners: [], statements: [], listing: null, chain: [], peopleUpChain: [],
  offshoreOwners: [], disqualified: [], covenant: null, documents: [], ...over,
});
const sanctions = (names: string[]) => ({ ran: true, lists: ["UK", "US"], error: null, lines: names.map(name => ({ name, role: "owner", outcome: "clear" as const, matches: [] })) });

test("any party can have another contracting entity", () => {
  assert.deepEqual([...SIGNER_ROLES], ["landlord", "tenant", "vendor", "purchaser"]);
  assert.ok(isSignerRole("landlord"));
  assert.ok(isSignerRole("vendor"));
  assert.ok(!isSignerRole("guarantor"));
  assert.equal(signerLine({ name: "BLUECAP TWO LIMITED", kind: "company", companiesHouseNumber: "12345678", checks: { state: "done", ranAt: null, redFlags: 0 } }),
    "BLUECAP TWO LIMITED (12345678) · BGP's checks have run · no red flags");
});

test("its findings are the party's red flags, under keys of their own", () => {
  const precheck: any = {
    kind: "precheck", ranAt: "2026-11-24T10:00:00Z", companiesHouse: register({ name: "BLUECAP TWO LIMITED", number: "12345678" }),
    sanctions: { ran: true, lists: ["UK", "US"], error: null, lines: [{ name: "BLUECAP TWO LIMITED", role: "the company", outcome: "possible", matches: [{ source: "uk", name: "BLUECAP TWO LIMITED", why: "every word of the name" }] }] },
    web: { ran: true, lines: [], skipped: null }, complyAdvantage: { ran: false, lines: [], skipped: "not set up" }, notAtCompaniesHouse: null, errors: [],
  };
  const flags = signerRedFlags({ signer: { id: "ent-s", name: "BLUECAP TWO LIMITED" }, precheck });
  assert.ok(flags.length >= 1);
  for (const f of flags) {
    assert.match(f.key, /^signer:ent-s:/);
    assert.match(f.label, /^Also signs, BLUECAP TWO LIMITED: /);
  }
  assert.deepEqual(signerRedFlags({ signer: { id: "x", name: "X" }, precheck: null }), []);
});

test("a person who signs too and the owners of a contracting entity too are people to check", () => {
  const out = partyPeople({
    companyId: "brand-1", kind: "company",
    precheck: { companiesHouse: register({}), sanctions: sanctions([]) } as any,
    requests: [],
    signers: [
      { name: "BLUECAP TWO LIMITED", kind: "company", precheck: { companiesHouse: register({
        name: "BLUECAP TWO LIMITED", number: "12345678",
        owners: [{ name: "Mrs Ana Owner", kind: "individual", controls: ["ownership-of-shares-75-to-100-percent"], notifiedOn: null, dob: { month: 3, year: 1970 } } as any],
        officers: [{ name: "DIRECTOR, Dan", role: "director", appointedOn: null, dob: { month: 5, year: 1975 }, nationality: "British" }],
      }), sanctions: sanctions(["Ana Owner", "Dan Director"]) } as any },
      { name: "Sam Signer", kind: "individual", precheck: null },
    ],
  });
  const byName = (n: string) => out.people.find(p => p.name.toLowerCase().includes(n.toLowerCase()));
  const ana = byName("Ana Owner")!;
  assert.deepEqual(ana.roles, ["signer_owner"]);
  assert.match(ana.ownerDetail || "", /owns or controls BLUECAP TWO LIMITED, which also signs/);
  assert.equal(ana.sanctions, "clear", "screened by BGP's checks on the other company");
  // An owner of the other company does an identity check and sends a proof of address (Jack, 26 November 2026).
  assert.deepEqual(ana.outstanding, ["identity check", "proof of address"]);
  const sam = byName("Sam Signer")!;
  assert.deepEqual(sam.roles, ["signer"]);
  assert.deepEqual(sam.outstanding, ["identity check", "proof of address"]);
  // Its other director is screened only.
  assert.deepEqual(out.directors.map(d => d.name), ["Dan Director"]);
});

test("a person's own link says why they are asked", () => {
  assert.equal(kycPersonRoleWords(["signer"], "Mount Anvil"), "signing with Mount Anvil");
  assert.equal(kycPersonRoleWords(["signer_owner"], "Mount Anvil"), "an owner of a company signing with Mount Anvil");
  const html = kycRequestEmail({
    recipientName: "Ana Owner", partyName: "Mount Anvil", dealName: "One Clapham", kind: "individual", needsIdCheck: true,
    docs: ["proof_of_address"], ref: "ABC123", link: "https://example.invalid/kyc", agents: [], expiresAt: "2026-12-08T00:00:00Z",
    person: { key: "ana owner", name: "Ana Owner", roles: ["signer_owner"] },
  } as any).html;
  assert.match(html, /owns or controls a company signing with Mount Anvil/);
});

const facts = (over: Partial<SignOffFacts> = {}): SignOffFacts => ({
  rejected: false, current: null, withKyc4u: false, redFlags: 0, dealRedFlags: 0, unchecked: [], higherRisk: false,
  precheck: { ranAt: "2026-11-23T10:00:00Z" }, precheckRunning: false, clientChecksFinished: true, note: "",
  now: new Date("2026-11-24T12:00:00Z"), ...over,
});

test("the party is signed off only once BGP's checks on each contracting entity have run", () => {
  assert.equal(signOffDenial(facts({ signerChecks: [{ name: "BLUECAP TWO LIMITED", state: "done" }] })), null);
  assert.match(signOffDenial(facts({ signerChecks: [{ name: "BLUECAP TWO LIMITED", state: "not_run" }] }))!,
    /Run BGP's checks on each contracting entity first \(BLUECAP TWO LIMITED: have not run\)/);
  assert.match(signOffDenial(facts({ signerChecks: [{ name: "BLUECAP TWO LIMITED", state: "running" }] }))!, /which also signs, are still running/);
  // Enhanced (a red flag) and sanctions-only: the same wait.
  assert.match(signOffDenial(facts({ redFlags: 1, signerChecks: [{ name: "A", state: "stale" }] }))!, /Run BGP's checks on each contracting entity first/);
  assert.match(signOffDenial(facts({ sanctionsOnly: true, signerChecks: [{ name: "A", state: "not_run" }] }))!, /Run BGP's checks on each contracting entity first/);
  assert.equal(signerChecksDenial([]), null);
  assert.equal(signerChecksDenial(undefined), null);
});

test("the party reads cleared only once each other contracting entity is signed off too", () => {
  const now = new Date("2026-11-24T12:00:00Z");
  const approved = { name: "A", status: "approved", expiresAt: "2029-11-24T00:00:00Z", scope: null } as const;
  assert.deepEqual(signersNotCleared([approved], true, now), []);
  assert.deepEqual(signersNotCleared([{ ...approved, name: "B", status: null }], true, now), ["B"]);
  assert.deepEqual(signersNotCleared([{ ...approved, name: "C", expiresAt: "2026-01-01T00:00:00Z" }], true, now), ["C"]);
  // A sanctions-only approval covers a small letting only.
  assert.deepEqual(signersNotCleared([{ ...approved, name: "D", scope: "sanctions_only" }], true, now), ["D"]);
  assert.deepEqual(signersNotCleared([{ ...approved, name: "D", scope: "sanctions_only" }], false, now), []);

  const cleared = { status: "approved", expiresAt: "2029-01-01", approvedBy: "Jack Barratt", approvedAt: "2026-11-24" };
  assert.equal(applySigners(cleared, []).status, "approved");
  const open = applySigners(cleared, ["BLUECAP TWO LIMITED"]);
  assert.equal(open.status, null);
  assert.equal(open.approvedBy, null);
  assert.deepEqual(open.signersOpen, ["BLUECAP TWO LIMITED"]);
  assert.equal(kycVerdict(open, now).reason, "BLUECAP TWO LIMITED also signs and is not signed off yet");
  // A party not approved stays as it was.
  assert.equal(applySigners({ status: "rejected", expiresAt: null, approvedBy: null }, ["X"]).status, "rejected");
});

test("the AML file says what is still needed on each contracting entity", () => {
  const base: StillNeededInput = {
    deadline: null, settled: null, needsCompany: true, companySet: true, precheck: "done", flags: [], level: "standard",
    sanctionsOnly: false, peopleOutstanding: [], requests: [], anyRequest: true, jointGaps: [], trustGaps: [],
  };
  const out = amlStillNeeded({ ...base, signers: [{ name: "BLUECAP TWO LIMITED", state: "not_run" }, { name: "Sam Signer", state: "done" }] });
  assert.ok(out.includes("Run BGP's checks on BLUECAP TWO LIMITED, which also signs."));
  assert.ok(!out.some(l => /Sam Signer/.test(l)));
});
