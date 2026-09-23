import assert from 'node:assert/strict';
import test from 'node:test';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { find, evaluate, ts } = require('./source-harness.cjs');
const file = 'server/evidence-plan.ts';
const declaration = name => find(file, node =>
  ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name?.text === name)
  || ts.isVariableStatement(node) && node.declarationList.declarations.some(item => item.name.getText() === name));
const code = ['EvidencePlanError', 'normaliseUnitRef', 'ENTRY_FIELDS', 'validateEvidenceUnitPatch',
  'validateEvidenceEntryPatch', 'importUnitEvidence'].map(declaration).join('\n');
const planId = '10000000-0000-4000-8000-000000000001';
const unitId = '20000000-0000-4000-8000-000000000002';
const otherId = '30000000-0000-4000-8000-000000000003';

function harness(options = {}) {
  const unit = { id: unitId, unit_ref: 'D3', property_id: 'brent-cross' };
  const calls = [], savedFiles = [], entries = [];
  let released = 0, transaction;
  const run = async (sql, values = []) => {
    calls.push({ sql, values });
    if (sql === 'BEGIN') transaction = { entries: entries.length, files: savedFiles.length };
    if (sql === 'ROLLBACK' && transaction) { entries.splice(transaction.entries); savedFiles.splice(transaction.files); }
    if (/JOIN evidence_plans/.test(sql)) return { rows: options.missingUnit ? [] : [unit] };
    if (/FROM evidence_plan_units.*FOR UPDATE/.test(sql)) return { rows: options.deletedUnit ? [] : [{ ...unit, ...(options.renamed ? { unit_ref: 'D4' } : {}) }] };
    if (/FROM evidence_plans.*FOR SHARE/.test(sql)) return { rows: [{ id: planId, property_id: options.relinked ? 'other-property' : unit.property_id }] };
    if (/SELECT \* FROM evidence_plan_entries/.test(sql)) return { rows: entries.filter(entry => entry.plan_id === values[0] && entry.unit_id === values[1] && entry.source_key === values[2]) };
    if (/INSERT INTO file_storage/.test(sql)) {
      if (options.storageError) throw new Error('Storage unavailable');
      savedFiles.push(values); return { rows: [] };
    }
    if (/INSERT INTO evidence_plan_entries/.test(sql)) {
      if (options.insertError) throw new Error('Database unavailable');
      const columns = sql.match(/INSERT INTO evidence_plan_entries \(([^)]+)\)/)[1].split(',').map(value => value.trim());
      const entry = { id: `entry-${entries.length + 1}`, ...Object.fromEntries(columns.map((column, index) => [column, values[index]])) };
      entries.push(entry); return { rows: [entry] };
    }
    if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql) || /^UPDATE evidence_plans SET updated_at/.test(sql)) return { rows: [] };
    throw new Error(`Unexpected query: ${sql}`);
  };
  const bindings = {
    crypto, pool: { query: run, connect: async () => ({ query: run, release: () => { released++; } }) },
    parseEvidenceWorkbook: () => {
      if (options.parseError) throw new Error('Workbook is corrupt');
      return { candidates: [{ sheetName: 'Sheet 1', unitRef: options.match ? 'Unit D03' : 'B6', tenant: 'Card Factory',
        headlineRent: 172000, zoneA: 171.697, transactionDate: null }], warnings: ['Check the selected unit'] };
    },
    require: name => {
      assert.equal(name, './company-scope');
      return { resolveCompanyScope: async () => options.client ? 'client-scope' : null,
        isPropertyInScope: async (_scope, propertyId) => { assert.equal(propertyId, 'brent-cross'); return !options.denied; } };
    },
  };
  const { importUnitEvidence } = evaluate(code, bindings);
  const request = (body = {}, overrides = {}) => ({ params: { id: planId, unitId }, session: { userId: 'pete' }, body,
    file: { originalname: 'Brent Cross - TAS - Card Factory, Unit D3.xls', buffer: Buffer.from('workbook-content') }, ...overrides });
  const reviewed = { tenant: 'Card Factory', zoneA: 0, headlineRent: '172000', netEffective: '', transactionDate: '', term: '5 years', concession: '9 months rent free', notes: 'Reviewed' };
  const saveRequest = (fields = reviewed, body = {}, overrides = {}) => request({ action: 'save', candidateIndex: '0', fields: JSON.stringify(fields), confirmUnitMismatch: 'true', ...body }, overrides);
  return { importUnitEvidence, request, saveRequest, calls, savedFiles, entries, released: () => released };
}

test('preview keeps the internal workbook reference and chosen unit visible without writing', async () => {
  const h = harness(); const result = await h.importUnitEvidence(h.request());
  assert.equal(result.unit.id, unitId); assert.equal(result.unit.unit_ref, 'D3');
  assert.equal(result.candidates[0].unitRef, 'B6'); assert.equal(result.candidates[0].unitMismatch, true);
  assert.equal(result.fileName, 'Brent Cross - TAS - Card Factory, Unit D3.xls');
  assert.equal(h.savedFiles.length, 0); assert.equal(h.calls.length, 1);
});

test('normalised reference equivalents do not ask for a false mismatch confirmation', async () => {
  const h = harness({ match: true });
  assert.equal((await h.importUnitEvidence(h.request())).candidates[0].unitMismatch, false);
  const result = await h.importUnitEvidence(h.saveRequest({}, { confirmUnitMismatch: '' }));
  assert.equal(result.entry.unit_ref, 'D3');
});

test('an explicit confirmation is required for the original sheet reference even if reviewed fields claim a match', async () => {
  const h = harness();
  await assert.rejects(h.importUnitEvidence(h.saveRequest({ unitRef: 'D3' }, { confirmUnitMismatch: '' })), error => error.status === 409);
  assert.equal(h.savedFiles.length, 0); assert.equal(h.entries.length, 0);
});

test('saving uses the selected UUID and canonical reference, preserves reviewed values and attaches the original Excel', async () => {
  const h = harness();
  const req = h.saveRequest();
  req.body.fields = JSON.stringify({ ...JSON.parse(req.body.fields), unitId: otherId, unitRef: 'B6', sourceKey: 'unrelated-file', planId: otherId });
  const { entry, duplicate } = await h.importUnitEvidence(req);
  assert.equal(duplicate, false); assert.equal(entry.plan_id, planId); assert.equal(entry.unit_id, unitId); assert.equal(entry.unit_ref, 'D3');
  assert.equal(entry.zone_a, 0); assert.equal(entry.net_effective, null); assert.equal(entry.transaction_date, null);
  assert.equal(entry.headline_rent, 172000); assert.equal(entry.term, '5 years'); assert.equal(entry.concession, '9 months rent free');
  assert.equal(entry.created_by, 'pete'); assert.ok(entry.source_key.startsWith(`evidence-plans/${planId}/unit-evidence/${unitId}/`));
  assert.equal(h.savedFiles.length, 1); assert.deepEqual(h.savedFiles[0][1], req.file.buffer);
  assert.equal(h.savedFiles[0][2], 'application/vnd.ms-excel'); assert.equal(h.savedFiles[0][3], req.file.originalname);
  assert.equal(h.released(), 1); assert.equal(h.calls.at(-1).sql, 'COMMIT');
  assert.ok(h.calls.some(call => /evidence_plan_units.*FOR UPDATE/.test(call.sql)));
  assert.ok(!h.calls.some(call => /UPDATE evidence_plan_units|tenancy_schedule|polygon/.test(call.sql)));
});

test('repeat upload returns the existing evidence without rewriting edits or duplicating the source', async () => {
  const h = harness(); const first = await h.importUnitEvidence(h.saveRequest());
  first.entry.notes = 'Subsequent manual correction';
  const second = await h.importUnitEvidence(h.saveRequest({ notes: 'Uploaded again' }));
  assert.equal(second.duplicate, true); assert.equal(second.entry.id, first.entry.id);
  assert.equal(second.entry.notes, 'Subsequent manual correction'); assert.equal(h.entries.length, 1); assert.equal(h.savedFiles.length, 1);
  assert.equal(h.released(), 2);
});

test('a revised workbook is separate evidence and a renamed identical file is still deduplicated', async () => {
  const h = harness(); await h.importUnitEvidence(h.saveRequest());
  const renamed = h.saveRequest(); renamed.file.originalname = 'renamed.xlsx';
  assert.equal((await h.importUnitEvidence(renamed)).duplicate, true);
  const revised = h.saveRequest(); revised.file.buffer = Buffer.from('revised-workbook');
  assert.equal((await h.importUnitEvidence(revised)).duplicate, false);
  assert.equal(h.entries.length, 2);
});

test('cross-plan units and denied clients cannot parse or save evidence', async () => {
  for (const options of [{ missingUnit: true }, { client: true, denied: true }]) {
    const h = harness(options);
    await assert.rejects(h.importUnitEvidence(h.saveRequest()), error => error.status === (options.missingUnit ? 404 : 403));
    assert.equal(h.savedFiles.length, 0); assert.equal(h.entries.length, 0);
  }
  const h = harness({ client: true }); assert.equal((await h.importUnitEvidence(h.saveRequest())).entry.unit_id, unitId);
});

test('invalid files, workbook errors, indices and reviewed data are actionable without side effects', async () => {
  const h = harness();
  const cases = [h.request({}, { file: null }), h.request({}, { params: { id: 'invalid', unitId } }),
    h.request({}, { file: { originalname: 'analysis.pdf', buffer: Buffer.from('pdf') } }),
    h.request({}, { file: { originalname: 'large.xls', buffer: Buffer.alloc(20 * 1024 * 1024 + 1) } }),
    h.request({ action: 'overwrite' }), h.saveRequest({}, { candidateIndex: '100' }),
    h.saveRequest({}, { fields: 'invalid json' }), h.saveRequest({}, { fields: '[]' }), h.saveRequest({ zoneA: -1 })];
  for (const req of cases) await assert.rejects(h.importUnitEvidence(req), error => [400, 413].includes(error.status));
  assert.equal(h.savedFiles.length, 0);
  const corrupt = harness({ parseError: true });
  await assert.rejects(corrupt.importUnitEvidence(corrupt.request()), error => error.status === 400 && /corrupt/.test(error.message));
});

test('unit deletion, renaming or changed property links abort the save under its transaction', async () => {
  for (const option of ['deletedUnit', 'renamed', 'relinked']) {
    const h = harness({ [option]: true });
    await assert.rejects(h.importUnitEvidence(h.saveRequest()), error => [404, 409].includes(error.status));
    assert.equal(h.savedFiles.length, 0); assert.equal(h.entries.length, 0);
    assert.equal(h.calls.at(-1).sql, 'ROLLBACK'); assert.equal(h.released(), 1);
  }
});

test('storage failures roll back before an evidence entry is created', async () => {
  const h = harness({ storageError: true });
  await assert.rejects(h.importUnitEvidence(h.saveRequest()), /Storage unavailable/);
  assert.equal(h.entries.length, 0); assert.equal(h.calls.at(-1).sql, 'ROLLBACK'); assert.equal(h.released(), 1);
});

test('an evidence INSERT failure rolls back the source attachment in the same transaction', async () => {
  const h = harness({ insertError: true });
  await assert.rejects(h.importUnitEvidence(h.saveRequest()), /Database unavailable/);
  assert.ok(h.calls.some(call => /INSERT INTO file_storage/.test(call.sql)));
  assert.equal(h.savedFiles.length, 0); assert.equal(h.entries.length, 0);
  assert.equal(h.calls.at(-1).sql, 'ROLLBACK'); assert.equal(h.released(), 1);
});

test('upload endpoint remains authenticated and returns parser errors with their status', async () => {
  const route = find(file, node => ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
    && node.expression.expression.getText() === 'router' && node.expression.name.text === 'post'
    && ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === '/api/evidence-plans/:id/units/:unitId/import-evidence');
  const auth = () => {}; let handlers;
  const errors = evaluate(declaration('EvidencePlanError'));
  evaluate(route + ';', { router: { post: (_url, ...args) => { handlers = args; } }, requireAuth: auth,
    unitEvidenceUpload: (_req, _res, next) => next({ code: 'LIMIT_FILE_SIZE' }),
    EvidencePlanError: errors.EvidencePlanError,
    importUnitEvidence: async () => { throw new errors.EvidencePlanError(409, 'Confirm unit'); } });
  assert.equal(handlers[0], auth);
  const res = { status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; } };
  handlers[1]({}, res, () => assert.fail('oversized file must stop'));
  assert.equal(res.statusCode, 413);
  await handlers[2]({}, res);
  assert.equal(res.statusCode, 409); assert.equal(res.body.error, 'Confirm unit');
});

test('Excel download follows its retained evidence link and property scope, including after outline removal', async () => {
  const route = find(file, node => ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
    && node.expression.expression.getText() === 'router' && node.expression.name.text === 'get'
    && ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === '/api/evidence-plans/source');
  const key = `evidence-plans/${planId}/unit-evidence/${unitId}/${'a'.repeat(64)}-0`;
  for (const scenario of ['allowed', 'denied', 'unlinked-source', 'invalid-key']) {
    let handler, reads = 0;
    evaluate(route + ';', { router: { get: (_url, _auth, callback) => { handler = callback; } }, requireAuth() {},
      pool: { query: async sql => { assert.ok(/FROM evidence_plan_entries/.test(sql)); assert.ok(!/evidence_plan_units/.test(sql));
        return { rows: scenario === 'unlinked-source' ? [] : [{ property_id: 'brent-cross' }] }; } },
      require: () => ({ resolveCompanyScope: async () => 'client', isPropertyInScope: async () => scenario !== 'denied' }),
      getFile: async () => { reads++; return { data: Buffer.from('original'), contentType: 'application/vnd.ms-excel', originalName: 'TAS\r\n.xls' }; } });
    const res = { headers: {}, status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; },
      setHeader(name, value) { this.headers[name] = value; }, send(value) { this.data = value; } };
    await handler({ query: { key: scenario === 'invalid-key' ? key + '/../other' : key } }, res);
    if (scenario === 'allowed') {
      assert.equal(reads, 1); assert.equal(res.headers['Content-Disposition'], 'attachment; filename="TAS.xls"'); assert.equal(res.data.toString(), 'original');
    } else {
      assert.equal(reads, 0); assert.equal(res.statusCode, { denied: 403, 'unlinked-source': 404, 'invalid-key': 400 }[scenario]);
    }
  }
});
