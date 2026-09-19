import assert from 'node:assert/strict';
import test from 'node:test';
import { validatePlanUnitLink, validatePropertyPlanPolygon, propertyPlanUnitStatus } from '../../server/property-plan-links.ts';

const concave = { points: [[0.1, 0.1], [0.8, 0.1], [0.8, 0.4], [0.4, 0.4], [0.4, 0.8], [0.1, 0.8]] };
test('plan unit geometry keeps a real concave boundary and rejects crossed/out-of-image shapes', () => {
  assert.deepEqual(validatePropertyPlanPolygon(concave), concave);
  for (const points of [
    [[0, 0], [1, 1], [0, 1], [1, 0]],
    [[0, 0], [1, 0], [1, 2]],
    [[0, 0], [1, 0], [NaN, 1]],
    [[0, 0], ['1', 0], [1, 1]],
    [[0, 0], [1, 0], [1, 1], [0, 0]],
    [[0, 0], [1, 0]],
    [[0, 0, 7], [1, 0], [1, 1]],
  ]) assert.throws(() => validatePropertyPlanPolygon({ points }), /boundary/);
});

function dbFixture() {
  const queries = [];
  return { queries, async query(sql, values) {
    queries.push({ sql, values });
    assert.doesNotMatch(sql, /\b(?:UPDATE|INSERT|DELETE)\b/);
    if (values[1] !== 'own-property') return { rows: [] };
    if (sql.includes('tenancy_schedule_units')) return { rows: values[0] === 'tenancy' ? [{ id: 'tenancy', property_unit_id: 'physical' }] : values[0] === 'no-master' ? [{ id: 'no-master', property_unit_id: null }] : [] };
    if (sql.includes('property_units')) return { rows: values[0] === 'physical' ? [{ id: 'physical' }] : [] };
    throw new Error('Unexpected query');
  } };
}

test('canonical links derive their physical identity without creating any units', async () => {
  const db = dbFixture();
  assert.deepEqual(await validatePlanUnitLink(db, 'own-property', { tenancy_unit_id: 'tenancy' }), { tenancy_unit_id: 'tenancy', unit_id: 'physical' });
  assert.deepEqual(await validatePlanUnitLink(db, 'own-property', { tenancy_unit_id: 'tenancy', unit_id: null }), { tenancy_unit_id: 'tenancy', unit_id: 'physical' });
  assert.deepEqual(await validatePlanUnitLink(db, 'own-property', { tenancy_unit_id: 'no-master' }), { tenancy_unit_id: 'no-master', unit_id: null });
  assert.ok(db.queries.every(q => /FOR SHARE/.test(q.sql)), 'a transactional save must lock referenced rows against identity changes');
});

test('foreign and inconsistent physical/tenancy links fail before any write', async () => {
  const db = dbFixture();
  for (const [property, link] of [
    ['other-property', { tenancy_unit_id: 'tenancy' }],
    ['own-property', { tenancy_unit_id: 'missing' }],
    ['own-property', { unit_id: 'foreign-physical' }],
    ['own-property', { tenancy_unit_id: 'tenancy', unit_id: 'different' }],
    ['own-property', { tenancy_unit_id: 'no-master', unit_id: 'physical' }],
    ['own-property', { tenancy_unit_id: 42 }],
  ]) await assert.rejects(validatePlanUnitLink(db, property, link), error => error.status === 400);
});

test('explicit null unlinks and a physical-only choice remains a supported legacy link', async () => {
  const db = dbFixture();
  assert.deepEqual(await validatePlanUnitLink(db, 'own-property', { tenancy_unit_id: null, unit_id: null }), { tenancy_unit_id: null, unit_id: null });
  assert.deepEqual(await validatePlanUnitLink(db, 'own-property', { tenancy_unit_id: null }), { tenancy_unit_id: null, unit_id: null });
  assert.deepEqual(await validatePlanUnitLink(db, 'own-property', { unit_id: 'physical' }), { tenancy_unit_id: null, unit_id: 'physical' });
});

test('canonical vacancy and tracker codes drive plan colours without stale tenant/expiry overriding them', () => {
  const now = Date.parse('2026-09-01');
  const row = { unit_id: 'unit', tenancy_unit_id: 'tenancy', tenant_name: 'Old tenant', lease_expiry: '2026-12-01' };
  assert.equal(propertyPlanUnitStatus({ ...row, lease_status: 'Vacant' }, now), 'vacant');
  assert.equal(propertyPlanUnitStatus({ ...row, marketing_status: 'AVA' }, now), 'vacant');
  assert.equal(propertyPlanUnitStatus({ ...row, marketing_status: 'HOT' }, now), 'under_offer');
  assert.equal(propertyPlanUnitStatus({ ...row, marketing_status: 'SOL' }, now), 'under_offer');
  assert.equal(propertyPlanUnitStatus({ ...row, lease_status: 'Under Offer' }, now), 'under_offer');
  assert.equal(propertyPlanUnitStatus({ ...row, lease_status: 'Vacant', occupancy_status: 'Trading' }, now), 'vacant');
  assert.equal(propertyPlanUnitStatus({ ...row, lease_status: 'Occupied', occupancy_status: 'Vacant', lease_expiry: null, marketing_status: 'COM' }, now), 'occupied');
  assert.equal(propertyPlanUnitStatus({ ...row, lease_status: 'Occupied', occupancy_status: 'Vacant', lease_expiry: null, marketing_status: 'AVA' }, now), 'occupied');
  assert.equal(propertyPlanUnitStatus({ ...row, active_deals: [{ id: 'deal' }], marketing_status: 'HOT' }, now), 'deal_in_progress');
  assert.equal(propertyPlanUnitStatus({ ...row, status_override: 'occupied', marketing_status: 'HOT' }, now), 'occupied');
  assert.equal(propertyPlanUnitStatus(row, now), 'lease_event');
  assert.equal(propertyPlanUnitStatus({ ...row, lease_expiry: '2020-01-01', lease_break: '2026-12-01' }, now), 'lease_event');
  assert.equal(propertyPlanUnitStatus({ tenant_name: 'Vacant' }, now), 'unlinked');
  assert.equal(propertyPlanUnitStatus({ tenancy_unit_id: 'tenancy', lease_expiry: null }, now), 'unknown');
});
