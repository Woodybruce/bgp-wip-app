import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import sharp from 'sharp';
import { detectPlanLevelName, originalPlanPdfKey, renderEvidencePlanPdf } from '../../server/plan-image-render.ts';

const require = createRequire(import.meta.url);
const { find, evaluate, ts } = require('./source-harness.cjs');

test('site-plan title overrides incidental basement and car-park labels', () => {
  assert.equal(detectPlanLevelName('BASEMENT LEVEL\nCar Parking Level 3\nDrawing Title\nBRIXTON MARKET -\nSITE PLAN'), 'SITE PLAN');
  assert.equal(detectPlanLevelName('Drawing Title: Proposed Site Location Plan\nAccess to Basement Level'), 'Proposed Site Location Plan');
});

test('level naming recognises titles while avoiding sentences and ambiguous floors', () => {
  assert.equal(detectPlanLevelName('Car Parking Level 3\nLOWER LEVEL\nRestaurant Level accessible via lift'), 'LOWER LEVEL');
  assert.equal(detectPlanLevelName('Drawing title: First Floor Plan'), 'First Floor');
  assert.equal(detectPlanLevelName('Level 4'), 'Level 4');
  assert.equal(detectPlanLevelName('Store access is via the Basement Level\nCar Parking Level 3'), null);
  assert.equal(detectPlanLevelName('Upper Level\nLower Level'), null);
});

test('only retained PDF upload keys expose an original, including repeated crops', () => {
  const prefix = 'evidence-plans/30964a01-2949-4b9b-aa15-fed2556117d2/pdf-c2657e4f-ae54-487d-914a-27508640c46b';
  assert.equal(originalPlanPdfKey(`${prefix}/page-2.png`), `${prefix}/original.pdf`);
  assert.equal(originalPlanPdfKey(`${prefix}/crop-c2657e4f-ae54-487d-914a-27508640c46b.png`), `${prefix}/original.pdf`);
  for (const key of [null, 'evidence-plans/30964a01/old.jpg', `${prefix}/../private.pdf`, `${prefix}/original.pdf`, `other/${prefix}/page-1.png`]) assert.equal(originalPlanPdfKey(key), null);
});

async function fixturePdf(sizes = [[300, 200]]) {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  for (const [width, height] of sizes) {
    const page = document.addPage([width, height]);
    page.drawLine({ start: { x: 30, y: 100 }, end: { x: 270, y: 100 }, thickness: 0.1, color: rgb(0, 0, 0) });
    page.drawRectangle({ x: 30, y: 30, width: 100, height: 100, borderWidth: 0.2, borderColor: rgb(1, 0, 0) });
    page.drawText('SITE PLAN', { x: 30, y: 170, size: 8, font });
  }
  return Buffer.from(await document.save());
}

test('PDF plans render as lossless opaque PNG with crisp hairlines and bounded high resolution', async () => {
  let index = 0;
  for await (const page of renderEvidencePlanPdf(await fixturePdf([[300, 200], [3000, 2000]]))) {
    const metadata = await sharp(page.buffer).metadata();
    assert.equal(metadata.format, 'png');
    assert.equal(metadata.hasAlpha, false);
    assert.ok(page.width <= 6000 && page.height <= 6000);
    assert.equal(page.name, 'SITE PLAN');
    if (index === 0) {
      assert.equal(page.width, 1250);
      assert.ok(page.height >= 833 && page.height <= 834);
      const { data, info } = await sharp(page.buffer).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      const y = Math.round(page.height / 2);
      let strong = 0;
      for (let x = 170; x < 1100; x++) {
        if ([-1, 0, 1].some(offset => data[((y + offset) * info.width + x) * info.channels] < 80)) strong++;
      }
      assert.ok(strong > 900, 'subpixel black line remains dark and continuous');
    } else {
      assert.equal(page.width, 6000, 'large architectural sheets stay within the memory limit');
    }
    index++;
  }
  assert.equal(index, 2);
});

test('oversized or unreadable PDFs fail before accepting any pages', async () => {
  for (const buffer of [Buffer.from('not a PDF'), await fixturePdf(Array.from({ length: 11 }, () => [300, 200]))]) {
    let accepted = 0;
    await assert.rejects(async () => { for await (const _page of renderEvidencePlanPdf(buffer)) accepted++; });
    assert.equal(accepted, 0);
  }
});

function originalRoute(bindings) {
  const route = find('server/evidence-plan.ts', node => ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
    && node.expression.expression.getText() === 'router' && node.expression.name.text === 'get'
    && ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === '/api/evidence-plans/levels/:levelId/original');
  let handler;
  evaluate(route + ';', { router: { get: (_path, _auth, fn) => { handler = fn; } }, requireAuth: () => {}, originalPlanPdfKey, encodeURIComponent, ...bindings });
  return handler;
}

test('original download returns identical uploaded PDF bytes and a safely encoded filename', async () => {
  const data = await fixturePdf();
  const backgroundKey = 'evidence-plans/30964a01/pdf-c2657e4f/page-1.png';
  const headers = {};
  let received;
  const handler = originalRoute({ pool: { query: async () => ({ rows: [{ background_key: backgroundKey }] }) },
    getFile: async key => { assert.equal(key, originalPlanPdfKey(backgroundKey)); return { data, originalName: 'Plan "A".pdf' }; } });
  await handler({ params: { levelId: 'level' } }, { setHeader: (key, value) => { headers[key] = value; }, send: value => { received = value; } });
  assert.equal(received, data);
  assert.equal(headers['Content-Type'], 'application/pdf');
  assert.match(headers['Content-Disposition'], /Plan%20%22A%22\.pdf/);
});

test('legacy backgrounds explain that their discarded PDF must be uploaded again', async () => {
  let status, response;
  const handler = originalRoute({ pool: { query: async () => ({ rows: [{ background_key: 'evidence-plans/old.jpg' }] }) },
    getFile: () => { throw new Error('No retained source can be inferred from an old JPEG'); } });
  const res = { status: value => { status = value; return res; }, json: value => { response = value; } };
  await handler({ params: { levelId: 'level' } }, res);
  assert.equal(status, 404);
  assert.match(response.error, /wasn't retained/);
});

test('upload stores the untouched PDF once beside lossless page images', async () => {
  const source = Buffer.from('original PDF bytes');
  const image = await sharp({ create: { width: 20, height: 10, channels: 3, background: '#fff' } }).png().toBuffer();
  const code = find('server/evidence-plan.ts', node => ts.isFunctionDeclaration(node) && node.name?.text === 'renderPlanPages');
  const files = new Map();
  const { render } = evaluate(code + '\nexports.render = renderPlanPages;', {
    require: name => name === 'sharp' ? { default: sharp } : require(name), crypto,
    renderEvidencePlanPdf: async function* (buffer) { assert.equal(buffer, source); yield { page: 1, buffer: image, width: 20, height: 10, name: 'SITE PLAN' }; },
    saveFile: async (key, data, type, name) => { files.set(key, { data, type, name }); },
  });
  const pages = await render('30964a01', { mimetype: 'application/pdf', originalname: 'Brixton.pdf', buffer: source });
  assert.equal(pages.length, 1);
  assert.equal(files.size, 2);
  assert.equal(files.get(pages[0].key).type, 'image/png');
  assert.equal(files.get(originalPlanPdfKey(pages[0].key)).data, source);
  assert.equal(files.get(originalPlanPdfKey(pages[0].key)).name, 'Brixton.pdf');
});

test('cropping preserves exact image pixels and retains the original PDF association', async () => {
  const sourcePixels = Buffer.from(Array.from({ length: 80 * 60 * 3 }, (_, i) => (i * 37) % 256));
  const source = await sharp(sourcePixels, { raw: { width: 80, height: 60, channels: 3 } }).png().toBuffer();
  const backgroundKey = 'evidence-plans/30964a01/pdf-c2657e4f/page-1.png';
  const level = { id: 'level', plan_id: '30964a01', background_key: backgroundKey };
  const code = find('server/evidence-plan.ts', node => ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
    && node.expression.expression.getText() === 'router' && node.expression.name.text === 'post'
    && ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === '/api/evidence-plans/levels/:levelId/crop');
  let handler, saved, response;
  const connection = { release: () => {}, query: async sql => {
    if (sql.includes('SELECT background_key')) return { rows: [{ background_key: backgroundKey }] };
    if (sql.includes('SELECT id FROM evidence_plan_levels')) return { rows: [level] };
    return { rows: [] };
  } };
  evaluate(code + ';', {
    router: { post: (_path, _auth, fn) => { handler = fn; } }, requireAuth: () => {}, originalPlanPdfKey, crypto,
    require: name => name === 'sharp' ? { default: sharp } : require(name),
    pool: { query: async () => ({ rows: [level] }), connect: async () => connection },
    getFile: async () => ({ data: source }), saveFile: async (key, data, type) => { saved = { key, data, type }; },
    EvidencePlanError: class extends Error {},
  });
  await handler({ params: { levelId: 'level' }, body: { x0: .1, y0: .2, x1: .8, y1: .9 } }, { json: value => { response = value; } });
  assert.equal(response.ok, true);
  assert.equal(saved.type, 'image/png');
  assert.equal(originalPlanPdfKey(saved.key), originalPlanPdfKey(backgroundKey));
  const pixels = await sharp(saved.data).raw().toBuffer();
  const expected = await sharp(source).extract({ left: 8, top: 12, width: 56, height: 42 }).raw().toBuffer();
  assert.deepEqual(pixels, expected);
});
