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
  WAITING_NEW_ITEM, checklistIsForDeal, daysWaiting, derivedWaiting, hasStoredWaiting, nextWaitingItem, reusableWaitingItem, validWaitingSince, waitedOnItem,
  waitingAfterAssign, waitingAfterDelete, waitingAfterTick, waitingClockFor, waitingClosed, waitingFlagFor, waitingFlagForResponsible, waitingLinkFields,
  waitingNamed, waitingPartyFor, waitingPersonFor, waitingPreviousOf, waitingTargetFor,
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

// Who the item was with before, as the clock would have named them.
const was = (p: WaitingPerson | null) => waitingPreviousOf(p);

test("assign: the waiting-on follows the item to its new person", () => {
  const a = item("negotiating", { assignee: ja });
  const cl = checklist("negotiating", [a]);
  const set = stored({ party: "Landsec asset manager", name: "Alex Mann", checklistItemId: a.id });
  assert.deepEqual(was(am), { name: "Alex Mann", party: "Landsec asset manager" });
  assert.deepEqual(waitingAfterAssign(set, a.id, cl, was(am)), { action: "update", party: "Joint agent", name: "Jo Agent", restart: true });
  // The same party, a new name: the clock keeps running.
  const b = item("negotiating", { assignee: { ...am, name: "Another Manager" } });
  assert.deepEqual(waitingAfterAssign({ ...set, checklistItemId: b.id }, b.id, checklist("negotiating", [b]), was(am)),
    { action: "update", party: "Landsec asset manager", name: "Another Manager", restart: false });
});

test("assign: a waiting-on someone typed over is left as typed", () => {
  const a = item("negotiating", { assignee: ja });
  const typed = stored({ party: "Tenant's solicitors", name: "Smith LLP", checklistItemId: a.id });
  assert.deepEqual(waitingAfterAssign(typed, a.id, checklist("negotiating", [a]), was(victoria)), { action: "none" });
});

// Review, 2026-11-13: the two cases that were misread. A party with no name
// is the normal way to say "waiting on the tenant's solicitors"; a later
// re-assignment turned it into "BGP (name)" and set the days back to 0.
test("assign: a party typed by hand with no name is left as typed, and its clock keeps running", () => {
  const a = item("negotiating", { assignee: victoria });
  const cl = checklist("negotiating", [a]);
  const typed = stored({ party: "Tenant's solicitors", name: null, since: ago(12), note: "their comments on the draft", checklistItemId: a.id });
  // The item had nobody, or the deal's person, or its own person: the same answer.
  assert.deepEqual(waitingAfterAssign(typed, a.id, cl, null), { action: "none" });
  assert.deepEqual(waitingAfterAssign(typed, a.id, cl, was(am)), { action: "none" });
  assert.deepEqual(waitingAfterAssign(typed, a.id, cl, was(ja)), { action: "none" });
  // The same when it is the person responsible for the deal who changes.
  const unassigned = item("negotiating");
  assert.deepEqual(waitingAfterAssign({ ...typed, checklistItemId: unassigned.id }, unassigned.id, checklist("negotiating", [unassigned], { responsible: victoria }), was(am)), { action: "none" });
});

test("assign: a party typed by hand with the old person's name left in the box is left as typed", () => {
  const a = item("negotiating", { assignee: victoria });
  const typed = stored({ party: "Tenant's solicitors", name: "Alex Mann", since: ago(12), checklistItemId: a.id });
  assert.deepEqual(waitingAfterAssign(typed, a.id, checklist("negotiating", [a]), was(am)), { action: "none" });
  // Any party that was not the old person's: a BGP item said to be waiting on Landsec approval.
  const other = stored({ party: "Landsec approval (CAPR)", name: "Victoria Broadhead", checklistItemId: a.id });
  assert.deepEqual(waitingAfterAssign(other, a.id, checklist("negotiating", [item("negotiating", { id: a.id, assignee: ja })]), was(victoria)), { action: "none" });
});

test("assign: it follows when the clock named the old person by their party alone, or named no one", () => {
  const a = item("negotiating", { assignee: ja });
  const cl = checklist("negotiating", [a]);
  // Their party, no name: it was them.
  assert.deepEqual(waitingAfterAssign(stored({ party: "Landsec asset manager", checklistItemId: a.id }), a.id, cl, was(am)),
    { action: "update", party: "Joint agent", name: "Jo Agent", restart: true });
  // Linked with no one named (the item had nobody): the first person it is given to is named.
  assert.deepEqual(waitingAfterAssign(stored({ checklistItemId: a.id }), a.id, cl, null), { action: "update", party: "Joint agent", name: "Jo Agent", restart: true });
});

test("assign: a person whose party is not known keeps the party picked beside their name", () => {
  // Sam is client-side with no known role, so whoever saved it picked the party for them.
  const a = item("negotiating", { assignee: am });
  const set = stored({ party: "Landsec leasing manager", name: "Sam Typed", checklistItemId: a.id });
  assert.deepEqual(was(noLogin), { name: "Sam Typed", party: null });
  assert.deepEqual(waitingAfterAssign(set, a.id, checklist("negotiating", [a]), was(noLogin)), { action: "update", party: "Landsec asset manager", name: "Alex Mann", restart: true });
  // Given to another person of unknown party: the party stays, the name moves, the clock runs on.
  const b = item("negotiating", { assignee: { ...noLogin, name: "Pat Typed" } });
  assert.deepEqual(waitingAfterAssign({ ...set, checklistItemId: b.id }, b.id, checklist("negotiating", [b]), was(noLogin)),
    { action: "update", party: "Landsec leasing manager", name: "Pat Typed", restart: false });
});

test("assign: taken off the item, it falls to the deal's person, or names no one and keeps the link", () => {
  const a = item("negotiating");
  const set = stored({ party: "Landsec asset manager", name: "Alex Mann", checklistItemId: a.id });
  assert.deepEqual(waitingAfterAssign(set, a.id, checklist("negotiating", [a], { responsible: victoria }), was(am)),
    { action: "update", party: "BGP", name: "Victoria Broadhead", restart: true });
  // Nobody at all: no one is named, the clock is not restarted, and the next person it is given to is followed.
  assert.deepEqual(waitingAfterAssign(set, a.id, checklist("negotiating", [a]), was(am)), { action: "update", party: null, name: null, restart: false });
  const given = item("negotiating", { id: a.id, assignee: ja });
  assert.deepEqual(waitingAfterAssign(stored({ checklistItemId: a.id }), a.id, checklist("negotiating", [given]), null),
    { action: "update", party: "Joint agent", name: "Jo Agent", restart: true });
  // Another item changing hands, another deal's checklist, or a closed deal changes nothing.
  assert.deepEqual(waitingAfterAssign(set, "other", checklist("negotiating", [a]), was(am)), { action: "none" });
  assert.deepEqual(waitingAfterAssign(set, a.id, checklist("negotiating", [a], { dealId: "another-deal" }), was(am)), { action: "none" });
  assert.deepEqual(waitingAfterAssign(set, a.id, checklist("negotiating", [a], { responsible: victoria, closed: true }), was(am)), { action: "none" });
});

// Review, 2026-11-13: a linked item handed from a BGP person to a Landsec
// login with no role (a full Landsec login has no role row) kept "BGP" beside
// the Landsec name, with the BGP person's days.
const noRole: WaitingPerson = { userId: "u-mark", name: "Mark Warne", side: "client", role: null };
test("assign: a party that was the old person's own is not left beside a person whose party is not known", () => {
  const a = item("negotiating", { assignee: noRole });
  const cl = checklist("negotiating", [a]);
  const set = stored({ party: "BGP", name: "Victoria Broadhead", since: ago(9), checklistItemId: a.id });
  assert.deepEqual(waitingAfterAssign(set, a.id, cl, was(victoria)), { action: "update", party: null, name: "Mark Warne", restart: true });
  // The same from a joint agent or an asset manager: their party was theirs, not the new person's.
  assert.deepEqual(waitingAfterAssign(stored({ party: "Joint agent", name: "Jo Agent", checklistItemId: a.id }), a.id, cl, was(ja)),
    { action: "update", party: null, name: "Mark Warne", restart: true });
  assert.deepEqual(waitingAfterAssign(stored({ party: "Landsec asset manager", name: "Alex Mann", checklistItemId: a.id }), a.id, cl, was(am)),
    { action: "update", party: null, name: "Mark Warne", restart: true });
  // Named by their party alone, or by their name alone: the days were the old person's, so the clock restarts.
  assert.deepEqual(waitingAfterAssign(stored({ party: "BGP", checklistItemId: a.id }), a.id, cl, was(victoria)), { action: "update", party: null, name: "Mark Warne", restart: true });
  assert.deepEqual(waitingAfterAssign(stored({ name: "Victoria Broadhead", checklistItemId: a.id }), a.id, cl, was(victoria)), { action: "update", party: null, name: "Mark Warne", restart: true });
  // A name alone handed to someone of the same party: a new name, the clock runs on.
  const b = item("negotiating", { assignee: { ...victoria, name: "Ben Sykes" } });
  assert.deepEqual(waitingAfterAssign(stored({ name: "Victoria Broadhead", checklistItemId: b.id }), b.id, checklist("negotiating", [b]), was(victoria)),
    { action: "update", party: "BGP", name: "Ben Sykes", restart: false });
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

// ── The person responsible for the deal ─────────────────────────────────
// Review, 2026-11-13: of 46 deals with a waiting-on read from the checklist,
// 44 fell to the deal's person, whose only task is the deal-level one.
test("deal's person: flagged when the waited-on item has nobody of its own", () => {
  const a = item("negotiating", { sortOrder: 0 });
  const b = item("negotiating", { assignee: am, sortOrder: 1, assignedAt: ago(5) });
  const cl = checklist("negotiating", [a, b], { responsible: victoria });
  // Read from the checklist: a is first and falls to Victoria. No date is kept for that.
  assert.deepEqual(waitingFlagForResponsible(null, cl, NOW), { waitingOnDeal: true, waitingDays: null });
  assert.equal(waitedOnItem(null, cl)?.item.id, a.id);
  // The item's own task (it has none) is never the one: not both.
  assert.deepEqual(waitingFlagFor(b.id, null, cl, NOW), { waitingOnDeal: false, waitingDays: null });
  // Set by a person on that item: the days are the clock's.
  assert.deepEqual(waitingFlagForResponsible(stored({ party: "BGP", name: "Victoria Broadhead", since: ago(7), checklistItemId: a.id }), cl, NOW), { waitingOnDeal: true, waitingDays: 7 });
});

test("deal's person: not flagged when the item has its own person, nothing is waited on, or nobody is responsible", () => {
  const no = { waitingOnDeal: false, waitingDays: null };
  const own = item("negotiating", { assignee: am, assignedAt: ago(5), sortOrder: 0 });
  const free = item("negotiating", { sortOrder: 1 });
  const cl = checklist("negotiating", [own, free], { responsible: victoria });
  // The deal waits on Alex's item: his task is flagged, Victoria's is not.
  assert.deepEqual(waitingFlagForResponsible(null, cl, NOW), no);
  assert.deepEqual(waitingFlagFor(own.id, null, cl, NOW), { waitingOnDeal: true, waitingDays: 5 });
  // Set by hand on Alex's item, or typed with no item behind it.
  assert.deepEqual(waitingFlagForResponsible(stored({ party: "Landsec asset manager", checklistItemId: own.id }), cl, NOW), no);
  assert.deepEqual(waitingFlagForResponsible(stored({ party: "Tenant" }), cl, NOW), no);
  // A stored link to a done item, no checklist, or nobody responsible for the deal.
  assert.deepEqual(waitingFlagForResponsible(stored({ checklistItemId: free.id }), checklist("negotiating", [own, { ...free, done: true }], { responsible: victoria }), NOW), no);
  assert.deepEqual(waitingFlagForResponsible(null, null, NOW), no);
  assert.deepEqual(waitingFlagForResponsible(stored({ checklistItemId: free.id }), checklist("negotiating", [free]), NOW), no);
  // After a tick moves the waiting-on to an unassigned item, the deal's person is the one.
  const moved = waitingAfterTick(stored({ checklistItemId: own.id }), own.id, true, checklist("negotiating", [{ ...own, done: true }, free], { responsible: victoria }));
  assert.equal(moved.action === "move" && moved.itemId, free.id);
  assert.equal(waitingFlagForResponsible(stored({ party: "BGP", name: "Victoria Broadhead", since: ago(0), checklistItemId: free.id }), checklist("negotiating", [{ ...own, done: true }, free], { responsible: victoria }), NOW).waitingOnDeal, true);
});

// Review, 2026-11-13: a task said "Deal is waiting on you" while the Deals
// table said the deal was waiting on the tenant's solicitors. A linked item
// can carry a party typed by hand; the flag follows who the clock names.
test("flag: a linked item whose clock names another party flags no task", () => {
  const no = { waitingOnDeal: false, waitingDays: null };
  const typed = { party: "Tenant's solicitors", name: null, since: ago(12), note: "their comments on the draft" };
  // The item falls to Victoria as the deal's person: her deal-level task is not flagged.
  const free = item("negotiating");
  const cl = checklist("negotiating", [free], { responsible: victoria });
  const set = stored({ ...typed, checklistItemId: free.id });
  assert.deepEqual(waitingFlagForResponsible(set, cl, NOW), no);
  // The Deals table still says who it is waiting on, with the item's name.
  const clock = waitingClockFor({ waitingOnParty: typed.party, waitingOnName: null, waitingSince: typed.since, waitingNote: typed.note, dependsOnDealId: null, dependsOn: null, dependsOnHidden: false, updatedAt: null, updatedByName: null, checklistItemId: free.id }, cl, DEAL);
  assert.equal(clock?.waitingOnParty, "Tenant's solicitors");
  assert.equal(clock?.checklistItemLabel, free.label);
  // The same when the item is Victoria's own: her item task is not flagged either.
  const own = item("negotiating", { assignee: victoria });
  assert.deepEqual(waitingFlagFor(own.id, stored({ ...typed, checklistItemId: own.id }), checklist("negotiating", [own]), NOW), no);
  // Another person's name, or another party beside no name.
  assert.deepEqual(waitingFlagFor(own.id, stored({ party: "BGP", name: "Smith LLP", checklistItemId: own.id }), checklist("negotiating", [own]), NOW), no);
  assert.deepEqual(waitingFlagFor(own.id, stored({ party: "Joint agent", checklistItemId: own.id }), checklist("negotiating", [own]), NOW), no);
  assert.deepEqual(waitingFlagForResponsible(stored({ name: "Jo Agent", checklistItemId: free.id }), cl, NOW), no);
});

test("flag: a linked item whose clock names its person, their party or no one flags their task", () => {
  const own = item("negotiating", { assignee: victoria });
  const cl = checklist("negotiating", [own]);
  const yes = { waitingOnDeal: true, waitingDays: 4 };
  assert.deepEqual(waitingFlagFor(own.id, stored({ party: "BGP", name: "Victoria Broadhead", since: ago(4), checklistItemId: own.id }), cl, NOW), yes);
  assert.deepEqual(waitingFlagFor(own.id, stored({ name: "victoria  broadhead", since: ago(4), checklistItemId: own.id }), cl, NOW), yes);
  assert.deepEqual(waitingFlagFor(own.id, stored({ party: "BGP", since: ago(4), checklistItemId: own.id }), cl, NOW), yes);
  assert.deepEqual(waitingFlagFor(own.id, stored({ since: ago(4), checklistItemId: own.id }), cl, NOW), yes);
  // Their name beside a party picked for them (a person whose own party is not known).
  const sams = item("negotiating", { assignee: noLogin });
  assert.deepEqual(waitingFlagFor(sams.id, stored({ party: "Landsec leasing manager", name: "Sam Typed", since: ago(4), checklistItemId: sams.id }), checklist("negotiating", [sams]), NOW), yes);
  // The deal's person, named by party alone.
  const free = item("negotiating");
  assert.deepEqual(waitingFlagForResponsible(stored({ party: "BGP", since: ago(4), checklistItemId: free.id }), checklist("negotiating", [free], { responsible: victoria }), NOW), yes);
});

// ── A closed deal is waiting on no one ──────────────────────────────────
// Review, 2026-11-13: a required item left open when a letting completed or
// was withdrawn kept "Deal is waiting on you" on its owner's task list.
test("closed: which statuses are closed", () => {
  for (const code of ["WIT", "COM", "INV", "ARCH", "wit"]) assert.equal(waitingClosed(code), true, code);
  for (const code of ["AVA", "NEG", "HOT", "SOL", "EXC", "", null, undefined]) assert.equal(waitingClosed(code), false, String(code));
});

test("closed: no task is flagged, read from the checklist or stored", () => {
  const no = { waitingOnDeal: false, waitingDays: null };
  const a = item("enquiry", { assignee: am, assignedAt: ago(43) });
  const free = item("enquiry", { sortOrder: 1 });
  const live = checklist("enquiry", [a, free], { responsible: victoria });
  const closed = { ...live, closed: true };
  // Live, the same checklist flags the item (the reviewer's 43 days).
  assert.deepEqual(waitingFlagFor(a.id, null, live, NOW), { waitingOnDeal: true, waitingDays: 43 });
  assert.deepEqual(waitingFlagFor(a.id, null, closed, NOW), no);
  // A link stored while the deal was live no longer counts.
  const link = stored({ party: "Landsec asset manager", name: "Alex Mann", since: ago(43), checklistItemId: a.id });
  assert.deepEqual(waitingFlagFor(a.id, link, live, NOW), { waitingOnDeal: true, waitingDays: 43 });
  assert.deepEqual(waitingFlagFor(a.id, link, closed, NOW), no);
  assert.equal(waitedOnItem(link, closed), null);
  // Nor is the deal's person flagged.
  const viaDeal = stored({ party: "BGP", checklistItemId: free.id });
  assert.equal(waitingFlagForResponsible(viaDeal, live, NOW).waitingOnDeal, true);
  assert.deepEqual(waitingFlagForResponsible(viaDeal, closed, NOW), no);
  assert.deepEqual(waitingFlagForResponsible(null, { ...checklist("enquiry", [free], { responsible: victoria }), closed: true }, NOW), no);
});

test("closed: nothing is read from the checklist, and what was typed is shown as typed", () => {
  const a = item("negotiating", { assignee: am, label: "Approval in place" });
  const closed = checklist("negotiating", [a], { closed: true });
  assert.equal(nextWaitingItem(closed), null);
  assert.equal(derivedWaiting(closed, DEAL), null);
  assert.equal(waitingClockFor(null, closed, DEAL), null);
  // The same answer as being handed no checklist at all (what the unit page does for a closed deal).
  const typed = { ...blankClock, waitingOnParty: "Tenant", waitingOnName: "Typed", checklistItemId: a.id };
  assert.deepEqual(waitingClockFor(typed, closed, DEAL), waitingClockFor(typed, null, DEAL));
  assert.equal(waitingClockFor(typed, closed, DEAL)!.waitingOnParty, "Tenant");
  assert.equal(waitingClockFor(typed, closed, DEAL)!.derived, false);
});

test("closed: ticking the linked item keeps the words and drops the link, and moves on to nothing", () => {
  const a = item("negotiating", { assignee: am, done: true, sortOrder: 0 });
  const b = item("negotiating", { assignee: ja, sortOrder: 1 });
  const set = stored({ party: "Landsec asset manager", name: "Alex Mann", checklistItemId: a.id });
  assert.equal(waitingAfterTick(set, a.id, true, checklist("negotiating", [a, b])).action, "move");
  assert.deepEqual(waitingAfterTick(set, a.id, true, checklist("negotiating", [a, b], { closed: true })), { action: "unlink" });
});

// ── Saving from the editor ──────────────────────────────────────────────
// Review, 2026-11-13: two identical saves of a typed item made two checklist
// items and two tasks.
test("typed item: an open item with the same words at the same stage is reused", () => {
  const rows = [
    { id: "1", label: "Chase the tenant's solicitor", stage: "negotiating", done: false },
    { id: "2", label: "Chase the tenant's solicitor", stage: "under_offer", done: false },
    { id: "3", label: "Survey booked", stage: "negotiating", done: true },
  ];
  assert.equal(reusableWaitingItem(rows, "Chase the tenant's solicitor", "negotiating")?.id, "1");
  // Case and spacing do not make it a different item.
  assert.equal(reusableWaitingItem(rows, "  chase the  TENANT'S solicitor ", "negotiating")?.id, "1");
  // Another stage's item is that stage's; a ticked item is the record, never reused.
  assert.equal(reusableWaitingItem(rows, "Chase the tenant's solicitor", "enquiry"), null);
  assert.equal(reusableWaitingItem(rows, "Survey booked", "negotiating"), null);
  // Different words are a different item.
  assert.equal(reusableWaitingItem(rows, "Chase the tenant's solicitors", "negotiating"), null);
  assert.equal(reusableWaitingItem([], "Anything", "negotiating"), null);
});

test("since: nothing or a real date is accepted, anything else is refused before a write", () => {
  for (const ok of [undefined, null, "", "2026-11-13", "2026-11-13T09:30:00Z", new Date(NOW), NOW]) assert.equal(validWaitingSince(ok), true, String(ok));
  for (const bad of ["not a date", "2026-13-45", "13/11/2026x", {}, [], true]) assert.equal(validWaitingSince(bad), false, JSON.stringify(bad));
});

// Review, 2026-11-13: opening the editor on a link that names no one (an item
// with nobody responsible) and saving any other box sent checklistItemId null.
test("editor: saving a linked waiting-on with no one named keeps the link", () => {
  const form = { item: "i-1", newLabel: "", personKey: "", party: "", name: "" };
  // It opened with no one named: nothing about the link is sent, so the server leaves it.
  assert.deepEqual(waitingLinkFields(form, { item: "i-1", named: false, derived: false }), {});
  assert.equal("checklistItemId" in waitingLinkFields(form, { item: "i-1", named: false, derived: false }), false);
  // It opened on someone and the person chose "no one": the link is cleared with it.
  assert.deepEqual(waitingLinkFields(form, { item: "i-1", named: true, derived: false }), { checklistItemId: null });
  // Read from the checklist and set to no one: stored as no one, with no link.
  assert.deepEqual(waitingLinkFields(form, { item: "i-1", named: true, derived: true }), { checklistItemId: null });
  // Nothing linked and no one named: nothing to send.
  assert.deepEqual(waitingLinkFields({ ...form, item: "" }, { item: "", named: false, derived: false }), {});
});

test("editor: the link is sent when it changes, to keep a derived one, and with a person or a typed item", () => {
  const form = { item: "i-1", newLabel: "", personKey: "", party: "BGP", name: "Victoria Broadhead" };
  // Unchanged and set by a person: left out.
  assert.deepEqual(waitingLinkFields(form, { item: "i-1", named: true, derived: false }), {});
  // Read from the checklist: sent, so saving keeps it.
  assert.deepEqual(waitingLinkFields(form, { item: "i-1", named: true, derived: true }), { checklistItemId: "i-1" });
  // Another item, or "not a checklist item".
  assert.deepEqual(waitingLinkFields({ ...form, item: "i-2" }, { item: "i-1", named: true, derived: false }), { checklistItemId: "i-2" });
  assert.deepEqual(waitingLinkFields({ ...form, item: "" }, { item: "i-1", named: true, derived: false }), { checklistItemId: null });
  // A linked item with no one named, given a party: nothing about the link changes.
  assert.deepEqual(waitingLinkFields({ ...form, name: "" }, { item: "i-1", named: false, derived: false }), {});
  // A person made responsible names the item, even when the link is unchanged.
  assert.deepEqual(waitingLinkFields({ ...form, personKey: "user:u-am" }, { item: "i-1", named: true, derived: false }), { personKey: "user:u-am", checklistItemId: "i-1" });
  // A typed item goes by its words, never with an id.
  assert.deepEqual(waitingLinkFields({ ...form, item: WAITING_NEW_ITEM, newLabel: "  Chase the solicitor ", personKey: "user:u-am" }, { item: "i-1", named: true, derived: false }),
    { newItemLabel: "Chase the solicitor", personKey: "user:u-am" });
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

// ── The shared diary reads the same waiting-on ──────────────────────────
// "Deals waiting on someone" (server/brand-crm-diary.ts) shows what a person
// set on the deal clock, else what the checklist gives, through the same
// rule as the Deals page, so one deal never reads differently in two places.
const DIARY_SCHEMES = [{ key: "bluewater", name: "Bluewater", town: "Kent", group: "South", regions: ["South East"], canonicalId: "p-blue", propertyIds: ["p-blue"] }];
const diaryRow = (over: Record<string, any>) => ({
  deal_id: DEAL, waiting_on_party: null, waiting_on_name: null, waiting_since: null, waiting_note: null, checklist_item_id: null, status: "HOTs", tenant_id: null, brand_name: null,
  property_id: "p-blue", property_name: "Bluewater Shopping Centre", tenancy_unit_id: "ts-1", unit_label: "Unit L104", owner_name: "Alex Todd", ...over,
});
async function diaryFor(kind: "staff" | "joint_agent", rows: any[], checklists: WaitingChecklist[]) {
  process.env.DATABASE_URL ||= "postgres://test:test@127.0.0.1:1/test";
  const { loadDiary } = await import("./brand-crm-diary");
  const asked: string[][] = [];
  const calls: { tag: string; values: any[] }[] = [];
  const db = { async query(sql: string, values: any[] = []) {
    const tag = sql.match(/\/\* brand-diary:([a-z-]+) \*\//)?.[1] || "untagged";
    calls.push({ tag, values });
    return { rows: tag === "deal-clocks" ? rows : [] };
  } };
  const viewer = kind === "staff"
    ? { kind: "staff" as const, clientCompanyId: null, schemes: null, userId: "u-bgp" }
    : { kind: "joint_agent" as const, clientCompanyId: "landsec-co", schemes: new Set(["bluewater"]), userId: "u-ja" };
  const diary = await loadDiary(db, viewer, DIARY_SCHEMES, {
    now: new Date(NOW), brandSliceSql: kind === "staff" ? null : "TRUE", engagement: async () => ({ strategies: [], events: [], actions: [] }),
    waitingChecklists: async ids => { asked.push(ids); return new Map(checklists.filter(c => c.dealId && ids.includes(c.dealId)).map(c => [c.dealId!, c])); },
  });
  return { waiting: diary.items.filter(i => i.kind === "deal_waiting"), asked, calls };
}

test("diary: a deal nobody set a waiting-on for shows the one read from its checklist", async () => {
  const a = item("negotiating", { assignee: victoria, assignedAt: ago(6) });
  const cl = checklist("negotiating", [a]);
  const { waiting, asked, calls } = await diaryFor("staff", [diaryRow({})], [cl]);
  assert.deepEqual(asked, [[DEAL]]);
  assert.equal(waiting.length, 1);
  assert.equal(waiting[0].id, `deal_waiting:${DEAL}`);
  assert.equal(waiting[0].title, "Deal waiting on BGP");
  assert.deepEqual(waiting[0].waitingOn, { side: "bgp", name: "BGP (Victoria Broadhead)" });
  assert.equal(waiting[0].daysWaiting, 6);
  // The same party, name and item the Deals page is sent.
  const clock = waitingClockFor(null, cl, DEAL)!;
  assert.equal(clock.waitingOnParty, "BGP"); assert.equal(clock.waitingOnName, "Victoria Broadhead");
  // Checklists are read only at the Landsec schemes.
  assert.deepEqual(calls.find(c => c.tag === "deal-clocks")!.values, [null, ["p-blue"]]);
});

test("diary: a joint agent is told the party, never the person", async () => {
  const cl = checklist("negotiating", [item("negotiating", { assignee: victoria })]);
  const { waiting } = await diaryFor("joint_agent", [diaryRow({})], [cl]);
  assert.deepEqual(waiting.map(i => i.waitingOn), [{ side: "bgp", name: "BGP" }]);
  // A person with no known party is "a named person" to a joint agent, and named to BGP staff.
  const unknown = checklist("negotiating", [item("negotiating", { assignee: noLogin })]);
  assert.deepEqual((await diaryFor("joint_agent", [diaryRow({})], [unknown])).waiting.map(i => i.waitingOn), [{ side: "other", name: "a named person" }]);
  assert.deepEqual((await diaryFor("staff", [diaryRow({})], [unknown])).waiting.map(i => i.waitingOn), [{ side: "other", name: "Sam Typed" }]);
});

test("diary: what a person set wins, and a deal waiting on nothing is left out", async () => {
  const a = item("negotiating", { assignee: victoria });
  const cl = checklist("negotiating", [a]);
  // Set by hand: shown as set, and the checklist is not even read for it.
  const set = await diaryFor("staff", [diaryRow({ waiting_on_party: "Tenant's solicitors", waiting_since: ago(3), checklist_item_id: a.id })], [cl]);
  assert.deepEqual(set.asked, []);
  assert.deepEqual(set.waiting.map(i => [i.title, i.daysWaiting]), [["Deal waiting on Tenant's solicitors", 3]]);
  // Linked with no one named: nothing is laid over it from the checklist.
  const linked = await diaryFor("staff", [diaryRow({ checklist_item_id: a.id })], [cl]);
  assert.deepEqual(linked.asked, []); assert.equal(linked.waiting.length, 0);
  // No checklist, nothing required open, a closed deal by its status, or a closed checklist: not in the diary.
  assert.equal((await diaryFor("staff", [diaryRow({})], [])).waiting.length, 0);
  assert.equal((await diaryFor("staff", [diaryRow({})], [checklist("negotiating", [item("negotiating", { assignee: victoria, done: true })])])).waiting.length, 0);
  assert.deepEqual((await diaryFor("staff", [diaryRow({ status: "Completed" })], [cl])).asked, []);
  assert.equal((await diaryFor("staff", [diaryRow({})], [{ ...cl, closed: true }])).waiting.length, 0);
});

// ── Where a login's task list is ────────────────────────────────────────
// A full Landsec login has no role row, so its role alone reads like a BGP
// login's and its "New task" push opened /tasks. The login's own team says
// which it is (tasksPathForLogin in server/deal-checklist.ts, used by the
// checklist's push and by tasksPathForUser in server/routes.ts).
test("tasks path: a Landsec role or a full Landsec login goes to /landsec/tasks, everyone else to /tasks", async () => {
  process.env.DATABASE_URL ||= "postgres://test:test@127.0.0.1:1/test";
  const { tasksPathForLogin } = await import("./deal-checklist");
  const asked: { sql: string; values: any[] }[] = [];
  const db = (row: any, fail = false) => ({ async query(sql: string, values: any[] = []) { asked.push({ sql, values }); if (fail) throw new Error("no table"); return { rows: row ? [row] : [] }; } });
  assert.equal(await tasksPathForLogin("u-ja", db({ landsec_role: "joint_agent", landsec_login: true })), "/landsec/tasks");
  assert.equal(await tasksPathForLogin("u-am", db({ landsec_role: "asset_manager", landsec_login: true })), "/landsec/tasks");
  // Mark Warne: a client login on the Landsec team, no role row.
  assert.equal(await tasksPathForLogin("u-mark", db({ landsec_role: null, landsec_login: true })), "/landsec/tasks");
  // BGP staff (also when viewing as Landsec), another client's login, an unknown id, a failed read, no id.
  assert.equal(await tasksPathForLogin("u-victoria", db({ landsec_role: null, landsec_login: false })), "/tasks");
  assert.equal(await tasksPathForLogin("u-gone", db(null)), "/tasks");
  assert.equal(await tasksPathForLogin("u-any", db(null, true)), "/tasks");
  assert.equal(await tasksPathForLogin(null, db({ landsec_role: null, landsec_login: true })), "/tasks");
  // What makes a full Landsec login: a client login (role Client, or an email outside BGP) on the Landsec team.
  const sql = asked[0].sql.replace(/\s+/g, " ");
  assert.match(sql, /\(u\.role = 'Client' OR \(COALESCE\(u\.email, ''\) <> '' AND lower\(u\.email\) NOT LIKE \$2\)\) AND regexp_replace\(lower\(COALESCE\(u\.team, ''\)\), '\[\^a-z\]', '', 'g'\) IN \('landsec', 'landsecurities'\)/);
  assert.deepEqual(asked[0].values, ["u-ja", "%@brucegillinghampollard.com"]);
});
