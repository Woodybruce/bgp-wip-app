// The A to Z letters down the right of the AML page (Woody, 25 November 2026:
// "on the right side can you put letters alphabetic so can click and search
// companies and also transactions"). Rules: shared/letter-index.ts.
import test from "node:test";
import assert from "node:assert/strict";
import { INDEX_LETTERS, byName, indexLetter, isIndexLetter, letterCounts } from "../shared/letter-index";

test("a name is under its first letter, accents aside; numbers and no letter are under #", () => {
  assert.equal(indexLetter("Tunsgate Quarter"), "T");
  assert.equal(indexLetter("rodd & Gunn"), "R");
  assert.equal(indexLetter("@Home pizza"), "H", "a sign before the name is skipped");
  assert.equal(indexLetter("[TEST AML] 3"), "T");
  assert.equal(indexLetter("Élan Café"), "E");
  assert.equal(indexLetter("1 Rebel"), "#");
  assert.equal(indexLetter("13th Street Hospitality"), "#");
  assert.equal(indexLetter(""), "#");
  assert.equal(indexLetter(null), "#");
  assert.equal(INDEX_LETTERS.length, 27);
  assert.ok(isIndexLetter("#") && isIndexLetter("A") && !isIndexLetter("a"));
});

test("counts per letter, and A to Z with numbers read as numbers", () => {
  const c = letterCounts(["Affineurs", "AEW", "1 Rebel", "92 Degrees", "Bill's"]);
  assert.equal(c.A, 2);
  assert.equal(c.B, 1);
  assert.equal(c["#"], 2);
  assert.equal(c.Z, 0);
  assert.deepEqual(["Unit 10", "Unit 2", "unit 1"].sort(byName), ["unit 1", "Unit 2", "Unit 10"]);
});
