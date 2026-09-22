// Disposable database only. No app environment or provider modules are loaded.
// PROPERTY_ENRICHMENT_TEST_DATABASE_URL='postgresql:///bgp_smoke?host=/tmp/bgp-propertyqa-20260916/socket&port=55446&user=postgres' PGSSLMODE=disable node --import tsx qa/regression/property-resolver-enrichment-postgres.mjs
import assert from 'node:assert/strict';
import pg from 'pg';
import { runPropertyEnrichment } from '../../server/property-resolver-enrichment.ts';
const supplied = process.env.PROPERTY_ENRICHMENT_TEST_DATABASE_URL;
if (!supplied) throw new Error('Provide the disposable PROPERTY_ENRICHMENT_TEST_DATABASE_URL');
const url = new URL(supplied);
if (url.hostname !== '' || url.pathname !== '/bgp_smoke' || url.searchParams.get('host') !== '/tmp/bgp-propertyqa-20260916/socket' || url.searchParams.get('port') !== '55446') throw new Error('Refusing a non-disposable database');
const schema = `qa_property_enrichment_${process.pid}_${Date.now()}`;
const pool = new pg.Pool({ connectionString: supplied, ssl: false, max: 4, options: `-c search_path=${schema}` });
const title = { title_number: 'N12345', proprietor_name_1: 'Verified Owner Ltd', company_registration_no_1: '00123456' };
const research = () => ({ ok: true, resolvedAddress: '12 High Street', resolvedPostcode: 'SW1A 1AA', buildingName: '', lat: null, lng: null, uprns: ['100000123456'], pdErrors: [], matched: { freeholds: [title], leaseholds: [], exact: true }, fallback: { freeholds: [], leaseholds: [], usedStreetNumberMatch: false }, context: { freeholds: [], leaseholds: [] }, source: 'uprn' });
let lookups = 0, created = false, checks = 0;
const deps = { pool, lookupTitles: async () => { lookups++; return research(); }, lookupVoa: async () => ({ available: true, rows: [] }) };
const row = async id => (await pool.query('SELECT * FROM crm_properties WHERE id=$1', [id])).rows[0];
const history = async id => (await pool.query('SELECT * FROM land_registry_searches WHERE crm_property_id=$1', [id])).rows;
const pass = label => { checks++; console.log(`PASS ${label}`); };
try {
  await pool.query(`CREATE SCHEMA ${schema}`); created = true;
  await pool.query(`CREATE TABLE crm_properties(id text PRIMARY KEY,name text,address jsonb,postcode text,uprn text,latitude numeric,longitude numeric,tenure text,title_number text,title_search_date timestamptz,proprietor_name text,proprietor_type text,proprietor_address text,proprietor_company_number text,landlord_id text,freeholder_id text,long_leaseholder_id text,voa_ba_reference text,kyc_status text,updated_at timestamptz DEFAULT now(),CONSTRAINT simulate_save_failure CHECK(NOT(id='rollback' AND title_number='N12345')));
    CREATE TABLE land_registry_searches(id serial PRIMARY KEY,user_id text NOT NULL,address text NOT NULL,postcode text,freeholds_count integer,leaseholds_count integer,freeholds jsonb,leaseholds jsonb,intelligence jsonb,crm_property_id text,source text,status text,created_at timestamptz DEFAULT now());`);
  for (const id of ['exact', 'rollback', 'human', 'identity', 'busy', 'unrelated']) await pool.query('INSERT INTO crm_properties(id,name,address,postcode,uprn,kyc_status) VALUES($1,$2,$3,$4,$5,$6)', [id, '12 High Street', JSON.stringify({ street: '12 High Street', city: 'London', postcode: 'SW1A 1AA' }), 'SW1A 1AA', '100000123456', 'Manual decision']);
  const untouched = await row('unrelated');
  const success = await runPropertyEnrichment(deps, 'exact', 'researcher-a');
  assert.equal(success.status, 'ready'); assert.equal((await row('exact')).title_number, 'N12345');
  const saved = (await history('exact'))[0]; assert.equal(saved.user_id, 'researcher-a'); assert.equal(saved.crm_property_id, 'exact'); assert.equal(saved.freeholds[0].title_number, 'N12345'); assert.equal((await row('exact')).kyc_status, 'Manual decision');
  pass('real transaction saves exact property facts and actor-linked history while preserving KYC');
  const cached = await runPropertyEnrichment(deps, 'exact', 'researcher-b');
  assert.equal(cached.cached, true); assert.equal((await history('exact')).length, 1); assert.equal(lookups, 1);
  pass('repeat action reads the saved research without another provider call or history duplicate');
  const failed = await runPropertyEnrichment(deps, 'rollback', 'researcher-a');
  assert.equal(failed.ok, false); assert.equal((await history('rollback')).length, 0); assert.equal((await row('rollback')).title_number, null);
  pass('real CHECK failure rolls back property update and research insert together');
  const human = await runPropertyEnrichment({ ...deps, lookupTitles: async () => {
    await pool.query("UPDATE crm_properties SET title_number='HUMAN12',proprietor_name='Manual owner',landlord_id='manual-company' WHERE id='human'"); return research();
  } }, 'human', 'researcher-a');
  assert.equal(human.status, 'needs_review'); const humanRow = await row('human'); assert.equal(humanRow.title_number, 'HUMAN12'); assert.equal(humanRow.proprietor_name, 'Manual owner'); assert.equal(humanRow.landlord_id, 'manual-company');
  pass('human title and owner edits made during lookup survive the locked current-row recheck');
  const changed = await runPropertyEnrichment({ ...deps, lookupTitles: async () => { await pool.query("UPDATE crm_properties SET uprn='999' WHERE id='identity'"); return research(); } }, 'identity', 'researcher-a');
  assert.equal(changed.httpStatus, 409); assert.equal((await history('identity')).length, 0);
  pass('identity change during research prevents results being attached to a different building');
  let release, entered; const started = new Promise(resolve => entered = resolve); const barrier = new Promise(resolve => release = resolve);
  const first = runPropertyEnrichment({ ...deps, lookupTitles: async () => { entered(); await barrier; return research(); } }, 'busy', 'researcher-a');
  await started;
  try { const second = await runPropertyEnrichment(deps, 'busy', 'researcher-b'); assert.equal(second.status, 'running'); assert.equal(second.httpStatus, 202); }
  finally { release(); await first; }
  assert.equal((await history('busy')).length, 1);
  pass('separate database connections share the paid-lookup lock without duplicate research');
  assert.deepEqual(await row('unrelated'), untouched);
  pass('unrelated property remains byte-for-byte unchanged');
  console.log(`${checks} PostgreSQL regression checks passed`);
} finally {
  if (created) await pool.query(`DROP SCHEMA ${schema} CASCADE`);
  await pool.end();
}
