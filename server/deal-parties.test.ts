// Each deal party's company that signs and the person to ask (18 November
// 2026). Woody: "most importantly adding the billing entities so can AML.
// Also when doing that if the AML hasnt started need the ability to add in
// all the info so it can start such as email phone numbers etc". The rules
// are shared/deal-parties.ts; server/deal-parties.ts reads and writes.
import "./test-database-url";
import test from "node:test";
import assert from "node:assert/strict";
import {
  DEAL_PARTY_COLUMNS, DEAL_PARTY_FIELDS, DEAL_PARTY_ROLES, companyOffer, isDealPartyRole, newPartyPerson, partyGaps, personFill, sameCompaniesHouseNumber,
  type DealPartyCompany,
} from "../shared/deal-parties";
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

test("what stops the checks starting: a company they can read, a person, an email", () => {
  const person = { name: "Jane Smith", email: "jane@example.com" };
  // A brand with no Companies House record needs the company that signs.
  assert.deepEqual(partyGaps({ kind: "company", brandName: "The Dulwich Bakery", brandHasNumber: false, companySet: false, person }).map(g => g.key), ["company"]);
  assert.match(partyGaps({ kind: "company", brandName: "The Dulwich Bakery", brandHasNumber: false, companySet: false, person })[0].words, /The Dulwich Bakery/);
  // The brand's own record is enough until a company is set; a set company is enough.
  assert.deepEqual(partyGaps({ kind: "company", brandName: "Pret", brandHasNumber: true, companySet: false, person }), []);
  assert.deepEqual(partyGaps({ kind: "company", brandName: "X", brandHasNumber: false, companySet: true, person }), []);
  // A private individual has no company to pick.
  assert.deepEqual(partyGaps({ kind: "individual", brandName: "J Bloggs", brandHasNumber: false, companySet: false, person }), []);
  // Nobody to ask, or nobody with an email.
  assert.deepEqual(partyGaps({ kind: "company", brandName: "X", brandHasNumber: true, companySet: false, person: null }).map(g => g.key), ["person"]);
  const noEmail = partyGaps({ kind: "company", brandName: "X", brandHasNumber: true, companySet: false, person: { name: "Sam", email: " " } });
  assert.deepEqual(noEmail.map(g => g.key), ["email"]);
  assert.match(noEmail[0].words, /Sam/);
  // In the order to fill them, each with a few words for a narrow column.
  const both = partyGaps({ kind: "company", brandName: "X", brandHasNumber: false, companySet: false, person: null });
  assert.deepEqual(both.map(g => g.key), ["company", "person"]);
  assert.deepEqual(both.map(g => g.short), ["the company that signs", "who to ask"]);
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

test("a deal save keeps the company that signs under its party", async () => {
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
