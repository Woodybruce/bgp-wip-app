import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import { consumeMicrosoftDraftConsent, createMicrosoftDraftConsentHandlers, isMicrosoftDraftCallback,
  MICROSOFT_DRAFT_SCOPES, type MicrosoftDraftConsentState } from "./microsoft-draft-consent";

const identity = { email: "Person@BruceGillinghamPollard.com", role: "Agent", is_active: true };
const clock = 1_800_000_000_000;
const result = () => ({ accessToken: "synthetic-access-token", scopes: ["User.Read", "Mail.ReadWrite"],
  account: { username: "person@brucegillinghampollard.com", homeAccountId: "own-account" } });
function response() {
  const res: any = { statusCode: 200, body: undefined, location: undefined, headers: {},
    set(values: any) { Object.assign(this.headers, values); return this; },
    status(value: number) { this.statusCode = value; return this; },
    json(value: unknown) { this.body = value; return this; },
    send(value: string) { this.body = value; return this; },
    type(value: string) { this.headers["Content-Type"] = value; return this; },
    redirect(value: string) { this.location = value; this.statusCode = 302; return this; },
  };
  return res;
}
function fixture() {
  let user: typeof identity | null = { ...identity };
  let tokenResult: any = result();
  let providerError: Error | undefined;
  const urls: any[] = [], exchanges: any[] = [], caches: any[] = [];
  let sessionSaves = 0;
  const req: any = { protocol: "https", query: {},
    get(name: string) { return name === "host" ? "chatbgp.app" : undefined; },
    session: { userId: "staff-one", msOAuthState: "ordinary-flow-state", msTokens: { accessToken: "old-token", expiresOn: "future" },
      save(callback: (error?: Error) => void) { sessionSaves++; callback(); } },
  };
  const handlers = createMicrosoftDraftConsentHandlers({
    getUser: async id => { assert.equal(id, "staff-one"); return user; },
    getRedirectUri: () => "https://chatbgp.app/api/microsoft/callback",
    now: () => clock,
    createClient: () => ({
      async getAuthCodeUrl(request) { urls.push(request); return "https://login.microsoftonline.com/example/authorize?state=synthetic"; },
      async acquireTokenByCode(request) { exchanges.push(request); if (providerError) throw providerError; return tokenResult; },
      getTokenCache() { return { serialize: () => "own-isolated-cache" }; },
    }),
    async saveCache(...args) { caches.push(args); },
  });
  return { req, handlers, urls, exchanges, caches, sessionSaves: () => sessionSaves,
    setUser(value: typeof identity | null) { user = value; },
    setResult(value: any) { tokenResult = value; }, setError(value: Error) { providerError = value; } };
}
async function started() {
  const f = fixture(), res = response();
  await f.handlers.start(f.req, res);
  assert.equal(res.statusCode, 200);
  f.req.query = { state: f.req.session.msDraftOAuth.state, code: "synthetic-authorization-code" };
  return f;
}

describe("explicit Outlook draft consent", () => {
  it("requests only narrow draft scopes with current staff login hint and PKCE", async () => {
    const f = await started();
    assert.deepEqual(f.urls[0].scopes, ["User.Read", "Mail.ReadWrite"]);
    assert.deepEqual(MICROSOFT_DRAFT_SCOPES, ["User.Read", "Mail.ReadWrite"]);
    assert.equal(f.urls[0].loginHint, "person@brucegillinghampollard.com");
    assert.equal(f.urls[0].prompt, "consent");
    assert.equal(f.urls[0].codeChallengeMethod, "S256");
    assert.equal(f.urls[0].codeChallenge, createHash("sha256").update(f.req.session.msDraftOAuth.codeVerifier).digest("base64url"));
    assert.equal(f.req.session.msDraftOAuth.purpose, "chat-drafts");
    assert.equal(f.req.session.msDraftOAuth.userId, "staff-one");
    assert.equal(f.req.session.msOAuthState, "ordinary-flow-state");
    assert.equal(f.sessionSaves(), 1);
  });
  it("denies unauthenticated, unknown, inactive and client users before creating an auth URL", async () => {
    for (const principal of [null, { ...identity, is_active: false }, { ...identity, role: "Client" }, { ...identity, email: "client@example.com" }]) {
      const f = fixture(), res = response(); f.setUser(principal);
      await f.handlers.start(f.req, res);
      assert.equal(res.statusCode, 403); assert.equal(f.urls.length, 0);
    }
    const f = fixture(), res = response(); delete f.req.session.userId;
    await f.handlers.start(f.req, res); assert.equal(res.statusCode, 401); assert.equal(f.urls.length, 0);
  });
  it("rejects cross-origin cookie requests to begin consent", async () => {
    const f = fixture(), res = response(); f.req.get = (name: string) => name === "origin" ? "https://other.example" : name === "host" ? "chatbgp.app" : undefined;
    await f.handlers.start(f.req, res); assert.equal(res.statusCode, 403); assert.equal(f.urls.length, 0);
  });
  it("successful callback verifies own account and scope before saving isolated cache", async () => {
    const f = await started(), res = response(), verifier = f.req.session.msDraftOAuth.codeVerifier;
    await f.handlers.callback(f.req, res);
    assert.equal(f.req.session.msDraftOAuth, undefined);
    assert.deepEqual(f.exchanges[0], { code: "synthetic-authorization-code", scopes: ["User.Read", "Mail.ReadWrite"],
      redirectUri: "https://chatbgp.app/api/microsoft/callback", codeVerifier: verifier });
    assert.deepEqual(f.caches, [["staff-one", "own-account", "own-isolated-cache"]]);
    assert.equal(f.req.session.msTokens, undefined);
    assert.equal(f.req.session.msAccountHomeId, "own-account");
    assert.match(res.body, /purpose:"chat-drafts"/);
    assert.match(res.body, /,"https:\/\/chatbgp\.app"\)/);
    assert.doesNotMatch(res.body, /synthetic-access-token|own-isolated-cache|postMessage\([^;]+,"\*"\)/);
    assert.match(res.body, /\/chatbgp\?microsoft_connected=chat-drafts/);
    assert.equal(f.sessionSaves(), 3);
  });
  it("rejects a different Microsoft account without saving anything", async () => {
    const f = await started(), res = response();
    f.setResult({ ...result(), account: { username: "other@brucegillinghampollard.com", homeAccountId: "other-account" } });
    await f.handlers.callback(f.req, res);
    assert.match(res.body, /code:"draft_consent_wrong_account"/);
    assert.equal(f.caches.length, 0); assert.equal(f.req.session.msDraftOAuth, undefined);
    assert.equal(f.req.session.msTokens.accessToken, "old-token");
  });
  it("rejects a token without Mail.ReadWrite permission", async () => {
    const f = await started(), res = response(); f.setResult({ ...result(), scopes: ["User.Read", "Mail.Read", "Mail.Send"] });
    await f.handlers.callback(f.req, res);
    assert.match(res.body, /code:"draft_consent_permission_required"/);
    assert.equal(f.caches.length, 0);
  });
  it("accepts qualified Microsoft scope names", async () => {
    const f = await started(), res = response(); f.setResult({ ...result(), scopes: ["https://graph.microsoft.com/Mail.ReadWrite"] });
    await f.handlers.callback(f.req, res); assert.equal(f.caches.length, 1);
  });
  it("rechecks active staff identity before exchanging a code", async () => {
    for (const changed of [{ ...identity, is_active: false }, { ...identity, email: "changed@brucegillinghampollard.com" }]) {
      const f = await started(), res = response(); f.setUser(changed);
      await f.handlers.callback(f.req, res);
      assert.match(res.body, /code:"draft_consent_account_changed"/);
      assert.equal(f.exchanges.length, 0); assert.equal(f.caches.length, 0);
    }
  });
  it("consumes denied callbacks and hides provider error descriptions", async () => {
    const f = await started(), res = response(); f.req.query = { state: f.req.query.state, error: "access_denied", error_description: "private-provider-detail" };
    await f.handlers.callback(f.req, res);
    assert.match(res.body, /code:"draft_consent_cancelled"/);
    assert.match(res.body, /type:"microsoft_draft_connection_failed"/);
    assert.match(res.body, /,"https:\/\/chatbgp\.app"\)/);
    assert.match(res.body, /Microsoft permission was cancelled/);
    assert.equal(f.req.session.msDraftOAuth, undefined); assert.equal(f.exchanges.length, 0);
    assert.doesNotMatch(res.body, /private-provider-detail/);
  });
  it("does not expose provider exceptions or allow callback replay", async () => {
    const f = await started(), res = response(); f.setError(new Error("sensitive code/token detail"));
    await f.handlers.callback(f.req, res);
    assert.match(res.body, /code:"draft_consent_failed"/);
    const replay = response(); await f.handlers.callback(f.req, replay);
    assert.match(replay.body, /invalid or has expired/);
    assert.doesNotMatch(replay.body, /postMessage/);
    assert.equal(f.exchanges.length, 1);
  });
});

describe("state and purpose boundaries", () => {
  const pending = (): MicrosoftDraftConsentState => ({ purpose: "chat-drafts", state: "chat-drafts." + "a".repeat(64),
    userId: "staff-one", email: "person@brucegillinghampollard.com", createdAt: clock,
    codeVerifier: "synthetic-verifier", redirectUri: "https://chatbgp.app/api/microsoft/callback" });
  it("consumes a valid state exactly once", () => {
    const value = pending(), session = { userId: "staff-one", msDraftOAuth: value };
    assert.deepEqual(consumeMicrosoftDraftConsent(session, value.state, clock), value);
    assert.equal(consumeMicrosoftDraftConsent(session, value.state, clock), null);
  });
  it("rejects wrong, missing, array and Unicode states and clears them", () => {
    for (const state of [undefined, [], "chat-drafts." + "b".repeat(64), "é".repeat(76)]) {
      const session = { userId: "staff-one", msDraftOAuth: pending() };
      assert.equal(consumeMicrosoftDraftConsent(session, state, clock), null);
      assert.equal(session.msDraftOAuth, undefined);
    }
  });
  it("rejects expired, future, wrong-user and wrong-purpose state", () => {
    for (const overrides of [{ createdAt: clock - 600_001 }, { createdAt: clock + 1 }, { userId: "another-user" }, { purpose: "files" }]) {
      const value = { ...pending(), ...overrides } as MicrosoftDraftConsentState;
      const session = { userId: "staff-one", msDraftOAuth: value };
      assert.equal(consumeMicrosoftDraftConsent(session, value.state, clock), null);
      assert.equal(session.msDraftOAuth, undefined);
    }
  });
  it("recognizes draft callbacks without capturing the ordinary OAuth flow", () => {
    assert.equal(isMicrosoftDraftCallback({ query: { state: pending().state }, session: {} } as any), true);
    assert.equal(isMicrosoftDraftCallback({ query: {}, session: { msDraftOAuth: pending() } } as any), true);
    assert.equal(isMicrosoftDraftCallback({ query: { state: "ordinary-state" }, session: { msDraftOAuth: pending() } } as any), false);
  });
});
