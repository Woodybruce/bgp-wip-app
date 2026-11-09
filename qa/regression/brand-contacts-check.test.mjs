import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { find, evaluate, ts } = require('./source-harness.cjs');
const { contactTier } = await import('../../shared/contact-tiers.ts');
const fn = find('server/brand-contacts-check.ts', node => ts.isFunctionDeclaration(node) && node.name?.text === 'contactsCheckPrompt');
const { contactsCheckPrompt } = evaluate(fn.replace(/^export /, '') + '\nexports.contactsCheckPrompt=contactsCheckPrompt;', { contactTier });

test('the contacts check sees each saved contact, their board status and BGP email history, plus unsaved senders', () => {
  const prompt = contactsCheckPrompt("Nando's", 'nandos.co.uk', [
    { id: 'm', name: 'Michael Gardner', role: 'Property Director', email: 'michaelg@nandos.co.uk' },
    { id: 'r', name: 'Nick Robinson', role: 'Regional Managing Director', email: 'nickr@nandos.co.uk' },
  ], [
    { email: 'michaelg@nandos.co.uk', threads: 4, last_touch: '2026-09-16T10:00:00Z' },
    { email: 'chris.pashley@nandos.co.uk', threads: 1, last_touch: '2026-07-09T08:00:00Z' },
  ]);
  assert.match(prompt, /id=m · Michael Gardner · Property Director · michaelg@nandos\.co\.uk · board: key \(property\) · BGP emails: 4 threads, last 2026-09-16/);
  assert.match(prompt, /id=r · Nick Robinson · Regional Managing Director .* board: hidden · BGP emails: none/);
  assert.match(prompt, /- chris\.pashley@nandos\.co\.uk · 1 threads/);
  assert.doesNotMatch(prompt, /- michaelg@nandos\.co\.uk · 4 threads/);
});
