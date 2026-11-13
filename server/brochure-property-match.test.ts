// Feedback #78/#79 (13 Nov 2026): the Cavendish House brochure was filed on
// 9 Conduit Street because that record's postcode read plain "W1".
import { test } from "node:test";
import assert from "node:assert/strict";
import { findExistingProperty } from "./whatsapp-brochure-pipeline";

const PROPS = [
  { id: "conduit", name: "9 Conduit Street", postcode: "W1", address: { line: "59-60 Paddington Street & 6-7 Garbutt Place", formatted: "59-60 Paddington Street & 6-7 Garbutt Place" } },
  { id: "cavendish", name: "Cavendish House, 18 Cavendish Square", postcode: null, address: { street: "18 Cavendish Square, Marylebone", city: "London" } },
  { id: "cav14", name: "14 Cavendish Square", postcode: "W1G 9DB", address: { formatted: "14 Cavendish Square, London W1G 9DB" } },
];
// Returns every row: the matcher itself must reject the wrong ones.
const pool = (rows: any[]) => ({ query: async () => ({ rows }) });

test("a 'London W1' brochure is never filed on a record just because its postcode reads W1", async () => {
  const cav = await findExistingProperty({ propertyName: "Cavendish House", addressLine: "18 Cavendish Square, London W1", postcode: "W1" }, pool(PROPS));
  assert.equal(cav?.id, "cavendish");
  const none = await findExistingProperty({ propertyName: "Cavendish House", addressLine: "18 Cavendish Square, London W1", postcode: "W1" }, pool(PROPS.filter((p) => p.id !== "cavendish")));
  assert.equal(none, null, "no 18 Cavendish Square on file: make a new record, never 9 Conduit Street or 14 Cavendish Square");
});

test("place names alone never pick a property", async () => {
  assert.equal(await findExistingProperty({ propertyName: "Mayfair Office Investment", addressLine: "Mayfair, London W1", postcode: "W1" }, pool(PROPS)), null);
  assert.equal(await findExistingProperty({ propertyName: null, addressLine: "Marylebone, London W1", postcode: null }, pool(PROPS)), null);
});

test("the same building by number and street is found", async () => {
  assert.equal((await findExistingProperty({ propertyName: "14 Cavendish Square", addressLine: "14 Cavendish Square, London W1G 9DB", postcode: "W1G 9DB" }, pool(PROPS)))?.id, "cav14");
  assert.equal((await findExistingProperty({ propertyName: "9 Conduit Street", addressLine: "9 Conduit Street, Mayfair, London W1", postcode: "W1" }, pool(PROPS)))?.id, "conduit");
});
