// The timed email and calendar filing (startAutoSync in server/interactions.ts):
// one run five minutes after the app starts, then one an hour, and never
// while another sync is running. The app's own code is cut from the source
// and run against a clock the test moves by hand, with the read of the
// mailboxes replaced, so nothing waits and nothing reaches Microsoft.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { source, evaluate, find, route, ts } = require('./source-harness.cjs');

const FILE = 'server/interactions.ts';
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const fn = name => find(FILE, node => ts.isFunctionDeclaration(node) && node.name?.text === name);
const variable = name => find(FILE, (node, ast) => ts.isVariableStatement(node)
  && node.declarationList.declarations.some(declaration => declaration.name.getText(ast) === name));
const settle = () => new Promise(resolve => setImmediate(resolve));
// What a promise has come to by now; undefined while it is still running,
// so a broken rule fails an assertion instead of leaving the test waiting.
const settled = async promise => { let value; promise.then(result => { value = result; }, () => {}); await settle(); return value; };
const filed = () => ({ success: true, synced: { emails: 3, calendar: 1 }, usersScanned: 2, perUserStats: [],
  autoContacts: { contactsCreated: 0, companiesCreated: 0 }, errors: undefined });

// The app's setTimeout and setInterval land here. goTo moves to a time
// measured from the start and runs whatever falls due on the way, in order.
function handClock() {
  let now = 0;
  const timers = [];
  const add = (callback, delay, every) => {
    const timer = { callback, at: now + delay, every, unref: false };
    timers.push(timer);
    return { unref() { timer.unref = true; return this; } };
  };
  return {
    timers,
    setTimeout: (callback, delay) => add(callback, delay, 0),
    setInterval: (callback, delay) => add(callback, delay, delay),
    async goTo(time) {
      for (;;) {
        const due = timers.filter(timer => timer.at <= time).sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        now = due.at;
        if (due.every) due.at += due.every; else timers.splice(timers.indexOf(due), 1);
        due.callback();
        await settle();
      }
      now = time;
    },
  };
}

// A sync the test ends by hand: one that is still reading mailboxes.
function slowSync() {
  const open = [];
  return {
    sync: () => new Promise(resolve => open.push(resolve)),
    async finish() { assert.ok(open.length, 'a sync should be running'); open.shift()(filed()); await settle(); },
  };
}

// `sync` stands in for runInteractionSync, the one function that reads
// Microsoft. `extra` is more of the file's own code that shares the flag.
function load({ sync = async () => filed(), extra = [], bindings = {} } = {}) {
  const clock = handClock();
  const state = { running: false, startedAt: null, finishedAt: null, lastResult: null, error: null };
  const calls = [];
  const errors = [];
  let running = 0;
  let mostAtOnce = 0;
  const exports = evaluate([variable('autoSyncInterval'), fn('startAutoSync'), ...extra, 'exports.startAutoSync = startAutoSync;'].join('\n'), {
    interactionSyncState: state,
    async runInteractionSync(...args) {
      calls.push(args);
      mostAtOnce = Math.max(mostAtOnce, ++running);
      try { return await sync(...args); } finally { running--; }
    },
    setTimeout: clock.setTimeout,
    setInterval: clock.setInterval,
    console: { log() {}, warn() {}, error: (...line) => errors.push(line.join(' ')) },
    require: () => ({ logActivity: async () => {} }),
    ...bindings,
  });
  return { start: exports.startAutoSync, exports, clock, state, calls, errors, mostAtOnce: () => mostAtOnce };
}

test('the first sync runs five minutes after the app starts, then one an hour', async () => {
  const { start, clock, state, calls, errors, mostAtOnce } = load();
  start();
  assert.equal(calls.length, 0, 'start-up itself reads no mailbox');
  await clock.goTo(5 * MINUTE - 1);
  assert.equal(calls.length, 0, 'boot work is left to finish first');
  await clock.goTo(5 * MINUTE);
  assert.deepEqual(calls, [[120, 90]], 'the ordinary hourly read, never a deeper catch-up');
  await clock.goTo(HOUR - 1);
  assert.equal(calls.length, 1);
  await clock.goTo(HOUR);
  assert.equal(calls.length, 2, 'the hourly run still counts from the start');
  await clock.goTo(4 * HOUR);
  assert.deepEqual(calls, Array(5).fill([120, 90]), 'five minutes, then each hour');
  assert.equal(mostAtOnce(), 1);
  assert.equal(state.running, false);
  assert.deepEqual(errors, []);
});

test('a second start sets no second timer, and the wait for the first run never keeps a stopping process alive', async () => {
  const { start, clock, calls } = load();
  start();
  start();
  assert.equal(clock.timers.length, 2, 'one first run and one hourly timer');
  assert.equal(clock.timers.find(timer => !timer.every).unref, true);
  await clock.goTo(HOUR);
  assert.equal(calls.length, 2);
});

test('a tick that falls due while a sync is still running starts no second one', async () => {
  const slow = slowSync();
  const { start, clock, state, calls, mostAtOnce } = load({ sync: slow.sync });
  start();
  await clock.goTo(5 * MINUTE);
  assert.equal(calls.length, 1);
  assert.equal(state.running, true);
  await clock.goTo(HOUR);
  assert.equal(calls.length, 1, 'the hourly tick finds the first run unfinished and does nothing');
  assert.equal(state.running, true, 'and leaves the running sync its flag');
  await slow.finish();
  assert.equal(state.running, false);
  await clock.goTo(2 * HOUR);
  assert.equal(calls.length, 2);
  await slow.finish();
  assert.equal(mostAtOnce(), 1);
});

test('a sync that fails does not block the next one', async () => {
  let broken = true;
  const { start, clock, state, calls, errors } = load({ sync: async () => { if (broken) throw new Error('Microsoft authentication failed'); return filed(); } });
  start();
  await clock.goTo(5 * MINUTE);
  assert.equal(state.running, false);
  assert.match(errors.join('\n'), /Auto-sync failed.*Microsoft authentication failed/);
  broken = false;
  await clock.goTo(HOUR);
  assert.equal(calls.length, 2);
  assert.equal(errors.length, 1);
});

test('a sync a person starts and the timed sync never run together', async () => {
  const withButton = slow => {
    const routes = {};
    const loaded = load({ sync: slow.sync, extra: [route(FILE, 'post', '/api/interactions/sync')],
      bindings: { app: { post(url, ...handlers) { routes[url] = handlers.at(-1); } }, requireAuth() {} } });
    const press = async () => {
      const res = { code: 200, body: null, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
      await routes['/api/interactions/sync']({ query: {} }, res);
      return res;
    };
    return { ...loaded, press };
  };

  // A person's sync is under way when the first timed run falls due.
  {
    const slow = slowSync();
    const { start, clock, state, calls, press } = withButton(slow);
    start();
    await clock.goTo(4 * MINUTE);
    const pressed = await press();
    assert.deepEqual([pressed.code, pressed.body.started], [202, true]);
    await clock.goTo(5 * MINUTE);
    assert.equal(calls.length, 1, 'the first timed run stands aside');
    assert.equal(state.running, true);
    await slow.finish();
    assert.equal(state.running, false);
    await clock.goTo(HOUR);
    assert.deepEqual(calls, [[30, 60], [120, 90]], 'and the next hourly run goes ahead');
    await slow.finish();
  }

  // The timed run is under way when a person presses Sync.
  {
    const slow = slowSync();
    const { start, clock, calls, press, mostAtOnce } = withButton(slow);
    start();
    await clock.goTo(5 * MINUTE);
    const pressed = await press();
    assert.deepEqual([pressed.code, pressed.body.started, pressed.body.alreadyRunning], [202, false, true]);
    assert.equal(calls.length, 1, 'the person is told one is running and no second read starts');
    await slow.finish();
    assert.equal(mostAtOnce(), 1);
  }
});

test('the admin backfill and the timed sync never run together', async () => {
  const withBackfill = slow => load({ sync: slow.sync,
    extra: [variable('EMAIL_CONTACTS_BACKFILL_KEY'), variable('EMAIL_CONTACTS_BACKFILL_DAYS'), variable('backfillRetries'), variable('backfillStop'),
      variable('EMAIL_CONTACTS_PROGRESS_KEY'), fn('backfillProgress'), variable('backfillState'), fn('runEmailContactsBackfill'),
      'exports.runEmailContactsBackfill = runEmailContactsBackfill;'],
    bindings: { pool: { query: async () => ({ rows: [] }) }, scheduleEmailContactsBackfill() {} } });

  // The backfill is under way when the first timed run falls due.
  {
    const slow = slowSync();
    const { start, exports, clock, state, calls, errors } = withBackfill(slow);
    start();
    await clock.goTo(4 * MINUTE);
    const backfill = exports.runEmailContactsBackfill(150);
    await settle();
    assert.deepEqual(calls.map(call => call[0]), [150]);
    await clock.goTo(5 * MINUTE);
    assert.equal(calls.length, 1, 'the first timed run stands aside');
    assert.equal(state.running, true);
    await slow.finish();
    assert.equal((await settled(backfill))?.success, true, 'the backfill finishes');
    assert.equal(state.running, false);
    await clock.goTo(HOUR);
    assert.deepEqual(calls.map(call => call[0]), [150, 120], 'and the next hourly run goes ahead');
    assert.deepEqual(errors, []);
  }

  // The timed run is under way when an admin starts the backfill.
  {
    const slow = slowSync();
    const { start, exports, clock, calls, mostAtOnce } = withBackfill(slow);
    start();
    await clock.goTo(5 * MINUTE);
    const answer = await settled(exports.runEmailContactsBackfill(150));
    assert.deepEqual([answer?.started, answer?.alreadyRunning], [false, true]);
    assert.equal(calls.length, 1, 'the backfill is refused and no second read starts');
    await slow.finish();
    assert.equal(mostAtOnce(), 1);
  }
});

test('loading the file starts nothing: the timers are set only when the routes are registered', () => {
  const ast = ts.createSourceFile(FILE, source(FILE), ts.ScriptTarget.Latest, true);
  const onLoad = [];
  const startedFrom = [];
  (function visit(node, owner) {
    if (ts.isCallExpression(node)) {
      const called = node.expression.getText(ast);
      if (!owner) onLoad.push(called);
      if (called === 'startAutoSync') startedFrom.push(owner);
    }
    const inside = ts.isFunctionLike(node) ? owner || node.name?.getText(ast) || '(unnamed)' : owner;
    ts.forEachChild(node, child => visit(child, inside));
  })(ast, null);
  assert.deepEqual(onLoad.filter(called => /^(startAutoSync|runInteractionSync|runEmailContactsBackfill|scheduleEmailContactsBackfill|setTimeout|setInterval)$/.test(called)), []);
  assert.deepEqual(startedFrom, ['registerInteractionRoutes']);
});
