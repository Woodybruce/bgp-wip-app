/**
 * account-reconciliation.test.ts — Hammerson official-destinations
 * reconciliation (Delivery 2, Task 5).
 *
 * Acceptance gates: all 11 official destinations accounted for, including
 * the legitimate Bullring & Grand Central grouping (one official row, two
 * CRM properties); development/disposed rows report in their own
 * categories and don't count against the gate; a tenant-rep deal at Brent
 * Cross is related market activity, not a Hammerson instruction, so
 * bgp_instruction stays false; and the route guard refuses any
 * client-scoped request (tested as the pure helper, not the wire).
 *
 * Matching is pure; seeding is tested against a mock pool. No network, no
 * real DB.
 *
 * Run with: node --import tsx --test server/account-reconciliation.test.ts
 */
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";

let reconcileBaseline: typeof import("./account-reconciliation").reconcileBaseline;
let destinationGatePassed: typeof import("./account-reconciliation").destinationGatePassed;
let reconciliationDeniedForScope: typeof import("./account-reconciliation").reconciliationDeniedForScope;
let ensureBaselineSeeded: typeof import("./account-reconciliation").ensureBaselineSeeded;
let HAMMERSON_OFFICIAL_DESTINATIONS: typeof import("./reconciliation-baselines").HAMMERSON_OFFICIAL_DESTINATIONS;

before(async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://test:test@localhost:1/test";
  const recon = await import("./account-reconciliation");
  reconcileBaseline = recon.reconcileBaseline;
  destinationGatePassed = recon.destinationGatePassed;
  reconciliationDeniedForScope = recon.reconciliationDeniedForScope;
  ensureBaselineSeeded = recon.ensureBaselineSeeded;
  ({ HAMMERSON_OFFICIAL_DESTINATIONS } = await import("./reconciliation-baselines"));
});

import type { AccountProperty, AccountView } from "./account-resolver";

function prop(propertyId: string, name: string, country: string | null = "GB"): AccountProperty {
  return {
    propertyId, name, postcode: null, country,
    relationshipRole: "owner", ownershipStakePct: null, owningEntityId: "HAM",
    confidence: "confirmed", sources: ["landlord_id"], unitCount: 0,
  };
}

// The full Hammerson portfolio as the CRM should hold it.
const FULL_PORTFOLIO: AccountProperty[] = [
  prop("P-ARNDALE", "Manchester Arndale"),
  prop("P-BRENT", "Brent Cross"),
  prop("P-BULLRING", "Bullring"),
  prop("P-GCENTRAL", "Grand Central"),
  prop("P-CABOT", "Cabot Circus"),
  prop("P-ORACLE", "The Oracle"),
  prop("P-WESTQUAY", "Westquay"),
  prop("P-DUNDRUM", "Dundrum Town Centre", "IE"),
  prop("P-ILAC", "Ilac Centre", "IE"),
  prop("P-PAVILIONS", "Pavilions", "IE"),
  prop("P-3FONTAINES", "Les 3 Fontaines", "FR"),
  prop("P-TERRASSES", "Les Terrasses du Port", "FR"),
];

function viewWith(properties: AccountProperty[], instructionPropertyIds: string[] = []): Pick<AccountView, "properties" | "instructions" | "entities"> {
  return {
    properties,
    instructions: instructionPropertyIds.map((propertyId, i) => ({
      dealId: `D${i}`, name: "d", status: "LIVE", propertyId, partyEntityId: "HAM", instructedAt: null,
    })),
    entities: [{ companyId: "HAM", name: "Hammerson", companyType: "REIT", companiesHouseNumber: null, relation: "self", relationConfidence: "confirmed", evidence: "crm_companies.id" }],
  };
}

// Function, not a const: HAMMERSON_OFFICIAL_DESTINATIONS is only assigned
// inside before(), so building the array at module top level would iterate
// undefined.
const baselineWithDevDisposed = () => [
  ...HAMMERSON_OFFICIAL_DESTINATIONS,
  { destination_name: "Sovereign Square Leeds", country: "GB", official_group_key: null, expected_crm_property_count: 1, category: "development" as const, source_url: "https://example.com", source_date: "2026-09-20" },
  { destination_name: "Brent South (Disposed)", country: "GB", official_group_key: null, expected_crm_property_count: 1, category: "disposed" as const, source_url: "https://example.com", source_date: "2026-09-20" },
];

describe("reconcileBaseline", () => {
  it("accounts for all 11 official destinations when the portfolio is complete", () => {
    const rows = reconcileBaseline(HAMMERSON_OFFICIAL_DESTINATIONS, viewWith(FULL_PORTFOLIO), new Map());
    const destinations = rows.filter(r => r.category === "destination");
    assert.equal(destinations.length, 11);
    assert.ok(destinations.every(r => r.status === "matched"));
    assert.ok(destinationGatePassed(rows));
  });

  it("reports Bullring & Grand Central as one grouped row with two CRM ids", () => {
    const rows = reconcileBaseline(HAMMERSON_OFFICIAL_DESTINATIONS, viewWith(FULL_PORTFOLIO), new Map());
    const bullring = rows.find(r => r.destination_name === "Bullring & Grand Central")!;
    assert.equal(bullring.status, "matched");
    assert.deepEqual(bullring.crm_property_ids.sort(), ["P-BULLRING", "P-GCENTRAL"]);
    assert.equal(bullring.country, "GB");
  });

  it("is partial when only one of the grouped pair resolves", () => {
    const withoutGrandCentral = FULL_PORTFOLIO.filter(p => p.propertyId !== "P-GCENTRAL");
    const rows = reconcileBaseline(HAMMERSON_OFFICIAL_DESTINATIONS, viewWith(withoutGrandCentral), new Map());
    const bullring = rows.find(r => r.destination_name === "Bullring & Grand Central")!;
    assert.equal(bullring.status, "partial");
    assert.deepEqual(bullring.crm_property_ids, ["P-BULLRING"]);
    assert.ok(bullring.unresolved_differences.some(d => d.includes("grand central")));
    assert.ok(!destinationGatePassed(rows));
  });

  it("keeps development and disposed rows out of the destination gate", () => {
    const rows = reconcileBaseline(baselineWithDevDisposed(), viewWith(FULL_PORTFOLIO), new Map());
    const dev = rows.find(r => r.destination_name === "Sovereign Square Leeds")!;
    const disposed = rows.find(r => r.destination_name === "Brent South (Disposed)")!;
    assert.equal(dev.status, "unresolved");
    assert.equal(disposed.status, "unresolved");
    assert.ok(destinationGatePassed(rows)); // all 11 destinations still matched
  });

  it("appends extra CRM properties as extra_in_crm rows (symmetric reconciliation)", () => {
    const rows = reconcileBaseline(
      HAMMERSON_OFFICIAL_DESTINATIONS,
      viewWith([...FULL_PORTFOLIO, prop("P-HIGHCROSS", "Highcross")]),
      new Map([["P-HIGHCROSS", 7]]),
    );
    const extra = rows.find(r => r.destination_name === "Highcross")!;
    assert.equal(extra.status, "extra_in_crm");
    assert.equal(extra.media_count, 7);
  });

  it("never guesses on an ambiguous name match", () => {
    const dupe = [...FULL_PORTFOLIO.filter(p => p.propertyId !== "P-WESTQUAY"), prop("P-WQ1", "Westquay"), prop("P-WQ2", "Westquay Shopping Centre")];
    const rows = reconcileBaseline(HAMMERSON_OFFICIAL_DESTINATIONS, viewWith(dupe), new Map());
    const westquay = rows.find(r => r.destination_name === "Westquay")!;
    assert.equal(westquay.status, "unresolved");
    assert.ok(westquay.unresolved_differences.some(d => d.includes("ambiguous")));
    assert.deepEqual(westquay.crm_property_ids, []);
  });

  it("a tenant-rep deal at Brent Cross leaves bgp_instruction false (related activity, not an instruction)", () => {
    // The resolver classifies the tenant-rep letting into
    // relatedMarketActivity, so instructions carry no deal on P-BRENT.
    const rows = reconcileBaseline(HAMMERSON_OFFICIAL_DESTINATIONS, viewWith(FULL_PORTFOLIO, []), new Map());
    assert.equal(rows.find(r => r.destination_name === "Brent Cross")!.bgp_instruction, false);
    // With a genuine Hammerson instruction on the property, it flips.
    const instructed = reconcileBaseline(HAMMERSON_OFFICIAL_DESTINATIONS, viewWith(FULL_PORTFOLIO, ["P-BRENT"]), new Map());
    assert.equal(instructed.find(r => r.destination_name === "Brent Cross")!.bgp_instruction, true);
  });
});

describe("reconciliationDeniedForScope", () => {
  it("refuses any client-scoped request, allows staff (null scope)", () => {
    assert.equal(reconciliationDeniedForScope(null), false);
    assert.equal(reconciliationDeniedForScope("company-1"), true);
  });
});

describe("ensureBaselineSeeded", () => {
  function mockPool(existing: number) {
    const inserts: any[][] = [];
    return {
      inserts,
      async query(sql: string, params: any[] = []) {
        if (/COUNT/.test(sql)) return { rows: [{ n: existing }], rowCount: 1 };
        if (/INSERT INTO account_reconciliation_baselines/.test(sql)) { inserts.push(params); return { rows: [], rowCount: 1 }; }
        throw new Error(`unexpected query: ${sql}`);
      },
    };
  }

  it("seeds the 11 Hammerson destinations for the Hammerson account only", async () => {
    const pool = mockPool(0);
    const n = await ensureBaselineSeeded(pool, "HAM", "hammerson-official-destinations", "Hammerson plc");
    assert.equal(n, 11);
    assert.equal(pool.inserts.length, 11);
    const bullring = pool.inserts.find(p => p[2] === "Bullring & Grand Central")!;
    assert.equal(bullring[3], "bullring-grand-central");
    assert.equal(bullring[4], 2);
  });

  it("seeds nothing for other companies or when rows already exist", async () => {
    const other = mockPool(0);
    assert.equal(await ensureBaselineSeeded(other, "OTHER", "hammerson-official-destinations", "Landsec"), 0);
    assert.equal(other.inserts.length, 0);
    const seeded = mockPool(11);
    assert.equal(await ensureBaselineSeeded(seeded, "HAM", "hammerson-official-destinations", "Hammerson plc"), 11);
    assert.equal(seeded.inserts.length, 0);
  });
});
