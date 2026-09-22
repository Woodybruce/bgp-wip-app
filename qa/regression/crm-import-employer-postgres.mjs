// Execute the real import handler against isolated synthetic tables, including
// competing transactions. No environment files or provider APIs are loaded.
// CRM_IMPORT_DATABASE_URL='postgresql:///bgp_crm_directory_regression?host=/tmp/bgp-smoke-20260906/socket&port=55441&user=postgres' node qa/regression/crm-import-employer-postgres.mjs
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import pg from 'pg';
const require = createRequire(import.meta.url);
const { source, evaluate } = require('./source-harness.cjs');
const supplied = process.env.CRM_IMPORT_DATABASE_URL;
if (!supplied) throw new Error('Provide the separate disposable CRM_IMPORT_DATABASE_URL');
const url = new URL(supplied);
if (url.hostname || url.pathname !== '/bgp_crm_directory_regression'
    || !/^\/(?:private\/)?tmp\/bgp-[a-zA-Z0-9_-]+\/socket$/.test(url.searchParams.get('host') || '')) {
  throw new Error('Refusing a database outside the disposable CRM Unix socket');
}
const schemaName = `crm_import_${randomUUID().replaceAll('-', '')}`;
const admin = new pg.Client({ connectionString: supplied, ssl: false });
const pool = new pg.Pool({ connectionString: supplied, ssl: false, max: 4, application_name: schemaName,
  options: `-c search_path=${schemaName} -c lock_timeout=8000 -c statement_timeout=12000`,
});
let checks = 0;
const check = (name, fn) => { fn(); checks++; console.log(`PASS ${name}`); };
const handlers = new Map();
evaluate(source('server/rocketreach-contacts.ts'), {
  URL, process: { env: {} },
  fetch() { assert.fail('No provider calls are allowed in this fixture'); },
  require(name) {
    if (name === 'express') return { Router: () => ({ post: (path, ...chain) => handlers.set(path, chain.at(-1)) }) };
    if (name === './auth') return { requireAuth() {} };
    if (name === './db') return { pool };
    throw new Error(`Unexpected import ${name}`);
  },
});
const person = changes => ({ name: 'Casey Agent', email: 'casey@agency.test', linkedin_url: 'https://linkedin.com/in/casey-agent',
  current_employer: 'Example Agency', role: 'Partner', source: 'direct', previous_employers: [], ...changes });
async function invoke(people, companyId = 'brand') {
  let status = 200;
  let data;
  await handlers.get('/api/brand/:companyId/rocketreach/import')({ params: { companyId }, body: { people, enrich: false } },
    { status(code) { status = code; return this; }, json(value) { data = value; } });
  assert.equal(status, 200, JSON.stringify(data));
  return data;
}
await admin.connect();
try {
  await admin.query(`CREATE SCHEMA ${schemaName}`);
  await pool.query(`
    CREATE TABLE crm_companies (
      id varchar PRIMARY KEY, name text, domain text, domain_url text,
      company_type text, brand_group_id varchar, parent_company_id varchar, merged_into_id varchar
    );
    CREATE TABLE crm_contacts (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text, name text, role text, email text, phone text,
      phone_mobile text, linkedin_url text, avatar_url text, notes text, company_id varchar, company_name text,
      enrichment_source text, last_enriched_at timestamp
    );
    CREATE TABLE crm_requirements_leasing (id varchar PRIMARY KEY, company_id varchar, agent_contact_id varchar);
    INSERT INTO crm_companies (id,name,company_type) VALUES
      ('brand','Example Brand','Brand'), ('other-brand','Other Brand','Brand'), ('agency','Example Agency','Agent');
    INSERT INTO crm_contacts (id,name,email,linkedin_url,company_id,company_name)
      VALUES ('corrected','Casey Agent','casey@agency.test','http://uk.linkedin.com/in/CASEY-AGENT/?trk=test','agency','Example Agency');
    INSERT INTO crm_requirements_leasing VALUES ('requirement','brand','corrected');
  `);

  const corrected = await invoke([person({ current_employer: 'Example Brand' })]);
  const correctedRows = (await pool.query("SELECT id,company_id FROM crm_contacts WHERE lower(email)='casey@agency.test'")).rows;
  const requirement = (await pool.query("SELECT * FROM crm_requirements_leasing WHERE id='requirement'")).rows[0];
  check('corrected contact is retained under its employer and its requirement keeps the same person', () => {
    assert.equal(corrected.existing, 1);
    assert.equal(corrected.inserted, 0);
    assert.deepEqual(correctedRows, [{ id: 'corrected', company_id: 'agency' }]);
    assert.equal(requirement.agent_contact_id, 'corrected');
    assert.equal(requirement.company_id, 'brand');
  });

  const batchPerson = person({ name: 'Morgan Agent', email: 'morgan@agency.test', linkedin_url: null });
  const sameBatch = await invoke([batchPerson, batchPerson]);
  check('same batch creates one contact under the provider-confirmed agency', () => {
    assert.equal(sameBatch.inserted, 1);
    assert.equal(sameBatch.existing, 1);
    assert.equal(sameBatch.insertedElsewhere, 1);
    assert.equal(sameBatch.results[0].companyId, 'agency');
  });

  const parallelPerson = person({ name: 'Taylor Agent', email: 'taylor@agency.test', linkedin_url: 'https://linkedin.com/in/taylor-agent' });
  const blocker = await pool.connect();
  let runs;
  let waiting = 0;
  try {
    await blocker.query('BEGIN');
    await blocker.query("SELECT pg_advisory_xact_lock(hashtext('rocketreach-contact-import'))");
    runs = [invoke([parallelPerson]), invoke([parallelPerson], 'other-brand')];
    const deadline = Date.now() + 5000;
    do {
      waiting = Number((await admin.query(`SELECT count(*) AS n FROM pg_stat_activity
        WHERE application_name = $1 AND wait_event_type = 'Lock' AND wait_event = 'advisory'`, [schemaName])).rows[0].n);
      if (waiting >= 2) break;
      await new Promise(resolve => setTimeout(resolve, 20));
    } while (Date.now() < deadline);
  } finally {
    await blocker.query('COMMIT');
    blocker.release();
  }
  const parallelResults = await Promise.all(runs);
  const parallelRows = (await pool.query("SELECT id,company_id FROM crm_contacts WHERE email='taylor@agency.test'")).rows;
  check('two real import transactions wait for the global identity lock', () => assert.equal(waiting, 2));
  check('simultaneous imports from two brands create only one person, with the second seeing the committed row', () => {
    assert.equal(parallelResults.reduce((sum, result) => sum + result.inserted, 0), 1);
    assert.equal(parallelResults.reduce((sum, result) => sum + result.existing, 0), 1);
    assert.equal(parallelRows.length, 1);
    assert.equal(parallelRows[0].company_id, 'agency');
  });

  const conflicting = await invoke([person({ name: 'Casey Agent', linkedin_url: 'https://linkedin.com/in/different-person' })]);
  check('matching email with a conflicting LinkedIn identity never rewrites or duplicates the person', () => {
    assert.equal(conflicting.skipped, 1);
    assert.equal(conflicting.inserted, 0);
    assert.equal(conflicting.existing, 0);
  });
  const finalCount = Number((await pool.query('SELECT count(*) AS n FROM crm_contacts')).rows[0].n);
  check('only the three expected synthetic contacts exist', () => assert.equal(finalCount, 3));
} finally {
  await pool.end();
  await admin.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
  await admin.end();
}
console.log(`PASS ${checks} real PostgreSQL import checks; synthetic schema removed`);
