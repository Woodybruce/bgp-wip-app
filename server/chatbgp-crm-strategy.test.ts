// ChatBGP starting a CRM strategy (Woody, 2026-11-16: "yes chat should be
// able to"). The rules that decide which record a name means and which
// strategy a company goes on. The save itself is the CRM's own.
import "./test-database-url";
import test from "node:test";
import assert from "node:assert/strict";
import type { EngagementAction, EngagementStrategy } from "../shared/crm-engagement";
import { actionStatusFrom, chooseStrategy, dueAtFrom, findStrategy, londonIso, pickAction, pickByName, planStrategyChange, strategyStatusFrom } from "./chatbgp-crm-strategy";

const people = [{ id: "1", name: "Alex Smith" }, { id: "2", name: "Alex Jones" }, { id: "3", name: "Lizzie Brown" }, { id: "4", name: "Sam Alexander" }];

test("a name means one person or nobody: never a guess between two", () => {
  assert.equal(pickByName(people, "Lizzie").one?.id, "3");
  assert.equal(pickByName(people, "lizzie brown").one?.id, "3");
  assert.equal(pickByName(people, "Alex Smith").one?.id, "1");
  const alex = pickByName(people, "Alex");
  assert.equal(alex.one, null);
  assert.deepEqual(alex.several.map(p => p.id), ["1", "2", "4"]);
  assert.deepEqual(pickByName(people, "Zebedee"), { one: null, several: [] });
  assert.deepEqual(pickByName(people, "  "), { one: null, several: [] });
  // Two records with the very same name are still a question.
  assert.equal(pickByName([...people, { id: "9", name: "Lizzie Brown" }], "Lizzie Brown").one, null);
});

const strategy = (over: Partial<EngagementStrategy> & { id: string; name: string; companies: string[] }): EngagementStrategy => ({
  objective: "An objective", team: null, ownerId: "u1", ownerName: "Owner", status: "active", startsOn: null, endsOn: null, updatedAt: "2026-11-16T00:00:00.000Z",
  targets: over.companies.map(companyId => ({ companyId, companyName: companyId, reason: "", contactIds: [] })), ...over,
});

test("a named running strategy is joined, an unknown name starts a new one, and a new one needs an objective", () => {
  const running = [strategy({ id: "s1", name: "Agents: restaurants", companies: ["a"] }), strategy({ id: "s2", name: "Old push", companies: ["m"], status: "completed" })];
  assert.deepEqual(chooseStrategy(running, "m", "agents: restaurants", ""), { join: running[0] });
  assert.deepEqual(chooseStrategy(running, "m", "Matta: leasing", "Be the team they call first"), { create: { name: "Matta: leasing", objective: "Be the team they call first" } });
  assert.match((chooseStrategy(running, "m", "Matta: leasing", "") as any).ask, /needs an objective/);
  // A completed strategy is never joined by name: the name starts a new one.
  assert.deepEqual(chooseStrategy(running, "m", "Old push", "Again"), { create: { name: "Old push", objective: "Again" } });
});

test("with no name, the one strategy the company is on is added to; none or several is a question", () => {
  const one = [strategy({ id: "s1", name: "Matta: leasing", companies: ["m"] }), strategy({ id: "s2", name: "Other", companies: ["x"] })];
  assert.deepEqual(chooseStrategy(one, "m", "", ""), { join: one[0] });
  assert.match((chooseStrategy(one, "z", "", "") as any).ask, /needs a name and an objective/);
  const two = [...one, strategy({ id: "s3", name: "Second", companies: ["m"] })];
  assert.match((chooseStrategy(two, "m", "", "") as any).ask, /on 2 running strategies/);
  // A paused strategy still counts as the one it is on; a completed one does not.
  assert.deepEqual(chooseStrategy([strategy({ id: "p", name: "Paused", companies: ["m"], status: "paused" })], "m", "", ""), { join: strategy({ id: "p", name: "Paused", companies: ["m"], status: "paused" }) });
  assert.match((chooseStrategy([strategy({ id: "c", name: "Done", companies: ["m"], status: "completed" })], "m", "", "") as any).ask, /needs a name/);
});

test("a due date is the day given, and two weeks out when none or a bad one is", () => {
  assert.equal(dueAtFrom("2026-11-20"), "2026-11-20T09:00:00.000Z");
  const now = new Date("2026-11-16T15:30:00.000Z");
  assert.equal(dueAtFrom("", now), "2026-11-30T09:00:00.000Z");
  assert.equal(dueAtFrom("next Friday", now), "2026-11-30T09:00:00.000Z");
  assert.equal(dueAtFrom("2026-13-45", now), "2026-11-30T09:00:00.000Z");
});

// The rest of the plan, the same day ("build it"): an event, a change to a
// strategy, a tick on an action.

test("a London day and time is the right moment in winter and in summer, and a bad one is refused", () => {
  assert.equal(londonIso("2026-12-03", "19:00"), "2026-12-03T19:00:00.000Z");
  assert.equal(londonIso("2027-06-17", "09:00"), "2027-06-17T08:00:00.000Z");
  assert.equal(londonIso("2026-13-40", "09:00"), null);
  assert.equal(londonIso("2026-12-03", "7pm"), null);
  assert.equal(londonIso("2026-12-03", "24:00"), null);
  assert.equal(londonIso("", "09:00"), null);
  // The hour the clocks skip in spring does not exist.
  assert.equal(londonIso("2027-03-28", "01:30"), null);
  assert.equal(londonIso("2027-03-28", "02:30"), "2027-03-28T01:30:00.000Z");
});

test("a status is read from the usual words, and anything else is a question", () => {
  for (const said of ["completed", "Complete", "closed", "close", "done"]) assert.equal(strategyStatusFrom(said), "completed", said);
  for (const said of ["paused", "pause", "on hold"]) assert.equal(strategyStatusFrom(said), "paused", said);
  for (const said of ["active", "reopen", "running"]) assert.equal(strategyStatusFrom(said), "active", said);
  assert.equal(strategyStatusFrom("sideways"), null);
  assert.equal(strategyStatusFrom(""), null);
  for (const said of ["done", "completed", "ticked"]) assert.equal(actionStatusFrom(said), "done", said);
  for (const said of ["in progress", "in_progress", "in-progress", "started"]) assert.equal(actionStatusFrom(said), "in_progress", said);
  for (const said of ["todo", "to do", "reopen", "not done"]) assert.equal(actionStatusFrom(said), "todo", said);
  assert.equal(actionStatusFrom("maybe"), null);
});

test("the strategy meant is the one named, else the one the company is on; two is a question", () => {
  const all = [strategy({ id: "s1", name: "Matta: leasing", companies: ["m"] }), strategy({ id: "s2", name: "Agents: restaurants", companies: ["a", "m"], status: "completed" }),
    strategy({ id: "s3", name: "Landlords: west end", companies: ["x"] })];
  assert.deepEqual(findStrategy(all, null, "landlords: west end"), { strategy: all[2] });
  assert.deepEqual(findStrategy(all, null, "west end"), { strategy: all[2] });
  // A completed strategy can be named, so it can be reopened.
  assert.deepEqual(findStrategy(all, null, "Agents: restaurants"), { strategy: all[1] });
  // With a company and no name: the one it is on that is not completed.
  assert.deepEqual(findStrategy(all, "m", ""), { strategy: all[0] });
  assert.deepEqual(findStrategy(all, "a", ""), { strategy: all[1] });
  assert.match((findStrategy(all, "z", "") as any).ask, /not on a CRM strategy/);
  assert.match((findStrategy(all, null, "") as any).ask, /Say which strategy/);
  assert.match((findStrategy(all, null, "No such") as any).ask, /no CRM strategy called/);
  const two = [...all, strategy({ id: "s4", name: "Matta: events", companies: ["m"] })];
  assert.match((findStrategy(two, "m", "") as any).ask, /on 2 strategies/);
  assert.match((findStrategy(two, null, "Matta") as any).ask, /More than one strategy matches/);
  // The company narrows a loose name before the whole list is tried.
  assert.deepEqual(findStrategy([...two, strategy({ id: "s5", name: "Leasing: other", companies: ["q"] })], "m", "events"), { strategy: two[3] });
});

test("a change to a strategy keeps every company and person on it, and names only what changed", () => {
  const before: EngagementStrategy = { ...strategy({ id: "s1", name: "Matta: leasing", companies: [] }), team: "Leasing", startsOn: "2026-11-01", endsOn: null,
    targets: [{ companyId: "m", companyName: "Matta", reason: "Key agent", contactIds: ["c1", "c2"] }, { companyId: "n", companyName: "Other", reason: "Also", contactIds: [] }] };
  const none = planStrategyChange(before, { name: "Matta: leasing", status: "active", owner: { id: "u1", name: "Owner" }, startsOn: "2026-11-01" });
  assert.deepEqual(none.changed, []);
  const closed = planStrategyChange(before, { status: "completed" });
  assert.deepEqual(closed.changed, ["marked completed"]);
  assert.deepEqual(closed.input, { name: "Matta: leasing", objective: "An objective", ownerId: "u1", status: "completed", startsOn: "2026-11-01", endsOn: null, team: "Leasing",
    targets: [{ companyId: "m", reason: "Key agent", contactIds: ["c1", "c2"] }, { companyId: "n", reason: "Also", contactIds: [] }], expectedUpdatedAt: "2026-11-16T00:00:00.000Z" });
  const many = planStrategyChange(before, { name: "Matta 2027", objective: "Sharper", owner: { id: "u2", name: "Lizzie Brown" }, status: "paused", startsOn: null, endsOn: "2027-03-31" });
  assert.deepEqual(many.changed, ['renamed to "Matta 2027"', "objective changed", "owner now Lizzie Brown", "paused", "start date cleared", "end date 2027-03-31"]);
  assert.equal(many.input.targets.length, 2);
  assert.deepEqual(planStrategyChange({ ...before, status: "completed" }, { status: "active" }).changed, ["reopened"]);
  assert.deepEqual(planStrategyChange({ ...before, status: "paused" }, { status: "active" }).changed, ["running again"]);
});

const action = (id: string, title: string, status: EngagementAction["status"] = "todo", companyName = "Matta"): EngagementAction => ({
  id, title, notes: null, dueAt: null, status, ownerId: "u1", ownerName: "Alex Smith", companyId: "m", companyName, strategyId: null, eventId: null });

test("the action meant is the one with that id or those words; two that both fit is a question", () => {
  const list = [action("a1", "Arrange a working session with Matta"), action("a2", "Monthly requirements call"), action("a3", "Monthly requirements call", "done")];
  assert.equal((pickAction(list, { id: "a2" }, "done") as any).one.id, "a2");
  assert.match((pickAction(list, { id: "gone" }, "done") as any).ask, /not on the CRM plan any more/);
  assert.equal((pickAction(list, { title: "working session" }, "done") as any).one.id, "a1");
  // Two with the same title: ticking means the open one, reopening means the done one.
  assert.equal((pickAction(list, { title: "Monthly requirements call" }, "done") as any).one.id, "a2");
  assert.equal((pickAction(list, { title: "Monthly requirements call" }, "todo") as any).one.id, "a3");
  assert.match((pickAction([...list, action("a4", "Monthly requirements call", "todo", "Other firm")], { title: "requirements call" }, "done") as any).ask, /More than one CRM action matches/);
  assert.match((pickAction(list, { title: "zzz" }, "done") as any).ask, /No CRM action matches/);
  assert.match((pickAction(list, {}, "done") as any).ask, /Say which action/);
});
