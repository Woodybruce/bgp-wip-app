import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import sharp from 'sharp';
import { hideRedPlanInk, redInkHiddenPlanImage } from '../../server/plan-display-image.ts';

const require = createRequire(import.meta.url);
const { find, evaluate, ts } = require('./source-harness.cjs');
const width = 90, height = 70;
const pixel = (data, x, y) => [...data.subarray((y * width + x) * 3, (y * width + x) * 3 + 3)];
function fixture() {
  const data = Buffer.alloc(width * height * 3, 245);
  const set = (x, y, colour) => colour.forEach((value, channel) => { data[(y * width + x) * 3 + channel] = value; });
  for (let x = 8; x < 80; x++) { set(x, 20, [255, 0, 0]); set(x, 35, [255, 135, 0]); }
  for (let y = 5; y < 65; y++) { set(30, y, [0, 0, 0]); set(60, y, [135, 135, 135]); }
  set(10, 19, [252, 240, 238]); // A faint JPEG fringe beside the red stroke.
  set(10, 55, [252, 240, 238]); // Identical warm paper away from red ink.
  set(15, 55, [0, 80, 255]); set(20, 55, [30, 180, 140]); set(25, 55, [255, 0, 255]);
  return data;
}
const encode = data => sharp(data, { raw: { width, height, channels: 3 } }).png().toBuffer();

test('hide-red removes red/orange ink and adjacent fringes while preserving neutral drawing pixels and other colours', async () => {
  const input = fixture(), source = await encode(input), originalBytes = Buffer.from(source);
  const rendered = await hideRedPlanInk(source);
  const result = await sharp(rendered).raw().toBuffer();
  assert.deepEqual(pixel(result, 15, 20), [245, 245, 245]);
  assert.deepEqual(pixel(result, 15, 35), [245, 245, 245]);
  assert.deepEqual(pixel(result, 10, 19), [245, 245, 245]);
  for (let y = 5; y < 65; y++) {
    assert.deepEqual(pixel(result, 30, y), [0, 0, 0]);
    assert.deepEqual(pixel(result, 60, y), [135, 135, 135]);
  }
  for (const x of [10, 15, 20, 25]) assert.deepEqual(pixel(result, x, 55), pixel(input, x, 55));
  assert.deepEqual(source, originalBytes, 'source buffer stays unchanged');
  const metadata = await sharp(rendered).metadata();
  assert.equal(metadata.format, 'png');
  assert.equal(metadata.width, width); assert.equal(metadata.height, height);
  assert.deepEqual(await sharp(await hideRedPlanInk(rendered)).raw().toBuffer(), result, 'display treatment is idempotent');
});

test('a JPEG-derived display hides compressed red strokes without changing the image frame', async () => {
  const source = await sharp(fixture(), { raw: { width, height, channels: 3 } }).jpeg({ quality: 75 }).toBuffer();
  const before = await sharp(source).raw().toBuffer();
  const rendered = await hideRedPlanInk(source), after = await sharp(rendered).raw().toBuffer();
  let redBefore = 0, redAfter = 0;
  for (let offset = 0; offset < before.length; offset += 3) {
    if (before[offset] >= 100 && before[offset + 1] >= before[offset + 2] - 12 && before[offset] - before[offset + 1] >= 22 && before[offset] - before[offset + 2] >= 28) redBefore++;
    if (after[offset] >= 100 && after[offset + 1] >= after[offset + 2] - 12 && after[offset] - after[offset + 1] >= 22 && after[offset] - after[offset + 2] >= 28) redAfter++;
    if (before[offset] === before[offset + 1] && before[offset] === before[offset + 2]) assert.deepEqual(after.subarray(offset, offset + 3), before.subarray(offset, offset + 3));
  }
  assert.ok(redBefore > 40); assert.equal(redAfter, 0);
  assert.equal(after.length, before.length);
});

test('display cache reuses an immutable background key and evicts beyond three images', async () => {
  const source = await encode(fixture());
  const one = await redInkHiddenPlanImage('qa-red-cache-1', source);
  assert.equal(await redInkHiddenPlanImage('qa-red-cache-1', source), one);
  await redInkHiddenPlanImage('qa-red-cache-2', source);
  await redInkHiddenPlanImage('qa-red-cache-3', source);
  await redInkHiddenPlanImage('qa-red-cache-4', source);
  const repeated = await redInkHiddenPlanImage('qa-red-cache-1', source);
  assert.notEqual(repeated, one, 'oldest encoded image was evicted');
  assert.deepEqual(repeated, one);
});

test('background route opts into display cleanup without writing files or changing the default response', async () => {
  const route = find('server/evidence-plan.ts', node => ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
    && node.expression.expression.getText() === 'router' && node.expression.name.text === 'get'
    && ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === '/api/evidence-plans/levels/:levelId/background');
  const original = Buffer.from('unchanged JPEG'), variant = Buffer.from('derived PNG');
  let handler, calls = 0;
  evaluate(route + ';', {
    router: { get: (_path, _auth, fn) => { handler = fn; } }, requireAuth: () => {},
    pool: { query: async sql => { assert.match(sql, /^SELECT/); return { rows: [{ background_key: 'stored-plan' }] }; } },
    getFile: async key => { assert.equal(key, 'stored-plan'); return { data: original, contentType: 'image/jpeg' }; },
    redInkHiddenPlanImage: async (key, buffer) => { calls++; assert.equal(key, 'stored-plan'); assert.equal(buffer, original); return variant; },
  });
  for (const hideRed of [undefined, '0', '1']) {
    const headers = {}; let body;
    await handler({ params: { levelId: 'level' }, query: { hideRed } }, {
      setHeader: (key, value) => { headers[key] = value; }, send: value => { body = value; },
    });
    assert.equal(body, hideRed === '1' ? variant : original);
    assert.equal(headers['Content-Type'], hideRed === '1' ? 'image/png' : 'image/jpeg');
    assert.match(headers['Cache-Control'], /^private/);
  }
  assert.equal(calls, 1);
});
