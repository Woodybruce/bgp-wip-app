import assert from "node:assert/strict";
import { after, test } from "node:test";

// Run: node --import tsx --test qa/regression/frontend*.test.ts
// Synthetic browser state and fetch only; never start the application server.
const values = new Map<string, string>();
const storage = {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => values.set(key, String(value)),
  removeItem: (key: string) => values.delete(key),
};
Object.assign(globalThis, { window: { localStorage: storage }, localStorage: storage });

let currentUser: any = { id: "A", role: "Staff" };
globalThis.fetch = async (input) => {
  const path = String(input);
  let status = 200;
  let body: unknown;
  if (path === "/api/auth/me") {
    status = currentUser ? 200 : 401;
    body = currentUser || { message: "Not authenticated" };
  } else if (path === "/api/heartbeat") {
    status = 401;
    body = { message: "Not authenticated" };
  } else if (path === "/api/chat/threads") {
    status = 403;
    body = { message: "Not permitted" };
  } else {
    throw new Error(`Unexpected mock request: ${path}`);
  }
  const response = new Response(JSON.stringify(body), { status });
  Object.defineProperty(response, "url", { value: `https://mock.invalid${path}` });
  return response;
};

const { QueryClient, QueryObserver, dehydrate } = await import("@tanstack/react-query");
const { persistQueryClientRestore } = await import("@tanstack/react-query-persist-client");
const { queryClient, apiRequest, getQueryFn, isSessionVerified, refreshSession, subscribeSessionVerification, getSessionVerificationSnapshot, sessionIdentity } = await import("../../client/src/lib/queryClient");
const { persistOptions, clearPersistedQueries, QUERY_PERSIST_KEY } = await import("../../client/src/lib/query-persist");
// Disable only the day-long GC timers so cancelled queries cannot keep the
// Node test process alive; cache/auth/refetch behavior is otherwise unchanged.
queryClient.setDefaultOptions({ ...queryClient.getDefaultOptions(), queries: { ...queryClient.getDefaultOptions().queries, gcTime: Infinity } });
const authKey = ["/api/auth/me"];
const privateKey = ["/api/chat/threads"];
const privateData = [{ id: "A-thread", title: "Synthetic private discussion" }];
const fetchAuth = () => queryClient.fetchQuery({ queryKey: authKey, queryFn: getQueryFn({ on401: "returnNull" }), staleTime: 0, retry: false });

async function eventually(predicate: () => boolean) {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.fail("Timed out waiting for mock auth probe");
}

after(() => {
  queryClient.clear();
  clearPersistedQueries();
});

test("pre-brand-link agent payloads are discarded on persisted-cache restore", async () => {
  assert.ok(persistOptions);
  const legacyClient = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  const freshClient = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  const agentKey = ["/api/client/agent-directory"];
  legacyClient.setQueryData(agentKey, [{ id: "agency", name: "Legacy agency", contacts: [], represents: [{ brandId: "brand", brandName: "Brand", region: null }] }]);
  clearPersistedQueries();
  storage.setItem(QUERY_PERSIST_KEY, JSON.stringify({ timestamp: Date.now(), buster: "bgp-q2", clientState: dehydrate(legacyClient) }));
  try {
    await persistQueryClientRestore({ queryClient: freshClient, ...persistOptions });
    assert.equal(freshClient.getQueryData(agentKey), undefined);
    assert.equal(storage.getItem(QUERY_PERSIST_KEY), null);
  } finally {
    legacyClient.clear();
    freshClient.clear();
    clearPersistedQueries();
  }
});

test("same-user hydration notifies verification even when React Query emits no tracked-prop change", async () => {
  queryClient.setQueryData(authKey, currentUser);
  queryClient.setQueryData(privateKey, privateData);
  const observer = new QueryObserver(queryClient, {
    queryKey: authKey,
    refetchOnMount: false,
    notifyOnChangeProps: ["data", "isLoading", "isError"],
  });
  let queryNotifications = 0;
  const verificationSnapshots: Array<string | null | undefined> = [];
  const unsubscribeQuery = observer.subscribe(() => { queryNotifications++; });
  const unsubscribeVerification = subscribeSessionVerification(() => verificationSnapshots.push(getSessionVerificationSnapshot()));
  const restoredUser = observer.getCurrentResult().data;
  try {
    assert.equal(isSessionVerified(currentUser), false);
    assert.equal(getSessionVerificationSnapshot(), undefined);
    await fetchAuth();
    assert.equal(observer.getCurrentResult().data, restoredUser, "structural sharing keeps the restored object");
    assert.equal(queryNotifications, 0, "App's tracked query props do not trigger a render");
    assert.deepEqual(verificationSnapshots, [sessionIdentity(currentUser)], "the external store triggers the missing render/effect");
    assert.equal(isSessionVerified(currentUser), true);
    assert.deepEqual(queryClient.getQueryData(privateKey), privateData);
  } finally {
    unsubscribeVerification();
    unsubscribeQuery();
  }
});

test("expiry clears private observer data; another login and a denied refetch cannot recover it", async () => {
  const observer = new QueryObserver(queryClient, { queryKey: privateKey, enabled: false });
  const unsubscribe = observer.subscribe(() => {});
  try {
    assert.deepEqual(observer.getCurrentResult().data, privateData);
    storage.setItem(QUERY_PERSIST_KEY, "old private snapshot");
    currentUser = null;
    await assert.rejects(apiRequest("POST", "/api/heartbeat"), /401:/);
    await eventually(() => queryClient.getQueryData(authKey) === null);
    assert.equal(storage.getItem(QUERY_PERSIST_KEY), null);
    assert.equal(queryClient.getQueryData(privateKey), undefined);
    assert.equal(observer.getCurrentResult().data, undefined);

    currentUser = { id: "B", role: "Client", companyScopeId: "client-B" };
    storage.setItem("bgp_auth_token", "synthetic-B");
    await refreshSession();
    assert.equal(isSessionVerified(currentUser), true);
    assert.equal(queryClient.getQueryData(privateKey), undefined);
    await assert.rejects(queryClient.fetchQuery({ queryKey: privateKey, retry: false }), /403:/);
    assert.equal(queryClient.getQueryData(privateKey), undefined);
  } finally { unsubscribe(); }
});

test("direct identity changes and narrower company scopes clear previous responses", async () => {
  queryClient.setQueryData(privateKey, privateData);
  currentUser = { id: "C", role: "Staff" };
  await fetchAuth();
  assert.equal(queryClient.getQueryData(privateKey), undefined);
  queryClient.setQueryData(privateKey, privateData);
  currentUser = { ...currentUser, companyScopeId: "client-C" };
  await fetchAuth();
  assert.equal(queryClient.getQueryData(privateKey), undefined);
});

test("an in-flight previous-user response cannot repopulate a cleared cache", async () => {
  queryClient.setQueryData(privateKey, privateData);
  let resolveOld!: (value: typeof privateData) => void;
  const oldRequest = queryClient.fetchQuery({
    queryKey: privateKey,
    staleTime: 0,
    queryFn: () => new Promise<typeof privateData>(resolve => { resolveOld = resolve; }),
  }).catch(() => undefined);
  currentUser = { id: "D", role: "Staff" };
  await refreshSession();
  resolveOld(privateData);
  await oldRequest;
  assert.equal(queryClient.getQueryData(privateKey), undefined);
});

test("a cancelled old auth response cannot clear the new user's confirmed cache", async () => {
  const mockFetch = globalThis.fetch;
  let releaseOld!: (response: Response) => void;
  let first = true;
  globalThis.fetch = (input, options) => {
    if (String(input) === "/api/auth/me" && first) {
      first = false;
      return new Promise<Response>(resolve => { releaseOld = resolve; });
    }
    return mockFetch(input, options);
  };
  try {
    const oldProbe = fetchAuth().catch(() => undefined);
    currentUser = { id: "E", role: "Staff" };
    await refreshSession();
    const newData = [{ id: "E-thread", title: "New user's discussion" }];
    queryClient.setQueryData(privateKey, newData);
    releaseOld(new Response(JSON.stringify({ id: "D", role: "Staff" })));
    await oldProbe;
    assert.equal(isSessionVerified(currentUser), true);
    assert.deepEqual(queryClient.getQueryData(privateKey), newData);
  } finally { globalThis.fetch = mockFetch; }
});

test("clearing persistence cancels a queued snapshot instead of writing it back after logout", async () => {
  assert.ok(persistOptions);
  queryClient.setQueryData(privateKey, privateData);
  await persistOptions.persister.persistClient({
    timestamp: Date.now(),
    buster: persistOptions.buster!,
    clientState: dehydrate(queryClient),
  });
  clearPersistedQueries();
  await new Promise(resolve => setTimeout(resolve, 2050));
  assert.equal(storage.getItem(QUERY_PERSIST_KEY), null);
});
