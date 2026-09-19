import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { source, ts } = require('./source-harness.cjs');
const key = companyId => ['/api/brand', companyId, 'refresh-profile', 'status'];

function fixture(initial, error = null) {
  const file = 'client/src/hooks/use-brand-profile-refresh.ts';
  const ast = ts.createSourceFile(file, source(file), ts.ScriptTarget.Latest, true);
  const script = ast.statements.filter(node => !ts.isImportDeclaration(node)).map(node => node.getText(ast)).join('\n');
  const cache = new Map([[JSON.stringify(key('first')), initial && { ...initial, companyId: 'first' }]]), requests = [], invalidated = [];
  const handled = { current: '' };
  let query, mutation, effects;
  const sandbox = { exports: {}, require, useRef: () => handled, useEffect: fn => effects.push(fn), getAuthHeaders: () => ({}),
    useQueryClient: () => ({ cancelQueries: async () => {}, setQueryData: (queryKey, value) => cache.set(JSON.stringify(queryKey), value), invalidateQueries: async options => invalidated.push(options.queryKey) }),
    useQuery: options => { query = options; return { data: cache.get(JSON.stringify(options.queryKey)), isError: !!error, error }; },
    useMutation: options => { mutation = options; return { isPending: false, mutate: id => requests.push({ method: 'mutate', id }) }; },
    apiRequest: async (method, url) => { requests.push({ method, url }); return { json: async () => ({ status: 'running' }) }; },
    fetch: async (url, options) => { requests.push({ method: 'GET', url, options }); return { ok: true, json: async () => ({ status: 'running' }) }; },
  };
  vm.runInNewContext(ts.transpileModule(script, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, sandbox);
  const render = (id = 'first', enabled = true) => { effects = []; const result = sandbox.exports.useBrandProfileRefresh(id, enabled); for (const effect of effects) effect(); return result; };
  render();
  return { render, cache, requests, invalidated, message: sandbox.exports.profileRefreshMessage, get query() { return query; }, get mutation() { return mutation; } };
}

test('restored running profile job shows progress and polls only the read-only status endpoint', async () => {
  const app = fixture({ status: 'running' });
  const result = app.render();
  assert.equal(result.isPending, true);
  assert.match(result.message, /Refreshing saved facts/);
  assert.equal(app.requests.length, 0);
  assert.equal(app.query.refetchOnMount, 'always');
  assert.equal(app.query.refetchInterval({ state: { status: 'success', data: { status: 'running' } } }), 5_000);
  const signal = new AbortController().signal;
  await app.query.queryFn({ signal });
  assert.equal(app.requests[0].method, 'GET');
  assert.equal(app.requests[0].url, '/api/brand/first/refresh-profile/status');
  assert.equal(app.requests[0].options.signal, signal);
});

test('completed, unchanged, blocked, and failed profile outcomes remain explicit after remount', () => {
  for (const [status, expected] of [
    [{ status: 'done', updated: ['description'] }, /New information has been saved/],
    [{ status: 'done', updated: [] }, /No saved facts changed/],
    [{ status: 'needs_review', reason: 'Confirm the company website first.' }, /Confirm the company website first/],
    [{ status: 'error', reason: 'The research provider could not be reached.' }, /could not be reached/],
  ]) {
    const app = fixture(status), result = app.render();
    assert.equal(result.isPending, false);
    assert.match(result.message, expected);
    assert.equal(app.query.refetchInterval({ state: { data: status } }), false);
  }
});

test('explicit refresh and late callbacks always use their captured company', async () => {
  const app = fixture({ status: 'idle' });
  app.cache.set(JSON.stringify(key('second')), { companyId: 'second', status: 'done', updated: [] });
  app.render('second');
  await app.mutation.onMutate('first');
  const result = await app.mutation.mutationFn('first');
  app.mutation.onSuccess(result, 'first');
  assert.equal(app.requests[0].url, '/api/brand/enrich/first');
  assert.equal(app.cache.get(JSON.stringify(key('first'))).status, 'running');
  assert.equal(app.render('second').isPending, false);
  assert.match(app.render('second').message, /No saved facts changed/);
  app.mutation.onError(new Error('First company failed'), 'first');
  assert.equal(app.render('first').message, 'First company failed');
  assert.doesNotMatch(app.render('second').message, /First company failed/);
});

test('terminal completion refreshes dependent records once without invalidating its status poll', () => {
  const app = fixture({ status: 'running' });
  app.cache.set(JSON.stringify(key('first')), { companyId: 'first', status: 'done', updated: ['description'] });
  app.render();
  assert.equal(app.invalidated.length, 4);
  assert.equal(app.invalidated.some(queryKey => queryKey.includes('refresh-profile')), false);
  app.render();
  assert.equal(app.invalidated.length, 4);
});

test('failed status check exposes a retryable message and stops stale running polling', () => {
  const app = fixture({ status: 'running' }, new Error('Refresh progress could not be checked. Please try again.'));
  assert.equal(app.render().isPending, false);
  assert.match(app.render().message, /could not be checked/);
  assert.equal(app.query.refetchInterval({ state: { status: 'error', data: { status: 'running' } } }), false);
});

test('disabled staff-only controls do not enable status reads or surface messages to clients', () => {
  const app = fixture({ status: 'error', reason: 'Internal research error' });
  const result = app.render('first', false);
  assert.equal(app.query.enabled, false);
  assert.equal(result.message, '');
  assert.equal(result.isPending, false);
  assert.equal(app.requests.length, 0);
});
