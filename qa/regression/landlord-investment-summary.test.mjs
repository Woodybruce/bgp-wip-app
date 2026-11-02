import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import React from 'react';
import { landlordInvestmentRequirementSummary } from '../../client/src/lib/landlord-investment-requirement.ts';
const require = createRequire(import.meta.url);
const { source, ts } = require('./source-harness.cjs');
const nodes = node => Array.isArray(node) ? node.flatMap(nodes) : React.isValidElement(node) ? [node, ...nodes(node.props.children)] : [];
const text = node => Array.isArray(node) ? node.map(text).join(' ') : React.isValidElement(node) ? text(node.props.children) : node == null ? '' : String(node);
function load(file, name, bindings) {
  const ast = ts.createSourceFile(file, source(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declaration = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  const tags = {};
  function visit(node) { if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && ts.isIdentifier(node.tagName)) tags[node.tagName.text] = node.tagName.text; ts.forEachChild(node, visit); }
  visit(declaration);
  const sandbox = { exports: {}, require, ...tags, ...bindings };
  vm.runInNewContext(ts.transpileModule(`${declaration.getText(ast)}\nexports.component = ${name};`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, sandbox);
  return sandbox.exports.component;
}

test('landlord requirement summary preserves recorded criteria, comments and distinct record links', () => {
  const requirement = { id: 'req/a?b&c', name: 'Example Estates', ownName: true, use_types: ['Retail', 'Leisure'], requirement_types: ['Freehold'], size_range: ['£5m–£20m'], requirement_locations: ['London', 'South East'], locations: 'Legacy location', comments: 'Only send occupied buildings.\nConfirm target yield with Alex.' };
  const brief = landlordInvestmentRequirementSummary(requirement);
  assert.equal(brief.title, 'Investment requirement');
  assert.equal(brief.summary, 'Use: Retail, Leisure · Type: Freehold · Size: £5m–£20m · Locations: London, South East');
  assert.equal(brief.excerpt, 'Only send occupied buildings. Confirm target yield with Alex.');
  assert.equal(brief.missing, '');
  assert.equal(new URL(brief.href, 'https://example.test').searchParams.get('requirementId'), requirement.id);
  assert.notEqual(brief.href, landlordInvestmentRequirementSummary({ ...requirement, id: 'other' }).href);
});

test('missing criteria stay explicit; legacy location and long saved notes remain available', () => {
  const notes = 'This is a saved factual note. '.repeat(20);
  const brief = landlordInvestmentRequirementSummary({ id: 'empty', name: 'Separate fund mandate', use_types: ['Retail', 'Retail'], requirement_types: [], size_range: null, requirement_locations: [], locations: 'Manchester', comments: notes });
  assert.equal(brief.title, 'Separate fund mandate');
  assert.equal(brief.summary, 'Use: Retail · Locations: Manchester');
  assert.equal(brief.missing, 'Fields not recorded: type, size.');
  assert.ok(brief.excerpt.length <= 241);
  assert.ok(brief.excerpt.endsWith('…'));
  assert.equal(brief.notes, notes.trim());
  const empty = landlordInvestmentRequirementSummary({ id: 'new', use_types: {}, size_range: '[]', requirement_locations: '{}' });
  assert.equal(empty.summary, '');
  assert.equal(empty.missing, 'Fields not recorded: use, type, size, locations.');
  assert.doesNotMatch(JSON.stringify(empty), /\[object Object\]/);
});

test('landlord card exposes wrapping body copy and full notes with a link to the same record', () => {
  const requirement = { id: 'record-1234', name: 'Separate fund', use_types: ['Retail'], locations: 'London', updated_at: '2026-10-27', comments: 'A detailed saved buying note. '.repeat(20) };
  const render = load('client/src/components/account-team-views.tsx', 'LandlordInvestmentRequirementRow', { landlordInvestmentRequirementSummary, fmtDate: value => value });
  const tree = render({ requirement, status: 'Active' });
  assert.match(text(tree), /Use: Retail · Locations: London/);
  assert.match(text(tree), /Fields not recorded: type, size/);
  assert.ok(nodes(tree).some(node => node.type === 'details' && text(node).includes(requirement.comments.trim())));
  const links = nodes(tree).filter(node => node.type === 'Link');
  assert.equal(links.length, 2);
  assert.equal(links[0].props.href, links[1].props.href);
  assert.equal(new URL(links[0].props.href, 'https://example.test').searchParams.get('requirementId'), requirement.id);
  for (const node of nodes(tree)) assert.doesNotMatch(node.props.className || '', /truncate|line-clamp/);
  assert.ok(nodes(tree).some(node => node.type === 'p' && /text-sm/.test(node.props.className)));
});

function tableFixture() {
  let stateIndex, refIndex, effects = [], data = [], loading = false, failure = null;
  const state = [], refs = [], notices = [];
  const render = load('client/src/pages/requirements.tsx', 'InvestmentTable', {
    useLocation: () => ['/requirements', () => {}], useIsMobile: () => true,
    useState: initial => { const i = stateIndex++; if (!(i in state)) state[i] = initial; return [state[i], value => { state[i] = typeof value === 'function' ? value(state[i]) : value; }]; },
    useRef: initial => { const i = refIndex++; return refs[i] ||= { current: initial }; },
    useMemo: fn => fn(), useEffect: fn => effects.push(fn),
    useQuery: options => options.queryKey[0] === '/api/crm/requirements-investment' ? { data, isLoading: loading, error: failure } : { data: [] },
    useMutation: () => ({}), useToast: () => ({ toast: notice => notices.push(notice) }),
    buildUserIdColorMap: () => ({}), useClassLabel: value => value,
  });
  return { notices, setData: value => { data = value; }, setLoading: value => { loading = value; },
    render: requirementId => { stateIndex = refIndex = 0; effects = []; const tree = render({ requirementId }); for (const effect of effects) effect(); return tree; },
    editItem: () => state[4], close: () => { state[4] = null; },
  };
}

test('record deep link waits for the authorised list and opens exactly once without reopening after close/refetch', () => {
  const f = tableFixture();
  f.setLoading(true); f.render('chosen');
  assert.equal(f.editItem(), null);
  assert.equal(f.notices.length, 0);
  const chosen = { id: 'chosen', name: 'Chosen record' };
  f.setLoading(false); f.setData([{ id: 'other', name: 'Other record' }, chosen]); f.render('chosen');
  assert.equal(f.editItem(), chosen);
  f.close(); f.setData([{ ...chosen }]); f.render('chosen');
  assert.equal(f.editItem(), null);
  const second = { id: 'second', name: 'Second record' };
  f.setData([chosen, second]); f.render('second');
  assert.equal(f.editItem(), second);
  f.render('missing');
  assert.equal(f.editItem(), null);
});

test('no deep link leaves the investment view unchanged; missing links never open another record', () => {
  const f = tableFixture();
  f.setData([{ id: 'other', name: 'Other record' }]); f.render(undefined);
  assert.equal(f.editItem(), null); assert.equal(f.notices.length, 0);
  f.render('missing'); f.render('missing');
  assert.equal(f.editItem(), null); assert.equal(f.notices.length, 1);
  assert.match(f.notices[0].description, /removed or is not available/);
});
