import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { isPrivateMailboxAddress, PRIVATE_MAILBOX } from '../../server/private-mail.ts';

const require = createRequire(import.meta.url);
const { find, evaluate, ts } = require('./source-harness.cjs');
const code = ['isPrivateMicrosoftAccount', 'getValidMsToken', 'getDelegatedGraphTokenForUser']
  .map(name => find('server/microsoft.ts', node => ts.isFunctionDeclaration(node) && node.name?.text === name)).join('\n');

function harness(options = {}) {
  const calls = [];
  let refreshed = 0, saved = 0;
  const account = options.account || { homeAccountId: 'home-staff', username: 'staff@brucegillinghampollard.com' };
  const result = options.result || { accessToken: 'synthetic-fresh', expiresOn: new Date(Date.now() + 3600000), account };
  const user = options.user || { email: 'staff@brucegillinghampollard.com', role: 'Staff', is_active: true };
  const client = {
    getTokenCache: () => ({ deserialize() {}, getAllAccounts: async () => [account] }),
    acquireTokenSilent: async () => { refreshed++; return result; },
  };
  const api = evaluate(code, {
    isPrivateMailboxAddress, PRIVATE_MAILBOX, SCOPES: ['synthetic-scope'],
    pool: { async query(sql, values) {
      calls.push({ sql, values });
      if (sql.includes('FROM users WHERE id')) return { rows: [user] };
      assert.match(sql, /FROM msal_token_cache mt/);
      assert.equal(values[0], PRIVATE_MAILBOX);
      assert.match(sql, /lower\(coalesce\(u.email, ''\)\) <> \$1/);
      return { rows: [{ user_id: 'fallback-staff', cache_data: 'synthetic-cache', home_account_id: account.homeAccountId }] };
    } },
    withMsalCacheLock: callback => callback(), getMsalClient: () => client,
    loadMsalCache: async () => options.fallback ? null : 'synthetic-cache',
    getHomeAccountId: async () => options.fallback ? null : account.homeAccountId,
    saveMsalCache: async () => { saved++; },
    delegatedAccountBelongsToUser: () => true,
    console: { log() {}, warn() {} },
  });
  return { ...api, calls, account, refreshed: () => refreshed, saved: () => saved };
}
const session = extra => ({ session: { userId: 'staff-1', msAccountHomeId: 'home-staff', msTokens: { accessToken: 'synthetic-session', expiresOn: new Date(Date.now() + 3600000).toISOString() }, ...extra } });

test('cached sessions reject known private Microsoft identity and private account metadata before token reuse', async () => {
  const privateIdentity = harness();
  const principalReq = session();
  principalReq.session.msTokens.userPrincipalName = PRIVATE_MAILBOX;
  assert.equal(await privateIdentity.getValidMsToken(principalReq), null);
  assert.equal(principalReq.session.msTokens, undefined);
  const privateAccount = harness({ account: { homeAccountId: 'home-staff', username: PRIVATE_MAILBOX } });
  const legacyReq = session();
  assert.equal(await privateAccount.getValidMsToken(legacyReq), null);
  assert.equal(legacyReq.session.msTokens, undefined);
  assert.equal(privateAccount.refreshed(), 0);
});

test('normal cached sessions remain reusable after metadata check and normal refresh persists the mailbox identity', async () => {
  const h = harness();
  const req = session();
  assert.equal(await h.getValidMsToken(req), 'synthetic-session');
  assert.equal(req.session.msTokens.userPrincipalName, h.account.username);
  assert.equal(h.refreshed(), 0);
  req.session.msTokens.expiresOn = '2000-01-01T00:00:00Z';
  assert.equal(await h.getValidMsToken(req), 'synthetic-fresh');
  assert.equal(h.refreshed(), 1);
  assert.equal(h.saved(), 1);
  assert.equal(req.session.msTokens.userPrincipalName, h.account.username);
});

test('org fallback excludes private user rows and rejects mismatched private account metadata', async () => {
  const excluded = harness({ fallback: true, account: { homeAccountId: 'fallback-home', username: PRIVATE_MAILBOX } });
  assert.equal(await excluded.getValidMsToken({ session: { userId: 'staff-1' } }), null);
  assert.ok(excluded.calls.some(call => call.sql.includes('FROM msal_token_cache mt')));
  assert.equal(excluded.refreshed(), 0);
  const allowed = harness({ fallback: true });
  const req = { session: { userId: 'staff-1' } };
  assert.equal(await allowed.getValidMsToken(req), 'synthetic-fresh');
  assert.equal(req.session.msTokens.userPrincipalName, allowed.account.username);
});

test('silent token results and delegated background users cannot return a private Microsoft identity', async () => {
  for (const identity of [{ account: { username: PRIVATE_MAILBOX } }, { idTokenClaims: { upn: PRIVATE_MAILBOX } }]) {
    const h = harness({ result: { accessToken: 'synthetic-denied', ...identity } });
    assert.equal(await h.getValidMsToken({ session: { userId: 'staff-1' } }), null);
    assert.equal(await h.getDelegatedGraphTokenForUser('staff-1'), null);
    assert.equal(h.saved(), 0);
  }
  const privateUser = harness({ user: { email: PRIVATE_MAILBOX, role: 'Staff' } });
  assert.equal(await privateUser.getValidMsToken(session()), null);
  assert.equal(await privateUser.getDelegatedGraphTokenForUser('staff-1'), null);
  assert.equal(privateUser.refreshed(), 0);
  const allowed = harness();
  assert.equal(await allowed.getDelegatedGraphTokenForUser('staff-1'), 'synthetic-fresh');
});
