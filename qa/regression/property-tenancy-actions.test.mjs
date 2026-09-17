import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as tenancyDisplay from '../../shared/tenancy-schedule-display.ts';
const require = createRequire(import.meta.url);
const { source, ts } = require('./source-harness.cjs');

const file = 'client/src/components/PropertyTenancySchedule.tsx';
const ast = ts.createSourceFile(file, source(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const functions = new Set(['PropertyTenancySchedule', 'normRefKey', 'fmtCurrency', 'fmtCurrencyCompact', 'fmtNum', 'fmtDate']);
// Execute the real parent, constants and formatters. Leaf widgets are boundaries:
// their props expose permissions/actions without duplicating the parent's logic.
const input = ast.statements.filter(node => ts.isVariableStatement(node) ||
  (ts.isFunctionDeclaration(node) && functions.has(node.name?.text))).map(node => node.getText(ast)).join('\n');
const compiled = ts.transpileModule(input, { fileName: 'fixture.tsx', compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React,
} }).outputText;

const staff = { id: 'staff', role: 'Admin' };
const client = { id: 'client', role: 'Client', companyScopeId: 'landlord' };
const unit = { id: 'unit-1', property_id: 'property-1', unit_number: 'Shop 1', premises: 'Ground floor',
  tenant_name: 'Example tenant', status: 'Occupied', passing_rent_pa: 12000, nia_sqft: 500 };

function descendants(node) {
  if (Array.isArray(node)) return node.flatMap(descendants);
  if (!React.isValidElement(node)) return [];
  return [node, ...descendants(node.props.children)];
}
const byTestId = (tree, id) => descendants(tree).find(node => node.props['data-testid'] === id);

function fixture({ units = [], user = staff, readOnly = false, links = { deals: [], lettingUnits: [], matters: [] }, updateResult } = {}) {
  const exports = {}, slots = [], requests = [], notifications = [], pending = [], invalidations = [];
  let cursor = 0;
  const empty = () => null;
  const wrap = ({ children, ...props }) => React.createElement('span', { 'data-testid': props['data-testid'] }, children);
  const bindings = {};
  for (const node of ast.statements) {
    if (ts.isImportDeclaration(node)) {
      for (const named of node.importClause?.namedBindings?.elements || []) bindings[named.name.text] = empty;
    } else if (ts.isFunctionDeclaration(node) && !functions.has(node.name?.text)) bindings[node.name.text] = empty;
  }
  Object.assign(bindings, {
    React, exports, console, URLSearchParams, ...tenancyDisplay,
    localStorage: { getItem: () => null, setItem: () => {} }, window: { innerWidth: 1280 },
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [slots[index], next => { slots[index] = typeof next === 'function' ? next(slots[index]) : next; }];
    },
    useMemo: fn => fn(), useCallback: fn => fn, useRef: initial => ({ current: initial }), useEffect: () => {},
    useLocation: () => ['/properties/property-1'], useToast: () => ({ toast: event => notifications.push(event) }),
    useQueryClient: () => ({ invalidateQueries: query => invalidations.push(query) }),
    useQuery: ({ queryKey }) => ({ data: queryKey[0] === '/api/auth/me' ? user : queryKey[2] === 'links' ? links : units }),
    useMutation(options) {
      return { isPending: false, mutate(data, callbacks = {}) {
        const promise = Promise.resolve().then(() => options.mutationFn(data)).then(result => {
          options.onSuccess?.(result, data);
          callbacks.onSuccess?.(result, data);
        }, error => {
          options.onError?.(error, data);
          callbacks.onError?.(error, data);
        });
        pending.push(promise);
      } };
    },
    apiRequest: async (method, url, body) => {
      requests.push({ method, url, body });
      if (method === 'PUT' && updateResult) await updateResult;
      return { json: async () => ({}) };
    },
    getAuthHeaders: () => ({ Authorization: 'Bearer fixture' }),
    UNIFIED_ADD_UNIT_ENABLED: true,
    UnifiedAddUnitDialog: props => props.open ? React.createElement('div', {
      role: 'dialog', 'data-property': props.fixedPropertyId, 'data-mode': props.mode,
    }, 'Add a tenancy unit') : null,
    Button: wrap, Badge: wrap, Popover: wrap, PopoverTrigger: wrap, PopoverContent: wrap,
    Link: ({ href, children }) => React.createElement('a', { href }, children),
    UnitRow: props => React.createElement('tr', { 'data-testid': `fixture-row-${props.unit.id}` }),
  });
  vm.runInNewContext(compiled, bindings);
  return {
    requests, notifications, invalidations,
    render() { cursor = 0; return exports.PropertyTenancySchedule({ propertyId: 'property-1', readOnly }); },
    row(tree) { return descendants(tree).find(node => node.type === bindings.UnitRow); },
    dialog(tree) { return descendants(tree).find(node => node.type === bindings.UnifiedAddUnitDialog); },
    async settle() { while (pending.length) await pending.shift(); },
  };
}

test('empty schedule Add Unit mounts and opens the unified tenancy dialog, then closes back to empty state', () => {
  for (const user of [staff, client]) {
    const app = fixture({ user });
    let tree = app.render();
    assert.equal(app.dialog(tree), undefined);
    const add = byTestId(tree, 'btn-add-tenancy-unit');
    assert.ok(add, `${user.role} can add a unit on their property`);
    add.props.onClick();
    tree = app.render();
    const dialog = app.dialog(tree);
    assert.ok(dialog, 'the open flag must take the component past its empty-state early return');
    assert.equal(dialog.props.open, true);
    assert.equal(dialog.props.mode, 'tenancy');
    assert.equal(dialog.props.fixedPropertyId, 'property-1');
    assert.match(renderToStaticMarkup(dialog), /role="dialog".*data-property="property-1".*data-mode="tenancy"/);
    dialog.props.onOpenChange(false);
    assert.equal(app.dialog(app.render()), undefined);
    assert.equal(app.requests.length, 0, 'opening or cancelling a dialog must not create a record');
  }
});

test('explicit readOnly hides Add and disables row editing in empty and populated schedules', () => {
  for (const user of [staff, client]) for (const units of [[], [unit]]) {
    const app = fixture({ user, units, readOnly: true });
    const tree = app.render();
    assert.equal(byTestId(tree, 'btn-add-tenancy-unit'), undefined);
    assert.equal(byTestId(tree, 'btn-import-tenancy'), undefined);
    assert.equal(byTestId(tree, 'btn-resync-mirror'), undefined);
    assert.equal(byTestId(tree, 'tenancy-select-all'), undefined);
    assert.equal(byTestId(tree, `tenancy-status-card-${unit.id}`), undefined);
    if (units.length) {
      assert.equal(app.row(tree).props.readOnly, true);
      assert.equal(app.row(tree).props.onSendToTracker, undefined);
    }
  }
});

test('scoped clients retain row and mobile edits while staff-only bulk, import and resync controls stay absent', async () => {
  // A scoped account is a client viewer even if its legacy role says Member.
  for (const user of [client, { ...client, role: 'Member' }]) {
    const app = fixture({ user, units: [unit] });
    const tree = app.render(), row = app.row(tree);
    assert.equal(row.props.readOnly, false);
    assert.equal(row.props.onToggleSelect, undefined);
    assert.equal(row.props.onPromote, undefined);
    assert.ok(byTestId(tree, 'btn-add-tenancy-unit'));
    for (const id of ['btn-import-tenancy', 'btn-resync-mirror', 'tenancy-select-all', 'tenancy-bulk-delete']) {
      assert.equal(byTestId(tree, id), undefined, id);
    }
    // Also inspect native mobile-menu buttons, which do not carry these IDs.
    const buttonTexts = descendants(tree).filter(node => node.type === 'button')
      .map(node => renderToStaticMarkup(node)).join('\n');
    assert.doesNotMatch(buttonTexts, /Import Excel|Re-sync \(all\)|Delete selected/);
    row.props.onUpdate(unit.id, 'passing_rent_pa', '14000');
    await app.settle();
    assert.equal(app.requests[0].method, 'PUT');
    assert.equal(app.requests[0].url, `/api/tenancy-schedule/unit/${unit.id}`);
    assert.equal(app.requests[0].body.passing_rent_pa, '14000');
    const mobileStatus = byTestId(tree, `tenancy-status-card-${unit.id}`);
    assert.equal(mobileStatus.type, 'select');
    mobileStatus.props.onChange({ target: { value: 'Vacant' } });
    await app.settle();
    assert.equal(app.requests[1].body.status, 'Vacant');
    assert.equal(app.requests.length, 2);
  }
  const staffApp = fixture({ units: [unit] }), staffTree = staffApp.render();
  for (const id of ['btn-import-tenancy', 'btn-resync-mirror', 'tenancy-select-all']) assert.ok(byTestId(staffTree, id), id);
  assert.equal(typeof staffApp.row(staffTree).props.onToggleSelect, 'function');
});

test('failed Opportunity update reports the error and never creates a Letting Tracker unit', async () => {
  let reject;
  const updateResult = new Promise((resolve, fail) => { reject = fail; });
  const app = fixture({ user: client, units: [unit], updateResult });
  app.row(app.render()).props.onUpdate(unit.id, 'status', 'Opportunity');
  await Promise.resolve();
  assert.equal(app.requests.length, 1, 'no tracker write while the save is pending');
  reject(new Error('Save rejected'));
  await app.settle();
  assert.equal(app.requests.length, 1, 'a failed save must never trigger the tracker mutation');
  assert.equal(app.requests[0].method, 'PUT');
  assert.equal(app.notifications.at(-1).title, 'Update failed');
  assert.equal(app.invalidations.length, 0);
});

test('Opportunity creates a tracker listing only after a successful save, never when already linked', async () => {
  for (const existing of ['none', 'foreign-key', 'links', 'normalised', 'ambiguous']) {
    let resolve;
    const updateResult = new Promise(done => { resolve = done; });
    const savedUnit = { ...unit, unit_number: existing === 'normalised' ? 'Shop A01' : unit.unit_number, letting_tracker_unit_id: existing === 'foreign-key' ? 'tracker-1' : null };
    const links = { deals: [], lettingUnits: existing === 'links' ? [{ id: 'tracker-1', unit_name: 'SHOP 1' }] : existing === 'normalised' ? [{ id: 'tracker-1', unit_name: 'A1' }] : existing === 'ambiguous' ? [{ id: 'tracker-1', unit_name: '1' }, { id: 'tracker-2', unit_name: 'Unit 1' }] : [] };
    const app = fixture({ units: [savedUnit], links, updateResult });
    app.row(app.render()).props.onUpdate(unit.id, 'status', 'Opportunity');
    await Promise.resolve();
    assert.equal(app.requests.length, 1);
    resolve();
    await app.settle();
    assert.equal(app.requests.length, existing === 'none' ? 2 : 1, existing);
    if (existing === 'none') {
      assert.equal(app.requests[1].url, '/api/available-units');
      assert.equal(app.requests[1].method, 'POST');
      assert.equal(app.requests[1].body.unitName, 'Shop 1');
      assert.equal(app.requests[1].body.propertyId, 'property-1');
    }
  }
});
