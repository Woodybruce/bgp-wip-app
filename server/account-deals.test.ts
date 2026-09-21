/**
 * account-deals.test.ts — Delivery 3 Task 1: the paginated account deal list.
 *
 * Runs listAccountDeals against a mock pool (same lazy-pool pattern as
 * account-resolver.test.ts — no live database). Covers: 30+ deal fixture
 * paginating with totals independent of page size; a deal linked to parent
 * + subentity appearing exactly once; tenant-rep at an owned centre being
 * related activity, never an instruction; every filter; fee/team stripping
 * for scoped viewers; and a pool spy asserting zero mutating statements.
 *
 * Run with: node --import tsx --test server/account-deals.test.ts
 */
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import type { Querier } from "./account-resolver";

// The module's router imports ./auth → ./db, which requires DATABASE_URL at
// load time. Set a dummy and import lazily — the pool is never queried
// (same pattern as account-reconciliation.test.ts).
let listAccountDeals: typeof import("./account-deals").listAccountDeals;
let filterAccountDeals: typeof import("./account-deals").filterAccountDeals;
let dealCounterparty: typeof import("./account-deals").dealCounterparty;
before(async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://test:test@localhost:1/test";
  ({ listAccountDeals, filterAccountDeals, dealCounterparty } = await import("./account-deals"));
});

// ─── Fixture ──────────────────────────────────────────────────────────────

interface ResolverDeal {
  id: string; name: string; status: string | null; property_id: string | null;
  landlord_id: string | null; tenant_id: string | null;
  vendor_id: string | null; purchaser_id: string | null;
  bgp_acting_for: string | null; created_at: string | null; completed_at: string | null;
}

const COMPANIES: Record<string, any> = {
  HAM: { id: "HAM", name: "Hammerson", company_type: "REIT", companies_house_number: "111", parent_company_id: null, merged_into_id: null },
  HAMUK: { id: "HAMUK", name: "Hammerson UK", company_type: "Landlord", companies_house_number: null, parent_company_id: "HAM", merged_into_id: null },
};
const CHILDREN: Record<string, any[]> = { HAM: [COMPANIES.HAMUK], HAMUK: [] };
const OWNERSHIP = [
  { id: "P1", name: "Brent Cross", postcode: "NW4 3FP", country: "GB", landlord_id: "HAM", freeholder_id: null, long_leaseholder_id: null, unit_count: 100 },
  { id: "P2", name: "Dundrum Town Centre", postcode: null, country: "IE", landlord_id: "HAMUK", freeholder_id: null, long_leaseholder_id: null, unit_count: 120 },
];

const DEALS: ResolverDeal[] = [];
const ENRICHED: Record<string, any> = {};

// D1..D30 — plain landlord instructions at Brent Cross. D1/D2 are completed
// (COM) so completedTotal is exercised; updated_at is unique per deal so
// pagination order is deterministic.
for (let i = 1; i <= 30; i++) {
  const id = `D${i}`;
  const month = (i % 8) + 1;
  const day = (i % 27) + 1;
  const updated = `2026-0${month}-${String(day).padStart(2, "0")}T10:00:00Z`;
  DEALS.push({
    id, name: `Letting ${i}`, status: i <= 2 ? "COM" : "LIVE", property_id: "P1",
    landlord_id: "HAM", tenant_id: `T${i}`, vendor_id: null, purchaser_id: null,
    bgp_acting_for: "landlord", created_at: "2026-01-01", completed_at: i <= 2 ? "2026-05-01" : null,
  });
  ENRICHED[id] = {
    id, name: `Letting ${i}`, deal_type: "Letting", status: i <= 2 ? "COM" : "LIVE", stage: null,
    property_id: "P1", property_name: "Brent Cross", unit_name: `Unit ${i}`, tenancy_unit_name: null,
    landlord_id: "HAM", tenant_id: `T${i}`, vendor_id: null, purchaser_id: null,
    landlord_name: "Hammerson", tenant_name: `Tenant ${i}`, vendor_name: null, purchaser_name: null,
    team: i === 1 ? ["Alice Smith"] : [], internal_agent: [],
    updated_at: updated, instructed_at: "2026-01-01", target_date: null,
    completed_at: i <= 2 ? "2026-05-01" : null, fee: 1000 + i,
  };
}

// DSH — landlord = parent AND vendor = subsidiary, plus an explicit
// crm_company_deals link. Three join paths, one deal: must appear once.
const LINKED: Record<string, string[]> = { DSH: ["HAM", "HAMUK"] };
DEALS.push({
  id: "DSH", name: "Shared parent/sub deal", status: "SOL", property_id: "P1",
  landlord_id: "HAM", tenant_id: null, vendor_id: "HAMUK", purchaser_id: null,
  bgp_acting_for: "landlord", created_at: "2026-06-01", completed_at: null,
});
ENRICHED.DSH = {
  id: "DSH", name: "Shared parent/sub deal", deal_type: "Investment", status: "SOL", stage: "sols",
  property_id: "P1", property_name: "Brent Cross", unit_name: null, tenancy_unit_name: null,
  landlord_id: "HAM", tenant_id: null, vendor_id: "HAMUK", purchaser_id: null,
  landlord_name: "Hammerson", tenant_name: null, vendor_name: "Hammerson UK", purchaser_name: null,
  team: [], internal_agent: [], updated_at: "2026-06-01T10:00:00Z",
  instructed_at: null, target_date: null, completed_at: null, fee: 5000,
};

// DVENDOR — subsidiary is the vendor (investment mandate) at Dundrum.
DEALS.push({
  id: "DVENDOR", name: "Dundrum disposal", status: "LIVE", property_id: "P2",
  landlord_id: "OTHER", tenant_id: null, vendor_id: "HAMUK", purchaser_id: "BUYER",
  bgp_acting_for: "landlord", created_at: "2026-07-01", completed_at: null,
});
ENRICHED.DVENDOR = {
  id: "DVENDOR", name: "Dundrum disposal", deal_type: "Investment", status: "LIVE", stage: null,
  property_id: "P2", property_name: "Dundrum Town Centre", unit_name: null, tenancy_unit_name: null,
  landlord_id: "OTHER", tenant_id: null, vendor_id: "HAMUK", purchaser_id: "BUYER",
  landlord_name: "Other Co", tenant_name: null, vendor_name: "Hammerson UK", purchaser_name: "Buyer Co",
  team: [], internal_agent: ["Bob Jones"], updated_at: "2026-07-01T10:00:00Z",
  instructed_at: null, target_date: null, completed_at: null, fee: 9000,
};

// DT1 — tenant-rep letting AT Brent Cross: related market activity, never
// a Hammerson instruction.
DEALS.push({
  id: "DT1", name: "Acme at Brent Cross", status: "LIVE", property_id: "P1",
  landlord_id: "HAM", tenant_id: "ACME", vendor_id: null, purchaser_id: null,
  bgp_acting_for: "tenant", created_at: "2026-08-01", completed_at: null,
});
ENRICHED.DT1 = {
  id: "DT1", name: "Acme at Brent Cross", deal_type: "Letting", status: "LIVE", stage: null,
  property_id: "P1", property_name: "Brent Cross", unit_name: "Unit 44", tenancy_unit_name: null,
  landlord_id: "HAM", tenant_id: "ACME", vendor_id: null, purchaser_id: null,
  landlord_name: "Hammerson", tenant_name: "Acme", vendor_name: null, purchaser_name: null,
  team: ["Alice Smith"], internal_agent: [], updated_at: "2026-08-01T10:00:00Z",
  instructed_at: null, target_date: null, completed_at: null, fee: 750,
};

const TASKS = [
  { id: "T1", title: "Chase solicitor", due_date: "2026-10-01T00:00:00Z", linked_deal_id: "D1", owner_name: "Alice Smith" },
  { id: "T2", title: "Send HOTs", due_date: "2026-09-25T00:00:00Z", linked_deal_id: "D1", owner_name: "Bob Jones" },
  { id: "T3", title: "Done task", due_date: "2026-09-01T00:00:00Z", linked_deal_id: "D1", owner_name: "Alice Smith" }, // done — excluded
];

function makeMockPool(): Querier & { queries: string[] } {
  const queries: string[] = [];
  return {
    queries,
    async query(sql: string, params: any[] = []) {
      queries.push(sql);
      const rows = ((): any[] => {
        // account-deals enrichment queries first (more specific patterns)
        if (/FROM crm_deals d\s+LEFT JOIN crm_properties p/.test(sql)) {
          const ids = params[0] as string[];
          return ids.filter(id => ENRICHED[id]).map(id => ENRICHED[id]);
        }
        if (/FROM user_tasks t/.test(sql)) {
          const ids = params[0] as string[];
          return TASKS
            .filter(t => t.id !== "T3") // the done row never leaves the DB filter
            .filter(t => ids.includes(t.linked_deal_id))
            .sort((a, b) => a.due_date.localeCompare(b.due_date));
        }
        // resolver queries (mirrors account-resolver.test.ts)
        if (/FROM crm_companies WHERE parent_company_id = \$1/.test(sql)) return CHILDREN[params[0]] ?? [];
        if (/FROM crm_companies WHERE id = \$1/.test(sql)) return COMPANIES[params[0]] ? [COMPANIES[params[0]]] : [];
        if (/FROM crm_trading_entities/.test(sql)) return [];
        if (/FROM crm_company_properties cp/.test(sql)) return [];
        if (/FROM crm_properties p/.test(sql)) {
          return OWNERSHIP.filter(o => (params[0] as string[]).some(id => [o.landlord_id, o.freeholder_id, o.long_leaseholder_id].includes(id)));
        }
        if (/UNION SELECT id FROM crm_properties WHERE landlord_id/.test(sql)) {
          return params[0] === "HAMUK" ? [{ id: "P2" }] : [];
        }
        if (/internal_agent_ids/.test(sql)) return [];
        if (/FROM crm_deals d\s+LEFT JOIN crm_companies tc/.test(sql)) {
          const entityIds = params[0] as string[];
          const scope = params[1] as string | undefined;
          return DEALS
            .filter(d => [d.landlord_id, d.tenant_id, d.vendor_id, d.purchaser_id].some(id => id && entityIds.includes(id)) || (LINKED[d.id] || []).some(id => entityIds.includes(id)))
            .filter(d => !scope || d.landlord_id === scope || d.vendor_id === scope || d.purchaser_id === scope)
            .map(d => ({ ...d, tenant_name: d.tenant_id === "ACME" ? "Acme" : null, linked_entity_ids: (LINKED[d.id] || []).filter(id => entityIds.includes(id)) }));
        }
        if (/FROM crm_contacts ct/.test(sql)) return [];
        if (/FROM crm_client_team_members m/.test(sql)) return [];
        if (/FROM crm_property_agents/.test(sql)) return [];
        if (/FROM users WHERE id = ANY/.test(sql)) return [];
        return [];
      })();
      return { rows, rowCount: rows.length };
    },
  };
}

// ─── Pure helpers ─────────────────────────────────────────────────────────

describe("dealCounterparty", () => {
  const row = {
    landlord_id: "HAM", tenant_id: "T1", vendor_id: null, purchaser_id: null,
    landlord_name: "Hammerson", tenant_name: "Tenant 1", vendor_name: null, purchaser_name: null,
  };
  it("returns the tenant for a landlord instruction", () => {
    assert.equal(dealCounterparty(row, "HAM", null), "Tenant 1");
  });
  it("returns the landlord for a tenant instruction", () => {
    assert.equal(dealCounterparty(row, "T1", null), "Hammerson");
  });
  it("falls back to the resolver's related-activity counterparty", () => {
    assert.equal(dealCounterparty(row, null, "Acme"), "Acme");
  });
});

describe("filterAccountDeals", () => {
  const rows = [
    { bucket: "instruction", partyEntityId: "HAM", propertyId: "P1", service: "Letting", status: "LIVE", stage: null, team: ["Alice Smith"], lastActivityAt: "2026-03-10T00:00:00Z" },
    { bucket: "instruction", partyEntityId: "HAMUK", propertyId: "P2", service: "Investment", status: "SOL", stage: "sols", team: ["Bob Jones"], lastActivityAt: "2026-07-01T00:00:00Z" },
    { bucket: "related", partyEntityId: null, propertyId: "P1", service: "Letting", status: "COM", stage: null, team: [], lastActivityAt: "2026-08-01T00:00:00Z" },
  ];
  it("filters by bucket, property, entity, service, person", () => {
    assert.equal(filterAccountDeals(rows, { bucket: "related" }).length, 1);
    assert.equal(filterAccountDeals(rows, { propertyId: "P2" })[0].partyEntityId, "HAMUK");
    assert.equal(filterAccountDeals(rows, { entityId: "HAMUK" }).length, 1);
    assert.equal(filterAccountDeals(rows, { service: "investment" }).length, 1);
    assert.equal(filterAccountDeals(rows, { person: "alice smith" }).length, 1);
  });
  it("stage matches the free-text stage, the canonical code, or the raw status", () => {
    assert.equal(filterAccountDeals(rows, { stage: "SOL" }).length, 1);
    assert.equal(filterAccountDeals(rows, { stage: "sols" }).length, 1);
    assert.equal(filterAccountDeals(rows, { stage: "COM" })[0].bucket, "related");
    // legacy raw status resolves through the canonical vocabulary
    assert.equal(filterAccountDeals(rows, { stage: "Completed" })[0].bucket, "related");
  });
  it("date range is inclusive on last activity", () => {
    assert.equal(filterAccountDeals(rows, { from: "2026-03-01", to: "2026-03-31" }).length, 1);
    assert.equal(filterAccountDeals(rows, { from: "2026-07-01", to: "2026-07-01" }).length, 1);
    assert.equal(filterAccountDeals(rows, { to: "2026-01-01" }).length, 0);
  });
});

// ─── listAccountDeals against the mock pool ───────────────────────────────

describe("listAccountDeals (mock pool)", () => {
  it("counts 30+ deals with totals independent of page size", async () => {
    const pool = makeMockPool();
    const p1 = await listAccountDeals("HAM", { page: 1, pageSize: 10 }, { pool });
    const p2 = await listAccountDeals("HAM", { page: 2, pageSize: 10 }, { pool });
    const p3 = await listAccountDeals("HAM", { page: 3, pageSize: 10 }, { pool });
    const p4 = await listAccountDeals("HAM", { page: 4, pageSize: 10 }, { pool });
    assert.equal(p1.total, 33);
    assert.equal(p4.total, 33); // same total on the last page
    assert.equal(p1.deals.length, 10);
    assert.equal(p4.deals.length, 3);
    const all = [...p1.deals, ...p2.deals, ...p3.deals, ...p4.deals];
    assert.equal(new Set(all.map(d => d.dealId)).size, 33); // every deal exactly once

    const big = await listAccountDeals("HAM", { page: 1, pageSize: 25 }, { pool });
    assert.equal(big.total, 33); // >25 deals still correctly counted
    assert.equal(big.deals.length, 25);
    const big2 = await listAccountDeals("HAM", { page: 2, pageSize: 25 }, { pool });
    assert.equal(big2.total, 33);
    assert.equal(big2.deals.length, 8);

    assert.equal(p1.completedTotal, 2); // D1, D2 are COM
    assert.equal(big.completedTotal, 2);
  });

  it("a deal linked to parent + subentity (FK + join) appears exactly once", async () => {
    const pool = makeMockPool();
    const res = await listAccountDeals("HAM", { page: 1, pageSize: 100 }, { pool });
    assert.equal(res.deals.filter(d => d.dealId === "DSH").length, 1);
    const dsh = res.deals.find(d => d.dealId === "DSH")!;
    assert.equal(dsh.bucket, "instruction");
    assert.equal(dsh.partyEntityId, "HAM"); // landlord FK wins
    assert.equal(dsh.counterparty, "Hammerson UK");
  });

  it("tenant-rep at an owned centre is related activity, never an instruction", async () => {
    const pool = makeMockPool();
    const res = await listAccountDeals("HAM", { page: 1, pageSize: 100 }, { pool });
    const dt1 = res.deals.find(d => d.dealId === "DT1")!;
    assert.equal(dt1.bucket, "related");
    assert.equal(dt1.activityKind, "tenant_rep");
    assert.equal(dt1.counterparty, "Acme");

    const instructionsOnly = await listAccountDeals("HAM", { page: 1, pageSize: 100, filters: { bucket: "instruction" } }, { pool });
    assert.ok(!instructionsOnly.deals.some(d => d.dealId === "DT1"));
    const relatedOnly = await listAccountDeals("HAM", { page: 1, pageSize: 100, filters: { bucket: "related" } }, { pool });
    assert.deepEqual(relatedOnly.deals.map(d => d.dealId), ["DT1"]);
  });

  it("applies property / entity / service / stage / person / date filters", async () => {
    const pool = makeMockPool();
    const at = (f: any) => listAccountDeals("HAM", { page: 1, pageSize: 100, filters: f }, { pool });

    assert.equal((await at({ propertyId: "P2" })).deals.map(d => d.dealId).join(), "DVENDOR");
    assert.equal((await at({ entityId: "HAMUK" })).deals.map(d => d.dealId).join(), "DVENDOR");
    assert.deepEqual((await at({ service: "Investment" })).deals.map(d => d.dealId).sort(), ["DSH", "DVENDOR"]);
    assert.deepEqual((await at({ stage: "COM" })).deals.map(d => d.dealId).sort(), ["D1", "D2"]);
    assert.deepEqual((await at({ person: "Alice Smith" })).deals.map(d => d.dealId).sort(), ["D1", "DT1"]);
    assert.deepEqual(
      (await at({ from: "2026-03-01", to: "2026-03-31" })).deals.map(d => d.dealId).sort(),
      ["D10", "D18", "D2", "D26"],
    );
    // filters narrow totals too
    assert.equal((await at({ stage: "COM" })).total, 2);
  });

  it("completed deals stay reachable via the stage filter, never deleted", async () => {
    const pool = makeMockPool();
    const res = await listAccountDeals("HAM", { page: 1, pageSize: 100, filters: { stage: "Completed" } }, { pool });
    assert.equal(res.total, 2);
    assert.equal(res.completedTotal, 2);
  });

  it("staff get fees, team names and task-based next actions", async () => {
    const pool = makeMockPool();
    const res = await listAccountDeals("HAM", { page: 1, pageSize: 100 }, { pool });
    assert.equal(res.feesVisible, true);
    const d1 = res.deals.find(d => d.dealId === "D1")!;
    assert.equal(d1.fee, 1001);
    assert.deepEqual(d1.team, ["Alice Smith"]);
    // earliest-due open task wins; the done task never competes
    assert.equal(d1.nextAction?.taskId, "T2");
    assert.equal(d1.nextAction?.ownerName, "Bob Jones");
    assert.ok(d1.nextAction?.dueDate?.startsWith("2026-09-25"));
    // filter options come from the unfiltered universe
    assert.ok(res.services.includes("Letting") && res.services.includes("Investment"));
    assert.ok(res.people.includes("Alice Smith") && res.people.includes("Bob Jones"));
    assert.ok(res.properties.some(p => p.propertyId === "P2"));
  });

  it("scoped viewers get no fee key, no team, no next actions — and only their own deals", async () => {
    const pool = makeMockPool();
    const res = await listAccountDeals("HAM", { scopeCompanyId: "HAMUK", page: 1, pageSize: 100 }, { pool });
    assert.equal(res.feesVisible, false);
    assert.deepEqual(res.deals.map(d => d.dealId).sort(), ["DSH", "DVENDOR"]);
    for (const d of res.deals) {
      assert.ok(!("fee" in d), `fee leaked on ${d.dealId}`);
      assert.deepEqual(d.team, []);
      assert.equal(d.nextAction, null);
    }
    // properties are scoped to the viewer's own rows (P2 only)
    assert.deepEqual(res.properties.map(p => p.propertyId), ["P2"]);
  });

  it("issues no mutating statements", async () => {
    const pool = makeMockPool();
    await listAccountDeals("HAM", { page: 1, pageSize: 100 }, { pool });
    await listAccountDeals("HAM", { scopeCompanyId: "HAMUK", page: 1, pageSize: 100 }, { pool });
    assert.ok(pool.queries.length > 0);
    for (const sql of pool.queries) {
      assert.match(sql, /^\s*SELECT/i, sql);
      assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP)\b/i, sql);
    }
  });
});
