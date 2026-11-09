import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import React from 'react';
const require = createRequire(import.meta.url);
const { source, ts } = require('./source-harness.cjs');
const file = 'client/src/components/brand-profile-overview.tsx';
function descendants(node) {
  if (Array.isArray(node)) return node.flatMap(descendants);
  if (!React.isValidElement(node)) return [];
  return [node, ...descendants(node.props.children)];
}
function content(node) {
  if (Array.isArray(node)) return node.map(content).join(' ');
  if (React.isValidElement(node)) return content(node.props.children);
  return node == null ? '' : String(node);
}
function fixture(data) {
  const ast = ts.createSourceFile(file, source(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const code = ast.statements.filter(node => !ts.isImportDeclaration(node)).map(node => node.getText(ast)).join('\n') + '\nexports.BrandRetainedFactsReview = BrandRetainedFactsReview;';
  const slots = [], dependencies = [], effects = [], requests = []; let cursor = 0, pending;
  const sandbox = {
    exports: {}, require, console, URL, Date,
    Button: 'button', Input: 'input', Textarea: 'textarea', Label: 'label',
    useQuery: () => ({ data, isLoading: false, isError: false, refetch() {} }),
    useQueryClient: () => ({ invalidateQueries() {} }), useToast: () => ({ toast() {} }),
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = initial; return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }]; },
    useEffect(fn, deps) { const index = cursor++; if (!dependencies[index] || deps.some((dep, i) => dep !== dependencies[index][i])) { dependencies[index] = deps; effects.push(fn); } },
    useMutation(options) { return { isPending: false, mutate() { pending = Promise.resolve().then(options.mutationFn).then(options.onSuccess); } }; },
    apiRequest: async (method, path, payload) => { requests.push({ method, path, payload }); return { json: async () => ({ ok: true }) }; },
  };
  vm.runInNewContext(ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, sandbox);
  return { render(name, props) { cursor = 0; let node = sandbox.exports[name](props); if (effects.length) { while (effects.length) effects.shift()(); cursor = 0; node = sandbox.exports[name](props); } return node; }, requests, settle: () => pending };
}

test('the visible prepared label remains blocked by retained fact review independently of contact review', () => {
  const f = fixture({ ready: false, factReviewRequired: true, contactReviewRequired: true, preparedSections: 3, totalSections: 8, identity: { status: 'verified' }, stages: [{ stage: 'profile', status: 'ready' }] });
  const text = content(f.render('BrandPreparationStatus', { companyId: 'brand', refreshedAt: '2026-09-17' }));
  assert.match(text, /Core facts need review/); assert.match(text, /Facts need review/);
  assert.doesNotMatch(text, /Core facts prepared|Facts refreshed/);
});

test('retained facts form shows saved values, requires confirmation and submits only reviewed fields', async () => {
  const f = fixture({ factReview: { required: true, token: 'current-review-token', facts: { description: 'Saved human description', industry: 'Old industry', linkedin_url: 'https://www.linkedin.com/company/wrong/', head_office_address: { city: 'London' } } } });
  const props = { companyId: 'brand', identityVerified: true };
  let tree = f.render('BrandRetainedFactsReview', props);
  descendants(tree).find(node => node.props['data-testid'] === 'brand-fact-review-toggle').props.onClick();
  tree = f.render('BrandRetainedFactsReview', props);
  let nodes = descendants(tree);
  assert.equal(nodes.find(node => node.props.id === 'review-description-brand').props.value, 'Saved human description');
  assert.equal(nodes.find(node => node.props.id === 'review-city-brand').props.value, 'London');
  assert.equal(nodes.find(node => node.props.type === 'submit').props.disabled, true);
  for (const [id, value] of [['review-industry-brand', 'Food retail'], ['review-linkedin-brand', ''], ['review-city-brand', 'Sittingbourne']]) {
    nodes.find(node => node.props.id === id).props.onChange({ target: { value } });
    nodes = descendants(f.render('BrandRetainedFactsReview', props));
  }
  nodes.find(node => node.props.type === 'checkbox').props.onChange({ target: { checked: true } });
  nodes = descendants(f.render('BrandRetainedFactsReview', props));
  assert.equal(nodes.find(node => node.props.type === 'submit').props.disabled, false);
  nodes.find(node => node.props['data-testid'] === 'brand-fact-review-form').props.onSubmit({ preventDefault() {} });
  await f.settle();
  assert.equal(f.requests.length, 1); const request = f.requests[0];
  assert.equal(request.method, 'PATCH'); assert.equal(request.path, '/api/brand/brand');
  assert.deepEqual(Object.keys(request.payload), ['factReview']);
  assert.equal(request.payload.factReview.token, 'current-review-token'); assert.equal(request.payload.factReview.confirmed, true);
  assert.equal(request.payload.factReview.description, 'Saved human description'); assert.equal(request.payload.factReview.industry, 'Food retail');
  assert.equal(request.payload.factReview.linkedin_url, ''); assert.equal(request.payload.factReview.head_office_address.city, 'Sittingbourne');
});
