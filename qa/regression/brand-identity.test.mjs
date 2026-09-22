import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import * as identity from '../../server/brand-identity.ts';
const require = createRequire(import.meta.url);
const { find, evaluate, ts } = require('./source-harness.cjs');

const company = (overrides = {}) => ({ id: 'brand-one', name: 'COOK', domain: 'cookfood.net', domain_url: 'https://www.cookfood.net/',
  uk_entity_name: 'COOK Trading Ltd', trading_entities: [],
  ai_generated_fields: { brand_identity: { status: 'verified', domain: 'cookfood.net', country: 'GB', aliases: [] } }, ...overrides });
const candidate = (overrides = {}) => ({ id: 'provider-one', name: 'COOK Trading Limited', primary_domain: 'cookfood.net', country: 'United Kingdom', ...overrides });
const trusted = (co = company(), row = candidate()) => identity.stampBrandProviderPayload(row, identity.assessBrandProviderMatch(co, row));

test('domain normalisation accepts official URLs without broadening into subdomains or lookalikes', () => {
  assert.equal(identity.normalizeBrandDomain(' HTTPS://WWW.COOKFOOD.NET/about '), 'cookfood.net');
  assert.equal(identity.normalizeBrandDomain('cookfood.net.evil.test'), 'cookfood.net.evil.test');
  assert.equal(identity.normalizeBrandDomain('shops.cookfood.net'), 'shops.cookfood.net');
  for (const value of ['https://cookfood.net@evil.test', 'javascript:alert(1)', 'mailto:info@cookfood.net', 'https://cookfood.net:8080/', '', null]) {
    assert.equal(identity.normalizeBrandDomain(value), null);
  }
});

test('imported domain alone cannot verify a brand', () => {
  const co = company({ ai_generated_fields: {} });
  assert.equal(identity.getBrandIdentity(co).status, 'review');
  assert.equal(identity.assessBrandProviderMatch(co, candidate()).status, 'blocked');
});

test('editing or conflicting website fields invalidate the verified identity', () => {
  for (const overrides of [{ domain: 'cook.com' }, { website: 'https://cook.com' }, { domain: null, domain_url: null }]) {
    assert.equal(identity.getBrandIdentity(company(overrides)).status, 'review');
  }
});

test('official domain and exact legal name allow common legal suffix variants', () => {
  assert.equal(identity.assessBrandProviderMatch(company(), candidate()).status, 'matched');
  assert.equal(identity.assessBrandProviderMatch(company(), candidate({ name: 'COOK' })).status, 'matched');
});

test('explicit trading aliases bridge legitimate provider names without accepting broad name fragments', () => {
  const co = company({ trading_entities: [{ name: 'BGP Frozen Food Company Ltd' }] });
  assert.equal(identity.assessBrandProviderMatch(co, candidate({ name: 'BGP Frozen Food Company Limited' })).status, 'matched');
  for (const name of ['Mr Cook Fast Food', 'COOK Construction', 'COOK China', 'COOK Holdings']) {
    assert.equal(identity.assessBrandProviderMatch(company(), candidate({ name })).status, 'blocked');
  }
});

test('correct brand spelling never overrides a different website, subdomain or country', () => {
  for (const row of [candidate({ primary_domain: 'cook.com' }), candidate({ primary_domain: 'cn.cookfood.net' }),
    candidate({ primary_domain: 'cookfood.net.evil.test' }), candidate({ country: 'China' }), candidate({ primary_domain: null }),
    candidate({ website: 'cook.com' })]) {
    assert.equal(identity.assessBrandProviderMatch(company(), row).status, 'blocked');
  }
});

test('RocketReach results are searched for the valid identity rather than taking the first result', () => {
  const wrong = { name: 'Cook', email_domain: 'cook.com', country_code: 'CN' };
  const right = { name: 'COOK Trading Ltd', email_domain: 'cookfood.net', country_code: 'GB' };
  const result = identity.selectBrandProviderMatch(company(), [wrong, right]);
  assert.equal(result.status, 'matched');
  assert.equal(result.candidate, right);
  assert.equal(identity.selectBrandProviderMatch(company(), [right, { ...right, id: 'second' }]).status, 'blocked');
  assert.equal(identity.selectBrandProviderMatch(company(), []).status, 'no_match');
});

test('only a current matching cache is public; legacy, revoked and changed identity payloads stay hidden', () => {
  const co = company(), payload = trusted(co);
  assert.equal(identity.publicBrandProviderPayload(co, payload), payload);
  assert.equal(identity.publicBrandProviderPayload(co, candidate()), null);
  assert.equal(identity.publicBrandProviderPayload(company({ ai_generated_fields: {} }), payload), null);
  assert.equal(identity.publicBrandProviderPayload(company({ name: 'Different brand' }), payload), null);
  assert.equal(identity.publicBrandProviderPayload(company({ trading_entities: [{ name: 'New approved alias' }] }), payload), null);
  assert.equal(identity.publicBrandProviderPayload(company({ id: 'another-company' }), payload), null);
});

test('rejected cache stores only its review state and cannot leak rejected firmographics into direct payload readers', () => {
  const co = company(), wrong = candidate({ country: 'China', employees: 950 });
  const payload = identity.stampBrandProviderPayload(wrong, identity.assessBrandProviderMatch(co, wrong));
  assert.deepEqual(Object.keys(payload), ['_brandIdentity']);
  const result = identity.brandProviderCacheResult(co, payload);
  assert.equal(result.status, 'blocked');
  assert.equal(result.payload, null);
  assert.match(result.reason, /country/);
});

const declaration = (file, name) => find(file, node => ts.isFunctionDeclaration(node) && node.name?.text === name);
function providerHarness(provider, { co = company(), response = candidate(), changed = null, failWrite = false } = {}) {
  const file = `server/${provider === 'apollo' ? 'apollo' : 'rocketreach'}-company.ts`;
  const queries = [], calls = [];
  const query = async (sql, params = []) => {
    queries.push({ sql, params });
    if (sql.startsWith('SELECT * FROM crm_companies')) return { rows: [sql.includes('FOR UPDATE') && changed ? changed : co] };
    if (failWrite && sql.startsWith('INSERT INTO brand_')) throw new Error('database unavailable');
    return { rows: [] };
  };
  const client = { query, release: () => { calls.push('release'); } };
  const names = provider === 'apollo' ? ['ensureTable', 'normaliseApolloOrg', 'refreshApolloCompany']
    : ['mapRrIndustryToBgpType', 'refreshRocketReachCompany'];
  const exports = evaluate(names.map(name => declaration(file, name)).join('\n'), {
    ...identity, pool: { query, connect: async () => client },
    fetchApolloOrganization: async domain => { calls.push(domain); return response; },
    searchCompany: async query => { calls.push(query); return response; },
  });
  return { ...exports, queries, calls, refresh: exports.refreshApolloCompany || exports.refreshRocketReachCompany };
}

for (const provider of ['apollo', 'rocketreach']) {
  test(`${provider} refuses unverified identity before making a provider request`, async () => {
    const h = providerHarness(provider, { co: company({ ai_generated_fields: {} }) });
    const result = await h.refresh('brand-one');
    assert.equal(result.status, 'blocked');
    assert.equal(h.calls.length, 0);
    assert.equal(h.queries.some(q => q.sql.startsWith('UPDATE') || q.sql.startsWith('INSERT') || q.sql.startsWith('DELETE')), false);
  });

  test(`${provider} rechecks the locked brand identity before writing a completed lookup`, async () => {
    const response = provider === 'apollo' ? candidate() : [candidate()];
    const h = providerHarness(provider, { response, changed: company({ domain: 'cook.com' }) });
    const result = await h.refresh('brand-one');
    assert.equal(result.status, 'blocked');
    assert.equal(h.queries.some(q => q.sql.startsWith('INSERT') || q.sql.startsWith('UPDATE') || q.sql.startsWith('DELETE')), false);
    assert.equal(h.queries.at(-1).sql, 'ROLLBACK');
    assert.equal(h.calls.at(-1), 'release');
  });

  test(`${provider} holds a mismatched lookup without filling company facts`, async () => {
    const wrong = candidate({ primary_domain: 'cook.com', industry_str: 'Construction General', estimated_num_employees: 950 });
    const h = providerHarness(provider, { response: provider === 'apollo' ? wrong : [wrong] });
    const result = await h.refresh('brand-one');
    assert.equal(result.status, 'blocked'); assert.equal(result.payload, null);
    assert.equal(h.queries.some(q => q.sql.startsWith('UPDATE crm_companies')), false);
    const payload = JSON.parse(h.queries.find(q => q.sql.startsWith('INSERT INTO brand_')).params[1]);
    assert.deepEqual(Object.keys(payload), ['_brandIdentity']);
    if (provider === 'apollo') assert.ok(h.queries.some(q => q.sql.startsWith('DELETE FROM brand_signals')));
    assert.equal(h.queries.at(-1).sql, 'COMMIT');
  });

  test(`${provider} preserves human fields and records provenance when filling empty ones`, async () => {
    const data = candidate({ estimated_num_employees: 950, industry: 'Food retail', industry_str: 'Food retail', linkedin_url: 'https://linkedin.com/company/cook', founded_year: 1997 });
    const h = providerHarness(provider, { co: company({ employee_count: 1200, industry: 'Frozen ready meals', company_type: 'Tenant - Retail', founded_year: 1996 }), response: provider === 'apollo' ? data : [data] });
    const result = await h.refresh('brand-one');
    assert.equal(result.status, 'matched');
    for (const query of h.queries.filter(q => q.sql.startsWith('UPDATE crm_companies'))) {
      assert.doesNotMatch(query.sql, /employee_count =|industry =|company_type =|founded_year =/);
      assert.match(query.sql, /COALESCE\(ai_generated_fields/);
      assert.ok(query.params.some(p => typeof p === 'string' && p.includes(provider)));
    }
    if (provider === 'apollo') assert.equal(result.gapsFilled, 1);
    else assert.deepEqual(JSON.parse(JSON.stringify(result.auto_filled)), {});
  });

  test(`${provider} rolls back and releases its connection on a cache write failure`, async () => {
    const h = providerHarness(provider, { response: provider === 'apollo' ? candidate() : [candidate()], failWrite: true });
    await assert.rejects(h.refresh('brand-one'), /database unavailable/);
    assert.equal(h.queries.at(-1).sql, 'ROLLBACK');
    assert.equal(h.calls.at(-1), 'release');
  });
}

test('Apollo missing, invalid and zero staff estimates are unknown rather than zero employees', () => {
  const h = providerHarness('apollo');
  for (const count of [null, undefined, 0, -3, 'unknown', Infinity]) assert.equal(h.normaliseApolloOrg({ estimated_num_employees: count }).employees, null);
  assert.equal(h.normaliseApolloOrg({ estimated_num_employees: '950' }).employees, 950);
});

test('untrusted Apollo signals are excluded from expansion facts without dropping hand-entered BGP evidence', async () => {
  const rows = [{ headline: 'Hiring growth', source: 'apollo' }, { headline: 'Client requirement', source: 'bgp-deal:one' }];
  let payload = candidate();
  const { loadFacts } = evaluate(declaration('server/expansion-intel.ts', 'loadFacts') + '\nexports.loadFacts = loadFacts;', {
    ...identity, pool: { query: async sql => ({ rows: sql.includes('FROM brand_signals') ? rows : [{ payload }] }) },
  });
  assert.equal((await loadFacts('brand-one', company())).length, 1);
  payload = trusted();
  assert.equal((await loadFacts('brand-one', company())).length, 2);
  assert.equal((await loadFacts('brand-one', company({ ai_generated_fields: {} }))).length, 1);
});
