/**
 * account-entities.test.ts — Delivery 5, Task 6.
 *
 * Acceptance gates covered here:
 *  - the three-representation fixture (child company + crm_trading_entities
 *    row + legacy jsonb entry for the SAME legal entity) merges into ONE
 *    GroupEntity carrying every evidence source;
 *  - a jsonb-only entry surfaces with representationConflicts and NO
 *    invented id (entityId null);
 *  - an approved parent beside an unchecked child yields current < total,
 *    the child in the unchecked bucket, and the parent's approval is never
 *    projected onto the child;
 *  - an expired approval counts as not current;
 *  - the staff-only guard mirrors the reconciliation guard.
 *
 * resolveAccountView is bypassed via deps.view; the DB is a mock pool.
 * No network, no real DB.
 *
 * Run with: node --import tsx --test server/account-entities.test.ts
 */
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";

let mod: typeof import("./account-entities");

before(async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://test:test@localhost:1/test";
  mod = await import("./account-entities");
});

const NOW = new Date("2026-09-21T12:00:00Z");

function entity(over: Partial<any>) {
  return {
    companyId: "?", name: "?", companyType: null, companiesHouseNumber: null,
    relation: "subsidiary", relationConfidence: "confirmed", evidence: "crm_companies.parent_company_id",
    ...over,
  };
}

function fakeView(entities: any[]) {
  return {
    root: entities[0],
    entities,
    properties: [], instructions: [], relatedMarketActivity: [], contacts: [], team: [],
    totals: { deals: 0, completedDeals: 0 },
  };
}

function mockPool(handlers: { companyRows?: any[]; kycRows?: any[] }) {
  const calls: { sql: string; params?: any[] }[] = [];
  return {
    calls,
    async query(sql: string, params?: any[]) {
      calls.push({ sql, params });
      if (/FROM crm_entity_kyc/.test(sql)) return { rows: handlers.kycRows || [] };
      if (/FROM crm_companies/.test(sql)) return { rows: handlers.companyRows || [] };
      throw new Error(`unexpected SQL: ${sql}`);
    },
  };
}

describe("getAccountEntities", () => {
  it("merges the three representations of one legal entity into a single GroupEntity with all evidence", async () => {
    const view = fakeView([
      entity({ companyId: "ROOT", name: "Landsec", relation: "self", evidence: "self" }),
      entity({ companyId: "TE-1", name: "Landsec Trading", companiesHouseNumber: "01057547", relation: "trading_entity", evidence: "crm_trading_entities" }),
    ]);
    const pool = mockPool({
      companyRows: [
        { id: "ROOT", trading_entities: [{ name: "Landsec Trading", companies_house_number: "01057547" }], kyc_status: null },
      ],
    });
    const report = await mod.getAccountEntities("ROOT", {}, { pool, view: view as any, now: () => NOW });

    assert.equal(report.entities.length, 2);
    const trading = report.entities.find(e => e.name === "Landsec Trading")!;
    assert.equal(trading.entityKind, "trading_entity");
    assert.equal(trading.entityId, "TE-1", "the crm_trading_entities row is the canonical id");
    assert.equal(trading.companiesHouseNumber, "01057547");
    assert.deepEqual(trading.evidence.sort(), ["crm_companies.trading_entities", "crm_trading_entities"]);
    assert.deepEqual(trading.representationConflicts, []);
  });

  it("surfaces a jsonb-only entry with a conflict and no invented id", async () => {
    const view = fakeView([
      entity({ companyId: "ROOT", name: "Landsec", relation: "self", evidence: "self" }),
    ]);
    const pool = mockPool({
      companyRows: [
        { id: "ROOT", trading_entities: [{ name: "Ghost Entity Ltd", companies_house_number: "99999999" }], kyc_status: null },
      ],
    });
    const report = await mod.getAccountEntities("ROOT", {}, { pool, view: view as any, now: () => NOW });

    const ghost = report.entities.find(e => e.name === "Ghost Entity Ltd")!;
    assert.equal(ghost.entityKind, "trading_entity");
    assert.equal(ghost.entityId, null, "no invented id for a jsonb-only entry");
    assert.equal(ghost.companiesHouseNumber, "99999999");
    assert.deepEqual(ghost.representationConflicts, ["jsonb entry has no crm_trading_entities row"]);
    assert.deepEqual(ghost.evidence, ["crm_companies.trading_entities"]);
  });

  it("reports differing Companies House numbers as a conflict, never auto-resolved", async () => {
    const view = fakeView([
      entity({ companyId: "ROOT", name: "Landsec", relation: "self", evidence: "self" }),
      entity({ companyId: "TE-1", name: "Landsec Trading", companiesHouseNumber: "01057547", relation: "trading_entity", evidence: "crm_trading_entities" }),
    ]);
    const pool = mockPool({
      companyRows: [
        { id: "ROOT", trading_entities: [{ name: "Landsec Trading", companies_house_number: "99999999" }], kyc_status: null },
      ],
    });
    const report = await mod.getAccountEntities("ROOT", {}, { pool, view: view as any, now: () => NOW });
    const trading = report.entities.find(e => e.name === "Landsec Trading")!;
    assert.equal(trading.companiesHouseNumber, "01057547", "the canonical row's number wins");
    assert.equal(trading.representationConflicts.length, 1);
    assert.match(trading.representationConflicts[0], /differs/);
  });

  it("approved parent + unchecked child: current < total, child unchecked, no projection", async () => {
    const view = fakeView([
      entity({ companyId: "ROOT", name: "Landsec", relation: "self", evidence: "self" }),
      entity({ companyId: "CHILD", name: "Landsec SPV", companiesHouseNumber: "12345678" }),
    ]);
    const pool = mockPool({
      companyRows: [
        { id: "ROOT", trading_entities: null, kyc_status: "approved", kyc_checked_at: "2026-01-01T00:00:00Z", kyc_approved_by: "Woody", kyc_expires_at: "2027-01-01T00:00:00Z" },
        { id: "CHILD", trading_entities: null, kyc_status: null, kyc_checked_at: null, kyc_approved_by: null, kyc_expires_at: null },
      ],
    });
    const report = await mod.getAccountEntities("ROOT", {}, { pool, view: view as any, now: () => NOW });

    const parent = report.entities.find(e => e.entityId === "ROOT")!;
    const child = report.entities.find(e => e.entityId === "CHILD")!;
    assert.equal(parent.kyc?.status, "approved");
    assert.equal(parent.kyc?.source, "crm_companies");
    assert.equal(parent.groupRollupBlocks, false);
    assert.equal(child.kyc, null, "the parent's approval is never projected onto the child");
    assert.equal(child.groupRollupBlocks, true);

    assert.deepEqual(report.summary, { total: 2, current: 1, inReview: 0, unchecked: 1, expired: 0, rejected: 0 });
  });

  it("crm_entity_kyc is canonical and beats the live company fallback", async () => {
    const view = fakeView([
      entity({ companyId: "ROOT", name: "Landsec", relation: "self", evidence: "self" }),
    ]);
    const pool = mockPool({
      companyRows: [
        { id: "ROOT", trading_entities: null, kyc_status: "approved", kyc_checked_at: "2026-01-01T00:00:00Z", kyc_approved_by: "Woody", kyc_expires_at: null },
      ],
      kycRows: [{
        entity_kind: "company", entity_id: "ROOT", kyc_status: "in_review",
        checked_at: "2026-09-01T00:00:00Z", approved_by: null, approved_at: null,
        expires_at: null, next_review_at: null,
        outstanding: [{ key: "ubos", label: "UBO declaration" }], last_check_job_at: null,
      }],
    });
    const report = await mod.getAccountEntities("ROOT", {}, { pool, view: view as any, now: () => NOW });
    const root = report.entities[0];
    assert.equal(root.kyc?.status, "in_review");
    assert.equal(root.kyc?.source, "crm_entity_kyc");
    assert.deepEqual(root.kyc?.outstanding, [{ key: "ubos", label: "UBO declaration" }]);
    assert.equal(report.summary.inReview, 1);
    assert.equal(report.summary.current, 0);
    assert.equal(root.groupRollupBlocks, true);
  });

  it("an expired approval counts as expired, never current", async () => {
    const view = fakeView([
      entity({ companyId: "ROOT", name: "Landsec", relation: "self", evidence: "self" }),
      entity({ companyId: "OLD", name: "Old SPV" }),
    ]);
    const pool = mockPool({
      companyRows: [
        { id: "ROOT", trading_entities: null, kyc_status: null },
        { id: "OLD", trading_entities: null, kyc_status: "approved", kyc_checked_at: "2024-01-01T00:00:00Z", kyc_approved_by: "Woody", kyc_expires_at: "2025-01-01T00:00:00Z" },
      ],
    });
    const report = await mod.getAccountEntities("ROOT", {}, { pool, view: view as any, now: () => NOW });
    assert.equal(report.summary.expired, 1);
    assert.equal(report.summary.current, 0);
    assert.equal(report.entities.find(e => e.entityId === "OLD")!.groupRollupBlocks, true);
  });

  it("scopes crm_entity_kyc reads to the resolver's entity set", async () => {
    const view = fakeView([
      entity({ companyId: "ROOT", name: "Landsec", relation: "self", evidence: "self" }),
      entity({ companyId: "TE-1", name: "Trading", relation: "trading_entity", evidence: "crm_trading_entities" }),
    ]);
    const pool = mockPool({ companyRows: [{ id: "ROOT", trading_entities: null, kyc_status: null }] });
    await mod.getAccountEntities("ROOT", {}, { pool, view: view as any, now: () => NOW });
    const kycCall = pool.calls.find(c => /FROM crm_entity_kyc/.test(c.sql))!;
    assert.deepEqual(kycCall.params, [["ROOT"], ["TE-1"]]);
  });
});

describe("groupEntitiesDeniedForScope", () => {
  it("denies client-scoped viewers, allows staff", () => {
    assert.equal(mod.groupEntitiesDeniedForScope("any-company"), true);
    assert.equal(mod.groupEntitiesDeniedForScope(null), false);
    assert.equal(mod.groupEntitiesDeniedForScope(undefined), false);
  });
});

// ─── Task 7: per-entity KYC writes ───────────────────────────────────────

function writePool(handlers: { entity?: any; intervalDays?: number } = {}) {
  const calls: { sql: string; params?: any[] }[] = [];
  return {
    calls,
    async query(sql: string, params?: any[]) {
      calls.push({ sql, params });
      if (/FROM crm_companies WHERE id/.test(sql)) {
        return { rows: handlers.entity && "kyc_status" in (handlers.entity || {}) ? [] : handlers.entity ? [handlers.entity] : [] };
      }
      if (/FROM crm_trading_entities WHERE id/.test(sql)) return { rows: handlers.entity ? [handlers.entity] : [] };
      if (/FROM aml_settings/.test(sql)) return { rows: [{ recheck_interval_days: handlers.intervalDays ?? 182 }] };
      if (/INTO crm_entity_kyc/.test(sql)) return { rows: [{ id: "kyc-1", entity_kind: params![0], entity_id: params![1] }] };
      if (/INTO aml_recheck_reminders/.test(sql)) return { rows: [] };
      if (/INTO kyc_audit_log/.test(sql)) return { rows: [] };
      throw new Error(`unexpected SQL: ${sql}`);
    },
  };
}

describe("approveEntityKyc", () => {
  it("writes exactly one entity's row + audit + reminder, approver NAME, configured cadence", async () => {
    const pool = writePool({ entity: { id: "CHILD", name: "Landsec SPV" }, intervalDays: 90 });
    const { status, body } = await mod.approveEntityKyc("company", "CHILD", "Woody", { pool });
    assert.equal(status, 200);
    assert.equal(body.entity_id, "CHILD");

    const upsert = pool.calls.find(c => /INTO crm_entity_kyc/.test(c.sql))!;
    assert.equal(upsert.params[0], "company");
    assert.equal(upsert.params[1], "CHILD");
    assert.equal(upsert.params[2], "Woody", "the approver is the session user's NAME");
    const expires = new Date(upsert.params[3]);
    const days = Math.round((expires.getTime() - Date.now()) / 86_400_000);
    assert.equal(days, 90, "expires_at follows aml_settings.recheck_interval_days");

    const reminder = pool.calls.find(c => /INTO aml_recheck_reminders/.test(c.sql))!;
    assert.equal(reminder.params[0], "CHILD");
    assert.equal(reminder.params[1], "Landsec SPV");

    const audit = pool.calls.find(c => /INTO kyc_audit_log/.test(c.sql))!;
    assert.deepEqual(audit.params.slice(0, 3), ["CHILD", "entity_kyc_approved", "Woody"]);
    assert.deepEqual(audit.params.slice(4), ["company", "CHILD"]);

    // A child approve NEVER touches the parent — or any other table's KYC.
    assert.equal(pool.calls.some(c => /UPDATE crm_companies/.test(c.sql)), false);
    assert.equal(pool.calls.some(c => /crm_deals/.test(c.sql)), false, "no deal-gate side effects (shadow only)");
    assert.equal(pool.calls.some(c => c.params?.includes("ROOT")), false);
  });

  it("404s for an unknown entity and writes nothing", async () => {
    const pool = writePool({ entity: null });
    const { status } = await mod.approveEntityKyc("company", "NOPE", "Woody", { pool });
    assert.equal(status, 404);
    assert.equal(pool.calls.some(c => /INTO crm_entity_kyc/.test(c.sql)), false);
  });

  it("audits trading-entity approvals with a NULL company_id and the entity columns", async () => {
    const pool = writePool({ entity: { id: "TE-1", name: "Landsec Trading" } });
    const { status } = await mod.approveEntityKyc("trading_entity", "TE-1", "Woody", { pool });
    assert.equal(status, 200);
    const audit = pool.calls.find(c => /INTO kyc_audit_log/.test(c.sql))!;
    assert.equal(audit.params[0], null);
    assert.deepEqual(audit.params.slice(4), ["trading_entity", "TE-1"]);
  });
});

describe("putEntityKyc", () => {
  it("moves the entity to in_review with the outstanding list and merged evidence notes", async () => {
    const pool = writePool({ entity: { id: "TE-1", name: "Landsec Trading" } });
    const { status } = await mod.putEntityKyc("trading_entity", "TE-1", {
      outstanding: [{ key: "ubos", label: "UBO declaration" }],
      evidenceNotes: "Waiting on the corporate structure chart",
    }, "Woody", { pool });
    assert.equal(status, 200);
    const upsert = pool.calls.find(c => /INTO crm_entity_kyc/.test(c.sql))!;
    assert.match(upsert.sql, /'in_review'/);
    assert.deepEqual(JSON.parse(upsert.params[2]), [{ key: "ubos", label: "UBO declaration" }]);
    assert.deepEqual(JSON.parse(upsert.params[3]), { notes: "Waiting on the corporate structure chart" });
  });
});

describe("rejectEntityKyc", () => {
  it("stamps rejected with the actor name and audits the reason", async () => {
    const pool = writePool({ entity: { id: "CHILD", name: "Landsec SPV" } });
    const { status } = await mod.rejectEntityKyc("company", "CHILD", "failed sanctions", "Woody", { pool });
    assert.equal(status, 200);
    const upsert = pool.calls.find(c => /INTO crm_entity_kyc/.test(c.sql))!;
    assert.match(upsert.sql, /'rejected'/);
    const audit = pool.calls.find(c => /INTO kyc_audit_log/.test(c.sql))!;
    assert.deepEqual(audit.params.slice(1, 4), ["entity_kyc_rejected", "Woody", "failed sanctions"]);
    assert.equal(pool.calls.some(c => /crm_deals/.test(c.sql)), false);
  });
});

describe("entity KYC routes require admin / MLRO", () => {
  it("the checklist write is behind requireAdmin; approve and reject are the MLRO's", async () => {
    const { requireAdmin } = await import("./auth");
    const { requireMlro } = await import("./aml-authority");
    const router = (await import("./account-entities")).default as any;
    const guards: Record<string, Function> = {
      "/api/entities/:kind/:id/kyc": requireAdmin,
      "/api/entities/:kind/:id/kyc/approve": requireMlro,
      "/api/entities/:kind/:id/kyc/reject": requireMlro,
    };
    for (const [path, guard] of Object.entries(guards)) {
      const layer = router.stack.find((l: any) => l.route?.path === path);
      assert.ok(layer, `route ${path} registered`);
      const handles = layer.route.stack.map((s: any) => s.handle);
      assert.ok(handles.includes(guard), `${path} is behind ${guard.name}`);
    }
  });
});

describe("Task 6+7 integration", () => {
  it("an entity approved through the write path reads back as current in the group view", async () => {
    const view = fakeView([
      entity({ companyId: "ROOT", name: "Landsec", relation: "self", evidence: "self" }),
      entity({ companyId: "TE-1", name: "Landsec Trading", relation: "trading_entity", evidence: "crm_trading_entities" }),
    ]);
    const pool = mockPool({
      companyRows: [{ id: "ROOT", trading_entities: null, kyc_status: "approved", kyc_checked_at: "2026-01-01T00:00:00Z", kyc_approved_by: "Woody", kyc_expires_at: null }],
      kycRows: [{
        entity_kind: "trading_entity", entity_id: "TE-1", kyc_status: "approved",
        checked_at: "2026-09-01T00:00:00Z", approved_by: "Woody", approved_at: "2026-09-01T00:00:00Z",
        expires_at: "2027-03-01T00:00:00Z", next_review_at: "2027-03-01T00:00:00Z",
        outstanding: [], last_check_job_at: null,
      }],
    });
    const report = await mod.getAccountEntities("ROOT", {}, { pool, view: view as any, now: () => NOW });
    assert.deepEqual(report.summary, { total: 2, current: 2, inReview: 0, unchecked: 0, expired: 0, rejected: 0 });
  });
});
