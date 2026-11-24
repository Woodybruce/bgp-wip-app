import { test } from "node:test";
import assert from "node:assert/strict";
import { planningAddressFit, planningPlaceKey, referenceYear } from "../shared/planning-address";

const pavement = planningPlaceKey({
  name: "26A and 26B The Pavement, Clapham",
  address: { street: "26A and 26B The Pavement, Clapham Old Town", postcode: "SW4 0JA" },
});

test("26A and 26B The Pavement: its own applications, not its neighbours'", () => {
  assert.deepEqual(pavement, { numbers: ["26a", "26b"], street: "pavement", building: null, searchTerm: "26a the pavement" });
  assert.equal(planningAddressFit("26A And 26B The Pavement London SW4 0JA", pavement), "address");
  assert.equal(planningAddressFit("26A The Pavement London SW4 0JA", pavement), "address");
  assert.equal(planningAddressFit("Flat 2, 26B The Pavement, London", pavement), "address");
  assert.equal(planningAddressFit("26 The Pavement London SW4 0JA", pavement), null);
  assert.equal(planningAddressFit("22 The Pavement London SW4 0JA", pavement), null);
  assert.equal(planningAddressFit("9 Bromell's Road London SW4 0BN", pavement), null);
  assert.equal(planningAddressFit("Flat 11, Trinity Close, The Pavement, London", pavement), null);
});

test("ranges, abbreviations and building names", () => {
  const briggate = planningPlaceKey({ name: "129-132 Briggate", address: "129-132 Briggate, Leeds LS1 6BR" });
  assert.equal(planningAddressFit("130 Briggate Leeds", briggate), "address");
  assert.equal(planningAddressFit("133 Briggate Leeds", briggate), null);
  const wells = planningPlaceKey({ name: "55 Wells St", address: { formatted: "55 Wells Street, London W1T 3PT" } });
  assert.equal(planningAddressFit("55 Wells Street London W1T 3PT", wells), "address");
  assert.equal(planningAddressFit("57 Wells Street London", wells), null);
  const mbh = planningPlaceKey({ name: "Millennium Bridge House", address: { formatted: "2 Lambeth Hill, London EC4V 4GG" } });
  assert.equal(planningAddressFit("Millennium Bridge House, 2 Lambeth Hill, London", mbh), "address");
  assert.equal(planningAddressFit("Millennium Bridge House London EC4", mbh), "name");
  assert.equal(planningAddressFit("4 Lambeth Hill London", mbh), null);
});

test("no key, no fit; the year in a reference", () => {
  assert.equal(planningPlaceKey({ name: "Clapham", address: null }), null);
  assert.equal(planningAddressFit("26A The Pavement", null), null);
  assert.equal(referenceYear("13/04314/FUL"), 2013);
  assert.equal(referenceYear("98/01234/FUL"), 1998);
  assert.equal(referenceYear("PP/20/01165"), null);
});
