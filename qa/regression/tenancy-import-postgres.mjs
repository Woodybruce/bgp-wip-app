// Real transactions in an isolated schema of the disposable local database only.
import assert from 'node:assert/strict';
import pg from 'pg';
import { importTenancyRows } from '../../server/tenancy-import.ts';
import { upsertChatTenancySchedule } from '../../server/chatbgp-tenancy-import.ts';

const supplied = process.env.TENANCY_IMPORT_DATABASE_URL;
if (!supplied) throw new Error('Provide TENANCY_IMPORT_DATABASE_URL for the disposable database');
const url = new URL(supplied);
if (url.hostname || url.pathname !== '/bgp_crm_directory_regression' || !/^\/(?:private\/)?tmp\/bgp-[a-zA-Z0-9_-]+\/socket$/.test(url.searchParams.get('host') || '')) throw new Error('Refusing non-disposable database');
const schema = `qa_tenancy_import_${process.pid}_${Date.now()}`;
const db = new pg.Pool({ connectionString: supplied, ssl: false, max: 6, options: `-c search_path=${schema}` });
const allowedFields = ['unit_number', 'tenant_name', 'floor_level', 'premises', 'passing_rent_pa', 'lease_expiry', 'comments', 'sort_order'];
const row = (unit_number, rest = {}, sourceRow = 2) => ({ sourceRow, values: { unit_number, ...rest } });
const save = (rows, extra = {}) => importTenancyRows(db, 'property', rows, { allowedFields, ...extra });
const records = async () => (await db.query('SELECT * FROM tenancy_schedule_units ORDER BY id')).rows;
const snapshot = async () => JSON.stringify({ rows: await records(), refs: (await db.query('SELECT * FROM leasing_schedule_units ORDER BY id')).rows,
  deals: (await db.query('SELECT * FROM crm_deals ORDER BY id')).rows, plan: (await db.query('SELECT * FROM evidence_plan_units ORDER BY id')).rows });
let checks = 0;
async function seed() {
  await db.query('TRUNCATE tenancy_schedule_units, leasing_schedule_units, available_units, crm_deals, evidence_plan_units');
  await db.query("INSERT INTO tenancy_schedule_units (id,property_id,unit_number,tenant_name,passing_rent_pa,comments,lease_expiry) VALUES ('keep','property','Unit D04','Human tenant',120000,'Human note','2031-05-04')");
  await db.query("INSERT INTO leasing_schedule_units VALUES ('board','property','keep')");
  await db.query("INSERT INTO crm_deals VALUES ('deal','property','keep')");
  await db.query("INSERT INTO evidence_plan_units VALUES ('outline','keep')");
}
async function check(name, fn) { await seed(); await fn(); checks++; console.log(`PASS ${name}`); }
try {
  await db.query(`CREATE SCHEMA ${schema}`);
  await db.query(`CREATE TABLE crm_properties (id text PRIMARY KEY, name text);
    INSERT INTO crm_properties VALUES ('property', 'Fixture property'), ('other', 'Other property');
    CREATE TABLE tenancy_schedule_units (id text PRIMARY KEY DEFAULT gen_random_uuid()::text, property_id text, unit_number text, tenant_name text,
      floor_level text, premises text, status text, passing_rent_pa numeric CHECK (passing_rent_pa >= 0), lease_expiry date, comments text, sort_order integer DEFAULT 0,
      created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
    CREATE TABLE leasing_schedule_units (id text PRIMARY KEY, property_id text, tenancy_unit_id text);
    CREATE TABLE available_units (id text PRIMARY KEY, property_id text, tenancy_unit_id text);
    CREATE TABLE crm_deals (id text PRIMARY KEY, property_id text, tenancy_unit_id text);
    CREATE TABLE evidence_plan_units (id text PRIMARY KEY, tenancy_unit_id text);`);
  await check('repeat import does not change existing IDs, facts, timestamps or downstream references', async () => {
    const before = await snapshot();
    const result = await save([row('D4', { tenant_name: 'Human tenant', passing_rent_pa: 120000, lease_expiry: '2031-05-04' })]);
    assert.equal(result.imported, 0); assert.equal(result.skippedExisting, 1); assert.equal(result.needsReview, 0);
    assert.equal(await snapshot(), before);
  });
  await check('human-edited facts remain untouched while truly new units are added', async () => {
    const original = (await records())[0];
    const result = await save([row('D4', { passing_rent_pa: 50000 }), row('New A1', { tenant_name: 'New tenant' })]);
    assert.equal(result.imported, 1); assert.equal(result.needsReview, 1);
    assert.deepEqual(result.reviewRows[0].differingFields, ['passing_rent_pa']);
    assert.deepEqual((await records()).find(r => r.id === 'keep'), original);
    assert.equal((await db.query("SELECT tenancy_unit_id FROM evidence_plan_units WHERE id='outline'")).rows[0].tenancy_unit_id, 'keep');
  });
  await check('repeated rows inside the same file are inserted only once', async () => {
    const result = await save([row('A1', { tenant_name: 'Brand' }, 2), row('Unit A01', { tenant_name: 'Brand' }, 3)]);
    assert.equal(result.imported, 1); assert.equal(result.skippedExisting, 1);
    assert.equal((await records()).length, 2);
  });
  await check('concurrent imports of an empty identity produce one record', async () => {
    const results = await Promise.all([save([row('A1')]), save([row('A1')])]);
    assert.equal(results.reduce((n, result) => n + result.imported, 0), 1);
    assert.equal(results.reduce((n, result) => n + result.skippedExisting, 0), 1);
    assert.equal((await records()).filter(r => r.unit_number === 'A1').length, 1);
  });
  await check('distinct floors remain separate, blank-floor ambiguity stays in review and cannot mirror by name', async () => {
    const added = await save([row('A1', { floor_level: 'Lower' }), row('A1', { floor_level: 'Upper' })]);
    assert.equal(added.imported, 2); assert.deepEqual(added.mirrorEligibleIds, []);
    const before = await snapshot(); const ambiguous = await save([row('A1')]);
    assert.equal(ambiguous.needsReview, 1); assert.equal(ambiguous.reviewRows[0].existingIds.length, 2);
    assert.equal(await snapshot(), before);
    const repeated = await save([row('A1', { floor_level: 'Lower' }), row('A1', { floor_level: 'Upper' })]);
    assert.equal(repeated.skippedExisting, 2); assert.equal(repeated.imported, 0);
  });
  await check('existing duplicate groups remain unchanged and receive no third copy', async () => {
    await db.query("INSERT INTO tenancy_schedule_units (id,property_id,unit_number) VALUES ('second','property','D4')");
    const before = await snapshot(); const result = await save([row('D4')]);
    assert.equal(result.imported, 0); assert.equal(result.reviewRows[0].reason, 'ambiguous_identity');
    assert.equal(await snapshot(), before);
  });
  await check('same references at another property do not prevent new records here', async () => {
    await db.query("INSERT INTO tenancy_schedule_units (id,property_id,unit_number) VALUES ('other-unit','other','A1')");
    const result = await save([row('A1')]); assert.equal(result.imported, 1);
    assert.equal((await records()).find(r => r.id === 'other-unit').property_id, 'other');
  });
  await check('database failure rolls back the whole import instead of leaving a partial schedule', async () => {
    const before = await snapshot();
    await assert.rejects(() => save([row('A1'), row('A2', { passing_rent_pa: -1 })]), /check constraint/);
    assert.equal(await snapshot(), before);
  });
  await check('explicit replacement failure restores old rows and all references atomically', async () => {
    const before = await snapshot();
    await assert.rejects(() => save([row('A1'), row('A2', { passing_rent_pa: -1 })], { clearExisting: true }), /check constraint/);
    assert.equal(await snapshot(), before);
  });
  await check('explicit replacement keeps old plan links visibly stale instead of linking a new row by accident', async () => {
    const result = await save([row('D4')], { clearExisting: true }); assert.equal(result.imported, 1);
    assert.notEqual(result.insertedIds[0], 'keep');
    assert.equal((await db.query("SELECT tenancy_unit_id FROM evidence_plan_units WHERE id='outline'")).rows[0].tenancy_unit_id, 'keep');
    assert.equal((await db.query("SELECT tenancy_unit_id FROM leasing_schedule_units WHERE id='board'")).rows[0].tenancy_unit_id, null);
  });
  await check('unknown property cannot import records', async () => {
    const before = await snapshot();
    await assert.rejects(() => importTenancyRows(db, 'missing', [row('A1')], { allowedFields }), error => error.status === 404);
    assert.equal(await snapshot(), before);
  });
  await check('ChatBGP repeat extraction adds once and reports the second run as already present', async () => {
    const input = [{ unitNumber: 'A1', tenantName: 'New brand', floorLevel: 'Lower', passingRentPa: 50000 }];
    const first = await upsertChatTenancySchedule(db, 'property', input);
    assert.equal(first.inserted, 1); assert.equal(first.updated, 0);
    const before = await snapshot(); const again = await upsertChatTenancySchedule(db, 'property', input);
    assert.equal(again.inserted, 0); assert.equal(again.skipped, 1); assert.equal(again.needsReview, 0);
    assert.match(again.message, /0 added, 0 updated, 1 already present, 0 need review/);
    assert.equal(await snapshot(), before);
  });
  await check('ChatBGP explicit edits keep unspecified values and accept zero without creating a new row', async () => {
    const result = await upsertChatTenancySchedule(db, 'property', [{ id: 'keep', passingRentPa: 0, comments: null, tenantName: undefined }]);
    assert.equal(result.updated, 1); assert.equal(result.inserted, 0);
    const saved = (await records()).find(r => r.id === 'keep');
    assert.equal(Number(saved.passing_rent_pa), 0); assert.equal(saved.comments, 'Human note'); assert.equal(saved.tenant_name, 'Human tenant');
    assert.equal((await db.query("SELECT tenancy_unit_id FROM evidence_plan_units WHERE id='outline'")).rows[0].tenancy_unit_id, 'keep');
  });
  await check('ChatBGP foreign-property IDs reject the entire mixed request before editing or adding anything', async () => {
    await db.query("INSERT INTO tenancy_schedule_units (id,property_id,unit_number) VALUES ('other-unit','other','A1')");
    const before = await snapshot();
    await assert.rejects(() => upsertChatTenancySchedule(db, 'property', [{ id: 'keep', comments: 'Changed' }, { id: 'other-unit', comments: 'Wrong property' }, { unitNumber: 'A2' }]), error => error.status === 404);
    assert.equal(await snapshot(), before);
  });
  await check('ChatBGP differing ID-less facts are reported as review rather than updated or inserted', async () => {
    const before = await snapshot();
    const result = await upsertChatTenancySchedule(db, 'property', [{ unitNumber: 'D4', passingRentPa: 99 }]);
    assert.equal(result.inserted, 0); assert.equal(result.updated, 0); assert.equal(result.needsReview, 1);
    assert.match(result.message, /0 added, 0 updated, 0 already present, 1 need review/);
    assert.equal(await snapshot(), before);
  });
  await check('ChatBGP mixed explicit edit and new-row failure roll back together', async () => {
    const before = await snapshot();
    await assert.rejects(() => upsertChatTenancySchedule(db, 'property', [{ id: 'keep', comments: 'Changed' }, { unitNumber: 'A2', passingRentPa: -1 }]), /check constraint/);
    assert.equal(await snapshot(), before);
  });
  console.log(`PASS ${checks} tenancy import PostgreSQL checks`);
} finally {
  await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await db.end();
}
