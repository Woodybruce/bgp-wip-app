/**
 * brand-preparation-stages.test.ts — Delivery 4 Task 5: portfolio &
 * financials stages, source/freshness on stage state, page-open enqueue.
 *
 * nextPreparationState and shouldEnqueueOnPageOpen are pure (static import);
 * the applicability helpers come from brand-enrichment, which imports the
 * db pool at module level — dummy DATABASE_URL + dynamic import, the pool is
 * never queried (same pattern as account-deals.test.ts).
 *
 * Run with: node --import tsx --test server/brand-preparation-stages.test.ts
 */
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { nextPreparationState, shouldEnqueueOnPageOpen, BRAND_PREPARATION_STAGES } from "./brand-preparation-jobs";

let isPortfolioStageApplicable: typeof import("./brand-enrichment").isPortfolioStageApplicable;
let isFinancialsStageApplicable: typeof import("./brand-enrichment").isFinancialsStageApplicable;
before(async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://test:test@localhost:1/test";
  ({ isPortfolioStageApplicable, isFinancialsStageApplicable } = await import("./brand-enrichment"));
});

describe("stage list", () => {
  it("gains portfolio and financials, appended so existing keys are untouched", () => {
    assert.deepEqual(BRAND_PREPARATION_STAGES.slice(0, 9), ["identity", "profile", "apollo", "rocketreach", "stores", "images", "logo", "brief", "contacts"]);
    assert.deepEqual(BRAND_PREPARATION_STAGES.slice(9), ["portfolio", "financials"]);
  });
});

describe("stage applicability", () => {
  it("portfolio is landlord-vocabulary only", () => {
    for (const t of ["Landlord", "Landlord/Freeholder", "Investor", "REIT", "Developer", "Fund"]) {
      assert.equal(isPortfolioStageApplicable({ company_type: t }), true, t);
    }
    assert.equal(isPortfolioStageApplicable({ company_type: "Tenant" }), false);
    assert.equal(isPortfolioStageApplicable({ company_type: "tenant (retail)" }), false);
    assert.equal(isPortfolioStageApplicable({ company_type: null }), false);
    assert.equal(isPortfolioStageApplicable({}), false);
  });

  it("financials requires a non-empty stored ticker", () => {
    assert.equal(isFinancialsStageApplicable({ stock_ticker: "LAND.L" }), true);
    assert.equal(isFinancialsStageApplicable({ stock_ticker: "  HMSO " }), true);
    assert.equal(isFinancialsStageApplicable({ stock_ticker: "" }), false);
    assert.equal(isFinancialsStageApplicable({ stock_ticker: "   " }), false);
    assert.equal(isFinancialsStageApplicable({ stock_ticker: null }), false);
    assert.equal(isFinancialsStageApplicable({}), false);
  });
});

describe("nextPreparationState source propagation", () => {
  const now = new Date("2026-09-21T10:00:00Z");

  it("keeps the source on ready", () => {
    const s = nextPreparationState({}, { status: "ready", source: "landlord website scrape" }, now);
    assert.equal(s.source, "landlord website scrape");
    assert.ok(s.lastSuccessAt);
  });

  it("keeps the source on no_match and needs_review", () => {
    assert.equal(nextPreparationState({}, { status: "no_match", source: "Yahoo Finance", reason: "nope" }, now).source, "Yahoo Finance");
    assert.equal(nextPreparationState({}, { status: "needs_review", source: "Apollo" }, now).source, "Apollo");
  });

  it("retains the previous source when the outcome doesn't restate it", () => {
    const s = nextPreparationState({ source: "logo.dev" }, { status: "ready" }, now);
    assert.equal(s.source, "logo.dev");
  });

  it("clears the source on error — a failure never advertises a source it didn't use", () => {
    const s = nextPreparationState({ source: "Yahoo Finance" }, { status: "error", reason: "providers down" }, now);
    assert.equal(s.source, null);
    assert.equal(s.lastError, "providers down");
    assert.equal(s.failures, 1);
  });
});

describe("shouldEnqueueOnPageOpen", () => {
  const now = new Date("2026-09-21T10:00:00Z");
  const past = new Date(now.getTime() - 60000).toISOString();
  const future = new Date(now.getTime() + 86400000).toISOString();

  it("cold account (pending stages) enqueues once", () => {
    assert.equal(shouldEnqueueOnPageOpen([{ status: "pending" }, { status: "ready", nextAttemptAt: future }], false, now), true);
  });

  it("a due stage (nextAttemptAt in the past) enqueues", () => {
    assert.equal(shouldEnqueueOnPageOpen([{ status: "error", nextAttemptAt: past }], false, now), true);
  });

  it("everything fresh and in cooldown → no enqueue", () => {
    assert.equal(shouldEnqueueOnPageOpen([
      { status: "ready", nextAttemptAt: future },
      { status: "no_match", nextAttemptAt: future },
      { status: "needs_review", nextAttemptAt: future },
    ], false, now), false);
  });

  it("a running stage suppresses the enqueue", () => {
    assert.equal(shouldEnqueueOnPageOpen([{ status: "running" }, { status: "pending" }], false, now), false);
  });

  it("an existing request marker suppresses the enqueue — enqueue once, not on every visit", () => {
    assert.equal(shouldEnqueueOnPageOpen([{ status: "pending" }], true, now), false);
  });

  it("empty applicable stage list → no enqueue", () => {
    assert.equal(shouldEnqueueOnPageOpen([], false, now), false);
  });

  it("ready stage with no nextAttemptAt is not due", () => {
    assert.equal(shouldEnqueueOnPageOpen([{ status: "ready" }], false, now), false);
  });
});
