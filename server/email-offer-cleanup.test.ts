// The rule for the offers left by the 14 August 2026 email import (Woody,
// 19 November 2026, chose an admin Preview then Apply to clear them): which
// rows are still exactly as the import wrote them, which are credited to a
// brand and listed on their own, and every way a person's touch keeps a row.
import test from "node:test";
import assert from "node:assert/strict";
import {
  OFFER_TERM_COLUMNS, cleanupGroup, importSubject, isBlankFirstRound, isImportOffer, mayClear, touchedBecause,
  type ImportOfferFacts, type ImportRound,
} from "../shared/email-offer-cleanup";

const importRow = (over: Partial<ImportOfferFacts> = {}): ImportOfferFacts => ({
  source: "email",
  comments: 'Backfilled from synced email: "RE: Unit 4 Cathedral Walk - offer" — figures need confirming.',
  emailConversationId: "int_8c1d2e3f",
  status: "Pending",
  confirmedAt: null,
  agreedAt: null,
  agreedByUserId: null,
  agreedByName: null,
  terms: Object.fromEntries(OFFER_TERM_COLUMNS.map(c => [c, null])),
  viewingId: null,
  updatedAt: null,
  rounds: [],
  hotsOffer: false,
  recommendationOffer: false,
  loggedFromComment: false,
  creditedToBrand: false,
  ...over,
});

const blankRound: ImportRound = { roundNo: 1, party: "tenant", createdByUserId: null, createdByName: null, note: null, hasTerms: false, edited: false };

test("an import row nobody has touched is cleared", () => {
  assert.deepEqual(cleanupGroup(importRow()), { group: "clear", keptBecause: [] });
  assert.equal(mayClear("clear"), true);
});

test("one credited to a tenant brand is listed on its own, still clearable", () => {
  assert.deepEqual(cleanupGroup(importRow({ creditedToBrand: true })), { group: "brand", keptBecause: [] });
  assert.equal(mayClear("brand"), true);
  assert.equal(mayClear("kept"), false);
});

test("only the import's own rows count: the live inbox sweep and offers people logged never do", () => {
  assert.equal(isImportOffer(importRow()), true);
  const sweep = importRow({ comments: "Detected in peter@brucegillinghampollard.com's inbox: \"Offer\" — figures need confirming from the email/heads of terms.", emailConversationId: "conv_AAQk" });
  assert.equal(isImportOffer(sweep), false);
  assert.deepEqual(cleanupGroup(sweep), { group: "kept", keptBecause: ["not from the 14 August import"] });
  assert.equal(isImportOffer(importRow({ source: null })), false, "a person's offer has no source");
  // A person who rewrote the comment does not hide the row: it is kept, and says why.
  assert.equal(isImportOffer(importRow({ comments: "Starbucks offer, see email" })), true);
  assert.equal(isImportOffer(importRow({ emailConversationId: "conv_x" })), false, "the import's key is int_<interaction id>");
  assert.equal(isImportOffer(importRow({ emailConversationId: null })), false);
});

test("the subject is read back from the import's comment, quotes inside it included", () => {
  assert.equal(importSubject('Backfilled from synced email: "RE: F45 White City Place | Strong" — figures need confirming.'), "RE: F45 White City Place | Strong");
  assert.equal(importSubject('Backfilled from synced email: "The "Eclectic" offer" — figures need confirming.'), 'The "Eclectic" offer');
  assert.equal(importSubject('Backfilled from synced email: "" — figures need confirming.'), "");
  assert.equal(importSubject("Starbucks at £95k, 10 years"), null);
  assert.equal(importSubject(null), null);
});

test("each thing a person can do to an offer keeps it", () => {
  const cases: Array<[Partial<ImportOfferFacts>, string]> = [
    [{ status: "Negotiating" }, "status is Negotiating"],
    [{ status: "Rejected" }, "status is Rejected"],
    [{ status: "Closed" }, "status is Closed"],
    [{ confirmedAt: new Date("2026-09-01T10:00:00Z") }, "confirmed by a person"],
    [{ agreedAt: new Date("2026-09-01T10:00:00Z") }, "terms agreed"],
    [{ agreedByName: "Millie Edwards" }, "terms agreed"],
    [{ viewingId: "v1" }, "linked to a viewing"],
    [{ updatedAt: new Date("2026-11-13T09:00:00Z") }, "saved since the import"],
    [{ comments: 'Backfilled from synced email: "RE: Unit 4" — figures need confirming. Starbucks £95k' }, "comments edited"],
    [{ comments: "Starbucks offer, see email" }, "comments edited"],
    [{ hotsOffer: true }, "the unit's Heads of Terms name it"],
    [{ recommendationOffer: true }, "a recommendation names it"],
    [{ loggedFromComment: true }, "logged from a comment"],
  ];
  for (const [over, reason] of cases) {
    const verdict = cleanupGroup(importRow(over));
    assert.equal(verdict.group, "kept", reason);
    assert.ok(verdict.keptBecause.includes(reason), `${reason}: ${verdict.keptBecause.join(", ")}`);
  }
});

test("any term entered keeps it, text or figure", () => {
  for (const column of OFFER_TERM_COLUMNS) {
    const value = ["break_option", "incentives", "rent_review", "rent_deposit"].includes(column) ? "5 yr TBO" : 0;
    const verdict = cleanupGroup(importRow({ terms: { ...importRow().terms, [column]: value } }));
    assert.deepEqual(verdict, { group: "kept", keptBecause: ["terms entered"] }, column);
  }
  // A blank text box is not a term.
  assert.equal(cleanupGroup(importRow({ terms: { ...importRow().terms, break_option: "  " } })).group, "clear");
});

test("a status left blank reads as Pending, as the tracker reads it", () => {
  assert.equal(cleanupGroup(importRow({ status: null })).group, "clear");
  assert.equal(cleanupGroup(importRow({ status: "pending" })).group, "clear");
});

test("the blank round 1 written by opening the negotiation log is not a touch", () => {
  assert.equal(isBlankFirstRound(blankRound), true);
  assert.equal(cleanupGroup(importRow({ rounds: [blankRound] })).group, "clear");
});

test("a logged position keeps it: a second round, an author, a note, terms or an edit", () => {
  const touched: ImportRound[][] = [
    [blankRound, { ...blankRound, roundNo: 2, party: "landlord" }],
    [{ ...blankRound, createdByUserId: "u1" }],
    [{ ...blankRound, createdByName: "Alex Todd" }],
    [{ ...blankRound, note: "Countered at £100k" }],
    [{ ...blankRound, hasTerms: true }],
    [{ ...blankRound, edited: true }],
    [{ ...blankRound, party: "landlord" }],
    [{ ...blankRound, roundNo: 2 }],
  ];
  for (const rounds of touched) {
    assert.deepEqual(cleanupGroup(importRow({ rounds })), { group: "kept", keptBecause: ["negotiation logged"] }, JSON.stringify(rounds));
  }
});

test("every reason is listed, not just the first", () => {
  const why = touchedBecause(importRow({ status: "Agreed", agreedAt: new Date(), terms: { ...importRow().terms, rent_pa: 95000 }, hotsOffer: true }));
  assert.deepEqual(why, ["status is Agreed", "terms agreed", "terms entered", "the unit's Heads of Terms name it"]);
});

test("a touched row credited to a brand is kept, not listed with the brands", () => {
  assert.equal(cleanupGroup(importRow({ creditedToBrand: true, status: "Rejected" })).group, "kept");
});
