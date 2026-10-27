import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import React from 'react';
const require = createRequire(import.meta.url);
const { source, ts } = require('./source-harness.cjs');
const nodes = node => Array.isArray(node) ? node.flatMap(nodes) : React.isValidElement(node) ? [node, ...nodes(node.props.children)] : [];
const text = node => Array.isArray(node) ? node.map(text).join(' ') : React.isValidElement(node) ? text(node.props.children) : node == null ? '' : String(node);
function load(file, bindings = {}, names) {
  const ast = ts.createSourceFile(file, source(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declarations = ast.statements.filter(node => !ts.isImportDeclaration(node) && (!names || ts.isFunctionDeclaration(node) && names.includes(node.name?.text)));
  const tags = {};
  function visit(node) { if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && ts.isIdentifier(node.tagName)) tags[node.tagName.text] = node.tagName.text; ts.forEachChild(node, visit); }
  declarations.forEach(visit);
  const script = declarations.map(node => node.getText(ast)).join('\n') + (names ? names.map(name => `\nexports.${name} = ${name};`).join('') : '');
  const sandbox = { exports: {}, require, Date, Set, ...tags, useState: value => [value, () => {}], ...bindings };
  vm.runInNewContext(ts.transpileModule(script, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, sandbox);
  return sandbox.exports;
}
const file = 'client/src/components/landlord-chat-bubble.tsx';
const msg = (userId, createdAt, role = 'user') => ({ id: userId + createdAt, userId, userName: userId === 'woody' ? 'Woody Bruce' : 'Nick', createdAt, role });

test('author colours are stable across roster order and resolve hash collisions for different people', () => {
  const app = load(file);
  const roster = ['Aa', 'BB', 'woody', 'nick', '__chatbgp__']; // Aa/BB share the same string hash.
  const colours = roster.slice(0, 4).map(id => app.landlordAuthorColour(id, 'user', roster));
  assert.equal(new Set(colours).size, 4);
  for (const id of roster.slice(0, 4)) assert.equal(app.landlordAuthorColour(id, 'user', roster), app.landlordAuthorColour(id, 'user', [...roster].reverse()));
  assert.equal(app.landlordAuthorColour('__chatbgp__', 'assistant', roster), 'text-primary');
  assert.equal(app.landlordAuthorColour(undefined), 'text-muted-foreground');
});

test('messages group only for a known same author within five minutes on the same London day', () => {
  const app = load(file);
  const prior = msg('nick', '2026-10-27T09:00:00Z');
  assert.equal(app.landlordMessagePresentation(msg('nick', '2026-10-27T09:04:00Z'), prior).grouped, true);
  assert.equal(app.landlordMessagePresentation(msg('nick', '2026-10-27T09:06:00Z'), prior).grouped, false);
  assert.equal(app.landlordMessagePresentation(msg('woody', '2026-10-27T09:04:00Z'), prior).grouped, false);
  assert.equal(app.landlordMessagePresentation(msg(null, '2026-10-27T09:04:00Z'), { ...prior, userId: null }).grouped, false);
  assert.equal(app.landlordMessagePresentation(msg('nick', '2026-07-15T23:01:00Z'), msg('nick', '2026-07-15T22:59:00Z')).grouped, false);
});

test('date separators and times use London time and never manufacture a missing timestamp', () => {
  const app = load(file);
  const result = app.landlordMessagePresentation(msg('nick', '2026-07-15T23:01:00Z'), undefined, new Date('2026-07-15T23:30:00Z'));
  assert.equal(result.dateLabel, 'Today');
  assert.equal(result.timeLabel, '00:01');
  const unknown = app.landlordMessagePresentation(msg('nick', undefined));
  assert.equal(unknown.dateLabel, null);
  assert.equal(unknown.timeLabel, null);
});

test('own bubbles align right with a pale fill, others left, names carry colour, and no read status is invented', () => {
  const app = load(file);
  const own = app.LandlordChatBubble({ message: msg('woody', '2026-10-27T09:00:00Z'), currentUserId: 'woody', children: 'The legacy deal continues.' });
  const other = app.LandlordChatBubble({ message: msg('nick', '2026-10-27T09:01:00Z'), currentUserId: 'woody', children: 'Meeting tomorrow.' });
  assert.match(nodes(own).find(node => node.props['data-testid'] === 'landlord-chat-message').props.className, /ml-auto justify-end/);
  assert.ok(nodes(own).some(node => node.props.className?.includes('bg-emerald-100/70') && node.props.className?.includes('dark:bg-emerald-950/60')));
  assert.ok(nodes(other).some(node => node.props.className?.includes('bg-stone-50') && node.props.className?.includes('dark:bg-stone-900')));
  assert.match(nodes(other).find(node => node.props['data-testid'] === 'landlord-chat-message').props.className, /mr-auto justify-start/);
  assert.equal(text(nodes(own).find(node => node.props['data-testid'] === 'landlord-chat-author')), 'You');
  assert.equal(text(nodes(other).find(node => node.props['data-testid'] === 'landlord-chat-author')), 'Nick');
  assert.match(nodes(other).find(node => node.props['data-testid'] === 'landlord-chat-author').props.className, /text-\w+-[78]00/);
  assert.doesNotMatch(text(own), /read|delivered|seen|✓/i);
  const unknown = app.LandlordChatBubble({ message: { role: 'user' }, currentUserId: 'woody', children: 'Unknown author' });
  assert.match(text(unknown), /Team member/);
  assert.doesNotMatch(text(unknown), /You/);
});

test('consecutive messages keep their timestamp but do not repeat sender labels or headshots', () => {
  const app = load(file);
  const grouped = app.LandlordChatBubble({ message: msg('nick', '2026-10-27T09:01:00Z'), previous: msg('nick', '2026-10-27T09:00:00Z'), photoUrl: '/nick.jpg', children: 'Second note' });
  assert.equal(nodes(grouped).some(node => node.props['data-testid'] === 'landlord-chat-author'), false);
  assert.equal(nodes(grouped).some(node => node.type === 'img'), false);
  assert.equal(nodes(grouped).filter(node => node.type === 'time').length, 1);
});

test('full chat styling requires the matching landlord company and never applies to Brands or general threads', () => {
  const app = load('client/src/components/chat-panel.tsx', { isLandlordCompany: (type, flag) => typeof flag === 'boolean' ? flag : /landlord/i.test(type || '') }, ['isLandlordLinkedConversation']);
  const thread = { isAiChat: false, linkedType: 'company', linkedId: 'aew' };
  const profile = { company: { id: 'aew', company_type: 'Landlord' }, isLandlord: true };
  assert.equal(app.isLandlordLinkedConversation(thread, profile), true);
  assert.equal(app.isLandlordLinkedConversation(thread, undefined), false);
  assert.equal(app.isLandlordLinkedConversation(thread, { company: { id: 'another', company_type: 'Landlord' }, isLandlord: true }), false);
  assert.equal(app.isLandlordLinkedConversation(thread, { company: { id: 'aew', company_type: 'Tenant - Retail' }, isLandlord: true }), false);
  assert.equal(app.isLandlordLinkedConversation({ ...thread, isAiChat: true }, profile), false);
  assert.equal(app.isLandlordLinkedConversation({ ...thread, linkedType: 'property' }, profile), false);
});

test('full landlord chat keeps rich content, attachments and action controls while default bubbles remain unchanged', () => {
  const app = load('client/src/components/chat-panel.tsx', { getNameColor: () => 'text-blue-600', isImageFile: () => false, isAudioFile: () => false }, ['MessageBubble']);
  const message = { ...msg('woody', '2026-10-27T09:00:00Z'), content: '**Legacy deal**', attachments: ['{"url":"/document.pdf","name":"Lease.pdf"}'] };
  const landlord = app.MessageBubble({ message, currentUserId: 'woody', threadId: 'aew-chat', landlord: true });
  assert.equal(landlord.type, 'LandlordChatBubble');
  assert.ok(nodes(landlord).some(node => node.type === 'ChatResponse' && node.props.content === '**Legacy deal**'));
  assert.ok(nodes(landlord).some(node => node.type === 'a' && node.props.href === '/document.pdf'));
  assert.ok(nodes(landlord.props.actions).some(node => node.props['data-testid'] === `button-message-actions-${message.id}`));
  const original = app.MessageBubble({ message, currentUserId: 'woody', threadId: 'brand-chat' });
  assert.equal(original.type, 'div');
  assert.ok(nodes(original).some(node => node.props.className?.includes('bg-gray-900 text-white rounded-br-sm')));
  assert.equal(nodes(original).some(node => node.type === 'LandlordChatBubble'), false);
});
