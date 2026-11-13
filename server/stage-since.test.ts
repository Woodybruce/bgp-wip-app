// Days at stage and Last contact (Woody, 2026-11-13). The pure rules in
// shared/stage-since.ts and shared/last-contact.ts.
//   node --import tsx --test server/stage-since.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import {
  STAGE_BULK_PEERS, STAGE_SINCE_EARLIEST_YEARS, checkStageSinceInput, handSetApplies, isCalendarDay, londonDay,
  resolveStageSince, stageDaysLabel, stageDaysTitle,
} from "@shared/stage-since";
import { lastContactCell, lastContactSortValue, readLastContact } from "@shared/last-contact";

const CREATED = "2026-06-01T09:00:00.000Z";

test("which date wins: a hand-set date, then the deal's history, then its creation", () => {
  const hand = { date: "2026-09-01", code: "NEG", byName: "Victoria Bruce", setAt: "2026-11-13T10:00:00Z" };
  // Set by hand for the stage the deal is at.
  assert.deepEqual(resolveStageSince("NEG", { auditAt: "2026-10-27T09:15:00Z", auditPeers: 30, hand }, CREATED), {
    since: "2026-09-01", confirmed: true, source: "set", set: { date: "2026-09-01", byName: "Victoria Bruce" },
  });
  // No hand-set date: the latest status change.
  assert.deepEqual(resolveStageSince("NEG", { auditAt: "2026-11-03T09:15:00Z", auditPeers: 0 }, CREATED), {
    since: "2026-11-03T09:15:00Z", confirmed: true, source: "history", set: null,
  });
  // Neither: the fallback, never confirmed.
  assert.deepEqual(resolveStageSince("NEG", undefined, CREATED), { since: CREATED, confirmed: false, source: "none", set: null });
  assert.deepEqual(resolveStageSince("NEG", {}, null), { since: null, confirmed: false, source: "none", set: null });
});

test("the confirmed flag: a status change sharing its minute with 5 other deals is a bulk stamp", () => {
  assert.equal(STAGE_BULK_PEERS, 5);
  const at = "2026-10-27T09:15:00Z";
  assert.equal(resolveStageSince("NEG", { auditAt: at, auditPeers: 4 }, CREATED).confirmed, true);
  const bulk = resolveStageSince("NEG", { auditAt: at, auditPeers: 5 }, CREATED);
  assert.equal(bulk.confirmed, false);
  assert.equal(bulk.source, "bulk");
  // The date is still the one the days are counted from (a stuck deal is never hidden).
  assert.equal(bulk.since, at);
  // No count read (an older caller, a failed read): the single change stands.
  assert.equal(resolveStageSince("NEG", { auditAt: at }, CREATED).confirmed, true);
  assert.equal(resolveStageSince("NEG", { auditAt: at, auditPeers: null }, CREATED).confirmed, true);
});

test("a hand-set date applies only while the deal is at the stage it was set for", () => {
  const hand = { date: "2026-09-01", code: "NEG", byName: "Victoria Bruce", setAt: "2026-11-01T10:00:00Z" };
  assert.equal(handSetApplies("NEG", { hand }), true);
  // The deal moved on: its own history is used, and a single real move is confirmed by itself.
  const moved = resolveStageSince("HOT", { auditAt: "2026-11-10T14:00:00Z", auditPeers: 0, hand }, CREATED);
  assert.deepEqual(moved, { since: "2026-11-10T14:00:00Z", confirmed: true, source: "history", set: null });
  // It left Negotiating and came back after the date was set: the old date is not revived.
  const back = resolveStageSince("NEG", { auditAt: "2026-11-12T14:00:00Z", auditPeers: 0, hand }, CREATED);
  assert.equal(back.source, "history");
  assert.equal(back.set, null);
  // A status change BEFORE the date was set does not cancel it (that is the stamp it corrects).
  assert.equal(resolveStageSince("NEG", { auditAt: "2026-10-27T09:15:00Z", auditPeers: 30, hand }, CREATED).source, "set");
  // No record of when it was set: the stage code alone decides.
  assert.equal(handSetApplies("NEG", { auditAt: "2026-11-12T14:00:00Z", hand: { ...hand, setAt: null } }), true);
  // No code, no date, or a date that is not a day: nothing applies.
  assert.equal(handSetApplies(null, { hand }), false);
  assert.equal(handSetApplies("NEG", { hand: { ...hand, date: null } }), false);
  assert.equal(handSetApplies("NEG", { hand: { ...hand, date: "last month" } }), false);
  assert.equal(handSetApplies("NEG", { hand: { ...hand, code: null } }), false);
  assert.equal(handSetApplies("NEG", null), false);
});

test("setting the date: a real day, not in the future, not long before the deal existed", () => {
  const opts = { today: "2026-11-13", createdAt: CREATED };
  assert.deepEqual(checkStageSinceInput("2026-10-01", opts), { ok: true, date: "2026-10-01" });
  // Today is allowed; tomorrow is not.
  assert.deepEqual(checkStageSinceInput("2026-11-13", opts), { ok: true, date: "2026-11-13" });
  const future = checkStageSinceInput("2026-11-14", opts);
  assert.equal(future.ok, false);
  assert.match((future as any).error, /future/);
  // Before the deal was created is fine (it was running before it was put on the app) ...
  assert.equal(checkStageSinceInput("2025-01-15", opts).ok, true);
  assert.equal(STAGE_SINCE_EARLIEST_YEARS, 3);
  assert.equal(checkStageSinceInput("2023-06-01", opts).ok, true);
  // ... but not by more than the margin (a mistyped year).
  const early = checkStageSinceInput("2023-05-31", opts);
  assert.equal(early.ok, false);
  assert.match((early as any).error, /before the deal was created/);
  assert.equal(checkStageSinceInput("0206-10-01", opts).ok, false);
  // Nonsense is refused, not guessed at.
  for (const bad of ["yesterday", "01/10/2026", "2026-13-01", "2026-02-30", "2026-10-01T00:00:00Z", 20261001, true, {}, undefined]) {
    assert.equal(checkStageSinceInput(bad, opts).ok, false, `refuses ${JSON.stringify(bad)}`);
  }
  // null (or an empty box) clears it.
  assert.deepEqual(checkStageSinceInput(null, opts), { ok: true, date: null });
  assert.deepEqual(checkStageSinceInput("", opts), { ok: true, date: null });
  // A deal with no creation date has no floor.
  assert.equal(checkStageSinceInput("2019-01-01", { today: "2026-11-13" }).ok, true);
});

test("calendar days and London's today", () => {
  assert.equal(isCalendarDay("2024-02-29"), true);
  assert.equal(isCalendarDay("2026-02-29"), false);
  assert.equal(isCalendarDay("2026-2-9"), false);
  // 23:30 UTC on a summer evening is already the next day in London.
  assert.equal(londonDay(new Date("2026-07-01T23:30:00Z")), "2026-07-02");
  assert.equal(londonDay(new Date("2026-11-13T23:30:00Z")), "2026-11-13");
});

test("the figure and its title", () => {
  assert.equal(stageDaysLabel(17, true), "17d");
  assert.equal(stageDaysLabel(17, undefined), "17d");   // an older server answer: no flag, no question mark
  assert.equal(stageDaysLabel(17, false), "17d?");
  const base = { stage: "Negotiating", stuckDays: 30 };
  assert.equal(stageDaysTitle({ ...base, days: 17, confirmed: false, stuck: false, canSet: true }),
    "The app does not know when this deal reached Negotiating. Set the date.");
  assert.equal(stageDaysTitle({ ...base, days: 17, confirmed: false, stuck: false }),
    "The app does not know when this deal reached Negotiating.");
  // Still stuck, and the title says the date is unconfirmed.
  const stuck = stageDaysTitle({ ...base, days: 87, confirmed: false, stuck: true, canSet: true });
  assert.match(stuck, /^The app does not know when this deal reached Negotiating\./);
  assert.match(stuck, /87 days, which counts as stuck \(30 days or more\), but that date is unconfirmed\. Set the date\.$/);
  assert.equal(stageDaysTitle({ ...base, days: 45, confirmed: true, stuck: true }), "At Negotiating for 45 days: stuck (30 days or more)");
  assert.equal(stageDaysTitle({ ...base, days: 1, confirmed: true, stuck: false }), "At Negotiating for 1 day");
  assert.equal(stageDaysTitle({ ...base, days: 12, confirmed: true, stuck: false, isSet: true, setByName: "Victoria Bruce", canSet: true }),
    "At Negotiating for 12 days. Date set by Victoria Bruce. Press to change the date");
  assert.equal(stageDaysTitle({ days: 3, stuck: false, stuckDays: 30 }), "At this stage for 3 days");
});

// ── Last contact ─────────────────────────────────────────────────────────
const NOW = Date.parse("2026-11-13T12:00:00Z");

test("last contact: a past date is the last contact, a date ahead is Next, never a minus figure", () => {
  assert.deepEqual(readLastContact(null, NOW), { kind: "none" });
  assert.deepEqual(readLastContact("", NOW), { kind: "none" });
  assert.deepEqual(readLastContact("not a date", NOW), { kind: "text", text: "not a date" });
  assert.deepEqual(readLastContact("2026-10-12T09:00:00Z", NOW), { kind: "last", at: Date.parse("2026-10-12T09:00:00Z"), days: 32 });
  assert.deepEqual(readLastContact("2027-02-12T09:00:00Z", NOW), { kind: "next", at: Date.parse("2027-02-12T09:00:00Z") });

  const past = lastContactCell("2026-10-12T09:00:00Z", NOW);
  assert.equal(past.kind, "last");
  assert.equal(past.label, "5w");
  assert.equal(past.title, "Last contact 12 Oct 2026, from the app's reading of emails and meetings");
  assert.equal(lastContactCell("2026-11-13T08:00:00Z", NOW).label, "today");
  assert.equal(lastContactCell("2026-11-06T12:00:00Z", NOW).label, "7d");

  const ahead = lastContactCell("2027-02-12T09:00:00Z", NOW);
  assert.equal(ahead.kind, "next");
  assert.equal(ahead.label, "Next: 12 Feb");
  assert.match(ahead.title, /^A meeting or email dated ahead/);
  assert.doesNotMatch(ahead.label, /-/);

  assert.deepEqual(lastContactCell(null, NOW), { kind: "none", label: "—", title: "", days: null });
  assert.equal(lastContactCell("not a date", NOW).kind, "none");
});

test("last contact: a sort treats a date ahead as the newest", () => {
  const rows = ["2026-10-12T09:00:00Z", "2027-02-12T09:00:00Z", null, "2026-11-01T09:00:00Z", "garbage"];
  const sorted = rows.map(v => lastContactSortValue(v)).filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime());
  assert.equal(sorted[0].toISOString(), "2027-02-12T09:00:00.000Z");
  assert.equal(lastContactSortValue(null), null);
  assert.equal(lastContactSortValue("garbage"), null);
});
