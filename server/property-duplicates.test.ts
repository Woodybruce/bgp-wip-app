import { test } from "node:test";
import assert from "node:assert/strict";
import { describeDuplicateGroup, type DuplicateRecordFacts } from "../shared/property-duplicates";

const rec = (o: Partial<DuplicateRecordFacts>): DuplicateRecordFacts => ({
  id: "x", address: null, postcode: null, hasLandlord: false, createdAt: null, sharedCentrePage: false, deals: 0, scheduleRows: 0, trackerUnits: 0, ...o,
});

test("Sedley Place in Clapham and on Oxford Street are two places", () => {
  const g = describeDuplicateGroup("sedley place", [
    rec({ id: "a", address: { formatted: "Sedley Place, 68 Venn St, London SW4 0AX, UK" } }),
    rec({ id: "b", address: { line: "355-361 Oxford Street, London" }, postcode: "W1D 2HE" }),
  ]);
  assert.equal(g.samePlace, false);
  assert.equal(g.why, "Different postcodes");
});

test("the record with the landlord and links is kept, whatever order the scan gave", () => {
  const g = describeDuplicateGroup("liverpool one", [
    rec({ id: "new", postcode: "L1 8JQ", createdAt: "2026-09-29T00:00:00Z" }),
    rec({ id: "old", postcode: "L1 8JQ", hasLandlord: true, deals: 4, createdAt: "2026-03-22T00:00:00Z" }),
  ]);
  assert.equal(g.samePlace, true);
  assert.deepEqual(g.ids, ["old", "new"]);
});

test("a record with no address does not block a merge; a shared centre page does", () => {
  assert.equal(describeDuplicateGroup("borough yards", [rec({ id: "a", address: { street: "Borough Yards, Stoney Street, London SE1" } }), rec({ id: "b" })]).samePlace, true);
  assert.equal(describeDuplicateGroup("x", [rec({ id: "a", postcode: "L1 8JQ" }), rec({ id: "b", postcode: "L18JQ", sharedCentrePage: true })]).samePlace, false);
  assert.equal(describeDuplicateGroup("x", [rec({ id: "a", address: "1 High St, Bath" }), rec({ id: "b", address: "9 Low Rd, Leeds" })]).why, "Different addresses");
});
