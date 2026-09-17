import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import React from 'react';
import { brandComplianceStatus } from '../../shared/brand-compliance-status.ts';
const require = createRequire(import.meta.url);
const { source, ts } = require('./source-harness.cjs');
const file = 'client/src/components/brand-profile-panel.tsx';
function nodes(node) { return Array.isArray(node) ? node.flatMap(nodes) : React.isValidElement(node) ? [node, ...nodes(node.props.children)] : []; }
function text(node) { return Array.isArray(node) ? node.map(text).join(' ') : React.isValidElement(node) ? text(node.props.children) : node == null ? '' : String(node); }
function render(company, client = false) {
  const ast = ts.createSourceFile(file, source(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declaration = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'BrandComplianceCard');
  const sandbox = { exports: {}, require, brandComplianceStatus, useQueryClient: () => ({}), useToast: () => ({}),
    useState: initial => [initial, () => {}], useMutation: () => ({ isPending: false }),
    useQuery: options => ({ data: options.queryKey[0] === '/api/auth/me' ? { role: client ? 'Client' : 'Staff' } : { grade: 'A' } }),
  };
  for (const name of ['Pill','Card','CardHeader','CardTitle','CardContent','Link','ShieldCheck','Check','Loader2','ExternalLink','Pencil','Search','ChevronRight']) sandbox[name] = name;
  vm.runInNewContext(ts.transpileModule(declaration.getText(ast), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, sandbox);
  return sandbox.exports.BrandComplianceCard({ companyId: 'brand', company });
}
const complete = { name: 'COOK', uk_entity_name: 'COOK Trading Ltd', companies_house_number: '04611064', companies_house_data: { profile: { companyName: 'COOK TRADING LIMITED' }, pscs: [{}] }, last_accounts_storage_key: 'saved.pdf', aml_pep_status: 'clear' };
test('brand card does not turn a full collection checklist into AML approval', () => {
  const tree = render(complete);
  assert.match(text(tree), /Checks collected — approval not recorded/);
  assert.doesNotMatch(text(tree), /AML pass complete/);
  assert.ok(nodes(tree).find(node => node.props.href === '/api/brand/brand/latest-accounts.pdf'));
});
test('mismatched saved legal identity remains visible with a review explanation', () => {
  const tree = render({ ...complete, uk_entity_name: 'Digimedia.com, LP', kyc_status: 'approved' });
  assert.match(text(tree), /Legal entity needs review/);
  assert.match(text(tree), /Digimedia.com, LP.*COOK TRADING LIMITED/s);
  assert.ok(nodes(tree).find(node => node.props.title === 'Edit the trading entity manually'));
});
test('client card retains record visibility and the existing staff-action restriction', () => {
  const tree = render(complete, true);
  assert.match(text(tree), /COOK Trading Ltd/);
  assert.match(text(tree), /Checks collected — approval not recorded/);
  assert.ok(nodes(tree).find(node => node.props.href === '/api/brand/brand/latest-accounts.pdf'));
  assert.equal(nodes(tree).some(node => node.props.title === 'Edit the trading entity manually'), false);
});
