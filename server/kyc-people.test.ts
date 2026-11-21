// The people a company's checks are about (Woody, 19 November 2026: "a list
// of people to check for each party: the owners and the person acting, each
// with their own Veriff link and a proof-of-address upload; the directors
// shown with their sanctions result only"). The rules are shared/kyc-people.ts.
// The registers below are deal #4491's as BGP's checks before asking read them.
import test from "node:test";
import assert from "node:assert/strict";
import {
  bornWords, dobAgrees, partyPeople, personDisplayName, personKey, personRequestAsks, verifiedPersonDob,
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
  assert.deepEqual(huseyn.outstanding, ["identity check", "proof of address"]);
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
  assert.deepEqual(woody.outstanding, ["proof of address"]);
  assert.equal(jack.id.state, "not_started");
  assert.equal(jack.id.someoneElse, "Woody Bruce");
  assert.deepEqual(jack.outstanding, ["identity check", "proof of address"]);
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
  const ownWith = (file: Partial<PeopleRequest["files"][number]>) => request({
    token: "t-huseyn", ref: "H2K9QP", recipientName: "Huseyn Mirhadiyev", needsIdCheck: true, docs: ["proof_of_address"], finished: true,
    person: { key: personKey("Mr Huseyn Mirhadiyev"), name: "Huseyn Mirhadiyev", roles: ["owner"] },
    files: [{ name: "bill.pdf", docKey: "proof_of_address", uploadedAt: "2026-11-20T09:00:00Z", url: "/api/chat-media/c.pdf", documentId: "doc-1", ...file }],
  });
  const huseynWith = (file: Partial<PeopleRequest["files"][number]>) =>
    partyPeople({ companyId: "brand-bgp", kind: "company", precheck: { companiesHouse: bgpLtd, sanctions: sanctions([]) }, requests: [request({}), ownWith(file)] })
      .people.find(p => p.name === "Huseyn Mirhadiyev")!;

  // Not read yet, or not readable: it does not count, and they can be sent a link for a new one.
  const unread = huseynWith({ reading: null });
  assert.equal(unread.address.done, false);
  assert.deepEqual(unread.address.proof?.reasons, ["Not read yet"]);
  assert.ok(unread.outstanding.includes("proof of address"));
  assert.equal(unread.canSend, true);
  const blank = huseynWith({ reading: { ...thamesWater, read: false, unreadable: "the file is empty", kind: null, names: [], date: null } });
  assert.deepEqual(blank.address.proof?.reasons, ["Could not be read: the file is empty"]);

  // Another person's bill, an old one, a driving licence: each says why.
  assert.deepEqual(huseynWith({ reading: { ...thamesWater, names: ["MRS J SMITH"] } }).address.proof?.reasons, ["In the name of MRS J SMITH, not Huseyn Mirhadiyev"]);
  assert.deepEqual(huseynWith({ reading: { ...thamesWater, date: "2026-05-01" } }).address.proof?.reasons, ["Dated 1 May 2026, more than three months before it was sent"]);
  assert.deepEqual(huseynWith({ reading: { ...thamesWater, kind: "driving_licence", kindWords: "DVLA driving licence" } }).address.proof?.reasons,
    ["A driving licence proves identity, not address (BGP's AML policy)"]);

  // The Nominated Officer or a Deputy accepting it makes it count, with their note.
  const accepted = huseynWith({ reading: { ...thamesWater, date: "2026-05-01" }, accepted: { by: "Jack Barratt", at: "2026-11-20T10:00:00Z", note: "Annual statement, the latest one issued" } });
  assert.equal(accepted.address.done, true);
  assert.equal(accepted.address.proof?.accepted?.by, "Jack Barratt");
  assert.ok(!accepted.outstanding.includes("proof of address"));

  // A later good proof counts over an earlier bad one.
  const both = request({
    token: "t-huseyn", ref: "H2K9QP", recipientName: "Huseyn Mirhadiyev", docs: ["proof_of_address"], finished: true,
    person: { key: personKey("Mr Huseyn Mirhadiyev"), name: "Huseyn Mirhadiyev", roles: ["owner"] },
    files: [
      { name: "old.pdf", docKey: "proof_of_address", uploadedAt: "2026-11-20T09:00:00Z", url: "/a", documentId: "doc-1", reading: { ...thamesWater, date: "2026-01-01" } },
      { name: "new.pdf", docKey: "proof_of_address", uploadedAt: "2026-11-20T09:10:00Z", url: "/b", documentId: "doc-2", reading: thamesWater },
    ],
  });
  const fixed = partyPeople({ companyId: "brand-bgp", kind: "company", precheck: { companiesHouse: bgpLtd, sanctions: sanctions([]) }, requests: [request({}), both] })
    .people.find(p => p.name === "Huseyn Mirhadiyev")!;
  assert.equal(fixed.address.done, true);
  assert.equal(fixed.address.proof?.documentId, "doc-2");
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
  assert.match(PARTY_PEOPLE_BASIS_WORDS.owners_abroad, /It goes to KYC4U to find them\. The app traces what it can/);
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
  assert.ok(recorded.outstanding.includes("Anna Rossi: identity check and proof of address"));

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
