/**
 * geocode-country.test.ts — country-aware geocoding (Delivery 2).
 *
 * The old geocoder appended "UK" to every query and hard-filtered
 * components=country:GB, so Dundrum Town Centre (Dublin) resolved to
 * "Dundrum, Newcastle BT33, UK". Now: a country hint biases the request to
 * that country, the result's country is validated against the hint
 * (mismatch → unresolved NULL-cache), cache keys include the hint, and a
 * missing hint preserves the legacy GB filter exactly.
 *
 * Google access is mocked at the global fetch layer; the geocode_cache
 * pool is injected via setGeocodeQuerierForTests. No network, no real DB.
 *
 * Run with: node --import tsx --test server/geocode-country.test.ts
 */
import { describe, it, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";

let geocodeOne: typeof import("./geocode").geocodeOne;
let geocodeBatch: typeof import("./geocode").geocodeBatch;
let setGeocodeQuerierForTests: typeof import("./geocode").setGeocodeQuerierForTests;

// ─── fetch + pool mocks ──────────────────────────────────────────────────
let fetchUrls: string[] = [];
const realFetch = globalThis.fetch;

// Results keyed by the address param: GB_RESULT fails IE validation (the
// Dundrum→Newcastle case), IE_RESULT passes it.
const GB_RESULT = {
  results: [{
    formatted_address: "Dundrum, Newcastle BT33, UK",
    geometry: { location: { lat: 54.25, lng: -5.84 } },
    place_id: "gb-place",
    address_components: [{ long_name: "United Kingdom", short_name: "GB", types: ["country", "political"] }],
  }],
};
const IE_RESULT = {
  results: [{
    formatted_address: "Dundrum Town Centre, Sandyford Rd, Dublin 16, Ireland",
    geometry: { location: { lat: 53.29, lng: -6.24 } },
    place_id: "ie-place",
    address_components: [{ long_name: "Ireland", short_name: "IE", types: ["country", "political"] }],
  }],
};
// No address_components — the legacy no-hint path must not start validating.
const BARE_RESULT = {
  results: [{
    formatted_address: "Bluewater, Greenhithe DA9 9ST, UK",
    geometry: { location: { lat: 51.44, lng: 0.27 } },
    place_id: "bare-place",
  }],
};

let cacheRows: Record<string, { lat: number | null; lng: number | null; formatted_address: string | null }> = {};
let cacheWrites: Array<{ key: string; lat: number | null }> = [];

function mockQuerier() {
  return {
    async query(sql: string, params: any[] = []) {
      if (/CREATE TABLE IF NOT EXISTS geocode_cache/.test(sql)) return { rows: [], rowCount: 0 };
      if (/SELECT lat, lng, formatted_address FROM geocode_cache/.test(sql)) {
        const hit = cacheRows[params[0]];
        return { rows: hit ? [hit] : [], rowCount: hit ? 1 : 0 };
      }
      if (/INSERT INTO geocode_cache/.test(sql)) {
        cacheWrites.push({ key: params[0], lat: params[1] ?? null });
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`unexpected query: ${sql}`);
    },
  };
}

before(async () => {
  process.env.GOOGLE_API_KEY = process.env.GOOGLE_API_KEY || "test-key";
  const mod = await import("./geocode");
  geocodeOne = mod.geocodeOne;
  geocodeBatch = mod.geocodeBatch;
  setGeocodeQuerierForTests = mod.setGeocodeQuerierForTests;

  globalThis.fetch = (async (input: any) => {
    const url = String(input);
    fetchUrls.push(url);
    const address = new URL(url).searchParams.get("address") || "";
    const body = address.includes("Dundrum, Newcastle") || address === "dundrum-gb"
      ? GB_RESULT
      : address.includes("Dublin") || address === "dundrum-ie"
        ? IE_RESULT
        : BARE_RESULT;
    return new Response(JSON.stringify(body), { status: 200 });
  }) as any;
});

beforeEach(() => {
  fetchUrls = [];
  cacheRows = {};
  cacheWrites = [];
  setGeocodeQuerierForTests(mockQuerier());
});

after(() => {
  globalThis.fetch = realFetch;
  setGeocodeQuerierForTests(null);
});

describe("geocodeOne country hints", () => {
  it("flows the hint into the request URL (region + components)", async () => {
    await geocodeOne("dundrum-ie", { countryHint: "IE" });
    assert.equal(fetchUrls.length, 1);
    assert.match(fetchUrls[0], /region=ie/);
    assert.match(fetchUrls[0], /components=country:IE/);
  });

  it("preserves the legacy GB filter when no hint is given", async () => {
    await geocodeOne("Bluewater, DA9 9ST, UK");
    assert.match(fetchUrls[0], /region=uk/);
    assert.match(fetchUrls[0], /components=country:GB/);
  });

  it("does not validate country on the legacy no-hint path", async () => {
    // BARE_RESULT has no address_components — with no hint it still resolves.
    const r = await geocodeOne("Bluewater, DA9 9ST, UK");
    assert.equal(r.lat, 51.44);
    assert.equal(r.formattedAddress, "Bluewater, Greenhithe DA9 9ST, UK");
  });

  it("treats a hint/result country mismatch as unresolved and caches a NULL miss", async () => {
    // The Dundrum→Newcastle fix: hint IE, Google returns a GB (BT33) result.
    const r = await geocodeOne("dundrum-gb", { countryHint: "IE" });
    assert.deepEqual({ lat: r.lat, lng: r.lng, formattedAddress: r.formattedAddress }, { lat: null, lng: null, formattedAddress: null });
    assert.equal(cacheWrites.length, 1);
    assert.equal(cacheWrites[0].lat, null);
  });

  it("resolves when the result country matches the hint", async () => {
    const r = await geocodeOne("dundrum-ie", { countryHint: "IE" });
    assert.equal(r.lat, 53.29);
    assert.equal(r.formattedAddress, IE_RESULT.results[0].formatted_address);
  });

  it("includes the hint in the cache key so poisoned legacy entries are never hit", async () => {
    await geocodeOne("dundrum town centre, uk");                  // legacy key, GB filter
    await geocodeOne("dundrum town centre, uk", { countryHint: "IE" }); // different key
    const keys = cacheWrites.map(w => w.key);
    assert.ok(keys.includes("dundrum town centre, uk|"));
    assert.ok(keys.includes("dundrum town centre, uk|IE"));
    assert.notEqual(keys[0], keys[1]);
  });

  it("serves cache hits without calling Google", async () => {
    cacheRows["cached query|IE"] = { lat: 1, lng: 2, formatted_address: "Cached, Ireland" };
    const r = await geocodeOne("Cached Query", { countryHint: "IE" });
    assert.equal(r.lat, 1);
    assert.equal(fetchUrls.length, 0);
  });
});

describe("geocodeBatch", () => {
  it("threads per-item hints through and keeps string items on the legacy path", async () => {
    const results = await geocodeBatch([
      { query: "dundrum-ie", countryHint: "IE" },
      "Bluewater, DA9 9ST, UK",
    ]);
    assert.equal(results[0].lat, 53.29);
    assert.equal(results[1].lat, 51.44);
    assert.ok(fetchUrls.some(u => u.includes("components=country:IE")));
    assert.ok(fetchUrls.some(u => u.includes("components=country:GB")));
  });
});
