import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import React from 'react';
const require = createRequire(import.meta.url);
const { source, ts } = require('./source-harness.cjs');
const nodes = node => Array.isArray(node) ? node.flatMap(nodes) : React.isValidElement(node) ? [node, ...nodes(node.props.children)] : [];
const text = node => Array.isArray(node) ? node.map(text).join(' ') : React.isValidElement(node) ? text(node.props.children) : node == null ? '' : String(node);

function load(file, bindings, name) {
  const ast = ts.createSourceFile(file, source(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const script = name ? ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name).getText(ast) + `\nexports.fn = ${name};`
    : ast.statements.filter(node => !ts.isImportDeclaration(node)).map(node => node.getText(ast)).join('\n');
  const sandbox = { exports: {}, require, Date, Set, String, useState: initial => [initial, () => {}], ...bindings };
  vm.runInNewContext(ts.transpileModule(script, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, sandbox);
  return sandbox.exports;
}

test('edited interviews refresh the previous and new landlords, never unrelated landlords or Brands', async () => {
  const keys = [
    ['/api/brand', 'old-landlord', 'ai-take', 'activity'], ['/api/brand', 'new-landlord', 'ai-take', 'activity'],
    ['/api/brand', 'unrelated-landlord', 'ai-take', 'activity'], ['/api/brand', 'brand', 'ai-take', 'brand'],
    ['/api/brand', 'old-landlord', 'profile'],
  ];
  const invalidated = [];
  const app = load('client/src/components/crm-meetings-tab.tsx', {
    apiRequest: async () => ({ json: async () => [{ interviewId: 'edited', companyId: 'new-landlord' }, { interviewId: 'other', companyId: 'unrelated-landlord' }] }),
    queryClient: {
      getQueriesData: () => [[[], [{ interviewId: 'edited', companyId: 'old-landlord' }, { interviewId: 'other', companyId: 'unrelated-landlord' }]]],
      invalidateQueries: async options => { if (options.predicate) invalidated.push(...keys.filter(queryKey => options.predicate({ queryKey }))); },
      fetchQuery: options => options.queryFn(),
    },
  }, 'refreshInterviewLandlordBriefs');
  await app.fn('edited');
  assert.deepEqual(invalidated, keys.slice(0, 2));
});

test('deleting a mention or a failed link refresh still refreshes the previous landlord and preserves successful-save status', async () => {
  for (const fail of [false, true]) {
    const invalidated = [];
    const app = load('client/src/components/crm-meetings-tab.tsx', {
      queryClient: {
        getQueriesData: () => [[[], [{ interviewId: 'deleted', companyId: 'aew' }]]],
        invalidateQueries: async options => { if (options.predicate) invalidated.push(options.predicate({ queryKey: ['/api/brand', 'aew', 'ai-take', 'activity'] })); },
        fetchQuery: async () => { if (fail) throw Error('Temporary source unavailable'); return []; },
      },
    }, 'refreshInterviewLandlordBriefs');
    await assert.doesNotReject(() => app.fn('deleted'));
    assert.deepEqual(invalidated, [true]);
  }
});

test('weekly coverage failures stay collapsed, and refresh updates profile and weekly calendar caches only', () => {
  let mutation;
  const invalidations = [];
  const app = load('client/src/components/landlord-weekly-meetings.tsx', {
    Link: 'Link', CalendarDays: 'CalendarDays', RefreshCw: 'RefreshCw', Button: 'Button', Skeleton: 'Skeleton',
    useQuery: () => ({ data: { meetings: [], week: { start: '2026-10-26T00:00:00Z', end: '2026-11-02T00:00:00Z' }, coverage: { status: 'partial', mailboxesChecked: 2, mailboxesExpected: 42, issues: Array.from({ length: 40 }, (_, i) => `Mailbox ${i} unavailable`) } } }),
    useMutation: options => { mutation = options; return {}; },
    queryClient: { invalidateQueries: options => invalidations.push(options) },
  });
  const tree = app.LandlordWeeklyMeetings();
  const details = nodes(tree).find(node => node.type === 'details');
  assert.equal(details.props.open, undefined);
  assert.match(text(details.props.children[0]), /Diary coverage details \(\s*40\s*\)/);
  assert.match(nodes(details).find(node => node.type === 'ul').props.className, /max-h-40 overflow-y-auto/);
  mutation.onSuccess();
  const predicate = invalidations[0].predicate;
  assert.equal(predicate({ queryKey: ['/api/crm/landlords', 'aew', 'meetings'] }), true);
  assert.equal(predicate({ queryKey: ['/api/crm/landlords/meetings/week'] }), true);
  assert.equal(predicate({ queryKey: ['/api/crm/landlords/interview-links'] }), false);
  assert.equal(predicate({ queryKey: ['/api/brand', 'brand', 'ai-take'] }), false);
});

test('weekly ordering retains in-progress meetings first and puts completed meetings in reverse chronological history', () => {
  const app = load('client/src/components/landlord-weekly-meetings.tsx', {}, 'splitLandlordWeekMeetings');
  const rows = [
    { id: 'later', start: '2026-10-30T09:00:00Z', end: '2026-10-30T10:00:00Z' },
    { id: 'monday', start: '2026-10-26T09:00:00Z', end: '2026-10-26T10:00:00Z' },
    { id: 'in-progress', start: '2026-10-27T10:00:00Z', end: '2026-10-27T12:00:00Z' },
    { id: 'this-morning', start: '2026-10-27T08:00:00Z', end: '2026-10-27T09:00:00Z' },
    { id: 'tomorrow', start: '2026-10-28T09:00:00Z', end: '2026-10-28T10:00:00Z' },
    { id: 'invalid', start: 'invalid', end: '2026-10-30T10:00:00Z' },
  ];
  const before = JSON.stringify(rows);
  const result = app.fn(rows, Date.parse('2026-10-27T11:00:00Z'));
  assert.deepEqual(Array.from(result.upcoming, row => row.id), ['in-progress', 'tomorrow', 'later']);
  assert.deepEqual(Array.from(result.earlier, row => row.id), ['this-morning', 'monday']);
  assert.equal(JSON.stringify(rows), before);
});

test('weekly board defaults to six upcoming cards, expands on request, and keeps past cards collapsed', () => {
  const now = new Date('2026-10-27T11:00:00Z');
  class FixedDate extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now.getTime(); } }
  const meetings = Array.from({ length: 8 }, (_, i) => ({ id: String(i), companyId: 'aew', companyName: 'AEW', subject: `Meeting ${i}`, participants: [], start: `2026-10-28T${String(i + 10).padStart(2, '0')}:00:00Z`, end: `2026-10-28T${String(i + 11).padStart(2, '0')}:00:00Z` }));
  meetings.unshift({ ...meetings[0], id: 'past', subject: 'Monday catch-up', start: '2026-10-26T09:00:00Z', end: '2026-10-26T10:00:00Z' });
  let showAll = false;
  const app = load('client/src/components/landlord-weekly-meetings.tsx', {
    Date: FixedDate, Link: 'Link', CalendarDays: 'CalendarDays', RefreshCw: 'RefreshCw', Button: 'Button', Skeleton: 'Skeleton',
    useState: () => [showAll, update => { showAll = update(showAll); }],
    useQuery: () => ({ data: { meetings, week: { start: '2026-10-26T00:00:00Z', end: '2026-11-02T00:00:00Z' }, coverage: { status: 'current', mailboxesChecked: 2, mailboxesExpected: 2, issues: [] } } }),
    useMutation: () => ({}),
  });
  const tree = app.LandlordWeeklyMeetings();
  const upcoming = nodes(tree).find(node => node.props['data-testid'] === 'landlord-weekly-upcoming');
  const earlier = nodes(tree).find(node => node.props['data-testid'] === 'landlord-weekly-earlier');
  assert.equal(nodes(upcoming).filter(node => node.type === 'article').length, 6);
  assert.equal(earlier.type, 'details');
  assert.equal(earlier.props.open, undefined);
  assert.match(text(earlier), /Monday catch-up/);
  assert.doesNotMatch(text(upcoming), /Monday catch-up/);
  const expand = nodes(tree).find(node => node.type === 'Button' && /Show all 8 upcoming/.test(text(node)));
  assert.equal(expand.props['aria-expanded'], false);
  expand.props.onClick();
  const expanded = app.LandlordWeeklyMeetings();
  assert.equal(nodes(nodes(expanded).find(node => node.props['data-testid'] === 'landlord-weekly-upcoming')).filter(node => node.type === 'article').length, 8);
  assert.ok(nodes(expanded).some(node => node.type === 'Button' && text(node) === 'Show fewer meetings'));
});
