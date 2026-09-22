import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { find, route, evaluate, ts } = require('./source-harness.cjs');
const file = 'server/routes.ts';
const helper = find(file, node => ts.isFunctionDeclaration(node) && node.name?.text === 'taskLinksInScope');
const response = () => ({ code: 200, body: null, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });

function fixture(method, path, { client = true, existing = {}, missing = false } = {}) {
  let handler;
  const writes = [], checks = [];
  const scope = {
    resolveCompanyScope: async () => client ? 'portfolio' : null,
    isPropertyInScope: async (company, id) => { checks.push(['property', company, id]); return id === 'own' || id === 'shared'; },
    isDealInScope: async (company, id) => { checks.push(['deal', company, id]); return id === 'own-deal'; },
  };
  const current = { id: 'record', propertyId: 'own', user_id: 'user', status: 'todo', linked_property_id: 'own', linked_deal_id: null, ...existing };
  evaluate(`${helper}\n${route(file, method, path)}`, {
    ...scope, requireAuth() {},
    app: { [method]: (_path, _auth, callback) => { handler = callback; } },
    pool: { query: async (sql, values) => {
      if (sql.startsWith('SELECT * FROM user_tasks')) return { rows: missing ? [] : [current] };
      assert.match(sql, /^\s*(INSERT INTO|UPDATE) user_tasks/);
      writes.push({ sql, values });
      return { rows: [{ ...current, id: 'saved' }] };
    } },
    storage: {
      getAvailableUnit: async () => missing ? null : current,
      updateAvailableUnit: async (id, patch) => { writes.push({ id, patch }); return { ...current, ...patch }; },
    },
    require: name => {
      if (name === './company-scope') return scope;
      if (name === '@shared/schema') return { insertAvailableUnitSchema: { partial: () => ({ parse: value => ({ ...value }) }) } };
      throw new Error(`Unexpected import ${name}`);
    },
  });
  return { writes, checks, async run(body) { const res = response(); await handler({ params: { id: 'record' }, session: { userId: 'user' }, body }, res); return res; } };
}

test('available-unit move authorises both the current and destination property before any write', async () => {
  for (const scenario of [{ existing: {}, body: { propertyId: 'foreign', sqft: 1200 } }, { existing: { propertyId: 'foreign' }, body: { propertyId: 'own', sqft: 1200 } }]) {
    const f = fixture('patch', '/api/available-units/:id', scenario);
    assert.equal((await f.run(scenario.body)).code, 403);
    assert.equal(f.writes.length, 0, 'neither the unit master nor its listing may change');
  }
});

test('clients retain ordinary listing edits and permitted destinations; staff remain unscoped', async () => {
  for (const options of [{ body: { notes: 'Saved note', askingRent: 51000, fee: 900 } }, { body: { propertyId: 'shared' } }, { client: false, body: { propertyId: 'foreign' } }]) {
    const f = fixture('patch', '/api/available-units/:id', options);
    assert.equal((await f.run(options.body)).code, 200);
    assert.equal(f.writes.length, 1);
    if (options.body.fee) assert.equal(f.writes[0].patch.fee, undefined, 'client fee protection remains');
  }
});

test('task creation rejects either an inaccessible property or an inaccessible deal before inserting', async () => {
  for (const links of [{ linkedPropertyId: 'foreign' }, { linkedDealId: 'foreign-deal' }, { linkedPropertyId: 'own', linkedDealId: 'foreign-deal' }, { linkedPropertyId: { id: 'own' } }]) {
    const f = fixture('post', '/api/tasks');
    assert.equal((await f.run({ title: 'Follow up', ...links })).code, 403);
    assert.equal(f.writes.length, 0);
  }
});

test('task creation keeps own-property, own-deal, standalone and staff workflows', async () => {
  for (const options of [{ body: { linkedPropertyId: 'own', linkedDealId: 'own-deal' } }, { body: {} }, { client: false, body: { linkedPropertyId: 'foreign', linkedDealId: 'foreign-deal' } }]) {
    const f = fixture('post', '/api/tasks', options);
    assert.equal((await f.run({ title: 'Follow up', ...options.body })).code, 200);
    assert.equal(f.writes.length, 1);
  }
});

test('task updates authorise replacement links before any write', async () => {
  for (const body of [{ linkedPropertyId: 'foreign' }, { linkedDealId: 'foreign-deal' }, { linkedPropertyId: 'shared', linkedDealId: 'foreign-deal' }]) {
    const f = fixture('patch', '/api/tasks/:id');
    assert.equal((await f.run(body)).code, 403);
    assert.equal(f.writes.length, 0);
  }
});

test('legacy foreign task links cannot post completion to another property, but may be removed', async () => {
  for (const existing of [{ linked_property_id: 'foreign' }, { linked_deal_id: 'foreign-deal' }]) {
    const blocked = fixture('patch', '/api/tasks/:id', { existing });
    assert.equal((await blocked.run({ status: 'done' })).code, 403);
    assert.equal(blocked.writes.length, 0);
    const repaired = fixture('patch', '/api/tasks/:id', { existing });
    assert.equal((await repaired.run({ linkedPropertyId: null, linkedDealId: null })).code, 200);
    assert.equal(repaired.writes.length, 1);
  }
});

test('task ownership checks and legitimate edits are preserved', async () => {
  const missing = fixture('patch', '/api/tasks/:id', { missing: true });
  assert.equal((await missing.run({ title: 'No access' })).code, 404);
  assert.equal(missing.checks.length, 0);
  const own = fixture('patch', '/api/tasks/:id');
  assert.equal((await own.run({ title: 'Updated next action', linkedDealId: 'own-deal' })).code, 200);
  assert.equal(own.writes.length, 1);
});
