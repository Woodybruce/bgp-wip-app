/**
 * brand-profile-deals.test.ts — deal totals independent of the 20-row cap.
 *
 * The company-profile endpoint caps its deal list at LIMIT 20, then used to
 * derive totalDeals / completedDeals / totalFees / team from that capped set,
 * classifying "completed" with a substring match (`includes("complet") ||
 * includes("won")`) that missed the canonical status codes. The fix aggregates
 * over the FULL scoped set with the canonical vocabulary from
 * shared/deal-status.ts (COM/INV completed; WIT/COM/INV closed).
 *
 * Run with: node --import tsx --test server/brand-profile-deals.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  COMPLETED_DEAL_STATUSES,
  isCompletedDealStatus,
  isActiveDealStatus,
  completedStatusSql,
  closedStatusSql,
  dealTotalsSql,
} from "./brand-profile-deals";
import { CLOSED_STATUSES, TERMINAL_STATUSES } from "../shared/deal-status";

describe("COMPLETED_DEAL_STATUSES", () => {
  it("is derived from the shared closed/terminal lists, not hand-rolled", () => {
    assert.deepEqual(
      COMPLETED_DEAL_STATUSES,
      CLOSED_STATUSES.filter((s) => !(TERMINAL_STATUSES as readonly string[]).includes(s)),
    );
  });

  it("is exactly COM and INV", () => {
    assert.deepEqual(COMPLETED_DEAL_STATUSES, ["COM", "INV"]);
  });
});

describe("isCompletedDealStatus", () => {
  it("accepts canonical completed codes", () => {
    assert.equal(isCompletedDealStatus("COM"), true);
    assert.equal(isCompletedDealStatus("INV"), true);
  });

  it("accepts lowercase canonical variants", () => {
    assert.equal(isCompletedDealStatus("com"), true);
    assert.equal(isCompletedDealStatus("inv"), true);
  });

  it("accepts legacy free-text variants", () => {
    assert.equal(isCompletedDealStatus("completed"), true);
    assert.equal(isCompletedDealStatus("Complete"), true);
    assert.equal(isCompletedDealStatus("let"), true);
    assert.equal(isCompletedDealStatus("invoiced"), true);
    assert.equal(isCompletedDealStatus("occupied"), true);
  });

  it("rejects archived/withdrawn statuses", () => {
    assert.equal(isCompletedDealStatus("WIT"), false);
    assert.equal(isCompletedDealStatus("wit"), false);
    assert.equal(isCompletedDealStatus("withdrawn"), false);
    assert.equal(isCompletedDealStatus("lost"), false);
    assert.equal(isCompletedDealStatus("dead"), false);
  });

  it("rejects live pipeline statuses", () => {
    for (const s of ["OPP", "REP", "SPEC", "LIVE", "AVA", "NEG", "HOT", "SOL", "EXC"]) {
      assert.equal(isCompletedDealStatus(s), false, s);
    }
  });

  it("rejects empty/unknown statuses", () => {
    assert.equal(isCompletedDealStatus(null), false);
    assert.equal(isCompletedDealStatus(undefined), false);
    assert.equal(isCompletedDealStatus(""), false);
    assert.equal(isCompletedDealStatus("   "), false);
    assert.equal(isCompletedDealStatus("nonsense"), false);
  });
});

describe("isActiveDealStatus", () => {
  it("treats closed statuses (WIT/COM/INV) as not active", () => {
    assert.equal(isActiveDealStatus("WIT"), false);
    assert.equal(isActiveDealStatus("COM"), false);
    assert.equal(isActiveDealStatus("INV"), false);
    assert.equal(isActiveDealStatus("withdrawn"), false);
    assert.equal(isActiveDealStatus("completed"), false);
  });

  it("treats live pipeline statuses as active", () => {
    for (const s of ["NEG", "HOT", "SOL", "EXC", "AVA", "LIVE"]) {
      assert.equal(isActiveDealStatus(s), true, s);
    }
  });

  it("treats empty/unknown statuses as active (prior convention)", () => {
    assert.equal(isActiveDealStatus(null), true);
    assert.equal(isActiveDealStatus(""), true);
    assert.equal(isActiveDealStatus("nonsense"), true);
  });
});

describe("completedStatusSql / closedStatusSql", () => {
  it("completed SQL matches canonical COM and INV, case-insensitively", () => {
    const sql = completedStatusSql("d.status");
    assert.match(sql, /UPPER\(BTRIM\(COALESCE\(d\.status, ''\)\)\) IN \('COM', 'INV'\)/);
  });

  it("completed SQL excludes WIT (withdrawn is closed, not completed)", () => {
    assert.doesNotMatch(completedStatusSql("d.status"), /'WIT'/);
  });

  it("closed SQL includes WIT, COM and INV", () => {
    const sql = closedStatusSql("d.status");
    for (const code of ["WIT", "COM", "INV"]) {
      assert.ok(sql.includes(`'${code}'`), code);
    }
  });
});

describe("dealTotalsSql", () => {
  const sql = dealTotalsSql(" AND (d.landlord_id = $2 OR d.vendor_id = $2 OR d.purchaser_id = $2)");

  it("runs over the full scoped set — no LIMIT", () => {
    assert.doesNotMatch(sql, /\bLIMIT\b/i);
  });

  it("keeps the same party-match WHERE as the list query", () => {
    assert.match(sql, /WHERE \(d\.tenant_id = \$1 OR d\.landlord_id = \$1 OR d\.vendor_id = \$1 OR d\.purchaser_id = \$1\)/);
  });

  it("embeds the client-counterparty scope clause verbatim", () => {
    assert.ok(sql.includes(" AND (d.landlord_id = $2 OR d.vendor_id = $2 OR d.purchaser_id = $2)"));
  });

  it("counts completed via the canonical COM/INV filter and completed_at", () => {
    assert.match(sql, /COUNT\(\*\) FILTER \(WHERE UPPER\(BTRIM\(COALESCE\(status, ''\)\)\) IN \('COM', 'INV'\) OR completed_at IS NOT NULL\)/);
  });

  it("counts active as NOT closed (WIT/COM/INV)", () => {
    assert.match(sql, /COUNT\(\*\) FILTER \(WHERE NOT UPPER\(BTRIM\(COALESCE\(status, ''\)\)\) IN \('WIT', 'COM', 'INV'\)\)/);
  });

  it("sums fees and unions distinct team + internal_agent members", () => {
    assert.match(sql, /COALESCE\(SUM\(fee\), 0\)::float AS total_fees/);
    assert.match(sql, /SELECT unnest\(s\.team\) AS m\s+UNION\s+SELECT unnest\(s\.internal_agent\)/);
    assert.match(sql, /SELECT DISTINCT m/);
  });

  it("works with an empty scope clause (staff view)", () => {
    const staffSql = dealTotalsSql("");
    assert.doesNotMatch(staffSql, /\$2/);
    assert.doesNotMatch(staffSql, /\bLIMIT\b/i);
  });
});
