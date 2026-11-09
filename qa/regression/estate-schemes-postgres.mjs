// Real SQL for the estate-schemes work (2026-09-28) in an isolated schema of
// a disposable local database only: migration 0048 (twice), the PO rule, the
// unit-name resolver, scheme relabelling, the leasing-minutes apply and the
// email-domain move.
//   ESTATE_SCHEMES_DATABASE_URL=postgresql://postgres:…@127.0.0.1:5432/bgp_estate_regression \
//     node --import tsx qa/regression/estate-schemes-postgres.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import XLSX from 'xlsx';

const supplied = process.env.ESTATE_SCHEMES_DATABASE_URL;
if (!supplied) throw new Error('Provide ESTATE_SCHEMES_DATABASE_URL for the disposable database');
const url = new URL(supplied);
if (url.pathname !== '/bgp_estate_regression' || !['127.0.0.1', 'localhost', ''].includes(url.hostname)) throw new Error('Refusing non-disposable database');
process.env.DATABASE_URL = supplied;
const schema = `qa_estate_${process.pid}_${Date.now()}`;
const db = new pg.Pool({ connectionString: supplied, ssl: false, max: 4, options: `-c search_path=${schema}` });

const { dealPoCheck } = await import('../../server/deal-po.ts');
const { resolveEstateUnit } = await import('../../server/estate-units.ts');
const { relabelScheme, ensureScheme, schemeDealDefaults } = await import('../../server/property-schemes.ts');
const { importLeasingMinutes } = await import('../../server/leasing-minutes.ts');
const { moveCompanyEmailDomain } = await import('../../server/contact-email-domain.ts');

let checks = 0;
const check = async (name, fn) => { await fn(); checks++; console.log(`PASS ${name}`); };
try {
  await db.query(`CREATE SCHEMA ${schema}`);
  await db.query(`
    CREATE TABLE crm_properties (id text PRIMARY KEY, name text, aliases jsonb, landlord_id text);
    CREATE TABLE crm_companies (id text PRIMARY KEY, name text, parent_company_id text, updated_at timestamptz DEFAULT now());
    CREATE TABLE crm_contacts (id text PRIMARY KEY, name text, email text, company_id text, updated_at timestamptz DEFAULT now());
    CREATE TABLE crm_deals (id text PRIMARY KEY, property_id text, landlord_id text, tenant_id text, vendor_id text, purchaser_id text,
      bgp_acting_for text DEFAULT 'landlord', po_number text, tenancy_unit_id text, updated_at timestamptz DEFAULT now());
    CREATE TABLE tenancy_schedule_units (id text PRIMARY KEY DEFAULT gen_random_uuid()::text, property_id text, unit_number text, premises text, status text, updated_at timestamptz DEFAULT now());
    CREATE TABLE leasing_schedule_units (id text PRIMARY KEY DEFAULT gen_random_uuid()::text, property_id text, unit_name text, zone text, tenant_name text,
      sqft real, status text, updates text, financial_notes text, lease_expiry timestamp, lease_break timestamp, sort_order int DEFAULT 0,
      tenancy_unit_id text, updated_at timestamptz DEFAULT now());
    CREATE TABLE available_units (id text PRIMARY KEY, property_id text, unit_name text, tenancy_unit_id text, updated_at timestamptz DEFAULT now());
    CREATE TABLE leasing_schedule_audit (id serial PRIMARY KEY, unit_id text, property_id text, user_id text, user_name text, action text, field_name text, old_value text, new_value text);
    INSERT INTO crm_companies VALUES ('cwg', 'Canary Wharf Group', NULL), ('cwr', 'Canary Wharf Retail Limited', 'cwg'), ('brand', 'Some Brand', NULL);
    INSERT INTO crm_properties VALUES ('cw', 'Canary Wharf Estate, London E14, UK', '["Canary Wharf"]', 'cwg'), ('bw', 'Bluewater Shopping Centre', NULL, NULL);
  `);
  const migration = readFileSync(new URL('../../migrations/0048_property_schemes.sql', import.meta.url), 'utf8');

  await check('migration 0048 applies and re-applies', async () => {
    await db.query(migration);
    await db.query(migration);
    const cols = (await db.query(`SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = $1 AND column_name IN ('grouping','unit_code','scheme','requires_po')`, [schema])).rows.map(r => `${r.table_name}.${r.column_name}`).sort();
    assert.deepEqual(cols, ['available_units.scheme', 'crm_companies.requires_po', 'crm_deals.scheme', 'leasing_schedule_units.unit_code', 'tenancy_schedule_units.grouping']);
    await db.query(`INSERT INTO property_schemes (property_id, name) VALUES ('cw', 'Jubilee Place')`);
    await assert.rejects(db.query(`INSERT INTO property_schemes (property_id, name) VALUES ('cw', ' jubilee place ')`), /duplicate key/);
    await db.query(`DELETE FROM property_schemes`);
  });

  await check('the PO rule: parent flag, scheme entity, tenant only when BGP acts for the tenant', async () => {
    await db.query(`UPDATE crm_companies SET requires_po = true WHERE id = 'cwg' AND requires_po IS NULL`);
    await ensureScheme(db, 'cw', 'Jubilee Place', { billing_entity_id: 'cwr' });
    await db.query(`INSERT INTO crm_deals (id, property_id, landlord_id, scheme) VALUES ('d-child', NULL, 'cwr', NULL), ('d-scheme', 'cw', NULL, 'Jubilee Place'),
      ('d-other', 'bw', 'brand', NULL), ('d-po', 'cw', 'cwg', NULL)`);
    await db.query(`UPDATE crm_deals SET po_number = '4500123' WHERE id = 'd-po'`);
    await db.query(`UPDATE crm_companies SET requires_po = true WHERE id = 'brand'`);
    await db.query(`INSERT INTO crm_deals (id, property_id, tenant_id, bgp_acting_for) VALUES ('d-tenant-l', 'bw', 'brand', 'landlord'), ('d-tenant-t', 'bw', 'brand', 'tenant')`);
    await db.query(`UPDATE crm_deals SET landlord_id = NULL WHERE id LIKE 'd-tenant%'`);
    assert.deepEqual((await dealPoCheck(db, 'd-child')).requiredBy.map(c => c.id), ['cwr'], 'subsidiary of a PO client');
    assert.equal((await dealPoCheck(db, 'd-scheme')).missing, true, 'property landlord / scheme entity');
    assert.equal((await dealPoCheck(db, 'd-po')).missing, false);
    assert.equal((await dealPoCheck(db, 'd-tenant-l')).required, false, 'the tenant is not billed on a landlord-side deal');
    assert.equal((await dealPoCheck(db, 'd-tenant-t')).required, true);
    await db.query(`UPDATE crm_companies SET requires_po = NULL WHERE id = 'brand'`);
  });

  await check('scheme deal defaults read the scheme entity', async () => {
    assert.deepEqual(await schemeDealDefaults(db, { propertyId: 'cw', scheme: 'JUBILEE PLACE' }), { scheme: 'Jubilee Place', xeroContactName: 'Canary Wharf Retail Limited' });
  });

  await check('unit names resolve onto the estate', async () => {
    await ensureScheme(db, 'cw', 'Wharf Kitchen');
    await db.query(`INSERT INTO tenancy_schedule_units (id, property_id, unit_number) VALUES ('t-k3', 'cw', 'Kiosk 3 Wharf Kitchen')`);
    const k3 = await resolveEstateUnit(db, 'Kiosk 3 Wharf Kitchen');
    assert.deepEqual([k3.propertyId, k3.unitId, k3.created], ['cw', 't-k3', false]);
    const u48 = await resolveEstateUnit(db, 'Unit 48 Jubilee Place');
    assert.equal(u48.created, true);
    assert.deepEqual((await db.query(`SELECT unit_number, grouping, status FROM tenancy_schedule_units WHERE id = $1`, [u48.unitId])).rows[0], { unit_number: 'Unit 48 Jubilee Place', grouping: 'Jubilee Place', status: null });
    const rs = await resolveEstateUnit(db, 'Unit RS315 Canary Wharf');
    assert.equal(rs.propertyId, 'cw');
    assert.equal(await resolveEstateUnit(db, 'Unit 2 Nowhere'), null);
    assert.equal((await db.query(`SELECT count(*)::int AS n FROM crm_properties`)).rows[0].n, 2, 'no property created');
  });

  await check('renaming a scheme relabels the boards', async () => {
    await db.query(`INSERT INTO leasing_schedule_units (property_id, unit_name, zone) VALUES ('cw', 'CR40', 'Crossrail'), ('cw', 'CR38', 'CROSSRAIL'), ('bw', 'X', 'Crossrail')`);
    assert.equal(await relabelScheme(db, 'cw', 'Crossrail', 'Crossrail Place'), 2);
    assert.deepEqual((await db.query(`SELECT DISTINCT zone FROM leasing_schedule_units WHERE property_id = 'cw' AND unit_name LIKE 'CR%'`)).rows, [{ zone: 'Crossrail Place' }]);
    assert.equal((await db.query(`SELECT zone FROM leasing_schedule_units WHERE property_id = 'bw'`)).rows[0].zone, 'Crossrail', 'other properties untouched');
  });

  await check('leasing minutes apply in one transaction, idempotently', async () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      [null, 'Property', 'Previous/Current Tenant', 'Unit Size (sqft)', '2026 ERVs & RF', 'Offers', 'Targets / Comments'],
      [null, 'Cabot Place Voids'],
      [null, 'Cabot Place\r\nUnit 4\r\nYardi 29200004', 'Vacant', '890', 'BP26: £90,000', 'Facegym (Under Offer)', 'HOTs agreed, sols instructed'],
      [null, 'Crossrail Voids'],
      [null, 'Crossrail\r\nUnit 40\r\nYardi 12000040', 'Vacant- Platform', '4719', 'BP26: £185,000', null, 'Enmei - toured with CEO'],
    ]), 'Units to let - Wc 23.03');
    const buf = Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
    await db.query(`INSERT INTO leasing_schedule_units (property_id, unit_name, status, sqft) VALUES ('cw', 'Unit 4 Cabot Place', 'Vacant', 900)`);
    await ensureScheme(db, 'cw', 'Crossrail Place');
    const user = { id: 'u1', username: 'woody' };
    const first = await importLeasingMinutes(db, 'cw', buf, { dryRun: false, user, fileName: 'minutes.xlsx' });
    assert.deepEqual(first.counts, { create: 1, update: 1, unchanged: 0, statusChanges: 1 });
    const cabot = (await db.query(`SELECT zone, unit_code, status, sqft, updates FROM leasing_schedule_units WHERE unit_name = 'Unit 4 Cabot Place'`)).rows[0];
    assert.deepEqual([cabot.zone, cabot.unit_code, cabot.status, cabot.sqft], ['Cabot Place', '29200004', 'Under Offer', 900]);
    assert.match(cabot.updates, /Minutes w\/c 23\.03/);
    const created = (await db.query(`SELECT zone, unit_code FROM leasing_schedule_units WHERE unit_name = 'Unit 40 Crossrail Place'`)).rows[0];
    assert.deepEqual(created, { zone: 'Crossrail Place', unit_code: '12000040' }, '"Crossrail Voids" lands on the saved Crossrail Place scheme');
    assert.ok((await db.query(`SELECT count(*)::int AS n FROM leasing_schedule_audit WHERE action LIKE 'minutes_%'`)).rows[0].n >= 5);
    const schemes = (await db.query(`SELECT name, code FROM property_schemes WHERE property_id = 'cw' ORDER BY name`)).rows;
    assert.ok(schemes.some(s => s.name === 'Cabot Place' && s.code === null), 'one unit is no evidence of a scheme code');
    const again = await importLeasingMinutes(db, 'cw', buf, { dryRun: false, user, fileName: 'minutes.xlsx' });
    assert.deepEqual(again.counts, { create: 0, update: 0, unchanged: 2, statusChanges: 0 });
  });

  await check('email domain move on real rows', async () => {
    await db.query(`INSERT INTO crm_contacts VALUES ('a', 'Ann', 'ann@canarywharf.com', 'cwg'), ('b', 'Bob', 'Bob@CanaryWharf.com ', 'cwg'),
      ('x', 'Other Ann', 'ann@cwg.com', 'someone-else'), ('z', 'Zed', 'zed@canarywharf.com', 'cwr')`);
    const preview = await moveCompanyEmailDomain(db, 'cwg', 'canarywharf.com', 'cwg.com', false);
    assert.deepEqual(preview.rows.map(r => [r.id, r.to, !!r.skipped]), [['a', 'ann@cwg.com', true], ['b', 'Bob@cwg.com', false]]);
    const applied = await moveCompanyEmailDomain(db, 'cwg', 'canarywharf.com', 'cwg.com', true);
    assert.equal(applied.changed, 1);
    assert.deepEqual((await db.query(`SELECT id, email FROM crm_contacts ORDER BY id`)).rows.map(r => `${r.id}:${r.email}`), ['a:ann@canarywharf.com', 'b:Bob@cwg.com', 'x:ann@cwg.com', 'z:zed@canarywharf.com']);
  });
  console.log(`${checks} checks passed`);
} finally {
  await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => {});
  await db.end();
  const { pool } = await import('../../server/db.ts');
  await pool.end().catch(() => {});
}
