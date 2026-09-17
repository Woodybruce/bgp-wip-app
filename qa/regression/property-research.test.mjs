import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { propertyResearchContext } from '../../shared/property-research.ts';
const require = createRequire(import.meta.url);
const { find, evaluate, ts } = require('./source-harness.cjs');
const file = 'server/property-gap-analysis.ts';
const response = () => ({ code: 200, body: null, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });

test('office and industrial buildings do not become shopping destinations because of layout or old caches', () => {
  for (const assetClass of ['Office', 'Offices', 'Industrial Estate', 'Residential', '', null]) {
    assert.equal(propertyResearchContext({ assetClass, propertyView: 'centre' }).mode, 'not_applicable');
  }
  assert.equal(propertyResearchContext({ assetClass: 'Office' }, [{ permitted_use: 'Restaurant', status: ' Archived ' }]).mode, 'not_applicable');
  assert.equal(propertyResearchContext({ assetClass: 'Office' }, [{ permitted_use: 'Restaurant', status: 'Occupied', occupancy_status: ' Archived ' }]).mode, 'not_applicable');
  assert.equal(propertyResearchContext({ assetClass: 'Office' }, [{ permitted_use: 'Restaurant', status: null, occupancy_status: 'ARCHIVED' }]).mode, 'not_applicable');
});

test('research distinguishes local retail opportunities from a recorded centre', () => {
  assert.equal(propertyResearchContext({ assetClass: 'Retail' }).mode, 'local');
  assert.equal(propertyResearchContext({ assetClass: 'Office' }, [{ permitted_use: 'Ground floor café', status: 'Occupied' }]).mode, 'local');
  assert.equal(propertyResearchContext({ assetClass: 'Mixed Use' }, [{ permitted_use: 'F&B', status: 'Vacant' }]).mode, 'local');
  assert.equal(propertyResearchContext({ assetClass: 'Office' }, [{ permitted_use: 'E(g)(i) offices' }]).mode, 'not_applicable');
  assert.equal(propertyResearchContext({ assetClass: 'Retail', propertyView: 'centre' }).mode, 'centre');
  assert.equal(propertyResearchContext({ assetClass: 'Shopping Centre' }).mode, 'centre');
  assert.equal(propertyResearchContext({ assetClass: 'Retail Park' }).mode, 'centre');
});

test('current retail and hospitality use codes and common plural labels remain eligible', () => {
  for (const permitted_use of ['E(a)', 'Class E(b)', 'E ( d )', 'A1', 'A3', 'Shops', 'Restaurants', 'Cafés', 'Gyms', 'Bars', 'Pubs', 'Kiosks', 'Takeaways', 'F & B']) {
    const units = [{ permitted_use, status: 'Occupied' }];
    assert.equal(propertyResearchContext({ assetClass: 'Mixed Use' }, units).mode, 'local', permitted_use);
    assert.equal(propertyResearchContext({ assetClass: 'Office' }, [{ ...units[0], status: ' Archived ' }]).mode, 'not_applicable', permitted_use);
    assert.equal(propertyResearchContext({ assetClass: 'Office' }, [{ ...units[0], occupancy_status: ' Archived ' }]).mode, 'not_applicable', permitted_use);
  }
  for (const permitted_use of ['E', 'Class E', 'E(c)', 'E(e)', 'E(f)', 'E(g)', 'E(g)(i)', 'B8', 'Offices', 'Workshop', 'Barcode storage']) {
    assert.equal(propertyResearchContext({ assetClass: 'Mixed Use' }, [{ permitted_use }]).mode, 'not_applicable', permitted_use);
  }
});

test('research cache identity changes when relevant property facts change, but not when rows reorder', () => {
  const units = [{ permitted_use: 'Retail' }, { permitted_use: 'Office' }];
  const a = propertyResearchContext({ assetClass: 'Mixed Use' }, units);
  assert.equal(a.cacheKey, propertyResearchContext({ assetClass: 'Mixed Use' }, [...units].reverse()).cacheKey);
  assert.notEqual(a.cacheKey, propertyResearchContext({ assetClass: 'Shopping Centre' }, units).cacheKey);
  assert.notEqual(a.cacheKey, propertyResearchContext({ assetClass: 'Mixed Use' }, [{ permitted_use: 'Office' }]).cacheKey);
});

function routeFixture(section, { context = propertyResearchContext({ assetClass: 'Office' }), matches = false, denied = false } = {}) {
  const url = '/api/property/:propertyId/brand-gaps' + (section ? '/' + section : '');
  const source = find(file, node => ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.expression.getText() === 'router' && ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === url);
  let handler, fetches = 0, locations = 0, providerImports = 0;
  const scope = { resolveCompanyScope: async () => denied ? 'client' : null, isPropertyInScope: async () => !denied, isClientRequestUser: async () => denied };
  evaluate(source, {
    router: { get: (_url, _auth, callback) => { handler = callback; } }, requireAuth() {},
    ensureGapColumns: async () => {}, readPropertyResearchContext: async () => context,
    researchCacheMatches: async () => matches,
    resolvePropertyLocation: async () => { locations++; throw new Error('Location must not be read for offices'); },
    pool: { query: async sql => ({ rows: /^\s*ALTER/.test(sql) ? [] : [{ name: 'Test property', gap_commentary: 'Cached commentary', gap_commentary_at: new Date().toISOString(), gap_live_intel: { brands: [{ name: 'Example' }] }, gap_live_intel_at: new Date().toISOString(), gap_intl: [{ name: 'Example' }], gap_intl_at: new Date().toISOString() }] }) },
    process: { env: {} },
    fetch: async () => { fetches++; return { ok: false, status: 503 }; },
    require: name => { if (name === './company-scope') return scope; providerImports++; throw new Error(`Unexpected provider import ${name}`); },
  });
  return { async run() { const res = response(); await handler({ params: { propertyId: 'property' }, query: {}, headers: {} }, res); return res; }, get calls() { return { fetches, locations, providerImports }; } };
}

test('all gap routes reject irrelevant office analysis before geocoding, stale-cache display or AI calls', async () => {
  for (const section of ['', 'commentary', 'live-intel', 'international']) {
    const f = routeFixture(section); const result = await f.run();
    assert.equal(result.code, 200); assert.equal(result.body.applicable, false, section);
    assert.deepEqual(f.calls, { fetches: 0, locations: 0, providerImports: 0 });
  }
});

test('international centre watchlists are not generated for a high-street retail unit', async () => {
  const f = routeFixture('international', { context: propertyResearchContext({ assetClass: 'Retail' }) });
  assert.equal((await f.run()).body.applicable, false);
  assert.equal(f.calls.providerImports, 0);
});

test('context-matching prepared commentary remains available without generation', async () => {
  for (const assetClass of ['Shopping Centre', 'Retail']) {
    const f = routeFixture('commentary', { context: propertyResearchContext({ assetClass }), matches: true });
    assert.equal((await f.run()).body.text, 'Cached commentary'); assert.equal(f.calls.fetches, 0);
  }
});

test('old shopping-centre commentary is not reused after property context changes', async () => {
  const f = routeFixture('commentary', { context: propertyResearchContext({ assetClass: 'Retail' }), matches: false });
  const result = await f.run();
  assert.equal(result.code, 503); assert.equal(result.body.text, undefined);
  assert.equal(f.calls.fetches, 1);
});

test('existing property access gates still run before any research decision', async () => {
  for (const section of ['', 'commentary', 'live-intel', 'international']) {
    const f = routeFixture(section, { denied: true }); assert.equal((await f.run()).code, 403);
    assert.deepEqual(f.calls, { fetches: 0, locations: 0, providerImports: 0 });
  }
});

test('research result and context identity commit together, rolling back a failed metadata save', async () => {
  const fn = find(file, node => ts.isFunctionDeclaration(node) && node.name?.text === 'saveResearchResult');
  for (const fail of [false, true]) {
    const queries = []; let released = false;
    const { saveResearchResult } = evaluate(`${fn}\nexports.saveResearchResult = saveResearchResult;`, {
      pool: { connect: async () => ({ query: async (sql, values) => { queries.push([sql, values]); if (fail && sql.includes('INSERT INTO system_settings')) throw new Error('metadata failed'); }, release() { released = true; } }) },
    });
    const run = saveResearchResult('property', 'commentary', propertyResearchContext({ assetClass: 'Retail' }), 'Local research');
    if (fail) await assert.rejects(run, /metadata failed/); else await run;
    assert.equal(queries[0][0], 'BEGIN');
    assert.equal(queries.at(-1)[0], fail ? 'ROLLBACK' : 'COMMIT');
    assert.equal(queries[1][1][0], 'Local research'); assert.equal(released, true);
  }
});
