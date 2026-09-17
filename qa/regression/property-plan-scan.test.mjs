import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { suggestPropertyPlanLink, scanPropertyPlanImage } from '../../server/property-plan-scan.ts';
import { validatePropertyScanAssignments } from '../../server/property-plan-scan-store.ts';
import sharp from 'sharp';

const option = (id, unit_name, tenant_name = 'Tea Shop') => ({ tenancy_unit_id: id, unit_id: null, unit_name, tenant_name });
test('plan scan suggestions require a unique compatible canonical identity', () => {
  const row = option('schedule-1', 'Unit A01');
  assert.equal(suggestPropertyPlanLink('A1', 'Tea Shop', [row]), row);
  assert.equal(suggestPropertyPlanLink('A1', null, [row, option('duplicate', 'A1')]), null);
  assert.equal(suggestPropertyPlanLink('A1', 'Different Shop', [row]), null);
  assert.equal(suggestPropertyPlanLink('A9', 'Tea Shop', [row]), null, 'never override a conflicting printed reference with a tenant match');
  assert.equal(suggestPropertyPlanLink(null, 'Tea Shop', [row]), row);
  assert.equal(suggestPropertyPlanLink(null, 'Tea Shop', [row, option('second-shop', 'A2')]), null);
  assert.equal(suggestPropertyPlanLink('A1', 'Tea Shop', [{ ...row, tenancy_unit_id: null, unit_id: 'physical-only' }]), null);
});

test('scan acceptance normalises order for retries and rejects malformed or repeated choices', () => {
  const a = { candidateId: 'candidate-1', label: ' A1 ', tenancy_unit_id: 'tenant-1', unit_id: null };
  const b = { candidateId: 'candidate-2', label: 'A2' };
  assert.deepEqual(validatePropertyScanAssignments({ assignments: [b, a] }), [
    { candidateId: 'candidate-1', tenancy_unit_id: 'tenant-1', unit_id: null, label: 'A1' },
    { candidateId: 'candidate-2', tenancy_unit_id: null, unit_id: null, label: 'A2' },
  ]);
  for (const assignments of [[], [a, a], [{ ...a, label: '' }], [{ ...a, tenancy_unit_id: {} }], [{ ...a, candidateId: 'other-job' }]]) {
    assert.throws(() => validatePropertyScanAssignments({ assignments }), error => error.status === 400);
  }
});

test('an unavailable provider produces an explicit failure, not a successful empty scan', async () => {
  const image = await sharp({ create: { width: 100, height: 100, channels: 3, background: '#fff' } }).png().toBuffer();
  let calls = 0;
  await assert.rejects(scanPropertyPlanImage(image, [], [], async () => {}, async () => { calls++; throw new Error('provider down'); }), /scan service could not read/);
  assert.equal(calls, 20, 'ten bounded sections, at most two attempts each');
});

test('property scans pass property type, floor and current tenancy uses to every identity read', async () => {
  const image = await sharp({ create: { width: 100, height: 100, channels: 3, background: '#fff' } }).png().toBuffer();
  const contexts = [];
  const options = [{ ...option('office', 'Office 1', null), floor: 'First', permitted_use: 'Office', lease_status: 'Occupied' },
    { ...option('storage', 'S1', null), floor: 'Basement', permitted_use: 'Storage', lease_status: 'Vacant' },
    { ...option('old', 'Old retail', null), permitted_use: 'Shop', lease_status: 'Archived' }];
  await scanPropertyPlanImage(image, options, [], async () => {}, async (...args) => { contexts.push(args[12]); return []; },
    { propertyName: 'Market House', assetClass: 'Mixed use', floor: 'First' });
  assert.ok(contexts.length > 0);
  for (const context of contexts) assert.deepEqual(context, { kind: 'property', propertyName: 'Market House', assetClass: 'Mixed use', floor: 'First', tenancyUnits: [
    { unitRef: 'Office 1', floor: 'First', permittedUse: 'Office' }, { unitRef: 'S1', floor: 'Basement', permittedUse: 'Storage' },
  ] });
});

test('property scan worker loads property context without changing access or saved outlines', async () => {
  const require = createRequire(import.meta.url);
  const { find, evaluate, ts } = require('./source-harness.cjs');
  const worker = find('server/property-plan-scanning.ts', node => ts.isFunctionDeclaration(node) && node.name?.text === 'runPropertyPlanScan');
  const calls = [], updates = [];
  const { run } = evaluate(worker + '\nexports.run = runPropertyPlanScan;', {
    setInterval, clearInterval, getFile: async () => ({ data: Buffer.from('image') }),
    queryPickableUnits: async (_db, propertyId) => { assert.equal(propertyId, 'own-property'); return [{ unit_name: 'Suite 1', permitted_use: 'Office' }]; },
    scanPropertyPlanImage: async (...args) => { calls.push(args); return { candidates: [], message: 'No proposals' }; },
    pool: { query: async (sql, values) => {
      if (sql.startsWith('SELECT name, asset_class')) { assert.deepEqual(Array.from(values), ['own-property']); return { rows: [{ name: 'Market House', asset_class: 'Mixed use' }] }; }
      if (sql.startsWith('SELECT polygon')) return { rows: [{ polygon: { points: [[0, 0], [.2, 0], [.2, .2]] } }] };
      assert.match(sql, /^UPDATE property_plan_scans/); updates.push(sql); return { rows: [{ id: 'job' }] };
    } },
  });
  await run({ id: 'job' }, { id: 'plan', property_id: 'own-property', storage_key: 'image', floor: 'First' });
  assert.equal(calls.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0][5])), { propertyName: 'Market House', assetClass: 'Mixed use', floor: 'First' });
  assert.equal(calls[0][2].length, 1, 'saved outlines remain protected inputs');
  assert.ok(updates.some(sql => sql.includes("status='ready'")));
});

test('non-serialisable plan images stay out of the persistent query cache', () => {
  const require = createRequire(import.meta.url);
  const { source, evaluate } = require('./source-harness.cjs');
  const store = new Map();
  const { persistOptions } = evaluate(source('client/src/lib/query-persist.ts'), {
    require: name => { assert.equal(name, '@tanstack/react-query'); return { defaultShouldDehydrateQuery: () => true }; },
    window: { localStorage: { setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k), getItem: k => store.get(k) } },
  });
  const query = { queryKey: ['/api/plans', 'id', 'image'], state: { data: {} }, meta: { persist: false } };
  assert.equal(persistOptions.dehydrateOptions.shouldDehydrateQuery(query), false);
  assert.equal(persistOptions.dehydrateOptions.shouldDehydrateQuery({ ...query, meta: undefined, queryKey: ['/api/plans', 'id', 'units'] }), true);
  assert.equal(persistOptions.dehydrateOptions.shouldDehydrateQuery({ queryKey: ['/api/auth/me'], state: { data: null } }), false);
});
