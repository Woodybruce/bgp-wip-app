import test from "node:test";
import assert from "node:assert/strict";
import {
  STANDARD_CHECKLIST, checklistClientName, checklistHasTaskList, checklistLinkPath, checklistStageFor, checklistSummary, checklistTasksPath, checklistTemplateFor, checklistWayFor,
} from "../shared/deal-checklist";

test("the list is worded for the landlord", () => {
  const ls = checklistTemplateFor("Landsec").items.map(i => i.label);
  assert.ok(ls.includes("Approval from Landsec in place"));
  assert.ok(ls.includes("Brand and concept put to Landsec for clearance"));
  assert.ok(ls.includes("Unit taken off the market: the tracker, the website and Landsec's own system"));
  assert.ok(checklistTemplateFor("Hammerson plc").items.some(i => i.label === "Approval from Hammerson in place"));
  assert.ok(checklistTemplateFor(null).items.some(i => i.label === "Approval from the client in place"));
  assert.ok(checklistTemplateFor(null).items.some(i => /the client's financial thresholds/.test(i.label)));
  assert.ok(ls.every(l => !l.includes("{CLIENT}")));
});

test("it is not a copy of the client list it was modelled on", () => {
  const all = STANDARD_CHECKLIST.items.map(i => i.label).join(" | ");
  for (const theirs of ["VTS", "GMC", "OOE", "NTC", "Credit Control", "Retail Analysis", "Concept Clearance"]) assert.ok(!all.includes(theirs), theirs);
});

test("client names lose their legal ending", () => {
  assert.equal(checklistClientName("Land Securities Group PLC"), "Land Securities");
  assert.equal(checklistClientName("Hammerson plc"), "Hammerson");
  assert.equal(checklistClientName(""), "the client");
});

test("stages and the summary", () => {
  assert.equal(checklistStageFor("HOT"), "negotiating");
  assert.equal(checklistStageFor("SOL"), "under_offer");
  assert.equal(checklistStageFor(null), "enquiry");
  const items = checklistTemplateFor("Landsec").items.map((i, n) => ({ ...i, doneAt: n === 0 ? "2026-11-12" : null, dueDate: n === 2 ? "2026-11-01" : null, assignee: null }));
  const s = checklistSummary(items, "negotiating", "2026-11-12", false);
  assert.equal(s.total, 18); assert.equal(s.done, 1);
  assert.equal(s.requiredOpen, 2, "the two required Negotiating items; the Enquiry one is done");
  assert.equal(s.overdue, 1); assert.equal(s.unassigned, 17);
});

test("a joint agent has a task list and their own way in; an asset manager has the Letting Tracker and My Tasks", () => {
  assert.equal(checklistHasTaskList("joint_agent"), true);
  assert.equal(checklistHasTaskList("asset_manager"), true);
  assert.equal(checklistTasksPath("asset_manager"), "/tasks");
  assert.equal(checklistHasTaskList(null), true);
  assert.equal(checklistTasksPath("joint_agent"), "/landsec/tasks");
  assert.equal(checklistTasksPath(null), "/tasks");
  assert.equal(checklistLinkPath(checklistWayFor(true, "joint_agent"), "u 1"), "/landsec/tracker?unit=u%201&checklist=1");
  assert.equal(checklistLinkPath(checklistWayFor(true, "asset_manager"), "u1"), "/deals/letting?unit=u1&checklist=1");
  assert.equal(checklistLinkPath(checklistWayFor(true, null), "u1"), "/deals/letting?unit=u1&checklist=1");
  assert.equal(checklistLinkPath(checklistWayFor(false, null), "u1"), "/landsec/unit/u1?checklist=1");
  // Someone with no login is never sent to a joint agent's tracker, whatever role is passed.
  assert.equal(checklistWayFor(false, "joint_agent"), "landsec_unit");
});
