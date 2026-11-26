// The people a company's checks are about (Woody, 19 November 2026: "a list
// of people to check for each party: the owners and the person acting, each
// with their own Veriff link and a proof-of-address upload; the directors
// shown with their sanctions result only"). The rules are shared/kyc-people.ts.
// The registers below are deal #4491's as BGP's checks before asking read them.
import test from "node:test";
import assert from "node:assert/strict";
import {
  bornWords, dobAgrees, owesProofOfAddress, partyPeople, personDisplayName, personKey, personRequestAsks, priorAddressProofFor, priorIdCheckFor, verifiedLicenceAddress, verifiedPersonDob,
  type PartyPeopleInput, type PeopleRequest,
} from "../shared/kyc-people";

type Ch = NonNullable<NonNullable<PartyPeopleInput["precheck"]>["companiesHouse"]>;

const register = (over: Partial<Ch>): Ch => ({
  number: "07600004", name: "BRUCE GILLINGHAM POLLARD LIMITED", status: "active", type: "ltd", incorporatedOn: null, registeredOffice: null,
  jurisdiction: null, sicCodes: [], accountsOverdue: false, confirmationOverdue: false, lastAccountsMadeUpTo: null, lastAccountsType: null,
  hasInsolvencyHistory: false, insolvencyCases: 0, officers: [], owners: [], statements: [], listing: null, chain: [], peopleUpChain: [],
  offshoreOwners: [], disqualified: [], covenant: null, documents: [], ...over,
});

// BRUCE GILLINGHAM POLLARD LIMITED: owned more than 75% by Bgp Real Estate
// Limited, whose owners are Woody Bruce and (through Thames Commercial
// Properties Limited) Huseyn Mirhadiyev; four directors.
const bgpLtd = register({
  officers: [
    { name: "BARRATT, Jack", role: "director", appointedOn: null, dob: { month: 3, year: 1990 }, nationality: "British" },
    { name: "BENTLEY-SMITH, Rupert", role: "director", appointedOn: null, dob: { month: 6, year: 1985 }, nationality: "British" },
    { name: "BRUCE, Woody", role: "director", appointedOn: null, dob: { month: 5, year: 1976 }, nationality: "British" },
    { name: "ROBERTS, Charlotte Caroline", role: "director", appointedOn: null, dob: null, nationality: null },
  ],
  owners: [{ name: "Bgp Real Estate Limited", kind: "company", controls: ["ownership-of-shares-75-to-100-percent"], notifiedOn: "2020-07-07" }],
  peopleUpChain: [
    { name: "Mr Woody Bruce", foundAt: "Bgp Real Estate Limited", controls: ["ownership-of-shares-25-to-50-percent"], dob: { month: 5, year: 1976 } },
    { name: "Mr Huseyn Mirhadiyev", foundAt: "Thames Commercial Properties Limited", controls: ["ownership-of-shares-75-to-100-percent"], dob: { month: 2, year: 1982 } },
  ],
});

const sanctions = (names: string[]) => ({ ran: true, lists: ["UK", "US"], error: null, lines: names.map(name => ({ name, role: "director", outcome: "clear" as const, matches: [] })) });

const request = (over: Partial<PeopleRequest>): PeopleRequest => ({
  token: "t-main", ref: "7MJEGT", companyId: "brand-bgp", recipientName: "jack Barrat", person: null,
  cancelled: false, expired: false, finished: false, sentAt: "2026-11-19T16:43:18.270Z", needsIdCheck: true, docs: [], ownerNames: [], idChecks: [], files: [], ...over,
});

// A proof of address as the reader reads it (20 November 2026).
const thamesWater = {
  readAt: "2026-11-20T09:00:05Z", read: true, unreadable: null, kind: "utility_bill" as const, kindWords: "Thames Water bill", issuer: "Thames Water",
  names: ["MR H MIRHADIYEV"], date: "2026-10-30", address: "1 Example Road, London W1", certified: null,
};

test("names read as people write them, and one key for a person however the register spells them", () => {
  assert.equal(personDisplayName("BRUCE, David"), "David Bruce");
  assert.equal(personDisplayName("Mr Woody Bruce"), "Woody Bruce");
  assert.equal(personDisplayName("BENTLEY-SMITH, Rupert"), "Rupert Bentley-Smith");
  assert.equal(personDisplayName("jack Barrat"), "Jack Barrat");
  assert.equal(personDisplayName("O'BRIEN, Siobhan"), "Siobhan O'Brien");
  assert.equal(personDisplayName("Kirsty McDonald"), "Kirsty McDonald");
  assert.equal(personKey("BRUCE, David"), personKey("Mr David Bruce"));
  assert.equal(bornWords({ month: 7, year: 1978 }), "July 1978");
  assert.equal(bornWords({ year: 1978 }), "1978");
  assert.equal(bornWords(null), null);
  assert.equal(verifiedPersonDob({ firstName: "WOODY", lastName: "BRUCE", dateOfBirth: "1976-05-02" }), "1976-05-02");
  assert.equal(verifiedPersonDob({ firstName: "WOODY" }), null);
  assert.equal(dobAgrees({ month: 5, year: 1976 }, "1976-05-02"), true);
  assert.equal(dobAgrees({ month: 5, year: 1976 }, "1976-06-02"), false);
  assert.equal(dobAgrees({ year: 1976 }, "1977-05-02"), false);
  assert.equal(dobAgrees(null, "1977-05-02"), true);
});

test("the owners up the chain and the person acting need checks; the other directors are screened only", () => {
  const out = partyPeople({
    companyId: "brand-bgp", kind: "company",
    precheck: { companiesHouse: bgpLtd, sanctions: sanctions(["BARRATT, Jack", "BENTLEY-SMITH, Rupert", "BRUCE, Woody", "ROBERTS, Charlotte Caroline", "Mr Huseyn Mirhadiyev"]) },
    requests: [request({})],
  });
  assert.equal(out.basis, "owners");
  assert.deepEqual(out.people.map(p => [p.name, p.roles]), [
    ["Woody Bruce", ["owner", "director"]],
    ["Huseyn Mirhadiyev", ["owner"]],
    ["Jack Barratt", ["acting", "director"]],
  ]);
  const huseyn = out.people[1];
  assert.equal(huseyn.ownerDetail, "up the ownership chain, in Thames Commercial Properties Limited: more than 75% of the shares");
  assert.equal(huseyn.born, "February 1982");
  assert.equal(huseyn.sanctions, "clear");
  // An owner does an identity check and sends a proof of address (Jack,
  // 26 November 2026: "applied back to all checks").
  assert.deepEqual(huseyn.outstanding, ["identity check", "proof of address"]);
  assert.equal(huseyn.address.notNeeded, undefined);
  assert.equal(huseyn.canSend, true);
  assert.deepEqual(out.directors, [{ name: "Rupert Bentley-Smith", sanctions: "clear" }, { name: "Charlotte Caroline Roberts", sanctions: "clear" }]);
  assert.equal(out.outstanding.length, 3);
});

test("Woody's check on Jack's link counts for Woody, not for Jack, and a file on the old owners' step is nobody's yet", () => {
  const main = request({
    finished: true, ownerNames: ["Mr Woody Bruce", "Mr Huseyn Mirhadiyev"], docs: ["owner_ids"],
    idChecks: [{ state: "approved", verifiedName: "WOODY BRUCE", verifiedDob: "1976-05-02" }],
    files: [
      { name: "passport.jpg", docKey: "owner_ids", uploadedAt: "2026-11-19T17:00:00Z", url: "/api/chat-media/a.jpg" },
      { name: "passport-2.jpg", docKey: "owner_ids", uploadedAt: "2026-11-19T17:01:00Z", url: "/api/chat-media/b.jpg" },
    ],
  });
  const out = partyPeople({ companyId: "brand-bgp", kind: "company", precheck: { companiesHouse: bgpLtd, sanctions: sanctions([]) }, requests: [main] });
  const [woody, huseyn, jack] = out.people;
  assert.equal(woody.id.state, "passed");
  assert.equal(woody.id.elsewhere, "on the link sent to Jack Barrat (7MJEGT)");
  assert.deepEqual(woody.outstanding, ["proof of address"], "an owner still owes a proof of address (26 November 2026)");
  assert.equal(jack.id.state, "not_started");
  assert.equal(jack.id.someoneElse, "Woody Bruce");
  // Jack acts for the company and is not an owner: a representative sends no
  // proof of address (Jack Barratt, 26 November 2026).
  assert.equal(jack.address.notNeeded, true);
  assert.deepEqual(jack.outstanding, ["identity check"]);
  assert.equal(jack.canSend, true, "his request is finished, so nothing live asks for them");
  assert.equal(huseyn.id.state, "not_started", "a passport on the old owners' step is not his check");
  assert.deepEqual(out.loose, [{ ref: "7MJEGT", files: 2, names: ["Woody Bruce", "Huseyn Mirhadiyev"] }]);
});

test("a check on their own link wins over the same result on someone else's", () => {
  const jacks = request({ ref: "7MJEGT", finished: true, idChecks: [{ state: "approved", verifiedName: "WOODY BRUCE", verifiedDob: null }] });
  const own = request({ token: "t-cap", ref: "4YTTES", recipientName: "woody bruce", idChecks: [{ state: "approved", verifiedName: "WOODY BRUCE", verifiedDob: null }] });
  const out = partyPeople({ companyId: "brand-bgp", kind: "company", precheck: { companiesHouse: bgpLtd, sanctions: sanctions([]) }, requests: [jacks, own] });
  const woody = out.people.find(p => p.name === "Woody Bruce")!;
  assert.equal(woody.id.state, "passed");
  assert.equal(woody.id.ref, "4YTTES");
  assert.equal(woody.id.elsewhere, null);
});

test("a check whose date of birth disagrees with the register is not the person's", () => {
  const main = request({ idChecks: [{ state: "approved", verifiedName: "Woody Bruce", verifiedDob: "1960-01-01" }], recipientName: "Someone Else" });
  const out = partyPeople({ companyId: "brand-bgp", kind: "company", precheck: { companiesHouse: bgpLtd, sanctions: sanctions([]) }, requests: [main] });
  const woody = out.people.find(p => p.name === "Woody Bruce")!;
  assert.equal(woody.id.state, "not_started");
});

test("a person's own request: its check and its proof of address are theirs, and it is their link", () => {
  const own = request({
    token: "t-huseyn", ref: "H2K9QP", recipientName: "Huseyn Mirhadiyev", needsIdCheck: true, docs: ["proof_of_address"],
    person: { key: personKey("Mr Huseyn Mirhadiyev"), name: "Huseyn Mirhadiyev", roles: ["owner"] },
    idChecks: [{ state: "submitted", verifiedName: null, verifiedDob: null }],
    files: [{ name: "bill.pdf", docKey: "proof_of_address", uploadedAt: "2026-11-20T09:00:00Z", url: "/api/chat-media/c.pdf", documentId: "doc-1", reading: thamesWater }],
  });
  const out = partyPeople({ companyId: "brand-bgp", kind: "company", precheck: { companiesHouse: bgpLtd, sanctions: sanctions([]) }, requests: [request({}), own] });
  const huseyn = out.people.find(p => p.name === "Huseyn Mirhadiyev")!;
  assert.equal(huseyn.id.state, "waiting");
  assert.equal(huseyn.address.done, true);
  assert.equal(huseyn.address.proof?.summary, "Thames Water bill, 30 Oct 2026, in the name of MR H MIRHADIYEV");
  assert.deepEqual(huseyn.outstanding, []);
  assert.deepEqual(huseyn.own, { token: "t-huseyn", ref: "H2K9QP", isMain: false, sentAt: "2026-11-19T16:43:18.270Z" });
  assert.equal(huseyn.canSend, false);
});

test("a live request that asks for it means there is nothing to send", () => {
  const live = request({ recipientName: "woody bruce", companyId: "brand-cap", ref: "4YTTES", needsIdCheck: true, docs: ["proof_of_address", "authority"] });
  const cap = register({
    number: "OC424210", name: "BRUCE CAP SERVICES LLP",
    officers: [
      { name: "BRUCE, David", role: "llp-designated-member", appointedOn: null, dob: { month: 7, year: 1978 }, nationality: "British" },
      { name: "BRUCE CAP LTD", role: "corporate-llp-designated-member", appointedOn: null, dob: null, nationality: null },
    ],
    owners: [
      { name: "Bruce Cap Ltd", kind: "company", controls: ["voting-rights-25-to-50-percent-limited-liability-partnership"], notifiedOn: null },
      { name: "Mr David Bruce", kind: "individual", controls: ["voting-rights-25-to-50-percent-limited-liability-partnership"], notifiedOn: null, dob: { month: 7, year: 1978 } },
    ],
    peopleUpChain: [{ name: "Mr Woody Bruce", foundAt: "Bruce Cap Ltd", controls: ["ownership-of-shares-75-to-100-percent"] }],
  });
  const out = partyPeople({ companyId: "brand-cap", kind: "company", precheck: { companiesHouse: cap, sanctions: sanctions([]) }, requests: [live] });
  assert.deepEqual(out.people.map(p => [p.name, p.roles]), [["David Bruce", ["owner", "director"]], ["Woody Bruce", ["owner", "acting"]]]);
  assert.deepEqual(out.directors, [], "a corporate member is not a person to check");
  const woody = out.people[1];
  assert.equal(woody.id.asked, true);
  assert.equal(woody.address.asked, true);
  assert.equal(woody.canSend, false);
  assert.equal(out.people[0].born, "July 1978");
});

test("a listed company, an unread register and a private individual", () => {
  const listed = partyPeople({
    companyId: "brand-bgp", kind: "company",
    precheck: { companiesHouse: { ...bgpLtd, listing: { market: "uk_regulated", company: "BGP PLC", viaParent: false, since: null } as any }, sanctions: sanctions([]) },
    requests: [request({})],
  });
  assert.equal(listed.basis, "listed");
  assert.deepEqual(listed.people.map(p => p.name), ["Jack Barratt"]);
  // The person acting for a listed group owes their identity check, not a
  // proof of address (Woody, 23 November 2026: "If HMRC don't require it then stop it").
  const acting = listed.people[0];
  assert.equal(acting.address.notNeeded, true);
  assert.deepEqual(acting.outstanding, ["identity check"]);
  assert.deepEqual(personRequestAsks(acting, false).docs, ["photo_id"]);
  assert.deepEqual(listed.outstanding, ["Jack Barratt: identity check"]);
  // A company that is not listed: its representative sends none either (Jack, 26 November 2026).
  const unlisted = partyPeople({ companyId: "brand-bgp", kind: "company", precheck: { companiesHouse: { ...bgpLtd, owners: [] }, sanctions: sanctions([]) }, requests: [request({})] });
  const same = unlisted.people.find(p => p.roles.includes("acting"))!;
  assert.equal(same.address.notNeeded, true);
  assert.deepEqual(same.outstanding, ["identity check"]);
  assert.deepEqual(personRequestAsks(same, true).docs, []);
  // And the person acting who is also an owner.
  const ownerActing = partyPeople({ companyId: "brand-bgp", kind: "company", precheck: { companiesHouse: bgpLtd, sanctions: sanctions([]) }, requests: [request({ recipientName: "Woody Bruce" })] });
  const woody = ownerActing.people.find(p => p.roles.includes("acting"))!;
  assert.deepEqual(woody.roles, ["owner", "acting", "director"]);
  assert.equal(woody.address.notNeeded, undefined);
  assert.deepEqual(woody.outstanding, ["identity check", "proof of address"]);
  const unread = partyPeople({ companyId: "brand-bgp", kind: "company", precheck: null, requests: [request({})] });
  assert.equal(unread.basis, "not_read");
  assert.deepEqual(unread.people.map(p => [p.name, p.roles]), [["Jack Barrat", ["acting"]]]);
  assert.equal(partyPeople({ companyId: "x", kind: "individual", precheck: null, requests: [] }).basis, "individual");
});

test("more than one private individual on one side: each is listed with their own checks (Jack, 20 November 2026)", () => {
  const sandy = request({ token: "t-sandy", ref: "SANDY1", companyId: "brand-sandy", recipientName: "Sandy Macaskill",
    idChecks: [{ state: "approved", verifiedName: "Sandy Macaskill", verifiedDob: "1970-04-02" }] });
  const jane = request({ token: "t-jane", ref: "JANE01", companyId: "brand-sandy", recipientName: "Jane Macaskill", sentAt: null,
    person: { key: personKey("Jane Macaskill"), name: "Jane Macaskill", roles: ["joint"] } });
  // A register on an individual is never read.
  const out = partyPeople({ companyId: "brand-sandy", kind: "individual", precheck: { companiesHouse: bgpLtd, sanctions: sanctions([]) }, requests: [sandy, jane] });
  assert.equal(out.basis, "individual");
  assert.deepEqual(out.people.map(p => [p.name, p.roles]), [["Sandy Macaskill", ["acting"]], ["Jane Macaskill", ["joint"]]]);
  assert.deepEqual(out.directors, []);
  const janeRow = out.people.find(p => p.name === "Jane Macaskill")!;
  assert.deepEqual(janeRow.outstanding, ["identity check", "proof of address"]);
  assert.equal(janeRow.own?.ref, "JANE01");
  assert.equal(out.people.find(p => p.name === "Sandy Macaskill")!.id.state, "passed");
  assert.ok(out.outstanding.some(l => l.startsWith("Jane Macaskill: identity check and proof of address")));
});

test("a cancelled request keeps the checks done on it but makes nobody the person acting; another party's files are not this party's", () => {
  const cancelled = request({ cancelled: true, idChecks: [{ state: "approved", verifiedName: "Huseyn Mirhadiyev", verifiedDob: "1982-02-10" }] });
  const other = request({ companyId: "brand-cap", recipientName: "Huseyn Mirhadiyev", files: [{ name: "bill.pdf", docKey: "proof_of_address", uploadedAt: "2026-11-20T09:00:00Z", url: null }] });
  const out = partyPeople({ companyId: "brand-bgp", kind: "company", precheck: { companiesHouse: bgpLtd, sanctions: sanctions([]) }, requests: [cancelled, other] });
  const huseyn = out.people.find(p => p.name === "Huseyn Mirhadiyev")!;
  assert.equal(huseyn.id.state, "passed", "a passed check is evidence whatever became of its link");
  assert.equal(huseyn.address.done, false, "a proof of address belongs to the party it was sent for");
  assert.equal(out.people.some(p => p.roles.includes("acting")), false);
  const started = partyPeople({ companyId: "brand-bgp", kind: "company", precheck: null, requests: [
    request({}),
    request({ token: "t-old", ref: "OLD123", cancelled: true, idChecks: [{ state: "started", verifiedName: null, verifiedDob: null }] }),
  ] });
  assert.equal(started.people[0].id.state, "not_started", "a check under way on a cancelled link is not progress");
  assert.deepEqual(started.people[0].own, { token: "t-main", ref: "7MJEGT", isMain: true, sentAt: "2026-11-19T16:43:18.270Z" });
});

test("a person's own request asks only what is still outstanding", () => {
  assert.deepEqual(personRequestAsks({ id: { state: "passed", ref: "X", elsewhere: null, someoneElse: null, asked: false }, address: { done: false, ref: null, asked: false } }, true),
    { needsIdCheck: false, docs: ["proof_of_address"] });
  assert.deepEqual(personRequestAsks({ id: { state: "not_started", ref: null, elsewhere: null, someoneElse: null, asked: false }, address: { done: false, ref: null, asked: false } }, true),
    { needsIdCheck: true, docs: ["proof_of_address"] });
  assert.deepEqual(personRequestAsks({ id: { state: "not_started", ref: null, elsewhere: null, someoneElse: null, asked: false }, address: { done: true, ref: "Y", asked: false } }, false),
    { needsIdCheck: false, docs: ["photo_id"] });
});

// Woody, 20 November 2026: "with the proof of address is the app checking its
// actually for that person and acceptable? linking it from a name perspective?"
test("a proof of address counts only when it reads as theirs, in date and accepted by the policy, or an officer accepts it", () => {
  // A private individual owes one (HMRC: a customer who is a person has their
  // home address verified); an owner of a company does not (25 November 2026).
  const ownWith = (file: Partial<PeopleRequest["files"][number]>) => request({
    token: "t-huseyn", ref: "H2K9QP", recipientName: "Huseyn Mirhadiyev", needsIdCheck: true, docs: ["proof_of_address"], finished: true,
    files: [{ name: "bill.pdf", docKey: "proof_of_address", uploadedAt: "2026-11-20T09:00:00Z", url: "/api/chat-media/c.pdf", documentId: "doc-1", ...file }],
  });
  const huseynWith = (file: Partial<PeopleRequest["files"][number]>) =>
    partyPeople({ companyId: "brand-bgp", kind: "individual", precheck: null, requests: [ownWith(file)] })
      .people.find(p => p.name === "Huseyn Mirhadiyev")!;

  // Not read yet, or not readable: it does not count, and they can be sent a link for a new one.
  const unread = huseynWith({ reading: null });
  assert.equal(unread.address.done, false);
  assert.equal(unread.address.notNeeded, undefined);
  assert.deepEqual(unread.address.proof?.reasons, ["Not read yet"]);
  assert.ok(unread.outstanding.includes("proof of address"));
  assert.equal(unread.canSend, true);
  const blank = huseynWith({ reading: { ...thamesWater, read: false, unreadable: "the file is empty", kind: null, names: [], date: null } });
  assert.deepEqual(blank.address.proof?.reasons, ["Could not be read: the file is empty"]);

  // Another person's bill, an old one: each says why.
  assert.deepEqual(huseynWith({ reading: { ...thamesWater, names: ["MRS J SMITH"] } }).address.proof?.reasons, ["In the name of MRS J SMITH, not Huseyn Mirhadiyev"]);
  assert.deepEqual(huseynWith({ reading: { ...thamesWater, date: "2026-05-01" } }).address.proof?.reasons, ["Dated 1 May 2026, more than three months before it was sent"]);
  // A photocard driving licence showing the address counts, in date (HMRC
  // AMLG11400 14.2: ID evidence, one document or more; 25 November 2026).
  const licence = { ...thamesWater, kind: "driving_licence" as const, kindWords: "DVLA driving licence", date: "2019-03-12" };
  const inDate = huseynWith({ reading: { ...licence, expires: "2029-03-11" } });
  assert.equal(inDate.address.done, true);
  assert.equal(inDate.address.proof?.summary, "DVLA driving licence, expires 11 Mar 2029, in the name of MR H MIRHADIYEV");
  assert.deepEqual(huseynWith({ reading: { ...licence, expires: "2026-01-01" } }).address.proof?.reasons, ["It expired on 1 Jan 2026"]);
  assert.deepEqual(huseynWith({ reading: licence }).address.proof?.reasons, ["No expiry date found: check it is in date"]);
  assert.deepEqual(huseynWith({ reading: { ...licence, expires: "2029-03-11", address: null } }).address.proof?.reasons, ["No address found on it"]);

  // The Nominated Officer or a Deputy accepting it makes it count, with their note.
  const accepted = huseynWith({ reading: { ...thamesWater, date: "2026-05-01" }, accepted: { by: "Jack Barratt", at: "2026-11-20T10:00:00Z", note: "Annual statement, the latest one issued" } });
  assert.equal(accepted.address.done, true);
  assert.equal(accepted.address.proof?.accepted?.by, "Jack Barratt");
  assert.ok(!accepted.outstanding.includes("proof of address"));

  // A later good proof counts over an earlier bad one.
  const both = request({
    token: "t-huseyn", ref: "H2K9QP", recipientName: "Huseyn Mirhadiyev", docs: ["proof_of_address"], finished: true,
    files: [
      { name: "old.pdf", docKey: "proof_of_address", uploadedAt: "2026-11-20T09:00:00Z", url: "/a", documentId: "doc-1", reading: { ...thamesWater, date: "2026-01-01" } },
      { name: "new.pdf", docKey: "proof_of_address", uploadedAt: "2026-11-20T09:10:00Z", url: "/b", documentId: "doc-2", reading: thamesWater },
    ],
  });
  const fixed = partyPeople({ companyId: "brand-bgp", kind: "individual", precheck: null, requests: [both] })
    .people.find(p => p.name === "Huseyn Mirhadiyev")!;
  assert.equal(fixed.address.done, true);
  assert.equal(fixed.address.proof?.documentId, "doc-2");
});

// Who sends a proof of address (Jack, 26 November 2026: "applied back to all
// checks ... The only time we need ID only by itself is Listed Businesses").
test("owners and the party in person owe a proof of address; an agent or representative never does", () => {
  assert.equal(owesProofOfAddress("individual", ["acting"]), true, "a private individual");
  assert.equal(owesProofOfAddress("individual", ["joint"]), true, "someone named alongside them");
  assert.equal(owesProofOfAddress("company", ["guarantor"]), true, "a person who guarantees");
  assert.equal(owesProofOfAddress("company", ["signer"]), true, "a person who signs too");
  assert.equal(owesProofOfAddress("company", ["owner"]), true);
  assert.equal(owesProofOfAddress("company", ["owner", "acting", "director"]), true);
  assert.equal(owesProofOfAddress("company", ["acting"]), false, "a representative of a company, listed or not");
  assert.equal(owesProofOfAddress("company", ["acting", "director"], true), false, "the person acting for a listed company");
  assert.equal(owesProofOfAddress("company", ["guarantor"], true), true, "a guarantor of a listed company");
  assert.equal(owesProofOfAddress("company", ["guarantor_owner"]), true, "the owner of a company that guarantees");
  assert.equal(owesProofOfAddress("company", ["signer_owner"]), true);
  assert.equal(owesProofOfAddress("company", ["trustee", "settlor"]), true, "a trust's people (Jack, 25 November 2026)");
  assert.equal(owesProofOfAddress("company", ["protector"]), true);
  assert.equal(owesProofOfAddress("individual", ["guarantor_owner"]), true, "a guarantor company's owner on a private individual's side");
});

// The online check on a UK photocard driving licence verifies the address
// too, when Veriff reads it (25 November 2026).
test("a passed identity check on a UK driving licence with its address covers the proof of address", () => {
  assert.equal(verifiedLicenceAddress({ type: "DRIVERS_LICENSE", country: "GB" }, { addresses: [{ fullAddress: "12 High Street, Guildford GU1 3AA" }] }), "12 High Street, Guildford GU1 3AA");
  assert.equal(verifiedLicenceAddress({ type: "PASSPORT", country: "GB" }, { addresses: [{ fullAddress: "12 High Street" }] }), null, "a passport");
  assert.equal(verifiedLicenceAddress({ type: "DRIVERS_LICENSE", country: "FR" }, { addresses: [{ fullAddress: "1 rue X" }] }), null, "a licence from abroad");
  assert.equal(verifiedLicenceAddress({ type: "DRIVERS_LICENSE", country: "GB" }, {}), null, "no address read");
  const sandy = (licenceAddress: string | null, state: "approved" | "submitted" = "approved") => partyPeople({
    companyId: "brand-sandy", kind: "individual", precheck: null,
    requests: [request({ companyId: "brand-sandy", recipientName: "Sandy Macaskill", docs: ["proof_of_address"],
      idChecks: [{ state, verifiedName: "SANDY MACASKILL", verifiedDob: "1970-04-02", licenceAddress }] })],
  }).people[0];
  const covered = sandy("12 High Street, Guildford GU1 3AA");
  assert.equal(covered.address.done, true);
  assert.equal(covered.address.fromLicence, "12 High Street, Guildford GU1 3AA");
  assert.deepEqual(covered.outstanding, []);
  assert.equal(sandy(null).address.done, false, "a passport, or no address read");
  assert.equal(sandy("12 High Street", "submitted").address.done, false, "only once Veriff passes it");
});

// Woody, 24 November 2026: "Let's allow others to drop proof of address" (who
// hands it over is not a legal point). A proof sent on someone else's link on
// the party counts for the person it names, read and checked the same way.
test("a proof of address sent on someone else's link counts for the person it names", () => {
  const huseynKey = personKey("Mr Huseyn Mirhadiyev");
  const peopleWith = (file: Partial<PeopleRequest["files"][number]>, over: Partial<PeopleRequest> = {}) => partyPeople({
    companyId: "brand-bgp", kind: "company", precheck: { companiesHouse: bgpLtd, sanctions: sanctions([]) },
    requests: [request({ finished: true, files: [{ name: "bill.pdf", docKey: "proof_of_address", uploadedAt: "2026-11-20T09:00:00Z", url: "/a", documentId: "doc-9", ...file }], ...over })],
  }).people;
  const who = (list: ReturnType<typeof peopleWith>, name: string) => list.find(p => p.name === name)!;

  // Jack, the person acting, uploads Huseyn's bill for him.
  const sent = who(peopleWith({ reading: thamesWater, forKey: huseynKey }), "Huseyn Mirhadiyev");
  assert.equal(sent.address.done, true);
  assert.equal(sent.address.proof?.elsewhere, "on Jack Barrat's link");
  assert.equal(sent.address.proof?.ref, "7MJEGT");
  assert.ok(!sent.outstanding.includes("proof of address"));
  // With no "for" at all, a bill that reads as his still counts for him.
  assert.equal(who(peopleWith({ reading: thamesWater }), "Huseyn Mirhadiyev").address.done, true);
  // It never counts for someone it does not name.
  assert.equal(who(peopleWith({ reading: thamesWater, forKey: huseynKey }), "Woody Bruce").address.done, false);
  // Sent for him but in another name: shown on his row with the reason, so an officer can accept it for him.
  const wrong = who(peopleWith({ reading: { ...thamesWater, names: ["MRS J SMITH"] }, forKey: huseynKey }), "Huseyn Mirhadiyev");
  assert.equal(wrong.address.done, false);
  assert.deepEqual(wrong.address.proof?.reasons, ["In the name of MRS J SMITH, not Huseyn Mirhadiyev"]);
  const accepted = who(peopleWith({ reading: { ...thamesWater, names: ["MRS J SMITH"] }, forKey: huseynKey,
    accepted: { by: "Jack Barratt", at: "2026-11-20T10:00:00Z", note: "Bill in his partner's name; the tenancy agreement shows him at the address" } }), "Huseyn Mirhadiyev");
  assert.equal(accepted.address.done, true);
  assert.equal(accepted.address.proof?.accepted?.by, "Jack Barratt");
  // An acceptance is for the person it was sent for, never for whoever else the bill names.
  const forWoody = peopleWith({ reading: thamesWater, forKey: personKey("Mr Woody Bruce"), accepted: { by: "Jack Barratt", at: "2026-11-20T10:00:00Z", note: "Accepted for Woody" } });
  assert.equal(who(forWoody, "Woody Bruce").address.done, true, "accepted for him");
  assert.equal(who(forWoody, "Huseyn Mirhadiyev").address.done, true, "it reads as Huseyn's, so it counts for him too");
  assert.equal(who(forWoody, "Huseyn Mirhadiyev").address.proof?.accepted, null);
  // Not read yet: not counted, and shown on his row as waiting.
  const unread = who(peopleWith({ reading: null, forKey: huseynKey }), "Huseyn Mirhadiyev");
  assert.equal(unread.address.done, false);
  assert.deepEqual(unread.address.proof?.reasons, ["Not read yet"]);
  // Another party's links never count.
  assert.equal(who(peopleWith({ reading: thamesWater, forKey: huseynKey }, { companyId: "brand-cap" }), "Huseyn Mirhadiyev").address.done, false);
});

test("owners behind a company registered abroad: the client is asked who they are", async () => {
  const { partyPeople, PARTY_PEOPLE_BASIS_WORDS } = await import("../shared/kyc-people");
  const precheck: any = {
    kind: "precheck", version: 1, ranAt: "2026-11-20T09:00:00Z", party: { companyId: "c1", name: "TUREDDI GROUP LIMITED", subjectKind: "company", contactName: null },
    companiesHouse: {
      number: "15210693", name: "TUREDDI GROUP LIMITED", listing: null, chain: [], peopleUpChain: [], statements: [], offshoreOwners: [],
      officers: [{ name: "ROSSI, Marco", role: "director", appointedOn: null, dob: { month: 1, year: 1980 }, nationality: "Italian" }],
      owners: [{ name: "Scp Aaa Invest", kind: "company", controls: ["ownership-of-shares-75-to-100-percent"], notifiedOn: null, country: "Monaco", registrationNumber: "25sc38568" }],
    },
    sanctions: { ran: true, lists: [], lines: [], error: null },
  };
  const people = partyPeople({ kind: "company", companyId: "c1", precheck, requests: [] } as any);
  assert.equal(people.basis, "owners_abroad");
  assert.deepEqual(people.ownersAbroad, [{ name: "Scp Aaa Invest", country: "Monaco", foundAt: null }]);
  // Since 21 November 2026 a company abroad goes to KYC4U (Woody: "foreign companies I think we will send to KYC4U").
  assert.match(PARTY_PEOPLE_BASIS_WORDS.owners_abroad, /BGP's officers find them\. The app traces what it can/);
  assert.doesNotMatch(PARTY_PEOPLE_BASIS_WORDS.owners_abroad, /KYC4U/);
  assert.ok(people.outstanding.some(o => /The people behind Scp Aaa Invest \(Monaco\)/.test(o)), "owed until the client sends the chart");

  // Someone recorded behind it (21 November 2026) is an owner to check, and
  // the company abroad is answered: what is owed is that person's own checks.
  const recorded = partyPeople({ kind: "company", companyId: "c1", precheck, requests: [],
    abroadPeople: [{ name: "Anna Rossi", ownerName: "SCP AAA INVEST", ownerCountry: "Monaco", detail: "100% of the shares", dob: { month: 3, year: 1975 } }] } as any);
  assert.equal(recorded.basis, "owners_abroad");
  const anna = recorded.people.find(p => p.name === "Anna Rossi")!;
  assert.deepEqual(anna.roles, ["owner"]);
  assert.equal(anna.ownerDetail, "behind SCP AAA INVEST (Monaco): 100% of the shares");
  assert.equal(anna.born, "March 1975");
  assert.ok(!recorded.outstanding.some(o => /The people behind/.test(o)));
  assert.ok(recorded.outstanding.some(o => /^Anna Rossi: identity check/.test(o)));

  // Recorded behind a parent GLEIF found above the owner abroad also answers it.
  const withTrace = { ...precheck, abroad: { accounts: null, checkedAt: "2026-11-21T00:00:00Z", traced: [{ name: "Scp Aaa Invest", country: "Monaco", registrationNumber: null, via: "register", foundAt: null,
    gleif: { status: "found", entity: null, parents: [{ lei: "X".repeat(20), name: "AAA Holdings SAM", jurisdiction: "MC", country: "MC", registeredAs: null, status: "ACTIVE", leiStatus: "ISSUED", lastUpdate: null }], top: null, candidates: 1, error: null } }] } };
  const viaParent = partyPeople({ kind: "company", companyId: "c1", precheck: withTrace, requests: [],
    abroadPeople: [{ name: "Anna Rossi", ownerName: "AAA Holdings SAM", ownerCountry: "Monaco", detail: "owns AAA Holdings SAM", dob: null }] } as any);
  assert.ok(!viaParent.outstanding.some(o => /The people behind/.test(o)));
  // A private individual's side takes no one recorded behind a company.
  const individual = partyPeople({ kind: "individual", companyId: "c1", precheck: null, requests: [], abroadPeople: [{ name: "Anna Rossi", ownerName: "X", ownerCountry: null, detail: "x", dob: null }] } as any);
  assert.equal(individual.people.length, 0);
});

test("a person verified from public sources owes nothing more (KYC4U's Public figure method, 21 November 2026)", () => {
  const base: PartyPeopleInput = { companyId: "brand-bgp", kind: "company", precheck: { companiesHouse: bgpLtd, sanctions: sanctions([]) as any }, requests: [request({})] };
  const before = partyPeople(base).people.find(p => p.name === "Huseyn Mirhadiyev")!;
  assert.deepEqual(before.outstanding, ["identity check", "proof of address"]);
  assert.equal(before.publicFigure, null);
  const after = partyPeople({ ...base, publicFigures: [{ id: "1", name: "Mr Huseyn Mirhadiyev", note: "Named with photograph in the group's annual report", by: "Jack Barratt", at: "2026-11-21T10:00:00Z", links: ["https://example.org/annual-report"], documents: 1 }] });
  const huseyn = after.people.find(p => p.name === "Huseyn Mirhadiyev")!;
  assert.equal(huseyn.publicFigure?.by, "Jack Barratt");
  assert.deepEqual(huseyn.outstanding, []);
  assert.equal(huseyn.canSend, false);
  assert.ok(!after.outstanding.some(o => o.startsWith("Huseyn Mirhadiyev")), "the party no longer owes anything for him");
  assert.ok(after.outstanding.some(o => o.startsWith("Woody Bruce")), "the others still do");
  assert.deepEqual(personRequestAsks(huseyn, true), { needsIdCheck: false, docs: [] });
});

// Woody, 25 November 2026: "if I send someone an email from the app that has
// had their identity already confirmed for something else it wont ask them to
// do it again?", then "proof of address should have an expiry flag so cant be
// used but should be if possible".
test("an identity check passed on another transaction counts when the date of birth agrees", () => {
  const prior = [{ sessionId: "s1", verifiedName: "HUSEYN MIRHADIYEV", verifiedDob: "1982-02-11", email: null, at: "2026-06-01T10:00:00Z", where: "another transaction, Bill's", ref: "ABC123" }];
  const out = partyPeople({ companyId: "brand-bgp", kind: "company", precheck: { companiesHouse: bgpLtd, sanctions: sanctions([]) }, requests: [], priorIdChecks: prior, today: new Date("2026-11-25") });
  const huseyn = out.people.find(p => p.name.includes("Mirhadiyev"))!;
  assert.equal(huseyn.id.state, "passed");
  assert.match(huseyn.id.elsewhere || "", /checked on another transaction, Bill's \(ABC123\), 1 Jun 2026/);
  assert.ok(!huseyn.outstanding.includes("identity check"));
  // A different month of birth is someone else.
  const other = partyPeople({ companyId: "brand-bgp", kind: "company", precheck: { companiesHouse: bgpLtd, sanctions: sanctions([]) }, requests: [],
    priorIdChecks: [{ ...prior[0], verifiedDob: "1982-07-11" }], today: new Date("2026-11-25") });
  assert.equal(other.people.find(p => p.name.includes("Mirhadiyev"))!.id.state, "not_started");
});

test("with no register date of birth an earlier check needs the same email; over three years it no longer counts", () => {
  const p = { name: "Jack Barratt", emails: ["jack@example.com"] };
  const check = { sessionId: "s1", verifiedName: "JACK BARRATT", verifiedDob: "1990-03-01", email: "Jack@Example.com", at: "2026-01-01T00:00:00Z", where: "x", ref: null };
  assert.ok(priorIdCheckFor(p, [check], new Date("2026-11-25")));
  assert.equal(priorIdCheckFor({ ...p, emails: ["other@example.com"] }, [check], new Date("2026-11-25")), null);
  assert.equal(priorIdCheckFor(p, [check], new Date("2029-02-01")), null);
  assert.equal(priorIdCheckFor({ name: "Jack Smith", emails: p.emails }, [check], new Date("2026-11-25")), null);
});

test("a proof of address from another transaction counts while in date, and is flagged once out of date", () => {
  const proof = {
    token: "t-old", ref: "OLD123", where: "another transaction, Bill's", email: "h@example.com", documentId: "9", fileName: "bill.pdf", url: "/f",
    uploadedAt: "2026-11-01T00:00:00Z", reading: thamesWater, forKey: null, idChecks: [],
  };
  const person = { name: "Huseyn Mirhadiyev", emails: ["h@example.com"] };
  const inDate = priorAddressProofFor(person, [proof], new Date("2026-11-25"));
  assert.ok(inDate && !inDate.expired);
  // Dated 30 October: in date for three months (92 days), to 30 January.
  const late = priorAddressProofFor(person, [proof], new Date("2027-02-15"));
  assert.equal(late?.expired, "2027-01-30");
  // Not tied to the person (another email, no identity check on that request): not used.
  assert.equal(priorAddressProofFor({ ...person, emails: ["x@example.com"] }, [proof], new Date("2026-11-25")), null);

  // A private individual owes a proof of address (HMRC, 25 November 2026), so one sent elsewhere counts.
  const req = request({ token: "t-h", ref: "NEW1", companyId: "brand-h", recipientName: "Huseyn Mirhadiyev", email: "h@example.com" });
  const now = partyPeople({ companyId: "brand-h", kind: "individual", precheck: null, requests: [req], priorAddressProofs: [proof], today: new Date("2026-11-25") });
  const h = now.people.find(p => p.name.includes("Mirhadiyev"))!;
  assert.equal(h.address.done, true);
  assert.equal(h.address.proof?.earlier, true);
  assert.ok(!h.outstanding.includes("proof of address"));
  const later = partyPeople({ companyId: "brand-h", kind: "individual", precheck: null, requests: [req], priorAddressProofs: [proof], today: new Date("2027-02-15") });
  const h2 = later.people.find(p => p.name.includes("Mirhadiyev"))!;
  assert.equal(h2.address.done, false);
  assert.equal(h2.address.proof?.expired, "2027-01-30");
  assert.match(h2.address.proof!.reasons[0], /Out of date since 30 Jan 2027: ask for a new one/);
  assert.ok(h2.outstanding.includes("proof of address"));
  // A company's owner owes one too (Jack, 26 November 2026): an out-of-date
  // proof from elsewhere is flagged against them.
  const ownerReq = request({ token: "t-o", ref: "NEW2", recipientName: "Huseyn Mirhadiyev", email: "h@example.com", person: { key: personKey("Huseyn Mirhadiyev"), name: "Huseyn Mirhadiyev", roles: ["owner"] } });
  const asOwner = partyPeople({ companyId: "brand-bgp", kind: "company", precheck: { companiesHouse: bgpLtd, sanctions: sanctions([]) }, requests: [ownerReq], priorAddressProofs: [proof], today: new Date("2027-02-15") });
  const o = asOwner.people.find(p => p.name.includes("Mirhadiyev"))!;
  assert.equal(o.address.notNeeded, undefined);
  assert.equal(o.address.proof?.expired, "2027-01-30");
  assert.ok(o.outstanding.includes("proof of address"));
});
