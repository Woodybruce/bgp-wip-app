import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { getBrandIdentity, publicBrandProviderPayload, assessBrandProviderMatch, stampBrandProviderPayload } from '../../server/brand-identity.ts';
const require = createRequire(import.meta.url);
const { find, evaluate, ts } = require('./source-harness.cjs');
const implementation = find('server/expansion-intel.ts', node => ts.isFunctionDeclaration(node) && node.name?.text === 'normaliseBrandFacts');
const brand = { id: 'brand', name: 'Example', domain: 'example.test', domain_url: 'https://example.test', ai_generated_fields: { brand_identity: { status: 'verified', domain: 'example.test' } } };

function run({ company = brand, current = company, provider = null, signals = [], news = [] } = {}) {
  const calls = [], prompts = [];
  const query = async (sql, args) => {
    calls.push({ sql, args });
    if (sql.includes('FROM crm_companies')) return { rows: [sql.includes('FOR UPDATE') ? current : company] };
    if (sql.includes('FROM brand_apollo_data')) return { rows: provider ? [{ payload: provider }] : [] };
    if (sql.includes('FROM brand_signals')) return { rows: signals };
    if (sql.includes('FROM news_articles')) return { rows: news };
    return { rows: [] };
  };
  const module = evaluate(implementation, { getBrandIdentity, publicBrandProviderPayload, pool: { query, connect: async () => ({ query, release() {} }) },
    MODEL_EXTRACT: 'fixture', MODEL_FALLBACK: 'fallback', FACT_KINDS: ['hiring'], safeParseJSON: JSON.parse,
    anthropic: { messages: { create: async options => { prompts.push(options.messages[0].content); return { content: [{ type: 'text', text: JSON.stringify([{ kind: 'hiring', headline: 'Reviewed hiring fact', dedupe_key: 'hiring-test' }]) }] }; } } },
  });
  return { calls, prompts, execute: () => module.normaliseBrandFacts('brand') };
}

test('unverified identity blocks extraction before any model or provider access', async () => {
  const fixture = run({ company: { ...brand, ai_generated_fields: {} } });
  assert.equal((await fixture.execute()).facts, 0);
  assert.equal(fixture.calls.length, 1);
  assert.equal(fixture.prompts.length, 0);
});

test('legacy Apollo signals cannot become fresh facts through normalisation', async () => {
  const fixture = run({ provider: { name: 'Example', website: 'https://other.test' }, signals: [{ source: 'apollo', signal_type: 'hiring', headline: 'WRONG EMPLOYER SIGNAL' }] });
  assert.equal((await fixture.execute()).facts, 0);
  assert.equal(fixture.prompts.length, 0);
  assert.equal(fixture.calls.some(call => /DELETE|INSERT/.test(call.sql)), false);
});

test('matched Apollo input can be extracted while mismatched Apollo text is absent from mixed input', async () => {
  const payload = { name: 'Example', website: 'https://example.test' };
  const provider = stampBrandProviderPayload(payload, assessBrandProviderMatch(brand, payload));
  const trusted = run({ provider, signals: [{ source: 'apollo', signal_type: 'hiring', headline: 'Verified source hiring' }] });
  assert.equal((await trusted.execute()).facts, 1);
  assert.match(trusted.prompts[0], /Verified source hiring/);
  const mixed = run({ signals: [{ source: 'apollo', signal_type: 'hiring', headline: 'WRONG EMPLOYER SIGNAL' }], news: [{ title: 'Official store opening', url: 'https://example.test/news' }] });
  assert.equal((await mixed.execute()).facts, 1);
  assert.doesNotMatch(mixed.prompts[0], /WRONG EMPLOYER SIGNAL/);
  assert.match(mixed.calls.find(call => call.sql.includes('DELETE FROM')).sql, /ai_relevant IS DISTINCT FROM FALSE/, 'quarantined evidence is not deleted during normalisation');
});

test('identity changed during extraction cannot replace facts from the new identity', async () => {
  const fixture = run({ current: { ...brand, domain: 'replacement.test' }, news: [{ title: 'Official store opening', url: 'https://example.test/news' }] });
  const result = await fixture.execute();
  assert.equal(result.facts, 0);
  assert.match(result.error, /identity changed/);
  assert.equal(fixture.calls.some(call => /DELETE|INSERT/.test(call.sql)), false);
  assert.equal(fixture.calls.at(-1).sql, 'ROLLBACK');
  assert.ok(fixture.calls.some(call => /FROM crm_companies.*FOR UPDATE/.test(call.sql)));
});
