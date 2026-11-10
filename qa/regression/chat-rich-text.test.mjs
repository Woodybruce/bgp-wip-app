import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { Marked } from 'marked';
import { decodeHTML } from 'entities';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { source, ts } = require('./source-harness.cjs');
const ast = ts.createSourceFile('chat-rich-text.ts', source('shared/chat-rich-text.ts'), ts.ScriptTarget.Latest, true);
const code = ast.statements.filter(n => !ts.isImportDeclaration(n)).map(n => n.getText(ast)).join('\n');
const context = { exports: {}, Marked, decodeHTML, URL, URLSearchParams };
vm.runInNewContext(ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context);
const { parseRichText, renderEmailHtml, renderPlainText, safeRichTextUrl, safeExportUrl } = context.exports;

const padel = `## Leisure opportunities

Use | Area | Rent per sq ft pa | Potential tenants
--- | --- | --- | ---
Padel with café/bar | 25,000 sq ft | £14 blended | Padium, Padel Social Club
Cinema | 15,000 sq ft | £15 | Everyman \\| Curzon

**Next step:** confirm the operator requirements.`;

test('padel table without outer pipes renders real email cells and readable plain rows', () => {
  const table = parseRichText(padel).find(t => t.type === 'table');
  assert.equal(table.header.length, 4);
  assert.equal(table.rows.length, 2);
  assert.equal(table.rows[1].length, 4);
  const html = renderEmailHtml(padel);
  assert.equal((html.match(/<th /g) || []).length, 4);
  assert.equal((html.match(/<td /g) || []).length, 8);
  assert.match(html, /Everyman \| Curzon/);
  assert.match(html, /<strong>Next step:<\/strong>/);
  assert.doesNotMatch(html, /class=|bg-muted|--border|\*\*|--- \|/);
  const plain = renderPlainText(padel);
  assert.match(plain, /Use\tArea\tRent per sq ft pa\tPotential tenants/);
  assert.match(plain, /Padel with café\/bar\t25,000 sq ft\t£14 blended/);
});

test('paragraphs and both soft/hard line breaks survive without chat backgrounds', () => {
  const value = 'Area: 25,000 sq ft\nRent: £14  \nTenants: A, B\n\nKind regards,\nWoody';
  const html = renderEmailHtml(value);
  assert.equal((html.match(/<p /g) || []).length, 2);
  assert.equal((html.match(/<br>/g) || []).length, 3);
  assert.equal(renderPlainText(value), 'Area: 25,000 sq ft\nRent: £14\nTenants: A, B\n\nKind regards,\nWoody');
  for (const background of html.matchAll(/background-color:([^;]+);/g)) assert.ok(['#ffffff', 'transparent'].includes(background[1]));
});

test('nested lists, ordered starts, emphasis, strikeout and code keep their meaning', () => {
  const value = '3. **Bold** and *italic*\n   - nested item\n     - grandchild\n4. ~~Removed~~ and `a < b`\n\n```text\n<not-html>\n```';
  const html = renderEmailHtml(value);
  assert.match(html, /<ol start="3"/);
  assert.equal((html.match(/<ul /g) || []).length, 2);
  assert.match(html, /<em>italic<\/em>/);
  assert.match(html, /<del>Removed<\/del>/);
  assert.match(html, /a &lt; b/);
  assert.match(html, /&lt;not-html&gt;/);
  const plain = renderPlainText(value);
  assert.match(plain, /3\. Bold and italic\n  • nested item\n    • grandchild/);
  assert.match(plain, /4\. Removed and a < b/);
});

test('entities decode once for visible text and are escaped once for HTML', () => {
  const value = 'AT&amp;T &pound;50 &#163;60 &lt;shop&gt;';
  assert.equal(renderPlainText(value), 'AT&T £50 £60 <shop>');
  const html = renderEmailHtml(value);
  assert.match(html, /AT&amp;T £50 £60 &lt;shop&gt;/);
  assert.doesNotMatch(html, /&amp;amp;/);
});

test('raw HTML is inert rather than being inserted as markup', () => {
  const html = renderEmailHtml('<script>alert(1)</script>\n<img src=x onerror="alert(2)">\n<iframe src="https://example.invalid"></iframe>');
  assert.doesNotMatch(html, /<(?:script|img|iframe)\b/i);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&quot;alert\(2\)&quot;/);
});

test('unsafe and obfuscated destinations never become live email/chat links', () => {
  for (const url of ['javascript:alert(1)', 'java&#x73;cript:alert(1)', 'java&#9;script:alert(1)', 'vbscript:msgbox(1)', 'data:text/html,evil', 'file:///tmp/a', '//example.invalid/a', '/\\example.invalid/a', 'https://user:password@example.invalid/a']) {
    assert.equal(safeRichTextUrl(url), null, url);
    const html = renderEmailHtml(`[Safe label](${url})`);
    assert.doesNotMatch(html, /href=/, url);
  }
  assert.equal(safeRichTextUrl('/deals/123', { allowRelative: true }), '/deals/123');
  assert.equal(safeExportUrl('/deals/123'), null);
});

test('public links, mailto and balanced filename parentheses remain usable', () => {
  const html = renderEmailHtml('[Public](https://example.invalid/Folder(2)/report.pdf?q=a&b=c) [Email](mailto:hello@example.invalid)');
  assert.match(html, /href="https:\/\/example.invalid\/Folder\(2\)\/report.pdf\?q=a&amp;b=c"/);
  assert.match(html, /href="mailto:hello@example.invalid"/);
  assert.equal(renderPlainText('[Public](https://example.invalid/report)'), 'Public (https://example.invalid/report)');
});

test('private URLs and token variants never leave through either export format', () => {
  const destinations = [
    '/api/chat-media/report.pdf?token=CANARY',
    'https://bgp.invalid/api/chat-media/report.pdf?token=CANARY',
    'https://bgp.invalid/%61pi/chat-media/report.pdf?token=CANARY',
    'https://example.invalid/?%74oken=CANARY',
    'https://example.invalid/?ACCESS_TOKEN=CANARY',
    'https://example.invalid/?token=CANARY?x=1',
    'https://example.invalid/#/compose?access_token=CANARY',
    '/api?token=CANARY',
    '/%61%70%69/chat-media/report.pdf?token=CANARY',
    '//example.invalid/?token=CANARY',
    '/api/lr-bg/register/AB123?token=CANARY',
    '/api/lr-bg/register/AB123#ACCESS_TOKEN=CANARY',
    ...['X-Amz-Credential', 'X-Amz-Signature', 'X-Goog-Credential', 'X-Goog-Signature'].map(key => `https://storage.invalid/report.pdf?${key}=CANARY`),
  ];
  for (const destination of destinations) {
    for (const value of [`**[Report](${destination})**`, `[Report][file]\n\n[file]: ${destination}`, `![Report](${destination})`, destination, `<a href="${destination}">Report</a>`, `\`${destination}\``]) {
      for (const output of [renderEmailHtml(value), renderPlainText(value)]) {
        assert.doesNotMatch(output, /CANARY|\/api\/chat-media/, value);
      }
    }
  }
  for (const name of ['auth', 'authorization', 'api_key', 'key', 'signature', 'sig', 'downloadToken', 'session_token', 'X-Amz-Credential', 'X-Amz-Signature', 'X-Goog-Credential', 'X-Goog-Signature']) {
    assert.equal(safeExportUrl(`https://example.invalid/?${name}=CANARY`), null, name);
  }
  assert.equal(renderPlainText('£14/sq ft'), '£14/sq ft');
});

test('smart tags and existing download links retain chat tokens but export labels only', () => {
  const value = '@[Portman](tag:property/property-id) @[Folder](tag:folder/PRIVATE_FOLDER_ID)\n\n**[Workbook]\n(/api/chat-media/terms(1).xlsx)**\n\n/api/lr-bg/register/NGL813653';
  const tokens = parseRichText(value);
  assert.equal(tokens[0].tokens.filter(t => t.type === 'bgp_tag').length, 2);
  for (const output of [renderEmailHtml(value), renderPlainText(value)]) {
    assert.match(output, /Portman/);
    assert.match(output, /Workbook/);
    assert.match(output, /Download official register/);
    assert.doesNotMatch(output, /tag:|property-id|PRIVATE_FOLDER_ID|\/api\//);
  }
});

test('unfinished streaming tables remain readable without dropping rows', () => {
  for (const value of ['Use | Area', 'Use | Area\n--- |', 'Use | Area\n--- | ---\nPadel |']) {
    const html = renderEmailHtml(value);
    assert.match(html, /Use/);
    if (value.includes('Padel')) assert.match(html, /Padel/);
  }
});

test('extreme nesting degrades to inert readable text without throwing', () => {
  for (const depth of [100, 1500, 5000]) {
    const value = '> '.repeat(depth) + 'Retained content';
    assert.match(renderEmailHtml(value), /Retained content/);
    assert.match(renderPlainText(value), /Retained content/);
  }
});
