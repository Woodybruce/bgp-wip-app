/**
 * account-media.test.ts — Delivery 4 Task 2: one media view over company +
 * property assets.
 *
 * Runs listAccountMedia against a mock pool (lazy-pool pattern, no live
 * database) with a fake AccountView via deps.resolveView, so resolver SQL is
 * not in play. Covers: property-only images surfacing in the properties
 * group; brand-hero pin → approved; auto-imported public images never
 * approved (no auto marketing clearance); legacy brand_name-only rows
 * included; id dedupe; propertyId filter; empty account → empty response;
 * pool spy asserting zero mutating statements.
 *
 * Run with: node --import tsx --test server/account-media.test.ts
 */
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import type { Querier } from "./account-resolver";
import type { AccountView } from "./account-resolver";

let listAccountMedia: typeof import("./account-media").listAccountMedia;
let classifyMediaRow: typeof import("./account-media").classifyMediaRow;
let isMarketingCleared: typeof import("./account-media").isMarketingCleared;
before(async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://test:test@localhost:1/test";
  ({ listAccountMedia, classifyMediaRow, isMarketingCleared } = await import("./account-media"));
});

const VIEW: AccountView = {
  root: { companyId: "HAM", name: "Hammerson", companyType: "REIT", companiesHouseNumber: null, relation: "self", relationConfidence: "confirmed", evidence: "self" } as any,
  entities: [
    { companyId: "HAM", name: "Hammerson", companyType: "REIT", companiesHouseNumber: null, relation: "self", relationConfidence: "confirmed", evidence: "self" } as any,
    { companyId: "HAMUK", name: "Hammerson UK", companyType: "Landlord", companiesHouseNumber: null, relation: "subsidiary", relationConfidence: "confirmed", evidence: "crm_companies.parent_company_id" } as any,
  ],
  properties: [
    { propertyId: "P1", name: "Brent Cross", postcode: null, country: "GB", relationshipRole: "owner", ownershipStakePct: null, owningEntityId: "HAM", confidence: "confirmed", sources: ["landlord_id"], unitCount: 0 } as any,
    { propertyId: "P2", name: "Dundrum Town Centre", postcode: null, country: "IE", relationshipRole: "owner", ownershipStakePct: null, owningEntityId: "HAMUK", confidence: "confirmed", sources: ["landlord_id"], unitCount: 0 } as any,
  ],
  instructions: [], relatedMarketActivity: [], contacts: [], team: [], totals: { deals: 0, completedDeals: 0 },
};

const EMPTY_VIEW: AccountView = {
  ...VIEW,
  entities: [{ ...VIEW.entities[0] }],
  properties: [],
};

const ROWS = [
  // Property-only photo: no company linkage at all — today's gallery drops it.
  { id: "IMG-PROP", file_name: "brent-cross-entrance.jpg", thumbnail_data: null, mime_type: "image/jpeg", tags: ["brand-auto"], category: "Property", source: "official-website", description: null, width: 800, height: 600, created_at: "2026-06-01T10:00:00Z", company_id: null, property_id: "P1", property_name: "Brent Cross" },
  // Staff-pinned hero → approved group even though it is company-linked.
  { id: "IMG-HERO", file_name: "hero.jpg", thumbnail_data: null, mime_type: "image/jpeg", tags: ["brand-auto", "brand-hero"], category: "Brands", source: "official-website", description: null, width: 800, height: 600, created_at: "2026-06-02T10:00:00Z", company_id: "HAM", property_id: null, property_name: null },
  // Plain company asset → corporate, never marketing-cleared by itself.
  { id: "IMG-CORP", file_name: "corporate.jpg", thumbnail_data: null, mime_type: "image/jpeg", tags: ["brand-auto"], category: "Brands", source: "official-website", description: null, width: 800, height: 600, created_at: "2026-06-03T10:00:00Z", company_id: "HAMUK", property_id: null, property_name: null },
  // Legacy row: brand_name only, both FKs null — matched via the name fallback.
  { id: "IMG-LEGACY", file_name: "legacy.jpg", thumbnail_data: null, mime_type: "image/jpeg", tags: ["brand-auto"], category: "Brands", source: "official-website", description: null, width: 800, height: 600, created_at: "2026-06-04T10:00:00Z", company_id: null, property_id: null, property_name: null },
  // Duplicate id — can satisfy the company and property clauses at once.
  { id: "IMG-PROP", file_name: "brent-cross-entrance.jpg", thumbnail_data: null, mime_type: "image/jpeg", tags: ["brand-auto"], category: "Property", source: "official-website", description: null, width: 800, height: 600, created_at: "2026-06-01T10:00:00Z", company_id: null, property_id: "P1", property_name: "Brent Cross" },
  // A property outside the account's portfolio — must never leak in.
  { id: "IMG-OTHER", file_name: "other.jpg", thumbnail_data: null, mime_type: "image/jpeg", tags: ["brand-auto"], category: "Property", source: "official-website", description: null, width: 800, height: 600, created_at: "2026-06-05T10:00:00Z", company_id: null, property_id: "P9", property_name: "Elsewhere" },
];

function makePool() {
  const calls: Array<{ sql: string; params: unknown }> = [];
  const pool: Querier = {
    async query(sql: string, params?: unknown) {
      calls.push({ sql, params });
      const [entityIds, portfolioIds, entityNames] = params as [string[], string[], string[]];
      const rows = ROWS.filter(r =>
        (r.company_id && entityIds.includes(r.company_id)) ||
        (r.property_id && portfolioIds.includes(r.property_id)) ||
        (!r.company_id && !r.property_id && entityNames.includes("hammerson") && r.id === "IMG-LEGACY"),
      );
      return { rows, rowCount: rows.length };
    },
  };
  return { pool, calls };
}

const fakeResolveView = (view: AccountView) => async () => view;

describe("classifyMediaRow / isMarketingCleared", () => {
  it("brand-hero pin → approved; property-linked → properties; else corporate", () => {
    assert.equal(classifyMediaRow({ tags: ["brand-hero"], property_id: null }), "approved");
    assert.equal(classifyMediaRow({ tags: ["brand-hero"], property_id: "P1" }), "approved");
    assert.equal(classifyMediaRow({ tags: ["brand-auto"], property_id: "P1" }), "properties");
    assert.equal(classifyMediaRow({ tags: ["brand-auto"], property_id: null }), "corporate");
    assert.equal(classifyMediaRow({ tags: null, property_id: null }), "corporate");
  });

  it("public auto-imports are never marketing-cleared; only the staff pin clears", () => {
    assert.equal(isMarketingCleared({ tags: ["brand-auto", "official-website"] }), false);
    assert.equal(isMarketingCleared({ tags: ["brand-auto", "brand-hero"] }), true);
  });
});

describe("listAccountMedia", () => {
  it("property-only photo surfaces in the properties group with its property name", async () => {
    const { pool } = makePool();
    const res = await listAccountMedia("HAM", {}, { pool, resolveView: fakeResolveView(VIEW) });
    const prop = res.groups.properties.find(r => r.id === "IMG-PROP");
    assert.ok(prop, "property-only image must surface");
    assert.equal(prop.property_name, "Brent Cross");
    assert.equal(prop.marketing_cleared, false);
  });

  it("groups: approved = brand-hero only; corporate = company-linked plain assets", async () => {
    const { pool } = makePool();
    const res = await listAccountMedia("HAM", {}, { pool, resolveView: fakeResolveView(VIEW) });
    assert.deepEqual(res.groups.approved.map(r => r.id), ["IMG-HERO"]);
    assert.equal(res.groups.approved[0].marketing_cleared, true);
    assert.deepEqual(res.groups.corporate.map(r => r.id).sort(), ["IMG-CORP", "IMG-LEGACY"]);
  });

  it("dedupes by image id when a row satisfies multiple clauses", async () => {
    const { pool } = makePool();
    const res = await listAccountMedia("HAM", {}, { pool, resolveView: fakeResolveView(VIEW) });
    const ids = [...res.groups.corporate, ...res.groups.properties, ...res.groups.approved].map(r => r.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(res.total, ids.length);
  });

  it("excludes properties outside the account portfolio", async () => {
    const { pool } = makePool();
    const res = await listAccountMedia("HAM", {}, { pool, resolveView: fakeResolveView(VIEW) });
    assert.ok(!res.groups.properties.some(r => r.property_id === "P9"));
  });

  it("propertyId filter narrows the properties group only", async () => {
    const { pool } = makePool();
    const res = await listAccountMedia("HAM", { propertyId: "P2" }, { pool, resolveView: fakeResolveView(VIEW) });
    assert.equal(res.groups.properties.length, 0);
    assert.equal(res.groups.approved.length, 1);
    assert.equal(res.groups.corporate.length, 2);
  });

  it("exposes the sorted property list for the filter UI", async () => {
    const { pool } = makePool();
    const res = await listAccountMedia("HAM", {}, { pool, resolveView: fakeResolveView(VIEW) });
    assert.deepEqual(res.properties, [
      { propertyId: "P1", name: "Brent Cross" },
      { propertyId: "P2", name: "Dundrum Town Centre" },
    ]);
  });

  it("empty account (no portfolio) still returns entity-linked rows; fully empty view short-circuits", async () => {
    const { pool, calls } = makePool();
    const res = await listAccountMedia("HAM", {}, { pool, resolveView: fakeResolveView(EMPTY_VIEW) });
    assert.deepEqual(res.properties, []);
    assert.equal(calls.length, 1, "entity ids exist so the query still runs");

    const noEntityView: AccountView = { ...EMPTY_VIEW, entities: [] };
    const res2 = await listAccountMedia("HAM", {}, { pool, resolveView: fakeResolveView(noEntityView) });
    assert.deepEqual(res2, { groups: { corporate: [], properties: [], approved: [] }, properties: [], total: 0 });
    assert.equal(calls.length, 1, "no entities and no properties → no query issued");
  });

  it("issues only SELECT statements (read-only view)", async () => {
    const { pool, calls } = makePool();
    await listAccountMedia("HAM", {}, { pool, resolveView: fakeResolveView(VIEW) });
    assert.ok(calls.length >= 1);
    for (const c of calls) assert.match(c.sql.trim(), /^SELECT/i, `mutating statement: ${c.sql}`);
  });
});
