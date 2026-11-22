// New Deal, pressed to Create (Woody, 20 November 2026: "check the add deal
// process actually works and doesnt fail"). Two faults found that day.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

test('the billing and contracting entity dialog holds no form: it opens inside the deal form', () => {
  // React carries a submit from a portal to the form above it in the tree, so
  // saving a person in Who signs created the deal before the person was set.
  const dialog = read('client/src/components/billing-entity-create.tsx');
  assert.doesNotMatch(dialog, /<form[\s>]/);
  assert.match(dialog, /onClick=\{\(\) => void savePerson\(\)\}/);
  assert.match(dialog, /if \(e\.key === "Enter"\) \{ e\.preventDefault\(\); e\.stopPropagation\(\);/);
  // And the picker that opens it from the deal form has no form either.
  assert.doesNotMatch(read('client/src/components/signing-entity-picker.tsx'), /<form[\s>]/);
});

test('a duplicate deal is answered in words with the deal it duplicates, never the database text', () => {
  const crm = read('server/crm.ts');
  const route = crm.slice(crm.indexOf('app.post("/api/crm/deals", async'), crm.indexOf('function calculateRentAnalysis'));
  assert.match(route, /dbErr\?\.code === "23505" && \/idx_crm_deals_dedupe\//);
  assert.match(route, /code: "DUPLICATE_DEAL"/);
  assert.match(route, /There is already a live transaction called/);
  const deals = read('client/src/pages/deals.tsx');
  assert.match(deals, /body\?\.code === "DUPLICATE_DEAL"\)\) \{/);
  assert.match(deals, /refusal\.code === "LIVE_LETTING_EXISTS" \|\| refusal\.code === "DUPLICATE_DEAL"\) && refusal\.existingDealId/);
});
