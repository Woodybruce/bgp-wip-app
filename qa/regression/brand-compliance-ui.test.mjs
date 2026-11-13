import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import React from 'react';
import { brandComplianceStatus } from '../../shared/brand-compliance-status.ts';
import { recordCheckRows } from '../../shared/company-facts.ts';
const require = createRequire(import.meta.url);
const { source, ts } = require('./source-harness.cjs');
const file = 'client/src/components/brand-profile-panel.tsx';
function nodes(node) { return Array.isArray(node) ? node.flatMap(nodes) : React.isValidElement(node) ? [node, ...nodes(node.props.children)] : []; }
function text(node) { return Array.isArray(node) ? node.map(text).join(' ') : React.isValidElement(node) ? text(node.props.children) : node == null ? '' : String(node); }
function render(company, client = false, props = {}) {
  const ast = ts.createSourceFile(file, source(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declaration = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'BrandComplianceCard');
  const sandbox = { exports: {}, require, brandComplianceStatus, recordCheckRows, useQueryClient: () => ({}), useToast: () => ({}), useCovenantReportEnabled: props.covenantRefused ? () => false : num => !!num,
    useState: initial => [initial, () => {}], useMutation: () => ({ isPending: false }),
    useQuery: options => options.queryKey[0] === '/api/auth/me' ? { data: { role: client ? 'Client' : 'Staff' } } : { data: props.noReport || props.reportFailed ? undefined : { grade: 'A' }, isError: !!props.reportFailed },
  };
  for (const name of ['Pill','Card','CardHeader','CardTitle','CardContent','Link','ShieldCheck','Check','Loader2','ExternalLink','Pencil','Search','ChevronRight','Kyc4uStatusStrip']) sandbox[name] = name;
  vm.runInNewContext(ts.transpileModule(declaration.getText(ast), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, sandbox);
  return sandbox.exports.BrandComplianceCard({ companyId: 'brand', company, ...props });
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

test('combined landlord checks keep legal identity editing, downloads and KYC while showing covenant only in its dedicated section', () => {
  const tree = render(complete, false, { landlord: true, embedded: true });
  assert.match(text(tree), /Registered entity/);
  assert.match(text(tree), /Company records/);
  assert.doesNotMatch(text(tree), /Covenant grade/);
  assert.ok(nodes(tree).find(node => node.props.href === '/api/brand/brand/latest-accounts.pdf'));
  assert.ok(nodes(tree).find(node => node.props.title === 'Edit the trading entity manually'));
  assert.ok(nodes(tree).find(node => node.type === 'Kyc4uStatusStrip'));
  assert.match(text(render(complete)), /UK trading entity.*Downstream checks.*Covenant grade/s);
});

test('a login that is refused the covenant report is not shown the covenant row as a check not run', () => {
  // A Landsec joint agent: the report by company number is refused at the gateway.
  const refused = render(complete, true, { covenantRefused: true });
  assert.doesNotMatch(text(refused), /Covenant grade/);
  assert.match(text(refused), /Companies House profile.*Officers \+ PSCs.*Latest accounts/s);
  // Everyone else keeps the row, and a brand with no company number still shows it as not run.
  assert.match(text(render(complete, true)), /Covenant grade/);
  assert.match(text(render({ ...complete, companies_house_number: null }, true, { covenantRefused: true })), /Covenant grade/);
});

// A listed plc as the app holds one (Greggs, 2026-11-13): 35 officers held, the
// PSC register read and empty, the group accounts PDF held.
const plc = { name: 'Greggs', uk_entity_name: 'Greggs plc', companies_house_number: '00502851', kyc_status: 'in_review', last_accounts_storage_key: 'accounts.pdf', last_accounts_made_up_to: '2025-12-27',
  companies_house_data: { profile: { companyName: 'GREGGS PLC', companyType: 'plc' }, pscs: [], officers: [{ officerRole: 'director' }, { officerRole: 'secretary' }], fetchStatus: { pscs: 'ok' } } };
const rowsOf = tree => nodes(tree).filter(node => typeof node.props.className === 'string' && node.props.className.includes('flex gap-1.5 text-[11px]'));
const ticked = row => nodes(row).some(node => node.type === 'Check');
test('a plc with its officers and filed accounts held has every Checks run row ticked, for staff and a client alike', () => {
  for (const client of [false, true]) {
    const tree = render(plc, client, { brandPage: true, embedded: true });
    const rows = rowsOf(tree);
    const labels = ['Companies House profile', 'Officers + PSCs', 'Latest accounts', 'Annual report and accounts', 'Covenant grade (CH + Gazette)'];
    assert.equal(rows.length, labels.length);
    rows.forEach((row, index) => { assert.ok(text(row).trim().startsWith(labels[index]), labels[index]); assert.equal(ticked(row), true, labels[index]); });
    assert.match(text(tree), /Officers \+ PSCs.*1 serving director · public company, no PSCs on the register/s);
    assert.match(text(tree), /Annual report and accounts.*as filed at Companies House/s);
    // The collected rows never become an approval: the chip's state is KYC4U's.
    assert.match(text(tree), /Checks collected — approval not recorded/);
    assert.doesNotMatch(text(tree), /KYC approv/i);
    // One PDF link (the filed accounts); the landlord annual-report address is refused to clients and is not the file held here.
    assert.equal(nodes(tree).filter(node => /annual-report\.pdf/.test(String(node.props.href || ''))).length, 0);
    assert.equal(nodes(tree).filter(node => node.props.href === '/api/brand/brand/latest-accounts.pdf').length, 1);
  }
});
test('a row ticks only on a record that is held', () => {
  const noOfficers = render({ ...plc, companies_house_data: { ...plc.companies_house_data, officers: [] }, last_accounts_storage_key: null }, false, { brandPage: true, embedded: true, noReport: true });
  assert.deepEqual(rowsOf(noOfficers).map(ticked), [true, false, false, false, false]);
  assert.match(text(noOfficers), /Annual report \(PLC\)/);
  assert.doesNotMatch(text(noOfficers), /Checks collected/);
});
test('a private company is not shown an annual report row that does not apply to it', () => {
  assert.doesNotMatch(text(render(complete)), /Annual report/);
  assert.doesNotMatch(text(render(complete, true)), /Annual report/);
  // A stored annual report still shows, with its PDF for staff only.
  const stored = { ...complete, annual_report_storage_key: 'report.pdf' };
  assert.ok(nodes(render(stored)).find(node => node.props.href === '/api/landlord/brand/annual-report.pdf'));
  assert.match(text(render(stored, true)), /Annual report \(PLC\)/);
  assert.equal(nodes(render(stored, true)).some(node => node.props.href === '/api/landlord/brand/annual-report.pdf'), false);
  // The landlord card keeps its own annual report row.
  assert.match(text(render(complete, false, { landlord: true, embedded: true })), /Annual report \(PLC\)/);
});
test('a client whose covenant report could not be read is not shown the covenant row as a check not run; staff still are', () => {
  assert.doesNotMatch(text(render(plc, true, { brandPage: true, embedded: true, reportFailed: true })), /Covenant grade/);
  assert.match(text(render(plc, false, { brandPage: true, embedded: true, reportFailed: true })), /Covenant grade/);
  // No report yet is not a failure: the row stays, unticked.
  assert.match(text(render(plc, true, { brandPage: true, embedded: true, noReport: true })), /Covenant grade/);
});
