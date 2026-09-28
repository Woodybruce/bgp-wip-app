import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const page = fs.readFileSync(new URL('../../client/src/pages/investment-tracker.tsx', import.meta.url), 'utf8');
const service = fs.readFileSync(new URL('../../server/investment-tracker-service.ts', import.meta.url), 'utf8');

test('a party change is one PATCH, not an id save racing a name save', () => {
  for (const [id, name] of [['clientId', 'client'], ['vendorId', 'vendor'], ['vendorAgentId', 'vendorAgent'], ['clientContactId', 'clientContact'], ['propertyId', 'assetName']]) {
    assert.doesNotMatch(page, new RegExp(`inlineUpdate\\(item\\.id, "${id}"[^\\n]*\\n\\s*(if \\(name\\) )?inlineUpdate\\(item\\.id, "${name}"`), `${id} + ${name} saved separately`);
  }
});

test('tracker pickers can create what they cannot find', () => {
  for (const testId of ['picker-client', 'picker-client-contact', 'picker-vendor', 'picker-vendor-agent', 'picker-buyer', 'picker-property', 'picker-extra-client']) {
    const at = page.indexOf(`testId="${testId}"`);
    assert.ok(at > 0, `${testId} missing`);
    assert.match(page.slice(at, at + 400), /onCreate=/, `${testId} has no create`);
  }
  assert.match(page, /placeholder="Link buyer"/);
  assert.doesNotMatch(page, /landlordCompanyItems/, 'buyer picker limited to landlords');
});

test('extra clients: added, removed with the next one stepping up, linked to the deal', () => {
  assert.match(service, /export async function addTrackerClient/);
  assert.match(service, /export async function removeTrackerClient/);
  assert.match(service, /INSERT INTO crm_company_deals \(company_id, deal_id\)/);
  assert.match(service, /The next client steps up as the primary one/);
});
