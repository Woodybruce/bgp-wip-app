// The sign-off note for a listed company, written from the file (Woody, 24
// November 2026: "Yes do the sign off note"). Rules: shared/sign-off-note.ts.
import test from "node:test";
import assert from "node:assert/strict";
import { listedSignOffNote, type SignOffNoteInput } from "../shared/sign-off-note";

type Pre = NonNullable<SignOffNoteInput["precheck"]>;
type Ch = NonNullable<Pre["companiesHouse"]>;

const register = (over: Partial<Ch> = {}): Ch => ({
  number: "01471587", name: "VODAFONE LIMITED", status: "active", type: "ltd", incorporatedOn: null, registeredOffice: null,
  jurisdiction: null, sicCodes: [], accountsOverdue: false, confirmationOverdue: false, lastAccountsMadeUpTo: "2026-03-31", lastAccountsType: "full",
  hasInsolvencyHistory: false, insolvencyCases: 0,
  officers: [{ name: "SMITH, Jane Anne", role: "director", appointedOn: null, dob: { month: 4, year: 1972 }, nationality: "British" } as any],
  owners: [], statements: [],
  listing: { market: "uk_regulated", since: "2017-07-07", company: "VODAFONE GROUP PUBLIC LIMITED COMPANY", companyNumber: "01833679", viaParent: true },
  chain: [{ name: "VODAFONE EUROPE UK LIMITED", number: "04227345", individuals: 0, companies: 1 }],
  peopleUpChain: [], offshoreOwners: [], disqualified: [], covenant: null, documents: [], ...over,
});

const precheck = (over: Partial<Pre> = {}, ch: Partial<Ch> = {}): Pre => ({
  ranAt: "2026-11-24T10:00:00Z",
  companiesHouse: register(ch),
  sanctions: { ran: true, lists: ["the UK Sanctions List", "the US OFAC list", "the EU consolidated list"], error: null,
    lines: [{ name: "VODAFONE LIMITED", role: "the company", outcome: "clear", matches: [] }, { name: "Jane Smith", role: "director", outcome: "clear", matches: [] }] },
  web: { ran: true, lines: [], skipped: null },
  complyAdvantage: { ran: true, lines: [{ name: "VODAFONE LIMITED", status: "clear", types: [], detail: null }], skipped: null },
  ...over,
});

const base = (over: Partial<SignOffNoteInput> = {}): SignOffNoteInput => ({
  precheck: precheck(), redFlags: 0, sanctionsOnly: false, company: true,
  acting: { name: "Jane Smith", sentAt: "2026-11-20T09:00:00Z", finished: true, idState: "passed", authoritySent: false },
  outstanding: [],
  ...over,
});

test("a company owned through a listed company: what the file holds, in one note", () => {
  const note = listedSignOffNote(base())!;
  assert.match(note, /^VODAFONE LIMITED \(01471587\) is owned through one company at each level by VODAFONE GROUP PUBLIC LIMITED COMPANY \(01833679\), which is listed on a UK regulated market \(Companies House PSC exemption since 7 July 2017\)\. Standard due diligence: no individual owners to verify\./);
  assert.match(note, /Ownership read at Companies House: VODAFONE LIMITED > VODAFONE EUROPE UK LIMITED > VODAFONE GROUP PUBLIC LIMITED COMPANY\./);
  assert.match(note, /Status at Companies House: active\./);
  assert.match(note, /Latest accounts made up to 31 March 2026\./);
  assert.match(note, /BGP's checks on 24 November 2026 found no red flags: the UK Sanctions List, the US OFAC list and the EU consolidated list \(2 names\), a web search \(adverse media and public roles\) and ComplyAdvantage\./);
  // A director at Companies House needs no other proof of authority.
  assert.match(note, /Instructed by Jane Smith: identity check passed; a director at Companies House\./);
  assert.doesNotMatch(note, /Not screened|Still to come|not finished/);
  assert.ok(note.length < 1000, `${note.length} characters`);
});

test("the listed company itself: simplified, and the chain is not repeated", () => {
  const note = listedSignOffNote(base({ precheck: precheck({}, {
    number: "01833679", name: "VODAFONE GROUP PUBLIC LIMITED COMPANY", chain: [],
    listing: { market: "uk_regulated", since: null, company: "VODAFONE GROUP PUBLIC LIMITED COMPANY", companyNumber: "01833679", viaParent: false },
  }) }))!;
  assert.match(note, /^VODAFONE GROUP PUBLIC LIMITED COMPANY \(01833679\) is listed on a UK regulated market\. Simplified due diligence: no beneficial owners to identify\./);
  assert.doesNotMatch(note, /Ownership read/);
  // The listed parent at the top of the chain is named once.
  const via = listedSignOffNote(base({ precheck: precheck({}, {
    chain: [{ name: "VODAFONE EUROPE UK LIMITED", number: "04227345", individuals: 0, companies: 1 },
      { name: "VODAFONE GROUP PUBLIC LIMITED COMPANY", number: "01833679", individuals: 0, companies: 0 }],
  }) }))!;
  assert.equal((via.match(/VODAFONE GROUP PUBLIC LIMITED COMPANY/g) || []).length, 2, "the listing line and the chain's top, once each");
});

test("the person instructing us: their identity check and authority as the file shows them", () => {
  const notDirector = listedSignOffNote(base({ acting: { name: "Tom Brown", sentAt: null, finished: true, idState: "passed", authoritySent: true } }))!;
  assert.match(notDirector, /Instructed by Tom Brown: identity check passed; authority to act sent with the client checks\./);
  const noAuthority = listedSignOffNote(base({ acting: { name: "Tom Brown", sentAt: null, finished: true, idState: "waiting", authoritySent: false } }))!;
  assert.match(noAuthority, /Instructed by Tom Brown: identity check done, result awaited; authority to act not sent yet\./);
  // Nobody asked yet: said plainly.
  assert.match(listedSignOffNote(base({ acting: null }))!, /The client checks have not been sent to anyone instructing us for it yet\./);
  // Sent, not finished, and what is still owed.
  const open = listedSignOffNote(base({ acting: { name: "Tom Brown", sentAt: "2026-11-20T09:00:00Z", finished: false, idState: "not_started", authoritySent: false } }))!;
  assert.match(open, /identity check not done yet; authority to act not sent yet\. The client checks sent on 20 November 2026 are not finished\./);
  assert.match(listedSignOffNote(base({ outstanding: ["Tom Brown: identity check"] }))!, /Still to come: Tom Brown: identity check\./);
});

test("a screen that did not run is said, never read as clear", () => {
  const caFailed = listedSignOffNote(base({ precheck: precheck({ complyAdvantage: { ran: true, skipped: null,
    lines: [{ name: "Jane Smith", status: "error", types: [], detail: "refused" }] } }) }))!;
  assert.match(caFailed, /Not screened: ComplyAdvantage for 1 name\./);
  assert.doesNotMatch(caFailed, /found no red flags:[^.]*ComplyAdvantage/);
  const caOff = listedSignOffNote(base({ precheck: precheck({ complyAdvantage: { ran: false, lines: [], skipped: "ComplyAdvantage refused the sign-in" } }) }))!;
  assert.match(caOff, /Not screened: ComplyAdvantage\./);
  // Not set up is not a failure.
  const caNone = listedSignOffNote(base({ precheck: precheck({ complyAdvantage: { ran: false, lines: [], skipped: "no ComplyAdvantage keys are set" } }) }))!;
  assert.doesNotMatch(caNone, /ComplyAdvantage/);
  const noLists = listedSignOffNote(base({ precheck: precheck({ sanctions: { ran: false, lists: [], lines: [], error: "the sanctions lists could not be downloaded" } }) }))!;
  assert.match(noLists, /Not screened: the sanctions lists\./);
});

test("no note where a person writes their own", () => {
  assert.equal(listedSignOffNote(base({ redFlags: 1 })), null, "a red flag: enhanced, the officers' note");
  assert.equal(listedSignOffNote(base({ sanctionsOnly: true })), null, "a small letting needs no note");
  assert.equal(listedSignOffNote(base({ company: false })), null, "a person, trust or public body");
  assert.equal(listedSignOffNote(base({ precheck: null })), null, "BGP's checks have not run");
  assert.equal(listedSignOffNote(base({ precheck: precheck({}, { listing: null }) })), null, "not listed");
  for (const market of ["other_regulated", "listed_market", "roe_disclosure"] as const) {
    const pre = precheck({}, { listing: { market, since: null, company: "ACME SA", companyNumber: "X1", viaParent: true } });
    assert.equal(listedSignOffNote(base({ precheck: pre })), null, `${market}: the officers weigh a market abroad`);
  }
  for (const market of ["uk_regulated", "dtr5", "eu_regulated"] as const) {
    const pre = precheck({}, { listing: { market, since: null, company: "ACME PLC", companyNumber: "X1", viaParent: true } });
    assert.ok(listedSignOffNote(base({ precheck: pre })), market);
  }
});
