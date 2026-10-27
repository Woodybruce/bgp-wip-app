import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import React from 'react';
const require = createRequire(import.meta.url);
const { source, ts } = require('./source-harness.cjs');
function nodes(node) { return Array.isArray(node) ? node.flatMap(nodes) : React.isValidElement(node) ? [node, ...nodes(node.props.children)] : []; }
function text(node) { return Array.isArray(node) ? node.map(text).join(' ') : React.isValidElement(node) ? text(node.props.children) : node == null ? '' : String(node); }
const now = new Date('2026-10-27T11:00:00Z');
class TestDate extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now.getTime(); } }
function fixture(data, error = false) {
  const file = 'client/src/components/landlord-meetings-summary.tsx';
  const ast = ts.createSourceFile(file, source(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const script = ast.statements.filter(node => !ts.isImportDeclaration(node)).map(node => node.getText(ast)).join('\n');
  let query, mutation;
  const invalidations = [];
  const sandbox = { exports: {}, require, Date: TestDate, encodeURIComponent,
    Calendar: 'Calendar', MapPin: 'MapPin', RefreshCw: 'RefreshCw', Users: 'Users', Sparkles: 'Sparkles', Dialog: 'Dialog', DialogTitle: 'DialogTitle', DialogDescription: 'DialogDescription', DialogContent: 'DialogContent', Input: 'Input', LandlordActivityCard: 'LandlordActivityCard', AiCommentary: 'AiCommentary', Button: 'Button', MeetingViewerDialog: 'MeetingViewerDialog',
    useState: initial => [initial, () => {}], useQueryClient: () => ({ invalidateQueries(options) { invalidations.push(options); } }), getAuthHeaders: () => ({}),
    useQuery: options => { if (options.queryKey[2] === 'meeting-summary') return { data: {summary: null}, isFetching: false }; query = options; return { data, isLoading: false, isError: error }; },
    useMutation: options => { mutation = options; return { isPending: false, isError: false }; },
    apiRequest: async () => ({ json: async () => ({ running: true }) }),
  };
  vm.runInNewContext(ts.transpileModule(script, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, sandbox);
  return { ...sandbox.exports, invalidations, get query() { return query; }, get mutation() { return mutation; } };
}
const meeting = (id, start, end) => ({ id, companyId: 'aew', companyName: 'AEW', subject: 'AEW catch-up', start, end, location: 'Office',
  participants: [{ name: 'Manish', email: 'manish@eu.aew.com' }, { name: 'Ben Sykes', email: 'ben@eu.aew.com' }],
  bgpParticipants: [{ name: 'Nick', email: 'nick@bgp.uk.com' }, { name: 'Vics', email: 'vics@bgp.uk.com' }],
  sourceId: id, mailbox: 'nick@bgp.uk.com', webLink: 'https://outlook.office365.com/owa/?itemid=meeting', source: 'calendar', checkedAt: now.toISOString(), matchReasons: [] });
const coverage = { status: 'partial', checkedAt: now.toISOString(), mailboxesChecked: 2, mailboxesExpected: 4, issues: ['Calendar unavailable'] };

test('past and invalid meetings cannot lead the landlord overview; in-progress meetings stay visible', () => {
  const app = fixture();
  const rows = [meeting('later', '2026-10-29T10:00:00Z', '2026-10-29T11:00:00Z'), meeting('past', '2026-10-26T10:00:00Z', '2026-10-26T11:00:00Z'),
    meeting('now', '2026-10-27T10:30:00Z', '2026-10-27T11:30:00Z'), meeting('invalid', 'invalid', '2026-10-30T11:30:00Z')];
  assert.deepEqual(Array.from(app.upcomingLandlordMeetings(rows), row => row.id), ['now', 'later']);
  assert.deepEqual(rows.map(row => row.id), ['later', 'past', 'now', 'invalid']);
});

test('tomorrow’s AEW meeting exposes invite attendees and BGP participants before profile details', () => {
  const app = fixture({ meetings: [meeting('tomorrow', '2026-10-28T09:30:00Z', '2026-10-28T10:30:00Z')], coverage });
  const tree = app.LandlordMeetingsSummary({ companyId: 'aew' });
  assert.match(text(tree), /Tomorrow · 09:30/);
  for (const name of ['Manish', 'Ben Sykes', 'Nick', 'Vics']) assert.match(text(tree), new RegExp(name));
  assert.ok(nodes(tree).some(node => node.type === 'Button' && text(node) === 'Invitation'));
  assert.match(text(tree), /Meetings with/);
  assert.ok(nodes(tree).some(node => node.type === 'a' && node.props.href.startsWith('https://outlook.') && node.props.rel === 'noopener noreferrer'));
  assert.equal(nodes(tree).some(node => node.type === 'MeetingViewerDialog'), false);
  assert.match(text(tree), /partial \(2 of 4 connected diaries checked\)/);
  assert.doesNotMatch(text(tree), /No upcoming/);
});

test('no meetings with incomplete coverage never claims there are no landlord meetings', () => {
  const app = fixture({ meetings: [], coverage });
  const tree = app.LandlordMeetingsSummary({ companyId: 'aew' });
  assert.match(text(tree), /No upcoming invitations linked in the checked diaries/);
  assert.match(text(tree), /Other meetings may be missing/);
  assert.doesNotMatch(text(tree), /no landlord meetings/i);
});

test('compact preview shows two invitations and the separate dialog keeps the full list', () => {
  const app = fixture({ meetings: Array.from({ length: 5 }, (_, i) => meeting(String(i), `2026-10-${28 + i}T09:00:00Z`, `2026-10-${28 + i}T10:00:00Z`)).filter(row => Number.isFinite(Date.parse(row.start))), coverage });
  const tree = app.LandlordMeetingsSummary({ companyId: 'aew' });
  assert.equal(nodes(tree).filter(node => node.props['data-testid'] === 'landlord-meeting-preview').length, 2);
  assert.equal(nodes(tree).filter(node => node.props['data-testid'] === 'landlord-meeting').length, 4);
  const card = nodes(tree).find(node => node.type === 'LandlordActivityCard');
  assert.equal(card.props.actionLabel, 'View meetings');
  assert.equal(card.props.count, '4 upcoming');
  assert.ok(nodes(tree).some(node => node.props['data-testid'] === 'landlord-meetings-dialog'));
  assert.equal(app.query.refetchInterval({ state: { data: { coverage: { refreshing: true } } } }), 5_000);
  assert.equal(app.query.refetchInterval({ state: { data: { coverage: { refreshing: false } } } }), 60_000);
});

test('invitation dates use London time in summer and after the autumn clock change', () => {
  const app = fixture();
  assert.match(app.landlordMeetingWhen(meeting('summer', '2026-07-15T09:00:00Z', ''), now), /10:00$/);
  assert.match(app.landlordMeetingWhen(meeting('autumn', '2026-10-28T09:00:00Z', ''), now), /09:00$/);
});

test('load failure is not mislabelled as an empty diary or a successful scan', () => {
  const app = fixture(undefined, true);
  const tree = app.LandlordMeetingsSummary({ companyId: 'aew' });
  assert.match(text(tree), /could not be loaded/);
  assert.doesNotMatch(text(tree), /No upcoming|diaries checked/);
});


test('tomorrow remains the next calendar day across the 25-hour autumn clock change', () => {
  const app = fixture();
  const beforeClocksChange = new Date('2026-10-24T23:30:00Z');
  assert.match(app.landlordMeetingWhen(meeting('next-day', '2026-10-26T09:00:00Z', ''), beforeClocksChange), /^Tomorrow/);
  assert.match(app.landlordMeetingWhen(meeting('same-day', '2026-10-25T23:30:00Z', ''), beforeClocksChange), /^Today/);
});

test('refreshing a profile updates both calendar views without touching Brand or interview caches', () => {
  const app = fixture({ meetings: [], coverage });
  app.LandlordMeetingsSummary({ companyId: 'aew' });
  app.mutation.onSuccess();
  const match = queryKey => app.invalidations.some(options => options.predicate({ queryKey }));
  assert.equal(match(['/api/crm/landlords', 'aew', 'meetings']), true);
  assert.equal(match(['/api/crm/landlords/meetings/week']), true);
  assert.equal(match(['/api/crm/landlords/interview-links']), false);
  assert.equal(match(['/api/brand', 'brand', 'ai-take', 'brand']), false);
});

test('AI summary identity changes when any invitation, coverage or meeting phase changes', () => {
  const app = fixture();
  const first = meeting('one', '2026-10-27T12:00:00Z', '2026-10-27T13:00:00Z');
  const second = meeting('two', '2026-10-28T12:00:00Z', '2026-10-28T13:00:00Z');
  const digest = {meetings:[first,second],coverage};
  const before = app.landlordMeetingSummarySignature(digest, +now);
  for (const changed of [{...digest,meetings:[first]}, {...digest,meetings:[first,{...second,subject:'Revised subject'}]}, {...digest,coverage:{...coverage,status:'current'}}]) {
    assert.notEqual(app.landlordMeetingSummarySignature(changed, +now), before);
  }
  assert.notEqual(app.landlordMeetingSummarySignature(digest, Date.parse('2026-10-27T12:15:00Z')), before);
  assert.equal(app.landlordMeetingSummarySignature(digest, +now), before);
});
