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
// held the unit's raw class text. Since 19 November 2026 both dialogs read
// the one fit rule (requirementFit).

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
    // The pool is the units on the market: the route asks for those statuses in SQL.
    if (/FROM available_units au/.test(text)) return { rows: units.filter(u => (params[0] || []).includes(u.marketing_status)) };
    throw new Error(`unexpected query ${text}`);
  } };
  const run = load('/api/requirements/matches/:requirementId', { pool });
  return { sql, run: () => run({ params: { requirementId: requirement.id }, query: { type: 'leasing' } }) };
}

// The one fit rule (Woody, 2026-11-19, decision 2 of
// docs/requirements-board-review-2026-11-19.md): the size in the requirement's
// range and the use or a place it names; with no size to compare, both. The
// dialog matches over the same units as the board's Fits column (on the
// market: Marketing or Negotiating) and puts them in the same order.
const UNITS = [
  { id: 'u-eb', unit_name: 'Unit 2', use_class: 'E(b)', sqft: 2000, marketing_status: 'AVA', property_id: 'p-1', property_name: 'Bluewater', tenancy_unit_id: 'ts-2' },
  { id: 'u-a3', unit_name: 'Unit 7', use_class: 'A3', sqft: 2500, marketing_status: 'NEG', property_id: 'p-1', property_name: 'Bluewater' },
  { id: 'u-shop', unit_name: 'Unit 3', use_class: 'E(a)', sqft: 2000, marketing_status: 'AVA', property_id: 'p-1', property_name: 'Bluewater' },
  { id: 'u-big', unit_name: 'Unit 4', use_class: 'E(b)', sqft: 9000, marketing_status: 'AVA', property_id: 'p-1', property_name: 'Bluewater' },
  { id: 'u-hot', unit_name: 'Unit 5', use_class: 'E(b)', sqft: 2000, marketing_status: 'HOT', property_id: 'p-1', property_name: 'Bluewater' },
  { id: 'u-blank', unit_name: 'Unit 11', use_class: null, sqft: 2000, marketing_status: 'NEG', property_id: 'p-1', property_name: 'Bluewater' },
  { id: 'u-nosize', unit_name: 'Unit 12', use_class: 'E(b)', sqft: null, marketing_status: 'AVA', property_id: 'p-1', property_name: 'Bluewater' },
];

test('Match dialog: a Restaurant requirement is offered the units on the market whose size and use fit, each with why', async () => {
  const m = requirementMatches({ id: 'req-1', name: 'KFC', size: ['1,500-3,000 sq ft'], use: ['Restaurant'], requirement_locations: null }, UNITS);
  const { code, body } = await m.run();
  assert.equal(code, 200, JSON.stringify(body));
  // Not the shop (use), the big unit (size), the unit at Heads of Terms (not on
  // the market), the unit with no use class (no use or place to line up) or
  // the unit with no size (it would need both a use and a place).
  assert.deepEqual(body.map(u => u.id), ['u-eb', 'u-a3']);
  assert.deepEqual(body.map(u => u.fit_why), ['Size and use fit', 'Size and use fit']);
  assert.equal(body[0].fit_count, 2);
  const unitQuery = m.sql.find(q => /FROM available_units au/.test(q.text));
  assert.doesNotMatch(unitQuery.text, /use_class = ANY/);
  assert.match(unitQuery.text, /au\.marketing_status = ANY\(\$1::text\[\]\)/);
  assert.deepEqual(JSON.parse(JSON.stringify(unitQuery.params[0])), ['AVA', 'NEG']);
  // Each unit carries its schedule row by the stored ties, so it opens the unit.
  assert.match(unitQuery.text, /COALESCE\(au\.tenancy_unit_id::text,[\s\S]*letting_tracker_unit_id = au\.id[\s\S]*AS schedule_row_id/);
});

test('Match dialog: a place it names stands in for the use; with no size it needs both; twenty at most', async () => {
  const placed = await requirementMatches({ id: 'req-2', name: 'Any', size: ['1,500-3,000 sq ft'], use: null, requirement_locations: ['Bluewater'] }, UNITS).run();
  assert.deepEqual(placed.body.map(u => u.id), ['u-eb', 'u-shop', 'u-blank', 'u-a3']);
  assert.ok(placed.body.every(u => u.fit_why === 'Size fits, at Bluewater'));
  // No size on the requirement: only a unit whose use AND place line up, and
  // then the unit's own size does not count (the big unit fits).
  const noSize = await requirementMatches({ id: 'req-4', name: 'Cafe', size: null, use: ['Restaurant'], requirement_locations: ['Bluewater'] }, UNITS).run();
  assert.deepEqual(noSize.body.map(u => u.id), ['u-eb', 'u-a3', 'u-big', 'u-nosize']);
  assert.ok(noSize.body.every(u => u.fit_why === 'Use fits, at Bluewater; no size to compare'));
  // A size alone fits nothing.
  const sizeOnly = await requirementMatches({ id: 'req-5', name: 'Shop', size: ['2000'], use: null, requirement_locations: null }, UNITS).run();
  assert.deepEqual(sizeOnly.body, []);
  const many = Array.from({ length: 25 }, (_, i) => ({ id: `u-${i}`, unit_name: `Unit ${i}`, use_class: 'E(b)', sqft: 2000, marketing_status: 'AVA' }));
  const capped = await requirementMatches({ id: 'req-3', name: 'Cafe', size: ['1,500-3,000'], use: ['Restaurant'] }, many).run();
  assert.deepEqual(capped.body.map(u => u.id), many.slice(0, 20).map(u => u.id));
  assert.equal(capped.body[0].fit_count, 25);
});

const CANDIDATES = [
  { id: 'r-retail', size: ['1,500-3,000 sq ft'], use: ['Retail'] },
  { id: 'r-rest', size: ['1,500-3,000 sq ft'], use: ['Restaurant'] },
  { id: 'r-none', size: ['1,500-3,000 sq ft'], use: null },
  { id: 'r-a3', size: ['1,500-3,000 sq ft'], use: ['A3'] },
  { id: 'r-gym', size: ['1,500-3,000 sq ft'], use: ['Gym'] },
  { id: 'r-food', size: ['1,500-3,000 sq ft'], use: ['A1 Food'] },
  { id: 'r-big', size: ['5,000-8,000 sq ft'], use: ['Restaurant'] },
  { id: 'r-place', size: ['1,500-3,000 sq ft'], use: null, requirement_locations: ['Bluewater'] },
];
const fullRow = c => ({ ...c, name: c.id, company_id: `co-${c.id}`, company_name: c.id, company_type: 'Tenant - Restaurant', status: 'Active',
  origin: 'pipnet', sources: ['PIPnet'], last_listed_at: '2026-11-01T00:00:00Z', last_listed_source: 'PIPnet', bgp_contact_user_ids: ['u-staff'], updated_at: '2026-11-02T00:00:00Z' });

function unitMatches({ unit = { id: 'unit-1', property_id: 'p-1', unit_name: 'Unit 2', use_class: 'E(b)', sqft: 2000, location: null }, candidates = CANDIDATES, scope = null, outside = false } = {}) {
  const sql = [];
  const pool = { query: async (text, params = []) => {
    sql.push({ text, params });
    if (/FROM available_units WHERE id = \$1/.test(text)) return { rows: [unit] };
    if (/FROM crm_properties WHERE id = \$1/.test(text)) return { rows: [{ name: 'Bluewater', address: '{"formatted":"Greenhithe DA9 9ST"}' }] };
    if (/SELECT r\.id, r\.size, r\.use, r\.requirement_locations FROM crm_requirements_leasing r/.test(text)) return { rows: candidates };
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

test('Find matching requirements: an E(b) unit of 2,000 sq ft finds the requirements whose size and use, or size and place, fit', async () => {
  const m = unitMatches();
  const { code, body } = await m.run();
  assert.equal(code, 200, JSON.stringify(body));
  // Not Retail or Gym (use), not the one naming no use or place (size alone),
  // not the 5,000 to 8,000 sq ft one (size).
  assert.deepEqual(body.map(r => r.id), ['r-rest', 'r-a3', 'r-food', 'r-place']);
  assert.deepEqual(body.map(r => r.fit_why), ['Size and use fit', 'Size and use fit', 'Size and use fit', 'Size fits, at Bluewater']);
  assert.ok(body.every(r => r.state && r.date_label), 'staff get each row\'s state and dated line');
  const candidateQuery = m.sql.find(q => /SELECT r\.id, r\.size, r\.use/.test(q.text));
  assert.doesNotMatch(candidateQuery.text, /ANY\(r\.use\)/);
  assert.ok(!candidateQuery.params.includes('E(b)'), 'the unit\'s class is not compared as text in SQL');
  assert.match(candidateQuery.text, /<> 'closed'/);
  assert.match(candidateQuery.text, /ORDER BY \(CASE/);
});

test('Find matching requirements: twenty at most, and a client is sent its own cut of them', async () => {
  const many = Array.from({ length: 30 }, (_, i) => ({ id: `r-${i}`, size: ['1,500-3,000'], use: ['Restaurant'] }));
  const capped = unitMatches({ candidates: many });
  assert.deepEqual((await capped.run()).body.map(r => r.id), many.slice(0, 20).map(r => r.id));
  assert.equal(capped.sql.find(q => /r\.id = ANY/.test(q.text)).params[0].length, 20);

  const client = unitMatches({ scope: 'client-co' });
  const { body } = await client.run();
  assert.deepEqual(body.map(r => r.id), ['r-rest', 'r-a3', 'r-food', 'r-place']);
  for (const row of body) for (const key of ['state', 'origin', 'last_listed_at', 'bgp_contact_user_ids', 'updated_at']) assert.ok(!(key in row), `${key} sent to a client`);
  // Every requirement is open to a client since 17 November 2026: no PIPnet
  // cut, and newest first (an order the live state moves would tell it which
  // ones BGP has confirmed).
  const clientQuery = client.sql.find(q => /SELECT r\.id, r\.size, r\.use/.test(q.text)).text;
  assert.doesNotMatch(clientQuery, /PIPnet/);
  assert.match(clientQuery, /<> 'closed' ORDER BY r\.created_at DESC/);
});

test('Find matching requirements: a unit outside the client\'s properties is refused before any requirement is read', async () => {
  const m = unitMatches({ outside: true });
  assert.equal((await m.run()).code, 403);
  assert.ok(!m.sql.some(q => /crm_requirements_leasing/.test(q.text)));
});
