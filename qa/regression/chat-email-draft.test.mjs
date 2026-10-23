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

test('bold and italic greetings retain their original Markdown in editable drafts', () => {
  for (const greeting of ['**Hi Alex,**', '*Hi Alex,*', '__Hi__ Alex,', '_Hi_ Alex,', '***Hi Alex,***', '**Good** *morning* Alex,']) {
    const formattedBody = `${greeting}\n\nPlease review the picnic plan below.\n\nThanks,\nQA`;
    const result = extractChatEmailDraft(`Subject: Picnic plan\n\n${formattedBody}`);
    assert.equal(result?.bodyMarkdown, formattedBody, greeting);
  }
});

test('a saved edit remains a draft with a changed, removed or shortened greeting', () => {
  const before = 'Here is the draft.\n\n[Email draft edited by user.]';
  for (const editedBody of ['Alex,\n\nPlease review the picnic plan.\n\nThanks,\nQA', 'Please review the picnic plan.\n\nThanks,\nQA', 'Thanks!']) {
    const result = extractChatEmailDraft(`${before}\n\nSubject: Picnic plan\n\n${editedBody}`);
    assert.deepEqual(result, { subject: 'Picnic plan', bodyMarkdown: editedBody, before });
  }
});

test('only a standalone edit note immediately before the subject preserves draft status', () => {
  const withoutGreeting = 'Please review the picnic plan.\n\nThanks,\nQA';
  for (const before of [
    '> [Email draft edited by user.]',
    '`[Email draft edited by user.]`',
    '```text\n[Email draft edited by user.]\n```',
    '~~~text\n[Email draft edited by user.]\n~~~',
    '    [Email draft edited by user.]',
    'Example: [Email draft edited by user.]',
    '[Email draft edited by user.]\n\nHere is an unrelated subject example.',
  ]) assert.equal(extractChatEmailDraft(`${before}\n\nSubject: Example\n\n${withoutGreeting}`), null, before);
  assert.equal(extractChatEmailDraft(`Subject: Example\n\n${withoutGreeting}\n\n[Email draft edited by user.]`), null);
});

test('edit provenance does not accept empty, fenced or ambiguous drafts', () => {
  for (const content of [
    '[Email draft edited by user.]\n\nSubject: Example\n\n',
    '```text\n[Email draft edited by user.]\n\nSubject: Example\n\nPlease review the picnic plan.',
    '[Email draft edited by user.]\n\nSubject: First\n\nPlease review.\n\nSubject: Second\n\nPlease review again.',
  ]) assert.equal(extractChatEmailDraft(content), null);
});

test('formatting support does not turn quoted, code, linked or heading examples into greetings', () => {
  for (const greeting of ['> **Hi Alex,**', '`Hi Alex,`', '## Hi Alex,', '[Hi Alex,](https://example.com)', '- Hi Alex,', '**History** of this email']) {
    assert.equal(extractChatEmailDraft(`Subject: Example\n\n${greeting}\n\nThis is an example discussed in ordinary chat.`), null, greeting);
  }
});
