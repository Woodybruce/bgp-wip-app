import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import React from 'react';
const require = createRequire(import.meta.url);
const { source, ts } = require('./source-harness.cjs');
function nodes(node) { return Array.isArray(node) ? node.flatMap(nodes) : React.isValidElement(node) ? [node, ...nodes(node.props.children)] : []; }
function text(node) { return Array.isArray(node) ? node.map(text).join(' ') : React.isValidElement(node) ? text(node.props.children) : node == null ? '' : String(node); }
const panel = 'client/src/components/brand-profile-panel.tsx';
function component(name, bindings = {}, file = panel) {
  const ast = ts.createSourceFile(file, source(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declaration = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(declaration, name);
  const tags = {};
  function visit(node) { if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && ts.isIdentifier(node.tagName)) tags[node.tagName.text] = node.tagName.text; ts.forEachChild(node, visit); }
  visit(declaration);
  const sandbox = { exports: {}, require, Date, ...tags,
    useState: initial => [initial, () => {}], useRef: initial => ({ current: initial }), useEffect: () => {},
    useLocation: () => ['/', () => {}], useToast: () => ({}),
    TAG_TOKEN_SOURCE: '@\\[([^\\]]+)\\]\\(tag:(user|company|property|deal|unit|contact|folder)/([^)\\s]+)\\)',
    ...bindings };
  vm.runInNewContext(ts.transpileModule(declaration.getText(ast), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, sandbox);
  return sandbox.exports[name];
}
const messages = [
  { id: 'mine', role: 'user', userId: 'woody', content: 'The legacy deal continues.' },
  { id: 'nick-message', role: 'user', userId: 'nick', content: 'Meeting tomorrow.' },
  { id: 'reply', role: 'assistant', content: '**Dough T2** continues as a legacy deal.\n\n@[Dough T2](tag:deal/3629)' },
];
function chatFixture(landlord) {
  return component('CompanyMiniChat', {
    useQuery: ({ queryKey }) => ({ data: queryKey[0] === '/api/auth/me' ? { id: 'woody' }
      : queryKey[0] === '/api/users' ? [{ id: 'nick', name: 'Nick' }]
      : queryKey[0] === '/api/chat/threads' && queryKey.length === 2 ? { messages, members: [] }
      : [] }),
  })({ companyId: 'aew', companyName: 'AEW', landlord, fill: true, title: 'Landlord conversation' });
}

test('landlord chat renders rich text and shows real authors in readable directional bubbles', () => {
  const tree = chatFixture(true), all = nodes(tree);
  assert.match(tree.props.style.fontFamily, /sans-serif/);
  assert.equal(all.filter(node => node.type === 'ChatBGPMarkdown').length, 3);
  const bubbles = all.filter(node => node.type === 'LandlordChatBubble');
  assert.equal(bubbles.length, 3);
  assert.equal(bubbles[0].props.currentUserId, 'woody');
  assert.equal(bubbles[0].props.message.userId, 'woody');
  assert.equal(bubbles[1].props.message.userName, 'Nick');
  assert.equal(bubbles[1].props.previous.id, 'mine');
  const markdown = nodes(bubbles[2]).find(node => node.type === 'ChatBGPMarkdown');
  assert.equal(markdown.props.content, messages[2].content);
});

test('Brand mini-chat keeps its existing typography, alignment and tag renderer', () => {
  const tree = chatFixture(false), all = nodes(tree);
  assert.equal(tree.props.style, undefined);
  assert.equal(all.some(node => node.type === 'ChatBGPMarkdown'), false);
  assert.equal(all.some(node => node.props['data-testid'] === 'landlord-chat-message'), false);
  const bubbles = all.filter(node => node.props.className?.includes('group/msg relative'));
  assert.match(bubbles[1].props.className, /text-xs rounded-lg/);
  assert.match(bubbles[1].props.className, /ml-6/);
  assert.equal(all.filter(node => node.type === 'TagChip').length, 1);
  assert.match(text(tree), /\*\*Dough T2\*\*/);
});

test('only landlord starters gain the meetings question', () => {
  const topics = component('askTopics');
  assert.equal(topics('AEW', true)[0].label, 'Meetings');
  assert.match(topics('AEW', true)[0].question, /linked calendar invitations/);
  for (const args of [['Brand'], ['Agent', false, true], ['Lender', false, false, true]]) {
    assert.equal(topics(...args).some(topic => topic.label === 'Meetings'), false);
    assert.equal(topics(...args)[0].label, 'Overview');
  }
});

test('landlord profile and chat lead the page, with staff meeting/team brief and interview notes immediately below', () => {
  const ast = ts.createSourceFile(panel, source(panel), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let branch;
  function visit(node) { if (ts.isIfStatement(node) && node.expression.getText(ast) === 'isLandlord && flat && !isLender') branch = node; ts.forEachChild(node, visit); }
  visit(ast);
  assert.ok(branch);
  const code = branch.getText(ast);
  assert.match(code, /leading=\{!isClientViewer &&/);
  assert.match(code, /<LandlordMeetingsSummary/);
  assert.match(code, /!isClientViewer && <LandlordInterviewNotes/);
  assert.match(code, /footer=\{!isClientViewer && <LandlordRelationshipTeam/);
  assert.ok(code.indexOf('{profileTopRow}') < code.indexOf('landlord-relationship-brief'));
  assert.ok(code.indexOf('landlord-relationship-brief') < code.indexOf('<LandlordInterviewNotes'));
  assert.ok(code.indexOf('<LandlordInterviewNotes') < code.indexOf('<CompanyPropertiesBoard'));
  assert.equal((code.match(/\{profileTopRow\}/g) || []).length, 1);
  assert.ok(source(panel).includes('{!(isLandlord && flat && !isLender) && relationshipSummary}'));
});

test('landlord chat refreshes its brief only on changed human content, without polling loops or Brand invalidation', () => {
  function render(landlord, rows) {
    const effects = [], invalidations = [];
    component('CompanyMiniChat', {
      useEffect: (callback, deps) => effects.push({ callback, deps }),
      queryClient: { invalidateQueries: options => invalidations.push(options) },
      useQuery: ({ queryKey }) => ({ data: queryKey[0] === '/api/auth/me' ? { id: 'woody' }
        : queryKey[0] === '/api/users' ? []
        : queryKey[0] === '/api/chat/threads' && queryKey.length === 2 ? { messages: rows, members: [] } : [] }),
    })({ companyId: 'aew', companyName: 'AEW', landlord });
    const effect = effects.find(effect => effect.deps[0] === landlord && effect.deps[1] === 'aew' && effect.deps.length === 4);
    assert.ok(effect);
    effect.callback();
    return { deps: Array.from(effect.deps), invalidations };
  }
  const first = render(true, messages);
  assert.deepEqual(Array.from(first.invalidations[0].queryKey), ['/api/brand', 'aew', 'ai-take']);
  assert.deepEqual(render(true, messages.map(message => ({ ...message }))).deps, first.deps);
  assert.deepEqual(render(true, messages.map(message => message.role === 'assistant' ? { ...message, content: 'New AI reply' } : message)).deps, first.deps);
  assert.notDeepEqual(render(true, messages.map(message => message.id === 'mine' ? { ...message, content: 'Corrected human statement' } : message)).deps, first.deps);
  assert.notDeepEqual(render(true, messages.filter(message => message.id !== 'mine')).deps, first.deps);
  assert.deepEqual(render(false, messages).invalidations, []);
});
