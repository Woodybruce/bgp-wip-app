import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareChatTenancyRows } from '../../server/chatbgp-tenancy-import.ts';

test('ChatBGP uses only supplied fields and retains legitimate zero values', () => {
  const result = prepareChatTenancyRows([{ id: 'existing', passingRentPa: 0, comments: null, tenantName: undefined, leaseExpiry: '' }]);
  assert.deepEqual(result.rows, []);
  assert.deepEqual(result.explicitEdits, [{ id: 'existing', sourceRow: 1, values: { passing_rent_pa: 0 } }]);
});

test('ID-less extraction preserves floor and demise context for conservative identity matching', () => {
  const result = prepareChatTenancyRows([{ unitNumber: 'A1', floorLevel: 'Upper', premises: 'gbp123456', tenantName: 'Brand', leaseExpiry: '2031-02-03' }]);
  assert.deepEqual(result.rows[0].values, { unit_number: 'A1', premises: 'gbp123456', floor_level: 'Upper', tenant_name: 'Brand', lease_expiry: '2031-02-03', status: 'Occupied', sort_order: 0 });
});

test('missing tenants do not silently invent a vacant status and explicit edits do not infer status', () => {
  assert.equal('status' in prepareChatTenancyRows([{ unitNumber: 'A1' }]).rows[0].values, false);
  assert.equal('status' in prepareChatTenancyRows([{ id: 'existing', tenantName: 'Brand' }]).explicitEdits[0].values, false);
  assert.equal(prepareChatTenancyRows([{ unitNumber: 'A1', tenantName: 'Vacant' }]).rows[0].values.status, 'Vacant');
});

test('invalid extractor dates and numbers fail before any writes', () => {
  for (const rows of [[], [null], [{ id: '' }], [{ unitNumber: 'A1', passingRentPa: NaN }], [{ unitNumber: 'A1', passingRentPa: '100,000' }], [{ unitNumber: 'A1', leaseExpiry: 'not a date' }], [{ unitNumber: 'A1', comments: {} }]]) {
    assert.throws(() => prepareChatTenancyRows(rows), error => error.status === 400);
  }
});

test('calendar dates cannot silently roll into another month or guess US date order', () => {
  for (const leaseExpiry of ['2031-02-29', '2032-02-30', '03/04/2031', '2031-13-01', 0, true, '2031-05-01T23:00:00-04:00']) {
    assert.throws(() => prepareChatTenancyRows([{ unitNumber: 'A1', leaseExpiry }]), error => error.status === 400);
  }
  assert.equal(prepareChatTenancyRows([{ unitNumber: 'A1', leaseExpiry: '2032-02-29' }]).rows[0].values.lease_expiry, '2032-02-29');
});
