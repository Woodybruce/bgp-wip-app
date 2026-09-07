import assert from "node:assert/strict";
import { test } from "node:test";
import { boundaryDistance, containedMarker, interiorPoint, isValidPolygon, moveMarkerInside, pointInPolygon } from "../../shared/plan-geometry";

const lShape = [{ x: .1, y: .1 }, { x: .3, y: .1 }, { x: .3, y: .7 }, { x: .8, y: .7 }, { x: .8, y: .9 }, { x: .1, y: .9 }];
const square = [{ x: .1, y: .1 }, { x: .8, y: .1 }, { x: .8, y: .8 }, { x: .1, y: .8 }];

test("concave demise gets a label inside its shape, where a vertex average is outside", () => {
  assert.equal(pointInPolygon({ x: .4, y: .5666 }, lShape), false);
  assert.ok(pointInPolygon(interiorPoint(lShape), lShape));
  const marker = containedMarker(lShape, { x: .5, y: .2 }, .04);
  assert.ok(pointInPolygon(marker, lShape));
  assert.ok(boundaryDistance(marker, lShape) > marker.radius);
});

test("valid saved label positions do not drift as zoom changes", () => {
  const anchor = { x: .25, y: .3 };
  for (const radius of [.03, .015, .008]) {
    const marker = containedMarker(square, anchor, radius, .75);
    assert.equal(marker.x, anchor.x);
    assert.ok(Math.abs(marker.y - anchor.y) < 1e-12);
    assert.equal(marker.radius, radius);
  }
});

test("a disc near the edge shrinks to fit without crossing a boundary", () => {
  const marker = containedMarker(square, { x: .1005, y: .3 }, .04);
  assert.ok(marker.radius < .0005);
  assert.equal(marker.x, .1005);
});

test("label drag outside a concave demise remains within the unit at either image aspect", () => {
  for (const aspect of [.5, 1, 2]) for (const desired of [{ x: .5, y: .2 }, { x: -1, y: 0 }, { x: 2, y: 2 }]) {
    const point = moveMarkerInside(lShape, desired, .025, aspect);
    assert.ok(pointInPolygon(point, lShape));
    const scaled = lShape.map(p => ({ x: p.x, y: p.y * aspect }));
    assert.ok(boundaryDistance({ x: point.x, y: point.y * aspect }, scaled) >= .0247);
  }
});

test("label drag inside free space preserves the requested point exactly", () => {
  const point = { x: .35, y: .55 };
  assert.deepEqual(moveMarkerInside(square, point, .025, .75), point);
});

test("drawing validation rejects crossed, duplicate, outside and nonfinite corners", () => {
  assert.ok(isValidPolygon(lShape));
  assert.ok(isValidPolygon([...lShape].reverse()));
  for (const invalid of [[], square.slice(0, 2), [square[0], square[2], square[1], square[3]], [...square, square[0]], square.map(p => ({ ...p, x: -1 })), square.map(p => ({ ...p, x: NaN }))]) assert.equal(isValidPolygon(invalid), false);
});
