// Brand CRM: who gets through which door, the "On hold" flag and the brand
// tidy (docs/brand-crm-spec-2026-11-12.md, 2.6: the gateway, concept_status
// and brand-relevance tests). The grouping, stages and what each viewer is
// sent are in server/brand-scheme-plan.test.ts and
// server/brand-crm-diary.test.ts; this file runs the routes themselves, cut
// from the source, with the database and the login helpers stubbed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { RESTRICTED_LANDSEC_ROLES, restrictedLandsecApiRule } from '../../shared/landsec.ts';
const require = createRequire(import.meta.url);
const { source, find, route, evaluate, ts } = require('./source-harness.cjs');

const PLAN = 'server/brand-scheme-plan.ts', DIARY = 'server/brand-crm-diary.ts', ACCESS = 'server/landsec-access.ts';
const PROFILE = 'server/brand-profile.ts', CRM = 'server/crm.ts', STAGE = 'shared/brand-stage.ts', TIDY = 'server/brand-relevance.ts';
const fn = (file, name) => find(file, node => ts.isFunctionDeclaration(node) && node.name?.text === name);
const statement = (file, start) => find(file, node => ts.isVariableStatement(node) && node.getText().startsWith(start));
// Values made inside the evaluated source belong to another realm.
const plain = value => JSON.parse(JSON.stringify(value));
const reply = () => ({ code: 200, body: undefined, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });

// ── The logins ───────────────────────────────────────────────────────────
// `client` is what isClientRequestUser answers, `scope` what
// resolveCompanyScope answers and `landsec` what landsecViewer answers.
const LANDSEC = 'landsec-co';
const viewer = (role, schemes = null) => ({ companyId: LANDSEC, isClient: role !== 'bgp', role, schemes, firm: null });
const STAFF = { landsec: viewer('bgp') };
const STAFF_AS_LANDSEC = { scope: LANDSEC, landsec: viewer('bgp') };
const FULL_LANDSEC = { client: true, scope: LANDSEC, landsec: viewer('landsec') };
const LEASING_MANAGER = { client: true, scope: LANDSEC, landsec: viewer('leasing_manager') };
const ASSET_MANAGER = { client: true, scope: LANDSEC, landsec: viewer('asset_manager', new Set(['bluewater'])) };
const JOINT_AGENT = { client: true, scope: LANDSEC, landsec: viewer('joint_agent', new Set(['westgate-oxford'])) };
const OTHER_CLIENT = { client: true, scope: 'hammerson-co', landsec: null };

// The Brand CRM's routes as written, on a stand-in app.
function doors() {
  const calls = [], routes = [];
  const add = method => (path, ...chain) => routes.push({ method, path, run: chain.at(-1) });
  const app = { get: add('GET'), post: add('POST'), put: add('PUT'), patch: add('PATCH'), delete: add('DELETE'), all: add('*') };
  const code = [find(PLAN, node => ts.isClassDeclaration(node) && node.name?.text === 'PlanError'), statement(PLAN, 'const fail ='), fn(PLAN, 'staffDoor'),
    fn(PLAN, 'landsecPlanViewer'), fn(PLAN, 'landsecSchemes'), fn(PLAN, 'setupBrandCrmPlanRoutes'), statement(DIARY, 'const userIdOf ='), fn(DIARY, 'setupBrandCrmDiaryRoutes')].join('\n');
  const built = evaluate(code, {
    requireAuth() {}, STAFF_VIEWER: { kind: 'staff', clientCompanyId: null, schemes: null },
    isClientRequestUser: async req => !!req.who.client, resolveCompanyScope: async req => req.who.scope || null, landsecViewer: async req => req.who.landsec || null,
    landsecCompanyId: async () => LANDSEC, resolveLandsecPortfolio: async companyId => ({ companyId }), planSchemes: () => [], getCompanyIdForClientTeam: () => null,
    clientBrandSliceSql: async companyId => `SLICE OF ${companyId}`,
    isClientVisibleBrand: async (id, companyId) => { calls.push(['on its list?', id, companyId]); return id !== 'outside'; },
    pool: { query: async () => ({ rows: [{ name: 'Alex Todd' }] }) },
    brandGrid: async (_db, who, _schemes, slice) => { calls.push(['grid', who, slice]); return { grid: true }; },
    brandPlan: async (_db, id, who) => { calls.push(['plan', id, who]); return id === 'gone' ? null : { plan: id }; },
    createWish: async (_db, _schemes, body, actor) => { calls.push(['add', body, actor]); return { ok: true, id: 'w1' }; },
    updateWish: async (_db, _schemes, id, body) => { calls.push(['change', id, body]); return { ok: true, id }; },
    loadDiary: async (_db, who, _schemes, options) => { calls.push(['diary', who, options?.brandSliceSql || null]); return { items: [] }; },
  });
  built.setupBrandCrmPlanRoutes(app); built.setupBrandCrmDiaryRoutes(app);
  return {
    calls, list: routes.map(r => `${r.method} ${r.path}`),
    async call(method, url, who, body) {
      const [path, query = ''] = url.split('?'); let params = {};
      const found = routes.find(r => {
        if (r.method !== '*' && r.method !== method) return false;
        if (typeof r.path !== 'string') return r.path.test(path);
        const want = r.path.split('/'), got = path.split('/'), named = {};
        if (want.length !== got.length) return false;
        for (let i = 0; i < want.length; i++) { if (want[i].startsWith(':')) named[want[i].slice(1)] = got[i]; else if (want[i] !== got[i]) return false; }
        params = named; return true;
      });
      assert.ok(found, `no route for ${method} ${path}`);
      calls.length = 0;
      const res = reply();
      await found.run({ method, params, query: Object.fromEntries(new URLSearchParams(query)), body, who, session: { userId: 'u1' } }, res);
      // A scheme set becomes a list so it can be compared.
      const listed = value => typeof value?.schemes?.has === 'function' ? { ...value, schemes: [...value.schemes] } : value;
      return { status: res.code, body: res.body === undefined ? undefined : plain(res.body), calls: plain(calls.map(([name, ...rest]) => [name, ...rest.map(listed)])) };
    },
  };
}

const STAFF_ROUTES = [['GET', '/api/brand-crm/plan'], ['GET', '/api/brand-crm/plan/b1'], ['POST', '/api/brand-crm/targets'], ['PATCH', '/api/brand-crm/targets/w1'], ['GET', '/api/brand-crm/diary']];

test('the Brand CRM registers these routes and no others', () => {
  assert.deepEqual(doors().list, [
    'GET /api/brand-crm/plan', 'GET /api/brand-crm/plan/:companyId', 'POST /api/brand-crm/targets', 'PATCH /api/brand-crm/targets/:id',
    'GET /api/landsec/brand-crm/plan', 'GET /api/landsec/brand-crm/plan/:companyId', '* /^\\/api\\/landsec\\/brand-crm\\/targets(\\/.*)?$/i',
    'GET /api/brand-crm/diary', 'GET /api/landsec/diary',
  ]);
});

test('the staff door: BGP staff only; a client login, and staff viewing as a client, are turned away before anything is read or written', async () => {
  const app = doors();
  for (const [name, who] of Object.entries({ FULL_LANDSEC, LEASING_MANAGER, ASSET_MANAGER, JOINT_AGENT, OTHER_CLIENT, STAFF_AS_LANDSEC })) {
    for (const [method, url] of STAFF_ROUTES) {
      const out = await app.call(method, url, who, { companyId: 'b1', schemeKey: 'bluewater' });
      assert.equal(out.status, 403, `${name} ${method} ${url}`);
      assert.match(out.body.error, /BGP's own Brand CRM view/);
      assert.deepEqual(out.calls, [], `${name} ${method} ${url} reached the engine`);
    }
  }
  const staffViewer = { kind: 'staff', clientCompanyId: null, schemes: null };
  assert.deepEqual(await app.call('GET', '/api/brand-crm/plan', STAFF), { status: 200, body: { grid: true }, calls: [['grid', staffViewer, null]] });
  assert.deepEqual(await app.call('GET', '/api/brand-crm/plan/b1', STAFF), { status: 200, body: { plan: 'b1' }, calls: [['plan', 'b1', staffViewer]] });
  assert.equal((await app.call('GET', '/api/brand-crm/plan/gone', STAFF)).status, 404);
  // The grid is built for the Landsec schemes only so far.
  const other = await app.call('GET', '/api/brand-crm/plan?landlord=hammerson', STAFF);
  assert.deepEqual([other.status, other.calls], [400, []]);
  const added = await app.call('POST', '/api/brand-crm/targets', STAFF, { companyId: 'b1', schemeKey: 'bluewater' });
  assert.deepEqual([added.status, added.body, added.calls], [201, { ok: true, id: 'w1' }, [['add', { companyId: 'b1', schemeKey: 'bluewater' }, { id: 'u1', name: 'Alex Todd' }]]]);
  const changed = await app.call('PATCH', '/api/brand-crm/targets/w1', STAFF, { visibleToClient: true });
  assert.deepEqual([changed.status, changed.calls], [200, [['change', 'w1', { visibleToClient: true }]]]);
  const diary = await app.call('GET', '/api/brand-crm/diary', STAFF);
  assert.deepEqual([diary.status, diary.calls], [200, [['diary', { ...staffViewer, userId: 'u1' }, null]]]);
});

test('the Landsec door: always a client view, cut by role; another client gets nothing; a joint agent gets no brand by id', async () => {
  const app = doors();
  for (const url of ['/api/landsec/brand-crm/plan', '/api/landsec/brand-crm/plan/b1', '/api/landsec/diary']) {
    const out = await app.call('GET', url, OTHER_CLIENT);
    assert.deepEqual([out.status, out.calls], [403, []], url);
  }
  // A full Landsec login, a leasing manager and BGP staff looking through this door all get the full Landsec client view.
  const full = { kind: 'landsec', clientCompanyId: LANDSEC, schemes: null };
  for (const who of [FULL_LANDSEC, LEASING_MANAGER, STAFF, STAFF_AS_LANDSEC]) {
    assert.deepEqual((await app.call('GET', '/api/landsec/brand-crm/plan', who)).calls, [['grid', full, `SLICE OF ${LANDSEC}`]]);
    assert.deepEqual((await app.call('GET', '/api/landsec/brand-crm/plan/b1', who)).calls, [['on its list?', 'b1', LANDSEC], ['plan', 'b1', full]]);
    assert.deepEqual((await app.call('GET', '/api/landsec/diary', who)).calls, [['diary', { ...full, userId: 'u1' }, `SLICE OF ${LANDSEC}`]]);
  }
  // A brand outside the client's list, or hidden, is refused before its plan is read.
  const outside = await app.call('GET', '/api/landsec/brand-crm/plan/outside', FULL_LANDSEC);
  assert.deepEqual([outside.status, outside.calls], [403, [['on its list?', 'outside', LANDSEC]]]);
  assert.equal((await app.call('GET', '/api/landsec/brand-crm/plan/gone', FULL_LANDSEC)).status, 404);

  const am = { kind: 'asset_manager', clientCompanyId: LANDSEC, schemes: ['bluewater'] };
  assert.deepEqual((await app.call('GET', '/api/landsec/brand-crm/plan', ASSET_MANAGER)).calls, [['grid', am, `SLICE OF ${LANDSEC}`]]);
  assert.deepEqual((await app.call('GET', '/api/landsec/brand-crm/plan/b1', ASSET_MANAGER)).calls, [['on its list?', 'b1', LANDSEC], ['plan', 'b1', am]]);
  assert.equal((await app.call('GET', '/api/landsec/brand-crm/plan/outside', ASSET_MANAGER)).status, 403);
  assert.deepEqual((await app.call('GET', '/api/landsec/diary', ASSET_MANAGER)).calls[0][1], { ...am, userId: 'u1' });

  // A joint agent holds no brand ids: its lines come with the grid, and the per-brand route is shut before the brand is looked up.
  const ja = { kind: 'joint_agent', clientCompanyId: LANDSEC, schemes: ['westgate-oxford'] };
  assert.deepEqual((await app.call('GET', '/api/landsec/brand-crm/plan', JOINT_AGENT)).calls, [['grid', ja, `SLICE OF ${LANDSEC}`]]);
  const byId = await app.call('GET', '/api/landsec/brand-crm/plan/b1', JOINT_AGENT);
  assert.deepEqual([byId.status, byId.calls], [403, []]);
  assert.deepEqual((await app.call('GET', '/api/landsec/diary', JOINT_AGENT)).calls[0][1], { ...ja, userId: 'u1' });

  // A restricted role whose scheme list is missing sees no scheme, never every scheme.
  for (const role of ['asset_manager', 'joint_agent']) {
    const none = await app.call('GET', '/api/landsec/brand-crm/plan', { client: true, scope: LANDSEC, landsec: viewer(role, null) });
    assert.deepEqual(none.calls[0][1].schemes, [], role);
  }
});

test('nobody writes a Wanted line through the Landsec door, whatever the method or the login', async () => {
  const app = doors();
  for (const who of [STAFF, STAFF_AS_LANDSEC, FULL_LANDSEC, LEASING_MANAGER, ASSET_MANAGER, JOINT_AGENT, OTHER_CLIENT]) {
    for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) for (const url of ['/api/landsec/brand-crm/targets', '/api/landsec/brand-crm/targets/w1']) {
      const out = await app.call(method, url, who, { companyId: 'b1', schemeKey: 'bluewater', ruledOut: null });
      assert.deepEqual([out.status, out.body, out.calls], [403, { error: 'Wanted lines are added by BGP for now' }, []], `${method} ${url}`);
    }
  }
});

test('the gateway for asset managers and joint agents: the Landsec Brand CRM door and nothing else of the Brand CRM', async () => {
  // The door is restrictedLandsecApiDecision (server/landsec-access.ts): no
  // say for a login without a restricted role, else the rule. The rule and
  // its lists moved to shared/landsec.ts (restrictedLandsecApiRule) when
  // joint agents were given control of their schemes; it is the real one here.
  const { restrictedLandsecApiDecision } = evaluate(fn(ACCESS, 'restrictedLandsecApiDecision'),
    { RESTRICTED_LANDSEC_ROLES, restrictedLandsecApiRule, getLandsecAccess: async req => req.access });
  const decide = (role, method, path) => restrictedLandsecApiDecision({ method, access: role ? { role, schemes: ['bluewater'], firm: null } : null }, path);
  // [method, path, asset manager, joint agent]
  const table = [
    // Reads of the plan and the diary; the handlers cut them to the person's schemes.
    ['GET', '/api/landsec/brand-crm/plan', 'allow', 'allow'],
    ['GET', '/api/landsec/brand-crm/plan/b1', 'allow', 'allow'],          // the handler refuses a joint agent (test above)
    ['GET', '/api/landsec/diary', 'allow', 'allow'],
    ['POST', '/api/landsec/brand-crm/targets', 'allow', 'allow'],         // reaches the handler, which refuses every write (test above)
    // BGP's own door.
    ['GET', '/api/brand-crm/plan', 'deny', 'deny'],
    ['GET', '/api/brand-crm/plan/b1', 'deny', 'deny'],
    ['GET', '/api/brand-crm/diary', 'deny', 'deny'],
    ['POST', '/api/brand-crm/targets', 'deny', 'deny'],
    ['PATCH', '/api/brand-crm/targets/w1', 'deny', 'deny'],
    // The CRM plan: no strategies, events or actions, no tick-off, no request, no share marker.
    ['GET', '/api/crm/engagement', 'deny', 'deny'],
    ['GET', '/api/crm/engagement/options', 'deny', 'deny'],
    ['POST', '/api/crm/engagement/actions', 'deny', 'deny'],
    ['PATCH', '/api/crm/engagement/actions/a1', 'deny', 'deny'],
    ['POST', '/api/crm/engagement/strategies', 'deny', 'deny'],
    // "On hold" and the brand record are not theirs to change.
    ['PATCH', '/api/brand/b1', 'deny', 'deny'],
    ['PUT', '/api/crm/companies/b1', 'deny', 'deny'],
    // Brand contacts: an asset manager reads brand pages; a joint agent reads nothing of a brand.
    ['GET', '/api/brand/b1', 'allow', 'deny'],
    ['GET', '/api/brand/b1/email-threads', 'allow', 'deny'],              // staffOnly in the handler turns the asset manager away
    ['GET', '/api/brands/search', 'allow', 'deny'],
    ['GET', '/api/crm/contacts', 'deny', 'deny'],
    ['POST', '/api/landlord/b1/dismiss-contact-suggestion', 'deny', 'deny'],
    ['GET', '/api/landsec/brand-case/b1', 'allow', 'deny'],
    // Their own task list, read and tick only (Woody, 2026-11-13: "we need
    // each person to have this update their own task list"). Nothing else
    // under /api/tasks.
    ['GET', '/api/tasks', 'allow', 'allow'],
    ['PATCH', '/api/tasks/t1', 'allow', 'allow'],
    ['POST', '/api/tasks', 'deny', 'deny'],
    ['DELETE', '/api/tasks/t1', 'deny', 'deny'],
  ];
  for (const [method, path, assetManager, jointAgent] of table) {
    assert.equal(await decide('asset_manager', method, path), assetManager, `asset manager ${method} ${path}`);
    assert.equal(await decide('joint_agent', method, path), jointAgent, `joint agent ${method} ${path}`);
    // Not this gateway's call for anyone else: the client allowlist decides.
    assert.equal(await decide('leasing_manager', method, path), null);
    assert.equal(await decide(null, method, path), null);
  }
  // That allowlist (server/index.ts) names the Landsec door and never BGP's.
  const index = source('server/index.ts');
  const lists = index.slice(index.indexOf('const CLIENT_ALLOWED_API = ['), index.indexOf('app.use("/api", (req: any, res, next) => {', index.indexOf('const CLIENT_ALLOWED_WRITES = [')));
  assert.ok(lists.includes('"/api/landsec/"'));
  assert.ok(!lists.includes('/api/brand-crm'));
  // The email history behind the asset manager's gateway allowance is staff only.
  for (const handler of source('server/brand-email-threads.ts').split('router.').slice(1)) assert.match(handler, /if \(!\(await staffOnly\(req, res\)\)\) return;/);
  // So are BGP's contacts read from its mailboxes: the gateway lets an asset
  // manager GET anything under /api/brand/, so each handler turns it away
  // before the company is even looked up (no probing ids, no paid lookup).
  const discovery = source('server/contacts-discovery.ts');
  const contactRoutes = discovery.split('router.get(').slice(1).filter(route => /^"\/api\/brand\/[^"]*(contacts-cascade|bgp-known-contacts)"/.test(route));
  assert.equal(contactRoutes.length, 4);
  for (const route of contactRoutes) assert.match(route, /^"[^"]+", requireAuth, async \(req: Request, res: Response\) => \{\s+if \(!await staffOnlyContacts\(req, res\)\) return;/);
  assert.match(discovery, /async function staffOnlyContacts\(req: Request, res: Response\): Promise<boolean> \{\s+const \{ canReadLandlordMeetings \} = await import\("\.\/landlord-meetings"\);\s+if \(await canReadLandlordMeetings\(req\)\) return true;\s+res\.status\(403\)/);
});

test('a client is never sent a dismissed contact suggestion or a requirement BGP entered by hand', () => {
  const profile = source('server/brand-profile.ts');
  // A dismissed suggestion's key is a person's name or email.
  assert.match(profile, /dismissedDiscoveries: \(dismissedDiscoveries\.rows \|\| \[\]\)\.map\(\(r: any\) => r\.discovery_key\)\.filter\(\(k: any\) => !bpScope \|\| !\/\^contact:\/i\.test\(String\(k\)\)\)/);
  // The one client rule of the requirements centre (requirementClientVisibleSql
  // in shared/requirement-live.ts: rows labelled PIPnet only), which replaced
  // the hand-written PIPnet test here on 12 November 2026. On the profile a
  // client also reads a requirement on its own company; suggested pitches
  // read the listings only. Staff get neither cut.
  const requirements = profile.slice(profile.indexOf('const requirementsQ = pool.query('), profile.indexOf('// Pitched-to history'));
  assert.ok(requirements.length > 0);
  assert.match(requirements, /AND \$\{bpScope\s+\? `\(\$\{requirementClientVisibleSql\("r"\)\} OR r\.company_id = \$2\) AND /);
  assert.match(requirements, /bpScope \? \[companyId, bpScope\] : \[companyId\]/);
  const crm = source('server/crm.ts');
  const pitches = crm.slice(crm.indexOf('app.get("/api/brands/:id/suggested-pitches"'));
  const pitchRequirements = pitches.slice(0, pitches.indexOf('const unitsQ'));
  assert.ok(pitchRequirements.length > 0);
  assert.match(pitchRequirements, /FROM crm_requirements_leasing r\s+WHERE r\.company_id = \$1 AND [^\n]*\$\{scope \? ` AND \$\{requirementClientVisibleSql\("r"\)\}` : ""\}/);
});

// ── "On hold" (crm_companies.concept_status) ─────────────────────────────
const onHold = evaluate([statement(STAGE, 'export const ON_HOLD_VALUE'), fn(STAGE, 'conceptStatusForSave')].join('\n'));
const OLD_VALUES = ['watching', 'pitching', 'won_deal', 'lost_deal', 'Parked', 'on_hold'];

function brandPatch(who) {
  let handler; const saved = [];
  evaluate(find(PROFILE, node => ts.isCallExpression(node) && node.expression.getText() === 'router.patch' && node.arguments[0]?.text === '/api/brand/:companyId'), {
    requireAuth() {}, router: { patch: (_path, ...chain) => { handler = chain.at(-1); } }, canUseBrand: async () => true,
    updateBrandRecord: async (id, body) => { saved.push(plain(body)); return { ok: true, id }; },
    require: name => { assert.equal(name, './company-scope'); return { resolveCompanyScope: async () => who.scope || null, isClientRequestUser: async () => !!who.client }; },
  });
  return { saved, async send(body) { const res = reply(); await handler({ params: { companyId: 'b1' }, body, session: { userId: 'u1' } }, res); return res; } };
}

test('PATCH /api/brand/:id: only BGP staff set On hold; from a client login, or staff viewing as a client, the field is dropped and the rest is saved', async () => {
  const staff = brandPatch(STAFF);
  assert.equal((await staff.send({ concept_status: 'parked' })).code, 200);
  await staff.send({ conceptStatus: null });
  assert.deepEqual(staff.saved, [{ concept_status: 'parked' }, { conceptStatus: null }]);
  for (const who of [FULL_LANDSEC, ASSET_MANAGER, OTHER_CLIENT, STAFF_AS_LANDSEC, { client: true }]) {
    const client = brandPatch(who);
    assert.equal((await client.send({ concept_status: 'parked', conceptStatus: 'parked', store_count: 12 })).code, 200);
    assert.equal((await client.send({ concept_status: null, concept_pitch: 'Subs' })).code, 200);
    assert.deepEqual(client.saved, [{ store_count: 12 }, { concept_pitch: 'Subs' }]);
  }
});

function brandSave() {
  const queries = []; let connections = 0;
  const company = { id: 'b1', name: "Jersey Mike's", concept_status: 'pitching', ai_generated_fields: { concept_status: 'ai', store_count: 'ai' } };
  const { save } = evaluate(`${fn(PROFILE, 'updateBrandRecord')}\nexports.save = updateBrandRecord;`, {
    conceptStatusForSave: onHold.conceptStatusForSave, getBrandIdentity: () => ({}),
    pool: { connect: async () => { connections++; return { query: async (sql, values) => { queries.push({ sql, values }); return { rows: sql.startsWith('SELECT') ? [company] : [] }; }, release() {} }; } },
  });
  return { save, queries, connections: () => connections, write: () => queries.find(q => q.sql.startsWith('UPDATE')) };
}

test('the brand save writes only null or parked to concept_status, and refuses any other value before it touches the database', async () => {
  for (const [body, written] of [[{ concept_status: 'parked' }, 'parked'], [{ conceptStatus: 'parked' }, 'parked'], [{ concept_status: null }, null], [{ conceptStatus: '' }, null]]) {
    const db = brandSave();
    await db.save('b1', body, 'u1');
    assert.match(db.write().sql, /^UPDATE crm_companies SET concept_status = \$2, ai_generated_fields = \$3, updated_at = now\(\) WHERE id = \$1$/);
    assert.deepEqual(plain(db.write().values.slice(0, 2)), ['b1', written]);
    assert.equal(db.queries.at(-1).sql, 'COMMIT');
  }
  for (const old of OLD_VALUES) for (const field of ['concept_status', 'conceptStatus']) {
    const db = brandSave();
    await assert.rejects(db.save('b1', { [field]: old, store_count: 12 }, 'u1'), error => error.status === 400 && /On hold/.test(error.message));
    assert.equal(db.connections(), 0, `${field}=${old} opened a connection`);
  }
  // A save that does not mention the flag leaves it alone.
  const other = brandSave();
  await other.save('b1', { store_count: 12 }, 'u1');
  assert.doesNotMatch(other.write().sql, /concept_status/);
});

function companyPut(who, visible = true) {
  let handler; const saved = [];
  evaluate(route(CRM, 'put', '/api/crm/companies/:id'), {
    app: { put: (_path, ...chain) => { handler = chain.at(-1); } }, conceptStatusForSave: onHold.conceptStatusForSave,
    resolveCompanyScope: async () => who.scope || null, isClientRequestUser: async () => !!who.client, isClientVisibleBrand: async () => visible,
    pool: { query: async () => assert.fail('no query expected') },
    storage: { updateCrmCompany: async (id, body) => { saved.push(plain(body)); return { id, name: "Jersey Mike's", conceptStatus: 'parked', ...body }; } },
  });
  return { saved, async send(body) { const res = reply(); await handler({ params: { id: 'b1' }, body }, res); return res; } };
}

test('PUT /api/crm/companies/:id: a client cannot set On hold and is not sent it back; staff may save only null or parked', async () => {
  const staff = companyPut(STAFF);
  const kept = await staff.send({ conceptStatus: 'parked' });
  assert.deepEqual([kept.code, kept.body.conceptStatus], [200, 'parked']);
  await staff.send({ conceptStatus: '' });
  assert.deepEqual(staff.saved, [{ conceptStatus: 'parked' }, { conceptStatus: null }]);
  for (const old of OLD_VALUES) {
    const refused = companyPut(STAFF);
    const res = await refused.send({ conceptStatus: old, description: 'x' });
    assert.equal(res.code, 400); assert.match(res.body.error, /On hold/);
    assert.deepEqual(refused.saved, []);
  }
  for (const who of [FULL_LANDSEC, OTHER_CLIENT, STAFF_AS_LANDSEC]) {
    const client = companyPut(who);
    const res = await client.send({ conceptStatus: 'parked', description: 'Subs' });
    assert.equal(res.code, 200);
    assert.deepEqual(client.saved, [{ description: 'Subs' }]);
    assert.equal('conceptStatus' in res.body, false, 'the saved row went back to a client with On hold on it');
  }
  // A client login whose company could not be resolved is still a client.
  const unscoped = companyPut({ client: true });
  await unscoped.send({ conceptStatus: 'parked', description: 'Subs' });
  assert.deepEqual(unscoped.saved, [{ description: 'Subs' }]);
  // A brand outside the client's list is refused outright.
  const outside = companyPut(FULL_LANDSEC, false);
  assert.equal((await outside.send({ conceptStatus: 'parked' })).code, 403);
  assert.deepEqual(outside.saved, []);
});

test('a client is never sent On hold: the company record, the company list, a new brand and the brand profile all leave it out', async () => {
  let handler;
  const company = { id: 'b1', name: "Jersey Mike's", companyType: 'Tenant - Restaurants', conceptStatus: 'parked', bgpContactUserIds: ['u-lead'], description: 'Subs' };
  const read = who => {
    evaluate(route(CRM, 'get', '/api/crm/companies/:id'), {
      app: { get: (_path, ...chain) => { handler = chain.at(-1); } }, storage: { getCrmCompany: async () => ({ ...company }) }, resolveCompanyScope: async () => who.scope || null,
      isClientCrmCategory: () => true, pool: { query: async () => ({ rows: [] }) }, require: name => { assert.equal(name, './company-scope'); return { getClientExtraBrandIds: async () => new Set() }; },
    });
    const res = reply();
    return handler({ params: { id: 'b1' } }, res).then(() => res);
  };
  assert.equal((await read(STAFF)).body.conceptStatus, 'parked');
  for (const who of [FULL_LANDSEC, OTHER_CLIENT, STAFF_AS_LANDSEC]) {
    const sent = (await read(who)).body;
    assert.deepEqual([sent.name, sent.description], ["Jersey Mike's", 'Subs']);
    assert.equal('conceptStatus' in sent, false);
    assert.equal('bgpContactUserIds' in sent, false);           // nor BGP's lead
  }
  const crm = source(CRM), profile = source(PROFILE);
  // The company list, for a client scope.
  assert.match(route(CRM, 'get', '/api/crm/companies'), /\)\.map\(\(\{ conceptStatus, \.\.\.c \}: any\) => c\)\);/);
  // A brand a client creates.
  assert.match(crm, /if \(createScope\) \{[\s\S]{0,900}?delete \(parsed as any\)\.conceptStatus;\s+\} else if \("conceptStatus" in \(parsed as any\)\) \{\s+\(parsed as any\)\.conceptStatus = conceptStatusForSave\(/);
  // The brand profile: undefined is dropped when the response is written.
  assert.match(profile, /company: bpScope \? \{ \.\.\.c, concept_status: undefined \} : c,/);
  assert.equal('concept_status' in JSON.parse(JSON.stringify({ company: { id: 'b1', concept_status: undefined } })).company, false);
});

// ── Brand tidy ───────────────────────────────────────────────────────────
// The whole module, with the database answering each check by its query.
function tidy({ brands, signals = {} }) {
  const ast = ts.createSourceFile(TIDY, source(TIDY), ts.ScriptTarget.Latest, true);
  const routes = {}, updates = [], deleted = [];
  let built;
  built = evaluate(ast.statements.filter(node => !ts.isImportDeclaration(node)).map(node => node.getText(ast)).join('\n'), {
    requireAuth() {}, requireAdmin() {}, storage: { deleteCrmCompany: async id => { deleted.push(id); } }, console: { log() {}, warn() {} },
    pool: { query: async (sql, values) => {
      if (/^\s*UPDATE /.test(sql)) { updates.push({ hide: /archived_at = NOW\(\)/.test(sql), ids: plain(values[0]) }); return { rowCount: values[0].length }; }
      if (/ORDER BY c\.name/.test(sql)) return { rows: brands.map(b => ({ company_type: 'Tenant - Restaurants', archived_at: null, archived_reason: null, contacts: 0, ...b, name: b.id })) };
      const name = Object.keys(built.SIGNALS).find(key => built.SIGNALS[key].sql === sql);
      assert.ok(name, `unexpected query: ${sql.slice(0, 80)}`);
      if (signals[name] instanceof Error) throw signals[name];
      return { rows: (signals[name] || []).map(id => ({ id })) };
    } },
  });
  const add = method => (path, ...chain) => { routes[`${method} ${path}`] = chain.at(-1); };
  built.setupBrandRelevanceRoutes({ get: add('GET'), post: add('POST') });
  return { updates, deleted, labels: name => built.SIGNALS[name].label, async call(key, body = {}) { const res = reply(); await routes[key]({ body, query: {}, session: { userId: 'admin' } }, res); return res; } };
}
const SWEPT = { archived_at: '2026-11-11', archived_reason: 'No BGP or client activity found (brand tidy, 2026-11-11)' };
const BY_HAND = { archived_at: '2026-11-11', archived_reason: 'Hidden by hand' };
const TIDY_BRANDS = [
  { id: 'wanted-live' }, { id: 'ruled-out-live' }, { id: 'nothing-live' },
  { id: 'wanted-swept', ...SWEPT }, { id: 'wanted-by-hand', ...BY_HAND }, { id: 'ruled-out-hidden', ...SWEPT }, { id: 'nothing-hidden', ...SWEPT },
];
const WISHES = { schemeTarget: ['wanted-live', 'wanted-swept', 'wanted-by-hand'], anyWish: ['wanted-live', 'wanted-swept', 'wanted-by-hand', 'ruled-out-live', 'ruled-out-hidden'] };

test('brand tidy: a live Wanted line keeps a brand and brings back one the sweep hid; any Wanted line at all stops a permanent delete', async () => {
  const app = tidy({ brands: TIDY_BRANDS, signals: WISHES });
  const report = (await app.call('GET /api/admin/brand-relevance')).body;
  assert.deepEqual(plain([report.keep, report.archive, report.unhide, report.deletable, report.failedSignals]), [1, 2, 1, 1, []]);
  assert.deepEqual(plain([report.signals.schemeTarget, report.signals.anyWish]), [
    { label: 'Wanted at a scheme (Brand CRM)', count: 3 }, { label: 'Any Wanted line, live or ruled out', count: 5, deleteOnly: true }]);
  assert.deepEqual(plain(report.archiveSample.map(b => b.id)), ['ruled-out-live', 'nothing-live']);

  // Hide: the brand with a live line stays; one with only a ruled-out line goes with the rest. The swept brand with a live line comes back; the one hidden by hand stays hidden.
  assert.equal((await app.call('POST /api/admin/brand-relevance/apply')).code, 200);
  assert.deepEqual(app.updates, [{ hide: true, ids: ['ruled-out-live', 'nothing-live'] }, { hide: false, ids: ['wanted-swept'] }]);

  // Delete for good: only the hidden brand with no line of any kind, asked for by name or all at once.
  const some = await app.call('POST /api/admin/brand-relevance/delete', { ids: ['ruled-out-hidden', 'wanted-by-hand', 'wanted-live', 'nothing-hidden'] });
  assert.deepEqual(plain(some.body), { ok: true, deleted: 1, skipped: 3 });
  await app.call('POST /api/admin/brand-relevance/delete', { all: true });
  assert.deepEqual(app.deleted, ['nothing-hidden', 'nothing-hidden']);
  const list = (await app.call('GET /api/admin/brand-relevance/archived')).body;
  assert.deepEqual(plain(list.brands.filter(b => b.deletable).map(b => b.id)), ['nothing-hidden']);
});

test('brand tidy: when the Wanted table cannot be read, Hide and Delete refuse to run and nothing is offered for deletion', async () => {
  const missing = Object.assign(new Error('relation "brand_scheme_targets" does not exist'), { code: '42P01' });
  const app = tidy({ brands: TIDY_BRANDS, signals: { schemeTarget: missing, anyWish: missing } });
  const report = (await app.call('GET /api/admin/brand-relevance')).body;
  assert.deepEqual(plain(report.failedSignals), ['Wanted at a scheme (Brand CRM)', 'Any Wanted line, live or ruled out']);
  assert.equal(report.signals.schemeTarget.unavailable, true);
  for (const key of ['POST /api/admin/brand-relevance/apply', 'POST /api/admin/brand-relevance/delete']) {
    const res = await app.call(key, { all: true });
    assert.equal(res.code, 409); assert.match(res.body.error, /Nothing was changed/);
  }
  assert.deepEqual([app.updates, app.deleted], [[], []]);
  assert.equal((await app.call('GET /api/admin/brand-relevance/archived')).body.deletable, 0);
});
