/**
 * account-resolver.test.ts — Delivery 2 account view assembly.
 *
 * Covers the pure helpers (entity-tree walk with cycle protection, deal
 * classification, property merge) without a database, and the full
 * resolveAccountView against a mock pool: instruction vs related-activity
 * split on a tenant-rep-at-owned-centre fixture, contact dedup across
 * employer + property paths, totals without double counting, scope
 * filtering that never adds rows, and a pool spy asserting the resolver
 * issues zero mutating statements.
 *
 * Run with: node --import tsx --test server/account-resolver.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  walkEntityTree,
  assembleProperties,
  classifyDealForAccount,
  resolveAccountView,
  type AccountDealRow,
  type CompanyGraphRow,
  type Querier,
} from "./account-resolver";

describe("walkEntityTree", () => {
  it("terminates on an A→B→A parent loop and flags the closing row unresolved", () => {
    const rows: CompanyGraphRow[] = [
      { id: "A", name: "A Ltd", company_type: "Landlord", companies_house_number: null, parent_company_id: "B", merged_into_id: null },
      { id: "B", name: "B Ltd", company_type: "Landlord", companies_house_number: null, parent_company_id: "A", merged_into_id: null },
    ];
    const entities = walkEntityTree(rows, [], "A");
    assert.equal(entities.length, 2);
    const root = entities.find(e => e.relation === "self")!;
    assert.equal(root.relationConfidence, "unresolved");
    assert.equal(root.evidence, "cycle detected");
    const parent = entities.find(e => e.companyId === "B")!;
    assert.equal(parent.relation, "parent");
  });

  it("walks up to the top ancestor, collects descendants, and appends trading entities", () => {
    const rows: CompanyGraphRow[] = [
      { id: "ROOT", name: "Mid Co", company_type: "Landlord", companies_house_number: null, parent_company_id: "TOP", merged_into_id: null },
      { id: "TOP", name: "Top Co", company_type: "REIT", companies_house_number: "111", parent_company_id: null, merged_into_id: null },
      { id: "SIB", name: "Sibling Co", company_type: "Landlord", companies_house_number: null, parent_company_id: "TOP", merged_into_id: null },
      { id: "KID", name: "Kid Co", company_type: "Landlord", companies_house_number: null, parent_company_id: "ROOT", merged_into_id: null },
    ];
    const trading = [{ id: "TE1", name: "Kid Trading Ltd", companies_house_number: "222", parent_company_id: "KID" }];
    const entities = walkEntityTree(rows, trading, "ROOT");
    const byId = new Map(entities.map(e => [e.companyId, e]));
    assert.deepEqual([...byId.keys()].sort(), ["KID", "ROOT", "SIB", "TE1", "TOP"]);
    assert.equal(byId.get("TOP")!.relation, "parent");
    assert.equal(byId.get("SIB")!.relation, "subsidiary");
    assert.equal(byId.get("KID")!.relation, "subsidiary");
    assert.equal(byId.get("TE1")!.relation, "trading_entity");
    assert.ok(entities.every(e => e.relationConfidence === "confirmed"));
  });

  it("follows merged_into_id once to read the surviving row's parent", () => {
    const rows: CompanyGraphRow[] = [
      { id: "OLD", name: "Old Co", company_type: null, companies_house_number: null, parent_company_id: null, merged_into_id: "NEW" },
      { id: "NEW", name: "New Co", company_type: "Landlord", companies_house_number: null, parent_company_id: "TOP", merged_into_id: null },
      { id: "TOP", name: "Top Co", company_type: "REIT", companies_house_number: null, parent_company_id: null, merged_into_id: null },
    ];
    const entities = walkEntityTree(rows, [], "OLD");
    const byId = new Map(entities.map(e => [e.companyId, e]));
    assert.equal(byId.get("TOP")?.relation, "parent");
  });
});

describe("assembleProperties", () => {
  it("dedupes by property, merges sources, and keeps landlord-at-root confirmed", () => {
    const out = assembleProperties(
      [{ id: "P1", name: "Brent Cross", postcode: "NW4 3FP", country: "GB", landlord_id: "ROOT", freeholder_id: "ROOT", long_leaseholder_id: null, unit_count: 100 }],
      [{ property_id: "P1", company_id: "ROOT", relationship_role: null, ownership_stake_pct: null, relationship_confidence: null, relationship_source: null, name: "Brent Cross", postcode: "NW4 3FP", country: "GB", unit_count: 100 }],
      "ROOT",
    );
    assert.equal(out.length, 1);
    const p = out[0];
    assert.equal(p.relationshipRole, "owner");
    assert.equal(p.confidence, "confirmed");
    assert.deepEqual(p.sources.sort(), ["company_property_link", "freeholder_id", "landlord_id"]);
    assert.equal(p.unitCount, 100);
  });

  it("marks landlord links reached via the tree as inferred, and NULL link role as unknown", () => {
    const out = assembleProperties(
      [{ id: "P2", name: "Dundrum", postcode: null, country: "IE", landlord_id: "SUB", freeholder_id: null, long_leaseholder_id: null, unit_count: 0 }],
      [{ property_id: "P3", company_id: "ROOT", relationship_role: null, ownership_stake_pct: 40, relationship_confidence: null, relationship_source: null, name: "Bullring", postcode: "B5 4BU", country: "GB", unit_count: 0 }],
      "ROOT",
    );
    const p2 = out.find(p => p.propertyId === "P2")!;
    assert.equal(p2.confidence, "inferred");
    assert.equal(p2.owningEntityId, "SUB");
    const p3 = out.find(p => p.propertyId === "P3")!;
    assert.equal(p3.relationshipRole, "unknown");
    assert.equal(p3.confidence, "unresolved");
    assert.equal(p3.ownershipStakePct, 40);
  });
});

describe("classifyDealForAccount", () => {
  const entities = new Set(["HAM", "HAMUK"]);
  const portfolio = new Set(["P1"]);

  it("treats a landlord-rep deal with an account landlord as an instruction", () => {
    const cls = classifyDealForAccount(
      { id: "D1", name: "d", status: "LIVE", property_id: "P1", landlord_id: "HAM", tenant_id: "T", vendor_id: null, purchaser_id: null, bgp_acting_for: "landlord", created_at: null, completed_at: null },
      entities, portfolio,
    );
    assert.deepEqual(cls, { bucket: "instruction", partyEntityId: "HAM" });
  });

  it("treats a tenant-rep deal at an account centre as related activity, NOT an instruction", () => {
    const cls = classifyDealForAccount(
      { id: "D2", name: "d", status: "LIVE", property_id: "P1", landlord_id: "HAM", tenant_id: "ACME", vendor_id: null, purchaser_id: null, bgp_acting_for: "tenant", created_at: null, completed_at: null },
      entities, portfolio,
    );
    assert.deepEqual(cls, { bucket: "related", activityKind: "tenant_rep" });
  });

  it("treats vendor/purchaser counterparties on the default side as instructions (investment mandate)", () => {
    const cls = classifyDealForAccount(
      { id: "D3", name: "d", status: "LIVE", property_id: null, landlord_id: null, tenant_id: null, vendor_id: "HAMUK", purchaser_id: "OTHER", bgp_acting_for: "landlord", created_at: null, completed_at: null },
      entities, portfolio,
    );
    assert.deepEqual(cls, { bucket: "instruction", partyEntityId: "HAMUK" });
  });

  it("joins explicitly linked deals to the instruction list when no FK rule contradicts", () => {
    const cls = classifyDealForAccount(
      { id: "D5", name: "d", status: "LIVE", property_id: null, landlord_id: null, tenant_id: null, vendor_id: null, purchaser_id: null, bgp_acting_for: "landlord", created_at: null, completed_at: null, linked_entity_ids: ["HAM"] },
      entities, portfolio,
    );
    assert.deepEqual(cls, { bucket: "instruction", partyEntityId: "HAM" });
  });

  it("returns null for deals with no account party and no portfolio property", () => {
    const cls = classifyDealForAccount(
      { id: "D9", name: "d", status: "LIVE", property_id: "PX", landlord_id: "OTHER", tenant_id: "T", vendor_id: null, purchaser_id: null, bgp_acting_for: "landlord", created_at: null, completed_at: null },
      entities, portfolio,
    );
    assert.equal(cls, null);
  });
});

// ─── Full resolveAccountView against a mock pool ─────────────────────────

const COMPANIES: Record<string, CompanyGraphRow> = {
  HAM: { id: "HAM", name: "Hammerson", company_type: "REIT", companies_house_number: "111", parent_company_id: null, merged_into_id: null },
  HAMUK: { id: "HAMUK", name: "Hammerson UK", company_type: "Landlord", companies_house_number: null, parent_company_id: "HAM", merged_into_id: null },
};
const CHILDREN: Record<string, CompanyGraphRow[]> = { HAM: [COMPANIES.HAMUK], HAMUK: [] };
const TRADING = [{ id: "TE1", name: "Hammerson UK Ltd", companies_house_number: "222", parent_company_id: "HAMUK" }];

const OWNERSHIP = [
  { id: "P1", name: "Brent Cross", postcode: "NW4 3FP", country: "GB", landlord_id: "HAM", freeholder_id: null, long_leaseholder_id: null, unit_count: 100 },
  { id: "P2", name: "Dundrum Town Centre", postcode: null, country: "IE", landlord_id: "HAMUK", freeholder_id: null, long_leaseholder_id: null, unit_count: 120 },
];
const LINKS = [
  { property_id: "P3", company_id: "HAM", relationship_role: null, ownership_stake_pct: null, relationship_confidence: null, relationship_source: null, name: "Bullring", postcode: "B5 4BU", country: "GB", unit_count: 50 },
];
const DEAL_LINKS: Record<string, string[]> = { D5: ["HAM"] };
const DEALS: AccountDealRow[] = [
  { id: "D1", name: "Brent Cross letting", status: "COM", property_id: "P1", landlord_id: "HAM", tenant_id: "T1", vendor_id: null, purchaser_id: null, bgp_acting_for: "landlord", created_at: "2026-01-01", completed_at: null },
  { id: "D2", name: "Acme at Brent Cross", status: "LIVE", property_id: "P1", landlord_id: "HAM", tenant_id: "ACME", vendor_id: null, purchaser_id: null, bgp_acting_for: "tenant", created_at: "2026-02-01", completed_at: null },
  { id: "D3", name: "HAMUK disposals", status: "LIVE", property_id: null, landlord_id: null, tenant_id: null, vendor_id: "HAMUK", purchaser_id: "OTHER", bgp_acting_for: "landlord", created_at: "2026-03-01", completed_at: null },
  { id: "D4", name: "Shared parent/sub deal", status: "LIVE", property_id: "P2", landlord_id: "HAM", tenant_id: null, vendor_id: "HAMUK", purchaser_id: null, bgp_acting_for: "landlord", created_at: "2026-04-01", completed_at: null },
  { id: "D5", name: "Linked-only mandate", status: "LIVE", property_id: null, landlord_id: null, tenant_id: null, vendor_id: null, purchaser_id: null, bgp_acting_for: "landlord", created_at: "2026-05-01", completed_at: null },
];
const CONTACTS = [
  { id: "C1", name: "Alice", role: "AM", email: "a@ham.example", phone: null, linkedin_url: null, avatar_url: null, company_id: "HAM" },
  { id: "C2", name: "Bob", role: "Centre manager", email: "b@ham.example", phone: null, linkedin_url: null, avatar_url: null, company_id: "HAM" },
  { id: "C3", name: "Carol", role: "Ops", email: "c@example.com", phone: null, linkedin_url: null, avatar_url: null, company_id: null },
];
const CONTACT_PROPERTIES: Record<string, string[]> = { C2: ["P1"] };
const PROPERTY_CLIENTS: Record<string, string[]> = { C3: ["P2"] };
const INTERACTION_STATS = [{ contact_id: "C1", touches: 5, last_touch: "2026-09-01" }];
const CURATED = [{ user_id: "U1", team_group: "Investment", role: "Lead" }];
const PROPERTY_AGENTS = [{ user_id: "U2", role: "Leasing" }];
const CONTRIBUTORS = [{ uid: "U3" }];
const USERS = [
  { id: "U1", name: "Una", email: "una@bgp.example" },
  { id: "U2", name: "Ulf", email: "ulf@bgp.example" },
  { id: "U3", name: "Uma", email: "uma@bgp.example" },
];

function makeMockPool(overrides: {
  companies?: Record<string, CompanyGraphRow>;
  children?: Record<string, CompanyGraphRow[]>;
} = {}): Querier & { queries: string[] } {
  const companies = overrides.companies ?? COMPANIES;
  const children = overrides.children ?? CHILDREN;
  const queries: string[] = [];
  return {
    queries,
    async query(sql: string, params: any[] = []) {
      queries.push(sql);
      const rows = ((): any[] => {
        if (/FROM crm_companies WHERE parent_company_id = \$1/.test(sql)) return children[params[0]] ?? [];
        if (/FROM crm_companies WHERE id = \$1/.test(sql)) return companies[params[0]] ? [companies[params[0]]] : [];
        if (/FROM crm_trading_entities/.test(sql)) return TRADING.filter(t => (params[0] as string[]).includes(t.parent_company_id));
        if (/FROM crm_company_properties cp/.test(sql)) return LINKS.filter(l => (params[0] as string[]).includes(l.company_id));
        if (/FROM crm_properties p/.test(sql)) return OWNERSHIP.filter(o => (params[0] as string[]).some(id => [o.landlord_id, o.freeholder_id, o.long_leaseholder_id].includes(id)));
        if (/UNION SELECT id FROM crm_properties WHERE landlord_id/.test(sql)) {
          // scope lookup: HAMUK owns P2 directly, no links
          return params[0] === "HAMUK" ? [{ id: "P2" }] : [];
        }
        if (/internal_agent_ids/.test(sql)) return CONTRIBUTORS;
        if (/FROM crm_deals d\s+LEFT JOIN/.test(sql)) {
          const entityIds = params[0] as string[];
          const scope = params[1] as string | undefined;
          return DEALS
            .filter(d => [d.landlord_id, d.tenant_id, d.vendor_id, d.purchaser_id].some(id => id && entityIds.includes(id)) || (DEAL_LINKS[d.id] || []).some(id => entityIds.includes(id)))
            .filter(d => !scope || d.landlord_id === scope || d.vendor_id === scope || d.purchaser_id === scope)
            .map(d => ({ ...d, tenant_name: d.tenant_id === "ACME" ? "Acme" : null, linked_entity_ids: (DEAL_LINKS[d.id] || []).filter(id => entityIds.includes(id)) }));
        }
        if (/FROM crm_contacts ct/.test(sql)) {
          const entityIds = params[0] as string[];
          const portfolio = params[1] as string[];
          return CONTACTS
            .map(c => ({
              ...c,
              via_employer: c.company_id != null && entityIds.includes(c.company_id),
              via_property: (CONTACT_PROPERTIES[c.id] || []).some(p => portfolio.includes(p)),
              via_property_client: (PROPERTY_CLIENTS[c.id] || []).some(p => portfolio.includes(p)),
            }))
            .filter(c => c.via_employer || c.via_property || c.via_property_client);
        }
        if (/FROM crm_interactions/.test(sql)) return INTERACTION_STATS.filter(s => (params[0] as string[]).includes(s.contact_id));
        if (/FROM crm_client_team_members m/.test(sql)) return CURATED;
        if (/FROM crm_property_agents/.test(sql)) return PROPERTY_AGENTS;
        if (/FROM users WHERE id = ANY/.test(sql)) return USERS.filter(u => (params[0] as string[]).includes(u.id));
        return [];
      })();
      return { rows, rowCount: rows.length };
    },
  };
}

describe("resolveAccountView (mock pool)", () => {
  it("assembles the entity tree, portfolio, instructions and related activity", async () => {
    const pool = makeMockPool();
    const view = await resolveAccountView("HAM", {}, { pool });

    assert.equal(view.root.companyId, "HAM");
    assert.deepEqual(view.entities.map(e => e.companyId).sort(), ["HAM", "HAMUK", "TE1"]);

    assert.deepEqual(view.properties.map(p => p.propertyId), ["P1", "P3", "P2"]);
    const p2 = view.properties.find(p => p.propertyId === "P2")!;
    assert.equal(p2.country, "IE");
    assert.equal(p2.confidence, "inferred"); // reached via subsidiary, not the root
    const p3 = view.properties.find(p => p.propertyId === "P3")!;
    assert.equal(p3.relationshipRole, "unknown"); // NULL link role is never assumed "owner"

    // The tenant-rep letting at Brent Cross is related market activity, NOT
    // a Hammerson instruction.
    assert.deepEqual(view.instructions.map(i => i.dealId).sort(), ["D1", "D3", "D4", "D5"]);
    assert.deepEqual(view.relatedMarketActivity.map(r => r.dealId), ["D2"]);
    assert.equal(view.relatedMarketActivity[0].activityKind, "tenant_rep");
    assert.equal(view.relatedMarketActivity[0].counterpartyName, "Acme");

    // Totals over the deduped counterparty set: D4 (parent + subsidiary on
    // one deal) counts once; the linked-only D5 is not a counterparty deal.
    assert.deepEqual(view.totals, { deals: 4, completedDeals: 1 });
  });

  it("dedupes contacts across employer and property paths, with interaction stats grouped once", async () => {
    const view = await resolveAccountView("HAM", {}, { pool: makeMockPool() });
    assert.deepEqual(view.contacts.map(c => c.contactId), ["C1", "C2", "C3"]);
    const c2 = view.contacts.find(c => c.contactId === "C2")!;
    assert.deepEqual(c2.via, ["employer", "property"]);
    const c1 = view.contacts.find(c => c.contactId === "C1")!;
    assert.equal(c1.interactionCount, 5);
    assert.equal(c1.lastInteractionAt, "2026-09-01");
  });

  it("unions the curated board, property agents and evidenced deal contributors", async () => {
    const view = await resolveAccountView("HAM", {}, { pool: makeMockPool() });
    const byUser = new Map(view.team.map(m => [m.userId, m]));
    assert.deepEqual([...byUser.keys()].sort(), ["U1", "U2", "U3"]);
    assert.deepEqual(byUser.get("U1")!.sources, ["curated"]);
    assert.deepEqual(byUser.get("U2")!.sources, ["property_agent"]);
    assert.deepEqual(byUser.get("U3")!.sources, ["deal_contributor"]);
  });

  it("filters a scoped viewer to their own rows and never adds any", async () => {
    const staff = await resolveAccountView("HAM", {}, { pool: makeMockPool() });
    const scoped = await resolveAccountView("HAM", { scopeCompanyId: "HAMUK" }, { pool: makeMockPool() });

    assert.deepEqual(scoped.properties.map(p => p.propertyId), ["P2"]);
    assert.ok(scoped.properties.every(p => staff.properties.some(sp => sp.propertyId === p.propertyId)));
    // Scoped instructions follow the counterparty rule (vendor/purchaser/landlord = scope).
    assert.deepEqual(scoped.instructions.map(i => i.dealId).sort(), ["D3", "D4"]);
    // Fees/team stripped and interactions emptied for clients.
    assert.deepEqual(scoped.team, []);
    assert.ok(scoped.contacts.every(c => c.interactionCount === 0 && c.lastInteractionAt === null));
    assert.deepEqual(scoped.contacts.map(c => c.contactId), ["C3"]);
  });

  it("issues no mutating statements", async () => {
    const pool = makeMockPool();
    await resolveAccountView("HAM", {}, { pool });
    assert.ok(pool.queries.length > 0);
    for (const sql of pool.queries) {
      assert.match(sql, /^\s*SELECT/i, sql);
      assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP)\b/i, sql);
    }
  });

  it("terminates on a parent loop and flags the closing row", async () => {
    const a: CompanyGraphRow = { id: "A", name: "A Ltd", company_type: null, companies_house_number: null, parent_company_id: "B", merged_into_id: null };
    const b: CompanyGraphRow = { id: "B", name: "B Ltd", company_type: null, companies_house_number: null, parent_company_id: "A", merged_into_id: null };
    const pool = makeMockPool({ companies: { A: a, B: b }, children: { A: [b], B: [a] } });
    const view = await resolveAccountView("A", {}, { pool });
    assert.equal(view.entities.length, 2);
    assert.equal(view.root.relationConfidence, "unresolved");
    assert.equal(view.root.evidence, "cycle detected");
  });

  it("throws when the company does not exist", async () => {
    await assert.rejects(
      resolveAccountView("NOPE", {}, { pool: makeMockPool() }),
      /company not found/,
    );
  });
});
