import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import React from 'react';
import { createRequire } from 'node:module';
import { calendarDateValue } from '../../shared/calendar-date.ts';
import { buildViewingReport } from '../../shared/viewing-report.ts';
import { VIEWING_STATUSES, VIEWING_OUTCOMES, VIEWING_BRAND_GAP, VIEWING_BRAND_WAITS, viewingGapsForJointAgent, viewingMissingDetails, viewingNeedsOutcome } from '../../shared/viewing-workflow.ts';
import { viewingFollowupDecision } from '../../server/viewing-followups.ts';
const require = createRequire(import.meta.url);
const { source, find, evaluate, ts } = require('./source-harness.cjs');
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const viewing = { id: 'viewing-1', unitId: 'unit-1', propertyId: 'property-1', propertyName: 'Shopping centre', unitName: 'Unit 1', sqft: 2000, companyId: 'brand-1', companyName: 'Brand One', contactId: 'contact-1', contactName: 'Brand Contact', agentContactId: null, agentContactName: null, ownerUserId: 'owner-1', ownerName: 'BGP Owner', team: 'Leasing', requirementId: null, requirementName: null, viewingDate: today, viewingTime: '11:30', status: 'scheduled', outcome: null, notes: null, attendees: null, nextAction: null, followUpDate: null, source: 'diary', calendarEventId: 'event-1', bookingId: 'booking-1', detailsConfirmedAt: '2026-01-01T10:00:00Z', outcomeRecordedAt: null, updatedAt: '2026-01-01T10:00:00Z', issues: [], offers: [] };
const options = { units: [{ id: 'unit-1', name: 'Unit 1', propertyId: 'property-1', propertyName: 'Shopping centre', sqft: 2000 }], brands: [{ id: 'brand-1', name: 'Brand One' }, { id: 'brand-2', name: 'Brand Two' }], contacts: [{ id: 'contact-1', name: 'Brand Contact', companyId: 'brand-1', email: 'person@brand.test', representedBrandIds: [] }, { id: 'agent-1', name: 'Agent', companyId: 'agency-1', email: 'agent@agency.test', representedBrandIds: ['brand-1'] }, { id: 'foreign-agent', name: 'Foreign agent', companyId: 'agency-2', email: 'foreign@agency.test', representedBrandIds: ['brand-2'] }], owners: [{ id: 'owner-1', name: 'BGP Owner', team: 'Leasing' }], requirements: [{ id: 'requirement-1', name: 'Brand One requirement', companyId: 'brand-1' }] };
function descendants(node) { if (Array.isArray(node)) return node.flatMap(descendants); if (!React.isValidElement(node)) return []; return [node, ...descendants(node.props.children)]; }
function content(node) { if (Array.isArray(node)) return node.map(content).join(''); if (React.isValidElement(node)) return content(node.props.children); return node == null || typeof node === 'boolean' ? '' : String(node); }
function fixture({ client = false, mobile = false, failing = false, jointAgent = false } = {}) {
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
    React, exports, console, URLSearchParams, Intl, Date, calendarDateValue, VIEWING_STATUSES, VIEWING_OUTCOMES, VIEWING_BRAND_GAP, VIEWING_BRAND_WAITS, viewingGapsForJointAgent, viewingMissingDetails, viewingNeedsOutcome,
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial; return [slots[index], next => slots[index] = typeof next === 'function' ? next(slots[index]) : next]; },
    useMemo: fn => fn(), useEffect: () => {}, useIsMobile: () => mobile,
    useToast: () => ({ toast: value => notifications.push(value) }),
    useQuery({ queryKey }) { return { data: queryKey[1] === 'report' ? data.report : queryKey.at(-1) === 'options' ? data.options : { viewings: data.viewings, emailRemindersEnabled: false }, isLoading: false, isError: false, refetch() {} }; },
    useMutation(config) { return { isPending: false, mutate(value) { pending.push(Promise.resolve().then(() => config.mutationFn(value)).then(result => config.onSuccess?.(result), error => { errors.push(error); config.onError?.(error); })); } }; },
    queryClient: { invalidateQueries: args => invalidations.push(args) },
    apiRequest: async (method, url, body) => { calls.push({ method, url, body }); if (failing) throw new Error('This viewing changed. Refresh before saving.'); return { json: async () => ({ id: 'saved' }) }; },
  });
  vm.runInNewContext(compiled, bindings);
  const props = { mode: 'viewings', units: jointAgent ? [] : [{ id: 'unit-1' }], isClient: client || jointAgent, jointAgent, currentUserId: jointAgent ? 'joint-1' : 'owner-1', focusedViewingId: null, onFocusHandled() {}, onAddViewing() {}, onRecordOffer: v => calls.push({ action: 'offer', viewing: v }) };
  return { calls, errors, invalidations, notifications, data, bindings,
    render() { cursor = 0; return exports.LeasingViewings(props); },
    renderReport() { cursor = 0; return exports.Reports({ options: data.options, isClient: client || jointAgent, jointAgent }); },
    byTestId(tree, id) { return descendants(tree).find(node => node.props['data-testid'] === id || node.props.testId === id); },
    button(tree, text) { return descendants(tree).find(node => node.type === bindings.Button && content(node) === text); },
    async settle() { while (pending.length) await pending.shift(); },
  };
}

function open(app) { descendants(app.render()).find(node => node.type === app.bindings.ViewingsTimeGrid).props.onSelect(app.data.viewings[0]); app.byTestId(app.render(), 'viewings-action-edit').props.onClick(); return app.render(); }

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
  app.byTestId(tree, 'viewing-workflow-unit').props.onChange('unit-1');
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
  descendants(tree).find(node => node.type === app.bindings.Pill && content(node).startsWith('Needs details')).props.onClick();
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
  descendants(tree).find(node => node.type === app.bindings.Pill && content(node).startsWith('Needs details')).props.onClick();
  assert.match(content(app.render()), /Date needed/);
});

test('viewing identity pickers expose distinct accessible labels', () => {
  const app = fixture();
  const tree = open(app);
  for (const [id, label] of [['unit', 'Tracker unit'], ['brand', 'Brand viewing'], ['contact', 'Brand contact'], ['agent', 'Representing agent'], ['owner', 'Agent']]) {
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


// ── Joint agent mode (Woody, 2026-11-12: full control on their instructed
// schemes, no access to the brand pages). The server sends a joint agent no
// CRM contact or requirement: contacts and requirements are empty, a viewing
// carries names without ids, and the agents are BGP's people on the account
// plus the joint agents on the scheme.
const jointOptions = { units: [{ id: 'unit-1', name: 'Unit 1', propertyId: 'property-1', propertyName: 'Shopping centre', sqft: 2000 }], brands: [{ id: 'brand-1', name: 'Brand One' }, { id: 'brand-2', name: 'Brand Two' }], contacts: [], owners: [{ id: 'owner-1', name: 'BGP Owner', team: null }, { id: 'joint-1', name: 'Jo Joint', team: null, firm: 'CBRE', jointAgent: true, propertyIds: ['property-1'] }], requirements: [] };
const jointViewing = { ...viewing, contactId: null, agentContactId: null, requirementId: null, calendarEventId: null, team: null, agentContactName: 'Tenant Agent', typedContact: true };
function jointFixture() {
  const app = fixture({ jointAgent: true });
  app.data.viewings[0] = { ...jointViewing };
  app.data.options = structuredClone(jointOptions);
  return app;
}

test('a joint agent types the contact and the agent, and their save sends names and never a CRM contact or requirement id', async () => {
  const app = jointFixture();
  let tree = open(app);
  assert.equal(app.byTestId(tree, 'viewing-workflow-contact'), undefined, 'no CRM contact picker');
  assert.equal(app.byTestId(tree, 'viewing-workflow-agent'), undefined, 'no CRM agent picker');
  assert.equal(app.byTestId(tree, 'viewing-workflow-contact-name').props.value, 'Brand Contact');
  assert.equal(app.byTestId(tree, 'viewing-workflow-agent-name').props.value, 'Tenant Agent');
  app.byTestId(tree, 'viewing-workflow-agent-name').props.onChange({ target: { value: 'New Agent, Savills' } });
  app.byTestId(app.render(), 'viewing-workflow-save').props.onClick();
  await app.settle();
  assert.equal(app.calls.length, 1);
  assert.equal(app.calls[0].method, 'PATCH');
  assert.equal(app.calls[0].url, '/api/leasing-viewings/viewing-1');
  const body = app.calls[0].body;
  assert.equal(body.contactName, 'Brand Contact');
  assert.equal(body.agentContactName, 'New Agent, Savills');
  assert.equal(body.companyId, 'brand-1');
  assert.equal(body.confirmDetails, true, 'a typed contact completes the viewing');
  for (const key of ['contactId', 'agentContactId', 'requirementId']) assert.equal(key in body, false, `${key} is never sent from a joint agent login`);
});

test('a joint agent makes no CRM, accounts or staff tracker call: the page is fed by the viewings routes only', async () => {
  const app = jointFixture();
  let tree = open(app);
  descendants(tree).find(node => node.props.id === 'viewing-workflow-notes' && node.type === app.bindings.Textarea).props.onChange({ target: { value: 'Went well.' } });
  app.byTestId(app.render(), 'viewing-workflow-save').props.onClick();
  await app.settle();
  assert.ok(app.calls.every(call => /^\/api\/(leasing-viewings|available-units\/[^/]+\/viewings)/.test(call.url)));
  const keys = app.invalidations.map(q => q.queryKey?.[0]).filter(Boolean);
  assert.deepEqual(keys, ['/api/leasing-viewings', '/api/tasks']);
  const landsecOnly = app.invalidations.find(q => q.predicate);
  assert.equal(landsecOnly.predicate({ queryKey: ['/api/landsec/tracker'] }), true);
  for (const key of ['/api/crm/requirements-leasing', '/api/accounts', '/api/available-units', '/api/crm/contacts']) assert.equal(landsecOnly.predicate({ queryKey: [key] }), false);
});

test('a joint agent sees no requirement action and the summary is asked for names only', () => {
  const app = jointFixture();
  app.data.viewings[0].offers = [{ id: 'offer-1', offerDate: today, confirmedAt: null, status: 'Pending' }];
  descendants(app.render()).find(node => node.type === app.bindings.ViewingsTimeGrid).props.onSelect(app.data.viewings[0]);
  let tree = app.render();
  const summary = descendants(tree).find(node => node.type === app.bindings.ViewingSummary);
  assert.equal(summary.props.plain, true);
  assert.equal(app.button(tree, 'Create requirement draft'), undefined);
  assert.equal(app.button(tree, 'Link requirement'), undefined);
  assert.equal(app.byTestId(tree, 'viewings-requirement-picker'), undefined);
  assert.doesNotMatch(content(tree), /requirement/i);
  assert.equal(app.button(tree, 'Record offer').props.disabled, false);
  assert.ok(app.button(tree, 'Confirm offer'));
  app.byTestId(tree, 'viewings-action-edit').props.onClick();
  tree = app.render();
  assert.equal(app.button(tree, 'Create requirement draft'), undefined);
  assert.doesNotMatch(content(tree), /requirement/i);
});

test('a joint agent is the agent on a viewing they add, types who is coming and saves through the tracker viewing route', async () => {
  const app = jointFixture();
  app.button(app.render(), 'Add viewing').props.onClick();
  let tree = app.render();
  assert.deepEqual(Array.from(app.byTestId(tree, 'viewing-workflow-unit').props.items, u => u.id), ['unit-1'], 'their scheme units come from the viewing options');
  assert.equal(app.byTestId(tree, 'viewing-workflow-owner').props.value, 'joint-1');
  app.byTestId(tree, 'viewing-workflow-unit').props.onChange('unit-1');
  app.byTestId(app.render(), 'viewing-workflow-brand').props.onChange('brand-2');
  tree = app.render();
  app.byTestId(tree, 'viewing-workflow-contact-name').props.onChange({ target: { value: 'Sam Visitor' } });
  descendants(tree).find(node => node.props.id === 'viewing-workflow-time' && node.type === app.bindings.Input).props.onChange({ target: { value: '15:00' } });
  app.byTestId(app.render(), 'viewing-workflow-save').props.onClick();
  await app.settle();
  assert.equal(app.calls[0].method, 'POST');
  assert.equal(app.calls[0].url, '/api/available-units/unit-1/viewings');
  const body = app.calls[0].body;
  assert.equal(body.ownerUserId, 'joint-1');
  assert.equal(body.companyId, 'brand-2');
  assert.equal(body.contactName, 'Sam Visitor');
  assert.equal(body.confirmDetails, true);
  assert.equal('contactId' in body, false);
});

test('a typed brand is sent as a name with no id, and the joint agent confirms the viewing while BGP matches the brand', async () => {
  const app = jointFixture();
  let tree = open(app);
  app.byTestId(tree, 'viewing-workflow-brand-name').props.onChange({ target: { value: 'New Brand Ltd' } });
  tree = app.render();
  assert.equal(app.byTestId(tree, 'viewing-workflow-brand').props.value, null);
  assert.match(content(tree), /BGP will match this brand to its list/);
  assert.doesNotMatch(content(tree), /Confirm the brand/, 'a joint agent is not asked for a link only BGP can make');
  app.byTestId(tree, 'viewing-workflow-save').props.onClick();
  await app.settle();
  assert.equal(app.calls[0].body.companyId, null);
  assert.equal(app.calls[0].body.companyName, 'New Brand Ltd');
  assert.equal(app.calls[0].body.confirmDetails, true, 'the typed brand does not hold back their confirmation');
});

test('a typed brand confirms nothing else: a joint agent with no contact, or no brand at all, is still asked for it', async () => {
  const noContact = jointFixture();
  Object.assign(noContact.data.viewings[0], { contactName: null, agentContactName: null, typedContact: false });
  let tree = open(noContact);
  noContact.byTestId(tree, 'viewing-workflow-brand-name').props.onChange({ target: { value: 'New Brand Ltd' } });
  tree = noContact.render();
  assert.match(content(tree), /Choose a brand contact or representing agent/);
  noContact.byTestId(tree, 'viewing-workflow-save').props.onClick();
  await noContact.settle();
  assert.equal(noContact.calls[0].body.confirmDetails, false);

  const noBrand = jointFixture();
  tree = open(noBrand);
  noBrand.byTestId(tree, 'viewing-workflow-brand').props.onChange('');
  tree = noBrand.render();
  assert.match(content(tree), /Confirm the brand/, 'with no brand picked or typed the gap is theirs to fill');
  assert.doesNotMatch(content(tree), /BGP will match/);
  noBrand.byTestId(tree, 'viewing-workflow-save').props.onClick();
  await noBrand.settle();
  assert.equal(noBrand.calls[0].body.companyId, null);
  assert.equal(noBrand.calls[0].body.confirmDetails, false);
});

test('a saved viewing with a typed brand tells the joint agent BGP will match it, and still takes no offer until it is matched', () => {
  const app = jointFixture();
  Object.assign(app.data.viewings[0], { companyId: null, companyName: 'New Brand Ltd', issues: ['Confirm the brand'] });
  descendants(app.render()).find(node => node.type === app.bindings.ViewingsTimeGrid).props.onSelect(app.data.viewings[0]);
  let tree = app.render();
  assert.match(content(tree), /Brand typed by name/);
  assert.match(content(tree), /BGP will match this brand to its list/);
  assert.doesNotMatch(content(tree), /Confirm the brand|Check the viewing details/);
  assert.equal(app.button(tree, 'Record offer').props.disabled, true, 'the offer link still needs a matched brand');
  descendants(tree).find(node => node.type === app.bindings.Pill && content(node).startsWith('Needs details')).props.onClick();
  tree = app.render();
  assert.match(content(app.byTestId(tree, 'viewings-list-open-viewing-1')), /BGP will match this brand to its list/);
  assert.equal(content(descendants(tree).find(node => node.type === app.bindings.Pill && content(node).startsWith('Needs details'))), 'Needs details1', 'it stays in the queue until BGP links the brand');
});

test('staff and ordinary client logins are still asked to confirm an unlinked brand, and their save does not confirm the viewing', async () => {
  for (const client of [false, true]) {
    const app = fixture({ client });
    Object.assign(app.data.viewings[0], { companyId: null, companyName: 'Name from the invitation', detailsConfirmedAt: null, issues: ['Confirm the brand', 'Confirm the viewing details'] });
    descendants(app.render()).find(node => node.type === app.bindings.ViewingsTimeGrid).props.onSelect(app.data.viewings[0]);
    let tree = app.render();
    assert.match(content(tree), /Check the viewing details/);
    assert.match(content(tree), /Confirm the brand/);
    assert.doesNotMatch(content(tree), /BGP will match|Brand typed by name/);
    app.byTestId(tree, 'viewings-action-edit').props.onClick();
    app.byTestId(app.render(), 'viewing-workflow-save').props.onClick();
    await app.settle();
    assert.equal(app.calls[0].body.confirmDetails, false);
    assert.equal('companyName' in app.calls[0].body, false);
  }
});

// The rule behind the screens. Only a joint agent's gaps change, and only
// for a brand that has a typed name and no link.
test('a typed brand is not a gap for a joint agent; every other gap, and every other login, counts as before', () => {
  const complete = { unitId: 'unit-1', companyId: null, companyName: 'New Brand Ltd', contactId: null, agentContactId: null, typedContact: true, ownerUserId: 'joint-1', viewingDate: '2026-11-20', viewingTime: '11:00' };
  assert.deepEqual(viewingMissingDetails(complete), [VIEWING_BRAND_GAP], 'reports, the offer link and every non joint agent login still see the brand gap');
  assert.equal(VIEWING_BRAND_GAP, 'Confirm the brand');
  assert.deepEqual(viewingGapsForJointAgent(complete), []);
  assert.deepEqual(viewingGapsForJointAgent({ ...complete, companyName: '  ' }), [VIEWING_BRAND_GAP], 'no name typed: the brand is still theirs to give');
  assert.deepEqual(viewingGapsForJointAgent({ ...complete, typedContact: false, viewingTime: null }), ['Choose a brand contact or representing agent', 'Set the viewing time']);
  const linked = { ...complete, companyId: 'brand-1' };
  assert.deepEqual(viewingGapsForJointAgent(linked), viewingMissingDetails(linked));
});

test('no follow-up task is raised for a joint agent over a typed brand alone, and BGP agents are asked exactly as before', () => {
  const now = new Date('2026-11-12T10:00:00Z');
  const typed = { id: 'v-typed', unitId: 'unit-1', companyId: null, companyName: 'New Brand Ltd', contactId: null, agentContactId: null, contactName: 'Sam Visitor',
    ownerUserId: 'joint-1', viewingDate: '2026-11-20', viewingTime: '11:00', status: 'scheduled', outcome: null, detailsConfirmedAt: '2026-11-12T09:00:00Z',
    createdAt: '2026-11-12T09:00:00Z', unitName: 'Unit 1', propertyName: 'Shopping centre', sourceDetails: { typedContact: true } };
  assert.equal(viewingFollowupDecision(typed, now, true).needed, false, 'confirmed, typed brand, joint agent owner: nothing to chase');
  const bgp = viewingFollowupDecision(typed, now);
  assert.equal(bgp.kind, 'details');
  assert.deepEqual(bgp.reasons, ['Confirm the brand'], 'the same viewing with a BGP agent still asks BGP to link the brand');
  const unconfirmed = viewingFollowupDecision({ ...typed, detailsConfirmedAt: null }, now, true);
  assert.equal(unconfirmed.kind, 'details');
  assert.deepEqual(unconfirmed.reasons, ['Review and confirm the booking details'], 'what is left is theirs to do');
  const untimed = viewingFollowupDecision({ ...typed, viewingTime: null }, now, true);
  assert.deepEqual(untimed.reasons, ['Set the viewing time']);
  const unnamed = viewingFollowupDecision({ ...typed, companyName: null }, now, true);
  assert.deepEqual(unnamed.reasons, ['Confirm the brand'], 'no brand at all is still asked of a joint agent');
  const past = viewingFollowupDecision({ ...typed, viewingDate: '2026-11-10' }, now, true);
  assert.equal(past.kind, 'outcome', 'the outcome prompt is no longer hidden behind the brand');
});

// What the server does with a scoped login's copy of a viewing, read from
// the source of server/leasing-viewings.ts (the file itself needs a database).
function viewingServer() {
  const file = 'server/leasing-viewings.ts';
  const fn = name => find(file, node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  return evaluate(`${fn('serializeViewingForScope')}\n${fn('diaryNoteToStore')}\nexports.diaryNoteToStore = diaryNoteToStore;`, { createHash: require('node:crypto').createHash });
}

test('a scoped login is sent a stand-in for the Outlook invitation id, the same for every unit of the visit', () => {
  const { serializeViewingForScope } = viewingServer();
  const diary = { id: 'a', source: 'diary', bookingId: 'AAMkAGI2-invitation-uid', calendarEventId: 'AAMkAGI2-invitation-uid' };
  const second = { id: 'b', source: 'diary', bookingId: 'AAMkAGI2-invitation-uid', calendarEventId: 'AAMkAGI2-invitation-uid::unit:unit-2' };
  for (const jointAgent of [false, true]) {
    const sent = serializeViewingForScope(diary, true, jointAgent);
    assert.match(sent.bookingId, /^visit:[0-9a-f]{16}$/);
    assert.ok(!JSON.stringify({ ...sent, calendarEventId: null }).includes('AAMkAGI2'));
    assert.equal(serializeViewingForScope(second, true, jointAgent).bookingId, sent.bookingId, 'the units of one visit still group');
    assert.notEqual(serializeViewingForScope({ ...diary, bookingId: 'another-invitation' }, true, jointAgent).bookingId, sent.bookingId);
  }
  assert.equal(serializeViewingForScope(diary, true, true).calendarEventId, null);
  assert.match(serializeViewingForScope({ source: 'diary', booking_id: 'AAMkAGI2-invitation-uid' }, true).booking_id, /^visit:[0-9a-f]{16}$/);
  assert.equal(serializeViewingForScope({ bookingId: 'manual:viewing-1' }, true, true).bookingId, 'manual:viewing-1', 'an id the app made itself goes as it is');
  assert.equal(serializeViewingForScope({ bookingId: null }, true, true).bookingId, null);
  assert.equal(serializeViewingForScope(diary, false), diary, 'BGP staff get the record as stored');
});

test('a scoped login saving a diary viewing never overwrites the first line of BGP\'s note', () => {
  const { serializeViewingForScope, diaryNoteToStore } = viewingServer();
  const subject = 'Goyard "private" viewing\nsecond line';
  for (const [stored, details] of [
    [`Synced from Outlook: "${subject}"\nPete: wants a wider frontage.`, { subject }],
    [`Synced from Outlook: "${subject}"`, { subject }],
    ['Synced from Outlook: "Older booking"\nCharlotte: send the floor plan.', null],
    ['Synced from Outlook: "Older booking" and a note on the same line', {}],
  ]) {
    const sent = serializeViewingForScope({ source: 'diary', notes: stored, sourceDetails: details }, true, true).notes;
    assert.ok(sent.startsWith('Captured from Outlook.') && !sent.includes('Synced from Outlook'));
    assert.equal(diaryNoteToStore(sent, stored, details), stored, 'the note they were sent, saved back unchanged, stores exactly what was there');
    assert.equal(diaryNoteToStore(`${sent}\nJo: second viewing booked.`, stored, details), `${stored}\nJo: second viewing booked.`);
    const first = /^Synced from Outlook: "Older booking"/.exec(stored)?.[0] || `Synced from Outlook: "${subject}"`;
    assert.equal(diaryNoteToStore('A fresh note.', stored, details), `${first}\nA fresh note.`, 'a note typed afresh goes under the stored line');
    assert.equal(diaryNoteToStore(null, stored, details), first, 'clearing the note leaves the stored line');
    assert.equal(diaryNoteToStore('', stored, details), first);
  }
  assert.equal(diaryNoteToStore('Their note', 'Pete: typed by hand, no Outlook line.', { subject }), 'Their note', 'a note with no Outlook line is theirs to replace');
  assert.equal(diaryNoteToStore('Their note', null, { subject }), 'Their note');
  assert.equal(diaryNoteToStore(null, null, null), null);
});

test('a joint agent has My viewings, sees whose viewing it is by firm, and reports open on their own calendar', () => {
  const app = jointFixture();
  app.data.viewings.push({ ...jointViewing, id: 'viewing-2', ownerUserId: 'joint-1', ownerName: 'Jo Joint', detailsConfirmedAt: null, issues: ['Confirm the viewing details'] });
  let tree = app.render();
  const ownerFilter = app.byTestId(tree, 'viewings-filter-owner');
  assert.deepEqual(Array.from(ownerFilter.props.options, o => o.label), ['My viewings', 'BGP Owner']);
  assert.equal(ownerFilter.props.options[0].id, 'joint-1');
  descendants(tree).find(node => node.type === app.bindings.Pill && content(node).startsWith('Needs details')).props.onClick();
  tree = app.render();
  assert.match(content(tree), /Jo Joint \(CBRE\)/);
  assert.doesNotMatch(content(tree), /Jo Joint \(BGP\)/);
  const reports = jointFixture();
  reports.data.report = buildViewingReport({ viewings: [{ ...viewing, status: 'completed', confirmed: true, viewingDate: today }], offers: [], from: today, to: today, asOf: today });
  const report = reports.renderReport();
  const link = descendants(report).find(node => node.type === 'a' && content(node) === 'Open viewing');
  assert.equal(link.props.href, '/landsec/viewings?viewingId=viewing-1');
});

test('staff and ordinary client logins keep the CRM pickers, the brand links and the full refresh', async () => {
  for (const client of [false, true]) {
    const app = fixture({ client });
    let tree = open(app);
    assert.ok(app.byTestId(tree, 'viewing-workflow-contact'));
    assert.ok(app.byTestId(tree, 'viewing-workflow-agent'));
    assert.equal(app.byTestId(tree, 'viewing-workflow-contact-name'), undefined);
    assert.equal(app.byTestId(tree, 'viewing-workflow-brand-name'), undefined);
    app.byTestId(tree, 'viewing-workflow-save').props.onClick();
    await app.settle();
    for (const key of ['companyName', 'contactName', 'agentContactName']) assert.equal(key in app.calls[0].body, false);
    assert.ok(app.invalidations.some(q => q.queryKey?.[0] === '/api/accounts'));
    descendants(app.render()).find(node => node.type === app.bindings.ViewingsTimeGrid).props.onSelect(app.data.viewings[0]);
    assert.ok(!descendants(app.render()).find(node => node.type === app.bindings.ViewingSummary).props.plain);
  }
});

// The read view of one viewing, rendered through its own small components.
function summaryFixture() {
  const file = 'client/src/components/leasing-viewings-calendar.tsx';
  const ast = ts.createSourceFile(file, source(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declarations = ast.statements.filter(node => !ts.isImportDeclaration(node) && !ts.isInterfaceDeclaration(node) && !ts.isTypeAliasDeclaration(node));
  const compiled = ts.transpileModule(declarations.map(node => node.getText(ast)).join('\n'), { fileName: 'calendar.tsx', compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
  const queries = [], exports = {}, bindings = {};
  for (const node of ast.statements) if (ts.isImportDeclaration(node)) for (const member of node.importClause?.namedBindings?.elements || []) bindings[member.name.text] = function Leaf() { return null; };
  const details = { '/api/crm/companies': { id: 'brand-1', name: 'Brand One', companyType: 'Tenant - Restaurants', domain: 'brand.test', domainUrl: null }, '/api/crm/contacts': { id: 'contact-1', name: 'Brand Contact', role: 'Property director', email: 'person@brand.test', phone: '020 7000 0000', phoneMobile: null, companyName: 'Brand One' } };
  Object.assign(bindings, {
    React, exports, console, Intl, Date, Number, Set, Map, Array, String, calendarDateValue, viewingMissingDetails, viewingNeedsOutcome, encodeURIComponent,
    useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}], useEffect: () => {}, useMemo: fn => fn(), useRef: () => ({ current: null }),
    cn: (...parts) => parts.filter(Boolean).join(' '), localBrandLogoUrl: () => '/logo.png', window: { setInterval: () => 0, clearInterval: () => {} },
    useQuery(config) { queries.push(config); const on = config.enabled !== false; return { data: !on ? undefined : config.queryKey[0] === 'viewing-panel-lookup' ? details[config.queryKey[1]] : { hasLogos: true } }; },
  });
  vm.runInNewContext(compiled, bindings);
  // Function components of the file itself are rendered; imported ones are leaves.
  const expand = node => {
    if (Array.isArray(node)) return node.map(expand);
    if (!React.isValidElement(node)) return node;
    if (typeof node.type === 'function' && node.type.name !== 'Leaf') return expand(node.type(node.props));
    return React.cloneElement(node, {}, ...[].concat(expand(node.props.children) ?? []));
  };
  return { queries, summary: props => expand(exports.ViewingSummary({ today, options, siblings: [], onSelect() {}, ...props })) };
}

test('the joint agent summary looks nothing up in the CRM and shows names without email, phone or a brand page link', () => {
  const plain = summaryFixture();
  const tree = plain.summary({ viewing: { ...jointViewing, companyId: 'brand-1', contactId: 'contact-1', agentContactId: 'contact-1' }, options: jointOptions, plain: true });
  assert.ok(plain.queries.length > 0);
  assert.ok(plain.queries.every(query => query.enabled === false), 'no company, contact or logo library request is made');
  const links = descendants(tree).filter(node => node.type === 'a').map(node => node.props.href);
  assert.deepEqual(links, ['/landsec/tracker?unit=unit-1']);
  const text = content(tree);
  assert.match(text, /Brand Contact/);
  assert.match(text, /Tenant Agent/);
  assert.doesNotMatch(text, /person@brand\.test|020 7000|Property director|Brand page/);
  assert.equal(descendants(tree).find(node => node.type === 'img'), undefined);

  const staff = summaryFixture();
  const full = staff.summary({ viewing: { ...viewing, agentContactId: null } });
  const staffLinks = descendants(full).filter(node => node.type === 'a').map(node => node.props.href);
  assert.ok(staffLinks.includes('/companies/brand-1'));
  assert.ok(staffLinks.includes('mailto:person@brand.test'));
  assert.ok(staffLinks.some(href => href.startsWith('/available?unitId=unit-1')));
  assert.match(content(full), /Property director/);
});
