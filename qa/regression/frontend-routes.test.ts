import assert from "node:assert/strict";
import { after, test } from "node:test";
import { readFileSync } from "node:fs";

const storage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
Object.assign(globalThis, { window: { localStorage: storage, innerWidth: 390 }, localStorage: storage });
const { DEAL_TAB_ROUTES, getTabFromLocation } = await import("../../client/src/pages/deals-hub");
const { queryClient } = await import("../../client/src/lib/queryClient");
after(() => queryClient.clear());

test("every explicit Deals tab URL restores the selected tab, including the phone WIP report", () => {
  for (const [tab, path] of Object.entries(DEAL_TAB_ROUTES)) {
    assert.equal(getTabFromLocation(path), tab, path);
  }
  assert.equal(DEAL_TAB_ROUTES["wip-report"], "/deals/report");
  assert.equal(getTabFromLocation("/deals"), null);
  assert.equal(getTabFromLocation("/wip-report"), "wip-report");
});

test("the client mobile profile destination is explicitly permitted by the route guard", () => {
  const mobile = readFileSync(new URL("../../client/src/components/mobile-app.tsx", import.meta.url), "utf8");
  const app = readFileSync(new URL("../../client/src/App.tsx", import.meta.url), "utf8");
  const profile = mobile.match(/navigate\(currentUser\?\.role === "Client" \? "([^"]+)" : "([^"]+)"\)/);
  assert.ok(profile);
  const allowedRoutes = app.match(/const CLIENT_ALLOWED_ROUTES = \[([\s\S]*?)\];/)![1];
  assert.ok(allowedRoutes.includes(`"${profile[1]}"`));
  assert.equal(profile[2], "/m/profile");
});
