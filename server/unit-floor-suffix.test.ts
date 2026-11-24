import { test } from "node:test";
import assert from "node:assert/strict";
import { withoutFloorSuffix } from "../shared/unit-floor-suffix";
import { classifyTenancyImportRow } from "./tenancy-import";

test("the row's own floor comes off the end of the unit name", () => {
  assert.equal(withoutFloorSuffix("254 Queen Street (U30), Westgate, OX1 1PE - Upper Level", "Upper Level"), "254 Queen Street (U30), Westgate, OX1 1PE");
  assert.equal(withoutFloorSuffix("Leisure Box - 127 Queen Street (Leisure Box), Westgate - Lower Level", "lower level"), "Leisure Box - 127 Queen Street (Leisure Box), Westgate");
  assert.equal(withoutFloorSuffix("SVL02 Bluewater – Lower Level", "Lower Level"), "SVL02 Bluewater");
});

test("anything that is not the row's floor stays", () => {
  assert.equal(withoutFloorSuffix("307 Queen Street (RU5), Westgate - Roof", "Second"), "307 Queen Street (RU5), Westgate - Roof");
  assert.equal(withoutFloorSuffix("36 St Ebbes Street (U1) Westgate, OX1 1PU - Whole Demise", "Lower Level"), "36 St Ebbes Street (U1) Westgate, OX1 1PU - Whole Demise");
  assert.equal(withoutFloorSuffix("L11 - Westgate Shopping Centre", "Lower Level"), "L11 - Westgate Shopping Centre");
  assert.equal(withoutFloorSuffix("Upper Level", "Upper Level"), "Upper Level");
  assert.equal(withoutFloorSuffix("Unit 4 - Upper Level", null), "Unit 4 - Upper Level");
});

test("a re-import matches the row saved with the floor on its name", () => {
  const saved = [{ id: "a", unit_number: "254 Queen Street (U30), Westgate, OX1 1PE - Upper Level", floor_level: "Upper Level", tenant_name: "Dallas Holdings Limited" }];
  const decision = classifyTenancyImportRow({ sourceRow: 2, values: { unit_number: "254 Queen Street (U30), Westgate, OX1 1PE", floor_level: "Upper Level", tenant_name: "Dallas Holdings Limited" } }, saved);
  assert.deepEqual(decision, { action: "skip", existingId: "a" });
});
