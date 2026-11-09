// Isolated browser regression: real component/styles, synthetic workbooks, mocked local API.
// No app server, database, production requests, or AI provider is used.
// node qa/evidence-unit-upload-smoke.mjs
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import loadConfig from 'tailwindcss/loadConfig.js';
import XLSX from 'xlsx';
import { chromium, devices, expect } from '@playwright/test';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT = resolve(process.env.UNIT_UPLOAD_SMOKE_OUTPUT || join(ROOT, '../audit-evidence/evidence-unit-upload-20260923'));
const PLAN = 'qa-plan', UNIT = 'qa-unit-d3', OTHER_UNIT = 'qa-unit-d4';
const pathFor = unit => `/api/evidence-plans/${PLAN}/units/${unit}/import-evidence`;
const results = { checks: [], screenshots: [], pageErrors: [], requests: [] };
const check = (label, condition = true) => { assert.ok(condition, label); results.checks.push(label); console.log(`PASS ${label}`); };
await mkdir(OUTPUT, { recursive: true });

const pageSource = await readFile(join(ROOT, 'client/src/pages/evidence-plans.tsx'), 'utf8');
assert.match(pageSource, /<EvidenceUnitUpload\s+key=\{unit\.id\}/, 'Unit upload must remount when its selected unit changes');
const bundle = await build({
  absWorkingDir: ROOT, bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
  alias: { '@': join(ROOT, 'client/src') }, define: { 'process.env.NODE_ENV': '"development"' },
  stdin: { resolveDir: ROOT, sourcefile: 'unit-upload-qa.tsx', loader: 'tsx', contents: `
    import React, { useState } from 'react';
    import { createRoot } from 'react-dom/client';
    import { EvidenceUnitUpload } from './client/src/components/evidence-unit-upload';
    import { Toaster } from './client/src/components/ui/toaster';
    import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from './client/src/components/ui/sheet';
    function App() {
      const [unit, setUnit] = useState({ id: '${UNIT}', ref: 'D3' });
      const [saved, setSaved] = useState(0);
      window.qaSelectUnit = setUnit;
      const upload = <EvidenceUnitUpload key={unit.id} planId="${PLAN}" unitId={unit.id} unitRef={unit.ref} onSaved={() => setSaved(n => n + 1)} />;
      return <main style={{maxWidth: 700, margin: '24px auto', padding: 16}}>
        <h1 className="text-xl font-semibold mb-4">Unit evidence · local QA</h1>
        {matchMedia('(max-width: 767px)').matches ? <Sheet open><SheetContent side="bottom" hideClose className="max-h-[80dvh] overflow-y-auto p-0 rounded-t-2xl pb-[env(safe-area-inset-bottom)]">
          <SheetHeader className="sr-only"><SheetTitle>Unit {unit.ref}</SheetTitle><SheetDescription>Selected unit details</SheetDescription></SheetHeader>
          <div className="p-4">{upload}</div>
        </SheetContent></Sheet> : upload}
        <output data-testid="saved-count">{saved}</output><Toaster />
      </main>;
    }
    createRoot(document.getElementById('root')).render(<App />);
  ` },
});
const config = loadConfig(join(ROOT, 'tailwind.config.ts'));
config.content = [join(ROOT, 'client/src/components/evidence-unit-upload.tsx'), join(ROOT, 'client/src/components/ui/*.{tsx,ts}')];
const css = (await postcss([tailwindcss(config)]).process(await readFile(join(ROOT, 'client/src/index.css'), 'utf8'), { from: join(ROOT, 'client/src/index.css') })).css;
const candidate = (unitRef = 'D3', unitMismatch = false) => ({
  sheetName: 'Agreed terms', unitRef, unitMismatch, tenant: 'QA Card Retail', transactionType: 'Rent review',
  transactionDate: '2026-09-22', sizeSqft: 1800, zoneA: 0, itza: 642.5, headlineRent: 50000,
  netEffective: null, term: '5 years', concession: null, notes: 'Synthetic fixture: original note',
});
let mismatch = false, failSave = false, duplicate = false, holdPreview = false, releasePreview;
function workbook(extension) {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['Unit', 'D3'], ['Tenant', 'QA Card Retail'], ['Headline Rent', 50000]]), 'Agreed terms');
  return { name: `QA TAS D3.${extension}`, mimeType: extension === 'xls' ? 'application/vnd.ms-excel' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: XLSX.write(book, { type: 'buffer', bookType: extension }) };
}
const xls = workbook('xls'), xlsx = workbook('xlsx');
const server = createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
    if (req.method === 'POST') {
      assert.ok([pathFor(UNIT), pathFor(OTHER_UNIT)].includes(pathname), `Unexpected mutation path: ${pathname}`);
      assert.match(req.headers['content-type'], /^multipart\/form-data; boundary=/);
      assert.equal(req.headers.authorization, 'Bearer qa-upload-only');
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const form = await new Request(`http://127.0.0.1${pathname}`, { method: 'POST', headers: { 'content-type': req.headers['content-type'] }, body: Buffer.concat(chunks) }).formData();
      const file = form.get('file');
      const received = { path: pathname, action: form.get('action'), fileName: file.name,
        fileSize: file.size, candidateIndex: form.get('candidateIndex'), confirmUnitMismatch: form.get('confirmUnitMismatch'),
        fields: form.has('fields') ? JSON.parse(form.get('fields')) : null };
      results.requests.push(received);
      res.setHeader('Content-Type', 'application/json');
      if (received.action === 'preview') {
        const data = { fileName: file.name, candidates: mismatch
          ? [candidate('D9', true), { ...candidate('D8', true), sheetName: 'Alternative terms', headlineRent: 55000 }]
          : [candidate(pathname === pathFor(OTHER_UNIT) ? 'D4' : 'D3')], warnings: ['Check the workbook figures before saving.'] };
        if (holdPreview) await new Promise(resolve => { releasePreview = resolve; });
        res.end(JSON.stringify(data));
      } else {
        assert.equal(received.action, 'save');
        if (failSave) { res.statusCode = 503; res.end(JSON.stringify({ error: 'The file store is unavailable. Please retry.' })); }
        else res.end(JSON.stringify({ entry: { id: 'qa-entry', unitId: pathname === pathFor(UNIT) ? UNIT : OTHER_UNIT }, duplicate }));
      }
      return;
    }
    if (pathname === '/bundle.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle.outputFiles[0].contents); return; }
    if (pathname === '/style.css') { res.setHeader('Content-Type', 'text/css'); res.end(css); return; }
    if (/^\/fonts\/[a-z0-9-]+\.woff2$/.test(pathname)) {
      res.setHeader('Content-Type', 'font/woff2'); res.end(await readFile(join(ROOT, 'client/public', pathname))); return;
    }
    if (pathname !== '/') { res.statusCode = 404; res.end(); return; }
    res.setHeader('Content-Type', 'text/html');
    res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>');
  } catch (error) { results.pageErrors.push(error.message); res.statusCode = 500; res.end(JSON.stringify({ error: error.message })); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const chrome = process.env.SMOKE_CHROMIUM || (existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome') ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined);
let browser;
async function open(phone = false) {
  const context = await browser.newContext({ ...(phone ? devices['iPhone 13'] : { viewport: { width: 1280, height: 1000 } }), serviceWorkers: 'block' });
  await context.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  await context.addInitScript(() => localStorage.setItem('bgp_auth_token', 'qa-upload-only'));
  const page = await context.newPage();
  page.on('pageerror', error => results.pageErrors.push(error.message));
  await page.goto(base);
  await page.getByTestId('button-upload-unit-evidence').waitFor();
  return { context, page };
}
async function choose(page, file) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('button-upload-unit-evidence').click();
  await (await chooser).setFiles(file);
  await page.getByTestId('unit-evidence-preview').waitFor();
}
async function drop(page, file) {
  const data = await page.evaluateHandle(({ name, type, bytes }) => {
    const transfer = new DataTransfer(); transfer.items.add(new File([new Uint8Array(bytes)], name, { type })); return transfer;
  }, { name: file.name, type: file.mimeType, bytes: [...file.buffer] });
  await page.getByTestId('unit-evidence-dropzone').dispatchEvent('dragover', { dataTransfer: data });
  await page.getByTestId('unit-evidence-dropzone').dispatchEvent('drop', { dataTransfer: data });
  await data.dispose();
}
async function shot(page, name) {
  await page.screenshot({ path: join(OUTPUT, name), fullPage: false, animations: 'disabled' });
  results.screenshots.push(name);
}

try {
  browser = await chromium.launch({ headless: true, executablePath: chrome });
  const desktop = await open(), page = desktop.page;
  await choose(page, xls);
  await expect(page.getByTestId('upload-evidence-zoneA')).toHaveValue('0');
  await expect(page.getByTestId('upload-evidence-netEffective')).toHaveValue('');
  await expect(page.getByTestId('upload-evidence-headlineRent')).toHaveValue('50000');
  await expect(page.getByTestId('upload-evidence-transactionDate')).toHaveValue('2026-09-22');
  await expect(page.getByTestId('upload-evidence-concession')).toHaveValue('');
  await expect(page.getByTestId('button-save-unit-evidence')).toBeEnabled();
  check('Click Upload Excel accepts legacy XLS and previews saved zero, date, numeric, and missing values');
  check('Opening preview does not force the phone keyboard', await page.evaluate(() => !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)));
  assert.equal(results.requests[0].path, pathFor(UNIT));
  assert.equal(results.requests[0].action, 'preview');
  assert.equal(results.requests[0].fileSize, xls.buffer.length);
  await shot(page, 'desktop-preview.png');

  await page.getByTestId('upload-evidence-headlineRent').fill('51000');
  await page.getByTestId('upload-evidence-notes').fill('Reviewed by QA, keep this draft');
  failSave = true;
  await page.getByTestId('button-save-unit-evidence').click();
  await expect(page.getByRole('alert')).toContainText('file store is unavailable');
  await expect(page.getByTestId('upload-evidence-headlineRent')).toHaveValue('51000');
  await expect(page.getByTestId('upload-evidence-notes')).toHaveValue('Reviewed by QA, keep this draft');
  await expect(page.getByTestId('saved-count')).toHaveText('0');
  check('Failed saves keep the workbook preview and reviewed draft without calling success');
  failSave = false;
  await page.getByTestId('button-save-unit-evidence').click();
  await expect(page.getByTestId('unit-evidence-preview')).toBeHidden();
  await expect(page.getByTestId('saved-count')).toHaveText('1');
  await expect(page.getByText('Evidence added to unit D3', { exact: true })).toBeVisible();
  const saved = results.requests.at(-1);
  assert.equal(saved.path, pathFor(UNIT)); assert.equal(saved.action, 'save'); assert.equal(saved.candidateIndex, '0');
  assert.equal(saved.fileSize, xls.buffer.length); assert.equal(saved.fields.headlineRent, '51000');
  assert.equal(saved.fields.zoneA, 0); assert.equal(saved.fields.netEffective, null);
  assert.equal(saved.fields.notes, 'Reviewed by QA, keep this draft');
  assert.equal(saved.confirmUnitMismatch, 'false');
  check('Retry saves multipart workbook and reviewed fields to the exact selected unit');

  mismatch = true;
  await drop(page, xlsx);
  await expect(page.getByTestId('unit-evidence-preview')).toBeVisible();
  await expect(page.getByTestId('unit-evidence-mismatch')).toContainText('D9');
  await expect(page.getByTestId('button-save-unit-evidence')).toBeDisabled();
  await page.getByTestId('confirm-unit-evidence-mismatch').check();
  await expect(page.getByTestId('button-save-unit-evidence')).toBeEnabled();
  await page.locator('#upload-evidence-sheet').selectOption('1');
  await expect(page.getByTestId('confirm-unit-evidence-mismatch')).not.toBeChecked();
  await expect(page.getByTestId('button-save-unit-evidence')).toBeDisabled();
  await expect(page.getByTestId('upload-evidence-headlineRent')).toHaveValue('55000');
  await expect(page.getByTestId('unit-evidence-mismatch')).toContainText('D8');
  check('Dropping XLSX previews sheets and switching sheets clears the mismatch acknowledgement');
  duplicate = true;
  await page.getByTestId('confirm-unit-evidence-mismatch').check();
  await page.getByTestId('button-save-unit-evidence').click();
  await expect(page.getByText('Workbook already linked', { exact: true })).toBeVisible();
  await expect(page.getByTestId('saved-count')).toHaveText('2');
  assert.equal(results.requests.at(-1).candidateIndex, '1');
  assert.equal(results.requests.at(-1).confirmUnitMismatch, 'true');
  assert.equal(results.requests.at(-1).path, pathFor(UNIT));
  check('Confirmed mismatches stay bound to the selected unit and duplicate imports have an explicit toast');

  const beforePdf = results.requests.length;
  await drop(page, { name: 'QA evidence.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF synthetic') });
  await expect(page.getByRole('alert')).toContainText('Use Add TAFs above for PDFs');
  assert.equal(results.requests.length, beforePdf);
  check('PDF drop gives a useful alternate action without sending an Excel request');
  await desktop.context.close();

  mismatch = false; duplicate = false;
  const phone = await open(true);
  await choose(phone.page, xlsx);
  await expect(phone.page.getByTestId('upload-evidence-zoneA')).toHaveValue('0');
  await phone.page.waitForFunction(() => document.getAnimations().every(animation => animation.playState !== 'running'));
  const preview = phone.page.getByTestId('unit-evidence-preview');
  await expect.poll(async () => {
    const box = await preview.boundingBox(), viewport = phone.page.viewportSize();
    return !!box && box.x >= 0 && box.x + box.width <= viewport.width + 1 && box.y >= 0 && box.y + box.height <= viewport.height + 1;
  }, { message: 'Animated preview settles within the phone viewport' }).toBe(true);
  const phoneLayout = await phone.page.evaluate(() => {
    const tenant = document.querySelector('[data-testid="upload-evidence-tenant"]');
    const transaction = document.querySelector('[data-testid="upload-evidence-transactionType"]');
    return { columns: getComputedStyle(tenant.parentElement.parentElement).gridTemplateColumns.split(' ').length,
      inputHeight: tenant.getBoundingClientRect().height,
      nextRow: transaction.getBoundingClientRect().top > tenant.getBoundingClientRect().top,
      width: document.documentElement.scrollWidth, viewport: innerWidth,
      keyboardFocus: ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName) };
  });
  assert.equal(phoneLayout.columns, 1); assert.equal(phoneLayout.nextRow, true);
  assert.ok(phoneLayout.inputHeight >= 44, `Phone input height: ${phoneLayout.inputHeight}`); assert.equal(phoneLayout.width, phoneLayout.viewport);
  assert.equal(phoneLayout.keyboardFocus, false);
  await shot(phone.page, 'phone-preview.png');
  await phone.page.getByTestId('upload-evidence-notes').fill('Reviewed on phone');
  await phone.page.getByTestId('button-save-unit-evidence').scrollIntoViewIfNeeded();
  await shot(phone.page, 'phone-save.png');
  await phone.page.getByTestId('button-save-unit-evidence').click();
  await expect(phone.page.getByTestId('saved-count')).toHaveText('1');
  assert.equal(results.requests.at(-1).fields.notes, 'Reviewed on phone');
  check('Phone preview has one-column fields, 44px inputs, no overflow or keyboard autofocus, and can save');

  holdPreview = true;
  await phone.page.getByTestId('unit-evidence-file').setInputFiles(xls);
  await expect.poll(() => Boolean(releasePreview)).toBe(true);
  await phone.page.evaluate(() => window.qaSelectUnit({ id: 'qa-unit-d4', ref: 'D4' }));
  await expect(phone.page.getByText('Excel evidence for unit D4', { exact: true })).toBeVisible();
  releasePreview(); holdPreview = false;
  await expect(phone.page.getByTestId('unit-evidence-preview')).toBeHidden();
  await choose(phone.page, xlsx);
  await expect(phone.page.getByRole('heading', { name: 'Add evidence to unit D4', exact: true })).toBeVisible();
  await phone.page.getByTestId('button-save-unit-evidence').click();
  await expect(phone.page.getByTestId('saved-count')).toHaveText('2');
  assert.equal(results.requests.at(-1).path, pathFor(OTHER_UNIT));
  check('Switching units during a delayed preview discards the old draft and subsequent saves target the new unit');
  await phone.context.close();
  assert.deepEqual(results.pageErrors, []);
  check('No browser or local fixture server errors');
} finally {
  if (releasePreview) releasePreview();
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
  await writeFile(join(OUTPUT, 'results.json'), JSON.stringify(results, null, 2));
}
console.log(`Screenshots and results: ${OUTPUT}`);
