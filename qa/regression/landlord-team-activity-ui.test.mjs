import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import React from 'react';
const require = createRequire(import.meta.url);
const { source, ts } = require('./source-harness.cjs');
const file = 'client/src/components/landlord-relationship-team.tsx';
const nodes = node => Array.isArray(node) ? node.flatMap(nodes) : React.isValidElement(node) ? [node, ...nodes(node.props.children)] : [];
const text = node => Array.isArray(node) ? node.map(text).join('') : React.isValidElement(node) ? text(node.props.children) : node == null ? '' : String(node);
function component(name, bindings = {}) {
  const ast = ts.createSourceFile(file, source(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declaration = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  const tags = {};
  function visit(node) { if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && ts.isIdentifier(node.tagName)) tags[node.tagName.text] = node.tagName.text; ts.forEachChild(node, visit); }
  visit(declaration);
  const sandbox = { exports: {}, require, ...tags, useState: initial => [initial, () => {}], useMutation: () => ({}), ...bindings };
  vm.runInNewContext(ts.transpileModule(`${declaration.getText(ast)}\nexports.component = ${name};`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, sandbox);
  return sandbox.exports.component;
}
const member = { id: 'sam', name: 'Sam Morgan', title: 'Director', profilePicUrl: null, active: true, assigned: true, assignedRole: 'Relationship lead', emailCount: 12, meetingCount: 3, dealCount: 2, conversationCount: 4, lastInteractionAt: '2026-10-27T10:00:00Z', contexts: [{ id: 'tenant-role', role: 'Tenant representative', propertyId: 'high-street', propertyName: 'High Street', origin: 'suggested', notes: 'Tenant-side work only.', sources: [{ kind: 'deal', id: 'deal-123', label: 'Tenant letting #123', url: '/deals/deal-123' }] }] };

test('member email and invitation counts are accessible actions; other totals and role evidence stay intact', () => {
  const opened = [];
  const tree = component('TeamMember')({ companyId: 'landlord', member, properties: [], canEdit: true, onSaved: () => {}, onOpenActivity: kind => opened.push(kind) });
  const buttons = nodes(tree).filter(node => node.type === 'button' && node.props['aria-haspopup'] === 'dialog');
  assert.equal(buttons.length, 2);
  assert.equal(buttons[0].props['aria-label'], 'View 12 emails involving Sam Morgan');
  assert.equal(buttons[1].props['aria-label'], 'View 3 invitations involving Sam Morgan');
  for (const button of buttons) { assert.equal(button.props.type, 'button'); button.props.onClick(); }
  assert.deepEqual(opened, ['emails', 'meetings']);
  assert.match(text(tree), /12 emails · 3 invitations · 2 deals · 4 chat messages/);
  assert.ok(nodes(tree).some(node => node.type === 'a' && node.props.href === '/deals/deal-123'));
  assert.ok(nodes(tree).some(node => node.type === 'button' && text(node) === 'Confirm role'));
  assert.match(text(tree), /Tenant-side work only/);
});

test('zero counts do not create misleading activity actions or remove the saved role', () => {
  const tree = component('TeamMember')({ companyId: 'landlord', member: { ...member, emailCount: 0, meetingCount: 0, dealCount: 0, conversationCount: 0, contexts: [] }, properties: [], canEdit: false, onSaved: () => {}, onOpenActivity: () => { throw new Error('No action expected'); } });
  assert.equal(nodes(tree).filter(node => node.type === 'button' && node.props['aria-haspopup'] === 'dialog').length, 0);
  assert.match(text(tree), /Saved account assignment/);
  assert.match(text(tree), /Relationship lead/);
});

test('team mounts only the selected person’s scoped history and unmounts it when closed', () => {
  let index = 0;
  const state = [];
  const render = component('LandlordRelationshipTeam', {
    useState: initial => { const i = index++; if (!(i in state)) state[i] = initial; return [state[i], value => { state[i] = value; }]; },
    useQueryClient: () => ({ invalidateQueries: () => {} }),
    useQuery: () => ({ data: { members: [member, { ...member, id: 'jo', name: 'Jo Reed' }], properties: [], issues: [] } }),
  });
  const tree = () => { index = 0; return render({ companyId: 'landlord', companyName: 'Example Estates', canEdit: false }); };
  assert.equal(nodes(tree()).filter(node => node.type === 'BrandEmailHistory' || node.type === 'LandlordMeetingsHistory').length, 0);
  nodes(tree()).filter(node => node.type === 'TeamMember')[0].props.onOpenActivity('emails');
  let dialog = nodes(tree()).find(node => node.type === 'BrandEmailHistory');
  assert.equal(dialog.props.companyId, 'landlord');
  assert.equal(dialog.props.companyName, 'Example Estates');
  assert.equal(dialog.props.landlord, true);
  assert.deepEqual(JSON.parse(JSON.stringify(dialog.props.person)), { userId: 'sam', name: 'Sam Morgan' });
  assert.equal(nodes(tree()).some(node => node.type === 'LandlordMeetingsHistory'), false);
  dialog.props.onOpenChange(false);
  assert.equal(nodes(tree()).some(node => node.type === 'BrandEmailHistory'), false);
  nodes(tree()).filter(node => node.type === 'TeamMember')[1].props.onOpenActivity('meetings');
  dialog = nodes(tree()).find(node => node.type === 'LandlordMeetingsHistory');
  assert.deepEqual(JSON.parse(JSON.stringify(dialog.props.person)), { userId: 'jo', name: 'Jo Reed' });
  assert.equal(dialog.props.initialPeriod, 'recent');
  assert.equal(nodes(tree()).some(node => node.type === 'BrandEmailHistory'), false);
});
