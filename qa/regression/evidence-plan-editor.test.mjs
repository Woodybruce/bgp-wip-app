// Actual capability routing and SQL grants, with a synthetic downstream editor.
// No application database, environment files, AI service or live storage is used.
import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import express from 'express';
import multer from 'multer';
import { createRequire } from 'node:module';
import { createEvidencePlanSharingRouters, ensureEvidencePlanShareSchema } from '../../server/evidence-plan-sharing.ts';
import { createSharingFixture, ids, id, fileKeys } from './evidence-plan-sharing-fixture.mjs';
const require = createRequire(import.meta.url);
const { find, evaluate, ts } = require('./source-harness.cjs');

let fixture;
let adapter;
let access;
const dispatches = [];
const imports = [];
let downstreamReply = (_req, res) => res.json({ ok: true });
const management = `/api/evidence-plans/${ids.plan}/share`;
const expected = share => share && !share.revokedAt ? { id: share.id, updatedAt: share.updatedAt } : null;
const currentShare = async () => (await fixture.request(management, { user: 'staff' })).json.share;
const share = async (accessMode = 'edit') => {
  const response = await fixture.request(management, { method: 'PUT', user: 'staff', body: {
    accessMode, label: 'Synthetic editing invitation', entryIds: [], documentEntryIds: [],
    includeUnitFacts: false, expectedShare: expected(await currentShare()),
  } });
  assert.equal(response.status, 200, response.text);
  return response.json.share;
};
const endpoint = (token, suffix = '') => `/api/public/evidence-plans/${token}/editor${suffix}`;
const request = (token, suffix, method = 'GET', body) =>
  fixture.request(endpoint(token, suffix), { method, ...(!['GET', 'HEAD'].includes(method) ? { body: body ?? {} } : {}) });
const safeHeaders = response => {
  assert.match(response.headers.get('cache-control') || '', /no-store/);
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  assert.match(response.headers.get('x-robots-tag') || '', /noindex/);
};

before(async () => {
  adapter = await import('../../server/evidence-plan-editor.ts');
  access = await import('../../server/evidence-plan-editor-access.ts');
  fixture = await createSharingFixture(deps => {
    const sharing = createEvidencePlanSharingRouters(deps);
    const editor = adapter.createScopedEditorRouter({
      db: deps.db, ensureSchema: deps.ensureSchema, getFile: deps.getFile,
      downstream: (req, res, next) => {
        dispatches.push({ method: req.method, url: req.url, body: req.body,
          session: req.session, tokenUserId: req.tokenUserId,
          grant: access.currentEvidencePlanEditorAccess(),
          trusted: access.isEvidencePlanEditorRequest(req) });
        return downstreamReply(req, res, next);
      },
      importTenancyWorkbook: async (...args) => { imports.push(args); return { imported: 0, reviewRows: [] }; },
    });
    const publicRouter = express.Router();
    publicRouter.use(editor);
    publicRouter.use(sharing.publicRouter);
    return { publicRouter, staffRouter: sharing.staffRouter };
  }, ensureEvidencePlanShareSchema);
  await fixture.db.query(`CREATE TABLE evidence_plan_jobs (
    id uuid PRIMARY KEY, plan_id uuid, level_id uuid, kind text DEFAULT 'detect',
    status text DEFAULT 'done', error text, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now())`);
});
beforeEach(async () => {
  await fixture.reset();
  await fixture.db.query('TRUNCATE evidence_plan_jobs');
  await fixture.db.query(`INSERT INTO evidence_plan_jobs (id,plan_id,level_id)
    VALUES ($1,$2,$3),($4,$5,$6)`, [id(40), ids.plan, ids.level, id(41), ids.otherPlan, ids.otherLevel]);
  dispatches.length = 0;
  imports.length = 0;
  downstreamReply = (_req, res) => res.json({ ok: true });
});
after(async () => { await fixture?.cleanup(); });

test('view, invalid and revoked capabilities cannot enter the editing adapter', async () => {
  const view = await share('view');
  const edit = await share('edit');
  await fixture.request(`${management}/revoke`, { method: 'POST', user: 'staff', body: { expectedShare: expected(edit) } });
  for (const token of [view.token, edit.token, 'bad', 'A'.repeat(43)]) {
    for (const [suffix, method, body] of [
      [`/${ids.plan}`, 'GET'],
      [`/${ids.plan}/units`, 'POST', { unitRef: 'A3', levelId: ids.level }],
      [`/units/${ids.unit}`, 'PUT', { tenantName: 'Must not save' }],
    ]) {
      const response = await request(token, suffix, method, body);
      assert.ok([403, 404].includes(response.status), `${method} ${suffix}: ${response.status} ${response.text}`);
      safeHeaders(response);
    }
  }
  assert.deepEqual(dispatches, []);
  assert.deepEqual(fixture.fileReads, []);
  assert.deepEqual(imports, []);
});

test('capabilities cannot list/create plans, reassign property, delete the plan or manage sharing', async () => {
  const { token } = await share();
  for (const [suffix, method, body] of [
    ['', 'GET'], ['', 'POST', { name: 'Unauthorized new plan' }],
    [`/${ids.plan}`, 'DELETE'],
    [`/${ids.plan}`, 'PUT', { propertyId: 'property-b' }],
    [`/${ids.plan}`, 'PUT', { propertyId: null }],
    [`/${ids.plan}/share`, 'GET'],
    [`/${ids.plan}/share`, 'PUT', { accessMode: 'edit' }],
    [`/${ids.plan}/share/revoke`, 'POST', {}],
    ['/source?key=' + encodeURIComponent(fileKeys.otherDoc), 'GET'],
    ['/../crm/properties', 'GET'],
  ]) {
    const response = await request(token, suffix, method, body);
    assert.ok([400, 403, 404, 405].includes(response.status), `${method} ${suffix}: ${response.status} ${response.text}`);
  }
  assert.deepEqual(dispatches, []);
  assert.deepEqual(fixture.fileReads, []);
  assert.equal((await currentShare()).token, token);
});

test('foreign child IDs and foreign root plan IDs are rejected before downstream handlers', async () => {
  const { token } = await share();
  for (const [suffix, method, body] of [
    [`/${ids.otherPlan}`, 'GET'],
    [`/${ids.otherPlan}/units`, 'POST', { unitRef: 'B2', levelId: ids.otherLevel }],
    [`/${ids.otherPlan}/entries`, 'POST', { tenant: 'Forbidden' }],
    [`/units/${ids.otherUnit}`, 'PUT', { tenantName: 'Forbidden' }],
    [`/units/${ids.otherUnit}`, 'DELETE'],
    [`/entries/${ids.otherEntry}`, 'PUT', { tenant: 'Forbidden' }],
    [`/entries/${ids.otherEntry}`, 'DELETE'],
    [`/levels/${ids.otherLevel}`, 'PUT', { name: 'Forbidden' }],
    [`/levels/${ids.otherLevel}`, 'DELETE'],
    [`/levels/${ids.otherLevel}/crop`, 'POST', { x0: 0, y0: 0, x1: .5, y1: .5 }],
    [`/levels/${ids.otherLevel}/trace-unit`, 'POST', { x: .2, y: .2 }],
    [`/levels/${ids.otherLevel}/background`, 'GET'],
    [`/levels/${ids.otherLevel}/original`, 'GET'],
    [`/entries/${ids.otherEntry}/document`, 'GET'],
    [`/jobs/${id(41)}`, 'GET'],
    [`/${ids.plan}/scan-review/${id(41)}/apply`, 'POST', { assignments: [] }],
    [`/${ids.plan}/units/${ids.otherUnit}/import-evidence`, 'POST', {}],
  ]) {
    const response = await request(token, suffix, method, body);
    assert.ok([400, 403, 404].includes(response.status), `${method} ${suffix}: ${response.status} ${response.text}`);
  }
  assert.deepEqual(dispatches, []);
  assert.deepEqual(fixture.fileReads, []);
  assert.deepEqual(imports, []);
});

test('foreign body and query references cannot redirect a permitted own-plan operation', async () => {
  const { token } = await share();
  for (const [suffix, method, body] of [
    [`/${ids.plan}/units`, 'POST', { unitRef: 'A3', levelId: ids.otherLevel }],
    [`/units/${ids.unit}`, 'PUT', { levelId: ids.otherLevel }],
    [`/units/${ids.unit}`, 'PUT', { expectedPlanId: ids.otherPlan }],
    [`/${ids.plan}/entries`, 'POST', { unitId: ids.otherUnit, tenant: 'Forbidden' }],
    [`/entries/${ids.entry}`, 'PUT', { unitId: ids.otherUnit }],
    [`/${ids.plan}/detect-units`, 'POST', { levelId: ids.otherLevel }],
    [`/${ids.plan}/background`, 'POST', { levelId: ids.otherLevel }],
    [`/${ids.plan}/scan-review?levelId=${ids.otherLevel}`, 'GET'],
    [`/${ids.plan}/scan-review/${id(40)}/apply`, 'POST',
      { assignments: [{ candidateId: 'candidate-1', unitId: ids.otherUnit }] }],
    [`/${ids.plan}/scan-review/${id(40)}/apply`, 'POST',
      { assignments: [], clearOutlineUnitIds: [ids.otherUnit] }],
  ]) {
    const response = await request(token, suffix, method, body);
    assert.ok([400, 403, 404, 409].includes(response.status), `${method} ${suffix}: ${response.status} ${response.text}`);
  }
  assert.deepEqual(dispatches, []);
  assert.deepEqual(fixture.fileReads, []);
});

test('allowed own-plan editing routes dispatch without inventing a staff session or user', async () => {
  const editor = await share();
  for (const [suffix, method, body] of [
    [`/${ids.plan}`, 'GET'],
    [`/${ids.plan}`, 'PUT', { name: 'Approved new plan name' }],
    [`/${ids.plan}/units`, 'POST', { unitRef: 'A3', levelId: ids.level }],
    [`/units/${ids.unit}`, 'PUT', { tenantName: 'Approved edit', erv: 0 }],
    [`/units/${ids.unit}`, 'DELETE'],
    [`/${ids.plan}/entries`, 'POST', { unitId: ids.unit, tenant: 'Approved edit' }],
    [`/entries/${ids.entry}`, 'PUT', { unitId: ids.secondUnit, headlineRent: 0 }],
    [`/entries/${ids.entry}`, 'DELETE'],
    [`/levels/${ids.level}`, 'PUT', { name: 'Approved new level name' }],
    [`/levels/${ids.level}/crop`, 'POST', { x0: 0, y0: 0, x1: .5, y1: .5 }],
    [`/levels/${ids.level}/trace-unit`, 'POST', { x: .2, y: .2 }],
    [`/${ids.plan}/detect-units`, 'POST', { levelId: ids.level }],
    [`/${ids.plan}/scan-review?levelId=${ids.level}`, 'GET'],
    [`/${ids.plan}/scan-review/${id(40)}/apply`, 'POST',
      { assignments: [{ candidateId: 'candidate-1', unitId: ids.unit }] }],
    [`/jobs/${id(40)}`, 'GET'],
  ]) {
    const previous = dispatches.length;
    const response = await request(editor.token, suffix, method, body);
    assert.equal(response.status, 200, `${method} ${suffix}: ${response.text}`);
    safeHeaders(response);
    assert.equal(dispatches.length, previous + 1);
    const dispatched = dispatches.at(-1);
    assert.equal(dispatched.url, `/api/evidence-plans${suffix}`);
    assert.equal(dispatched.session, undefined);
    assert.equal(dispatched.tokenUserId, undefined);
    assert.equal(dispatched.trusted, true);
    assert.equal(dispatched.grant.planId, ids.plan);
    assert.equal(dispatched.grant.propertyId, 'property-a');
    assert.equal(dispatched.grant.shareId, editor.id);
  }
  assert.equal(access.currentEvidencePlanEditorAccess(), undefined, 'The grant must not escape its async request');
});

test('unit revisions use opaque image versions and reject stale or raw storage keys', async () => {
  const { token } = await share();
  const body = { expectedBackgroundKey: adapter.editorBackgroundRevision(fileKeys.image), expectedPlanId: ids.plan, polygon: null };
  const saved = await request(token, `/units/${ids.unit}`, 'PUT', body);
  assert.equal(saved.status, 200, saved.text);
  assert.equal(dispatches.at(-1).body.expectedBackgroundKey, fileKeys.image, 'Only the trusted server maps a revision to storage');
  dispatches.length = 0;
  for (const key of [fileKeys.image, 'stale-revision', adapter.editorBackgroundRevision(fileKeys.otherImage)]) {
    const denied = await request(token, `/units/${ids.unit}`, 'PUT', { ...body, expectedBackgroundKey: key });
    assert.equal(denied.status, 409, denied.text);
    assert.ok(!denied.text.includes(fileKeys.image));
  }
  assert.deepEqual(dispatches, []);
});

test('linked schedule references are limited to the granted property and preserve zero edits', async () => {
  await fixture.db.query(`INSERT INTO tenancy_schedule_units (id,property_id,unit_number)
    VALUES ('schedule-a','property-a','A1'),('schedule-b','property-b','B1')`);
  const { token } = await share();
  for (const key of ['scheduleRowId', 'linkScheduleRowId', 'expectedScheduleRowId', 'expectedTenancyUnitId']) {
    const denied = await request(token, `/units/${ids.unit}`, 'PUT', { [key]: 'schedule-b', erv: 0 });
    assert.equal(denied.status, 404, denied.text);
  }
  assert.deepEqual(dispatches, []);
  const allowed = await request(token, `/units/${ids.unit}`, 'PUT', { scheduleRowId: 'schedule-a', erv: 0, passingRent: 0 });
  assert.equal(allowed.status, 200, allowed.text);
  assert.equal(dispatches.at(-1).body.erv, 0);
  assert.equal(dispatches.at(-1).body.passingRent, 0);
});

test('editing grants can download this plan’s full evidence, but never raw-key endpoints or active content', async () => {
  const { token } = await share();
  fixture.files.set(fileKeys.unselectedDoc, { data: Buffer.from('%PDF-1.4 own-plan evidence'), contentType: 'application/pdf' });
  const image = await request(token, `/levels/${ids.level}/background`);
  assert.equal(image.status, 200, image.text);
  safeHeaders(image);
  for (const entry of [ids.entry, ids.unselectedEntry]) {
    const response = await request(token, `/entries/${entry}/document`);
    assert.equal(response.status, 200, response.text);
    assert.match(response.headers.get('content-disposition'), /^attachment;/);
    safeHeaders(response);
  }
  fixture.files.set(fileKeys.doc, { data: Buffer.from('<script>active</script>'), contentType: 'application/pdf' });
  assert.equal((await request(token, `/entries/${ids.entry}/document`)).status, 404);
  assert.deepEqual(dispatches, [], 'File reads must use the dedicated scoped proxy');
});

test('browser cross-origin mutations and form-encoded requests are rejected before editor dispatch', async () => {
  const { token } = await share();
  for (const [headers, status] of [
    [{ origin: 'https://attacker.example' }, 403],
    [{ origin: 'null' }, 403],
    [{ 'sec-fetch-site': 'same-site' }, 403],
    [{ 'sec-fetch-site': 'cross-site' }, 403],
    [{ 'content-type': 'application/x-www-form-urlencoded' }, 415],
  ]) {
    const response = await fixture.request(endpoint(token, `/units/${ids.unit}`), {
      method: 'PUT', body: { notes: 'Must not save' }, headers,
    });
    assert.equal(response.status, status, response.text);
  }
  assert.deepEqual(dispatches, []);
});

test('linked workbook import derives its property and cannot clear a schedule or redirect the import', async () => {
  const { token } = await share();
  const workbook = values => {
    const body = new FormData();
    body.append('file', new Blob([Buffer.from('504b030400000000', 'hex')], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }), 'synthetic.xlsx');
    for (const [key, value] of Object.entries(values)) body.append(key, value);
    return body;
  };
  for (const values of [{ propertyId: 'property-b' }, { clearExisting: 'true' }]) {
    const response = await fixture.request(endpoint(token, `/${ids.plan}/import-tenancy`), {
      method: 'POST', body: workbook(values),
    });
    assert.ok([400, 403, 404].includes(response.status), response.text);
  }
  assert.deepEqual(imports, []);
  const ok = await fixture.request(endpoint(token, `/${ids.plan}/import-tenancy`), {
    method: 'POST', body: workbook({ propertyId: 'linked' }),
  });
  assert.equal(ok.status, 200, ok.text);
  assert.equal(imports.length, 1);
  assert.equal(imports[0][1], 'property-a');
  assert.deepEqual(imports[0][3], { clearExisting: false });
  assert.deepEqual(dispatches, []);
});

test('revoke waits for an accepted synchronous edit, then denies every later request', { timeout: 8000 }, async () => {
  const editor = await share();
  let entered, release;
  const started = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  downstreamReply = async (_req, res) => { entered(); await gate; res.json({ ok: true }); };
  const editing = request(editor.token, `/units/${ids.unit}`, 'PUT', { notes: 'Accepted before revoke' });
  try {
    await started;
    const revoking = fixture.request(`${management}/revoke`, {
      method: 'POST', user: 'staff', body: { expectedShare: expected(editor) },
    });
    let blocked = false;
    for (let retry = 0; retry < 100; retry++) {
      blocked = (await fixture.db.query("SELECT 1 FROM pg_locks WHERE locktype='advisory' AND NOT granted LIMIT 1")).rowCount > 0;
      if (blocked) break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.equal(blocked, true, 'Revoke must serialize with the active edit grant');
    release();
    assert.equal((await editing).status, 200);
    assert.equal((await revoking).status, 200);
    const count = dispatches.length;
    assert.equal((await request(editor.token, `/units/${ids.unit}`, 'PUT', { notes: 'Must not save' })).status, 404);
    assert.equal(dispatches.length, count);
  } finally { release(); await editing; }
});

test('disconnecting a request cannot release its grant while an accepted edit is still writing', { timeout: 8000 }, async () => {
  const editor = await share();
  let entered, release;
  const started = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  downstreamReply = async (_req, res) => {
    entered();
    await gate;
    await fixture.db.query('UPDATE evidence_plan_units SET notes=$1 WHERE id=$2', ['Accepted edit finished', ids.unit]);
    res.json({ ok: true });
  };
  const controller = new AbortController();
  const editing = fixture.request(endpoint(editor.token, `/units/${ids.unit}`), {
    method: 'PUT', body: { notes: 'Accepted edit finished' }, signal: controller.signal,
  }).catch(error => error);
  try {
    await started;
    controller.abort();
    assert.equal((await editing).name, 'AbortError');
    const revoking = fixture.request(`${management}/revoke`, {
      method: 'POST', user: 'staff', body: { expectedShare: expected(editor) },
    });
    let blocked = false;
    for (let retry = 0; retry < 100; retry++) {
      blocked = (await fixture.db.query("SELECT 1 FROM pg_locks WHERE locktype='advisory' AND NOT granted LIMIT 1")).rowCount > 0;
      if (blocked) break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.equal(blocked, true, 'An HTTP disconnect must not unlock a still-running mutation');
    release();
    assert.equal((await revoking).status, 200);
    assert.equal((await fixture.db.query('SELECT notes FROM evidence_plan_units WHERE id=$1', [ids.unit])).rows[0].notes,
      'Accepted edit finished');
    const count = dispatches.length;
    assert.equal((await request(editor.token, `/units/${ids.unit}`, 'PUT', { notes: 'Must not save' })).status, 404);
    assert.equal(dispatches.length, count);
  } finally { release(); await editing; }
});

test('downstream errors cannot disclose keys, provider details or the link token', async () => {
  const editor = await share();
  downstreamReply = (_req, res) => res.status(500).json({ error: `PRIVATE-PROVIDER ${fileKeys.doc} ${editor.token}` });
  const response = await request(editor.token, `/units/${ids.unit}`, 'PUT', { notes: 'Synthetic failure' });
  assert.equal(response.status, 500, response.text);
  safeHeaders(response);
  for (const secret of ['PRIVATE-PROVIDER', fileKeys.doc, editor.token]) assert.ok(!response.text.includes(secret));
  const revoked = await fixture.request(`${management}/revoke`, {
    method: 'POST', user: 'staff', body: { expectedShare: expected(editor) },
  });
  assert.equal(revoked.status, 200, revoked.text);
});

test('the plan-level background alias uses the same safe image proxy and never a legacy cached file handler', async () => {
  const { token } = await share();
  const response = await request(token, `/${ids.plan}/background`);
  assert.equal(response.status, 200, response.text);
  safeHeaders(response);
  assert.match(response.headers.get('content-type'), /^image\/png/);
  fixture.files.set(fileKeys.image, { data: Buffer.from('<svg onload="unsafe()"/>'), contentType: 'image/svg+xml' });
  const rejected = await request(token, `/${ids.plan}/background`);
  assert.equal(rejected.status, 404, rejected.text);
  assert.ok(!rejected.text.includes('<svg'));
  assert.deepEqual(dispatches, []);
});

test('the editor payload preserves plan notes and import decisions while removing CRM records and storage keys', async () => {
  const { token } = await share();
  downstreamReply = (_req, res) => res.json({
    plan: { id: ids.plan, property_id: 'property-a', name: 'Shared plan', created_by: 'PRIVATE-USER' },
    levels: [{ id: ids.level, background_key: fileKeys.image, source_pdf_url: '/staff-only-original' }],
    units: [{ id: ids.unit, notes: 'Approved plan note', ts_link_status: 'conflict', ts_link_reason: 'Choose the matching row',
      ts_equivalent_row_ids: ['schedule-a'], ts_conflicts: [{ field: 'passing_rent_pa', label: 'Passing rent', values: [0, 100] }] }],
    entries: [{ id: ids.entry, source_key: fileKeys.doc, notes: 'Approved evidence note', created_by: 'PRIVATE-USER' }],
    matters: [{ id: 'PRIVATE-MATTER', client_name: 'PRIVATE-CLIENT' }],
    schedule_rows: [{ id: 'schedule-a', unit_number: 'A1', floor_level: 'Ground', premises: 'Shop',
      passing_rent_pa: 0, comments: 'Approved schedule note', underwriting_comments: 'Approved linked schedule commentary',
      property_id: 'property-a', tenant_company_id: 'PRIVATE-COMPANY', deal_id: 'PRIVATE-DEAL' }],
    imported: 0, skippedExisting: 2, needsReview: 1, mirrorNeedsReview: 1, message: 'One row needs review',
    reviewRows: [{ sourceRow: 3, unitNumber: 'A1', existingIds: ['schedule-a'], differingFields: ['passing_rent_pa'],
      incomingValues: { passing_rent_pa: 0, comments: 'Incoming note', tenant_company_id: 'PRIVATE-COMPANY' } }],
  });
  const response = await request(token, `/${ids.plan}`);
  assert.equal(response.status, 200, response.text);
  const result = response.json;
  assert.equal(result.plan.property_id, 'linked');
  assert.equal(result.levels[0].background_key, adapter.editorBackgroundRevision(fileKeys.image));
  assert.equal(result.levels[0].source_pdf_url, endpoint(token, `/levels/${ids.level}/original`));
  assert.equal(result.entries[0].document_url, endpoint(token, `/entries/${ids.entry}/document`));
  assert.equal(result.units[0].notes, 'Approved plan note');
  assert.equal(result.units[0].ts_link_status, 'conflict');
  assert.deepEqual(result.units[0].ts_equivalent_row_ids, ['schedule-a']);
  assert.equal(result.units[0].ts_conflicts[0].field, 'passing_rent_pa');
  assert.equal(result.schedule_rows[0].passing_rent_pa, 0);
  assert.equal(result.schedule_rows[0].floor_level, 'Ground');
  assert.equal(result.schedule_rows[0].underwriting_comments, 'Approved linked schedule commentary');
  assert.equal(result.skippedExisting, 2);
  assert.equal(result.needsReview, 1);
  assert.equal(result.reviewRows[0].incomingValues.passing_rent_pa, 0);
  assert.deepEqual(result.reviewRows[0].differingFields, ['passing_rent_pa']);
  assert.deepEqual(result.matters, []);
  for (const secret of ['PRIVATE-', fileKeys.image, fileKeys.doc, '/staff-only-original', 'property-a']) {
    assert.ok(!response.text.includes(secret), `Leaked ${secret}`);
  }
});

test('multipart background ownership is checked after parsing and before rendering or storage', async () => {
  const { token } = await share();
  const route = find('server/evidence-plan.ts', node => ts.isCallExpression(node)
    && ts.isPropertyAccessExpression(node.expression) && node.expression.expression.getText() === 'router'
    && node.expression.name.text === 'post' && ts.isStringLiteral(node.arguments[0])
    && node.arguments[0].text === '/api/evidence-plans/:id/background');
  const legacy = express.Router();
  let rendered = 0, applied = 0;
  evaluate(route + ';', {
    router: legacy,
    requireAuth: (req, res, next) => access.isEvidencePlanEditorRequest(req) ? next() : res.sendStatus(401),
    upload: multer({ storage: multer.memoryStorage() }),
    pool: fixture.db, isEvidencePlanEditorRequest: access.isEvidencePlanEditorRequest,
    planOr404: async planId => (await fixture.db.query('SELECT * FROM evidence_plans WHERE id=$1', [planId])).rows[0],
    healLevels: async () => {},
    renderPlanPages: async () => { rendered++; return []; },
    applyBackgroundPages: async () => { applied++; },
    planLevels: async planId => (await fixture.db.query('SELECT * FROM evidence_plan_levels WHERE plan_id=$1', [planId])).rows,
    autoDetectEmptyLevels: async () => {},
  });
  downstreamReply = legacy;
  const upload = async levelId => {
    const body = new FormData();
    body.append('background', new Blob([Buffer.from('89504e470d0a1a0a', 'hex')], { type: 'image/png' }), 'plan.png');
    body.append('levelId', levelId);
    return fixture.request(endpoint(token, `/${ids.plan}/background`), { method: 'POST', body });
  };
  const foreign = await upload(ids.otherLevel);
  assert.equal(foreign.status, 404, foreign.text);
  assert.equal(rendered, 0);
  assert.equal(applied, 0);
  const own = await upload(ids.level);
  assert.equal(own.status, 200, own.text);
  assert.equal(rendered, 1);
  assert.equal(applied, 1);
});

test('malformed scan assignment collections return validation errors without dispatch', async () => {
  const { token } = await share();
  for (const body of [{ assignments: {} }, { assignments: 'all' },
    { assignments: [], clearOutlineUnitIds: {} }, { assignments: [], clearOutlineUnitIds: 'all' }]) {
    const response = await request(token, `/${ids.plan}/scan-review/${id(40)}/apply`, 'POST', body);
    assert.equal(response.status, 400, response.text);
  }
  assert.deepEqual(dispatches, []);
});
