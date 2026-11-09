import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { find, evaluate, ts } = require('./source-harness.cjs');
const page = 'client/src/pages/chatbgp.tsx';
const fn = name => find(page, n => ts.isFunctionDeclaration(n) && n.name?.text === name);
const { classify } = evaluate(`${fn('isFailedChatResponse')}\nexport const classify = isFailedChatResponse;`);
const errorContent = find(page, n => ts.isVariableDeclaration(n) && n.name.getText() === 'errorContent');
const incomplete = find('server/chatbgp.ts', n => ts.isFunctionDeclaration(n) && n.name?.text === 'incompleteChatReply');
const { clientFailure, serverFailure } = evaluate(`export function clientFailure(msg: string) { const ${errorContent}; return errorContent; }\n${incomplete}\nexport const serverFailure = incompleteChatReply;`);

const completedFinancingAnswer = `Royal Exchange has an £8.3m facility, not a confirmed current debt balance.
Borrower: Royex Real Estate Investments Ltd; lender: Infinity HAGIM Lenwood RED II.
The insurance-security deed identifies NGL813653 on pages 5–6.
[Insurance-security deed](/api/companies-house/document/fixture?filename=Royex-Insurance-Security.pdf)
The knowledge-bank search timed out; the saved register was nevertheless retrieved.
The earlier register excludes pending registration changes.`;

test('a completed sourced financing answer is not a failed response because an ancillary search timed out', () => {
  assert.equal(classify({ role: 'assistant', content: completedFinancingAnswer }), false);
  for (const content of [
    "The first lookup couldn't process a scanned page; the filed deed confirms the facility on page 6.",
    'The earlier run ran into an issue. The saved source document is now available.',
    'The log says “Connection lost”; this lookup succeeded.',
    'If the AI service is busy, try again later. The requested register is already saved.',
  ]) assert.equal(classify({ role: 'assistant', content }), false, content);
});

test('actual client failure messages and server incomplete-response envelopes remain identifiable', () => {
  for (const reason of [
    'Request timed out after 5 minutes. Please try again.',
    'Connection lost — retrying...',
    'AI service is busy, please try again in a moment.',
    'No response received',
  ]) {
    assert.equal(classify({ role: 'assistant', content: clientFailure(reason) }), true);
    assert.equal(classify({ role: 'user', content: clientFailure(reason) }), false);
  }
  assert.equal(classify({ role: 'assistant', content: serverFailure('The chat run ended before a final answer was completed.') }), true);
  assert.equal(classify({ role: 'assistant', content: 'Failed to get AI response. Please try again.' }), true);
});

test('the actual message bubble keeps a completed answer neutral and only offers Retry for a failure', () => {
  const context = {
    exports: {}, React, useState: initial => [initial, () => {}],
    Sparkles: () => null, RotateCcw: () => null,
    ChatBGPMarkdown: ({ content }) => React.createElement('div', null, content),
  };
  vm.runInNewContext(ts.transpileModule(
    `${fn('splitContentParts')}\n${fn('isFailedChatResponse')}\n${fn('MessageBubble')}\nexport const Bubble = MessageBubble;`,
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } },
  ).outputText, context);
  const render = content => renderToStaticMarkup(React.createElement(context.exports.Bubble, {
    message: { role: 'assistant', content }, onRetry() {},
  }));
  const completed = render(completedFinancingAnswer);
  assert.match(completed, /text-foreground/);
  assert.doesNotMatch(completed, /text-destructive|button-retry/);
  assert.match(completed, /£8.3m/);
  const failure = render(clientFailure('Request timed out after 5 minutes. Please try again.'));
  assert.match(failure, /text-destructive/);
  assert.match(failure, /data-testid="button-retry"/);
});
