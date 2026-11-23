// Heads of terms read on the transaction page (Woody, 23 November 2026:
// "where is the upload HOTs place? so can populate?"). The rules reader, the
// checks on the provider's answer, and where each party is.
import test from "node:test";
import assert from "node:assert/strict";
import {
  checkHotsAnswer, cleanCompanyNumber, countsIn, hotsTermPatch, hotsTermState, mergeHotsReadings, moneyIn, numberInQuote, readHotsByRules,
  type HotsParty,
} from "@shared/deal-hots";
import { hotsTermViews, matchHotsParties, partiesFromBody, readHotsDocument, termsFromBody, type RegisterLookups } from "./deal-hots";

const HOTS = `HEADS OF TERMS
Subject to contract

1. Property
Unit 7a, Southbank Place, York Road, London SE1 7NQ

2. Landlord
Braeburn Estates Limited (Company No. 06327384) whose registered office is at One Canada Square, London E14 5AB

3. Tenant
Bill's Restaurants Limited (company number 5211343), whose registered office is at 1 Example Street, Lewes

4. Guarantor
Bill's Holdings Limited (Company Registration Number 09876543)

5. Landlord's Solicitors: Herbert Smith Freehills LLP
6. Tenant's Solicitors: Shoosmiths LLP
7. Term: A new lease for a term of ten (10) years from completion
8. Rent: £85,000 per annum exclusive of VAT and outgoings
9. Rent Review: Upward only open market review at year 5
10. Rent Free: Six months from completion
11. Break: Tenant only break at the end of year 5 on 6 months' written notice
12. Area: 2,450 sq ft (227.6 sq m)
13. Tenant fit out: The tenant shall carry out its own fit out works
`;

test("a Companies House number is tidied to eight characters", () => {
  assert.equal(cleanCompanyNumber("5211343"), "05211343");
  assert.equal(cleanCompanyNumber("SC 123456"), "SC123456");
  assert.equal(cleanCompanyNumber("06327384"), "06327384");
  assert.equal(cleanCompanyNumber("12"), null);
  assert.equal(cleanCompanyNumber("ABC12345"), null);
  assert.ok(numberInQuote("05211343", "Bill's Restaurants Limited (company number 5211343)"));
  assert.ok(!numberInQuote("05211343", "company number 952113430"));
});

test("figures are read from words as the transaction stores them", () => {
  assert.deepEqual(moneyIn("£85,000 pa, £85k, £1.25m"), [85000, 85000, 1250000]);
  assert.deepEqual(moneyIn("year 5 and 6 months"), []);
  assert.deepEqual(countsIn("a term of ten (10) years", "years"), [10]);
  assert.deepEqual(countsIn("Six months rent free", "months"), [6]);
});

test("the rules read each party's company and number, and the plain terms", () => {
  const r = readHotsByRules(HOTS);
  const by = Object.fromEntries(r.parties.map(p => [p.role, p]));
  assert.equal(by.landlord.name, "Braeburn Estates Limited");
  assert.equal(by.landlord.number, "06327384");
  assert.equal(by.tenant.name, "Bill's Restaurants Limited");
  assert.equal(by.tenant.number, "05211343");
  assert.equal(by.guarantor.name, "Bill's Holdings Limited");
  assert.equal(by.guarantor.number, "09876543");
  // Solicitors and a clause that starts with the word are not parties.
  assert.equal(r.parties.length, 3);
  const terms = Object.fromEntries(r.terms.map(t => [t.key, t.value]));
  assert.equal(terms.rentPa, 85000);
  assert.equal(terms.leaseLength, 10);
  assert.equal(terms.rentFree, 6);
  assert.equal(terms.totalAreaSqft, 2450);
  assert.equal(terms.breakOption, "Tenant only break at the end of year 5 on 6 months' written notice");
  // A value never takes in the next clause.
  assert.ok(!String(r.terms.find(t => t.key === "rentFree")!.quote).includes("Break"));
});

test("a PDF table's label runs into its value; a possessive label is not the party", () => {
  const r = readHotsByRules([
    "Landlord Braeburn Estates Limited (Company No. 06327384) whose registered office is at",
    "One Canada Square, London E14 5AB",
    "Tenant Bill's Restaurants Limited (company number 5211343), whose registered office is",
    "at 1 Example Street, Lewes",
    "Landlord's Solicitors Herbert Smith Freehills LLP",
    "Tenant Break At the end of year 5 on 6 months' notice",
    "Rent £85,000 per annum exclusive",
    "Rent Review Upward only at £90,000",
    "Tenant to pay the Landlord's legal costs",
  ].join("\n"));
  assert.deepEqual(r.parties.map(p => [p.role, p.name, p.number]), [
    ["landlord", "Braeburn Estates Limited", "06327384"],
    ["tenant", "Bill's Restaurants Limited", "05211343"],
  ]);
  const terms = Object.fromEntries(r.terms.map(t => [t.key, t.value]));
  assert.equal(terms.breakOption, "At the end of year 5 on 6 months' notice");
  assert.equal(terms.rentPa, 85000);
});

test("the rules leave out a guarantor that is not one, and a floor of several areas", () => {
  const r = readHotsByRules("Landlord: Acme Property Limited\nTenant: Fresh Bakes Ltd\nGuarantor: None\nArea: Ground floor 1,800 sq ft, basement 700 sq ft\n");
  assert.deepEqual(r.parties.map(p => p.role), ["landlord", "tenant"]);
  assert.equal(r.terms.find(t => t.key === "totalAreaSqft"), undefined);
  const total = readHotsByRules("Accommodation: Ground floor 1,800 sq ft, basement 700 sq ft, total 2,500 sq ft\n");
  assert.equal(total.terms.find(t => t.key === "totalAreaSqft")?.value, 2500);
});

test("the provider's answer is kept only where the document's words carry it", () => {
  const checked = checkHotsAnswer({
    parties: [
      { role: "tenant", name: "Bill's Restaurants Limited", company_number: "05211343", quote: "Bill's Restaurants Limited (company number 5211343)" },
      { role: "landlord", name: "Canary Wharf Group plc", company_number: "12345678", quote: "Canary Wharf Group plc" },
      { role: "guarantor", name: "Bill's Holdings Limited", company_number: "11111111", quote: "Bill's Holdings Limited (Company Registration Number 09876543)" },
    ],
    terms: {
      rentPa: { value: 85000, quote: "Rent: £85,000 per annum" },
      leaseLength: { value: 15, quote: "a term of ten (10) years" },
      rentFree: { value: 6, quote: "Rent Free: Six months" },
    },
  }, HOTS);
  assert.deepEqual(checked.parties.map(p => [p.role, p.number]), [["tenant", "05211343"], ["guarantor", null]]);
  assert.ok(checked.dropped.some(d => d.value === "Canary Wharf Group plc" && /not in the document/.test(d.reason)));
  assert.ok(checked.dropped.some(d => d.value === "11111111"));
  assert.deepEqual(checked.terms.map(t => t.key).sort(), ["rentFree", "rentPa"]);
  assert.ok(checked.dropped.some(d => d.what === "Lease (years)"));
  assert.equal(checked.scanned, false);
});

test("a scan's reading is kept and marked to check by eye", () => {
  const checked = checkHotsAnswer({ parties: [{ role: "tenant", name: "Bill's Restaurants Limited", company_number: "05211343", quote: "Bill's Restaurants Limited (05211343)" }], terms: { rentPa: { value: 85000, quote: "£85,000" } } }, "");
  assert.equal(checked.scanned, true);
  assert.equal(checked.parties[0].checked, false);
  assert.equal(checked.terms[0].value, 85000);
  // A figure its own words do not give is never kept, scan or not.
  const wrong = checkHotsAnswer({ terms: { rentPa: { value: 95000, quote: "£85,000" } } }, "");
  assert.equal(wrong.terms.length, 0);
});

test("the rules fill what the provider left out", () => {
  const ai = { parties: [{ role: "tenant", name: "Bill's Restaurants Limited", number: null, quote: "Bill's Restaurants Limited", checked: true }] as HotsParty[], terms: [] };
  const merged = mergeHotsReadings(ai, readHotsByRules(HOTS));
  const tenant = merged.parties.find(p => p.role === "tenant")!;
  assert.equal(tenant.number, "05211343");
  assert.ok(merged.parties.some(p => p.role === "landlord"));
  assert.ok(merged.terms.some(t => t.key === "rentPa"));
});

test("without the provider the rules read the document alone, and say so", async () => {
  const r = await readHotsDocument({ buffer: Buffer.from(HOTS), mime: "text/plain", name: "hots.txt" }, { hasKey: () => false });
  assert.equal(r.usedAi, false);
  assert.match(String(r.note), /not switched on/);
  assert.equal(r.parties.find(p => p.role === "tenant")?.number, "05211343");
});

test("the provider's answer is checked against the document and merged with the rules", async () => {
  let asked = 0;
  const r = await readHotsDocument({ buffer: Buffer.from(HOTS), mime: "text/plain", name: "hots.txt" }, {
    hasKey: () => true, claim: async () => true,
    parts: async () => ({ parts: [{ type: "text", text: HOTS }] }),
    ask: async () => { asked += 1; return { model: "test", input: { parties: [{ role: "landlord", name: "Braeburn Estates Limited", company_number: "06327384", quote: "Braeburn Estates Limited (Company No. 06327384)" }, { role: "tenant", name: "Someone Else Ltd", quote: "Someone Else Ltd" }], terms: { rentPa: { value: 85000, quote: "£85,000 per annum" } } } }; },
  });
  assert.equal(asked, 1);
  assert.equal(r.usedAi, true);
  assert.equal(r.parties.find(p => p.role === "landlord")?.number, "06327384");
  // The invented tenant is dropped and the rules' tenant stands.
  assert.equal(r.parties.find(p => p.role === "tenant")?.name, "Bill's Restaurants Limited");
  assert.ok(r.dropped.some(d => d.value === "Someone Else Ltd"));
});

test("the day's allowance used up: the rules read it, and say why", async () => {
  const r = await readHotsDocument({ buffer: Buffer.from(HOTS), mime: "text/plain", name: "hots.txt" }, {
    hasKey: () => true, claim: async () => false, parts: async () => ({ parts: [] }), ask: async () => { throw new Error("not asked"); },
  });
  assert.equal(r.usedAi, false);
  assert.match(String(r.note), /allowance/);
});

// ── Where each party is ─────────────────────────────────────────────────────

const DEAL = {
  id: "d1", deal_type: "New Letting",
  landlord_id: "L", tenant_id: "T", vendor_id: null, purchaser_id: null,
  landlord_trading_entity_id: null, tenant_trading_entity_id: null, vendor_trading_entity_id: null, purchaser_trading_entity_id: null,
  rent_pa: 80000, lease_length: null, break_option: null, rent_free: null, capital_contribution: null, total_area_sqft: 2450, pricing: null, target_date: null,
};
const fakeDb = (entities: any[], brands = [{ id: "L", name: "Canary Wharf Group" }, { id: "T", name: "Bill's" }], crm: { companies?: any[]; entities?: any[] } = {}) => ({
  async query(sql: string) {
    if (/FROM crm_companies WHERE id = ANY/.test(sql)) return { rows: brands };
    if (/FROM crm_trading_entities WHERE parent_company_id = ANY/.test(sql)) return { rows: entities };
    if (/FROM crm_companies c\s+WHERE c\.merged_into_id IS NULL/.test(sql)) return { rows: crm.companies || [] };
    if (/FROM crm_trading_entities e JOIN crm_companies c/.test(sql)) return { rows: crm.entities || [] };
    throw new Error(`unexpected query: ${sql.slice(0, 80)}`);
  },
});
const lookups = (byNumber: Record<string, { name: string; status?: string }>, byName: Record<string, Array<{ company_number: string; title: string; company_status?: string }>> = {}): RegisterLookups => ({
  async byNumber(n) { const h = byNumber[n]; return h ? { number: n, name: h.name, status: h.status || "active", address: null } : null; },
  async byName(name) { return byName[name] || []; },
});
const party = (role: HotsParty["role"], name: string, number: string | null = null): HotsParty => ({ role, name, number, quote: name, checked: true });

test("a company filed under the party is offered, and read as signing once set", async () => {
  const entities = [{ id: "e1", name: "BILL'S RESTAURANTS LIMITED", companies_house_number: "05211343", parent_company_id: "T" }];
  const [m] = await matchHotsParties(fakeDb(entities), DEAL as any, [party("tenant", "Bill's Restaurants Limited", "05211343")], lookups({}));
  assert.equal(m.state, "filed");
  assert.equal(m.filed?.id, "e1");
  assert.equal(m.brand?.name, "Bill's");
  const [signs] = await matchHotsParties(fakeDb(entities), { ...DEAL, tenant_trading_entity_id: "e1" } as any, [party("tenant", "Bill's Restaurants Limited", "05211343")], lookups({}));
  assert.equal(signs.state, "signs");
});

test("a company not filed is found at Companies House by its number, and a name that differs is said", async () => {
  const [m] = await matchHotsParties(fakeDb([]), DEAL as any, [party("landlord", "Braeburn Estates Limited", "06327384")], lookups({ "06327384": { name: "BRAEBURN ESTATES LIMITED" } }));
  assert.equal(m.state, "register");
  assert.equal(m.register[0].agrees, true);
  const [other] = await matchHotsParties(fakeDb([]), DEAL as any, [party("landlord", "Braeburn Estates Limited", "06327384")], lookups({ "06327384": { name: "SOMETHING ELSE LIMITED" } }));
  assert.equal(other.state, "register");
  assert.equal(other.register[0].agrees, false);
  const [gone] = await matchHotsParties(fakeDb([]), DEAL as any, [party("landlord", "Braeburn Estates Limited", "06327384")], lookups({ "06327384": { name: "BRAEBURN ESTATES LIMITED", status: "dissolved" } }));
  assert.equal(gone.state, "not_found");
  assert.match(String(gone.registerNote), /dissolved/);
});

test("by name: one live company is offered, several are a choice, a brand name is no company", async () => {
  const search = { "Braeburn Estates Limited": [{ company_number: "06327384", title: "BRAEBURN ESTATES LIMITED" }, { company_number: "99999999", title: "BRAEBURN ESTATES (HOLDINGS) LIMITED" }] };
  const [one] = await matchHotsParties(fakeDb([]), DEAL as any, [party("landlord", "Braeburn Estates Limited")], lookups({}, search));
  assert.equal(one.state, "register");
  assert.equal(one.register[0].number, "06327384");
  const two = { "Braeburn Estates Limited": [{ company_number: "06327384", title: "BRAEBURN ESTATES LIMITED" }, { company_number: "06327385", title: "Braeburn Estates Ltd" }] };
  const [choose] = await matchHotsParties(fakeDb([]), DEAL as any, [party("landlord", "Braeburn Estates Limited")], lookups({}, two));
  assert.equal(choose.state, "choose");
  const [brand] = await matchHotsParties(fakeDb([]), DEAL as any, [party("tenant", "Bill's")], lookups({}));
  assert.equal(brand.state, "no_company");
});

test("Companies House not set up: said, never a guess", async () => {
  const [m] = await matchHotsParties(fakeDb([]), DEAL as any, [party("landlord", "Braeburn Estates Limited", "06327384")], null);
  assert.equal(m.state, "not_found");
  assert.match(String(m.registerNote), /not set up/);
});

test("no party on the transaction yet: the CRM records of that name are offered", async () => {
  const deal = { ...DEAL, tenant_id: null };
  const db = fakeDb([], [{ id: "L", name: "Canary Wharf Group" }], {
    entities: [{ id: "e1", name: "Bill's Restaurants Limited", companies_house_number: "05211343", brand_id: "T", brand_name: "Bill's", brand_type: "Tenant - Restaurant" }],
  });
  const [m] = await matchHotsParties(db, deal as any, [party("tenant", "Bill's Restaurants Limited", "05211343")], lookups({ "05211343": { name: "BILL'S RESTAURANTS LIMITED" } }));
  assert.equal(m.state, "no_party");
  assert.equal(m.candidates[0].companyId, "T");
  assert.equal(m.candidates[0].entityId, "e1");
});

test("a guarantor is shown, never set; a sale reads its landlord as the vendor", async () => {
  const [g] = await matchHotsParties(fakeDb([]), DEAL as any, [party("guarantor", "Bill's Holdings Limited", "09876543")], lookups({ "09876543": { name: "BILL'S HOLDINGS LIMITED" } }));
  assert.equal(g.role, null);
  assert.equal(g.state, "guarantor");
  assert.equal(g.register[0].name, "BILL'S HOLDINGS LIMITED");
  const sale = { ...DEAL, deal_type: "Sale", landlord_id: null, tenant_id: null, vendor_id: "V" };
  const [v] = await matchHotsParties(fakeDb([], [{ id: "V", name: "URC Thames North Trust" }]), sale as any, [party("landlord", "URC Thames North Trust")], lookups({}));
  assert.equal(v.role, "vendor");
});

test("each term beside what the transaction holds, and only the terms its type shows", () => {
  const views = hotsTermViews(DEAL as any, [
    { key: "rentPa", value: 85000, quote: "£85,000", checked: true },
    { key: "leaseLength", value: 10, quote: "10 years", checked: true },
    { key: "totalAreaSqft", value: 2450, quote: "2,450 sq ft", checked: true },
    { key: "pricing", value: 4250000, quote: "£4,250,000", checked: true },
  ]);
  assert.deepEqual(views.map(v => [v.key, v.state]), [["rentPa", "differs"], ["leaseLength", "blank"], ["totalAreaSqft", "same"]]);
  const sale = hotsTermViews({ ...DEAL, deal_type: "Sale" } as any, [{ key: "pricing", value: 4250000, quote: "£4,250,000", checked: true }, { key: "rentPa", value: 85000, quote: "£85,000", checked: true }]);
  assert.deepEqual(sale.map(v => v.key), ["pricing"]);
  assert.equal(hotsTermState("text", "Tenant only break at year 5", "tenant only break at year 5."), "same");
  assert.deepEqual(hotsTermPatch("leaseLength", 10), { leaseLength: 10 });
  assert.deepEqual(hotsTermPatch("breakOption", "Year 5"), { breakOption: "Year 5" });
});

test("a reading sent back by the screen is kept only in the reader's shape", () => {
  const parties = partiesFromBody([{ role: "tenant", name: "  Bill's  Restaurants Limited ", number: "5211343", quote: "x" }, { role: "agent", name: "Savills" }, { role: "tenant", name: "" }]);
  assert.deepEqual(parties.map(p => [p.role, p.name, p.number]), [["tenant", "Bill's Restaurants Limited", "05211343"]]);
  const terms = termsFromBody([{ key: "rentPa", value: "85000" }, { key: "fee", value: 1 }, { key: "rentPa", value: 1 }, { key: "leaseLength", value: "ten" }]);
  assert.deepEqual(terms.map(t => [t.key, t.value]), [["rentPa", 85000]]);
});
