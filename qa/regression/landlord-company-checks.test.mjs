import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import React from 'react';
const require = createRequire(import.meta.url);
const { source, ts } = require('./source-harness.cjs');
const panel = 'client/src/components/brand-profile-panel.tsx';
const entities = 'client/src/components/account-entities-panel.tsx';
function nodes(node) { return Array.isArray(node) ? node.flatMap(nodes) : React.isValidElement(node) ? [node, ...nodes(node.props.children)] : []; }
function text(node) { return Array.isArray(node) ? node.map(text).join(' ') : React.isValidElement(node) ? text(node.props.children) : node == null ? '' : String(node); }
function component(file, name, bindings = {}) {
  const ast = ts.createSourceFile(file, source(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declaration = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  const tags = {};
  function visit(node) { if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && ts.isIdentifier(node.tagName)) tags[node.tagName.text] = node.tagName.text; ts.forEachChild(node, visit); }
  visit(declaration);
  const sandbox = { exports: {}, require, ...tags, useState: initial => [initial, () => {}], useToast: () => ({}), useQueryClient: () => ({}), ...bindings };
  vm.runInNewContext(ts.transpileModule(`${declaration.getText(ast)}\nexports.component = ${name};`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, sandbox);
  return sandbox.exports.component;
}

test('combined landlord card preserves the covenant run action and invalidates the linked company after success', async () => {
  let mutation, refetched = 0;
  const calls = [], invalidated = [];
  const render = component(panel, 'LandlordCompanyChecksCard', {
    useCovenantReport: () => ({ data: null, refetch: () => { refetched++; } }),
    useMutation: options => { mutation = options; return { mutate: () => options.mutationFn() }; },
    useQueryClient: () => ({ invalidateQueries: options => invalidated.push(options.queryKey) }),
    apiRequest: async (...args) => calls.push(args),
  });
  const tree = render({ companyId: 'landlord', company: { companies_house_number: ' 12345678 ' }, isClientViewer: false });
  const all = nodes(tree);
  assert.equal(all.filter(node => node.type === 'Card').length, 1);
  assert.equal(all.find(node => node.type === 'BrandComplianceCard').props.landlord, true);
  assert.equal(all.find(node => node.type === 'BrandComplianceCard').props.embedded, true);
  assert.equal(all.find(node => node.type === 'AccountEntitiesPanel').props.primaryCompanyNumber, '12345678');
  const billing = all.find(node => node.type === 'CompanyInvoicingControls');
  assert.equal(billing.props.mode, 'billing');
  assert.equal(billing.props.landlord, true);
  assert.equal(billing.props.companyId, 'landlord');
  await all.find(node => node.type === 'button' && text(node) === 'Run check').props.onClick();
  mutation.onSuccess();
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0])), ['POST', '/api/brand/landlord/credit-check', {}]);
  assert.equal(refetched, 1);
  assert.deepEqual(Array.from(invalidated[0]), ['/api/brand', 'landlord', 'profile']);
});

test('client view does not gain group-entity data or staff check actions', () => {
  const render = component(panel, 'LandlordCompanyChecksCard', { useCovenantReport: () => ({ data: null }), useMutation: () => ({}) });
  const tree = render({ companyId: 'landlord', company: { companies_house_number: '12345678' }, isClientViewer: true });
  assert.equal(nodes(tree).some(node => node.type === 'AccountEntitiesPanel'), false);
  assert.equal(nodes(tree).some(node => node.props.href === '/kyc-clouseau'), false);
  assert.equal(nodes(tree).some(node => node.type === 'button'), false);
  assert.equal(nodes(tree).some(node => node.type === 'CompanyInvoicingControls'), false);
  assert.equal(nodes(tree).some(node => node.type === 'BrandComplianceCard'), true);
});

test('embedded entities avoid repeating the account identity while keeping review, child identities and per-entity actions', () => {
  const self = { entityKind: 'company', entityId: 'landlord', name: 'Example Estates Ltd', companiesHouseNumber: '12345678', relation: 'self', representationConflicts: [], kyc: null };
  const child = { ...self, entityId: 'child', name: 'Example Property SPV Ltd', companiesHouseNumber: '87654321', relation: 'subsidiary' };
  const data = { accountName: self.name, entities: [self, child], summary: { total: 2, current: 0, unchecked: 2 } };
  let review;
  const render = component(entities, 'AccountEntitiesPanel', {
    Card: 'Card',
    useQuery: options => ({ data: options.queryKey[0] === '/api/aml/me' ? { isMlro: true } : data }),
    useMutation: () => ({}), useState: initial => [initial, value => { review = value; }],
    bucketOf: () => 'unchecked', BUCKET_ORDER: ['unchecked'], TONE: { unchecked: '', expired: '' }, tone: value => value,
    chip: 'chip', RELATION_LABEL: { self: 'Account', subsidiary: 'Subsidiary' },
  });
  const combined = render({ companyId: 'landlord', embedded: true, primaryCompanyNumber: '12345678' });
  assert.equal(combined.type, 'section');
  assert.match(text(combined), /Review account entity/);
  assert.doesNotMatch(text(combined), /Example Estates Ltd|12345678/);
  assert.match(text(combined), /Example Property SPV Ltd.*87654321/s);
  const reviewButton = nodes(combined).find(node => node.props['data-testid'] === 'entity-open-landlord');
  assert.equal(reviewButton.props['aria-label'], 'Review Example Estates Ltd');
  reviewButton.props.onClick();
  assert.equal(review.key, 'company-landlord');
  assert.equal(nodes(combined).filter(node => node.props['data-testid']?.startsWith('entity-approve-')).length, 2);
  assert.equal(nodes(combined).filter(node => node.props['data-testid']?.startsWith('entity-reject-')).length, 2);
  const brand = render({ companyId: 'landlord' });
  assert.equal(brand.type, 'Card');
  assert.match(text(brand), /Example Estates Ltd.*12345678/s);
  assert.doesNotMatch(text(brand), /Review account entity/);
});
