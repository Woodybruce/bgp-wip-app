/**
 * client-folder-jobs.test.ts — Delivery 5, Task 4.
 *
 * Acceptance gates covered here:
 *  (a) mid-job crash resume — a re-run skips every bound|created node
 *      (the Graph create spy is never called for them, so no duplicate
 *      tree is created) and completes the rest;
 *  (b) a failing create (429-style) fails ONLY that subtree, the job ends
 *      `failed` with exactly those nodes in failedNodes, and a retry
 *      re-attempts just the failed nodes and finishes `done`;
 *  (c) a second run while the first holds the advisory lock is a no-op
 *      ({ ran:false, reason:"already_running" });
 *  (d) the wire shape keeps the legacy poller fields (status/startedAt/
 *      companyName/properties/created/errors/total/message) plus
 *      failedNodes, and a stale running lease projects as a resumable
 *      failure.
 *
 * Store is an in-memory ClientFolderJobStore fake; Graph is a stubbed
 * ClientFolderGraph; the DB is a stateful mock pool over a fake
 * account_folder_map table. resolveAccountView is bypassed via deps.view.
 * No network, no real DB.
 *
 * Run with: node --import tsx --test server/client-folder-jobs.test.ts
 */
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";

let jobs: typeof import("./client-folder-jobs");
let treeMod: typeof import("@shared/client-folder-tree");

before(async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://test:test@localhost:1/test";
  jobs = await import("./client-folder-jobs");
  treeMod = await import("@shared/client-folder-tree");
});

const COMPANY_ID = "CO-1";
const PROPERTY_ID = "aaaaaaaa-1111-2222-3333-444455556666";

function fakeView() {
  const root = {
    companyId: COMPANY_ID, name: "Landsec", companyType: null, companiesHouseNumber: "00000001",
    relation: "self" as const, relationConfidence: "confirmed" as const, evidence: "test",
  };
  return {
    root,
    entities: [root],
    properties: [{
      propertyId: PROPERTY_ID, name: "Bluewater", postcode: null, country: null,
      relationshipRole: "owner" as const, ownershipStakePct: null, owningEntityId: COMPANY_ID,
      confidence: "confirmed" as const, sources: ["landlord_id"], unitCount: 0,
    }],
    instructions: [], relatedMarketActivity: [], contacts: [], team: [],
    totals: { deals: 0, completedDeals: 0 },
  };
}

// ─── In-memory store ─────────────────────────────────────────────────────

function memStore(initial?: import("./client-folder-jobs").ClientFolderJobState) {
  let state = initial ?? null;
  let locked = false;
  const store: import("./client-folder-jobs").ClientFolderJobStore & { current: () => typeof state } = {
    async tryLock() { if (locked) return false; locked = true; return true; },
    async read() { return state ? JSON.parse(JSON.stringify(state)) : null; },
    async save(s) { state = JSON.parse(JSON.stringify(s)); },
    async unlock() { locked = false; },
    close() {},
    current: () => state,
  };
  return store;
}

// ─── Stubbed Graph ───────────────────────────────────────────────────────

function graphStub(opts: {
  rootExists?: boolean;
  physical?: Record<string, { id: string; name: string }[]>; // itemId -> child folders
  failOnNames?: Set<string>;                                  // createFolder fails for these display names
  gate?: { promise: Promise<void>; entered: () => void };     // blocks first createFolder until released
} = {}) {
  const creates: { driveId: string; parentItemId: string; name: string }[] = [];
  let ensureRootCalls = 0;
  let resolveRootCalls = 0;
  let gated = false;
  const physical = opts.physical || {};
  const graph: import("./client-folder-jobs").ClientFolderGraph & {
    creates: typeof creates; ensureRootCalls: () => number; resolveRootCalls: () => number;
  } = {
    creates,
    ensureRootCalls: () => ensureRootCalls,
    resolveRootCalls: () => resolveRootCalls,
    async resolveRoot() {
      resolveRootCalls++;
      if (opts.rootExists === false) return null;
      return {
        source: "path" as const,
        ref: { driveId: "D1", itemId: "ROOT", name: "Landsec", webUrl: "https://sp/root", fullPath: "" },
      };
    },
    async ensureRoot(name: string) {
      ensureRootCalls++;
      return { driveId: "D1", itemId: "ROOT", name, webUrl: "https://sp/root", fullPath: "" };
    },
    async listChildren(_driveId: string, itemId: string) {
      return {
        items: (physical[itemId] || []).map(c => ({ id: c.id, name: c.name, folder: {}, webUrl: `https://sp/${c.id}` })),
        capped: false,
      };
    },
    async createFolder(driveId: string, parentItemId: string, name: string) {
      if (opts.gate && !gated) { gated = true; opts.gate.entered(); await opts.gate.promise; }
      creates.push({ driveId, parentItemId, name });
      if (opts.failOnNames?.has(name)) return { success: false, error: "429 throttled" };
      const id = `item:${parentItemId}/${name}`;
      return { success: true, item: { id, webUrl: `https://sp/${encodeURIComponent(name)}` } };
    },
  };
  return graph;
}

// ─── Stateful mock pool over a fake account_folder_map ───────────────────

function mapPool(store: ReturnType<typeof memStore>) {
  const rows: any[] = [];
  const calls: { sql: string; params?: any[] }[] = [];
  const propertyStamps: { propertyId: string; webUrl: string }[] = [];
  const clientStamps: { companyId: string; webUrl: string }[] = [];
  const pool = {
    rows, calls, propertyStamps, clientStamps,
    async query(sql: string, params?: any[]) {
      calls.push({ sql, params });
      if (/FROM system_settings/.test(sql)) {
        return { rows: store.current() ? [{ value: store.current() }] : [] };
      }
      if (/FROM account_folder_map\s+WHERE drive_id/.test(sql)) {
        return { rows: rows.filter(r => r.drive_id === params![0] && r.item_id === params![1]) };
      }
      if (/FROM account_folder_map/.test(sql)) {
        const [companyId, entityIds, propertyIds] = params!;
        return {
          rows: rows.filter(r =>
            (r.owner_kind === "company" && r.owner_id === companyId) ||
            (r.owner_kind === "entity" && (entityIds || []).includes(r.owner_id)) ||
            (r.owner_kind === "property" && (propertyIds || []).includes(r.owner_id))),
        };
      }
      if (/INSERT INTO account_folder_map/.test(sql)) {
        const [owner_kind, owner_id, parent_map_id, logical_key, display_name,
          drive_id, item_id, cached_path, web_url, bind_status, bound_by] = params!;
        const existing = rows.find(r => r.owner_kind === owner_kind && r.owner_id === owner_id && r.logical_key === logical_key);
        if (existing) {
          Object.assign(existing, { drive_id, item_id, display_name, cached_path, web_url, bind_status, bound_by });
        } else {
          rows.push({
            id: `map-${rows.length + 1}`, owner_kind, owner_id, parent_map_id, logical_key,
            display_name, drive_id, item_id, cached_path, web_url, bind_status, bound_by,
          });
        }
        return { rows: [] };
      }
      if (/UPDATE account_folder_map/.test(sql)) {
        const [owner_kind, owner_id, logical_key] = params!;
        for (const r of rows) {
          if (r.owner_kind === owner_kind && r.owner_id === owner_id && r.logical_key === logical_key) r.bind_status = "conflict";
        }
        return { rows: [] };
      }
      if (/UPDATE crm_companies SET sharepoint_folder_url/.test(sql)) {
        clientStamps.push({ webUrl: params![0], companyId: params![1] });
        return { rows: [] };
      }
      if (/UPDATE crm_properties SET sharepoint_folder_url/.test(sql)) {
        propertyStamps.push({ webUrl: params![0], propertyId: params![1] });
        return { rows: [] };
      }
      throw new Error(`unexpected SQL: ${sql}`);
    },
  };
  return pool;
}

// The full expected node set for fakeView(): root + 7 sections + property
// root + 5 property subfolders = 14.
const TOTAL_NODES = 14;
const PROP_NAME = `Bluewater — ${PROPERTY_ID.slice(0, 8)}`;

async function runOnce(store: ReturnType<typeof memStore>, pool: any, graph: any, extra: Partial<Parameters<typeof jobs.runClientFolderJob>[0]> = {}) {
  return jobs.runClientFolderJob(
    { companyId: COMPANY_ID, userId: "user-1", ...extra },
    { store, pool, graph, view: fakeView() as any },
  );
}

describe("runClientFolderJob", () => {
  it("creates the full tree on a clean run, binds the root first, and stamps root + property URLs", async () => {
    const store = memStore();
    const pool = mapPool(store);
    const graph = graphStub();
    const { ran, state } = await runOnce(store, pool, graph);

    assert.equal(ran, true);
    assert.equal(state!.status, "done");
    assert.equal(state!.total, TOTAL_NODES);
    assert.equal(state!.nodes.every(n => n.status === "bound" || n.status === "created"), true);
    // Root bound from the existing physical root — never created.
    const root = state!.nodes.find(n => n.logicalKey === "root")!;
    assert.equal(root.status, "bound");
    assert.equal(root.itemId, "ROOT");
    assert.equal(graph.ensureRootCalls(), 0);
    // Every other node was created exactly once, parent before child.
    assert.equal(graph.creates.length, TOTAL_NODES - 1);
    const sectionIdx = graph.creates.findIndex(c => c.name === "03 Properties");
    const propIdx = graph.creates.findIndex(c => c.name.startsWith("Bluewater — "));
    const subIdx = graph.creates.findIndex(c => c.name === "01 Instructions & appointments");
    assert.ok(sectionIdx !== -1 && propIdx !== -1 && subIdx !== -1);
    assert.ok(sectionIdx < propIdx && propIdx < subIdx);
    // The property folder was created INSIDE the section's created item.
    assert.equal(graph.creates[propIdx].parentItemId, "item:ROOT/03 Properties");
    assert.ok(graph.creates[subIdx].parentItemId.endsWith(PROP_NAME));
    // Stamps mirror the legacy behaviour.
    assert.deepEqual(pool.clientStamps, [{ webUrl: "https://sp/root", companyId: COMPANY_ID }]);
    assert.equal(pool.propertyStamps.length, 1);
    assert.equal(pool.propertyStamps[0].propertyId, PROPERTY_ID);
    // Durable map rows exist for every node.
    assert.equal(pool.rows.length, TOTAL_NODES);
  });

  it("(a) resumes a crashed run: bound|created nodes are never re-created, no duplicates", async () => {
    // First run dies mid-flight: simulate by pre-seeding the state the crash
    // left behind — root bound, sections created, property tree pending —
    // plus the matching map rows (the store row is the resume point).
    const seededStore = memStore();
    const pool = mapPool(seededStore);
    const expected = treeMod.buildExpectedFolderTree({
      companyId: COMPANY_ID, clientName: "Landsec", entities: [],
      properties: [{ propertyId: PROPERTY_ID, name: "Bluewater" }],
    });
    const seededNodes = expected.map(e => {
      const isSection = e.treePath.length === 2;
      const isRoot = e.logicalKey === "root";
      return {
        logicalKey: e.logicalKey, ownerKind: e.ownerKind, ownerId: e.ownerId,
        displayName: e.displayName, treePath: e.treePath,
        status: isRoot ? ("bound" as const) : isSection ? ("created" as const) : ("pending" as const),
        driveId: isRoot || isSection ? "D1" : undefined,
        itemId: isRoot ? "ROOT" : isSection ? `item:ROOT/${e.displayName}` : undefined,
        webUrl: isRoot ? "https://sp/root" : isSection ? `https://sp/${e.displayName}` : undefined,
      };
    });
    const seededStartedAt = Date.now() - 300_000;
    await seededStore.save({
      status: "running", companyId: COMPANY_ID, companyName: "Landsec",
      claim: "dead-claim", leaseUntil: new Date(Date.now() - 60_000).toISOString(), // lease lapsed = crashed
      startedAt: seededStartedAt, properties: 1, total: TOTAL_NODES, nodes: seededNodes,
    });
    // The crashed run had already persisted map rows for the root + sections.
    for (const n of seededNodes.filter(n => n.status !== "pending")) {
      pool.rows.push({
        id: `map-seed-${n.logicalKey}`, owner_kind: n.ownerKind, owner_id: n.ownerId,
        parent_map_id: null, logical_key: n.logicalKey, display_name: n.displayName,
        drive_id: n.driveId, item_id: n.itemId, cached_path: null,
        web_url: n.webUrl, bind_status: n.status, bound_by: "user-1",
      });
    }

    const graph = graphStub();
    const { ran, state } = await runOnce(seededStore, pool, graph);

    assert.equal(ran, true);
    assert.equal(state!.status, "done");
    // Only the 6 property nodes were created — the 7 sections + root untouched.
    assert.equal(graph.creates.length, 6);
    assert.equal(graph.creates.some(c => c.name === "03 Properties"), false);
    assert.equal(graph.resolveRootCalls(), 0, "bound root is never re-resolved");
    assert.equal(graph.ensureRootCalls(), 0);
    // No duplicate map rows: one row per node, exactly.
    assert.equal(pool.rows.length, TOTAL_NODES);
    assert.equal(new Set(pool.rows.map(r => `${r.owner_kind}|${r.owner_id}|${r.logical_key}`)).size, TOTAL_NODES);
    // startedAt survives the crash (the wire field the poller renders).
    assert.equal(state!.startedAt, seededStartedAt);
  });

  it("(b) a failing create fails only that subtree; retry re-attempts just the failed nodes and finishes done", async () => {
    const store = memStore();
    const pool = mapPool(store);
    const propName = `Bluewater — ${PROPERTY_ID.slice(0, 8)}`;
    const flaky = graphStub({ failOnNames: new Set([propName]) });

    const first = await runOnce(store, pool, flaky);
    assert.equal(first.state!.status, "failed");
    const failed1 = first.state!.nodes.filter(n => n.status === "failed");
    // Property root (429) + its 5 children (parent unavailable) — nothing else.
    assert.equal(failed1.length, 6);
    assert.deepEqual(
      failed1.map(n => n.logicalKey).sort(),
      ["property", "property:01-instructions", "property:02-letting", "property:03-tenancy-schedules", "property:04-property-media", "property:99-archive"].sort(),
    );
    const wire1 = jobs.clientFolderJobWire(first.state!);
    assert.equal(wire1.status, "failed");
    assert.equal(wire1.failedNodes.length, 6);
    assert.equal(wire1.failedNodes.find(n => n.logicalKey === "property")!.error, "429 throttled");
    assert.match(first.state!.message!, /re-run to resume/);

    // Retry with a healthy Graph: ONLY the 6 failed nodes are re-attempted.
    const healthy = graphStub();
    const second = await runOnce(store, pool, healthy);
    assert.equal(second.state!.status, "done");
    assert.equal(healthy.creates.length, 6);
    assert.equal(healthy.creates[0].name, propName, "the failed property root is retried first");
    assert.equal(second.state!.nodes.every(n => n.status === "bound" || n.status === "created"), true);
    // Still no duplicates in the durable map.
    assert.equal(pool.rows.length, TOTAL_NODES);
  });

  it("(c) a second run while the first holds the lock is a no-op already_running", async () => {
    const store = memStore();
    const pool = mapPool(store);
    let release!: () => void;
    let entered!: () => void;
    const enteredPromise = new Promise<void>(res => { entered = res; });
    const gate = { promise: new Promise<void>(res => { release = res; }), entered };
    const slow = graphStub({ gate });

    const first = runOnce(store, pool, slow);
    await enteredPromise; // first run is mid-job, lock held
    const second = await runOnce(store, pool, graphStub());
    assert.equal(second.ran, false);
    assert.equal(second.reason, "already_running");
    release();
    const done = await first;
    assert.equal(done.state!.status, "done");
  });

  it("creates the client root only when none exists at all", async () => {
    const store = memStore();
    const pool = mapPool(store);
    const graph = graphStub({ rootExists: false });
    const { state } = await runOnce(store, pool, graph);
    assert.equal(state!.status, "done");
    assert.equal(graph.ensureRootCalls(), 1);
    assert.equal(state!.nodes.find(n => n.logicalKey === "root")!.status, "created");
  });
});

describe("clientFolderJobWire", () => {
  const base: import("./client-folder-jobs").ClientFolderJobState = {
    status: "done", companyId: COMPANY_ID, companyName: "Landsec",
    startedAt: 1726000000000, properties: 1, total: 2,
    nodes: [
      { logicalKey: "root", ownerKind: "company", ownerId: COMPANY_ID, displayName: "Landsec", treePath: ["Landsec"], status: "bound" },
      { logicalKey: "property", ownerKind: "property", ownerId: PROPERTY_ID, displayName: "Bluewater — aaaaaaaa", treePath: ["Landsec", "03 Properties", "Bluewater — aaaaaaaa"], status: "failed", error: "429 throttled" },
    ],
  };

  it("(d) keeps the legacy poller fields and adds failedNodes", () => {
    const wire = jobs.clientFolderJobWire(base);
    assert.equal(wire.status, "done");
    assert.equal(wire.startedAt, 1726000000000);
    assert.equal(wire.companyName, "Landsec");
    assert.equal(wire.properties, 1);
    assert.equal(wire.created, 1);
    assert.equal(wire.errors, 1);
    assert.equal(wire.total, 2);
    assert.deepEqual(wire.failedNodes, [
      { logicalKey: "property", displayName: "Bluewater — aaaaaaaa", error: "429 throttled" },
    ]);
  });

  it("projects a stale running lease as a resumable failure", () => {
    const stale = {
      ...base, status: "running" as const,
      claim: "c1", leaseUntil: new Date(Date.now() - 1000).toISOString(),
    };
    const wire = jobs.clientFolderJobWire(stale);
    assert.equal(wire.status, "failed");
    assert.match(wire.message!, /interrupted — re-run to resume/);
    // A live lease still reports running.
    const live = { ...stale, leaseUntil: new Date(Date.now() + 60_000).toISOString() };
    assert.equal(jobs.clientFolderJobWire(live).status, "running");
  });
});
