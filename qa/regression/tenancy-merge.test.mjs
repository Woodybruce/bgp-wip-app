import assert from 'node:assert/strict';
import test from 'node:test';
import { tenancyMergeConflicts, mergeTenancyUnits } from '../../server/tenancy-merge.ts';

const row = (id, extra = {}) => ({ id, property_id: 'property', unit_number: 'F01', tenant_name: 'Shop Ltd',
  tenant_company_id: 'brand', floor_level: 'Lower', passing_rent_pa: '120000', lease_expiry: new Date('2031-01-01'),
  premises: 'premises-1', comments: 'Keep the agreed clause.', ...extra });

test('manual merge permits equivalent references and metadata differences without changing facts', () => {
  assert.deepEqual(tenancyMergeConflicts(row('keep', { created_at: new Date('2020-01-01'), sort_order: 1 }),
    row('duplicate', { unit_number: 'Unit F1', created_at: new Date('2024-01-01'), sort_order: 20 })), []);
});

test('manual merge rejects conflicting, missing and unknown facts rather than discarding or coalescing them', () => {
  for (const patch of [{ passing_rent_pa: 130000 }, { lease_expiry: new Date('2032-01-01') }, { floor_level: 'Upper' },
    { comments: 'A different clause' }, { tenant_company_id: 'BRAND' }, { premises: null }, { custom_overlay: 'Keep this too' },
    { property_unit_id: 'physical-2' }, { marketing_active: true }, { unit_number: 'F2' }]) {
    assert.ok(tenancyMergeConflicts(row('keep'), row('duplicate', patch)).includes(Object.keys(patch)[0]), JSON.stringify(patch));
  }
  assert.deepEqual(tenancyMergeConflicts(row('keep', { comments: null }), row('duplicate')), ['comments']);
});

test('invalid merge IDs fail before opening a transaction', async () => {
  const pool = { connect() { throw Error('Must not connect'); } };
  for (const ids of [['property', 'same', 'same'], ['property', null, 'second'], ['property', ['first'], 'second'], ['', 'first', 'second']]) {
    await assert.rejects(() => mergeTenancyUnits(pool, ...ids), error => error.status === 400);
  }
});
