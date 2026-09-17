import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import React from 'react';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { source, ts } = require('./source-harness.cjs');

const file = 'client/src/pages/properties.tsx';
const ast = ts.createSourceFile(file, source(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const constants = new Set(['HIDDEN_FROM_ALL', 'STATUS_OPTIONS', 'PROPERTY_STATUS_COLORS', 'BUILDING_ICON_COLORS', 'ASSET_CLASS_OPTIONS', 'ASSET_CLASS_COLORS', 'TEAM_OPTIONS', 'TEAM_COLORS']);
const declarations = ast.statements.filter(node => ts.isFunctionDeclaration(node) && node.name?.text === 'PropertiesList' ||
  ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration => constants.has(declaration.name.getText(ast))));
const sortAst = ts.createSourceFile('sort.ts', source('client/src/hooks/use-table-sort.ts'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const sortHook = sortAst.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'useTableSort').getText(sortAst);
const compiled = ts.transpileModule(declarations.map(node => node.getText(ast)).join('\n') + '\n' + sortHook + '\nexports.PropertiesList = PropertiesList;', {
  fileName: 'fixture.tsx', compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
}).outputText;
const rows = count => Array.from({ length: count }, (_, index) => ({ id: `p${index}`, name: `Property ${String(index).padStart(3, '0')}`, status: index % 2 ? 'BGP Targeting' : 'BGP Active', bgpEngagement: ['Leasing'], groupName: 'Properties', sqft: index + 1 }));
function descendants(node) {
  if (Array.isArray(node)) return node.flatMap(descendants);
  if (!React.isValidElement(node)) return [];
  return [node, ...descendants(node.props.children)];
}
function content(node) {
  if (Array.isArray(node)) return node.map(content).join(' ');
  if (React.isValidElement(node)) return content(node.props.children);
  return node == null ? '' : String(node);
}

function fixture({ count = 121, mobile = false, client = false } = {}) {
  const input = { properties: rows(count), activeTeam: 'All', user: client ? { role: 'Client', companyScopeId: 'owner' } : { role: 'Admin' }, companies: [] };
  const slots = [], effects = [], requests = [], empty = [], bindings = {};
  let cursor = 0, dirty = false;
  const props = { search: '', activeGroup: 'all', columnFilters: {}, createDialogOpen: false, teamFilter: null };
  Object.assign(props, {
    setSearch: value => { props.search = value; }, setActiveGroup: value => { props.activeGroup = value; },
    setColumnFilters: fn => { props.columnFilters = fn(props.columnFilters); }, setCreateDialogOpen: value => { props.createDialogOpen = value; },
  });
  for (const node of ast.statements) {
    if (ts.isImportDeclaration(node)) for (const member of node.importClause?.namedBindings?.elements || []) bindings[member.name.text] = function Leaf() { return null; };
    if (ts.isFunctionDeclaration(node) && node.name?.text !== 'PropertiesList') bindings[node.name.text] = function Leaf() { return null; };
  }
  const changed = (previous, next) => !previous || !next || previous.length !== next.length || next.some((value, i) => !Object.is(value, previous[i]));
  const useMemo = (fn, deps) => { const index = cursor++; if (changed(slots[index]?.deps, deps)) slots[index] = { deps, value: fn() }; return slots[index].value; };
  Object.assign(bindings, {
    React, exports: {}, console, URLSearchParams,
    window: { innerWidth: mobile ? 390 : 1280 }, localStorage: { getItem: () => null },
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial; return [slots[index], next => { const value = typeof next === 'function' ? next(slots[index]) : next; if (!Object.is(value, slots[index])) { slots[index] = value; dirty = true; } }]; },
    useMemo, useCallback: (fn, deps) => useMemo(() => fn, deps),
    useRef(value) { const index = cursor++; if (!(index in slots)) slots[index] = { current: value }; return slots[index]; },
    useEffect(fn, deps) { const index = cursor++; if (changed(slots[index], deps)) { slots[index] = deps; effects.push(fn); } },
    useToast: () => ({ toast() {} }), useIsMobile: () => mobile, useTeam: () => ({ activeTeam: input.activeTeam }),
    useQuery({ queryKey }) { return { data: queryKey[0] === '/api/crm/properties' ? input.properties : queryKey[0] === '/api/auth/me' ? input.user : queryKey[0] === '/api/crm/companies' ? input.companies : empty, isLoading: false }; },
    useMutation(options) { return { isPending: false, mutate(value) { options.mutationFn(value); } }; },
    apiRequest: async (method, url, body) => { requests.push({ method, url, body }); return { json: async () => ({}) }; },
    buildUserColorMap: () => new Map(), CRM_OPTIONS: { dealTeam: ['Leasing', 'Investment'] },
    formatAddress: value => typeof value === 'string' ? value : '', extractPostcode: () => '', addressToResult: () => null,
    countLabel: (count, singular, plural) => `${count} ${count === 1 ? singular : plural}`,
  });
  vm.runInNewContext(compiled, bindings);
  return {
    props, input, bindings, requests,
    render() { let tree; for (let pass = 0; pass < 10; pass++) { cursor = 0; dirty = false; tree = bindings.exports.PropertiesList(props); while (effects.length) effects.shift()(); if (!dirty) return tree; } throw new Error('Render did not settle'); },
    find(tree, id) { return descendants(tree).find(node => node.props['data-testid'] === id); },
    tableRows(tree) { return descendants(tree).filter(node => String(node.props['data-testid']).startsWith('property-row-')).map(node => node.props['data-testid'].replace('property-row-', '')); },
    cards(tree) { return descendants(tree).find(node => node.type === bindings.MobileCardView)?.props.items || []; },
    header(tree) { return descendants(tree).find(node => node.type === bindings.PropertiesBoardHeader); },
    sort(tree) { return descendants(tree).find(node => node.type === bindings.SortableTableHead)?.props.sort; },
  };
}

test('desktop property pages render 50 rows while global counts and header inputs retain all matches', () => {
  const app = fixture({ count: 476 });
  let tree = app.render();
  assert.equal(app.tableRows(tree).length, 50);
  assert.deepEqual(app.tableRows(tree), rows(50).map(row => row.id));
  assert.equal(app.header(tree).props.items.length, 476);
  assert.match(content(app.find(tree, 'property-pagination-top')), /1.–.50.*476/s);
  assert.equal(app.find(tree, 'property-page-prev-top').props.disabled, true);
  app.find(tree, 'property-page-next-top').props.onClick();
  tree = app.render();
  assert.equal(app.tableRows(tree)[0], 'p50');
  app.find(tree, 'property-page-select-top').props.onChange({ target: { value: '10' } });
  tree = app.render();
  assert.equal(app.tableRows(tree).length, 26);
  assert.equal(app.tableRows(tree)[0], 'p450');
  assert.equal(app.find(tree, 'property-page-next-bottom').props.disabled, true);
});

test('card mode and phone layouts use the same 50-result pages without changing client controls', () => {
  for (const mobile of [false, true]) for (const client of [false, true]) {
    const app = fixture({ mobile, client });
    let tree = app.render();
    if (!mobile) { descendants(tree).find(node => node.type === app.bindings.ViewToggle).props.onToggle('card'); tree = app.render(); }
    assert.equal(app.cards(tree).length, 50);
    app.find(tree, 'property-page-next-bottom').props.onClick();
    tree = app.render();
    assert.equal(app.cards(tree)[0].id, 'p50');
    assert.equal(app.header(tree).props.items.length, 121);
    assert.equal(app.find(tree, 'property-page-select-top').props.value, 2);
    assert.equal(app.requests.length, 0);
  }
});

test('search and column filters apply globally before pagination and reset the page', () => {
  const app = fixture();
  let tree = app.render();
  app.find(tree, 'property-page-select-top').props.onChange({ target: { value: '3' } });
  tree = app.render();
  app.props.columnFilters = { status: ['BGP Targeting'] };
  tree = app.render();
  assert.equal(app.find(tree, 'property-page-select-top').props.value, 1);
  assert.equal(app.header(tree).props.items.length, 60);
  assert.equal(app.tableRows(tree)[0], 'p1');
  assert.equal(app.tableRows(tree).length, 50);
  app.find(tree, 'property-page-next-top').props.onClick();
  tree = app.render();
  assert.equal(app.tableRows(tree).length, 10);
  app.props.search = 'Property 120';
  tree = app.render();
  assert.deepEqual(app.tableRows(tree), ['p120'], 'existing global search ignores other filters and reaches records beyond page one');
  assert.equal(app.find(tree, 'property-page-select-top').props.value, 1);
});

test('sorting resets to the first page; shrinking data clamps the page and does not revive it on growth', () => {
  const app = fixture();
  let tree = app.render();
  app.find(tree, 'property-page-select-top').props.onChange({ target: { value: '3' } });
  tree = app.render();
  app.sort(tree).toggle('name');
  tree = app.render();
  assert.equal(app.find(tree, 'property-page-select-top').props.value, 1);
  assert.equal(app.tableRows(tree)[0], 'p120');
  app.find(tree, 'property-page-select-top').props.onChange({ target: { value: '3' } });
  app.render();
  app.input.properties = rows(60);
  tree = app.render();
  assert.equal(app.find(tree, 'property-page-select-top').props.value, 2);
  assert.equal(app.tableRows(tree).length, 10);
  app.input.properties = rows(121);
  tree = app.render();
  assert.equal(app.find(tree, 'property-page-select-top').props.value, 2);
});

test('header selection covers only this page; all-matches selection is explicit and hidden-page counts are visible', () => {
  const app = fixture();
  let tree = app.render();
  const checkbox = app.find(tree, 'checkbox-select-all-properties');
  assert.equal(checkbox.props['aria-label'], 'Select properties on this page');
  checkbox.props.onCheckedChange(true);
  tree = app.render();
  assert.match(content(app.find(tree, 'text-selected-count-properties')), /50.*selected/);
  assert.ok(app.find(tree, 'select-all-matching-properties'));
  app.find(tree, 'property-page-next-top').props.onClick();
  tree = app.render();
  assert.equal(app.find(tree, 'checkbox-select-all-properties').props.checked, false);
  assert.match(content(app.find(tree, 'text-selected-count-properties')), /50.*on other pages/);
  app.find(tree, 'checkbox-select-all-properties').props.onCheckedChange(true);
  tree = app.render();
  assert.match(content(app.find(tree, 'text-selected-count-properties')), /100.*selected/);
  app.find(tree, 'checkbox-select-all-properties').props.onCheckedChange(false);
  tree = app.render();
  assert.match(content(app.find(tree, 'text-selected-count-properties')), /50.*selected/);
  app.find(tree, 'select-all-matching-properties').props.onClick();
  tree = app.render();
  assert.match(content(app.find(tree, 'text-selected-count-properties')), /121.*selected/);
  assert.equal(app.find(tree, 'select-all-matching-properties'), undefined);
  app.find(tree, 'clear-selected-properties').props.onClick();
  assert.equal(app.find(app.render(), 'bulk-action-bar-properties'), undefined);
  assert.equal(app.requests.length, 0);
});

test('filter/team changes clear selection and data removal drops IDs from bulk payloads', () => {
  const app = fixture();
  let tree = app.render();
  app.find(tree, 'checkbox-select-all-properties').props.onCheckedChange(true);
  tree = app.render();
  app.props.search = 'Property 100';
  tree = app.render();
  assert.equal(app.find(tree, 'bulk-action-bar-properties'), undefined);
  app.find(tree, 'checkbox-select-all-properties').props.onCheckedChange(true);
  app.render();
  app.props.teamFilter = 'Leasing';
  tree = app.render();
  assert.equal(app.find(tree, 'bulk-action-bar-properties'), undefined);
  app.props.search = '';
  app.props.teamFilter = null;
  tree = app.render();
  app.find(tree, 'checkbox-select-all-properties').props.onCheckedChange(true);
  app.render();
  app.input.properties = app.input.properties.filter(row => row.id !== 'p0');
  tree = app.render();
  assert.match(content(app.find(tree, 'text-selected-count-properties')), /49.*selected/);
  app.find(tree, 'bulk-team-option-leasing').props.onClick();
  assert.equal(app.requests[0].body.ids.length, 49);
  assert.equal(app.requests[0].body.ids.includes('p0'), false);
});

test('an empty search result leaves no stale page or selection', () => {
  const app = fixture();
  let tree = app.render();
  app.find(tree, 'property-page-next-top').props.onClick();
  app.render();
  app.props.search = 'missing-property';
  tree = app.render();
  assert.equal(app.tableRows(tree).length, 0);
  assert.equal(app.find(tree, 'property-pagination-top'), undefined);
  app.props.search = '';
  tree = app.render();
  assert.equal(app.find(tree, 'property-page-select-top').props.value, 1);
});
