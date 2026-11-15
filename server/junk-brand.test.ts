import { test } from "node:test";
import assert from "node:assert/strict";
import { isJunkBrand } from "../shared/junk-brand";

test("operating companies, hotel groups, bookmakers and generic names are not pitchable brands", () => {
  for (const name of ["IHG", "Street Food Holdings", "William Hill", "Coral", "Travelodge", "Coffee House", "McDonald's Restaurants Ltd", "Marston's PLC", "Admiral Casino", "Azzurri Group", "The Restaurant Group plc", ""]) {
    assert.equal(isJunkBrand({ name }), true, name);
  }
  assert.equal(isJunkBrand({ name: "Sleepwell", companyType: "Tenant - Hotel" }), true);
});

test("real brands stay", () => {
  for (const name of ["Popeyes", "Pret A Manger", "Dishoom", "PureGym", "The Ivy Collection", "Flight Club", "Vue", "Boom Battle Bar", "All Bar One", "Blank Street Coffee", "Five Guys", "Coral Reef Sushi Co", "The Gym Group", "Hotpod Yoga", "Las Iguanas", "Group Therapy Coffee"]) {
    assert.equal(isJunkBrand({ name, companyType: "Tenant - Restaurant" }), false, name);
  }
});
