// Xero invoices worked from the app (Woody, 20 and 24 November 2026: see and
// edit the draft, delete it with the transaction, approve and email from the
// app; "xero all admin"). The rules in shared/xero-invoice.ts.
import test from "node:test";
import assert from "node:assert/strict";
import {
  dealDeleteRefusal, dealDeleteXeroPlan, emailRecipientWords, emailRecipients, invoiceActions, invoiceEditInput,
  invoiceViewFrom, xeroDay, xeroEditPayload, xeroErrorWords, xeroStatusWords,
} from "../shared/xero-invoice";

const ID = "8f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b";
const LINE = "11111111-2222-4333-8444-555555555555";

test("what each status allows: any BGP person edits and deletes a draft; only an admin approves, emails and voids", () => {
  const draft = invoiceActions({ status: "DRAFT", inXero: true, admin: false });
  assert.deepEqual(draft, { pdf: true, edit: true, deleteDraft: true, approve: false, email: false, void: false, remove: false });
  assert.equal(invoiceActions({ status: "DRAFT", inXero: true, admin: true }).approve, true);
  assert.equal(invoiceActions({ status: "SUBMITTED", inXero: true, admin: true }).approve, true, "awaiting approval is a draft to Xero");
  const approved = invoiceActions({ status: "AUTHORISED", inXero: true, admin: true });
  assert.deepEqual(approved, { pdf: true, edit: false, deleteDraft: false, approve: false, email: true, void: true, remove: false });
  assert.equal(invoiceActions({ status: "AUTHORISED", inXero: true, admin: false }).email, false, "not an admin");
  assert.equal(invoiceActions({ status: "AUTHORISED", inXero: true, admin: true, amountPaid: 100 }).void, false, "Xero voids only with no payment against it");
  assert.equal(invoiceActions({ status: "PAID", inXero: true, admin: true }).email, true, "a paid one again as a copy");
  assert.equal(invoiceActions({ status: "PAID", inXero: true, admin: true }).void, false);
  assert.equal(invoiceActions({ status: "DELETED", inXero: true, admin: true }).remove, true);
  assert.equal(invoiceActions({ status: "DELETED", inXero: true, admin: true }).pdf, false);
  assert.equal(invoiceActions({ status: "VOIDED", inXero: true, admin: true }).remove, true);
  assert.deepEqual(invoiceActions({ status: "ERROR", inXero: false, admin: true }), { pdf: false, edit: false, deleteDraft: false, approve: false, email: false, void: false, remove: true });
  assert.equal(invoiceActions({ status: null, inXero: true, admin: false }).edit, true, "no status reads as a draft");
});

test("deleting a transaction: drafts are deleted in Xero, approved or paid ones keep it", () => {
  const rows = [
    { id: "a", xeroInvoiceId: ID, status: "DRAFT", invoiceNumber: "INV-05587" },
    { id: "b", xeroInvoiceId: ID, status: "SUBMITTED", invoiceNumber: "INV-05588" },
    { id: "c", xeroInvoiceId: null, status: "ERROR", invoiceNumber: null },
    { id: "d", xeroInvoiceId: ID, status: "VOIDED", invoiceNumber: "INV-05500" },
    { id: "e", xeroInvoiceId: ID, status: "DELETED", invoiceNumber: "INV-05501" },
  ];
  const plan = dealDeleteXeroPlan(rows);
  assert.deepEqual(plan.drafts.map(r => r.id), ["a", "b"]);
  assert.deepEqual(plan.drop.map(r => r.id), ["c", "d", "e"]);
  assert.equal(plan.refuse.length, 0);
  assert.equal(dealDeleteRefusal(plan.refuse), null);

  const live = dealDeleteXeroPlan([...rows, { id: "f", xeroInvoiceId: ID, status: "AUTHORISED", invoiceNumber: "INV-05590" }]);
  assert.deepEqual(live.refuse.map(r => r.id), ["f"]);
  assert.equal(dealDeleteRefusal(live.refuse), "Invoice INV-05590 is approved in Xero. An admin can void it under Fees & invoicing; then the transaction can be deleted.");
  assert.equal(dealDeleteRefusal([{ id: "g", xeroInvoiceId: ID, status: "PAID", invoiceNumber: "INV-1" }]), "Invoice INV-1 is paid in Xero, so the transaction is kept.");
  assert.match(dealDeleteRefusal(live.refuse, 3) || "", /^One of these transactions: Invoice INV-05590/);
  assert.match(dealDeleteRefusal([...live.refuse, { id: "h", xeroInvoiceId: ID, status: "PAID", invoiceNumber: "INV-2" }]) || "", /\(1 more invoice too\.\)$/);
  // A status the app does not know keeps the transaction until a person looks.
  assert.deepEqual(dealDeleteXeroPlan([{ id: "i", xeroInvoiceId: ID, status: "REPEATING", invoiceNumber: null }]).refuse.map(r => r.id), ["i"]);
});

test("an edit is checked line by line; the older one-line form still reads", () => {
  const ok = invoiceEditInput({
    lines: [
      { lineItemId: LINE, description: " Fee for the new letting ", quantity: "1", unitAmount: "£12,000" },
      { description: "Disbursement", quantity: 2, unitAmount: 150.555, accountCode: "4000", taxType: "output2" },
    ],
    date: "2026-11-24", dueDate: "2026-12-24", reference: " FAO Jane ", contactId: ID,
  });
  assert.equal(ok.ok, true);
  if (!ok.ok) return;
  assert.deepEqual(ok.edit.lines[0], { lineItemId: LINE, description: "Fee for the new letting", quantity: 1, unitAmount: 12000, accountCode: null, taxType: null });
  assert.equal(ok.edit.lines[1].unitAmount, 150.56);
  assert.equal(ok.edit.lines[1].taxType, "OUTPUT2");
  assert.equal(ok.edit.reference, "FAO Jane");
  const one = invoiceEditInput({ description: "Professional fees", body: "Acting for the landlord", amount: 5000 });
  assert.equal(one.ok && one.edit.lines[0].description, "Professional fees\n\nActing for the landlord");
  assert.deepEqual(invoiceEditInput({ lines: [] }), { ok: false, message: "An invoice needs at least one line." });
  assert.deepEqual(invoiceEditInput({ lines: [{ description: "", unitAmount: 1 }] }), { ok: false, message: "Add the words." });
  assert.deepEqual(invoiceEditInput({ lines: [{ description: "a", unitAmount: 1 }, { description: "b", unitAmount: "x" }] }), { ok: false, message: "Check the amount on line 2." });
  assert.deepEqual(invoiceEditInput({ lines: [{ description: "a", quantity: 0, unitAmount: 1 }] }), { ok: false, message: "Check the quantity." });
  assert.deepEqual(invoiceEditInput({ lines: [{ description: "a", unitAmount: 1 }], date: "2026-02-30" }), { ok: false, message: "Check the invoice date." });
  assert.deepEqual(invoiceEditInput({ lines: [{ description: "a", unitAmount: 1 }], date: "2026-11-24", dueDate: "2026-11-01" }), { ok: false, message: "The due date is before the invoice date." });
  assert.deepEqual(invoiceEditInput({ lines: [{ description: "a", unitAmount: 1 }], contactId: "Acme Ltd" }), { ok: false, message: "Pick the contact from Xero." });
  assert.equal(invoiceEditInput({ lines: Array.from({ length: 21 }, () => ({ description: "a", unitAmount: 1 })) }).ok, false);
});

test("the body Xero takes: every line, a kept line keeps its codes, the contact by its id only", () => {
  const edit = invoiceEditInput({ lines: [{ lineItemId: LINE, description: "Fee", unitAmount: 100 }, { description: "New line", unitAmount: 5 }], reference: "", contactId: ID });
  assert.ok(edit.ok);
  if (!edit.ok) return;
  const body = xeroEditPayload("inv-1", edit.edit, { lines: [{ LineItemID: LINE, AccountCode: "4010", TaxType: "OUTPUT2" }] }, { accountCode: "4000", taxType: "OUTPUT2" });
  assert.deepEqual(body.LineItems, [
    { LineItemID: LINE, Description: "Fee", Quantity: 1, UnitAmount: 100, AccountCode: "4010", TaxType: "OUTPUT2" },
    { Description: "New line", Quantity: 1, UnitAmount: 5, AccountCode: "4000", TaxType: "OUTPUT2" },
  ]);
  assert.deepEqual(body.Contact, { ContactID: ID });
  assert.equal(body.Reference, "", "an emptied reference is sent as empty");
  assert.equal(body.Date, undefined);
  // A line id Xero does not hold is not sent (Xero would refuse it): the line is made afresh.
  const stray = xeroEditPayload("inv-1", edit.edit, { lines: [] }, { accountCode: "4000", taxType: "OUTPUT2" });
  assert.equal(stray.LineItems[0].LineItemID, undefined);
});

test("reading Xero: both date forms, the lines and totals, who Xero emails", () => {
  assert.equal(xeroDay("2026-11-24T00:00:00"), "2026-11-24");
  assert.equal(xeroDay("/Date(1763942400000+0000)/"), "2025-11-24");
  assert.equal(xeroDay("nonsense"), null);
  const view = invoiceViewFrom({
    InvoiceID: ID, InvoiceNumber: "INV-05587", Status: "AUTHORISED", Contact: { ContactID: ID, Name: "Bruce Cap Ltd" },
    Date: "/Date(1763942400000+0000)/", DateString: "2026-11-24T00:00:00", DueDateString: "2026-12-24T00:00:00",
    Reference: "FAO Jane", CurrencyCode: "GBP", SubTotal: 60000, TotalTax: 12000, Total: 72000, AmountDue: 72000, AmountPaid: 0, SentToContact: true,
    LineItems: [{ LineItemID: LINE, Description: "Fee", Quantity: 1, UnitAmount: 60000, AccountCode: "4000", TaxType: "OUTPUT2", TaxAmount: 12000, LineAmount: 60000 }],
  });
  assert.equal(view.date, "2026-11-24", "DateString first");
  assert.equal(view.dueDate, "2026-12-24");
  assert.equal(view.statusWords, "Approved");
  assert.equal(view.lines[0].taxAmount, 12000);
  assert.equal(view.sentToContact, true);
  assert.equal(xeroStatusWords("submitted"), "Awaiting approval");

  const r = emailRecipients({ EmailAddress: "accounts@brucecap.co.uk", ContactPersons: [
    { EmailAddress: "jane@brucecap.co.uk", IncludeInEmails: true },
    { EmailAddress: "bob@brucecap.co.uk", IncludeInEmails: false },
    { EmailAddress: "ACCOUNTS@brucecap.co.uk", IncludeInEmails: true },
  ] });
  assert.deepEqual(r, { primary: "accounts@brucecap.co.uk", others: ["jane@brucecap.co.uk"] });
  assert.equal(emailRecipientWords(r), "Xero emails it to accounts@brucecap.co.uk, jane@brucecap.co.uk.");
  assert.equal(emailRecipientWords(emailRecipients({ EmailAddress: "" })), "Xero has no email address for this contact.");
});

test("Xero's refusals in plain words", () => {
  const body = JSON.stringify({ ErrorNumber: 10, Type: "ValidationException", Message: "A validation exception occurred", Elements: [{ ValidationErrors: [{ Message: "Account code '200' has been archived, or has been deleted." }] }] });
  assert.equal(xeroErrorWords(`Xero API error: 400 - ${body}`), "Xero says: Account code '200' has been archived, or has been deleted.");
  assert.match(xeroErrorWords("Xero API error: 403 - {}"), /^Xero refused this for your Xero login/);
  assert.equal(xeroErrorWords("Xero API error: 404 - "), "Xero no longer has this invoice.");
  assert.equal(xeroErrorWords("Xero API error: 500 - {\"Detail\":\"Down\"}"), "Xero says: Down");
  assert.equal(xeroErrorWords("Not connected to Xero"), "Not connected to Xero");
});
