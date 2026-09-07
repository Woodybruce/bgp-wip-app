import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import sharp from 'sharp';
import { tracePlanUnit, mapDetectedPlanUnits } from '../../server/plan-unit-detection.ts';
import * as geometry from '../../shared/plan-geometry.ts';
const require = createRequire(import.meta.url);
const { evaluate, find, ts } = require('./source-harness.cjs');
const { pointInPolygon, polygonArea, isValidPolygon } = geometry;
const teal = [110, 190, 185];
function raster(width = 240, height = 180) {
  return { data: Buffer.alloc(width * height * 3, 255), width, height };
}
function rect(image, left, top, right, bottom, colour) {
  for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
    const i = (y * image.width + x) * 3;
    image.data[i] = colour[0]; image.data[i + 1] = colour[1]; image.data[i + 2] = colour[2];
  }
}
const seed = (image, x, y) => ({ x: x / image.width, y: y / image.height });
const trace = (image, x, y) => tracePlanUnit(image, seed(image, x, y));

test('L-shaped fill produces a true concave polygon and an interior marker', () => {
  const image = raster();
  rect(image, 30, 30, 60, 140, teal); rect(image, 30, 110, 150, 140, teal);
  const out = trace(image, 45, 80);
  assert.ok(out);
  assert.equal(out.polygon.length, 6);
  assert.equal(isValidPolygon(out.polygon), true);
  assert.equal(pointInPolygon(seed(image, 100, 65), out.polygon), false, 'notch is outside the demise');
  assert.equal(pointInPolygon(out.dot, out.polygon), true);
  assert.ok(Math.abs(polygonArea(out.polygon) * image.width * image.height - 6000) < 1);
});

test('adjacent identical teal units remain separated by a one-pixel boundary', () => {
  const image = raster();
  rect(image, 30, 30, 100, 130, teal); rect(image, 100, 30, 101, 130, [40, 40, 40]); rect(image, 101, 30, 170, 130, teal);
  const left = trace(image, 70, 70), right = trace(image, 130, 70);
  assert.ok(left && right);
  assert.equal(Math.max(...left.polygon.map(p => p.x)), 100 / image.width);
  assert.equal(Math.min(...right.polygon.map(p => p.x)), 101 / image.width);
  assert.equal(pointInPolygon(right.dot, left.polygon), false);
});

test('a dark grey unit does not absorb a connected, slightly lighter wall line outside the demise', () => {
  const image = raster();
  rect(image, 80, 40, 110, 120, [95, 95, 95]);
  rect(image, 30, 120, 110, 122, [112, 112, 112]);
  rect(image, 30, 20, 32, 160, [112, 112, 112]);
  const out = trace(image, 95, 70);
  assert.ok(out);
  assert.equal(out.pixels, 2400);
  assert.equal(Math.min(...out.polygon.map(p => p.x)), 80 / image.width);
  assert.equal(Math.max(...out.polygon.map(p => p.y)), 120 / image.height);
  assert.equal(pointInPolygon(seed(image, 31, 145), out.polygon), false);
});

test('large anchors wider than a detection tile and over the old area limit remain traceable', () => {
  const image = raster();
  rect(image, 20, 20, 200, 110, teal);
  const out = trace(image, 100, 70);
  assert.ok(out);
  assert.ok(polygonArea(out.polygon) > .12);
  assert.ok(Math.max(...out.polygon.map(p => p.x)) - Math.min(...out.polygon.map(p => p.x)) > .4);
});

test('small white units enclosed by dark boundaries are not discarded for lacking saturated fill', () => {
  const image = raster();
  rect(image, 80, 60, 92, 70, [30, 30, 30]); rect(image, 81, 61, 91, 69, [255, 255, 255]);
  const out = trace(image, 85, 65);
  assert.ok(out);
  assert.equal(out.pixels, 80);
  assert.ok(polygonArea(out.polygon) < .004);
});

test('pale fills, slanted borders and white text holes keep the exterior outline', () => {
  const image = raster();
  const polygon = [{ x: .2, y: .2 }, { x: .6, y: .3 }, { x: .5, y: .7 }, { x: .2, y: .7 }];
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
    if (pointInPolygon(seed(image, x + .5, y + .5), polygon)) rect(image, x, y, x + 1, y + 1, [232, 225, 220]);
  }
  rect(image, 70, 65, 74, 82, [255, 255, 255]);
  const out = trace(image, 65, 90);
  assert.ok(out);
  assert.ok(out.polygon.length >= 4);
  assert.ok(Math.abs(polygonArea(out.polygon) - polygonArea(polygon)) < .01);
  assert.equal(pointInPolygon(out.dot, out.polygon), true);
});

test('text holes touching the boundary at diagonal pixels do not create a self-intersecting outline', () => {
  const image = raster();
  rect(image, 30, 30, 100, 140, teal);
  rect(image, 93, 128, 97, 133, [255, 255, 255]);
  rect(image, 97, 133, 98, 135, [255, 255, 255]);
  rect(image, 98, 135, 99, 138, [255, 255, 255]);
  rect(image, 99, 138, 100, 140, [255, 255, 255]);
  const out = trace(image, 60, 70);
  assert.ok(out);
  assert.equal(isValidPolygon(out.polygon), true);
  assert.ok(polygonArea(out.polygon) * image.width * image.height > 7600);
});

test('unbounded page/mall regions and invalid seeds are rejected', () => {
  const image = raster();
  assert.equal(trace(image, 100, 90), null);
  for (const point of [{ x: NaN, y: .2 }, { x: -.1, y: .2 }, { x: .1, y: 1.1 }]) assert.equal(tracePlanUnit(image, point), null);
});

test('model parsing demands proper JSON shape and finite coordinates, and maps the actual crop frame', () => {
  assert.throws(() => mapDetectedPlanUnits(null, { x: 0, y: 0, width: 1, height: 1 }), /valid units array/);
  const result = mapDetectedPlanUnits({ units: [
    { unitRef: 'A1', seed: { x: .5, y: .25 } },
    { unitRef: 'bad', seed: { x: '0.5', y: .25 } },
    { unitRef: 'legacy-box', x0: .2, y0: .3, x1: .4, y1: .5 },
  ] }, { x: .3, y: .6, width: .4, height: .4 });
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].seed, { x: .5, y: .7 });
});

async function detectionJob({ existing = [], candidates, changedBackground = false } = {}) {
  const image = raster(); rect(image, 20, 20, 75, 100, teal); rect(image, 90, 20, 140, 100, teal);
  const png = await sharp(image.data, { raw: { width: image.width, height: image.height, channels: 3 } }).png().toBuffer();
  const writes = [], refinements = [], updates = [], allQueries = [];
  const current = existing.map(row => ({ ...row }));
  let calls = 0, released = false;
  const jobSource = find('server/evidence-plan.ts', node => ts.isFunctionDeclaration(node) && node.name?.text === 'runDetectJob');
  const { run } = evaluate(jobSource + '\nexports.run = runDetectJob;', {
    pool: {
      async query(sql, values) {
        allQueries.push(sql);
        if (sql.startsWith('SELECT DISTINCT unit_ref')) return { rows: [] };
        if (sql.startsWith('UPDATE evidence_plan_jobs')) { updates.push({ sql, values }); return { rows: [] }; }
        assert.fail(`Unexpected pool query ${sql}`);
      },
      async connect() {
        return {
          async query(sql, values) {
            allQueries.push(sql);
            if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql)) return { rows: [] };
            if (sql.startsWith('SELECT background_key')) return { rows: [{ background_key: changedBackground ? 'changed' : 'original' }] };
            if (sql.startsWith('SELECT id, unit_ref')) return { rows: [...current] };
            if (sql.startsWith('INSERT INTO evidence_plan_units')) {
              writes.push(values);
              const row = { id: 'new-unit', unit_ref: values[2], polygon: JSON.parse(values[4]), source: 'ai' };
              current.push(row); return { rows: [row] };
            }
            if (sql.startsWith('UPDATE evidence_plan_units SET polygon')) {
              assert.equal(sql, "UPDATE evidence_plan_units SET polygon = $1 WHERE id = $2 AND source = 'ai'");
              refinements.push(values);
              current.find(row => row.id === values[1]).polygon = JSON.parse(values[0]);
              return { rows: [], rowCount: 1 };
            }
            if (sql.startsWith('UPDATE evidence_plans')) return { rows: [] };
            assert.fail(`Unexpected transaction query ${sql}`);
          },
          release() { released = true; },
        };
      },
    },
    getFile: async () => ({ data: png }),
    detectTile: async () => calls++ === 0 ? (candidates || [
      { unitRef: 'A1', tenant: 'Tenant A', seed: seed(image, 45, 60), polygon: null },
      { unitRef: 'A2', tenant: 'Tenant B', seed: seed(image, 115, 60), polygon: null },
    ]) : [],
    normaliseUnitRef: value => String(value).trim().toUpperCase(), normTenantName: value => String(value || '').toUpperCase(),
    relinkAllEntries: async () => 0,
    require(name) {
      if (name === 'sharp') return { default: sharp };
      if (name === './plan-unit-detection') return { tracePlanUnit };
      if (name === '@shared/plan-geometry') return geometry;
      throw new Error(`Unexpected module ${name}`);
    },
  });
  await run('plan', 'job', { id: 'level', background_key: 'original' }, null, true);
  return { writes, refinements, updates, allQueries, current, released, calls };
}

test('refresh keeps manually saved outlines, identifiers and attached data while adding a missing outline', async () => {
  const preserved = { id: 'saved', unit_ref: 'A1', polygon: [{ x: .08, y: .1 }, { x: .33, y: .1 }, { x: .33, y: .6 }, { x: .08, y: .6 }], source: 'manual', dot: { x: .2, y: .3 }, passing_rent: 120000, notes: 'Saved human facts' };
  const result = await detectionJob({ existing: [preserved] });
  assert.equal(result.calls, 10, 'overview plus nine close-up tiles');
  assert.equal(result.writes.length, 1);
  assert.equal(result.writes[0][2], 'A2');
  assert.deepEqual(result.current[0], preserved);
  assert.equal(result.allQueries.some(sql => /DELETE|UPDATE evidence_plan_units|UPDATE evidence_plan_entries/.test(sql)), false);
  assert.equal(result.released, true);
});

test('a unique AI outline is refined in place while id, source, marker and all saved facts remain intact', async () => {
  const preserved = { id: 'saved', unit_ref: 'A1', polygon: [{ x: .08, y: .1 }, { x: .33, y: .1 }, { x: .33, y: .6 }, { x: .08, y: .6 }], source: 'ai', dot: { x: .32, y: .58 }, passing_rent: 120000, notes: 'Saved human facts', tenant_name: 'Saved tenant', ts_row_id: 'schedule-row' };
  const result = await detectionJob({ existing: [preserved] });
  assert.equal(result.refinements.length, 1);
  const { polygon, ...unchanged } = result.current[0];
  const { polygon: oldPolygon, ...original } = preserved;
  assert.deepEqual(unchanged, original);
  assert.notDeepEqual(polygon, oldPolygon);
  assert.equal(result.allQueries.some(sql => /DELETE|UPDATE evidence_plan_entries/.test(sql)), false);
  assert.ok(result.updates.at(-1).values[3].includes('1 existing AI outlines refined'));
});

test('repeated saved refs and an AI label in a different place cannot replace existing geometry', async () => {
  const saved = { id: 'saved', unit_ref: 'A1', polygon: [{ x: .7, y: .2 }, { x: .8, y: .2 }, { x: .8, y: .4 }, { x: .7, y: .4 }], source: 'ai' };
  assert.equal((await detectionJob({ existing: [saved] })).refinements.length, 0);
  const box = [{ x: .08, y: .1 }, { x: .33, y: .1 }, { x: .33, y: .6 }, { x: .08, y: .6 }];
  const duplicate = await detectionJob({ existing: [{ ...saved, polygon: box }, { ...saved, id: 'second', polygon: box }] });
  assert.equal(duplicate.refinements.length, 0);
});

test('conflicting printed labels on the same traced shape are withheld for review', async () => {
  const result = await detectionJob({ candidates: [
    { unitRef: 'A1', seed: { x: 45 / 240, y: 60 / 180 }, polygon: null },
    { unitRef: 'A2', seed: { x: 50 / 240, y: 65 / 180 }, polygon: null },
  ] });
  assert.equal(result.writes.length, 0);
  assert.equal(result.refinements.length, 0);
  assert.ok(result.updates.at(-1).values[3].includes('conflicting or repeated unit labels'));
});

test('two distinct demises with the same printed reference are withheld for review', async () => {
  const result = await detectionJob({ candidates: [
    { unitRef: 'A1', seed: { x: 45 / 240, y: 60 / 180 }, polygon: null },
    { unitRef: 'A1', seed: { x: 115 / 240, y: 60 / 180 }, polygon: null },
  ] });
  assert.equal(result.writes.length, 0);
  assert.ok(result.updates.at(-1).values[3].includes('conflicting or repeated unit labels'));
});

test('a failed trace never removes existing units or pretends an approximate box is an outline', async () => {
  const result = await detectionJob({ existing: [{ id: 'saved', unit_ref: 'A1', source: 'manual' }], candidates: [{ unitRef: 'mall', seed: { x: .85, y: .85 }, polygon: null }] });
  assert.equal(result.writes.length, 0);
  assert.ok(result.updates.at(-1).sql.includes("status = 'error'"));
  assert.equal(result.allQueries.some(sql => /DELETE/.test(sql)), false);
});

test('a replaced image during scanning aborts before inserting geometry for the obsolete frame', async () => {
  const result = await detectionJob({ changedBackground: true });
  assert.equal(result.writes.length, 0);
  assert.ok(result.allQueries.includes('ROLLBACK'));
  assert.equal(result.released, true);
});
