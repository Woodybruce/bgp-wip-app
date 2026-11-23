// Heads of terms read on the transaction page (Woody, 23 November 2026:
// "where is the upload HOTs place? so can populate?"). The rules reader, the
// checks on the provider's answer, and where each party is.
import test from "node:test";
import assert from "node:assert/strict";
import {
  checkHotsAnswer, cleanCompanyNumber, countsIn, documentHasText, hotsNamesClose, hotsTermPatch, hotsTermState, mergeHotsReadings, moneyIn, numberAfterName, numberInQuote,
  readHotsByRules, readHotsNoteRules,
  contactsFromBody, firmLike, isBgpContact, mergeHotsContacts, readHotsContactsByRules,
  type HotsContact, type HotsParty,
} from "@shared/deal-hots";
import { hotsContactViews, hotsTermViews, matchHotsParties, partiesFromBody, readHotsDocument, readHotsNote, termsFromBody, type RegisterLookups } from "./deal-hots";

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
const lookups = (byNumber: Record<string, { name: string; status?: string; previous?: string[] }>, byName: Record<string, Array<{ company_number: string; title: string; company_status?: string }>> = {}): RegisterLookups => ({
  async byNumber(n) { const h = byNumber[n]; return h ? { number: n, name: h.name, status: h.status || "active", address: null, previousNames: h.previous || [] } : null; },
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
  assert.equal(m.numberIsAnother, null);
  // A word in common: offered, with "check it is the same company".
  const [close] = await matchHotsParties(fakeDb([]), DEAL as any, [party("landlord", "Braeburn Estates Limited", "06327384")], lookups({ "06327384": { name: "BRAEBURN ESTATES (HOLDINGS) LIMITED" } }));
  assert.equal(close.state, "register");
  assert.equal(close.register[0].agrees, false);
  assert.equal(close.numberIsAnother, null);
  const [gone] = await matchHotsParties(fakeDb([]), DEAL as any, [party("landlord", "Braeburn Estates Limited", "06327384")], lookups({ "06327384": { name: "BRAEBURN ESTATES LIMITED", status: "dissolved" } }));
  assert.equal(gone.state, "not_found");
  assert.match(String(gone.registerNote), /dissolved/);
});

test("a number that is another company's is never offered: the name is looked up instead (live check, 23 November 2026)", async () => {
  const L = { "06327384": { name: "AUSTIN BARBER DESIGN LIMITED" } };
  const [none] = await matchHotsParties(fakeDb([]), DEAL as any, [party("landlord", "Braeburn Estates Limited", "06327384")], lookups(L));
  assert.equal(none.state, "not_found");
  assert.deepEqual(none.register, []);
  assert.deepEqual(none.numberIsAnother, { number: "06327384", name: "AUSTIN BARBER DESIGN LIMITED", status: "active" });
  assert.match(String(none.registerNote), /no live company called Braeburn Estates Limited/);
  // Found by its name: that company is offered, never the number's.
  const [byName] = await matchHotsParties(fakeDb([]), DEAL as any, [party("landlord", "Braeburn Estates Limited", "06327384")],
    lookups(L, { "Braeburn Estates Limited": [{ company_number: "11111111", title: "BRAEBURN ESTATES LIMITED" }] }));
  assert.equal(byName.state, "register");
  assert.deepEqual(byName.register.map(h => h.number), ["11111111"]);
  assert.equal(byName.register[0].agrees, true);
  assert.match(String(byName.registerNote), /Found by its name instead/);
  // A guarantor's number is said the same way, and its company is not shown as the guarantor.
  const [g] = await matchHotsParties(fakeDb([]), DEAL as any, [party("guarantor", "Bill's Holdings Limited", "09876543")],
    lookups({ "09876543": { name: "SPECIALISED IN TAX ACCOUNTING LTD", status: "dissolved" } }));
  assert.equal(g.state, "guarantor");
  assert.equal(g.numberIsAnother?.name, "SPECIALISED IN TAX ACCOUNTING LTD");
  assert.deepEqual(g.register, []);
});

test("a former name at Companies House is the same company", async () => {
  const [m] = await matchHotsParties(fakeDb([]), DEAL as any, [party("landlord", "Braeburn Estates Limited", "06327384")],
    lookups({ "06327384": { name: "ORCHARD HOLDINGS LIMITED", previous: ["BRAEBURN ESTATES LIMITED"] } }));
  assert.equal(m.state, "register");
  assert.equal(m.register[0].agrees, true);
  assert.equal(m.numberIsAnother, null);
  assert.match(String(m.registerNote), /former name/);
});

test("names close enough to be the company a number names", () => {
  assert.equal(hotsNamesClose("Bill's Restaurants Limited", "BILLS RESTAURANTS LTD."), true);
  assert.equal(hotsNamesClose("Braeburn Estates Limited", "BRAEBURN ESTATES (HOLDINGS) LIMITED"), true);
  assert.equal(hotsNamesClose("Bill's", "BILLS RESTAURANTS LTD."), true);
  assert.equal(hotsNamesClose("Braeburn Estates Limited", "AUSTIN BARBER DESIGN LIMITED"), false);
  assert.equal(hotsNamesClose("Bill's Holdings Limited", "SPECIALISED IN TAX ACCOUNTING LTD"), false);
  // Common words alone are no match: Smith Estates is not Braeburn Estates.
  assert.equal(hotsNamesClose("Braeburn Estates Limited", "SMITH ESTATES LIMITED"), false);
  // A name of common words only is compared on all its words.
  assert.equal(hotsNamesClose("London Property Holdings Limited", "LONDON PROPERTY HOLDINGS (NO. 2) LIMITED"), true);
  assert.equal(hotsNamesClose("London Property Holdings Limited", "AUSTIN BARBER DESIGN LIMITED"), false);
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

// ── A note typed in the box (Woody, 23 November 2026: "drop HOTS or type it out?") ──

test("a typed note is checked against itself, however short", () => {
  assert.equal(documentHasText("Landlord is Brucecap Ltd"), false);
  assert.equal(documentHasText("Landlord is Brucecap Ltd", { note: true }), true);
  assert.deepEqual(moneyIn("Rent £120kpax and £85k pa"), [120000, 85000]);
  assert.deepEqual(countsIn("rent free 5 momnths", "months"), [5]);
  assert.deepEqual(countsIn("maths", "months"), []);
  assert.equal(numberAfterName("Tenant is Bill's Restaurants Ltd (05211343), rent", "Bill's Restaurants Ltd"), "05211343");
  assert.equal(numberAfterName("Landlord is Braeburn Estates Ltd, company number 6327384.", "Braeburn Estates Ltd"), "06327384");
  assert.equal(numberAfterName("Tenant is Bill's Restaurants Ltd, rent 300000 pax", "Bill's Restaurants Ltd"), null);
});

test("Woody's own note reads its parties and terms by the rules", () => {
  const note = "lettering on 55 wells street London to Bruce gillingham pollard LTd. Landlord is Brucecap Ltd rent is 300,000 pax term 10 yrs rent free 5 momnths";
  const checked = checkHotsAnswer(readHotsNoteRules(note, "2026-11-23"), note, { note: true });
  assert.deepEqual(checked.parties.map(p => [p.role, p.name]), [["landlord", "Brucecap Ltd"], ["tenant", "Bruce gillingham pollard LTd"]]);
  const terms = Object.fromEntries(checked.terms.map(t => [t.key, t.value]));
  assert.equal(terms.rentPa, 300000);
  assert.equal(terms.leaseLength, 10);
  assert.equal(checked.scanned, false);
});

test("a typed note: names with their numbers, and every term the shorthand reads", async () => {
  const note = "Landlord is Braeburn Estates Ltd (06327384). Tenant is Bill's Restaurants Limited, company number 5211343. Rent £85k pa, 10 yr lease, 6 months rent free, tenant break at year 5, £50k CC";
  const r = await readHotsNote(note, { hasKey: () => false });
  assert.equal(r.usedAi, false);
  assert.match(String(r.note), /only the rules read it/);
  assert.deepEqual(r.parties.map(p => [p.role, p.number]), [["landlord", "06327384"], ["tenant", "05211343"]]);
  const terms = Object.fromEntries(r.terms.map(t => [t.key, t.value]));
  assert.deepEqual(terms, { rentPa: 85000, leaseLength: 10, breakOption: "Tenant break at year 5", rentFree: 6, capitalContribution: 50000 });
  assert.ok(r.parties.every(p => p.checked));
});

test("a typed note goes to the provider as the note alone, and its answer is checked against the note", async () => {
  const note = "Landlord is Braeburn Estates Ltd. Tenant Bill's Restaurants Ltd taking 10 years at £85,000 pa.";
  let sent = "";
  const r = await readHotsNote(note, {
    hasKey: () => true, claim: async () => true,
    ask: async (_system, parts) => {
      sent = JSON.stringify(parts);
      return { model: "test", input: {
        parties: [{ role: "tenant", name: "Bill's Restaurants Ltd", quote: "Tenant Bill's Restaurants Ltd" }, { role: "guarantor", name: "Made Up Holdings Ltd", quote: "Made Up Holdings Ltd" }],
        terms: { rentPa: { value: 85000, quote: "£85,000 pa" }, leaseLength: { value: 10, quote: "10 years" } },
      } };
    },
  });
  assert.match(sent, /<note>/);
  assert.ok(!/crm|companies_house/i.test(sent));
  assert.equal(r.usedAi, true);
  assert.ok(r.parties.some(p => p.role === "tenant" && p.name === "Bill's Restaurants Ltd"));
  assert.ok(r.parties.some(p => p.role === "landlord" && p.name === "Braeburn Estates Ltd"));
  assert.ok(!r.parties.some(p => p.name === "Made Up Holdings Ltd"));
  assert.ok(r.dropped.some(d => d.value === "Made Up Holdings Ltd"));
});


// ── Solicitors and agents (Woody, 23 November 2026: "the HOTs upload / drop
// didnt pick up their solcitors or ours or their agent") ───────────────────

const CONTACT_SHEET = `${HOTS}
CONTACTS
Landlord Solicitors
GT - GreenbergTraurig
FAO: Jo Partner
T: 020 7900 3000
Email: jo.partner@gtlaw.example
Tenant Solicitors
Shoosmiths LLP
Contact: Sam Lawyer
Email: sam.lawyer@shoosmiths.example
Landlord's Agent
Bruce Gillingham Pollard
Alex Agent
alex.agent@brucegillinghampollard.com
Tenant's Agent
Savills (UK) Limited
James Brown
M: 07700 900123
jbrown@savills.example
`;

const contactOf = (list: HotsContact[], side: string, kind: string) => list.find(c => c.side === side && c.kind === kind);

test("the rules read a contact sheet: each side's solicitors and agents, with the person, email and phone", () => {
  const c = readHotsContactsByRules(CONTACT_SHEET);
  assert.equal(c.length, 4);
  const ll = contactOf(c, "landlord", "solicitor")!;
  // The clause "5. Landlord's Solicitors: Herbert Smith Freehills LLP" comes first in the document.
  assert.equal(ll.firm, "Herbert Smith Freehills LLP");
  const tAgent = contactOf(c, "tenant", "agent")!;
  assert.equal(tAgent.firm, "Savills");
  assert.equal(tAgent.person, "James Brown");
  assert.equal(tAgent.phone, "07700 900123");
  assert.equal(tAgent.email, "jbrown@savills.example");
  assert.ok(tAgent.checked);
  const lAgent = contactOf(c, "landlord", "agent")!;
  assert.equal(lAgent.firm, "Bruce Gillingham Pollard");
  assert.ok(isBgpContact(lAgent));
  assert.ok(!isBgpContact(tAgent));
  assert.ok(isBgpContact({ firm: "Someone", email: "x@brucegillinghampollard.com" }));
});

test("a contact sheet on its own: the firm under the label, the person from FAO or Contact", () => {
  const sheet = CONTACT_SHEET.slice(CONTACT_SHEET.indexOf("CONTACTS"));
  const c = readHotsContactsByRules(sheet, { note: true });
  const ll = contactOf(c, "landlord", "solicitor")!;
  assert.deepEqual([ll.firm, ll.person, ll.email, ll.phone], ["GT - GreenbergTraurig", "Jo Partner", "jo.partner@gtlaw.example", "020 7900 3000"]);
  const ts = contactOf(c, "tenant", "solicitor")!;
  assert.deepEqual([ts.firm, ts.person, ts.email], ["Shoosmiths LLP", "Sam Lawyer", "sam.lawyer@shoosmiths.example"]);
});

test("a row a PDF flattened onto one line is read; a sentence, a blank and the next clause are not", () => {
  const pdf = readHotsContactsByRules("Landlord Solicitors GT - GreenbergTraurig\nFAO: Jo Partner\n020 7900 3000\nEmail: jo.partner@gtlaw.example", { note: true });
  assert.deepEqual([pdf[0].firm, pdf[0].person, pdf[0].phone, pdf[0].email], ["GT - GreenbergTraurig", "Jo Partner", "020 7900 3000", "jo.partner@gtlaw.example"]);
  assert.deepEqual(readHotsContactsByRules("The Landlord's solicitors will prepare the lease and send it to the Tenant", { note: true }), []);
  assert.deepEqual(readHotsContactsByRules("Landlord's Solicitors: TBC\nTenant's Solicitors: to be confirmed", { note: true }), []);
  // An empty cell: the next clause is not the firm.
  assert.deepEqual(readHotsContactsByRules("Tenant's Solicitors\nTerm: 10 years from completion", { note: true }), []);
  // A clause heading under an inline firm is never the person.
  const heading = readHotsContactsByRules("Landlord's Solicitors: Herbert Smith Freehills LLP\nRent Free\nSix months", { note: true });
  assert.equal(heading[0].firm, "Herbert Smith Freehills LLP");
  assert.equal(heading[0].person, null);
  // The person written beside the firm.
  const inline = readHotsContactsByRules("Tenant's Solicitors: Shoosmiths LLP (FAO Sam Lawyer)", { note: true });
  assert.deepEqual([inline[0].firm, inline[0].person], ["Shoosmiths LLP", "Sam Lawyer"]);
  assert.ok(firmLike("Savills (UK) Limited"));
  assert.ok(firmLike("GT - GreenbergTraurig"));
  assert.ok(!firmLike("will prepare the lease"));
  assert.ok(!firmLike("Each party to bear its own costs"));
});

test("the provider's contacts are kept only where the document's own words carry them", () => {
  const raw = {
    parties: [],
    contacts: [
      { side: "landlord", kind: "solicitor", firm: "GT - GreenbergTraurig", person: "Jo Partner", email: "jo.partner@gtlaw.example", phone: "020 7900 3000", quote: "GT - GreenbergTraurig" },
      // Firm not in the document.
      { side: "tenant", kind: "solicitor", firm: "Made Up LLP", quote: "Shoosmiths LLP" },
      // Its words are not in the document.
      { side: "tenant", kind: "agent", firm: "Savills", quote: "Savills plc, the tenant's agent" },
      // An email and a phone the document does not give are dropped, the firm kept.
      { side: "landlord", kind: "agent", firm: "Bruce Gillingham Pollard", email: "someone@else.example", phone: "0161 000 0000", person: "Nobody Here", quote: "Bruce Gillingham Pollard" },
      // Not a side or a kind.
      { side: "guarantor", kind: "solicitor", firm: "Shoosmiths LLP", quote: "Shoosmiths LLP" },
    ],
  };
  const checked = checkHotsAnswer(raw, CONTACT_SHEET);
  assert.equal(checked.contacts.length, 2);
  const ll = contactOf(checked.contacts, "landlord", "solicitor")!;
  assert.deepEqual([ll.person, ll.email, ll.phone], ["Jo Partner", "jo.partner@gtlaw.example", "020 7900 3000"]);
  const agent = contactOf(checked.contacts, "landlord", "agent")!;
  assert.deepEqual([agent.email, agent.phone, agent.person], [null, null, null]);
  const reasons = checked.dropped.map(d => `${d.what}: ${d.reason}`);
  assert.ok(reasons.includes("Tenant's solicitors: the firm is not in the document"));
  assert.ok(reasons.includes("Tenant's agent: its words are not in the document"));
});

test("the provider's contact first, its blanks from the rules' reading of the same firm", () => {
  const ai: HotsContact[] = [{ side: "tenant", kind: "agent", firm: "Savills (UK) Limited", person: null, email: null, phone: null, quote: "Savills (UK) Limited", checked: true }];
  const rules = readHotsContactsByRules(CONTACT_SHEET);
  const merged = mergeHotsContacts(ai, rules);
  const agent = contactOf(merged, "tenant", "agent")!;
  assert.equal(agent.firm, "Savills (UK) Limited");
  assert.equal(agent.person, "James Brown");
  assert.equal(agent.email, "jbrown@savills.example");
  // The rules' others follow; one per side and kind.
  assert.equal(merged.length, 4);
  // A different firm for the same side and kind is not mixed in.
  const other = mergeHotsContacts([{ ...ai[0], firm: "Knight Frank" }], rules);
  assert.equal(contactOf(other, "tenant", "agent")!.person, null);
});

test("contacts sent back by the screen are kept only in the reader's shape", () => {
  const back = contactsFromBody([
    { side: "tenant", kind: "agent", firm: "Savills", email: "not an email", quote: "Savills" },
    { side: "tenant", kind: "agent", firm: "Second", quote: "x" },
    { side: "nobody", kind: "agent", firm: "X LLP" },
    { side: "landlord", kind: "lawyers", firm: "Y LLP" },
  ]);
  assert.equal(back.length, 2);
  assert.equal(back[0].email, null);
  assert.equal(back[1].kind, "solicitor");
});

function contactsDb(names: Record<string, string>, checkedFirms: string[]) {
  return {
    query: async (sql: string) => {
      if (/FROM crm_companies/.test(sql)) return { rows: Object.entries(names).map(([id, name]) => ({ id, name })) };
      if (/FROM kyc_solicitor_checks/.test(sql)) return { rows: checkedFirms.map(firm => ({ firm })) };
      return { rows: [] };
    },
  };
}

test("each contact beside the transaction: the agent set, our client's solicitors, an SRA check, BGP itself", async () => {
  const contacts = readHotsContactsByRules(CONTACT_SHEET.slice(CONTACT_SHEET.indexOf("CONTACTS")), { note: true });
  const deal: any = { id: "d1", deal_type: "New Letting", bgp_acting_for: "landlord", team: ["London Estate"], solicitor_firm: "GT GreenbergTraurig", acquisition_agent_id: "c-sav" };
  const views = await hotsContactViews(contactsDb({ "c-sav": "Savills (UK) Limited" }, ["Shoosmiths LLP"]), deal, contacts);
  const view = (side: string, kind: string) => views.find(v => v.side === side && v.read.kind === kind)!;
  // BGP acts for the landlord: its solicitors are our client's, already on the transaction.
  assert.ok(view("landlord", "solicitor").clientSide);
  assert.ok(view("landlord", "solicitor").same);
  // The tenant's solicitors were checked at the SRA on this transaction.
  assert.ok(!view("tenant", "solicitor").clientSide);
  assert.ok(view("tenant", "solicitor").checked);
  // The landlord's agent is BGP.
  assert.ok(view("landlord", "agent").us);
  // The tenant's agent is the firm already on the transaction.
  assert.equal(view("tenant", "agent").onDeal, "Savills (UK) Limited");
  assert.ok(view("tenant", "agent").same);
  // A sale's heads of terms that say landlord and tenant: the seller and the buyer.
  const sale = await hotsContactViews(contactsDb({}, []), { id: "d2", deal_type: "Sale" } as any, contacts);
  assert.deepEqual([...new Set(sale.map(v => v.side))].sort(), ["purchaser", "vendor"]);
  assert.ok(sale.find(v => v.side === "vendor" && v.read.kind === "solicitor")!.clientSide);
});
