import test from "node:test";
import assert from "node:assert/strict";
import { PRIVATE_MAILBOX } from "../shared/private-mail";
import {
  agentLine, brandWhy, companyCity, companyIsKind, contactDates, crmHubKindsOf, isCrmClient, isCrmHubKind, isOwnFirm, landlordLine,
  lenderLine, lenderSubType, nextActionOf, rankPeople, rowIsQuiet, rowMatchesFilter, rowMatchesSearch, shownDescription, type CrmHubRow,
} from "../shared/crm-hub";
import { KIND_SQL, createCrmHubRouter, loadCompanyPeople, loadCrmHub } from "./crm-hub";

const NOW = Date.parse("2026-11-15T12:00:00Z");

// ── Which list a company is on ──────────────────────────────────────────────

test("a landlord is typed Landlord, Client or Landlord / Client, or is a portfolio account", () => {
  for (const companyType of ["Landlord", " client ", "Landlord / Client"]) assert.equal(companyIsKind({ companyType }, "landlord"), true, companyType);
  assert.equal(companyIsKind({ companyType: "Investor", isPortfolioAccount: true }, "landlord"), true);
  for (const companyType of ["Investor", "Landlord/Freeholder", "Tenant - Restaurant", "Agent", null]) assert.equal(companyIsKind({ companyType }, "landlord"), false, String(companyType));
});

test("an agent is typed exactly Agent, and BGP's own firm is never one", () => {
  assert.equal(companyIsKind({ name: "CBRE", companyType: " AGENT " }, "agent"), true);
  assert.equal(companyIsKind({ name: "CBRE", companyType: "Agent / Landlord" }, "agent"), false);
  assert.equal(companyIsKind({ name: "Bruce  Gillingham Pollard", companyType: "Agent" }, "agent"), false);
  assert.equal(companyIsKind({ name: "BGP", companyType: "Agent", domainUrl: "https://www.BruceGillinghamPollard.com" }, "agent"), false);
  assert.equal(isOwnFirm({ name: "BGP", domain: "brucegillinghampollard.com" }), true);
  assert.equal(isOwnFirm({ name: "Savills", domain: "savills.com" }), false);
});

test("a lender is any of the lender types, with its sub-type", () => {
  const cases: Array<[string, string]> = [["Lender", "Other"], ["Clearing Bank", "Banks"], ["Investment bank", "Banks"], ["Building Society", "Banks"],
    ["Debt Fund", "Debt Funds"], ["Insurance Lender", "Insurance/Pension"], ["Pension Fund", "Insurance/Pension"],
    ["Private Credit", "Private/Bridge"], ["Mezzanine", "Private/Bridge"], ["Bridging", "Private/Bridge"], ["Development Finance", "Private/Bridge"]];
  for (const [companyType, subType] of cases) {
    assert.equal(companyIsKind({ companyType }, "lender"), true, companyType);
    assert.equal(lenderSubType(companyType), subType, companyType);
  }
  for (const companyType of ["Landlord", "Agent", "Tenant - Bakery", "", null]) assert.equal(companyIsKind({ companyType }, "lender"), false, String(companyType));
});

test("a brand is a tenant company, and a company can be on two lists", () => {
  assert.equal(companyIsKind({ companyType: "Tenant - Restaurant" }, "brand"), true);
  assert.equal(companyIsKind({ companyType: "tenant" }, "brand"), true);
  assert.equal(companyIsKind({ companyType: "Landlord" }, "brand"), false);
  assert.deepEqual(crmHubKindsOf({ companyType: "Debt Fund", isPortfolioAccount: true }), ["landlord", "lender"]);
  assert.deepEqual(crmHubKindsOf({ companyType: "Solicitor" }), []);
  assert.equal(isCrmHubKind("lender"), true);
  assert.equal(isCrmHubKind("company"), false);
});

test("the crown is a company BGP acts for", () => {
  assert.equal(isCrmClient({ companyType: "Client" }), true);
  assert.equal(isCrmClient({ companyType: "Landlord / Client" }), true);
  assert.equal(isCrmClient({ companyType: "Agent", isPortfolioAccount: true }), true);
  assert.equal(isCrmClient({ companyType: "Landlord" }), false);
});

test("the SQL that narrows each list names the same types as the rule", () => {
  assert.match(KIND_SQL.landlord, /IN \('landlord', 'client', 'landlord \/ client'\) OR c\.is_portfolio_account IS TRUE/);
  assert.match(KIND_SQL.agent, /= 'agent'$/);
  assert.match(KIND_SQL.brand, /LIKE 'tenant%'$/);
  for (const type of ["lender", "clearing bank", "building society", "development finance"]) assert.ok(KIND_SQL.lender.includes(`LIKE '%${type}%'`), type);
});

// ── The brands BGP is working ───────────────────────────────────────────────

test("a brand is on the list for each reason it is being worked, in a fixed order", () => {
  assert.deepEqual(brandWhy({}), []);
  assert.deepEqual(brandWhy({ onStrategy: false, openAction: false, liveDeal: false, requirement: false, hunterPick: false }), []);
  assert.deepEqual(brandWhy({ hunterPick: true }), ["Hunter pick"]);
  assert.deepEqual(brandWhy({ requirement: true, onStrategy: true }), ["On a strategy", "Requirement"]);
  assert.deepEqual(brandWhy({ onStrategy: true, openAction: true, liveDeal: true, requirement: true, hunterPick: true }),
    ["On a strategy", "Open action", "Live deal", "Requirement", "Hunter pick"]);
});

// ── What a row shows ────────────────────────────────────────────────────────

test("the fact lines", () => {
  assert.equal(landlordLine({ properties: 12, deals: 4 }), "12 properties · 4 live deals");
  assert.equal(landlordLine({ properties: 1, deals: 1 }), "1 property · 1 live deal");
  assert.equal(landlordLine({ properties: 0, deals: 0 }), null);
  assert.equal(agentLine({ brandsRepresented: 9 }), "Acts for 9 brands");
  assert.equal(agentLine({ brandsRepresented: 1 }), "Acts for 1 brand");
  assert.equal(agentLine({ brandsRepresented: 0 }), null);
  assert.equal(lenderLine({ typicalLtvMax: 60, loanMin: 5, loanMax: 50, lendingActive: true }), "Typical LTV 60% · £5m–£50m · Active");
  assert.equal(lenderLine({ typicalLtvMax: 62.5, loanMin: 10, loanMax: null, lendingActive: false }), "Typical LTV 62.5% · £10m+ · Paused");
  assert.equal(lenderLine({ loanMax: 25 }), "up to £25m");
  // Appetite nobody recorded is not said.
  assert.equal(lenderLine({ lendingActive: null }), null);
});

test("the town is the registered office first, and never a head office outside the UK", () => {
  assert.equal(companyCity("LONDON", { city: "Los Angeles", country: "United States" }), "London");
  assert.equal(companyCity(null, { city: "Los Angeles", country: "United States" }), null);
  assert.equal(companyCity("", { city: "Leeds", country: "UK" }), "Leeds");
  assert.equal(companyCity(null, { city: "Manchester" }), "Manchester");
  assert.equal(companyCity(null, null), null);
});

test("a description that is the enrichment's failure message is not shown", () => {
  assert.equal(shownDescription("Unable to identify this company."), null);
  assert.equal(shownDescription("No reliable information found for a company named X."), null);
  assert.equal(shownDescription("CH no. 00262958...."), "CH no. 00262958…");
  assert.equal(shownDescription("  A London landlord. "), "A London landlord.");
  assert.equal(shownDescription(null), null);
});

test("a date ahead is the next contact, never the last", () => {
  const dates = contactDates(["2026-11-01T10:00:00Z", "2026-10-01T10:00:00Z", "2026-11-20T09:00:00Z", "2026-12-02T09:00:00Z", null], NOW);
  assert.equal(dates.lastContactAt, "2026-11-01T10:00:00.000Z");
  assert.equal(dates.nextContactAt, "2026-11-20T09:00:00.000Z");
  assert.deepEqual(contactDates([], NOW), { lastContactAt: null, nextContactAt: null });
  assert.deepEqual(contactDates(["2026-11-20T09:00:00Z"], NOW), { lastContactAt: null, nextContactAt: "2026-11-20T09:00:00.000Z" });
});

test("the next action is the earliest due, and overdue only before today", () => {
  const actions = [
    { id: "a", title: "Undated", dueAt: null, createdAt: "2026-11-10T09:00:00Z", ownerName: "Ann" },
    { id: "b", title: "Later", dueAt: "2026-12-01T09:00:00Z", ownerName: "Ben" },
    { id: "c", title: "Sooner", dueAt: "2026-11-14T09:00:00Z", ownerName: null },
  ];
  assert.deepEqual(nextActionOf(actions, NOW), { id: "c", title: "Sooner", dueAt: "2026-11-14T09:00:00Z", ownerName: null, overdue: true });
  assert.equal(nextActionOf([{ id: "d", title: "Today", dueAt: "2026-11-15T00:00:00Z", ownerName: null }], NOW)?.overdue, false);
  assert.equal(nextActionOf([actions[0]], NOW)?.overdue, false);
  assert.equal(nextActionOf([], NOW), null);
});

test("the people shown first: a favourite, then the most recently spoken to, then the reachable, then by name", () => {
  const person = (id: string, extra: Record<string, any> = {}) => ({ id, name: id, role: null, email: null, phone: null, ...extra });
  const ranked = rankPeople([person("Zed"), person("Amy"), person("Reachable", { role: "Director", email: "r@example.test" }),
    person("Spoken", { lastContactAt: "2026-11-01T10:00:00Z" }), person("Older", { lastContactAt: "2026-06-01T10:00:00Z" }), person("Fave", { favourite: true })]);
  assert.deepEqual(ranked.map(p => p.id), ["Fave", "Spoken", "Older", "Reachable", "Amy", "Zed"]);
});

test("the filters: strategy, next step and 90 days without contact", () => {
  const row = (extra: Partial<CrmHubRow>) => ({ strategies: [], nextAction: null, lastContactAt: null, ...extra }) as CrmHubRow;
  const onPlan = row({ strategies: [{ id: "s", name: "S" }], nextAction: { id: "t", title: "Call", dueAt: null, ownerName: null, overdue: false }, lastContactAt: "2026-11-01T10:00:00Z" });
  assert.equal(rowMatchesFilter(onPlan, "strategy", NOW), true);
  assert.equal(rowMatchesFilter(onPlan, "no-strategy", NOW), false);
  assert.equal(rowMatchesFilter(onPlan, "no-next", NOW), false);
  assert.equal(rowMatchesFilter(onPlan, "quiet", NOW), false);
  assert.equal(rowMatchesFilter(row({}), "no-strategy", NOW), true);
  assert.equal(rowMatchesFilter(row({}), "no-next", NOW), true);
  assert.equal(rowIsQuiet(row({}), NOW), true);
  assert.equal(rowIsQuiet(row({ lastContactAt: "2026-08-10T10:00:00Z" }), NOW), true);
  assert.equal(rowIsQuiet(row({ lastContactAt: "2026-08-20T10:00:00Z" }), NOW), false);
  const searched = { ...onPlan, name: "Hammerson", companyType: "Landlord", description: null, city: "London", line: null,
    owners: [{ id: "u", name: "Rupert Bentley" }], people: [{ id: "p", name: "Kate Taylor", role: null, email: null, phone: null }] } as CrmHubRow;
  for (const text of ["hammer", "LONDON", "rupert", "kate", " s "]) assert.equal(rowMatchesSearch(searched, text), true, text);
  assert.equal(rowMatchesSearch(searched, "savills"), false);
});

// ── The feed, on a fake database ────────────────────────────────────────────

type Tables = Partial<Record<"companies" | "actions" | "strategies" | "contacts" | "interactions" | "users" | "dealOwners" | "properties" | "landlordDeals"
  | "represented" | "brandDeals" | "brandRequirements" | "people" | "company", any[] | Error>>;
function fake(tables: Tables) {
  const calls: Array<{ name: string; sql: string; values: any[] }> = [];
  const nameOf = (sql: string): keyof Tables => {
    if (/FROM crm_engagement_actions/.test(sql)) return "actions";
    if (/FROM crm_strategy_targets/.test(sql)) return "strategies";
    if (/FROM crm_interactions/.test(sql)) return "interactions";
    if (/FROM brand_agent_representations/.test(sql)) return "represented";
    if (/FROM crm_requirements_leasing/.test(sql)) return "brandRequirements";
    if (/unnest\(COALESCE\(x\.internal_agent/.test(sql)) return "dealOwners";
    if (/d\.tenant_id AS company_id/.test(sql)) return "brandDeals";
    if (/d\.landlord_id AS company_id/.test(sql)) return "landlordDeals";
    if (/count\(DISTINCT links\.property_id\)/.test(sql)) return "properties";
    if (/FROM crm_contacts p WHERE p\.company_id = ANY/.test(sql)) return "contacts";
    if (/FROM crm_contacts p WHERE p\.company_id = \$1/.test(sql)) return "people";
    if (/FROM users u WHERE u\.id = ANY/.test(sql)) return "users";
    if (/SELECT c\.id FROM crm_companies c WHERE c\.id = \$1/.test(sql)) return "company";
    if (/FROM crm_companies c\s+WHERE c\.merged_into_id IS NULL AND c\.archived_at IS NULL/.test(sql)) return "companies";
    throw new Error("unexpected query: " + sql);
  };
  const q = {
    async query(sql: string, values: any[] = []) {
      const name = nameOf(sql);
      calls.push({ name, sql, values });
      const answer = tables[name];
      if (answer instanceof Error) throw answer;
      return { rows: answer || [] };
    },
  };
  return { q, calls };
}
const company = (id: string, extra: Record<string, any> = {}) => ({ id, name: "Company " + id, company_type: "Landlord", domain: null, domain_url: null, description: null,
  is_portfolio_account: false, head_office_address: null, registered_locality: null, bgp_contact_user_ids: null, hunter_flag: false,
  lending_active: null, typical_ltv_max: null, typical_loan_size_min_m: null, typical_loan_size_max_m: null, ...extra });
const contact = (id: string, companyId: string, extra: Record<string, any> = {}) => ({ id, name: "Person " + id, role: null, email: null, phone: null, phone_mobile: null, is_favourite: false, company_id: companyId, ...extra });
const quiet = async <T>(work: () => Promise<T>): Promise<T> => {
  const warn = console.warn;
  console.warn = () => {};
  try { return await work(); } finally { console.warn = warn; }
};

test("a landlord row is assembled from the reads", async () => {
  const { q, calls } = fake({
    companies: [
      company("l1", { name: "Hammerson", company_type: "Landlord / Client", domain: "hammerson.com", domain_url: "https://hammerson.com", description: "A REIT...",
        registered_locality: "LONDON", bgp_contact_user_ids: ["u2", "u1", "gone"] }),
      company("l2", { name: "Quiet Estates" }),
      // The read can return more than the rule allows: the rule decides.
      company("x1", { name: "Not a landlord", company_type: "Investor" }),
    ],
    users: [{ id: "u1", name: "Rupert Bentley" }, { id: "u2", name: "Charlotte Roberts" }],
    dealOwners: [{ company_id: "l2", id: "u3", name: "Will Smith" }],
    actions: [
      { id: "t1", title: "Send the pack", due_date: "2026-12-01T09:00:00Z", created_at: "2026-11-01T09:00:00Z", company_id: "l1", owner_name: "Rupert Bentley", participants: [] },
      { id: "t2", title: "Call the asset manager", due_date: "2026-11-10T09:00:00Z", created_at: "2026-11-02T09:00:00Z", company_id: "l1", owner_name: "Charlotte Roberts", participants: [] },
      { id: "t3", title: "Private follow-up", due_date: "2026-11-01T09:00:00Z", created_at: "2026-11-02T09:00:00Z", company_id: "l1", owner_name: "X", participants: [PRIVATE_MAILBOX] },
    ],
    strategies: [{ id: "s1", name: "Retail parks 2027", company_id: "l1" }],
    contacts: [
      contact("p1", "l1", { name: "Kate Taylor", role: "Head of Leasing", email: "kate@hammerson.example", phone_mobile: "07700 900001" }),
      contact("p2", "l1", { name: "Adam Hill", is_favourite: true }),
      contact("p3", "l1", { name: "Hidden", email: PRIVATE_MAILBOX }),
      ...["a", "b", "c", "d", "e", "f"].map(letter => contact("extra-" + letter, "l1", { name: "Extra " + letter })),
    ],
    interactions: [
      { company_id: "l1", contact_id: "p1", last_at: "2026-11-03T10:00:00Z", next_at: "2026-11-25T10:00:00Z" },
      { company_id: null, contact_id: "extra-a", last_at: "2026-11-09T10:00:00Z", next_at: null },
      { company_id: "elsewhere", contact_id: "nobody", last_at: "2026-11-14T10:00:00Z", next_at: null },
    ],
    properties: [{ company_id: "l1", n: 12 }],
    landlordDeals: [{ company_id: "l1", n: 4 }],
  });
  const out = await loadCrmHub(q, "landlord", NOW);
  assert.deepEqual(out.rows.map(row => row.id), ["l1", "l2"]);
  const [first, second] = out.rows;
  assert.deepEqual({ ...first, people: first.people.map(p => p.name) }, {
    id: "l1", name: "Hammerson", kind: "landlord", companyType: "Landlord / Client", domain: "https://hammerson.com", description: "A REIT…",
    isClient: true, subType: null, city: "London",
    owners: [{ id: "u2", name: "Charlotte Roberts" }, { id: "u1", name: "Rupert Bentley" }],
    lastContactAt: "2026-11-09T10:00:00.000Z", nextContactAt: "2026-11-25T10:00:00.000Z",
    openActions: 2,
    nextAction: { id: "t2", title: "Call the asset manager", dueAt: "2026-11-10T09:00:00.000Z", ownerName: "Charlotte Roberts", overdue: true },
    strategies: [{ id: "s1", name: "Retail parks 2027" }],
    contactCount: 8,
    people: ["Adam Hill", "Extra a", "Kate Taylor", "Extra b", "Extra c", "Extra d"],
    counts: { properties: 12, deals: 4 }, line: "12 properties · 4 live deals",
  });
  assert.deepEqual(first.people.find(p => p.id === "p1"), { id: "p1", name: "Kate Taylor", role: "Head of Leasing", email: "kate@hammerson.example", phone: "07700 900001" });
  // Nobody set on the account: the agents on its deals, marked as such.
  assert.deepEqual(second.owners, [{ id: "u3", name: "Will Smith" }]);
  assert.equal(second.ownersFromDeals, true);
  assert.equal(first.ownersFromDeals, undefined);
  assert.deepEqual([second.lastContactAt, second.nextAction, second.strategies, second.contactCount, second.line], [null, null, [], 0, null]);
  assert.equal(second.why, undefined);
  assert.deepEqual(out.owners, [{ id: "u2", name: "Charlotte Roberts" }, { id: "u1", name: "Rupert Bentley" }, { id: "u3", name: "Will Smith" }]);
  assert.deepEqual(out.cities, ["London"]);
  assert.deepEqual(out.subTypes, []);
  // Nothing the private mailbox is on is asked for by a looser test than the summary's.
  const interactions = calls.find(call => call.name === "interactions")!;
  assert.match(interactions.sql, /MAX\(i\.interaction_date\) FILTER \(WHERE i\.interaction_date <= now\(\)\)/);
  assert.match(interactions.sql, /i\.type = 'meeting' AND i\.interaction_date >= now\(\)/);
  assert.deepEqual(interactions.values[0], ["l1", "l2"]);
  assert.ok(!interactions.values[1].includes("p3"));
  assert.ok(new RegExp(interactions.values[2], "i").test(`["${PRIVATE_MAILBOX}"]`));
  assert.ok(!new RegExp(interactions.values[2].replace("[[:space:]]", "\\s"), "i").test('["private.equity@brucegillinghampollard.com"]'));
});

test("the number of reads does not grow with the number of companies", async () => {
  const run = async (n: number) => {
    const companies = Array.from({ length: n }, (_, i) => company("l" + i, { bgp_contact_user_ids: i % 2 ? ["u1"] : null }));
    const { q, calls } = fake({ companies, users: [{ id: "u1", name: "Rupert" }], contacts: companies.map(c => contact("p-" + c.id, c.id)) });
    await loadCrmHub(q, "landlord", NOW);
    return calls.map(call => call.name).sort();
  };
  const few = await run(2);
  assert.deepEqual(await run(300), few);
  assert.deepEqual(few, ["actions", "companies", "contacts", "dealOwners", "interactions", "landlordDeals", "properties", "strategies", "users"]);
});

test("a failed side read costs its column, not the list", async () => {
  const missing = new Error('relation "crm_strategy_targets" does not exist');
  const { q } = fake({
    companies: [company("l1", { bgp_contact_user_ids: ["u1"] })],
    strategies: missing, actions: new Error("actions down"), interactions: new Error("interactions down"), users: new Error("users down"),
    properties: new Error("properties down"), landlordDeals: [{ company_id: "l1", n: 2 }],
    contacts: [contact("p1", "l1")],
  });
  const out = await quiet(() => loadCrmHub(q, "landlord", NOW));
  assert.equal(out.rows.length, 1);
  const row = out.rows[0];
  assert.deepEqual([row.strategies, row.openActions, row.nextAction, row.lastContactAt, row.nextContactAt, row.owners], [[], 0, null, null, null, []]);
  assert.equal(row.contactCount, 1);
  // A count that could not be read is left out, never shown as nought.
  assert.deepEqual(row.counts, { deals: 2 });
  assert.equal(row.line, "2 live deals");
});

test("the company read is the one the list cannot do without", async () => {
  const { q } = fake({ companies: new Error("companies down") });
  await assert.rejects(() => loadCrmHub(q, "landlord", NOW), /companies down/);
});

test("an empty list asks for nothing more", async () => {
  const { q, calls } = fake({ companies: [] });
  assert.deepEqual(await loadCrmHub(q, "agent", NOW), { kind: "agent", rows: [], owners: [], cities: [], subTypes: [] });
  assert.deepEqual(calls.map(call => call.name), ["companies"]);
});

test("agents: brands represented, the town, and never BGP's own firm", async () => {
  const { q, calls } = fake({
    companies: [company("a1", { name: "Davis Coffer Lyons", company_type: "Agent", head_office_address: { city: "London", country: "UK" } }),
      company("a2", { name: "Colliers", company_type: "Agent", head_office_address: { city: "Toronto", country: "Canada" } }),
      company("own", { name: "Bruce Gillingham Pollard", company_type: "Agent" })],
    represented: [{ company_id: "a1", n: 5 }],
  });
  const out = await loadCrmHub(q, "agent", NOW);
  assert.deepEqual(out.rows.map(row => [row.id, row.city, row.line, row.counts]), [
    ["a1", "London", "Acts for 5 brands", { brandsRepresented: 5 }], ["a2", null, null, { brandsRepresented: 0 }]]);
  assert.deepEqual(out.cities, ["London"]);
  assert.match(calls.find(call => call.name === "represented")!.sql, /r\.end_date IS NULL/);
});

test("lenders: the sub-type and the lending line", async () => {
  const { q } = fake({
    companies: [company("b1", { name: "Big Bank", company_type: "Clearing Bank", lending_active: true, typical_ltv_max: 60, typical_loan_size_min_m: 5, typical_loan_size_max_m: 50 }),
      company("b2", { name: "Bridge Co", company_type: "Bridging" })],
    properties: [{ company_id: "b1", n: 3 }],
  });
  const out = await loadCrmHub(q, "lender", NOW);
  assert.deepEqual(out.rows.map(row => [row.subType, row.line, row.counts.properties]), [["Banks", "Typical LTV 60% · £5m–£50m · Active", 3], ["Private/Bridge", null, 0]]);
  assert.deepEqual(out.subTypes, ["Banks", "Private/Bridge"]);
});

test("brands: only the ones BGP is working, each saying why", async () => {
  const brand = (id: string, extra: Record<string, any> = {}) => company(id, { company_type: "Tenant - Restaurant", ...extra });
  const { q, calls } = fake({
    actions: [
      { id: "t1", title: "Send units", due_date: null, created_at: "2026-11-01T09:00:00Z", company_id: "b-action", owner_name: "Ann", participants: [] },
      { id: "t2", title: "Private", due_date: null, created_at: "2026-11-01T09:00:00Z", company_id: "b-private", owner_name: "Ann", participants: [PRIVATE_MAILBOX] },
    ],
    strategies: [{ id: "s1", name: "Bakeries", company_id: "b-all" }],
    brandDeals: [{ company_id: "b-all", n: 2 }, { company_id: "b-deal", n: 1 }],
    brandRequirements: [{ company_id: "b-all", n: 1 }, { company_id: "b-req", n: 3 }],
    companies: [brand("b-action"), brand("b-all", { hunter_flag: true }), brand("b-deal"), brand("b-hunter", { hunter_flag: true }), brand("b-private"), brand("b-req")],
  });
  const out = await loadCrmHub(q, "brand", NOW);
  assert.deepEqual(out.rows.map(row => [row.id, row.why]), [
    ["b-action", ["Open action"]],
    ["b-all", ["On a strategy", "Live deal", "Requirement", "Hunter pick"]],
    ["b-deal", ["Live deal"]],
    ["b-hunter", ["Hunter pick"]],
    ["b-req", ["Requirement"]],
  ]);
  const all = out.rows.find(row => row.id === "b-all")!;
  assert.equal(all.line, "On a strategy · Live deal · Requirement · Hunter pick");
  assert.deepEqual(all.counts, { deals: 2, requirements: 1 });
  assert.deepEqual(all.strategies, [{ id: "s1", name: "Bakeries" }]);
  assert.equal(out.rows.find(row => row.id === "b-action")!.openActions, 1);
  // The company read is asked only for the worked brands and the Hunter picks; a brand
  // named only by an action the private mailbox is on is not asked for.
  const companies = calls.find(call => call.name === "companies")!;
  assert.match(companies.sql, /c\.hunter_flag IS TRUE OR c\.id = ANY\(\$1::text\[\]\)/);
  assert.deepEqual([...companies.values[0]].sort(), ["b-action", "b-all", "b-deal", "b-req"]);
  // The plan is read once for brands, not again for the listed ones.
  assert.equal(calls.filter(call => call.name === "actions").length, 1);
  assert.equal(calls.filter(call => call.name === "strategies").length, 1);
  // Live deals by the shared closed list; requirements by the one live rule.
  assert.match(calls.find(call => call.name === "brandDeals")!.sql, /NOT IN \('exc'/i);
  assert.match(calls.find(call => call.name === "brandRequirements")!.sql, /x\.st IN \('live', 'to_confirm'\)/);
});

test("brands: a missing plan table loses that reason, not the list", async () => {
  const { q } = fake({
    actions: new Error('relation "crm_engagement_actions" does not exist'), strategies: new Error("no strategies"), brandRequirements: new Error("no requirements"),
    brandDeals: [{ company_id: "b1", n: 1 }],
    companies: [company("b1", { company_type: "Tenant" }), company("b2", { company_type: "Tenant", hunter_flag: true })],
  });
  const out = await quiet(() => loadCrmHub(q, "brand", NOW));
  assert.deepEqual(out.rows.map(row => [row.id, row.why, row.counts]), [["b1", ["Live deal"], { deals: 1 }], ["b2", ["Hunter pick"], { deals: 0 }]]);
});

test("everyone at a company, less the private mailbox", async () => {
  const { q } = fake({ company: [{ id: "l1" }], people: [contact("p1", "l1", { name: "Zoe" }), contact("p2", "l1", { name: "Hidden", email: PRIVATE_MAILBOX }), contact("p3", "l1", { name: "Amy", is_favourite: true, phone: "020 7946 0000" })] });
  assert.deepEqual(await loadCompanyPeople(q, "l1"), [{ id: "p3", name: "Amy", role: null, email: null, phone: "020 7946 0000" }, { id: "p1", name: "Zoe", role: null, email: null, phone: null }]);
  assert.equal(await loadCompanyPeople(fake({ company: [] }).q, "nope"), null);
});

// ── Who is answered ─────────────────────────────────────────────────────────

const STAFF = { id: "staff", name: "Rupert", email: "rupert@brucegillinghampollard.com", role: "Agent", is_active: true, client_view_mode: false };
function router(user: Record<string, any> | null, scope: string | null | Error, tables: Tables = { companies: [company("l1")] }) {
  const { q, calls } = fake(tables);
  const app = createCrmHubRouter({
    requireAuth: (_req, _res, next) => next(),
    query: async (sql, values) => /FROM users WHERE id=\$1/.test(sql) ? { rows: user ? [user] : [] } : q.query(sql, values),
    resolveScope: async () => { if (scope instanceof Error) throw scope; return scope; },
  });
  const get = (url: string) => new Promise<{ status: number; body: any }>((resolve, reject) => {
    const res: any = { statusCode: 200, setHeader() {}, getHeader() {}, status(code: number) { this.statusCode = code; return this; }, json(body: any) { resolve({ status: this.statusCode, body }); return this; } };
    (app as any)({ method: "GET", url, headers: {}, session: user ? { userId: user.id } : {} }, res, (error?: any) => error ? reject(error) : resolve({ status: 404, body: null }));
  });
  return { get, calls };
}

test("BGP staff are answered", async () => {
  const { get } = router(STAFF, null);
  const list = await get("/api/crm/hub/landlord");
  assert.equal(list.status, 200);
  assert.deepEqual([list.body.kind, list.body.rows.length], ["landlord", 1]);
  assert.equal((await get("/api/crm/hub/companies")).status, 404);
  const people = await router(STAFF, null, { company: [{ id: "l1" }], people: [contact("p1", "l1")] }).get("/api/crm/hub/company/l1/people");
  assert.deepEqual([people.status, people.body.people.length], [200, 1]);
  assert.equal((await router(STAFF, null, { company: [] }).get("/api/crm/hub/company/nope/people")).status, 404);
});

test("a client login, a joint agent, staff viewing as a client and a scoped session are refused, and nothing is read", async () => {
  const refused: Array<[string, Record<string, any> | null, string | null]> = [
    ["a client login", { ...STAFF, id: "c", email: "leasing@landsec.example", role: "Client" }, "landsec-company"],
    ["a client role on a BGP address", { ...STAFF, role: "client" }, null],
    ["staff viewing as a client", { ...STAFF, client_view_mode: true }, null],
    ["staff in a client's scope", STAFF, "landsec-company"],
    ["an outside address", { ...STAFF, email: "agent@jointagent.example" }, null],
    ["a deactivated login", { ...STAFF, is_active: false }, null],
    ["the private mailbox", { ...STAFF, email: PRIVATE_MAILBOX }, null],
    ["nobody signed in", null, null],
  ];
  for (const [label, user, scope] of refused) {
    for (const url of ["/api/crm/hub/landlord", "/api/crm/hub/brand", "/api/crm/hub/company/l1/people"]) {
      const { get, calls } = router(user, scope);
      const answer = await get(url);
      assert.equal(answer.status, 403, `${label} ${url}`);
      assert.equal(answer.body.rows, undefined);
      assert.equal(calls.length, 0, `${label} ${url}`);
    }
  }
});

test("a staff check that cannot be made refuses", async () => {
  const { get, calls } = router(STAFF, new Error("scope down"));
  assert.equal((await get("/api/crm/hub/landlord")).status, 503);
  assert.equal(calls.length, 0);
});
