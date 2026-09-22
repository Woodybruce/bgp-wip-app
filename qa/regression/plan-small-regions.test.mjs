import assert from 'node:assert/strict';
import test from 'node:test';
import { findPlanUnitRegions } from '../../server/plan-unit-detection.ts';
import { pointInPolygon, polygonArea } from '../../shared/plan-geometry.ts';

function fixture() {
  const image = { width: 1000, height: 1000, data: Buffer.alloc(1000 * 1000 * 3, 255) };
  const rect = (left, top, right, bottom, colour) => {
    for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) image.data.set(colour, (y * image.width + x) * 3);
  };
  const kiosk = left => {
    rect(left - 2, 98, left + 21, 123, [60, 90, 80]);
    rect(left, 100, left + 19, 121, [142, 175, 168]);
    // A compressed edge differs from the centre just beyond the ordinary
    // colour tolerance. Lettering leaves no large clear patch in either fill.
    rect(left + 3, 103, left + 16, 118, [130, 201, 195]);
    rect(left + 6, 106, left + 9, 111, [230, 255, 250]);
    rect(left + 12, 106, left + 14, 111, [230, 255, 250]);
  };
  return { image, rect, kiosk };
}

test('small labelled coloured kiosks retain their complete border, without absorbing adjacent mall or shop', () => {
  const { image, rect, kiosk } = fixture();
  kiosk(100); kiosk(123);
  rect(90, 130, 180, 230, [110, 190, 185]);
  const regions = findPlanUnitRegions(image);
  assert.equal(regions.length, 3);
  for (const left of [100, 123]) {
    const region = regions.find(row => pointInPolygon({ x: (left + 10) / 1000, y: .108 }, row.polygon));
    assert.ok(region, 'the printed label stays within a complete kiosk contour');
    assert.equal(region.polygon.length, 4);
    assert.ok(Math.abs(polygonArea(region.polygon) * 1000000 - 399) < 1e-6);
    assert.equal(pointInPolygon({ x: (left - 1) / 1000, y: .108 }, region.polygon), false);
    assert.equal(pointInPolygon({ x: (left + 10) / 1000, y: .125 }, region.polygon), false);
  }
  const shop = regions.find(row => pointInPolygon({ x: .15, y: .18 }, row.polygon));
  assert.ok(shop);
  assert.ok(Math.abs(polygonArea(shop.polygon) * 1000000 - 9000) < 1e-6);
  assert.equal(regions.some(row => pointInPolygon({ x: .5, y: .5 }, row.polygon)), false);
});

test('a large printed logo remains inside a small complete shop contour', () => {
  const { image, rect } = fixture();
  rect(100, 100, 160, 140, [110, 190, 185]);
  rect(114, 105, 146, 135, [255, 255, 255]);
  const regions = findPlanUnitRegions(image);
  assert.equal(regions.length, 1);
  assert.ok(Math.abs(polygonArea(regions[0].polygon) * 1000000 - 2400) < 1e-6);
  assert.equal(pointInPolygon({ x: .13, y: .12 }, regions[0].polygon), true);
});

test('a one-pixel logo gap closes without bridging a real mall notch or adjacent unit', () => {
  const { image, rect } = fixture();
  rect(200, 200, 230, 300, [110, 190, 185]);
  rect(202, 218, 228, 282, [255, 255, 255]);
  rect(200, 249, 202, 250, [255, 255, 255]);
  rect(231, 200, 260, 300, [110, 190, 185]);
  rect(300, 200, 315, 290, [110, 190, 185]);
  rect(300, 275, 360, 290, [110, 190, 185]);
  const regions = findPlanUnitRegions(image);
  assert.equal(regions.length, 3);
  const labelled = regions.find(row => pointInPolygon({ x: .215, y: .25 }, row.polygon));
  assert.ok(labelled);
  assert.ok(Math.abs(polygonArea(labelled.polygon) * 1000000 - 3000) < 1e-6);
  assert.equal(pointInPolygon({ x: .24, y: .25 }, labelled.polygon), false);
  const concave = regions.find(row => pointInPolygon({ x: .31, y: .23 }, row.polygon));
  assert.ok(concave);
  assert.equal(pointInPolygon({ x: .33, y: .24 }, concave.polygon), false);
  assert.ok(Math.abs(polygonArea(concave.polygon) * 1000000 - 2025) < 1e-6);
});

test('narrow coloured kiosks survive the minimum-size filter on a large plan', () => {
  const image = { width: 3000, height: 2200, data: Buffer.alloc(3000 * 2200 * 3, 255) };
  for (let y = 100; y < 112; y++) for (let x = 100; x < 108; x++) image.data.set([110, 190, 185], (y * image.width + x) * 3);
  const regions = findPlanUnitRegions(image);
  assert.equal(regions.length, 1);
  assert.ok(Math.abs(polygonArea(regions[0].polygon) * image.width * image.height - 96) < 1e-6);
});
