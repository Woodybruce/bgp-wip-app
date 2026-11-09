import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { source, ts } = require('./source-harness.cjs');
const file = 'client/src/components/official-copy-button.tsx';
const ast = ts.createSourceFile(file, source(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const code = ast.statements.filter(n => !ts.isImportDeclaration(n)).map(n => n.getText(ast)).join('\n');
function descendants(tree) {
  if (Array.isArray(tree)) return tree.flatMap(descendants);
  if (!React.isValidElement(tree)) return [];
  return [tree, ...descendants(tree.props.children)];
}
function fixture({ status = 200, body, error }) {
  const slots = [], toasts = [], opened = [], completed = [], requests = [];
  let cursor = 0, titleNumber = 'NGL813653', activeKey;
  const context = { exports: {}, React,
    Button: props => React.createElement('button', props), Loader2: () => null, Stamp: () => null, Download: () => null,
    AuthDownloadLink: ({ href, children }) => React.createElement('button', { 'data-download-url': href }, children),
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = initial; return [slots[index], next => { slots[index] = next; }]; },
    useToast: () => ({ toast: value => toasts.push(value) }), getAuthHeaders: () => ({ Authorization: 'Bearer qa-fixture' }),
    window: { confirm: () => true, open: (...args) => opened.push(args) },
    fetch: async (url, options) => { requests.push({ url, options }); if (error) throw error; return { ok: status >= 200 && status < 300, status, json: async () => body }; },
  };
  vm.runInNewContext(ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText, context);
  const render = () => {
    const child = context.exports.OfficialCopyButton({ titleNumber, onComplete: value => completed.push(value) });
    if (activeKey !== child.key) { slots.length = 0; activeKey = child.key; }
    cursor = 0;
    return child.type(child.props);
  };
  return { toasts, opened, completed, requests, render, setTitle: title => { titleNumber = title; return render(); }, order: async () => { const button = descendants(render()).find(n => n.props.onClick); await button.props.onClick(); return render(); } };
}

test('accepted pending order displays its reference and does not offer another paid order', async () => {
  const app = fixture({ status: 202, body: { ok: false, outcome: 'pending', reference: 'HMLR-123' } });
  const tree = await app.order();
  const html = renderToStaticMarkup(tree);
  assert.match(html, /Order pending/); assert.match(html, /HMLR-123/);
  assert.match(html, /Do not place another order/);
  assert.ok(descendants(tree).find(n => n.props.disabled === true));
  assert.equal(app.toasts[0].title, 'Official Copy pending');
  assert.equal(app.opened.length, 0);
});

test('provider delivery followed by save failure asks for recovery instead of success or reorder', async () => {
  const app = fixture({ status: 502, body: { ok: false, outcome: 'delivered', saved: null, requestMessageId: 'request-123' } });
  const html = renderToStaticMarkup(await app.order());
  assert.match(html, /Register received — saving failed/); assert.match(html, /request-123/);
  assert.match(html, /do not place another paid order/);
  assert.equal(app.toasts[0].title, 'Register needs recovery');
  assert.equal(app.opened.length, 0);
});

test('legacy success without a saved file is never described as saved', async () => {
  const app = fixture({ body: { ok: true, saved: null } });
  await app.order();
  assert.equal(app.toasts[0].title, 'Register needs recovery');
  assert.equal(app.opened.length, 0);
});

test('saved delivery uses the authenticated download control for the actual file', async () => {
  const url = '/api/lr-bg/register/NGL813653';
  const app = fixture({ body: { ok: true, outcome: 'delivered', saved: { registerUrl: url }, fee: 7 } });
  const html = renderToStaticMarkup(await app.order());
  assert.match(html, /Register \(HMLR\)/); assert.match(html, /data-download-url="\/api\/lr-bg\/register\/NGL813653"/);
  assert.equal(app.toasts[0].title, 'Official Copy retrieved');
  assert.equal(app.opened.length, 0, 'Do not navigate to an API URL without the token header');
  assert.equal(app.completed.length, 1);
});

test('rejected request surfaces the provider fault and makes no success claim', async () => {
  const app = fixture({ status: 502, body: { ok: false, outcome: 'rejected', fault: 'Login details are invalid.' } });
  await app.order();
  assert.equal(app.toasts[0].description, 'Login details are invalid.');
  assert.equal(app.opened.length, 0); assert.equal(app.completed.length, 0);
});

test('lost network response is treated as unknown order status rather than safe to reorder', async () => {
  const app = fixture({ error: new Error('Network unavailable') });
  const html = renderToStaticMarkup(await app.order());
  assert.match(html, /Check order status/);
  assert.match(html, /before placing another paid order/);
  assert.equal(app.toasts[0].title, 'Official Copy status unknown');
});

for (const [outcome, providerStatus] of [['unknown', 0], ['failed', 0], ['failed', 503]]) {
  test(`server ${outcome}/${providerStatus} prevents another order and retains the request reference`, async () => {
    const app = fixture({ status: 502, body: { ok: false, outcome, status: providerStatus, requestMessageId: 'ambiguous-123' } });
    const tree = await app.order();
    const html = renderToStaticMarkup(tree);
    assert.match(html, /Check order status/);
    assert.match(html, /ambiguous-123/);
    assert.ok(descendants(tree).find(n => n.props.disabled === true));
    assert.equal(app.toasts[0].title, 'Official Copy status unknown');
  });
}

for (const body of [
  { ok: false, outcome: 'pending', reference: 'HMLR-123' },
  { ok: true, outcome: 'delivered', saved: { registerUrl: '/api/lr-bg/register/NGL813653' } },
]) {
  test(`switching title clears ${body.outcome} state and orders only the newly selected title`, async () => {
    const app = fixture({ status: body.ok ? 200 : 202, body });
    await app.order();
    const tree = app.setTitle('NGL814693');
    const html = renderToStaticMarkup(tree);
    assert.doesNotMatch(html, /Order pending|Register \(HMLR\)|NGL813653/);
    const orderButton = descendants(tree).find(n => n.props.onClick);
    assert.equal(orderButton.props.disabled, false);
    await orderButton.props.onClick();
    assert.equal(JSON.parse(app.requests.at(-1).options.body).titleNumber, 'NGL814693');
  });
}
