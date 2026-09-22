/**
 * account-entity-checks.test.ts — Delivery 5, Task 8.
 *
 * Acceptance gates covered here:
 *  - fan-out: 3 companies + 2 trading entities each get exactly one
 *    outcome; companies go through the company checker (investigationId),
 *    trading entities through the trading checker;
 *  - a failing entity leaves the run `done` with that entity `failed` and
 *    the rest `done`;
 *  - retryFailed re-runs ONLY the failed entities (done outcomes carry
 *    forward untouched);
 *  - no writes to crm_deals.kyc_approved (pool spy) — deal-level effects
 *    are the Task-9 shadow's business, not a side effect here;
 *  - a concurrent run is a no-op ({ ran:false, reason:"already_running" }).
 *
 * Store is an in-memory fake; checkers are spies; the DB is a mock pool.
 * No network, no real DB.
 *
 * Run with: node --import tsx --test server/account-entity-checks.test.ts
 */
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";

let mod: typeof import("./account-entity-checks");

before(async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://test:test@localhost:1/test";
  mod = await import("./account-entity-checks");
});

const ACCOUNT = "ROOT";

function entity(over: Partial<any>) {
  return {
    companyId: "?", name: "?", companyType: null, companiesHouseNumber: null,
    relation: "subsidiary", relationConfidence: "confirmed", evidence: "crm_companies.parent_company_id",
    ...over,
  };
}

// 3 companies + 2 trading entities.
function fanOutView() {
  const entities = [
    entity({ companyId: "ROOT", name: "Landsec", relation: "self", evidence: "self" }),
    entity({ companyId: "C-1", name: "SPV One" }),
    entity({ companyId: "C-2", name: "SPV Two" }),
    entity({ companyId: "TE-1", name: "Trading One", relation: "trading_entity", evidence: "crm_trading_entities", companiesHouseNumber: "01057547" }),
    entity({ companyId: "TE-2", name: "Trading Two", relation: "trading_entity", evidence: "crm_trading_entities" }),
  ];
  return {
    root: entities[0], entities,
    properties: [], instructions: [], relatedMarketActivity: [], contacts: [], team: [],
    totals: { deals: 0, completedDeals: 0 },
  };
}

function memStore() {
  let latest: import("./account-entity-checks").EntityChecksRun | null = null;
  let locked = false;
  const store: import("./account-entity-checks").EntityChecksStore & { current: () => typeof latest } = {
    async tryLock() { if (locked) return false; locked = true; return true; },
    async saveRun(run) { latest = JSON.parse(JSON.stringify(run)); },
    async readLatest() { return latest ? JSON.parse(JSON.stringify(latest)) : null; },
    async unlock() { locked = false; },
    close() {},
    current: () => latest,
  };
  return store;
}

function mockPool() {
  const calls: { sql: string; params?: any[] }[] = [];
  return {
    calls,
    async query(sql: string, params?: any[]) {
      calls.push({ sql, params });
      if (/FROM crm_entity_kyc/.test(sql)) return { rows: [] };
      if (/INTO crm_entity_kyc/.test(sql)) return { rows: [] };
      if (/FROM crm_companies/.test(sql)) return { rows: [{ id: "ROOT", trading_entities: null, kyc_status: null }] };
      throw new Error(`unexpected SQL: ${sql}`);
    },
  };
}

function checkers(failOn: Set<string> = new Set()) {
  const companyCalls: string[] = [];
  const tradingCalls: string[] = [];
  return {
    companyCalls, tradingCalls,
    async checkCompany(entityId: string, _userId: string | null) {
      companyCalls.push(entityId);
      if (failOn.has(entityId)) throw new Error("orchestrator exploded");
      return { investigationId: 1000 + companyCalls.length };
    },
    async checkTradingEntity(entity: any, _q: any) {
      tradingCalls.push(entity.entityId);
      if (failOn.has(entity.entityId)) throw new Error("sanctions API 500");
    },
  };
}

describe("runEntityChecks", () => {
  it("fans out one check per entity: 3 companies + 2 trading entities, exactly one outcome each", async () => {
    const store = memStore();
    const pool = mockPool();
    const spies = checkers();
    const { ran, run } = await mod.runEntityChecks(
      { accountId: ACCOUNT, userId: "user-1" },
      { store, pool, view: fanOutView(), ...spies },
    );

    assert.equal(ran, true);
    assert.equal(run!.status, "done");
    assert.equal(run!.entities.length, 5);
    assert.deepEqual(spies.companyCalls.sort(), ["C-1", "C-2", "ROOT"]);
    assert.deepEqual(spies.tradingCalls.sort(), ["TE-1", "TE-2"]);
    assert.equal(run!.entities.every(e => e.status === "done"), true);
    assert.equal(run!.entities.find(e => e.entityId === "ROOT")!.investigationId, 1001);
    // Trading entities never get an investigation id (that flow is company-only).
    assert.equal(run!.entities.find(e => e.entityId === "TE-1")!.investigationId, undefined);
    // No deal-gate side effects.
    assert.equal(pool.calls.some(c => /crm_deals/.test(c.sql)), false);
  });

  it("a failing entity leaves the run done with exactly that entity failed", async () => {
    const store = memStore();
    const pool = mockPool();
    const spies = checkers(new Set(["C-2"]));
    const { run } = await mod.runEntityChecks(
      { accountId: ACCOUNT, userId: "user-1" },
      { store, pool, view: fanOutView(), ...spies },
    );

    assert.equal(run!.status, "done");
    const failed = run!.entities.filter(e => e.status === "failed");
    assert.equal(failed.length, 1);
    assert.equal(failed[0].entityId, "C-2");
    assert.equal(failed[0].error, "orchestrator exploded");
    assert.equal(run!.entities.filter(e => e.status === "done").length, 4);
  });

  it("retryFailed re-runs only the failed entities and keeps the run id", async () => {
    const store = memStore();
    const pool = mockPool();
    const first = await mod.runEntityChecks(
      { accountId: ACCOUNT, userId: "user-1" },
      { store, pool, view: fanOutView(), ...checkers(new Set(["TE-1", "C-1"])) },
    );
    assert.equal(first.run!.entities.filter(e => e.status === "failed").length, 2);

    const spies = checkers();
    const second = await mod.runEntityChecks(
      { accountId: ACCOUNT, userId: "user-1", retryFailed: true },
      { store, pool, view: fanOutView(), ...spies },
    );
    assert.equal(second.run!.runId, first.run!.runId, "a retry continues the same run");
    assert.deepEqual(spies.companyCalls, ["C-1"], "only the failed company re-runs");
    assert.deepEqual(spies.tradingCalls, ["TE-1"], "only the failed trading entity re-runs");
    assert.equal(second.run!.entities.every(e => e.status === "done"), true);
    // Carried-forward outcomes keep their investigation ids.
    assert.equal(second.run!.entities.find(e => e.entityId === "ROOT")!.investigationId, 1001);
  });

  it("a concurrent run is a no-op already_running", async () => {
    const store = memStore();
    const pool = mockPool();
    // Hold the lock as if another runner had it.
    await store.tryLock();
    const result = await mod.runEntityChecks(
      { accountId: ACCOUNT, userId: "user-1" },
      { store, pool, view: fanOutView(), ...checkers() },
    );
    assert.equal(result.ran, false);
    assert.equal(result.reason, "already_running");
  });

  it("jsonb-only entities get an explicit failed outcome, never a silent skip", async () => {
    const store = memStore();
    const pool = {
      calls: [] as any[],
      async query(sql: string, params?: any[]) {
        this.calls.push({ sql, params });
        if (/FROM crm_entity_kyc/.test(sql)) return { rows: [] };
        if (/FROM crm_companies/.test(sql)) {
          return { rows: [{ id: "ROOT", trading_entities: [{ name: "Ghost Entity" }], kyc_status: null }] };
        }
        throw new Error(`unexpected SQL: ${sql}`);
      },
    };
    const view = fanOutView();
    view.entities = view.entities.slice(0, 1);
    const spies = checkers();
    const { run } = await mod.runEntityChecks(
      { accountId: ACCOUNT, userId: "user-1" },
      { store, pool: pool as any, view, ...spies },
    );
    const ghost = run!.entities.find(e => e.name === "Ghost Entity")!;
    assert.equal(ghost.status, "failed");
    assert.match(ghost.error!, /representation conflict/);
    assert.equal(run!.entities.filter(e => e.status === "done").length, 1);
  });
});
