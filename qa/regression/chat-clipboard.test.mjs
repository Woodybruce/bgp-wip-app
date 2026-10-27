import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { renderEmailHtml, renderPlainText } from '../../shared/chat-rich-text.ts';
const require = createRequire(import.meta.url);
const { source, ts } = require('./source-harness.cjs');
const ast = ts.createSourceFile('chat-clipboard.ts', source('client/src/lib/chat-clipboard.ts'), ts.ScriptTarget.Latest, true);
const code = ast.statements.filter(n => !ts.isImportDeclaration(n)).map(n => n.getText(ast)).join('\n');
const compiled = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

const markdown = `Dear Paul,

**Leisure assumptions**

Use | Rent
--- | ---
Padel | £14 per sq ft

[Private file](/api/chat-media/brief.pdf?token=CANARY)

Kind regards,
Woody`;

function setup(options = {}) {
  const state = { writes: [], plainWrites: [], nodes: [], ranges: [], copiedHtml: null, execCalls: 0, focusCalls: [], calls: [] };
  const oldRanges = [0, 1].map(id => ({ id, cloneRange() { return { id: `clone-${id}` }; } }));
  state.ranges = [...oldRanges];
  const selection = {
    get rangeCount() { return state.ranges.length; },
    getRangeAt: index => state.ranges[index],
    removeAllRanges() { state.calls.push('clear-selection'); state.ranges = []; },
    addRange(range) { state.calls.push('select-range'); state.ranges.push(range); },
  };
  const document = {
    activeElement: { focus(value) { state.focusCalls.push(value); } },
    createElement(tag) {
      assert.equal(tag, 'div');
      const node = { contentEditable: '', style: { cssText: '' }, innerHTML: '', remove() { state.nodes = state.nodes.filter(value => value !== node); state.calls.push('remove'); } };
      return node;
    },
    body: { append(node) { state.calls.push('append'); state.nodes.push(node); } },
    createRange() {
      return { selectNodeContents(node) { this.node = node; state.calls.push('select-contents'); } };
    },
    execCommand(command) {
      assert.equal(command, 'copy');
      state.execCalls++;
      state.copiedHtml = state.ranges.find(range => range.node)?.node.innerHTML ?? null;
      if (options.execThrows) throw new Error('Legacy clipboard denied');
      return options.execResult ?? false;
    },
  };
  const clipboard = {};
  if (options.richWrite !== false) clipboard.write = async items => {
    state.writes.push(items);
    if (options.writeHook) await options.writeHook(items);
    if (options.richReject) throw new Error('Rich clipboard denied');
  };
  if (options.plainWrite !== false) clipboard.writeText = async text => {
    state.plainWrites.push(text);
    if (options.plainReject) throw new Error('Plain clipboard denied');
  };
  class ClipboardItemMock {
    constructor(data) { this.data = data; this.types = Object.keys(data); }
    async getType(type) { return this.data[type]; }
  }
  const context = {
    exports: {}, renderEmailHtml, renderPlainText, Blob,
    navigator: { clipboard: options.noClipboard ? undefined : clipboard },
    ClipboardItem: options.noClipboardItem ? undefined : ClipboardItemMock,
    document, window: { getSelection: () => options.noSelection ? null : selection },
  };
  vm.runInNewContext(compiled, context);
  return { copy: context.exports.copyChatContent, state };
}

test('formatted copy writes clean HTML and readable plain text together', async () => {
  const { copy, state } = setup();
  assert.equal(await copy(markdown), 'formatted');
  assert.equal(state.writes.length, 1);
  const [item] = state.writes[0];
  assert.deepEqual(item.types.sort(), ['text/html', 'text/plain']);
  const html = await (await item.getType('text/html')).text();
  const plain = await (await item.getType('text/plain')).text();
  assert.match(html, /<table\b/);
  assert.match(html, /<strong>Leisure assumptions<\/strong>/);
  assert.doesNotMatch(html, /class=|chatbgp|bg-muted|CANARY|\/api\/chat-media/);
  assert.match(plain, /Use\tRent\nPadel\t£14 per sq ft/);
  assert.doesNotMatch(plain, /\*\*|CANARY|\/api\/chat-media/);
  assert.equal(state.execCalls, 0);
  assert.equal(state.plainWrites.length, 0);
  assert.equal(state.nodes.length, 0);
});

test('copy does not report success while a clipboard write is still pending', async () => {
  let finish;
  const pending = new Promise(resolve => { finish = resolve; });
  const { copy, state } = setup({ writeHook: () => pending });
  let settled = false;
  const result = copy(markdown).then(value => { settled = true; return value; });
  await Promise.resolve();
  assert.equal(settled, false);
  finish();
  assert.equal(await result, 'formatted');
  assert.equal(state.execCalls, 0);
});

test('explicit plain copy skips rich writes and copies the readable alternative', async () => {
  const { copy, state } = setup();
  assert.equal(await copy(markdown, false), 'plain');
  assert.equal(state.writes.length, 0);
  assert.equal(state.execCalls, 0);
  assert.equal(state.plainWrites.length, 1);
  assert.equal(state.plainWrites[0], renderPlainText(markdown));
});

test('a denied rich write falls back to an isolated rich selection and restores focus/selection', async () => {
  const { copy, state } = setup({ richReject: true, execResult: true });
  assert.equal(await copy(markdown), 'formatted');
  assert.equal(state.execCalls, 1);
  assert.match(state.copiedHtml, /<table\b/);
  assert.doesNotMatch(state.copiedHtml, /class=|CANARY|bg-muted/);
  assert.equal(state.nodes.length, 0);
  assert.deepEqual(state.ranges.map(range => range.id), ['clone-0', 'clone-1']);
  assert.equal(state.focusCalls.length, 1);
  assert.equal(state.focusCalls[0].preventScroll, true);
  assert.equal(state.plainWrites.length, 0);
});

test('missing ClipboardItem uses the selection fallback without invoking rich write', async () => {
  const { copy, state } = setup({ noClipboardItem: true, execResult: true });
  assert.equal(await copy(markdown), 'formatted');
  assert.equal(state.writes.length, 0);
  assert.equal(state.execCalls, 1);
});

test('failed rich methods return plain status only after the plain write succeeds', async () => {
  const { copy, state } = setup({ richReject: true, execResult: false });
  assert.equal(await copy(markdown), 'plain');
  assert.equal(state.execCalls, 1);
  assert.equal(state.plainWrites[0], renderPlainText(markdown));
  assert.equal(state.nodes.length, 0);
  assert.deepEqual(state.ranges.map(range => range.id), ['clone-0', 'clone-1']);
});

test('a throwing legacy copy cleans up and still permits a plain clipboard fallback', async () => {
  const { copy, state } = setup({ richReject: true, execThrows: true });
  assert.equal(await copy(markdown), 'plain');
  assert.equal(state.nodes.length, 0);
  assert.deepEqual(state.ranges.map(range => range.id), ['clone-0', 'clone-1']);
  assert.equal(state.focusCalls.length, 1);
  assert.equal(state.plainWrites.length, 1);
});

test('a missing selection cannot produce a misleading formatted success', async () => {
  const { copy, state } = setup({ richReject: true, noSelection: true, execResult: true });
  assert.equal(await copy(markdown), 'plain');
  assert.equal(state.execCalls, 0);
  assert.equal(state.nodes.length, 0);
  assert.equal(state.plainWrites.length, 1);
});

test('plain clipboard denial rejects instead of returning a success result', async () => {
  const { copy, state } = setup({ richReject: true, execResult: false, plainReject: true });
  await assert.rejects(copy(markdown), /Plain clipboard denied/);
  assert.equal(state.nodes.length, 0);
});

test('no available copy method reports a clear failure without leaving a hidden editor', async () => {
  const { copy, state } = setup({ noClipboard: true, execResult: false });
  await assert.rejects(copy(markdown), /Copy is unavailable/);
  assert.equal(state.nodes.length, 0);
  assert.deepEqual(state.ranges.map(range => range.id), ['clone-0', 'clone-1']);
});
