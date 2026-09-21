/**
 * geo-country.test.ts — shared country helpers (Delivery 2).
 *
 * Tail parsing of Google formatted addresses (incl. the production bug:
 * "Dundrum, Newcastle BT33, UK" must read as GB while a Dublin address
 * reads as IE), ISO→name reversal for geocode queries, the UK postcode
 * shape check, and buildGeocodeQuery's "UK only as fallback" rule.
 *
 * Run with: node --import tsx --test shared/geo-country.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  COUNTRY_TAIL_TO_ISO,
  inferCountryFromAddress,
  countryNameFromIso,
  UK_POSTCODE_RE,
  buildGeocodeQuery,
} from "./geo-country";

describe("inferCountryFromAddress", () => {
  it("parses the Newcastle-Dundrum impostor as GB, a Dublin address as IE", () => {
    assert.equal(inferCountryFromAddress("Dundrum, Newcastle BT33, UK"), "GB");
    assert.equal(inferCountryFromAddress("Dundrum Town Centre, Sandyford Rd, Dublin 16, Ireland"), "IE");
  });

  it("parses French and UK tails", () => {
    assert.equal(inferCountryFromAddress("123 Rue de Rivoli, 75001 Paris, France"), "FR");
    assert.equal(inferCountryFromAddress("Brent Cross, London NW4 3FP, United Kingdom"), "GB");
  });

  it("returns null when nothing matches", () => {
    assert.equal(inferCountryFromAddress("Some unterminated address"), null);
    assert.equal(inferCountryFromAddress(null), null);
    assert.equal(inferCountryFromAddress(undefined), null);
    assert.equal(inferCountryFromAddress(""), null);
  });

  it("is case-insensitive and tolerates a trailing dot", () => {
    assert.equal(inferCountryFromAddress("Maremagnum, Barcelona, SPAIN."), "ES");
  });
});

describe("countryNameFromIso", () => {
  it("reverses ISO-2 to a query-usable country name", () => {
    assert.equal(countryNameFromIso("IE"), "Ireland");
    assert.equal(countryNameFromIso("FR"), "France");
    // GB deliberately renders as "UK" — the legacy query convention.
    assert.equal(countryNameFromIso("GB"), "UK");
    assert.equal(countryNameFromIso("ie"), "Ireland");
  });

  it("returns null for unknown or missing codes", () => {
    assert.equal(countryNameFromIso("XX"), null);
    assert.equal(countryNameFromIso(null), null);
    assert.equal(countryNameFromIso(""), null);
  });
});

describe("UK_POSTCODE_RE", () => {
  it("accepts UK postcode shapes", () => {
    for (const pc of ["NW4 3FP", "B5 4BU", "M4 3AQ", "EC1A 1BB", "SW1A1AA"]) {
      assert.ok(UK_POSTCODE_RE.test(pc), pc);
    }
  });

  it("rejects non-UK postcodes", () => {
    for (const pc of ["D16 X2K7", "75001", "Dublin 16", "12345"]) {
      assert.ok(!UK_POSTCODE_RE.test(pc), pc);
    }
  });
});

describe("buildGeocodeQuery", () => {
  it("uses the asset's evidenced country as tail and hint", () => {
    const { query, countryHint } = buildGeocodeQuery({ name: "Dundrum Town Centre", address: "Dublin 16", country: "IE" });
    assert.equal(query, "Dundrum Town Centre, Dublin 16, Ireland");
    assert.equal(countryHint, "IE");
  });

  it("falls back to the landlord's home country when the asset has none", () => {
    const { query, countryHint } = buildGeocodeQuery({ name: "Ilac Centre", postcode: null, address: null, country: null }, "IE");
    assert.equal(query, "Ilac Centre, Ireland");
    assert.equal(countryHint, "IE");
  });

  it("appends the literal UK only when no country was evidenced at all", () => {
    const { query, countryHint } = buildGeocodeQuery({ name: "Bluewater", postcode: "DA9 9ST" });
    assert.equal(query, "Bluewater, DA9 9ST, UK");
    assert.equal(countryHint, null);
  });

  it("omits the tail for an unmapped ISO code rather than guessing", () => {
    const { query, countryHint } = buildGeocodeQuery({ name: "Somewhere", country: "XX" });
    assert.equal(query, "Somewhere");
    assert.equal(countryHint, "XX");
  });
});

describe("COUNTRY_TAIL_TO_ISO", () => {
  it("maps every reversed ISO back from its own country name", () => {
    for (const iso of ["IE", "FR", "ES", "DE", "NL", "IT", "US"]) {
      const name = countryNameFromIso(iso)!;
      assert.equal(inferCountryFromAddress(`1 Main Street, ${name}`), iso, iso);
    }
  });
});
