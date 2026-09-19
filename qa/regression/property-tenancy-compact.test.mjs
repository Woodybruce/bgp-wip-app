import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import React from 'react';
import { createRequire } from 'node:module';
import { formatCalendarDate } from '../../shared/calendar-date.ts';
import * as tenancyDisplay from '../../shared/tenancy-schedule-display.ts';
const require = createRequire(import.meta.url);
const { source, ts } = require('./source-harness.cjs');

const propertyId = 'small-building';
const unit = { id: 'unit-1', property_id: propertyId, unit_number: 'Shop 1', premises: 'Shop 1', floor_level: 'Ground', permitted_use: 'Shop', tenant_name: 'Tenant', status: 'Occupied', nia_sqft: 1250, passing_rent_pa: 24000, lease_expiry: '2030-09-01', next_review_date: '2028-09-01' };
// Put the occupier, area and current rent before dates and optional use detail.
const essentials = ['unit_number', 'floor_level', 'tenant_name', 'status', 'nia_sqft', 'passing_rent_pa', 'lease_expiry', 'next_review_date', 'permitted_use'];
const fullKey = `tenancy-hidden-cols:${propertyId}:tenancy`;
const compactKey = `${fullKey}:compact`;
function descendants(node) {
  if (Array.isArray(node)) return node.flatMap(descendants);
  if (!React.isValidElement(node)) return [];
  return [node, ...descendants(node.props.children)];
}
function fixture({ presentation = 'compact', readOnly = false, saved = {}, width = 1200, user = { role: 'Client', companyScopeId: 'client-company' }, units = [unit], links = { deals: [], lettingUnits: [], matters: [] }, urlSearch = '' } = {}) {
  const file = 'client/src/components/PropertyTenancySchedule.tsx';
  const ast = ts.createSourceFile(file, source(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const kept = new Set(['PropertyTenancySchedule', 'normRefKey', 'fmtCurrency', 'fmtCurrencyCompact', 'fmtNum', 'fmtDate']);
  const declarations = ast.statements.filter(node => ts.isVariableStatement(node) || ts.isFunctionDeclaration(node) && kept.has(node.name?.text));
  const compiled = ts.transpileModule(declarations.map(node => node.getText(ast)).join('\n'), { fileName: 'fixture.tsx', compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
  const slots = [], effects = [], calls = [], pending = [], bindings = {}, storage = new Map(Object.entries(saved));
  const props = { propertyId, presentation, readOnly };
  let cursor = 0;
  const noop = () => {};
  for (const node of ast.statements) {
    if (ts.isImportDeclaration(node)) for (const member of node.importClause?.namedBindings?.elements || []) bindings[member.name.text] = function Leaf() { return null; };
    if (ts.isFunctionDeclaration(node) && !kept.has(node.name?.text)) bindings[node.name.text] = function Leaf() { return null; };
  }
  const changed = (before, next) => !before || !next || before.length !== next.length || next.some((v, i) => !Object.is(v, before[i]));
  Object.assign(bindings, {
    React, exports: {}, console, URLSearchParams, formatCalendarDate, ...tenancyDisplay,
    window: { innerWidth: width },
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial; return [slots[index], next => slots[index] = typeof next === 'function' ? next(slots[index]) : next]; },
    useRef(value) { const index = cursor++; if (!(index in slots)) slots[index] = { current: value }; return slots[index]; },
    useMemo(fn, deps) { const index = cursor++; if (changed(slots[index]?.deps, deps)) slots[index] = { value: fn(), deps }; return slots[index].value; },
    useEffect(fn, deps) { const index = cursor++; if (changed(slots[index], deps)) { slots[index] = deps; effects.push(fn); } },
    useCallback: fn => fn,
    useLocation: () => [`/properties/${propertyId}`], useSearch: () => urlSearch,
    useToast: () => ({ toast: noop }),
    useQueryClient: () => ({ invalidateQueries: noop }),
    useQuery({ queryKey }) { return { data: queryKey[0] === '/api/auth/me' ? user : queryKey.at(-1) === 'links' ? links : units, isLoading: false }; },
    useMutation(options) { return { isPending: false, mutate(value) { pending.push(Promise.resolve().then(() => options.mutationFn(value)).then(result => options.onSuccess?.(result))); } }; },
    apiRequest: async (method, url, body) => { calls.push({ method, url, body }); return { json: async () => ({}) }; },
  });
  vm.runInNewContext(compiled, bindings);
  return {
    props, bindings, storage, calls,
    render() { cursor = 0; const tree = bindings.exports.PropertyTenancySchedule(props); while (effects.length) effects.shift()(); return tree; },
    row(tree) { return descendants(tree).find(node => node.type === bindings.UnitRow); },
    find(tree, id) { return descendants(tree).find(node => node.props['data-testid'] === id); },
    async settle() { while (pending.length) await pending.shift(); },
  };
}

for (const width of [390, 1200]) test(`compact tenancy view starts with essentials and keeps full schedule reachable (${width}px)`, () => {
  const app = fixture({ width });
  const tree = app.render();
  assert.deepEqual(Array.from(app.row(tree).props.columns, c => c.field), essentials);
  assert.ok(app.find(tree, 'link-tenancy-full-board'));
  assert.ok(app.find(tree, 'btn-tenancy-columns'));
  assert.equal(descendants(tree).filter(node => String(node.props['data-testid']).startsWith('tenancy-stat-')).length, 4);
  assert.equal(descendants(tree).some(node => node.type === app.bindings.TrackerSummary), false);
});

test('switching compact/full preferences never replaces the other board columns', () => {
  const app = fixture({ saved: { [fullKey]: JSON.stringify(['service_charge', 'comments']) } });
  let tree = app.render();
  assert.deepEqual(Array.from(app.row(tree).props.columns, c => c.field), essentials);
  app.find(tree, 'btn-tenancy-columns-reset').props.onClick();
  tree = app.render();
  const columnCount = app.row(tree).props.columns.length;
  assert.ok(columnCount > 40);
  assert.equal(app.storage.get(fullKey), JSON.stringify(['service_charge', 'comments']));
  assert.equal(app.storage.get(compactKey), '[]');

  app.props.presentation = 'full';
  tree = app.render();
  assert.equal(app.row(tree).props.columns.length, columnCount - 2);
  app.find(tree, 'btn-tenancy-columns-key').props.onClick();
  tree = app.render();
  const fullAfterEdit = app.storage.get(fullKey);
  assert.equal(app.row(tree).props.columns.length, 5);

  app.props.presentation = 'compact';
  tree = app.render();
  assert.equal(app.row(tree).props.columns.length, columnCount);
  app.find(tree, 'btn-tenancy-columns-compact').props.onClick();
  tree = app.render();
  assert.deepEqual(Array.from(app.row(tree).props.columns, c => c.field), essentials);
  assert.equal(app.storage.get(fullKey), fullAfterEdit);
});

test('compact client rows retain canonical editing, add and export controls', async () => {
  const app = fixture();
  const tree = app.render();
  const row = app.row(tree);
  assert.equal(row.props.readOnly, false);
  assert.ok(app.find(tree, 'btn-add-tenancy-unit'));
  assert.ok(app.find(tree, 'btn-export-tenancy'));
  assert.equal(app.find(tree, 'btn-import-tenancy'), undefined);
  assert.equal(row.props.onToggleSelect, undefined, 'staff bulk controls remain restricted');
  row.props.onUpdate('unit-1', 'passing_rent_pa', '27000');
  await app.settle();
  assert.deepEqual(JSON.parse(JSON.stringify(app.calls)), [{ method: 'PUT', url: '/api/tenancy-schedule/unit/unit-1', body: { id: 'unit-1', passing_rent_pa: '27000' } }]);
  const phoneEditors = descendants(tree).filter(node => node.type === app.bindings.InlineEdit).map(node => node.props.field);
  assert.deepEqual(phoneEditors, ['nia_sqft', 'passing_rent_pa']);
});

test('compact presentation respects explicit read-only and malformed saved preferences', () => {
  const app = fixture({ readOnly: true, saved: { [compactKey]: '{bad JSON' } });
  const tree = app.render();
  assert.equal(app.row(tree).props.readOnly, true);
  assert.deepEqual(Array.from(app.row(tree).props.columns, c => c.field), essentials);
  assert.equal(app.find(tree, 'btn-add-tenancy-unit'), undefined);
  assert.equal(descendants(tree).filter(node => node.type === app.bindings.InlineEdit).length, 0);
});

function content(node) {
  if (Array.isArray(node)) return node.map(content).join(' ');
  if (React.isValidElement(node)) return content(node.props.children);
  return node === null || node === undefined ? '' : String(node);
}
const tableRows = (app, tree) => descendants(tree).filter(node => node.type === app.bindings.UnitRow);

test('history is opt-in and never inflates current rent, area or service-charge totals', () => {
  const app = fixture({ presentation: 'full', units: [
    { ...unit, passing_rent_pa: 20000, nia_sqft: 1000, service_charge: 2000, blended_erv: 20 },
    { ...unit, id: 'old', status: ' Archived ', occupancy_status: 'Occupied', passing_rent_pa: 50000, nia_sqft: 2000, service_charge: 8000, blended_erv: 100 },
    { ...unit, id: 'old-occupancy', status: 'Occupied', occupancy_status: ' aRcHiVeD ', passing_rent_pa: 90000, nia_sqft: 3000, service_charge: 9000, blended_erv: 200 },
  ] });
  let tree = app.render();
  assert.deepEqual(tableRows(app, tree).map(row => row.props.unit.id), ['unit-1']);
  assert.match(content(app.find(tree, 'tenancy-stat-passing-rent')), /£20,000/);
  assert.match(content(app.find(tree, 'tenancy-stat-total-nia')), /1,000 sq ft/);
  assert.match(content(app.find(tree, 'tenancy-stat-service-charge')), /£2,000/);
  assert.match(content(app.find(tree, 'tenancy-stat-avg-erv-£psf')), /20/);
  assert.equal(app.find(tree, 'tenancy-show-history').props.active, false);
  app.find(tree, 'tenancy-show-history').props.onClick();
  tree = app.render();
  assert.deepEqual(tableRows(app, tree).map(row => row.props.unit.id), ['unit-1', 'old', 'old-occupancy']);
  assert.match(content(app.find(tree, 'tenancy-history-note')), /Headline figures cover current rows only/);
  assert.match(content(app.find(tree, 'tenancy-stat-passing-rent')), /£20,000/);
  assert.doesNotMatch(content(app.find(tree, 'tenancy-stat-passing-rent')), /70,000/);
  assert.equal(tableRows(app, tree)[1].props.readOnly, false, 'history does not change existing editing permissions');
  app.find(tree, 'tenancy-show-history').props.onClick();
  assert.deepEqual(tableRows(app, app.render()).map(row => row.props.unit.id), ['unit-1']);
  assert.equal(app.calls.length, 0, 'showing history must never change records');
});

test('missing values remain unknown, partial totals disclose coverage, and recorded zero remains zero', () => {
  for (const invalid of [null, undefined, '', ' ', 'unknown', Infinity, -1]) {
    const app = fixture({ units: [{ ...unit, passing_rent_pa: invalid, nia_sqft: invalid }] });
    const tree = app.render();
    assert.match(content(app.find(tree, 'tenancy-stat-passing-rent')), /Not recorded/);
    assert.match(content(app.find(tree, 'tenancy-stat-total-nia')), /Not recorded/);
  }
  const partial = fixture({ units: [unit, { ...unit, id: 'missing', passing_rent_pa: null, nia_sqft: null }] });
  const tree = partial.render();
  assert.match(content(partial.find(tree, 'tenancy-stat-passing-rent')), /£24,000.*Incomplete total · 1 of 2 current rows recorded/);
  assert.match(content(partial.find(tree, 'tenancy-stat-total-nia')), /1,250 sq ft.*Incomplete total · 1 of 2 current rows recorded/);
  const zero = fixture({ units: [{ ...unit, passing_rent_pa: 0, nia_sqft: 0 }] });
  const zeroTree = zero.render();
  assert.match(content(zero.find(zeroTree, 'tenancy-stat-passing-rent')), /£0/);
  assert.match(content(zero.find(zeroTree, 'tenancy-stat-total-nia')), /0 sq ft/);
  assert.doesNotMatch(content(zero.find(zeroTree, 'tenancy-stat-passing-rent')), /Incomplete|Not recorded/);
});

test('occupied and vacant pills filter the same aliases counted in their headlines', () => {
  const occupied = ['Occupied', 'Trading', 'Let', 'Not Vacant', ' trading '];
  const vacant = ['Vacant', 'Void', 'Available', 'AVA', ' ava '];
  const app = fixture({ units: [...occupied, ...vacant, 'Archived'].map((status, id) => ({ ...unit, id: String(id), status })) });
  let tree = app.render();
  const occupiedPill = app.find(tree, 'tenancy-stat-occupied');
  assert.equal(occupiedPill.type, app.bindings.Pill);
  assert.match(content(occupiedPill), /Occupied\s+5/);
  occupiedPill.props.onClick();
  tree = app.render();
  assert.deepEqual(tableRows(app, tree).map(row => row.props.unit.status), occupied);
  assert.equal(app.find(tree, 'tenancy-stat-occupied').props.active, true);
  app.find(tree, 'tenancy-stat-vacant').props.onClick();
  tree = app.render();
  assert.deepEqual(tableRows(app, tree).map(row => row.props.unit.status), vacant);
  assert.match(content(app.find(tree, 'tenancy-stat-vacant')), /Vacant\s+5/);
  app.find(tree, 'tenancy-stat-vacant').props.onClick();
  assert.equal(tableRows(app, app.render()).length, occupied.length + vacant.length);
});

test('legacy links require unique exact nonempty unit identities, never a prefix or shared tenant name', () => {
  const app = fixture({ units: [
    { ...unit, id: 'one', unit_number: '1', premises: '', trading_name: 'Shared brand' },
    { ...unit, id: 'blank', unit_number: '', premises: '', trading_name: 'Shared brand' },
    { ...unit, id: 'normalised', unit_number: 'Shop A01' },
    { ...unit, id: 'ambiguous', unit_number: 'B1' },
  ], links: {
    deals: [{ id: 'prefix', name: 'Unit 10' }, { id: 'tenant', name: 'Shared brand' }, { id: 'one-deal', name: 'Unit 1' }, { id: 'a-deal', name: 'A1' }, { id: 'b-deal-1', name: 'B1' }, { id: 'b-deal-2', name: 'Unit B1' }],
    lettingUnits: [{ id: 'prefix-tracker', unit_name: '10' }, { id: 'one-tracker', unit_name: 'Shop 1' }, { id: 'a-tracker', unit_name: 'A1' }, { id: 'b-tracker-1', unit_name: 'B1' }, { id: 'b-tracker-2', unit_name: 'Unit B1' }],
  } });
  assert.deepEqual(tableRows(app, app.render()).map(row => [row.props.unit.id, row.props.deal?.id, row.props.letting?.id]), [
    ['one', 'one-deal', 'one-tracker'], ['blank', undefined, undefined], ['normalised', 'a-deal', 'a-tracker'], ['ambiguous', undefined, undefined],
  ]);
});

test('canonical links remain authoritative even if missing, and a matched tracker can identify its named deal', () => {
  const app = fixture({ units: [
    { ...unit, id: 'canonical', unit_number: '1', deal_id: 'explicit-deal', letting_tracker_unit_id: 'explicit-tracker' },
    { ...unit, id: 'missing', unit_number: '1', deal_id: 'missing-deal', letting_tracker_unit_id: 'missing-tracker' },
    { ...unit, id: 'derived', unit_number: '2' },
  ], links: {
    deals: [{ id: 'name-deal', name: '1' }, { id: 'explicit-deal', name: 'Renamed recorded deal' }, { id: 'tracker-deal', name: 'Centre – unit 2 – brand' }],
    lettingUnits: [{ id: 'name-tracker', unit_name: '1' }, { id: 'explicit-tracker', unit_name: 'Renamed recorded unit' }, { id: 'second-tracker', unit_name: '2', dealId: 'tracker-deal' }],
  } });
  assert.deepEqual(tableRows(app, app.render()).map(row => [row.props.unit.id, row.props.deal?.id, row.props.letting?.id]), [
    ['canonical', 'explicit-deal', 'explicit-tracker'], ['missing', undefined, undefined], ['derived', 'tracker-deal', 'second-tracker'],
  ]);
});

test('a direct link to an archived tenancy reveals its history without including its rent in current income', () => {
  const app = fixture({ urlSearch: '?unitId=old', units: [{ ...unit, id: 'old', status: 'Occupied', occupancy_status: ' Archived ', passing_rent_pa: 50000 }] });
  app.render();
  const tree = app.render();
  assert.deepEqual(tableRows(app, tree).map(row => row.props.unit.id), ['old']);
  assert.equal(app.find(tree, 'tenancy-show-history').props.active, true);
  assert.match(content(app.find(tree, 'tenancy-stat-passing-rent')), /Not recorded.*No current rows/);
});
