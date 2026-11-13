const assert = require('node:assert/strict');
const express = require('express');
const { insertCrmPropertySchema, insertCrmCompanySchema } = require('../../shared/schema.ts');
const { source, route, evaluate, find, ts } = require('./source-harness.cjs');
const { routedApiPath } = require('../../shared/landsec.ts');
const { conceptStatusForSave } = require('../../shared/brand-stage.ts');
const { CLIENT_NEW_BRAND_FIELDS, BGP_ONLY_COMPANY_FIELDS, clientBrandCompanyView } = require('../../shared/tenant-categories.ts');
const { NO_ACCESS_SCOPE } = evaluate(find('server/company-scope.ts', n => ts.isVariableStatement(n) && n.getText().startsWith('export const NO_ACCESS_SCOPE')));
// What Express sets on a request inside app.use(mount, ...): the gates judge
// baseUrl + path (routedApiPath), never the text of originalUrl.
const mounted = (req, mount) => Object.assign(req, { baseUrl: req.originalUrl.slice(0, mount.length), path: req.originalUrl.slice(mount.length).split('?')[0] || '/' });
let gate;
let crmGate;
const scopeLookups = [];
let scopeFailure = false;
let crmScopeFailure = false;
const statuses = evaluate(source("shared/deal-status.ts"));
const policy = ['CLIENT_ALLOWED_API', 'CLIENT_ALLOWED_WRITES', 'CLIENT_BLOCKED_SUBPATHS']
  .map(name => find('server/index.ts', n => ts.isVariableStatement(n) && n.declarationList.declarations.some(d => d.name.getText() === name))).join('\n');
const gateSource = find('server/index.ts', n => ts.isCallExpression(n) && n.expression.getText() === 'app.use' && n.arguments[0]?.getText() === '"/api"' && n.getText().includes('CLIENT_ALLOWED_WRITES'));
evaluate(policy + '\n' + gateSource, { routedApiPath, app: { use: (_, fn) => gate = fn }, pool: { query: async (_, params) => { scopeLookups.push(params[0]); return { rows: [{ id: 'visible-brand' }] }; } },
  require: () => ({
    isClientRequestUser: async () => { if (scopeFailure) throw new Error('Synthetic scope outage'); return true; },
    resolveCompanyScope: async () => 'client-a',
    isClientVisibleBrand: async id => id === 'visible-brand' || id === 'BrandID',
    // No Landsec role row: a full client login, judged by the ordinary
    // client lists (the restricted roles' rules have their own test,
    // server/landsec-gateway.test.ts).
    restrictedLandsecApiDecision: async () => null,
  }) });
const crmGateSource = find('server/crm.ts', n => ts.isCallExpression(n) && n.expression.getText() === 'app.use' && n.arguments[0]?.getText() === '"/api/crm"' && n.getText().includes('isClientRequestUser'));
evaluate(crmGateSource, { app: { use: (_, fn) => crmGate = fn }, isClientRequestUser: async () => {
  if (crmScopeFailure) throw new Error('Synthetic CRM scope outage');
  return true;
} });
async function requestGate(method, url) {
  let status;
  await gate(mounted({ method, originalUrl: url }, '/api'), { status(n) { status = n; return this; }, json() {} }, () => status = 200);
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
    insertCrmPropertySchema,
    app: { [method]: (_, ...handlers) => handler = handlers.at(-1) }, requireAuth() {},
    resolveCompanyScope: async () => staff ? null : 'client-a',
    isClientVisibleBrand: async id => id === 'visible-brand',
    isClientRequestUser: async () => !staff, ...statuses,
    pool: { query: async () => ({ rows: [{ email: 'client@example.test', is_admin: false }] }) },
    require: name => name.includes('deal-status') ? statuses : { checkCounterpartyAml: async () => ({ notReady: [], hasCounterparties: true }), SENIOR_APPROVER_EMAILS: new Set() },
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
    if (throughGuards) await gate(mounted(req, '/api'), res, () => crmGate(mounted(req, '/api/crm'), res, () => handler(req, res)));
    else await handler(req, res);
    return { status, data };
  }};
}
// Both real write gates with nothing behind them: 200 means the request
// would reach its handler.
async function throughBothGates(method, url) {
  let status;
  const req = { method, originalUrl: url };
  const res = { status(n) { status = n; return this; }, json() {} };
  await gate(mounted(req, '/api'), res, () => crmGate(mounted(req, '/api/crm'), res, () => status = 200));
  return status;
}
// The company create as written. `scope` is what resolveCompanyScope answers
// (null for BGP staff); `hidden` is a hidden brand its name check finds.
function makeCompanyCreate(scope, hidden = null) {
  let handler;
  const inserted = [], stamped = [], nameChecks = [];
  evaluate(route('server/crm.ts', 'post', '/api/crm/companies'), {
    app: { post: (_, ...handlers) => handler = handlers.at(-1) },
    insertCrmCompanySchema, conceptStatusForSave, CLIENT_NEW_BRAND_FIELDS, clientBrandCompanyView, NO_ACCESS_SCOPE,
    resolveCompanyScope: async () => scope,
    storage: { createCrmCompany: async row => { inserted.push(JSON.parse(JSON.stringify(row))); return { id: 'new-brand', conceptStatus: null, lettingHunterNotes: null, kycStatus: null, ...row }; } },
    // Values made inside the evaluated handler belong to another realm, so
    // they are copied before they are compared.
    pool: { query: async (sql, params) => { assert.match(sql, /SET crm_extra_brand_ids/); stamped.push(JSON.parse(JSON.stringify(params))); return { rowCount: 1 }; } },
    require: name => { assert.equal(name, './brand-relevance'); return { unhideBrandByName: async brandName => { nameChecks.push(brandName); return hidden; } }; },
  });
  return { inserted, stamped, nameChecks, async send(body, throughGuards = scope !== null, spelling = '/api/crm/companies') {
    let status = 200; let data;
    const req = { session: { userId: 'client-user' }, params: {}, body, method: 'POST', originalUrl: spelling };
    const res = { status(n) { status = n; return this; }, json(v) { data = v === undefined ? v : JSON.parse(JSON.stringify(v)); } };
    if (throughGuards) await gate(mounted(req, '/api'), res, () => crmGate(mounted(req, '/api/crm'), res, () => handler(req, res)));
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

  // ── A client adds a brand: POST /api/crm/companies ────────────────────
  // The create gets through both gates, however the address is spelt. A
  // company save, a delete and every other company write stop at the CRM
  // gate (the outer gateway's "/api/crm/companies" prefix lets them that far).
  for (const spelling of ['/api/crm/companies', '/API/CRM/Companies/', '/api/crm/companies?x=1']) {
    const app = express(); app.post('/api/crm/companies', () => {});
    assert.ok(app.router.stack[0].match(spelling.split('?')[0]));
    assert.equal(await throughBothGates('POST', spelling), 200, spelling);
  }
  for (const [method, url] of [['PUT', '/api/crm/companies/visible-brand'], ['PUT', '/API/CRM/Companies/visible-brand/'], ['PUT', '/api/crm/companies/client-a'],
    ['PATCH', '/api/crm/companies/visible-brand'], ['DELETE', '/api/crm/companies/visible-brand'], ['POST', '/api/crm/companies/visible-brand'],
    ['POST', '/api/crm/companies/merge'], ['POST', '/api/crm/companies/ai-description'], ['POST', '/api/crm/companies/bulk-delete'],
    ['PUT', '/api/crm/companies'], ['DELETE', '/api/crm/companies'], ['POST', '/api/crm//companies']]) {
    assert.equal(await throughBothGates(method, url), 403, `${method} ${url}`);
  }
  // A brand picker sends a name alone: a bare "Tenant" brand, stamped into
  // the client's own extra brands, and the reply is the client cut of the row.
  const picker = makeCompanyCreate('client-a');
  const made = await picker.send({ name: 'New Noodles' });
  assert.deepEqual([made.status, made.data], [201, { id: 'new-brand', name: 'New Noodles', companyType: 'Tenant' }]);
  assert.deepEqual(picker.inserted, [{ name: 'New Noodles', companyType: 'Tenant' }]);
  assert.deepEqual([picker.stamped, picker.nameChecks], [[['new-brand', 'client-a']], ['New Noodles']]);
  assert.equal((await makeCompanyCreate('client-a').send({ name: 'New Noodles' }, true, '/API/CRM/Companies/')).status, 201);
  // What the create screens send is saved, and nothing else a request carries:
  // not a KYC status or AML record, a BGP note or flag, a BGP lead, a parent
  // or merged-into link, trading names, or the client's own list of extra brands.
  const screen = { name: 'New Cafe', companyType: 'Tenant - Café', domain: 'newcafe.example', domainUrl: 'https://newcafe.example', description: 'Coffee.', companyProfileUrl: 'https://example.test/new-cafe' };
  const form = makeCompanyCreate('client-a');
  assert.equal((await form.send(screen)).status, 201);
  assert.deepEqual(form.inserted, [screen]);
  const loaded = makeCompanyCreate('client-a');
  assert.equal((await loaded.send({ ...screen, kycStatus: 'approved', kycApprovedBy: 'the client', amlRiskLevel: 'low', amlPepStatus: 'clear', amlNotes: 'x', amlChecklist: { done: true }, amlCddForm: { done: true },
    hunterFlag: true, lettingHunterFlag: true, lettingHunterNotes: 'x', conceptStatus: 'parked', crmExtraBrandIds: ['foreign-company'], bgpContactUserIds: ['u1'], bgpContactCrm: 'x', requiresPo: true,
    parentCompanyId: 'client-a', mergedIntoId: 'visible-brand', mergedBy: 'x', archivedReason: 'x', archivedBy: 'x', isPortfolioAccount: true, aiGeneratedFields: { email_summary: 'x' }, brandAnalysis: 'x',
    lastInteraction: 'x', tradingEntities: [{ name: 'x' }], agentType: 'tenant_rep', aiDisabled: true, companiesHouseOfficers: [{ name: 'x' }], companiesHouseData: { x: 1 } })).status, 201);
  assert.deepEqual(loaded.inserted, [screen]);
  assert.deepEqual([...CLIENT_NEW_BRAND_FIELDS], ['name', 'companyType', 'domain', 'domainUrl', 'description', 'companyProfileUrl']);
  const everyColumn = Object.fromEntries(Object.keys(insertCrmCompanySchema.shape).map(column => [column, 'x']));
  assert.ok('kycStatus' in everyColumn && 'lettingHunterNotes' in everyColumn, 'the company columns were not read');
  for (const field of CLIENT_NEW_BRAND_FIELDS) {
    assert.ok(field in everyColumn, `${field} is not a column of crm_companies`);
    assert.ok(field in clientBrandCompanyView(everyColumn), `${field} is never sent to a client, so a client must not set it`);
  }
  for (const never of ['crmExtraBrandIds', 'requiresPo']) assert.equal(CLIENT_NEW_BRAND_FIELDS.includes(never), false, `${never} is not a client's to set`);
  // Never a landlord, an agent or an office company: refused before the name
  // check (which would bring a hidden brand back), the insert and the stamp.
  for (const companyType of ['Landlord', 'Agent', 'Office', 'Investor', 'Billing Entity', 'Tenantish', ' landlord ']) {
    const refused = makeCompanyCreate('client-a');
    const res = await refused.send({ name: 'Not A Brand', companyType });
    assert.deepEqual([res.status, res.data], [403, { error: 'Client accounts can only create tenant brands' }], companyType);
    assert.deepEqual([refused.inserted, refused.stamped, refused.nameChecks], [[], [], []], companyType);
  }
  // A hidden brand of the same name comes back in place of a second record,
  // and it is sent to the client cut as a read of it would be: none of BGP's
  // notes, compliance record or lead on the old record.
  const HIDDEN = { id: 'hidden-brand', name: 'Old Dumplings', companyType: 'Tenant - Restaurant', description: 'Dumplings.', lettingHunterNotes: 'BGP note', distressNotes: 'BGP note', hunterFlag: true,
    amlNotes: 'BGP note', amlRiskLevel: 'high', kycStatus: 'rejected', kycApprovedBy: 'MLRO', companiesHouseOfficers: [{ name: 'x' }], companiesHouseData: { x: 1 }, bgpContactCrm: 'BGP lead',
    bgpContactUserIds: ['u1'], aiGeneratedFields: { email_summary: 'BGP mail' }, brandAnalysis: 'BGP take', lastInteraction: '2026-11-01', conceptStatus: 'parked' };
  const back = makeCompanyCreate('client-a', HIDDEN);
  const returned = await back.send({ name: 'old dumplings', kycStatus: 'approved' });
  assert.deepEqual([returned.status, returned.data], [200, { id: 'hidden-brand', name: 'Old Dumplings', companyType: 'Tenant - Restaurant', description: 'Dumplings.', unhidden: true }]);
  for (const field of [...BGP_ONLY_COMPANY_FIELDS, 'kycStatus', 'companiesHouseOfficers', 'companiesHouseData', 'bgpContactCrm', 'bgpContactUserIds']) assert.equal(field in returned.data, false, `${field} went to a client on a brand it brought back`);
  assert.deepEqual([back.inserted, back.stamped], [[], [['hidden-brand', 'client-a']]]);
  // A client login BGP has not tied to a company makes nothing, brings
  // nothing back and is stamped nowhere.
  const unlinked = makeCompanyCreate(NO_ACCESS_SCOPE, HIDDEN);
  const unlinkedReply = await unlinked.send({ name: 'Old Dumplings' });
  assert.equal(unlinkedReply.status, 403);
  assert.match(unlinkedReply.data.error, /not linked to a client company/);
  assert.deepEqual([unlinked.inserted, unlinked.stamped, unlinked.nameChecks], [[], [], []]);
  // BGP staff are unchanged: any company type, BGP's own columns, the whole
  // row back, and no client's list is stamped.
  const staffCreate = makeCompanyCreate(null);
  const staffRow = { name: 'New Landlord', companyType: 'Landlord', lettingHunterNotes: 'ours', kycStatus: 'pending', conceptStatus: 'parked' };
  const staffMade = await staffCreate.send(staffRow);
  assert.deepEqual([staffMade.status, staffMade.data], [201, { id: 'new-brand', ...staffRow }]);
  assert.deepEqual([staffCreate.inserted, staffCreate.stamped], [[staffRow], []]);

  console.log('PASS: authorized owned/shared edits, link checks, mixed-batch rejection, staff behavior, route spelling variants, a client adding a brand');
})().catch(error => { console.error(error); process.exitCode = 1; });
