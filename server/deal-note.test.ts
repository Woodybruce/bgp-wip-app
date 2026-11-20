// The deal read from the New Deal form's "Describe the deal" box (Woody,
// 20 November 2026). His note, word for word, is the first case: "lettering
// on 55 wells street London to Bruce gillingham pollard LTd.  Landlord is
// Brucecap Ltd rent is 300,000 pax term 10 yrs rent free 5 momnths". The
// rules, the checks, the server's look-ups (with a fake database, provider
// and Companies House) and the form's mapping run here.
import test from "node:test";
import assert from "node:assert/strict";
import {
  addressSearch, checkDealNoteAnswer, dealTypeFromWords, mergeDealProposals, partyCandidates, partyNameKey,
  readDealNoteRules, registerHits, tidyOfferReadingForDeal, type DealNoteRead,
} from "../shared/deal-note";
import { dealNotePrompt, dealNoteTool, findParty, findPlace, proposeFromNote, readDealFromNote } from "./deal-note-reader";
import { billingPatch, dealAutoName, dealReadPatch, noteUnitId, partyPatch, propertyPickPatch, rolesShownFor, teamForDealType } from "../client/src/lib/deal-note";

const NOTE = "lettering on 55 wells street London to Bruce gillingham pollard LTd.  Landlord is Brucecap Ltd rent is 300,000 pax term 10 yrs rent free 5 momnths";

test("the rules read Woody's note: the address, the landlord and the tenant, each with the note's own words", () => {
  const r = readDealNoteRules(NOTE);
  assert.deepEqual(r.address, { value: "55 wells street London", quote: "55 wells street London" });
  assert.deepEqual(r.parties.map(p => [p.role, p.name, p.quote]), [
    ["landlord", "Brucecap Ltd", "Landlord is Brucecap Ltd"],
    ["tenant", "Bruce gillingham pollard LTd", "lettering on 55 wells street London to Bruce gillingham pollard LTd"],
  ]);
  assert.deepEqual(r.dealType, { value: "New Letting", quote: "lettering on" }, "\"lettering on\" is \"letting\" autocorrected");
  assert.equal(r.unit, null);
});

test("the rules read the kinds of deal they are sure of, and none when the note names two", () => {
  assert.equal(dealTypeFromWords("New letting of unit 4 to Acme")?.value, "New Letting");
  assert.equal(dealTypeFromWords("Sub-letting of the second floor to Acme")?.value, "Sub-Letting");
  assert.equal(dealTypeFromWords("Rent review at Bluewater")?.value, "Rent Review");
  assert.equal(dealTypeFromWords("Rent review and lease renewal at Bluewater"), null);
  assert.equal(dealTypeFromWords("lettering on 55 wells street")?.value, "New Letting");
  assert.equal(dealTypeFromWords("new shopfront lettering approved"), null, "signage lettering is not a letting");
});

test("every value must be the note's own words; a kind of deal must be one of the form's", () => {
  const { proposal, dropped } = checkDealNoteAnswer(NOTE, {
    deal_type: { value: "new letting", quote: "lettering" },
    address: { value: "55 Wells Street", quote: "on 55 wells street London" },
    tenant: { value: "Bruce Gillingham Pollard Limited", quote: "to Bruce gillingham pollard LTd" },
    landlord: { value: "Acme Ltd", quote: "Landlord is Acme Ltd" },
    vendor: { value: "Landlord", quote: "Landlord is" },
  });
  assert.deepEqual(proposal.dealType, { value: "New Letting", quote: "lettering" }, "case aside, the form's own label");
  assert.equal(proposal.address?.value, "55 Wells Street");
  assert.deepEqual(proposal.parties.map(p => p.role), [], "a name not inside its words, a quote not in the note, a role for a name");
  const reasons = Object.fromEntries(dropped.map(d => [d.what, d.reason]));
  assert.match(reasons.Tenant, /not in the words it came from/);
  assert.match(reasons.Landlord, /not in the note/);
  assert.match(reasons.Vendor, /not a name/);
  const bad = checkDealNoteAnswer(NOTE, { deal_type: { value: "Letting", quote: "lettering" } });
  assert.equal(bad.proposal.dealType, null);
  assert.match(bad.dropped[0].reason, /not one of the deal form's types/);
});

test("one name in two roles, or the address as a party, is used for neither", () => {
  const twin = checkDealNoteAnswer(NOTE, {
    landlord: { value: "Brucecap Ltd", quote: "Landlord is Brucecap Ltd" },
    tenant: { value: "Brucecap Ltd", quote: "Brucecap Ltd" },
  });
  assert.deepEqual(twin.proposal.parties, []);
  assert.ok(twin.dropped.every(d => /more than one party/.test(d.reason)));
  const place = checkDealNoteAnswer(NOTE, {
    address: { value: "55 wells street London", quote: "55 wells street London" },
    tenant: { value: "55 wells street London", quote: "55 wells street London" },
  });
  assert.deepEqual(place.proposal.parties, []);
  assert.match(place.dropped[0].reason, /it is the address/);
});

test("the provider's reading stands and the rules fill only its gaps", () => {
  const ai = checkDealNoteAnswer(NOTE, { deal_type: { value: "New Letting", quote: "lettering" }, tenant: { value: "Bruce gillingham pollard LTd", quote: "to Bruce gillingham pollard LTd" } }).proposal;
  const merged = mergeDealProposals(NOTE, ai, readDealNoteRules(NOTE)).proposal;
  assert.equal(merged.dealType?.value, "New Letting");
  assert.equal(merged.address?.value, "55 wells street London", "the rules' address fills the provider's gap");
  assert.deepEqual(merged.parties.map(p => [p.role, p.name]), [["landlord", "Brucecap Ltd"], ["tenant", "Bruce gillingham pollard LTd"]]);
  assert.equal(merged.parties.find(p => p.role === "tenant")?.quote, "to Bruce gillingham pollard LTd", "the provider's words for its own party");
});

test("an address is looked up word by word: the number whole, Street as St too, the town left out", () => {
  const s = addressSearch("55 wells street London");
  assert.deepEqual(s.patterns, ["\\m55\\M", "\\mwells\\M", "\\m(street|st)\\M"]);
  assert.deepEqual(s.loose, ["\\mwells\\M", "\\m(street|st)\\M"]);
  assert.equal(s.postcode, null);
  assert.equal(addressSearch("Unit 4, 1 High St, W1T 3PT").postcode, "W1T3PT");
  assert.deepEqual(addressSearch("55-57 Wells Street").patterns[0], "\\m55\\M");
  assert.ok(new RegExp(s.patterns[0].replace(/\\m|\\M/g, "\\b")).test("55 wells st") && !new RegExp(s.patterns[0].replace(/\\m|\\M/g, "\\b")).test("155 wells st"));
});

test("a party is the CRM company of its name, with the company filed under it that the name is", () => {
  assert.equal(partyNameKey("Bruce gillingham pollard LTd"), partyNameKey("BRUCE GILLINGHAM POLLARD LIMITED"));
  assert.equal(partyNameKey("Brucecap Ltd"), partyNameKey("brucecap"));
  assert.notEqual(partyNameKey("Brucecap Ltd"), partyNameKey("BRUCE CAP SERVICES LLP"));
  // The legal company filed under another brand brings that brand.
  const viaEntity = partyCandidates("Bruce gillingham pollard LTd", [],
    [{ id: "e1", name: "BRUCE GILLINGHAM POLLARD LIMITED", companies_house_number: "01234567", brand_id: "b1", brand_name: "barrette estates" }]);
  assert.deepEqual(viaEntity, [{ companyId: "b1", companyName: "barrette estates", companyType: null, entityId: "e1", entityName: "BRUCE GILLINGHAM POLLARD LIMITED", entityNumber: "01234567" }]);
  // A company of the name and its own legal company are one candidate.
  const one = partyCandidates("Brucecap Ltd", [{ id: "c1", name: "brucecap", company_type: "Tenant - Leisure" }],
    [{ id: "e2", name: "BRUCECAP LIMITED", companies_house_number: "07654321", brand_id: "c1", brand_name: "brucecap" },
     { id: "e3", name: "BRUCE CAP SERVICES LLP", companies_house_number: "OC123456", brand_id: "c1", brand_name: "brucecap" }]);
  assert.equal(one.length, 1);
  assert.equal(one[0].entityId, "e2");
  // A company of the name and the same name filed under a different brand: two to pick from.
  const two = partyCandidates("Bruce gillingham pollard LTd", [{ id: "c9", name: "Bruce Gillingham Pollard", company_type: "Landlord" }],
    [{ id: "e1", name: "BRUCE GILLINGHAM POLLARD LIMITED", companies_house_number: "01234567", brand_id: "b1", brand_name: "barrette estates" }]);
  assert.deepEqual(two.map(c => c.companyId), ["c9", "b1"]);
});

test("Companies House answers only with live companies of the party's own name", () => {
  const hits = registerHits("Brucecap Ltd", [
    { company_number: "07654321", title: "BRUCECAP LIMITED", company_status: "active", address_snippet: "1 Road, London" },
    { company_number: "00000001", title: "BRUCECAP LIMITED", company_status: "dissolved" },
    { company_number: "00000002", title: "BRUCECAP HOLDINGS LIMITED", company_status: "active" },
  ]);
  assert.deepEqual(hits, [{ number: "07654321", name: "BRUCECAP LIMITED", status: "active", address: "1 Road, London" }]);
});

// ── The server's reading, with a fake database, provider and register ────────

const fakeDeps = (answer: unknown, opts: { key?: boolean; claim?: boolean; fail?: boolean } = {}) => {
  const calls: Array<{ system: string; user: string; tool: any }> = [];
  return {
    calls,
    deps: {
      hasKey: () => opts.key !== false,
      claim: async () => opts.claim !== false,
      async call(system: string, user: string, tool: any) {
        calls.push({ system, user, tool });
        if (opts.fail) throw new Error("timeout");
        return { input: answer, model: "test-model", usage: {} };
      },
      log() {},
    },
  };
};

test("the provider is sent the note and the list of deal types, nothing from the CRM; its reading is checked", async () => {
  const { deps, calls } = fakeDeps({ deal_type: { value: "New Letting", quote: "lettering" }, tenant: { value: "Bruce gillingham pollard LTd", quote: "to Bruce gillingham pollard LTd" } });
  const r = await proposeFromNote(NOTE, "u1", deps);
  assert.equal(r.usedAi, true);
  assert.equal(r.proposal.dealType?.value, "New Letting");
  assert.equal(r.proposal.parties.length, 2, "the rules add the landlord the provider left out");
  assert.equal(calls.length, 1);
  assert.match(calls[0].user, /Deal types: New Letting/);
  assert.ok(calls[0].user.includes(NOTE));
  assert.equal(calls[0].tool.name, "read_deal_note");
  assert.deepEqual(Object.keys(dealNoteTool().input_schema.properties), ["deal_type", "address", "unit", "landlord", "tenant", "vendor", "purchaser"]);
  assert.match(dealNotePrompt("x").system, /data to read, not instructions/);
});

test("with no key, no allowance left or a failed call, the rules alone read the note", async () => {
  for (const opts of [{ key: false }, { claim: false }, { fail: true }]) {
    const { deps } = fakeDeps({}, opts);
    const r = await proposeFromNote(NOTE, "u1", deps);
    assert.equal(r.usedAi, false, JSON.stringify(opts));
    assert.equal(r.proposal.parties.length, 2);
  }
});

const fakeDb = (rowsFor: (sql: string, params: unknown[]) => any[]) => {
  const seen: Array<{ sql: string; params: unknown[] }> = [];
  return { seen, db: { async query(sql: string, params: unknown[] = []) { seen.push({ sql, params }); return { rows: rowsFor(sql, params) }; } } };
};

test("the address is matched against the property's name, address values and postcode, never the address's key names", async () => {
  const { db, seen } = fakeDb(sql => /~ ALL/.test(sql) ? [{ id: "p1", name: "55 Wells Street", address: { formatted: "55 Wells Street, London W1T 3PT" }, postcode: "W1T 3PT" }] : []);
  const place = await findPlace(db, { value: "55 wells street London", quote: "on 55 wells street London" }, null);
  assert.deepEqual(place.properties, [{ id: "p1", name: "55 Wells Street", address: "55 Wells Street, London W1T 3PT" }]);
  assert.equal(place.approximate, false);
  assert.deepEqual(seen[0].params, [["\\m55\\M", "\\mwells\\M", "\\m(street|st)\\M"]]);
  assert.match(seen[0].sql, /p\.address->>'formatted'/);
  assert.doesNotMatch(seen[0].sql, /address::text/);
});

test("with no match on every word, a looser match is offered and never sure", async () => {
  const { db, seen } = fakeDb((sql, params) => /~ ALL/.test(sql) && (params[0] as string[]).length === 2 ? [{ id: "p2", name: "Wells Street House", address: null, postcode: null }] : []);
  const place = await findPlace(db, { value: "55 wells street London", quote: "55 wells street London" }, null);
  assert.equal(place.approximate, true);
  assert.equal(place.properties[0].id, "p2");
  assert.equal(seen.length, 2);
});

test("a party not in the CRM is looked for at Companies House; one in the CRM with its legal company is not", async () => {
  const register = async () => [{ company_number: "07654321", title: "BRUCECAP LIMITED", company_status: "active" }];
  const none = fakeDb(() => []);
  const missing = await findParty(none.db, { role: "landlord", name: "Brucecap Ltd", quote: "Landlord is Brucecap Ltd" }, register);
  assert.deepEqual(missing.candidates, []);
  assert.deepEqual(missing.register.map(h => h.number), ["07654321"]);
  assert.match(String(none.seen[0].params[0]), /%brucecap%/);

  let asked = 0;
  const held = fakeDb(sql => /FROM crm_trading_entities/.test(sql)
    ? [{ id: "e1", name: "BRUCE GILLINGHAM POLLARD LIMITED", companies_house_number: "01234567", brand_id: "b1", brand_name: "barrette estates" }] : []);
  const found = await findParty(held.db, { role: "tenant", name: "Bruce gillingham pollard LTd", quote: "x" }, async () => { asked++; return []; });
  assert.equal(found.candidates.length, 1);
  assert.equal(asked, 0, "the CRM holds the legal company: Companies House is not asked");

  const down = await findParty(none.db, { role: "landlord", name: "Brucecap Ltd", quote: "x" }, async () => { throw new Error("Companies House is not configured"); });
  assert.match(String(down.registerNote), /not set up/);
  const quiet = await findParty(none.db, { role: "landlord", name: "Brucecap Ltd", quote: "x" }, async () => []);
  assert.match(String(quiet.registerNote), /no live company called Brucecap Ltd/);
});

test("the whole reading of Woody's note: the type, the property, both parties", async () => {
  const { deps } = fakeDeps({ deal_type: { value: "New Letting", quote: "lettering" } });
  const { db } = fakeDb(sql => {
    if (/FROM crm_properties/.test(sql)) return [{ id: "p1", name: "55 Wells Street", address: null, postcode: "W1T 3PT" }];
    if (/FROM crm_trading_entities/.test(sql)) return [{ id: "e1", name: "BRUCE GILLINGHAM POLLARD LIMITED", companies_house_number: "01234567", brand_id: "b1", brand_name: "barrette estates" }];
    if (/FROM crm_companies c\s/.test(sql)) return [{ id: "c1", name: "brucecap", company_type: "Tenant - Leisure" }];
    return [];
  });
  const read = await readDealFromNote(db, NOTE, "u1", { deps, searchRegister: async () => [] });
  assert.equal(read.dealType?.value, "New Letting");
  assert.equal(read.place?.properties[0].id, "p1");
  assert.deepEqual(read.parties.map(p => [p.role, p.candidates.map(c => c.companyId)]), [["landlord", ["c1"]], ["tenant", ["b1"]]]);
  assert.match(String(read.parties[0].registerNote), /no live company/, "Brucecap Ltd names a legal company the CRM does not hold, so Companies House was asked");
});

// ── The first reading, tidied ────────────────────────────────────────────────

test("the offer reading loses what the deal reading answers: the parties as brand or agent, and \"not a brand on this unit\"", () => {
  const deal: DealNoteRead = {
    dealType: null, usedAi: true, dropped: [],
    place: { text: "55 wells street London", quote: "55 wells street London", unit: null, properties: [], approximate: false },
    parties: [{ role: "tenant", name: "Bruce gillingham pollard LTd", quote: "x", candidates: [], register: [], registerNote: null }],
  };
  const reading = {
    fields: { rentPa: 300000, agentName: "Bruce gillingham pollard LTd", contactName: "Jo Smith" } as Record<string, any>,
    quotes: { rentPa: "300,000 pax", agentName: "Bruce gillingham pollard LTd" } as Record<string, any>,
    unsure: [{ field: "agentName", value: "Bruce gillingham pollard LTd", quote: "x" }, { field: "termYears", value: 10, quote: "term 10 yrs" }, { field: "brandName", value: "lettering on 55 wells street London", quote: "y" }],
    dropped: [{ field: "brandName", reason: "is not a brand on this unit" }, { field: "premium", reason: "x" }],
    unplaced: ["Landlord is Brucecap Ltd", "to Bruce gillingham pollard LTd", "Service charge cap"],
  };
  tidyOfferReadingForDeal(reading, deal);
  assert.deepEqual(reading.fields, { rentPa: 300000, contactName: "Jo Smith" });
  assert.deepEqual(reading.unsure.map(u => u.field), ["termYears"]);
  assert.deepEqual(reading.dropped.map(d => d.field), ["premium"]);
  assert.deepEqual(reading.unplaced, ["Landlord is Brucecap Ltd", "Service charge cap"]);
});

// ── The form ─────────────────────────────────────────────────────────────────

const READ: DealNoteRead = {
  dealType: { value: "New Letting", quote: "lettering" }, usedAi: true, dropped: [],
  place: { text: "55 wells street", quote: "55 wells street", unit: null, properties: [{ id: "p1", name: "55 Wells Street", address: null }], approximate: false },
  parties: [
    { role: "landlord", name: "Brucecap Ltd", quote: "x", candidates: [{ companyId: "c1", companyName: "brucecap", companyType: null, entityId: null, entityName: null, entityNumber: null }], register: [], registerNote: null },
    { role: "tenant", name: "Bruce gillingham pollard LTd", quote: "y", candidates: [{ companyId: "b1", companyName: "barrette estates", companyType: null, entityId: "e1", entityName: "BRUCE GILLINGHAM POLLARD LIMITED", entityNumber: "01234567" }], register: [], registerNote: null },
  ],
};

test("what is sure fills an empty box: the type, the property, each party and the company that signs", () => {
  const patch = dealReadPatch({ dealType: "", propertyId: "", landlordId: "", tenantId: "" }, READ);
  assert.deepEqual(patch, { dealType: "New Letting", propertyId: "p1", landlordId: "c1", landlordEntityId: "", landlordEntityName: "", landlordTradingEntityId: "",
    tenantId: "b1", tenantEntityId: "", tenantEntityName: "", tenantTradingEntityId: "e1" });
});

test("nothing chosen is replaced, a looser property or two companies fill nothing, and a sale's form takes no landlord", () => {
  assert.deepEqual(dealReadPatch({ dealType: "Lease Disposal", propertyId: "p9", landlordId: "c9", tenantId: "" }, READ),
    { tenantId: "b1", tenantEntityId: "", tenantEntityName: "", tenantTradingEntityId: "e1" });
  const loose = { ...READ, place: { ...READ.place!, approximate: true } };
  assert.equal(dealReadPatch({ dealType: "New Letting", propertyId: "" }, loose).propertyId, undefined);
  const two = { ...READ, parties: [{ ...READ.parties[1], candidates: [READ.parties[1].candidates[0], { ...READ.parties[1].candidates[0], companyId: "b2" }] }] };
  assert.equal(dealReadPatch({ dealType: "New Letting", tenantId: "" }, two).tenantId, undefined);
  assert.deepEqual(Object.keys(dealReadPatch({ dealType: "Sale" }, { ...READ, dealType: null, place: null })), []);
  assert.deepEqual(rolesShownFor("Purchase"), ["vendor", "purchaser"]);
});

test("a party pick clears the old billing entity; a billing entity made sets the company that signs and the Xero contact", () => {
  assert.deepEqual(partyPatch({ tenantId: "b1", tenantTradingEntityId: "" }, "tenant", { companyId: "b1", entityId: "e1" }), { tenantTradingEntityId: "e1" });
  assert.deepEqual(partyPatch({ tenantId: "b1", tenantTradingEntityId: "e7" }, "tenant", { companyId: "b1", entityId: "e1" }), {}, "a company already set stays");
  assert.deepEqual(billingPatch("landlord", { entity: { id: "e5" }, contact: { ContactID: "x1", Name: "BRUCECAP LIMITED" } }),
    { landlordTradingEntityId: "e5", landlordEntityId: "x1", landlordEntityName: "BRUCECAP LIMITED" });
  assert.deepEqual(billingPatch("landlord", { entity: { id: "e5" }, contact: null }), { landlordTradingEntityId: "e5" });
});

test("the unit is the one the note names, else the property's only unit", () => {
  const units = [{ id: "u1", unitName: "Unit 4", propertyId: "p1" }, { id: "u2", unitName: "Ground floor", propertyId: "p1" }, { id: "u3", unitName: "Whole", propertyId: "p2" }];
  assert.equal(noteUnitId({ ...READ, place: { ...READ.place!, unit: { value: "unit 4", quote: "unit 4" } } }, "p1", units), "u1");
  assert.equal(noteUnitId(READ, "p1", units), null, "two units and none named");
  assert.equal(noteUnitId(READ, "p2", units), "u3");
});

test("the form's own rules, shared with the note: the property's landlord and team, the deal type's team, the deal name", () => {
  assert.deepEqual(propertyPickPatch({ dealType: "New Letting", team: [], landlordId: "" }, "p1", { landlordId: "L1", bgpEngagement: ["London Estate"] }, t => t === "London Estate"),
    { propertyId: "p1", team: ["London Estate"], landlordId: "L1" });
  assert.deepEqual(propertyPickPatch({ dealType: "Sale", team: ["Investment"], vendorId: "" }, "p1", { landlordId: "L1", bgpEngagement: ["London Estate"] }, () => true),
    { propertyId: "p1", vendorId: "L1" });
  assert.equal(teamForDealType("Purchase"), "Investment");
  assert.equal(teamForDealType("New Letting"), null);
  assert.equal(dealAutoName({ dealType: "New Letting", propertyId: "p1", tenantId: "b1" }, [{ id: "p1", name: "55 Wells Street" }], [{ id: "b1", name: "barrette estates" }]), "barrette estates – 55 Wells Street");
});

// Heads of terms on a sale or purchase (Woody, 20 November 2026: "I loaded up
// HOTs but it didnt add new vendor also it hasnt added the purchase price ...
// and should auto add team if its investment").
test("a name from a document finds its company by whole words, never part of a word", async () => {
  const { findCompanyByName } = await import("../client/src/lib/deal-note");
  const companies = [
    { id: "ee", name: "EE" },
    { id: "urc", name: "URC Thames North Trust" },
    { id: "urc2", name: "United Reformed Church (trustees)" },
    { id: "sandy", name: "Sandy Macaskill (private)" },
    { id: "fg", name: "Fortis Green Tennis Club Ltd" },
  ];
  // On live, "Fortis Green Tennis Club" was linked to EE: "fortis gr-ee-n" holds "ee".
  assert.equal(findCompanyByName("Fortis Green Tennis Club", companies.filter(c => c.id !== "fg")), null);
  assert.equal(findCompanyByName("FORTIS GREEN TENNIS CLUB", companies)?.id, "fg");
  assert.equal(findCompanyByName("Sandy Macaskill", companies)?.id, "sandy");
  assert.equal(findCompanyByName("The Trustees of United Reformed Church", companies)?.id, "urc2");
  assert.equal(findCompanyByName("URC Thames North Trust", companies)?.id, "urc");
  assert.equal(findCompanyByName("EE Limited", companies)?.id, "ee", "the same words, a legal ending aside");
  assert.equal(findCompanyByName("", companies), null);
  // Two companies the words fit: no guess.
  assert.equal(findCompanyByName("Green Tennis", [{ id: "a", name: "Green Tennis Club" }, { id: "b", name: "Green Tennis Centre" }]), null);
});

test("a sale's heads of terms fill the vendor, purchaser, price, fee and team", async () => {
  const { hotsParties, hotsPricePatch, isInvestmentDealType, teamPatch } = await import("../client/src/lib/deal-note");
  const reading = { dealType: "Purchase", vendorName: "URC Thames North Trust", purchaserName: "Sandy Macaskill", sittingTenant: "Fortis Green Tennis Club", tenantName: "Fortis Green Tennis Club", price: 510000, feePercentage: 1 };
  assert.deepEqual(hotsParties(reading, "Purchase"), [{ role: "vendor", name: "URC Thames North Trust" }, { role: "purchaser", name: "Sandy Macaskill" }]);
  // A reader that gave only a landlord gave the seller; the tenant of a sale is never the buyer.
  assert.deepEqual(hotsParties({ landlordName: "URC Thames North Trust", tenantName: "Fortis Green Tennis Club" }, "Sale"), [{ role: "vendor", name: "URC Thames North Trust" }]);
  assert.deepEqual(hotsParties(reading, "New Letting"), [{ role: "tenant", name: "Fortis Green Tennis Club" }]);
  assert.deepEqual(hotsPricePatch({ pricing: "", fee: "", feePercentage: "" }, reading), { pricing: "510000", feePercentage: "1", fee: "5100" });
  assert.deepEqual(hotsPricePatch({ pricing: "500000", fee: "", feePercentage: "" }, { price: "£510,000" }), {}, "a price already typed is kept");
  assert.ok(isInvestmentDealType("Sale") && isInvestmentDealType("Purchase") && !isInvestmentDealType("New Letting"));
  assert.deepEqual(teamPatch([], "Purchase"), ["Investment"]);
  assert.equal(teamPatch(["Investment"], "Sale"), null);
  assert.equal(teamPatch(["London Estate"], "New Letting"), null);
});
