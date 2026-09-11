import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPlanScanReview, publicPlanScanReview, scanUnitSnapshot, scanUnitMatchesSnapshot, validateScanReviewApplyRequest } from '../../server/plan-scan-review.ts';

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const polygon = [{ x: .1, y: .1 }, { x: .3, y: .1 }, { x: .3, y: .4 }, { x: .1, y: .4 }];
const saved = { id: id(1), unit_ref: 'A1', tenant_name: 'Saved tenant', polygon, dot: { x: .2, y: .2 }, source: 'ai', notes: 'Keep', passing_rent: '100' };

test('scan snapshot checks identity and geometry while unrelated fact changes remain independent', () => {
  const snapshot = scanUnitSnapshot(saved);
  assert.ok(scanUnitMatchesSnapshot({ ...saved, notes: 'New note', passing_rent: '200' }, snapshot));
  for (const patch of [{ id: id(2) }, { unit_ref: 'A2' }, { tenant_name: 'New tenant' }, { source: 'manual' }, { dot: { x: .21, y: .2 } }, { polygon: null }]) {
    assert.equal(scanUnitMatchesSnapshot({ ...saved, ...patch }, snapshot), false, JSON.stringify(patch));
  }
  assert.ok(scanUnitMatchesSnapshot({ ...saved, dot: { y: .2, x: .2 }, polygon: polygon.map(({ x, y }) => ({ y, x })) }, snapshot), 'JSON object key order is immaterial');
});

test('complete scan results retain blocked candidates separately from automatic changes', () => {
  const candidates = ['added', 'refined', 'current', 'review', 'review'].map((status, i) => ({ id: `candidate-${i + 1}`, unitRef: `A${i + 1}`, tenantName: null, polygon, dot: { x: .2, y: .2 }, status, unitId: null, suggestedUnitIds: [], reason: 'Fixture reason' }));
  const review = buildPlanScanReview({ planId: id(10), levelId: id(11), jobId: id(12), backgroundKey: 'fixture.png', candidates, existingUnits: [saved] });
  assert.deepEqual(review.summary, { detected: 5, added: 1, refined: 1, current: 1, needsReview: 2 });
  assert.equal(review.candidates.length, 5);
  assert.deepEqual(review.existingUnits, [scanUnitSnapshot(saved)]);
  const result = publicPlanScanReview(review);
  assert.equal('applicationRequests' in result, false);
  assert.equal('clearedSnapshots' in result, false);
  assert.deepEqual(result.applied, {});
});

test('review input requires explicit distinct candidate and target choices', () => {
  const replace = { candidateId: 'candidate-1', unitId: id(1) };
  const create = { candidateId: 'candidate-2', unitId: null, newUnitRef: '  B2  ' };
  assert.deepEqual(validateScanReviewApplyRequest({ assignments: [replace, create], clearOutlineUnitIds: [id(3)] }), { assignments: [replace, { ...create, newUnitRef: 'B2' }], clearOutlineUnitIds: [id(3)] });
  const invalid = [null, {}, { assignments: [] }, { assignments: [{ candidateId: 'candidate-1' }] },
    { assignments: [replace, replace] }, { assignments: [replace, { ...replace, candidateId: 'candidate-2' }] },
    { assignments: [replace], clearOutlineUnitIds: [id(1)] }, { assignments: [], clearOutlineUnitIds: [id(1), id(1)] },
    { assignments: [{ ...replace, newUnitRef: 'Renamed existing unit' }] }, { assignments: [{ ...create, newUnitRef: ' ' }] },
    { assignments: [{ ...replace, candidateId: '../../other-file' }] }, { assignments: [{ ...replace, unitId: 'wrong-id' }] }];
  for (const body of invalid) assert.throws(() => validateScanReviewApplyRequest(body), error => error.status === 400, JSON.stringify(body));
});
