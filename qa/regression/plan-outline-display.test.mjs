import assert from 'node:assert/strict';
import test from 'node:test';
import { planOutlineDisplay, planOutlinePoints, unitOutlinePlacement } from '../../shared/plan-outline-display.ts';
import { pointInPolygon } from '../../shared/plan-geometry.ts';

const rect = (left, top, right, bottom) => [{ x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom }];
const frame = { planId: 'plan', levelId: 'lower', backgroundKey: 'original.jpg' };
const makeUnit = (id, polygon, source = 'ai') => ({ id, unit_ref: id, tenant_name: 'Tenant', source, polygon, notes: 'Keep notes', passing_rent: 500, evidenceIds: ['entry-1'] });
const snapshot = unit => ({ id: unit.id, unitRef: unit.unit_ref, tenantName: unit.tenant_name, polygon: unit.polygon, dot: null, source: unit.source });
const reviewFor = (units, candidates = []) => ({ version: 1, ...frame, jobId: 'latest', createdAt: '2026-09-10',
  candidates, existingUnits: units.map(snapshot), applied: {}, clearedUnitIds: [] });
const candidate = (unit, status = 'current', polygon = unit.polygon) => ({ id: `candidate-${unit.id}`, unitId: unit.id, status, polygon, suggestedUnitIds: [unit.id] });

test('a newer scan keeps contradicted old AI boxes and their labels out of the saved canvas and hit targets', () => {
  const oldBox = makeUnit('old-large-box', rect(.1, .1, .8, .8));
  const saved = makeUnit('correct-unit', rect(.2, .2, .3, .4));
  const manual = makeUnit('manual-unit', rect(.4, .2, .5, .4), 'manual');
  const unplaced = makeUnit('schedule-only', null);
  const units = [oldBox, saved, manual, unplaced], before = structuredClone(units);
  const review = reviewFor(units, [candidate(saved), candidate(oldBox, 'review', rect(.1, .1, .18, .2))]);
  const display = planOutlineDisplay(units, review, frame);
  assert.deepEqual(new Set(display.placed.map(unit => unit.id)), new Set([saved.id, manual.id]));
  assert.deepEqual(display.needsPlacement.map(unit => unit.id), [oldBox.id, unplaced.id]);
  assert.equal(display.placement.get(oldBox.id), 'needs_review');
  assert.equal(display.placement.get(unplaced.id), 'unplaced');
  const hits = display.placed.filter(unit => pointInPolygon({ x: .25, y: .3 }, unit.polygon));
  assert.deepEqual(hits.map(unit => unit.id), [saved.id], 'oversized old region cannot steal a click inside the real unit');
  assert.deepEqual(units, before, 'render policy never removes or changes saved facts, evidence, markers or polygons');
});

test('same unit reference alone cannot publish a proposed outline before the user applies it', () => {
  const unit = makeUnit('A1', rect(.1, .1, .8, .8));
  const pending = candidate(unit, 'review', rect(.2, .2, .3, .4));
  assert.equal(unitOutlinePlacement(unit, reviewFor([unit], [pending]), frame), 'needs_review');
  const merelyMatchingGeometry = candidate(unit, 'review');
  assert.equal(unitOutlinePlacement(unit, reviewFor([unit], [merelyMatchingGeometry]), frame), 'needs_review');
});

test('scan status cannot certify a stale, different-level, replaced-background or subsequently changed polygon', () => {
  const unit = makeUnit('A1', rect(.2, .2, .3, .4));
  const review = reviewFor([unit], [candidate(unit)]);
  assert.equal(unitOutlinePlacement(unit, review, frame), 'scanned');
  for (const patch of [{ planId: 'other' }, { levelId: 'upper' }, { backgroundKey: 'replacement.jpg' }]) {
    assert.equal(unitOutlinePlacement(unit, { ...review, ...patch }, frame), 'needs_review');
  }
  assert.equal(unitOutlinePlacement({ ...unit, polygon: rect(.2, .2, .6, .4) }, review, frame), 'needs_review');
  assert.equal(unitOutlinePlacement(unit, { ...review, clearedUnitIds: [unit.id] }, frame), 'needs_review');
  assert.equal(unitOutlinePlacement(unit, { ...review, existingUnits: [] }, frame), 'needs_review');
  assert.equal(unitOutlinePlacement(unit, undefined, frame), 'needs_review', 'no flash of legacy boxes while review is loading');
  assert.equal(unitOutlinePlacement(unit, null, frame), 'needs_review', 'old scans without retained geometry need review');
});

test('manual outlines remain usable without a scan, while fact edits do not invalidate current geometry', () => {
  const unit = makeUnit('A1', rect(.2, .2, .3, .4));
  assert.equal(unitOutlinePlacement({ ...unit, source: 'manual' }, null, frame), 'manual');
  assert.equal(unitOutlinePlacement({ ...unit, unit_ref: 'New number', tenant_name: 'New tenant', notes: 'Edited' }, reviewFor([unit], [candidate(unit)]), frame), 'scanned');
  assert.equal(unitOutlinePlacement({ ...unit, source: 'manual', polygon: null }, null, frame), 'unplaced');
});

test('only matching saved geometry is shown for current, added, refined and reviewed results', () => {
  const unit = makeUnit('A1', rect(.2, .2, .3, .4));
  for (const status of ['added', 'refined', 'current']) assert.equal(unitOutlinePlacement(unit, reviewFor([unit], [candidate(unit, status)]), frame), 'scanned');
  const pending = candidate(unit, 'review'), review = reviewFor([unit], [pending]);
  review.applied[pending.id] = { unitId: unit.id, action: 'replaced' };
  assert.equal(unitOutlinePlacement(unit, review, frame), 'scanned');
});

test('small placed units paint last and source coordinates remain exact on wide and tall plans', () => {
  const large = makeUnit('large', rect(.1, .1, .9, .9), 'manual');
  const small = makeUnit('small', rect(.2, .3, .4, .6), 'manual');
  assert.deepEqual(planOutlineDisplay([small, large], null, frame).placed.map(unit => unit.id), ['large', 'small']);
  const pixels = planOutlinePoints(small.polygon, 2000, 1000);
  assert.equal(pixels, '400,300 800,300 800,600 400,600');
  assert.equal(planOutlinePoints(small.polygon, 100, 50), '20,15 40,15 40,30 20,30');
  assert.equal(planOutlinePoints(small.polygon, 100, 150), '20,45 40,45 40,90 20,90');
});
