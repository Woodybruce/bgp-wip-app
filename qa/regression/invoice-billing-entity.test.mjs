// The deal's invoice goes to the billing entity set with the AML checks
// (Woody, 20 November 2026: "this xero invoicing is not autolinked to the AML
// deal process thats happening it should be"). Source guards: one rule for
// who is billed (shared/deal-parties.ts invoiceContactFor), the invoice routes
// read it, and nothing makes a Xero contact out of a deal's or a tenant's name.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(p, 'utf8');
const xero = read('server/xero.ts');
const crm = read('server/crm.ts');
const deals = read('client/src/pages/deals.tsx');

const between = (src, from, to) => {
  const a = src.indexOf(from);
  assert.ok(a >= 0, `missing: ${from}`);
  const b = src.indexOf(to, a + from.length);
  return src.slice(a, b < 0 ? undefined : b);
};

test('the invoice route bills the contact the rule names, never one made from the deal name', () => {
  const route = between(xero, 'app.post("/api/xero/invoices", requireAuth', 'const invoiceLines =');
  assert.match(route, /await resolveDealInvoiceContact\(req\.session, deal,/);
  assert.match(route, /code: "NO_BILLING_ENTITY"/);
  assert.doesNotMatch(route, /deal\.name \|\| undefined|\|\| deal\.name/, 'the deal name is never a contact name');
  assert.doesNotMatch(route, /method: "POST",\s*body: JSON\.stringify\(\{\s*Contacts/, 'no contact is created in the route itself');
  const helper = between(xero, 'export async function resolveDealInvoiceContact(', '\n}\n');
  assert.match(helper, /const billing = invoiceContactFor\(deal\);/);
  // Only a contact held by name (a scheme's billing entity) is found or made.
  assert.match(helper, /if \(billing\.name\) \{/);
});

test('the automatic draft at exchange or completion bills the same contact, never the tenant by default', () => {
  const auto = between(crm, 'if (existingInvoices.length === 0 && (deal.fee || 0) > 0 && !kycBlocked && !poCheck?.missing) {', 'Auto-created draft Xero invoice');
  assert.match(auto, /await resolveDealInvoiceContact\(req\.session, deal,/);
  assert.doesNotMatch(auto, /deal\.tenantId/, 'no fallback to the tenant');
  assert.doesNotMatch(auto, /Contacts: \[\{ Name: contactName/);
});

test('the invoice card and the Deals table read the one rule', () => {
  const card = between(deals, 'export function XeroInvoiceSection(', 'function kycStatusLabel(');
  assert.match(card, /const billing = invoiceContactFor\(deal as any\);/);
  assert.match(card, /xeroContactId: billing\.contactId \|\| null,/);
  assert.match(card, /contactName: billing\.name \|\| undefined,/);
  assert.doesNotMatch(card, /xeroContactName \|\| deal\.name/);
  assert.match(card, /<DealPartyEditor dealId=\{dealId\} role=\{billing\.role\}/, 'the billing entity is set in the one party box');
  assert.match(card, /disabled=\{createInvoiceMutation\.isPending \|\| \(poStillMissing && !allowMissingPo\) \|\| !billing\.name\}/);
  // The Deals table's Client and Xero cells show who the invoice goes to.
  assert.match(deals, /return DEAL_PARTY_FIELDS\[dealClientRole\(deal\)\]\.brand as ClientField;/);
  assert.equal((deals.match(/const billing = invoiceContactFor\(deal\);/g) || []).length, 2);
});
