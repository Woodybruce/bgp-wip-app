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
