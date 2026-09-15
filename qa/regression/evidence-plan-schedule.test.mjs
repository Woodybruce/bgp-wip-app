import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyEvidenceScheduleCandidates as classify,
  evidenceScheduleRefsEquivalent as sameRef,
  normalizeEvidenceUnitRef as normalise,
  resolveEvidenceScheduleMatch as match,
} from '../../server/evidence-plan-schedule.ts';

const property = 'property-one';
const row = (id, fields = {}) => ({
  id, property_id: property, unit_number: 'Unit A01', tenant_name: 'Tea Shop Limited', trading_name: 'Tea Shop',
  permitted_use: 'Retail Unit', floor_level: 'Ground', lease_expiry: '2030-01-01T00:00:00.000Z',
  passing_rent_pa: 12500, erv_pa: 13000, nia_sqft: 750, gia_sqft: null, ...fields,
});
const unit = fields => ({ unit_ref: 'A1', tenant_name: 'Tea Shop', ...fields });
const options = { propertyId: property };

test('explicit codes normalize spelling without collapsing store and unit namespaces', () => {
  assert.equal(normalise(' Unit A01 '), normalise('A1'));
  assert.ok(sameRef('Shop A01', 'Unit A1'));
  assert.ok(sameRef('Store A', 'STORE A'));
  assert.ok(!sameRef('Store A', 'Unit A'));
  assert.ok(!sameRef('Store 1', 'Unit 1'));
  assert.ok(!sameRef('Store A', 'A'));
});

test('bounded explicit lists and ranges share a reference without losing parts', () => {
  for (const [a, b] of [['D4-D6', 'D4/D5/D6'], ['D04-D06', 'D4/5/6'], ['D11/12', 'D11 & D12'],
    ['E3/4', 'Unit E03/E04'], ['Unit N14 N15 and N15A', 'N14, N15 & N15A'], ['K17', 'Kiosk K17'],
    ['Kiosk 17', 'K17'], ['F6 – F9', 'F6/F7/F8/F9']]) assert.ok(sameRef(a, b), `${a} = ${b}`);
  for (const [a, b] of [['D8 & D9', 'D8-10'], ['A1-B2', 'A1/A2/B1/B2'], ['D6-D4', 'D4/D5/D6'],
    ['A1-A999', 'A1'], ['A1/A1', 'A1'], ['Remote Store 2 (N6a)', 'N6A'], ['E1D', 'E1']]) assert.ok(!sameRef(a, b), `${a} != ${b}`);
});

test('equivalent imports resolve deterministically without changing or merging rows', () => {
  const first = Object.freeze(row('a', { updated_at: '2020-01-01', premises: null }));
  const second = Object.freeze(row('z', { updated_at: '2035-01-01', passing_rent_pa: '12500.00', premises: 'import-key-1' }));
  const resolved = match(unit(), [second, first], options);
  assert.equal(resolved.status, 'matched');
  assert.equal(resolved.row, first);
  assert.deepEqual(resolved.equivalentDuplicateIds, ['a', 'z']);
  assert.equal(match(unit(), [first, second], options).row, first);
  assert.equal(second.passing_rent_pa, '12500.00');
});

test('different financial amounts including rounding remain an explicit choice', () => {
  for (const patch of [{ passing_rent_pa: 12500.4 }, { passing_rent_pa: null }, { erv_pa: null }, { nia_sqft: 750.01 },
    { gia_sqft: 0 }, { marketing_rent_pa: 0 }, { area_ground_nia: 600 }, { deposit_held: 0 }, { service_charge: 500 }]) {
    const result = match(unit(), [row('a'), row('b', patch)], options);
    assert.equal(result.status, 'ambiguous', JSON.stringify(patch));
    assert.equal(result.row, null);
    assert.ok(result.conflicts.some(c => c.field === Object.keys(patch)[0]));
  }
});

test('conflicting dates, use, floor, status and tenant stay ambiguous', () => {
  for (const patch of [{ lease_expiry: null }, { lease_start: '2020-01-01' }, { break_date: '2028-01-01' },
    { landlord_break_date: '2029-01-01' }, { next_review_date: '2027-01-01' }, { floor_level: 'Upper' },
    { grouping: 'Other floor' }, { permitted_use: 'Storage' }, { status: 'Vacant' },
    { tenant_name: 'Other tenant Limited' }, { trading_name: null }, { tenant_company_id: 'other-company' }]) {
    const result = classify([row('a'), row('b', patch)]);
    assert.equal(result.status, 'conflicting', JSON.stringify(patch));
    assert.equal(result.row, null);
  }
});

test('complete schedule facts include later rent reviews, alternative areas and linked records', () => {
  for (const patch of [{ rent_review_2_date: '2029-01-01' }, { rent_review_2_amount: 20000 },
    { area_ground: 1200 }, { net_income: 12000 }, { turnover_percent: 0 }, { rent_psf: 22 },
    { property_unit_id: 'physical-unit' }, { deal_id: 'live-deal' }, { occupancy_status: 'let' },
    { marketing_active: false }, { in_leasing_schedule: false }, { target_company_ids: [] },
    { comments: 'Rent concession agreed' }]) {
    const result = classify([row('a'), row('b', patch)]);
    assert.equal(result.status, 'conflicting', JSON.stringify(patch));
    assert.ok(result.conflicts.some(c => c.field === Object.keys(patch)[0]));
  }
  assert.equal(classify([row('a', { target_company_ids: ['b', 'a'] }), row('b', { target_company_ids: ['a', 'b'] })]).status, 'equivalent');
  assert.equal(classify([row('a', { marketing_active: false }), row('b', { marketing_active: 'false' })]).status, 'conflicting');
});

test('two different supplied premises IDs are not assumed to be one tenancy', () => {
  const result = classify([row('a', { premises: 'first-demise' }), row('b', { premises: 'second-demise' })]);
  assert.equal(result.status, 'conflicting');
  assert.ok(result.conflicts.some(c => c.field === 'premises'));
});

test('zero is a value and absent versus populated facts cannot silently fill one another', () => {
  assert.equal(classify([row('a', { erv_pa: 0 }), row('b', { erv_pa: '0.00' })]).status, 'equivalent');
  assert.equal(classify([row('a', { erv_pa: 0 }), row('b', { erv_pa: null })]).status, 'conflicting');
  assert.equal(classify([row('a', { erv_pa: undefined }), row('b', { erv_pa: null })]).status, 'equivalent');
});

test('matching date instants compare across database Date objects and JSON snapshots', () => {
  assert.equal(classify([row('a'), row('b', { lease_expiry: new Date('2030-01-01T00:00:00.000Z') })]).status, 'equivalent');
  assert.equal(classify([row('a'), row('b', { lease_expiry: '2029-12-31T23:00:00.000Z' })]).status, 'conflicting');
  assert.equal(classify([row('a', { lease_expiry: 'not-a-date' }), row('b', { lease_expiry: 'not-a-date' })]).status, 'conflicting');
  assert.equal(classify([row('a', { erv_pa: 'NaN' }), row('b', { erv_pa: 'NaN' })]).status, 'conflicting');
});

test('alias matches include all equivalent spellings and expose conflicts across them', () => {
  const rows = [row('a', { unit_number: 'D04-D06' }), row('b', { unit_number: 'D4/D5/D6' })];
  assert.equal(match(unit({ unit_ref: 'D4-D6' }), rows, options).status, 'matched');
  assert.equal(match(unit({ unit_ref: 'D4-D6' }), rows, options).method, 'alias');
  const conflicting = [rows[0], { ...rows[1], passing_rent_pa: 99999 }];
  const result = match(unit({ unit_ref: 'D4-D6' }), conflicting, options);
  assert.equal(result.status, 'ambiguous');
  assert.deepEqual(result.candidateIds, ['a', 'b']);
});

test('an exact supplied tenancy link wins even where import candidates disagree', () => {
  const rows = [row('a'), row('b', { passing_rent_pa: 88888 })];
  const result = match(unit({ tenancy_unit_id: 'b', unit_ref: 'Different printed reference' }), rows, options);
  assert.equal(result.status, 'matched');
  assert.equal(result.method, 'explicit');
  assert.equal(result.row.id, 'b');
  assert.equal(result.row.passing_rent_pa, 88888);
});

test('stale, malformed and cross-property links never fall back to a similar tenancy', () => {
  for (const link of ['gone', 'foreign', 42, { id: 'a' }]) {
    const result = match(unit({ tenancy_unit_id: link }), [row('a'), row('foreign', { property_id: 'other-property' })], options);
    assert.equal(result.status, 'stale-link', JSON.stringify(link));
    assert.equal(result.row, null);
    assert.equal(result.method, null);
  }
});

test('explicit links require proof of property scope', () => {
  const noScope = [{ ...row('a'), property_id: undefined }];
  assert.equal(match(unit({ tenancy_unit_id: 'a' }), noScope).status, 'stale-link');
  assert.equal(match(unit({ tenancy_unit_id: 'a' }), noScope, options).status, 'stale-link');
  assert.equal(match(unit({ tenancy_unit_id: 'a' }), [row('a')], { propertyId: null }).status, 'stale-link');
  assert.equal(match(unit({ tenancy_unit_id: 'a' }), [row('a')]).row.id, 'a');
});

test('unlinked resolution also filters property scope and never compares tenants across properties', () => {
  assert.equal(match(unit(), [row('foreign', { property_id: 'other-property' })], options).row, null);
  assert.equal(match(unit(), [row('a'), row('b', { property_id: 'other-property' })]).row, null);
  assert.equal(match(unit(), [row('a'), row('b', { property_id: 'other-property' })], options).row.id, 'a');
  assert.equal(match(unit({ property_id: 'other-property' }), [row('a')], options).row, null);
});

test('legacy pure callers may pass already-scoped rows without property fields when there is no explicit link', () => {
  assert.equal(match(unit(), [{ ...row('a'), property_id: undefined }]).row.id, 'a');
});

test('explicit references never borrow another shop belonging to the same tenant', () => {
  for (const ref of ['A9', 'Unit A', 'Store A', 'Remote Store 2 (N6a)', 'Unlabelled 97', 'D8-10']) {
    assert.equal(match(unit({ unit_ref: ref }), [row('a')], options).row, null, ref);
  }
});

test('repeated codes on another floor cannot overwrite a contradictory saved tenant', () => {
  const rows = [row('a', { unit_number: 'E7A', tenant_name: 'Hasty Tasty Pizza Ltd', trading_name: 'Hasty Tasty Pizza' }),
    row('b', { unit_number: 'E7A', tenant_name: 'Hasty Tasty Pizza Ltd', trading_name: 'Hasty Tasty Pizza' })];
  const result = match(unit({ unit_ref: 'E7A', tenant_name: "Nando's" }), rows, options);
  assert.equal(result.status, 'ambiguous');
  assert.equal(result.row, null);
  assert.deepEqual(result.candidateIds, ['a', 'b']);
  assert.equal(result.conflicts[0].field, 'saved_tenant');
});

test('one exact reference also needs confirmation when its tenant contradicts the saved unit', () => {
  const rows = [row('a', { unit_number: 'F02', tenant_name: 'Accessorize Stores Ltd', trading_name: 'Accessorize' })];
  const staleUnit = unit({ unit_ref: 'F02', tenant_name: 'Holland & Barrett' });
  assert.equal(match(staleUnit, rows, options).status, 'ambiguous');
  assert.equal(match({ ...staleUnit, tenancy_unit_id: 'a' }, rows, options).status, 'matched');
  assert.equal(match({ ...staleUnit, tenancy_unit_id: 'a' }, rows, options).method, 'explicit');
});

test('name-only labels use full names, including legal suffix and accent normalization', () => {
  assert.equal(match(unit({ unit_ref: 'Tea Shop', tenant_name: null }), [row('a')], options).method, 'tenant');
  assert.equal(match(unit({ unit_ref: 'Thérapie', tenant_name: null }), [row('a', { tenant_name: 'Therapie Ltd', trading_name: 'Therapie' })], options).row.id, 'a');
  assert.equal(match(unit({ unit_ref: 'Tea', tenant_name: null }), [row('a')], options).row, null);
});

test('name-only matching rejects other shop demises even when economic facts happen to agree', () => {
  const result = match(unit({ unit_ref: 'Tea Shop' }), [row('a'), row('b', { unit_number: 'Unit A02' })], options);
  assert.equal(result.status, 'ambiguous');
  assert.ok(result.conflicts.some(c => c.field === 'unit_number'));
});

test('name-only matching excludes ancillary spaces rather than choosing the only storage row', () => {
  const storage = row('storage', { unit_number: 'Remote Store 2', permitted_use: 'Storage' });
  assert.equal(match(unit({ unit_ref: 'Tea Shop' }), [row('shop'), storage], options).row.id, 'shop');
  assert.equal(match(unit({ unit_ref: 'Tea Shop' }), [storage], options).row, null);
  assert.equal(match(unit({ unit_ref: 'Remote Store 2' }), [storage], options).row.id, 'storage');
});

test('empty schedules and cleared links produce actionable unmatched state', () => {
  assert.equal(classify([]).status, 'none');
  const result = match(unit({ tenancy_unit_id: null }), [], options);
  assert.equal(result.status, 'unmatched');
  assert.ok(result.reason);
  assert.deepEqual(result.candidateIds, []);
});
