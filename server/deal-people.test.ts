// Everyone on a transaction (Woody, 24 November 2026, on #4664: "add up there
// all the other contacts on the deal with email and phone number? should be
// client/s and the details of the other side plus advisors agents and
// solicitors and ability to add a contact to the deal"). Rules:
// shared/deal-people.ts; reads: server/deal-people.ts.
import "./test-database-url";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cleanPhone, groupForLinked, isUkMobile, mergePeople, newDealContact, personPhones, type DealPerson,
} from "../shared/deal-people";
import { loadDealPeople, parseSolicitorContact } from "./deal-people";

test("a phone is digits, never an email typed in the wrong box; mobile first, each once", () => {
  assert.equal(cleanPhone("+44 7810203606"), "+44 7810203606");
  assert.equal(cleanPhone("kenneth@gmail.com"), null);
  assert.equal(cleanPhone("ext 12"), null);
  assert.deepEqual(personPhones({ phone: "020 7123 4567", phone_mobile: "07810 203606" }), ["07810 203606", "020 7123 4567"]);
  assert.deepEqual(personPhones({ phone: "07810203606", phone_mobile: "07810 203 606" }), ["07810 203 606"]);
  assert.ok(isUkMobile("07810 203606"));
  assert.ok(isUkMobile("+44 7810 203606"));
  assert.ok(!isUkMobile("020 7123 4567"));
});

test("a contact linked with no group sits by the party it is filed under, else its firm's kind", () => {
  const base = { companyId: null as string | null, companyType: null as string | null, clientBrandId: "L", otherBrandIds: ["T"] };
  assert.equal(groupForLinked({ ...base, chosen: "advisers", companyId: "L" }), "advisers");
  assert.equal(groupForLinked({ ...base, companyId: "L" }), "client");
  assert.equal(groupForLinked({ ...base, companyId: "T" }), "other_side");
  assert.equal(groupForLinked({ ...base, companyId: "X", companyType: "Solicitor" }), "solicitors");
  assert.equal(groupForLinked({ ...base, companyId: "X", companyType: "Agent" }), "agents");
  assert.equal(groupForLinked({ ...base, companyId: "X", companyType: "Landlord" }), "advisers");
});

test("one entry per person: every role kept, the first group wins, a firm line goes once someone there is named", () => {
  const p = (over: Partial<DealPerson>): DealPerson => ({
    key: "contact:1", contactId: "1", name: "Kenneth Tam", company: null, companyId: "tam", jobTitle: null, email: null, phones: [],
    detailsFrom: null, group: "advisers", roles: [], linked: false, noPerson: false, ...over,
  });
  const merged = mergePeople([
    p({ roles: ["Adviser"], linked: true, email: "k@tam.com" }),
    p({ roles: ["Who to ask (landlord)"], group: "client", phones: ["07810 203606"] }),
    p({ key: "firm:f", contactId: null, name: "Savills", companyId: "savills", group: "agents", roles: ["The tenant's agent"], noPerson: true }),
    p({ key: "contact:2", contactId: "2", name: "Ann Agent", companyId: "savills", group: "agents", roles: ["The tenant's agent"] }),
  ]);
  assert.equal(merged.length, 2);
  assert.deepEqual(merged[0].roles, ["Adviser", "Who to ask (landlord)"]);
  assert.equal(merged[0].group, "client");
  assert.equal(merged[0].linked, true);
  assert.equal(merged[0].email, "k@tam.com");
  assert.deepEqual(merged[0].phones, ["07810 203606"]);
  assert.equal(merged[1].name, "Ann Agent");
});

test("Add a contact needs a name, an email or a phone that look right, and who they are", () => {
  assert.deepEqual(newDealContact({ name: "Ann", email: "ann@firm.com", group: "solicitors" }), { contact: { name: "Ann", email: "ann@firm.com", phone: null, company: null, jobTitle: null, label: null, group: "solicitors" } });
  assert.equal((newDealContact({ name: "Ann", email: "ann@firm.com" }) as any).problem, "Say who they are on the transaction.");
  assert.equal((newDealContact({ name: "", phone: "07810 203606", group: "client" }) as any).problem, "Give their name.");
  assert.equal((newDealContact({ name: "Ann", group: "client" }) as any).problem, "Give their email or phone.");
  assert.equal((newDealContact({ name: "Ann", email: "not an email", group: "client" }) as any).problem, "That email address does not look right.");
});

test("our client's solicitor as the heads of terms save it: name, email and phone", () => {
  assert.deepEqual(parseSolicitorContact("Jane Smith · jane@forsters.com · 020 7863 8333"), { name: "Jane Smith", email: "jane@forsters.com", phone: "020 7863 8333" });
  assert.deepEqual(parseSolicitorContact("jane@forsters.com"), { name: null, email: "jane@forsters.com", phone: null });
  assert.deepEqual(parseSolicitorContact(null), { name: null, email: null, phone: null });
});

// A stand-in database: each read the feed makes, answered from fixed rows.
function fakeDb(rows: { deal: any; links?: any[]; contacts?: any[]; companies?: any[]; checks?: any[] }) {
  const contacts = rows.contacts || [];
  return {
    async query(sql: string, params: any[] = []) {
      if (/FROM crm_deals WHERE id = \$1/.test(sql)) return { rows: rows.deal && rows.deal.id === params[0] ? [rows.deal] : [] };
      if (/FROM crm_contact_deals WHERE deal_id/.test(sql)) return { rows: rows.links || [] };
      if (/FROM crm_contacts c LEFT JOIN crm_companies co ON co.id = c.company_id WHERE c.id = ANY/.test(sql)) return { rows: contacts.filter(c => params[0].includes(c.id)) };
      if (/WHERE lower\(c.email\) = \$1/.test(sql)) return { rows: contacts.filter(c => (c.email || "").toLowerCase() === params[0]).slice(0, 1) };
      if (/FROM crm_companies WHERE id = ANY/.test(sql)) return { rows: (rows.companies || []).filter(c => params[0].includes(c.id)) };
      if (/FROM kyc_solicitor_checks/.test(sql)) return { rows: rows.checks || [] };
      throw new Error(`Unexpected query: ${sql.slice(0, 80)}`);
    },
  };
}

const dealRow = (over: Record<string, unknown> = {}) => ({
  id: "d1", name: "Vodafone", deal_type: "Lease Renewal", team: ["Lease Advisory"], bgp_acting_for: "landlord",
  client_contact_id: null, solicitor_firm: null, solicitor_contact: null,
  landlord_id: "tam", landlord_contact_id: "k", tenant_id: "voda", tenant_contact_id: null, vendor_id: null, vendor_contact_id: null, purchaser_id: null, purchaser_contact_id: null,
  joint_agent_id: null, joint_agent_contact_id: null, leasing_agent_id: null, leasing_agent_contact_id: null,
  acquisition_agent_id: null, acquisition_agent_contact_id: null, vendor_agent_id: null, vendor_agent_contact_id: null, purchaser_agent_id: null, purchaser_agent_contact_id: null,
  ...over,
});

test("#4664: Kenneth Tam is who to ask for our client; Vodafone has nobody named yet", async () => {
  const view = (await loadDealPeople(fakeDb({
    deal: dealRow(),
    contacts: [{ id: "k", name: "Kenneth Tam", email: "kennethmktam@gmail.com", phone: null, phone_mobile: "+44 7810203606", role: "Family office", company_id: "tamfam", company_name: "tam family", co_name: "tam family", company_type: null }],
    companies: [{ id: "tam", name: "Joint Holdings", company_type: "Landlord", phone: null }, { id: "voda", name: "Vodafone", company_type: "Tenant", phone: null }],
  }), "d1"))!;
  assert.equal(view.clientRole, "landlord");
  assert.deepEqual(view.parties, [{ role: "landlord", name: "Joint Holdings", client: true }, { role: "tenant", name: "Vodafone", client: false }]);
  const kenneth = view.people.find(p => p.contactId === "k")!;
  assert.equal(kenneth.group, "client");
  assert.deepEqual(kenneth.roles, ["Who to ask (landlord)"]);
  assert.equal(kenneth.email, "kennethmktam@gmail.com");
  assert.deepEqual(kenneth.phones, ["+44 7810203606"]);
  // The landlord is named through Kenneth, so it has no "nobody named" line, even though he is filed under his family office.
  assert.ok(!view.people.some(p => p.key === "party:landlord"));
  const voda = view.people.find(p => p.key === "party:tenant")!;
  assert.equal(voda.group, "other_side");
  assert.equal(voda.noPerson, true);
});

test("agents, both sides' solicitors and a contact added on the card", async () => {
  const view = (await loadDealPeople(fakeDb({
    deal: dealRow({
      acquisition_agent_id: "savills", leasing_agent_id: "kf", leasing_agent_contact_id: "ann",
      solicitor_firm: "Forsters LLP", solicitor_contact: "Jane Smith · jane@forsters.com",
    }),
    links: [{ contact_id: "am", deal_group: "client", deal_label: "Asset manager" }, { contact_id: "pm", deal_group: null, deal_label: null }],
    contacts: [
      { id: "k", name: "Kenneth Tam", email: "k@tam.com", phone: null, phone_mobile: null, role: null, company_id: "tam", company_name: null, co_name: "Joint Holdings", company_type: "Landlord" },
      { id: "ann", name: "Ann Agent", email: "ann@kf.com", phone: "020 7629 8171", phone_mobile: null, role: "Partner", company_id: "kf", company_name: null, co_name: "Knight Frank", company_type: "Agent" },
      { id: "am", name: "Sam Manager", email: "sam@am.com", phone: null, phone_mobile: null, role: null, company_id: "am-co", company_name: null, co_name: "Asset Co", company_type: "Investor" },
      { id: "pm", name: "Paula Pinsent", email: "paula@pinsentmasons.com", phone: null, phone_mobile: null, role: null, company_id: "pm-co", company_name: null, co_name: "Pinsent Masons LLP", company_type: "Solicitor" },
    ],
    companies: [
      { id: "tam", name: "Joint Holdings", company_type: "Landlord", phone: null }, { id: "voda", name: "Vodafone", company_type: "Tenant", phone: null },
      { id: "savills", name: "Savills", company_type: "Agent", phone: "020 7499 8644" }, { id: "kf", name: "Knight Frank", company_type: "Agent", phone: null },
    ],
    checks: [
      { firm: "Pinsent Masons", result: { firm: "Pinsent Masons", side: "other", ranAt: "2026-11-24T10:00:00Z", register: { sra: { name: "Pinsent Masons LLP", headOffice: { phone: "020 7418 7000", email: "enquiries@pinsentmasons.com" } } } } },
      { firm: "Eversheds", result: { firm: "Eversheds", side: "other", ranAt: "2026-11-24T10:00:00Z", register: { sra: { name: "Eversheds Sutherland (International) LLP", headOffice: { phone: "020 7497 9797", email: null } } } } },
    ],
  }), "d1"))!;
  const by = (name: string) => view.people.find(p => p.name === name)!;
  // The landlord's agent is a named person; the tenant's agent is a firm with its own number.
  assert.deepEqual(by("Ann Agent").roles, ["The landlord's agent"]);
  assert.equal(by("Ann Agent").group, "agents");
  assert.equal(by("Savills").noPerson, true);
  assert.deepEqual(by("Savills").phones, ["020 7499 8644"]);
  assert.equal(by("Savills").detailsFrom, "firm");
  // Our client's solicitor typed on the transaction, not in the CRM.
  const jane = by("Jane Smith");
  assert.equal(jane.group, "solicitors");
  assert.equal(jane.company, "Forsters LLP");
  assert.equal(jane.email, "jane@forsters.com");
  assert.deepEqual(jane.roles, ["Our client's solicitors"]);
  // Someone at a firm checked at the SRA carries the side; the firm line goes.
  assert.deepEqual(by("Paula Pinsent").roles, ["The other side's solicitors"]);
  assert.equal(by("Paula Pinsent").group, "solicitors");
  assert.ok(!view.people.some(p => p.name === "Pinsent Masons LLP"));
  // A firm checked with nobody named: the SRA's head office.
  const ev = by("Eversheds Sutherland (International) LLP");
  assert.equal(ev.detailsFrom, "sra");
  assert.deepEqual(ev.phones, ["020 7497 9797"]);
  // Added on the card, with the role typed.
  assert.deepEqual(by("Sam Manager").roles, ["Asset manager"]);
  assert.equal(by("Sam Manager").group, "client");
  assert.equal(by("Sam Manager").linked, true);
  // The groups come in order.
  const order = view.people.map(p => p.group);
  assert.deepEqual(order, [...order].sort((a, b) => ["client", "other_side", "agents", "solicitors", "advisers"].indexOf(a) - ["client", "other_side", "agents", "solicitors", "advisers"].indexOf(b)));
});

test("a transaction that is not there reads as nothing", async () => {
  assert.equal(await loadDealPeople(fakeDb({ deal: null }), "missing"), null);
});
