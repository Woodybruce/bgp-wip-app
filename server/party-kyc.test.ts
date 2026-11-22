// Step 2 of docs/deal-page-review-2026-11-18.md (Woody, 18 November 2026:
// "Ok go ahead with your suggestions I will do the requests"): approval on
// the company that signs, BGP's sign-off, KYC4U's result added by hand, and
// KYC4U requests and documents filed on the company that signs. The rules are
// shared/party-kyc.ts; the gate is server/deal-gates.ts; the KYC4U pieces are
// server/kyc4u.ts.
import "./test-database-url";
import test from "node:test";
import assert from "node:assert/strict";
import {
  approverWords, isKyc4uResultKey, kyc4uResultDate, kycVerdict, partyKycState, sameLegalCompany, signOffDenial,
  type PartyKycInput, type SignOffFacts,
} from "../shared/party-kyc";
import { loadPartyKyc } from "./deal-gates";
import { kyc4uDocType, kyc4uFileStem, pickTradingEntity, reqFolderParts } from "./kyc4u";

const brand = (over: Partial<PartyKycInput["brand"]> = {}): PartyKycInput["brand"] => ({
  id: "b1", name: "The Test Bakery", companiesHouseNumber: null, legalName: null,
  status: "approved", expiresAt: "2099-01-01T00:00:00Z", approvedBy: "KYC4U (MLRO)", ...over,
});
const company = (over: Partial<NonNullable<PartyKycInput["company"]>> = {}): NonNullable<PartyKycInput["company"]> => ({
  id: "e1", name: "The Test Bakery Operations Limited", companiesHouseNumber: "12345678", kyc: null, ...over,
});

test("KYC4U's approvals read as KYC4U's, never the MLRO's (BGP's AML policy, Issue 2)", () => {
  assert.equal(approverWords("KYC4U (MLRO)"), "KYC4U");
  assert.equal(approverWords("Jack Barratt"), "Jack Barratt");
  assert.equal(approverWords(null), null);
  // A brand approved before 21 November 2026 still holds the old name.
  assert.equal(partyKycState({ brand: brand(), company: null }).approvedBy, "KYC4U");
  const viaCompany = partyKycState({ brand: brand(), company: company({ kyc: { status: "approved", expiresAt: null, approvedBy: "KYC4U (MLRO)" } }) });
  assert.equal(viaCompany.approvedBy, "KYC4U");
});

test("a party is judged on the company that signs when the deal names one", () => {
  // No company: the brand, as before.
  assert.deepEqual(partyKycState({ brand: brand(), company: null }).source, "brand");
  // A company with its own check: that check, approved or not.
  const own = partyKycState({ brand: brand(), company: company({ kyc: { status: "in_review", expiresAt: null, approvedBy: null } }) });
  assert.equal(own.source, "company");
  assert.equal(own.status, "in_review");
  assert.equal(own.name, "The Test Bakery Operations Limited");
  assert.equal(own.brandName, "The Test Bakery");
  // No check of its own and a different legal company: no checks run, though the brand is approved.
  const other = partyKycState({ brand: brand(), company: company() });
  assert.equal(other.source, "company");
  assert.equal(other.status, null);
  assert.equal(other.brandStatus, "approved");
  // The brand's own legal company (same number, or the brand's legal name): the brand's check.
  assert.equal(partyKycState({ brand: brand({ companiesHouseNumber: "12345678" }), company: company() }).source, "same_company");
  assert.equal(partyKycState({ brand: brand({ companiesHouseNumber: "1234567" }), company: company({ companiesHouseNumber: "01234567" }) }).source, "same_company");
  assert.equal(partyKycState({ brand: brand({ legalName: "The Test Bakery Operations Ltd" }), company: company({ companiesHouseNumber: null }) }).source, "same_company");
  // Two numbers that differ are two companies, whatever the names.
  assert.ok(!sameLegalCompany(brand({ companiesHouseNumber: "87654321", legalName: "The Test Bakery Operations Limited" }), company()));
  // A rejected brand blocks whatever company is named, even one approved itself.
  const rejected = partyKycState({ brand: brand({ status: "rejected" }), company: company({ kyc: { status: "approved", expiresAt: "2099-01-01", approvedBy: "x" } }) });
  assert.equal(rejected.source, "brand_rejected");
  assert.equal(rejected.status, "rejected");
});

test("approved means approved and in date", () => {
  const now = new Date("2026-11-18T12:00:00Z");
  assert.deepEqual(kycVerdict({ status: "approved", expiresAt: "2027-01-01", approvedBy: "x" }, now), { approved: true, reason: null });
  assert.deepEqual(kycVerdict({ status: "approved", expiresAt: "2026-01-01", approvedBy: "x" }, now), { approved: false, reason: "expired" });
  assert.deepEqual(kycVerdict({ status: null, expiresAt: null, approvedBy: null }, now), { approved: false, reason: "no checks run" });
  assert.deepEqual(kycVerdict({ status: "rejected", expiresAt: null, approvedBy: "x" }, now), { approved: false, reason: "rejected" });
});

const facts = (over: Partial<SignOffFacts> = {}): SignOffFacts => ({
  rejected: false, current: null, withKyc4u: false, redFlags: 0, dealRedFlags: 0, unchecked: [], higherRisk: false,
  precheck: { ranAt: "2026-11-17T10:00:00Z" }, precheckRunning: false, clientChecksFinished: true, note: "",
  now: new Date("2026-11-18T12:00:00Z"), ...over,
});

test("BGP signs off a routine party only; anything else goes to KYC4U or waits", () => {
  assert.equal(signOffDenial(facts()), null);
  assert.match(signOffDenial(facts({ rejected: true }))!, /rejected by the Nominated Officer or KYC4U/);
  assert.match(signOffDenial(facts({ current: { by: "KYC4U", until: "2027-05-19T00:00:00Z" } }))!, /Already approved by KYC4U until 19 May 2027/);
  assert.match(signOffDenial(facts({ unchecked: ["the sanctions screening"] }))!, /could not be checked against the sanctions screening/);
  assert.match(signOffDenial(facts({ withKyc4u: true }))!, /raised with KYC4U on this transaction/);
  assert.match(signOffDenial(facts({ redFlags: 1 }))!, /needs enhanced due diligence \(a red flag or a higher-risk factor in the AML policy\): raise it with KYC4U/);
  assert.match(signOffDenial(facts({ dealRedFlags: 2 }))!, /a red flag or a higher-risk factor on the transaction record/);
  assert.match(signOffDenial(facts({ higherRisk: true }))!, /higher-risk file/);
  assert.match(signOffDenial(facts({ precheckRunning: true }))!, /still running/);
  assert.match(signOffDenial(facts({ precheck: null }))!, /have not run/);
  assert.match(signOffDenial(facts({ precheck: { ranAt: "2026-10-01T10:00:00Z" } }))!, /more than 30 days old/);
  // Client checks unfinished: a sentence of what was relied on instead.
  assert.match(signOffDenial(facts({ clientChecksFinished: false, note: "ok" }))!, /say what you relied on/);
  assert.equal(signOffDenial(facts({ clientChecksFinished: false, note: "Listed plc, owners confirmed on the register" })), null);
  // A rejection is named before anything else, and a red flag before the paperwork.
  assert.match(signOffDenial(facts({ rejected: true, redFlags: 3, precheck: null }))!, /rejected/);
  assert.match(signOffDenial(facts({ redFlags: 1, precheck: null }))!, /red flag/);
});

test("KYC4U's result: a known verdict and a real date, not in the future", () => {
  assert.ok(isKyc4uResultKey("approved") && isKyc4uResultKey("rejected") && isKyc4uResultKey("more_info"));
  for (const bad of ["Approved", "toString", "__proto__", "constructor", "", null, 1]) assert.ok(!isKyc4uResultKey(bad), String(bad));
  const now = new Date("2026-11-18T09:00:00Z");
  assert.equal(kyc4uResultDate("2026-11-18", now)?.toISOString(), "2026-11-18T12:00:00.000Z");
  assert.equal(kyc4uResultDate("2026-11-10", now)?.toISOString().slice(0, 10), "2026-11-10");
  assert.equal(kyc4uResultDate("2026-11-21", now), null);
  assert.equal(kyc4uResultDate("2026-02-30", now), null);
  assert.equal(kyc4uResultDate("2014-12-31", now), null);
  assert.equal(kyc4uResultDate("18/11/2026", now), null);
  assert.equal(kyc4uResultDate(undefined, now), null);
});

test("the gate reads a company's own check only when it is filed under the party's brand", async () => {
  const calls: string[] = [];
  const db = {
    query: async (sql: string) => {
      calls.push(sql);
      if (sql.includes("FROM crm_companies")) return { rows: [{ id: "b1", name: "The Test Bakery", kyc_status: "approved", kyc_expires_at: "2099-01-01", kyc_approved_by: "KYC4U (MLRO)" }] };
      if (sql.includes("FROM crm_trading_entities")) return { rows: [
        { id: "e1", parent_company_id: "b1", name: "The Test Bakery Operations Limited", companies_house_number: "12345678" },
        { id: "e9", parent_company_id: "someone-else", name: "Elsewhere Ltd", companies_house_number: "99999999" },
      ] };
      if (sql.includes("FROM crm_entity_kyc")) return { rows: [{ entity_id: "e9", kyc_status: "approved", expires_at: "2099-01-01", approved_by: "x", approved_at: null }] };
      return { rows: [] };
    },
  };
  const states = await loadPartyKyc(db, [{ role: "tenant", brandId: "b1", entityId: "e1" }, { role: "landlord", brandId: "b1", entityId: "e9" }]);
  // e1 is under the brand and has no check of its own: no checks run.
  assert.equal(states.tenant.source, "company");
  assert.equal(states.tenant.status, null);
  // e9 is under another brand: not counted, so the party reads as the brand.
  assert.equal(states.landlord.source, "brand");
  assert.equal(states.landlord.status, "approved");
  // A failed read of the companies' own checks reads as no checks run, never approved.
  const failing = { query: async (sql: string) => sql.includes("FROM crm_entity_kyc") ? Promise.reject(new Error("down")) : db.query(sql) };
  const s2 = await loadPartyKyc(failing, [{ role: "tenant", brandId: "b1", entityId: "e1" }]);
  assert.equal(s2.tenant.status, null);
});

test("a KYC4U request is filed on the company that signs only on a single fit under its brand", () => {
  const key = (n: string) => n.toLowerCase().replace(/\b(limited|ltd)\b/g, "ltd").replace(/[^a-z0-9]+/g, " ").trim();
  const entities = [
    { id: "e1", parentId: "b1", name: "The Test Bakery Operations Limited", companiesHouseNumber: "12345678" },
    { id: "e2", parentId: "b1", name: "The Test Bakery Holdings Limited", companiesHouseNumber: "87654321" },
    { id: "e3", parentId: "b2", name: "The Test Bakery Operations Limited", companiesHouseNumber: "55555555" },
  ];
  assert.equal(pickTradingEntity(entities, "b1", "The Test Bakery Operations Ltd", key), "e1");
  assert.equal(pickTradingEntity(entities, "b2", "The Test Bakery Operations Ltd", key), "e3");
  assert.equal(pickTradingEntity(entities, "b1", "Holdings Co company number 87654321", key), "e2");
  // The brand's own name is the brand, not one of its companies.
  assert.equal(pickTradingEntity(entities, "b1", "The Test Bakery", key), null);
  assert.equal(pickTradingEntity(entities, null, "The Test Bakery Operations Ltd", key), null);
  assert.equal(pickTradingEntity(entities, "b9", "The Test Bakery Operations Ltd", key), null);
  // Two companies of that name under the brand: neither.
  assert.equal(pickTradingEntity([...entities, { id: "e4", parentId: "b1", name: "The Test Bakery Operations Ltd", companiesHouseNumber: null }], "b1", "The Test Bakery Operations Limited", key), null);
});

test("KYC4U's request folders and documents", () => {
  assert.deepEqual(reqFolderParts("REQ113355  Iris Ave Ltd"), { ref: "REQ113355", entity: "Iris Ave Ltd" });
  assert.deepEqual(reqFolderParts("req200001_Nobody"), { ref: "REQ200001", entity: "Nobody" });
  assert.equal(reqFolderParts("2.0 KYC Entity"), null);
  const classify = (n: string) => /passport/i.test(n) ? "passport" : "other";
  assert.equal(kyc4uDocType("UBOs", "J Smith passport.jpg", classify), "passport");
  assert.equal(kyc4uDocType("UBOs", "Ownership chart.pdf", classify), "ubo_declaration");
  assert.equal(kyc4uDocType("KYC Entity", "Register extract.pdf", classify), "company_cert");
  assert.equal(kyc4uDocType("Source of funds", "statement.pdf", classify), "source_of_funds");
  assert.equal(kyc4uDocType("HOTs", "terms.pdf", classify), "kyc4u_document");
  assert.equal(kyc4uFileStem("d1", "i1"), kyc4uFileStem("d1", "i1"));
  assert.notEqual(kyc4uFileStem("d1", "i1"), kyc4uFileStem("d1", "i2"));
  assert.match(kyc4uFileStem("d1", "i1"), /^kyc4u-doc-[0-9a-f]{20}$/);
});

test("the sign-off names the people still to send something (19 November 2026)", () => {
  const denial = signOffDenial(facts({ clientChecksFinished: false, clientChecksOutstanding: ["Huseyn Mirhadiyev: identity check and proof of address"] }));
  assert.match(denial || "", /still to come: Huseyn Mirhadiyev: identity check and proof of address/);
  assert.equal(signOffDenial(facts({ clientChecksFinished: false, clientChecksOutstanding: ["Huseyn Mirhadiyev: proof of address"], note: "Owner verified by KYC4U on another deal" })), null);
});

test("BGP does not sign off a party owned through a company registered abroad: it goes to KYC4U", () => {
  assert.match(signOffDenial(facts({ ownersAbroad: ["Example Holding A/S, Denmark"] }))!, /^Owned through a company registered abroad \(Example Holding A\/S, Denmark\): it goes to KYC4U/);
  assert.equal(signOffDenial(facts({ ownersAbroad: [] })), null);
  // Approved by KYC4U already: the approval is what is said.
  assert.match(signOffDenial(facts({ ownersAbroad: ["X, Denmark"], current: { by: "KYC4U", until: null } }))!, /^Already approved by KYC4U/);
});
