import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import fs from 'node:fs';
import React from 'react';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { source, ts, evaluate } = require('./source-harness.cjs');

const file = 'client/src/pages/investment-tracker.tsx';
// Optional pre-fix source lets this same behavioral suite demonstrate the
// original failure without replacing the working tree or starting an app.
const pageSource = process.env.QA_INVESTMENT_SOURCE
  ? fs.readFileSync(process.env.QA_INVESTMENT_SOURCE, 'utf8') : source(file);
const status = evaluate(source('shared/deal-status.ts'));
const plain = value => JSON.parse(JSON.stringify(value));
function descendants(node) {
  if (Array.isArray(node)) return node.flatMap(descendants);
  if (!React.isValidElement(node)) return [];
  return [node, ...descendants(node.props.children)];
}

function fixture(items, { mobile = true } = {}) {
  const ast = ts.createSourceFile(file, pageSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const bindings = {}, slots = [], effects = [], requests = [], pending = [];
  let cursor = 0, dirty = false;
  for (const node of ast.statements) if (ts.isImportDeclaration(node)) {
    for (const member of node.importClause?.namedBindings?.elements || []) {
      bindings[member.name.text] = function Leaf() { return null; };
    }
  }
  const users = [{ id: 'staff-1', name: 'Test Agent One' }, { id: 'staff-2', name: 'Test Agent Two' }];
  const data = new Map([
    ['/api/investment-tracker', items], ['/api/users', users],
    ['/api/crm/properties', items.filter(i => i.propertyId).map(i => ({ id: i.propertyId, name: i.assetName }))],
    ['/api/crm/companies', [{ id: 'client-a', name: 'Client A', companyType: 'Landlord' }]],
    ['/api/crm/contacts', []], ['/api/investment-tracker/counts', { viewings: {}, offers: {}, distributions: {} }],
    ['/api/investment-tracker/all-marketing-files', {}],
  ]);
  Object.assign(bindings, {
    ...status, React, Fragment: React.Fragment, exports: {}, console, Date,
    window: { innerWidth: mobile ? 390 : 1440 }, localStorage: { getItem: () => null, setItem() {} },
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [slots[index], next => {
        const value = typeof next === 'function' ? next(slots[index]) : next;
        if (!Object.is(value, slots[index])) { slots[index] = value; dirty = true; }
      }];
    },
    useRef(value) { const index = cursor++; if (!(index in slots)) slots[index] = { current: value }; return slots[index]; },
    useMemo: fn => fn(),
    useEffect(fn, deps) {
      const index = cursor++;
      if (!slots[index] || deps.some((v, i) => !Object.is(v, slots[index][i]))) {
        slots[index] = deps; effects.push(fn);
      }
    },
    useIsMobile: () => mobile, useTeam: () => ({ activeTeam: 'all' }),
    useToast: () => ({ toast() {} }), useTableSort: () => ({ sortKey: null }),
    buildUserIdColorMap: () => ({}),
    useQuery: ({ queryKey }) => ({ data: data.get(queryKey[0]) ?? [], isLoading: false }),
    useMutation: options => ({ isPending: false, mutate: value => {
      const operation = Promise.resolve(options.mutationFn(value));
      pending.push(operation);
      return operation;
    } }),
    apiRequest: async (method, url, body) => {
      requests.push({ method, url, body: plain(body) });
      return { json: async () => ({}) };
    },
    queryClient: { invalidateQueries() {} }, invalidateDealCaches() {},
    fetch() { throw new Error('Unexpected network request in isolated component regression'); },
  });
  const code = ast.statements.filter(n => !ts.isImportDeclaration(n)).map(n => n.getText(ast)).join('\n');
  vm.runInNewContext(ts.transpileModule(code, {
    fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  }).outputText, bindings);
  const app = {
    requests, pending, bindings,
    render() {
      for (let pass = 0; pass < 10; pass++) {
        cursor = 0; dirty = false;
        const tree = bindings.exports.default();
        while (effects.length) effects.shift()();
        if (!dirty) return tree;
      }
      throw new Error('Component did not settle');
    },
    find(tree, id) {
      const node = descendants(tree).find(n => n.props['data-testid'] === id || n.props.testId === id);
      assert.ok(node, `Missing rendered control ${id}`);
      return node;
    },
    open(item) {
      let tree = app.render();
      app.find(tree, `toggle-board-${(item.boardType || 'Purchases').toLowerCase()}`).props.onClick();
      tree = app.render();
      const trigger = mobile
        ? descendants(tree).find(n => n.type === bindings.Card && n.key === item.id)
        : app.find(tree, `button-edit-${item.id}`);
      assert.ok(trigger, `Missing ${mobile ? 'card' : 'desktop editor'} for ${item.id}`);
      trigger.props.onClick();
      return app.render();
    },
    cancel(tree) {
      const dialog = descendants(tree).find(n => n.type === bindings.Dialog && n.props.open &&
        descendants(n).some(child => child.props['data-testid'] === 'button-save-asset'));
      assert.ok(dialog, 'Asset editor should be open');
      dialog.props.onOpenChange(false);
      return app.render();
    },
    async save(tree) {
      const button = app.find(tree, 'button-save-asset');
      assert.equal(button.props.disabled, false, 'Populated asset should be saveable');
      button.props.onClick();
      await Promise.all(pending);
      return requests.at(-1);
    },
  };
  return app;
}

const purchase = {
  id: 'asset-a', assetName: 'Fixture Shopping Centre', propertyId: 'property-a', address: '10 Fixture Road',
  assetType: 'Retail', tenure: 'Freehold', boardType: 'Purchases', status: 'SOL',
  guidePrice: 12500000, niy: 5.25, eqy: 6.1, sqft: 80500, waultBreak: 4.5, waultExpiry: 8.25,
  currentRent: 650000, ervPa: 720000, occupancy: 92.4, capexRequired: 150000,
  client: 'Client A', clientId: 'client-a', clientContact: 'Client Contact A', clientContactId: 'contact-a',
  vendor: 'Vendor A', vendorId: 'vendor-a', vendorAgent: 'External Agent A', vendorAgentId: 'external-agent-a',
  buyer: 'Buyer A', notes: 'Saved note A', fee: 125000, feeType: 'Fixed Fee',
  marketingDate: '2026-09-01', bidDeadline: '2026-10-01', agentUserIds: ['staff-1', 'staff-2'],
};
const sale = {
  ...purchase, id: 'asset-b', assetName: 'Fixture Sale Building', propertyId: 'property-b', address: '20 Other Road',
  boardType: 'Sales', status: 'INV', client: 'Client B', clientId: 'client-b', vendor: 'Vendor B', vendorId: 'vendor-b',
  clientContact: 'Contact B', clientContactId: 'contact-b', vendorAgent: 'External B', vendorAgentId: 'external-b',
  buyer: 'Buyer B', notes: 'Saved note B', guidePrice: 2750000, currentRent: 0, occupancy: 0,
  fee: 0, feeType: '% of Price', agentUserIds: ['staff-2'], marketingDate: '2026-08-30', bidDeadline: null,
};
function expectedPayload(item) {
  const { id, ...fields } = item;
  return fields;
}

test('first phone card edit displays the selected asset and saves its full existing record', async () => {
  const app = fixture([purchase]);
  const tree = app.open(purchase);
  assert.equal(app.find(tree, 'input-asset-name').props.value, purchase.assetName);
  assert.equal(app.find(tree, 'input-address').props.value, purchase.address);
  assert.equal(app.find(tree, 'input-guide-price').props.value, '12500000');
  assert.equal(app.find(tree, 'picker-property').props.value, 'property-a');
  assert.equal(app.find(tree, 'input-notes').props.value, 'Saved note A');
  assert.deepEqual(app.requests, [], 'Opening an editor performs no writes');
  assert.deepEqual(await app.save(tree), { method: 'PATCH', url: '/api/investment-tracker/asset-a', body: expectedPayload(purchase) });
});

test('cancelled edits to A cannot leak into B; Sales, parties, agents and zero financial values survive Save', async () => {
  const app = fixture([purchase, sale]);
  let tree = app.open(purchase);
  app.find(tree, 'input-address').props.onChange({ target: { value: 'UNSAVED A ADDRESS' } });
  tree = app.render();
  app.find(tree, 'input-notes').props.onChange({ target: { value: 'UNSAVED A NOTE' } });
  app.cancel(app.render());
  tree = app.open(sale);
  assert.equal(app.find(tree, 'input-asset-name').props.value, sale.assetName);
  assert.equal(app.find(tree, 'input-notes').props.value, sale.notes);
  assert.equal(app.find(tree, 'input-current-rent').props.value, '0');
  assert.equal(app.find(tree, 'input-fee').props.value, '0');
  assert.deepEqual(await app.save(tree), { method: 'PATCH', url: '/api/investment-tracker/asset-b', body: expectedPayload(sale) });
});

test('opening a sparse record clears prior values without inventing missing information', async () => {
  const sparse = { id: 'asset-empty', assetName: 'Fixture Unresearched Asset', boardType: 'Purchases', status: 'REP' };
  const app = fixture([purchase, sparse]);
  app.cancel(app.open(purchase));
  const tree = app.open(sparse);
  for (const id of ['input-address', 'input-guide-price', 'input-niy', 'input-fee', 'input-notes']) {
    assert.equal(app.find(tree, id).props.value, '', `${id} must not retain another asset's value`);
  }
  const { body } = await app.save(tree);
  assert.equal(body.assetName, sparse.assetName);
  assert.equal(body.propertyId, '');
  for (const key of ['clientId', 'vendorId', 'vendorAgentId', 'guidePrice', 'niy', 'fee', 'agentUserIds', 'notes']) {
    assert.equal(body[key], null, `${key} is genuinely unset on this record`);
  }
});

test('desktop edit uses the same populated record and preserves Save payload', async () => {
  const app = fixture([purchase], { mobile: false });
  const tree = app.open(purchase);
  assert.equal(app.find(tree, 'input-asset-name').props.value, purchase.assetName);
  assert.deepEqual(await app.save(tree), { method: 'PATCH', url: '/api/investment-tracker/asset-a', body: expectedPayload(purchase) });
});
