import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const require = createRequire(import.meta.url);
const { find, source, evaluate, ts } = require('./source-harness.cjs');
const serverFile = 'server/property-asset-brief.ts';
const uiFile = 'client/src/components/property-asset-brief.tsx';
const detailFile = 'client/src/components/property-detail.tsx';
const fn = (file, name) => find(file, node => ts.isFunctionDeclaration(node) && node.name?.text === name);
const route = (method, path) => find(serverFile, node => ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
  && node.expression.expression.getText() === 'router' && node.expression.name.text === method && node.arguments[0]?.text === path) + ';';
const helpers = evaluate(['briefOccupancy', 'summariseBriefSchedule', 'stageBucket', 'stageLabel', 'buildActivitySummary'].map(name => fn(serverFile, name)).join('\n')
  + '\nexport { stageBucket, stageLabel, buildActivitySummary };');
const row = (patch = {}) => ({ id: 'unit', unit_name: '1', tenant_name: 'Recorded Tenant', status: 'Occupied', lease_expiry: '2040-01-01', rent_pa: 10000,
  schedule_source: 'tenancy', has_live_deal: true, ...patch });
const scope = { resolveCompanyScope: async () => null, isPropertyInScope: async () => true, isClientRequestUser: async () => false };
const response = () => ({ code: 200, body: null, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });

function briefHandler({ schedule = [row()], fail = null, client = false, inScope = true, deals = [] } = {}) {
  let handler; const queries = [];
  evaluate(route('get', '/api/properties/:id/asset-brief'), {
    ...helpers, console: { error() {} }, requireAuth() {}, router: { get: (_path, _auth, fn) => { handler = fn; } },
    require: name => { assert.equal(name, './company-scope'); return { ...scope, resolveCompanyScope: async () => client ? 'client-scope' : null, isPropertyInScope: async () => inScope }; },
    pool: { query: async (sql, values) => {
      queries.push({ sql, values });
      assert.doesNotMatch(sql, /\b(?:UPDATE|INSERT|DELETE)\b/, 'GET must not rewrite user data or cached commentary');
      let kind, rows;
      if (sql.includes('SELECT id, name, address, postcode')) { kind = 'property'; rows = [{ id: 'property', name: 'Mixed building', notes: 'Human asset lead instructions', weekly_focus: [], bgp_contact_user_ids: [], updated_at: '2026-09-16' }]; }
      else if (sql.includes('WITH schedule_source')) { kind = 'schedule'; rows = schedule; }
      else if (sql.includes('SELECT bgp_commentary')) { kind = 'commentary'; rows = [{ bgp_commentary: 'Saved commentary must survive', bgp_commentary_at: '2026-08-01' }]; }
      else if (sql.includes('FROM crm_deals d')) { kind = 'deals'; rows = deals; }
      else if (sql.includes('FROM available_units au')) { kind = 'lettings'; rows = []; }
      else if (sql.includes('FROM crm_interactions')) { kind = 'activity'; rows = []; }
      else if (sql.includes('mat_psqft')) { kind = 'trading'; rows = []; }
      else throw new Error(`Unexpected SQL in route: ${sql}`);
      if (kind === fail) throw new Error(`Synthetic ${kind} database failure`);
      return { rows };
    } },
  });
  return { queries, async run() { const res = response(); await handler({ params: { id: 'property' } }, res); return res; } };
}

test('missing and failed schedules are distinct states, neither is zero vacancy or healthy risk coverage', async () => {
  for (const scenario of [{ schedule: [] }, { fail: 'schedule' }]) {
    const fixture = briefHandler(scenario), res = await fixture.run();
    assert.equal(res.code, 200);
    assert.equal(res.body.performance.vacancy_rate, null);
    assert.equal(res.body.performance.wault_years, null);
    assert.equal(res.body.data_quality.schedule, scenario.fail ? 'error' : 'missing');
    assert.equal(res.body.data_quality.risks, scenario.fail ? 'error' : 'missing');
    assert.ok(res.body.data_warnings.some(warning => warning.section === 'schedule'));
    assert.equal(res.body.performance.total_units, scenario.fail ? null : 0);
    assert.equal(res.body.commentary, 'Human asset lead instructions');
    assert.equal(res.body.bgp_commentary, 'Saved commentary must survive');
  }
});

test('unknown/marketing occupancy cannot silently become an occupied unit; legacy coverage remains explicitly partial', () => {
  for (const status of ['', null, 'In Negotiation', 'Under Offer', 'Opportunity', 'Custom status']) assert.equal(helpers.briefOccupancy(status), 'unknown');
  for (const status of ['Vacant', 'VOID', 'Available', 'AVA']) assert.equal(helpers.briefOccupancy(status), 'vacant');
  for (const status of ['Occupied', 'Not Vacant', 'Trading', 'Holding Over', 'Lease Event Pending']) assert.equal(helpers.briefOccupancy(status), 'occupied');
  const summary = helpers.summariseBriefSchedule([row(), row({ id: 'unknown', status: null }), row({ id: 'vacant', status: 'Vacant' })]);
  assert.equal(summary.performance.total_units, 3);
  assert.equal(summary.performance.occupied_units, 1);
  assert.equal(summary.performance.vacant_units, 1);
  assert.equal(summary.performance.unknown_units, 1);
  assert.equal(summary.performance.vacancy_rate, null);
  assert.equal(summary.status, 'partial');
  const legacy = helpers.summariseBriefSchedule([row({ schedule_source: 'leasing' })]);
  assert.equal(legacy.status, 'partial');
  assert.equal(legacy.performance.source, 'leasing');
  assert.equal(legacy.performance.vacancy_rate, null);
});

test('confirmed tenancy occupancy supports a real zero vacancy and computes rent-weighted lease term', () => {
  const now = Date.parse('2026-01-01'), year = 31557600000;
  const rows = [row({ rent_pa: 100, lease_expiry: new Date(now + year).toISOString() }), row({ id: '2', rent_pa: 300, lease_expiry: new Date(now + 9 * year).toISOString() })];
  const result = helpers.summariseBriefSchedule(rows, false, now);
  assert.equal(result.status, 'ready');
  assert.equal(result.performance.vacancy_rate, 0);
  assert.equal(result.performance.wault_years, 7, 'a plain mean of lease terms would incorrectly report five years');
  assert.equal(helpers.summariseBriefSchedule([...rows, row({ status: 'Void' })], false, now).performance.vacancy_rate, 1 / 3);
  assert.equal(helpers.summariseBriefSchedule([row({ rent_pa: null })], false, now).performance.wault_years, null);
  const missingExpiry = helpers.summariseBriefSchedule([row({ lease_expiry: null })], false, now);
  assert.equal(missingExpiry.risksStatus, 'partial');
  assert.equal(missingExpiry.performance.wault_years, null);
});

test('a source-specific read failure is surfaced and never erases human commentary', async () => {
  for (const fail of ['deals', 'lettings', 'activity', 'trading']) {
    const res = await briefHandler({ fail }).run();
    assert.equal(res.code, 200);
    assert.equal(res.body.data_quality[fail], 'error');
    assert.equal(res.body.data_warnings.filter(warning => warning.section === fail).length, 1);
    assert.equal(res.body.commentary, 'Human asset lead instructions');
    assert.equal(res.body.bgp_commentary, 'Saved commentary must survive');
  }
});

test('client property scope and fee redaction survive the aggregation changes', async () => {
  const blocked = briefHandler({ client: true, inScope: false });
  assert.equal((await blocked.run()).code, 403);
  assert.equal(blocked.queries.length, 0);
  const res = await briefHandler({ client: true, deals: [{ id: 'deal', status: 'NEG', fee_pence: 500000, updated_at: '2026-09-16' }] }).run();
  assert.equal(res.body.active_deals[0].fee_pence, null);
  assert.equal(res.body.commentary, '', 'internal notes remain internal');
});

function regeneration({ brief, tasks = [{ title: 'Chase the lease renewal', owner_name: 'Pete' }], tasksFail = false } = {}) {
  let handler, providerCalls = 0, providerPrompt = null; const writes = [], fetches = [];
  evaluate(route('post', '/api/properties/:id/bgp-commentary/regenerate'), {
    requireAuth() {}, console: { error() {} }, process: { env: { PORT: '5000', ANTHROPIC_API_KEY: 'synthetic-not-live' } },
    router: { post: (_path, _auth, fn) => { handler = fn; } },
    require: name => name === './company-scope' ? scope : { default: class {
      messages = { create: async request => { providerCalls++; providerPrompt = request.messages[0].content; return { content: [{ type: 'text', text: 'New grounded summary' }] }; } };
    } },
    fetch: async (url, options) => { fetches.push({ url, options }); return url.endsWith('/asset-brief')
      ? { ok: true, json: async () => brief } : { ok: !tasksFail, json: async () => ({ tasks }) }; },
    pool: { query: async (sql, values) => { writes.push({ sql, values }); return { rows: [] }; } },
  });
  return { writes, fetches, get providerCalls() { return providerCalls; }, get prompt() { return providerPrompt; }, async run() {
    const res = response(); await handler({ params: { id: 'property' }, headers: { authorization: 'Bearer fixture', cookie: 'fixture-cookie' } }, res); return res;
  } };
}

test('missing/partial/failed source data prevents any AI call or persisted commentary change', async () => {
  const ready = (await briefHandler().run()).body;
  for (const status of ['missing', 'partial', 'error']) for (const section of ['deals', 'lettings', 'activity', 'schedule', 'risks']) {
    const fixture = regeneration({ brief: { ...ready, data_quality: { ...ready.data_quality, [section]: status } } });
    assert.equal((await fixture.run()).code, 409);
    assert.equal(fixture.providerCalls, 0);
    assert.equal(fixture.writes.length, 0);
  }
});

test('commentary uses visible current tasks, keeps authentication and never rewrites manual notes', async () => {
  const brief = (await briefHandler().run()).body;
  brief.weekly_focus = [{ text: 'Retired stale action' }];
  const fixture = regeneration({ brief });
  assert.equal((await fixture.run()).code, 200);
  assert.match(fixture.prompt, /Chase the lease renewal/);
  assert.doesNotMatch(fixture.prompt, /Retired stale action/);
  assert.match(fixture.fetches[1].url, /\/tasks\?status=active$/);
  assert.equal(fixture.fetches[1].options.headers.Authorization, 'Bearer fixture');
  assert.equal(fixture.fetches[1].options.headers.Cookie, 'fixture-cookie');
  assert.equal(fixture.writes.length, 1);
  assert.match(fixture.writes[0].sql, /SET bgp_commentary =/);
  assert.doesNotMatch(fixture.writes[0].sql, /\bnotes\s*=/);
  const unavailable = regeneration({ brief, tasksFail: true });
  assert.equal((await unavailable.run()).code, 409);
  assert.equal(unavailable.providerCalls, 0);
  assert.equal(unavailable.writes.length, 0);
});

function uiFunction(name, bindings = {}) {
  const exports = {}, empty = () => null;
  const wrapper = ({ children }) => React.createElement('section', {}, children);
  const components = Object.fromEntries(['Card', 'CardContent', 'CardHeader', 'CardTitle', 'Badge', 'Button', 'Link', 'Select', 'SelectTrigger', 'SelectValue', 'SelectContent', 'SelectItem'].map(name => [name, wrapper]));
  const compiled = ts.transpileModule(fn(uiFile, name), { fileName: 'fixture.tsx', compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText;
  vm.runInNewContext(compiled, { exports, React, ...components, Skeleton: empty, Input: empty,
    Target: empty, Plus: empty, BarChart3: empty, TrendingUp: empty, TrendingDown: empty, AlertTriangle: empty,
    useState: initial => [initial, () => {}], useMutation: () => ({ isPending: false }), useQueryClient: () => ({}), useToast: () => ({}),
    STAGE_BUCKETS: [{ key: 'engaged', label: 'Engaged', colour: '' }], ...bindings });
  return props => renderToStaticMarkup(React.createElement(exports[name], props));
}

test('rendered performance and risk cards do not reassure the user on an empty or failed schedule', async () => {
  for (const setup of [{ schedule: [] }, { fail: 'schedule' }]) {
    const data = (await briefHandler(setup).run()).body;
    const bindings = { useAssetBrief: () => ({ data, isLoading: false, isError: false, refetch() {} }) };
    const performance = uiFunction('PipelinePerformanceBoard', bindings)({ propertyId: 'property' });
    assert.doesNotMatch(performance, /NaN|0\.0%|undefined of|0 of 0/);
    assert.match(performance, /unavailable|incomplete/);
    const risk = uiFunction('RiskRegisterCard', bindings)({ propertyId: 'property' });
    assert.doesNotMatch(risk, /No risks flagged|All long-expiry/);
    assert.match(risk, /unavailable|incomplete/);
  }
});

test('task loading and failure states do not claim that the property has no open work', () => {
  for (const [isLoading, isError] of [[true, false], [false, true]]) {
    const html = uiFunction('WeeklyFocusCard', { useQuery: options => options.queryKey[0] === '/api/users' ? { data: [] } : { isLoading, isError, refetch() {} } })({ propertyId: 'property' });
    assert.doesNotMatch(html, /No open tasks/);
    assert.match(html, isError ? /Property tasks could not be loaded/ : /Loading property tasks/);
  }
});

function propertyTasksHandler({ userId = 'viewer', token = false, clientScope = null, propertyAllowed = true, linkedPropertyAllowed = true, linkedDealAllowed = true, missingPhotoColumn = false } = {}) {
  let handler;
  const queries = [], scopeChecks = [];
  const tasks = [
    { id: 'owned', title: 'My recorded action', user_id: 'viewer', assigned_by_user_id: null, linked_property_id: 'property', linked_deal_id: null },
    { id: 'delegated', title: 'Action I assigned to Victoria', user_id: 'victoria', assigned_by_user_id: 'viewer', linked_property_id: 'property', linked_deal_id: 'linked-deal' },
    { id: 'colleague', title: 'Victoria recorded action', user_id: 'victoria', assigned_by_user_id: 'someone-else', linked_property_id: 'property', linked_deal_id: null },
  ].map(task => ({ ...task, status: 'todo', priority: 'medium', due_date: null, owner_name: task.user_id === 'viewer' ? 'Viewer' : 'Victoria' }));
  evaluate(route('get', '/api/properties/:id/tasks'), {
    requireAuth() {}, console: { warn() {} }, router: { get: (_path, _auth, fn) => { handler = fn; } },
    require: name => {
      assert.equal(name, './company-scope');
      return {
        clientBlockedForProperty: async () => !propertyAllowed,
        resolveCompanyScope: async () => clientScope,
        isPropertyInScope: async (scope, id) => { scopeChecks.push({ kind: 'property', scope, id }); return linkedPropertyAllowed; },
        isDealInScope: async (scope, id) => { scopeChecks.push({ kind: 'deal', scope, id }); return linkedDealAllowed; },
      };
    },
    pool: { query: async (sql, values) => {
      queries.push({ sql, values });
      assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE)\b/);
      assert.match(sql, /t\.assigned_by_user_id/, 'permission calculation must read the task assigner as well as its owner');
      if (missingPhotoColumn && queries.length === 1) throw Object.assign(new Error('column profile_pic_url does not exist'), { code: '42703' });
      return { rows: tasks };
    } },
  });
  return { queries, scopeChecks, async run() {
    const res = response();
    await handler({ params: { id: 'property' }, query: { status: 'active' }, ...(token ? { tokenUserId: userId } : { session: { userId } }) }, res);
    return res;
  } };
}

test('property tasks expose completion capability for owner or assigner, while retaining colleagues’ visible tasks', async () => {
  for (const token of [false, true]) for (const clientScope of [null, 'landlord']) for (const missingPhotoColumn of [false, true]) {
    const app = propertyTasksHandler({ token, clientScope, missingPhotoColumn });
    const res = await app.run();
    assert.equal(res.code, 200);
    assert.deepEqual(Array.from(res.body.tasks, task => [task.id, task.can_complete]), [['owned', true], ['delegated', true], ['colleague', false]]);
    assert.equal(app.queries.length, missingPhotoColumn ? 2 : 1);
    assert.equal(app.scopeChecks.length, clientScope ? 3 : 0);
    assert.equal(app.queries[0].values[0], 'property');
  }
});

test('property task capability respects linked-record scope and the route rejects unauthenticated or out-of-portfolio access', async () => {
  for (const scenario of [{ linkedPropertyAllowed: false }, { linkedDealAllowed: false }]) {
    const res = await propertyTasksHandler({ clientScope: 'landlord', ...scenario }).run();
    assert.equal(res.body.tasks.length, 3, 'read visibility stays intact even if the action is unavailable');
    assert.equal(res.body.tasks.find(task => task.id === 'delegated').can_complete, false);
    assert.equal(res.body.tasks.find(task => task.id === 'owned').can_complete, scenario.linkedPropertyAllowed !== false);
  }
  for (const scenario of [{ userId: null }, { propertyAllowed: false }]) {
    const app = propertyTasksHandler(scenario), res = await app.run();
    assert.equal(res.code, scenario.userId === null ? 401 : 403);
    assert.equal(app.queries.length, 0);
  }
});

test('weekly focus renders completion only for eligible tasks and leaves other task titles and owners visible', async () => {
  const { tasks } = (await propertyTasksHandler({ clientScope: 'landlord' }).run()).body;
  tasks.push({ ...tasks[2], id: 'legacy', title: 'Task from older cached response', can_complete: undefined });
  const due = evaluate(fn(uiFile, 'dueLabel') + '\nexport { dueLabel };');
  const html = uiFunction('WeeklyFocusCard', {
    ...due, PRIORITY_DOT: {},
    useQuery: options => ({ data: options.queryKey[0] === '/api/users' ? [] : { tasks } }),
  })({ propertyId: 'property' });
  assert.match(html, /data-testid="task-complete-owned"/);
  assert.match(html, /data-testid="task-complete-delegated"/);
  assert.doesNotMatch(html, /data-testid="task-complete-(colleague|legacy)"/);
  assert.match(html, /Victoria recorded action/);
  assert.match(html, /Task from older cached response/);
  assert.match(html, /Victoria/);
});

test('mixed-use editing splits legacy CSV, retains unknown uses and sends the complete selected mix', () => {
  const { propertyAssetClasses } = evaluate(fn(detailFile, 'propertyAssetClasses'));
  assert.deepEqual(Array.from(propertyAssetClasses('Retail, Residential, Office')), ['Retail', 'Residential', 'Office']);
  assert.deepEqual(Array.from(propertyAssetClasses(['Retail, Office', 'Office', 'Historic local use'])), ['Retail', 'Office', 'Historic local use']);
  assert.deepEqual(Array.from(propertyAssetClasses(null)), []);
  const editor = find(detailFile, node => ts.isJsxSelfClosingElement(node) && node.tagName.getText() === 'InlineEngagement'
    && node.attributes.properties.some(attr => ts.isJsxAttribute(attr) && attr.name.text === 'value' && attr.initializer?.getText().includes('propertyAssetClasses')));
  let chosen, saved;
  const code = ts.transpileModule(`export const element = (${editor});`, { fileName: 'fixture.tsx', compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, React, property: { assetClass: 'Retail, Residential' }, propertyAssetClasses,
    ASSET_CLASS_OPTIONS: ['Retail', 'Residential', 'Office'], ASSET_CLASS_COLORS: {},
    inlineUpdate: (field, value) => { saved = { field, value }; }, InlineEngagement: props => { chosen = props; return null; } });
  renderToStaticMarkup(exports.element);
  assert.deepEqual(Array.from(chosen.value), ['Retail', 'Residential']);
  chosen.onSave([...chosen.value, 'Office']);
  assert.deepEqual(saved, { field: 'assetClass', value: 'Retail, Residential, Office' });
  chosen.onSave([]);
  assert.equal(saved.value, null);
  assert.doesNotMatch(source(detailFile), /Auto-enriching|badge-enriching/);
});
