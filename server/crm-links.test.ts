// The CRM page, 23 November 2026: what a company is linked to, Select and
// Delete on the lists, and the action form picking the company's strategy.
import "./test-database-url";
import test from "node:test";
import assert from "node:assert/strict";
import { companyLinks } from "./crm-company-links";
import { crmBulkDeletePlan } from "./brand-relevance";
import { strategyForCompany } from "../client/src/components/crm-engagement/dialogs";

test("links: a landlord's buildings, a brand's BGP lettings and an agent's brands and buildings", async () => {
  const q = { query: async (sql: string) => {
    if (/FROM crm_companies WHERE id = \$1/.test(sql)) return { rows: [{ id: "c1", name: "Mixed Co" }] };
    if (/CROSS JOIN LATERAL \(VALUES/.test(sql)) return { rows: [{ id: "p1", name: "Bluewater", role: "landlord" }, { id: "p1", name: "Bluewater", role: "asset_manager" }, { id: "p2", name: "Arches", role: "competitor_agent" }] };
    if (/FROM crm_company_properties cp/.test(sql)) return { rows: [{ id: "p3", name: "Trinity", role: "co_owner", stake: 50 }] };
    if (/'Target' AS how/.test(sql)) return { rows: [
      { how: "Target", unit_id: "u1", unit_name: "MSU9", marketing_status: "AVA", deal_id: "d9", property_id: "p1", property_name: "Bluewater" },
      { how: "Viewing", unit_id: "u1", unit_name: "MSU9", marketing_status: "AVA", deal_id: "d9", property_id: "p1", property_name: "Bluewater" },
      { how: "Offer", unit_id: "u2", unit_name: "U4", marketing_status: "COM", deal_id: null, property_id: "p3", property_name: "Trinity" },
    ] };
    if (/FROM brand_scheme_targets/.test(sql)) return { rows: [{ id: "w1", unit_label: null, property_id: "p4", property_name: "Gunwharf" }] };
    if (/CASE WHEN d.tenant_id/.test(sql)) return { rows: [{ id: "d1", name: "U1 letting", status: "NEG", side: "Tenant", property_id: "p1", property_name: "Bluewater" }] };
    if (/FROM brand_agent_representations/.test(sql)) return { rows: [{ id: "b1", name: "Gail's", agent_type: "Tenant rep", region: "London" }] };
    if (/SELECT DISTINCT p\.id, p\.name FROM crm_deals/.test(sql)) return { rows: [{ id: "p5", name: "Westgate" }] };
    if (/FROM unit_interest i JOIN/.test(sql)) return { rows: [{ unit_id: "u7", unit_name: "Kiosk 2", property_id: "p1", property_name: "Bluewater", brand: "Flat Iron" }] };
    return { rows: [] };
  } };
  const l = (await companyLinks(q, "c1"))!;
  assert.deepEqual(l.buildings!.map(b => [b.name, b.roles]), [["Arches", ["Letting agent"]], ["Bluewater", ["Landlord", "Asset manager"]], ["Trinity", ["co owner 50%"]]]);
  const u1 = l.instructions!.find(i => i.unitId === "u1")!;
  assert.deepEqual(u1.how, ["Target", "Viewing"]);
  assert.equal(u1.live, true);
  assert.equal(l.instructions!.find(i => i.unitId === "u2")!.live, false, "a completed letting is history");
  assert.ok(l.instructions!.some(i => i.how.includes("Wanted") && i.propertyName === "Gunwharf"));
  assert.ok(l.instructions!.some(i => i.how.includes("Tenant on the deal")));
  assert.deepEqual(l.actingFor, [{ id: "b1", name: "Gail's", detail: "Tenant rep · London" }]);
  assert.deepEqual(l.leasing!.map(b => b.name), ["Arches", "Bluewater", "Westgate"]);
  assert.match(l.leasing!.find(b => b.name === "Bluewater")!.how[0], /Brought Flat Iron to Kiosk 2/);
});

test("links: a part that fails is null, the rest still answer; an unknown company is null", async () => {
  const q = { query: async (sql: string) => {
    if (/FROM crm_companies WHERE id = \$1/.test(sql)) return { rows: [{ id: "c1", name: "X" }] };
    if (/FROM brand_agent_representations/.test(sql)) throw new Error("no table");
    return { rows: [] };
  } };
  const l = (await companyLinks(q, "c1"))!;
  assert.equal(l.actingFor, null);
  assert.deepEqual(l.buildings, []);
  assert.equal(await companyLinks({ query: async () => ({ rows: [] }) }, "nope"), null);
});

test("Select and Delete: untied goes, a tied brand is hidden, a tied landlord is kept", () => {
  const plan = crmBulkDeletePlan(["a", "b", "c", "d", "e"], [
    { id: "a", name: "Free Co", company_type: "Landlord" },
    { id: "b", name: "Tied Brand", company_type: "Tenant - Restaurant" },
    { id: "c", name: "Tied Landlord", company_type: "Landlord" },
    { id: "d", name: "Hidden Brand", company_type: "Tenant", archived_at: "2026-11-01" },
  ], new Map([["b", ["Has contacts"]], ["c", ["Linked to a property"]], ["d", ["Has contacts"]]]));
  assert.deepEqual(plan.remove.map(c => c.id), ["a"]);
  assert.deepEqual(plan.hide.map(c => c.id), ["b"]);
  assert.deepEqual(plan.kept.map(c => [c.id, c.ties]), [["c", ["Linked to a property"]]]);
  assert.deepEqual(plan.staysHidden.map(c => c.id), ["d"]);
  assert.deepEqual(plan.missing, ["e"]);
});

test("the action form takes the company's one running strategy, or the one the note names", () => {
  const s = (id: string, name: string, companies: string[], status = "active") => ({ id, name, status, targets: companies.map(companyId => ({ companyId })) }) as any;
  const all = [s("s1", "Mayfair push", ["beam"]), s("s2", "Old plan", ["beam"], "completed"), s("s3", "City dining", ["x", "y"]), s("s4", "Retail roll-out", ["y"])];
  assert.equal(strategyForCompany(all, "beam", "speak to giles at beam"), "s1");
  assert.equal(strategyForCompany(all, "y", "present our ideas"), null, "two running strategies and neither named");
  assert.equal(strategyForCompany(all, "y", "the city dining pitch"), "s3");
  assert.equal(strategyForCompany(all, "nobody"), null);
});

// Woody, 2026-11-23, Forge's page: people at every other Forge came back.
test("contact discovery keeps only people whose employer or work email is on the company's website", async () => {
  const { rocketReachEmployerFits } = await import("./contacts-discovery");
  assert.equal(rocketReachEmployerFits({ current_employer_domain: "forge.global" }, "forge-cp.com"), false);
  assert.equal(rocketReachEmployerFits({ current_employer_website: "https://www.forge-cp.com/" }, "forge-cp.com"), true);
  assert.equal(rocketReachEmployerFits({ recommended_professional_email: "mark@forge-cp.com" }, "forge-cp.com"), true);
  assert.equal(rocketReachEmployerFits({ emails: [{ email: "ed@forgeglobal.com" }] }, "forge-cp.com"), false);
  assert.equal(rocketReachEmployerFits({ emails: [{ email: "chris@gmail.com" }] }, "forge-cp.com"), true, "a personal address says nothing either way");
  assert.equal(rocketReachEmployerFits({}, "forge-cp.com"), true);
  assert.equal(rocketReachEmployerFits({ current_employer_domain: "forge.global" }, null), true, "no website on the record: as before");
});
