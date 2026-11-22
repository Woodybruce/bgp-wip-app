// Layla's invoice template filled into the Xero draft (Layla O'Driscoll to
// Woody, 20 November 2026: "This is the template I use for majority of
// invoices – would be great if it could autofill over to Xero!"). Source
// guards; the rule is tested in server/invoice-template.test.ts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(p, 'utf8');
const between = (src, from, to) => {
  const a = src.indexOf(from);
  assert.ok(a >= 0, `missing: ${from}`);
  const b = src.indexOf(to, a + from.length);
  return src.slice(a, b < 0 ? undefined : b);
};

test("the template keeps Layla's words", () => {
  const rule = read('shared/invoice-template.ts');
  assert.match(rule, /reference: `FAO \$\{fao \|\| "NAME"\}`/);
  assert.match(rule, /`To: Acting on behalf of \$\{landlord \|\| "LANDLORD"\}, in negotiating a new letting to \$\{tenantWord\} in respect of the above property\.`/);
  assert.match(rule, /`To: Fee \$\{/);
  assert.match(rule, /plus VAT`/);
  assert.match(rule, /\.\.\.\(po \? \[`PO – \$\{po\}`\] : \[\]\)/);
  // It is for a New Letting where BGP acts for the landlord; nothing else takes its words.
  assert.match(rule, /return text\(facts\.dealType\)\.toLowerCase\(\) === "new letting" && facts\.clientRole === "landlord";/);
});

test('the draft route is read only and for BGP staff signed in as themselves', () => {
  const xero = read('server/xero.ts');
  const route = between(xero, 'app.get("/api/xero/invoice-draft/:dealId", requireAuth', 'app.post("/api/xero/invoices", requireAuth');
  assert.match(route, /if \(!\(await contactViewer\(req\)\)\.staff\) return res\.status\(403\)/);
  assert.doesNotMatch(route, /UPDATE|INSERT|db\.update|db\.insert|xeroApi/);
});

test('the invoice route fills the template when no lines are sent, and keeps a PO in the words off the reference', () => {
  const xero = read('server/xero.ts');
  const route = between(xero, 'app.post("/api/xero/invoices", requireAuth', 'res.json({\n        success: true,');
  assert.match(route, /if \(!\(lineItems && lineItems\.length > 0\)\) \{[\s\S]{0,400}buildInvoiceDraft\(\{ \.\.\.facts, poNumber: resolvedPoNumber \}\)/);
  assert.match(route, /Description: filled\?\.description \|\| deal\.name \|\| "Professional fees",/);
  assert.match(route, /const invoiceReference = reference \|\| filled\?\.reference \|\| deal\.name;/);
  assert.match(route, /if \(resolvedPoNumber && !descriptionHoldsPo\(invoiceLines\.map\(l => l\.Description\), resolvedPoNumber\)\) \{/);
  assert.match(route, /reference: invoiceReference,/);
});

test('the automatic draft at exchange or completion uses the same template', () => {
  const crm = read('server/crm.ts');
  const auto = between(crm, 'if (existingInvoices.length === 0 && (deal.fee || 0) > 0 && !kycBlocked && !poCheck?.missing) {', 'Auto-created draft Xero invoice');
  assert.match(auto, /const filled = facts \? buildInvoiceDraft\(facts\) : null;/);
  assert.match(auto, /Description: lineDescription,/);
  assert.match(auto, /!descriptionHoldsPo\(\[lineDescription\], deal\.poNumber\)/);
  assert.match(auto, /reference: baseReference,/);
});

test('the deal page shows the filled words to check and sends what it shows', () => {
  const deals = read('client/src/pages/deals.tsx');
  const card = between(deals, 'export function XeroInvoiceSection(', 'function kycStatusLabel(');
  assert.match(card, /queryKey: \["\/api\/xero\/invoice-draft", dealId\],\s*enabled: creating,/);
  assert.match(card, /buildInvoiceDraft\(\{ \.\.\.draftData\.facts, poNumber: poNumber \|\| null, fee: amount \|\| null, currency \}\)/);
  assert.match(card, /data-testid="input-xero-description"/);
  assert.match(card, /Description: description\.trim\(\) \|\| deal\.name \|\| "Professional fees",/);
  assert.match(card, /reference: reference\.trim\(\) \|\| deal\.name,/);
  // Typing over the words stops them following the deal; Fill again starts from the deal.
  assert.match(card, /if \(!descriptionTyped\) setDescription\(liveDraft\.description\);/);
  assert.match(card, /data-testid="xero-invoice-refill"/);
  assert.match(card, /data-testid="xero-invoice-template-missing"/);
});
