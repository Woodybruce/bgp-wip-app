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
  const sandbox = { exports: {}, require, ...tags, useState: initial => [initial, () => {}], useToast: () => ({}), useQueryClient: () => ({}), useLandsecRestricted: () => false, ...bindings };
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
  assert.deepEqual(Array.from(invalidated[1]), ['/api/landlord-relationships', 'landlord', 'covenant']);
});

test('brand card keeps the covenant summary and compliance checks but drops the landlord-only entities and billing', () => {
  const render = component(panel, 'LandlordCompanyChecksCard', { useCovenantReport: () => ({ data: { grade: 'B' } }), useMutation: () => ({}) });
  const tree = render({ companyId: 'brand', company: { name: 'Dough', companies_house_number: '12345678' }, isClientViewer: false, landlord: false });
  const all = nodes(tree);
  assert.equal(all.filter(node => node.type === 'Card').length, 1);
  assert.equal(all[0].props['data-testid'], 'brand-company-checks');
  assert.equal(all.find(node => node.type === 'LandlordCovenantSummary').props.companyId, 'brand');
  assert.equal(all.find(node => node.type === 'BrandComplianceCard').props.landlord, false);
  assert.equal(all.find(node => node.type === 'BrandComplianceCard').props.embedded, true);
  assert.equal(all.some(node => node.type === 'AccountEntitiesPanel'), false);
  assert.equal(all.some(node => node.type === 'CompanyInvoicingControls'), false);
  assert.equal(all.some(node => node.props.href === '/kyc-clouseau'), true);
});

test('client view does not gain group-entity data or staff check actions', () => {
  const render = component(panel, 'LandlordCompanyChecksCard', { useCovenantReport: () => ({ data: null }), useMutation: () => ({}) });
  const tree = render({ companyId: 'landlord', company: { companies_house_number: '12345678' }, isClientViewer: true });
  assert.equal(nodes(tree).some(node => node.type === 'LandlordCovenantSummary'), false);
  assert.equal(nodes(tree).some(node => node.type === 'AccountEntitiesPanel'), false);
  assert.equal(nodes(tree).some(node => node.props.href === '/kyc-clouseau'), false);
  assert.equal(nodes(tree).some(node => node.type === 'button'), false);
  assert.equal(nodes(tree).some(node => node.type === 'CompanyInvoicingControls'), false);
  assert.equal(nodes(tree).some(node => node.type === 'BrandComplianceCard'), true);
});


test('landlord checks lead with the scoped summary and keep all existing controls in closed details', () => {
  let expanded = false;
  const render = component(panel, 'LandlordCompanyChecksCard', {
    useCovenantReport: () => ({ data: { grade: 'A' } }),
    useMutation: () => ({}),
    useState: () => [expanded, value => { expanded = value; }],
  });
  const props = { companyId: 'landlord', company: { name: 'Example Estates', companies_house_number: ' 12345678 ' }, isClientViewer: false };
  const tree = render(props), all = nodes(tree);
  const summary = all.find(node => node.type === 'LandlordCovenantSummary');
  assert.equal(summary.props.companyId, 'landlord');
  assert.equal(summary.props.companyName, 'Example Estates');
  assert.equal(summary.props.companyNumber, '12345678');
  assert.equal(all.some(node => node.type === 'CovenantCommentary' || node.type === 'CovenantBadge'), false);
  const details = all.find(node => node.type === 'details');
  assert.equal(details.props.open, undefined, 'native details must start collapsed');
  assert.ok(all.indexOf(summary) < all.indexOf(details));
  assert.equal(nodes(details).some(node => node.type === 'LandlordCovenantSummary'), false);
  for (const name of ['BrandComplianceCard', 'AccountEntitiesPanel', 'CompanyInvoicingControls']) {
    assert.equal(nodes(details).filter(node => node.type === name).length, 1, `${name} remains available once opened`);
  }
  assert.equal(nodes(details).find(node => node.type === 'summary').props.children, 'Show more');
  details.props.onToggle({ currentTarget: { open: true } });
  assert.equal(nodes(render(props)).find(node => node.type === 'summary').props.children, 'Show less');
  details.props.onToggle({ currentTarget: { open: false } });
  assert.equal(nodes(render(props)).find(node => node.type === 'summary').props.children, 'Show more');
});

test('a brand page card rests on its summary and the checks run, with the toggle at its foot, and asks for its own height only when opened or thin', () => {
  let open = false;
  const bindings = (facts = { summary: [{ key: 'type', text: 'Public limited company' }], rows: [{ key: 'type', label: 'Type', value: 'Public limited company' }] }, report = { grade: 'A', verdict: 'Sound. More.' }) => ({
    useCovenantReport: () => ({ data: report }), useMutation: () => ({}), useState: () => [open, value => { open = typeof value === 'function' ? value(open) : value; }],
    brandKycChip: () => null, verdictFirstSentence: () => (report ? 'Sound.' : ''), companyFacts: () => facts,
  });
  const props = { companyId: 'brand', company: { name: 'Greggs', uk_entity_name: 'Greggs plc', companies_house_number: '00502851' }, landlord: false, brandSummary: true };
  for (const isClientViewer of [false, true]) {
    open = false;
    const render = component(panel, 'LandlordCompanyChecksCard', bindings());
    let all = nodes(render({ ...props, isClientViewer }));
    assert.equal(all.some(node => node.type === 'details' || node.type === 'summary'), false, 'no native details on a brand page');
    assert.equal(all[0].props['data-own-height'], undefined, 'at rest the card can share the pair height');
    assert.deepEqual(all.filter(node => node.type === 'BrandComplianceCard').map(node => node.props.part), ['records'], 'the checks run are on the card at rest');
    assert.equal(all.some(node => node.type === 'CompanyFactsRows' || node.type === 'CovenantCommentary'), false);
    assert.match(text(all.find(node => node.props['data-testid'] === 'brand-checks-verdict-line')), /Sound\./);
    const toggle = all.find(node => node.props['data-testid'] === 'brand-checks-toggle');
    assert.equal(toggle.props.children, 'Show more');
    const content = all.find(node => node.type === 'CardContent');
    assert.equal(nodes(content.props.children).filter(node => node.type === 'button').at(-1), toggle);
    assert.equal(nodes(content.props.children).at(-1), toggle, 'the toggle is the last thing in the card');
    toggle.props.onClick();
    all = nodes(render({ ...props, isClientViewer }));
    assert.equal(all[0].props['data-own-height'], 'true', 'opened, the card takes its own height');
    assert.equal(all.find(node => node.props['data-testid'] === 'brand-checks-toggle').props.children, 'Show less');
    // Staff get the entity edit behind Show more; a client is not sent a second copy of the entity.
    assert.deepEqual(all.filter(node => node.type === 'BrandComplianceCard').map(node => node.props.part), isClientViewer ? ['records'] : ['records', 'entity']);
    assert.equal(all.filter(node => node.type === 'CompanyFactsRows').length, 1);
    assert.equal(all.some(node => node.props['data-testid'] === 'brand-checks-verdict-line'), false, 'the full verdict replaces its first sentence');
    assert.equal(all.some(node => node.type === 'Kyc4uStatusStrip'), !isClientViewer);
  }
  // A restricted Landsec role (a joint agent: no covenant report is asked for) is shown no company facts, at rest or opened, and no empty toggle.
  open = false;
  const restricted = component(panel, 'LandlordCompanyChecksCard', { ...bindings(undefined, null), useLandsecRestricted: () => true });
  const restrictedAll = nodes(restricted({ ...props, isClientViewer: true }));
  assert.equal(restrictedAll.some(node => node.type === 'CompanyFactsSummary' || node.type === 'CompanyFactsRows'), false);
  assert.deepEqual(restrictedAll.filter(node => node.type === 'BrandComplianceCard').map(node => node.props.part), ['records']);
  assert.equal(restrictedAll.some(node => node.props['data-testid'] === 'brand-checks-toggle'), false);
  assert.equal(nodes(component(panel, 'LandlordCompanyChecksCard', bindings(undefined, null))({ ...props, isClientViewer: true })).filter(node => node.type === 'CompanyFactsSummary').length, 1, 'every other client keeps them');
  // Only the entity and the checks run (no facts lines, no verdict): not stretched into a blank.
  open = false;
  const thin = component(panel, 'LandlordCompanyChecksCard', bindings({ summary: [], rows: [] }, null));
  const thinStaff = nodes(thin({ ...props, isClientViewer: false }));
  assert.equal(thinStaff[0].props['data-own-height'], 'true');
  assert.ok(thinStaff.find(node => node.props['data-testid'] === 'brand-checks-toggle'));
  // A client with nothing behind Show more is not shown a toggle that opens nothing.
  assert.equal(nodes(thin({ ...props, isClientViewer: true })).some(node => node.props['data-testid'] === 'brand-checks-toggle'), false);
  // No trading entity: one line, everything else behind Show more, own height.
  const none = nodes(thin({ ...props, company: { name: 'Dough' }, isClientViewer: false }));
  assert.equal(none[0].props['data-own-height'], 'true');
  assert.equal(none.some(node => node.type === 'BrandComplianceCard'), false);
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
