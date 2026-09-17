import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import React from 'react';
import { createRequire } from 'node:module';
import { planUnitChoiceKey } from '../../client/src/components/property-plan-types.ts';
const require = createRequire(import.meta.url);
const { source, ts } = require('./source-harness.cjs');

const propertyId = 'property-1';
const plan = { id: 'plan-1', property_id: propertyId, floor: 'Ground', width: 1000, height: 600 };
const polygon = { points: [[0.1, 0.1], [0.3, 0.1], [0.3, 0.4], [0.1, 0.4]] };
const tenancy = { id: 'tenancy-1', tenancy_unit_id: 'tenancy-1', unit_id: 'physical-1', unit_name: 'Shop 1', tenant_name: 'Tenant', floor: 'Ground' };
const candidate = { id: 'candidate-1', label: 'Shop 1', tenant: 'Tenant', polygon, tenancy_unit_id: 'tenancy-1', unit_id: 'physical-1', requiresReview: false, warning: null };

function descendants(node) {
  if (Array.isArray(node)) return node.flatMap(descendants);
  if (!React.isValidElement(node)) return [];
  return [node, ...descendants(node.props.children)];
}
function content(node) {
  if (Array.isArray(node)) return node.map(content).join('');
  if (React.isValidElement(node)) return content(node.props.children);
  return node == null || typeof node === 'boolean' ? '' : String(node);
}
function fixture(name, { file = 'client/src/components/property-plans-panel.tsx', data = {}, props = {}, effects: runEffects = false, hash = '' } = {}) {
  const ast = ts.createSourceFile(file, source(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const keptFunctions = new Set([name, 'formatMoney', 'formatDate']);
  const declarations = ast.statements.filter(node => ts.isFunctionDeclaration(node) && keptFunctions.has(node.name?.text)
    || ts.isVariableStatement(node) && node.declarationList.declarations.some(d => d.name.getText(ast) === 'STATUS_COLOURS'));
  const compiled = ts.transpileModule(declarations.map(node => node.getText(ast)).join('\n') + `\nexports.fixture = ${name};`, { fileName: 'test.tsx', compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
  const slots = [], refs = [], calls = [], pending = [], errors = [], invalidations = [], exports = {}, effectSlots = [], effects = [], handlers = {};
  let cursor = 0, refCursor = 0, effectCursor = 0, changed = false;
  const bindings = {};
  const noop = () => null;
  const queryClient = { invalidateQueries: value => invalidations.push(value), setQueryData: noop };
  for (const node of ast.statements) {
    if (ts.isImportDeclaration(node)) for (const member of node.importClause?.namedBindings?.elements || []) bindings[member.name.text] = function Leaf() { return null; };
    if (ts.isFunctionDeclaration(node) && !keptFunctions.has(node.name?.text)) bindings[node.name.text] = function Leaf() { return null; };
  }
  Object.assign(bindings, {
    React, exports, console, URLSearchParams, planUnitChoiceKey, window: { location: { hash }, addEventListener: (name, handler) => { handlers[name] = handler; }, removeEventListener: noop },
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial; return [slots[index], next => { const value = typeof next === 'function' ? next(slots[index]) : next; changed ||= !Object.is(value, slots[index]); slots[index] = value; }]; },
    useMemo: fn => fn(), useEffect(fn, deps) { const index = effectCursor++; if (!runEffects) return; if (!effectSlots[index] || deps.some((dep, i) => !Object.is(dep, effectSlots[index][i]))) { effectSlots[index] = deps; effects.push(fn); } },
    useRef(value) { const index = refCursor++; refs[index] ||= { current: value }; return refs[index]; },
    useQuery({ queryKey }) { return { data: data[queryKey[1] === 'property-links' ? 'property-links' : queryKey.at(-1)] ?? data[queryKey[0]], refetch: noop, isPending: false, isError: false, isFetching: queryKey[1] === 'property-links' && Boolean(data.linksFetching) }; },
    useQueryClient: () => queryClient,
    useToast: () => ({ toast: noop }),
    usePropertyPlanImage: () => ({ src: 'blob:fixture', isPending: false, isError: false }),
    useMutation(options) { return { isPending: false, reset: noop, mutate(value) { pending.push(Promise.resolve().then(() => options.mutationFn(value)).then(result => options.onSuccess?.(result), error => { errors.push(error); options.onError?.(error); })); } }; },
    apiRequest: async (method, url, body) => { calls.push({ method, url, body }); return { json: async () => ({ created: 1 }) }; },
    confirm: () => true,
  });
  vm.runInNewContext(compiled, bindings);
  return { data, refs, calls, errors, invalidations, bindings, handlers,
    render() { let tree, count = 0; do { cursor = 0; refCursor = 0; effectCursor = 0; changed = false; tree = exports.fixture(props); while (effects.length) effects.shift()(); assert.ok(++count < 20, 'effects must settle'); } while (runEffects && changed); return tree; },
    leaf(tree, component) { return descendants(tree).find(node => node.type === bindings[component]); },
    async settle() { while (pending.length) await pending.shift(); },
  };
}

for (const physicalId of ['physical-1', null]) test(`linking an outline uses tenancy identity, not picker id (${physicalId ?? 'no physical unit'})`, async () => {
  const unit = { ...tenancy, unit_id: physicalId };
  const app = fixture('LinkPolygonDialog', { data: { 'plan-pickable-units': { units: [unit] } }, props: { propertyId, plan, polygon, imageKey: 'original-plan.png', onSaved() {}, onClose() {} } });
  let tree = app.render();
  descendants(tree).find(node => node.type === 'select').props.onChange({ target: { value: 'tenancy:tenancy-1' } });
  tree = app.render();
  descendants(tree).find(node => node.type === app.bindings.Button && content(node) === 'Save unit').props.onClick();
  await app.settle();
  assert.equal(app.errors.length, 0);
  assert.equal(app.calls.length, 1);
  assert.equal(app.calls[0].body.tenancy_unit_id, 'tenancy-1');
  assert.equal(app.calls[0].body.unit_id, physicalId);
  assert.equal(app.calls[0].body.label, 'Shop 1');
  assert.equal(app.calls[0].body.imageKey, 'original-plan.png');
});

test('relinking or unlinking an existing outline leaves its geometry untouched', async () => {
  const app = fixture('LinkPolygonDialog', { data: { 'plan-pickable-units': { units: [tenancy] } }, props: { propertyId, plan, polygon, existingUnit: { ...tenancy, id: 'outline-1', label: 'Shop 1' }, onSaved() {}, onClose() {} } });
  let tree = app.render();
  descendants(tree).find(node => node.type === 'select').props.onChange({ target: { value: '' } });
  tree = app.render();
  descendants(tree).find(node => node.type === app.bindings.Button && content(node) === 'Save link').props.onClick();
  await app.settle();
  assert.equal(app.calls[0].method, 'PATCH');
  assert.equal(app.calls[0].url, '/api/plan-units/outline-1');
  assert.equal(app.calls[0].body.unit_id, null);
  assert.equal(app.calls[0].body.tenancy_unit_id, null);
  assert.equal('polygon' in app.calls[0].body, false);
});

test('scan review saves only explicitly chosen outlines with stable tenancy links', async () => {
  const app = fixture('PropertyPlanScanReview', { file: 'client/src/components/property-plan-scan-review.tsx', props: { plan }, data: { scan: { job: { id: 'job-1', status: 'ready', candidates: [candidate, { ...candidate, id: 'candidate-2', label: 'Shop 2' }] } }, 'plan-pickable-units': { units: [tenancy] } } });
  let tree = app.render();
  let add = descendants(tree).find(node => node.type === app.bindings.Button && /^Add \d/.test(content(node)));
  assert.equal(add.props.disabled, true, 'no proposals are accepted automatically');
  assert.equal(app.calls.length, 0);
  const checkboxes = descendants(tree).filter(node => node.type === 'input' && node.props.type === 'checkbox');
  assert.equal(checkboxes.length, 2);
  assert.ok(checkboxes.every(node => node.props.checked === false));
  checkboxes[0].props.onChange({ target: { checked: true } });
  tree = app.render();
  add = descendants(tree).find(node => node.type === app.bindings.Button && /^Add 1/.test(content(node)));
  assert.equal(add.props.disabled, false);
  add.props.onClick(); await app.settle();
  assert.equal(app.errors.length, 0);
  assert.equal(app.calls[0].url, '/api/plans/plan-1/scans/job-1/apply');
  assert.deepEqual(JSON.parse(JSON.stringify(app.calls[0].body.assignments)), [{ candidateId: 'candidate-1', tenancy_unit_id: 'tenancy-1', unit_id: 'physical-1', label: 'Shop 1' }]);
  assert.ok(app.invalidations.some(value => JSON.stringify(value.queryKey) === JSON.stringify(['/api/plans', 'property-links', propertyId])));
});

test('repeating View on plan returns to the linked floor after manual floor browsing', () => {
  const first = { ...plan, id: 'first', floor: 'First' };
  const app = fixture('PropertyPlansPanel', { effects: true, hash: '#plan-tenancy-tenancy-1', props: { propertyId }, data: {
    '/api/auth/me': { role: 'Admin' }, plans: { plans: [plan, first] }, units: { units: [] },
    'property-links': [{ planId: plan.id, units: [tenancy] }, { planId: first.id, units: [] }],
  } });
  let tree = app.render();
  assert.equal(app.leaf(tree, 'PlanCanvas').props.plan.id, plan.id);
  descendants(tree).find(node => node.props['data-testid'] === 'button-floor-First').props.onClick();
  assert.equal(app.leaf(app.render(), 'PlanCanvas').props.plan.id, first.id, 'browsing another floor must remain possible');
  app.handlers.hashchange();
  assert.equal(app.leaf(app.render(), 'PlanCanvas').props.plan.id, plan.id);
});

test('View on plan waits for refreshed floor links and rechecks them after outline edits', () => {
  const first = { ...plan, id: 'first', floor: 'First' };
  const data = { '/api/auth/me': { role: 'Admin' }, plans: { plans: [plan, first] }, units: { units: [{ ...tenancy, id: 'outline-1', polygon }] },
    'property-links': [{ planId: plan.id, units: [tenancy] }, { planId: first.id, units: [] }], linksFetching: false };
  const app = fixture('PropertyPlansPanel', { effects: true, hash: '#plan-tenancy-tenancy-1', props: { propertyId }, data });
  let tree = app.render();
  app.leaf(tree, 'PlanCanvas').props.onSelectUnit(data.units.units[0]);
  app.leaf(app.render(), 'UnitDetailDrawer').props.onUpdated();
  assert.ok(app.invalidations.some(value => JSON.stringify(value.queryKey) === JSON.stringify(['/api/plans', 'property-links', propertyId])));
  data.linksFetching = true;
  app.handlers.hashchange();
  assert.equal(app.leaf(app.render(), 'PlanCanvas').props.plan.id, plan.id);
  data['property-links'] = [{ planId: plan.id, units: [] }, { planId: first.id, units: [tenancy] }];
  data.linksFetching = false;
  assert.equal(app.leaf(app.render(), 'PlanCanvas').props.plan.id, first.id, 'fresh mapping must win over the old cached location');
});

test('clients retain manual trace, draw and upload; paid scanning stays with staff', () => {
  for (const user of [{ role: 'Client', companyScopeId: 'company-1' }, { role: 'Admin' }]) {
    const app = fixture('PropertyPlansPanel', { props: { propertyId }, data: { '/api/auth/me': user, plans: { plans: [plan] }, units: { units: [] } } });
    const tree = app.render();
    assert.ok(app.leaf(tree, 'UploadPlanButton'));
    assert.ok(descendants(tree).find(node => node.props['data-testid'] === 'button-trace-property-unit'));
    assert.ok(descendants(tree).find(node => node.props['data-testid'] === 'button-toggle-draw-mode'));
    assert.equal(app.leaf(tree, 'PropertyPlanScanReview').props.canStart, user.role === 'Admin');
  }
});

test('an open unit drawer receives refreshed schedule information instead of a stale selection snapshot', () => {
  const unit = { ...tenancy, id: 'outline-1', polygon, rent_pa: 12000 };
  const data = { '/api/auth/me': { role: 'Admin' }, plans: { plans: [plan] }, units: { units: [unit] } };
  const app = fixture('PropertyPlansPanel', { props: { propertyId }, data });
  app.leaf(app.render(), 'PlanCanvas').props.onSelectUnit(unit);
  assert.equal(app.leaf(app.render(), 'UnitDetailDrawer').props.unit.rent_pa, 12000);
  data.units = { units: [{ ...unit, rent_pa: 16000, tenant_name: 'Updated tenant' }] };
  const drawer = app.leaf(app.render(), 'UnitDetailDrawer');
  assert.equal(drawer.props.unit.rent_pa, 16000);
  assert.equal(drawer.props.unit.tenant_name, 'Updated tenant');
});

test('drawing adds a corner in transformed image coordinates without starting a pan', () => {
  const points = [];
  const app = fixture('PlanCanvas', { props: { plan, units: [], mode: 'draw', busy: false, pendingPoints: [], setPendingPoints: value => points.push(value), onFinishPolygon() {}, onTrace() {}, onSelectUnit() {}, highlightedLabel: null, highlightedTenancyId: null, multipleFloors: false } });
  const tree = app.render();
  const inner = descendants(tree).find(node => node.props.onPointerDown);
  inner.ref.current = { getBoundingClientRect: () => ({ left: 100, top: 200, width: 1000, height: 600 }) };
  inner.props.onPointerDown({ clientX: 200, clientY: 300, button: 0 });
  inner.props.onPointerMove({ clientX: 201, clientY: 301 });
  inner.props.onClick({ clientX: 350, clientY: 350, detail: 1 });
  assert.deepEqual(JSON.parse(JSON.stringify(points)), [[[0.25, 0.25]]]);
});

for (const canStart of [true, false]) test(`scan start controls respect staff scope (${canStart})`, () => {
  const app = fixture('PropertyPlanScanReview', { file: 'client/src/components/property-plan-scan-review.tsx', props: { plan, canStart }, data: { scan: { job: null } } });
  const tree = app.render();
  assert.equal(Boolean(descendants(tree).find(node => node.type === app.bindings.Button && content(node) === 'Start scan')), canStart);
});
