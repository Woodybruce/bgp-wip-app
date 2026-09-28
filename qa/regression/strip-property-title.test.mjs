import assert from "node:assert/strict";
import test from "node:test";
import { stripPropertyFromTitle } from "../../client/src/lib/format.ts";

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

for (const [title, property, tenant, expected] of cases) {
  test(`${title} under ${property}`, () => {
    assert.equal(stripPropertyFromTitle(title, property, null, tenant), expected);
  });
}
