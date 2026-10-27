import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { find, evaluate, ts } = require('./source-harness.cjs');
const file = 'server/brand-email-threads.ts';
const decl = name => find(file, node => (ts.isVariableStatement(node) && node.declarationList.declarations.some(d => d.name.getText() === name))
  || (ts.isFunctionDeclaration(node) && node.name?.text === name));
const src = ['BGP_DOMAIN', 'normSubject', 'cleanPreview', 'personList', 'groupEmailConversations', 'nameFromEmail', 'emailSummaryPrompt'].map(decl).join('\n')
  .replace(/^export /gm, '') + '\nexports.groupEmailConversations=groupEmailConversations;exports.emailSummaryPrompt=emailSummaryPrompt;';
const { groupEmailConversations, emailSummaryPrompt } = evaluate(src);

const hg = ['rupert@brucegillinghampollard.com', 'david.menendez@honestgreens.com', 'rasmus@honestgreens.com', 'richard@etchgroup.com'];
const rows = [
  { subject: 'RE: Canary Wharf - Hg (access)', bgp_user: 'rupert@brucegillinghampollard.com', preview: 'Thanks Marissa,\r\n\r\nCallum will update our strip out specs.\r\n\r\nFrom: Marisa', participants: hg, interaction_date: '2026-07-16T14:11:18Z' },
  { subject: 'Canary Wharf - Hg (access)', bgp_user: 'rupert@brucegillinghampollard.com', preview: 'Hi Rupert', participants: hg, interaction_date: '2026-07-10T09:00:00Z' },
  { subject: 'FW: Heads of terms', bgp_user: 'charlotte@brucegillinghampollard.com', preview: 'Attached', participants: ['david.menendez@honestgreens.com'], interaction_date: '2026-05-01T09:00:00Z' },
];

test('emails group into conversations with BGP, brand and other parties split out', () => {
  const convs = groupEmailConversations(rows, 'honestgreens.com');
  assert.equal(convs.length, 2);
  const cw = convs[0];
  assert.equal(cw.subject, 'Canary Wharf - Hg (access)');
  assert.equal(cw.messages, 2);
  assert.equal(cw.first, '2026-07-10T09:00:00.000Z');
  assert.equal(cw.last, '2026-07-16T14:11:18.000Z');
  assert.deepEqual([...cw.bgp], ['rupert@brucegillinghampollard.com']);
  assert.deepEqual([...cw.brand].sort(), ['david.menendez@honestgreens.com', 'rasmus@honestgreens.com']);
  assert.deepEqual([...cw.others], ['richard@etchgroup.com']);
  assert.equal(cw.preview, 'Thanks Marissa, Callum will update our strip out specs.');
  assert.equal(convs[1].subject, 'Heads of terms');
  assert.deepEqual([...convs[1].bgp], ['charlotte@brucegillinghampollard.com']);
});

test('summary prompt names people and copied firms from the conversations', () => {
  const prompt = emailSummaryPrompt('Honest Greens', groupEmailConversations(rows, 'honestgreens.com'));
  assert.match(prompt, /"Canary Wharf - Hg \(access\)" · 2 msg/);
  assert.match(prompt, /BGP: Rupert · Honest Greens: (David Menendez, Rasmus|Rasmus, David Menendez)/);
  assert.match(prompt, /other people: Richard \(etchgroup\.com\)/);
  assert.match(prompt, /sender not recorded/);
});


test('Landlord email grouping accepts exact contacts and genuine subdomains without changing Brand grouping', () => {
  const people = ['nick@brucegillinghampollard.com', 'manish@eu.aew.com', 'other@notaew.com', 'known@agency.test'];
  const rows = [{ subject: 'Catch up', participants: people, interaction_date: '2026-10-27T11:00:00Z' }];
  const landlord = groupEmailConversations(rows, 'aew.com', new Set(['known@agency.test']), ['aew.com'])[0];
  assert.deepEqual([...landlord.brand].sort(), ['known@agency.test', 'manish@eu.aew.com']);
  assert.deepEqual([...landlord.others], ['other@notaew.com']);
  const brand = groupEmailConversations(rows, 'aew.com')[0];
  assert.deepEqual([...brand.brand], []);
  assert.equal(brand.others.length, 3);
});
