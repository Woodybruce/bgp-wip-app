/**
 * aml-shadow-gate.test.ts — Delivery 5, Task 9.
 *
 * Acceptance gates covered here:
 *  - a deal with a brand-approved parent but an UNAPPROVED linked
 *    contracting entity → current pass / proposed block,
 *    changed='newly_blocked';
 *  - a deal with no crm_deal_entities rows → proposed == current,
 *    changed='same', with the explicit "no links" reason;
 *  - the mirror case (brand unapproved, linked entity approved) →
 *    'newly_passing';
 *  - expired linked-entity approval blocks the proposed gate;
 *  - the live gate module is byte-identical — no crm_deal_entities
 *    reference anywhere in deal-gates.ts (grep assertion), and its call
 *    sites are untouched (this delivery adds none);
 *  - report rows sort changed-first for the GET endpoint.
 *
 * currentGate is a spy (the real checkCounterpartyAml runs in prod);
 * the DB is a mock pool. No network, no real DB.
 *
 * Run with: node --import tsx --test server/aml-shadow-gate.test.ts
 */
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

let mod: typeof import("./aml-shadow-gate");

before(async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://test:test@localhost:1/test";
  mod = await import("./aml-shadow-gate");
});

const NOW = new Date("2026-09-21T12:00:00Z");

const DEAL = {
  id: "D-1", name: "Bluewater — Unit 12",
  landlord_id: "BRAND-1", tenant_id: null, vendor_id: null, purchaser_id: null,
};

function mockPool(handlers: {
  deal?: any;
  links?: any[];
  kycRows?: any[];
  companies?: Record<string, any>;
  trading?: Record<string, any>;
}) {
  const calls: { sql: string; params?: any[] }[] = [];
  return {
    calls,
    async query(sql: string, params?: any[]) {
      calls.push({ sql, params });
      if (/FROM crm_deals WHERE id/.test(sql)) return { rows: handlers.deal ? [handlers.deal] : [] };
      if (/FROM crm_deal_entities/.test(sql)) return { rows: handlers.links || [] };
      if (/FROM crm_entity_kyc/.test(sql)) return { rows: handlers.kycRows || [] };
      if (/FROM crm_trading_entities/.test(sql)) {
        return { rows: (params![0] || []).map((id: string) => handlers.trading?.[id]).filter(Boolean) };
      }
      if (/FROM crm_companies/.test(sql)) {
        return { rows: (params![0] || []).map((id: string) => handlers.companies?.[id]).filter(Boolean) };
      }
      throw new Error(`unexpected SQL: ${sql}`);
    },
  };
}

const passingGate = async () => ({ hasCounterparties: true, notReady: [] });
const failingGate = async () => ({ hasCounterparties: true, notReady: [{ name: "Landsec", reason: "no checks run", role: "landlord" }] });

describe("checkCounterpartyAmlShadow", () => {
  it("brand-approved parent + unapproved linked contracting entity → current pass / proposed block (newly_blocked)", async () => {
    const pool = mockPool({
      deal: DEAL,
      links: [{ role: "landlord", entity_kind: "company", entity_id: "SPV-1" }],
      kycRows: [], // no crm_entity_kyc row → company fallback reads its OWN live state
      companies: {
        "SPV-1": { id: "SPV-1", name: "Landsec SPV One", kyc_status: "pending", kyc_expires_at: null },
        "BRAND-1": { id: "BRAND-1", name: "Landsec", kyc_status: "approved", kyc_expires_at: null },
      },
    });
    const row = await mod.checkCounterpartyAmlShadow("D-1", { pool, now: NOW, currentGate: passingGate });

    assert.equal(row.current.pass, true);
    assert.equal(row.proposed.pass, false);
    assert.equal(row.changed, "newly_blocked");
    assert.deepEqual(row.proposed.notReady, [{ name: "Landsec SPV One", reason: "pending", role: "landlord" }]);
    assert.ok(row.reasons.some(r => /linked entity "Landsec SPV One" is pending/.test(r)));
  });

  it("crm_entity_kyc is canonical for linked entities and beats the live company state", async () => {
    const pool = mockPool({
      deal: DEAL,
      links: [{ role: "landlord", entity_kind: "company", entity_id: "SPV-1" }],
      kycRows: [{ entity_kind: "company", entity_id: "SPV-1", kyc_status: "in_review", expires_at: null }],
      companies: {
        "SPV-1": { id: "SPV-1", name: "Landsec SPV One", kyc_status: "approved", kyc_expires_at: null },
        "BRAND-1": { id: "BRAND-1", name: "Landsec", kyc_status: "approved", kyc_expires_at: null },
      },
    });
    const row = await mod.checkCounterpartyAmlShadow("D-1", { pool, now: NOW, currentGate: passingGate });
    assert.equal(row.proposed.pass, false);
    assert.deepEqual(row.proposed.notReady, [{ name: "Landsec SPV One", reason: "in_review", role: "landlord" }]);
  });

  it("no crm_deal_entities rows → proposed == current, changed='same', stated explicitly", async () => {
    const pool = mockPool({
      deal: DEAL,
      links: [],
      companies: { "BRAND-1": { id: "BRAND-1", name: "Landsec", kyc_status: "approved", kyc_expires_at: null } },
    });
    const pass = await mod.checkCounterpartyAmlShadow("D-1", { pool, now: NOW, currentGate: passingGate });
    assert.equal(pass.changed, "same");
    assert.equal(pass.proposed.pass, true);
    assert.ok(pass.reasons.some(r => /No crm_deal_entities links — proposed equals current/.test(r)));

    const failPool = mockPool({
      deal: DEAL,
      links: [],
      companies: { "BRAND-1": { id: "BRAND-1", name: "Landsec", kyc_status: null, kyc_expires_at: null } },
    });
    const fail = await mod.checkCounterpartyAmlShadow("D-1", { pool: failPool, now: NOW, currentGate: failingGate });
    assert.equal(fail.changed, "same");
    assert.equal(fail.proposed.pass, false);
    assert.deepEqual(fail.proposed.notReady, fail.current.notReady);
  });

  it("brand unapproved + approved linked entity → newly_passing", async () => {
    const pool = mockPool({
      deal: DEAL,
      links: [{ role: "landlord", entity_kind: "trading_entity", entity_id: "TE-1" }],
      kycRows: [{ entity_kind: "trading_entity", entity_id: "TE-1", kyc_status: "approved", expires_at: "2027-01-01T00:00:00Z" }],
      trading: { "TE-1": { id: "TE-1", name: "Landsec Trading" } },
      companies: { "BRAND-1": { id: "BRAND-1", name: "Landsec", kyc_status: null, kyc_expires_at: null } },
    });
    const row = await mod.checkCounterpartyAmlShadow("D-1", { pool, now: NOW, currentGate: failingGate });
    assert.equal(row.current.pass, false);
    assert.equal(row.proposed.pass, true);
    assert.equal(row.changed, "newly_passing");
  });

  it("an expired linked-entity approval blocks the proposed gate", async () => {
    const pool = mockPool({
      deal: DEAL,
      links: [{ role: "landlord", entity_kind: "trading_entity", entity_id: "TE-1" }],
      kycRows: [{ entity_kind: "trading_entity", entity_id: "TE-1", kyc_status: "approved", expires_at: "2025-01-01T00:00:00Z" }],
      trading: { "TE-1": { id: "TE-1", name: "Landsec Trading" } },
      companies: { "BRAND-1": { id: "BRAND-1", name: "Landsec", kyc_status: "approved", kyc_expires_at: null } },
    });
    const row = await mod.checkCounterpartyAmlShadow("D-1", { pool, now: NOW, currentGate: passingGate });
    assert.equal(row.changed, "newly_blocked");
    assert.deepEqual(row.proposed.notReady, [{ name: "Landsec Trading", reason: "expired", role: "landlord" }]);
  });

  it("roles without a link fall back to the brand FK exactly like the live gate", async () => {
    const pool = mockPool({
      deal: DEAL,
      links: [{ role: "tenant", entity_kind: "company", entity_id: "SPV-9" }],
      kycRows: [{ entity_kind: "company", entity_id: "SPV-9", kyc_status: "approved", expires_at: null }],
      companies: {
        "SPV-9": { id: "SPV-9", name: "Tenant SPV", kyc_status: "approved", kyc_expires_at: null },
        "BRAND-1": { id: "BRAND-1", name: "Landsec", kyc_status: null, kyc_expires_at: null },
      },
    });
    // Landlord role has no link → brand FK evaluated (unapproved → not ready).
    const row = await mod.checkCounterpartyAmlShadow("D-1", { pool, now: NOW, currentGate: failingGate });
    assert.equal(row.proposed.pass, false);
    assert.deepEqual(row.proposed.notReady, [{ name: "Landsec", reason: "no checks run", role: "landlord" }]);
  });

  it("throws deal not found for an unknown deal", async () => {
    const pool = mockPool({ deal: null });
    await assert.rejects(() => mod.checkCounterpartyAmlShadow("NOPE", { pool }), /deal not found/);
  });
});

describe("the live gate is untouched", () => {
  it("deal-gates.ts has no entity-link awareness (grep assertion)", () => {
    const source = readFileSync(new URL("./deal-gates.ts", import.meta.url), "utf8");
    assert.equal(source.includes("crm_deal_entities"), false, "the live gate must not read crm_deal_entities");
    assert.equal(source.includes("crm_entity_kyc"), false, "the live gate must not read crm_entity_kyc");
  });
});

describe("sortShadowRows / summariseShadowRows", () => {
  it("orders newly_blocked, newly_passing, then same (by name within a bucket)", () => {
    const rows = [
      { changed: "same" as const, name: "B deal" },
      { changed: "newly_passing" as const, name: "C deal" },
      { changed: "same" as const, name: "A deal" },
      { changed: "newly_blocked" as const, name: "D deal" },
    ];
    const sorted = mod.sortShadowRows(rows);
    assert.deepEqual(sorted.map(r => r.name), ["D deal", "C deal", "A deal", "B deal"]);
    assert.deepEqual(mod.summariseShadowRows(rows), { total: 4, newlyBlocked: 1, newlyPassing: 1, same: 2 });
  });
});
