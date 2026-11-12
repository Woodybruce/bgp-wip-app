import test from "node:test";
import assert from "node:assert/strict";
import { briefProgress } from "../shared/brief-progress";

const base = { today: "2026-11-12", statusCode: "AVA", viewings: [], offers: [] };
const brief = (over: any = {}) => ({ signoff: { total: 3, agreed: 3, complete: true }, minTargets: 3, priorityTargets: 1, targets: [], commercials: { quotingRentPa: 120000, nerFloorPa: 100000 }, ...over });

test("no brief, nothing to measure", () => {
  assert.equal(briefProgress({ ...base, brief: null }).state, "no_brief");
});

test("a new brief: nothing done but it is counted", () => {
  const p = briefProgress({ ...base, brief: brief({ signoff: { total: 2, agreed: 1, complete: false } }) });
  assert.equal(p.state, "in_progress");
  assert.equal(p.done, 0);
  assert.equal(p.total, 11);
  assert.equal(p.next, "get the brief agreed by everyone on it");
  assert.equal(p.steps[0].detail, "1 of 2 have agreed");
});

test("targets: wanted number and Priority A both needed", () => {
  const t = (status: string, priority = "B") => ({ status, priority });
  let p = briefProgress({ ...base, brief: brief({ targets: [t("Identified"), t("Identified"), t("Approached")] }) });
  assert.equal(p.steps.find(s => s.key === "targets")!.done, false, "no Priority A yet");
  p = briefProgress({ ...base, brief: brief({ targets: [t("Identified", "A"), t("Approached"), t("Meeting Held")] }) });
  assert.equal(p.steps.find(s => s.key === "targets")!.done, true);
  assert.equal(p.steps.find(s => s.key === "approached")!.done, false);
  assert.equal(p.steps.find(s => s.key === "approached")!.detail, "2 of 3 approached");
});

test("offer measured against the floor by net effective rent", () => {
  const offer = { status: "Negotiating", companyName: "Dishoom", rentPa: 110000, rentFreeMonths: 12, termYears: 10, fittingOutContribution: 50000 };
  const p = briefProgress({ ...base, statusCode: "NEG", brief: brief(), offers: [offer] });
  const on = p.steps.find(s => s.key === "onBrief")!;
  // (110000 * 9 - 50000) / 10 = 94,000
  assert.equal(on.done, false);
  assert.match(on.detail, /£94,000 against a floor of £100,000/);
  const better = briefProgress({ ...base, statusCode: "NEG", brief: brief(), offers: [{ ...offer, rentPa: 120000, rentFreeMonths: 6 }] });
  assert.equal(better.steps.find(s => s.key === "onBrief")!.done, true);
});

test("no figures on the brief: the on-brief step is left out", () => {
  const p = briefProgress({ ...base, brief: brief({ commercials: {} }) });
  assert.equal(p.steps.some(s => s.key === "onBrief"), false);
  assert.equal(p.total, 10);
});

test("a deal at Solicitors counts the steps it must have passed, marked as not recorded", () => {
  const p = briefProgress({ ...base, statusCode: "SOL", brief: brief() });
  const by = Object.fromEntries(p.steps.map(s => [s.key, s]));
  assert.equal(by.viewing.done, true); assert.equal(by.viewing.implied, true);
  assert.equal(by.offer.done, true); assert.equal(by.terms.done, true);
  assert.equal(by.hots.done, true); assert.equal(by.solicitors.done, true);
  assert.equal(by.exchanged.done, false);
  assert.equal(p.next, "add the target operators the brief asks for");
  assert.equal(p.deadline, null, "the brief's dates stop mattering at Solicitors");
});

test("completed is 100% and withdrawn is not measured", () => {
  assert.equal(briefProgress({ ...base, statusCode: "COM", brief: brief() }).percent, 100);
  assert.equal(briefProgress({ ...base, statusCode: "COM", brief: brief() }).state, "complete");
  assert.equal(briefProgress({ ...base, statusCode: "WIT", brief: brief() }).state, "withdrawn");
});

test("deadlines: the next one coming, else the last one passed", () => {
  let p = briefProgress({ ...base, brief: brief({ deadline1Date: "2026-11-05", deadline2Date: "2026-11-20" }) });
  assert.deepEqual(p.deadline, { label: "Deadline 2", date: "2026-11-20", days: 8, overdue: false });
  p = briefProgress({ ...base, brief: brief({ deadline1Date: "2026-11-05", deadline2Date: "2026-11-09" }) });
  assert.deepEqual(p.deadline, { label: "Deadline 2", date: "2026-11-09", days: 3, overdue: true });
});

test("rejected offers are not what the brief is measured against", () => {
  const p = briefProgress({ ...base, statusCode: "NEG", brief: brief({ commercials: { quotingRentPa: 100000 } }), offers: [
    { status: "Rejected", rentPa: 150000 }, { status: "Pending", rentPa: 90000 },
  ] });
  assert.match(p.steps.find(s => s.key === "onBrief")!.detail, /£90,000 against a quoting rent of £100,000 \(90%\)/);
});
