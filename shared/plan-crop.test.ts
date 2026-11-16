import test from "node:test";
import assert from "node:assert/strict";
import { readPlanCropRect, planCropPixels, cropPlanOutline, planCropOutcome, planCropRefusal, uncropPlanOutline,
  planCropStorageKey, planCropOrigin, type PlanPointPair } from "./plan-crop";

const square = (x: number, y: number, side: number): PlanPointPair[] => [[x, y], [x + side, y], [x + side, y + side], [x, y + side]];
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} is not ${b}`);

test("a crop is read from the request, kept inside the page, and refused when it is no crop", () => {
  assert.deepEqual(readPlanCropRect({ x: 0.1, y: 0.2, width: 0.5, height: 0.6 }), { rect: { x: 0.1, y: 0.2, width: 0.5, height: 0.6 } });
  // A hair over the edge is the edge.
  const edge = readPlanCropRect({ x: -0.001, y: 0, width: 0.6, height: 1.001 });
  assert.ok("rect" in edge);
  assert.equal(edge.rect.x, 0); close(edge.rect.width, 0.599); assert.equal(edge.rect.height, 1);
  for (const bad of [null, {}, { x: "0", y: 0, width: 1, height: 1 }, { x: 0, y: 0, width: NaN, height: 1 }]) assert.ok("error" in readPlanCropRect(bad));
  assert.match((readPlanCropRect({ x: 0.5, y: 0.5, width: 0.7, height: 0.2 }) as any).error, /inside the page/);
  assert.match((readPlanCropRect({ x: 0.1, y: 0.1, width: 0.02, height: 0.5 }) as any).error, /too small/);
  assert.match((readPlanCropRect({ x: 0, y: 0, width: 1, height: 1 }) as any).error, /whole page/);
  // One side at full length is still a crop.
  assert.ok("rect" in readPlanCropRect({ x: 0, y: 0, width: 0.8, height: 1 }));
});

test("the crop is cut on whole pixels and the outlines are measured against exactly that cut", () => {
  const { pixels, rect } = planCropPixels({ x: 0.1003, y: 0.2, width: 0.5, height: 0.6 }, 1000, 500);
  assert.deepEqual(pixels, { left: 100, top: 100, width: 500, height: 300 });
  assert.deepEqual(rect, { x: 0.1, y: 0.2, width: 0.5, height: 0.6 });
  // Never past the image.
  assert.deepEqual(planCropPixels({ x: 0.5, y: 0.5, width: 0.5, height: 0.5 }, 999, 333).pixels, { left: 500, top: 167, width: 499, height: 166 });
});

test("an outline inside the crop is re-measured, one outside or cut through is named", () => {
  const rect = { x: 0.2, y: 0.2, width: 0.5, height: 0.5 };
  const inside = cropPlanOutline(square(0.3, 0.3, 0.1), rect);
  assert.equal(inside.where, "inside");
  if (inside.where === "inside") { close(inside.points[0][0], 0.2); close(inside.points[0][1], 0.2); close(inside.points[2][0], 0.4); close(inside.points[2][1], 0.4); }
  assert.equal(cropPlanOutline(square(0.8, 0.8, 0.1), rect).where, "outside");
  assert.equal(cropPlanOutline(square(0.05, 0.3, 0.1), rect).where, "outside");
  assert.equal(cropPlanOutline(square(0.15, 0.3, 0.1), rect).where, "cut");
  // An outline traced to the very edge of the crop is inside it, held to 0..1.
  const edge = cropPlanOutline(square(0.1995, 0.3, 0.1), rect);
  assert.equal(edge.where, "inside");
  if (edge.where === "inside") assert.equal(edge.points[0][0], 0);
  // An outline that surrounds the crop is cut, never called outside.
  assert.equal(cropPlanOutline([[0, 0], [1, 0], [1, 1], [0, 1]], rect).where, "cut");
  assert.equal(cropPlanOutline([[0.3, 0.3]], rect).where, "cut");
});

test("a crop never loses a matched unit: loose outlines outside go, anything cut or matched outside stops it", () => {
  const rect = { x: 0, y: 0, width: 0.75, height: 1 };
  const outlines = [
    { id: "keep", points: square(0.1, 0.1, 0.1), linked: true },
    { id: "legend-box", points: square(0.8, 0.1, 0.1), linked: false },
    { id: "matched-outside", points: square(0.8, 0.5, 0.1), linked: true },
    { id: "cut", points: square(0.7, 0.8, 0.1), linked: false },
  ];
  const outcome = planCropOutcome(outlines, rect);
  assert.deepEqual(outcome.keep.map(row => row.id), ["keep"]);
  assert.deepEqual(outcome.remove, ["legend-box"]);
  assert.deepEqual(outcome.linkedOutside, ["matched-outside"]);
  assert.deepEqual(outcome.cut, ["cut"]);
  assert.equal(planCropRefusal(outcome), "This crop would cut through 1 unit outline and leave 1 matched unit outside it. Drag a bigger box, or remove those outlines first.");
  const fine = planCropOutcome(outlines.slice(0, 2), rect);
  assert.equal(planCropRefusal(fine), null);
  assert.deepEqual(fine.remove, ["legend-box"]);
});

test("restoring the whole page puts every outline back where it was", () => {
  const rect = { x: 0.1, y: 0.2, width: 0.5, height: 0.6 };
  const original = square(0.3, 0.4, 0.2);
  const cropped = cropPlanOutline(original, rect);
  assert.equal(cropped.where, "inside");
  if (cropped.where !== "inside") return;
  const back = uncropPlanOutline(cropped.points, rect);
  back.forEach((point, index) => { close(point[0], original[index][0]); close(point[1], original[index][1]); });
});

test("the cropped image's key names the page it was cut from, and only such a key reads as a crop", () => {
  const pixels = { left: 100, top: 50, width: 800, height: 600 };
  const key = planCropStorageKey("property-plans/p1/pdf-abc/page-1.png", pixels, 1200, 900, "M3X9-a");
  assert.equal(key, "property-plans/p1/pdf-abc/page-1.png.crop-100-50-800-600-of-1200x900-m3x9a.png");
  const origin = planCropOrigin(key);
  assert.ok(origin);
  assert.equal(origin.pageKey, "property-plans/p1/pdf-abc/page-1.png");
  assert.deepEqual(origin.pixels, pixels);
  assert.deepEqual(origin.rect, { x: 100 / 1200, y: 50 / 900, width: 800 / 1200, height: 600 / 900 });
  // A crop of a crop goes back one step at a time.
  const second = planCropStorageKey(key, { left: 10, top: 10, width: 400, height: 300 }, 800, 600, "zz1");
  assert.equal(planCropOrigin(second)?.pageKey, key);
  for (const plain of ["property-plans/p1/plan.png", "", null, undefined, "x.crop-1-2-3-4-of-0x0-a.png", "x.crop-900-0-800-600-of-1200x900-a.png"]) assert.equal(planCropOrigin(plain as any), null);
});
