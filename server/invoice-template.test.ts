// Layla's invoice template (20 November 2026): shared/invoice-template.ts and
// the read behind it, server/invoice-template.ts.
import "./test-database-url";
import test from "node:test";
import assert from "node:assert/strict";
import { buildInvoiceDraft, descriptionHoldsPo, invoiceAddress, invoiceMoney, usesLettingTemplate, type InvoiceTemplateFacts } from "../shared/invoice-template";
import { invoiceTemplateFactsFor } from "./invoice-template";

const letting = (over: Partial<InvoiceTemplateFacts> = {}): InvoiceTemplateFacts => ({
  dealName: "Gail's – 12 High Street",
  dealType: "New Letting",
  clientRole: "landlord",
  fao: "Jane Smith",
  landlord: "Highbury Estates Limited",
  tenant: "Bread Holdings Limited",
  address: "Unit 3, 12 High Street, Guildford, GU1 3AA",
  poNumber: null,
  feePercentage: 10,
  rentPa: 120000,
  fee: 12000,
  currency: "GBP",
  jointAgentFeePct: null,
  ...over,
});

test("a New Letting for the landlord fills Layla's template from the deal", () => {
  const d = buildInvoiceDraft(letting({ poNumber: "4500123" }));
  assert.equal(d.template, "letting");
  assert.equal(d.reference, "FAO Jane Smith");
  assert.equal(d.amount, 12000);
  assert.equal(d.description, [
    "Bread Holdings Limited",
    "Unit 3, 12 High Street, Guildford, GU1 3AA",
    "PO – 4500123",
    "",
    "To: Acting on behalf of Highbury Estates Limited, in negotiating a new letting to Bread Holdings Limited in respect of the above property.",
    "",
    "To: Fee 10% of the agreed annual rent of £120,000 = £12,000 plus VAT",
  ].join("\n"));
  assert.deepEqual(d.missing, []);
  assert.deepEqual(d.warnings, []);
});

test("no PO number leaves the PO line out, and a line holding the PO keeps it off the reference", () => {
  const d = buildInvoiceDraft(letting());
  assert.doesNotMatch(d.description, /PO –/);
  assert.equal(descriptionHoldsPo([buildInvoiceDraft(letting({ poNumber: "PO-77" })).description], "PO-77"), true);
  assert.equal(descriptionHoldsPo(["Gail's – 12 High Street"], "PO-77"), false);
  assert.equal(descriptionHoldsPo(["anything"], null), false);
});

test("what the deal does not hold stays as in the template, and is listed", () => {
  const d = buildInvoiceDraft(letting({ fao: null, tenant: null, landlord: null, address: null, rentPa: null, feePercentage: null, fee: null }));
  assert.equal(d.reference, "FAO NAME");
  assert.match(d.description, /^TENANT\nADDRESS\n/);
  assert.match(d.description, /on behalf of LANDLORD, in negotiating a new letting to TENANT in respect/);
  assert.match(d.description, /To: Fee \?% of the agreed annual rent of £\? = £\? plus VAT$/);
  assert.equal(d.amount, 0);
  for (const word of ["the fee", "the client contact", "the tenant", "the landlord", "the property's address", "the agreed annual rent", "the fee percentage"]) {
    assert.ok(d.missing.some(m => m.startsWith(word)), word);
  }
});

test("a fee percentage is worked out from the fee and the rent only when it is a clean figure", () => {
  const clean = buildInvoiceDraft(letting({ feePercentage: null, rentPa: 80000, fee: 6000 }));
  assert.match(clean.description, /Fee 7\.5% of the agreed annual rent of £80,000 = £6,000 plus VAT/);
  assert.equal(clean.workedOut.length, 1);
  assert.deepEqual(clean.missing, []);
  const sum = buildInvoiceDraft(letting({ feePercentage: null, rentPa: 90000, fee: 10000 }));
  assert.match(sum.description, /Fee \?% of the agreed annual rent of £90,000 = £10,000 plus VAT/);
  assert.ok(sum.missing.includes("the fee percentage"));
});

test("a percentage, rent and fee that do not agree are flagged, never changed", () => {
  const d = buildInvoiceDraft(letting({ feePercentage: 10, rentPa: 120000, fee: 10000 }));
  assert.match(d.description, /Fee 10% of the agreed annual rent of £120,000 = £10,000 plus VAT/);
  assert.equal(d.amount, 10000);
  assert.equal(d.warnings.length, 1);
  assert.equal(d.warnings[0], "10% of £120,000 is £12,000, not £10,000.");
});

test("a fee shared with a joint agent asks for BGP's share to be checked", () => {
  const d = buildInvoiceDraft(letting({ jointAgentFeePct: 50 }));
  assert.ok(d.warnings.includes("Joint agent takes 50% of the fee: check this is BGP's share."));
});

test("other deals keep the deal's name: the template is for a New Letting acting for the landlord", () => {
  assert.equal(usesLettingTemplate({ dealType: "New Letting", clientRole: "landlord" }), true);
  assert.equal(usesLettingTemplate({ dealType: "new letting", clientRole: "landlord" }), true);
  for (const [dealType, clientRole] of [["New Letting", "tenant"], ["Lease Disposal", "tenant"], ["Sale", "vendor"], ["Temp Lease", "landlord"], [null, "landlord"]] as const) {
    const d = buildInvoiceDraft(letting({ dealType, clientRole }));
    assert.equal(d.template, "plain", String(dealType));
    assert.equal(d.description, "Gail's – 12 High Street");
    assert.equal(d.reference, "Gail's – 12 High Street");
    assert.equal(d.amount, 12000);
  }
});

test("money in pounds or dollars, pence only when there are any", () => {
  assert.equal(invoiceMoney(120000), "£120,000");
  assert.equal(invoiceMoney(1234.5), "£1,234.50");
  assert.equal(invoiceMoney(9000, "USD"), "$9,000");
  const usd = buildInvoiceDraft(letting({ currency: "USD" }));
  assert.match(usd.description, /rent of \$120,000 = \$12,000 plus VAT/);
});

test("the address line: unit, the property's name where the address lacks it, the address, the postcode", () => {
  assert.equal(invoiceAddress({ unitName: "Unit L045", propertyName: "Westgate Centre", address: { formatted: "Queen Street, Oxford OX1 1PE, UK" }, postcode: "OX1 1PE" }),
    "Unit L045, Westgate Centre, Queen Street, Oxford OX1 1PE");
  assert.equal(invoiceAddress({ unitName: null, propertyName: "55 Wells Street", address: { formatted: "55 Wells Street, London W1T 3PT, United Kingdom" }, postcode: null }),
    "55 Wells Street, London W1T 3PT");
  assert.equal(invoiceAddress({ unitName: "4", propertyName: "Cathedral Walk", address: { line1: "4 Cathedral Walk", city: "Cardiff" }, postcode: "CF10 2AA" }),
    "4 Cathedral Walk, Cardiff, CF10 2AA");
  assert.equal(invoiceAddress({ unitName: null, propertyName: null, address: "1 New England Road, Brighton", postcode: null }), "1 New England Road, Brighton");
  assert.equal(invoiceAddress({ unitName: "Ground Floor", propertyName: "The Arches", address: null, postcode: "se1 7aa" }),
    "Ground Floor, The Arches, SE1 7AA");
  assert.equal(invoiceAddress({ unitName: null, propertyName: null, address: null, postcode: null }), "");
});

test("the read takes each party as it signs, the client contact for FAO, and the unit's tracker name", async () => {
  const seen: string[] = [];
  const row = {
    name: "Gail's – Westgate", deal_type: "New Letting", bgp_acting_for: "landlord", team: ["Shopping Centre"], po_number: "PO-9",
    fee_percentage: 10, rent_pa: 100000, fee: 10000, fee_currency: null, joint_agent_fee_pct: null,
    landlord_brand: "Westgate Oxford", landlord_signs: "WESTGATE OXFORD ALLIANCE LIMITED PARTNERSHIP",
    tenant_brand: "Gail's", tenant_signs: null,
    property_name: "Westgate Centre", property_address: { formatted: "Queen Street, Oxford OX1 1PE, UK" }, property_postcode: "OX1 1PE",
    schedule_unit: "L045", tracker_unit: "Unit L045",
    client_contact: null, landlord_contact: "Jane Smith", tenant_contact: "Tom Baker", vendor_contact: null, purchaser_contact: null,
  };
  const facts = await invoiceTemplateFactsFor("d1", { query: async (sql: string) => { seen.push(sql); return { rows: [row] }; } });
  assert.ok(facts);
  assert.equal(facts!.clientRole, "landlord");
  assert.equal(facts!.landlord, "WESTGATE OXFORD ALLIANCE LIMITED PARTNERSHIP");
  assert.equal(facts!.tenant, "Gail's");
  assert.equal(facts!.fao, "Jane Smith");
  assert.equal(facts!.address, "Unit L045, Westgate Centre, Queen Street, Oxford OX1 1PE");
  assert.equal(facts!.poNumber, "PO-9");
  assert.equal(facts!.currency, "GBP");
  // The company that signs is taken only when it is filed under the party's brand.
  assert.match(seen[0], /ls\.id = d\.landlord_trading_entity_id AND ls\.parent_company_id = d\.landlord_id/);
  assert.match(seen[0], /ts\.id = d\.tenant_trading_entity_id AND ts\.parent_company_id = d\.tenant_id/);
  // With no Letting Tracker row, the schedule's unit.
  const scheduleOnly = await invoiceTemplateFactsFor("d1", { query: async () => ({ rows: [{ ...row, tracker_unit: null }] }) });
  assert.equal(scheduleOnly!.address, "L045, Westgate Centre, Queen Street, Oxford OX1 1PE");
  assert.match(seen[0], /coalesce\(nullif\(trim\(tu\.unit_number\), ''\), tu\.premises\) AS schedule_unit/);
  // A deal's own client contact wins over the party's contact.
  const withClient = await invoiceTemplateFactsFor("d1", { query: async () => ({ rows: [{ ...row, client_contact: "Ann Lee" }] }) });
  assert.equal(withClient!.fao, "Ann Lee");
  assert.equal(await invoiceTemplateFactsFor("none", { query: async () => ({ rows: [] }) }), null);
});
