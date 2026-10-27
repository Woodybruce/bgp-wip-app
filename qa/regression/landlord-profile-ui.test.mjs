import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import React from 'react';
import { landlordConfirmedCrmAction, landlordCrmActionQueryKeys } from '../../client/src/lib/landlord-chat-actions.ts';
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
  const sandbox = { exports: {}, require, Date, landlordConfirmedCrmAction, landlordCrmActionQueryKeys, ...tags,
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

test('only Landlord top row puts chat first on phones and retains profile-left desktop columns', () => {
  const ast = ts.createSourceFile(panel, source(panel), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let declaration;
  function visit(node) { if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'profileTopRow') declaration = node; ts.forEachChild(node, visit); }
  visit(ast);
  const render = (isLandlord, isLender) => {
    const sandbox = { exports: {}, require, isLandlord, isLender, editing: false, header: 'Profile', topInfo: 'Facts', aboutBody: 'About', data: {}, conversationSlot: null, conversationBoard: React.createElement('section', { 'data-testid': 'chat' }) };
    vm.runInNewContext(ts.transpileModule(`const ${declaration.getText(ast)}; exports.row = profileTopRow;`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, sandbox);
    return sandbox.exports.row;
  };
  const landlord = render(true, false);
  assert.match(landlord.props.className, /flex flex-col-reverse gap-3/);
  assert.match(landlord.props.className, /\[@container\(min-width:900px\)\]:grid /);
  assert.match(landlord.props.className, /\[@container\(min-width:900px\)\]:grid-cols-2/);
  const columns = React.Children.toArray(landlord.props.children);
  assert.ok(nodes(columns[0]).some(node => node.props['data-testid'] === 'brand-profile-card'));
  assert.ok(nodes(columns[1]).some(node => node.props['data-testid'] === 'chat'));
  assert.doesNotMatch(columns[1].props.className, /pt-3/);
  for (const flags of [[false, false], [true, true]]) {
    const other = render(...flags);
    assert.doesNotMatch(other.props.className, /flex-col-reverse/);
    assert.equal(React.Children.toArray(other.props.children)[1].props.className, 'pt-3');
  }
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

const savedRequirement = {
  id: 'saved-reply', role: 'assistant', content: 'Saved the investment requirement.',
  actionData: JSON.stringify({ type: 'crm_created', entityType: 'requirement', id: 'req-123', companyId: 'aew', category: 'Investment', success: true, url: '/requirements?type=investment&requirementId=req-123' }),
};

test('only a successful server mutation for this Landlord becomes a saved-record action', () => {
  const action = landlordConfirmedCrmAction(savedRequirement, 'aew');
  assert.equal(action.href, '/requirements?type=investment&requirementId=req-123');
  assert.equal(action.requirementType, 'investment');
  const receipt = JSON.parse(savedRequirement.actionData);
  for (const changes of [
    { success: false }, { success: undefined }, { companyId: 'other-landlord' }, { companyId: undefined },
    { type: 'pending' }, { entityType: 'unknown' }, { requiresConfirmation: true }, { id: '' },
  ]) assert.equal(landlordConfirmedCrmAction({ ...savedRequirement, actionData: { ...receipt, ...changes } }, 'aew'), null);
  assert.equal(landlordConfirmedCrmAction({ ...savedRequirement, role: 'user' }, 'aew'), null);
  assert.equal(landlordConfirmedCrmAction({ ...savedRequirement, actionData: 'broken-json' }, 'aew'), null);
  assert.equal(landlordConfirmedCrmAction({ id: 'no-receipt', role: 'assistant', content: 'Saved it.' }, 'aew'), null);
  const maliciousUrl = landlordConfirmedCrmAction({ ...savedRequirement, actionData: { ...receipt, url: 'https://outside.example/steal' } }, 'aew');
  assert.equal(maliciousUrl.href, action.href, 'record links are built locally from the confirmed ID, never arbitrary action URLs');
  const keys = landlordCrmActionQueryKeys('aew', action);
  assert.ok(keys.some(key => JSON.stringify(key) === JSON.stringify(['/api/accounts', 'aew', 'teams'])));
  assert.ok(keys.some(key => key[0] === '/api/crm/requirements-investment'));
  assert.equal(keys.some(key => key[0] === '/api/crm/requirements-leasing'), false);
});

test('Landlord chat refreshes confirmed records once across polling and links the saved requirement; Brands do neither', () => {
  const refs = [], invalidations = [];
  let refIndex = 0, effects = [], rows = [savedRequirement];
  const renderChat = component('CompanyMiniChat', {
    useRef: initial => refs[refIndex++] ||= { current: initial },
    useEffect: (callback, deps) => effects.push({ callback, deps }),
    queryClient: { invalidateQueries: options => invalidations.push(options) },
    useQuery: ({ queryKey }) => ({ data: queryKey[0] === '/api/auth/me' ? { id: 'woody' }
      : queryKey[0] === '/api/users' ? []
      : queryKey[0] === '/api/chat/threads' && queryKey.length === 2 ? { id: 'thread-aew', messages: rows, members: [] } : [] }),
  });
  function render(landlord = true) {
    refIndex = 0; effects = [];
    const tree = renderChat({ companyId: 'aew', companyName: 'AEW', landlord });
    const actionEffect = effects.find(effect => effect.deps?.length === 5 && effect.deps[1] === 'aew');
    assert.ok(actionEffect, 'receipt refresh effect is present');
    actionEffect.callback();
    return tree;
  }
  const first = render();
  const links = nodes(first).filter(node => node.props['data-testid'] === 'landlord-chat-record-link');
  assert.equal(links.length, 1);
  assert.equal(links[0].props.href, '/requirements?type=investment&requirementId=req-123');
  assert.equal(text(links[0]), 'Open  investment  requirement');
  const count = invalidations.length;
  assert.ok(count >= 5);
  rows = rows.map(row => ({ ...row, content: 'Updated explanation only.' }));
  render();
  assert.equal(invalidations.length, count, 'polling/fresh message objects and explanation edits do not repeat refreshes');
  rows.push({ id: 'claims-only', role: 'assistant', content: 'Saved another requirement.' });
  render();
  assert.equal(invalidations.length, count, 'prose cannot trigger a saved-action refresh');
  rows.push({ ...savedRequirement, id: 'updated-reply', actionData: { ...JSON.parse(savedRequirement.actionData), type: 'crm_updated' } });
  render();
  assert.ok(invalidations.length > count, 'a newly confirmed update refreshes the board');
  const beforeBrand = invalidations.length;
  const brand = render(false);
  assert.equal(invalidations.length, beforeBrand);
  assert.equal(nodes(brand).some(node => node.props['data-testid'] === 'landlord-chat-record-link'), false);
});

test('weekly Landlord meetings live only in CRM Meetings, without removing company meeting history', () => {
  assert.doesNotMatch(source('client/src/pages/people.tsx'), /LandlordWeeklyMeetings/);
  assert.match(source('client/src/components/crm-meetings-tab.tsx'), /<LandlordWeeklyMeetings\s*\/>/);
  assert.match(source(panel), /<LandlordMeetingsSummary/);
});

test('navigating between Landlords hides the old thread immediately and clears the old draft/context', () => {
  const states = [], refs = [], queries = [];
  let stateIndex = 0, refIndex = 0, effects = [];
  const renderChat = component('CompanyMiniChat', {
    useState: initial => {
      const index = stateIndex++;
      if (!(index in states)) states[index] = initial;
      return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value; }];
    },
    useRef: initial => refs[refIndex++] ||= { current: initial },
    useEffect: (callback, deps) => effects.push({ callback, deps }),
    useQuery: options => {
      const { queryKey } = options;
      queries.push(options);
      if (queryKey[0] === '/api/auth/me') return { data: { id: 'woody' } };
      if (queryKey[0] === '/api/chat/threads' && queryKey.length === 1) return { data: [
        { id: 'thread-aew', linkedId: 'aew', hasAiMember: true },
        { id: 'thread-landsec', linkedId: 'landsec', hasAiMember: true },
      ] };
      if (queryKey[0] === '/api/chat/threads' && queryKey[1]) return { data: { id: queryKey[1], members: [], messages: [{ id: 'message', role: 'assistant', content: queryKey[1] }] } };
      return { data: [] };
    },
  });
  function render(companyId) {
    stateIndex = 0; refIndex = 0; effects = []; queries.length = 0;
    return renderChat({ companyId, companyName: companyId, landlord: true });
  }
  render('aew');
  effects[0].callback(); // resolve the linked company thread
  let tree = render('aew');
  assert.ok(nodes(tree).some(node => node.type === 'ChatBGPMarkdown' && node.props.content === 'thread-aew'));
  states[1] = 'An unsent AEW requirement';
  tree = render('landsec');
  assert.equal(nodes(tree).some(node => node.type === 'ChatBGPMarkdown'), false, 'old company messages are hidden before effects run');
  const threadQuery = queries.find(query => query.queryKey[0] === '/api/chat/threads' && query.queryKey.length === 2);
  assert.equal(threadQuery.enabled, false);
  assert.equal(threadQuery.queryKey[1], null);
  effects.find(effect => effect.deps?.length === 2 && effect.deps[0] === true && effect.deps[1] === 'landsec').callback();
  assert.equal(states[1], '', 'draft is not carried into another Landlord');
  effects[0].callback();
  tree = render('landsec');
  assert.ok(nodes(tree).some(node => node.type === 'ChatBGPMarkdown' && node.props.content === 'thread-landsec'));
});
