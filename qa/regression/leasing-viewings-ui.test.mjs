import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import React from 'react';
import { createRequire } from 'node:module';
import { calendarDateValue } from '../../shared/calendar-date.ts';
import { buildViewingReport } from '../../shared/viewing-report.ts';
import { VIEWING_STATUSES, VIEWING_OUTCOMES, viewingMissingDetails, viewingNeedsOutcome } from '../../shared/viewing-workflow.ts';
const require = createRequire(import.meta.url);
const { source, ts } = require('./source-harness.cjs');
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const viewing = { id: 'viewing-1', unitId: 'unit-1', propertyId: 'property-1', propertyName: 'Shopping centre', unitName: 'Unit 1', sqft: 2000, companyId: 'brand-1', companyName: 'Brand One', contactId: 'contact-1', contactName: 'Brand Contact', agentContactId: null, agentContactName: null, ownerUserId: 'owner-1', ownerName: 'BGP Owner', team: 'Leasing', requirementId: null, requirementName: null, viewingDate: today, viewingTime: '11:30', status: 'scheduled', outcome: null, notes: null, attendees: null, nextAction: null, followUpDate: null, source: 'diary', calendarEventId: 'event-1', bookingId: 'booking-1', detailsConfirmedAt: '2026-01-01T10:00:00Z', outcomeRecordedAt: null, updatedAt: '2026-01-01T10:00:00Z', issues: [], offers: [] };
const options = { units: [{ id: 'unit-1', name: 'Unit 1', propertyId: 'property-1', propertyName: 'Shopping centre', sqft: 2000 }], brands: [{ id: 'brand-1', name: 'Brand One' }, { id: 'brand-2', name: 'Brand Two' }], contacts: [{ id: 'contact-1', name: 'Brand Contact', companyId: 'brand-1', email: 'person@brand.test', representedBrandIds: [] }, { id: 'agent-1', name: 'Agent', companyId: 'agency-1', email: 'agent@agency.test', representedBrandIds: ['brand-1'] }, { id: 'foreign-agent', name: 'Foreign agent', companyId: 'agency-2', email: 'foreign@agency.test', representedBrandIds: ['brand-2'] }], owners: [{ id: 'owner-1', name: 'BGP Owner', team: 'Leasing' }], requirements: [{ id: 'requirement-1', name: 'Brand One requirement', companyId: 'brand-1' }] };
function descendants(node) { if (Array.isArray(node)) return node.flatMap(descendants); if (!React.isValidElement(node)) return []; return [node, ...descendants(node.props.children)]; }
function content(node) { if (Array.isArray(node)) return node.map(content).join(''); if (React.isValidElement(node)) return content(node.props.children); return node == null || typeof node === 'boolean' ? '' : String(node); }
function fixture({ client = false, mobile = false, failing = false } = {}) {
  const file = 'client/src/components/leasing-viewings.tsx';
  const ast = ts.createSourceFile(file, source(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declarations = ast.statements.filter(node => !ts.isImportDeclaration(node) && !ts.isInterfaceDeclaration(node) && !ts.isTypeAliasDeclaration(node));
  const compiled = ts.transpileModule(declarations.map(node => node.getText(ast)).join('\n') + '\nexports.Reports = ViewingReports;', { fileName: 'test.tsx', compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
  const slots = [], calls = [], pending = [], errors = [], invalidations = [], exports = {}, notifications = [];
  let cursor = 0;
  const bindings = {};
  for (const node of ast.statements) if (ts.isImportDeclaration(node)) for (const member of node.importClause?.namedBindings?.elements || []) bindings[member.name.text] = function Leaf() { return null; };
  const data = { viewings: [{ ...viewing }], options: structuredClone(options), report: buildViewingReport({ viewings: [], offers: [], from: today, to: today, asOf: today }) };
  Object.assign(bindings, {
    React, exports, console, URLSearchParams, Intl, Date, calendarDateValue, VIEWING_STATUSES, VIEWING_OUTCOMES, viewingMissingDetails, viewingNeedsOutcome,
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial; return [slots[index], next => slots[index] = typeof next === 'function' ? next(slots[index]) : next]; },
    useMemo: fn => fn(), useEffect: () => {}, useIsMobile: () => mobile,
    useToast: () => ({ toast: value => notifications.push(value) }),
    useQuery({ queryKey }) { return { data: queryKey[1] === 'report' ? data.report : queryKey.at(-1) === 'options' ? data.options : { viewings: data.viewings, emailRemindersEnabled: false }, isLoading: false, isError: false, refetch() {} }; },
    useMutation(config) { return { isPending: false, mutate(value) { pending.push(Promise.resolve().then(() => config.mutationFn(value)).then(result => config.onSuccess?.(result), error => { errors.push(error); config.onError?.(error); })); } }; },
    queryClient: { invalidateQueries: args => invalidations.push(args) },
    apiRequest: async (method, url, body) => { calls.push({ method, url, body }); if (failing) throw new Error('This viewing changed. Refresh before saving.'); return { json: async () => ({ id: 'saved' }) }; },
  });
  vm.runInNewContext(compiled, bindings);
  const props = { mode: 'viewings', units: [{ id: 'unit-1' }], isClient: client, currentUserId: 'owner-1', focusedViewingId: null, onFocusHandled() {}, onAddViewing() {}, onRecordOffer: v => calls.push({ action: 'offer', viewing: v }) };
  return { calls, errors, invalidations, notifications, data, bindings,
    render() { cursor = 0; return exports.LeasingViewings(props); },
    renderReport() { cursor = 0; return exports.Reports({ options: data.options, isClient: client }); },
    byTestId(tree, id) { return descendants(tree).find(node => node.props['data-testid'] === id || node.props.testId === id); },
    button(tree, text) { return descendants(tree).find(node => node.type === bindings.Button && content(node) === text); },
    async settle() { while (pending.length) await pending.shift(); },
  };
}

function open(app) { app.button(app.render(), 'Open viewing').props.onClick(); return app.render(); }

test('recording an agent preserves the prospective brand and sends a concurrency token', async () => {
  const app = fixture();
  let tree = open(app);
  app.byTestId(tree, 'viewing-workflow-agent').props.onChange('agent-1');
  tree = app.render();
  assert.equal(app.button(tree, 'Record offer').props.disabled, true, 'a linked offer cannot use unsaved identity');
  app.byTestId(tree, 'viewing-workflow-save').props.onClick();
  await app.settle();
  assert.equal(app.calls[0].method, 'PATCH');
  assert.equal(app.calls[0].url, '/api/leasing-viewings/viewing-1');
  assert.equal(app.calls[0].body.companyId, 'brand-1');
  assert.equal(app.calls[0].body.agentContactId, 'agent-1');
  assert.equal(app.calls[0].body.expectedUpdatedAt, viewing.updatedAt);
  assert.equal(app.calls[0].body.confirmDetails, true);
  assert.ok(app.invalidations.some(q => q.queryKey[0] === '/api/available-units'));
  assert.ok(app.invalidations.some(q => q.queryKey[0] === '/api/leasing-viewings'));
});

test('clients can edit their viewing and record offers but cannot create requirements or select another brands agent', () => {
  const app = fixture({ client: true, mobile: true });
  let tree = open(app);
  assert.ok(descendants(tree).find(node => node.type === app.bindings.Drawer && node.props.open));
  assert.ok(app.byTestId(tree, 'viewing-workflow-save'));
  assert.equal(app.button(tree, 'Record offer').props.disabled, false);
  assert.equal(app.button(tree, 'Create requirement draft'), undefined);
  assert.deepEqual(Array.from(app.byTestId(tree, 'viewing-workflow-agent').props.items, c => c.id), ['agent-1']);
  app.byTestId(tree, 'viewing-workflow-brand').props.onChange('brand-2');
  tree = app.render();
  assert.equal(app.byTestId(tree, 'viewing-workflow-contact').props.value, null);
  assert.equal(app.byTestId(tree, 'viewing-workflow-agent').props.value, null);
  assert.deepEqual(Array.from(app.byTestId(tree, 'viewing-workflow-agent').props.items, c => c.id), ['foreign-agent']);
});

test('failed or conflicting saves retain the open form and user edits for recovery', async () => {
  const app = fixture({ failing: true });
  let tree = open(app);
  descendants(tree).find(node => node.props.id === 'viewing-workflow-notes' && node.type === app.bindings.Textarea).props.onChange({ target: { value: 'The occupier needs a wider frontage.' } });
  app.byTestId(app.render(), 'viewing-workflow-save').props.onClick();
  await app.settle();
  tree = app.render();
  assert.equal(app.errors.length, 1);
  assert.ok(descendants(tree).find(node => node.type === app.bindings.Dialog && node.props.open));
  assert.equal(descendants(tree).find(node => node.props.id === 'viewing-workflow-notes' && node.type === app.bindings.Textarea).props.value, 'The occupier needs a wider frontage.');
  assert.equal(app.notifications.at(-1).variant, 'destructive');
});

test('a new viewing saves through the existing tracker endpoint and retains owner, next action and date', async () => {
  const app = fixture();
  app.button(app.render(), 'Add viewing').props.onClick();
  let tree = app.render();
  descendants(tree).find(node => node.type === app.bindings.EntityCombobox && node.props.placeholder === 'Find the property and unit').props.onChange('unit-1');
  app.button(app.render(), 'Add viewing for this unit').props.onClick();
  tree = app.render();
  assert.equal(app.button(tree, 'Record offer'), undefined, 'a transient unsaved viewing cannot receive offers');
  app.byTestId(tree, 'viewing-workflow-brand').props.onChange('brand-1');
  tree = app.render();
  app.byTestId(tree, 'viewing-workflow-agent').props.onChange('agent-1');
  descendants(tree).find(node => node.props.id === 'viewing-workflow-time' && node.type === app.bindings.Input).props.onChange({ target: { value: '14:00' } });
  descendants(tree).find(node => node.props.id === 'viewing-workflow-next-action' && node.type === app.bindings.Input).props.onChange({ target: { value: 'Send terms' } });
  app.byTestId(app.render(), 'viewing-workflow-save').props.onClick();
  await app.settle();
  assert.equal(app.calls[0].method, 'POST');
  assert.equal(app.calls[0].url, '/api/available-units/unit-1/viewings');
  assert.equal(app.calls[0].body.companyId, 'brand-1');
  assert.equal(app.calls[0].body.agentContactId, 'agent-1');
  assert.equal(app.calls[0].body.ownerUserId, 'owner-1');
  assert.equal(app.calls[0].body.viewingDate, today);
  assert.equal(app.calls[0].body.nextAction, 'Send terms');
  assert.equal('expectedUpdatedAt' in app.calls[0].body, false);
});

test('requirements and offers only mutate after an explicit action, and requirement link uses the saved brand', async () => {
  const app = fixture();
  let tree = open(app);
  assert.equal(app.calls.length, 0);
  const picker = descendants(tree).find(node => node.type === app.bindings.EntityCombobox && node.props.placeholder === 'Choose an existing brand requirement');
  assert.deepEqual(Array.from(picker.props.items, r => r.id), ['requirement-1']);
  picker.props.onChange('requirement-1');
  app.button(app.render(), 'Link requirement').props.onClick();
  await app.settle();
  assert.equal(app.calls[0].url, '/api/leasing-viewings/viewing-1/requirement');
  assert.equal(app.calls[0].body.requirementId, 'requirement-1');
});


test('empty conversion reports show unavailable percentages rather than an invented zero-percent result', () => {
  const app = fixture();
  const tree = app.renderReport();
  assert.match(content(tree), /No confirmed completed viewing opportunities/);
  assert.doesNotMatch(content(tree), /0%/);
  const metrics = descendants(tree).filter(node => node.type === 'p' && node.props.className === 'text-2xl font-mono tabular-nums mt-2');
  assert.deepEqual(metrics.map(content), ['0', '0', '—', '—']);
});

test('cancelling a captured booking does not silently confirm its identity and clears its outcome', async () => {
  const app = fixture();
  let tree = open(app);
  descendants(tree).find(node => node.type === app.bindings.Pill && content(node) === 'Cancelled').props.onClick();
  app.byTestId(app.render(), 'viewing-workflow-save').props.onClick();
  await app.settle();
  assert.equal(app.calls[0].body.status, 'cancelled');
  assert.equal(app.calls[0].body.outcome, null);
  assert.equal('confirmDetails' in app.calls[0].body, false);
});

test('brand activity separates confirmed attended and scheduled rows, caps its board and keeps the brand on the full-calendar link', () => {
  const file = 'client/src/components/brand-viewing-activity.tsx';
  const ast = ts.createSourceFile(file, source(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declarations = ast.statements.filter(node => !ts.isImportDeclaration(node));
  const compiled = ts.transpileModule(declarations.map(node => node.getText(ast)).join('\n'), { fileName: 'brand.tsx', compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
  const rows = [
    ...Array.from({ length: 7 }, (_, i) => ({ ...viewing, id: `attended-${i}`, status: 'completed', outcome: 'Interested' })),
    { ...viewing, id: 'scheduled', detailsConfirmedAt: null },
    { ...viewing, id: 'unconfirmed', status: 'completed', detailsConfirmedAt: null },
    { ...viewing, id: 'cancelled', status: 'cancelled' },
    { ...viewing, id: 'foreign', companyId: 'brand-other', status: 'completed' },
    { ...viewing, id: 'invalid-date', viewingDate: '2026-99-42' },
  ];
  const exports = {}, captured = [];
  const bindings = { React, exports, Intl, Date, calendarDateValue, encodeURIComponent, useQuery: config => { captured.push(config); return { data: { viewings: rows }, isError: false, isLoading: false }; } };
  for (const name of ['Card', 'CardContent', 'Button', 'Skeleton']) bindings[name] = function Leaf() { return null; };
  vm.runInNewContext(compiled, bindings);
  const tree = exports.BrandViewingActivity({ companyId: 'brand-1' });
  const links = descendants(tree).filter(node => node.type === 'a');
  assert.equal(links.filter(node => content(node) === 'Open viewing').length, 6);
  assert.equal(links.find(node => content(node).startsWith('Show all')).props.href, '/available?workspace=viewings&brandId=brand-1');
  assert.match(content(tree), /Attended · 90 days 7/);
  assert.match(content(tree), /Upcoming 1/);
  assert.ok(!links.some(node => /foreign|unconfirmed|cancelled|invalid-date/.test(node.props.href)));
  assert.deepEqual(Array.from(captured[0].queryKey), ['/api/leasing-viewings', 'brand', 'brand-1']);
});


test('an unmatched legacy diary booking can be marked non-leasing without inventing a date or resubmitting its agency as a brand', async () => {
  const app = fixture();
  Object.assign(app.data.viewings[0], { unitId: null, companyId: 'legacy-agency', viewingDate: '', contactId: 'agency-contact', notes: 'Contractor inspection', detailsConfirmedAt: null });
  let tree = app.render();
  descendants(tree).find(node => node.type === app.bindings.Pill && content(node) === 'All viewings').props.onClick();
  app.button(app.render(), 'Complete details').props.onClick();
  tree = app.render();
  descendants(tree).find(node => node.type === app.bindings.Pill && content(node) === 'Not a leasing viewing').props.onClick();
  tree = app.render();
  const save = app.byTestId(tree, 'viewing-workflow-save');
  assert.equal(save.props.disabled, false, 'missing dates and units must not trap an irrelevant booking in the queue');
  save.props.onClick();
  await app.settle();
  assert.equal(app.calls[0].method, 'PATCH');
  assert.deepEqual(JSON.parse(JSON.stringify(app.calls[0].body)), { status: 'not_leasing', notes: 'Contractor inspection', outcome: null, expectedUpdatedAt: viewing.updatedAt });
  assert.ok(!('companyId' in app.calls[0].body));
  assert.ok(!('viewingDate' in app.calls[0].body));
});


test('correcting the viewing brand also clears the old brands requirement link', async () => {
  const app = fixture();
  app.data.viewings[0].requirementId = 'requirement-1';
  let tree = open(app);
  app.byTestId(tree, 'viewing-workflow-brand').props.onChange('brand-2');
  app.byTestId(app.render(), 'viewing-workflow-save').props.onClick();
  await app.settle();
  assert.equal(app.calls[0].body.companyId, 'brand-2');
  assert.equal(app.calls[0].body.requirementId, null);
  assert.equal(app.calls[0].body.contactId, null);
});

test('a no-show with incomplete details leaves the missing-details queue after it is closed', () => {
  const app = fixture();
  Object.assign(app.data.viewings[0], { status: 'no_show', unitId: null, detailsConfirmedAt: null, issues: ['Choose the tracker unit'] });
  const tree = app.render();
  const pill = descendants(tree).find(node => node.type === app.bindings.Pill && content(node).startsWith('Needs details'));
  assert.equal(content(pill), 'Needs details0');
  pill.props.onClick();
  assert.match(content(app.render()), /No viewings match this view/);
});

test('invalid legacy calendar dates remain reviewable without crashing the viewing list', () => {
  const app = fixture();
  app.data.viewings[0].viewingDate = '2026-99-42';
  const tree = app.render();
  descendants(tree).find(node => node.type === app.bindings.Pill && content(node) === 'All viewings').props.onClick();
  assert.match(content(app.render()), /Date needed/);
});

test('viewing identity pickers expose distinct accessible labels', () => {
  const app = fixture();
  const tree = open(app);
  for (const [id, label] of [['unit', 'Tracker unit'], ['brand', 'Brand viewing'], ['contact', 'Brand contact'], ['agent', 'Representing agent'], ['owner', 'Responsible BGP person']]) {
    assert.equal(app.byTestId(tree, `viewing-workflow-${id}`).props.ariaLabel, label);
  }
});


test('reselecting the same brand preserves its existing contact and requirement', () => {
  const app = fixture();
  app.data.viewings[0].requirementId = 'requirement-1';
  let tree = open(app);
  app.byTestId(tree, 'viewing-workflow-brand').props.onChange('brand-1');
  tree = app.render();
  assert.equal(app.byTestId(tree, 'viewing-workflow-contact').props.value, 'contact-1');
  assert.equal(app.button(tree, 'Record offer').props.disabled, false, 'reselecting unchanged identity must not introduce a destructive draft');
});


test('scoped clients see existing saved identities missing from their directory without gaining other directory choices', async () => {
  const app = fixture({ client: true });
  Object.assign(app.data.viewings[0], { agentContactId: 'saved-agent', agentContactName: 'Recorded Agent' });
  app.data.options = { ...structuredClone(options), units: [], brands: [{ id: 'brand-2', name: 'Brand Two' }], contacts: [], owners: [] };
  let tree = open(app);
  for (const [field, id, label] of [
    ['unit', 'unit-1', 'Unit 1'], ['brand', 'brand-1', 'Brand One'],
    ['contact', 'contact-1', 'Brand Contact'], ['agent', 'saved-agent', 'Recorded Agent'], ['owner', 'owner-1', 'BGP Owner'],
  ]) {
    const picker = app.byTestId(tree, `viewing-workflow-${field}`);
    assert.equal(picker.props.value, id);
    assert.equal(picker.props.items.find(item => item.id === id)?.label, label);
    assert.equal(picker.props.items.length, field === 'brand' ? 2 : 1);
  }
  descendants(tree).find(node => node.props.id === 'viewing-workflow-notes' && node.type === app.bindings.Textarea).props.onChange({ target: { value: 'Client viewing feedback' } });
  app.byTestId(app.render(), 'viewing-workflow-save').props.onClick();
  await app.settle();
  assert.equal(app.calls[0].body.companyId, 'brand-1');
  assert.equal(app.calls[0].body.contactId, 'contact-1');
  assert.equal(app.calls[0].body.agentContactId, 'saved-agent');
  assert.equal(app.calls[0].body.ownerUserId, 'owner-1');
});
