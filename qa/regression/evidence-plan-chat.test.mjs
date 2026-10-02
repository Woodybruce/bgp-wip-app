import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { manageEvidencePlanUnit as run, EVIDENCE_PLAN_CHAT_TOOL } from '../../server/evidence-plan-chat.ts';
const require = createRequire(import.meta.url);
const { find, evaluate, ts, source } = require('./source-harness.cjs');
const planId = '11111111-1111-4111-8111-111111111111';
const unitId = '22222222-2222-4222-8222-222222222222';
const version = '2026-10-02T10:00:00.000Z';
const revision = { unitUpdatedAt: version, scheduleRowId: null, scheduleRowUpdatedAt: null };
function fixture(options = {}) {
  const calls = [], audits = [], writes = [];
  const unit = { id: unitId, plan_id: planId, unit_ref: 'B6', tenant_name: 'Hotel Chocolat', updated_at: version, ...options.unit };
  const deps = {
    async query(sql, values) {
      calls.push({ sql, values });
      if (sql.includes('FROM evidence_plans')) return { rows: [{ id: planId, property_id: 'property' }] };
      if (sql.includes('FROM evidence_plan_units')) return { rows: options.units || [unit] };
      if (sql.includes('FROM evidence_plan_entries')) return { rows: [{ id: 'entry', unit_id: unitId, size_sqft: 1227, headline_rent: null, transaction_date: '2027-08-03', term: '5' }] };
      assert.fail(sql);
    },
    async canAccessProperty(id) { assert.equal(id, 'property'); return options.access !== false; },
    async scheduleRows() { return []; },
    presentUnit(row) { return { ...row, ...options.presented }; },
    normaliseUnitRef(ref) { return ref.toUpperCase().replace(/^UNIT /, '').replace(/([A-Z])0+(\d)/g, '$1$2'); },
    async saveUnit(id, body, allowed) {
      assert.equal(id, unitId); assert.equal(await allowed('property'), true);
      writes.push(body); if (options.error) throw new Error(options.error);
      return { ...unit, ts_linked: !!options.presented?.ts_row_id };
    },
    async audit(entry) { audits.push(entry); },
  };
  return { deps, calls, audits, writes, unit };
}

test('read resolves normalized unit reference and exposes evidence separately without inventing current rent or dates', async () => {
  const f = fixture(); const result = await run({ action: 'read', planId, unitRef: 'Unit B06' }, f.deps);
  assert.equal(result.success, true); assert.equal(result.evidence[0].size_sqft, 1227);
  assert.equal(result.unit.passing_rent, undefined); assert.equal(result.unit.lease_expiry, undefined);
  assert.deepEqual(result.revision, revision); assert.equal(f.writes.length, 0);
});

test('out-of-scope read and update do not fetch units, evidence, or mutate', async () => {
  for (const action of ['read', 'update']) {
    const f = fixture({ access: false });
    const result = await run({ action, planId, unitId, revision, facts: { sqft: 1227 } }, f.deps);
    assert.equal(result.success, false); assert.equal(f.calls.length, 1); assert.equal(f.writes.length, 0);
  }
});

test('duplicate references across levels return choices and never pick an arbitrary unit', async () => {
  const f = fixture(); f.deps.query = async sql => ({ rows: sql.includes('FROM evidence_plans') ? [{ id: planId, property_id: 'property' }] : [f.unit, { ...f.unit, id: 'other', level_id: 'upper' }] });
  const result = await run({ action: 'read', planId, unitRef: 'B6' }, f.deps);
  assert.equal(result.success, false); assert.equal(result.candidates.length, 2); assert.equal(f.writes.length, 0);
});

test('explicit size update uses the canonical editor, scope callback, plan and unit versions, and audit', async () => {
  const f = fixture(); const result = await run({ action: 'update', planId, unitId, revision, facts: { sqft: 1227 } }, f.deps);
  assert.equal(result.success, true); assert.equal(result.savedTo, 'Evidence plan unit');
  assert.deepEqual(f.writes, [{ sqft: 1227, expectedPlanId: planId, expectedUnitUpdatedAt: version, scheduleRowId: null, scheduleRowUpdatedAt: null }]);
  assert.equal(f.audits[0].success, true); assert.equal(f.audits[0].affectedRows, 1);
});

test('linked schedule identity and version are passed unchanged to editor; genuine zero and explicit clear survive', async () => {
  const linked = { ...revision, scheduleRowId: 'schedule', scheduleRowUpdatedAt: version };
  const f = fixture({ presented: { ts_row_id: 'schedule', ts_row_updated_at: version } });
  const result = await run({ action: 'update', planId, unitId, revision: linked, facts: { passingRent: 0, breakDate: null } }, f.deps);
  assert.equal(result.success, true); assert.equal(result.savedTo, 'Linked property tenancy schedule');
  assert.equal(f.writes[0].passingRent, 0); assert.equal(f.writes[0].breakDate, null);
  assert.equal(f.writes[0].scheduleRowId, 'schedule'); assert.equal(f.writes[0].scheduleRowUpdatedAt, version);
});

test('missing or stale revisions, geometry, and transaction rent fields are rejected before any write', async () => {
  for (const extra of [ { revision: undefined }, { revision: { ...revision, unitUpdatedAt: 'old' } },
    { revision: { ...revision, scheduleRowId: 'other' } }, { revision: { unitUpdatedAt: version } },
    { facts: { polygon: [] } }, { facts: { headlineRent: 100 } }, { facts: {} }, { unitId: undefined, unitRef: 'B6' } ]) {
    const f = fixture(); const result = await run({ action: 'update', planId, unitId, revision, facts: { sqft: 1227 }, ...extra }, f.deps);
    assert.equal(result.success, false); assert.equal(f.writes.length, 0);
  }
});

test('transactional editor errors are returned as failure and audited, never claimed saved', async () => {
  for (const error of ['passingRent must be a non-negative number', 'The tenancy schedule was edited after you opened this unit.']) {
    const f = fixture({ error }); const result = await run({ action: 'update', planId, unitId, revision, facts: { passingRent: -1 } }, f.deps);
    assert.equal(result.success, false); assert.equal(result.error, error); assert.equal(result.affected, undefined);
    assert.equal(f.audits[0].success, false);
  }
});

test('locked editor rejects stale unit or wrong plan before any property or schedule update', async () => {
  const fn = find('server/evidence-plan.ts', node => ts.isFunctionDeclaration(node) && node.name?.text === 'saveEvidenceUnit');
  const cls = find('server/evidence-plan.ts', node => ts.isClassDeclaration(node) && node.name?.text === 'EvidencePlanError');
  for (const extra of [{ expectedUnitUpdatedAt: 'old' }, { expectedPlanId: 'wrong' }]) {
    const statements = [];
    const db = { async query(sql) { statements.push(sql); return { rows: [{ id: unitId, plan_id: planId, level_id: null, updated_at: version }] }; }, release() {} };
    const { saveEvidenceUnit } = evaluate(cls + '\n' + fn, { pool: { connect: async () => db }, validateEvidenceUnitPatch: body => ({ sqft: body.sqft }) });
    await assert.rejects(saveEvidenceUnit(unitId, { sqft: 1227, ...extra }, async () => true), error => error.status === 409);
    assert.ok(statements.includes('ROLLBACK')); assert.ok(!statements.some(sql => sql.includes('UPDATE ') && !sql.includes('FOR UPDATE')));
  }
});

test('tool is registered for non-admin use and describes rent/date limitations', () => {
  const name = EVIDENCE_PLAN_CHAT_TOOL.function.name;
  assert.match(source('server/chatbgp.ts'), /tools.push\(EVIDENCE_PLAN_CHAT_TOOL/);
  assert.match(source('server/chatbgp.ts'), /fnName === "manage_evidence_plan_unit"/);
  assert.match(EVIDENCE_PLAN_CHAT_TOOL.function.description, /never promote proposed\/renewal headline rent to passing rent/);
  const blocked = find('server/chatbgp.ts', node => ts.isVariableStatement(node) && node.declarationList.declarations.some(d => d.name.getText() === 'CLIENT_BLOCKED_TOOLS'));
  assert.ok(!blocked.includes(name));
});

test('chat adapter enforces sign-in, resolves scope and only emits change events for successful updates', async () => {
  const branch = find('server/chatbgp.ts', (node, ast) => ts.isIfStatement(node) && node.expression.getText(ast) === 'fnName === "manage_evidence_plan_unit"');
  const { call } = evaluate(`export async function call(fnArgs: any, req: any) { const fnName = "manage_evidence_plan_unit"; ${branch} }`, {
    pool: {}, unitId, planId,
    async resolveCompanyScope(req) { return req.testScope || null; },
    async isPropertyInScope(scope, id) { return scope === 'client' && id === 'own'; },
    require(name) {
      if (name === './evidence-plan-chat') return { async manageEvidencePlanUnit(args, deps) {
        assert.equal(await deps.canAccessProperty('own'), true);
        assert.equal(await deps.canAccessProperty('other'), false);
        assert.equal(await deps.canAccessProperty(null), false);
        return { success: args.testSuccess !== false, unit: { id: unitId, unit_ref: "B6" }, planId, propertyId: "own" };
      } };
      if (name === './evidence-plan') return {};
      if (name === './sql-tools') return { logAudit() {} };
      assert.fail(name);
    },
  });
  assert.equal((await call({ action: 'read' }, { session: {} })).data.success, false);
  for (const action of ['read', 'update']) {
    for (const testSuccess of [false, true]) {
      const result = await call({ action, testSuccess }, { session: { userId: 'client-user' }, testScope: 'client' });
      assert.equal(Boolean(result.action), action === 'update' && testSuccess);
    }
  }
});

test('both chat surfaces refresh the changed plan and linked property schedule without evicting unrelated data', () => {
  for (const file of ['client/src/pages/chatbgp.tsx', 'client/src/components/chat-panel.tsx']) {
    const declaration = find(file, node => ts.isVariableStatement(node) && node.declarationList.declarations.some(d => d.name.getText() === 'invalidateCrmEntity'));
    const invalidations = [];
    const { invalidateCrmEntity } = evaluate('export ' + declaration, { queryClient: { invalidateQueries({ queryKey }) { invalidations.push(Array.from(queryKey)); } } });
    invalidateCrmEntity('evidence_plan_unit', { planId, propertyId: 'property' });
    assert.deepEqual(invalidations, [['/api/evidence-plans', planId], ['/api/tenancy-schedule/property', 'property']]);
    assert.ok(/invalidateCrmEntity\(action.entityType, action\)|invalidateCrmEntity\(et, data.action\)/.test(source(file)));
  }
});
