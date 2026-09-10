import test from 'node:test';
import assert from 'node:assert/strict';
import { knownBrandLegalIdentity, websiteSupportsBrandLegalIdentity, verifyBrandIdentityFromOfficialSite } from '../../server/brand-identity-verification.ts';
import { getBrandIdentity } from '../../server/brand-identity.ts';
const company = () => ({ id: 'cook', name: 'COOK', domain: 'cookfood.net', uk_entity_name: 'COOK Trading Limited', companies_house_number: '04611064',
  description: 'Human description', ai_generated_fields: {}, companies_house_data: { profile: { companyName: 'COOK TRADING LTD', companyNumber: '04611064', companyStatus: 'active' } } });
const legal = { name: 'COOK TRADING LTD', number: '04611064' };

test('automatic identity requires coherent existing domain, active CH number and exact legal-name mapping', () => {
  assert.equal(knownBrandLegalIdentity(company()).domain, 'cookfood.net');
  for (const override of [
    { website: 'cook.com' }, { uk_entity_name: 'Unrelated Limited' }, { companies_house_number: '12345678' },
    { companies_house_data: { profile: { companyName: 'COOK TRADING LTD', companyNumber: '04611064', companyStatus: 'dissolved' } } },
  ]) assert.equal(knownBrandLegalIdentity({ ...company(), ...override }), null);
});

test('registered company number and exact legal name must appear together in visible legal text', () => {
  assert.equal(websiteSupportsBrandLegalIdentity('<footer>COOK Trading Limited. Company Registration No. 04611064.</footer>', legal), true);
  assert.equal(websiteSupportsBrandLegalIdentity('<footer>COOK Trading Ltd. Company number: 4611064.</footer>', legal), true);
  assert.equal(websiteSupportsBrandLegalIdentity('Mr Cook Fast Food. Company number 04611064', legal), false);
  assert.equal(websiteSupportsBrandLegalIdentity('COOK Trading Ltd. Company number 12345678', legal), false);
  assert.equal(websiteSupportsBrandLegalIdentity('COOK Trading Ltd. Call us on 04611064', legal), false);
  assert.equal(websiteSupportsBrandLegalIdentity('<script>COOK Trading Ltd. Company number 04611064</script>', legal), false);
  assert.equal(websiteSupportsBrandLegalIdentity(`COOK Trading Ltd ${'x '.repeat(400)} Company number 04611064`, legal), false);
});

test('missing legal corroboration performs no outbound request', async () => {
  let calls = 0;
  const result = await verifyBrandIdentityFromOfficialSite({}, { ...company(), companies_house_data: null }, async () => { calls++; throw new Error('Must not fetch'); });
  assert.equal(calls, 0); assert.equal(result.status, 'needs_review');
});

function database(current) {
  const writes = [];
  const client = { query: async (sql, values) => { writes.push({ sql, values }); return { rows: sql.startsWith('SELECT * FROM crm_companies') ? [current] : [], rowCount: 1 }; }, release() {} };
  return { writes, connect: async () => client, query: client.query };
}

test('homepage plus one same-domain legal page can verify while retaining human fields and quarantining old machine results', async () => {
  const row = company(), db = database(row), calls = [];
  const result = await verifyBrandIdentityFromOfficialSite(db, row, async url => {
    calls.push(url);
    return { url, html: calls.length === 1 ? '<a href="https://wrong.example/legal">Legal</a><a href="/terms">Terms</a>' : '<footer>COOK Trading Limited. Company Registration No. 04611064.</footer>' };
  });
  assert.equal(result.status, 'ready'); assert.deepEqual(calls, ['https://cookfood.net/', 'https://cookfood.net/terms']);
  const update = db.writes.find(write => write.sql.startsWith('UPDATE crm_companies'));
  assert.ok(update); assert.equal(update.sql.includes('description='), false);
  const metadata = update.values.map(value => { try { return JSON.parse(value); } catch { return null; } }).find(value => value?.brand_identity);
  assert.equal(metadata.brand_identity.verifiedBy, 'official-website-register-match');
  assert.equal(metadata.brand_identity.source.url, 'https://cookfood.net/terms');
  assert.equal(getBrandIdentity({ ...row, ai_generated_fields: metadata }).status, 'verified');
  assert.ok(db.writes.some(write => write.sql.startsWith('INSERT INTO system_settings')));
  assert.equal(db.writes.at(-1).sql, 'COMMIT');
});

test('no proof follows at most one legal page and makes no company write', async () => {
  const db = database(company()); let calls = 0;
  const result = await verifyBrandIdentityFromOfficialSite(db, company(), async url => { calls++; return { url, html: '<a href="/terms">Terms</a><a href="/privacy">Privacy</a>COOK kitchenware' }; });
  assert.equal(calls, 2); assert.equal(result.status, 'no_match'); assert.equal(db.writes.length, 0);
});

test('concurrent identity edits block automatic verification before quarantine or update', async () => {
  const db = database({ ...company(), domain: 'changed.example' });
  await assert.rejects(() => verifyBrandIdentityFromOfficialSite(db, company(), async url => ({ url, html: 'COOK Trading Ltd. Company number 04611064' })), /changed during website verification/);
  assert.equal(db.writes.some(write => write.sql.startsWith('UPDATE')), false); assert.equal(db.writes.at(-1).sql, 'ROLLBACK');
});
