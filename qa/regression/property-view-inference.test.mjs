import assert from 'node:assert/strict';
import test from 'node:test';
import { currentPropertyUnits, propertyOverviewFacts, suggestPropertyView } from '../../shared/property-view.ts';

const unit = (id, extras = {}) => ({ id, unit_number: `Unit ${id}`, status: 'Occupied', ...extras });

test('an absent, empty, archived-only or tracker-only schedule cannot establish a building format', () => {
  for (const rows of [undefined, [], [unit('old', { status: ' Archived ' })], [unit('vacant-1', { status: 'AVA', is_vacant: true })]]) {
    assert.equal(suggestPropertyView('Retail', rows), null);
  }
  assert.equal(suggestPropertyView('Mixed Use', undefined), 'multi_let', 'known use chooses presentation without claiming a unit count');
});

test('explicit shopping-centre, retail-park and industrial-estate classes retain the full page without waiting for a schedule', () => {
  for (const assetClass of ['Shopping Centre', 'SHOPPING CENTER', 'Retail Park', 'Industrial Estate', 'Retail, Shopping Centre']) {
    assert.equal(suggestPropertyView(assetClass, undefined), 'centre', assetClass);
  }
  assert.equal(suggestPropertyView('Retail', undefined), null);
  assert.equal(suggestPropertyView('Office', undefined), 'building');
  assert.equal(suggestPropertyView('Office', []), 'building');
  assert.equal(suggestPropertyView('Residential', undefined), 'building');
  assert.equal(suggestPropertyView('Office', [unit('1'), unit('2')]), 'multi_let', 'actual multiple units override the simpler empty-state default');
});

test('a single current physical unit suggests building while multiple leases on it do not inflate the count', () => {
  assert.equal(suggestPropertyView('Retail', [unit('1')]), 'building');
  assert.equal(suggestPropertyView('Retail', [unit('1', { property_unit_id: 'physical-1' }), unit('2', { property_unit_id: 'physical-1' }), unit('old', { status: 'Archived', property_unit_id: 'physical-old' })]), 'building');
});

test('multiple physical units and explicit mixed use suggest a multi-let layout', () => {
  assert.equal(suggestPropertyView('Retail', [unit('1', { property_unit_id: 'physical-1' }), unit('2', { property_unit_id: 'physical-2' })]), 'multi_let');
  assert.equal(suggestPropertyView('Retail', [unit('1'), unit('2')]), 'multi_let', 'unlinked rows remain distinct');
  assert.equal(suggestPropertyView('Retail', [unit('1'), unit('vacant-2', { is_vacant: true, status: 'AVA' })]), 'multi_let', 'an additional tracker unit remains visible');
  for (const assetClass of ['Mixed Use', 'Mixed-use']) assert.equal(suggestPropertyView(assetClass, [unit('1')]), 'multi_let');
});

test('either archive flag excludes a tenancy from layout counts, overview rent and lease events without removing history', () => {
  const rows = [
    unit('current', { property_unit_id: 'physical-1', passing_rent_pa: 24000, lease_expiry: '2027-09-17' }),
    unit('old-status', { status: ' Archived ', occupancy_status: 'Occupied', property_unit_id: 'physical-2', passing_rent_pa: 100000, lease_expiry: '2026-09-18' }),
    unit('old-occupancy', { status: 'Occupied', occupancy_status: ' aRcHiVeD ', property_unit_id: 'physical-3', passing_rent_pa: 200000, lease_expiry: '2026-09-19' }),
  ];
  const original = structuredClone(rows);
  assert.deepEqual(currentPropertyUnits(rows).map(row => row.id), ['current']);
  assert.equal(suggestPropertyView('Retail', rows), 'building');
  assert.equal(suggestPropertyView('Retail', rows.slice(1)), null, 'archive-only history cannot establish a unit count');
  const facts = propertyOverviewFacts(rows, '2026-09-17');
  assert.equal(facts.knownRent, 24000);
  assert.equal(facts.rentRows, 1);
  assert.deepEqual(facts.nextEvents.map(event => event.unit.id), ['current']);
  assert.deepEqual(rows, original, 'historical source records remain available');
});

test('overview rent distinguishes a recorded zero from missing or invalid amounts', () => {
  const rows = [unit('null', { passing_rent_pa: null }), unit('missing'), unit('empty', { passing_rent_pa: ' ' }), unit('bad', { passing_rent_pa: 'unknown' }), unit('negative', { passing_rent_pa: -100 }), unit('infinite', { passing_rent_pa: 'Infinity' })];
  const missing = propertyOverviewFacts(rows, '2026-09-16');
  assert.equal(missing.knownRent, null);
  assert.equal(missing.rentRows, 0);
  const zero = propertyOverviewFacts([...rows, unit('zero', { passing_rent_pa: 0 })], '2026-09-16');
  assert.equal(zero.knownRent, 0);
  assert.equal(zero.rentRows, 1);
  const partial = propertyOverviewFacts([...rows, unit('rent-1', { passing_rent_pa: '24000.50' }), unit('rent-2', { passing_rent_pa: 12000 }), unit('old', { status: 'Archived', passing_rent_pa: 100000 })], '2026-09-16');
  assert.equal(partial.knownRent, 36000.5);
  assert.equal(partial.rentRows, 2);
  assert.equal(partial.units.length, rows.length + 2);
});

test('overview lease dates preserve calendar days, order events and include today without invalid dates', () => {
  const rows = [
    unit('later', { lease_expiry: '2028-09-01', next_review_date: '2026-09-16T00:00:00+01:00' }),
    unit('earlier', { break_date: '2026-09-17', landlord_break_date: '2026-09-15', lease_expiry: '2026-02-30', next_review_date: 'invalid' }),
    unit('archived', { status: ' archived ', lease_expiry: '2026-09-18' }),
  ];
  const facts = propertyOverviewFacts(rows, '2026-09-16');
  assert.deepEqual(facts.nextEvents.map(({ unit: u, kind, date }) => [u.id, kind, date]), [['later', 'Rent review', '2026-09-16'], ['earlier', 'Break date', '2026-09-17'], ['later', 'Lease expiry', '2028-09-01']]);
  assert.deepEqual(facts.pastEvents.map(({ unit: u, kind, date }) => [u.id, kind, date]), [['earlier', 'Landlord break', '2026-09-15']]);
  assert.deepEqual(currentPropertyUnits(rows).map(u => u.id), ['later', 'earlier']);
  assert.equal(rows.length, 3, 'the shared schedule remains unchanged');
});
