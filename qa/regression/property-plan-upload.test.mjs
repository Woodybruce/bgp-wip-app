import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { PropertyPlanInputError } from '../../server/property-plan-links.ts';
const require = createRequire(import.meta.url);
const { find, evaluate, ts } = require('./source-harness.cjs');
const file = 'server/property-plans.ts';
const handlerSource = find(file, (node, ast) => ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
  && node.expression.expression.getText(ast) === 'router' && node.expression.name.text === 'post'
  && node.arguments[0]?.text === '/api/properties/:propertyId/plans') + ';';
const errorHelper = find(file, node => ts.isFunctionDeclaration(node) && node.name?.text === 'errorResponse');
function fixture({ blocked = false, missing = false } = {}) {
  let handler;
  const saved = [], queries = [];
  evaluate(`${errorHelper}\n${handlerSource}`, {
    sharp, PropertyPlanInputError, crypto: { randomUUID }, requireAuth() {}, upload: { single() {} },
    router: { post(_path, _auth, _upload, fn) { handler = fn; } },
    clientBlockedForProperty: async () => blocked,
    saveFile: async (...args) => saved.push(args),
    pool: { async query(sql, values) {
      queries.push({ sql, values });
      return sql.startsWith('SELECT') ? { rows: missing ? [] : [{ id: values[0] }] }
        : { rows: [{ id: values[0], property_id: values[1], storage_key: values[5], width: values[6], height: values[7] }] };
    } },
  });
  return { saved, queries, async upload(buffer, body = {}, mimetype = 'image/png') {
    let status = 200, data;
    const res = { status(value) { status = value; return this; }, json(value) { data = value; return this; } };
    await handler({ params: { propertyId: 'own-property' }, body, file: { buffer, mimetype, originalname: 'plan.png' } }, res);
    return { status, data };
  } };
}

test('plan upload saves exact original pixels and reads true dimensions instead of trusting form values or MIME', async () => {
  const original = await sharp({ create: { width: 320, height: 180, channels: 3, background: '#f9f9f9' } }).png().toBuffer();
  const target = fixture();
  const response = await target.upload(original, { width: '1', height: '1' }, 'text/html');
  assert.equal(response.status, 200, response.data?.error);
  assert.equal(response.data.width, 320); assert.equal(response.data.height, 180);
  assert.equal(target.saved[0][2], 'image/png');
  assert.deepEqual(target.saved[0][1], original, 'upload must not downsample/recompress the display original');
});

test('JPEG orientation uses browser-visible dimensions while preserving original quality and metadata', async () => {
  const original = await sharp({ create: { width: 40, height: 20, channels: 3, background: '#78bfb8' } }).jpeg({ quality: 97 }).withMetadata({ orientation: 6 }).toBuffer();
  const target = fixture(), response = await target.upload(original);
  assert.equal(response.status, 200, response.data?.error);
  assert.equal(response.data.width, 20); assert.equal(response.data.height, 40);
  assert.deepEqual(target.saved[0][1], original);
  assert.equal(target.saved[0][2], 'image/jpeg');
});

test('invalid, unsafe or truncated images cannot become saved plan records', async () => {
  const png = await sharp({ create: { width: 80, height: 60, channels: 3, background: '#ffffff' } }).png().toBuffer();
  for (const buffer of [Buffer.from('<html>not an image</html>'), Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="60"><rect width="80" height="60" fill="red"/></svg>'), png.subarray(0, 50)]) {
    const target = fixture(), response = await target.upload(buffer);
    assert.equal(response.status, 400);
    assert.equal(target.saved.length, 0);
    assert.equal(target.queries.filter(query => query.sql.startsWith('INSERT')).length, 0);
  }
});

test('out-of-scope and missing properties reject uploads before image storage', async () => {
  const blocked = fixture({ blocked: true });
  assert.equal((await blocked.upload(Buffer.from('unused'))).status, 403);
  assert.equal(blocked.queries.length, 0); assert.equal(blocked.saved.length, 0);
  const missing = fixture({ missing: true });
  assert.equal((await missing.upload(Buffer.from('unused'))).status, 404);
  assert.equal(missing.saved.length, 0);
});
