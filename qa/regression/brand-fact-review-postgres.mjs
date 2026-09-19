// Real retained-fact review transactions; only an isolated disposable schema.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { getBrandIdentity } from '../../server/brand-identity.ts';
import { readBrandFactReview, prepareBrandFactReview } from '../../server/brand-fact-review.ts';
const require = createRequire(import.meta.url);
const { find, evaluate, ts } = require('./source-harness.cjs');
const supplied = process.env.BRAND_FACT_REVIEW_DATABASE_URL;
const url = new URL(supplied || 'file:///');
if (url.hostname || url.pathname !== '/bgp_smoke' || url.searchParams.get('host') !== '/tmp/bgp-propertyqa-20260916/socket' || url.searchParams.get('port') !== '55446') throw new Error('Disposable local QA database required');
const schema = `qa_brand_fact_review_${process.pid}_${Date.now()}`;
const db = new pg.Pool({ connectionString: supplied, ssl: false, options: `-c search_path=${schema}` });
const queued = [];
const implementation = find('server/brand-profile.ts', node => ts.isFunctionDeclaration(node) && node.name?.text === 'updateBrandRecord');
const { updateBrandRecord } = evaluate(`${implementation}\nexports.updateBrandRecord=updateBrandRecord;`, {
  pool: db, getBrandIdentity, prepareBrandFactReview, randomUUID,
  require: name => { assert.equal(name, './brand-enrichment'); return { enqueueBrandPreparation: async id => queued.push(id) }; },
});
const company = async () => (await db.query("SELECT * FROM crm_companies WHERE id='brand'")).rows[0];
const state = async () => ({ company: await company(), settings: (await db.query('SELECT * FROM system_settings ORDER BY key')).rows });
const reviewedInput = row => ({ factReview: { token: readBrandFactReview(row).token, confirmed: true,
  description: 'Verified synthetic food business', industry: 'Food retail', head_office_address: { city: 'Synthetic town' }, linkedin_url: '' } });
let checks = 0;
const check = async (name, run) => { await run(); checks++; console.log(`PASS ${name}`); };
const reset = async () => {
  await db.query("DELETE FROM system_settings; DELETE FROM crm_companies");
  await db.query(`INSERT INTO crm_companies(id,name,domain,domain_url,description,industry,head_office_address,linkedin_url,backers,companies_house_number,kyc_status,ai_generated_fields)
    VALUES ('brand','Synthetic Brand','brand.example','https://brand.example','Legacy wrong description','Legacy industry','{"city":"Old city"}','https://www.linkedin.com/company/wrong/','Human owners','SYNTHETIC','in_review',$1)`,
    [JSON.stringify({ description: 'old-marker', store_count: 'untouched-marker', brand_identity: { status: 'verified', domain: 'brand.example', previousFactsNeedReview: true } })]);
  await db.query("INSERT INTO system_settings VALUES ('brand-prepared-take:brand:brand','{\"text\":\"Legacy brief\"}'),('brand-preparation:brand:brief','{\"status\":\"ready\"}'),('unrelated-setting','{\"keep\":true}')");
};
try {
  await db.query(`CREATE SCHEMA ${schema}`);
  await db.query(`CREATE TABLE crm_companies(id text PRIMARY KEY,name text,domain text,domain_url text,description text,
    industry text CHECK(industry <> 'Reject save'),head_office_address jsonb,linkedin_url text,backers text,companies_house_number text,kyc_status text,ai_generated_fields jsonb,updated_at timestamptz DEFAULT now());
    CREATE TABLE system_settings(key text PRIMARY KEY,value jsonb);`);
  await reset();
  await check('actual review saves core facts, removes AI ownership and retains legal/manual fields', async () => {
    const before = await company();
    await updateBrandRecord('brand', reviewedInput(before), 'synthetic-reviewer');
    const after = await company();
    assert.equal(after.description, 'Verified synthetic food business'); assert.equal(after.industry, 'Food retail');
    assert.deepEqual(after.head_office_address, { city: 'Synthetic town' }); assert.equal(after.linkedin_url, null);
    for (const key of ['backers', 'companies_house_number', 'kyc_status']) assert.equal(after[key], before[key]);
    assert.equal(after.ai_generated_fields.brand_identity.previousFactsNeedReview, false);
    assert.equal(after.ai_generated_fields.description, undefined); assert.equal(after.ai_generated_fields.store_count, before.ai_generated_fields.store_count);
  });
  await check('audit and brief invalidation commit together; only this brand is queued', async () => {
    const rows = (await db.query('SELECT * FROM system_settings')).rows;
    assert.equal(rows.length, 2); assert.ok(rows.some(row => row.key === 'unrelated-setting'));
    const audit = rows.find(row => row.key.startsWith('brand-fact-review:brand:'));
    assert.equal(audit.value.actor, 'synthetic-reviewer'); assert.equal(audit.value.previous.industry, 'Legacy industry'); assert.equal(audit.value.facts.industry, 'Food retail');
    assert.deepEqual(queued, ['brand']);
  });
  await check('concurrent factual correction rejects the stale form without a partial save', async () => {
    await reset(); const body = reviewedInput(await company());
    await db.query("UPDATE crm_companies SET industry='Concurrent human correction' WHERE id='brand'");
    const before = await state();
    await assert.rejects(updateBrandRecord('brand', body, 'synthetic-reviewer'), /changed/);
    assert.deepEqual(await state(), before);
  });
  await check('concurrent identity change rejects the stale form', async () => {
    await reset(); const body = reviewedInput(await company());
    await db.query("UPDATE crm_companies SET name='Changed identity' WHERE id='brand'");
    const before = await state();
    await assert.rejects(updateBrandRecord('brand', body, 'synthetic-reviewer'), /changed/);
    assert.deepEqual(await state(), before);
  });
  await check('failed field write rolls back review flag, audit and old brief deletion', async () => {
    await reset(); const body = reviewedInput(await company()); body.factReview.industry = 'Reject save'; const before = await state(), queueCount = queued.length;
    await assert.rejects(updateBrandRecord('brand', body, 'synthetic-reviewer'), /check constraint/);
    assert.deepEqual(await state(), before); assert.equal(queued.length, queueCount);
  });
  await check('unrelated concurrent staff correction survives successful fact review', async () => {
    await reset(); const body = reviewedInput(await company());
    await db.query("UPDATE crm_companies SET backers='New human owners' WHERE id='brand'");
    await updateBrandRecord('brand', body, 'synthetic-reviewer');
    assert.equal((await company()).backers, 'New human owners');
  });
  console.log(`PASS ${checks} PostgreSQL retained-fact review checks`);
} finally { try { await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); } finally { await db.end(); } }
