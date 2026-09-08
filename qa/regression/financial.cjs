// Run with node --test qa/regression/financial.cjs. Executes the production
// functions with synthetic persistence/provider boundaries; never starts the app.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const source = file => fs.readFileSync(path.join(root, file), 'utf8');

function named(file, name) {
  const ast = ts.createSourceFile(file, source(file), ts.ScriptTarget.Latest, true);
  let result;
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) result = node.getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(result, `${file}: missing ${name}`);
  return result;
}
function routeHandler(file, url) {
  const ast = ts.createSourceFile(file, source(file), ts.ScriptTarget.Latest, true);
  let result;
  function visit(node) {
    if (ts.isCallExpression(node) && node.arguments[0]?.text === url) {
      const last = node.arguments[node.arguments.length - 1];
      if (ts.isArrowFunction(last)) result = last.getText(ast);
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(result, `${file}: missing route ${url}`);
  return `exports.handle = ${result};`;
}
function evaluate(code, bindings = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(code, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, { exports, Date, Buffer, URLSearchParams, console: { log() {}, warn() {}, error() {} }, ...bindings });
  return exports;
}
function gate() {
  let release;
  const promise = new Promise(resolve => { release = resolve; });
  return { promise, release };
}

function approvalFixture(patch = {}, onPick = async () => 'director') {
  let expense = { id: 'expense', status: 'pending_approval', approvalStage: 1,
    approverUserId: 'finance', submitterUserId: 'submitter', ...patch };
  const people = [
    { id: 'finance', email: 'accounts@example.test', isAdmin: false },
    { id: 'director', email: 'director@example.test', isAdmin: false },
    { id: 'admin', email: 'admin@example.test', isAdmin: true },
  ];
  const columns = new Proxy({}, { get: (_, key) => key });
  const db = {
    select: () => ({ from: table => ({ where: condition => ({ limit: async () =>
      (table === people ? people : [{ ...expense }]).filter(condition).slice(0, 1),
    }) }) }),
    update: () => ({ set: patch => ({ where: condition => ({ returning: async () => {
      if (!condition(expense)) return [];
      expense = { ...expense, ...patch };
      return [{ id: expense.id }];
    } }) }) }),
  };
  const exported = evaluate(named('server/expense-approval.ts', 'approveExpense'), {
    db, expenses: columns, users: people,
    eq: (column, value) => row => row[column] === value,
    isNull: column => row => row[column] == null,
    and: (...conditions) => row => conditions.every(fn => fn(row)),
    sql: (_strings, column, stage) => row => (row[column] ?? 1) === stage,
    pickStageApprover: onPick, FALLBACK_APPROVER_EMAILS: new Set(['accounts@example.test']),
  });
  // Users also expose their ORM column names.
  people.id = 'id';
  return { approve: (id, expectedStage = expense.approvalStage ?? 1) => exported.approveExpense(id, expense.id, null, expectedStage),
    read: () => expense, mutate: patch => { expense = { ...expense, ...patch }; } };
}

test('overlapping finance approvals advance exactly once and still require the director', async () => {
  const block = gate();
  const f = approvalFixture({}, async () => { await block.promise; return 'director'; });
  const requests = [f.approve('finance'), f.approve('finance')];
  block.release();
  const outcomes = await Promise.all(requests);
  assert.deepEqual(outcomes.map(x => x.outcome).sort(), ['advanced', 'noop']);
  assert.equal(f.read().status, 'pending_approval');
  assert.equal(f.read().approverUserId, 'director');
  assert.equal((await f.approve('finance')).outcome, 'noop');
  assert.equal((await f.approve('director')).outcome, 'approved');
  assert.equal(f.read().approvedByUserId, 'director');
});

test('reassignment during approval invalidates the stale reviewer snapshot', async () => {
  const picked = gate(), resume = gate();
  const f = approvalFixture({}, async () => { picked.release(); await resume.promise; return 'director'; });
  const request = f.approve('finance');
  await picked.promise;
  f.mutate({ approverUserId: 'replacement' });
  resume.release();
  assert.equal((await request).outcome, 'noop');
  assert.equal(f.read().approvalStage, 1);
});

test('a queued admin approval cannot advance a different stage than the one reviewed', async () => {
  const f = approvalFixture();
  assert.equal((await f.approve('admin', 1)).outcome, 'advanced');
  assert.equal((await f.approve('admin', 1)).outcome, 'noop');
  assert.equal(f.read().status, 'pending_approval');
  assert.equal(f.read().approverUserId, 'director');
  assert.equal((await f.approve('admin', 2)).outcome, 'approved');
  assert.equal(f.read().approvedByUserId, 'admin');
});

test('approval API requires the reviewed stage and carries it through queued bulk work', async () => {
  const calls = [], jobs = [];
  const bindings = {
    setImmediate: fn => jobs.push(fn),
    require: () => ({ canApproveExpense: async () => true,
      approveExpense: async (...args) => { calls.push(args); return { outcome: 'advanced', stage: 2 }; } }),
  };
  const single = evaluate(routeHandler('server/stripe-issuing.ts', '/api/expenses/:id/approve'), bindings).handle;
  const bulk = evaluate(routeHandler('server/stripe-issuing.ts', '/api/expenses/approve-bulk'), bindings).handle;
  const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; } });
  for (const [handler, body] of [[single, {}], [single, { expectedStage: 0 }], [bulk, { ids: ['expense'] }]]) {
    const res = response();
    await handler({ session: { userId: 'admin' }, params: { id: 'expense' }, body }, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /Refresh/);
  }
  await single({ session: { userId: 'admin' }, params: { id: 'expense' }, body: { expectedStage: 1 } }, response());
  await bulk({ session: { userId: 'admin' }, body: { ids: ['expense'], expectedStages: { expense: 1 } } }, response());
  assert.equal(calls.length, 1, 'bulk work has not run yet');
  await jobs[0]();
  assert.deepEqual(calls.map(args => args[3]), [1, 1]);
});

test('final approval is claimed once, with fallback/admin workflows preserved', async () => {
  const final = approvalFixture({ approvalStage: 2, approverUserId: 'director' });
  const outcomes = await Promise.all([final.approve('director'), final.approve('director')]);
  assert.deepEqual(outcomes.map(x => x.outcome).sort(), ['approved', 'noop']);
  assert.equal((await approvalFixture({ approverUserId: null }).approve('finance')).outcome, 'advanced');
  assert.equal((await approvalFixture().approve('admin')).outcome, 'advanced');
  assert.equal((await approvalFixture({ approvalStage: 0 }).approve('admin')).outcome, 'noop');
});

test('concurrent Xero refresh copies new tokens to separate sessions and preserves tenant selection', async () => {
  const response = gate();
  let calls = 0;
  const xero = evaluate('const refreshLocks = new Map();\n' + named('server/xero.ts', 'refreshXeroToken'), {
    process: { env: { XERO_CLIENT_ID: 'synthetic', XERO_CLIENT_SECRET: 'synthetic' } },
    XERO_TOKEN_URL: 'https://example.invalid/token',
    fetch: async () => { calls++; await response.promise; return { ok: true, json: async () =>
      ({ access_token: 'rotated-access', refresh_token: 'rotated-refresh', expires_in: 1800 }) }; },
  });
  const old = { accessToken: 'expired', refreshToken: 'shared', expiresAt: 0 };
  const a = { xeroTokens: { ...old, tenantId: 'tenant-a' } }, b = { xeroTokens: { ...old, tenantId: 'tenant-b' } };
  const requests = [xero.refreshXeroToken(a), xero.refreshXeroToken(b)];
  response.release();
  assert.deepEqual(await Promise.all(requests), ['rotated-access', 'rotated-access']);
  assert.equal(calls, 1);
  assert.equal(b.xeroTokens.refreshToken, 'rotated-refresh');
  assert.equal(b.xeroTokens.tenantId, 'tenant-b');
  assert.equal(await xero.refreshXeroToken(b), 'rotated-access');
  assert.equal(calls, 1);
});

test('refresh failure returns no expired token to any waiter', async () => {
  const response = gate();
  const xero = evaluate('const refreshLocks = new Map();\n' + named('server/xero.ts', 'refreshXeroToken'), {
    process: { env: { XERO_CLIENT_ID: 'synthetic', XERO_CLIENT_SECRET: 'synthetic' } },
    XERO_TOKEN_URL: 'https://example.invalid/token',
    fetch: async () => { await response.promise; throw new Error('synthetic network failure'); },
  });
  const old = { accessToken: 'expired', refreshToken: 'shared', expiresAt: 0 };
  const a = { xeroTokens: { ...old } }, b = { xeroTokens: { ...old } };
  const requests = [xero.refreshXeroToken(a), xero.refreshXeroToken(b)];
  response.release();
  assert.deepEqual(await Promise.all(requests), [null, null]);
  assert.equal(a.xeroTokens, undefined);
  assert.equal(b.xeroTokens, undefined);
});

test('system token rotation persists even when the later API operation fails', async () => {
  const sys = { xeroTokens: { accessToken: 'old', refreshToken: 'old-rt', expiresAt: 0 } };
  let saves = 0;
  sys.save = async () => { saves++; };
  const xero = evaluate(named('server/xero-system-session.ts', 'withSystemXero'), { getSystemXeroSession: async () => sys });
  const failure = new Error('synthetic invoice failure');
  await assert.rejects(xero.withSystemXero(async session => {
    session.xeroTokens = { accessToken: 'new', refreshToken: 'new-rt', expiresAt: 1000 };
    throw failure;
  }), error => error === failure);
  assert.equal(sys.xeroTokens.refreshToken, 'new-rt');
  assert.equal(saves, 1);
  await xero.withSystemXero(async session => { session.xeroTokens.tenantId = 'selected-tenant'; });
  assert.equal(saves, 2);
  await assert.rejects(xero.withSystemXero(async session => { session.xeroTokens = undefined; throw failure; }));
  assert.equal(saves, 2, 'failed refresh must not restore a cleared connection');
});

test('a late system session save cannot overwrite a newer refresh rotation', async () => {
  let stored = { accessToken: 'old', refreshToken: 'old-rt', expiresAt: 0 };
  const xero = evaluate(named('server/xero-system-session.ts', 'getSystemXeroSession'), {
    SYSTEM_KEY: 'synthetic', ensureTable: async () => {},
    sql: (strings, ...values) => ({ text: strings.join('?'), values }),
    db: { execute: async query => {
      if (query.text.includes('SELECT value')) return { rows: [{ value: { ...stored } }] };
      assert.match(query.text, /value->>'refreshToken'/);
      const [json, , expectedRefresh] = query.values;
      if (stored.refreshToken === expectedRefresh) stored = JSON.parse(json);
      return { rows: [] };
    } },
  });
  const early = await xero.getSystemXeroSession(), late = await xero.getSystemXeroSession();
  Object.assign(early.xeroTokens, { accessToken: 'first', refreshToken: 'first-rt' });
  await early.save();
  const newer = await xero.getSystemXeroSession();
  Object.assign(newer.xeroTokens, { accessToken: 'second', refreshToken: 'second-rt' });
  await newer.save();
  Object.assign(late.xeroTokens, { accessToken: 'first', refreshToken: 'first-rt' });
  await late.save();
  assert.equal(stored.refreshToken, 'second-rt');
});

function postingFixture({ state = {}, lockAvailable = true, onPost = async () => {}, onUnlock = async () => {} } = {}) {
  let expense = { id: 'expense', status: 'approved', amountPence: 1200, merchant: 'Synthetic Merchant',
    createdAt: new Date('2026-09-01T12:00:00Z'), ...state };
  const calls = [], releases = [];
  const columns = new Proxy({}, { get: (_, key) => key });
  const db = {
    select: () => ({ from: table => ({ where: () => ({ limit: async () => [{ ...expense }], orderBy: async () => [] }) }) }),
    update: () => ({ set: patch => ({ where: async () => { expense = { ...expense, ...patch }; } }) }),
  };
  const exported = evaluate('const expensePosts = new Map(); const expensePostLimit = fn => fn();\n' +
    ['postExpenseToXero', 'postExpenseToXeroLocked', 'postExpenseToXeroOnce'].map(n => named('server/expense-xero-poster.ts', n)).join('\n'), {
    db, expenses: columns, expenseSplits: 'splits', eq() {},
    STRIPE_CARDS_ACCOUNT_CODE: '1230', CARD_SPEND_XERO_CONTACT: 'Synthetic Expenses',
    pool: { connect: async () => ({ query: async query => {
      if (query.includes('pg_try_advisory_lock')) return { rows: [{ locked: lockAvailable }] };
      await onUnlock(); return { rows: [] };
    }, release: value => releases.push(value) }) },
    xeroApi: async (_session, url, options) => {
      if (url === '/TrackingCategories') return { TrackingCategories: [] };
      calls.push({ url, ...options }); await onPost();
      return { BankTransactions: [{ BankTransactionID: 'transaction' }] };
    },
    EXPENSE_CATEGORY_MAP: {}, getCategoryCode: async () => '900', isKnownExpenseCode: async () => true,
    isCategoryVatReclaimable: async () => false, getCategoryTaxType: async () => 'NONE',
    attachReceiptToXero: async () => {},
  });
  return { post: () => exported.postExpenseToXero({ session: {}, expenseId: 'expense' }), calls, releases,
    read: () => expense };
}

test('overlapping expense posts share one request; completed retries return the stored transaction', async () => {
  const response = gate();
  const f = postingFixture({ onPost: () => response.promise });
  const posts = [f.post(), f.post()];
  response.release();
  const results = await Promise.all(posts);
  assert.ok(results.every(r => r.xeroTransactionId === 'transaction'));
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].headers['Idempotency-Key'], 'bgp-expense-expense');
  assert.equal(JSON.parse(f.calls[0].body).Date, '2026-09-01');
  assert.equal((await f.post()).xeroTransactionId, 'transaction');
  assert.equal(f.calls.length, 1);
});

test('posting honors the cross-process lock and full approval', async () => {
  const busy = postingFixture({ lockAvailable: false });
  await assert.rejects(busy.post(), /already being posted/);
  assert.equal(busy.calls.length, 0);
  assert.deepEqual(busy.releases, [false]);
  const unapproved = postingFixture({ state: { status: 'pending_approval' } });
  await assert.rejects(unapproved.post(), /fully approved/);
  assert.equal(unapproved.calls.length, 0);
});

test('a lost provider response releases the lock and retries with the same key and body', async () => {
  let fail = true;
  const f = postingFixture({ onPost: async () => { if (fail) throw new Error('synthetic lost response'); } });
  await assert.rejects(f.post(), /lost response/);
  fail = false;
  await f.post();
  assert.equal(f.calls[0].headers['Idempotency-Key'], f.calls[1].headers['Idempotency-Key']);
  assert.equal(f.calls[0].body, f.calls[1].body);
  assert.deepEqual(f.releases, [false, false]);
  const unlockFailed = postingFixture({ onUnlock: async () => { throw new Error('synthetic connection loss'); } });
  await unlockFailed.post();
  assert.deepEqual(unlockFailed.releases, [true]);
});

test('weekly schedules parse full times and roll past an elapsed scheduled instant', () => {
  const input = source('server/scheduled-jobs.ts');
  const jobs = evaluate(input.slice(input.indexOf('const DOW_MAP:'), input.indexOf('// ─── Action runners')));
  const monday = new Date(2026, 8, 7, 7, 29);
  const next = jobs.computeNextRun('weekly', 'MON:07:30', monday);
  assert.equal(next.getDay(), 1); assert.equal(next.getHours(), 7); assert.equal(next.getMinutes(), 30);
  assert.equal(next.getDate(), 7);
  const following = jobs.computeNextRun('weekly', 'MON:07:30', new Date(2026, 8, 7, 7, 30));
  assert.equal(following.getDate(), 14);
  for (const bad of ['MON:24:00', 'MON:07:60', 'MON:07', 'MON::30', 'MON:07:30:00', 'BAD:07:30']) {
    assert.throws(() => jobs.computeNextRun('weekly', bad), /Bad weekly/);
  }
  assert.equal(jobs.computeNextRun('weekly', 'MON:09:00', monday).getHours(), 9);
});
