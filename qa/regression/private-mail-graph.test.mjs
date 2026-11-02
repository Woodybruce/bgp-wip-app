import test from 'node:test';
import assert from 'node:assert/strict';
import { isPrivateMailboxAddress, isPrivateEmailRecord, PRIVATE_MAILBOX } from '../../server/private-mail.ts';
import { privateMailGraphFetch } from '../../server/private-mail-graph.ts';

const base = 'https://graph.microsoft.com/v1.0';
const person = address => ({ emailAddress: { address, name: address.split('@')[0] } });
const message = (id = 'safe', extra = {}) => ({ id, subject: 'Normal work', from: person('client@example.test'), sender: person('client@example.test'), toRecipients: [person('staff@example.test')], ccRecipients: [], bccRecipients: [], internetMessageId: `<${id}@example.test>`, ...extra });
const event = (id = 'safe', extra = {}) => ({ id, subject: 'Portfolio meeting', organizer: person('client@example.test'), attendees: [person('staff@example.test')], ...extra });
const json = (data, init) => new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' }, ...init });
function fixture(reply, lookup, observer) {
  const calls = [];
  const fetch = privateMailGraphFetch(async (input, init) => {
    calls.push({ url: new URL(input instanceof Request ? input.url : String(input)), init });
    return typeof reply === 'function' ? reply(calls.at(-1), calls.length) : json(reply);
  }, lookup, observer);
  return { fetch, calls };
}

test('private address detection handles real metadata shapes and avoids unrelated text/similar domains', () => {
  for (const value of [PRIVATE_MAILBOX, `Equity <${PRIVATE_MAILBOX}>`, `(${PRIVATE_MAILBOX})`, PRIVATE_MAILBOX.toUpperCase(), 'equity+deal@brucegillinghampollard.com']) assert.equal(isPrivateMailboxAddress(value), true, value);
  for (const value of ['notequity@brucegillinghampollard.com', 'equity@brucegillinghampollard.com.example.test', 'equity@example.test']) assert.equal(isPrivateMailboxAddress(value), false, value);
  for (const key of ['senderEmail', 'from_email', 'mailbox_email', 'toRecipients', 'ccRecipients', 'bccRecipients', 'organizer', 'attendees', 'bgpParticipants']) assert.equal(isPrivateEmailRecord({ [key]: [person(PRIVATE_MAILBOX)] }), true, key);
  assert.equal(isPrivateEmailRecord({ participants: JSON.stringify({ optional: [{ email: PRIVATE_MAILBOX }] }) }), true);
  assert.equal(isPrivateEmailRecord({ participants: { [PRIVATE_MAILBOX]: { name: 'Equity' } } }), true);
  assert.equal(isPrivateEmailRecord({ body: `Contact ${PRIVATE_MAILBOX}`, subject: PRIVATE_MAILBOX }), false);
  const circular = {}; circular.self = circular;
  assert.equal(isPrivateEmailRecord({ participants: circular }), false);
});

test('safe narrow message selections keep data and gain every recipient field', async () => {
  const f = fixture(message());
  const result = await f.fetch(`${base}/me/messages/safe?$select=subject,body`);
  assert.equal(result.status, 200);
  assert.equal((await result.json()).subject, 'Normal work');
  const select = f.calls[0].url.searchParams.get('$select').split(',');
  for (const field of ['subject', 'body', 'from', 'sender', 'toRecipients', 'ccRecipients', 'bccRecipients', 'internetMessageId']) assert.ok(select.includes(field), field);
});

test('private mailboxes and anchor headers are denied before network reads', async () => {
  const f = fixture(message());
  assert.equal((await f.fetch(`${base}/users/${encodeURIComponent(PRIVATE_MAILBOX)}/messages`)).status, 404);
  assert.equal((await f.fetch(`${base}/me/messages`, { headers: { 'X-AnchorMailbox': PRIVATE_MAILBOX } })).status, 404);
  assert.equal(f.calls.length, 0);
});

test('mail list and delta exclude private copies in every participant field and suppress total counts', async () => {
  const privateRows = ['from', 'sender', 'toRecipients', 'ccRecipients', 'bccRecipients'].map((key, i) => message(`private-${i}`, { [key]: key.endsWith('Recipients') ? [person(PRIVATE_MAILBOX)] : person(PRIVATE_MAILBOX) }));
  for (const path of ['/me/messages', '/users/staff%40example.test/mailFolders/inbox/messages/delta']) {
    const f = fixture({ value: [message(), ...privateRows, { subject: 'metadata missing' }], '@odata.count': 7, '@odata.nextLink': `${base}/me/messages?$skip=7` });
    const result = await (await f.fetch(base + path)).json();
    assert.deepEqual(result.value.map(row => row.id), ['safe']);
    assert.equal(result['@odata.count'], undefined);
    assert.ok(result['@odata.nextLink']);
  }
});

test('malformed or incomplete direct message metadata is not treated as safe', async () => {
  for (const data of [null, [], {}, { value: [] }, message('bad', { bccRecipients: undefined }), message('bad', { ccRecipients: [null] }), message('bad', { from: 'sender@example.test' })]) {
    assert.equal((await fixture(data).fetch(`${base}/me/messages/bad`)).status, 404);
  }
  assert.equal((await fixture(() => new Response('not JSON')).fetch(`${base}/me/messages`)).status, 404);
  assert.equal((await fixture({ value: {} }).fetch(`${base}/me/messages`)).status, 404);
});

test('raw email and attachments require safe parent metadata before bytes can be returned', async () => {
  for (const parent of [{}, null, message('private', { ccRecipients: [person(PRIVATE_MAILBOX)] })]) {
    const f = fixture(() => json(parent));
    assert.equal((await f.fetch(`${base}/me/messages/private/attachments/file/$value`)).status, 404);
    assert.equal(f.calls.length, 1);
  }
  const f = fixture((_call, count) => count === 1 ? json(message()) : new Response('safe attachment', { headers: { 'content-type': 'application/pdf' } }));
  const result = await f.fetch(`${base}/me/messages/safe/attachments/file/$value`);
  assert.equal(await result.text(), 'safe attachment');
  assert.equal(f.calls[0].url.pathname, '/v1.0/me/messages/safe');
  assert.equal(f.calls.length, 2);
});

test('calendar invitations and recurring instances are filtered after parent authorisation', async () => {
  const privateEvent = event('private', { attendees: [person(PRIVATE_MAILBOX)] });
  const f = fixture((_call, count) => count === 1 ? json(event('series')) : json({ value: [event(), privateEvent] }));
  const result = await (await f.fetch(`${base}/me/events/series/instances?$select=subject`)).json();
  assert.deepEqual(result.value.map(row => row.id), ['safe']);
  assert.equal(f.calls.length, 2);
  assert.equal((await fixture(privateEvent).fetch(`${base}/me/events/private`)).status, 404);
});

test('Request inputs preserve authorization, timezone preference and cancellation', async () => {
  const f = fixture(message());
  const controller = new AbortController();
  const input = new Request(`${base}/me/messages/safe`, { headers: { Authorization: 'Bearer synthetic', Prefer: 'outlook.timezone="Europe/London"' }, signal: controller.signal });
  await f.fetch(input, { headers: { 'X-Test': 'preserved' } });
  const headers = new Headers(f.calls[0].init.headers);
  assert.equal(headers.get('Authorization'), 'Bearer synthetic');
  assert.equal(headers.get('Prefer'), 'outlook.timezone="Europe/London"');
  assert.equal(headers.get('X-Test'), 'preserved');
  controller.abort();
  assert.equal(f.calls[0].init.signal.aborted, true);
});

test('unrelated Graph files, normal writes and non-Graph requests are untouched', async () => {
  for (const [url, init] of [[`${base}/drives/a/root:/messages/report:/content`, {}], [`${base}/me/sendMail`, { method: 'POST', body: '{}' }], ['https://example.test/messages', {}]]) {
    const f = fixture(() => new Response('unchanged'));
    assert.equal(await (await f.fetch(url, init)).text(), 'unchanged');
    assert.equal(f.calls.length, 1);
  }
});

test('batched header reads stay batched and exclude private response bodies', async () => {
  const f = fixture(call => {
    const sent = JSON.parse(call.init.body);
    assert.equal(sent.requests.length, 2);
    assert.ok(sent.requests.every(row => new URL(row.url, base).searchParams.get('$select').includes('bccRecipients')));
    return json({ responses: [{ id: 'safe', status: 200, body: message('safe', { internetMessageHeaders: [] }) }, { id: 'copy', status: 200, body: message('copy', { bccRecipients: [person(PRIVATE_MAILBOX)] }) }] });
  });
  const result = await (await f.fetch(`${base}/$batch`, { method: 'POST', body: JSON.stringify({ requests: [
    { id: 'safe', method: 'GET', url: '/me/messages/safe?$select=internetMessageHeaders' },
    { id: 'copy', method: 'GET', url: '/me/messages/copy?$select=internetMessageHeaders' },
    { id: 'private', method: 'GET', url: `/users/${PRIVATE_MAILBOX}/messages` },
  ] }) })).json();
  assert.equal(f.calls.length, 1);
  assert.equal(result.responses.find(row => row.id === 'safe').status, 200);
  for (const id of ['copy', 'private']) assert.equal(result.responses.find(row => row.id === id).status, 404);
  assert.doesNotMatch(JSON.stringify(result), /equity@/i);
});

test('getSchedule removes the private mailbox and preserves availability without unvalidated meeting details', async () => {
  const availability = { status: 'busy', start: { dateTime: '2026-10-27T11:00:00', timeZone: 'Europe/London' }, end: { dateTime: '2026-10-27T12:00:00', timeZone: 'Europe/London' }, isPrivate: false };
  const safe = { scheduleId: 'staff@example.test', availabilityView: '022', workingHours: { daysOfWeek: ['monday'], startTime: '09:00:00', endTime: '17:30:00' },
    scheduleItems: [{ ...availability, subject: 'Unvalidated meeting title', location: 'Unvalidated location', body: 'Unvalidated detail' }] };
  const f = fixture(call => {
    assert.deepEqual(JSON.parse(call.init.body).schedules, ['staff@example.test']);
    return json({ value: [safe, { scheduleId: PRIVATE_MAILBOX, scheduleItems: [{ subject: 'Private item' }] }] });
  });
  const result = await (await f.fetch(`${base}/me/calendar/getSchedule`, { method: 'POST', body: JSON.stringify({ schedules: [PRIVATE_MAILBOX, 'staff@example.test'], availabilityViewInterval: 30 }) })).json();
  assert.deepEqual(result.value, [{ ...safe, scheduleItems: [availability] }]);
  assert.doesNotMatch(JSON.stringify(result), /Unvalidated|Private item/);
});

test('file searches remain available but mail searches without recipient metadata cannot bypass filtering', async () => {
  const f = fixture({ value: [] });
  for (const type of ['message', 'event']) assert.equal((await f.fetch(`${base}/search/query`, { method: 'POST', body: JSON.stringify({ requests: [{ entityTypes: [type] }] }) })).status, 404);
  assert.equal((await f.fetch(`${base}/search/query`, { method: 'POST', body: JSON.stringify({ requests: [{ entityTypes: ['driveItem'] }] }) })).status, 200);
  assert.equal(f.calls.length, 1);
});

test('optional known-copy lookup can exclude hidden-recipient copies without extra network reads', async () => {
  const f = fixture({ value: [message('safe'), message('known-private-copy')] }, async row => row.internetMessageId === '<known-private-copy@example.test>');
  assert.deepEqual((await (await f.fetch(`${base}/me/messages`)).json()).value.map(row => row.id), ['safe']);
  assert.equal(f.calls.length, 1);
});

test('private-record observer receives complete private metadata before exclusion, but not safe or malformed records', async () => {
  const observed = [];
  const privateRow = message('private', { ccRecipients: [person(PRIVATE_MAILBOX)] });
  const f = fixture({ value: [message('safe'), privateRow, { subject: 'Incomplete', from: person(PRIVATE_MAILBOX) }] }, undefined,
    async (record, mailbox, resourceType) => { observed.push({ record, mailbox, resourceType }); });
  const result = await (await f.fetch(`${base}/users/staff%40example.test/messages`)).json();
  assert.deepEqual(result.value.map(row => row.id), ['safe']);
  assert.deepEqual(observed, [{ record: privateRow, mailbox: 'staff@example.test', resourceType: 'messages' }]);
  const eventRow = event('private-event', { attendees: [person(PRIVATE_MAILBOX)] });
  const cal = fixture(eventRow, undefined, async (_row, _mailbox, kind) => { assert.equal(kind, 'events'); observed.push(kind); });
  assert.equal((await cal.fetch(`${base}/me/events/private-event`)).status, 404);
  assert.equal(observed.at(-1), 'events');
});

test('versioned batch URLs and parent expansions cannot skip the message guard', async () => {
  const f = fixture(call => {
    const body = JSON.parse(call.init.body);
    assert.match(body.requests[0].url, /^\/me\/messages\/copy\?/);
    assert.match(body.requests[0].url, /bccRecipients/);
    return json({ responses: [{ id: 'copy', status: 200, body: message('copy', { toRecipients: [person(PRIVATE_MAILBOX)] }) }] });
  });
  const result = await (await f.fetch(`${base}/$batch`, { method: 'POST', body: JSON.stringify({ requests: [{ id: 'copy', method: 'GET', url: '/v1.0/me/messages/copy?$select=subject' }] }) })).json();
  assert.equal(result.responses[0].status, 404);
  assert.equal((await f.fetch(`${base}/me?$expand=messages`)).status, 404);
  assert.equal(f.calls.length, 1);
});
