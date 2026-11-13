// Package C of docs/tenant-entity-plan-2026-11-13.md: the tenancy schedule's
// Tenant cell. The brand is picked by id through the tenant route; the lease
// name is plain text; the company on the lease is set by BGP staff only, and
// a client login sees it read-only with its covenant grade (Woody,
// 2026-11-13: "yes"), never the brand's list of companies.
import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import React from 'react';
import { createRequire } from 'node:module';
import { leaseCompanyState } from '../../shared/tenant-entity.ts';
import { namedTenant } from '../../shared/property-units.ts';
const require = createRequire(import.meta.url);
const { source, ts } = require('./source-harness.cjs');

const file = 'client/src/components/PropertyTenancySchedule.tsx';
const screen = source(file);
const picker = source('client/src/components/lease-company-picker.tsx');

// Objects made inside the vm come from another realm: compare them as JSON.
const plain = value => JSON.parse(JSON.stringify(value));

function descendants(node) {
  if (Array.isArray(node)) return node.flatMap(descendants);
  if (!React.isValidElement(node)) return [];
  return [node, ...descendants(node.props.children)];
}

// The picker's number rule, run from its own source.
const pickerAst = ts.createSourceFile('picker.tsx', picker, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const { cleanCompanyNumber } = (() => {
  const text = pickerAst.statements.filter(node => ts.isFunctionDeclaration(node) && node.name?.text === 'cleanCompanyNumber').map(node => node.getText(pickerAst)).join('\n');
  const exports = {};
  vm.runInNewContext(ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports });
  return exports;
})();

// Runs the real TenantCell. Every imported component is a named stand-in, so
// the tree shows which ones the cell draws and with what props.
function tenantCell() {
  const ast = ts.createSourceFile(file, screen, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const kept = new Set(['TenantCell', 'InlineEdit', 'fmtDate', 'fmtCurrency', 'fmtNum']);
  const input = ast.statements.filter(node => ts.isVariableStatement(node) || ts.isFunctionDeclaration(node) && kept.has(node.name?.text))
    .map(node => node.getText(ast)).join('\n');
  const compiled = ts.transpileModule(input, { fileName: 'cell.tsx', compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
  const slots = [], toasts = [];
  let cursor = 0;
  const bindings = { React, exports: {}, console, confirm: () => true };
  for (const node of ast.statements) {
    if (ts.isImportDeclaration(node)) {
      for (const member of node.importClause?.namedBindings?.elements || []) {
        const name = member.name.text;
        bindings[name] = { [name]: function () { return null; } }[name];
      }
    } else if (ts.isFunctionDeclaration(node) && !kept.has(node.name?.text)) {
      const name = node.name.text;
      bindings[name] = { [name]: function () { return null; } }[name];
    }
  }
  Object.assign(bindings, {
    leaseCompanyState, namedTenant, cleanCompanyNumber,
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial; return [slots[index], next => { slots[index] = typeof next === 'function' ? next(slots[index]) : next; }]; },
    useRef(value) { const index = cursor++; if (!(index in slots)) slots[index] = { current: value }; return slots[index]; },
    useToast: () => ({ toast: event => toasts.push(event) }),
  });
  vm.runInNewContext(compiled, bindings);
  return {
    bindings, toasts,
    render(props) { cursor = 0; return bindings.TenantCell(props); },
    of(tree, type) { return descendants(tree).filter(node => node.type === bindings[type]); },
    byId(tree, id) { return descendants(tree).find(node => node.props['data-testid'] === id); },
  };
}

const linked = {
  id: 'u1', property_id: 'p1', status: 'Occupied', tenant_name: 'ITX UK Limited', trading_name: 'Zara',
  tenant_company_id: 'brand-1', resolved_tenant_company_id: 'brand-1', resolved_tenant_company_name: 'Zara',
  tenant_entity_id: 'ent-1', tenant_entity_name: 'ITX UK Limited', tenant_entity_ch: '01234567', lease_in_brand_name: false,
};

test('the old name-only brand picker is gone and the brand is picked by id through the tenant route', () => {
  assert.doesNotMatch(screen, /TenantBrandPicker/);
  assert.doesNotMatch(screen, /CrmEntityPicker/);
  assert.match(screen, /apiRequest\("PUT", `\/api\/tenancy-schedule\/unit\/\$\{id\}\/tenant`, body\)/);
  assert.match(screen, /const body: TenantWriteInput = \{ companyId: pick\.companyId \};/);
  assert.doesNotMatch(screen, /onSave\(unitId, field, opt\.name\)/);
});

test('picking a brand sends its id, and the trading name only when the row has none', () => {
  for (const [trading, expected] of [['', { companyId: 'b2', tradingName: 'Bershka' }], ['Zara', { companyId: 'b2' }]]) {
    const cell = tenantCell(), sent = [];
    const props = { unit: { ...linked, trading_name: trading }, isClientViewer: false, onUpdate() {}, onSetTenant: (id, body) => sent.push([id, body]) };
    let tree = cell.render(props);
    cell.byId(tree, 'tenancy-brand-change-u1').props.onClick();
    tree = cell.render(props);
    const search = cell.of(tree, 'BrandSearchInput')[0];
    assert.equal(search.props.allowCreate, true);
    search.props.onPick({ name: 'Bershka', companyId: 'b2' });
    assert.deepEqual(plain(sent), [['u1', expected]]);
  }
  const cell = tenantCell(), sent = [];
  const props = { unit: { ...linked, tenant_company_id: null, resolved_tenant_company_id: null, tenant_entity_id: null }, isClientViewer: true, onUpdate() {}, onSetTenant: (id, body) => sent.push(body) };
  cell.byId(cell.render(props), 'tenancy-brand-set-u1').props.onClick();
  const clientSearch = cell.of(cell.render(props), 'BrandSearchInput')[0];
  assert.equal(clientSearch.props.allowCreate, true, 'a client login may add a brand to its list from the schedule (Woody, 2026-11-13: "allow it to add")');
  clientSearch.props.onPick({ name: 'Typed name', companyId: null });
  assert.deepEqual(plain(sent), [{ tradingName: 'Typed name' }], '"use as typed" is a trading name, never a cleared brand');
});

test('closing the brand search without a pick brings back Change and Unlink', () => {
  const cell = tenantCell(), effects = [];
  let observer;
  cell.bindings.useEffect = effect => { effects.push(effect); };
  cell.bindings.MutationObserver = class {
    constructor(callback) { this.callback = callback; observer = this; }
    observe(target, options) { this.target = target; this.options = options; }
    disconnect() { this.disconnected = true; }
  };
  const props = { unit: linked, isClientViewer: false, onUpdate() {}, onSetTenant() { throw new Error('nothing is saved on close'); } };
  let tree = cell.render(props);
  assert.ok(cell.byId(tree, 'tenancy-brand-unlink-u1'));
  cell.byId(tree, 'tenancy-brand-change-u1').props.onClick();
  effects.length = 0;
  tree = cell.render(props);
  assert.equal(cell.of(tree, 'BrandSearchInput').length, 1);
  assert.equal(cell.byId(tree, 'tenancy-brand-unlink-u1'), undefined);
  const wrapper = descendants(tree).find(node => node.type === 'span' && node.ref && cell.of(node.props.children, 'BrandSearchInput').length);
  const trigger = { state: 'open', getAttribute: name => (name === 'data-state' ? trigger.state : null) };
  wrapper.ref.current = { querySelector: selector => (selector === 'button' ? trigger : null) };
  const cleanup = effects.map(effect => effect()).find(Boolean);
  assert.deepEqual(plain(observer.options), { attributes: true, attributeFilter: ['data-state'] });
  observer.callback();
  tree = cell.render(props);
  assert.equal(cell.of(tree, 'BrandSearchInput').length, 1, 'still open: still picking');
  trigger.state = 'closed';
  observer.callback();
  tree = cell.render(props);
  assert.equal(cell.of(tree, 'BrandSearchInput').length, 0);
  assert.ok(cell.byId(tree, 'tenancy-brand-change-u1'));
  assert.ok(cell.byId(tree, 'tenancy-brand-unlink-u1'));
  cleanup();
  assert.equal(observer.disconnected, true);
});

test('the lease name is plain text saved through the row edit, never a brand picker', () => {
  const cell = tenantCell(), saved = [];
  const tree = cell.render({ unit: linked, isClientViewer: true, onUpdate: (...args) => saved.push(args), onSetTenant() {} });
  const lease = cell.of(tree, 'InlineEdit');
  assert.equal(lease.length, 1);
  assert.equal(lease[0].props.field, 'tenant_name');
  assert.equal(lease[0].props.value, 'ITX UK Limited');
  lease[0].props.onSave('u1', 'tenant_name', 'New Lease Co Ltd');
  assert.deepEqual(saved, [['u1', 'tenant_name', 'New Lease Co Ltd']]);
});

test('a client sees the company on the lease read-only, with its own covenant badge, and no controls for it', () => {
  const cell = tenantCell();
  for (const readOnly of [false, true]) {
    const tree = cell.render({ unit: linked, readOnly, isClientViewer: true, onUpdate() {}, onSetTenant() {}, onSetEntityNumber() {} });
    const line = cell.byId(tree, 'tenancy-company-u1');
    assert.ok(line, 'the company line is drawn');
    const words = JSON.stringify(line.props.children);
    assert.match(words, /ITX UK Limited/);
    assert.match(words, /"CH ","01234567"/);
    assert.deepEqual(plain(cell.of(tree, 'CovenantBadge').map(node => node.props.companyNumber)), readOnly ? [] : ['01234567']);
    assert.equal(cell.of(tree, 'LeaseCompanyPicker').length, 0, 'no picker, Change or + Company: no trading-entities request');
    assert.equal(cell.byId(tree, 'tenancy-company-change-u1'), undefined);
    assert.equal(cell.byId(tree, 'tenancy-company-add-u1'), undefined);
    assert.equal(cell.byId(tree, 'tenancy-company-unlink-u1'), undefined);
    const brandBadge = cell.of(tree, 'CovenantBadgeByCompany');
    assert.equal(brandBadge.length, readOnly ? 0 : 1, 'the brand badge shows exactly where it did before');
    if (!readOnly) assert.match(brandBadge[0].props.note, /not the company on the lease/);
    assert.ok(cell.byId(tree, 'tenancy-brand-link-u1'));
  }
  // No number: no "add CH number" for a client.
  const noNumber = cell.render({ unit: { ...linked, tenant_entity_ch: null }, isClientViewer: true, onUpdate() {}, onSetTenant() {}, onSetEntityNumber() {} });
  assert.equal(cell.byId(noNumber, 'tenancy-company-number-add-u1'), undefined);
  assert.match(JSON.stringify(cell.byId(noNumber, 'tenancy-company-u1').props.children), /no CH number/);
  assert.equal(cell.of(noNumber, 'CovenantBadge').length, 0);
  // No company on the row: nothing of BGP's work list (no + Company, no "brand's own name").
  const none = { ...linked, tenant_entity_id: null, tenant_entity_name: null, tenant_entity_ch: null };
  for (const unit of [none, { ...none, lease_in_brand_name: true }]) {
    const tree = cell.render({ unit, isClientViewer: true, onUpdate() {}, onSetTenant() {} });
    assert.equal(cell.byId(tree, 'tenancy-company-u1'), undefined);
    assert.equal(cell.byId(tree, 'tenancy-company-add-u1'), undefined);
    assert.equal(cell.byId(tree, 'tenancy-lease-brand-name-u1'), undefined);
  }
  const tree = cell.render({ unit: linked, isClientViewer: true, onUpdate() {}, onSetTenant() {} });
  assert.ok(cell.byId(tree, 'tenancy-brand-change-u1'), 'a client may pick a brand');
  assert.ok(cell.byId(tree, 'tenancy-brand-unlink-u1'), 'and unlink it, which takes the company off');
});

test('the phone card shows a client the company on the lease too, and the add form lets everyone add a brand', () => {
  assert.match(screen, /\{unit\.tenant_entity_name && \(\s*<p className="text-\[11px\] text-muted-foreground mt-0\.5 flex min-w-0 gap-1" data-testid=\{`tenancy-company-card-/);
  assert.doesNotMatch(screen, /!isClientViewer && unit\.tenant_entity_name/);
  assert.doesNotMatch(screen, /allowCreate=\{/, 'every brand picker on the schedule offers "add to the brand list"');
});

test('staff see the company on the lease with its own covenant badge, and the brand badge says whose it is', () => {
  const cell = tenantCell(), sent = [];
  const tree = cell.render({ unit: linked, isClientViewer: false, onUpdate() {}, onSetTenant: (id, body) => sent.push(body), onSetEntityNumber() {} });
  assert.ok(cell.byId(tree, 'tenancy-company-u1'));
  assert.deepEqual(plain(cell.of(tree, 'CovenantBadge').map(node => node.props.companyNumber)), ['01234567']);
  assert.match(cell.of(tree, 'CovenantBadgeByCompany')[0].props.note, /not the company on the lease/);
  const picker = cell.of(tree, 'LeaseCompanyPicker');
  assert.equal(picker.length, 1);
  assert.equal(picker[0].props.currentEntityId, 'ent-1');
  assert.equal(cell.byId(tree, 'tenancy-company-number-add-u1'), undefined, 'a company with a number is not offered another');
  cell.byId(tree, 'tenancy-company-unlink-u1').props.onClick();
  picker[0].props.onLink('ent-2');
  picker[0].props.onCreate({ name: 'Zara UK Ltd', companiesHouseNumber: null });
  assert.deepEqual(plain(sent), [{ entityId: null }, { entityId: 'ent-2' }, { createEntity: { name: 'Zara UK Ltd', companiesHouseNumber: null } }]);
});

test('each lease company state draws its own quiet line, and nothing links on open', () => {
  const cell = tenantCell();
  const none = { ...linked, tenant_entity_id: null, tenant_entity_name: null, tenant_entity_ch: null };
  let tree = cell.render({ unit: none, isClientViewer: false, onUpdate() {}, onSetTenant() { throw new Error('nothing links on open'); } });
  assert.ok(cell.byId(tree, 'tenancy-company-add-u1'));
  assert.equal(cell.of(tree, 'LeaseCompanyPicker')[0].props.open, false);
  cell.byId(tree, 'tenancy-company-add-u1').props.onClick();
  tree = cell.render({ unit: none, isClientViewer: false, onUpdate() {}, onSetTenant() { throw new Error('nothing links on open'); } });
  assert.equal(cell.of(tree, 'LeaseCompanyPicker')[0].props.open, true);
  assert.equal(cell.of(tree, 'CovenantBadge').length, 0);

  tree = cell.render({ unit: { ...none, lease_in_brand_name: true }, isClientViewer: false, onUpdate() {}, onSetTenant() {} });
  assert.ok(cell.byId(tree, 'tenancy-lease-brand-name-u1'));
  assert.equal(cell.byId(tree, 'tenancy-company-add-u1'), undefined);

  tree = cell.render({ unit: { ...none, tenant_company_id: null, resolved_tenant_company_id: null }, isClientViewer: false, onUpdate() {}, onSetTenant() {} });
  assert.equal(cell.byId(tree, 'tenancy-company-add-u1'), undefined, 'no brand, no company');
  assert.ok(cell.byId(tree, 'tenancy-brand-set-u1'));
  assert.equal(cell.byId(tree, 'tenancy-brand-link-u1'), undefined);
  assert.equal(descendants(tree).filter(node => node.type === 'div').length, 2, 'no brand: one line, the Lease line, with the brand control on it');

  tree = cell.render({ unit: { ...none, tenant_company_id: null }, isClientViewer: false, onUpdate() {}, onSetTenant() {} });
  assert.ok(cell.byId(tree, 'tenancy-brand-by-name-u1'), 'a brand matched by name only is marked as such');
  assert.ok(cell.byId(tree, 'tenancy-brand-set-u1'), 'and offers Set brand, not Change');
  assert.equal(cell.byId(tree, 'tenancy-brand-unlink-u1'), undefined);
  assert.equal(cell.byId(cell.render({ unit: none, isClientViewer: false, onUpdate() {}, onSetTenant() {} }), 'tenancy-brand-by-name-u1'), undefined);

  const numbered = [];
  const noNumber = { ...linked, tenant_entity_ch: null };
  const props = { unit: noNumber, isClientViewer: false, onUpdate() {}, onSetTenant() {}, onSetEntityNumber: (...args) => numbered.push(args) };
  tree = cell.render(props);
  assert.match(JSON.stringify(cell.byId(tree, 'tenancy-company-u1').props.children), /add CH number/);
  assert.match(JSON.stringify(cell.byId(cell.render({ ...props, readOnly: true }), 'tenancy-company-u1').props.children), /no CH number/);
  cell.byId(tree, 'tenancy-company-number-add-u1').props.onClick();
  tree = cell.render(props);
  const box = cell.byId(tree, 'tenancy-company-number-input-u1');
  box.props.onChange({ target: { value: '1234567' } });
  tree = cell.render(props);
  cell.byId(tree, 'tenancy-company-number-input-u1').props.onKeyDown({ key: 'Enter' });
  cell.byId(tree, 'tenancy-company-number-input-u1').props.onBlur();
  assert.deepEqual(plain(numbered), [['ent-1', 'brand-1', '01234567']], 'saved once, padded to eight characters');
});

test('a Companies House number is eight letters and digits; a short number is padded', () => {
  assert.equal(cleanCompanyNumber(' 1234567 '), '01234567');
  assert.equal(cleanCompanyNumber('sc123456'), 'SC123456');
  assert.equal(cleanCompanyNumber(''), null);
  assert.equal(cleanCompanyNumber('ITX UK'), undefined);
  assert.equal(cleanCompanyNumber('123456789'), undefined);
});

test('the company picker asks for the brand\'s companies only when open, and never the shared company list', () => {
  assert.match(picker, /enabled: open && !!brandId,/);
  assert.match(picker, /\/api\/crm\/companies\/\$\{encodeURIComponent\(brandId\)\}\/trading-entities/);
  assert.doesNotMatch(picker, /companies-basic/);
  assert.doesNotMatch(picker, /\/api\/covenant/);
});

test('the schedule keeps the shared company list key shape wherever it reads it', () => {
  const keys = screen.match(/"\/api\/crm\/companies-basic"/g) || [];
  const shaped = screen.match(/queryKey: \["\/api\/crm\/companies-basic"\],\s*queryFn: async \(\) => \{\s*const \w+ = await fetch\(COMPANIES_BASIC_URL,/g) || [];
  assert.equal(shaped.length, keys.length);
});

test('refusals are shown in their own words, never with the HTTP status in front', () => {
  assert.match(screen, /const plainMessage = \(e: any\): string \| undefined => \(typeof e\?\.message === "string" \? e\.message\.replace\(\/\^\\d\{3\}:\\s\*\/, ""\) : undefined\);/);
  assert.match(screen, /title: "Tenant not changed", description: plainMessage\(err\)/);
  assert.match(screen, /title: "Update failed", description: plainMessage\(err\)/);
});
