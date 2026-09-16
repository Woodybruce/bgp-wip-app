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
