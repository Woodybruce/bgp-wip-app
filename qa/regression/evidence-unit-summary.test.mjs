import assert from 'node:assert/strict';
import test from 'node:test';
import { orderedUnitEvidence, evidenceHasNumber, evidenceSummaryIsFuture, evidenceUnitFactDraft } from '../../shared/evidence-unit-summary.ts';

const entry = (patch = {}) => ({ id: 'b6-renewal', unit_id: 'B6', transaction_date: '2027-08-03',
  headline_rent: '50000', size_sqft: '1227', term: '5 years', ...patch });

test('B6 summary uses saved evidence even when tenancy facts are blank, without changing either record', () => {
  const evidence = entry(); const unit = { id: 'B6', passing_rent: null, sqft: null, lease_expiry: null };
  const snapshot = structuredClone({ unit, evidence });
  const [summary] = orderedUnitEvidence([evidence], unit.id);
  assert.equal(summary.headline_rent, '50000'); assert.equal(summary.size_sqft, '1227');
  assert.deepEqual({ unit, evidence }, snapshot);
  assert.equal(evidenceSummaryIsFuture(summary, '2026-10-02'), true);
});

test('only linked entries for the chosen unit are eligible, independent of tenant names and unit refs', () => {
  assert.deepEqual(orderedUnitEvidence([entry(), entry({ id: 'other', unit_id: 'D3' }), entry({ id: 'unlinked', unit_id: null })], 'B6').map(e => e.id), ['b6-renewal']);
  assert.deepEqual(orderedUnitEvidence([entry()], 'missing'), []);
});

test('ordering is deterministic by transaction then upload date; undated entries follow dated ones', () => {
  const entries = [entry({ id: 'undated', transaction_date: null, created_at: '2026-10-05' }),
    entry({ id: 'old', transaction_date: '2020-01-01' }), entry({ id: 'tie-old', created_at: '2026-10-01' }),
    entry({ id: 'tie-new', created_at: '2026-10-02' }), entry({ id: 'invalid', transaction_date: 'bad' })];
  const originalOrder = entries.map(e => e.id);
  assert.deepEqual(orderedUnitEvidence(entries, 'B6').map(e => e.id), ['tie-new', 'tie-old', 'old', 'undated', 'invalid']);
  assert.deepEqual(entries.map(e => e.id), originalOrder);
});

test('editing and deleting evidence update the derived summary; figures are not merged across entries', () => {
  const older = entry({ id: 'older', transaction_date: '2025-01-01', headline_rent: '40000', size_sqft: '1500' });
  const latest = entry({ headline_rent: null, size_sqft: '1227' });
  assert.equal(orderedUnitEvidence([older, latest], 'B6')[0].headline_rent, null);
  latest.headline_rent = '52000';
  assert.equal(orderedUnitEvidence([older, latest], 'B6')[0].headline_rent, '52000');
  assert.equal(orderedUnitEvidence([older], 'B6')[0].headline_rent, '40000');
  assert.deepEqual(orderedUnitEvidence([], 'B6'), []);
});

test('future evidence is labelled by calendar date, including ISO timestamps', () => {
  assert.equal(evidenceSummaryIsFuture(entry(), '2026-10-02'), true);
  assert.equal(evidenceSummaryIsFuture(entry({ transaction_date: '2026-10-02T00:00:00.000Z' }), '2026-10-02'), false);
  assert.equal(evidenceSummaryIsFuture(entry({ transaction_date: '2026-10-01' }), '2026-10-02'), false);
  for (const transaction_date of [null, '', 'invalid']) assert.equal(evidenceSummaryIsFuture(entry({ transaction_date }), '2026-10-02'), false);
});

test('review creates only explicitly selected numeric fields and never infers lease dates or tenant', () => {
  assert.deepEqual(evidenceUnitFactDraft(entry(), { size: false, passingRent: false }), {});
  assert.deepEqual(evidenceUnitFactDraft(entry(), { size: true, passingRent: false }), { sqft: '1227' });
  assert.deepEqual(evidenceUnitFactDraft(entry(), { size: false, passingRent: true }), { passingRent: '50000' });
  assert.deepEqual(evidenceUnitFactDraft(entry(), { size: true, passingRent: true }), { sqft: '1227', passingRent: '50000' });
});

test('zero rent is valid; blank, malformed, negative and non-numeric values cannot clear or pollute current facts', () => {
  for (const value of [0, '0', ' 0 ', 123.45, '123.45']) assert.equal(evidenceHasNumber(value), true);
  for (const value of [null, undefined, '', ' ', 'unknown', -1, '-1', Infinity, NaN, false, [], {}]) {
    assert.equal(evidenceHasNumber(value), false);
    assert.deepEqual(evidenceUnitFactDraft(entry({ size_sqft: value, headline_rent: value }), { size: true, passingRent: true }), {});
  }
  assert.deepEqual(evidenceUnitFactDraft(entry({ size_sqft: '0', headline_rent: 0 }), { size: true, passingRent: true }), { sqft: '0', passingRent: '0' });
});
