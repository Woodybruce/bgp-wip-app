import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { route, evaluate } = require('./source-harness.cjs');

function handlerFor(cache, clientViewer = null) {
  let handler, calls = 0; const cacheReads = [];
  evaluate(route('server/activity-routes.ts', 'get', '/api/activity/:subjectType/:subjectId'), {
    app: { get: (_path, _auth, callback) => { handler = callback; } }, requireAuth: () => {},
    VALID_TYPES: ['brand', 'landlord', 'contact', 'deal', 'property'],
    resolveClientViewer: async () => clientViewer,
    readCache: async (type, id) => { cacheReads.push({ type, id }); return cache; },
    curationKey: (type, id) => `${type}:${id}`, pendingCurations: new Map(), recentCurationFailures: new Map(),
    CURATION_FAILURE_COOLDOWN_MS: 600000, DEGRADED_CURATION_RE: /poisoned/,
    buildSubject: async () => { calls++; return null; },
    curateActivity: async () => { throw new Error('Cached read must never call provider'); },
  });
  return { get calls() { return calls; }, cacheReads, run: async (query = { cachedOnly: '1' }) => {
    let body; const response = { json: data => { body = data; }, status: () => response };
    await handler({ params: { subjectType: 'brand', subjectId: 'brand-test' }, query }, response);
    return body;
  } };
}

test('cached brand reads never start provider jobs for missing, stale or degraded output', async () => {
  for (const cache of [null, { markdown: 'Saved relationship summary', generatedAt: '2025-01-01' }, { markdown: 'poisoned', generatedAt: '2026-09-10' }]) {
    const route = handlerFor(cache); const result = await route.run();
    assert.equal(route.calls, 0); assert.equal(result.inFlight, false);
    assert.equal(result.markdown, cache?.markdown === 'Saved relationship summary' ? cache.markdown : '');
  }
});

test('cached read preserves client-specific cache separation', async () => {
  const route = handlerFor(null, { companyId: 'landsec-test', companyName: 'Synthetic client' });
  await route.run();
  assert.deepEqual(route.cacheReads, [{ type: 'brand', id: 'brand-test@client:landsec-test' }]);
  assert.equal(route.calls, 0);
});

test('existing non-cached-only surfaces retain their refresh behavior', async () => {
  const route = handlerFor(null); await route.run({}); assert.equal(route.calls, 1);
});
