import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
const requirementFit = await import('../../shared/requirement-fit.ts');
const lettingRules = await import('../../shared/letting-rules.ts');
const tenantCategories = await import('../../shared/tenant-categories.ts');
const requirementLive = await import('../../shared/requirement-live.ts');
const require = createRequire(import.meta.url);
const { route, evaluate } = require('./source-harness.cjs');

// Audit, 2026-11-17: a unit holds a planning class (E(b), A3) and a
// requirement a use (Restaurant). Both dialogs compared the two as text in
// SQL, so the Requirements page's Match was empty for any requirement naming
// a use, and the tracker's Find matching requirements found only rows that
// held the unit's raw class text.

const response = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } });

function load(url, bindings) {
  let handler;
  evaluate(route('server/routes.ts', 'get', url), {
    app: { get: (_url, _auth, callback) => { handler = callback; } }, requireAuth() {},
    ...bindings,
    require: name => {
      if (name === '@shared/requirement-fit') return requirementFit;
      if (name === '@shared/letting-rules') return lettingRules;
      if (name === '@shared/tenant-categories') return tenantCategories;
      if (bindings.modules?.[name]) return bindings.modules[name];
      throw new Error(`unexpected import ${name}`);
    },
  });
  return async req => { const res = response(); await handler(req, res); return { code: res.code, body: JSON.parse(JSON.stringify(res.body)) }; };
}

function requirementMatches(requirement, units) {
  const sql = [];
  const pool = { query: async (text, params = []) => {
    sql.push({ text, params });
    if (/FROM crm_requirements_leasing WHERE id = \$1/.test(text)) return { rows: [requirement] };
    if (/FROM available_units au/.test(text)) return { rows: units };
    throw new Error(`unexpected query ${text}`);
  } };
  const run = load('/api/requirements/matches/:requirementId', { pool });
  return { sql, run: () => run({ params: { requirementId: requirement.id }, query: { type: 'leasing' } }) };
}

const UNITS = [
  { id: 'u-eb', unit_name: 'Unit 2', use_class: 'E(b)', marketing_status: 'AVA', property_name: 'Bluewater' },
  { id: 'u-a3', unit_name: 'Unit 7', use_class: 'A3', marketing_status: 'Under Offer', property_name: 'Bluewater' },
  { id: 'u-shop', unit_name: 'Unit 3', use_class: 'E(a)', marketing_status: 'AVA', property_name: 'Bluewater' },
  { id: 'u-let', unit_name: 'Unit 9', use_class: 'E(b)', marketing_status: 'Let', property_name: 'Bluewater' },
  { id: 'u-blank', unit_name: 'Unit 11', use_class: null, marketing_status: 'NEG', property_name: 'Bluewater' },
];

test('Match dialog: a Restaurant requirement is offered the E(b) and A3 units live on the tracker', async () => {
  const m = requirementMatches({ id: 'req-1', name: 'KFC', use: ['Restaurant'], requirement_locations: null }, UNITS);
  const { code, body } = await m.run();
  assert.equal(code, 200, JSON.stringify(body));
  // Not the shop, not the let unit; a unit with no use class fits on the rest.
  assert.deepEqual(body.map(u => u.id), ['u-eb', 'u-a3', 'u-blank']);
  const unitQuery = m.sql.find(q => /FROM available_units au/.test(q.text));
  assert.doesNotMatch(unitQuery.text, /use_class = ANY/);
  assert.ok(!unitQuery.params.some(p => Array.isArray(p)), 'the uses are not compared as text in SQL');
});

test('Match dialog: a requirement naming no use is offered every live unit, twenty at most', async () => {
  const none = await requirementMatches({ id: 'req-2', name: 'Any', use: null }, UNITS).run();
  assert.deepEqual(none.body.map(u => u.id), ['u-eb', 'u-a3', 'u-shop', 'u-blank']);
  const many = Array.from({ length: 25 }, (_, i) => ({ id: `u-${i}`, unit_name: `Unit ${i}`, use_class: 'E(b)', marketing_status: 'AVA' }));
  const capped = await requirementMatches({ id: 'req-3', name: 'Cafe', use: ['Restaurant'] }, many).run();
  assert.deepEqual(capped.body.map(u => u.id), many.slice(0, 20).map(u => u.id));
});

const CANDIDATES = [
  { id: 'r-retail', use: ['Retail'] },
  { id: 'r-rest', use: ['Restaurant'] },
  { id: 'r-none', use: null },
  { id: 'r-a3', use: ['A3'] },
  { id: 'r-gym', use: ['Gym'] },
  { id: 'r-food', use: ['A1 Food'] },
];
const fullRow = c => ({ ...c, name: c.id, company_id: `co-${c.id}`, company_name: c.id, company_type: 'Tenant - Restaurant', status: 'Active',
  origin: 'pipnet', sources: ['PIPnet'], last_listed_at: '2026-11-01T00:00:00Z', last_listed_source: 'PIPnet', bgp_contact_user_ids: ['u-staff'], updated_at: '2026-11-02T00:00:00Z' });

function unitMatches({ unit = { id: 'unit-1', property_id: 'p-1', use_class: 'E(b)', location: null }, candidates = CANDIDATES, scope = null, outside = false } = {}) {
  const sql = [];
  const pool = { query: async (text, params = []) => {
    sql.push({ text, params });
    if (/FROM available_units WHERE id = \$1/.test(text)) return { rows: [unit] };
    if (/SELECT r\.id, r\.use FROM crm_requirements_leasing r/.test(text)) return { rows: candidates };
    // Handed back out of order: the route keeps the order it read.
    if (/WHERE r\.id = ANY\(\$1::text\[\]\)/.test(text)) return { rows: candidates.filter(c => params[0].includes(c.id)).map(fullRow).reverse() };
    throw new Error(`unexpected query ${text}`);
  } };
  const run = load('/api/available-units/matches/:unitId', {
    pool, assertUnitInClientScope: async () => outside,
    requirementStateSql: requirementLive.requirementStateSql, requirementClientVisibleSql: requirementLive.requirementClientVisibleSql,
    requirementLive: requirementLive.requirementLive, requirementClientCopy: requirementLive.requirementClientCopy,
    modules: { './company-scope': { resolveCompanyScope: async () => scope, getClientExtraBrandIds: async () => new Set() } },
  });
  return { sql, run: () => run({ params: { unitId: unit.id }, query: {} }) };
}

test('Find matching requirements: an E(b) unit finds the Restaurant, A3, A1 Food and no-use requirements, in order', async () => {
  const m = unitMatches();
  const { code, body } = await m.run();
  assert.equal(code, 200, JSON.stringify(body));
  assert.deepEqual(body.map(r => r.id), ['r-rest', 'r-none', 'r-a3', 'r-food']);
  assert.ok(body.every(r => r.state && r.date_label), 'staff get each row\'s state and dated line');
  const candidateQuery = m.sql.find(q => /SELECT r\.id, r\.use/.test(q.text));
  assert.doesNotMatch(candidateQuery.text, /ANY\(r\.use\)/);
  assert.ok(!candidateQuery.params.includes('E(b)'), 'the unit\'s class is not compared as text in SQL');
  assert.match(candidateQuery.text, /<> 'closed'/);
  assert.match(candidateQuery.text, /ORDER BY \(CASE/);
});

test('Find matching requirements: twenty at most, and a client is sent its own cut of them', async () => {
  const many = Array.from({ length: 30 }, (_, i) => ({ id: `r-${i}`, use: ['Restaurant'] }));
  const capped = unitMatches({ candidates: many });
  assert.deepEqual((await capped.run()).body.map(r => r.id), many.slice(0, 20).map(r => r.id));
  assert.equal(capped.sql.find(q => /r\.id = ANY/.test(q.text)).params[0].length, 20);

  const client = unitMatches({ scope: 'client-co' });
  const { body } = await client.run();
  assert.deepEqual(body.map(r => r.id), ['r-rest', 'r-none', 'r-a3', 'r-food']);
  for (const row of body) for (const key of ['state', 'origin', 'last_listed_at', 'bgp_contact_user_ids', 'updated_at']) assert.ok(!(key in row), `${key} sent to a client`);
  // Every requirement is open to a client since 17 November 2026: no PIPnet
  // cut, and newest first (an order the live state moves would tell it which
  // ones BGP has confirmed).
  const clientQuery = client.sql.find(q => /SELECT r\.id, r\.use/.test(q.text)).text;
  assert.doesNotMatch(clientQuery, /PIPnet/);
  assert.match(clientQuery, /<> 'closed' ORDER BY r\.created_at DESC/);
});

test('Find matching requirements: a unit outside the client\'s properties is refused before any requirement is read', async () => {
  const m = unitMatches({ outside: true });
  assert.equal((await m.run()).code, 403);
  assert.ok(!m.sql.some(q => /crm_requirements_leasing/.test(q.text)));
});
