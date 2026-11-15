// Turning a company on in the CRM: the kick-off draft (Woody, 2026-11-15).
//   node --import tsx --test server/crm-kickoff.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { checkKickoffAnswer, type KickoffOffer } from "../shared/crm-kickoff";
import { buildKickoff } from "./crm-kickoff";

const offer: KickoffOffer = {
  contacts: [{ id: "p1", name: "Priya Shah", role: "Head of Property" }, { id: "p2", name: "Tom Reed", role: null }],
  events: [{ id: "e1", title: "Leisure lunch", startsAt: "2026-12-12T13:00:00.000Z", location: "The Ivy" }],
  places: [{ id: "unit:u1", name: "Unit 4 at Trinity Leeds", detail: "2,100 sq ft" }],
  strategies: [{ id: "s1", name: "Chicken brands", objective: "Get the chicken brands into our centres", companies: ["Popeyes"], already: false },
    { id: "s2", name: "Already on", objective: "x", companies: ["Wingstop"], already: true }],
};
const fallback = { name: "Wingstop relationship", objective: "", reason: "" };

test("the reader's picks are kept only when the server offered them", () => {
  const out = checkKickoffAnswer({
    name: "Wingstop rollout", objective: "Win their next five sites.", reason: "They are opening fast.",
    join: { strategyId: "s1", why: "Same sector" },
    people: [{ contactId: "p1", why: "Runs property" }, { contactId: "ghost", why: "Invented" }, { contactId: "p1", why: "Twice" }],
    events: [{ eventId: "e1", why: "Good fit" }, { eventId: "e9" }],
    places: [{ placeId: "unit:u1", why: "Right size" }, { placeId: "unit:other" }],
    actions: [{ title: "Call Priya about 2027 sites", dueInDays: 7, why: "Open the door" }, { title: "x" }, { title: "Call Priya about 2027 sites" }, { title: "Send the Trinity particulars", dueInDays: 9999 }],
  }, offer, fallback);
  assert.deepEqual(out.draft, { name: "Wingstop rollout", objective: "Win their next five sites.", reason: "They are opening fast." });
  assert.deepEqual(out.people.map(p => [p.contactId, p.suggested, p.why]), [["p1", true, "Runs property"], ["p2", false, null]], "every contact is listed; the suggested ones first");
  assert.deepEqual(out.events.map(e => [e.eventId, e.suggested]), [["e1", true]]);
  assert.deepEqual(out.places.map(p => p.placeId), ["unit:u1"]);
  assert.deepEqual(out.actions, [{ title: "Call Priya about 2027 sites", dueInDays: 7, why: "Open the door" }, { title: "Send the Trinity particulars", dueInDays: 180, why: null }]);
  assert.deepEqual(out.strategies.map(s => [s.id, s.suggested]), [["s1", true], ["s2", false]]);
});

test("a strategy the company is already on is never the one suggested to join; no answer leaves the lists to tick by hand", () => {
  assert.equal(checkKickoffAnswer({ join: { strategyId: "s2" } }, offer, fallback).strategies.some(s => s.suggested), false);
  const empty = checkKickoffAnswer(null, offer, fallback);
  assert.deepEqual(empty.draft, fallback);
  assert.equal(empty.people.length, 2);
  assert.equal(empty.people.some(p => p.suggested), false);
  assert.deepEqual(empty.actions, []);
});

const fakeDb = (company: any) => ({
  query: async (text: string) => {
    if (/FROM crm_companies c WHERE c\.id=\$1 AND/.test(text)) return { rows: company ? [company] : [] };
    if (/FROM crm_contacts WHERE company_id/.test(text)) return { rows: [{ id: "p1", name: "Priya Shah", role: "Head of Property", email: "priya@brand.example" }] };
    if (/max\(interaction_date\)/.test(text)) return { rows: [{ at: "2026-10-12T10:00:00Z" }] };
    if (/FROM available_units/.test(text)) return { rows: [{ id: "u1", unit_name: "Unit 4", sqft: 2100, property: "Trinity Leeds" }] };
    if (/brand_signals/.test(text)) throw new Error("no such table");
    return { rows: [] };
  },
});
const plan = async () => ({ strategies: [{ id: "s1", name: "Chicken brands", objective: "Get them in", team: null, ownerId: "u", ownerName: "U", status: "active" as const, startsOn: null, endsOn: null, updatedAt: "x",
  targets: [{ companyId: "c9", companyName: "Popeyes", reason: "r", contactIds: [] }] }], events: [], actions: [] });

test("the draft is built from what the app holds, survives a failed side query, and works with the reader off", async () => {
  const brand = { id: "c1", name: "Wingstop", company_type: "Tenant - Restaurant", description: "Chicken wings.", industry: "Quick service", noun: "brand" };
  const off = await buildKickoff(fakeDb(brand), "c1", { hasKey: () => false, plan });
  assert.equal(off.usedAi, false);
  assert.match(off.note || "", /not switched on/);
  assert.deepEqual(off.company, { id: "c1", name: "Wingstop", noun: "brand" });
  assert.ok(off.facts.includes("Last contact 12 Oct 2026"));
  assert.ok(off.facts.some(f => f.startsWith("1 contact on file")));
  assert.equal(off.draft.name, "Wingstop relationship");
  assert.deepEqual(off.people.map(p => p.name), ["Priya Shah"]);
  let brief = "";
  const on = await buildKickoff(fakeDb(brand), "c1", { hasKey: () => true, claim: async () => true, plan, ask: async (_s, b) => { brief = b;
    return { text: JSON.stringify({ name: "Wingstop rollout", objective: "Win five sites.", reason: "Opening fast.", people: [{ contactId: "p1", why: "Runs property" }], places: [{ placeId: "unit:u1", why: "Size" }], join: { strategyId: "s1", why: "Sector" }, actions: [{ title: "Call Priya", dueInDays: 7 }] }), model: "test" }; } });
  assert.equal(on.usedAi, true);
  assert.equal(on.draft.name, "Wingstop rollout");
  assert.deepEqual(on.places.map(p => p.name), ["Unit 4 at Trinity Leeds"]);
  assert.equal(on.strategies[0].suggested, true);
  assert.match(brief, /- p1: Priya Shah, Head of Property/);
  assert.match(brief, /- unit:u1: Unit 4 at Trinity Leeds, 2,100 sq ft/);
  assert.doesNotMatch(brief, /priya@brand\.example/, "no email address is sent to the reader");
  const capped = await buildKickoff(fakeDb(brand), "c1", { hasKey: () => true, claim: async () => false, plan });
  assert.match(capped.note || "", /allowance/);
  const broken = await buildKickoff(fakeDb(brand), "c1", { hasKey: () => true, claim: async () => true, plan, ask: async () => { throw new Error("timeout"); } });
  assert.equal(broken.usedAi, false);
  assert.match(broken.note || "", /could not be drawn up/);
});

test("a company that cannot be on the CRM is refused", async () => {
  await assert.rejects(buildKickoff(fakeDb(null), "x", { hasKey: () => false, plan }), /cannot be put on the CRM/);
});
