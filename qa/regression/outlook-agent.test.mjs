import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL ||= 'postgres://unused@localhost/unused';
const ok = (value) => (cb) => cb({ status: 'succeeded', value });
function fakeOutlook(mode) {
  const calls = [];
  const readItem = {
    subject: 'Brixton Village unit 12', from: { displayName: 'Trudie Samworth', emailAddress: 'trudie@generalprojects.com' },
    to: [{ displayName: 'Woody Bruce', emailAddress: 'woody@brucegillinghampollard.com' }], cc: [],
    dateTimeCreated: '2026-09-28T09:00:00Z', attachments: [{ name: 'plan.pdf' }], conversationId: 'conv-1',
    body: { getAsync: (_t, cb) => ok('Can we view on Thursday?')(cb) },
    displayReplyForm: (o) => calls.push(['reply', o]), displayReplyAllForm: (o) => calls.push(['replyAll', o]),
  };
  const composeItem = {
    subject: { getAsync: ok('Re: terms'), setAsync: (v, cb) => { calls.push(['subject', v]); ok()(cb); } },
    to: { getAsync: ok([]), addAsync: (v, cb) => { calls.push(['to', v]); ok()(cb); } },
    cc: { getAsync: ok([]), addAsync: (v, cb) => ok()(cb) },
    body: { getAsync: (_t, cb) => ok('draft')(cb), setSelectedDataAsync: (v, _o, cb) => { calls.push(['insert', v]); ok()(cb); }, setAsync: (v, _o, cb) => { calls.push(['replace', v]); ok()(cb); }, prependAsync: (v, _o, cb) => ok()(cb) },
  };
  globalThis.window = globalThis.window || globalThis;
  window.Office = { CoercionType: { Text: 'text', Html: 'html' }, context: { mailbox: {
    item: mode === 'read' ? readItem : composeItem,
    displayNewMessageForm: (o) => calls.push(['newMessage', o]),
    displayNewAppointmentForm: (o) => calls.push(['newMeeting', o]),
  } } };
  return calls;
}

const tools = await import('../../client/src/lib/outlook-agent-tools.ts');

test('reads the open email with sender, attachments and thread id', async () => {
  fakeOutlook('read');
  const e = await tools.readOpenEmail();
  assert.equal(e.mode, 'read');
  assert.equal(e.fromEmail, 'trudie@generalprojects.com');
  assert.deepEqual(e.attachments, ['plan.pdf']);
  assert.match(tools.emailContext(e), /Body:\nCan we view on Thursday\?/);
});

test('a reply opens Outlook\'s reply window with the draft — never sends', async () => {
  const calls = fakeOutlook('read');
  const r = await tools.runOutlookTool('outlook_draft_reply', { html: '<p>Thursday works.</p>', replyAll: true });
  assert.match(r.done, /reply-all/);
  assert.deepEqual(calls, [['replyAll', { htmlBody: '<p>Thursday works.</p>' }]]);
});

test('while composing, text goes into the message and subject/recipients can be set', async () => {
  const calls = fakeOutlook('compose');
  assert.equal(tools.isCompose(), true);
  await tools.runOutlookTool('outlook_write_compose', { html: '<p>Hi</p>', subject: 'Terms', to: ['a@b.com'] });
  assert.deepEqual(calls.map(c => c[0]), ['subject', 'to', 'insert']);
  const r = await tools.runOutlookTool('outlook_write_compose', { html: '<p>x</p>', mode: 'replace' });
  assert.ok(r.done);
});

test('compose-only tool refuses in read mode instead of failing silently', async () => {
  fakeOutlook('read');
  const r = await tools.runOutlookTool('outlook_write_compose', { html: '<p>x</p>' });
  assert.match(r.error, /isn't writing/);
});

test('server knows the Outlook tools and labels them', async () => {
  const agent = await import('../../server/outlook-agent.ts');
  assert.ok(agent.OUTLOOK_TOOL_NAMES.has('outlook_draft_reply'));
  assert.equal(agent.outlookToolLabel('outlook_new_meeting', {}), 'Opening a calendar invite…');
});
