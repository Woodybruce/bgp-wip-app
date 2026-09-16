// Applies the additive migration only to the disposable QA database; CRUD test data rolls back.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import { crmProperties, insertCrmPropertySchema } from '../../shared/schema.ts';
const require = createRequire(import.meta.url);
const { find, evaluate, ts } = require('./source-harness.cjs');
const supplied = process.env.PROPERTY_VIEW_TEST_DATABASE_URL;
if (!supplied) throw new Error('Provide the disposable PROPERTY_VIEW_TEST_DATABASE_URL');
const url = new URL(supplied);
if (url.hostname || url.pathname !== '/bgp_smoke'
  || url.searchParams.get('host') !== '/tmp/bgp-propertyqa-20260916/socket'
  || url.searchParams.get('port') !== '55446') throw new Error('Refusing non-disposable property QA database');
const client = new pg.Client({ connectionString: supplied, ssl: false });
await client.connect();
let checks = 0;
const check = (name, fn) => { fn(); checks++; console.log(`PASS ${name}`); };
try {
  const before = (await client.query('SELECT id, name, asset_class FROM crm_properties ORDER BY id')).rows;
  const migration = await readFile(new URL('../../migrations/0037_property_view.sql', import.meta.url), 'utf8');
  await client.query(migration);
  await client.query(migration);
  const after = (await client.query('SELECT id, name, asset_class FROM crm_properties ORDER BY id')).rows;
  check('migration is repeatable and preserves property identities and classifications', () => assert.deepEqual(after, before));
  const constraints = (await client.query("SELECT conname FROM pg_constraint WHERE conname='crm_properties_property_view_check' AND conrelid='crm_properties'::regclass")).rows;
  check('migration installs one property-view constraint', () => assert.equal(constraints.length, 1));

  await client.query('BEGIN');
  const methods = ['createCrmProperty', 'getCrmProperty', 'updateCrmProperty'].map(name => find('server/storage.ts', node => ts.isMethodDeclaration(node) && node.name?.getText() === name));
  const { storage } = evaluate(`export const storage = { ${methods.join(',\n')} };`, { db: drizzle(client), eq, crmProperties });
  const created = await storage.createCrmProperty(insertCrmPropertySchema.parse({ name: `QA property view ${randomUUID()}`, assetClass: 'Mixed Use', notes: 'Keep the schedule and facts' }));
  check('actual Drizzle create defaults to automatic', () => assert.equal(created.propertyView, null));
  for (const propertyView of ['building', 'multi_let', 'centre', null]) {
    const saved = await storage.updateCrmProperty(created.id, { propertyView });
    const read = await storage.getCrmProperty(created.id);
    check(`actual Drizzle write and read round-trip ${propertyView ?? 'automatic'}`, () => {
      assert.equal(saved.propertyView, propertyView);
      assert.equal(read.propertyView, propertyView);
      assert.equal(read.assetClass, 'Mixed Use');
      assert.equal(read.notes, 'Keep the schedule and facts');
    });
  }
  await client.query('SAVEPOINT invalid_layout');
  await assert.rejects(client.query('UPDATE crm_properties SET property_view=$1 WHERE id=$2', ['unknown', created.id]), error => error.code === '23514');
  await client.query('ROLLBACK TO SAVEPOINT invalid_layout');
  const unchanged = await storage.getCrmProperty(created.id);
  check('database rejects invalid writes outside HTTP validation without changing the saved choice', () => assert.equal(unchanged.propertyView, null));
  await client.query('ROLLBACK');
  console.log(`${checks} disposable PostgreSQL checks passed.`);
} finally {
  await client.query('ROLLBACK').catch(() => {});
  await client.end();
}
