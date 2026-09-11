// Actual identity-update/quarantine transactions in an isolated disposable schema.
// EVIDENCE_PLAN_DATABASE_URL='postgresql:///bgp_crm_directory_regression?host=/tmp/bgp-smoke-20260909/socket&port=55441&user=postgres' node --import tsx qa/regression/brand-publishing-postgres.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import pg from 'pg';
import { getBrandIdentity } from '../../server/brand-identity.ts';
import { prepareBrandIdentityUpdate, quarantineBrandIdentityDependents, publishableBrandImage, publishableBrandStore } from '../../server/brand-publishing.ts';
const require = createRequire(import.meta.url);
const { find, evaluate, ts } = require('./source-harness.cjs');
const supplied = process.env.EVIDENCE_PLAN_DATABASE_URL;
if (!supplied) throw new Error('Provide the disposable EVIDENCE_PLAN_DATABASE_URL');
const url = new URL(supplied);
if (url.hostname || url.pathname !== '/bgp_crm_directory_regression' || !/^\/(?:private\/)?tmp\/bgp-[a-zA-Z0-9_-]+\/socket$/.test(url.searchParams.get('host') || '')) throw new Error('Refusing non-disposable database');
const schema = `qa_brand_publishing_${process.pid}_${Date.now()}`;
const db = new pg.Pool({ connectionString: supplied, ssl: false, max: 4, options: `-c search_path=${schema}` });
const queued = [];
const implementation = find('server/brand-profile.ts', node => ts.isFunctionDeclaration(node) && node.name?.text === 'updateBrandRecord');
const { updateBrandRecord } = evaluate(`${implementation}\nexport { updateBrandRecord };`, {
  pool: db, getBrandIdentity, prepareBrandIdentityUpdate, quarantineBrandIdentityDependents,
  require: name => { assert.equal(name, './brand-enrichment'); return { enqueueBrandPreparation: async id => queued.push(id) }; },
});
let checks = 0;
function check(name, fn) { fn(); checks++; console.log(`PASS ${name}`); }
const read = async (table, where = '', args = []) => (await db.query(`SELECT * FROM ${table} ${where} ORDER BY id`, args)).rows;
const company = async id => (await db.query('SELECT * FROM crm_companies WHERE id=$1', [id])).rows[0];
const history = async () => (await db.query("SELECT key, value FROM system_settings ORDER BY key")).rows;
const state = async () => ({ companies: await read('crm_companies'), stores: await read('brand_stores'), images: await read('image_studio_images'), signals: await read('brand_signals'), contacts: await read('crm_contacts'), history: await history() });
let created = false;
try {
  await db.query(`CREATE SCHEMA ${schema}`); created = true;
  await db.query(`
    CREATE TABLE crm_companies(id text PRIMARY KEY, name text, domain text, domain_url text, website text,
      description text, industry text, backers text, brand_analysis text, ai_generated_fields jsonb, updated_at timestamptz DEFAULT now(),
      CONSTRAINT fixture_failure CHECK (NOT (id='rollback-brand' AND domain='reject.test')));
    CREATE TABLE brand_stores(id text PRIMARY KEY, brand_company_id text, name text, source_type text, notes text, updated_at timestamptz DEFAULT now());
    CREATE TABLE image_studio_images(id text PRIMARY KEY, company_id text, tags text[], local_path text);
    CREATE TABLE brand_signals(id text PRIMARY KEY, brand_company_id text, source text, ai_generated boolean, ai_relevant boolean, headline text);
    CREATE TABLE crm_contacts(id text PRIMARY KEY, company_id text, name text, notes text);
    CREATE TABLE system_settings(key text PRIMARY KEY, value jsonb);
  `);
  for (const id of ['brand', 'rollback-brand', 'unrelated-brand']) {
    const metadata = { industry: { source: 'apollo' }, backers: 'ai', backers_detail: [{ name: 'Old automated investor' }],
      brand_identity: { status: 'verified', domain: 'old.test', aliases: ['Example Trading Ltd'] } };
    await db.query('INSERT INTO crm_companies(id,name,domain,domain_url,website,description,industry,backers,brand_analysis,ai_generated_fields) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
      [id, 'Example', 'old.test', 'https://old.test', 'https://old.test', 'Human description', 'Wrong automated sector', 'Old automated investor', 'Old automated analysis', JSON.stringify(metadata)]);
    for (const [suffix, source] of [['manual', 'manual'], ['auto', 'google_places'], ['verified', 'google_places_verified']]) {
      await db.query('INSERT INTO brand_stores(id,brand_company_id,name,source_type,notes) VALUES ($1,$2,$3,$4,$5)', [`${id}-${suffix}`, id, `Store ${suffix}`, source, 'Keep store record']);
    }
    for (const [suffix, tags] of [['manual', ['photography']], ['pinned', ['brand-auto', 'brand-hero']], ['auto', ['brand-auto']], ['logo', ['brand-logo', 'logo-dev-cache']], ['website', ['website-refresh']]]) {
      await db.query('INSERT INTO image_studio_images VALUES ($1,$2,$3,$4)', [`${id}-${suffix}`, id, tags, `/synthetic/${id}-${suffix}.png`]);
    }
    for (const [suffix, source, ai] of [['human', 'bgp-manual', false], ['apollo', 'apollo', false], ['ai', 'research', true]]) {
      await db.query('INSERT INTO brand_signals VALUES ($1,$2,$3,$4,true,$5)', [`${id}-${suffix}`, id, source, ai, `Keep ${suffix} signal`]);
    }
    await db.query('INSERT INTO crm_contacts VALUES ($1,$2,$3,$4)', [`${id}-person`, id, 'Human contact', 'Keep actions and relationship']);
  }
  const before = await state();
  const result = await updateBrandRecord('brand', { domain: 'https://www.correct.test/shops', aliases: ['Example Trading Ltd'] }, 'reviewer', true);
  const corrected = await company('brand'), after = await state();
  check('actual identity action synchronises all website columns and queues preparation after commit', () => {
    assert.equal(corrected.domain, 'correct.test'); assert.equal(corrected.domain_url, 'https://correct.test'); assert.equal(corrected.website, 'https://correct.test');
    assert.equal(getBrandIdentity(corrected).status, 'verified'); assert.equal(result.identity.status, 'verified'); assert.deepEqual(queued, ['brand']);
  });
  check('explicitly automated facts and structured ownership are cleared while human description remains', () => {
    assert.equal(corrected.industry, null); assert.equal(corrected.backers, null); assert.equal(corrected.brand_analysis, null);
    assert.equal(corrected.ai_generated_fields.backers_detail, undefined); assert.equal(corrected.description, 'Human description');
    assert.equal(corrected.ai_generated_fields.brand_identity.verifiedBy, 'reviewer');
  });
  check('quarantine preserves manual stores, photos, pinned images, contacts and human signals exactly', () => {
    for (const [collection, suffix] of [['stores', 'manual'], ['images', 'manual'], ['images', 'pinned'], ['signals', 'human']]) {
      assert.deepEqual(after[collection].find(row => row.id === `brand-${suffix}`), before[collection].find(row => row.id === `brand-${suffix}`));
    }
    assert.deepEqual(after.contacts, before.contacts);
    assert.equal(publishableBrandStore(corrected, after.stores.find(row => row.id === 'brand-manual')), true);
    assert.equal(publishableBrandImage(corrected, after.images.find(row => row.id === 'brand-manual')), true);
    assert.equal(publishableBrandImage(corrected, after.images.find(row => row.id === 'brand-pinned')), true);
  });
  check('automatic stores, website photos and logo cache are retired without deleting their records', () => {
    assert.equal(after.stores.length, before.stores.length); assert.equal(after.images.length, before.images.length); assert.equal(after.signals.length, before.signals.length);
    for (const suffix of ['auto', 'verified']) { const store = after.stores.find(row => row.id === `brand-${suffix}`); assert.equal(store.source_type, 'identity_review'); assert.equal(publishableBrandStore(corrected, store), false); }
    for (const suffix of ['auto', 'logo', 'website']) { const image = after.images.find(row => row.id === `brand-${suffix}`); assert.ok(image.tags.includes('identity-review')); assert.equal(publishableBrandImage(corrected, image), false); }
    for (const suffix of ['apollo', 'ai']) assert.equal(after.signals.find(row => row.id === `brand-${suffix}`).ai_relevant, false);
  });
  check('only the chosen company is changed and its prior identity and dependent IDs are archived', () => {
    for (const collection of ['companies', 'stores', 'images', 'signals']) assert.deepEqual(after[collection].filter(row => row.id.startsWith('unrelated-brand')), before[collection].filter(row => row.id.startsWith('unrelated-brand')));
    assert.equal(after.history.length, 1); assert.equal(after.history[0].value.company.domain, 'old.test');
    assert.equal(after.history[0].value.actor, 'reviewer'); assert.equal(after.history[0].value.images.length, 3);
  });
  const beforeFailure = await state();
  await assert.rejects(() => updateBrandRecord('rollback-brand', { domain: 'reject.test' }, 'reviewer', true), /fixture_failure/);
  check('company update failure rolls back all quarantine changes and history atomically', () => assert.equal(queued.length, 1));
  const afterFailure = await state();
  check('failed identity transaction leaves every stored row byte-for-byte equivalent', () => assert.deepEqual(afterFailure, beforeFailure));
  await updateBrandRecord('brand', { domain: 'correct.test' }, 'second-reviewer', true);
  check('same-domain reconfirmation does not quarantine again or lose the review flag', () => assert.equal(queued.length, 1));
  check('reconfirmation retains one audit event', () => assert.equal((after.history).length, 1));
  assert.equal((await history()).length, 1);
  assert.equal((await company('brand')).ai_generated_fields.brand_identity.previousFactsNeedReview, true);
  console.log(`PASS ${checks} PostgreSQL brand identity checks`);
} finally {
  if (created) await db.query(`DROP SCHEMA ${schema} CASCADE`);
  await db.end();
}
