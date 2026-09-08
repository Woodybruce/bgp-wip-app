const assert = require('node:assert/strict');
const express = require('express');
const { source, route, evaluate, find, ts } = require('./source-harness.cjs');
let gate;
let crmGate;
const scopeLookups = [];
let scopeFailure = false;
let crmScopeFailure = false;
const statuses = evaluate(source("shared/deal-status.ts"));
const policy = ['CLIENT_ALLOWED_API', 'CLIENT_ALLOWED_WRITES', 'CLIENT_BLOCKED_SUBPATHS']
  .map(name => find('server/index.ts', n => ts.isVariableStatement(n) && n.declarationList.declarations.some(d => d.name.getText() === name))).join('\n');
const gateSource = find('server/index.ts', n => ts.isCallExpression(n) && n.expression.getText() === 'app.use' && n.arguments[0]?.getText() === '"/api"' && n.getText().includes('CLIENT_ALLOWED_WRITES'));
evaluate(policy + '\n' + gateSource, { app: { use: (_, fn) => gate = fn }, pool: { query: async (_, params) => { scopeLookups.push(params[0]); return { rows: [{ id: 'visible-brand' }] }; } },
  require: () => ({
    isClientRequestUser: async () => { if (scopeFailure) throw new Error('Synthetic scope outage'); return true; },
    resolveCompanyScope: async () => 'client-a',
    isClientVisibleBrand: async id => id === 'visible-brand' || id === 'BrandID',
  }) });
const crmGateSource = find('server/crm.ts', n => ts.isCallExpression(n) && n.expression.getText() === 'app.use' && n.arguments[0]?.getText() === '"/api/crm"' && n.getText().includes('isClientRequestUser'));
evaluate(crmGateSource, { app: { use: (_, fn) => crmGate = fn }, isClientRequestUser: async () => {
  if (crmScopeFailure) throw new Error('Synthetic CRM scope outage');
  return true;
} });
async function requestGate(method, url) {
  let status;
  await gate({ method, originalUrl: url }, { status(n) { status = n; return this; }, json() {} }, () => status = 200);
  return status;
}
function makeHandler(method, url, staff = false) {
  let handler;
  const writes = [];
  const storage = new Proxy({}, { get: (_, name) => async (...args) => {
    if (name === 'getCrmProperty') return { id: args[0], bgpEngagement: ['London'] };
    if (name === 'getCrmDeal') return { id: args[0], status: 'AVA' };
    writes.push([name, ...args]); return {};
  }});
  evaluate(route('server/crm.ts', method, url), {
    app: { [method]: (_, ...handlers) => handler = handlers.at(-1) }, requireAuth() {},
    resolveCompanyScope: async () => staff ? null : 'client-a',
    isClientVisibleBrand: async id => id === 'visible-brand',
    isClientRequestUser: async () => !staff, ...statuses,
    pool: { query: async () => ({ rows: [{ email: 'client@example.test', is_admin: false }] }) },
    require: name => name.includes('deal-status') ? statuses : { checkCounterpartyAml: async () => ({ notReady: [], hasCounterparties: true }) },
    isPropertyInScope: async (_, id) => ['owned-property', 'shared-property'].includes(id),
    isDealInScope: async (_, id) => ['owned-deal', 'shared-deal'].includes(id), storage,
  });
  return { writes, async invoke(params = {}, body = {}, throughGuards = false, spelling) {
    let status = 200; let data;
    const originalUrl = spelling || url.replace(/:([A-Za-z]+)/g, (_, key) => params[key]);
    const req = { session: { userId: 'client-user' }, params, body, method: method.toUpperCase(), originalUrl, path: originalUrl.replace(/^\/api\/crm/i, '') };
    const res = {
      status(n) { status = n; return this; }, json(v) { data = v; },
    };
    if (throughGuards) await gate(req, res, () => crmGate(req, res, () => handler(req, res)));
    else await handler(req, res);
    return { status, data };
  }};
}
(async () => {
  // Exercise both real write gateways before the scoped handler. Testing
  // either gateway or handlers alone missed the stale CRM read-only gate.
  for (const [entities, singular] of [['properties', 'property'], ['deals', 'deal']]) {
    for (const target of [`owned-${singular}`, `shared-${singular}`, `foreign-${singular}`]) {
      const allowed = !target.startsWith('foreign-');
      const link = makeHandler('post', `/api/crm/companies/:id/${entities}`);
      assert.equal((await link.invoke({ id: 'visible-brand' }, { [`${singular}Id`]: target }, true)).status, allowed ? 200 : 403);
      assert.equal(link.writes.length, allowed ? 1 : 0);
      const unlink = makeHandler('delete', `/api/crm/companies/:id/${entities}/:${singular}Id`);
      assert.equal((await unlink.invoke({ id: 'visible-brand', [`${singular}Id`]: target }, {}, true)).status, allowed ? 200 : 403);
      assert.equal(unlink.writes.length, allowed ? 1 : 0);
    }
    for (const forbidden of [false, true]) {
      const bulk = makeHandler('post', `/api/crm/${entities}/bulk-update`);
      const result = await bulk.invoke({}, { ids: [`owned-${singular}`, `${forbidden ? 'foreign' : 'shared'}-${singular}`],
        field: entities === 'properties' ? 'assetClass' : 'dealType', value: 'Retail' }, true);
      assert.equal(result.status, forbidden ? 403 : 200);
      assert.equal(bulk.writes.length, forbidden ? 0 : 2);
    }
  }
  for (const target of ['owned-property', 'shared-property', 'foreign-property']) {
    const h = makeHandler('put', '/api/crm/properties/:id');
    const result = await h.invoke({ id: target }, { name: 'Scoped business edit' }, true, `/API/CRM/PROPERTIES/${target}/`);
    assert.equal(result.status, target === 'foreign-property' ? 403 : 200);
    assert.equal(h.writes.length, target === 'foreign-property' ? 0 : 1);
  }
  crmScopeFailure = true;
  const deniedProbe = makeHandler('put', '/api/crm/properties/:id');
  assert.equal((await deniedProbe.invoke({ id: 'owned-property' }, { name: 'Not saved' }, true)).status, 503);
  assert.equal(deniedProbe.writes.length, 0);
  crmScopeFailure = false;
  for (const [entities, singular] of [['properties', 'property'], ['deals', 'deal']]) {
    for (const target of [`owned-${singular}`, `shared-${singular}`]) {
      const h = makeHandler('post', `/api/crm/companies/:id/${entities}`);
      assert.equal((await h.invoke({ id: 'client-a' }, { [`${singular}Id`]: target })).status, 200);
      assert.equal(h.writes.length, 1, 'authorized shared links remain editable');
    }
    for (const [company, target] of [['client-a', `foreign-${singular}`], ['foreign-company', `owned-${singular}`]]) {
      const h = makeHandler('post', `/api/crm/companies/:id/${entities}`);
      assert.equal((await h.invoke({ id: company }, { [`${singular}Id`]: target })).status, 403);
      assert.equal(h.writes.length, 0);
    }
    for (const op of ['bulk-update', 'bulk-delete']) {
      const h = makeHandler('post', `/api/crm/${entities}/${op}`);
      const body = { ids: [`owned-${singular}`, `foreign-${singular}`], field: entities === 'deals' ? 'team' : 'assetClass', value: 'Retail' };
      assert.equal((await h.invoke({}, body)).status, 403);
      assert.equal(h.writes.length, 0, 'mixed batches must fail before any write');
      const good = makeHandler('post', `/api/crm/${entities}/${op}`);
      assert.equal((await good.invoke({}, { ...body, ids: [`owned-${singular}`, `shared-${singular}`] })).status, 200);
      assert.equal(good.writes.length, 2);
    }
    const unlink = makeHandler('delete', `/api/crm/companies/:id/${entities}/:${singular}Id`);
    assert.equal((await unlink.invoke({ id: 'client-a', [`${singular}Id`]: `foreign-${singular}` })).status, 403);
    assert.equal(unlink.writes.length, 0);
  }
  for (const suffix of ['bulk-delete', 'BULK-DELETE', 'bulk-delete/']) {
    const url = '/api/crm/deals/' + suffix;
    const app = express(); app.post('/api/crm/deals/bulk-delete', () => {});
    assert.ok(app.router.stack[0].match(url));
    assert.equal(await requestGate('POST', url), 403);
  }
  for (const suffix of ['bulk-update', 'BULK-UPDATE', 'bulk-update/']) {
    assert.equal(await requestGate('POST', '/api/crm/deals/' + suffix), 200);
  }
  for (const target of ['owned-property', 'shared-property']) {
    const h = makeHandler('put', '/api/crm/properties/:id');
    assert.equal((await h.invoke({ id: target }, { name: 'Client edited name', id: 'foreign-property', landlordId: 'foreign-company', proprietorKycStatus: 'APPROVED', leasingPrivacyEnabled: false })).status, 200);
    assert.equal(h.writes[0][0], 'updateCrmProperty');
    assert.deepEqual(Object.keys(h.writes[0][2]), ['name']);
    assert.equal(await requestGate('PUT', `/api/crm/properties/${target}`), 200);
  }
  for (const value of ['com', 'completed', 'INV', 'invoiced']) {
    const h = makeHandler('post', '/api/crm/deals/bulk-update');
    const result = await h.invoke({}, { ids: ['owned-deal'], field: 'status', value });
    assert.equal(result.status, 200);
    assert.equal(result.data.updated, 0);
    assert.match(result.data.failures[0].reason, /senior approval/);
    assert.equal(h.writes.length, 0);
  }
  assert.equal(await requestGate('GET', '/api/covenant/SC123456'), 200);
  assert.equal(scopeLookups.at(-1), 'SC123456', 'keep resource identifiers case-sensitive');
  assert.equal(await requestGate('GET', '/api/brand/BrandID/profile'), 200);
  scopeFailure = true;
  assert.equal(await requestGate('PUT', '/api/crm/properties/owned-property'), 503);
  scopeFailure = false;
  const company = makeHandler('delete', '/api/crm/companies/:id');
  assert.equal((await company.invoke({ id: 'foreign-company' })).status, 403);
  assert.equal(company.writes.length, 0);
  const staff = makeHandler('delete', '/api/crm/companies/:id', true);
  assert.equal((await staff.invoke({ id: 'any-company' })).status, 200);
  const privateFees = makeHandler('put', '/api/crm/deals/:id/fee-allocations');
  assert.equal((await privateFees.invoke({ id: 'owned-deal' }, { allocations: [] })).status, 403);
  console.log('PASS: authorized owned/shared edits, link checks, mixed-batch rejection, staff behavior, route spelling variants');
})().catch(error => { console.error(error); process.exitCode = 1; });
