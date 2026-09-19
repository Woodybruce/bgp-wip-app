import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

const values = new Map<string, string>();
const storage = {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => values.set(key, String(value)),
  removeItem: (key: string) => values.delete(key),
};
Object.assign(globalThis, { window: { localStorage: storage }, localStorage: storage });
const { queryClient } = await import("../../client/src/lib/queryClient");
const { clearPersistedQueries } = await import("../../client/src/lib/query-persist");
const { createTeamSwitcher } = await import("../../client/src/lib/team-context");
queryClient.setDefaultOptions({ ...queryClient.getDefaultOptions(), queries: { ...queryClient.getDefaultOptions().queries, gcTime: Infinity } });

function response(status = 200) {
  return new Response(JSON.stringify(status === 200 ? { ok: true } : { message: "Synthetic save failed" }), { status });
}
function setup() {
  let userId: string | null = "staff-A";
  let serverTeam: string | null = "Landsec";
  const confirmed: string[] = [];
  const errors: unknown[] = [];
  queryClient.setQueryData(["/api/auth/me"], { id: userId, canViewAsClient: true });
  values.clear();
  values.set("bgp_active_team_staff-A", "Landsec");
  return {
    confirmed,
    errors,
    switchTeam: createTeamSwitcher({
      getUserId: () => userId,
      onConfirmed: team => confirmed.push(team),
      onError: error => errors.push(error),
    }),
    setUser: (id: string) => { userId = id; },
    mock: (write: typeof fetch) => {
      globalThis.fetch = async (input, options) => {
        if (String(input) === "/api/auth/me") {
          return new Response(JSON.stringify({ id: userId, activeTeam: serverTeam, canViewAsClient: true }));
        }
        const result = await write(input, options);
        if (result.ok && String(input) === "/api/auth/active-team") {
          const team = JSON.parse(String(options?.body)).team;
          serverTeam = team === "all" ? null : team;
        }
        return result;
      };
    },
  };
}
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
afterEach(() => { queryClient.clear(); clearPersistedQueries(); });

test("HTTP failure preserves the confirmed team and reports the failure", async () => {
  const state = setup();
  state.mock(async () => response(429));
  assert.equal(await state.switchTeam("all"), false);
  assert.deepEqual(state.confirmed, ["Landsec"]);
  assert.equal(storage.getItem("bgp_active_team_staff-A"), "Landsec");
  assert.equal(state.errors.length, 1);
});

test("rapid selections are sent serially and the last successful choice wins", async () => {
  const state = setup();
  const requests: string[] = [];
  let releaseFirst!: () => void;
  state.mock(async (_input, options) => {
    const team = JSON.parse(String(options?.body)).team;
    requests.push(team);
    if (requests.length === 1) await new Promise<void>(resolve => { releaseFirst = resolve; });
    return response();
  });
  const first = state.switchTeam("Investment");
  const second = state.switchTeam("all");
  await tick();
  assert.deepEqual(requests, ["Investment"]);
  assert.deepEqual(state.confirmed, []);
  releaseFirst();
  assert.deepEqual(await Promise.all([first, second]), [true, true]);
  assert.deepEqual(requests, ["Investment", "all"]);
  assert.deepEqual(state.confirmed, ["Investment", "all"]);
  assert.equal(storage.getItem("bgp_active_team_staff-A"), "all");
});

test("exit completes both server writes in order and updates the per-user selection", async () => {
  const state = setup();
  const requests: string[] = [];
  let releaseMode!: () => void;
  state.mock(async (input) => {
    requests.push(String(input));
    if (requests.length === 1) await new Promise<void>(resolve => { releaseMode = resolve; });
    return response();
  });
  const exit = state.switchTeam("all", true);
  await tick();
  assert.deepEqual(requests, ["/api/auth/client-view-mode"]);
  releaseMode();
  assert.equal(await exit, true);
  assert.deepEqual(requests, ["/api/auth/client-view-mode", "/api/auth/active-team"]);
  assert.deepEqual(state.confirmed, ["all"]);
  assert.equal(storage.getItem("bgp_active_team_staff-A"), "all");
  assert.equal(storage.getItem("bgp_active_team"), null);
});

test("failed client-view exit does not proceed to a misleading team change", async () => {
  const state = setup();
  const requests: string[] = [];
  state.mock(async (input) => { requests.push(String(input)); return response(403); });
  assert.equal(await state.switchTeam("all", true), false);
  assert.deepEqual(requests, ["/api/auth/client-view-mode"]);
  assert.deepEqual(state.confirmed, ["Landsec"]);
  assert.equal(storage.getItem("bgp_active_team_staff-A"), "Landsec");
});

test("queued changes belonging to a previous login do not update the new account", async () => {
  const state = setup();
  let calls = 0;
  let release!: () => void;
  state.mock(async () => {
    calls++;
    await new Promise<void>(resolve => { release = resolve; });
    return response();
  });
  const first = state.switchTeam("Investment");
  const second = state.switchTeam("all");
  await tick();
  state.setUser("staff-B");
  release();
  assert.deepEqual(await Promise.all([first, second]), [false, false]);
  assert.equal(calls, 1);
  assert.deepEqual(state.confirmed, []);
  assert.equal(storage.getItem("bgp_active_team_staff-B"), null);
});

test("failed scope verification clears old data and does not poison the next queued change", async () => {
  const state = setup();
  queryClient.setQueryData(["/api/chat/threads"], [{ id: "old-scope-private-thread" }]);
  state.mock(async () => response());
  const mockFetch = globalThis.fetch;
  let failures = 2;
  globalThis.fetch = (input, options) => {
    if (String(input) === "/api/auth/me" && failures-- > 0) return Promise.resolve(response(403));
    return mockFetch(input, options);
  };
  const first = state.switchTeam("Investment");
  const second = state.switchTeam("all");
  assert.deepEqual(await Promise.all([first, second]), [false, true]);
  assert.equal(queryClient.getQueryData(["/api/chat/threads"]), undefined);
  assert.deepEqual(state.confirmed, ["all"]);
  assert.equal(state.errors.length, 1);
});
