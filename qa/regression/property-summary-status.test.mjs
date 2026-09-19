import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LETTING_STATUSES, WIP_STATUSES, DEAL_STATUS_LABELS, legacyToCode } from '../../shared/deal-status.ts';
const require = createRequire(import.meta.url);
const { source, ts } = require('./source-harness.cjs');

function fixture(kind, { units = [], deals = [], failed = false, loading = false, dealsFailed = false, status = 200 } = {}) {
  const file = `client/src/components/${kind}-summary.tsx`, exports = {}, queries = [], fetches = [];
  const ast = ts.createSourceFile(file, source(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const hook = kind === 'tracker' ? 'useTrackerUnits' : 'useBoardDeals';
  const input = ast.statements.filter(node => !ts.isImportDeclaration(node)).map(node => node.getText(ast)).join('\n') + `\nexport { ${hook} };`;
  const code = ts.transpileModule(input, { fileName: 'fixture.tsx', compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText;
  const wrap = ({ children }) => React.createElement('span', {}, children), empty = () => null;
  vm.runInNewContext(code, {
    exports, React, URLSearchParams, LETTING_STATUSES, WIP_STATUSES, DEAL_STATUS_LABELS, legacyToCode,
    DEAL_STATUS_BADGE_COLORS: {}, DEAL_STATUS_DOT_COLORS: {}, useMemo: fn => fn(),
    Link: ({ children, href }) => React.createElement('a', { href }, children), Badge: wrap, Button: wrap, Store: empty, Handshake: empty, ChevronRight: empty,
    getAuthHeaders: () => ({ Authorization: 'Bearer fixture' }),
    fetch: async (url, options) => { fetches.push({ url, options }); return { ok: status === 200, status, json: async () => [] }; },
    useQuery: options => {
      queries.push(options);
      const isUnits = options.queryKey[0] === '/api/available-units';
      return { data: isUnits ? units : deals, isLoading: loading, isError: isUnits || kind === 'deals' ? failed : dealsFailed, refetch: async () => {} };
    },
  });
  return { queries, fetches, hook: exports[hook], render: props => renderToStaticMarkup(React.createElement(exports[kind === 'tracker' ? 'TrackerSummary' : 'DealsSummary'], props)) };
}

test('HOT and legacy heads-of-terms units appear in both tracker count and live list', () => {
  for (const marketingStatus of ['HOT', 'HOTs', 'Heads of Terms']) {
    const test = fixture('tracker', { units: [{ id: 'u1', propertyId: 'property', unitName: 'Ground shop', marketingStatus }] });
    const model = test.hook('property');
    assert.equal(model.counts.HOT, 1);
    assert.equal(model.live.length, 1);
    const html = test.render({ propertyId: 'property', variant: 'card' });
    assert.match(html, /Ground shop/);
    assert.match(html, /1.*live letting/);
    assert.doesNotMatch(html, /Nothing live/);
    assert.match(html, /propertyId=property&amp;status=HOT/);
  }
});

test('linked deal status remains authoritative and completed listings are not treated as live', () => {
  const test = fixture('tracker', { units: [
    { id: 'live', propertyId: 'property', marketingStatus: 'AVA', dealId: 'hot-deal' },
    { id: 'done', propertyId: 'property', marketingStatus: 'HOT', dealId: 'done-deal' },
  ], deals: [{ id: 'hot-deal', status: 'HOT' }, { id: 'done-deal', status: 'COM' }] });
  const model = test.hook('property');
  assert.deepEqual(Array.from(model.live, unit => unit.id), ['live']);
  assert.equal(model.counts.HOT, 1);
  assert.equal(model.counts.COM, 1);
});

test('HOT deals appear live without changing the Deals board tracker-exclusion request or property scope', async () => {
  const test = fixture('deals', { deals: [{ id: 'hot', propertyId: 'property', name: 'Recorded HOT deal', status: 'HOT' }, { id: 'other', propertyId: 'other', status: 'HOT' }] });
  const model = test.hook('property');
  assert.equal(model.counts.HOT, 1);
  assert.equal(model.live.length, 1);
  const html = test.render({ propertyId: 'property', variant: 'card' });
  assert.match(html, /Recorded HOT deal/);
  assert.doesNotMatch(html, /Nothing live/);
  await test.queries[0].queryFn();
  assert.equal(test.fetches[0].url, '/api/crm/deals?excludeTrackerDeals=true');
  assert.equal(test.fetches[0].options.headers.Authorization, 'Bearer fixture');
});

test('summary query errors throw instead of returning an apparently empty board', async () => {
  for (const kind of ['tracker', 'deals']) {
    const test = fixture(kind, { status: 503 }); test.hook('property');
    await assert.rejects(test.queries[0].queryFn(), /lookup failed \(503\)/);
  }
});

test('both summary variants distinguish loading/failure from no live records, including linked-deal lookup failure', () => {
  for (const kind of ['tracker', 'deals']) for (const variant of ['card', 'strip']) for (const state of [{ failed: true }, { loading: true }]) {
    const html = fixture(kind, state).render({ propertyId: 'property', variant });
    assert.doesNotMatch(html, /Nothing live|0<\/span>.*live/);
    assert.match(html, state.failed ? /could not be loaded/ : /Loading/);
  }
  assert.match(fixture('tracker', { dealsFailed: true }).render({ propertyId: 'property', variant: 'card' }), /could not be loaded/);
});
