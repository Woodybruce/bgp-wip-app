// ChatBGP starting a CRM strategy (Woody, 2026-11-16: "yes chat should be
// able to"). The rules that decide which record a name means and which
// strategy a company goes on. The save itself is the CRM's own.
import "./test-database-url";
import test from "node:test";
import assert from "node:assert/strict";
import type { EngagementStrategy } from "../shared/crm-engagement";
import { chooseStrategy, dueAtFrom, pickByName } from "./chatbgp-crm-strategy";

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
