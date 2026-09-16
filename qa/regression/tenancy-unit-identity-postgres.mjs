// Executes the real GET/PUT handlers against an isolated local schema, with no providers.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import pg from 'pg';
import { tenancyCalendarDatesSql } from '../../server/tenancy-calendar-dates.ts';
const require = createRequire(import.meta.url);
const { source, find, evaluate, ts } = require('./source-harness.cjs');
const supplied = process.env.PROPERTY_ENRICHMENT_TEST_DATABASE_URL;
if (!supplied) throw new Error('Provide the disposable PROPERTY_ENRICHMENT_TEST_DATABASE_URL');
const url = new URL(supplied);
if (url.hostname !== '' || url.pathname !== '/bgp_smoke' || url.searchParams.get('host') !== '/tmp/bgp-propertyqa-20260916/socket' || url.searchParams.get('port') !== '55446') throw new Error('Refusing a non-disposable database');
const schema = `qa_tenancy_identity_${process.pid}_${Date.now()}`;
const pool = new pg.Pool({ connectionString: supplied, ssl: false, max: 4, options: `-c search_path=${schema}` });
const routerHandler = (method, path) => find('server/tenancy-schedule.ts', (node, ast) => ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.expression.getText(ast) === 'router' && node.expression.name.text === method && ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === path);
const { normUnitSql } = evaluate(find('server/tenant-brand-resolver.ts', node => ts.isFunctionDeclaration(node) && node.name?.text === 'normUnitSql'));
const routeScripts = routerHandler('get', '/api/tenancy-schedule/property/:propertyId') + ';\n' + routerHandler('put', '/api/tenancy-schedule/unit/:id') + ';';
const scheduleAst = ts.createSourceFile('server/tenancy-schedule.ts', source('server/tenancy-schedule.ts'), ts.ScriptTarget.Latest, true);
const constants = scheduleAst.statements.filter(node => ts.isVariableStatement(node) && ['TENANCY_FIELDS', 'NUMERIC_FIELDS', 'DATE_FIELDS'].some(name => node.declarationList.declarations.some(decl => decl.name.getText(scheduleAst) === name))).map(node => node.getText(scheduleAst)).join('\n');
const normalise = find('server/tenancy-schedule.ts', node => ts.isFunctionDeclaration(node) && node.name?.text === 'normaliseFieldValue');
let get, put, created = false, checks = 0;
evaluate(`${constants}\n${normalise}\n${routeScripts}`, {
  router: { get: (_path, _auth, fn) => get = fn, put: (_path, _auth, fn) => put = fn }, requireAuth() {},
  getPool: async () => pool, normUnitSql, tenancyCalendarDatesSql, resolveBrandIdSubquery: () => 'NULL', fanOutTenancyStatus: async () => {},
  require: name => { assert.equal(name, './company-scope'); return { resolveCompanyScope: async req => req.scope || null, isPropertyInScope: async (scope, id) => scope === id }; },
  console: { error() {}, warn() {} },
});
async function invoke(handler, params, body = {}, scope) { let status = 200, data; const res = { status: value => { status = value; return res; }, json: value => { data = value; return res; } }; await handler({ params, body, scope }, res); return { status, data }; }
const schedule = async () => { const response = await invoke(get, { propertyId: 'property' }); assert.equal(response.status, 200, response.data?.error); return response.data; };
const update = (body, scope = 'property') => invoke(put, { id: 'tenancy-1' }, body, scope);
const read = async table => (await pool.query(`SELECT * FROM ${table} ORDER BY id`)).rows;
const pass = label => { checks++; console.log(`PASS ${label}`); };
try {
  await pool.query(`CREATE SCHEMA ${schema}`); created = true;
  await pool.query(`CREATE TABLE crm_companies(id text PRIMARY KEY,name text,merged_into_id text);
    CREATE TABLE tenancy_schedule_units(id text PRIMARY KEY,property_id text,unit_number text,premises text,property_unit_id text,letting_tracker_unit_id text,tenant_company_id text,trading_name text,tenant_name text,lease_start date,break_date date,lease_expiry date,next_review_date date,landlord_break_date date,sort_order integer DEFAULT 0,updated_at timestamptz DEFAULT now());
    CREATE TABLE property_units(id text PRIMARY KEY,property_id text,unit_name text,notes text,updated_at timestamptz DEFAULT now());
    CREATE TABLE crm_deals(id text PRIMARY KEY,deal_ref text);
    CREATE TABLE available_units(id text PRIMARY KEY,property_id text,unit_id text,unit_name text,sqft real,asking_rent real,marketing_status text,deal_id text,tenancy_unit_id text,notes text,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),CONSTRAINT fail_rename CHECK(unit_name <> 'Rejected'));
    CREATE TABLE leasing_schedule_units(id text PRIMARY KEY,property_id text,unit_name text,tenancy_unit_id text,notes text,updated_at timestamptz DEFAULT now());
    INSERT INTO tenancy_schedule_units(id,property_id,unit_number,premises,property_unit_id) VALUES('tenancy-1','property','Unit 1','Ground','physical-1'),('tenancy-2','property','Unit 2 renamed','First','physical-2');
    INSERT INTO available_units(id,property_id,unit_id,unit_name,tenancy_unit_id,notes,deal_id) VALUES('tracker-1','property','physical-1','Unit 1','tenancy-1','Keep viewings and notes','deal-1'),('tracker-2','property','physical-2','Old unit 2',NULL,'Keep physical link',NULL),('vacancy','property','physical-3','Vacant shop',NULL,'Real vacancy',NULL),('other-property','other','physical-9','Unit 1','tenancy-1','Do not touch cross-property',NULL);
    INSERT INTO leasing_schedule_units VALUES('leasing-1','property','Unit 1','tenancy-1','Keep negotiation',now());
    INSERT INTO crm_deals VALUES('deal-1','D001');
    INSERT INTO property_units(id,property_id,unit_name,notes) VALUES('physical-1','property','Unit 1','Keep physical facts'),('physical-2','property','Original physical label','Keep physical facts');`);
  assert.equal((await schedule()).length, 3);
  pass('canonical and physical links suppress duplicate projections while a genuine vacancy remains');
  await pool.query("UPDATE tenancy_schedule_units SET lease_start='2023-09-01',lease_expiry='2027-03-31',next_review_date='2028-09-01' WHERE id='tenancy-1'");
  const originalTimezone = process.env.TZ;
  try {
    for (const timezone of ['Europe/London', 'UTC', 'America/Los_Angeles']) {
      process.env.TZ = timezone;
      const dated = (await schedule()).find(row => row.id === 'tenancy-1');
      assert.equal(dated.lease_start, '2023-09-01'); assert.equal(dated.lease_expiry, '2027-03-31'); assert.equal(dated.next_review_date, '2028-09-01'); assert.equal(dated.break_date, null);
      const response = await update({ lease_expiry: dated.lease_expiry, next_review_date: dated.next_review_date });
      assert.equal(response.status, 200, response.data?.error); assert.equal(response.data.lease_expiry, '2027-03-31'); assert.equal(response.data.next_review_date, '2028-09-01');
      assert.equal((await pool.query("SELECT lease_expiry::text AS expiry FROM tenancy_schedule_units WHERE id='tenancy-1'")).rows[0].expiry, '2027-03-31');
    }
  } finally { if (originalTimezone === undefined) delete process.env.TZ; else process.env.TZ = originalTimezone; }
  pass('GET, unchanged date edits and PUT return exact SQL calendar days in London, UTC and Los Angeles');
  const original = await read('available_units'); const leasing = await read('leasing_schedule_units');
  const renamed = await update({ unit_number: 'Unit 1 QA' }); assert.equal(renamed.status, 200, renamed.data?.error);
  const after = await read('available_units'); const same = after.find(row => row.id === 'tracker-1');
  assert.equal((await read('property_units')).find(row => row.id === 'physical-1').unit_name, 'Unit 1 QA'); assert.equal((await read('property_units')).find(row => row.id === 'physical-1').notes, 'Keep physical facts');
  assert.equal(same.tenancy_unit_id, 'tenancy-1'); assert.equal(same.unit_name, 'Unit 1 QA'); assert.equal(same.notes, original[original.findIndex(row => row.id === same.id)].notes); assert.equal(same.deal_id, 'deal-1');
  assert.equal((await read('leasing_schedule_units'))[0].id, leasing[0].id); assert.equal((await read('leasing_schedule_units'))[0].unit_name, 'Unit 1 QA');
  assert.equal((await schedule()).length, 3); assert.equal(after.length, original.length); assert.deepEqual(after.find(row => row.id === 'other-property'), original.find(row => row.id === 'other-property'));
  pass('renaming keeps three rows, existing canonical IDs, deal/notes and unrelated property data');
  assert.equal((await update({ unit_number: 'Unit 1 QA' })).status, 200); assert.equal((await schedule()).length, 3);
  pass('repeated same rename cannot create extra tracker or schedule rows');
  await pool.query("UPDATE available_units SET tenancy_unit_id=NULL, unit_name='Detached old name' WHERE id='tracker-1'");
  assert.equal((await schedule()).length, 3);
  pass('physical ID prevents a historical detached projection becoming a new vacancy');
  await pool.query("UPDATE available_units SET unit_id=NULL WHERE id='tracker-2'; UPDATE tenancy_schedule_units SET letting_tracker_unit_id='tracker-2' WHERE id='tenancy-2'");
  assert.equal((await schedule()).length, 3);
  pass('reverse tracker link also survives differing labels without a physical ID');
  await pool.query("INSERT INTO available_units(id,property_id,unit_id,unit_name) VALUES('same-name-different-space','property','physical-4','Unit 1 QA'),('same-physical-duplicate','property','physical-3','Another vacant label')");
  const distinct = await schedule(); assert.equal(distinct.length, 4); assert.equal(distinct.filter(row => row.is_vacant).length, 2);
  pass('same name does not hide another known physical unit; repeated physical vacancy appears once');
  await pool.query("UPDATE available_units SET tenancy_unit_id='tenancy-1' WHERE id='tracker-1'");
  const beforeFailure = { available: await read('available_units'), leasing: await read('leasing_schedule_units'), tenancy: await read('tenancy_schedule_units'), physical: await read('property_units') };
  assert.equal((await update({ unit_number: 'Rejected' })).status, 500);
  assert.deepEqual({ available: await read('available_units'), leasing: await read('leasing_schedule_units'), tenancy: await read('tenancy_schedule_units'), physical: await read('property_units') }, beforeFailure);
  pass('projection failure rolls back all rename changes together');
  assert.equal((await update({ unit_number: 'Forbidden' }, 'another-client')).status, 403); assert.equal((await invoke(get, { propertyId: 'property' }, {}, 'another-client')).status, 403);
  assert.deepEqual(await read('tenancy_schedule_units'), beforeFailure.tenancy);
  pass('scoped clients retain own-property rename while foreign reads/writes are refused');
  await pool.query("UPDATE property_units SET unit_name='Manually maintained master' WHERE id='physical-1'");
  assert.equal((await update({ unit_number: 'Unit 1 next' })).status, 200);
  assert.equal((await read('property_units')).find(row => row.id === 'physical-1').unit_name, 'Manually maintained master');
  pass('a separately maintained physical master label is not overwritten');
  await pool.query("UPDATE property_units SET unit_name='Unit 1 next' WHERE id='physical-1'; INSERT INTO tenancy_schedule_units(id,property_id,unit_number,property_unit_id) VALUES('shared-tenancy','property','Historic lease','physical-1')");
  assert.equal((await update({ unit_number: 'Unit 1 latest' })).status, 200);
  assert.equal((await read('property_units')).find(row => row.id === 'physical-1').unit_name, 'Unit 1 next');
  pass('a physical master shared by multiple tenancies is not renamed automatically');
  console.log(`${checks} PostgreSQL tenancy identity checks passed`);
} finally {
  if (created) await pool.query(`DROP SCHEMA ${schema} CASCADE`);
  await pool.end();
}
