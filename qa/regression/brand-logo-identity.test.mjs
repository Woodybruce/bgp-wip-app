import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { getBrandIdentity, normalizeBrandDomain } from '../../server/brand-identity.ts';
import { publishableBrandImage, brandImageIdentityTag } from '../../server/brand-publishing.ts';
const require = createRequire(import.meta.url);
const { find, route, evaluate, ts } = require('./source-harness.cjs');
const fn = name => find('server/image-studio.ts', node => ts.isFunctionDeclaration(node) && node.name?.text === name);
const company = (verified = true) => ({ id: 'cook', name: 'COOK', domain: 'cookfood.net', ai_generated_fields: { brand_identity: { status: verified ? 'verified' : 'review', domain: 'cookfood.net' } } });
const helpers = evaluate(fn('selectBrandLogoCompany') + '\n' + fn('isPublishableBrandLogo'), { normalizeBrandDomain, publishableBrandImage });

test('logo lookup requires one exact company and coherent supplied domain; no first-word or prefix fallback', () => {
  const food = company(), fastFood = { id: 'fast', name: 'Mr COOK Fast Food', domain: 'mrcook.example' };
  assert.equal(helpers.selectBrandLogoCompany([fastFood], 'COOK', null), null);
  assert.equal(helpers.selectBrandLogoCompany([food], 'COOK Group', null), null);
  assert.equal(helpers.selectBrandLogoCompany([food], 'COOK', 'cook.com'), null);
  assert.equal(helpers.selectBrandLogoCompany([food, { ...food, id: 'duplicate' }], 'COOK', null), null);
  assert.equal(helpers.selectBrandLogoCompany([food, fastFood], 'COOK', 'cookfood.net').id, 'cook');
});

test('wrong automatic logo and unrelated storefront cannot masquerade as a brand logo; manual logo remains usable', () => {
  const food = company();
  assert.equal(helpers.isPublishableBrandLogo(food, { company_id: 'cook', brand_name: 'COOK', file_name: 'COOK Logo', tags: ['logo-dev-cache'] }), false);
  assert.equal(helpers.isPublishableBrandLogo(food, { company_id: 'cook', file_name: 'Storefront photo', tags: ['brand-auto', brandImageIdentityTag(food)] }), false);
  assert.equal(helpers.isPublishableBrandLogo(food, { company_id: 'fast', file_name: 'COOK Logo', tags: ['brand-logo'] }), false);
  assert.equal(helpers.isPublishableBrandLogo(company(false), { company_id: 'cook', file_name: 'COOK Logo', tags: ['brand-logo'] }), true);
  assert.equal(helpers.isPublishableBrandLogo(food, { company_id: 'cook', file_name: 'COOK Logo', tags: ['brand-logo', 'logo-dev-cache', brandImageIdentityTag(food)] }), true);
});

test('client own-company disambiguation and domain-less manual logos remain available', () => {
  const landlord={id:'landlord',name:'Landsec'}, agent={id:'agent',name:'Landsec'};
  assert.equal(helpers.selectBrandLogoCompany([landlord,agent],'Landsec','landsec.com','landlord').id,'landlord');
  assert.equal(helpers.selectBrandLogoCompany([landlord],'Landsec','landsec.com').id,'landlord');
  assert.equal(helpers.isPublishableBrandLogo(landlord,{company_id:'landlord',tags:['brand-logo']}),true);
  assert.equal(getBrandIdentity(landlord).status,'review','a hint cannot enable automatic fetching');
});

test('unverified brand logo read neither publishes the old wrong cache nor queues an external lookup', async () => {
  let handler, queued = 0, reads = 0;
  const row = company(false);
  evaluate(route('server/image-studio.ts', 'get', '/api/brand-logo/:name'), {
    ...helpers, getBrandIdentity, normalizeBrandDomain, process: { env: {} },
    app: { get: (_url, _auth, fn) => { handler = fn; } }, requireAuth: () => {},
    require: name => name === './company-scope' ? { resolveCompanyScope: async () => null, isClientVisibleBrand: async () => true }
      : { prepareBrandStage: async () => { queued++; } },
    pool: { query: async sql => ({ rows: sql.includes('FROM crm_companies') ? [row] : [{ company_id: 'cook', file_name: 'COOK Logo', tags: ['logo-dev-cache'], local_path: '/old-logo' }] }) },
    readPersistedImage: async () => { reads++; return Buffer.from('bad logo'); },
  });
  const response = { code: 200, body: null, setHeader() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; }, end() { throw new Error('Wrong cache must not be served'); } };
  await handler({ params: { name: 'COOK' }, query: {} }, response);
  assert.equal(response.code, 404); assert.equal(queued, 0); assert.equal(reads, 0);
});

test('verified logo cache records exact company and fingerprint, and never guesses a domain', async () => {
  let stored, requested; const row = company();
  const { prepareBrandLogo } = evaluate(fn('prepareBrandLogo'), {
    ...helpers, getBrandIdentity, brandImageIdentityTag, process: { env: { LOGO_DEV_TOKEN: 'synthetic' } }, AbortSignal,
    pool: { query: async sql => ({ rows: sql.includes('FROM crm_companies') ? [row] : [] }) }, readPersistedImage: async () => null,
    fetch: async url => { requested = url; return new Response(new Uint8Array(200), { headers: { 'content-type': 'image/png' } }); },
    storeImageFromBuffer: async args => { stored = args; return { id: 'new-logo' }; },
  });
  const result = await prepareBrandLogo('cook'); assert.equal(result.status, 'ready');
  assert.match(requested, /^https:\/\/img\.logo\.dev\/cookfood\.net\?/);
  assert.equal(stored.companyId, 'cook'); assert.ok(stored.tags.includes(brandImageIdentityTag(row)));
  assert.ok(stored.tags.includes('logo-dev-cache'));
});

test('identity changed while storing a downloaded logo marks it for review', async () => {
  let companyReads = 0; const writes = [], row = company();
  const { prepareBrandLogo } = evaluate(fn('prepareBrandLogo'), {
    ...helpers, getBrandIdentity, brandImageIdentityTag, process: { env: { LOGO_DEV_TOKEN: 'synthetic' } }, AbortSignal,
    pool: { query: async (sql, values) => {
      if (sql.includes('FROM crm_companies')) { companyReads++; return { rows: [companyReads > 2 ? { ...row, domain: 'changed.example' } : row] }; }
      if (sql.startsWith('UPDATE')) writes.push({ sql, values }); return { rows: [] };
    } }, readPersistedImage: async () => null,
    fetch: async () => new Response(new Uint8Array(200), { headers: { 'content-type': 'image/png' } }),
    storeImageFromBuffer: async () => ({ id: 'new-logo' }),
  });
  assert.equal((await prepareBrandLogo('cook')).status, 'needs_review');
  assert.ok(writes[0].sql.includes('identity-review')); assert.deepEqual(Array.from(writes[0].values), ['new-logo']);
});
