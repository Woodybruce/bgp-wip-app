import assert from 'node:assert/strict';
import test from 'node:test';
import { layoutPlanMarkers, parsePlanMarkerMode } from '../../shared/plan-marker-layout.ts';
import { pointInPolygon } from '../../shared/plan-geometry.ts';

const rect = (left, top, right, bottom) => [{ x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom }];
const options = { mode: 'compact', screenWidth: 1000, aspect: 1, showPrices: true };
const unit = (id = 'D13', patch = {}) => ({ id, label: id, price: '£220', hasEvidence: true, polygon: rect(.1, .1, .9, .9), anchor: { x: .5, y: .5 }, ...patch });
const layout = (input = unit(), patch = {}) => layoutPlanMarkers([input], { ...options, ...patch }).get(input.id);

test('unknown saved modes default to compact without accepting unrelated strings or objects', () => {
  assert.equal(parsePlanMarkerMode('compact'), 'compact');
  assert.equal(parsePlanMarkerMode('circles'), 'circles');
  assert.equal(parsePlanMarkerMode('dots'), 'dots');
  for (const value of [null, undefined, '', 'circle', 'CIRCLES', 1, {}, ['dots']]) assert.equal(parsePlanMarkerMode(value), 'compact');
});

test('readable marker dimensions stay fixed in screen pixels across zoom and plan aspect', () => {
  const before = structuredClone(unit());
  for (const mode of ['compact', 'circles', 'dots']) {
    const reference = layout(before, { mode });
    for (const screenWidth of [700, 1200, 3500]) for (const aspect of [.45, 1, 2.4]) {
      const actual = layout(before, { mode, screenWidth, aspect });
      assert.deepEqual(actual, reference, `${mode} at ${screenWidth}px, aspect ${aspect}`);
      assert.equal(actual.x, before.anchor.x);
      assert.equal(actual.y, before.anchor.y);
    }
  }
  assert.deepEqual(before, unit(), 'layout cannot rewrite unit facts, source geometry or saved anchor');
  assert.equal(layout().height, 42);
  assert.equal(layout(unit(), { showPrices: false }).height, 26);
  assert.ok(layout(unit(), { mode: 'circles' }).width >= 48);
});

test('compact label text is bounded while retaining a separate allowance for the evidence dot', () => {
  const short = layout(unit('D2'), { showPrices: false });
  assert.equal(short.displayLabel, 'D2');
  assert.ok(short.width >= 36);
  const long = layout(unit('Remote store D17A/D17B/D18/D19'));
  assert.ok(long.width <= 120);
  assert.ok(long.displayLabel.endsWith('…'));
  assert.notEqual(long.displayLabel, 'Remote store D17A/D17B/D18/D19');
  for (const label of ['WWWWWWWWWWWWWW', 'mmmmmmmmmmmmmm', '单位单位单位单位单位单位']) {
    const actual = layout(unit(label));
    assert.ok(actual.width <= 120);
    assert.ok(actual.displayLabel.endsWith('…'));
  }
});

test('price visibility is explicit, missing prices never become zero, and oversized values do not overflow', () => {
  assert.equal(layout().showPrice, true);
  assert.equal(layout(unit(), { showPrices: false }).showPrice, false);
  for (const price of [null, '', '   ']) assert.equal(layout(unit('D13', { price })).showPrice, false);
  for (const mode of ['compact', 'circles']) {
    assert.equal(layout(unit('D13', { price: '£123,456,789,012,345,678' }), { mode }).showPrice, false);
    assert.equal(layout(unit('D13', { price: '£0' }), { mode }).showPrice, true, 'an explicitly supplied zero remains distinguishable from missing evidence');
  }
});

test('dots show one selected compact label and number mode keeps unit references without prices', () => {
  const a = unit('A1', { anchor: { x: .3, y: .5 } }), b = unit('B2', { anchor: { x: .7, y: .5 } });
  const result = layoutPlanMarkers([a, b], { ...options, mode: 'dots', selectedId: 'B2' });
  assert.deepEqual(result.get('A1'), { x: .3, y: .5, kind: 'dot', width: 8, height: 8, showPrice: false, displayLabel: '' });
  assert.equal(result.get('B2').kind, 'compact');
  assert.equal(result.get('B2').showPrice, true);
  for (const mode of ['compact', 'circles', 'dots']) {
    const number = layout(a, { mode, numberOnly: true });
    assert.equal(number.kind, 'number');
    assert.equal(number.displayLabel, 'A1');
    assert.equal(number.showPrice, false);
  }
});

test('a thin unit gets an 8px dot, and only becomes a full readable label when enough space is visible', () => {
  const input = unit('D13', { polygon: rect(.49, .4, .51, .6) });
  assert.equal(layout(input).kind, 'dot');
  assert.equal(layout(input).width, 8);
  assert.equal(layout(input, { selectedId: input.id }).kind, 'dot', 'selection never pushes the badge through its walls');
  const zoomed = layout(input, { screenWidth: 4000 });
  assert.equal(zoomed.kind, 'compact');
  assert.equal(zoomed.height, 42);
  assert.deepEqual({ x: zoomed.x, y: zoomed.y }, input.anchor);
});

test('containment converts normalized source y using the image aspect, not the image width twice', () => {
  const input = unit('A1', { polygon: rect(.4, .485, .6, .515) });
  assert.equal(layout(input, { aspect: .5 }).kind, 'dot', 'the demise is only 15 screen pixels tall on a wide plan');
  assert.equal(layout(input, { aspect: 2 }).kind, 'compact', 'the same source-coordinate height spans 60 pixels on a tall plan');
  assert.equal(layout(input, { aspect: 2 }).y, .5);
});

test('a concave notch cannot be bridged by a badge even when its centre and all four corners are inside', () => {
  // A 10px-wide notch enters the top edge, 12px right of the anchor. It
  // misses the four badge corners and centre but cuts through its top edge.
  const polygon = [
    { x: .4, y: .4 }, { x: .507, y: .4 }, { x: .507, y: .5 },
    { x: .517, y: .5 }, { x: .517, y: .4 }, { x: .6, y: .4 },
    { x: .6, y: .6 }, { x: .4, y: .6 },
  ];
  const expected = layout(unit('D13'), { showPrices: false });
  const halfWidth = (expected.width / 2 + 1) / 1000, halfHeight = (expected.height / 2 + 1) / 1000;
  for (const x of [.5 - halfWidth, .5 + halfWidth]) for (const y of [.5 - halfHeight, .5 + halfHeight]) assert.equal(pointInPolygon({ x, y }, polygon), true);
  assert.equal(pointInPolygon({ x: .5, y: .5 }, polygon), true);
  const actual = layout(unit('D13', { polygon }), { showPrices: false });
  assert.equal(actual.kind, 'dot');
  assert.equal(actual.width, 8);
  assert.equal(actual.x, .5);
});

test('circle containment uses the nearest angled wall rather than a polygon bounding box', () => {
  const diamond = [{ x: .5, y: .47 }, { x: .53, y: .5 }, { x: .5, y: .53 }, { x: .47, y: .5 }];
  const actual = layout(unit('A1', { polygon: diamond, price: null }), { mode: 'circles' });
  assert.equal(actual.kind, 'dot', '48px circle fits the 60px bounds but crosses the diamond walls');
  assert.equal(actual.width, 8);
});

test('circle mode keeps readable circles up to 80px and deliberately allows circle overlap', () => {
  const a = unit('D17A/D17B/D18/D19', { anchor: { x: .5, y: .5 } });
  const b = unit('A1', { anchor: { x: .53, y: .5 } });
  const actual = layoutPlanMarkers([a, b], { ...options, mode: 'circles' });
  for (const shape of actual.values()) {
    assert.equal(shape.kind, 'circle');
    assert.equal(shape.width, shape.height);
    assert.ok(shape.width >= 48 && shape.width <= 80);
  }
  assert.ok(actual.get(a.id).displayLabel.endsWith('…'));
});

test('compact collisions prioritize selection, then evidence, and never move the remaining markers', () => {
  const noEvidence = unit('A1', { hasEvidence: false, price: null, anchor: { x: .47, y: .5 } });
  const evidence = unit('B2', { anchor: { x: .5, y: .5 } });
  const selected = unit('C3', { hasEvidence: false, price: null, anchor: { x: .53, y: .5 } });
  const defaultResult = layoutPlanMarkers([noEvidence, evidence], { ...options, showPrices: false });
  assert.equal(defaultResult.get(evidence.id).kind, 'compact');
  assert.equal(defaultResult.get(noEvidence.id).kind, 'dot');
  assert.equal(defaultResult.get(noEvidence.id).width, 8);
  const result = layoutPlanMarkers([noEvidence, evidence, selected], { ...options, showPrices: false, selectedId: selected.id });
  assert.equal(result.get(selected.id).kind, 'compact');
  assert.equal(result.get(evidence.id).kind, 'dot');
  for (const input of [noEvidence, evidence, selected]) assert.deepEqual({ x: result.get(input.id).x, y: result.get(input.id).y }, input.anchor);
});

test('overlapping anchors cannot paint a second label over the selected unit, but all records remain in the layout map', () => {
  const selected = unit('A1'), other = unit('B2');
  const result = layoutPlanMarkers([other, selected], { ...options, selectedId: selected.id });
  assert.equal(result.size, 2);
  assert.equal(result.get(selected.id).kind, 'compact');
  assert.equal(result.get(other.id).width, 0);
  assert.equal(result.get(other.id).height, 0);
});

test('number-only decluttering is independent of the previously selected marker style', () => {
  const a = unit('A', { polygon: rect(.1, .1, .2, .4), anchor: { x: .15, y: .25 } });
  const b = unit('B', { polygon: rect(.2, .1, .3, .4), anchor: { x: .25, y: .25 } });
  const reference = layoutPlanMarkers([a, b], { ...options, screenWidth: 264, numberOnly: true });
  assert.equal(reference.get('A').kind, 'number');
  assert.equal(reference.get('B').kind, 'dot');
  for (const mode of ['compact', 'circles', 'dots']) {
    assert.deepEqual(layoutPlanMarkers([a, b], { ...options, mode, screenWidth: 264, numberOnly: true }), reference);
  }
});

test('an impossibly small demise or invalid geometry stays unpainted without changing its anchor', () => {
  for (const polygon of [rect(.498, .498, .502, .502), [], rect(-.1, .1, .4, .4)]) {
    const actual = layout(unit('A1', { polygon }));
    assert.equal(actual.width, 0);
    assert.equal(actual.height, 0);
    assert.equal(actual.x, .5);
    assert.equal(actual.y, .5);
  }
  const outside = layout(unit('A1', { anchor: { x: .95, y: .95 } }));
  assert.equal(outside.width, 0);
  assert.equal(outside.x, .95, 'layout does not silently relocate an invalid saved anchor');
  for (const patch of [{ screenWidth: 0 }, { screenWidth: NaN }, { aspect: 0 }, { aspect: Infinity }]) assert.equal(layout(unit(), patch).width, 0);
});
