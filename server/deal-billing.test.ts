// Who BGP bills, and who pays (Woody, 20 November 2026: "the Xero billing
// entity and the aml entity need to be flagged if they are different", then
// "yes biuild"). Rules: shared/deal-billing.ts.
import test from "node:test";
import assert from "node:assert/strict";
import { billingState, billingWords, payerInput, payerRedFlags, sameBillingCompany } from "../shared/deal-billing";

test("the same legal company, however it is written", () => {
  assert.ok(sameBillingCompany("Bruce Cap Ltd t/a Pave", "BRUCE CAP LTD"));
  assert.ok(sameBillingCompany("Bruce Gillingham Pollard Limited", "BRUCE GILLINGHAM POLLARD LTD."));
  assert.ok(sameBillingCompany("Smith & Jones Ltd", "SMITH AND JONES LIMITED"));
  assert.ok(!sameBillingCompany("Brent Cross Partnership Ltd", "Hammerson UK Properties plc"));
  assert.ok(!sameBillingCompany("", ""));
});

test("billed as the contracting entity by default; another company is flagged", () => {
  const signing = { name: "BRUCE CAP LTD", xeroContactId: "x1" };
  assert.equal(billingState({ individual: false, signing, billed: null, payer: null }), "signing");
  assert.equal(billingState({ individual: false, signing, billed: { contactId: "x1", name: "Pave" }, payer: null }), "same", "the Xero contact linked to the company");
  assert.equal(billingState({ individual: false, signing: { name: "BRUCE CAP LTD" }, billed: { contactId: "x9", name: "Bruce Cap Ltd t/a Pave" }, payer: null }), "same", "by name");
  assert.equal(billingState({ individual: false, signing, billed: { contactId: "x2", name: "Brent Cross Partnership Ltd" }, payer: null }), "different");
  assert.equal(billingState({ individual: false, signing: null, billed: { contactId: "x2", name: "Anyone Ltd" }, payer: null }), "no_company");
  assert.equal(billingState({ individual: true, signing: null, billed: null, payer: null }), "individual");
  // Confirmed as the same company: a name-only contact kept on the company reads as it.
  assert.equal(billingState({ individual: false, signing: { name: "HAMMERSON UK PROPERTIES PLC", xeroContactName: "Brent Cross Partnership Ltd" }, billed: { contactId: null, name: "Brent Cross Partnership Ltd" }, payer: null }), "same");
});

test("a third party recorded as the payer", () => {
  const signing = { name: "BRUCE CAP LTD", xeroContactId: "x1" };
  const payer = { name: "BGP REAL ESTATE LIMITED", xeroContactId: "x7" };
  assert.equal(billingState({ individual: false, signing, billed: { contactId: "x7", name: "BGP Real Estate Ltd" }, payer }), "payer");
  assert.equal(billingState({ individual: false, signing, billed: null, payer }), "payer");
  // Billed to someone else again: still different.
  assert.equal(billingState({ individual: false, signing, billed: { contactId: "x8", name: "Other Ltd" }, payer }), "different");
  assert.equal(billingWords("payer", { billed: null, signing: "BRUCE CAP LTD", payer: "BGP REAL ESTATE LIMITED", relationship: "group" }).tone, "act");
  assert.equal(billingWords("payer", { billed: null, signing: "BRUCE CAP LTD", payer: "X LTD", relationship: "none" }).tone, "flag");
  assert.match(billingWords("different", { billed: "Brent Cross Partnership Ltd", signing: "HAMMERSON UK PROPERTIES PLC", payer: null, relationship: null }).words,
    /^Billed to Brent Cross Partnership Ltd, not the contracting entity \(HAMMERSON UK PROPERTIES PLC\): a third party paying BGP's invoice needs its own checks\./);
});

test("the payer is recorded with how it is related, and another relationship says what", () => {
  assert.deepEqual(payerInput({ companyId: null }), { companyId: null, relationship: null, note: null });
  assert.deepEqual(payerInput({ companyId: "e1", relationship: "group" }), { companyId: "e1", relationship: "group", note: null });
  assert.ok("problem" in payerInput({ companyId: "e1" }));
  assert.ok("problem" in payerInput({ companyId: "e1", relationship: "other", note: "short" }));
  assert.deepEqual(payerInput({ companyId: "e1", relationship: "other", note: "The tenant's franchisor pays the fee" }), { companyId: "e1", relationship: "other", note: "The tenant's franchisor pays the fee" });
});

test("no clear relationship is a red flag; the payer's own findings count too", () => {
  const none = payerRedFlags({ payer: { id: "e1", name: "X LTD" }, relationship: "none", note: null, precheck: null });
  assert.equal(none.length, 1);
  assert.equal(none[0].kind, "third_party_payer");
  assert.equal(none[0].key, "payer:e1:relationship");
  assert.match(none[0].detail || "", /HMRC treats a payment from a third party with no link to the customer as high risk/);
  assert.equal(payerRedFlags({ payer: { id: "e1", name: "X LTD" }, relationship: "group", note: null, precheck: null }).length, 0);
});

// A person as the billing or contracting entity, and a purchase vehicle set
// up later (Woody, 20 November 2026).
test("a person who signs is billed as the one who signs", () => {
  const words = billingWords("signing", { billed: null, signing: "Sandy Macaskill", payer: null, relationship: null, signingPerson: true }).words;
  assert.match(words, /^Billed to Sandy Macaskill, who signs\. Their Xero contact/);
  assert.match(billingWords("different", { billed: "Macaskill Holdings Ltd", signing: "Sandy Macaskill", payer: null, relationship: null, signingPerson: true }).words,
    /not the person who signs \(Sandy Macaskill\)/);
  // A purchase vehicle the client owns is a clear relationship.
  assert.equal(billingWords("payer", { billed: null, signing: "Sandy Macaskill", payer: "Macaskill Holdings Ltd", relationship: "vehicle", signingPerson: true }).tone, "act");
  const vehicle = payerInput({ companyId: "e1", relationship: "vehicle" });
  assert.ok(!("problem" in vehicle) && vehicle.relationship === "vehicle");
});

test("a person typed as the billing or contracting entity", async () => {
  const { billingPersonInput, xeroContactForPerson } = await import("./billing-entity");
  const ok = billingPersonInput({ brandId: "b1", person: { name: "  Sandy   Macaskill ", email: "Sandy@Example.com", mobile: "07700 900123" } });
  assert.deepEqual(ok, { brandId: "b1", person: { name: "Sandy Macaskill", email: "sandy@example.com", mobile: "07700 900123" } });
  assert.match((billingPersonInput({ brandId: "b1", person: { name: "Sandy" } }) as any).problem, /first name and surname/);
  assert.match((billingPersonInput({ brandId: "b1", person: { name: "Macaskill Holdings Limited" } }) as any).problem, /reads as a company/);
  assert.match((billingPersonInput({ brandId: "b1", person: { name: "Sandy Macaskill", email: "not-an-email" } }) as any).problem, /email/);
  assert.match((billingPersonInput({ person: { name: "Sandy Macaskill" } }) as any).problem, /landlord or brand/);
  assert.deepEqual(xeroContactForPerson({ name: "Sandy Jane Macaskill", email: "s@example.com" }),
    { Name: "Sandy Jane Macaskill", FirstName: "Sandy Jane", LastName: "Macaskill", EmailAddress: "s@example.com" });
});
