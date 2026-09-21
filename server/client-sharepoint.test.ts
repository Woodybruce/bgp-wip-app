/**
 * client-sharepoint.test.ts — Delivery 5, Task 5.
 *
 * Acceptance gates covered here:
 *  - resolveRoot prefers the durable account_folder_map root binding
 *    (drive/item identity, no /shares/ URL resolution) and only falls back
 *    to the legacy URL path when no binding exists or the bound item was
 *    deleted;
 *  - the property-root resolver returns the BOUND folder (never a name
 *    match), only for properties inside the caller's scoped portfolio;
 *  - the jail rejects a bound item that resolves outside the client root —
 *    it is never exposed.
 *
 * Graph and the DB are injected fakes. No network, no real DB.
 *
 * Run with: node --import tsx --test server/client-sharepoint.test.ts
 */
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";

let mod: any;

before(async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://test:test@localhost:1/test";
  mod = await import("./client-sharepoint");
});

const COMPANY_ID = "CO-1";
const PROPERTY_ID = "aaaaaaaa-1111-2222-3333-444455556666";

const ROOT_ITEM = {
  id: "ROOT", name: "Landsec", webUrl: "https://sp/root",
  parentReference: { driveId: "D1", path: "/drive/root:/BGP share drive" },
  folder: {},
};
// pathPrefix = "/drive/root:/bgp share drive/landsec"
const PROP_ITEM = {
  id: "PROP1", name: "Bluewater — aaaaaaaa", webUrl: "https://sp/prop",
  parentReference: { driveId: "D1", path: "/drive/root:/BGP share drive/Landsec/03 Properties" },
  folder: {},
};
const OUTSIDE_ITEM = {
  id: "PROP9", name: "Elsewhere", webUrl: "https://sp/elsewhere",
  parentReference: { driveId: "D1", path: "/drive/root:/OtherTenant" },
  folder: {},
};

function fakePool(handlers: { mapRows?: any[]; folderMapRows?: any[]; urlRows?: any[] }) {
  const queries: string[] = [];
  return {
    queries,
    async query(sql: string, _params?: any[]) {
      queries.push(sql);
      if (/FROM account_folder_map/.test(sql) && /logical_key = 'root'/.test(sql)) return { rows: handlers.mapRows || [] };
      if (/FROM account_folder_map/.test(sql)) return { rows: handlers.folderMapRows || [] };
      if (/FROM crm_companies/.test(sql)) return { rows: handlers.urlRows || [] };
      throw new Error(`unexpected SQL: ${sql}`);
    },
  };
}

function fakeGraph(items: Record<string, any>) {
  const calls: string[] = [];
  const get = async (path: string) => {
    calls.push(path);
    const m = path.match(/\/drives\/[^/]+\/items\/([^?]+)/);
    if (m && items[m[1]] !== undefined) return items[m[1]];
    if (path.startsWith("/shares/")) return items.__share ?? null;
    return null;
  };
  return { calls, get };
}

describe("resolveRoot", () => {
  it("prefers the durable root binding — no /shares/ URL resolution", async () => {
    const pool = fakePool({ mapRows: [{ drive_id: "D1", item_id: "ROOT" }], urlRows: [{ sharepoint_folder_url: "https://legacy" }] });
    const graph = fakeGraph({ ROOT: ROOT_ITEM });
    const ref = await mod.resolveRoot(COMPANY_ID, { pool, graphGet: graph.get, cache: new Map() });
    assert.equal(ref.driveId, "D1");
    assert.equal(ref.itemId, "ROOT");
    assert.equal(ref.pathPrefix, "/drive/root:/bgp share drive/landsec");
    assert.equal(graph.calls.some(c => c.startsWith("/shares/")), false);
    assert.equal(pool.queries.some(q => /sharepoint_folder_url/.test(q)), false);
  });

  it("caches the resolved root for the TTL", async () => {
    const pool = fakePool({ mapRows: [{ drive_id: "D1", item_id: "ROOT" }] });
    const graph = fakeGraph({ ROOT: ROOT_ITEM });
    const cache = new Map();
    await mod.resolveRoot(COMPANY_ID, { pool, graphGet: graph.get, cache });
    await mod.resolveRoot(COMPANY_ID, { pool, graphGet: graph.get, cache });
    assert.equal(pool.queries.length, 1);
    assert.equal(graph.calls.length, 1);
  });

  it("falls back to legacy URL resolution when the binding's item is gone", async () => {
    const pool = fakePool({ mapRows: [{ drive_id: "D1", item_id: "ROOT" }], urlRows: [{ sharepoint_folder_url: "https://legacy" }] });
    const graph = fakeGraph({ ROOT: null, __share: { ...ROOT_ITEM, id: "ROOT2" } });
    const ref = await mod.resolveRoot(COMPANY_ID, { pool, graphGet: graph.get, cache: new Map() });
    assert.equal(ref.itemId, "ROOT2");
    assert.equal(graph.calls.some(c => c.startsWith("/shares/")), true);
  });

  it("uses legacy URL resolution when no binding exists", async () => {
    const pool = fakePool({ mapRows: [], urlRows: [{ sharepoint_folder_url: "https://legacy" }] });
    const graph = fakeGraph({ __share: ROOT_ITEM });
    const ref = await mod.resolveRoot(COMPANY_ID, { pool, graphGet: graph.get, cache: new Map() });
    assert.equal(ref.itemId, "ROOT");
    assert.equal(graph.calls.some(c => c.startsWith("/shares/")), true);
  });

  it("returns null when neither binding nor URL exists", async () => {
    const pool = fakePool({ mapRows: [], urlRows: [] });
    const graph = fakeGraph({});
    const ref = await mod.resolveRoot(COMPANY_ID, { pool, graphGet: graph.get, cache: new Map() });
    assert.equal(ref, null);
    assert.equal(graph.calls.length, 0);
  });
});

function fakeViewWithProperty() {
  const root = {
    companyId: COMPANY_ID, name: "Landsec", companyType: null, companiesHouseNumber: null,
    relation: "self", relationConfidence: "confirmed", evidence: "test",
  };
  return {
    root, entities: [root],
    properties: [{
      propertyId: PROPERTY_ID, name: "Bluewater", postcode: null, country: null,
      relationshipRole: "owner", ownershipStakePct: null, owningEntityId: COMPANY_ID,
      confidence: "confirmed", sources: ["landlord_id"], unitCount: 0,
    }],
    instructions: [], relatedMarketActivity: [], contacts: [], team: [],
    totals: { deals: 0, completedDeals: 0 },
  };
}

function propertyBindingRow(itemId: string) {
  return {
    id: "map-1", owner_kind: "property", owner_id: PROPERTY_ID, parent_map_id: null,
    logical_key: "property", display_name: "Bluewater — aaaaaaaa",
    drive_id: "D1", item_id: itemId, cached_path: null, web_url: "https://sp/prop",
    bind_status: "bound", bound_by: "user-1",
  };
}

describe("resolveBoundPropertyRoot", () => {
  const rootDeps = () => ({
    mapRows: [{ drive_id: "D1", item_id: "ROOT" }],
  });

  it("returns the bound folder for a portfolio property (never a name match)", async () => {
    const pool = fakePool({ ...rootDeps(), folderMapRows: [propertyBindingRow("PROP1")] });
    const graph = fakeGraph({ ROOT: ROOT_ITEM, PROP1: PROP_ITEM });
    const bound = await mod.resolveBoundPropertyRoot(COMPANY_ID, PROPERTY_ID, {
      pool, graphGet: graph.get, cache: new Map(), view: fakeViewWithProperty(),
    });
    assert.deepEqual(bound, { id: "PROP1", name: "Bluewater — aaaaaaaa", webUrl: "https://sp/prop" });
  });

  it("jail rejection: a binding whose item resolves outside the client root is never exposed", async () => {
    const pool = fakePool({ ...rootDeps(), folderMapRows: [propertyBindingRow("PROP9")] });
    const graph = fakeGraph({ ROOT: ROOT_ITEM, PROP9: OUTSIDE_ITEM });
    const bound = await mod.resolveBoundPropertyRoot(COMPANY_ID, PROPERTY_ID, {
      pool, graphGet: graph.get, cache: new Map(), view: fakeViewWithProperty(),
    });
    assert.equal(bound, null);
  });

  it("returns null when the property is outside the scoped portfolio", async () => {
    const pool = fakePool({ ...rootDeps(), folderMapRows: [propertyBindingRow("PROP1")] });
    const graph = fakeGraph({ ROOT: ROOT_ITEM, PROP1: PROP_ITEM });
    const bound = await mod.resolveBoundPropertyRoot(COMPANY_ID, "not-my-property", {
      pool, graphGet: graph.get, cache: new Map(), view: fakeViewWithProperty(),
    });
    assert.equal(bound, null);
    // Nothing was fetched from Graph — the scope check happens first.
    assert.equal(graph.calls.length, 0);
  });

  it("returns null when no binding exists (UI falls back to the legacy match)", async () => {
    const pool = fakePool({ ...rootDeps(), folderMapRows: [] });
    const graph = fakeGraph({ ROOT: ROOT_ITEM });
    const bound = await mod.resolveBoundPropertyRoot(COMPANY_ID, PROPERTY_ID, {
      pool, graphGet: graph.get, cache: new Map(), view: fakeViewWithProperty(),
    });
    assert.equal(bound, null);
  });
});
