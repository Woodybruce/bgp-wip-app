const assert = require('node:assert/strict');
const test = require('node:test');
const { source, find, evaluate, ts } = require('./source-harness.cjs');

const ast = ts.createSourceFile('deals.tsx', source('client/src/pages/deals.tsx'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const dialog = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'DealFormDialog');
assert.ok(dialog);
let resetEffect;
function visit(node) {
  if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect'
      && node.arguments[0]?.getText(ast).includes('const start = handover ? handoverForm(deal, handover, handoverLandlordId) : deal ? dealToForm(deal) : { ...freshForm(), ...(prefill || {}) };')) {
    resetEffect = node.arguments[0];
  }
  ts.forEachChild(node, visit);
}
visit(dialog);
assert.ok(resetEffect, 'Exercise the real dialog reset effect');
// The reset also clears the unit found through "Find the unit" (2026-10-26) and the joint agency AML note.
const { EMPTY_JOINT_AGENCY } = evaluate(find('client/src/components/joint-agency-aml.tsx', node => ts.isVariableStatement(node)
  && node.declarationList.declarations.some(item => item.name.getText() === 'EMPTY_JOINT_AGENCY')));

// A handover (Promote to Solicitors, the Heads of Terms' Convert, 2026-11-17)
// opens the same dialog on the unit's deal through handoverForm.
function setup({ handover, prefill } = {}) {
  const state = { form: null, resets: 0, changeReason: '', learning: '', showAllFields: false, feeRows: [], feeAllocType: 'percentage', nameAutoFilled: false,
    pickedUnit: null, jointAgency: EMPTY_JOINT_AGENCY, jointAgencyErrors: false, noteBrandHint: 'stale',
    dealRead: 'stale', dealNoteBusy: 'stale', propertySeed: 'stale' };
  const bindings = {
    draftSessionRef: { current: null },
    dealToForm: deal => ({ ...deal }),
    freshForm: () => ({ name: '', rentPa: '' }),
    handover,
    // New Transaction opened from a company on the AML Companies view (24 November 2026).
    prefill,
    handoverLandlordId: 'landlord-1',
    handoverForm: (deal, h, landlordId) => ({ ...(deal || {}), status: 'SOL', landlordId, from: h.kind }),
    setForm: value => { state.form = value; state.resets++; },
    EMPTY_JOINT_AGENCY,
  };
  for (const field of ['changeReason', 'learning', 'showAllFields', 'feeRows', 'feeAllocType', 'nameAutoFilled', 'pickedUnit', 'jointAgency', 'jointAgencyErrors', 'noteBrandHint', 'dealRead', 'dealNoteBusy', 'propertySeed']) {
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
  state.pickedUnit = { propertyId: 'property-a', unitName: 'Unit 1' };
  state.jointAgency = { ...EMPTY_JOINT_AGENCY, on: true, coAgent: 'Synthetic co-agent' };
  render(true, { id: 'deal-a', name: 'Updated by a colleague', rentPa: '110000', updatedAt: 'later' });
  assert.equal(state.resets, 1);
  assert.equal(state.form.name, 'Unsaved name');
  assert.equal(state.form.rentPa, '125000');
  assert.equal(state.changeReason, 'Negotiated rent');
  assert.equal(state.learning, 'Draft note');
  assert.equal(state.showAllFields, true);
  assert.equal(state.feeRows.length, 1);
  assert.equal(state.pickedUnit.unitName, 'Unit 1');
  assert.equal(state.jointAgency.coAgent, 'Synthetic co-agent');
});

test('switching deals and closing/reopening starts from the latest server record', () => {
  const { state, render } = setup();
  render(true, { id: 'deal-a', name: 'A' });
  state.form.name = 'Unsaved A';
  state.pickedUnit = { propertyId: 'property-a', unitName: 'Unit 1' };
  state.jointAgency = { ...EMPTY_JOINT_AGENCY, on: true };
  state.jointAgencyErrors = true;
  render(true, { id: 'deal-b', name: 'B' });
  assert.equal(state.form.name, 'B');
  assert.equal(state.pickedUnit, null);
  assert.equal(state.jointAgency, EMPTY_JOINT_AGENCY);
  assert.equal(state.jointAgencyErrors, false);
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

test('a handover starts from the unit\'s deal at Solicitors, keeps the deal\'s name and clears the note hint', () => {
  const { state, render } = setup({ handover: { kind: 'promote', unit: { id: 'row-1' } } });
  render(true, { id: 'deal-a', name: 'Bluewater – Unit 12' });
  assert.deepEqual(state.form, { id: 'deal-a', name: 'Bluewater – Unit 12', status: 'SOL', landlordId: 'landlord-1', from: 'promote' });
  assert.equal(state.nameAutoFilled, false, 'the deal\'s own name is never overwritten by the auto-name rule');
  assert.equal(state.noteBrandHint, null);
  // The deal read from the box at the top (2026-11-20) is cleared with it.
  assert.deepEqual([state.dealRead, state.dealNoteBusy, state.propertySeed], [null, null, null]);
  // A tracker row with no deal yet still opens on the handover form.
  const orphan = setup({ handover: { kind: 'promote', unit: { id: 'row-2' } } });
  orphan.render(true, undefined);
  assert.equal(orphan.state.form.status, 'SOL');
  assert.equal(orphan.state.nameAutoFilled, false);
});

test('a new transaction opened from a company starts with that company filled in', () => {
  const { state, render } = setup({ prefill: { landlordId: 'company-1' } });
  render(true, null);
  assert.equal(state.form.landlordId, 'company-1');
  assert.equal(state.form.name, '');
  // Without one it starts empty, as before.
  const plain = setup();
  plain.render(true, null);
  assert.equal(plain.state.form.landlordId, undefined);
});
