import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { getBrandIdentity } from '../../server/brand-identity.ts';
import { readBrandFactReview, prepareBrandFactReview } from '../../server/brand-fact-review.ts';
const require = createRequire(import.meta.url);
const { find, evaluate, ts } = require('./source-harness.cjs');
const fixture = () => ({ id: 'brand', name: 'COOK', domain: 'cookfood.net', domain_url: 'https://cookfood.net',
  description: 'Wrong kitchenware description', industry: 'Construction', head_office_address: { city: 'London' }, linkedin_url: 'https://www.linkedin.com/company/wrong-business/',
  backers: 'Human-maintained owners', companies_house_number: '02884870', kyc_status: 'in_review',
  ai_generated_fields: { description: 'old-ai-marker', store_count: 'keep-marker', brand_identity: { status: 'verified', domain: 'cookfood.net', previousFactsNeedReview: true } } });
const input = company => ({ token: readBrandFactReview(company).token, confirmed: true, description: 'British frozen ready-meal retailer', industry: 'Food retail',
  head_office_address: { street: 'Reviewed address', city: 'Sittingbourne', country: 'United Kingdom' }, linkedin_url: '' });

test('explicit fact review corrects only reviewed fields and retains legal records, staff facts and unrelated provenance', () => {
  const company = fixture(), original = structuredClone(company);
  const { fields, review } = prepareBrandFactReview(company, input(company), 'reviewer', new Date('2026-09-17T18:00:00Z'));
  assert.deepEqual(company, original);
  const after = { ...company, ...fields };
  assert.equal(after.description, 'British frozen ready-meal retailer'); assert.equal(after.industry, 'Food retail');
  assert.equal(after.linkedin_url, null); assert.equal(after.head_office_address.city, 'Sittingbourne');
  assert.equal(after.ai_generated_fields.brand_identity.previousFactsNeedReview, false);
  assert.equal(after.ai_generated_fields.description, undefined); assert.equal(after.ai_generated_fields.store_count, 'keep-marker');
  assert.equal(after.backers, original.backers); assert.equal(after.companies_house_number, original.companies_house_number); assert.equal(after.kyc_status, original.kyc_status);
  assert.equal(review.previous.description, original.description); assert.equal(review.actor, 'reviewer');
  assert.equal(getBrandIdentity(after).fingerprint, getBrandIdentity(original).fingerprint);
});

test('review requires an explicit confirmation, signed-in actor, matching current identity and fresh facts', () => {
  const company = fixture(), review = input(company);
  assert.throws(() => prepareBrandFactReview(company, { ...review, confirmed: false }, 'reviewer'), /Confirm/);
  assert.throws(() => prepareBrandFactReview(company, review, null), /Sign in/);
  assert.throws(() => prepareBrandFactReview({ ...company, industry: 'Concurrent human correction' }, review, 'reviewer'), /changed/);
  assert.throws(() => prepareBrandFactReview({ ...company, domain: 'changed.example' }, review, 'reviewer'), /Confirm the official/);
  assert.throws(() => prepareBrandFactReview({ ...company, name: 'Renamed brand' }, review, 'reviewer'), /changed/);
  const finished = { ...company, ...prepareBrandFactReview(company, review, 'reviewer').fields };
  assert.throws(() => prepareBrandFactReview(finished, review, 'reviewer'), /changed/);
});

test('unknown optional facts can be cleared; missing core facts and invalid company links cannot be approved', () => {
  const company = fixture(), review = input(company);
  const cleared = prepareBrandFactReview(company, { ...review, head_office_address: null }, 'reviewer');
  assert.equal(cleared.fields.head_office_address, null);
  for (const patch of [{ description: '' }, { industry: '' }, { description: {} }, { head_office_address: [] }, { linkedin_url: 'javascript:alert(1)' }, { linkedin_url: 'https://linkedin.com.evil.example/company/test' }, { linkedin_url: 'https://linkedin.com/in/person' }]) {
    assert.throws(() => prepareBrandFactReview(company, { ...review, ...patch }, 'reviewer'));
  }
  const valid = prepareBrandFactReview(company, { ...review, linkedin_url: 'https://www.linkedin.com/company/cook/' }, 'reviewer');
  assert.equal(valid.fields.linkedin_url, 'https://www.linkedin.com/company/cook/');
});

test('review token tolerates JSON key ordering and unrelated concurrent edits without overwriting them', () => {
  const company = fixture(); company.head_office_address = { city: 'London', country: 'UK' };
  const changed = { ...company, backers: 'New human owner', head_office_address: { country: 'UK', city: 'London' } };
  assert.equal(readBrandFactReview(changed).token, readBrandFactReview(company).token);
  const result = prepareBrandFactReview(changed, input(company), 'reviewer');
  assert.equal(Object.hasOwn(result.fields, 'backers'), false);
});

test('actual fact review update transacts audit, brief invalidation and fields; mixed or stale saves roll back', async () => {
  const code = find('server/brand-profile.ts', node => ts.isFunctionDeclaration(node) && node.name?.text === 'updateBrandRecord');
  for (const mode of ['success', 'stale', 'mixed', 'failed-write']) {
    const company = fixture(); const queries = []; let released = false, queued = 0;
    const { updateBrandRecord } = evaluate(code + '\nexports.updateBrandRecord=updateBrandRecord;', {
      getBrandIdentity, prepareBrandFactReview, randomUUID,
      pool: { connect: async () => ({ query: async (sql, values) => {
        queries.push({ sql, values });
        if (sql.startsWith('SELECT')) return { rows: [company] };
        if (mode === 'failed-write' && sql.startsWith('UPDATE')) throw new Error('write rejected');
        return { rowCount: 1 };
      }, release() { released = true; } }) },
      require: name => { assert.equal(name, './brand-enrichment'); return { enqueueBrandPreparation: async () => { queued++; } }; },
    });
    const body = { factReview: { ...input(company), ...(mode === 'stale' ? { token: 'stale' } : {}) }, ...(mode === 'mixed' ? { backers: 'Must not write' } : {}) };
    const run = updateBrandRecord('brand', body, 'reviewer');
    if (mode === 'success') await run; else await assert.rejects(run);
    assert.equal(queries[0].sql, 'BEGIN'); assert.equal(queries.at(-1).sql, mode === 'success' ? 'COMMIT' : 'ROLLBACK');
    assert.equal(queued, mode === 'success' ? 1 : 0); assert.equal(released, true);
    if (mode === 'success') {
      assert.ok(queries.some(q => q.sql.startsWith('INSERT') && q.values[0].startsWith('brand-fact-review:brand:')));
      const deleted = queries.find(q => q.sql.startsWith('DELETE')).values[0];
      assert.equal(deleted.length, 5); assert.ok(deleted.includes('brand-prepared-take:brand:brand'));
      const write = queries.find(q => q.sql.startsWith('UPDATE'));
      assert.equal(write.sql.includes('companies_house_number'), false); assert.equal(write.sql.includes('backers ='), false);
      assert.ok(write.values.some(value => typeof value === 'string' && value.includes('"city":"Sittingbourne"')));
    }
  }
});

test('fact review requires staff while the existing client edit path stays available', async () => {
  const code = find('server/brand-profile.ts', node => ts.isCallExpression(node) && node.expression.getText() === 'router.patch' && ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === '/api/brand/:companyId');
  for (const [client, body, expected] of [[true, { factReview: {} }, 403], [false, { factReview: {} }, 200], [true, { concept_pitch: 'Permitted existing edit' }, 200]]) {
    let handler, updates = 0;
    evaluate(code, { router: { patch(_path, _auth, fn) { handler = fn; } }, requireAuth() {}, canUseBrand: async () => true,
      updateBrandRecord: async (_id, submitted, actor) => { updates++; assert.deepEqual(submitted, body); assert.equal(actor, 'reviewer'); return { ok: true }; },
      require: name => { assert.equal(name, './company-scope'); return { resolveCompanyScope: async () => client ? 'client-company' : null }; },
    });
    const res = { code: 200, status(code) { this.code = code; return this; }, json(payload) { this.body = payload; return this; } };
    await handler({ params: { companyId: 'brand' }, body, session: { userId: 'reviewer' } }, res);
    assert.equal(res.code, expected); assert.equal(updates, expected === 200 ? 1 : 0);
  }
});
