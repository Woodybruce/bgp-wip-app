// Share with a brand: the brand's agent as the recipient (Woody, 15 November
// 2026, "fix the phone issues"). The share stays logged against the brand, so
// the server itself decides who may receive it: someone at the brand, or a
// named contact of one of its CURRENT tenant reps. A joint agent's rules are
// unchanged: never a contact from BGP's CRM.
//
// The read's SQL runs for real in a throwaway schema of a local disposable
// database; the other tests need none. After `bash qa/start-postgres.sh`:
// UNIT_SHARE_DATABASE_URL='postgresql://postgres:qa-local-pg@127.0.0.1:5432/postgres' node --import tsx --test qa/regression/unit-share-tenant-rep.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import pg from 'pg';
const require = createRequire(import.meta.url);
const { source, find, evaluate, ts } = require('./source-harness.cjs');

const FILE = 'server/unit-share.ts';
const fn = name => find(FILE, n => ts.isFunctionDeclaration(n) && n.name?.text === name);
const load = pool => evaluate(`${fn('tenantRepContacts')}\n${fn('contactMayReceiveFor')}`, { pool });

test('a contact outside the brand receives a share only as its current tenant rep', async () => {
  const asked = [];
  const db = { query: async (sql, params) => { asked.push({ sql, params }); return { rows: [
    { id: 'rep', name: ' Richard Willcox ', email: 'richard@agent.example', role: 'Founding Partner', firm_name: 'ETCH.' },
    { id: 'blank', name: '  ', email: null, role: null, firm_name: 'ETCH.' },
  ] }; } };
  const { tenantRepContacts, contactMayReceiveFor } = load(db);

  assert.deepEqual(JSON.parse(JSON.stringify(await tenantRepContacts('brand'))), [{ id: 'rep', name: 'Richard Willcox', email: 'richard@agent.example', role: 'Founding Partner', firmName: 'ETCH.' }]);
  assert.equal(JSON.stringify(asked[0].params), '["brand"]');
  assert.match(asked[0].sql, /r\.brand_company_id = \$1/);
  assert.match(asked[0].sql, /r\.agent_type = 'tenant_rep'/, 'tenant reps only, never a landlord or investment agent');
  assert.match(asked[0].sql, /r\.end_date IS NULL/, 'current representations only');
  assert.match(asked[0].sql, /JOIN crm_contacts ct ON ct\.id = r\.primary_contact_id/, 'the named contact, not everyone at the firm');

  asked.length = 0;
  assert.equal(await contactMayReceiveFor('brand', { id: 'own', company_id: 'brand' }), true, 'someone at the brand');
  assert.equal(asked.length, 0, 'no lookup is needed for the brand\'s own people');
  assert.equal(await contactMayReceiveFor('brand', { id: 'rep', company_id: 'firm' }), true, 'the brand\'s tenant rep');
  assert.equal(await contactMayReceiveFor('brand', { id: 'colleague', company_id: 'firm' }), false, 'a colleague at the agent firm who is not the named contact');
  assert.equal(await contactMayReceiveFor('brand', { id: 'stranger', company_id: null }), false);
  assert.equal(await contactMayReceiveFor('brand', { id: 'blank', company_id: 'firm' }), false, 'a contact with no name is never offered');
});

test('the send checks the contact it is handed, and a joint agent still picks no contact', () => {
  const parse = fn('parseSend');
  const staff = parse.slice(parse.indexOf('if (!brands && r.contactId'));
  assert.match(staff, /SELECT id, name, email, company_id FROM crm_contacts WHERE id = \$1/);
  assert.ok(staff.indexOf('contactMayReceiveFor(company.id, row)') > 0 && staff.indexOf('contactMayReceiveFor(company.id, row)') < staff.indexOf('contact = {'),
    'the check runs before the contact is taken as the recipient');
  assert.match(staff, /if \(!company\.id \|\| !\(await contactMayReceiveFor\(company\.id, row\)\)\) \{\s*return bad\(/);
  // A joint agent: a contactId is refused before any CRM read, as before.
  const joint = parse.slice(parse.indexOf('if (brands) {'), parse.indexOf('} else {'));
  assert.match(joint, /if \(r\.contactId !== undefined && r\.contactId !== null && r\.contactId !== ""\) \{\s*return bad\("Type the person's name and email address\. Contacts are not picked from BGP's CRM on this login\.", 403\);/);
  assert.doesNotMatch(joint, /crm_contacts|tenantRepContacts|contactMayReceiveFor/);
});

test('the recipient list of tenant rep contacts is for BGP staff only', () => {
  const text = source(FILE);
  const route = text.slice(text.indexOf('app.get("/api/unit-share/:unitId/brand-agents"'), text.indexOf('app.get("/api/unit-share/:unitId/history"'));
  assert.ok(route.length > 0);
  const gate = route.indexOf('await staffGate(req, res, req.params.unitId)');
  const refusal = route.indexOf('if (isJointAgent(gate.access)) return void res.status(403)');
  const read = route.indexOf('tenantRepContacts(companyId)');
  assert.ok(gate > 0 && refusal > gate && read > refusal, 'the unit gate, then the joint agent refusal, then the read');
  // The dialog asks only when the server says this login picks from the CRM.
  const dialog = source('client/src/components/unit-share-dialog.tsx');
  assert.match(dialog, /brand-agents\?companyId=\$\{encodeURIComponent\(companyId\)\}`\], enabled: crmPicker && !!companyId,/);
});

const supplied = process.env.UNIT_SHARE_DATABASE_URL;
test('the read against real tables: current tenant rep contacts only', { skip: supplied ? false : 'Provide UNIT_SHARE_DATABASE_URL (a local disposable database) to run' }, async () => {
  const url = new URL(supplied);
  assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname), 'a local database only');
  const client = new pg.Client({ connectionString: supplied });
  await client.connect();
  const schema = `unit_share_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  try {
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}`);
    await client.query(`CREATE TABLE crm_companies (id text PRIMARY KEY, name text, merged_into_id text)`);
    await client.query(`CREATE TABLE crm_contacts (id text PRIMARY KEY, name text, email text, role text, company_id text)`);
    await client.query(`CREATE TABLE brand_agent_representations (id text PRIMARY KEY, brand_company_id text, agent_company_id text, agent_type text, primary_contact_id text, start_date date, end_date date)`);
    await client.query(`INSERT INTO crm_companies VALUES ('brand', 'Brand', NULL), ('other', 'Other brand', NULL), ('firm', 'Agent firm', NULL)`);
    await client.query(`INSERT INTO crm_contacts VALUES
      ('current', 'Current Rep', 'current@agent.example', 'Partner', 'firm'), ('ended', 'Ended Rep', NULL, NULL, 'firm'),
      ('landlord', 'Landlord Rep', NULL, NULL, 'firm'), ('elsewhere', 'Other Brand Rep', NULL, NULL, 'firm'), ('colleague', 'Colleague', NULL, NULL, 'firm')`);
    await client.query(`INSERT INTO brand_agent_representations VALUES
      ('r1', 'brand', 'firm', 'tenant_rep', 'current', NULL, NULL), ('r1b', 'brand', 'firm', 'tenant_rep', 'current', '2026-01-01', NULL),
      ('r2', 'brand', 'firm', 'tenant_rep', 'ended', NULL, '2026-06-30'), ('r3', 'brand', 'firm', 'landlord_rep', 'landlord', NULL, NULL),
      ('r4', 'other', 'firm', 'tenant_rep', 'elsewhere', NULL, NULL), ('r5', 'brand', 'firm', 'tenant_rep', NULL, NULL, NULL)`);
    const { tenantRepContacts, contactMayReceiveFor } = load(client);
    assert.deepEqual(JSON.parse(JSON.stringify(await tenantRepContacts('brand'))), [{ id: 'current', name: 'Current Rep', email: 'current@agent.example', role: 'Partner', firmName: 'Agent firm' }]);
    for (const id of ['ended', 'landlord', 'elsewhere', 'colleague']) assert.equal(await contactMayReceiveFor('brand', { id, company_id: 'firm' }), false, id);
    assert.equal(await contactMayReceiveFor('brand', { id: 'current', company_id: 'firm' }), true);
    assert.equal(await contactMayReceiveFor('other', { id: 'elsewhere', company_id: 'firm' }), true);
  } finally {
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => {});
    await client.end();
  }
});
