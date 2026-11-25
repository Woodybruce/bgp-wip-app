// Which companies a KYC4U request is about, by name (Woody, 25 November 2026,
// Sheet Anchor). Rules: shared/kyc4u-names.ts.
import test from "node:test";
import assert from "node:assert/strict";
import { kyc4uCompanyKeys, kyc4uRequestKeys, kyc4uRequestNames, kyc4uSectionNames } from "../shared/kyc4u-names";

const SHEET_ANCHOR_SECTIONS = "SHEET ANCHOR PROPERTIES LIMITED 2 · SHEET ANCHOR EVOLVE (LONDON) LIMITED 2 · Emails 4 · Instructing Party 1 · CASPAR_MACDONALD-HALL - UBO 2";

test("a folder's section names, counts aside", () => {
  assert.deepEqual(kyc4uSectionNames(SHEET_ANCHOR_SECTIONS), [
    "SHEET ANCHOR PROPERTIES LIMITED", "SHEET ANCHOR EVOLVE (LONDON) LIMITED", "Emails", "Instructing Party", "CASPAR_MACDONALD-HALL - UBO",
  ]);
  assert.deepEqual(kyc4uSectionNames(null), []);
});

test("REQ103894 names Sheet Anchor Evolve and its parent, wherever it was filed", () => {
  const keys = kyc4uRequestKeys("SHEET ANCHOR EVOLVE LONDON LIMITED", SHEET_ANCHOR_SECTIONS);
  // The Evolve record: its registered name and the company filed under it.
  assert.ok(kyc4uRequestNames(keys, kyc4uCompanyKeys(["SHEET ANCHOR EVOLVE (LONDON) LIMITED"])));
  // The parent's record: its company is a folder of its own inside the request.
  assert.ok(kyc4uRequestNames(keys, kyc4uCompanyKeys(["SHEET ANCHOR PROPERTIES LIMITED"])));
  // Headings and people are never companies.
  assert.ok(!keys.some(k => /emails|instructing|caspar/.test(k)), keys.join(", "));
});

test("every word counts: a shortened or another company's name is not the same", () => {
  const keys = kyc4uRequestKeys("SHEET ANCHOR EVOLVE LONDON LIMITED", null);
  assert.ok(!kyc4uRequestNames(keys, kyc4uCompanyKeys(["Sheet Anchor"])), "the brand's short name");
  assert.ok(!kyc4uRequestNames(keys, kyc4uCompanyKeys(["SHEET ANCHOR EVOLVE (HOLDINGS) LIMITED"])), "a bracketed word makes another company");
  // The legal form and punctuation aside.
  assert.ok(kyc4uRequestNames(kyc4uRequestKeys("Bill's Restaurants Ltd", null), kyc4uCompanyKeys(["BILL'S RESTAURANTS LIMITED"])));
  // A request entity with KYC4U's _Brand_ aside reads as the company.
  assert.ok(kyc4uRequestNames(kyc4uRequestKeys("SPORTSWIFT LTD _Card Factory_", null), kyc4uCompanyKeys(["SPORTSWIFT LIMITED"])));
  assert.ok(!kyc4uRequestNames(kyc4uRequestKeys("SPORTSWIFT LTD _Card Factory_", null), kyc4uCompanyKeys(["CARD FACTORY PLC"])), "the brand in the aside is not the company");
});

test("a heading folder never matches a company of the same word", () => {
  const keys = kyc4uRequestKeys("ACME TRADING LIMITED", "HOTs 1 · KYC Entity 3 · Holding Cos 2");
  assert.ok(!kyc4uRequestNames(keys, kyc4uCompanyKeys(["HOTS LIMITED"])));
  assert.ok(!kyc4uRequestNames(keys, kyc4uCompanyKeys(["KYC ENTITY LIMITED"])));
  assert.equal(kyc4uRequestNames([], kyc4uCompanyKeys(["ACME TRADING LIMITED"])), false);
  assert.equal(kyc4uRequestNames(keys, []), false);
});
