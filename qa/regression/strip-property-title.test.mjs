import assert from "node:assert/strict";
import test from "node:test";
import { stripPropertyFromTitle, dealDisplayTitle, titleIsOnlyProperty } from "../../client/src/lib/format.ts";

// Run with: node --import tsx --test qa/regression/strip-property-title.test.mjs
// Real WIP titles (ref | property | tenant) from the live WIP report. A title
// that is only the property shows the tenant; misspelt streets still match
// (Woody, 2026-09-28).
const cases = [
  ["62, 64 & 66/66A Pimlico Road – 62, 64 & 66/66A Pimlico Road", "Pimlico Rd, London SW1W, UK", "Lapicida", "Lapicida"],
  ["128 Charring Cross Road", "128 Charring Cross Road", "Sushi Joy", "Sushi Joy"],
  ["35 Dover St", "35 Dover St", "Tureddi", "Tureddi"],
  ["101 Finsbury Pavement", "101 Finsbury Pavement", "Kudu", "Kudu"],
  ["St Christophers Place", "St Christopher's Place", "Manna", "Manna"],
  ["Canary Wharf Estate, London E14, UK", "Canary Wharf Estate, London E14, UK", "Honest Greens", "Honest Greens"],
  ["Gabriel's Wharf", "Gabriel's Wharf", "Snapshot ice", "Snapshot ice"],
  ["One Millenium Bridge", "One Millenium Bridge", "Coq d'Argent", "Coq d'Argent"],
  ["29 Great Pultney Street - Corteiz", "29 Great Pulteney Street", "Corteiz", "Corteiz"],
  ["Pultney Street - Corteiz", "29 Great Pulteney Street", "Corteiz", "Corteiz"],
  ["Sushi Joy - 128 Charing Cross Road", "128 Charring Cross Road", "Sushi Joy", "Sushi Joy"],
  ["Washington green retail ltd – 25 - 26 St Christophers Place", "25 - 26 St Christophers Place", "Washington green retail ltd", "Washington green retail ltd"],
  ["Brookfield - One Leadenhall", "Brookfield", "One Leadenhall", "One Leadenhall"],
  ["Holy Greens – Canary Wharf Estate, London E14, UK", "Canary Wharf Estate, London E14, UK", "Holy Greens", "Holy Greens"],
  ["Canary Wharf – F2 Wood Wharf", "Canary Wharf Estate, London E14, UK", "Fulai", "F2 Wood Wharf"],
  ["Canary Wharf", "Canary Wharf Estate, London E14, UK", "Enmei", "Enmei"],
  ["St Christophers Place - Myka", "St Christopher's Place", "Myka", "Myka"],
  ["Luke Irwin – Pimlico Rd, London SW1W, UK", "Pimlico Rd, London SW1W, UK", "Luke Irwin", "Luke Irwin"],
  ["48-50 Brewer Street - Scuffers", "Beak Street", "Scuffers", "48-50 Brewer Street - Scuffers"],
  ["10-12 Chiltern Street", "23-25 Chiltern Street", "Completed Works", "10-12 Chiltern Street"],
  ["Time Out Market T2", "10 Piccadilly", "Time Out Market", "Time Out Market T2"],
  ["Portman Estate", "Portman Estate", "N/A", "Portman Estate"],
  ["Stratford Shopping Centre", "Stratford Shopping Centre", null, "Stratford Shopping Centre"],
  ["Pret A Manger – Gunwharf Quays, Portsmouth", "Gunwharf Quays", null, "Pret A Manger"],
  ["30 Davies St", "30 Davies Street", "The Frankie Shop", "The Frankie Shop"],
];

// A postal-address run is the location, not the deal — with or without the
// property's address passed (#3582, Woody, 2026-09-28).
const addressCases = [
  ["Queen St, Oxford OX1 1NZ, UK - Gail's Bakery", "Westgate Shopping Centre", "Queen St, Oxford OX1 1NZ, UK", "Gail's Bakery", "Gail's Bakery"],
  ["Queen St, Oxford OX1 1NZ, UK - Gail's Bakery", "Westgate Shopping Centre", null, "Gail's Bakery", "Gail's Bakery"],
  ["Gail's Bakery - Queen St, Oxford OX1 1NZ, UK", "Westgate Shopping Centre", null, null, "Gail's Bakery"],
];

for (const [title, property, address, tenant, expected] of addressCases) {
  test(`${title} under ${property} (address ${address ? "given" : "absent"})`, () => {
    assert.equal(stripPropertyFromTitle(title, property, address, tenant), expected);
  });
}

// Title that is only its property → callers show the deal type instead.
test("titleIsOnlyProperty", () => {
  assert.equal(titleIsOnlyProperty("1 Wood Street", "1 Wood Street"), true);
  assert.equal(titleIsOnlyProperty("103 Mount Street", "103 Mount Street, London W1K 2TJ"), true);
  assert.equal(titleIsOnlyProperty("Nando's", "Bluewater Shopping Centre"), false);
  assert.equal(titleIsOnlyProperty("10-12 Chiltern Street", "23-25 Chiltern Street"), false);
});

for (const [title, property, tenant, expected] of cases) {
  test(`${title} under ${property}`, () => {
    assert.equal(stripPropertyFromTitle(title, property, null, tenant), expected);
  });
}

// dealDisplayTitle — WIP report, property WIP chips and phone Deals cards: a
// bare unit takes its tenant, a title that is only the property shows the
// tenant (Woody, 2026-09-28).
const displayCases = [
  [{ name: "Unit C10", propertyName: null, tenantName: "MINISO UK" }, "MINISO UK · Unit C10"],
  [{ name: "Unit 10 (split)", propertyName: "Brent Cross Shopping Centre", tenantName: "Dream Nails" }, "Dream Nails · Unit 10 (split)"],
  [{ name: "Unit 3", propertyName: "180 Borough High St", tenantName: "Nando's" }, "Nando's · Unit 3"],
  [{ name: "Unit 5", propertyName: "Grand Central", tenantName: "Leon" }, "Leon · Unit 5"],
  [{ name: "South Molton - unit 3", propertyName: "South Molton - unit 3", tenantName: "Kinraden" }, "Kinraden · Unit 3"],
  [{ name: "Newsons Yard", propertyName: "Newsons Yard", tenantName: "Matilda Goad" }, "Matilda Goad"],
  [{ name: "1 Wood Street", propertyName: "1 Wood Street", tenantName: "Gail's" }, "Gail's"],
  [{ name: "12 George Street", propertyName: "12 George Street", tenantName: "Pret A Manger" }, "Pret A Manger"],
  [{ name: "Unit 7a", propertyName: "Southbank", tenantName: null }, "Unit 7a"],
  [{ name: "Southbank - Unit 7a", propertyName: "Southbank", tenantName: null }, "Southbank · Unit 7a"],
  [{ name: "Landsec - Consultancy - (Q2)", propertyName: "Cardinal Place", tenantName: null }, "Landsec - Consultancy (Q2)"],
  [{ name: "Time Out Market T1", propertyName: "10 Piccadilly", tenantName: "Time Out Market" }, "Time Out Market T1"],
];

for (const [deal, expected] of displayCases) {
  test(`display ${deal.name} under ${deal.propertyName}`, () => {
    assert.equal(dealDisplayTitle(deal), expected);
  });
}
