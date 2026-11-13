// The other writers of a schedule row's tenant (docs/tenant-entity-plan-2026-11-13.md
// section 7, package B): every name edit relinks through the tenant door, the
// review resolve sets a brand or a name only through it, the completion reverts
// clear the company on the lease with the brand, reconcile carries it only with
// its brand, sql_write refuses it, and a company on a lease cannot be deleted.
// Source facts and small behaviour checks with synthetic pools only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { importTenancyRows, TENANCY_REPLACE_PAUSED } from '../../server/tenancy-import.ts';
import { chatTenantActor } from '../../server/chatbgp-tenancy-import.ts';
import * as schema from '../../shared/schema.ts';
import { EVIDENCE_PLAN_READ_TABLES } from '../../server/evidence-plan-chat.ts';
import * as requirementLive from '../../shared/requirement-live.ts';
import { LETTING_REPAIR_TOOLS_ENABLED } from '../../shared/feature-flags.ts';
const require = createRequire(import.meta.url);
const { source, find, evaluate, ts } = require('./source-harness.cjs');

const fn = (file, name) => find(file, node => (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name?.text === name);
const constant = (file, name) => find(file, (node, ast) => ts.isVariableStatement(node) && node.declarationList.declarations.some(d => d.name.getText(ast) === name));
const routeOn = (file, object, method, url) => find(file, (node, ast) => ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
  && node.expression.expression.getText(ast) === object && node.expression.name.text === method
  && ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === url) + ';';
const response = () => ({ statusCode: 200, body: undefined, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });

test('no writer in this package sets tenant_entity_id except the two completion reverts', () => {
  for (const file of ['server/tenancy-import.ts', 'server/chatbgp-tenancy-import.ts', 'server/evidence-plan.ts', 'server/property-review.ts',
    'server/sql-tools.ts', 'server/leasing-schedule.ts', 'server/property-asset-brief.ts']) {
    assert.doesNotMatch(source(file), /tenant_entity_id\s*=(?!=)\s*(?!\$1\b)/, `${file} writes tenant_entity_id`);
  }
  for (const file of ['server/crm.ts', 'server/deal-stages.ts']) {
    const writes = source(file).match(/tenant_entity_id = (?!\$1\b)[^\n]*/g) || [];
    assert.deepEqual(writes, ['tenant_entity_id = CASE WHEN tenant_company_id = $3 THEN NULL ELSE tenant_entity_id END,'], file);
  }
});

test('both completion reverts clear the company on the lease in the same statement as the brand, and only with it', () => {
  for (const file of ['server/crm.ts', 'server/deal-stages.ts']) {
    const statement = source(file).match(/UPDATE tenancy_schedule_units\s+SET status = 'Under Offer',[\s\S]*?WHERE id = \$1 AND lower\(coalesce\(status, ''\)\) = 'occupied'/);
    assert.ok(statement, `${file} revert statement`);
    assert.match(statement[0], /tenant_company_id = CASE WHEN tenant_company_id = \$3 THEN NULL ELSE tenant_company_id END,\s+tenant_entity_id = CASE WHEN tenant_company_id = \$3 THEN NULL ELSE tenant_entity_id END,/);
  }
});

test('the AML gate still reads only the brand', () => {
  assert.doesNotMatch(source('server/deal-gates.ts'), /tenancy_schedule_units|tenant_entity_id/);
});

test('the review resolve sets a schedule row\'s brand and names through the door and never allows the company on the lease', async () => {
  const file = 'server/property-review.ts';
  assert.doesNotMatch(source(file), /"tenant_entity_id"/);
  const route = routeOn(file, 'router', 'post', '/api/review-items/:id/resolve');
  assert.match(route, /setTenancyTenant\(db, w\.id, tenantInput, actor\)/);
  const options = [{ key: 'pick', label: 'Use the file', writes: [
    { table: 'tenancy_schedule_units', id: 'row-1', set: { tenant_company_id: 'brand-1', trading_name: 'Zara', passing_rent_pa: 1000 } },
    { table: 'tenancy_schedule_units', id: 'row-2', set: { tenant_name: 'ITX UK Limited' } },
    { table: 'leasing_schedule_units', id: 'lease-1', set: { tenant_company_id: 'brand-1', tenant_name: 'Zara' } },
  ] }];
  const queries = [], doors = [];
  const db = {
    async query(sql, values) {
      queries.push({ sql, values });
      if (/FROM property_review_items WHERE id/.test(sql)) return { rows: [{ id: 'item', status: 'open', property_id: 'p1', options }] };
      if (/SELECT property_id FROM/.test(sql)) return { rows: [{ property_id: 'p1' }] };
      return { rows: [] };
    },
    release() {},
  };
  let handler;
  const router = { post(_url, ...handlers) { handler = handlers.at(-1); } };
  const bindings = { router, requireAuth: null, pool: { connect: async () => db }, staffOnly: async () => true, actorName: async () => 'Woody',
    setTenancyTenant: async (_db, id, input, actor) => { doors.push({ id, input, actor }); return { row: {}, notes: [] }; } };
  evaluate([constant(file, 'TENANT_DOOR_FIELDS'), constant(file, 'LEASING_FIELDS'), 'const TENANCY_FIELDS = ["trading_name", "tenant_name", "passing_rent_pa"];',
    constant(file, 'TABLES'), fn(file, 'validOptions'), route].join('\n'), bindings);
  const res = response();
  await handler({ params: { id: 'item' }, body: { option: 'pick' }, session: { userId: 'u1' } }, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.deepEqual(JSON.parse(JSON.stringify(doors)), [
    { id: 'row-1', input: { companyId: 'brand-1', tradingName: 'Zara' }, actor: { userId: 'u1', name: 'Woody', viewer: 'staff' } },
    { id: 'row-2', input: { tenantName: 'ITX UK Limited' }, actor: { userId: 'u1', name: 'Woody', viewer: 'staff' } },
  ]);
  const updates = queries.filter(q => /^UPDATE (tenancy|leasing)_schedule_units/.test(q.sql)).map(q => q.sql);
  assert.deepEqual(updates.map(sql => sql.match(/SET (.*), updated_at/)[1]), ['passing_rent_pa = $2', 'tenant_company_id = $2, tenant_name = $3']);
  assert.ok(queries.some(q => /status = 'resolved'/.test(q.sql)));
});

test('a review option naming the company on the lease is refused', () => {
  const file = 'server/property-review.ts';
  const { validOptions } = evaluate([constant(file, 'LEASING_FIELDS'), 'const TENANCY_FIELDS = ["trading_name", "tenant_name"];',
    constant(file, 'TABLES'), fn(file, 'validOptions'), 'exports.validOptions = validOptions;'].join('\n'));
  assert.throws(() => validOptions([{ writes: [{ table: 'tenancy_schedule_units', id: 'r', set: { tenant_entity_id: 'e' } }] }]), /tenant_entity_id can't be set/);
  assert.doesNotThrow(() => validOptions([{ writes: [{ table: 'tenancy_schedule_units', id: 'r', set: { tenant_company_id: 'b' } }] }]));
});

const loadSqlTools = pool => {
  const compiled = ts.transpileModule(source('server/sql-tools.ts'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  return evaluate(compiled.replace(/^"use strict";/, ''), { require(name) {
    if (name === './db') return { pool };
    if (name === '@shared/schema') return schema;
    if (name === './evidence-plan-chat') return { EVIDENCE_PLAN_READ_TABLES };
    if (name === '@shared/requirement-live') return requirementLive;
    throw new Error(`Unexpected module: ${name}`);
  } });
};

test('sql_write refuses the company on a schedule row\'s lease and keeps every other write it allowed', async () => {
  const calls = [];
  const tools = loadSqlTools({ async query(query, values) { calls.push({ query, values }); return { rows: [{ id: 'synthetic' }], rowCount: 1 }; } });
  for (const write of [
    { table: 'tenancy_schedule_units', op: 'update', data: { tenant_entity_id: 'entity' }, where: { id: 'row' } },
    { table: 'TENANCY_SCHEDULE_UNITS', op: 'update', data: { TENANT_ENTITY_ID: 'entity' }, where: { id: 'row' } },
    { table: 'tenancy_schedule_units', op: 'insert', data: { property_id: 'p', tenant_entity_id: 'entity' } },
    { table: 'tenancy_schedule_units', op: 'insert', rows: [{ property_id: 'p' }, { property_id: 'p', tenant_entity_id: 'entity' }] },
  ]) {
    const result = await tools.executeSqlWrite(write);
    assert.equal(result.success, false, JSON.stringify(write));
    assert.match(result.error, /tenant_entity_id/);
  }
  // A delete here would go round the trading-entities DELETE route's checks.
  const deleted = await tools.executeSqlWrite({ table: 'crm_trading_entities', op: 'delete', where: { id: 'entity' } });
  assert.equal(deleted.success, false);
  assert.match(deleted.error, /Delete it from the brand page/);
  assert.equal(calls.length, 0);
  for (const write of [
    { table: 'tenancy_schedule_units', op: 'update', data: { tenant_name: 'Zara', tenant_company_id: 'brand' }, where: { id: 'row' } },
    { table: 'tenancy_schedule_units', op: 'delete', where: { tenant_entity_id: 'entity' } },
    { table: 'crm_deals', op: 'update', data: { tenant_entity_id: 'xero-contact' }, where: { id: 'deal' } },
    { table: 'crm_trading_entities', op: 'update', data: { notes: 'Checked' }, where: { id: 'entity' } },
  ]) {
    assert.equal((await tools.executeSqlWrite(write)).success, true, JSON.stringify(write));
  }
  assert.ok(calls.some(call => call.query.startsWith('UPDATE crm_deals SET') && call.values.includes('xero-contact')));
});

test('deleting a company on the lease is refused while anything points at it, with the count', async () => {
  const route = routeOn('server/crm.ts', 'app', 'delete', '/api/crm/trading-entities/:id');
  assert.match(route, /FROM tenancy_schedule_units WHERE tenant_entity_id = \$1/);
  const run = async counts => {
    const queries = [];
    const pool = { async query(sql) {
      queries.push(sql);
      for (const [pattern, answer] of counts) {
        if (pattern.test(sql)) { if (answer instanceof Error) throw answer; return { rows: [{ n: answer }] }; }
      }
      return { rows: [{ n: 0 }] };
    } };
    let handler;
    evaluate(route, { app: { delete(_url, ...handlers) { handler = handlers.at(-1); } }, requireAuth: null, pool });
    const res = response();
    await handler({ params: { id: 'entity-1' } }, res);
    return { res, deleted: queries.some(sql => sql.startsWith('DELETE FROM crm_trading_entities')) };
  };
  const missing = code => Object.assign(new Error('missing'), { code });
  let out = await run([[/tenancy_schedule_units/, 3]]);
  assert.equal(out.res.statusCode, 409); assert.equal(out.res.body.error, 'This company is on the lease of 3 schedule rows. Unlink it first.'); assert.equal(out.deleted, false);
  out = await run([[/tenancy_schedule_units/, 1]]);
  assert.equal(out.res.body.error, 'This company is on the lease of 1 schedule row. Unlink it first.');
  out = await run([[/billing_entity_id/, 2]]);
  assert.equal(out.res.statusCode, 409); assert.match(out.res.body.error, /billing entity of 2 properties/); assert.equal(out.deleted, false);
  out = await run([[/crm_entity_kyc/, 1]]);
  assert.equal(out.res.statusCode, 409); assert.match(out.res.body.error, /1 KYC record /); assert.equal(out.deleted, false);
  out = await run([[/FROM crm_deals/, 2]]);
  assert.equal(out.res.statusCode, 409); assert.match(out.res.body.error, /2 deal/); assert.equal(out.deleted, false);
  out = await run([]);
  assert.equal(out.res.statusCode, 200); assert.equal(out.res.body.ok, true); assert.equal(out.deleted, true);
  out = await run([[/crm_entity_kyc/, missing('42P01')], [/billing_entity_id/, missing('42703')], [/tenancy_schedule_units/, missing('42703')]]);
  assert.equal(out.res.statusCode, 200); assert.equal(out.deleted, true);
  out = await run([[/crm_entity_kyc/, Object.assign(new Error('connection lost'), { code: '08006' })]]);
  assert.equal(out.res.statusCode, 500); assert.equal(out.deleted, false);
});

test('duplicate reconcile carries the company on the lease only from a donor whose brand is the keeper\'s final brand', async () => {
  const code = [constant('server/tenancy-reconcile.ts', 'norm'), constant('server/tenancy-reconcile.ts', 'CONFLICT_FIELDS'),
    constant('server/tenancy-reconcile.ts', 'SKIP_COLUMNS'), constant('server/tenancy-reconcile.ts', 'populatedCount'),
    constant('server/tenancy-reconcile.ts', 'valuesConflict'), fn('server/tenancy-reconcile.ts', 'coverageQuery'),
    fn('server/tenancy-reconcile.ts', 'reconcileTenancyRows'), 'exports.reconcileTenancyRows = reconcileTenancyRows;'].join('\n');
  const plan = async rows => {
    const pool = { async query(sql) {
      if (/FROM tenancy_schedule_units t/.test(sql)) return { rows: rows.map(r => ({ property_id: 'p', __property_name: 'P', unit_number: 'A1', ...r })) };
      if (/information_schema/.test(sql)) return { rows: [] };
      return { rows: [{ with_rent: '0', with_expiry: '0', with_both: '0' }] };
    }, connect() { assert.fail('a dry run writes nothing'); } };
    const { reconcileTenancyRows } = evaluate(code, { pool });
    return (await reconcileTenancyRows({ propertyId: 'p' })).merges[0];
  };
  const keeper = { id: 'keep', passing_rent_pa: 1, lease_expiry: '2030-01-01', comments: 'x', floor_level: 'G' };
  let m = await plan([{ ...keeper, tenant_company_id: 'zara' }, { id: 'd1', tenant_company_id: 'zara', tenant_entity_id: 'itx-uk' }]);
  assert.ok(m.fieldsGained.includes('tenant_entity_id'));
  m = await plan([{ ...keeper, tenant_company_id: 'zara' }, { id: 'd1', tenant_company_id: 'next', tenant_entity_id: 'next-plc' }]);
  assert.ok(!m.fieldsGained.includes('tenant_entity_id'));
  m = await plan([{ ...keeper }, { id: 'd1', tenant_company_id: 'zara', premises: 'p1', grouping: 'g' }, { id: 'd2', tenant_company_id: 'next', tenant_entity_id: 'next-plc' }]);
  assert.ok(m.fieldsGained.includes('tenant_company_id')); assert.ok(!m.fieldsGained.includes('tenant_entity_id'), 'keeper took zara, the donor is under next');
  m = await plan([{ ...keeper }, { id: 'd1', tenant_company_id: 'zara', tenant_entity_id: 'itx-uk' }]);
  assert.ok(m.fieldsGained.includes('tenant_company_id')); assert.ok(m.fieldsGained.includes('tenant_entity_id'), 'brand and company come together');
  m = await plan([{ ...keeper, tenant_company_id: 'zara', tenant_entity_id: 'itx-es' }, { id: 'd1', tenant_company_id: 'zara', tenant_entity_id: 'itx-uk' }]);
  assert.ok(!m.fieldsGained.includes('tenant_entity_id'), 'the keeper keeps its own');
});

const fakeImportPool = (rows, log) => ({
  async connect() {
    return {
      async query(sql, values) {
        log.push({ sql, values });
        if (/FROM crm_properties/.test(sql)) return { rows: [{ id: 'p' }] };
        if (/SELECT \* FROM tenancy_schedule_units/.test(sql)) return { rows: rows.map(r => ({ ...r })) };
        if (/^UPDATE tenancy_schedule_units/.test(sql)) return { rows: [{ ...rows[0], tenant_name: values[0] }] };
        if (/^INSERT INTO tenancy_schedule_units/.test(sql)) return { rows: [{ id: 'new', unit_number: values[1] }] };
        return { rows: [] };
      },
      release() {},
    };
  },
});

test('an import edit of a tenant name relinks through the door, inside the transaction, from the row as it was', async () => {
  const before = { id: 'keep', property_id: 'p', unit_number: 'A1', tenant_name: 'Old Co Ltd', trading_name: 'Zara', tenant_company_id: 'zara', tenant_entity_id: 'itx-uk', comments: 'x' };
  const log = [], relinks = [];
  const options = { allowedFields: ['tenant_name', 'comments'], explicitEdits: [{ id: 'keep', sourceRow: 1, values: { tenant_name: 'New Co Ltd' } }],
    afterTenantEdit: async (db, id, prior) => { relinks.push({ id, prior, open: !log.some(q => q.sql === 'COMMIT') }); return { row: { ...before, tenant_name: 'New Co Ltd', tenant_entity_id: null } }; } };
  const result = await importTenancyRows(fakeImportPool([before], log), 'p', [], options);
  assert.equal(result.updated, 1);
  assert.deepEqual(relinks, [{ id: 'keep', prior: { tenant_name: 'Old Co Ltd', trading_name: 'Zara', tenant_company_id: 'zara', tenant_entity_id: 'itx-uk' }, open: true }]);
  // A refusal from the door rolls the whole import back and reaches the caller.
  const refusedLog = [];
  const refusal = Object.assign(new Error('BGP has recorded the company on this lease. Ask BGP to change the tenant.'), { status: 409 });
  await assert.rejects(() => importTenancyRows(fakeImportPool([before], refusedLog), 'p', [], { ...options, afterTenantEdit: async () => { throw refusal; } }), refusal);
  assert.ok(refusedLog.some(q => q.sql === 'ROLLBACK')); assert.ok(!refusedLog.some(q => q.sql === 'COMMIT'));
  // A comment-only edit does not call the door.
  relinks.length = 0;
  await importTenancyRows(fakeImportPool([before], []), 'p', [], { ...options, explicitEdits: [{ id: 'keep', sourceRow: 1, values: { comments: 'y' } }] });
  assert.equal(relinks.length, 0);
  // Without the door, a name edit is refused before anything opens.
  await assert.rejects(() => importTenancyRows({ connect() { assert.fail('must not connect'); } }, 'p', [], { ...options, afterTenantEdit: undefined }), error => error.status === 400);
});

test('a replacement import is refused while a row on the property has a company on the lease', async () => {
  const s = fn('server/tenancy-import.ts', 'importTenancyRows');
  const at = s.indexOf('saved.tenant_entity_id');
  assert.ok(at > 0 && at < s.indexOf('DELETE FROM tenancy_schedule_units') && at < s.indexOf('UPDATE crm_deals SET tenancy_unit_id = NULL'));
  if (!LETTING_REPAIR_TOOLS_ENABLED) {
    await assert.rejects(() => importTenancyRows({ connect() { assert.fail('must not connect'); } }, 'p', [{ sourceRow: 1, values: { unit_number: 'A1' } }],
      { clearExisting: true, allowedFields: ['unit_number'] }), error => error.status === 409 && error.message === TENANCY_REPLACE_PAUSED);
  }
  // The same module with replacement switched back on, as when the lettings cleanup ends.
  const compiled = ts.transpileModule(source('server/tenancy-import.ts'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const unpaused = evaluate(compiled.replace(/^"use strict";/, ''), { require(name) {
    if (name === '@shared/feature-flags') return { LETTING_REPAIR_TOOLS_ENABLED: true, LETTING_REPAIR_PAUSED: 'Paused' };
    throw new Error(`Unexpected module: ${name}`);
  } });
  const log = [];
  await assert.rejects(() => unpaused.importTenancyRows(fakeImportPool([{ id: 'keep', unit_number: 'A1', tenant_entity_id: 'itx-uk' }, { id: 'two', unit_number: 'A2', tenant_entity_id: 'next-plc' }], log), 'p',
    [{ sourceRow: 1, values: { unit_number: 'A1' } }], { clearExisting: true, allowedFields: ['unit_number'] }),
    error => error.status === 409 && error.message === '2 rows on this property have a company on the lease. Import without replacing existing rows.');
  assert.ok(log.some(q => q.sql === 'ROLLBACK'));
  assert.ok(!log.some(q => /^(DELETE|UPDATE)/.test(q.sql)));
  const clean = [];
  const done = await unpaused.importTenancyRows(fakeImportPool([{ id: 'keep', unit_number: 'A1', tenant_entity_id: null }], clean), 'p',
    [{ sourceRow: 1, values: { unit_number: 'A1' } }], { clearExisting: true, allowedFields: ['unit_number'] });
  assert.ok(clean.some(q => /^DELETE FROM tenancy_schedule_units/.test(q.sql))); assert.equal(done.imported, 1);
});

test('ChatBGP writes as the person asking, a client scope as a client, and only a server run as the system', async () => {
  const pool = { async query() { return { rows: [{ username: 'woody' }] }; } };
  assert.deepEqual(await chatTenantActor(pool, { scope: null, userId: 'u1', internal: false }), { userId: 'u1', name: 'woody', viewer: 'staff' });
  assert.deepEqual(await chatTenantActor(pool, { scope: 'landsec', userId: 'u2', internal: false }), { userId: 'u2', name: 'woody', viewer: 'client' });
  assert.deepEqual(await chatTenantActor(pool, { scope: 'landsec', userId: 'u2', internal: true }), { userId: 'u2', name: 'woody', viewer: 'client' });
  assert.deepEqual(await chatTenantActor(pool, { scope: null, userId: 'u1', internal: true }), { system: 'chatbgp' });
  assert.deepEqual(await chatTenantActor(pool, { scope: null, userId: null, internal: false }), { system: 'chatbgp' });
  assert.equal((await chatTenantActor(pool, { scope: 'landsec', userId: null, internal: true })).viewer, 'client');
  const chat = source('server/chatbgp.ts');
  assert.equal((chat.match(/upsertChatTenancySchedule\(pool, fnArgs\.propertyId, fnArgs\.rows, actor\)/g) || []).length, 2);
  assert.equal((chat.match(/chatTenantActor\(pool, \{ scope: await resolveCompanyScope\(req\), userId: req\.session\?\.userId \|\| \(req as any\)\.tokenUserId, internal: isInternalStaffRequest\(req\) \}\)/g) || []).length, 2);
  assert.match(chat, /saveUnit: \(unitId, body, canEditProperty\) => saveEvidenceUnit\(unitId, body, canEditProperty, actor\)/);
  assert.match(source('server/chatbgp-tenancy-import.ts'), /afterTenantEdit: \(db, id, before\) => relinkTenantAfterNameEdit\(db, id, before, actor\)/);
});

test('the evidence plan unit edit relinks through the door from the row as it was, never by its own resolve', () => {
  const save = fn('server/evidence-plan.ts', 'saveEvidenceUnit');
  assert.doesNotMatch(save, /resolveBrandIdSubquery|SET tenant_company_id/);
  assert.match(save, /relinkTenantAfterNameEdit\(db, matched\.id, \{ tenant_name: matched\.tenant_name \?\? null, trading_name: matched\.trading_name \?\? null,\s+tenant_company_id: matched\.tenant_company_id \?\? null, tenant_entity_id: matched\.tenant_entity_id \?\? null \}, actor\)/);
  assert.ok(save.indexOf('relinkTenantAfterNameEdit') < save.indexOf('"COMMIT"'));
  const route = routeOn('server/evidence-plan.ts', 'router', 'put', '/api/evidence-plans/units/:unitId');
  assert.match(route, /viewer: scope \|\| isEvidencePlanEditorRequest\(req\) \? "client" : "staff"/);
  assert.doesNotMatch(route, /\{ system/);
});

test('the leasing schedule and the asset brief read a blank trading name as no name', () => {
  assert.match(source('server/leasing-schedule.ts'), /COALESCE\(NULLIF\(btrim\(t\.trading_name\), ''\), NULLIF\(btrim\(t\.tenant_name\), ''\), NULLIF\(btrim\(u\.tenant_name\), ''\), ''\)/);
  assert.match(source('server/property-asset-brief.ts'), /coalesce\(NULLIF\(btrim\(t\.trading_name\), ''\), NULLIF\(btrim\(t\.tenant_name\), ''\), ''\)/);
  for (const file of ['server/leasing-schedule.ts', 'server/property-asset-brief.ts']) {
    assert.doesNotMatch(source(file), /coalesce\(t\.trading_name, t\.tenant_name/i, file);
  }
});
