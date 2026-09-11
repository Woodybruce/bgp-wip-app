import assert from 'node:assert/strict';
import test from 'node:test';
import { findPlanUnitRegions, tracePlanUnit, planPolygonsOverlap, mapDetectedPlanUnits } from '../../server/plan-unit-detection.ts';
import { isValidPolygon, pointInPolygon, polygonArea } from '../../shared/plan-geometry.ts';

const teal = [118, 194, 188], white = [255, 255, 255], wall = [65, 70, 70];
function fixture(width = 1000, height = 1000) {
  const image = { width, height, data: Buffer.alloc(width * height * 3, 255) };
  const rect = (left, top, right, bottom, colour) => {
    for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) image.data.set(colour, (y * width + x) * 3);
  };
  const point = (x, y) => ({ x: x / width, y: y / height });
  const area = result => polygonArea(result.polygon) * width * height;
  const enclosed = (left, top, right, bottom, colour = teal) => {
    rect(left - 1, top - 1, right + 1, bottom + 1, wall);
    rect(left, top, right, bottom, colour);
  };
  const trace = (x, y) => tracePlanUnit(image, point(x, y));
  return { image, rect, point, area, enclosed, trace };
}

for (const [name, colour] of [['teal', teal], ['red', [238, 120, 94]], ['blue', [85, 135, 210]]]) {
  test(`closed ${name} kiosk recovers both floor pieces separated by a full-width white label`, () => {
    const f = fixture();
    f.enclosed(100, 100, 120, 124, colour);
    f.rect(100, 110, 120, 116, white);
    const result = f.trace(110, 120);
    assert.ok(result);
    assert.ok(isValidPolygon(result.polygon));
    assert.equal(result.polygon.length, 4);
    assert.ok(Math.abs(f.area(result) - 480) < 1e-6);
    assert.equal(pointInPolygon(f.point(110, 103), result.polygon), true);
    assert.equal(pointInPolygon(f.point(110, 112), result.polygon), true);
    assert.equal(pointInPolygon(f.point(98, 112), result.polygon), false);
    const regions = findPlanUnitRegions(f.image);
    assert.equal(regions.length, 1, 'one kiosk, not a separate unit for each side of its label');
  });
}

test('one-pixel shared wall keeps two equally coloured labelled kiosks separate', () => {
  const f = fixture();
  f.enclosed(100, 100, 120, 124);
  f.enclosed(121, 100, 141, 124);
  f.rect(100, 110, 120, 116, white);
  f.rect(121, 110, 141, 116, white);
  const regions = findPlanUnitRegions(f.image);
  assert.equal(regions.length, 2);
  assert.equal(planPolygonsOverlap(regions[0].polygon, regions[1].polygon), false);
  for (const x of [110, 131]) {
    const region = regions.find(r => pointInPolygon(f.point(x, 112), r.polygon));
    assert.ok(region);
    assert.ok(Math.abs(f.area(region) - 480) < 1e-6);
  }
});

test('a differently coloured neighbouring floor is not swallowed by the light-ink recovery', () => {
  const f = fixture();
  f.enclosed(100, 100, 130, 124);
  f.rect(120, 100, 130, 124, [232, 165, 120]);
  f.rect(100, 110, 120, 115, white);
  const result = f.trace(110, 120);
  assert.ok(result);
  assert.ok(Math.abs(f.area(result) - 480) < 1e-6);
  assert.equal(pointInPolygon(f.point(125, 112), result.polygon), false);
});

test('an opening into the pale mall cannot turn a partial coloured fill into a broad enclosed outline', () => {
  const f = fixture();
  f.enclosed(100, 100, 122, 124);
  f.rect(100, 109, 130, 116, white);
  const result = f.trace(110, 120);
  assert.ok(result);
  assert.equal(pointInPolygon(f.point(110, 103), result.polygon), false, 'unbounded light-ink attempt must fall back');
  assert.equal(pointInPolygon(f.point(127, 112), result.polygon), false);
  assert.ok(f.area(result) < 220);
});

test('thin black leader ink is excluded from the outer demise without extending into the mall', () => {
  const f = fixture();
  f.enclosed(100, 100, 126, 150);
  f.rect(117, 119, 140, 121, [5, 5, 5]);
  const result = f.trace(108, 140);
  assert.ok(result);
  assert.equal(result.polygon.length, 4);
  assert.ok(Math.abs(f.area(result) - 1300) < 1e-6);
  assert.equal(pointInPolygon(f.point(120, 120), result.polygon), true);
  assert.equal(pointInPolygon(f.point(131, 120), result.polygon), false);
});

test('large stepped and concave demises keep real recesses while white edge lettering is ignored', () => {
  const f = fixture();
  const shape = [f.point(100, 100), f.point(210, 100), f.point(210, 130), f.point(245, 130),
    f.point(245, 210), f.point(285, 210), f.point(285, 155), f.point(360, 155),
    f.point(360, 350), f.point(160, 350), f.point(160, 170), f.point(100, 170)];
  for (let y = 98; y < 352; y++) for (let x = 98; x < 362; x++) {
    if (pointInPolygon(f.point(x + .5, y + .5), shape)) f.rect(x, y, x + 1, y + 1, teal);
    else if ([-1, 0, 1].some(dy => [-1, 0, 1].some(dx => pointInPolygon(f.point(x + dx + .5, y + dy + .5), shape)))) {
      f.rect(x, y, x + 1, y + 1, wall);
    }
  }
  f.rect(205, 345, 230, 350, white);
  const result = f.trace(200, 250);
  assert.ok(result);
  assert.ok(Math.abs(f.area(result) - polygonArea(shape) * 1000000) < 1e-6);
  for (const [x, y] of [[130, 240], [263, 185], [230, 115]]) {
    assert.equal(pointInPolygon(f.point(x, y), result.polygon), false, `real recess ${x},${y} remains outside`);
  }
  assert.equal(pointInPolygon(f.point(217, 348), result.polygon), true);
  assert.ok(result.polygon.length >= 12);
});

test('a narrow real pale recess is not repaired as black leader ink', () => {
  const f = fixture();
  f.enclosed(100, 100, 140, 150);
  f.rect(122, 119, 141, 123, wall);
  f.rect(123, 120, 142, 122, white);
  const result = f.trace(110, 140);
  assert.ok(result);
  assert.equal(pointInPolygon(f.point(130, 121), result.polygon), false);
});

test('JPEG desaturation around a narrow ink cut does not become a notch in a kiosk wall', () => {
  const f = fixture();
  f.enclosed(100, 100, 126, 150);
  f.rect(119, 119, 126, 122, [148, 184, 174]);
  f.rect(120, 120, 140, 121, [5, 5, 5]);
  const result = f.trace(108, 140);
  assert.ok(result);
  assert.equal(result.polygon.length, 4);
  assert.ok(Math.abs(f.area(result) - 1300) < 1e-6);
  assert.equal(pointInPolygon(f.point(123, 119.5), result.polygon), true);
  assert.equal(pointInPolygon(f.point(130, 120), result.polygon), false, 'the external leader never extends the unit');
});

test('a light desaturated recess remains outside the unit beside a dark leader', () => {
  const f = fixture();
  f.enclosed(100, 100, 140, 150);
  f.rect(122, 119, 141, 123, wall);
  f.rect(123, 120, 142, 122, [188, 200, 196]);
  const result = f.trace(110, 140);
  assert.ok(result);
  assert.equal(pointInPolygon(f.point(130, 121), result.polygon), false);
});

for (const [name, colour] of [['white', white], ['pale', [235, 228, 224]]]) {
  test(`${name} enclosed units retain their original outline and interior text holes`, () => {
    const f = fixture();
    f.enclosed(100, 100, 126, 150, colour);
    f.rect(110, 114, 114, 135, [80, 80, 80]);
    const result = f.trace(105, 140);
    assert.ok(result);
    assert.equal(result.polygon.length, 4);
    assert.ok(Math.abs(f.area(result) - 1300) < 1e-6);
    assert.equal(pointInPolygon(f.point(112, 125), result.polygon), true);
  });
}

test('semantic review flag survives mapping and requires a literal boolean', () => {
  const frame = { x: 0, y: 0, width: 1, height: 1 };
  const rows = mapDetectedPlanUnits({ units: [
    { unitRef: 'A1', seed: { x: .2, y: .2 }, reviewRequired: true },
    { unitRef: 'A2', seed: { x: .4, y: .4 }, reviewRequired: 'true' },
  ] }, frame);
  assert.equal(rows[0].reviewRequired, true);
  assert.equal(rows[1].reviewRequired, undefined);
});
