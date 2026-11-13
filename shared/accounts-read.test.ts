/**
 * accounts-read.test.ts — the rule for reading a company's filed accounts
 * again when an earlier read came back with no figures, and for showing the
 * figures held on another record with the same company number.
 *
 * Run with: node --import tsx --test shared/accounts-read.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ACCOUNTS_FIGURE_KEYS, ACCOUNTS_MAX_EMPTY_READS, accountsFromSameEntity, accountsHaveFigures,
  accountsNoFiguresSql, accountsRetryDue, accountsRetryDueAt, emptyReadCount,
} from "./accounts-read";

const DAY = 86400000;
const empty = (extra: Record<string, any> = {}) => ({
  period: "Sat Dec 27", turnover: null, grossProfit: null, operatingProfit: null, profitBeforeTax: null,
  netAssets: null, cash: null, employees: null, rawText: "{\"period\": \"2025-12-27\", \"turnover\": \"not fou", ...extra,
});
const filled = { ...empty(), turnover: "£2,151m", profitBeforeTax: "£167.4m" };

describe("figures", () => {
  it("counts only text with a digit as a figure", () => {
    assert.equal(accountsHaveFigures(filled), true);
    assert.equal(accountsHaveFigures(empty()), false);
    assert.equal(accountsHaveFigures(empty({ turnover: "not found", cash: "n/a" })), false);
    assert.equal(accountsHaveFigures(empty({ employees: "33,000" })), true);
    assert.equal(accountsHaveFigures(null), false);
    assert.equal(accountsHaveFigures("£1m" as any), false);
  });
});

describe("empty read count", () => {
  it("is nothing when no read is stored or figures are held", () => {
    assert.equal(emptyReadCount(null), 0);
    assert.equal(emptyReadCount(filled), 0);
    assert.equal(emptyReadCount({ ...filled, emptyReads: 3 }), 0);
  });
  it("reads an empty result stored before the count was kept as one read, or two once marked final", () => {
    assert.equal(emptyReadCount(empty()), 1);
    assert.equal(emptyReadCount(empty({ retriedEmpty: true })), 2);
  });
  it("uses the kept count", () => {
    assert.equal(emptyReadCount(empty({ emptyReads: 3, retriedEmpty: true })), 3);
  });
});

describe("the retry rule", () => {
  const readAt = "2026-11-13T09:00:00.000Z";
  const at = (ms: number) => new Date(Date.parse(readAt) + ms);

  it("never retries a read that holds figures, or one that was never made", () => {
    assert.equal(accountsRetryDueAt(filled), null);
    assert.equal(accountsRetryDueAt(null), null);
    assert.equal(accountsRetryDue(filled, at(365 * DAY)), false);
  });
  it("tries again a day after the first empty read", () => {
    const first = empty({ emptyReads: 1, readAt });
    assert.equal(accountsRetryDue(first, at(DAY - 1)), false);
    assert.equal(accountsRetryDue(first, at(DAY)), true);
  });
  it("then weekly", () => {
    for (const reads of [2, 3]) {
      const later = empty({ emptyReads: reads, retriedEmpty: true, readAt });
      assert.equal(accountsRetryDue(later, at(DAY)), false, `read ${reads}, a day on`);
      assert.equal(accountsRetryDue(later, at(7 * DAY - 1)), false, `read ${reads}, just under a week`);
      assert.equal(accountsRetryDue(later, at(7 * DAY)), true, `read ${reads}, a week on`);
    }
  });
  it("stops after the last allowed empty read, however long ago", () => {
    assert.equal(ACCOUNTS_MAX_EMPTY_READS, 4);
    const last = empty({ emptyReads: ACCOUNTS_MAX_EMPTY_READS, retriedEmpty: true, readAt });
    assert.equal(accountsRetryDueAt(last), null);
    assert.equal(accountsRetryDue(last, at(400 * DAY)), false);
  });
  it("unfreezes an empty read stored before the rule: due at the next run", () => {
    // Greggs Plc as found on 13 November 2026: every figure null, marked final, no time kept.
    const frozen = empty({ retriedEmpty: true });
    assert.equal(accountsRetryDue(frozen, new Date("2026-11-14T04:00:00Z")), true);
    assert.equal(accountsRetryDue(empty(), new Date("2026-11-14T04:00:00Z")), true);
  });
  it("is not due on a time it cannot read as later than now", () => {
    assert.equal(accountsRetryDue(empty({ emptyReads: 2, readAt }), new Date(Date.parse(readAt) - DAY)), false);
  });
});

describe("the query's no-figures test", () => {
  it("names every figure and matches the function's digit rule", () => {
    const sql = accountsNoFiguresSql("x");
    for (const key of ACCOUNTS_FIGURE_KEYS) assert.ok(sql.includes(`x->>'${key}'`), key);
    assert.match(sql, /^NOT \(/);
    assert.equal((sql.match(/~ '\[0-9\]'/g) || []).length, ACCOUNTS_FIGURE_KEYS.length);
  });
});

describe("figures shown from another record with the same company number", () => {
  it("gives the figures, the other record's own accounts date, and nothing else", () => {
    const shown = accountsFromSameEntity({ ...filled, grossProfit: "not found", rawText: "raw reply", docId: "abc", readAt: "2026-06-01T00:00:00Z" }, "2025-12-27");
    assert.deepEqual(shown, {
      fromSameNumberRecord: true, period: "2025-12-27", turnover: "£2,151m", grossProfit: null, operatingProfit: null,
      profitBeforeTax: "£167.4m", netAssets: null, cash: null, employees: null,
    });
  });
  it("gives nothing when the other record has no figures either", () => {
    assert.equal(accountsFromSameEntity(empty({ retriedEmpty: true }), "2025-12-27"), null);
    assert.equal(accountsFromSameEntity(null, null), null);
  });
});
