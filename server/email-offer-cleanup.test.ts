// The rule for the offers left by the 14 August 2026 email import (Woody,
// 19 November 2026, chose an admin Preview then Apply to clear them): which
// rows are still exactly as the import wrote them, which are credited to a
// brand and listed on their own, and every way a person's touch keeps a row.
import test from "node:test";
import assert from "node:assert/strict";
import {
  OFFER_TERM_COLUMNS, cleanupGroup, importSubject, isBlankFirstRound, isImportOffer, mayClear, threadKeeper, threadKey, touchedBecause,
  type ImportOfferFacts, type ImportRound, type ThreadRow,
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

// One email thread on one unit is one offer (Woody, 2026-11-19: "these are
// actual offers but its picking up all the emails so shows hundred of entries
// for each offer").

test("a thread is its subject without reply and forward prefixes, case or spacing", () => {
  const one = threadKey("Re: One New Change - House of Dice offer");
  for (const s of ["RE: One New Change - House of Dice offer", "One New Change - House of Dice offer", "Re: RE: Fwd: One New Change - House of Dice offer",
    "FW:  One New Change  -  House of Dice offer", "re[2]: one new change - house of dice offer", "AW: One New Change - House of Dice offer"]) {
    assert.equal(threadKey(s), one, s);
  }
  assert.notEqual(threadKey("Re: One New Change - Bloom offer"), one);
  assert.equal(threadKey("Offer: Regent Street"), "offer: regent street", "a word that is not a prefix stays");
  assert.equal(threadKey(null), "");
});

const thread = (rows: Array<Partial<ThreadRow> & { id: string }>): ThreadRow[] =>
  rows.map(r => ({ offerDate: "2026-06-29", group: "clear", creditedToBrand: false, ...r }));

test("one untouched row is kept as the thread's offer: the first email", () => {
  assert.deepEqual(threadKeeper(thread([{ id: "b", offerDate: "2026-07-02" }, { id: "a", offerDate: "2026-06-29" }, { id: "c", offerDate: "2026-07-01" }])),
    { keeperId: "a", chosen: true });
  assert.deepEqual(threadKeeper(thread([{ id: "b" }, { id: "a" }])), { keeperId: "a", chosen: true }, "the same day: the lowest id");
  assert.deepEqual(threadKeeper(thread([{ id: "a", offerDate: null }, { id: "b", offerDate: "2026-07-02" }])), { keeperId: "b", chosen: true }, "a dated email before one with no date");
});

test("a row credited to a brand is kept before an earlier one credited to nobody", () => {
  assert.deepEqual(threadKeeper(thread([{ id: "a", offerDate: "2026-06-01" }, { id: "b", group: "brand", creditedToBrand: true, offerDate: "2026-06-20" }])),
    { keeperId: "b", chosen: true });
});

test("a row a person has worked on stands for the offer, so every untouched row is a copy", () => {
  assert.deepEqual(threadKeeper(thread([{ id: "a" }, { id: "b", group: "kept", offerDate: "2026-07-05" }, { id: "c" }])), { keeperId: "b", chosen: false });
});

test("a thread of one email keeps it; an empty thread keeps nothing", () => {
  assert.deepEqual(threadKeeper(thread([{ id: "only" }])), { keeperId: "only", chosen: true });
  assert.deepEqual(threadKeeper([]), { keeperId: null, chosen: false });
});
