// Exercises the actual master-schedule query in a disposable, isolated schema.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import pg from 'pg';
const require = createRequire(import.meta.url);
const { find, evaluate, ts } = require('./source-harness.cjs');
const supplied = process.env.PROPERTY_BRIEF_TEST_DATABASE_URL;
if (!supplied) throw new Error('Provide the disposable PROPERTY_BRIEF_TEST_DATABASE_URL');
const url = new URL(supplied);
if (url.hostname || url.pathname !== '/bgp_smoke'
  || url.searchParams.get('host') !== '/tmp/bgp-propertyqa-20260916/socket'
  || url.searchParams.get('port') !== '55446') throw new Error('Refusing non-disposable property QA database');
const schema = `qa_asset_brief_${process.pid}_${Date.now()}`;
const db = new pg.Pool({ connectionString: supplied, ssl: false, max: 2, options: `-c search_path=${schema}` });
const file = 'server/property-asset-brief.ts';
const statement = find(file, node => ts.isNoSubstitutionTemplateLiteral(node) && node.text.startsWith('WITH schedule_source'));
const { query } = evaluate(`export const query = ${statement};`);
const linkageResolutionSql = find(file, node => ts.isNoSubstitutionTemplateLiteral(node) && node.text.includes('AS unresolved') && node.text.includes('FROM tenancy_schedule_units'));
const linkageIntegritySql = find(file, node => ts.isNoSubstitutionTemplateLiteral(node) && node.text.startsWith('WITH dups AS'));
const { resolutionQuery, integrityQuery } = evaluate(`export const resolutionQuery = ${linkageResolutionSql}; export const integrityQuery = ${linkageIntegritySql};`);
const helpers = evaluate(['briefOccupancy', 'summariseBriefSchedule'].map(name => find(file, node => ts.isFunctionDeclaration(node) && node.name?.text === name)).join('\n'));
let created = false, checks = 0;
const check = (name, fn) => { fn(); checks++; console.log(`PASS ${name}`); };
try {
  await db.query(`CREATE SCHEMA ${schema}`); created = true;
  await db.query(`
    CREATE TABLE tenancy_schedule_units(id text PRIMARY KEY, property_id text, unit_number text, premises text, tenant_name text,
      status text, occupancy_status text, lease_expiry timestamptz, break_date timestamptz, tenant_company_id text, passing_rent_pa real);
    CREATE TABLE leasing_schedule_units(id text PRIMARY KEY, property_id text, unit_name text, tenant_name text, status text,
      lease_expiry timestamptz, lease_break timestamptz, tenant_company_id text, tenancy_unit_id text, rent_pa real);
    CREATE TABLE crm_companies(id text PRIMARY KEY, name text, merged_into_id text, aml_pep_status text, kyc_status text);
    CREATE TABLE crm_deals(id text PRIMARY KEY, property_id text, unit_id text, tenancy_unit_id text, status text);
    CREATE TABLE property_units(id text PRIMARY KEY, property_id text, unit_name text);
    CREATE TABLE available_units(id text PRIMARY KEY, property_id text, unit_name text, tenancy_unit_id text, deal_id text);
    INSERT INTO crm_companies VALUES ('confirmed-brand','Same brand',NULL,NULL,NULL), ('other-brand','Same brand',NULL,NULL,'admin');
    INSERT INTO tenancy_schedule_units VALUES
      ('t1','master','1',NULL,'Same brand','Occupied',NULL,'2040-01-01',NULL,'confirmed-brand',10000),
      ('t2','master','2',NULL,NULL,'HOT','Vacant',NULL,NULL,NULL,NULL),
      ('t3','master','3',NULL,NULL,'Vacant',NULL,NULL,NULL,NULL,NULL),
      ('archived','master','old',NULL,'Former tenant','Occupied','Archived','2020-01-01',NULL,NULL,5000),
      ('archived-status','master','old-status',NULL,'Former tenant','Archived','Occupied','2020-01-01',NULL,NULL,5000),
      ('archived-spaced','master','old-spaced',NULL,'Former tenant',' aRchIved ',NULL,'2020-01-01',NULL,NULL,5000),
      ('archived-occ-spaced','master','old-occ',NULL,'Former tenant','Occupied',' aRchIved ','2020-01-01',NULL,NULL,5000),
      ('other','other-property','1',NULL,'Unrelated','Occupied',NULL,'2040-01-01',NULL,NULL,99999),
      ('history','archived-only','old',NULL,'Former','Archived',NULL,'2020-01-01',NULL,NULL,5000);
    INSERT INTO leasing_schedule_units VALUES
      ('stale','master','wrong duplicate','Other','Occupied','2040-01-01',NULL,'other-brand',NULL,90000),
      ('legacy-row','legacy','L1','Legacy tenant','Occupied','2040-01-01',NULL,NULL,NULL,10000),
      ('legacy-old','legacy','L0','Former tenant',' aRchIved ','2020-01-01',NULL,NULL,NULL,80000),
      ('historic-projection','archived-only','old','Former','Occupied','2040-01-01',NULL,NULL,NULL,5000);
    INSERT INTO crm_deals VALUES ('live',NULL,NULL,'t2','HOT'), ('completed','master',NULL,NULL,'COM');
    INSERT INTO available_units VALUES ('completed-listing','master','3','t3','completed');
    ALTER TABLE tenancy_schedule_units ADD COLUMN trading_name text;
    INSERT INTO crm_companies VALUES ('merged-brand','Former brand','confirmed-brand',NULL,NULL);
    INSERT INTO tenancy_schedule_units(id,property_id,unit_number,tenant_name,status,occupancy_status,tenant_company_id) VALUES
      ('link-current','linkage','1','Current tenant','Occupied',NULL,'confirmed-brand'),
      ('link-missing','linkage','2','Unlinked current tenant','Occupied',NULL,NULL),
      ('link-history','linkage','1','Previous tenant',' aRchIved ','Occupied','merged-brand'),
      ('link-occ-history','linkage','2','Previous unlinked tenant','Occupied',' ARChived ',NULL),
      ('link-blank','linkage','3','  ','Vacant',NULL,'confirmed-brand'),
      ('link-placeholder','linkage','4','VACANT','Vacant',NULL,'confirmed-brand');
    INSERT INTO leasing_schedule_units(id,property_id,unit_name,tenant_name,status) VALUES
      ('legacy-link-history','linkage','Historic','Previous tenant',' ArChIvEd ');
  `);
  const master = (await db.query(query, ['master'])).rows;
  check('canonical tenancy rows take priority over stale leasing projection without duplicate counts', () => {
    assert.deepEqual(master.map(row => row.id).sort(), ['t1', 't2', 't3']);
    assert.ok(master.every(row => row.schedule_source === 'tenancy'));
    const summary = helpers.summariseBriefSchedule(master);
    assert.equal(summary.performance.total_units, 3);
    assert.equal(summary.performance.occupied_units, 1);
    assert.equal(summary.performance.vacant_units, 2);
    assert.equal(summary.performance.vacancy_rate, 2 / 3);
  });
  check('confirmed occupancy wins over marketing stage; either archived status excludes the row regardless of case or spaces', () => {
    assert.equal(master.find(row => row.id === 't2').status, 'Vacant');
    assert.ok(!master.some(row => row.id === 'archived'));
  });
  check('tenant namesakes cannot duplicate occupancy or attach another company covenant', () => {
    const tenant = master.find(row => row.id === 't1');
    assert.equal(tenant.tenant_company_id, 'confirmed-brand');
    assert.equal(tenant.kyc_status, null);
    assert.equal(master.filter(row => row.id === 't1').length, 1);
  });
  check('a live HOT deal linked only through tenancy is found', () => assert.equal(master.find(row => row.id === 't2').has_live_deal, true));
  check('a completed tracker deal does not suppress a current vacancy risk', () => assert.equal(master.find(row => row.id === 't3').has_live_deal, false));
  const legacy = (await db.query(query, ['legacy'])).rows;
  check('legacy-only property retains its data with explicit partial coverage', () => {
    assert.equal(legacy.length, 1);
    assert.equal(helpers.summariseBriefSchedule(legacy).status, 'partial');
    assert.equal(helpers.summariseBriefSchedule(legacy).performance.vacancy_rate, null);
  });
  const archived = (await db.query(query, ['archived-only'])).rows;
  check('archiving master tenancy does not resurrect its stale leasing copy', () => assert.equal(archived.length, 0));
  const empty = (await db.query(query, ['empty'])).rows;
  check('property with no records remains missing rather than fully occupied', () => {
    assert.equal(helpers.summariseBriefSchedule(empty).status, 'missing');
    assert.equal(helpers.summariseBriefSchedule(empty).performance.vacancy_rate, null);
  });
  const resolution = (await db.query(resolutionQuery, ['linkage'])).rows[0];
  check('header tenant linkage counts only current named tenants with one shared numerator and denominator', () => {
    assert.deepEqual(resolution, { total: 2, resolved: 1, unresolved: 1 });
    assert.equal(resolution.resolved + resolution.unresolved, resolution.total);
  });
  const integrity = (await db.query(integrityQuery, ['linkage'])).rows[0];
  check('archived leases cannot create current duplicate-unit, merged-brand or missing-spine warnings', () => {
    assert.equal(integrity.duplicate_unit_numbers, 0);
    assert.equal(integrity.tenants_pointing_at_merged_brand, 0);
    assert.equal(integrity.leasing_units_no_unit_fk, 0);
  });
  await db.query("UPDATE tenancy_schedule_units SET status='Occupied',occupancy_status=NULL WHERE id='link-history'");
  const currentIntegrity = (await db.query(integrityQuery, ['linkage'])).rows[0];
  check('genuine current duplicate-unit and merged-brand warnings remain visible', () => {
    assert.equal(currentIntegrity.duplicate_unit_numbers, 1);
    assert.equal(currentIntegrity.tenants_pointing_at_merged_brand, 1);
  });
  console.log(`${checks} isolated PostgreSQL checks passed.`);
} finally {
  if (created) await db.query(`DROP SCHEMA ${schema} CASCADE`);
  await db.end();
}
