// Each deal party's company that signs and the person to ask (18 November
// 2026). Woody: "most importantly adding the billing entities so can AML.
// Also when doing that if the AML hasnt started need the ability to add in
// all the info so it can start such as email phone numbers etc". The rules
// are shared/deal-parties.ts; server/deal-parties.ts reads and writes.
import "./test-database-url";
import test from "node:test";
import assert from "node:assert/strict";
import {
  DEAL_PARTY_COLUMNS, DEAL_PARTY_FIELDS, DEAL_PARTY_ROLES, companyOffer, dealClientRole, invoiceContactFor, isDealPartyRole, newPartyPerson, ownerContactMatch, partyAmlFacts,
  partyAmlQuietWords, partyGaps, peopleToReach, personFill, registeredOwnerAmong, sameCompaniesHouseNumber,
  type DealPartyCompany,
} from "../shared/deal-parties";
import { personNamesMatch } from "../shared/kyc-prechecks";
import { PartyCompanyRefusal, checkPartyCompanies, findOrAddPartyPerson } from "./deal-parties";

type Call = { sql: string; params: unknown[] };
function fakeDb(answer: (sql: string, params: unknown[]) => any[] = () => []) {
  const calls: Call[] = [];
  return {
    calls,
    query: async (sql: string, params: unknown[] = []) => { calls.push({ sql, params }); return { rows: answer(sql, params) }; },
  };
}

test("every party's API field and column name the same thing", () => {
  const snake = (s: string) => s.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`);
  for (const role of DEAL_PARTY_ROLES) {
    for (const key of Object.keys(DEAL_PARTY_FIELDS[role]) as Array<keyof typeof DEAL_PARTY_FIELDS["landlord"]>) {
      assert.equal(snake(DEAL_PARTY_FIELDS[role][key]), DEAL_PARTY_COLUMNS[role][key], `${role} ${key}`);
    }
  }
  assert.ok(isDealPartyRole("tenant"));
  assert.ok(!isDealPartyRole("agent"));
  assert.ok(!isDealPartyRole("__proto__"));
});

test("what stops the checks starting: the contracting entity, a person, an email", () => {
  const person = { name: "Jane Smith", email: "jane@example.com" };
  // A company party always needs the company that signs set on the deal:
  // the brand's own Companies House record is never assumed (Woody,
  // 19 November 2026: "We must have the company taking the lease or who
  // owns the property to be able to do a check").
  assert.deepEqual(partyGaps({ role: "tenant", kind: "company", brandName: "The Dulwich Bakery", companySet: false, person }).map(g => g.key), ["company"]);
  assert.match(partyGaps({ role: "tenant", kind: "company", brandName: "The Dulwich Bakery", companySet: false, person })[0].words, /^The company taking the lease: the checks are about it, not The Dulwich Bakery/);
  assert.match(partyGaps({ role: "landlord", kind: "company", brandName: "Hammerson", companySet: false, person })[0].words, /^The company that owns the property/);
  assert.equal(partyGaps({ role: "purchaser", kind: "company", brandName: "X", companySet: false, person })[0].short, "company buying");
  assert.deepEqual(partyGaps({ role: "tenant", kind: "company", brandName: "X", companySet: true, person }), []);
  // A private individual has no company to pick.
  assert.deepEqual(partyGaps({ role: "tenant", kind: "individual", brandName: "J Bloggs", companySet: false, person }), []);
  // Nobody to ask, or nobody with an email.
  assert.deepEqual(partyGaps({ role: "tenant", kind: "company", brandName: "X", companySet: true, person: null }).map(g => g.key), ["person"]);
  const noEmail = partyGaps({ role: "tenant", kind: "company", brandName: "X", companySet: true, person: { name: "Sam", email: " " } });
  assert.deepEqual(noEmail.map(g => g.key), ["email"]);
  assert.match(noEmail[0].words, /Sam/);
  // In the order to fill them, each with a few words for a narrow column.
  const both = partyGaps({ role: "landlord", kind: "company", brandName: "X", companySet: false, person: null });
  assert.deepEqual(both.map(g => g.key), ["company", "person"]);
  assert.deepEqual(both.map(g => g.short), ["company that owns the property", "who to ask"]);
  assert.equal(noEmail[0].short, "their email");
});

test("the company offered first: the one on the lease, the main one, the only one", () => {
  const a: DealPartyCompany = { id: "a", name: "A Ltd", companiesHouseNumber: "01", isDefault: false };
  const b: DealPartyCompany = { id: "b", name: "B Ltd", companiesHouseNumber: "02", isDefault: true };
  assert.equal(companyOffer([a, b], "a")?.why, "lease");
  assert.equal(companyOffer([a, b], "a")?.id, "a");
  assert.equal(companyOffer([a, b], null)?.id, "b");
  assert.equal(companyOffer([a, b], null)?.why, "default");
  assert.equal(companyOffer([a], null)?.why, "only");
  // A lease company not filed under the brand is never offered.
  assert.equal(companyOffer([a], "elsewhere")?.why, "only");
  assert.equal(companyOffer([a, { ...b, isDefault: false }], null), null);
  assert.equal(companyOffer([], "a"), null);
});

test("a landlord's or seller's offer: the building's registered owner at Land Registry comes before the main company", () => {
  const spv: DealPartyCompany = { id: "spv", name: "AG Millennium Propco Limited", companiesHouseNumber: "12345678", isDefault: false };
  const main: DealPartyCompany = { id: "main", name: "Angelo, Gordon Europe LLP", companiesHouseNumber: "OC361085", isDefault: true };
  // By number, Land Registry's number tidied either way.
  assert.equal(companyOffer([main, spv], null, { name: "AG MILLENNIUM PROPCO LTD", number: "12345678", titleNumber: "NGL1" })?.why, "land_registry");
  assert.equal(companyOffer([main, spv], null, { name: "AG MILLENNIUM PROPCO LTD", number: "12345678", titleNumber: "NGL1" })?.id, "spv");
  // By the registered name when Land Registry gives no number (a company abroad).
  assert.equal(companyOffer([main, { ...spv, companiesHouseNumber: null }], null, { name: "AG MILLENNIUM PROPCO LIMITED", number: null, titleNumber: null })?.id, "spv");
  // A different number is another company: the main one is offered as before.
  assert.equal(companyOffer([main, spv], null, { name: "AG Millennium Propco Limited", number: "87654321", titleNumber: null })?.why, "default");
  // The lease still comes first; a person who signs is never the registered owner.
  assert.equal(companyOffer([main, spv], "main", { name: "AG Millennium Propco Limited", number: "12345678", titleNumber: null })?.why, "lease");
  assert.equal(registeredOwnerAmong([{ ...spv, kind: "individual" }], { name: "AG Millennium Propco Limited", number: null, titleNumber: null }), undefined);
});

test("a person typed on the deal: a name and an email or mobile that look right", () => {
  assert.deepEqual(newPartyPerson({ name: "  Jane  Smith ", email: " Jane@Example.COM ", mobile: "", jobTitle: "Director" }),
    { person: { name: "Jane Smith", email: "jane@example.com", mobile: null, jobTitle: "Director" } });
  assert.deepEqual(newPartyPerson({ name: "Sam", mobile: "+44 7700 900123" }), { person: { name: "Sam", email: null, mobile: "+44 7700 900123", jobTitle: null } });
  assert.ok("problem" in newPartyPerson({ email: "a@b.co" }));
  assert.ok("problem" in newPartyPerson({ name: "Sam" }));
  assert.ok("problem" in newPartyPerson({ name: "Sam", email: "not an email" }));
  assert.ok("problem" in newPartyPerson({ name: "Sam", mobile: "call me" }));
  assert.ok("problem" in newPartyPerson(null));
  assert.ok("problem" in newPartyPerson([]));
});

test("a person already on the CRM gains only blank fields", () => {
  const typed = { name: "Jane", email: "jane@x.com", mobile: "07700900123", jobTitle: "CFO" };
  assert.deepEqual(personFill({ email: "jane@x.com", phone_mobile: null, role: "" }, typed), { phone_mobile: "07700900123", role: "CFO" });
  assert.deepEqual(personFill({ email: "jane@x.com", phone_mobile: "0207", role: "Director" }, typed), {});
  assert.ok(sameCompaniesHouseNumber("1057547", "01057547"));
  assert.ok(sameCompaniesHouseNumber("sc123456", "SC123456"));
  assert.ok(!sameCompaniesHouseNumber("", ""));
  assert.ok(!sameCompaniesHouseNumber("01057547", "01057548"));
});

const ENTITIES = [
  { id: "e-pret", parent_company_id: "pret", name: "Pret A Manger (Europe) Limited" },
  { id: "e-other", parent_company_id: "other-brand", name: "Someone Else Ltd" },
];
const entityDb = () => fakeDb((sql, params) => sql.includes("FROM crm_trading_entities") ? ENTITIES.filter(e => (params[0] as string[]).includes(e.id)) : []);

test("a deal save keeps the contracting entity under its party", async () => {
  // Filed under the tenant: kept.
  assert.deepEqual(await checkPartyCompanies(entityDb(), { tenantId: "pret", tenantTradingEntityId: "e-pret" }, { tenantTradingEntityId: "e-pret" }), {});
  // Sent for the tenant but filed under another brand: refused, naming it.
  await assert.rejects(
    checkPartyCompanies(entityDb(), { tenantId: "pret", tenantTradingEntityId: "e-other" }, { tenantTradingEntityId: "e-other" }),
    (e: any) => e instanceof PartyCompanyRefusal && e.status === 400 && /Someone Else Ltd is not filed under the tenant/.test(e.message));
  // Sent, but no such company.
  await assert.rejects(checkPartyCompanies(entityDb(), { tenantId: "pret", tenantTradingEntityId: "gone" }, { tenantTradingEntityId: "gone" }), PartyCompanyRefusal);
  // Sent with no party set.
  await assert.rejects(checkPartyCompanies(entityDb(), { tenantTradingEntityId: "e-pret" }, { tenantTradingEntityId: "e-pret" }), PartyCompanyRefusal);
  // Carried from before, and the tenant changed: cleared, not refused.
  assert.deepEqual(await checkPartyCompanies(entityDb(), { tenantId: "other-brand-2", tenantTradingEntityId: "e-pret" }, { tenantId: "other-brand-2" }), { tenantTradingEntityId: null });
  // Nothing set: nothing read.
  const db = entityDb();
  assert.deepEqual(await checkPartyCompanies(db, { tenantId: "pret", landlordId: "l" }, { tenantId: "pret" }), {});
  assert.equal(db.calls.length, 0);
});

test("a person typed for a party is found by email under the brand, else added", async () => {
  // Already there with that email: blank fields filled, nothing overwritten.
  const held = fakeDb(sql => {
    if (sql.includes("FROM crm_companies")) return [{ id: "pret", name: "Pret" }];
    if (sql.includes("FROM crm_contacts WHERE company_id")) return [{ id: "c1", email: "jane@pret.com", phone_mobile: null, role: "Head of Property" }];
    return [];
  });
  assert.deepEqual(await findOrAddPartyPerson(held, "pret", { name: "Jane", email: "jane@pret.com", mobile: "07700900123", jobTitle: "CFO" }, "note"), { id: "c1", created: false });
  const update = held.calls.find(c => c.sql.startsWith("UPDATE crm_contacts"))!;
  assert.match(update.sql, /phone_mobile = \$2/);
  assert.doesNotMatch(update.sql, /role =|email =|company_id/);
  assert.deepEqual(update.params, ["c1", "07700900123"]);
  // The email search is the brand's own people only.
  assert.deepEqual(held.calls.find(c => c.sql.includes("FROM crm_contacts WHERE company_id"))!.params, ["pret", "jane@pret.com"]);

  // Not there: a new contact under the brand, with the note.
  const fresh = fakeDb(sql => {
    if (sql.includes("FROM crm_companies")) return [{ id: "pret", name: "Pret" }];
    if (sql.startsWith("INSERT INTO crm_contacts")) return [{ id: "new-1" }];
    return [];
  });
  assert.deepEqual(await findOrAddPartyPerson(fresh, "pret", { name: "Sam", email: "sam@pret.com", mobile: null, jobTitle: null }, "Added for the checks"), { id: "new-1", created: true });
  const insert = fresh.calls.find(c => c.sql.startsWith("INSERT INTO crm_contacts"))!;
  assert.deepEqual(insert.params, ["Sam", "sam@pret.com", null, null, "pret", "Pret", "Added for the checks"]);

  // No email: never matched to someone, always a new contact.
  const mobileOnly = fakeDb(sql => {
    if (sql.includes("FROM crm_companies")) return [{ id: "pret", name: "Pret" }];
    if (sql.startsWith("INSERT INTO crm_contacts")) return [{ id: "new-2" }];
    return [];
  });
  await findOrAddPartyPerson(mobileOnly, "pret", { name: "Sam", email: null, mobile: "07700900123", jobTitle: null }, "n");
  assert.ok(!mobileOnly.calls.some(c => c.sql.includes("lower(email)")));

  // An unknown brand is refused.
  await assert.rejects(findOrAddPartyPerson(fakeDb(), "nope", { name: "Sam", email: "s@x.com", mobile: null, jobTitle: null }, "n"), PartyCompanyRefusal);
});

// Woody, 20 November 2026: "here where it says who to ask it should really
// say these owners need to AML and prompt for contact details at that stage".
test("an owner's details go on the contact that is them: by email, else by name", () => {
  const contacts = [
    { id: "c1", name: "Jane Smith", email: null },
    { id: "c2", name: "Jane Anne Smith", email: "jane@acme.co.uk" },
    { id: "c3", name: "Jane", email: "jane.other@acme.co.uk" },
    { id: "c4", name: "Robert Brown", email: "rob@acme.co.uk" },
  ];
  // The register's spelling ("SMITH, Jane Anne") finds the person under any of theirs, one with an email first.
  assert.equal(ownerContactMatch("SMITH, Jane Anne", null, contacts, personNamesMatch)?.id, "c2");
  // An email typed finds whoever holds it, whatever the name says.
  assert.equal(ownerContactMatch("SMITH, Jane Anne", "Rob@Acme.co.uk", contacts, personNamesMatch)?.id, "c4");
  // An email nobody holds falls back to the name.
  assert.equal(ownerContactMatch("SMITH, Jane Anne", "new@acme.co.uk", contacts, personNamesMatch)?.id, "c2");
  // A first name alone is not them; nobody of that name means a new contact.
  assert.equal(ownerContactMatch("JONES, Jane", null, contacts, personNamesMatch), null);
  assert.equal(ownerContactMatch("SMITH, Jane", null, [{ id: "x", name: "Jane", email: "j@x.com" }], personNamesMatch), null);
});

test("the people still to reach: something owed, no link of their own, no email or mobile held", () => {
  const person = (name: string, outstanding: string[], own: unknown = null) => ({ name, outstanding, own });
  const contacts = [
    { id: "a", name: "Huseyn Mirhadiyev", email: "h@x.az", mobile: null, jobTitle: null },
    { id: "b", name: "David Bruce", email: null, mobile: null, jobTitle: null },
    { id: "c", name: "Mary Lee", email: null, mobile: "07700900123", jobTitle: null },
  ];
  const people = [
    person("MIRHADIYEV, Huseyn", ["identity check", "proof of address"]),   // email held
    person("BRUCE, David", ["identity check"]),                              // contact with nothing on it
    person("LEE, Mary", ["proof of address"]),                               // a mobile is enough
    person("KHAN, Omar", ["identity check"]),                                // nobody in the CRM
    person("PATEL, Asha", ["identity check"], { token: "t", ref: "7MJEGT" }), // has their own link
    person("GREEN, Tom", []),                                                 // nothing owed
  ];
  assert.deepEqual(peopleToReach(people, contacts, personNamesMatch).map(p => p.name), ["BRUCE, David", "KHAN, Omar"]);
  assert.deepEqual(peopleToReach([], contacts, personNamesMatch), []);
});

test("a party approved, Not required, or on a letting under £10,000 a month asks nobody for details", () => {
  const status = {
    regime: { regime: "full" },
    counterparties: [
      { id: "ll", isApproved: true, isExpired: false },
      { id: "tt", isApproved: false, isExpired: false },
      { id: "old", isApproved: true, isExpired: true },
      { id: "nr", isApproved: false, isExpired: false, notRequired: { reasonWords: "Joint agent's client" } },
    ],
  };
  assert.deepEqual(partyAmlFacts(status, "ll"), { done: "approved", sanctionsOnly: false });
  assert.deepEqual(partyAmlFacts(status, "tt"), { done: null, sanctionsOnly: false });
  assert.deepEqual(partyAmlFacts(status, "old"), { done: null, sanctionsOnly: false });
  assert.deepEqual(partyAmlFacts(status, "nr"), { done: "not_required", sanctionsOnly: false });
  assert.deepEqual(partyAmlFacts({ ...status, regime: { regime: "sanctions_only" } }, "tt"), { done: null, sanctionsOnly: true });
  // Not read yet: nothing is known, so nothing is drawn.
  assert.equal(partyAmlFacts(undefined, "tt"), null);
  assert.equal(partyAmlFacts(status, null), null);

  assert.match(partyAmlQuietWords({ done: "approved", sanctionsOnly: false })!, /^Approved/);
  assert.match(partyAmlQuietWords({ done: "not_required", sanctionsOnly: true })!, /Not required/);
  assert.match(partyAmlQuietWords({ done: null, sanctionsOnly: true })!, /£10,000 a month/);
  assert.equal(partyAmlQuietWords({ done: null, sanctionsOnly: false }), null);
  assert.equal(partyAmlQuietWords(null), null);
});

// Woody, 20 November 2026: "this xero invoicing is not autolinked to the AML
// deal process thats happening it should be".
test("BGP's client, the party it invoices: one rule for the Deals table and the invoice", () => {
  assert.equal(dealClientRole({ dealType: "Sale" }), "vendor");
  assert.equal(dealClientRole({ dealType: "Purchase", bgpActingFor: "tenant" }), "purchaser");
  assert.equal(dealClientRole({ dealType: "Lease Acquisition" }), "tenant");
  assert.equal(dealClientRole({ dealType: "Lease Disposal" }), "tenant");
  assert.equal(dealClientRole({ dealType: "New Letting", bgpActingFor: "tenant" }), "tenant");
  assert.equal(dealClientRole({ dealType: "New Letting", team: ["Tenant Rep"] }), "tenant");
  assert.equal(dealClientRole({ dealType: "New Letting", team: "London Estate, tenant rep" }), "tenant");
  assert.equal(dealClientRole({ dealType: "New Letting", bgpActingFor: "landlord" }), "landlord");
  assert.equal(dealClientRole({}), "landlord");
});

test("the invoice goes to the deal's own contact, else the client's billing entity, never a made-up name", () => {
  // Deal #4507 as it was: the landlord's billing entity set under Parties, no invoice contact on the deal.
  const wells = { name: "55 Wells Street", dealType: "New Letting", bgpActingFor: "landlord", landlordId: "brucecap",
    landlordEntityId: "x-pave", landlordEntityName: "Bruce Cap Ltd t/a Pave", tenantEntityId: "x-bgp", tenantEntityName: "BRUCE GILLINGHAM POLLARD LIMITED" };
  assert.deepEqual(invoiceContactFor(wells), {
    role: "landlord", contactId: "x-pave", name: "Bruce Cap Ltd t/a Pave", source: "party",
    party: { contactId: "x-pave", name: "Bruce Cap Ltd t/a Pave" }, partyLinked: true,
  });
  // BGP acting for the tenant bills the tenant's billing entity.
  assert.equal(invoiceContactFor({ ...wells, bgpActingFor: "tenant", tenantId: "bgp" }).name, "BRUCE GILLINGHAM POLLARD LIMITED");
  // A contact set on the deal on purpose wins (a fund's partnership, a scheme's billing company), and the party's is still named.
  const own = invoiceContactFor({ ...wells, xeroContactId: "x-bcp", xeroContactName: "Brent Cross Partnership Ltd" });
  assert.equal(own.source, "deal");
  assert.equal(own.contactId, "x-bcp");
  assert.deepEqual(own.party, { contactId: "x-pave", name: "Bruce Cap Ltd t/a Pave" });
  // A scheme's billing entity held by name alone.
  assert.deepEqual(invoiceContactFor({ dealType: "New Letting", xeroContactName: "Canary Wharf Retail Limited" }),
    { role: "landlord", contactId: null, name: "Canary Wharf Retail Limited", source: "deal", party: null, partyLinked: false });
  // Nothing set: nobody, never the deal's name or the tenant's.
  const none = invoiceContactFor({ name: "55 Wells Street", dealType: "New Letting", landlordId: "brucecap", tenantId: "pret" });
  assert.deepEqual(none, { role: "landlord", contactId: null, name: null, source: null, party: null, partyLinked: true });
  // Another party's billing entity is not BGP's client's.
  assert.equal(invoiceContactFor({ dealType: "New Letting", tenantEntityId: "t", tenantEntityName: "Tenant Ltd" }).name, null);
});

// A person as the contracting entity (Woody, 20 November 2026: "need ability
// to create billing entity or contracting entity as a person we will then KYC
// them").
test("a person who signs makes the party a private individual for the checks", async () => {
  const { partySubjectKind, signerKindOf, partyGaps } = await import("../shared/deal-parties");
  assert.equal(signerKindOf("individual"), "individual");
  assert.equal(signerKindOf(null), "company");
  assert.equal(partySubjectKind(null, { kind: "individual" }), "individual", "a person signs for a company record");
  assert.equal(partySubjectKind("individual", { kind: null }), "company", "a company signs for a record kept as a person");
  assert.equal(partySubjectKind("individual", null), "individual");
  assert.equal(partySubjectKind(null, null), "company");
  // A person who signs needs no company: only someone to ask, with an email.
  assert.deepEqual(partyGaps({ role: "purchaser", kind: "individual", brandName: "Sandy Macaskill (private)", companySet: true, person: { name: "Sandy Macaskill", email: "sandy@example.com" } }), []);
});

test("a CRM name marked private suggests a private individual; nothing else does", async () => {
  const { privateMarkInName, OWN_NAME_WORDS } = await import("../shared/deal-parties");
  // The investment import's names (20 November 2026: Sandy Macaskill (private)
  // was asked for "the company buying" on the Fortis Green purchase).
  for (const name of ["Sandy Macaskill (private)", "Chan family (private client)", "J Smith (Private Individual)", "A Buyer ( private )", "Jo Bloggs (individual)"]) {
    assert.equal(privateMarkInName(name), true, name);
  }
  for (const name of ["Mayfairprivateoffice", "Private Hong Kong family (Jack Barratt client)", "URC Thames North Trust", "Private Equity Partners Ltd", "", null]) {
    assert.equal(privateMarkInName(name), false, String(name));
  }
  assert.equal(OWN_NAME_WORDS.purchaser, "are buying in their own name");
});

test("on a sale or purchase, who BGP acts for can be chosen (Woody, 25 November 2026)", () => {
  assert.equal(dealClientRole({ dealType: "Sale" }), "vendor");
  assert.equal(dealClientRole({ dealType: "Sale", bgpActingFor: "landlord" }), "vendor");
  assert.equal(dealClientRole({ dealType: "Sale", bgpActingFor: "purchaser" }), "purchaser");
  assert.equal(dealClientRole({ dealType: "Purchase", bgp_acting_for: "vendor" }), "vendor");
  assert.equal(dealClientRole({ dealType: "New Letting", bgpActingFor: "purchaser" }), "landlord");
});

test("who to ask has a relationship, and an agent may be at another firm", async () => {
  const { ASK_RELATIONS, askIsAgent, isAskRelation, ASK_RELATION_EMAIL } = await import("../shared/deal-parties");
  assert.deepEqual([...ASK_RELATIONS], ["party", "manager", "own_agent", "joint_agent"]);
  assert.ok(askIsAgent("joint_agent") && askIsAgent("own_agent") && !askIsAgent("party") && !askIsAgent("manager"));
  assert.ok(!isAskRelation("friend"));
  assert.match(ASK_RELATION_EMAIL.joint_agent, /not the client checks/);
});
