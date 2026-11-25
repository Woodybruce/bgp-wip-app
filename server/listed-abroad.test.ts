// A company abroad owned through a US-listed group (Woody, 25 November 2026,
// on Google LLC): GLEIF's chain against the SEC's list.
import test from "node:test";
import assert from "node:assert/strict";
import { listedAbroadFrom, abroadStatus } from "@shared/foreign-owners";
import { askInputFrom, overseasNameKey, precheckAsks, precheckListing } from "@shared/kyc-prechecks";
import { registerExtractDenial } from "@shared/party-kyc";
import { secListFrom } from "./sec-listed";

const SEC = { fields: ["cik", "name", "ticker", "exchange"], data: [[1652044, "Alphabet Inc.", "GOOGL", "Nasdaq"], [1652044, "Alphabet Inc.", "GOOG", "Nasdaq"], [1, "Pink Sheet Co", "PINK", "OTC"]] };

test("the SEC's list keeps Nasdaq, NYSE and Cboe companies only, read by name", () => {
  const byKey = secListFrom(SEC);
  assert.equal(byKey.size, 1);
  const lookup = (n: string) => [...byKey.values()].find(h => h.name.toLowerCase().replace(/[^a-z]/g, "") === n.toLowerCase().replace(/[^a-z]/g, "")) || null;
  assert.equal(lookup("Alphabet Inc")?.ticker, "GOOGL");
});

test("Google LLC is owned through a listed company: Alphabet Inc. at the top of its GLEIF chain", () => {
  const byKey = secListFrom(SEC);
  const lookup = (n: string) => byKey.get(overseasNameKey(n)) || null;
  const listing = listedAbroadFrom([{ self: true, names: ["GOOGLE LLC", "XXVI HOLDINGS INC.", "ALPHABET INC."] }], lookup);
  assert.equal(listing?.company, "Alphabet Inc.");
  assert.equal(listing?.viaParent, true);
  assert.equal(listing?.market, "us_exchange");
  // Listed itself.
  assert.equal(listedAbroadFrom([{ self: true, names: ["ALPHABET INC."] }], lookup)?.viaParent, false);
  assert.equal(listedAbroadFrom([{ self: true, names: ["SOME GMBH"] }], lookup), null);
});

test("owned through a listed group: no owners asked for, and nobody still to find behind it", () => {
  const listing = { market: "us_exchange" as const, since: null, company: "Alphabet Inc.", companyNumber: "SEC CIK 1652044, Nasdaq: GOOGL", viaParent: true };
  const result: any = { party: { subjectKind: "company" }, companiesHouse: null, abroad: { accounts: null, traced: [{ name: "GOOGLE LLC", country: "US-DE", registrationNumber: null, via: "party", foundAt: null, gleif: { status: "found", entity: null, parents: [], top: null, candidates: 1, error: null } }], checkedAt: "", party: true, listing } };
  assert.equal(precheckListing(result)?.company, "Alphabet Inc.");
  const asks = precheckAsks(askInputFrom(result), { kind: "company", role: "landlord", idCheck: true, contactName: null });
  assert.ok(!asks.docs.includes("ownership"));
  assert.ok(!asks.docs.includes("owner_ids"));
  assert.ok(asks.docs.includes("company_documents"), "its own register's extract is still asked for");
  const [status] = abroadStatus({ owners: [{ name: "GOOGLE LLC", country: "US-DE", via: "party" }], abroad: result.abroad, records: [], chartReceived: false });
  assert.equal(status.needs, null);
});

test("the register extract hold says where to get it", () => {
  const words = registerExtractDenial({ needed: true, held: false, company: "GOOGLE LLC", reasons: [], home: { country: "US", register: null, registrationNumber: null },
    search: { register: "Division of Corporations, Department of State (Delaware, United States of America)", number: "3582691", website: "https://corp.delaware.gov/" }, listedVia: "Alphabet Inc." })!;
  assert.match(words, /as number 3582691/);
  assert.match(words, /corp\.delaware\.gov/);
  assert.match(words, /Owned through Alphabet Inc\., a listed company/);
});
