/**
 * account-workspace.test.ts — Delivery 3 Task 2: team view, unified
 * contacts, next actions, investment requirements.
 *
 * Mock-pool tests (Delivery 2 pattern — no live database): team dedupe
 * across curated / property-agent / deal-contributor / interaction-evidenced
 * sources with is_lead; unified contacts with employer + property names and
 * via sources; next actions linked via deal / property / contact; investment
 * requirements only when records exist; scoped viewers get no team/tasks.
 *
 * Run with: node --import tsx --test server/account-workspace.test.ts
 */
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import type { Querier } from "./account-resolver";

// The module's router imports ./auth → ./db, which requires DATABASE_URL at
// load time. Set a dummy and import lazily — the pool is never queried
// (same pattern as account-reconciliation.test.ts).
let getAccountWorkspace: typeof import("./account-workspace").getAccountWorkspace;
let assembleWorkspaceTeam: typeof import("./account-workspace").assembleWorkspaceTeam;
before(async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://test:test@localhost:1/test";
  ({ getAccountWorkspace, assembleWorkspaceTeam } = await import("./account-workspace"));
});

// ─── Fixture ──────────────────────────────────────────────────────────────

const COMPANIES: Record<string, any> = {
  HAM: { id: "HAM", name: "Hammerson", company_type: "REIT", companies_house_number: "111", parent_company_id: null, merged_into_id: null },
  HAMUK: { id: "HAMUK", name: "Hammerson UK", company_type: "Landlord", companies_house_number: null, parent_company_id: "HAM", merged_into_id: null },
};
const CHILDREN: Record<string, any[]> = { HAM: [COMPANIES.HAMUK], HAMUK: [] };
const OWNERSHIP = [
  { id: "P1", name: "Brent Cross", postcode: "NW4 3FP", country: "GB", landlord_id: "HAM", freeholder_id: null, long_leaseholder_id: null, unit_count: 100 },
  { id: "P2", name: "Dundrum Town Centre", postcode: null, country: "IE", landlord_id: "HAMUK", freeholder_id: null, long_leaseholder_id: null, unit_count: 120 },
];
const DEALS = [
  { id: "D1", name: "Brent Cross letting", status: "LIVE", property_id: "P1", landlord_id: "HAM", tenant_id: "T1", vendor_id: null, purchaser_id: null, bgp_acting_for: "landlord", created_at: "2026-01-01", completed_at: null },
];
const CONTACTS = [
  { id: "C1", name: "Alice Asset", role: "Asset manager", email: "a@ham.example", phone: null, linkedin_url: null, avatar_url: null, company_id: "HAM" },
  { id: "C3", name: "Carol Ops", role: "Ops", email: "c@example.com", phone: null, linkedin_url: null, avatar_url: null, company_id: "EXT" },
];
const CONTACT_PROPERTY_LINKS = [{ contact_id: "C3", property_id: "P1", name: "Brent Cross" }];
const INTERACTION_STATS = [{ contact_id: "C1", touches: 5, last_touch: "2026-09-01" }];
const CURATED = [{ user_id: "U1", team_group: "Investment", role: "Lead" }];
const PROPERTY_AGENTS = [{ user_id: "U2", role: "Leasing" }];
const CONTRIBUTORS = [{ uid: "U3" }];
const USERS = [
  { id: "U1", name: "Una", email: "una@bgp.example" },
  { id: "U2", name: "Ulf", email: "ulf@bgp.example" },
  { id: "U3", name: "Uma", email: "uma@bgp.example" },
];
const LEADS = [{ user_id: "U1", is_lead: true }];
const AGENT_PROPERTIES = [{ user_id: "U2", name: "Brent Cross" }];
const INTERACTION_CONTRIBUTORS = [
  { key: "ulf", last_at: "2026-09-10T00:00:00Z" },          // exact name match → U2
  { key: "ghost writer", last_at: "2026-09-11T00:00:00Z" }, // no user — contributes nothing
];
const TASKS = [
  { id: "TK1", title: "Chase solicitor", status: "todo", priority: "high", due_date: "2026-10-01T00:00:00Z", linked_deal_id: "D1", linked_property_id: null, linked_contact_id: null, owner_name: "Una", deal_name: "Brent Cross letting", property_name: null, contact_name: null },
  { id: "TK2", title: "Book fire risk assessment", status: "in_progress", priority: "medium", due_date: "2026-09-28T00:00:00Z", linked_deal_id: null, linked_property_id: "P1", linked_contact_id: null, owner_name: "Ulf", deal_name: null, property_name: "Brent Cross", contact_name: null },
  { id: "TK3", title: "Intro call", status: "todo", priority: "low", due_date: null, linked_deal_id: null, linked_property_id: null, linked_contact_id: "C3", owner_name: "Uma", deal_name: null, property_name: null, contact_name: "Carol Ops" },
];
const REQUIREMENTS = [
  { id: "R1", name: "Retail park acquisitions", status: "Active", use: ["Retail"], size: ["50k-100k sqft"], locations: ["South East"], updated_at: "2026-09-01T00:00:00Z" },
];

function makeMockPool(overrides: { requirements?: any[] } = {}): Querier & { queries: string[] } {
  const requirements = overrides.requirements ?? REQUIREMENTS;
  const queries: string[] = [];
  return {
    queries,
    async query(sql: string, params: any[] = []) {
      queries.push(sql);
      const rows = ((): any[] => {
        // account-workspace enrichment queries first (specific patterns)
        if (/bool_or/.test(sql)) return LEADS;
        if (/FROM crm_property_agents pa/.test(sql)) return AGENT_PROPERTIES;
        if (/FROM crm_interactions i/.test(sql)) return INTERACTION_CONTRIBUTORS;
        if (/SELECT contact_id, property_id FROM crm_contact_properties/.test(sql)) return CONTACT_PROPERTY_LINKS;
        if (/SELECT id, name FROM crm_companies WHERE id = ANY/.test(sql)) {
          return [{ id: "EXT", name: "External Facilities Ltd" }].filter(r => (params[0] as string[]).includes(r.id));
        }
        if (/FROM user_tasks t/.test(sql)) {
          const [dealIds, propertyIds, contactIds] = params as string[][];
          return TASKS
            .filter(t =>
              (t.linked_deal_id && dealIds.includes(t.linked_deal_id)) ||
              (t.linked_property_id && propertyIds.includes(t.linked_property_id)) ||
              (t.linked_contact_id && contactIds.includes(t.linked_contact_id)))
            .sort((a, b) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999")); // due ASC NULLS LAST
        }
        if (/FROM crm_requirements_investment/.test(sql)) {
          // R1 hangs off HAM; a params list without HAM (e.g. scoped HAMUK) sees nothing
          return (params[0] as string[]).includes("HAM") ? requirements : [];
        }
        // resolver queries
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
        if (/internal_agent_ids/.test(sql)) return CONTRIBUTORS;
        if (/FROM crm_deals d\s+LEFT JOIN/.test(sql)) {
          const entityIds = params[0] as string[];
          const scope = params[1] as string | undefined;
          return DEALS
            .filter(d => [d.landlord_id, d.tenant_id, d.vendor_id, d.purchaser_id].some(id => id && entityIds.includes(id)))
            .filter(d => !scope || d.landlord_id === scope || d.vendor_id === scope || d.purchaser_id === scope)
            .map(d => ({ ...d, tenant_name: null, linked_entity_ids: [] }));
        }
        if (/FROM crm_contacts ct/.test(sql)) {
          const entityIds = params[0] as string[];
          const portfolio = params[1] as string[];
          return CONTACTS
            .map(c => ({
              ...c,
              via_employer: c.company_id != null && entityIds.includes(c.company_id),
              via_property: false,
              via_property_client: c.id === "C3" && portfolio.includes("P1"),
            }))
            .filter(c => c.via_employer || c.via_property || c.via_property_client);
        }
        if (/AS touches/.test(sql)) return INTERACTION_STATS.filter(s => (params[0] as string[]).includes(s.contact_id));
        if (/FROM crm_client_team_members m/.test(sql)) return CURATED;
        if (/FROM crm_property_agents/.test(sql)) return PROPERTY_AGENTS;
        if (/FROM users WHERE id = ANY/.test(sql)) return USERS.filter(u => (params[0] as string[]).includes(u.id));
        return [];
      })();
      return { rows, rowCount: rows.length };
    },
  };
}

// ─── Pure merge ───────────────────────────────────────────────────────────

describe("assembleWorkspaceTeam", () => {
  it("dedupes one row per user, pins the lead first, keeps all sources", () => {
    const team = assembleWorkspaceTeam(
      [
        { userId: "U1", name: "Una", email: null, role: "Lead", teamGroup: "Investment", sources: ["curated"] },
        { userId: "U2", name: "Ulf", email: null, role: "Leasing", teamGroup: null, sources: ["property_agent"] },
      ],
      {
        leads: new Set(["U1"]),
        propertyNamesByUser: new Map([["U2", ["Brent Cross"]]]),
        recentContributors: new Map([["U2", "2026-09-10T00:00:00.000Z"]]),
      },
    );
    assert.equal(team[0].userId, "U1");
    assert.equal(team[0].isLead, true);
    assert.deepEqual(team[1].sources, ["property_agent", "recent_contributor"]);
    assert.deepEqual(team[1].propertyNames, ["Brent Cross"]);
    assert.equal(team[1].lastContributionAt, "2026-09-10T00:00:00.000Z");
  });
});

// ─── getAccountWorkspace against the mock pool ────────────────────────────

describe("getAccountWorkspace (mock pool)", () => {
  it("builds the deduped team with lead, property names and interaction evidence", async () => {
    const ws = await getAccountWorkspace("HAM", {}, { pool: makeMockPool() });
    const byUser = new Map(ws.team.map(m => [m.userId, m]));
    assert.deepEqual([...byUser.keys()].sort(), ["U1", "U2", "U3"]);
    assert.equal(byUser.get("U1")!.isLead, true);
    assert.deepEqual(byUser.get("U1")!.sources, ["curated"]);
    assert.deepEqual(byUser.get("U2")!.sources, ["property_agent", "recent_contributor"]);
    assert.deepEqual(byUser.get("U2")!.propertyNames, ["Brent Cross"]);
    assert.equal(byUser.get("U2")!.lastContributionAt, "2026-09-10T00:00:00.000Z");
    assert.deepEqual(byUser.get("U3")!.sources, ["deal_contributor"]);
    // the unmatched bgp_user string produced no row
    assert.ok(!ws.team.some(m => m.name === "ghost writer"));
  });

  it("unifies contacts with employer name, property names, via sources and interaction stats", async () => {
    const ws = await getAccountWorkspace("HAM", {}, { pool: makeMockPool() });
    assert.deepEqual(ws.contacts.map(c => c.contactId), ["C1", "C3"]);
    const c1 = ws.contacts.find(c => c.contactId === "C1")!;
    assert.deepEqual(c1.via, ["employer"]);
    assert.equal(c1.employerName, "Hammerson");
    assert.equal(c1.interactionCount, 5);
    assert.equal(c1.lastInteractionAt, "2026-09-01");
    const c3 = ws.contacts.find(c => c.contactId === "C3")!;
    assert.deepEqual(c3.via, ["property_client"]);
    assert.deepEqual(c3.propertyNames, ["Brent Cross"]);
    assert.equal(c3.employerName, "External Facilities Ltd");
  });

  it("surfaces next actions linked via deal, property and contact — done tasks excluded", async () => {
    const ws = await getAccountWorkspace("HAM", {}, { pool: makeMockPool() });
    assert.deepEqual(ws.nextActions.map(t => t.taskId), ["TK2", "TK1", "TK3"]); // due asc, NULLS last
    const tk1 = ws.nextActions.find(t => t.taskId === "TK1")!;
    assert.equal(tk1.linkKind, "deal");
    assert.equal(tk1.linkLabel, "Brent Cross letting");
    assert.equal(tk1.ownerName, "Una");
    assert.equal(ws.nextActions.find(t => t.taskId === "TK2")!.linkKind, "property");
    assert.equal(ws.nextActions.find(t => t.taskId === "TK3")!.linkKind, "contact");
  });

  it("returns investment requirements only when records exist", async () => {
    const ws = await getAccountWorkspace("HAM", {}, { pool: makeMockPool() });
    assert.deepEqual(ws.investmentRequirements.map(r => r.id), ["R1"]);
    assert.deepEqual(ws.investmentRequirements[0].use, ["Retail"]);

    const empty = await getAccountWorkspace("HAM", {}, { pool: makeMockPool({ requirements: [] }) });
    assert.deepEqual(empty.investmentRequirements, []);
  });

  it("echoes the resolver totals for the overview summary", async () => {
    const ws = await getAccountWorkspace("HAM", {}, { pool: makeMockPool() });
    assert.deepEqual(ws.totals, { deals: 1, completedDeals: 0 });
  });

  it("scoped viewers get no team and no next actions; requirements collapse to their own company", async () => {
    const ws = await getAccountWorkspace("HAM", { scopeCompanyId: "HAMUK" }, { pool: makeMockPool() });
    assert.deepEqual(ws.team, []);
    assert.deepEqual(ws.nextActions, []);
    // R1 hangs off HAM, not HAMUK — invisible to the scoped viewer
    assert.deepEqual(ws.investmentRequirements, []);
    // contacts are exactly what the resolver scopes through
    assert.ok(ws.contacts.every(c => c.interactionCount === 0));
  });

  it("issues no mutating statements", async () => {
    const pool = makeMockPool();
    await getAccountWorkspace("HAM", {}, { pool });
    assert.ok(pool.queries.length > 0);
    for (const sql of pool.queries) {
      assert.match(sql, /^\s*SELECT/i, sql);
      assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP)\b/i, sql);
    }
  });
});
