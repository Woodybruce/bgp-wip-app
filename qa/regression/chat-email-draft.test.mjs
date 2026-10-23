import assert from 'node:assert/strict';
import test from 'node:test';
import { extractChatEmailDraft } from '../../shared/chat-email-draft.ts';

const body = `Dear Paul and Jamie,

Please find the initial leisure opportunities below.

Use | Area | Rent per sq ft pa | Potential tenants
--- | --- | --- | ---
Padel | 25,000 sq ft | £14 blended | Padium

Kind regards,
Woody`;

test('recognises a complete client email while keeping the introduction outside its body', () => {
  const result = extractChatEmailDraft(`Here is the draft for review.\n\nSubject: Thameside West — leisure opportunities\n\n${body}`);
  assert.ok(result);
  assert.equal(result.subject, 'Thameside West — leisure opportunities');
  assert.equal(result.before, 'Here is the draft for review.');
  assert.equal(result.bodyMarkdown, body);
});

test('recognises common subject emphasis/headings without carrying markers into the subject', () => {
  for (const heading of ['**Subject:** Thameside West', '**Subject: Thameside West**', '## Subject: Thameside West', 'subject: Thameside West']) {
    assert.equal(extractChatEmailDraft(`${heading}\n\n${body}`)?.subject, 'Thameside West', heading);
  }
});

test('normalises Windows newlines without changing the email content', () => {
  const result = extractChatEmailDraft(`Subject: Thameside West\r\n\r\n${body.replace(/\n/g, '\r\n')}`);
  assert.equal(result?.bodyMarkdown, body);
});

test('accepts the 200 character subject limit and rejects longer subjects', () => {
  assert.equal(extractChatEmailDraft(`Subject: ${'A'.repeat(200)}\n\n${body}`)?.subject.length, 200);
  assert.equal(extractChatEmailDraft(`Subject: ${'A'.repeat(201)}\n\n${body}`), null);
});

test('ordinary discussion, a missing greeting and incomplete drafts remain ordinary chat', () => {
  for (const value of [
    `I suggest the subject: Thameside West.\n\n${body}`,
    'Subject: Thameside West\n\nThis paragraph discusses which email to write next.',
    'Subject: Thameside West\n\nHi Paul,',
    'Subject: \n\nNotes only.',
    `> Subject: Thameside West\n> Dear Paul,\n> This is a quoted example and should not become a new draft.`,
  ]) assert.equal(extractChatEmailDraft(value), null, value);
});

test('fenced examples are not promoted to email drafts', () => {
  for (const [open, close] of [
    ['```text', '```'],
    ['~~~text', '~~~'],
    ['  ```text', '  ```'],
    ['  ~~~text', '  ~~~'],
    ['````text\n```', '```\n````'],
  ]) {
    const value = `${open}\nSubject: Example only\n\n${body}\n${close}`;
    assert.equal(extractChatEmailDraft(value), null, open);
  }
});

test('unclosed fenced content is never treated as a finished email', () => {
  for (const fence of ['```', '~~~', '  ```']) {
    assert.equal(extractChatEmailDraft(`${fence}\nSubject: Example\n\n${body}`), null, fence);
  }
});

test('two candidate email answers are not silently reduced to the first or last', () => {
  const value = `Subject: Version one\n\n${body}\n\nSubject: Version two\n\n${body}`;
  assert.equal(extractChatEmailDraft(value), null);
});

test('inline code inside a real email does not disable draft recognition', () => {
  const result = extractChatEmailDraft(`Subject: Reference check\n\n${body}\n\nThe reference is \`TSW-001\`.`);
  assert.ok(result);
  assert.match(result.bodyMarkdown, /`TSW-001`/);
});
