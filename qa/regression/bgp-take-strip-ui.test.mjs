import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import React from 'react';
const require = createRequire(import.meta.url);
const { source, ts } = require('./source-harness.cjs');
function nodes(node) { return Array.isArray(node) ? node.flatMap(nodes) : React.isValidElement(node) ? [node, ...nodes(node.props.children)] : []; }
function text(node) { return Array.isArray(node) ? node.map(text).join(' ') : React.isValidElement(node) ? text(node.props.children) : node == null ? '' : String(node); }
const key = target => ['/api/brand', target.companyId, 'ai-take', target.tab];
const original = { companyId: 'first-brand', tab: 'brand' };

function fixture(initial, queryError = null) {
  const file = 'client/src/components/bgp-take-strip.tsx';
  const ast = ts.createSourceFile(file, source(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const script = ast.statements.filter(node => !ts.isImportDeclaration(node)).map(node => node.getText(ast)).join('\n');
  const cache = new Map([[JSON.stringify(key(original)), initial]]), toasts = [], fetches = [], cancelled = [];
  let state = null, query, mutation;
  const sandbox = { exports: {}, require, Date, Sparkles: 'Sparkles', RefreshCw: 'RefreshCw', Button: 'Button', AiCommentary: 'AiCommentary',
    useState: () => [state, value => { state = typeof value === 'function' ? value(state) : value; }],
    useToast: () => ({ toast: value => toasts.push(value) }), getAuthHeaders: () => ({}),
    useQuery: options => { query = options; return { data: cache.get(JSON.stringify(options.queryKey)), isLoading: false, isError: !!queryError, error: queryError }; },
    useMutation: options => { mutation = options; return { isPending: false, mutate() {} }; },
    queryClient: { setQueryData: (queryKey, value) => cache.set(JSON.stringify(queryKey), value), cancelQueries: async options => cancelled.push(options.queryKey) },
    fetch: async (url, options) => { fetches.push({ url, options }); return { ok: true, json: async () => ({ text: 'Prepared text', generatedAt: 1 }) }; },
  };
  vm.runInNewContext(ts.transpileModule(script, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, sandbox);
  const render = (target = original) => sandbox.exports.BgpTakeStrip(target);
  render();
  return { render, cache, toasts, fetches, cancelled, get query() { return query; }, get mutation() { return mutation; } };
}

test('empty or pending refresh never reports success and its reason remains in the card', () => {
  for (const response of [{ text: '' }, { text: ' \n ' }, { text: '', pending: true, reason: 'Confirm the official website first.' }]) {
    const app = fixture();
    app.mutation.onSuccess(response, original);
    assert.equal(app.toasts.some(toast => toast.title === 'BGP take refreshed'), false);
    const status = nodes(app.render()).find(node => node.props['data-testid'] === 'bgp-take-status');
    assert.ok(status);
    assert.match(text(status), response.reason ? /Confirm the official website first/ : /not been prepared/);
    assert.equal(status.props.role, 'status');
  }
});

test('only a completed nonempty brief gives the success toast and renders commentary', () => {
  const app = fixture();
  app.mutation.onSuccess({ text: '  Call the confirmed property contact.  ', generatedAt: 1 }, original);
  assert.equal(app.toasts[0].title, 'BGP take refreshed');
  const tree = app.render();
  assert.equal(nodes(tree).find(node => node.type === 'AiCommentary').props.text, 'Call the confirmed property contact.');
  assert.equal(nodes(tree).some(node => node.props['data-testid'] === 'bgp-take-status'), false);
});

test('a blocked refresh keeps supplied saved text visible with its reason without claiming success', () => {
  const app = fixture();
  app.mutation.onSuccess({ text: 'Saved brief', pending: true, reason: 'Review the retained facts before refreshing.' }, original);
  const tree = app.render();
  assert.equal(nodes(tree).find(node => node.type === 'AiCommentary').props.text, 'Saved brief');
  assert.match(text(tree), /Review the retained facts/);
  assert.equal(app.toasts.some(toast => toast.title === 'BGP take refreshed'), false);
  assert.equal(app.query.refetchInterval({ state: { data: { pending: true, reason: 'Review needed' } } }), false);
});

test('explicit running response polls ordinary GET only and stops when the prepared text arrives', async () => {
  const app = fixture();
  app.mutation.onSuccess({ text: '', pending: true, running: true }, original);
  const tree = app.render();
  assert.match(text(tree), /Preparing the BGP brief/);
  assert.equal(nodes(tree).find(node => node.type === 'Button').props.disabled, true);
  assert.equal(app.query.refetchInterval({ state: { data: { running: true } } }), 5_000);
  const controller = new AbortController();
  const response = await app.query.queryFn({ signal: controller.signal });
  assert.equal(app.fetches[0].url, '/api/brand/first-brand/ai-take/brand');
  assert.equal(app.fetches[0].options.signal, controller.signal);
  app.cache.set(JSON.stringify(key(original)), response);
  assert.equal(nodes(app.render()).find(node => node.type === 'AiCommentary').props.text, 'Prepared text');
  assert.equal(app.query.refetchInterval({ state: { data: response } }), false);
  assert.equal(app.toasts.length, 0);
});

test('failed refresh stays visible beside the saved brief and unwraps API JSON errors', () => {
  const app = fixture({ text: 'Saved brief' });
  app.mutation.onError(new Error('{"error":"AI service unavailable"}'), original);
  const tree = app.render();
  assert.match(text(tree), /AI service unavailable/);
  assert.doesNotMatch(text(tree), /\{"error"/);
  assert.equal(nodes(tree).find(node => node.type === 'AiCommentary').props.text, 'Saved brief');
  assert.equal(app.toasts[0].variant, 'destructive');
});

test('late refresh callbacks and failures cannot overwrite or label another company or tab', async () => {
  const app = fixture();
  const destination = { companyId: 'second-brand', tab: 'uk' };
  app.cache.set(JSON.stringify(key(destination)), { text: 'Other company brief' });
  app.render(destination);
  await app.mutation.onMutate(original);
  await app.mutation.mutationFn(original);
  app.mutation.onSuccess({ text: 'First company result' }, original);
  app.mutation.onError(new Error('First company refresh failed'), original);
  const current = app.render(destination);
  assert.equal(nodes(current).find(node => node.type === 'AiCommentary').props.text, 'Other company brief');
  assert.doesNotMatch(text(current), /First company refresh failed/);
  assert.equal(app.fetches[0].url, '/api/brand/first-brand/ai-take/brand?refresh=1');
  assert.deepEqual(Array.from(app.cancelled[0]), key(original));
  assert.equal(app.cache.get(JSON.stringify(key(original))).text, 'First company result');
});

test('read errors are persistent accessible messages rather than raw JSON', () => {
  const app = fixture(undefined, new Error('{"error":"Saved brief unavailable"}'));
  const status = nodes(app.render()).find(node => node.props['data-testid'] === 'bgp-take-status');
  assert.equal(text(status), 'Saved brief unavailable');
  assert.equal(status.props['aria-live'], 'polite');
});
