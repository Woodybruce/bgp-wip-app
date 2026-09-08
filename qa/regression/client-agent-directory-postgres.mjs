// Actual query + canonical brand-slice check on temporary tables. No .env is loaded.
// CRM_DIRECTORY_DATABASE_URL='postgresql:///bgp_crm_directory_regression?host=/tmp/bgp-smoke-20260906/socket&port=55441&user=postgres' node --import tsx qa/regression/client-agent-directory-postgres.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import pg from 'pg';
import { buildClientAgentDirectoryQuery, mapClientAgentDirectoryRows } from '../../server/client-agent-directory.ts';
const require = createRequire(import.meta.url);
const { evaluate, find, source, ts } = require('./source-harness.cjs');
const supplied = process.env.CRM_DIRECTORY_DATABASE_URL;
if (!supplied) throw new Error('Provide the separate disposable CRM_DIRECTORY_DATABASE_URL');
const url = new URL(supplied);
if (url.hostname || url.pathname !== '/bgp_crm_directory_regression'
    || !/^\/(?:private\/)?tmp\/bgp-[a-zA-Z0-9_-]+\/socket$/.test(url.searchParams.get('host') || '')) {
  throw new Error('Refusing a database outside the disposable CRM Unix socket');
}
const client = new pg.Client({ connectionString: supplied, ssl: false });
const scope = '11111111-1111-4111-8111-111111111111';
const extra = '22222222-2222-4222-8222-222222222222';
const noAccess = '00000000-0000-0000-0000-000000000000';
const taxonomy = evaluate(source('shared/tenant-categories.ts'));
const scopeFunctions = ['getClientExtraBrandIds', 'clientBrandSliceSql'].map(name =>
  find('server/company-scope.ts', n => ts.isFunctionDeclaration(n) && n.name?.text === name)).join('\n');
const { clientBrandSliceSql } = evaluate(scopeFunctions, { pool: client, ...taxonomy });
let checks = 0;
function check(name, fn) { fn(); checks++; console.log(`PASS ${name}`); }
async function directory(requestScope = scope, brandScope = requestScope) {
  const slice = await clientBrandSliceSql(brandScope);
  const query = buildClientAgentDirectoryQuery(slice, requestScope, noAccess);
  return mapClientAgentDirectoryRows((await client.query(query.text, query.values)).rows);
}
await client.connect();
try {
  await client.query('BEGIN');
  await client.query(`
    CREATE TEMP TABLE crm_companies (
      id varchar PRIMARY KEY, name text, company_type text, domain text,
      merged_into_id varchar, agent_type text, crm_extra_brand_ids text[] DEFAULT '{}'
    ) ON COMMIT DROP;
    CREATE TEMP TABLE crm_contacts (
      id varchar PRIMARY KEY, name text, company_id varchar, role text, email text,
      phone text, phone_mobile text, agent_specialty text, contact_type text
    ) ON COMMIT DROP;
    CREATE TEMP TABLE brand_agent_representations (
      id varchar PRIMARY KEY, brand_company_id varchar, agent_company_id varchar,
      primary_contact_id varchar, agent_type text, region text, start_date timestamp, end_date timestamp
    ) ON COMMIT DROP;
    CREATE TEMP TABLE crm_requirements_leasing (
      id varchar PRIMARY KEY, company_id varchar, agent_contact_id varchar,
      principal_contact_id varchar, status text, sources text[]
    ) ON COMMIT DROP;
  `);
  for (const [id, name, type, merged] of [
    [scope, 'Client', 'Landlord'], ['coffee', 'Coffee Brand', 'Tenant - Restaurant'],
    ['gym', 'Gym Brand', 'Tenant - Gym'], [extra, 'Added Fashion', 'Tenant - Fashion'],
    ['outside', 'Outside Fashion', 'Tenant - Fashion'], ['merged-brand', 'Old Coffee', 'Tenant - Café', 'coffee'],
    ['agency', 'Agency With Requirement Links', 'Agent'], ['rep-agency', 'Representation Agency', 'Agent'],
    ['flag-only', 'Flag Only', 'Agent'], ['outside-agency', 'Outside Agent', 'Agent'],
    ['unnamed-agency', 'Firm With No Named Contact', 'Agent'], ['old-agency', 'Old Agency', 'Agent', 'agency'],
    ['landlord', 'Unrelated Landlord', 'Landlord'], ['private-agency', 'Private Requirement Agency', 'Agent'],
  ]) await client.query('INSERT INTO crm_companies (id,name,company_type,merged_into_id) VALUES ($1,$2,$3,$4)', [id,name,type,merged || null]);
  await client.query("UPDATE crm_companies SET agent_type='tenant_rep' WHERE id='flag-only'");
  for (const [id, name, firm, specialty] of [
    ['named', 'Alex Agent', 'rep-agency'], ['unrelated', 'Aardvark Unrelated Employee', 'rep-agency'],
    ['req-person', 'Blair Agent', 'agency'], ['unset-type', 'Casey Agent', 'agency'],
    ['unknown', 'Dana Without Firm', null], ['brand-attached', 'Eli Attached To Brand', 'coffee'],
    ['landlord-attached', 'Fin Attached To Landlord', 'landlord'], ['merged-firm', 'Gale Old Firm', 'old-agency'],
    ['same-one', 'Same Name', 'agency'], ['same-two', 'Same Name', 'agency'],
    ['outside-person', 'Outside Person', 'outside-agency'], ['principal', 'Principal Only', 'agency'],
    ['flag-person', 'Specialty Only', 'flag-only', 'Tenant Rep'], ['private-person', 'Private Agent', 'private-agency'],
  ]) await client.query('INSERT INTO crm_contacts (id,name,company_id,email,phone,phone_mobile,agent_specialty) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [id,name,firm,`${id}@fixture.example`,'020 0000 0000',id === 'named' ? '' : null,specialty || null]);
  async function representation(id, brand, firm, contact, type = 'tenant_rep', start = null, end = null) {
    await client.query('INSERT INTO brand_agent_representations VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [id,brand,firm,contact,type,'London',start,end]);
  }
  async function requirement(id, brand, contact, status = 'Active', sources = ['PIPnet'], principal = null) {
    await client.query('INSERT INTO crm_requirements_leasing VALUES ($1,$2,$3,$4,$5,$6)', [id,brand,contact,principal,status,sources]);
  }
  await representation('rep', 'coffee', 'rep-agency', 'named');
  await representation('rep-duplicate', 'coffee', 'rep-agency', 'named');
  await representation('rep-no-person', 'gym', 'unnamed-agency', null);
  await representation('rep-outside', 'outside', 'outside-agency', 'outside-person');
  await representation('rep-ended', 'coffee', 'outside-agency', 'outside-person', 'tenant_rep', null, '2020-01-01');
  await representation('rep-future', 'coffee', 'outside-agency', 'outside-person', 'tenant_rep', '2999-01-01');
  await representation('rep-landlord', 'coffee', 'outside-agency', 'outside-person', 'landlord_rep');
  await representation('rep-merged-brand', 'merged-brand', 'outside-agency', 'outside-person');
  await requirement('req-one', 'coffee', 'req-person');
  await requirement('req-two', 'gym', 'req-person');
  await requirement('req-same-person', 'coffee', 'named');
  await requirement('req-null-status', 'coffee', 'unset-type', null);
  await requirement('req-blank-status', 'coffee', 'same-one', '');
  await requirement('req-spaced-active', 'coffee', 'same-two', ' Active ');
  for (const id of ['unknown','brand-attached','landlord-attached','merged-firm']) await requirement(`req-${id}`, 'coffee', id);
  await requirement('req-outside', 'outside', 'outside-person');
  await requirement('req-past', 'coffee', 'outside-person', 'Past');
  await requirement('req-archived', 'coffee', 'outside-person', 'Archived');
  await requirement('req-unknown-status', 'coffee', 'outside-person', 'Inactive');
  await requirement('req-merged-brand', 'merged-brand', 'outside-person');
  await requirement('req-private', 'coffee', 'private-person', 'Active', []);
  await requirement('req-principal', 'coffee', null, 'Active', ['PIPnet'], 'principal');
  await requirement('req-broken-contact', 'coffee', 'missing-id');
  await requirement('req-extra', extra, 'outside-person');
  let entries = await directory();
  const byId = id => entries.find(e => e.id === id);
  check('requirement links include an agency without tenant-rep flags', () => assert.ok(byId('agency')));
  check('one person retains both represented brands', () => assert.deepEqual(byId('agency').contacts.find(c => c.id === 'req-person').represents.map(b => b.brandId), ['coffee','gym']));
  check('only the named representative appears, not unrelated firm employees', () => assert.deepEqual(byId('rep-agency').contacts.map(c => c.id), ['named']));
  check('duplicate representation and requirement evidence does not multiply people', () => assert.deepEqual(byId('rep-agency').contacts[0].represents[0].sources, ['representation','requirement']));
  check('empty mobile falls back to usable phone', () => assert.equal(byId('rep-agency').contacts[0].phone, '020 0000 0000'));
  check('firm-only representation remains visible without inventing a contact', () => assert.deepEqual(byId('unnamed-agency').contacts, []));
  check('agent and specialty flags alone never qualify a firm', () => assert.equal(byId('flag-only'), undefined));
  check('out-of-directory, historical, future, landlord and merged-brand links are excluded', () => assert.equal(byId('outside-agency'), undefined));
  check('unlabelled contact types and unset current statuses do not lose agents', () => assert.ok(byId('agency').contacts.some(c => c.id === 'unset-type')));
  check('same-name distinct contact IDs survive', () => assert.equal(byId('agency').contacts.filter(c => c.name === 'Same Name').length, 2));
  for (const id of ['unknown','brand-attached','landlord-attached','merged-firm']) {
    check(`${id} remains a person with no guessed employer`, () => {
      const entry = byId(`contact:${id}`); assert.ok(entry); assert.equal(entry.kind,'contact'); assert.equal(entry.companyId,null);
    });
  }
  check('principal contacts do not become acquiring agents', () => assert.ok(entries.every(e => e.contacts.every(c => c.id !== 'principal'))));
  check('missing contact IDs do not create empty persons', () => assert.equal(byId('contact:missing-id'), undefined));
  check('private staff requirements remain outside the client directory', () => assert.equal(byId('private-agency'), undefined));
  check('every displayed brand belongs to the same client Brand CRM', () => assert.ok(entries.every(e => e.represents.every(b => ['coffee','gym'].includes(b.brandId)))));
  await client.query('UPDATE crm_companies SET crm_extra_brand_ids=$1 WHERE id=$2', [[extra],scope]);
  entries = await directory();
  check('a client-added brand now qualifies its requirement agent', () => assert.deepEqual(byId('outside-agency').represents.map(b => b.brandId), [extra]));
  const staff = await directory(null, scope);
  check('staff preview includes the same extra brands and staff-visible requirement links', () => {
    assert.ok(staff.some(e => e.id === 'private-agency')); assert.ok(staff.some(e => e.represents.some(b => b.brandId === extra)));
  });
  const denied = await directory(noAccess);
  check('an unresolved client fails closed', () => assert.deepEqual(denied, [], 'Unresolved client must not receive representation contacts'));
  console.log(`PASS ${checks} PostgreSQL agent-directory checks`);
} finally {
  await client.query('ROLLBACK').catch(() => {});
  await client.end();
}
