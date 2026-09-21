/**
 * account-folder-map.test.ts — Delivery 5, Task 2.
 *
 * Acceptance gates covered here: same-name properties resolve by stable IDs
 * (two "Bluewater" properties produce two map rows with distinct display
 * names and distinct logical bindings); a renamed SharePoint folder (stale
 * cached_path) still resolves by item id; and the bind upsert is idempotent
 * on retry (no duplicate rows after a crash/re-run).
 *
 * Pure helpers run without a DB; writers run against a mock pool spy.
 * No network, no real DB.
 *
 * Run with: node --import tsx --test server/account-folder-map.test.ts
 */
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";

let map: typeof import("./account-folder-map");
let tree: typeof import("@shared/client-folder-tree");

before(async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://test:test@localhost:1/test";
  map = await import("./account-folder-map");
  tree = await import("@shared/client-folder-tree");
});

function mockPool(handler?: (sql: string, params?: any[]) => { rows: any[] }) {
  const calls: { sql: string; params?: any[] }[] = [];
  const pool = {
    calls,
    async query(sql: string, params?: any[]) {
      calls.push({ sql, params });
      return handler ? handler(sql, params) : { rows: [] };
    },
  };
  return pool;
}

describe("buildExpectedFolderTree", () => {
  it("gives two same-named properties distinct display names and distinct logical bindings", () => {
    const nodes = tree.buildExpectedFolderTree({
      companyId: "CO-1",
      clientName: "Landsec",
      entities: [],
      properties: [
        { propertyId: "aaaaaaaa-1111-2222-3333-444455556666", name: "Bluewater" },
        { propertyId: "bbbbbbbb-1111-2222-3333-444455556666", name: "Bluewater" },
      ],
    });
    const roots = nodes.filter(n => n.logicalKey === "property");
    assert.equal(roots.length, 2);
    assert.equal(roots[0].displayName, "Bluewater — aaaaaaaa");
    assert.equal(roots[1].displayName, "Bluewater — bbbbbbbb");
    assert.notEqual(roots[0].ownerId, roots[1].ownerId);
    // Property subfolders are keyed per property id, so the two trees never collide.
    const instructions = nodes.filter(n => n.logicalKey === "property:01-instructions");
    assert.equal(instructions.length, 2);
    assert.deepEqual(
      instructions.map(n => map.nodeKey(n.ownerKind, n.ownerId, n.logicalKey)).sort(),
      [
        "property|aaaaaaaa-1111-2222-3333-444455556666|property:01-instructions",
        "property|bbbbbbbb-1111-2222-3333-444455556666|property:01-instructions",
      ].sort(),
    );
  });

  it("names entity folders with the registration ID and marks missing IDs visibly incomplete", () => {
    assert.equal(tree.entityFolderDisplayName("Pret UK", "01057547"), "Pret UK — 01057547");
    assert.equal(tree.entityFolderDisplayName("Pret UK", null), "Pret UK — no-registration");
  });

  it("emits the full logical tree: root, sections, per-entity and per-property nodes", () => {
    const nodes = tree.buildExpectedFolderTree({
      companyId: "CO-1",
      clientName: "Landsec",
      entities: [
        { entityKind: "company", entityId: "E-1", name: "Landsec SPV", companiesHouseNumber: "12345678" },
        { entityKind: "trading_entity", entityId: "T-1", name: "Landsec Trading", companiesHouseNumber: null },
      ],
      properties: [{ propertyId: "P-1", name: "Bluewater" }],
    });
    const keys = nodes.map(n => `${n.ownerKind}:${n.logicalKey}`);
    assert.ok(keys.includes("company:root"));
    assert.ok(keys.includes("company:06-commercial-restricted"));
    assert.ok(keys.includes("entity:entity"));
    assert.ok(keys.includes("entity:entity:kyc-onboarding"));
    assert.ok(keys.includes("property:property"));
    assert.ok(keys.includes("property:property:99-archive"));
    // 1 root + 7 sections + 2 entities × (1 + 2 subs) + 1 property × (1 + 5 subs)
    assert.equal(nodes.length, 1 + 7 + 2 * 3 + 6);
    const restricted = nodes.find(n => n.logicalKey === "06-commercial-restricted")!;
    assert.equal(restricted.restricted, true);
  });
});

describe("resolveNodeFolder", () => {
  it("resolves a renamed folder by item id (stale cached_path is display-only)", () => {
    const row = {
      id: "M-1", owner_kind: "property" as const, owner_id: "P-1", parent_map_id: null,
      logical_key: "property", display_name: "Bluewater — P-1".slice(0, 20),
      drive_id: "D", item_id: "I-1",
      cached_path: "/old/renamed/path", // someone renamed the folder in SharePoint
      web_url: null, bind_status: "bound" as const, bound_by: null,
    };
    const loaded = {
      byNode: new Map([[map.nodeKey("property", "P-1", "property"), row]]),
    };
    assert.deepEqual(map.resolveNodeFolder(loaded, "property", "P-1", "property"), { driveId: "D", itemId: "I-1" });
    // And the item-id side of the map still points at the same logical node.
    const byItem = new Map([["D|I-1", row]]);
    assert.equal(byItem.get("D|I-1")!.logical_key, "property");
  });

  it("never resolves conflict or missing rows", () => {
    const mk = (status: any) => ({
      byNode: new Map([[map.nodeKey("property", "P-1", "property"), {
        owner_kind: "property", owner_id: "P-1", logical_key: "property",
        drive_id: "D", item_id: "I", bind_status: status,
      } as any]]),
    });
    assert.equal(map.resolveNodeFolder(mk("conflict"), "property", "P-1", "property"), null);
    assert.equal(map.resolveNodeFolder(mk("missing"), "property", "P-1", "property"), null);
    assert.equal(map.resolveNodeFolder(mk("bound"), "property", "P-9", "property"), null);
  });
});

describe("folderNameCandidates", () => {
  it("offers the current display name plus the legacy name-only variant", () => {
    assert.deepEqual(map.folderNameCandidates({ display_name: "Bluewater — aaaaaaaa" }), ["Bluewater — aaaaaaaa", "Bluewater"]);
    assert.deepEqual(map.folderNameCandidates({ display_name: "03 Properties" }), ["03 Properties"]);
  });
});

describe("recordFolderBinding", () => {
  const base = {
    ownerKind: "property" as const, ownerId: "P-1", logicalKey: "property",
    displayName: "Bluewater — aaaaaaaa", driveId: "D", itemId: "I-1",
    webUrl: "https://sp/bluewater", boundBy: "woody",
  };

  it("upserts by (owner_kind, owner_id, logical_key) — idempotent on retry", async () => {
    const pool = mockPool();
    const first = await map.recordFolderBinding(base, "bound", { pool });
    const second = await map.recordFolderBinding(base, "bound", { pool });
    assert.deepEqual(first, { status: "bound" });
    assert.deepEqual(second, { status: "bound" });
    const inserts = pool.calls.filter(c => c.sql.includes("INSERT INTO account_folder_map"));
    assert.equal(inserts.length, 2); // both retries issue the same upsert…
    assert.ok(inserts.every(c => c.sql.includes("ON CONFLICT (owner_kind, owner_id, logical_key)")));
    // …so the table still holds exactly one row for the node.
  });

  it("flags a conflict when the physical folder is already bound to another node, without overwriting it", async () => {
    const pool = mockPool((sql) => {
      if (sql.includes("FROM account_folder_map")) {
        return { rows: [{ owner_kind: "property", owner_id: "P-2", logical_key: "property" }] };
      }
      return { rows: [] };
    });
    const result = await map.recordFolderBinding(base, "bound", { pool });
    assert.deepEqual(result, { status: "conflict" });
    const conflictUpdate = pool.calls.find(c => c.sql.includes("bind_status = 'conflict'"));
    assert.ok(conflictUpdate, "the existing claimant row is marked conflict for human resolution");
    assert.ok(!pool.calls.some(c => c.sql.includes("INSERT INTO account_folder_map")), "no binding written on conflict");
  });
});

describe("url stampers", () => {
  it("stampClientRootUrl mirrors the legacy stamper's exact update shape", async () => {
    const pool = mockPool();
    await map.stampClientRootUrl("CO-1", "https://sp/landsec", { pool });
    assert.equal(pool.calls.length, 1);
    assert.ok(pool.calls[0].sql.includes("UPDATE crm_companies SET sharepoint_folder_url = $1"));
    assert.deepEqual(pool.calls[0].params, ["https://sp/landsec", "CO-1"]);
  });

  it("stampPropertyRootUrl never overwrites an existing stored URL", async () => {
    const pool = mockPool();
    await map.stampPropertyRootUrl("P-1", "https://sp/bluewater", { pool });
    assert.equal(pool.calls.length, 1);
    assert.ok(pool.calls[0].sql.includes("sharepoint_folder_url IS NULL"));
  });
});
