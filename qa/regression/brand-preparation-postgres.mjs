// Isolated fixture only; never loads app .env or provider credentials.
import assert from 'node:assert/strict';
import pg from 'pg';
import { createRequire } from 'node:module';
import { BRAND_PREPARATION_STAGES, runPreparationStage, readPreparationStates, preparationKey } from '../../server/brand-preparation-jobs.ts';
const require = createRequire(import.meta.url);
const { find, evaluate, ts } = require('./source-harness.cjs');
const supplied = process.env.BRAND_PREPARATION_DATABASE_URL;
const url = new URL(supplied || 'file:///');
if (url.hostname || url.pathname !== '/bgp_crm_directory_regression' || !/^\/(?:private\/)?tmp\/bgp-[a-zA-Z0-9_-]+\/socket$/.test(url.searchParams.get('host') || '')) throw new Error('Disposable local regression database required');
const schema = `qa_brand_preparation_${process.pid}_${Date.now()}`;
const db = new pg.Pool({ connectionString: supplied, ssl: false, max: 15, options: `-c search_path=${schema}` });
let checks = 0;
let date = new Date('2026-09-10T10:00:00Z');
const opts = (extra = {}) => ({ dailyLimit: 20, now: () => date, ...extra });
const run = (id, work, extra = {}, fingerprint = 'verified-domain-1') => runPreparationStage(db, id, 'profile', fingerprint, work, opts(extra));
const value = async key => (await db.query('SELECT value FROM system_settings WHERE key=$1', [key])).rows[0]?.value;
async function check(name, fn) { await db.query('TRUNCATE system_settings'); date = new Date('2026-09-10T10:00:00Z'); await fn(); checks++; console.log(`PASS ${name}`); }
try {
  await db.query(`CREATE SCHEMA ${schema}`);
  await db.query('CREATE TABLE system_settings(key text PRIMARY KEY,value jsonb,updated_at timestamptz DEFAULT now())');
  await check('simultaneous workers make one provider call for a brand section', async () => {
    let release; const gate = new Promise(resolve => { release = resolve; }); let started;
    const began = new Promise(resolve => { started = resolve; }); let calls = 0;
    const first = run('one', async () => { calls++; started(); await gate; return { status: 'ready' }; });
    await began;
    const other = await Promise.all(Array.from({ length: 10 }, () => run('one', async () => { calls++; return { status: 'ready' }; })));
    assert.ok(other.every(result => !result.ran && result.reason === 'already_running'));
    release(); await first; assert.equal(calls, 1);
    const state = await value(preparationKey('one', 'profile'));
    assert.equal(state.status, 'ready'); assert.equal(state.claim, undefined); assert.ok(state.lastAttemptAt); assert.ok(state.lastSuccessAt);
  });
  await check('daily reservations are atomic across brands and force cannot bypass the limit', async () => {
    let calls = 0;
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => run(`brand-${i}`, async () => { calls++; return { status: 'ready' }; }, { dailyLimit: 2, force: true })));
    assert.equal(calls, 2); assert.equal(results.filter(row => row.reason === 'daily_limit').length, 6);
    assert.equal((await value('brand-preparation-budget:2026-09-10:profile')).used, 2);
  });
  await check('no-match persists a seven-day cooldown rather than retrying at every open or restart', async () => {
    let calls = 0; const work = async () => { calls++; return { status: 'no_match', reason: 'No verified match' }; };
    const first = await run('none', work); assert.equal(first.state.lastSuccessAt, undefined);
    date = new Date('2026-09-11T10:00:00Z');
    const restarted = new pg.Pool({ connectionString: supplied, ssl: false, options: `-c search_path=${schema}` });
    try { assert.equal((await runPreparationStage(restarted, 'none', 'profile', 'verified-domain-1', work, opts())).reason, 'cooldown'); }
    finally { await restarted.end(); }
    assert.equal(calls, 1); date = new Date('2026-09-17T10:00:01Z'); assert.equal((await run('none', work)).ran, true); assert.equal(calls, 2);
  });
  await check('errors retry with increasing backoff and success clears the error', async () => {
    const bad = async () => { throw new Error('Temporary provider failure'); };
    const first = await run('retry', bad); assert.equal(first.state.status, 'error'); assert.equal(first.state.nextAttemptAt, '2026-09-10T11:00:00.000Z');
    assert.equal((await run('retry', bad)).reason, 'cooldown'); date = new Date('2026-09-10T11:01:00Z');
    const second = await run('retry', bad); assert.equal(second.state.failures, 2); assert.equal(second.state.nextAttemptAt, '2026-09-10T13:01:00.000Z');
    date = new Date('2026-09-10T13:02:00Z'); const success = await run('retry', async () => ({ status: 'ready' }));
    assert.equal(success.state.failures, 0); assert.equal(success.state.lastError, null); assert.ok(success.state.lastSuccessAt);
  });
  await check('identity review and unavailable services do not consume a provider reservation', async () => {
    await run('review', async () => ({ status: 'needs_review', reason: 'Confirm website' }), { charge: false });
    const unavailable = await run('missing-key', async () => ({ status: 'unavailable' }), { charge: false });
    assert.equal(unavailable.state.lastSuccessAt, undefined); assert.equal(await value('brand-preparation-budget:2026-09-10:profile'), undefined);
  });
  await check('a crashed claim waits for its lease then becomes retryable', async () => {
    await db.query('INSERT INTO system_settings(key,value) VALUES ($1,$2::jsonb)', [preparationKey('crash', 'profile'), JSON.stringify({ stage: 'profile', fingerprint: 'verified-domain-1', status: 'running', claim: 'dead-worker', leaseUntil: '2026-09-10T10:15:00Z' })]);
    let calls = 0; const work = async () => { calls++; return { status: 'ready' }; };
    assert.equal((await run('crash', work, { force: true })).reason, 'leased'); assert.equal(calls, 0);
    date = new Date('2026-09-10T10:16:00Z'); assert.equal((await run('crash', work)).ran, true); assert.equal(calls, 1);
  });
  await check('changing confirmed identity discards old cooldown and old success metadata', async () => {
    await run('changed', async () => ({ status: 'ready' }));
    const result = await run('changed', async () => ({ status: 'no_match' }), {}, 'verified-domain-2');
    assert.equal(result.ran, true); assert.equal(result.state.lastSuccessAt, undefined); assert.equal(result.state.fingerprint, 'verified-domain-2');
    const states = await readPreparationStates(db, 'changed', 'verified-domain-3'); assert.ok(states.every(row => row.status === 'pending'));
  });
  await check('unprepared sections remain pending rather than declaring the profile ready', async () => {
    await run('partial', async () => ({ status: 'ready' }));
    const states = await readPreparationStates(db, 'partial', 'verified-domain-1');
    assert.equal(states.find(row => row.stage === 'profile').status, 'ready'); assert.equal(states.find(row => row.stage === 'contacts').status, 'pending');
    assert.equal(states.every(row => row.status === 'ready'), false);
  });
  await check('selection prioritises requested, active requirements/deals and visible brands while skipping prepared rows', async () => {
    await db.query(`CREATE TABLE crm_companies(id text PRIMARY KEY,company_type text,merged_into_id text,ai_disabled boolean,crm_extra_brand_ids text[]);
      CREATE TABLE crm_requirements_leasing(company_id text,status text);
      CREATE TABLE crm_deals(tenant_id text,status text);`);
    await db.query(`INSERT INTO crm_companies(id,company_type) VALUES
      ('requested','Tenant - Retail'),('requirements','Tenant - Retail'),('deal','Tenant - Retail'),
      ('visible','Tenant - Restaurant'),('cold','Tenant - Retail'),('fresh','Tenant - Retail');
      INSERT INTO crm_requirements_leasing VALUES ('requirements','Active'),('fresh','Active');
      INSERT INTO crm_deals VALUES ('deal','Negotiating');`);
    await db.query("INSERT INTO system_settings(key,value) VALUES ('brand-preparation-request:requested','{}')");
    for (const stage of BRAND_PREPARATION_STAGES) await db.query('INSERT INTO system_settings(key,value) VALUES ($1,$2::jsonb)',
      [preparationKey('fresh', stage), JSON.stringify({ stage, nextAttemptAt: '2099-01-01T00:00:00Z', status: 'ready' })]);
    const code = find('server/brand-enrichment.ts', node => ts.isFunctionDeclaration(node) && node.name?.text === 'selectPreparationCompanies') + '\nexports.selectPreparationCompanies=selectPreparationCompanies;';
    const { selectPreparationCompanies } = evaluate(code, { pool: db, CLIENT_CRM_CATEGORIES: ['Tenant - Restaurant'] });
    assert.deepEqual(Array.from(await selectPreparationCompanies(20)), ['requested', 'requirements', 'deal', 'visible', 'cold']);
  });
  console.log(`PASS ${checks} PostgreSQL preparation checks`);
} finally { try { await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); } finally { await db.end(); } }
