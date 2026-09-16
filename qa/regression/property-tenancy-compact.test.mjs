import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import React from 'react';
import { createRequire } from 'node:module';
import { formatCalendarDate } from '../../shared/calendar-date.ts';
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
function fixture({ presentation = 'compact', readOnly = false, saved = {}, width = 1200, user = { role: 'Client', companyScopeId: 'client-company' } } = {}) {
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
    React, exports: {}, console, URLSearchParams, formatCalendarDate,
    window: { innerWidth: width },
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial; return [slots[index], next => slots[index] = typeof next === 'function' ? next(slots[index]) : next]; },
    useRef(value) { const index = cursor++; if (!(index in slots)) slots[index] = { current: value }; return slots[index]; },
    useMemo(fn, deps) { const index = cursor++; if (changed(slots[index]?.deps, deps)) slots[index] = { value: fn(), deps }; return slots[index].value; },
    useEffect(fn, deps) { const index = cursor++; if (changed(slots[index], deps)) { slots[index] = deps; effects.push(fn); } },
    useCallback: fn => fn,
    useLocation: () => [`/properties/${propertyId}`], useSearch: () => '',
    useToast: () => ({ toast: noop }),
    useQueryClient: () => ({ invalidateQueries: noop }),
    useQuery({ queryKey }) { return { data: queryKey[0] === '/api/auth/me' ? user : queryKey.at(-1) === 'links' ? { deals: [], lettingUnits: [], matters: [] } : [unit], isLoading: false }; },
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
