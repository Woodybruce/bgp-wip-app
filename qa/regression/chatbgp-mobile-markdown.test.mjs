import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRequire } from 'node:module';
import { Marked } from 'marked';
import { decodeHTML } from 'entities';
const require = createRequire(import.meta.url);
const { source, find, ts } = require('./source-harness.cjs');

const markdownFile = 'client/src/components/chatbgp-markdown.tsx';
const mobileFile = 'client/src/components/mobile-app.tsx';
const tagFile = 'client/src/components/chat-tags.tsx';
const icon = () => null;
let sharedBindings = {};
function compile(code, bindings = {}) {
  const context = { exports: {}, React, URL, URLSearchParams, Marked, decodeHTML, createElement: React.createElement, useMemo: fn => fn(), Copy: icon, Check: icon, Download: icon, Loader2: icon,
    useState: initial => [initial, () => {}],
    TagChip: ({ name }) => React.createElement('button', { 'data-testid': 'tag-chip' }, name),
    ...sharedBindings, ...bindings };
  vm.runInNewContext(ts.transpileModule(code, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  }).outputText, context);
  return context;
}
const tagCode = find(tagFile, n => ts.isVariableStatement(n) && n.declarationList.declarations.some(d => d.name.getText() === 'TAG_TOKEN_SOURCE'));
const ast = ts.createSourceFile(markdownFile, source(markdownFile), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const markdownCode = tagCode + '\n' + ast.statements.filter(n => !ts.isImportDeclaration(n)).map(n => n.getText(ast)).join('\n');
const richAst = ts.createSourceFile('chat-rich-text.ts', source('shared/chat-rich-text.ts'), ts.ScriptTarget.Latest, true);
const richCode = richAst.statements.filter(n => !ts.isImportDeclaration(n)).map(n => n.getText(richAst)).join('\n');
const richText = compile(richCode).exports;
sharedBindings = richText;
const renderer = compile(markdownCode, richText);
const mobileCode = ['isSafeUrl', 'renderFormattedText', 'RenderMessageContent'].map(name => find(mobileFile, n => ts.isFunctionDeclaration(n) && n.name?.text === name)).join('\n');
const mobile = compile(tagCode + '\n' + mobileCode, renderer.exports);
function render(content, props = {}) {
  return renderToStaticMarkup(React.createElement(mobile.RenderMessageContent, { content, markdown: true, ...props }));
}
function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!React.isValidElement(tree)) return [];
  return [tree, ...nodes(tree.props.children)];
}
const table = `**What happened with each title:**

| Title | What it is | Result |
|---|---|---|
| NGL813653 | Head lease | Login details are invalid. |
| NGL814693 | Retail leaseback | Not delivered |`;

test('phone assistant renders the reported Land Registry result as a scrollable table', () => {
  const html = render(table);
  assert.match(html, /<table/);
  assert.equal((html.match(/<th /g) || []).length, 3);
  assert.equal((html.match(/<td /g) || []).length, 6);
  assert.match(html, /overflow-x-auto/);
  assert.match(html, /max-w-full whitespace-normal/);
  assert.doesNotMatch(html, /\|---\|/);
  assert.match(html, /Login details are invalid\./);
});

test('phone chat renders optional-pipe tables, escaped pipes and explicit line breaks', () => {
  const html = render('Use | Area | Tenant\n--- | --- | ---\nPadel | 25,000 sq ft | A \\| B\n\nArea: 25,000\nRent: £14  \nTenants: A, B');
  assert.equal((html.match(/<th /g) || []).length, 3);
  assert.equal((html.match(/<td /g) || []).length, 3);
  assert.match(html, /A \| B/);
  assert.equal((html.match(/<br\/>/g) || []).length, 2);
});

test('chat retains wrapped downloads, nested emphasis, smart tags and code copy', () => {
  const html = render('**[Workbook]\n(/api/chat-media/terms(1).xlsx)**\n\n@[Fixture](tag:property/fixture-id)\n\n```text\na < b\n```');
  assert.match(html, /data-testid="link-download-file"/);
  assert.match(html, /data-testid="tag-chip"/);
  assert.match(html, /data-testid="button-copy-code"/);
  assert.match(html, /a &lt; b/);
});

test('chat raw HTML and executable links never become active DOM', () => {
  const html = render('[Unsafe](java&#x73;cript:alert(1))\n\n<img src=x onerror="alert(2)">');
  assert.doesNotMatch(html, /href=|<img\b|<script\b/);
  assert.match(html, /&lt;img/);
});

test('linked images use one anchor rather than nested interactive controls', () => {
  const html = render('[![Shopfront](https://example.invalid/photo.jpg)](https://example.invalid/property)');
  assert.equal((html.match(/<a /g) || []).length, 1);
  assert.match(html, /href="https:\/\/example.invalid\/property"/);
  assert.match(html, /<img src="https:\/\/example.invalid\/photo.jpg"/);
});

test('human message keeps its original literal table and inline formatting', () => {
  const html = render(table, { markdown: false });
  assert.doesNotMatch(html, /<table/);
  assert.match(html, /\|---\|/);
  assert.match(html, /<strong>What happened with each title:<\/strong>/);
});

test('mobile checklist action remains interactive beside rendered markdown', () => {
  const clicked = [];
  const tree = mobile.RenderMessageContent({ content: `${table}\n\n☐ Review account setup`, markdown: true, onCheckboxClick: text => clicked.push(text), selectedCheckboxes: ['Review account setup'] });
  const button = nodes(tree).find(n => n.props['data-testid']?.startsWith('checkbox-action-'));
  assert.ok(button);
  button.props.onClick({ stopPropagation() {} });
  assert.deepEqual(clicked, ['Review account setup']);
  const html = renderToStaticMarkup(tree);
  assert.match(html, /<table/);
  assert.match(html, /border-black bg-black/);
});

test('register PDF, chat file, app link, external link, tag and code render independently', () => {
  const html = render(`[Official register](/api/lr-bg/register/NGL813653)

**[Original workbook](/api/chat-media/terms(1).xlsx)**

[Open deal](/deals/fixture-deal) [Source](https://example.com/source) @[Fixture](tag:property/fixture-id) \`NGL813653\``);
  assert.equal((html.match(/data-testid="link-download-file"/g) || []).length, 2);
  assert.match(html, /href="\/deals\/fixture-deal"/);
  assert.match(html, /href="https:\/\/example.com\/source"/);
  assert.match(html, /data-testid="tag-chip"/);
  assert.match(html, /<code>NGL813653<\/code>/);
  assert.doesNotMatch(html, /href="\/api\/lr-bg/);
});

test('previously saved bare register paths get a download control without linking other API paths', () => {
  const html = render('/api/lr-bg/register/NGL813653\n\n/api/lr-bg/status');
  assert.equal((html.match(/data-testid="link-download-file"/g) || []).length, 1);
  assert.match(html, /Download official register/);
  assert.match(html, /\/api\/lr-bg\/status/);
});

test('Companies House deed links use authenticated downloads while public filing links stay external', () => {
  const html = render(`[Insurance security](/api/companies-house/document/doc_123-abc?filename=Royex-Insurance-Security.pdf#page=6)

[Bank account security](/api/companies-house/document/doc456)

[Official filing](https://find-and-update.company-information.service.gov.uk/company/11473397/filing-history/example/document?format=pdf)`);
  assert.equal((html.match(/data-testid="link-download-file"/g) || []).length, 2);
  assert.doesNotMatch(html, /href="\/api\/companies-house\/document/);
  assert.match(html, /href="https:\/\/find-and-update.company-information.service.gov.uk/);
});

test('Companies House downloads get a sanitized PDF filename and keep token authentication', async () => {
  for (const [suffix, expected] of [
    ['?filename=Royex-Insurance-Security.pdf#page=6', 'Royex-Insurance-Security.pdf'],
    ['?filename=..%2F..%5CRoyex%20Security%0A.pdf', 'Royex_Security_.pdf'],
    ['?filename=%2F%5C', 'Companies-House-doc_123-abc.pdf'],
    ['', 'Companies-House-doc_123-abc.pdf'],
  ]) {
    const requests = [], saved = [];
    const context = compile(markdownCode, {
      localStorage: { getItem: key => key === 'bgp_addin_token' ? 'qa-staff-token-only' : null },
      fetch: async (url, options) => { requests.push({ url, options }); return { ok: true, blob: async () => ({ size: 20 }) }; },
      URL: { createObjectURL: () => 'blob:qa-deed', revokeObjectURL() {} },
      document: { body: { appendChild() {} }, createElement: () => ({ click() { saved.push({ href: this.href, download: this.download }); }, remove() {} }) },
      setTimeout: fn => fn(),
    });
    const href = `/api/companies-house/document/doc_123-abc${suffix}`;
    const tree = context.exports.AuthDownloadLink({ href, children: 'Deed' });
    await nodes(tree).find(n => n.type === 'button').props.onClick({ preventDefault() {} });
    assert.equal(requests[0].url, href);
    assert.equal(requests[0].options.credentials, 'include');
    assert.equal(requests[0].options.headers.Authorization, 'Bearer qa-staff-token-only');
    assert.deepEqual(saved, [{ href: 'blob:qa-deed', download: expected }]);
  }
});

test('official register saves as a PDF using the authenticated download flow', async () => {
  const requests = [], saved = [], states = [];
  const context = compile(markdownCode, {
    useState: initial => [initial, next => states.push(next)],
    localStorage: { getItem: key => key === 'bgp_auth_token' ? 'qa-token-only' : null },
    fetch: async (url, options) => { requests.push({ url, options }); return { ok: true, blob: async () => ({ size: 20 }) }; },
    URL: { createObjectURL: () => 'blob:qa-register', revokeObjectURL() {} },
    document: { body: { appendChild() {} }, createElement: () => ({ click() { saved.push({ href: this.href, download: this.download }); }, remove() {} }) },
    setTimeout: fn => fn(),
  });
  const tree = context.exports.AuthDownloadLink({ href: '/api/lr-bg/register/NGL813653', children: 'Register' });
  await nodes(tree).find(n => n.type === 'button').props.onClick({ preventDefault() {} });
  assert.equal(requests[0].url, '/api/lr-bg/register/NGL813653');
  assert.equal(requests[0].options.credentials, 'include');
  assert.equal(requests[0].options.headers.Authorization, 'Bearer qa-token-only');
  assert.deepEqual(saved, [{ href: 'blob:qa-register', download: 'NGL813653-OC1-Register.pdf' }]);
  assert.equal(states.at(-1), false);
});

test('authenticated downloader refuses external URLs before reading or sending a token', async () => {
  const states = [];
  const context = compile(markdownCode, {
    useState: initial => [initial, next => states.push(next)],
    localStorage: { getItem() { throw new Error('Token must not be read for an external URL'); } },
    fetch() { throw new Error('External download must not make a request'); },
  });
  const tree = context.exports.AuthDownloadLink({ href: '//other.invalid/file.pdf', children: 'Register' });
  await nodes(tree).find(n => n.type === 'button').props.onClick({ preventDefault() {} });
  assert.ok(states.includes('Download must use an app file link'));
});

test('register download reports server error instead of saving an error response as PDF', async () => {
  const states = [];
  const context = compile(markdownCode, {
    useState: initial => [initial, next => states.push(next)],
    localStorage: { getItem: () => null },
    fetch: async () => ({ ok: false, status: 404, json: async () => ({ error: 'No Official Copy stored for this title' }) }),
  });
  const tree = context.exports.AuthDownloadLink({ href: '/api/lr-bg/register/NGL813653', children: 'Register' });
  await nodes(tree).find(n => n.type === 'button').props.onClick({ preventDefault() {} });
  assert.ok(states.includes('HTTP 404: No Official Copy stored for this title'));
});
