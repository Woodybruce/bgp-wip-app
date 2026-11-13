// "Waiting on" linked to the deal checklist (shared/deal-waiting.ts): which
// item a deal's waiting-on moves to when the linked item is ticked, the
// waiting-on a deal shows when nobody has set one, and the party a
// responsible person stands for.
//   node --import tsx --test server/deal-waiting.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { LANDSEC_WAITING_PARTIES } from "../shared/landsec";
import { checklistTemplateFor } from "../shared/deal-checklist";
import {
  checklistIsForDeal, daysWaiting, derivedWaiting, hasStoredWaiting, nextWaitingItem, waitingAfterAssign, waitingAfterDelete, waitingAfterTick,
  waitingClockFor, waitingFlagFor, waitingNamed, waitingPartyFor, waitingPersonFor, waitingTargetFor,
  type StoredWaiting, type WaitingChecklist, type WaitingItem, type WaitingPerson,
} from "../shared/deal-waiting";

const DEAL = "deal-1";
const NOW = Date.parse("2026-11-13T12:00:00Z");
const ago = (days: number) => new Date(NOW - days * 86400000).toISOString();

const victoria: WaitingPerson = { userId: "u-victoria", name: "Victoria Broadhead", side: "bgp", role: null };
const am: WaitingPerson = { userId: "u-am", name: "Alex Mann", side: "client", role: "asset_manager" };
const leasing: WaitingPerson = { userId: "u-mark", name: "Mark Warne", side: "client", role: "client_leasing" };
const ja: WaitingPerson = { userId: "u-ja", name: "Jo Agent", side: "joint_agent", role: "joint_agent" };
const noLogin: WaitingPerson = { userId: null, name: "Sam Typed", side: "client", role: null };

let n = 0;
const item = (stage: string, over: Partial<WaitingItem> = {}): WaitingItem => ({
  id: over.id || `i${++n}`, stage, label: over.label || `Item ${n}`, required: true, sortOrder: 0, done: false, assignedAt: null, assignee: null, ...over,
});
const checklist = (stage: WaitingChecklist["stage"], items: WaitingItem[], over: Partial<WaitingChecklist> = {}): WaitingChecklist => ({
  id: "cl-1", dealId: DEAL, stage, responsible: null, items, ...over,
});
const stored = (over: Partial<StoredWaiting> = {}): StoredWaiting => ({ dealId: DEAL, party: null, name: null, since: null, note: null, checklistItemId: null, ...over });

// ── The party a responsible person stands for ───────────────────────────
test("party: BGP and a joint agent are their own parties", () => {
  assert.equal(waitingPartyFor(victoria), "BGP");
  assert.equal(waitingPartyFor(ja), "Joint agent");
});

test("party: a client-side person is the Landsec party that fits their role", () => {
  assert.equal(waitingPartyFor(am), "Landsec asset manager");
  assert.equal(waitingPartyFor({ side: "client", role: "senior_asset_manager" }), "Landsec asset manager");
  assert.equal(waitingPartyFor({ side: "client", role: "Asset manager" }), "Landsec asset manager");
  assert.equal(waitingPartyFor(leasing), "Landsec leasing manager");
  assert.equal(waitingPartyFor({ side: "client", role: "leasing_manager" }), "Landsec leasing manager");
  assert.equal(waitingPartyFor({ side: "client", role: "Leasing team" }), "Landsec leasing manager");
});

test("party: a client-side person whose role is not known is left for the person to pick", () => {
  assert.equal(waitingPartyFor(noLogin), null);
  assert.equal(waitingPartyFor({ side: "client", role: "Involved" }), null);
  assert.equal(waitingPartyFor({ side: null, role: "asset_manager" }), null);
  assert.equal(waitingPartyFor(null), null);
});

test("party: every party the rules give is one the Waiting on list offers", () => {
  const all = LANDSEC_WAITING_PARTIES as readonly string[];
  for (const p of [victoria, ja, am, leasing]) assert.ok(all.includes(waitingPartyFor(p)!), String(waitingPartyFor(p)));
  assert.ok(all.includes("Joint agent"));
});

// ── The next item ───────────────────────────────────────────────────────
test("next: an item's own person wins over the person responsible for the deal", () => {
  const i = item("negotiating", { assignee: am });
  const cl = checklist("negotiating", [i], { responsible: victoria });
  assert.equal(waitingPersonFor(i, cl)?.name, "Alex Mann");
  assert.equal(nextWaitingItem(cl)?.id, i.id);
});

test("next: an unassigned item falls to the person responsible for the deal", () => {
  const i = item("negotiating");
  const cl = checklist("negotiating", [i], { responsible: victoria });
  assert.equal(nextWaitingItem(cl)?.id, i.id);
  const t = waitingTargetFor(i, cl);
  assert.equal(t.party, "BGP"); assert.equal(t.name, "Victoria Broadhead");
  assert.equal(t.since, null, "no date is kept for when the deal's person was chosen");
});

test("next: an unassigned item with nobody responsible for the deal is not waited on", () => {
  assert.equal(nextWaitingItem(checklist("negotiating", [item("negotiating")])), null);
});

test("next: an item at a later stage is never waited on", () => {
  const later = item("under_offer", { assignee: am });
  assert.equal(nextWaitingItem(checklist("negotiating", [later])), null);
  // Once the deal reaches that stage it is.
  assert.equal(nextWaitingItem(checklist("under_offer", [later]))?.id, later.id);
});

test("next: an earlier stage's open item comes before the current stage's", () => {
  const current = item("negotiating", { assignee: am, sortOrder: 0 });
  const earlier = item("enquiry", { assignee: victoria, sortOrder: 5 });
  assert.equal(nextWaitingItem(checklist("negotiating", [current, earlier]))?.id, earlier.id);
});

test("next: within a stage the checklist's order decides", () => {
  const second = item("negotiating", { assignee: am, sortOrder: 4 });
  const first = item("negotiating", { assignee: victoria, sortOrder: 2 });
  assert.equal(nextWaitingItem(checklist("negotiating", [second, first]))?.id, first.id);
});

test("next: an item that is not required, or is done, is passed over", () => {
  const optional = item("negotiating", { assignee: am, required: false, sortOrder: 0 });
  const done = item("negotiating", { assignee: am, done: true, sortOrder: 1 });
  const open = item("negotiating", { assignee: ja, sortOrder: 2 });
  assert.equal(nextWaitingItem(checklist("negotiating", [optional, done, open]))?.id, open.id);
});

// ── Derived when nobody set it ──────────────────────────────────────────
test("derived: no checklist, nothing to show", () => {
  assert.equal(derivedWaiting(null, DEAL), null);
  assert.equal(derivedWaiting(undefined, DEAL), null);
});

test("derived: a checklist for a different deal is never read", () => {
  const cl = checklist("negotiating", [item("negotiating", { assignee: am })], { dealId: "another-deal" });
  assert.equal(checklistIsForDeal(cl, DEAL), false);
  assert.equal(derivedWaiting(cl, DEAL), null);
  // A checklist with no deal belongs to no deal.
  assert.equal(derivedWaiting({ ...cl, dealId: null }, DEAL), null);
  assert.equal(derivedWaiting(cl, null), null);
});

test("derived: nothing required is open, nothing to show", () => {
  const cl = checklist("negotiating", [item("negotiating", { assignee: am, done: true }), item("negotiating", { assignee: am, required: false })]);
  assert.equal(derivedWaiting(cl, DEAL), null);
});

test("derived: the open required item, its person, their party and when it was given to them", () => {
  const i = item("negotiating", { assignee: am, assignedAt: ago(6), label: "Covenant and credit risk review of the tenant" });
  const d = derivedWaiting(checklist("negotiating", [i]), DEAL)!;
  assert.deepEqual(d, { itemId: i.id, label: "Covenant and credit risk review of the tenant", party: "Landsec asset manager", name: "Alex Mann", since: ago(6) });
  assert.equal(daysWaiting(d.since, NOW), 6);
});

test("derived: on the standard list at Negotiating with someone responsible for the deal", () => {
  const items = checklistTemplateFor("Landsec").items.map((t, k) => item(t.stage, { id: `std${k}`, label: t.label, required: t.required, sortOrder: k }));
  const cl = checklist("negotiating", items, { responsible: victoria });
  // The Enquiry stage's required item is still open, so it comes first.
  assert.equal(derivedWaiting(cl, DEAL)?.label, items[0].label);
  items[0].done = true;
  assert.equal(derivedWaiting(cl, DEAL)?.label, "Covenant and credit risk review of the tenant");
});

// ── Ticking the linked item ─────────────────────────────────────────────
test("tick: the waiting-on moves to the next required item's person", () => {
  const a = item("negotiating", { assignee: am, sortOrder: 0 });
  const b = item("negotiating", { assignee: ja, sortOrder: 1, label: "Tenant checked against the thresholds" });
  a.done = true;
  const change = waitingAfterTick(stored({ party: "Landsec asset manager", name: "Alex Mann", checklistItemId: a.id }), a.id, true, checklist("negotiating", [a, b]));
  assert.deepEqual(change, { action: "move", itemId: b.id, party: "Joint agent", name: "Jo Agent", note: "Tenant checked against the thresholds" });
});

test("tick: it moves on even if the ticked item is still read as open", () => {
  const a = item("negotiating", { assignee: am, sortOrder: 0 });
  const b = item("negotiating", { assignee: victoria, sortOrder: 1 });
  const change = waitingAfterTick(stored({ checklistItemId: a.id }), a.id, true, checklist("negotiating", [a, b]));
  assert.equal(change.action === "move" && change.itemId, b.id);
});

test("tick: ticking the last required item clears the waiting-on", () => {
  const a = item("negotiating", { assignee: am, done: true });
  const later = item("under_offer", { assignee: am });
  const optional = item("negotiating", { assignee: am, required: false });
  assert.deepEqual(waitingAfterTick(stored({ party: "BGP", checklistItemId: a.id }), a.id, true, checklist("negotiating", [a, later, optional])), { action: "clear" });
});

test("tick: the next item falls to the person responsible for the deal", () => {
  const a = item("negotiating", { assignee: am, done: true, sortOrder: 0 });
  const b = item("negotiating", { sortOrder: 1 });
  const change = waitingAfterTick(stored({ checklistItemId: a.id }), a.id, true, checklist("negotiating", [a, b], { responsible: victoria }));
  assert.equal(change.action === "move" && change.name, "Victoria Broadhead");
  assert.equal(change.action === "move" && change.party, "BGP");
});

test("tick: an item the deal is not waiting on changes nothing", () => {
  const a = item("negotiating", { assignee: am });
  const b = item("negotiating", { assignee: ja, done: true });
  const cl = checklist("negotiating", [a, b]);
  assert.deepEqual(waitingAfterTick(stored({ checklistItemId: a.id }), b.id, true, cl), { action: "none" });
  // A typed waiting-on with no item behind it is never moved by a tick.
  assert.deepEqual(waitingAfterTick(stored({ party: "Tenant" }), b.id, true, cl), { action: "none" });
  assert.deepEqual(waitingAfterTick(null, b.id, true, cl), { action: "none" });
});

test("untick: nothing moves back", () => {
  const a = item("negotiating", { assignee: am });
  const b = item("negotiating", { assignee: ja });
  const cl = checklist("negotiating", [a, b]);
  assert.deepEqual(waitingAfterTick(stored({ checklistItemId: a.id }), a.id, false, cl), { action: "none" });
  // The deal moved on to b when a was ticked; unticking a leaves it on b.
  assert.deepEqual(waitingAfterTick(stored({ checklistItemId: b.id }), a.id, false, cl), { action: "none" });
});

test("tick: a link to another deal's checklist is dropped, never followed", () => {
  const a = item("negotiating", { assignee: am, done: true });
  const b = item("negotiating", { assignee: ja });
  const other = checklist("negotiating", [a, b], { dealId: "another-deal" });
  assert.deepEqual(waitingAfterTick(stored({ checklistItemId: a.id }), a.id, true, other), { action: "unlink" });
  assert.deepEqual(waitingAfterTick(stored({ checklistItemId: a.id }), a.id, true, null), { action: "unlink" });
});

// ── Deleting and re-assigning the linked item ───────────────────────────
test("delete: the link goes and the words stay", () => {
  assert.deepEqual(waitingAfterDelete(stored({ party: "Tenant", name: "Typed name", checklistItemId: "x" }), "x"), { action: "unlink" });
  assert.deepEqual(waitingAfterDelete(stored({ party: "Tenant", checklistItemId: "x" }), "y"), { action: "none" });
  assert.deepEqual(waitingAfterDelete(stored({ party: "Tenant" }), "x"), { action: "none" });
  assert.deepEqual(waitingAfterDelete(null, "x"), { action: "none" });
});

test("assign: the waiting-on follows the item to its new person", () => {
  const a = item("negotiating", { assignee: ja });
  const cl = checklist("negotiating", [a]);
  const was = stored({ party: "Landsec asset manager", name: "Alex Mann", checklistItemId: a.id });
  assert.deepEqual(waitingAfterAssign(was, a.id, cl, "Alex Mann"), { action: "update", party: "Joint agent", name: "Jo Agent", restart: true });
  // The same party, a new name: the clock keeps running.
  const b = item("negotiating", { assignee: { ...am, name: "Another Manager" } });
  assert.deepEqual(waitingAfterAssign({ ...was, checklistItemId: b.id }, b.id, checklist("negotiating", [b]), "Alex Mann"),
    { action: "update", party: "Landsec asset manager", name: "Another Manager", restart: false });
});

test("assign: a waiting-on someone typed over is left as typed", () => {
  const a = item("negotiating", { assignee: ja });
  const typed = stored({ party: "Tenant's solicitors", name: "Smith LLP", checklistItemId: a.id });
  assert.deepEqual(waitingAfterAssign(typed, a.id, checklist("negotiating", [a]), "Victoria Broadhead"), { action: "none" });
});

test("assign: taken off the item, it falls to the deal's person, or keeps the party with no name", () => {
  const a = item("negotiating");
  const was = stored({ party: "Landsec asset manager", name: "Alex Mann", checklistItemId: a.id });
  assert.deepEqual(waitingAfterAssign(was, a.id, checklist("negotiating", [a], { responsible: victoria }), "Alex Mann"),
    { action: "update", party: "BGP", name: "Victoria Broadhead", restart: true });
  assert.deepEqual(waitingAfterAssign(was, a.id, checklist("negotiating", [a]), "Alex Mann"),
    { action: "update", party: "Landsec asset manager", name: null, restart: false });
  // Another item changing hands, or another deal's checklist, changes nothing.
  assert.deepEqual(waitingAfterAssign(was, "other", checklist("negotiating", [a]), "Alex Mann"), { action: "none" });
  assert.deepEqual(waitingAfterAssign(was, a.id, checklist("negotiating", [a], { dealId: "another-deal" }), "Alex Mann"), { action: "none" });
});

// ── Task flags ──────────────────────────────────────────────────────────
test("flag: the stored link decides when someone has set the waiting-on", () => {
  const a = item("negotiating", { assignee: am, sortOrder: 0, assignedAt: ago(20) });
  const b = item("negotiating", { assignee: ja, sortOrder: 1 });
  const cl = checklist("negotiating", [a, b]);
  const set = stored({ party: "Joint agent", name: "Jo Agent", since: ago(3), checklistItemId: b.id });
  assert.deepEqual(waitingFlagFor(b.id, set, cl, NOW), { waitingOnDeal: true, waitingDays: 3 });
  // a would be the derived one, but a person has said the deal waits on b.
  assert.deepEqual(waitingFlagFor(a.id, set, cl, NOW), { waitingOnDeal: false, waitingDays: null });
});

test("flag: a typed waiting-on with no item means no task is the one waited on", () => {
  const a = item("negotiating", { assignee: am });
  const cl = checklist("negotiating", [a]);
  assert.deepEqual(waitingFlagFor(a.id, stored({ party: "Tenant" }), cl, NOW), { waitingOnDeal: false, waitingDays: null });
});

test("flag: with nothing set, the item read from the checklist is the one", () => {
  const a = item("negotiating", { assignee: am, sortOrder: 0, assignedAt: ago(9) });
  const b = item("negotiating", { assignee: ja, sortOrder: 1 });
  const cl = checklist("negotiating", [a, b]);
  assert.deepEqual(waitingFlagFor(a.id, null, cl, NOW), { waitingOnDeal: true, waitingDays: 9 });
  assert.deepEqual(waitingFlagFor(b.id, null, cl, NOW), { waitingOnDeal: false, waitingDays: null });
  // A clock row that holds only a dependency is "nothing set".
  assert.equal(hasStoredWaiting(stored()), false);
  assert.equal(waitingFlagFor(a.id, stored(), cl, NOW).waitingOnDeal, true);
});

test("flag: a done item, an unknown item, no checklist or another deal's clock is never the one", () => {
  const a = item("negotiating", { assignee: am, done: true });
  const cl = checklist("negotiating", [a]);
  const no = { waitingOnDeal: false, waitingDays: null };
  assert.deepEqual(waitingFlagFor(a.id, stored({ checklistItemId: a.id }), cl, NOW), no);
  assert.deepEqual(waitingFlagFor("missing", null, cl, NOW), no);
  assert.deepEqual(waitingFlagFor(a.id, null, null, NOW), no);
  const open = item("negotiating", { assignee: am });
  // Another deal's stored waiting-on says nothing about this checklist: read it from the checklist.
  assert.equal(waitingFlagFor(open.id, stored({ dealId: "another-deal", party: "Tenant" }), checklist("negotiating", [open]), NOW).waitingOnDeal, true);
});

// ── The clock a screen is sent ──────────────────────────────────────────
const blankClock = { waitingOnParty: null, waitingOnName: null, waitingSince: null, waitingNote: null, dependsOnDealId: null, updatedAt: null, updatedByName: null };

test("clock: what a person set is sent as set, with the linked item's name", () => {
  const a = item("negotiating", { assignee: am, label: "Approval in place" });
  const cl = checklist("negotiating", [a]);
  const c = waitingClockFor({ ...blankClock, waitingOnParty: "Tenant", checklistItemId: a.id }, cl, DEAL)!;
  assert.equal(c.derived, false); assert.equal(c.waitingOnParty, "Tenant"); assert.equal(c.checklistItemLabel, "Approval in place");
  // Typed with no item: nothing from the checklist is laid over it.
  const typed = waitingClockFor({ ...blankClock, waitingOnParty: "Tenant", waitingOnName: "Typed" }, cl, DEAL)!;
  assert.equal(typed.derived, false); assert.equal(typed.checklistItemId, null); assert.equal(typed.waitingOnName, "Typed");
});

test("clock: nothing set, the checklist's item is shown as derived", () => {
  const a = item("negotiating", { assignee: am, assignedAt: ago(4), label: "Approval in place" });
  const cl = checklist("negotiating", [a]);
  const c = waitingClockFor(null, cl, DEAL)!;
  assert.equal(c.derived, true); assert.equal(c.waitingOnParty, "Landsec asset manager"); assert.equal(c.waitingOnName, "Alex Mann");
  assert.equal(c.waitingNote, "Approval in place"); assert.equal(c.checklistItemId, a.id); assert.equal(c.waitingSince, ago(4));
  // A stored dependency is kept beside the derived waiting-on.
  const dep = waitingClockFor({ ...blankClock, dependsOnDealId: "d2" }, cl, DEAL)!;
  assert.equal(dep.derived, true); assert.equal(dep.dependsOnDealId, "d2");
});

test("clock: no checklist, another deal's checklist or nothing open leaves it as stored", () => {
  assert.equal(waitingClockFor(null, null, DEAL), null);
  const other = checklist("negotiating", [item("negotiating", { assignee: am })], { dealId: "another-deal" });
  assert.equal(waitingClockFor(null, other, DEAL), null);
  const none = waitingClockFor({ ...blankClock, dependsOnDealId: "d2" }, other, DEAL)!;
  assert.equal(none.derived, false); assert.equal(none.waitingOnParty, null);
  // A stored link whose item is on another deal's checklist carries no item name.
  const stale = waitingClockFor({ ...blankClock, waitingOnParty: "BGP", checklistItemId: other.items[0].id }, other, DEAL)!;
  assert.equal(stale.checklistItemLabel, null);
});

test("named: a party or a person, set by hand or derived, counts as named", () => {
  assert.equal(waitingNamed(null), false);
  assert.equal(waitingNamed(blankClock), false);
  assert.equal(waitingNamed({ ...blankClock, waitingOnParty: "BGP" }), true);
  // A client-side person whose party is not known is still someone named.
  assert.equal(waitingNamed({ ...blankClock, waitingOnName: "Sam Typed" }), true);
  const cl = checklist("negotiating", [item("negotiating", { assignee: noLogin })]);
  assert.equal(waitingNamed(waitingClockFor(null, cl, DEAL)), true);
});

test("days: whole days, never negative, null with no date", () => {
  assert.equal(daysWaiting(ago(0), NOW), 0);
  assert.equal(daysWaiting(ago(30), NOW), 30);
  assert.equal(daysWaiting(new Date(NOW + 86400000), NOW), 0);
  assert.equal(daysWaiting(null, NOW), null);
  assert.equal(daysWaiting("not a date", NOW), null);
});
