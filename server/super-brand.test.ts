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
