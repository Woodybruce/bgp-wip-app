// Leasing requirements are open to client logins (Woody, 2026-11-17: "keep
// all requirements open for clients and access to amend and add"). A client
// login reads every requirement, adds one and amends any, and never deletes
// one. What it adds is the client's (origin 'client'): never confirmed, with
// no BGP owner, so it reads To confirm for BGP until a named BGP person
// confirms it. A Landsec joint agent, another agency with no Brands, is
// refused all of it. The centre's tools stay BGP staff's.
// These run the real routes of server/crm.ts behind the real client gateway
// (server/index.ts) and the real CRM write guard, with a fake database.
//   node --import tsx --test qa/regression/client-requirement-access.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import * as live from '../../shared/requirement-live.ts';
import { insertCrmRequirementsLeasingSchema } from '../../shared/schema.ts';
import { routedApiPath, jointAgentApiDenied, restrictedLandsecApiRule } from '../../shared/landsec.ts';
const require = createRequire(import.meta.url);
const { route, evaluate, find, ts, source } = require('./source-harness.cjs');

const { NO_ACCESS_SCOPE } = evaluate(find('server/company-scope.ts', n => ts.isVariableStatement(n) && n.getText().startsWith('export const NO_ACCESS_SCOPE')));
const TODAY = new Date();
const daysAgo = n => new Date(TODAY.getTime() - n * 86400000);
const plain = v => JSON.parse(JSON.stringify(v));

// Who is asking: BGP staff (no scope), a client login, a joint agent.
let viewer;
const STAFF = { client: false, scope: null, jointAgent: false };
const CLIENT = { client: true, scope: 'landsec', jointAgent: false };
const JOINT_AGENT = { client: true, scope: 'landsec', jointAgent: true };
const UNLINKED = { client: true, scope: NO_ACCESS_SCOPE, jointAgent: false };

// ── The two write gates, as written ─────────────────────────────────────
const mounted = (req, mount) => Object.assign(req, { baseUrl: req.originalUrl.slice(0, mount.length), path: req.originalUrl.slice(mount.length).split('?')[0] || '/' });
let gate, crmGate;
const policy = ['CLIENT_ALLOWED_API', 'CLIENT_ALLOWED_WRITES', 'CLIENT_BLOCKED_SUBPATHS']
  .map(name => find('server/index.ts', n => ts.isVariableStatement(n) && n.declarationList.declarations.some(d => d.name.getText() === name))).join('\n');
const gateSource = find('server/index.ts', n => ts.isCallExpression(n) && n.expression.getText() === 'app.use' && n.arguments[0]?.getText() === '"/api"' && n.getText().includes('CLIENT_ALLOWED_WRITES'));
evaluate(policy + '\n' + gateSource, { routedApiPath, app: { use: (_, fn) => { gate = fn; } }, pool: { query: async () => ({ rows: [] }) },
  require: () => ({
    isClientRequestUser: async () => viewer.client,
    resolveCompanyScope: async () => viewer.scope,
    isClientVisibleBrand: async () => true, isClientReadableCompanyPage: async () => true,
    // restrictedLandsecApiDecision as server/landsec-access.ts answers it for a joint agent.
    restrictedLandsecApiDecision: async (req, path) => !viewer.jointAgent ? null
      : restrictedLandsecApiRule('joint_agent', req.method, path) === 'allow' ? 'allow' : jointAgentApiDenied(req.method, path) ? 'deny' : null,
  }) });
const crmGateSource = find('server/crm.ts', n => ts.isCallExpression(n) && n.expression.getText() === 'app.use' && n.arguments[0]?.getText() === '"/api/crm"' && n.getText().includes('isClientRequestUser'));
evaluate(crmGateSource, { app: { use: (_, fn) => { crmGate = fn; } }, isClientRequestUser: async () => viewer.client });

// 200 means the request would reach its handler.
async function throughGates(method, url) {
  let status;
  const req = { method, originalUrl: url };
  const res = { status(n) { status = n; return this; }, json() {} };
  await gate(mounted(req, '/api'), res, async () => {
    if (!url.toLowerCase().startsWith('/api/crm')) { status = 200; return; }
    await crmGate(mounted({ method, originalUrl: url }, '/api/crm'), res, () => { status = 200; });
  });
  return status;
}

// ── The routes, as written, on a fake database ──────────────────────────
const CRM = 'server/crm.ts';
const clientWriteDoor = find(CRM, n => ts.isFunctionDeclaration(n) && n.name?.text === 'clientRequirementWrite');
const COMPANY_TYPES = { 'brand-1': 'Tenant - Restaurant', 'brand-2': 'Tenant - Café', 'landsec': 'Landlord', 'agency': 'Agent' };
const CONTACTS = { 'brand-person': 'brand-1', 'other-brand-person': 'brand-2', 'agency-person': 'agency', 'rival-person': 'rival-landlord' };

function bgpOwn() {
  return { id: 'r-bgp', name: 'Pret', companyId: 'brand-1', status: 'Active', origin: 'bgp', sources: ['Manual'], use: ['Restaurant'], size: ['1,500 sq ft'],
    requirementLocations: ['Leeds'], comments: 'BGP comment', requirementDate: '2026-11-01', bgpContactUserId: 'u-emily', bgpContactUserIds: ['u-emily'],
    lastConfirmedAt: daysAgo(3), lastConfirmedBy: 'u-emily', lastConfirmedByName: 'Emily Hart', confirmedHow: 'call', createdAt: daysAgo(20), updatedAt: daysAgo(3) };
}

function requirementRoutes() {
  const rows = new Map([['r-bgp', bgpOwn()]]);
  const writes = [];
  const storage = {
    getCrmRequirementsLeasing: async () => [...rows.values()],
    getCrmRequirementLeasing: async id => rows.get(id),
    createCrmRequirementLeasing: async r => { const row = { id: 'r-new', ...r, origin: r.origin ?? 'bgp', createdAt: TODAY, updatedAt: TODAY }; rows.set(row.id, row); writes.push(['create', plain(row)]); return row; },
    updateCrmRequirementLeasing: async (id, u) => {
      const clean = live.stripRequirementProvenance(u);
      writes.push(['update', id, plain(clean)]);
      const row = { ...rows.get(id), ...clean, updatedAt: TODAY }; rows.set(id, row); return row;
    },
    deleteCrmRequirementLeasing: async id => { writes.push(['delete', id]); rows.delete(id); },
    linkCompanyDeal: async () => {},
  };
  const pool = { query: async (sql, params = []) => {
    if (/FROM users WHERE id = \$1/.test(sql)) return { rows: [{ id: params[0], name: viewer.scope ? 'Lana Client' : 'Emily Hart' }] };
    if (/SELECT company_type FROM crm_companies WHERE id = \$1/.test(sql)) return { rows: COMPANY_TYPES[params[0]] ? [{ company_type: COMPANY_TYPES[params[0]] }] : [] };
    if (/SELECT company_id FROM crm_contacts WHERE id = \$1/.test(sql)) return { rows: CONTACTS[params[0]] ? [{ company_id: CONTACTS[params[0]] }] : [] };
    if (/FROM crm_contacts ct JOIN crm_companies co/.test(sql)) {
      assert.match(sql, /co\.id = \$2 OR co\.company_type ILIKE 'Agent%'/);
      const company = CONTACTS[params[0]];
      return { rows: company && (company === params[1] || COMPANY_TYPES[company] === 'Agent' || /^Tenant/.test(COMPANY_TYPES[company] || '')) ? [{ ok: 1 }] : [] };
    }
    throw new Error(`unexpected query: ${sql.slice(0, 80)}`);
  } };
  const handlers = {};
  const app = Object.fromEntries(['get', 'post', 'put', 'delete'].map(m => [m, (url, ...chain) => { handlers[`${m} ${url}`] = chain.at(-1); }]));
  const bindings = {
    app, requireAuth() {}, storage, pool, NO_ACCESS_SCOPE, insertCrmReqLeasingSchema: insertCrmRequirementsLeasingSchema,
    resolveCompanyScope: async () => viewer.scope,
    isClientVisibleBrand: async (id, scope) => scope !== NO_ACCESS_SCOPE && /^Tenant/.test(COMPANY_TYPES[id] || ''),
    isDealInScope: async (_scope, id) => id === 'own-deal',
    clientBrandSliceSql: async () => "(company_type ILIKE 'Tenant%')",
    getScopeCompanyName: async id => (id === 'landsec' ? 'Landsec' : null),
    requirementViewer: async () => (!viewer.scope ? 'staff' : viewer.jointAgent ? 'joint_agent' : 'client'),
    ensureAgentTyped: async () => { writes.push(['agent-typed']); },
    ...live,
  };
  const urls = [['get', '/api/crm/requirements-leasing'], ['get', '/api/crm/requirements-leasing/:id'], ['post', '/api/crm/requirements-leasing'],
    ['put', '/api/crm/requirements-leasing/:id'], ['delete', '/api/crm/requirements-leasing/:id']];
  evaluate(`${clientWriteDoor}\n${urls.map(([m, u]) => route(CRM, m, u)).join('\n')}`, bindings);
  const call = async (key, { params = {}, body = {} } = {}) => {
    let status = 200, data;
    const res = { status(n) { status = n; return this; }, json(v) { data = v === undefined ? v : plain(v); } };
    await handlers[key]({ session: { userId: viewer.scope ? 'u-client' : 'u-emily' }, params, body, query: {} }, res);
    return { status, data };
  };
  return { rows, writes, call };
}

const FORM = { name: 'Wingstop', companyId: 'brand-1', groupName: 'Hospitality', status: 'Active', principalContactId: 'brand-person', agentContactId: 'agency-person',
  dealId: null, use: ['Restaurant'], requirementType: ['Standalone'], size: ['2,000 - 3,000 sq ft'], requirementLocations: ['Bluewater'], locationData: null, comments: 'Heard at the leasing meeting' };
// What a request body may carry that a client never sets.
const SMUGGLED = { origin: 'bgp', sources: ['PIPnet'], lastConfirmedAt: new Date().toISOString(), lastConfirmedBy: 'u-client', lastConfirmedByName: 'Lana Client', confirmedHow: 'call',
  last_confirmed_at: new Date().toISOString(), externalRequirementId: 'x1', lastListedAt: new Date().toISOString(), lastListedSource: 'PIPnet',
  bgpContactUserId: 'u-emily', bgpContactUserIds: ['u-emily'], requirementDate: '2020-01-01', landlordPack: '{"url":"/x"}', underOffer: true, extract: 'x' };

// ── The live rule ───────────────────────────────────────────────────────

test('the client rule is retired at its source: every row is a client\'s to see, and a joint agent keeps the PIPnet rule', () => {
  for (const row of [bgpOwn(), { sources: ['ChatBGP'] }, { sources: ['PIPnet'] }, {}]) assert.equal(live.requirementClientVisible(row), true);
  assert.equal(live.requirementClientVisibleSql('r'), 'TRUE');
  assert.equal(live.requirementJointAgentVisible({ sources: ['PIPnet'] }), true);
  assert.equal(live.requirementJointAgentVisible({ sources: ['Manual'] }), false);
  assert.equal(live.requirementJointAgentVisibleSql('r'), "'PIPnet' = ANY(coalesce(r.sources, '{}'::text[]))");
});

test('a client is told what a requirement is and its own date, never its state, a confirmation or who', () => {
  const own = live.requirementReason({ ...bgpOwn(), lastConfirmedAt: daysAgo(3) }, TODAY);
  assert.equal(own.state, 'live');
  assert.match(own.text, /^requirement confirmed /, 'BGP staff read the confirmation');
  assert.match(own.clientText, /^requirement dated 1 Nov/);
  const listing = live.requirementReason({ status: 'Active', origin: 'pipnet', sources: ['PIPnet'], lastListedAt: new Date('2026-09-03T00:00:00Z') }, new Date('2026-11-17T12:00:00Z'));
  assert.deepEqual([listing.clientText, listing.listingText], ['PIPnet listing from Sep', 'PIPnet listing from Sep']);
  const trl = live.requirementReason({ status: 'Active', origin: 'trl', sources: ['TRL'] }, TODAY);
  assert.deepEqual([trl.clientText, trl.listingText], ['The Requirement List listing', null]);
  for (const r of [own, listing, trl, live.requirementReason({ status: 'Draft', origin: 'bgp', createdAt: daysAgo(2) }, TODAY)]) {
    assert.doesNotMatch(r.clientText, /confirm|live|emily|draft/i, r.clientText);
  }
  assert.equal(own.listingText, null, 'a joint agent is told nothing of BGP\'s own requirement');
});

// Woody, 20 November 2026: "Clients should be able to do what we can do
// really". A client's add is confirmed by the person who added it, as BGP's
// own are; with no creator the stamp still confirms nothing.
test('a client\'s requirement is the client\'s with no BGP owner, confirmed by the person who added it', () => {
  const at = new Date('2026-11-20T12:00:00Z');
  const added = live.clientCreatedStamp('Landsec', { id: 'u-client', name: 'Lana Client' }, at);
  assert.deepEqual(plain(added), { origin: 'client', sources: ['Landsec'], lastConfirmedAt: at.toISOString(), lastConfirmedBy: 'u-client', lastConfirmedByName: 'Lana Client', confirmedHow: 'created', bgpContactUserId: null, bgpContactUserIds: null });
  const confirmedState = live.requirementLive({ status: 'Active', createdAt: at, ...added }, at);
  assert.deepEqual([confirmedState.state, confirmedState.confirmed, confirmedState.clientMade], ['live', true, true]);
  const stamp = live.clientCreatedStamp('Landsec');
  assert.deepEqual(plain(stamp), { origin: 'client', sources: ['Landsec'], lastConfirmedAt: null, lastConfirmedBy: null, lastConfirmedByName: null, confirmedHow: null, bgpContactUserId: null, bgpContactUserIds: null });
  const row = { status: 'Active', requirementDate: TODAY.toISOString().slice(0, 10), createdAt: TODAY, ...stamp };
  const state = live.requirementLive(row, TODAY);
  assert.deepEqual([state.state, state.confirmed, state.clientMade, state.importOnly], ['to_confirm', false, true, false]);
  assert.match(state.why, /client login/);
  assert.equal(live.requirementListKey(state), 'to_confirm');
  assert.deepEqual(live.requirementSourceLabels(row), ['Client', 'Landsec']);
  assert.match(live.requirementReason(row, TODAY).text, /^client requirement dated .*, not confirmed$/);
  // A year on, unconfirmed, it is an older row, never a market listing.
  const old = live.requirementLive({ ...row, requirementDate: '2025-01-01', createdAt: new Date('2025-01-01') }, TODAY);
  assert.deepEqual([old.state, live.requirementListKey(old)], ['background', 'older']);
  // A BGP person confirming it makes it live, as any other.
  assert.equal(live.requirementLive({ ...row, lastConfirmedAt: TODAY, lastConfirmedBy: 'u-emily', lastConfirmedByName: 'Emily Hart' }, TODAY).state, 'live');
});

test('an import never labels, links or fills a client\'s requirement', () => {
  const clientRow = { id: 'c1', name: 'Wingstop', status: 'Active', origin: 'client', sources: ['Landsec'], externalRequirementId: null };
  assert.equal(live.importMayLabel(clientRow, 'PIPnet'), false);
  assert.equal(live.importMayLabel(clientRow, 'TRL'), false);
  assert.equal(live.importMayLabel({ origin: 'bgp' }, 'PIPnet'), false);
  assert.equal(live.importMayLabel({ origin: 'pipnet' }, 'TRL'), true);
  // The same brand's only open row is the client's: the import makes its own.
  assert.equal(live.listingTarget([clientRow], 'ext-1', r => r.name === 'Wingstop'), null);
  const open = { id: 'p1', name: 'Wingstop', status: 'Active', origin: 'pipnet', externalRequirementId: null };
  assert.equal(live.listingTarget([clientRow, open], 'ext-1', r => r.name === 'Wingstop'), open);
  // Defence in depth: a client's row carrying the link is still not the target, and is not "closed" either.
  assert.equal(live.listingTarget([{ ...clientRow, externalRequirementId: 'ext-1' }], 'ext-1', () => false), null);
});

test('a client writes the form\'s fields and nothing else', () => {
  assert.deepEqual([...live.CLIENT_REQUIREMENT_FIELDS], ['name', 'companyId', 'groupName', 'status', 'principalContactId', 'agentContactId', 'dealId',
    'use', 'requirementType', 'size', 'requirementLocations', 'locationData', 'comments']);
  assert.deepEqual(live.clientRequirementFields({ ...FORM, ...SMUGGLED }), FORM);
  for (const never of [...live.REQUIREMENT_PROVENANCE_FIELDS, 'bgpContactUserId', 'bgpContactUserIds', 'sources', 'requirementDate', 'landlordPack', 'underOffer']) {
    assert.equal((live.CLIENT_REQUIREMENT_FIELDS).includes(never), false, never);
  }
});

// ── The gates ───────────────────────────────────────────────────────────

test('both gates let a client add and amend a requirement, and nothing else under the path', async () => {
  viewer = CLIENT;
  for (const [method, url] of [['POST', '/api/crm/requirements-leasing'], ['POST', '/API/CRM/Requirements-Leasing/'], ['PUT', '/api/crm/requirements-leasing/r-bgp'],
    ['PUT', '/api/crm/requirements-leasing/r-bgp/'], ['GET', '/api/crm/requirements-leasing'], ['GET', '/api/crm/requirements-leasing/r-bgp']]) {
    assert.equal(await throughGates(method, url), 200, `${method} ${url}`);
  }
  for (const [method, url] of [['DELETE', '/api/crm/requirements-leasing/r-bgp'], ['PATCH', '/api/crm/requirements-leasing/r-bgp'],
    ['POST', '/api/crm/requirements-leasing/r-bgp/landlord-pack'], ['DELETE', '/api/crm/requirements-leasing/r-bgp/landlord-pack'],
    ['POST', '/api/crm/requirements-leasing/agent-audit'], ['PUT', '/api/crm/requirements-leasing'], ['POST', '/api/crm/requirements-investment'],
    ['POST', '/api/crm/contacts/c1/requirements']]) {
    assert.equal(await throughGates(method, url), 403, `${method} ${url}`);
  }
});

test('the centre\'s routes stay BGP staff\'s: a client login is refused them at the gateway', async () => {
  viewer = CLIENT;
  for (const [method, url] of [['GET', '/api/requirement-suggestions'], ['POST', '/api/requirement-suggestions/s1/confirm'],
    ['POST', '/api/requirement-centre/requirements/r-bgp/still-live'], ['GET', '/api/requirement-centre/requirements/r-bgp/evidence'],
    ['PUT', '/api/requirement-centre/requirements/r-bgp/owner'], ['GET', '/api/requirement-centre/expanding'], ['GET', '/api/admin/requirements-health']]) {
    assert.equal(await throughGates(method, url), 403, `${method} ${url}`);
  }
  // Nor does any allowlist name them.
  const index = source('server/index.ts');
  const lists = index.slice(index.indexOf('const CLIENT_ALLOWED_API = ['), index.indexOf('const CLIENT_BLOCKED_SUBPATHS = ['));
  assert.doesNotMatch(lists, /requirement-(suggestions|centre)/);
});

test('a joint agent is refused the requirements at the gateway, to read or to write', async () => {
  viewer = JOINT_AGENT;
  for (const [method, url] of [['GET', '/api/crm/requirements-leasing'], ['GET', '/api/crm/requirements-leasing/r-bgp'], ['POST', '/api/crm/requirements-leasing'],
    ['PUT', '/api/crm/requirements-leasing/r-bgp'], ['DELETE', '/api/crm/requirements-leasing/r-bgp'], ['GET', '/api/crm/requirements-leasing/matches'],
    ['GET', '/api/available-units/matches/u1'], ['GET', '/api/available-units/u1/brand-suggestions'], ['GET', '/api/requirements/matches/r-bgp'],
    ['GET', '/api/client/agent-directory'], ['GET', '/api/client/agents-overview']]) {
    assert.equal(await throughGates(method, url), 403, `${method} ${url}`);
  }
});

// ── The routes ──────────────────────────────────────────────────────────

test('a client reads every requirement, BGP\'s own included, as the client copy', async () => {
  viewer = CLIENT;
  const r = requirementRoutes();
  const list = await r.call('get /api/crm/requirements-leasing');
  assert.equal(list.status, 200);
  assert.deepEqual(list.data.map(x => x.id), ['r-bgp']);
  for (const key of ['lastConfirmedAt', 'lastConfirmedBy', 'lastConfirmedByName', 'confirmedHow', 'origin', 'bgpContactUserId', 'bgpContactUserIds', 'updatedAt']) {
    assert.equal(key in list.data[0], false, `${key} is sent to a client`);
  }
  assert.equal(list.data[0].comments, 'BGP comment');
  const one = await r.call('get /api/crm/requirements-leasing/:id', { params: { id: 'r-bgp' } });
  assert.deepEqual([one.status, one.data.id, 'lastConfirmedBy' in one.data], [200, 'r-bgp', false]);
  // A login tied to no company sees none; staff see the whole row.
  viewer = UNLINKED;
  assert.deepEqual((await r.call('get /api/crm/requirements-leasing')).data, []);
  assert.equal((await r.call('get /api/crm/requirements-leasing/:id', { params: { id: 'r-bgp' } })).status, 404);
  viewer = STAFF;
  assert.equal((await r.call('get /api/crm/requirements-leasing')).data[0].lastConfirmedBy, 'u-emily');
});

test('a client\'s add is the client\'s: labelled with its name, confirmed by the person who added it, with no owner or provenance from the body', async () => {
  viewer = CLIENT;
  const r = requirementRoutes();
  const made = await r.call('post /api/crm/requirements-leasing', { body: { ...FORM, ...SMUGGLED } });
  assert.equal(made.status, 201, JSON.stringify(made.data));
  const [kind, stored] = r.writes.find(w => w[0] === 'create');
  assert.equal(kind, 'create');
  // Confirmed by the signed-in person at creation ('created'), never by what the body says ('call').
  assert.deepEqual([stored.origin, stored.sources, stored.lastConfirmedBy, stored.lastConfirmedByName, stored.confirmedHow],
    ['client', ['Landsec'], 'u-client', 'Lana Client', 'created']);
  // The fake storage keeps plain values, so read the date by value.
  const confirmedAt = new Date(stored.lastConfirmedAt).getTime();
  assert.ok(Number.isFinite(confirmedAt) && Math.abs(confirmedAt - Date.now()) < 60_000, 'confirmed now, not at the body\'s time');
  assert.deepEqual([stored.bgpContactUserId, stored.bgpContactUserIds], [null, null]);
  for (const key of ['externalRequirementId', 'lastListedAt', 'lastListedSource', 'landlordPack', 'underOffer', 'extract']) assert.ok(!stored[key], `${key} was taken from the body`);
  assert.equal(stored.requirementDate, TODAY.toISOString().slice(0, 10), 'dated today, whatever the body says');
  assert.equal(stored.comments, 'Heard at the leasing meeting');
  assert.equal(live.requirementLive(stored, new Date()).state, 'live');
  // The reply is the client copy, and no agent was retyped by a client's write.
  for (const key of ['origin', 'bgpContactUserIds', 'lastConfirmedAt', 'updatedAt']) assert.equal(key in made.data, false, `${key} in the reply`);
  assert.equal(r.writes.some(w => w[0] === 'agent-typed'), false);
});

test('a client\'s add names a tenant brand it may see, and contacts and a deal it may choose', async () => {
  viewer = CLIENT;
  const refused = async (body, status, pattern) => {
    const r = requirementRoutes();
    const res = await r.call('post /api/crm/requirements-leasing', { body });
    assert.equal(res.status, status, JSON.stringify(body));
    assert.match(res.data.error, pattern);
    assert.equal(r.writes.length, 0, 'nothing written');
  };
  await refused({ ...FORM, companyId: null }, 403, /brand list/);
  await refused({ ...FORM, companyId: 'landsec' }, 403, /brand list/);
  await refused({ ...FORM, companyId: 'agency' }, 403, /brand list/);
  await refused({ ...FORM, companyId: 'unknown' }, 403, /brand list/);
  await refused({ ...FORM, name: '  ' }, 400, /name/);
  await refused({ ...FORM, status: 'Draft' }, 400, /Status/);
  await refused({ ...FORM, principalContactId: 'other-brand-person' }, 403, /contact at this brand/);
  await refused({ ...FORM, agentContactId: 'rival-person' }, 403, /agent/);
  await refused({ ...FORM, dealId: 'someone-elses-deal' }, 403, /own transactions/);
  const ok = requirementRoutes();
  assert.equal((await ok.call('post /api/crm/requirements-leasing', { body: { ...FORM, dealId: 'own-deal' } })).status, 201);
  viewer = UNLINKED;
  await refused(FORM, 403, /not linked to a client company/);
  viewer = JOINT_AGENT;
  await refused(FORM, 403, /Not available/);
});

test('a client amends any requirement through its own fields; the confirmation and the owner stay BGP\'s', async () => {
  viewer = CLIENT;
  const r = requirementRoutes();
  const saved = await r.call('put /api/crm/requirements-leasing/:id', { params: { id: 'r-bgp' }, body: { ...bgpOwn(), size: ['3,000 sq ft'], comments: 'Landsec heard they want more', ...SMUGGLED } });
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  const [, id, patch] = r.writes.find(w => w[0] === 'update');
  assert.equal(id, 'r-bgp');
  assert.deepEqual(Object.keys(patch).sort(), [...live.CLIENT_REQUIREMENT_FIELDS].filter(f => f in bgpOwn()).sort());
  assert.deepEqual([patch.size, patch.comments], [['3,000 sq ft'], 'Landsec heard they want more']);
  const row = r.rows.get('r-bgp');
  // An edit is not a confirmation, and whose record it is does not change.
  assert.deepEqual([row.origin, row.lastConfirmedBy, row.bgpContactUserIds, row.sources], ['bgp', 'u-emily', ['u-emily'], ['Manual']]);
  assert.equal(live.requirementLive(row, TODAY).state, 'live');
  assert.equal('lastConfirmedBy' in saved.data, false, 'the reply is the client copy');
  // Its brand can be changed only to one it may see; links it did not change are not checked.
  const moved = await r.call('put /api/crm/requirements-leasing/:id', { params: { id: 'r-bgp' }, body: { companyId: 'landsec', name: 'Landsec' } });
  assert.equal(moved.status, 403);
  assert.equal((await r.call('put /api/crm/requirements-leasing/:id', { params: { id: 'missing' }, body: { comments: 'x' } })).status, 404);
  viewer = JOINT_AGENT;
  assert.equal((await r.call('put /api/crm/requirements-leasing/:id', { params: { id: 'r-bgp' }, body: { comments: 'x' } })).status, 403);
});

test('only BGP staff delete a requirement', async () => {
  for (const who of [CLIENT, JOINT_AGENT, UNLINKED]) {
    viewer = who;
    const r = requirementRoutes();
    assert.equal((await r.call('delete /api/crm/requirements-leasing/:id', { params: { id: 'r-bgp' } })).status, 403);
    assert.equal(r.rows.has('r-bgp'), true);
  }
  viewer = STAFF;
  const r = requirementRoutes();
  assert.equal((await r.call('delete /api/crm/requirements-leasing/:id', { params: { id: 'r-bgp' } })).status, 200);
  assert.equal(r.rows.has('r-bgp'), false);
});

test('BGP staff still add BGP\'s own requirement, confirmed by the person who made it', async () => {
  viewer = STAFF;
  const r = requirementRoutes();
  const made = await r.call('post /api/crm/requirements-leasing', { body: { ...FORM, bgpContactUserIds: ['u-emily'], origin: 'client' } });
  assert.equal(made.status, 201);
  const stored = r.writes.find(w => w[0] === 'create')[1];
  assert.deepEqual([stored.origin, stored.lastConfirmedBy, stored.confirmedHow, stored.bgpContactUserIds], ['bgp', 'u-emily', 'created', ['u-emily']]);
  assert.equal(live.requirementLive(stored, TODAY).state, 'live');
});

test('the Requirements page offers a client Add and Edit on the client form, and never Delete or the centre\'s tools', () => {
  const page = source('client/src/pages/requirements.tsx');
  const table = find('client/src/pages/requirements.tsx', n => ts.isFunctionDeclaration(n) && n.name?.text === 'LeasingTable');
  // Add requirement for every login; the form waits for the login and is the client form for a client shape.
  assert.match(table, /<Button size="sm" onClick=\{\(\) => setCreateOpen\(true\)\} data-testid="button-create-leasing">/);
  assert.ok(!/\{!isClientView && \(\s*<Button size="sm" onClick=\{\(\) => setCreateOpen\(true\)\}/.test(table));
  assert.match(table, /\{createOpen && !!reqUser && \(/);
  assert.equal([...table.matchAll(/clientForm=\{clientShape\}/g)].length, 2, 'the add and the edit form');
  assert.equal([...table.matchAll(/companies=\{formCompanies\}/g)].length, 2);
  assert.match(table, /c\.id !== reqUser\?\.companyScopeId && \/\^tenant\/i\.test/);
  // Edit in the requirement panel for every login once it is known (since
  // 19 November 2026 the board's rows open the panel); Delete stays behind
  // the staff shape.
  assert.match(table, /canEdit=\{!!reqUser && !!panelItem\}/);
  assert.match(table, /canDelete=\{!clientShape && !!panelItem\}/);
  assert.match(table, /onEdit=\{\(\) => \{ if \(panelItem\) setEditItem\(panelItem\); \}\}/);
  const panel = source('client/src/components/requirements-board/requirement-panel.tsx');
  assert.match(panel, /\{canEdit && <Button[^\n]*onClick=\{onEdit\}[^\n]*data-testid="requirement-panel-edit"/);
  assert.match(panel, /\{canDelete && <DropdownMenuItem onClick=\{onDelete\}/);
  // The client form sends no owner and picks a brand.
  const form = find('client/src/pages/requirements.tsx', n => ts.isFunctionDeclaration(n) && n.name?.text === 'LeasingFormDialog');
  assert.match(form, /\.\.\.\(clientForm \? \{\} : \{\s*bgpContactUserIds:/);
  assert.match(form, /\{!clientForm && \(\s*<div className="space-y-2">\s*<Label>BGP owner<\/Label>/);
  assert.match(form, /\{!form\.companyId && !clientForm && \(/);
  // The centre's tools stay behind canUseCentre, which a client shape never has.
  assert.match(page, /const canUseCentre = !!reqUser && !clientShape && /);
});
