// The Companies view on Transactions → AML and its suggested sub companies
// (Woody, 24 November 2026). The rules in shared/kyc-companies.ts and
// shared/kyc-suggestions.ts; the reads in server/kyc-companies.ts and
// server/kyc-suggestions.ts; the routes are guarded in
// qa/regression/kyc-companies-guards.test.mjs.
import "./test-database-url";
import test from "node:test";
import assert from "node:assert/strict";
import {
  KYC_COMPANY_FILTERS, kycCompanyChip, kycCompanyCounts, kycCompanyKind, kycCompanyMatchesFilter, kycCompanyMatchesSearch,
  kycCompanyNext, kycCompanyWebsite, kycSanctionsOnly, transactionWaiting, type KycCompanyEntity, type KycCompanyRow,
} from "../shared/kyc-companies";
import { nameStems, normaliseCompanyNumber, rankSuggestions, startsWithStem } from "../shared/kyc-suggestions";
import { officerName, suggestSubCompanies, type SuggestionDeps } from "./kyc-suggestions";

const NOW = new Date("2026-11-24T12:00:00Z");
const inDays = (n: number) => new Date(NOW.getTime() + n * 86400000).toISOString();
const entity = (over: Partial<KycCompanyEntity> = {}): KycCompanyEntity => ({
  id: "e1", name: "Brucecap Ltd", number: "01234567", kind: "company", status: null, expiresAt: null, scope: null, started: false, xero: false, signsOn: 0, ...over,
});

test("a company is a landlord or a brand by its CRM type, else by the side it is on", () => {
  assert.equal(kycCompanyKind("Tenant - Restaurant", []), "brand");
  assert.equal(kycCompanyKind("Landlord", ["tenant"]), "landlord");
  assert.equal(kycCompanyKind("REIT", []), "landlord");
  assert.equal(kycCompanyKind(null, ["vendor"]), "landlord");
  assert.equal(kycCompanyKind("Agent", ["purchaser"]), "brand");
  assert.equal(kycCompanyKind(null, []), "other");
});

test("sanctions only: worked out from the transactions, and the switch wins either way", () => {
  const small = { sanctionsOnly: true }, big = { sanctionsOnly: false };
  assert.deepEqual(kycSanctionsOnly([small, small], null), { on: true, auto: true, set: null });
  assert.deepEqual(kycSanctionsOnly([small, big], null), { on: false, auto: false, set: null });
  // No transaction: full checks unless someone switches it on.
  assert.deepEqual(kycSanctionsOnly([], null), { on: false, auto: false, set: null });
  assert.deepEqual(kycSanctionsOnly([], true), { on: true, auto: false, set: true });
  assert.deepEqual(kycSanctionsOnly([small], false), { on: false, auto: true, set: false });
});

test("the KYC chip: Not started with no contracting entity, else the CRM chip's words", () => {
  assert.equal(kycCompanyChip([], false, NOW).label, "Not started");
  const done = entity({ status: "approved", expiresAt: inDays(400) });
  assert.equal(kycCompanyChip([done], false, NOW).label, "KYC cleared");
  // A sanctions-only sign-off says so, the CRM chip's words, whatever the company's switch.
  const small = entity({ status: "approved", expiresAt: inDays(400), scope: "sanctions_only" });
  assert.equal(kycCompanyChip([small], true, NOW).label, "Sanctions only");
  assert.equal(kycCompanyChip([small], false, NOW).label, "Sanctions only");
  assert.equal(kycCompanyChip([done, entity({ id: "e2", name: "Bagels Ltd" })], false, NOW).label, "KYC 1 of 2");
});

test("the Next line names the first thing to do, in a few words", () => {
  const fmt = (iso: string) => iso.slice(0, 10);
  assert.deepEqual(kycCompanyNext({ entities: [], sanctionsOnly: false, waiting: null }, NOW, fmt), { tone: "act", lead: "To do", words: "add the contracting entity" });
  assert.deepEqual(kycCompanyNext({ entities: [entity()], sanctionsOnly: false, waiting: null }, NOW, fmt), { tone: "act", lead: "To do", words: "KYC Brucecap Ltd" });
  assert.equal(kycCompanyNext({ entities: [entity({ status: "rejected" })], sanctionsOnly: false, waiting: null }, NOW, fmt).lead, "Rejected");
  const cleared = kycCompanyNext({ entities: [entity({ status: "approved", expiresAt: "2029-11-24T00:00:00.000Z" })], sanctionsOnly: true, waiting: null }, NOW, fmt);
  assert.deepEqual(cleared, { tone: "ok", lead: "Cleared", words: "until 2029-11-24 · lettings under £10k a month" });
  assert.equal(kycCompanyNext({ entities: [entity({ started: true })], sanctionsOnly: false, waiting: "the client" }, NOW, fmt).lead, "Waiting on the client");
  assert.equal(kycCompanyNext({ entities: [entity({ status: "approved", expiresAt: inDays(-1) })], sanctionsOnly: false, waiting: null }, NOW, fmt).lead, "Expired");
  // A sanctions-only sign-off on a company that now needs the full checks.
  const fuller = kycCompanyNext({ entities: [entity({ status: "approved", expiresAt: inDays(400), scope: "sanctions_only" })], sanctionsOnly: false, waiting: null }, NOW, fmt);
  assert.deepEqual(fuller, { tone: "act", lead: "To do", words: "Brucecap Ltd: run the full checks" });
  // KYC4U checked it before 23 November 2026 and the app holds no result: record theirs first.
  const k = { folders: 2, last: "2025-04-24T10:00:00.000Z" };
  assert.deepEqual(kycCompanyNext({ entities: [], sanctionsOnly: false, waiting: null, kyc4u: k }, NOW, fmt), { tone: "act", lead: "KYC4U checked it", words: "record their result (2 folders, latest 2025-04-24)" });
  assert.equal(kycCompanyNext({ entities: [entity()], sanctionsOnly: false, waiting: null, kyc4u: { folders: 1, last: "2026-03-30T00:00:00.000Z" } }, NOW, fmt).words, "record their result (1 folder, 2026-03-30)");
  // Cleared, or checks under way, says so whatever KYC4U holds.
  assert.equal(kycCompanyNext({ entities: [entity({ status: "approved", expiresAt: inDays(400) })], sanctionsOnly: false, waiting: null, kyc4u: k }, NOW, fmt).lead, "Cleared");
  assert.equal(kycCompanyNext({ entities: [entity({ started: true })], sanctionsOnly: false, waiting: null, kyc4u: k }, NOW, fmt).lead, "In progress");
  assert.equal(transactionWaiting("client_sent"), "the client");
  assert.equal(transactionWaiting("joint_asked"), "the joint agent");
  assert.equal(transactionWaiting("bgp_checked"), null);
});

test("filters, counts and one search over companies, entities, transactions and Refs", () => {
  const base: KycCompanyRow = {
    id: "c1", name: "Bruce Cap", kind: "landlord", companyType: "Landlord", website: "brucecap.co.uk",
    entities: [entity()], kyc: { label: "No KYC", tone: "none", title: "" },
    transactions: [{ id: "d1", ref: 4507, name: "55 Wells Street", status: "SOL", dealType: "New Letting", role: "landlord", signsAs: "Brucecap Ltd", stage: "not_started", bucket: "todo", sanctionsOnly: false, late: false, waitingOn: "BGP" }],
    people: { count: 1, first: [{ id: "p1", name: "Woody Bruce", role: null, email: null, phone: null }] },
    agents: [{ firmId: "f1", firm: "Savills", contactId: null, person: "Jo Smith", email: null, on: "the tenant's agent" }],
    sanctionsOnly: { on: false, auto: false, set: null },
    next: { tone: "act", lead: "To do", words: "KYC Brucecap Ltd" }, listed: false, kyc4u: null,
  };
  const brand: KycCompanyRow = { ...base, id: "c2", name: "Bruce's Bagels", kind: "brand", entities: [], transactions: [], agents: [], people: { count: 0, first: [] }, sanctionsOnly: { on: true, auto: false, set: true }, next: { tone: "act", lead: "To do", words: "add the contracting entity" } };
  assert.deepEqual(KYC_COMPANY_FILTERS.map(f => f.key), ["all", "landlord", "brand", "no_entity", "not_cleared", "sanctions_only"]);
  assert.equal(kycCompanyMatchesFilter(brand, "no_entity"), true);
  assert.equal(kycCompanyMatchesFilter(base, "no_entity"), false);
  assert.equal(kycCompanyMatchesFilter(brand, "sanctions_only"), true);
  assert.deepEqual(kycCompanyCounts([base, brand]), { all: 2, landlord: 1, brand: 1, no_entity: 1, not_cleared: 2, sanctions_only: 1 });
  for (const q of ["bruce cap", "#4507", "4507", "wells", "brucecap ltd", "01234567", "savills", "woody", "brucecap.co.uk"]) assert.equal(kycCompanyMatchesSearch(base, q), true, q);
  assert.equal(kycCompanyMatchesSearch(base, "bagels"), false);
  assert.equal(kycCompanyMatchesSearch(brand, "bruces bagels"), true, "an apostrophe is not needed");
  assert.equal(kycCompanyWebsite("https://www.brucecap.co.uk/", null), "brucecap.co.uk");
  assert.equal(kycCompanyWebsite(null, null), null);
});

test("name stems: the words a group's companies start with, never a short or common word", () => {
  assert.deepEqual(nameStems(["Land Securities Group PLC"]), ["land securities"]);
  assert.deepEqual(nameStems(["The Crown Estate"]), ["crown estate"]);
  assert.deepEqual(nameStems(["ABC Ltd", "UK Holdings Limited"]), []);
  assert.deepEqual(nameStems(["Brucecap Ltd", "Brucecap Limited", "Bruce Cap"]), ["brucecap", "bruce cap"]);
  assert.equal(startsWithStem("LAND SECURITIES PORTFOLIO MANAGEMENT LIMITED", ["land securities"]), true);
  assert.equal(startsWithStem("Landsecurities Ltd", ["land securities"]), false);
  assert.equal(startsWithStem("The Crown Estate Commissioners", ["crown estate"]), true);
  assert.equal(normaliseCompanyNumber("1234567"), "01234567");
  assert.equal(normaliseCompanyNumber("sc12345"), "SC012345");
  assert.equal(normaliseCompanyNumber("OE002654"), "OE002654");
  assert.equal(normaliseCompanyNumber(" "), null);
});

test("ranking: owned within the group first, names alone never, what is filed and dissolved companies left out", () => {
  const ranked = rankSuggestions([
    { source: "companies_house", name: "Brucecap Properties Ltd", number: "11111111", ownedBy: "BRUCECAP LTD" },
    { source: "land_registry", name: "BRUCECAP PROPERTIES LTD", number: "11111111", titles: 3, nameMatch: true },
    { source: "companies_house", name: "Brucecap Lettings Ltd", number: "22222222", sharedOfficers: ["Woody Bruce"], nameMatch: true },
    { source: "companies_house", name: "Unrelated Ltd", number: "33333333", sharedOfficers: ["Woody Bruce"] },
    { source: "companies_house", name: "Brucecap Old Ltd", number: "44444444", status: "dissolved", ownedBy: "BRUCECAP LTD" },
    { source: "companies_house", name: "Brucecap Anything Ltd", number: "55555555", nameMatch: true },
    { source: "companies_house", name: "Brucecap Ltd", number: "01234567", ownedBy: "X" },
    { source: "gleif", name: "BRUCECAP INVEST BV", number: null, country: "NL", gleifParent: "BRUCECAP LTD" },
  ], { numbers: ["1234567"], names: [] });
  assert.deepEqual(ranked.map(r => r.name), ["Brucecap Properties Ltd", "BRUCECAP INVEST BV", "Brucecap Lettings Ltd"]);
  // One company from two sources is one suggestion with both reasons.
  assert.deepEqual(ranked[0].sources, ["companies_house", "land_registry"]);
  assert.deepEqual(ranked[0].reasons, ["Owned or controlled by BRUCECAP LTD (Companies House)", "Owns 3 titles in England and Wales (Land Registry)"]);
  assert.equal(ranked[1].country, "NL");
  assert.deepEqual(ranked[2].reasons, ["Shares a director, Woody Bruce (Companies House)", "Its name starts like the company's"]);
});

test("officer names read as people write them", () => {
  assert.equal(officerName("BRUCE, Woody James", false), "Woody James Bruce");
  assert.equal(officerName("O'NEIL-SMITH, Ann", false), "Ann O'Neil-Smith");
  assert.equal(officerName("LS DIRECTOR LIMITED", true), "LS DIRECTOR LIMITED");
});

test("the read: officers' other companies, the name search, who owns each, Land Registry and GLEIF", async () => {
  const calls: string[] = [];
  const ch = async (path: string) => {
    calls.push(path);
    if (path === "/company/01234567") return { registered_office_address: { postal_code: "W1W 8BL" } };
    if (path.startsWith("/company/01234567/officers")) return { items: [
      { name: "BRUCE, Woody", officer_role: "director", links: { officer: { appointments: "/officers/A/appointments" } } },
      { name: "BRUCECAP SECRETARIES LIMITED", officer_role: "corporate-secretary", identification: { registration_number: "9" }, links: { officer: { appointments: "/officers/B/appointments" } } },
      { name: "GONE, Old", officer_role: "director", resigned_on: "2020-01-01", links: { officer: { appointments: "/officers/C/appointments" } } },
    ] };
    if (path.startsWith("/officers/A/appointments")) return { items: [
      { appointed_to: { company_number: "1234567", company_name: "BRUCECAP LTD", company_status: "active" } },
      { appointed_to: { company_number: "22222222", company_name: "BRUCECAP LETTINGS LTD", company_status: "active" } },
      { appointed_to: { company_number: "77777777", company_name: "A CHARITY", company_status: "active" }, resigned_on: "2021-01-01" },
    ] };
    if (path.startsWith("/officers/B/appointments")) return { items: [
      { appointed_to: { company_number: "66666666", company_name: "WELLS STREET NOMINEE LTD", company_status: "active" } },
    ] };
    if (path.startsWith("/officers/C/")) throw new Error("should not read a resigned officer");
    if (path.startsWith("/search/companies")) return { items: [
      { title: "BRUCECAP PROPERTIES LTD", company_number: "11111111", company_status: "active", address: { postal_code: "W1W8BL" } },
      { title: "BRUCECAPITAL MARKETS LTD", company_number: "88888888", company_status: "active" },
    ] };
    if (path.startsWith("/company/11111111/persons-with-significant-control")) return { items: [{ kind: "corporate-entity-person-with-significant-control", name: "BRUCECAP LTD", identification: { registration_number: "01234567" } }] };
    if (path.startsWith("/company/66666666/persons-with-significant-control")) return { items: [{ kind: "corporate-entity-person-with-significant-control", name: "BRUCECAP PROPERTIES LTD", identification: { registration_number: "11111111" } }] };
    if (path.includes("persons-with-significant-control")) return { items: [] };
    throw new Error(`unexpected ${path}`);
  };
  const query: SuggestionDeps["query"] = async (sql, params) => {
    if (/FROM crm_companies WHERE id = \$1/.test(sql)) return { rows: [{ id: "c1", name: "Bruce Cap", companies_house_number: "01234567", uk_entity_name: null, ch_name: "BRUCECAP LTD" }] };
    if (/FROM crm_trading_entities WHERE parent_company_id/.test(sql)) return { rows: [{ name: "Brucecap Ltd", companies_house_number: "01234567", is_default: true }] };
    if (/WHERE \(parent_company_id = \$1 OR id =/.test(sql)) return { rows: [] };
    if (/FROM hmlr_proprietors/.test(sql)) {
      // Each stem in turn, as a range on the name index and the exact prefix.
      if (params[0] === "bruce cap") { assert.equal(params[1], "bruce caq"); assert.equal(params[2], "bruce cap%"); return { rows: [] }; }
      assert.deepEqual(params, ["brucecap", "brucecaq", "brucecap%"]);
      return { rows: [{ proprietor_name: "BRUCECAP PROPERTIES LTD", company_registration_no: "11111111", country: null, titles: 4 }, { proprietor_name: "BRUCECAP JERSEY LIMITED", company_registration_no: null, country: "JERSEY", titles: 2 }] };
    }
    throw new Error(`unexpected sql ${sql}`);
  };
  const gleif: SuggestionDeps["gleif"] = {
    search: async () => [{ lei: "213800BRUCECAPGB0001", name: "BRUCECAP LTD", jurisdiction: "GB", country: "GB", registeredAs: "01234567", registeredAt: "RA000585", status: "ACTIVE", leiStatus: "ISSUED", lastUpdate: null }],
    get: async path => (path === "/lei-records/213800BRUCECAPGB0001/direct-children"
      ? { data: [{ id: "724500BRUCECAPNL0002", attributes: { lei: "724500BRUCECAPNL0002", entity: { legalName: { name: "BRUCECAP INVEST BV" }, jurisdiction: "NL", legalAddress: { country: "NL" }, registeredAs: "12345678", registeredAt: { id: "RA000463" }, status: "ACTIVE" }, registration: { status: "ISSUED" } } }] }
      : null),
  };
  const r = await suggestSubCompanies("c1", { query, ch, gleif });
  assert.ok(r);
  assert.deepEqual(r!.top, { name: "BRUCECAP LTD", number: "01234567" });
  const names = r!.suggestions.map(s => s.name);
  assert.equal(names[0], "BRUCECAP PROPERTIES LTD", "owned by the company, with Land Registry titles");
  assert.ok(names.includes("WELLS STREET NOMINEE LTD"), "owned through one of the group's companies");
  assert.ok(names.includes("BRUCECAP LETTINGS LTD"), "a shared director and the name");
  assert.ok(names.includes("BRUCECAP JERSEY LIMITED"), "Land Registry: titles under the name, registered abroad");
  assert.equal(r!.suggestions.find(s => s.name === "BRUCECAP JERSEY LIMITED")!.country, "JERSEY");
  assert.ok(names.some(n => /INVEST BV/i.test(n)), "GLEIF's subsidiary abroad");
  assert.ok(!names.includes("BRUCECAPITAL MARKETS LTD"), "the name has to start with the stem as a word");
  assert.ok(!names.includes("A CHARITY"), "an appointment the director resigned is not a tie");
  assert.ok(!names.some(n => /^BRUCECAP LTD$/i.test(n)), "the company itself is never suggested");
  assert.ok(!calls.some(c => c.startsWith("/officers/C/")));
  assert.deepEqual(r!.sources.map(s => [s.source, s.read]), [["companies_house", true], ["land_registry", true], ["gleif", true]]);

  // With no Companies House key, the other sources still answer and the list says why.
  const noCh = await suggestSubCompanies("c1", { query, ch: null, gleif: null });
  assert.equal(noCh!.sources[0].words, "Companies House: not set up on this machine");
  assert.equal(noCh!.sources[2].words, "GLEIF: switched off");
  assert.deepEqual(noCh!.suggestions.map(s => s.name), ["BRUCECAP PROPERTIES LTD", "BRUCECAP JERSEY LIMITED"]);
  assert.equal(await suggestSubCompanies("missing", { query: async () => ({ rows: [] }), ch: null, gleif: null }), null);
});
