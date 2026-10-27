import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { find, evaluate, ts } = require("./source-harness.cjs");
const file = "client/src/components/CompanyPropertiesBoard.tsx";
const unitsQuery = find(file, node => ts.isCallExpression(node) && node.expression.getText() === "useQuery"
  && node.arguments[0]?.getText().includes('queryKey: ["/api/leasing-schedule/company", companyId]'));

function query(status, body) {
  let request;
  const { options } = evaluate(`export const options = ${unitsQuery};`, {
    companyId: "aew", useQuery: options => options, getAuthHeaders: () => ({ Authorization: "test-session" }),
    fetch: async (url, options) => {
      request = { url, options };
      return { ok: status >= 200 && status < 300, status, json: async () => body };
    },
  });
  return { options, request: () => request };
}

const unit = { id: "unit-1", property_id: "property-1", property_name: "New Oxford Street", unit_name: "T2", status: "Occupied" };

test("company leasing query retains the server's array response and authenticated request", async () => {
  const h = query(200, [unit]);
  assert.deepEqual(await h.options.queryFn(), [unit]);
  assert.equal(h.request().url, "/api/leasing-schedule/company/aew");
  assert.equal(h.request().options.credentials, "include");
  assert.equal(h.request().options.headers.Authorization, "test-session");
});

test("HTTP error objects never become iterable leasing data", async () => {
  for (const status of [401, 403, 500]) {
    const h = query(status, { error: status === 403 ? "Not available for this account" : "Request failed" });
    await assert.rejects(h.options.queryFn(), new RegExp(`\\(${status}\\)`));
  }
  await assert.rejects(query(200, { error: "Invalid response" }).options.queryFn(), /Unexpected leasing schedule response/);
});

function properties(unitsRaw, unitsError = false) {
  const units = find(file, node => ts.isVariableDeclaration(node) && node.name.getText() === "units");
  const unavailable = find(file, node => ts.isVariableDeclaration(node) && node.name.getText() === "unitsUnavailable");
  const board = find(file, node => ts.isVariableDeclaration(node) && node.name.getText() === "boardProperties");
  return evaluate(`const ${units}; const ${unavailable}; const ${board}; export { unitsUnavailable, boardProperties };`, {
    unitsRaw, unitsError, useMemo: fn => fn(), kind: "landlord", companyId: "aew", brand: undefined,
    companyPropertyLinks: [], securedProperties: [], lrCharges: [], propertyAgentLinks: [], userIdToName: new Map(),
    propertyMap: new Map([["property-1", { id: "property-1", name: "New Oxford Street" }]]),
    allDeals: [{ id: "deal-1", propertyId: "property-1", landlordId: "aew", name: "Dough T2", status: "SOL" }],
    addressText: (address, postcode) => address || postcode || "", toNum: value => value == null ? null : Number(value),
  });
}

test("an older cached error cannot crash the properties board or hide recorded deals", () => {
  for (const bad of [{ error: "Unauthorized" }, { rows: [unit] }, null]) {
    const result = properties(bad);
    assert.equal(result.unitsUnavailable, true);
    assert.equal(result.boardProperties.length, 1);
    assert.equal(result.boardProperties[0].deals[0].id, "deal-1");
    assert.equal(result.boardProperties[0].units.length, 0);
  }
});

test("valid units still join the right property, while a failed refresh retains last successful units", () => {
  for (const failed of [false, true]) {
    const result = properties([unit], failed);
    assert.equal(result.unitsUnavailable, failed);
    assert.equal(result.boardProperties[0].units[0].id, "unit-1");
  }
  assert.equal(properties(undefined).unitsUnavailable, false, "initial loading is not an error");
});
