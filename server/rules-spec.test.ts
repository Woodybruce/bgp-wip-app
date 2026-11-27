// The rules specification build (Jack, 27 November 2026): limited
// partnerships, the register excerpt, the principal place of business.
import "./test-database-url";
import test from "node:test";
import assert from "node:assert/strict";
import { isLimitedPartnership, precheckCompany } from "../shared/kyc-prechecks";
import { PARTY_PEOPLE_BASIS_WORDS } from "../shared/kyc-people";
import { placeOfBusinessWords, KYC_PLACE_QUESTION } from "../shared/kyc-request";
import { registerExcerptLines } from "./kyc-register-excerpt";

const ch = (over: any = {}): any => ({
  number: "LP012345", name: "PROPCO LP", status: "active", type: "limited-partnership", incorporatedOn: "2019-03-01",
  registeredOffice: "1 High Street, London", jurisdiction: "england-wales", sicCodes: [], accountsOverdue: false, confirmationOverdue: false,
  lastAccountsMadeUpTo: null, lastAccountsType: null, hasInsolvencyHistory: false, insolvencyCases: 0,
  officers: [], owners: [], statements: [], listing: null, chain: [], peopleUpChain: [], offshoreOwners: [], ownersAbroad: [], disqualified: [], covenant: null, documents: [],
  ...over,
});

test("a limited partnership is recognised, and a company is not", () => {
  assert.equal(isLimitedPartnership({ type: "limited-partnership" }), true);
  assert.equal(isLimitedPartnership({ type: "scottish-partnership" }), true);
  assert.equal(isLimitedPartnership({ type: "ltd" }), false);
  assert.equal(isLimitedPartnership({ type: "llp" }), false);
  assert.equal(isLimitedPartnership(null), false);
  assert.equal(precheckCompany({ companiesHouse: ch() } as any)?.partnership, true);
  assert.equal(precheckCompany({ companiesHouse: ch({ type: "ltd" }) } as any)?.partnership, undefined);
  assert.match(PARTY_PEOPLE_BASIS_WORDS.partnership, /more than 25%/);
  assert.match(PARTY_PEOPLE_BASIS_WORDS.partnership, /general partner/);
});

test("the register excerpt names the owners, the officers and the day it was read", () => {
  const lines = registerExcerptLines(ch({
    number: "01234567", name: "ACME ESTATES LIMITED", type: "ltd",
    owners: [{ name: "Jane Testperson", kind: "individual", controls: ["ownership-of-shares-75-to-100-percent"], notifiedOn: "2020-01-02", nationality: "British", dob: { month: 5, year: 1970 } }],
    officers: [{ name: "TESTPERSON, Jane", role: "director", appointedOn: "2019-03-01", dob: { month: 5, year: 1970 }, nationality: "British" }],
  }), new Date("2026-11-27T10:00:00Z")).map(l => l.head || l.text).join("\n");
  assert.match(lines, /ACME ESTATES LIMITED \(01234567\)/);
  assert.match(lines, /People with significant control/);
  assert.match(lines, /Jane Testperson · an individual · British · born May 1970 · notified 2020-01-02/);
  assert.match(lines, /TESTPERSON, Jane · director/);
  assert.match(lines, /Read from Companies House by ChatBGP on 27 November 2026/);
  // An overseas entity's are its registered beneficial owners; none is said, never left blank.
  const oe = registerExcerptLines(ch({ number: "OE002654", type: "registered-overseas-entity" }), new Date()).map(l => l.head || l.text).join("\n");
  assert.match(oe, /Registered beneficial owners \(Register of Overseas Entities\)\nNone on the register\./);
});

test("the principal place of business in words", () => {
  assert.equal(placeOfBusinessWords(null), null);
  assert.equal(placeOfBusinessWords({ same: null, address: null, answeredAt: null }), null);
  assert.equal(placeOfBusinessWords({ same: true, address: null, answeredAt: "x" }), "the registered office");
  assert.equal(placeOfBusinessWords({ same: false, address: "2 Mill Lane, Leeds", answeredAt: "x" }), "2 Mill Lane, Leeds");
  assert.match(KYC_PLACE_QUESTION.intro, /registered office/);
});
