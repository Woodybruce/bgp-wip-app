import test from "node:test";
import assert from "node:assert/strict";
import { BLUEWATER_HOTS, ST_DAVIDS_HOTS, TRINITY_LEEDS_HOTS, WHITE_ROSE_HOTS, fillSchemeHots, isBracketTemplate, schemeHotsStandardFor } from "../shared/hots-standards";
import { STANDARD_HOTS_TEMPLATE } from "../shared/unit-hots";

const agreed = { unit: "L104", date: "12 November 2026", tenant: "Dishoom Limited", brand: "Dishoom", termYears: 10, rentPa: 110000, rentFreeMonths: 9, capitalContribution: 50000, breakOption: "Tenant break at year 5", use: "Indian restaurant" };

test("the scheme's own form is picked by the property name", () => {
  assert.equal(schemeHotsStandardFor("Bluewater Shopping Centre")?.key, "bluewater");
  assert.equal(schemeHotsStandardFor("St David's Dewi Sant, Cardiff")?.key, "st-davids");
  assert.equal(schemeHotsStandardFor("St. Davids")?.key, "st-davids");
  assert.equal(schemeHotsStandardFor("Westgate Oxford"), null);
});

test("bracket forms and token forms are told apart", () => {
  assert.equal(isBracketTemplate(BLUEWATER_HOTS), true);
  assert.equal(isBracketTemplate(ST_DAVIDS_HOTS), true);
  assert.equal(isBracketTemplate(STANDARD_HOTS_TEMPLATE), false);
});

test("Bluewater: the agreed figures go into their clauses", () => {
  const r = fillSchemeHots(BLUEWATER_HOTS, agreed);
  assert.match(r.text, /Unit L104 Bluewater, Kent/);
  assert.match(r.text, /\n12 November 2026\n/);
  assert.match(r.text, /4\. Tenant:\nDishoom Limited/);
  assert.match(r.text, /Agreed Brand\/trading name: Dishoom/);
  assert.match(r.text, /11\. Lease Term:\n10 years calculated/);
  assert.match(r.text, /£110,000 per annum exclusive of VAT/);
  assert.match(r.text, /payable from the date 9 months from the Access Date/);
  assert.match(r.text, /capital contribution of £50,000 plus VAT/);
  assert.match(r.text, /retail sale of Indian restaurant/);
  // The turnover alternative is left as written for the agent to strike out.
  assert.match(r.text, /an initial Base Rent of £\[ \]/);
  assert.deepEqual(r.unplaced.map(u => u.label), ["Break option"]);
});

test("St David's: a turnover deal fills the base rent and the percentage", () => {
  const r = fillSchemeHots(ST_DAVIDS_HOTS, { ...agreed, turnoverPct: 12 });
  assert.match(r.text, /a Base Rent of £110,000 per annum exclusive/);
  assert.match(r.text, /12% of the Tenant's Gross Turnover/);
  assert.match(r.text, /£\[ \] per annum exclusive of VAT, rates and all other outgoings, and is payable/, "the non-turnover alternative is untouched");
  assert.match(r.text, /Calculated as 10 years from the Access Date/);
  assert.match(r.text, /agreed trading brand of Dishoom no later/);
  assert.match(r.text, /Personal to Dishoom, there will be a tenant only break/);
  assert.match(r.text, /payable from the date 9 months from the Access Date/);
  assert.match(r.text, /capital contribution of £50,000 plus VAT/);
});

test("nothing agreed: the form comes back exactly as written", () => {
  const r = fillSchemeHots(BLUEWATER_HOTS, {});
  assert.equal(r.text, BLUEWATER_HOTS);
  assert.deepEqual(r.placed, []); assert.deepEqual(r.unplaced, []);
});

test("Trinity Leeds and White Rose are picked by name", () => {
  assert.equal(schemeHotsStandardFor("Trinity Leeds")?.key, "trinity-leeds");
  assert.equal(schemeHotsStandardFor("White Rose Centre, Leeds")?.key, "white-rose");
  assert.equal(isBracketTemplate(TRINITY_LEEDS_HOTS), true);
  assert.equal(isBracketTemplate(WHITE_ROSE_HOTS), true);
});

test("Trinity Leeds: the X blanks are filled", () => {
  const r = fillSchemeHots(TRINITY_LEEDS_HOTS, { ...agreed, turnoverPct: 10, areaSqFt: 2300, serviceChargePa: 18500, insurancePa: 900, landlordAgent: "Rob Barnes, Bruce Gillingham Pollard" });
  assert.match(r.text, /Date:\n12 November 2026/);
  assert.match(r.text, /Unit L104, Trinity Leeds/);
  assert.match(r.text, /approximate GIA of 2,300 sq\. ft/);
  assert.match(r.text, /Tenant ?: Dishoom Limited/);
  assert.match(r.text, /Trading as: Dishoom/);
  assert.match(r.text, /New 10 year lease commencing on the Access Date/);
  assert.match(r.text, /£110,000 per annum exclusive of VAT, service charge/);
  assert.match(r.text, /10% of gross annual turnover/);
  assert.match(r.text, /payable 9 months from Access Date/);
  assert.match(r.text, /service charge for the Premises is currently £18,500 pa/);
  assert.match(r.text, /insurance cost for the Premises is currently £900 pa/);
  assert.match(r.text, /retail sale of Indian restaurant/);
  assert.match(r.text, /Ours: Rob Barnes, Bruce Gillingham Pollard/);
  assert.deepEqual(r.unplaced.map(u => u.label).sort(), ["Break option", "Capital contribution"]);
});

test("White Rose: rent, term, rent free and capital contribution", () => {
  const r = fillSchemeHots(WHITE_ROSE_HOTS, agreed);
  assert.match(r.text, /Unit L104, White Rose Centre, Leeds/);
  assert.match(r.text, /Calculated as 10 years from the quarter day/);
  assert.match(r.text, /£110,000 per annum exclusive of VAT, rates and all other outgoings payable by equal payments monthly/);
  assert.match(r.text, /payable from the date 9 months after the Access Date/);
  assert.match(r.text, /capital contribution of £50,000 plus VAT/);
  const t = fillSchemeHots(WHITE_ROSE_HOTS, { ...agreed, turnoverPct: 12 });
  assert.match(t.text, /An initial Base Rent of £110,000 per annum/);
});
