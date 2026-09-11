import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyTenancyImportRow, normaliseTenancyImportRef, importTenancyRows } from '../../server/tenancy-import.ts';

const incoming = values => ({ sourceRow: 7, values });
const saved = (id, values = {}) => ({ id, unit_number: 'D04', tenant_name: 'Existing tenant', passing_rent_pa: 120000, ...values });

test('schedule identity recognises prefix and leading-zero variants without substring or combined-unit guesses', () => {
  for (const ref of ['Unit D004', 'SHOP D04', 'Units D4']) assert.equal(normaliseTenancyImportRef(ref), 'D4');
  assert.equal(normaliseTenancyImportRef('Unit 001'), '1');
  assert.notEqual(normaliseTenancyImportRef('A1'), normaliseTenancyImportRef('A10'));
  assert.notEqual(normaliseTenancyImportRef('A1/A2'), normaliseTenancyImportRef('A1'));
  assert.notEqual(normaliseTenancyImportRef('Store A'), normaliseTenancyImportRef('Unit A'));
  assert.notEqual(normaliseTenancyImportRef('Store D4'), normaliseTenancyImportRef('Unit D4'));
  assert.equal(normaliseTenancyImportRef('Store D004'), normaliseTenancyImportRef('Stores D4'));
});

test('a repeated import skips the existing record and ignores worksheet sort changes', () => {
  assert.deepEqual(classifyTenancyImportRow(incoming({ unit_number: 'Unit D4', tenant_name: ' EXISTING TENANT ', passing_rent_pa: 120000, sort_order: 17 }), [saved('keep')]), { action: 'skip', existingId: 'keep' });
});

test('edited rent, notes and tenant remain reviewable instead of being overwritten or appended', () => {
  for (const patch of [{ passing_rent_pa: 90000 }, { comments: 'Different note' }, { tenant_name: 'Old tenant' }]) {
    const result = classifyTenancyImportRow(incoming({ unit_number: 'D4', ...patch }), [saved('keep', { comments: 'Human note' })]);
    assert.equal(result.action, 'review');
    assert.equal(result.review.reason, 'different_facts');
    assert.deepEqual(result.review.existingIds, ['keep']);
    assert.equal(result.review.sourceRow, 7);
    assert.deepEqual(result.review.differingFields, Object.keys(patch));
    assert.equal(result.review.candidates[0].id, 'keep');
    assert.equal(result.review.candidates[0].tenantName, 'Existing tenant');
    assert.equal(result.review.incomingValues.unit_number, 'D4');
    assert.equal('sort_order' in result.review.incomingValues, false);
  }
});

test('genuinely different floors retain separate identities and missing floors cannot pick between them', () => {
  const lower = saved('lower', { floor_level: 'Lower Level' }), upper = saved('upper', { floor_level: 'Upper Level' });
  assert.equal(classifyTenancyImportRow(incoming({ unit_number: 'D4', floor_level: 'Upper Level' }), [lower]).action, 'insert');
  assert.deepEqual(classifyTenancyImportRow(incoming({ unit_number: 'D4', floor_level: 'Lower Level' }), [lower, upper]), { action: 'skip', existingId: 'lower' });
  const ambiguous = classifyTenancyImportRow(incoming({ unit_number: 'D4' }), [lower, upper]);
  assert.equal(ambiguous.review.reason, 'ambiguous_identity');
  assert.deepEqual(ambiguous.review.existingIds, ['lower', 'upper']);
});

test('explicit demise references distinguish repeated unit names and missing premises stay ambiguous', () => {
  const a = saved('first', { premises: 'gbp085001' }), b = saved('second', { premises: 'gbp085002' });
  assert.equal(classifyTenancyImportRow(incoming({ unit_number: 'D4', premises: 'gbp085002' }), [a]).action, 'insert');
  assert.deepEqual(classifyTenancyImportRow(incoming({ unit_number: 'D4', premises: 'gbp085002' }), [a, b]), { action: 'skip', existingId: 'second' });
  assert.equal(classifyTenancyImportRow(incoming({ unit_number: 'D4' }), [a, b]).review.reason, 'ambiguous_identity');
});

test('multiple existing copies stay untouched even if their imported values agree', () => {
  const result = classifyTenancyImportRow(incoming({ unit_number: 'D4', tenant_name: 'Existing tenant' }), [saved('one'), saved('two')]);
  assert.equal(result.review.reason, 'ambiguous_identity');
  assert.deepEqual(result.review.existingIds, ['one', 'two']);
});

test('numeric and date encodings agree without requiring matching DB driver value types', () => {
  assert.equal(classifyTenancyImportRow(incoming({ unit_number: 'D4', lease_expiry: '2031-05-04', passing_rent_pa: 120000 }), [saved('keep', { lease_expiry: new Date('2031-05-04T00:00:00Z'), passing_rent_pa: '120000' })]).action, 'skip');
});

test('empty unit and premises do not treat a tenant name as a physical-unit identity', () => {
  assert.equal(classifyTenancyImportRow(incoming({ tenant_name: 'Chain across three shops' }), []).review.reason, 'missing_identity');
});

test('missing source columns do not erase data already entered by staff', () => {
  assert.equal(classifyTenancyImportRow(incoming({ unit_number: 'D4' }), [saved('keep', { comments: 'Human note', lease_expiry: '2031-05-04', floor_level: 'Lower' })]).action, 'skip');
});

test('empty and malformed imports are rejected before opening a transaction', async () => {
  const db = { connect() { throw new Error('must not connect'); } }, options = { allowedFields: ['unit_number', 'passing_rent_pa'] };
  await assert.rejects(() => importTenancyRows(db, 'property', [], options), error => error.status === 400);
  await assert.rejects(() => importTenancyRows(db, 'property', [incoming({ unit_number: 'D4', id: 'forged' })], options), error => error.status === 400);
  await assert.rejects(() => importTenancyRows(db, 'property', [incoming({ unit_number: 'D4', passing_rent_pa: Infinity })], options), error => error.status === 400);
});

test('an explicit replacement with conflicting duplicate source rows is rejected before deleting anything', async () => {
  const db = { connect() { throw new Error('must not connect'); } };
  await assert.rejects(() => importTenancyRows(db, 'property', [incoming({ unit_number: 'D4', passing_rent_pa: 10 }), incoming({ unit_number: 'Unit D04', passing_rent_pa: 20 })],
    { clearExisting: true, allowedFields: ['unit_number', 'passing_rent_pa'] }), error => error.status === 400);
});
