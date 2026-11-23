// Super Brands (17 November 2026): BGP's own starred choice of expansion
// targets get the CRM's VIP treatment. Here: the Watch list holds a Super
// Brand before its strategy starts, owing one.
import "./test-database-url";
import test from "node:test";
import assert from "node:assert/strict";
import { watchList } from "./crm-watch-list";

test("a Super Brand with no strategy is on the Watch list, owing one; a strategy company is not told it", async () => {
  const q = {
    query: async (sql: string) => {
      if (/FROM crm_companies c\s+LEFT JOIN crm_strategy_targets t/.test(sql)) return { rows: [
        { id: "b1", name: "Gail's", noun: "brand", super_brand: true, strategies: [], strategy_ids: [] },
        { id: "b2", name: "Kricket", noun: "brand", super_brand: true, strategies: ["Neighbourhood dining"], strategy_ids: ["s2"] },
        { id: "l1", name: "Landlord Co", noun: "landlord", super_brand: false, strategies: ["Retail push"], strategy_ids: ["s1"] },
      ] };
      return { rows: [] };
    },
  };
  const rows = await watchList(q, new Date("2026-11-17T12:00:00Z"));
  const gails = rows.find(r => r.id === "b1")!;
  assert.equal(gails.superBrand, true);
  assert.equal(gails.owed[0], "No strategy yet");
  const kricket = rows.find(r => r.id === "b2")!;
  assert.equal(kricket.superBrand, true);
  assert.ok(!kricket.owed.includes("No strategy yet"));
  const landlord = rows.find(r => r.id === "l1")!;
  assert.equal(landlord.superBrand, undefined);
  assert.ok(!landlord.owed.includes("No strategy yet"));
});

// Woody, 2026-11-23: Jersey Mike's read "No contact on record" though BGP had
// been in touch with its people. Contact filed against a person, and the
// meetings BGP diaries hold, count; people on record are counted apart.
test("the watch list counts contact through a company's people and its diary meetings", async () => {
  const seen: string[] = [];
  const q = {
    query: async (sql: string) => {
      seen.push(sql);
      if (/FROM crm_companies c\s+LEFT JOIN crm_strategy_targets t/.test(sql)) return { rows: [
        { id: "jm", name: "Jersey Mike's", noun: "brand", super_brand: true, strategies: ["UK expansion"], strategy_ids: ["s1"] },
        { id: "cp", name: "Crisp Pizza", noun: "brand", super_brand: true, strategies: [], strategy_ids: [] },
        { id: "ll", name: "Quiet Landlord", noun: "landlord", super_brand: false, strategies: ["Retail"], strategy_ids: ["s2"] },
      ] };
      if (/FROM crm_interactions i JOIN crm_contacts p ON p\.id = i\.contact_id/.test(sql)) return { rows: [{ company_id: "jm", last_at: "2026-11-10T10:00:00Z", recent: 1 }] };
      if (/SELECT company_id, email FROM crm_contacts/.test(sql)) return { rows: [{ company_id: "jm", email: "a@jerseymikes.com" }, { company_id: "jm", email: "b@jerseymikes.com" }, { company_id: "ll", email: "c@ll.com" }] };
      return { rows: [] };
    },
  };
  const meetings = async () => [
    { companyId: "cp", subject: "Crisp Pizza x BGP", start: "2026-11-25T10:00:00.000Z", bgpParticipants: [] },
    { companyId: "jm", subject: "Jersey Mike's catch up", start: "2026-11-15T10:00:00.000Z", bgpParticipants: [] },
  ];
  const rows = await watchList(q, new Date("2026-11-23T12:00:00Z"), meetings);
  const jm = rows.find(r => r.id === "jm")!;
  assert.equal(jm.lastContactAt, "2026-11-15T10:00:00.000Z", "the later of an email to its people and a diary meeting");
  assert.equal(jm.peopleCount, 2);
  assert.ok(!jm.owed.some(line => /^No contact|No people/.test(line)), jm.owed.join(", "));
  const cp = rows.find(r => r.id === "cp")!;
  assert.equal(cp.nextMeetingAt, "2026-11-25T10:00:00.000Z");
  assert.ok(cp.owed.includes("No people on record"));
  assert.ok(!cp.owed.some(line => /^No contact/.test(line)), "a meeting booked ahead is contact in hand");
  const ll = rows.find(r => r.id === "ll")!;
  assert.ok(ll.owed.includes("No contact logged"));
  assert.ok(!ll.owed.includes("No people on record"));
  // The private mailbox is never read, here as on the CRM lists.
  assert.ok(seen.some(sql => /!~\* \$2/.test(sql) && /crm_interactions/.test(sql)));
});
