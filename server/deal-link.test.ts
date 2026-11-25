// Using a live transaction from New Transaction (Woody, 24 November 2026: "Can
// you allow for link to existing deal at this point? its easier", on the
// notice that One Clapham already had a live purchase, #4578, at Negotiating).
// The first case is that: the heads of terms read into New Transaction move
// onto #4578, filling only what it had blank.
import test from "node:test";
import assert from "node:assert/strict";
import { linkSame, linkToTransaction, linkValueWords } from "../client/src/lib/deal-link";

// New Transaction with nothing given: it starts at Solicitors, in pounds, on the person's team.
const BASE = {
  name: "", dealType: "", status: "SOL", team: ["Investment"], internalAgent: [], propertyId: "", unitId: "",
  landlordId: "", tenantId: "", vendorId: "", purchaserId: "", pricing: "", fee: "", feeCurrency: "GBP",
  feePercentage: "", targetDate: "", comments: "", amlCheckCompleted: "", xeroContactId: "", xeroContactName: "",
  xeroAccountNumber: "", xeroBillingAddress: null,
  vendorEntityId: "", vendorEntityName: "", vendorTradingEntityId: "",
  purchaserEntityId: "", purchaserEntityName: "", purchaserTradingEntityId: "",
};
const ONE_CLAPHAM = {
  ...BASE, name: "One Clapham", dealType: "Purchase", status: "NEG", team: ["Investment"], propertyId: "prop-1",
  purchaserId: "co-buyer", pricing: "", fee: "", targetDate: "", comments: "Client wants a quick exchange",
};
const READ = {
  ...BASE, name: "Buyer Ltd – One Clapham", dealType: "Purchase", status: "HOT", team: ["Investment", "London Estate"],
  propertyId: "prop-1", purchaserId: "co-buyer", vendorId: "co-seller", vendorTradingEntityId: "te-seller",
  pricing: "12500000", fee: "125000", targetDate: "2027-03-01", comments: "Subject to contract", amlCheckCompleted: "YES",
};

test("the heads of terms move onto the live transaction: its blanks fill, what it holds stays", () => {
  const r = linkToTransaction(ONE_CLAPHAM, READ, BASE);
  // Its own name, team, property and stage stay.
  assert.equal(r.form.name, "One Clapham");
  assert.deepEqual(r.form.team, ["Investment"]);
  assert.equal(r.form.propertyId, "prop-1");
  assert.equal(r.form.status, "NEG");
  // The AML check is the Nominated Officer's: never carried over.
  assert.equal(r.form.amlCheckCompleted, "");
  // The vendor comes whole, with the company that signs for it.
  assert.equal(r.form.vendorId, "co-seller");
  assert.equal(r.form.vendorTradingEntityId, "te-seller");
  assert.equal(r.form.pricing, "12500000");
  assert.equal(r.form.fee, "125000");
  assert.equal(r.form.targetDate, "2027-03-01");
  // The new words are added to the transaction's comments.
  assert.equal(r.form.comments, "Client wants a quick exchange\nSubject to contract");
  assert.deepEqual(r.filled.map(f => f.label), ["Vendor", "Price", "Fee", "Target date", "Comments (added to)"]);
  // The stage is offered, never moved by itself.
  assert.equal(r.differs.length, 1);
  assert.deepEqual(r.differs[0], { key: "status", field: "status", label: "Stage", current: "NEG", offered: "HOT", patch: { status: "HOT" }, move: true });
});

test("where the two disagree, the transaction's value stays and the other is offered whole", () => {
  const held = { ...ONE_CLAPHAM, vendorId: "co-other", vendorTradingEntityId: "te-other", pricing: "10000000" };
  const r = linkToTransaction(held, READ, BASE);
  assert.equal(r.form.vendorId, "co-other");
  assert.equal(r.form.pricing, "10000000");
  const vendor = r.differs.find(d => d.key === "vendor")!;
  assert.equal(vendor.current, "co-other");
  assert.equal(vendor.offered, "co-seller");
  assert.deepEqual(vendor.patch, { vendorId: "co-seller", vendorEntityId: "", vendorEntityName: "", vendorTradingEntityId: "te-seller" });
  const price = r.differs.find(d => d.key === "pricing")!;
  assert.deepEqual(price.patch, { pricing: "12500000" });
  assert.ok(!r.filled.some(f => f.key === "vendor" || f.key === "pricing"));
});

test("New Transaction's own defaults are not something given", () => {
  const untouched = { ...BASE, propertyId: "prop-1", name: "One Clapham" };
  const r = linkToTransaction(ONE_CLAPHAM, untouched, BASE);
  assert.deepEqual(r.filled, []);
  assert.deepEqual(r.differs, []);
  assert.equal(r.form.status, "NEG");
  assert.equal(r.form.feeCurrency, "GBP");
});

test("the stage is only ever offered forward, and never past Solicitors", () => {
  assert.deepEqual(linkToTransaction({ ...ONE_CLAPHAM, status: "SOL" }, READ, BASE).differs, []);
  assert.deepEqual(linkToTransaction({ ...ONE_CLAPHAM, status: "HOT" }, READ, BASE).differs, []);
  // Picked as Exchanged on New Transaction: not offered, set on the transaction itself.
  assert.deepEqual(linkToTransaction(ONE_CLAPHAM, { ...READ, status: "EXC" }, BASE).differs, []);
  // An old spelling of a stage is read as its code.
  const legacy = linkToTransaction({ ...ONE_CLAPHAM, status: "Negotiating" }, READ, BASE);
  assert.equal(legacy.differs[0]?.offered, "HOT");
});

test("the same value in another spelling is no difference", () => {
  assert.ok(linkSame("pricing", "12500000", "12,500,000"));
  assert.ok(linkSame("pricing", "£12,500,000.00", "12500000"));
  assert.ok(linkSame("targetDate", "2027-03-15", "2027-03-01"));
  assert.ok(!linkSame("targetDate", "2027-03-15", "2027-04-01"));
  assert.ok(linkSame("tenureText", "Freehold", " freehold "));
  assert.ok(linkSame("status", "Negotiating", "NEG"));
  const r = linkToTransaction({ ...ONE_CLAPHAM, pricing: "12,500,000", targetDate: "2027-03-31" }, READ, BASE);
  assert.ok(!r.differs.some(d => d.key === "pricing" || d.key === "targetDate"));
});

test("the same party: its billing entity and the company that signs fill only where the transaction has none", () => {
  const given = { ...READ, purchaserEntityId: "xero-1", purchaserEntityName: "Buyer Ltd", purchaserTradingEntityId: "te-buyer" };
  const r = linkToTransaction(ONE_CLAPHAM, given, BASE);
  assert.equal(r.form.purchaserEntityId, "xero-1");
  assert.equal(r.form.purchaserEntityName, "Buyer Ltd");
  assert.equal(r.form.purchaserTradingEntityId, "te-buyer");
  assert.ok(r.filled.some(f => f.label === "Purchaser's billing entity"));
  assert.ok(r.filled.some(f => f.label === "Purchaser's company that signs"));
  // Held already: kept, and not listed.
  const held = linkToTransaction({ ...ONE_CLAPHAM, purchaserTradingEntityId: "te-held" }, given, BASE);
  assert.equal(held.form.purchaserTradingEntityId, "te-held");
  assert.ok(!held.differs.some(d => d.key.startsWith("purchaser")));
});

test("the transaction's own invoice contact fills whole, or is offered by its name", () => {
  const given = { ...READ, xeroContactId: "x-2", xeroContactName: "Seller Holdings Ltd", xeroAccountNumber: "", xeroBillingAddress: null };
  const filled = linkToTransaction(ONE_CLAPHAM, given, BASE);
  assert.equal(filled.form.xeroContactId, "x-2");
  assert.equal(filled.form.xeroContactName, "Seller Holdings Ltd");
  assert.ok(filled.filled.some(f => f.key === "xero"));
  const held = linkToTransaction({ ...ONE_CLAPHAM, xeroContactId: "x-1", xeroContactName: "Buyer Ltd" }, given, BASE);
  const xero = held.differs.find(d => d.key === "xero")!;
  assert.equal(xero.field, "xeroContactName");
  assert.equal(xero.current, "Buyer Ltd");
  assert.equal(xero.offered, "Seller Holdings Ltd");
  assert.deepEqual(xero.patch, { xeroContactId: "x-2", xeroContactName: "Seller Holdings Ltd", xeroAccountNumber: "", xeroBillingAddress: null });
});

test("comments already on the transaction are not added twice", () => {
  const r = linkToTransaction({ ...ONE_CLAPHAM, comments: "Subject to contract. Client wants a quick exchange" }, READ, BASE);
  assert.equal(r.form.comments, "Subject to contract. Client wants a quick exchange");
  assert.ok(!r.filled.some(f => f.key === "comments"));
});

test("values read as the person reads them", () => {
  const names = { company: (id: string) => ({ "co-seller": "Seller Ltd" } as Record<string, string>)[id], unit: () => undefined };
  assert.equal(linkValueWords("vendorId", "co-seller", names), "Seller Ltd");
  assert.equal(linkValueWords("vendorId", "co-gone", names), "a company not in this list");
  assert.equal(linkValueWords("status", "HOT", names), "HOTs");
  assert.equal(linkValueWords("pricing", "12500000", names), "£12,500,000");
  assert.equal(linkValueWords("yieldPercent", "5.25", names), "5.25%");
  assert.equal(linkValueWords("totalAreaSqft", "12000", names), "12,000 sq ft");
  assert.equal(linkValueWords("rentFree", "1", names), "1 month");
  assert.equal(linkValueWords("leaseLength", "10", names), "10 years");
  assert.equal(linkValueWords("targetDate", "2027-03-01", names), "Mar 2027");
  assert.equal(linkValueWords("exchangedAt", "2027-03-14", names), "14 Mar 2027");
  assert.equal(linkValueWords("pricing", "", names), "nothing");
});
