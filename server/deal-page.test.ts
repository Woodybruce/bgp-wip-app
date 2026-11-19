// The deal page's rules (Woody, 18 November 2026: "need full time line of
// deal tracking from marketing to completion"; docs/deal-page-review-2026-11-18.md):
// the stage strip, the letting's window on a re-marketed unit, what the
// timeline sends each login and which sections each login gets.
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildStageStrip, dealPageSections, eventsForViewer, hotsStageOf, inLettingWindow, lettingWindow, owedItems, sortEvents,
  type DealChecklistView, type DealEvent, type StageMove,
} from "../shared/deal-page";

const now = new Date("2026-11-18T12:00:00Z");
const move = (to: StageMove["to"], at: string, extra: Partial<StageMove> = {}): StageMove => ({ from: null, to, at, byName: "Jack", confirmed: true, ...extra });

test("the strip: the stages a letting has passed, the one it is at and those ahead", () => {
  const strip = buildStageStrip({
    status: "HOT", dealType: "New Letting", team: ["Shopping Centre"],
    moves: [move("NEG", "2026-10-01T10:00:00Z", { from: "AVA" }), move("HOT", "2026-11-01T10:00:00Z", { from: "NEG", byName: "Millie" })],
    since: "2026-11-01T10:00:00Z", sinceConfirmed: true,
    dates: { instructedAt: "2026-09-01T00:00:00Z", targetDate: "2026-12-15" }, now,
  });
  assert.deepEqual(strip.steps.map(s => s.code), ["AVA", "NEG", "HOT", "SOL", "EXC", "COM", "INV"]);
  assert.deepEqual(strip.steps.map(s => s.state), ["done", "done", "current", "ahead", "ahead", "ahead", "ahead"]);
  // Marketing on a letting reads "Marketing"; it was reached when instructed.
  assert.equal(strip.steps[0].label, "Marketing");
  assert.equal(strip.steps[0].reachedAt, "2026-09-01T00:00:00.000Z");
  assert.equal(strip.steps[0].days, 30);
  assert.equal(strip.steps[1].days, 31);
  assert.equal(strip.steps[2].byName, "Millie");
  assert.equal(strip.steps[2].days, 17);
  // The target date sits against the next step.
  assert.equal(strip.steps[3].target, "2026-12-15T00:00:00.000Z");
  assert.equal(strip.outcome, null);
  assert.equal(strip.before, null);
});

test("the stage it is at takes the days-at-stage date; a bulk-stamped move is not confirmed", () => {
  const strip = buildStageStrip({
    status: "SOL", dealType: "New Letting", team: null,
    moves: [move("NEG", "2026-10-01T10:00:00Z", { confirmed: false }), move("SOL", "2026-11-10T09:00:00Z")],
    since: "2026-11-12T00:00:00Z", sinceConfirmed: false, dates: {}, now,
  });
  const sol = strip.steps.find(s => s.code === "SOL")!;
  assert.equal(sol.state, "current");
  assert.equal(sol.reachedAt, "2026-11-12T00:00:00.000Z");
  assert.equal(sol.confirmed, false);
  assert.equal(strip.steps.find(s => s.code === "NEG")!.confirmed, false);
  // A step passed with no move and no date of its own is done, with no date.
  const hot = strip.steps.find(s => s.code === "HOT")!;
  assert.equal(hot.state, "done");
  assert.equal(hot.reachedAt, null);
});

test("an earlier move into a step is used only when it is not after the step that followed", () => {
  // NEG → HOT → back to NEG → HOT again: each step takes its latest move before the next one.
  const strip = buildStageStrip({
    status: "HOT", dealType: "New Letting", team: null,
    moves: [move("NEG", "2026-09-01T10:00:00Z"), move("HOT", "2026-09-10T10:00:00Z"), move("NEG", "2026-10-01T10:00:00Z"), move("HOT", "2026-10-20T10:00:00Z")],
    since: "2026-10-20T10:00:00Z", sinceConfirmed: true, dates: {}, now,
  });
  assert.equal(strip.steps.find(s => s.code === "NEG")!.reachedAt, "2026-10-01T10:00:00.000Z");
  assert.equal(strip.steps.find(s => s.code === "NEG")!.days, 19);
});

test("a withdrawn deal shows how far it got and when it ended", () => {
  const strip = buildStageStrip({
    status: "WIT", dealType: "New Letting", team: null,
    moves: [move("NEG", "2026-10-01T10:00:00Z", { from: "AVA" }), move("WIT", "2026-10-15T10:00:00Z", { from: "NEG", byName: "Woody" })],
    since: "2026-10-15T10:00:00Z", sinceConfirmed: true, dates: { instructedAt: "2026-09-20T00:00:00Z" }, now,
  });
  assert.deepEqual(strip.steps.map(s => s.state), ["done", "done", "ahead", "ahead", "ahead", "ahead", "ahead"]);
  assert.equal(strip.steps[1].days, 14);
  assert.deepEqual(strip.outcome, { code: "WIT", label: "Withdrawn", at: "2026-10-15T10:00:00.000Z", byName: "Woody" });
});

test("an investment deal runs from Solicitors; before that it is not on the strip", () => {
  const onTracker = buildStageStrip({ status: "AVA", dealType: "Purchase", team: ["Investment"], moves: [], since: null, sinceConfirmed: false, dates: { targetDate: "2027-01-31" }, now });
  assert.deepEqual(onTracker.steps.map(s => s.code), ["SOL", "EXC", "COM", "INV"]);
  assert.ok(onTracker.steps.every(s => s.state === "ahead"));
  assert.equal(onTracker.before?.code, "AVA");
  assert.equal(onTracker.steps[0].target, "2027-01-31T00:00:00.000Z");
  const exchanged = buildStageStrip({ status: "EXC", dealType: "Sale", team: null, moves: [], since: "2026-11-01T00:00:00Z", sinceConfirmed: true, dates: { exchangedAt: "2026-11-01" }, now });
  assert.deepEqual(exchanged.steps.map(s => s.state), ["done", "current", "ahead", "ahead"]);
});

test("the letting's window: from the deal (after an earlier letting) to the deal that replaced it", () => {
  const first = lettingWindow({ dealCreatedAt: "2026-03-01T00:00:00Z", earlierLetting: false, replacedAt: "2026-09-01T00:00:00Z" });
  assert.equal(inLettingWindow("2026-02-01T00:00:00Z", first), true, "a first letting keeps offers logged before its backing deal");
  assert.equal(inLettingWindow("2026-08-31T23:00:00Z", first), true);
  assert.equal(inLettingWindow("2026-09-01T00:00:00Z", first), false, "the new letting's");
  const second = lettingWindow({ dealCreatedAt: "2026-09-01T00:00:00Z", earlierLetting: true, replacedAt: null });
  assert.equal(inLettingWindow("2026-08-31T00:00:00Z", second), false, "the earlier letting's");
  assert.equal(inLettingWindow("2026-10-01", second), true);
  assert.equal(inLettingWindow(null, second), false);
});

const ev = (kind: DealEvent["kind"], at: string, id = kind): DealEvent => ({ id, at, kind, title: kind, detail: null, by: null, confirmed: true, open: null });

test("the timeline: BGP's AML and invoicing lines go to BGP staff only, oldest first", () => {
  const events = [ev("stage", "2026-11-02T10:00:00Z"), ev("aml", "2026-11-01T10:00:00Z"), ev("invoice", "2026-11-03T10:00:00Z"), ev("invoiced", "2026-11-04T10:00:00Z"), ev("offer", "2026-10-20T12:00:00Z")];
  assert.deepEqual(sortEvents(eventsForViewer(events, "staff")).map(e => e.kind), ["offer", "aml", "stage", "invoice", "invoiced"]);
  assert.deepEqual(eventsForViewer(events, "client").map(e => e.kind), ["stage", "offer"]);
  assert.deepEqual(eventsForViewer(events, "joint_agent").map(e => e.kind), ["stage", "offer"]);
  // A tie keeps the order the events were read in.
  assert.deepEqual(sortEvents([ev("created", "2026-01-01T00:00:00Z", "a"), ev("instructed", "2026-01-01T00:00:00Z", "b")]).map(e => e.id), ["a", "b"]);
});

test("the sections: Negotiation only with a letting, Fees for BGP staff, no change log for a joint agent", () => {
  assert.deepEqual(dealPageSections("staff", { letting: true }).map(s => s.key), ["overview", "timeline", "negotiation", "checklist", "parties", "fees", "files", "history"]);
  assert.deepEqual(dealPageSections("client", { letting: true }).map(s => s.key), ["overview", "timeline", "negotiation", "checklist", "parties", "files", "history"]);
  assert.deepEqual(dealPageSections("joint_agent", { letting: true }).map(s => s.key), ["overview", "timeline", "negotiation", "checklist", "parties", "files"]);
  assert.deepEqual(dealPageSections("staff", { letting: false }).map(s => s.key), ["overview", "timeline", "checklist", "parties", "fees", "files", "history"]);
  assert.equal(dealPageSections("staff", { letting: false }).find(s => s.key === "checklist")!.label, "Tasks");
  assert.equal(dealPageSections("staff", { letting: true }).find(s => s.key === "parties")!.label, "Parties & AML");
  assert.equal(dealPageSections("client", { letting: true }).find(s => s.key === "parties")!.label, "Parties");
});

test("the Heads of Terms stage is read from the unit's own dates", () => {
  assert.equal(hotsStageOf({}), "none");
  assert.equal(hotsStageOf({ hotsContent: "  " }), "none");
  assert.equal(hotsStageOf({ hotsContent: "HEADS OF TERMS" }), "draft");
  assert.equal(hotsStageOf({ hotsContent: "x", agreedAt: "2026-11-01" }), "agreed");
  assert.equal(hotsStageOf({ hotsContent: "x", agreedAt: "2026-11-01", issuedAt: "2026-11-02" }), "issued");
  assert.equal(hotsStageOf({ issuedAt: "2026-11-02", finalAt: "2026-11-05" }), "final");
});

test("owed now: overdue items first, then required items up to the deal's stage, and unowned items when nobody runs the letting", () => {
  const item = (id: string, over: Partial<DealChecklistView["items"][number]> = {}) => ({
    id, stage: "negotiating", label: id, required: false, done: false, doneAt: null, doneByName: null, dueDate: null, assigneeName: "Millie", assigneeSide: "bgp", overdue: false, ...over,
  });
  const checklist: DealChecklistView = {
    id: "c1", responsibleName: "Jack", responsibleSide: "bgp", stage: "negotiating",
    summary: { total: 5, done: 1, requiredOpen: 1, unassigned: 0, overdue: 1 },
    items: [
      item("required-now", { required: true }),
      item("required-later", { required: true, stage: "exchanged" }),
      item("overdue", { stage: "under_offer", overdue: true, dueDate: "2026-11-01" }),
      item("done", { required: true, done: true }),
      item("nobody", { assigneeName: null }),
    ],
  };
  assert.deepEqual(owedItems(checklist).map(i => i.id), ["overdue", "required-now"]);
  assert.deepEqual(owedItems({ ...checklist, responsibleName: null }).map(i => i.id), ["overdue", "required-now", "nobody"]);
  assert.deepEqual(owedItems(null), []);
});
