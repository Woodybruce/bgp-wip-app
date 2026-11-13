const assert = require('node:assert/strict');
const { route, evaluate, find, ts } = require('./source-harness.cjs');
function named(file, name) { return find(file, n => ts.isFunctionDeclaration(n) && n.name?.text === name); }
(async () => {
  let register;
  evaluate(route('server/auth.ts', 'post', '/api/auth/register'), { app: { post: (_, fn) => register = fn } });
  let status;
  register({ body: { email: 'unverified@brucegillinghampollard.com', password: 'synthetic-password', name: 'Unverified' } }, {
    status(n) { status = n; return this; }, json(data) { assert.match(data.message, /Microsoft/); },
  });
  assert.equal(status, 403);
  const state = { sessions: 2, tokens: 2, codes: 1, active: true };
  const queries = [];
  let disconnected = false, released = false, handler;
  const pool = { async query(sql) {
    queries.push(sql);
    if (sql.includes('SELECT is_admin')) return { rows: [{ is_admin: true }] };
    if (sql.includes('SELECT name')) return { rows: [{ name: 'Test user' }] };
    if (sql.startsWith('SELECT t.user_id')) {
      assert.match(sql, /JOIN users/); assert.match(sql, /is_active IS DISTINCT FROM false/);
      return { rows: state.tokens && state.active ? [{ user_id: 'target' }] : [] };
    }
    if (sql.startsWith('DELETE FROM auth_tokens')) { const rowCount = state.tokens; state.tokens = 0; return { rowCount }; }
    if (sql.startsWith('DELETE FROM sso_exchange_codes')) { state.codes = 0; return {}; }
    if (sql.startsWith('DELETE FROM session')) { const rowCount = state.sessions; state.sessions = 0; return { rowCount }; }
    return {};
  }, async connect() { return { query: pool.query, release() { released = true; } }; } };
  const auth = evaluate(named('server/auth.ts', 'getUserIdFromToken'), { pool });
  assert.equal(await auth.getUserIdFromToken('synthetic-token'), 'target');
  state.active = false;
  assert.equal(await auth.getUserIdFromToken('synthetic-token'), null);
  state.active = true;
  evaluate(route('server/routes.ts', 'post', '/api/admin/users/:id/force-logout'), {
    app: { post: (_, ...handlers) => handler = handlers.at(-1) }, requireAuth() {}, pool,
    getIO: () => ({ in(room) { assert.equal(room, 'user:target'); return { disconnectSockets(force) { disconnected = force; } }; } }),
  });
  let response;
  await handler({ session: { userId: 'admin' }, params: { id: 'target' } }, { json(v) { response = v; }, status(n) { throw new Error(`Unexpected ${n}`); } });
  assert.equal(response.sessionsCleared, 2); assert.equal(response.tokensCleared, 2);
  assert.equal(state.codes, 0); assert.ok(disconnected); assert.ok(released);
  assert.ok(queries.indexOf('BEGIN') < queries.indexOf('COMMIT'));
  assert.equal(await auth.getUserIdFromToken('synthetic-token'), null);
  let mediaHandler;
  let account = { id: 'target', isActive: false };
  let fileReads = 0, reachChecks = 0, reachable = false;
  evaluate(route('server/routes.ts', 'get', '/api/chat-media/:filename'), {
    app: { get: (_, fn) => mediaHandler = fn },
    storage: { getUser: async id => { assert.equal(id, 'target'); return account; } },
    pool: { query: async (sql, values) => {
      reachChecks++;
      assert.match(sql, /user_upload_history/); assert.match(sql, /chat_thread_members/);
      assert.deepEqual(Array.from(values), ['target', 'fixture.pdf']);
      return { rowCount: reachable ? 1 : 0 };
    } },
    getFile: async () => { fileReads++; return { contentType: 'application/pdf', originalName: 'Shared document.pdf', data: Buffer.from('synthetic') }; },
    contentDispositionFor: () => 'attachment',
  });
  async function download(request) {
    let status = 200; const headers = {};
    await mediaHandler({ query: {}, params: { filename: 'fixture.pdf' }, ...request }, {
      status(n) { status = n; return this; }, json() {}, end() {}, send() {},
      set(name, value) { headers[name] = value; },
    });
    return { status, headers };
  }
  // A token in the address signs nobody in since 2026-10-24 (it left a 30-day token in history and proxy logs):
  // a download rides the session, or the bearer token the auth middleware has already resolved.
  assert.equal((await download({ query: { token: 'valid-token' } })).status, 401);
  assert.equal((await download({ tokenUserId: 'target' })).status, 401, 'a deactivated account');
  assert.equal(fileReads, 0);
  account = { id: 'target', isActive: true };
  for (const request of [{ session: { userId: 'target' } }, { tokenUserId: 'target' }]) {
    const validDownload = await download(request);
    assert.equal(validDownload.status, 200);
    assert.equal(validDownload.headers['Cache-Control'], 'private, no-store');
  }
  assert.equal((await download({ query: { token: 'valid-token' } })).status, 401);
  assert.deepEqual([fileReads, reachChecks], [2, 0]);
  // A client login reaches only what it uploaded or what was posted in a thread it is in.
  account = { id: 'target', isActive: true, role: 'Client' };
  assert.equal((await download({ session: { userId: 'target' } })).status, 404);
  assert.deepEqual([fileReads, reachChecks], [2, 1]);
  reachable = true;
  assert.equal((await download({ session: { userId: 'target' } })).status, 200);
  assert.deepEqual([fileReads, reachChecks], [3, 2]);
  console.log('PASS: verified-onboarding boundary, disabled tokens, session/token/exchange-code revocation and socket disconnect');
})().catch(error => { console.error(error); process.exitCode = 1; });
