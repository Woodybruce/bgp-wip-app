import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import React from 'react';
const require = createRequire(import.meta.url);
const { source, ts } = require('./source-harness.cjs');
const file = 'client/src/components/addin-agent-chat.tsx';
function nodes(node) { return Array.isArray(node) ? node.flatMap(nodes) : React.isValidElement(node) ? [node, ...nodes(node.props.children)] : []; }
function fixture(readDoc) {
  const ast = ts.createSourceFile(file, source(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declaration = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'AddinAgentChat');
  const state = [{ key: 'previous-safe-item', context: 'Old context', label: 'Previous email' }, [{ id: 'old', role: 'user', content: 'Old conversation' }], 'Summarise', false];
  let index = 0;
  const calls = [], tags = {};
  function visit(node) { if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && ts.isIdentifier(node.tagName)) tags[node.tagName.text] = node.tagName.text; ts.forEachChild(node, visit); }
  visit(declaration);
  const sandbox = { exports: {}, require, AbortController, TextDecoder, crypto: { randomUUID: () => 'test' }, ...tags,
    useState: initial => { const i = index++; if (i >= state.length) state[i] = initial; return [state[i], value => { state[i] = typeof value === 'function' ? value(state[i]) : value; }]; },
    useRef: value => ({ current: value }), useCallback: fn => fn, useEffect: () => {},
    fetch: async (url, init) => { calls.push({ url, init }); return new Response('data: {"reply":"Done"}\n\n'); },
  };
  vm.runInNewContext(ts.transpileModule(declaration.getText(ast), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, sandbox);
  const tree = sandbox.exports.AddinAgentChat({ host: 'outlook', token: 'synthetic', readDoc, runTool: async () => ({}), prompts: [], onUnauthorised: () => {} });
  return { calls, state, send: nodes(tree).find(node => node.type === 'Button' && node.props['aria-label'] === 'Send').props.onClick };
}

test('private and failed Outlook reads clear old conversation context and send nothing', async () => {
  for (const read of [async () => ({ key: '', context: '', label: 'Private item', unavailable: true }), async () => null, async () => { throw new Error('Unavailable'); }]) {
    const f = fixture(read);
    await f.send();
    assert.equal(f.calls.length, 0);
    assert.equal(f.state[1].length, 0);
    assert.equal(f.state[3], false);
    assert.notEqual(f.state[0]?.key, 'previous-safe-item');
  }
});

test('switching to a different safe Outlook item never sends the preceding conversation', async () => {
  const f = fixture(async () => ({ key: 'new-safe-item', context: 'Current context', label: 'Current email' }));
  await f.send();
  const body = JSON.parse(f.calls[0].init.body);
  assert.equal(body.workbookName, 'new-safe-item');
  assert.equal(body.excelContext, 'Current context');
  assert.deepEqual(body.messages, [{ role: 'user', content: 'Summarise' }]);
});
