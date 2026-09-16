import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { insertCrmPropertySchema } from '../../shared/schema.ts';

const require = createRequire(import.meta.url);
const { route, evaluate } = require('./source-harness.cjs');
const response = () => ({ code: 200, body: null, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });

function fixture({ client = true, propertyId = 'own', initial = {} } = {}) {
  const handlers = {}, writes = [], enrichments = [];
  let stored = { id: propertyId, name: 'Test building', assetClass: 'Mixed Use', propertyView: null, ...initial };
  const capture = method => (_path, ...callbacks) => { handlers[method] = callbacks.at(-1); };
  evaluate([
    route('server/crm.ts', 'post', '/api/crm/properties'),
    route('server/crm.ts', 'put', '/api/crm/properties/:id'),
    route('server/crm.ts', 'get', '/api/crm/properties/:id'),
  ].join('\n'), {
    insertCrmPropertySchema,
    enrichPropertyInBackground: (id, options) => enrichments.push({ id, options: options && { ...options } }),
    requireAuth() {},
    resolveCompanyScope: async () => client ? 'portfolio' : null,
    isPropertyInScope: async (_company, id) => id === 'own',
    app: { post: capture('post'), put: capture('put'), get: capture('get') },
    storage: {
      createCrmProperty: async patch => { writes.push(patch); stored = { ...stored, ...patch }; return stored; },
      updateCrmProperty: async (id, patch) => { assert.equal(id, propertyId); writes.push(patch); stored = { ...stored, ...patch }; return stored; },
      getCrmProperty: async () => stored,
    },
  });
  return {
    writes,
    enrichments,
    async run(method, body) {
      const res = response();
      await handlers[method]({ body, params: { id: propertyId } }, res);
      return res;
    },
  };
}

test('property creation accepts all layouts and automatic without changing asset classification', async () => {
  for (const propertyView of ['building', 'multi_let', 'centre', null, undefined]) {
    const f = fixture({ client: false });
    const result = await f.run('post', { name: 'Test building', assetClass: 'Mixed Use', ...(propertyView === undefined ? {} : { propertyView }) });
    assert.equal(result.code, 201);
    assert.equal(result.body.assetClass, 'Mixed Use');
    assert.equal(result.body.propertyView, propertyView ?? null);
    assert.deepEqual(f.enrichments, [{ id: 'own', options: { force: true } }]);
  }
});

test('invalid property layouts fail creation and updates before any write', async () => {
  for (const propertyView of ['shopping_centre', 'automatic', '', 'Building', 0, false, [], {}]) {
    for (const method of ['post', 'put']) {
      const f = fixture();
      const result = await f.run(method, { name: 'Test building', propertyView });
      assert.equal(result.code, 400, `${method}: ${JSON.stringify(propertyView)}`);
      assert.equal(f.writes.length, 0);
    }
  }
});

test('scoped clients can choose and reset their property view while preserving other data', async () => {
  const f = fixture({ initial: { landlordId: 'portfolio', notes: 'Keep me' } });
  for (const propertyView of ['centre', 'building', 'multi_let', null]) {
    const result = await f.run('put', { propertyView, landlordId: 'foreign' });
    assert.equal(result.code, 200);
    const read = await f.run('get');
    assert.equal(read.body.propertyView, propertyView);
    assert.equal(read.body.assetClass, 'Mixed Use');
    assert.equal(read.body.landlordId, 'portfolio');
    assert.equal(read.body.notes, 'Keep me');
  }
  assert.equal(f.writes.length, 4);
});

test('omitting view leaves the saved choice intact and unscoped staff retain ordinary edits', async () => {
  for (const client of [true, false]) {
    const f = fixture({ client, initial: { propertyView: 'multi_let' } });
    const result = await f.run('put', { notes: 'Saved note', assetClass: 'Office' });
    assert.equal(result.code, 200);
    assert.equal(result.body.propertyView, 'multi_let');
    assert.equal(result.body.notes, 'Saved note');
    assert.equal(result.body.assetClass, 'Office');
  }
});

test('property view changes retain existing property access checks', async () => {
  const blocked = fixture({ propertyId: 'foreign' });
  assert.equal((await blocked.run('put', { propertyView: 'centre' })).code, 403);
  assert.equal(blocked.writes.length, 0);
  const staff = fixture({ client: false, propertyId: 'foreign' });
  assert.equal((await staff.run('put', { propertyView: 'centre' })).code, 200);
  assert.equal(staff.writes.length, 1);
});

test('owner edits remain available to clients while shared company enrichment only runs for staff', async () => {
  for (const client of [true, false]) {
    const f = fixture({ client });
    const result = await f.run('put', { proprietorName: 'New owner', useClass: 'E(a)', propertyView: 'building' });
    assert.equal(result.code, 200);
    assert.equal(result.body.proprietorName, 'New owner');
    assert.equal(result.body.useClass, 'E(a)');
    assert.equal(result.body.propertyView, 'building');
    assert.deepEqual(f.enrichments, client ? [] : [{ id: 'own', options: { force: true } }]);
    assert.equal((await f.run('get')).code, 200);
    assert.equal(f.enrichments.length, client ? 0 : 2);
  }
});
