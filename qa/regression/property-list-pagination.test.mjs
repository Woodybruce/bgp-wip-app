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

function fixture({ count = 121, mobile = false, client = false, team = 'All', user, home } = {}) {
  const input = { properties: rows(count), activeTeam: team, user: user || (client ? { role: 'Client', companyScopeId: 'owner' } : { role: 'Admin' }), companies: [], home };
  const slots = [], effects = [], requests = [], empty = [], bindings = {}, queries = {};
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
    useToast: () => ({ toast() {} }), useIsMobile: () => mobile, useTeam: () => ({ activeTeam: input.activeTeam }), useIsLandsecView: () => input.activeTeam === 'Landsec',
    useQuery({ queryKey, enabled }) {
      queries[queryKey[0]] = { enabled };
      if (queryKey[0] === '/api/landsec/home') return { data: enabled ? input.home : undefined, isLoading: false, isError: false };
      return { data: queryKey[0] === '/api/crm/properties' ? input.properties : queryKey[0] === '/api/auth/me' ? input.user : queryKey[0] === '/api/crm/companies' ? input.companies : empty, isLoading: false };
    },
    useMutation(options) { return { isPending: false, mutate(value) { options.mutationFn(value); } }; },
    apiRequest: async (method, url, body) => { requests.push({ method, url, body }); return { json: async () => ({}) }; },
    buildUserColorMap: () => new Map(), CRM_OPTIONS: { dealTeam: ['Leasing', 'Investment'] },
    formatAddress: value => typeof value === 'string' ? value : '', extractPostcode: () => '', addressToResult: () => null,
    countLabel: (count, singular, plural) => `${count} ${count === 1 ? singular : plural}`,
  });
  vm.runInNewContext(compiled, bindings);
  return {
    props, input, bindings, requests, queries,
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
  // One page of results: the pager is hidden rather than showing "1 of 1".
  assert.equal(app.find(tree, 'property-page-select-top'), undefined);
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

// The Landsec view of Properties (docs/landsec-menu-plan-2026-11-12.md, part 3).
const landsecScheme = (key, name, town, propertyId) => ({
  key, name, town, group: 'South', propertyId, recordCount: propertyId ? 1 : 0, units: 10, vacant: 1, passingRent: 0, rentUnits: 0,
  pipeline: { tracker: { AVA: 1, NEG: 2, HOT: 0, SOL: 0 }, liveLettings: 3, liveDeals: 3, stuck: 1, oldestLiveDays: 40 },
});
const landsecHome = (staff = false) => ({
  companyId: 'landsec',
  groups: [{ group: 'South', schemes: [landsecScheme('bluewater', 'Bluewater', 'Kent', 'p0'), landsecScheme('westgate-oxford', 'Westgate Oxford', 'Oxford', null)] }],
  totals: { units: 20, vacant: 2, liveLettings: 6, liveDeals: 6, stuck: 2, tracker: { AVA: 2, NEG: 4, HOT: 0, SOL: 0 }, withRecord: 1 },
  ...(staff ? { outOfScope: [], outsideSchemes: null, trackerCheck: { differ: false, trackerRows: 6, liveLettings: 6, rowsWithoutLetting: 0, lettingsWithoutRow: 0, report: '' } } : {}),
});
const landsecLogin = { role: 'Client', companyScopeId: 'landsec' };

test('the Landsec view opens on Schemes; Table and Cards bring back the property list', () => {
  const home = landsecHome();
  const app = fixture({ count: 3, team: 'Landsec', user: landsecLogin, home });
  let tree = app.render();
  const groups = () => descendants(tree).find(node => node.type === app.bindings.SchemeGroups);
  assert.ok(app.find(tree, 'properties-landsec-schemes'), 'Schemes is the default view');
  assert.equal(app.tableRows(tree).length, 0);
  assert.equal(app.cards(tree).length, 0);
  // A scheme card opens the scheme's property page; a scheme with no record goes nowhere.
  assert.equal(groups().props.hrefFor(home.groups[0].schemes[0]), '/properties/p0');
  assert.equal(groups().props.hrefFor(home.groups[0].schemes[1]), null);
  assert.equal(groups().props.isStaff, false);
  // The header is handed the feed's totals: it counts nothing itself.
  assert.deepEqual(app.header(tree).props.landsec, home.totals);
  // The search box filters the scheme cards.
  app.props.search = 'oxford';
  tree = app.render();
  assert.deepEqual(groups().props.groups[0].schemes.map(s => s.key), ['westgate-oxford']);
  app.props.search = 'nowhere';
  tree = app.render();
  assert.equal(groups(), undefined);
  assert.ok(app.find(tree, 'properties-landsec-schemes-empty'));
  app.props.search = '';
  tree = app.render();
  // Table and Cards are the list, on the same pill row; the plain view toggle is not drawn twice.
  app.find(tree, 'button-view-table').props.onClick();
  tree = app.render();
  assert.equal(app.find(tree, 'properties-landsec-schemes'), undefined);
  assert.deepEqual(app.tableRows(tree), ['p0', 'p1', 'p2']);
  assert.equal(descendants(tree).some(node => node.type === app.bindings.ViewToggle), false);
  app.find(tree, 'button-view-card').props.onClick();
  tree = app.render();
  assert.equal(app.cards(tree).length, 3);
  app.find(tree, 'button-view-schemes').props.onClick();
  tree = app.render();
  assert.ok(app.find(tree, 'properties-landsec-schemes'));
  assert.equal(app.requests.length, 0);
});

test('a phone in the Landsec view has Schemes and Cards, never a table', () => {
  const app = fixture({ count: 3, mobile: true, team: 'Landsec', user: landsecLogin, home: landsecHome() });
  let tree = app.render();
  assert.ok(app.find(tree, 'button-view-schemes'));
  assert.equal(app.find(tree, 'button-view-table'), undefined);
  app.find(tree, 'button-view-card').props.onClick();
  tree = app.render();
  assert.equal(app.cards(tree).length, 3);
  assert.equal(app.tableRows(tree).length, 0);
});

test('a Landsec view whose session is not scoped to a client company lists only the scheme records', () => {
  // The list is cut to the 14 schemes on the server for a scoped session. A
  // BGP staff login with no team of its own (or whose own team is Landsec) is
  // not scoped and is sent the whole BGP portfolio: it must not appear under
  // a Landsec heading. The list is cut to the records the feed names for
  // staff, and to nothing when the feed names none.
  const home = landsecHome(true);
  home.groups[0].schemes[0].records = [{ id: 'p0', name: 'Bluewater', units: 20, deals: 6, files: 0 }];
  const staff = fixture({ count: 3, team: 'Landsec', user: { role: 'Admin' }, home });
  let tree = staff.render();
  staff.find(tree, 'button-view-table').props.onClick();
  tree = staff.render();
  assert.deepEqual(staff.tableRows(tree), ['p0']);
  assert.equal(staff.header(tree).props.items.length, 1);

  const app = fixture({ count: 3, team: 'Landsec', user: { role: 'Admin' }, home: landsecHome() });
  tree = app.render();
  app.find(tree, 'button-view-table').props.onClick();
  tree = app.render();
  assert.equal(app.tableRows(tree).length, 0);
  assert.equal(app.header(tree).props.items.length, 0);
});

test('the Landsec admin block gets the feed and the admin flag; the block itself draws only for BGP staff', () => {
  const block = app => descendants(app.render()).find(node => node.type === app.bindings.LandsecAdminBlock);
  const groups = app => descendants(app.render()).find(node => node.type === app.bindings.SchemeGroups);
  const staffHome = landsecHome(true);
  const admin = fixture({ count: 3, team: 'Landsec', user: { role: 'Admin', companyScopeId: 'landsec', isAdmin: true }, home: staffHome });
  assert.equal(block(admin).props.data, staffHome);
  assert.equal(block(admin).props.isAdmin, true);
  assert.equal(groups(admin).props.isStaff, true);
  const client = fixture({ count: 3, team: 'Landsec', user: landsecLogin, home: landsecHome() });
  assert.equal(block(client).props.isAdmin, false);
  assert.equal(block(client).props.data.outOfScope, undefined, 'a client login is sent no staff fields, so the block draws nothing');
});

test('other clients and BGP staff in their own view have no Schemes view and never ask for the Landsec feed', () => {
  for (const client of [false, true]) {
    const app = fixture({ client });
    const tree = app.render();
    assert.equal(app.find(tree, 'properties-landsec-views'), undefined);
    assert.equal(app.find(tree, 'properties-landsec-schemes'), undefined);
    assert.equal(app.header(tree).props.landsec, undefined);
    assert.equal(descendants(tree).some(node => node.type === app.bindings.LandsecAdminBlock), false);
    assert.ok(descendants(tree).some(node => node.type === app.bindings.ViewToggle));
    assert.equal(app.queries['/api/landsec/home'].enabled, false);
    assert.equal(app.tableRows(tree).length, 50);
  }
});
