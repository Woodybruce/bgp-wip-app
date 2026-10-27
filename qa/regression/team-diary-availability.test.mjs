import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { teamDiaryCoverage, teamDiaryItems } from '../../server/team-diary-availability.ts';
import { isPrivateMailboxAddress } from '../../server/private-mail.ts';

const require = createRequire(import.meta.url);
const { route, evaluate } = require('./source-harness.cjs');

const busy = { status: 'busy', start: { dateTime: '2026-10-27T11:00:00', timeZone: 'Europe/London' }, end: { dateTime: '2026-10-27T12:00:00', timeZone: 'Europe/London' }, isPrivate: false };

test('redacted appointments remain visible as busy intervals rather than disappearing', () => {
  const items = teamDiaryItems({ scheduleItems: [busy] });
  assert.equal(items.length, 1);
  assert.equal(items[0].subject, 'Busy — details unavailable');
  assert.equal(items[0].detailsUnavailable, true);
  assert.deepEqual(items[0].start, busy.start);
  assert.equal(items[0].location, '');
});

test('team summary describes busy blocks and missing meeting detail without claiming no meetings', () => {
  const coverage = teamDiaryCoverage([{ scheduleItems: [busy] }, { error: { message: 'Unavailable' } }], 3, 'day');
  assert.equal(coverage.busyBlocks, 1);
  assert.equal(coverage.checked, 1);
  assert.equal(coverage.detailsUnavailable, true);
  assert.match(coverage.summary, /1 busy diary block today/);
  assert.match(coverage.summary, /Meeting details are unavailable/);
  assert.match(coverage.summary, /1 of 3 calendars/);
  assert.doesNotMatch(coverage.summary, /no meetings|Quiet day|no notable/i);
});

test('empty or failed availability stays explicitly unknown, while free intervals are not counted busy', () => {
  for (const rows of [[], [{ error: { message: 'Unavailable' } }], [{ scheduleItems: [{ ...busy, status: 'free' }] }]]) {
    const coverage = teamDiaryCoverage(rows, 2, 'week');
    assert.equal(coverage.busyBlocks, 0);
    assert.equal(coverage.detailsUnavailable, true);
    assert.match(coverage.summary, /cannot be confirmed/);
    assert.doesNotMatch(coverage.summary, /no meetings|Quiet day/i);
  }
});

test('team endpoints retain busy intervals and avoid AI/no-meetings claims when only availability is known', async () => {
  const users = [{ name: 'Synthetic staff', email: 'staff@brucegillinghampollard.com', team: 'London Retail' }];
  const graph = { value: [{ scheduleId: users[0].email, availabilityView: '022', scheduleItems: [busy] }] };
  for (const path of ['/api/microsoft/team-calendar', '/api/microsoft/team-intelligence']) {
    let handler;
    evaluate(route('server/microsoft.ts', 'get', path), {
      app: { get(_path, callback) { handler = callback; } },
      getValidMsToken: async () => 'synthetic-token',
      teamDiaryCoverage, teamDiaryItems, isPrivateMailboxAddress,
      fetch: async () => ({ ok: true, json: async () => graph }),
      require(name) {
        if (name === './db') return { db: { select: () => ({ from: async () => users }) } };
        if (name === '@shared/schema') return { users: {} };
        if (name === './utils/anthropic-client') assert.fail('Unavailable titles must not be sent to AI as an empty meeting list');
        throw new Error(`Unexpected module ${name}`);
      },
    });
    let response;
    await handler({ query: { period: 'day' }, session: {} }, {
      status(code) { assert.fail(`Unexpected status ${code}`); }, json(value) { response = value; },
    });
    if (path.endsWith('team-calendar')) {
      assert.equal(response[0].scheduleItems.length, 1);
      assert.equal(response[0].scheduleItems[0].subject, 'Busy — details unavailable');
      assert.equal(response[0].availabilityView, '022');
    } else {
      assert.match(response.summary, /1 busy diary block today/);
      assert.equal(response.stats.totalMeetings, null);
      assert.equal(response.stats.busyBlocks, 1);
      assert.equal(response.schedules[0].meetingCount, null);
      assert.equal(response.schedules[0].busyBlockCount, 1);
      assert.doesNotMatch(response.summary, /no meetings|Quiet day/i);
    }
  }
});
