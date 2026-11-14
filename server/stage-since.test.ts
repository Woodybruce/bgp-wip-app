// Days at stage and Last contact (Woody, 2026-11-13). The pure rules in
// shared/stage-since.ts and shared/last-contact.ts.
//   node --import tsx --test server/stage-since.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  STAGE_BULK_PEERS, STAGE_SINCE_EARLIEST_YEARS, STATUS_LINE_NOT_A_MOVE, checkStageSinceInput, handSetApplies, isCalendarDay, londonDay,
  resolveStageSince, stageDaysLabel, stageDaysTitle, statusLineIsMove, statusLineIsMoveSql,
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
  assert.equal(stageDaysLabel(17, undefined), "17d");
  assert.equal(stageDaysLabel(17, false), "17d");   // no question mark (Woody, 2026-11-13)
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

// Review, 2026-11-13: the Deals list filled an empty last_interaction with
// the deal's last edit, and the column said it came from emails and meetings.
// The list now says where the date came from (lastContactSource).
test("last contact: a deal's last edit is never drawn or sorted as a contact", () => {
  const edit = lastContactCell("2026-10-27T09:00:00Z", NOW, "edit");
  assert.deepEqual(edit, { kind: "unread", label: "No contact read yet", title: "No email or meeting read yet. Deal last changed 27 Oct 2026", days: null });
  assert.doesNotMatch(edit.title, /reading of emails/);
  // With no edit date at all the words are the same, with no date to give.
  assert.deepEqual(lastContactCell(null, NOW, "edit"), { kind: "unread", label: "No contact read yet", title: "No email or meeting read yet.", days: null });
  // It sorts as no date, so it never sits among the deals someone has spoken to.
  assert.equal(lastContactSortValue("2026-10-27T09:00:00Z", "edit"), null);
  assert.equal(lastContactSortValue("2026-10-27T09:00:00Z", "read")?.toISOString(), "2026-10-27T09:00:00.000Z");
  assert.equal(lastContactSortValue("2026-10-27T09:00:00Z")?.toISOString(), "2026-10-27T09:00:00.000Z");
});

test("last contact: a stored reading says so, a deal event says what it is", () => {
  const read = lastContactCell("2026-10-12T09:00:00Z", NOW, "read");
  assert.equal(read.kind, "last");
  assert.equal(read.title, "Last contact 12 Oct 2026, from the app's reading of emails and meetings");
  const event = lastContactCell("2026-10-12T09:00:00Z", NOW, "event");
  assert.equal(event.kind, "activity");
  assert.equal(event.label, "5w");
  assert.equal(event.title, "Latest activity on the deal 12 Oct 2026 (a stage change, heads of terms or a document). No email or meeting read yet");
  assert.equal(lastContactSortValue("2026-10-12T09:00:00Z", "event")?.toISOString(), "2026-10-12T09:00:00.000Z");
  // A stored date ahead is still Next, whatever the source.
  assert.equal(lastContactCell("2027-02-12T09:00:00Z", NOW, "read").kind, "next");
});

// ── A refused move is not a move ─────────────────────────────────────────
// Review, 2026-11-13: the board mirror writes a 'status' line when a move is
// blocked or skipped and the deal stays where it is. That line cancelled the
// date a person set and restarted the days as a confirmed date.
test("a blocked, skipped or rejected status line is not a move", () => {
  for (const reason of [null, undefined, "", "Board mirror (leasing schedule)", "Bulk update", "Unblocked by the MLRO"]) assert.equal(statusLineIsMove(reason), true, String(reason));
  for (const reason of [
    "Approval rejected by Woody Bruce", "Blocked — AML checks are not complete (leasing minutes import)",
    "Blocked — gate check failed (timeout) (leasing archive)", "Skipped — deal is COM; tracker row left as-is (board edit)",
  ]) assert.equal(statusLineIsMove(reason), false, reason);
  assert.deepEqual([...STATUS_LINE_NOT_A_MOVE], ["Approval rejected", "Blocked —", "Skipped —"]);
  assert.equal(statusLineIsMoveSql(), "(reason IS NULL OR (reason NOT LIKE 'Approval rejected%' AND reason NOT LIKE 'Blocked —%' AND reason NOT LIKE 'Skipped —%'))");
  assert.match(statusLineIsMoveSql("a"), /^\(a\.reason IS NULL OR \(a\.reason NOT LIKE 'Approval rejected%' AND a\.reason NOT LIKE 'Blocked —%' AND a\.reason NOT LIKE 'Skipped —%'\)\)$/);
});

// The words the mirror really writes open with the words the rule refuses.
test("the mirror's own refusal lines open with the words the rule knows", () => {
  const mirror = readFileSync(new URL("./lease-status-mirror.ts", import.meta.url), "utf8");
  assert.match(mirror, /`Skipped — deal is \$\{currentCode\}/);
  assert.match(mirror, /`Blocked — gate check failed/);
  assert.match(mirror, /`Blocked — \$\{denial\.error\}/);
});

// The server's reading of the facts, with the database faked: both halves of
// the history query leave out the refused lines, and a deal whose only
// 'status' line is a refused move keeps its hand-set date.
type FakeRows = { history?: any[]; set?: any[]; entered?: any[] };
async function withFakeDb(rows: FakeRows) {
  process.env.DATABASE_URL ||= "postgres://test:test@127.0.0.1:1/test";
  const { stageSinceFor, stageDatesForDeals } = await import("./landsec-unit");
  const asked: { tag: string; sql: string }[] = [];
  const db = { async query(sql: string) {
    const tag = sql.match(/\/\* stage-since:([a-z]+) \*\//)?.[1] || "untagged";
    asked.push({ tag, sql });
    return { rows: (rows as any)[tag] || [] };
  } };
  return { stageSinceFor, stageDatesForDeals, db, asked };
}

test("stageSinceFor: the history query counts only real moves, in both of its halves", async () => {
  const { stageSinceFor, db, asked } = await withFakeDb({
    // What the database gives once the blocked line is left out: no status change for the deal.
    history: [],
    set: [{ deal_id: "d1", stage_since: "2026-09-01", stage_since_code: "HOT", stage_since_by_name: "Victoria Broadhead", set_at: "2026-11-01T10:00:00Z" }],
  });
  const facts = await stageSinceFor(["d1"], db);
  const history = asked.find(a => a.tag === "history")!.sql;
  assert.equal(history.split(statusLineIsMoveSql()).length - 1, 1, "the latest change per deal");
  assert.equal(history.split(statusLineIsMoveSql("a")).length - 1, 1, "the deals sharing its minute");
  assert.doesNotMatch(history.replace(statusLineIsMoveSql(), "").replace(statusLineIsMoveSql("a"), ""), /reason/);
  // The hand-set date stands: nothing later than it counts as a move.
  assert.deepEqual(resolveStageSince("HOT", facts.get("d1"), CREATED), { since: "2026-09-01", confirmed: true, source: "set", set: { date: "2026-09-01", byName: "Victoria Broadhead" } });
});

// Review, 2026-11-13: phone deal cards outside the Landsec view kept their
// own copy of the old rule (GET /api/crm/deals, statusChangedAt). They now
// read the same answer as every other screen.
test("stageDatesForDeals: the Deals list gets the one rule's date and its confirmed flag", async () => {
  const { stageDatesForDeals, db } = await withFakeDb({
    history: [
      { deal_id: "hand", latest: new Date("2026-08-18T09:15:00Z"), peers: 30 },
      { deal_id: "bulk", latest: new Date("2026-08-18T09:15:00Z"), peers: 30 },
      { deal_id: "moved", latest: new Date("2026-11-03T14:00:00Z"), peers: 0 },
    ],
    set: [{ deal_id: "hand", stage_since: "2026-11-01", stage_since_code: "NEG", stage_since_by_name: "Victoria Broadhead", set_at: "2026-11-13T10:00:00Z" }],
    entered: [{ id: "entered", stage_entered_at: new Date("2026-07-01T00:00:00Z") }],
  });
  const dates = await stageDatesForDeals([
    { id: "hand", status: "NEG", createdAt: CREATED }, { id: "bulk", status: "Negotiating", createdAt: CREATED }, { id: "moved", status: "HOT", createdAt: CREATED },
    { id: "new", status: "AVA", createdAt: CREATED }, { id: "entered", status: "SOL", createdAt: CREATED }, { id: "nothing", status: "NEG", createdAt: null },
  ], db);
  // Set by hand 12 days ago: that date, confirmed, not the bulk stamp of 87 days ago.
  assert.deepEqual(dates.get("hand"), { since: "2026-11-01", confirmed: true });
  // A bulk stamp: the date, with the question mark.
  assert.deepEqual(dates.get("bulk"), { since: "2026-08-18T09:15:00.000Z", confirmed: false });
  assert.deepEqual(dates.get("moved"), { since: "2026-11-03T14:00:00.000Z", confirmed: true });
  // No status change: the deal's stage timestamp, else its creation, never confirmed.
  assert.deepEqual(dates.get("entered"), { since: "2026-07-01T00:00:00.000Z", confirmed: false });
  assert.deepEqual(dates.get("new"), { since: CREATED, confirmed: false });
  assert.equal(dates.has("nothing"), false);
  assert.equal(stageDaysLabel(87, dates.get("bulk")!.confirmed), "87d");
  assert.equal(stageDaysLabel(12, dates.get("hand")!.confirmed), "12d");
});

// The list route itself: it sets the two fields from that helper and no
// longer keeps a query of its own, and it marks where Last contact came from
// without touching the stored value (the edit form saves it back).
test("the Deals list route uses the one rule and marks the contact source", () => {
  const crm = readFileSync(new URL("./crm.ts", import.meta.url), "utf8");
  const start = crm.indexOf(`app.get("/api/crm/deals", async`);
  const route = crm.slice(start, crm.indexOf(`if (scopeCompanyId) {`, start));
  assert.match(route, /stageDatesForDeals\(/);
  assert.match(route, /d\.statusChangedConfirmed = /);
  assert.doesNotMatch(route, /FROM deal_audit_log/);
  assert.match(route, /d\.lastContactSource = d\.lastInteraction \? "read" : event \? "event" : "edit"/);
  assert.doesNotMatch(route, /d\.lastInteraction = /);
});

// Board cards and the scheme unit list pass the flag on, so a bulk-stamp
// date reads the same there as it does on the Deals table (greyed, no question mark).
test("the board card and the scheme unit list draw an unconfirmed date with the question mark", () => {
  const board = readFileSync(new URL("../client/src/components/deal-kanban.tsx", import.meta.url), "utf8");
  assert.match(board, /<DaysChip code=\{clock\.code\} days=\{clock\.days\} confirmed=\{clock\.stageConfirmed\}/);
  const units = readFileSync(new URL("../client/src/components/landsec/scheme-units.tsx", import.meta.url), "utf8");
  assert.match(units, /<StageChip code=\{deal\.code\} days=\{deal\.days\} confirmed=\{deal\.stageConfirmed\}/);
  assert.match(units, /days: number \| null; stageConfirmed\?: boolean/);
  // The phone card outside the Landsec view writes the same mark.
  const deals = readFileSync(new URL("../client/src/pages/deals.tsx", import.meta.url), "utf8");
  assert.match(deals, /stageDaysLabel\(statusDays, !statusUnsure\)\} in /);
});
