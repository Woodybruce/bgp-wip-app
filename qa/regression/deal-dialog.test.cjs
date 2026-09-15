const assert = require('node:assert/strict');
const test = require('node:test');
const { source, evaluate, ts } = require('./source-harness.cjs');

const ast = ts.createSourceFile('deals.tsx', source('client/src/pages/deals.tsx'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const dialog = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'DealFormDialog');
assert.ok(dialog);
let resetEffect;
function visit(node) {
  if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect'
      && node.arguments[0]?.getText(ast).includes('setForm(deal ? dealToForm(deal) : freshForm())')) {
    resetEffect = node.arguments[0];
  }
  ts.forEachChild(node, visit);
}
visit(dialog);
assert.ok(resetEffect, 'Exercise the real dialog reset effect');

function setup() {
  const state = { form: null, resets: 0, changeReason: '', learning: '', showAllFields: false, feeRows: [], feeAllocType: 'percentage', nameAutoFilled: false };
  const bindings = {
    draftSessionRef: { current: null },
    dealToForm: deal => ({ ...deal }),
    freshForm: () => ({ name: '', rentPa: '' }),
    setForm: value => { state.form = value; state.resets++; },
  };
  for (const field of ['changeReason', 'learning', 'showAllFields', 'feeRows', 'feeAllocType', 'nameAutoFilled']) {
    bindings[`set${field[0].toUpperCase()}${field.slice(1)}`] = value => { state[field] = value; };
  }
  const { render } = evaluate(`exports.render = (open, deal) => (${resetEffect.getText(ast)})();`, bindings);
  return { state, render };
}

test('a live update of the same deal preserves open commercial fields and supporting drafts', () => {
  const { state, render } = setup();
  render(true, { id: 'deal-a', name: 'Initial deal', rentPa: '100000' });
  state.form = { ...state.form, name: 'Unsaved name', rentPa: '125000' };
  state.changeReason = 'Negotiated rent';
  state.learning = 'Draft note';
  state.showAllFields = true;
  state.feeRows = [{ agentName: 'Synthetic agent' }];
  render(true, { id: 'deal-a', name: 'Updated by a colleague', rentPa: '110000', updatedAt: 'later' });
  assert.equal(state.resets, 1);
  assert.equal(state.form.name, 'Unsaved name');
  assert.equal(state.form.rentPa, '125000');
  assert.equal(state.changeReason, 'Negotiated rent');
  assert.equal(state.learning, 'Draft note');
  assert.equal(state.showAllFields, true);
  assert.equal(state.feeRows.length, 1);
});

test('switching deals and closing/reopening starts from the latest server record', () => {
  const { state, render } = setup();
  render(true, { id: 'deal-a', name: 'A' });
  state.form.name = 'Unsaved A';
  render(true, { id: 'deal-b', name: 'B' });
  assert.equal(state.form.name, 'B');
  state.form.name = 'Unsaved B';
  render(false, { id: 'deal-b', name: 'B' });
  render(true, { id: 'deal-b', name: 'Latest B' });
  assert.equal(state.form.name, 'Latest B');
  assert.equal(state.resets, 3);
  assert.equal(state.changeReason, '');
  assert.equal(state.feeRows.length, 0);
});

test('new-deal drafts survive rerenders and clear when starting another create session', () => {
  const { state, render } = setup();
  render(true, undefined);
  state.form.name = 'New unsaved deal';
  render(true, undefined);
  assert.equal(state.form.name, 'New unsaved deal');
  assert.equal(state.resets, 1);
  render(false, undefined);
  render(true, undefined);
  assert.equal(state.form.name, '');
  assert.equal(state.nameAutoFilled, true);
  assert.equal(state.resets, 2);
});
