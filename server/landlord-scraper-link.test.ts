/**
 * landlord-scraper-link.test.ts — exact property matching (Delivery 2,
 * Task 3). "Ambiguous postcode causes no automatic ownership change."
 *
 * The old autoLinkScrapedProperties built byPostcode as a Map that
 * silently kept the last row when two CRM properties shared a postcode,
 * so an ambiguous postcode could win an automatic landlord_id write. The
 * match decision is now the pure decidePropertyLink: name and postcode
 * matches are both unique-or-skip, and an evidenced non-UK country with a
 * UK-shaped postcode skips as a country/postcode mismatch.
 *
 * decidePropertyLink is pure — the module is imported with a dummy
 * DATABASE_URL (its pool is never queried). No network, no real DB.
 *
 * Run with: node --import tsx --test server/landlord-scraper-link.test.ts
 */
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";

let decidePropertyLink: typeof import("./landlord-scraper").decidePropertyLink;
type Candidate = import("./landlord-scraper").PropertyLinkCandidate;

before(async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://test:test@localhost:1/test";
  ({ decidePropertyLink } = await import("./landlord-scraper"));
});

const CRM: Candidate[] = [
  { id: "P-BLUEWATER", name: "Bluewater Shopping Centre", postcode: "DA9 9ST", landlord_id: null },
  { id: "P-STDFS", name: "St. David's Dewi Sant", postcode: "CF10 1EF", landlord_id: null },
  { id: "P-DUP-A", name: "Mall A", postcode: "B5 4BU", landlord_id: null },
  { id: "P-DUP-B", name: "Mall B", postcode: "B5 4BU", landlord_id: null },
  { id: "P-OWNED", name: "Brent Cross", postcode: "NW4 3FP", landlord_id: "OTHER-LANDLORD" },
  { id: "P-MINE", name: "Cabot Circus", postcode: "BS1 3BX", landlord_id: "HAM" },
];

describe("decidePropertyLink", () => {
  it("links an exact normalised-name match", () => {
    const d = decidePropertyLink({ name: "Bluewater" }, CRM, "HAM");
    assert.deepEqual(d, { action: "link", crmId: "P-BLUEWATER", via: "name" });
  });

  it("links an exact unique postcode match when the name differs", () => {
    const d = decidePropertyLink({ name: "St David's Cardiff", postcode: "CF10 1EF" }, CRM, "HAM");
    assert.deepEqual(d, { action: "link", crmId: "P-STDFS", via: "postcode" });
  });

  it("skips a duplicate postcode with the ambiguity reason — no automatic ownership change", () => {
    const d = decidePropertyLink({ name: "Unmatched Name", postcode: "B5 4BU" }, CRM, "HAM");
    assert.deepEqual(d, { action: "skip", reason: "ambiguous postcode — 2 CRM rows share it" });
  });

  it("skips a country/postcode mismatch (IE country, UK-shaped postcode)", () => {
    const d = decidePropertyLink({ name: "Bluewater", postcode: "DA9 9ST", country: "IE" }, CRM, "HAM");
    assert.equal(d.action, "skip");
    assert.match((d as any).reason, /country\/postcode mismatch/);
  });

  it("still matches a GB item with a UK-shaped postcode", () => {
    const d = decidePropertyLink({ name: "Bluewater", postcode: "DA9 9ST", country: "GB" }, CRM, "HAM");
    assert.deepEqual(d, { action: "link", crmId: "P-BLUEWATER", via: "name" });
  });

  it("skips a row already linked to a different landlord, surfacing the blocker", () => {
    const d = decidePropertyLink({ name: "Brent Cross" }, CRM, "HAM");
    assert.deepEqual(d, { action: "skip", reason: "CRM row already linked to a different landlord", existingLandlordId: "OTHER-LANDLORD" });
  });

  it("reports an already-owned row without re-linking", () => {
    const d = decidePropertyLink({ name: "Cabot Circus" }, CRM, "HAM");
    assert.deepEqual(d, { action: "already_linked", crmId: "P-MINE", via: "name" });
  });

  it("skips when nothing matches", () => {
    const d = decidePropertyLink({ name: "Nowhere Plaza", postcode: "ZZ1 1ZZ" }, CRM, "HAM");
    assert.deepEqual(d, { action: "skip", reason: "no CRM property matches name or postcode" });
  });
});
