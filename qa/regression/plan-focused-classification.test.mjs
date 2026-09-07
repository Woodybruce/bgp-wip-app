import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import sharp from 'sharp';
import { mapDetectedPlanUnits } from '../../server/plan-unit-detection.ts';

const require = createRequire(import.meta.url);
const { evaluate, find, ts } = require('./source-harness.cjs');
const source = ['DETECT_PROMPT', 'extractJsonObject', 'detectTile'].map(name =>
  find('server/evidence-plan.ts', node => (ts.isFunctionDeclaration(node) && node.name?.text === name)
    || (ts.isVariableStatement(node) && node.declarationList.declarations.some(item => item.name.getText() === name)))
).join('\n');
const W = 400, H = 300;
const regions = [
  { id: 101, polygon: [{ x: .1, y: .2 }, { x: .35, y: .2 }, { x: .35, y: .7 }, { x: .1, y: .7 }], dot: { x: .2, y: .4 }, pixels: 15000 },
  { id: 203, polygon: [{ x: .365, y: .3 }, { x: .395, y: .3 }, { x: .395, y: .6 }, { x: .365, y: .6 }], dot: { x: .38, y: .45 }, pixels: 1080 },
];
const image = await sharp(Buffer.from(`<svg width="${W}" height="${H}">
  <rect width="400" height="300" fill="white"/>
  <rect x="40" y="60" width="100" height="150" fill="#71bebb" stroke="#444"/>
  <rect x="146" y="90" width="12" height="90" fill="#71bebb" stroke="#444"/>
  <path d="M65 100h30v4H65z M150 100v65" stroke="white" stroke-width="3"/>
</svg>`)).png().toBuffer();

function harness({ selectedRegions = regions, imageBytes = image, width = W, height = H,
  rows = selectedRegions.map(region => ({ regionId: region.id, isUnit: true, unitRef: null, tenant: null })),
  stopReason = 'end_turn', rawText, providerError } = {}) {
  const calls = [], composites = [], crops = [];
  const instrument = pipeline => {
    const clone = pipeline.clone.bind(pipeline), composite = pipeline.composite.bind(pipeline), extract = pipeline.extract.bind(pipeline);
    pipeline.clone = () => instrument(clone());
    pipeline.composite = options => { composites.push(...options); return composite(options); };
    pipeline.extract = options => { crops.push(options); return extract(options); };
    return pipeline;
  };
  const { run } = evaluate(source + '\nexports.run = detectTile;', {
    anthropic: { messages: { create: async (body, options) => {
      calls.push({ body, options });
      if (providerError) throw providerError;
      return { stop_reason: stopReason, content: [{ type: 'text', text: rawText ?? JSON.stringify({ units: rows }) }] };
    } } },
    require: name => { assert.equal(name, './plan-unit-detection'); return { mapDetectedPlanUnits }; },
  });
  return { calls, composites, crops, run: () => run((...args) => instrument(sharp(...args)), imageBytes, width, height, 0, 0, 1, 1, [], false, selectedRegions, true) };
}

test('focused classification sends matching original and single-boundary crops for every candidate', async () => {
  const fixture = harness();
  await fixture.run();
  assert.equal(fixture.calls.length, 1);
  const content = fixture.calls[0].body.messages[0].content;
  const images = content.filter(block => block.type === 'image').map(block => Buffer.from(block.source.data, 'base64'));
  assert.equal(images.length, regions.length * 2);
  assert.equal(fixture.crops.length, regions.length);
  assert.equal(fixture.composites.length, regions.length);
  for (let index = 0; index < regions.length; index++) {
    const region = regions[index], original = images[index * 2], outlined = images[index * 2 + 1];
    const originalMeta = await sharp(original).metadata(), outlinedMeta = await sharp(outlined).metadata();
    assert.deepEqual([originalMeta.width, originalMeta.height], [outlinedMeta.width, outlinedMeta.height]);
    assert.ok(Math.max(originalMeta.width, originalMeta.height) <= 768);
    const expected = await sharp(image).extract(fixture.crops[index])
      .resize({ width: originalMeta.width, height: originalMeta.height }).jpeg({ quality: 95 }).toBuffer();
    assert.deepEqual(original, expected, 'The label-reading crop must contain only the original drawing');
    assert.notDeepEqual(outlined, original);
    const overlay = fixture.composites[index].input.toString();
    assert.equal((overlay.match(/<polygon\b/g) || []).length, 1, 'Each view must highlight exactly one candidate');
    assert.equal(/<(?:text|line|rect)\b/.test(overlay), false, 'No candidate IDs or grid may obscure the plan');
    const vertices = overlay.match(/points="([^"]+)"/)[1].split(' ').map(pair => pair.split(',').map(Number));
    assert.equal(vertices.length, region.polygon.length);
    const crop = fixture.crops[index];
    for (let vertex = 0; vertex < vertices.length; vertex++) {
      const [x, y] = vertices[vertex];
      assert.ok(Math.abs((x * crop.width / originalMeta.width + crop.left) / W - region.polygon[vertex].x) < 1e-12);
      assert.ok(Math.abs((y * crop.height / originalMeta.height + crop.top) / H - region.polygon[vertex].y) < 1e-12);
    }
    const descriptions = content.filter(block => block.type === 'text' && block.text.startsWith(`Candidate ${region.id}:`));
    assert.equal(descriptions.length, 2, 'The original and boundary image must identify the same candidate');
  }
});

test('focused L-shaped view preserves its interior and fades the excluded notch and exterior only', async () => {
  const width = 240, height = 200;
  const candidate = {
    id: 901,
    polygon: [[40, 40], [180, 40], [180, 160], [140, 160], [140, 80], [40, 80]]
      .map(([x, y]) => ({ x: x / width, y: y / height })),
    dot: { x: 160 / width, y: 120 / height }, pixels: 8800,
  };
  const imageBytes = await sharp(Buffer.from(`<svg width="240" height="200">
    <rect width="240" height="200" fill="rgb(160,180,200)"/>
    <rect x="45" y="85" width="90" height="70" fill="rgb(80,100,120)"/>
    <path d="M40 40H180V160H140V80H40Z" fill="rgb(100,160,150)"/>
  </svg>`)).png().toBuffer();
  const fixture = harness({ selectedRegions: [candidate], imageBytes, width, height });
  const result = await fixture.run();
  assert.deepEqual(result[0].polygon, candidate.polygon, 'The visual mask must not alter the stored candidate geometry');
  const images = fixture.calls[0].body.messages[0].content.filter(block => block.type === 'image')
    .map(block => Buffer.from(block.source.data, 'base64'));
  assert.equal(images.length, 2);
  const [original, focused] = await Promise.all(images.map(bytes => sharp(bytes).removeAlpha().raw().toBuffer({ resolveWithObject: true })));
  assert.deepEqual(original.info, focused.info);
  const crop = fixture.crops[0];
  const expectedOriginal = await sharp(imageBytes).extract(crop)
    .resize({ width: original.info.width, height: original.info.height }).jpeg({ quality: 95 }).toBuffer();
  assert.deepEqual(images[0], expectedOriginal, 'The separate original image must stay completely unmasked');
  const pixel = (decoded, x, y) => {
    const px = Math.round((x - crop.left) * decoded.info.width / crop.width);
    const py = Math.round((y - crop.top) * decoded.info.height / crop.height);
    const offset = (py * decoded.info.width + px) * decoded.info.channels;
    return Array.from(decoded.data.subarray(offset, offset + 3));
  };
  for (const [name, x, y, outside] of [
    ['upper return', 80, 60, false],
    ['vertical leg', 160, 120, false],
    ['neighbour in the concave notch', 80, 120, true],
    ['external context', 30, 30, true],
  ]) {
    const before = pixel(original, x, y), after = pixel(focused, x, y);
    for (let channel = 0; channel < 3; channel++) {
      const expected = outside ? before[channel] * .15 + 255 * .85 : before[channel];
      assert.ok(Math.abs(after[channel] - expected) <= 4,
        `${name}: channel ${channel} should be ${outside ? '85% faded toward white' : 'unchanged'}; got ${after[channel]}, expected ${expected}`);
    }
  }
});

test('focused decisions may arrive out of order but stay bound to the supplied server geometry', async () => {
  const malicious = { seed: { x: .98, y: .98 }, polygon: [{ x: .8, y: .8 }, { x: .9, y: .8 }, { x: .9, y: .9 }] };
  const result = await harness({ rows: [
    { regionId: 203, isUnit: true, unitRef: 'D2', tenant: 'Second shop', ...malicious },
    { regionId: 101, isUnit: true, unitRef: 'D1', tenant: 'First shop', ...malicious },
  ] }).run();
  assert.equal(result.length, regions.length);
  for (const unit of result) {
    const expected = regions.find(region => region.id === unit.regionId);
    assert.deepEqual(unit.seed, expected.dot);
    assert.deepEqual(unit.polygon, expected.polygon);
  }
  assert.deepEqual(result.map(unit => [unit.regionId, unit.unitRef]), [[203, 'D2'], [101, 'D1']]);
});

test('focused classification excludes rejected shapes even when the provider supplies confident labels', async () => {
  const result = await harness({ rows: [
    { regionId: 101, isUnit: false, unitRef: 'D1', tenant: 'Not a complete demise' },
    { regionId: 203, isUnit: true, unitRef: null, tenant: null },
  ] }).run();
  assert.equal(result.length, 1);
  assert.equal(result[0].regionId, 203);
  assert.equal(result[0].unitRef, null, 'A genuine unit with unreadable labels is retained for naming');
  assert.equal(result[0].tenant, null);
  assert.deepEqual(result[0].polygon, regions[1].polygon);
});

test('focused classification permits a complete set of negative decisions', async () => {
  assert.deepEqual(await harness({ rows: regions.map(region => ({ regionId: region.id, isUnit: false })) }).run(), []);
});

const valid = regions.map(region => ({ regionId: region.id, isUnit: true }));
for (const [name, rows] of [
  ['an unknown candidate ID', [valid[0], { regionId: 999, isUnit: true }]],
  ['a duplicate candidate ID', [valid[0], valid[0]]],
  ['an omitted candidate', [valid[0]]],
  ['an additional candidate', [...valid, { regionId: 999, isUnit: false }]],
  ['a numeric-string ID', [valid[0], { regionId: '203', isUnit: true }]],
  ['a null decision row', [valid[0], null]],
  ['a missing decisions array', null],
  ...['true', 1, null, undefined].map(value => [`a nonboolean isUnit (${String(value)})`, [valid[0], { regionId: 203, isUnit: value }]]),
]) {
  test(`focused classification rejects ${name} instead of silently skipping a proposed boundary`, async () => {
    const fixture = harness({ rows });
    await assert.rejects(fixture.run(), /one decision per proposed boundary/);
    assert.equal(fixture.calls.length, 1, 'Only the worker may decide to retry the failed request');
  });
}

test('focused requests keep the provider timeout and disable hidden SDK retries', async () => {
  const fixture = harness();
  await fixture.run();
  assert.equal(fixture.calls[0].options.timeout, 75000);
  assert.equal(fixture.calls[0].options.maxRetries, 0);
  assert.equal(fixture.calls[0].body.model, 'claude-sonnet-4-6');
  assert.equal(fixture.calls[0].body.max_tokens, 6000);
  const failure = harness({ providerError: new Error('Provider timeout') });
  await assert.rejects(failure.run(), /Provider timeout/);
  assert.equal(failure.calls.length, 1);
});

test('focused classification refuses a truncated provider response even if its JSON parses', async () => {
  const fixture = harness({ stopReason: 'max_tokens' });
  await assert.rejects(fixture.run(), /reply was incomplete/);
  assert.equal(fixture.calls.length, 1);
});

test('focused classification rejects malformed provider JSON', async () => {
  await assert.rejects(harness({ rawText: '{"units":[' }).run(), /one decision per proposed boundary/);
});

test('focused worker batches inspect each proposed boundary once without adding a global association pass', async () => {
  const proposals = Array.from({ length: 25 }, (_, index) => ({ ...regions[index % regions.length], id: index + 1 }));
  const batches = [], progress = [];
  const workerSource = find('server/evidence-plan.ts', node => ts.isFunctionDeclaration(node) && node.name?.text === 'runDetectJob');
  const { run } = evaluate(workerSource + '\nexports.run = runDetectJob;', {
    setInterval, clearInterval,
    console: { log() {}, error() {} },
    pool: { query: async (sql, values) => {
      if (sql.startsWith('SELECT DISTINCT unit_ref')) return { rows: [] };
      assert.ok(sql.startsWith('UPDATE evidence_plan_jobs'), `Unexpected SQL: ${sql}`);
      progress.push({ sql, values });
      return { rows: [{ id: 'job' }] };
    }, connect: () => assert.fail('No save transaction is allowed when every proposed shape is rejected') },
    getFile: async () => ({ data: image }),
    detectTile: async (...args) => {
      assert.equal(args[11], true, 'Only focused candidate classification should run when regions are available');
      batches.push(args[10].map(region => region.id));
      return [];
    },
    require: name => {
      if (name === 'sharp') return { default: sharp };
      if (name === './plan-unit-detection') return { findPlanUnitRegions: () => proposals };
      if (name === '@shared/plan-geometry') return {};
      throw new Error(`Unexpected worker dependency: ${name}`);
    },
  });
  await run('plan', 'job', { id: 'level', background_key: 'fixture' }, null);
  assert.deepEqual(batches.map(batch => batch.length), [12, 12, 1]);
  assert.deepEqual(batches.flat(), proposals.map(region => region.id));
  const completed = progress.filter(update => update.sql.includes('total_docs = $3')).slice(1);
  assert.ok(completed.length > 0);
  assert.ok(completed.every(update => update.values[2] === batches.length), 'Progress reports the actual batch count');
  assert.ok(progress.at(-1).values[0].includes('No units could be read'));
});
