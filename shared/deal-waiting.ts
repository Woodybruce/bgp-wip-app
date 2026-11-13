// "Waiting on" linked to the deal checklist (Woody, 2026-11-13: "on the
// waiting on I think this is good but needs to be linked to the deal check
// tasks list"). The deal clock's waiting-on (landsec_deal_clock) can point at
// one item on that deal's checklist (checklist_item_id, migration 0058).
//
// These are the rules, with no database in them, so the server's two tick
// doors, the Deals feed, the unit page and every task list read one answer:
//  - which item a deal's waiting-on moves to when the linked item is ticked;
//  - the waiting-on a deal shows when nobody has set one (worked out on read,
//    never stored);
//  - the party a responsible person stands for.
// Tests: server/deal-waiting.test.ts. Change a rule here, never on a screen.
import { CHECKLIST_STAGES, type ChecklistPerson, type ChecklistSide, type ChecklistStageKey } from "./deal-checklist";
import { LANDSEC_WAITING_PARTIES, type LandsecDealClock } from "./landsec";

export type WaitingParty = (typeof LANDSEC_WAITING_PARTIES)[number];

// Someone responsible, as the rules need them. role is what is known of
// their job: a Landsec login's role (asset_manager, leasing_manager) or what
// they are on the Targeting Brief (client_leasing, senior_asset_manager).
export interface WaitingPerson { userId: string | null; name: string; side: ChecklistSide | null; role: string | null }

export interface WaitingItem {
  id: string;
  stage: string;
  label: string;
  required: boolean;
  sortOrder: number;
  done: boolean;
  assignedAt: string | Date | null;
  assignee: WaitingPerson | null;
}

// One checklist: the deal it is for, the stage that deal is at now, who is
// responsible for the deal, and its items.
export interface WaitingChecklist {
  id: string;
  dealId: string | null;
  stage: ChecklistStageKey;
  responsible: WaitingPerson | null;
  items: WaitingItem[];
}

// What is stored on the deal clock about who the deal is waiting on.
export interface StoredWaiting {
  dealId: string;
  party: string | null;
  name: string | null;
  since: string | Date | null;
  note: string | null;
  checklistItemId: string | null;
}

// The clock as the screens are sent it. checklistItemId is the linked item;
// derived is true when nobody set a waiting-on and it was read from the
// checklist ("from the checklist").
export type WaitingClock = LandsecDealClock & { checklistItemId?: string | null; checklistItemLabel?: string | null; derived?: boolean };

const stageIndex = (stage: string): number => CHECKLIST_STAGES.findIndex(s => s.key === stage);

// The party a responsible person stands for. BGP and a joint agent are their
// own parties. Someone on the client side is the Landsec party that fits
// their role where it is known; otherwise null, and the person saving picks.
export function waitingPartyFor(person: { side: ChecklistSide | null | undefined; role?: string | null } | null | undefined): WaitingParty | null {
  if (!person?.side) return null;
  if (person.side === "bgp") return "BGP";
  if (person.side === "joint_agent") return "Joint agent";
  const role = String(person.role || "").toLowerCase().replace(/[_-]+/g, " ");
  if (/asset\s*manager/.test(role)) return "Landsec asset manager";
  if (/leasing/.test(role)) return "Landsec leasing manager";
  return null;
}

// Who an item is with: its own responsible person, else the person
// responsible for the deal.
export function waitingPersonFor(item: Pick<WaitingItem, "assignee">, checklist: Pick<WaitingChecklist, "responsible">): WaitingPerson | null {
  return item.assignee || checklist.responsible || null;
}

// A checklist is linked only to its own deal: never across deals or units.
export function checklistIsForDeal(checklist: Pick<WaitingChecklist, "dealId"> | null | undefined, dealId: string | null | undefined): checklist is WaitingChecklist {
  return !!checklist && !!dealId && checklist.dealId === dealId;
}

export interface WaitingTarget {
  itemId: string;
  label: string;
  party: WaitingParty | null;
  name: string | null;
  // When the item was given to its own responsible person. Null when it
  // falls to the person responsible for the deal (no date is kept for that).
  since: string | null;
}

const isoOf = (d: string | Date | null | undefined): string | null => {
  if (!d) return null;
  const t = new Date(d);
  return Number.isNaN(t.getTime()) ? null : t.toISOString();
};

export function waitingTargetFor(item: WaitingItem, checklist: Pick<WaitingChecklist, "responsible">): WaitingTarget {
  const person = waitingPersonFor(item, checklist);
  return {
    itemId: item.id, label: item.label,
    party: waitingPartyFor(person), name: person?.name || null,
    since: item.assignee ? isoOf(item.assignedAt) : null,
  };
}

// The next thing a deal is waiting for: the first open REQUIRED item at the
// deal's current stage, or an earlier one, that has a responsible person (its
// own, else the person responsible for the deal). Earlier stages come first,
// then the order on the checklist. A later stage is never waited on.
export function nextWaitingItem(checklist: WaitingChecklist, skipItemId?: string | null): WaitingItem | null {
  const upTo = stageIndex(checklist.stage);
  const open = checklist.items
    .filter(i => !i.done && i.required && i.id !== skipItemId)
    .filter(i => { const at = stageIndex(i.stage); return at >= 0 && at <= upTo; })
    .filter(i => !!waitingPersonFor(i, checklist))
    .sort((a, b) => stageIndex(a.stage) - stageIndex(b.stage) || a.sortOrder - b.sortOrder);
  return open[0] || null;
}

// Has anyone set who the deal is waiting on? A party, a name or a linked item.
export function hasStoredWaiting(stored: Pick<StoredWaiting, "party" | "name" | "checklistItemId"> | null | undefined): boolean {
  return !!stored && !!(stored.party || stored.name || stored.checklistItemId);
}

// The waiting-on a deal shows when nobody has set one: read from its own
// checklist, never stored. Null when the deal has no checklist, the checklist
// is another deal's, or nothing required is open with someone responsible.
export function derivedWaiting(checklist: WaitingChecklist | null | undefined, dealId: string | null | undefined): WaitingTarget | null {
  if (!checklistIsForDeal(checklist, dealId)) return null;
  const next = nextWaitingItem(checklist);
  return next ? waitingTargetFor(next, checklist) : null;
}

export type WaitingChange =
  | { action: "none" }
  // Move the waiting-on to another item: the clock restarts, the note is the item's label.
  | { action: "move"; itemId: string; party: WaitingParty | null; name: string | null; note: string }
  // Nothing left to wait for: the waiting-on is cleared.
  | { action: "clear" }
  // Drop the link and leave the words as they were typed.
  | { action: "unlink" };

// The linked item was ticked, or unticked. Ticked: the waiting-on moves to
// the next required item with someone responsible, or is cleared. Unticked:
// nothing moves back. An item the deal is not waiting on changes nothing.
export function waitingAfterTick(stored: StoredWaiting | null | undefined, itemId: string, done: boolean, checklist: WaitingChecklist | null | undefined): WaitingChange {
  if (!done || !stored?.checklistItemId || stored.checklistItemId !== itemId) return { action: "none" };
  if (!checklistIsForDeal(checklist, stored.dealId)) return { action: "unlink" };
  const next = nextWaitingItem(checklist, itemId);
  if (!next) return { action: "clear" };
  const target = waitingTargetFor(next, checklist);
  return { action: "move", itemId: target.itemId, party: target.party, name: target.name, note: target.label };
}

// The linked item was deleted: the link goes, the waiting-on stays as typed.
export function waitingAfterDelete(stored: Pick<StoredWaiting, "checklistItemId"> | null | undefined, deletedItemId: string): WaitingChange {
  return stored?.checklistItemId && stored.checklistItemId === deletedItemId ? { action: "unlink" } : { action: "none" };
}

// The linked item was given to someone else (or to no one) on the checklist:
// the waiting-on follows the person, but only when it named the person the
// item was with before (previousName). A waiting-on someone typed over, for
// example the tenant's solicitor on an item a BGP agent is chasing, is left
// as typed. The party is kept when the new person's is not known, and the
// clock restarts only when the party changes.
export function waitingAfterAssign(stored: StoredWaiting | null | undefined, itemId: string, checklist: WaitingChecklist | null | undefined, previousName: string | null | undefined):
  { action: "none" } | { action: "update"; party: string | null; name: string | null; restart: boolean } {
  if (!stored?.checklistItemId || stored.checklistItemId !== itemId || !checklistIsForDeal(checklist, stored.dealId)) return { action: "none" };
  if (stored.name && stored.name !== (previousName || null)) return { action: "none" };
  const item = checklist.items.find(i => i.id === itemId);
  if (!item || item.done) return { action: "none" };
  const person = waitingPersonFor(item, checklist);
  const party = waitingPartyFor(person) || stored.party || null;
  const name = person?.name || null;
  if (party === (stored.party || null) && name === (stored.name || null)) return { action: "none" };
  return { action: "update", party, name, restart: party !== (stored.party || null) };
}

export const daysWaiting = (since: string | Date | null | undefined, now: number = Date.now()): number | null => {
  const iso = isoOf(since);
  return iso ? Math.max(0, Math.floor((now - new Date(iso).getTime()) / 86400000)) : null;
};

// Is the deal waiting on this checklist item, and for how many days? The
// stored link when someone has set a waiting-on, else the one read from the
// checklist. A done item is never waited on.
export function waitingFlagFor(itemId: string, stored: StoredWaiting | null | undefined, checklist: WaitingChecklist | null | undefined, now: number = Date.now()): { waitingOnDeal: boolean; waitingDays: number | null } {
  const no = { waitingOnDeal: false, waitingDays: null };
  const item = checklist?.items.find(i => i.id === itemId);
  if (!checklist || !item || item.done || !checklist.dealId) return no;
  if (stored && stored.dealId === checklist.dealId && hasStoredWaiting(stored)) {
    return stored.checklistItemId === itemId ? { waitingOnDeal: true, waitingDays: daysWaiting(stored.since, now) } : no;
  }
  const derived = derivedWaiting(checklist, checklist.dealId);
  return derived?.itemId === itemId ? { waitingOnDeal: true, waitingDays: daysWaiting(derived.since, now) } : no;
}

const BLANK_CLOCK: LandsecDealClock = {
  waitingOnParty: null, waitingOnName: null, waitingSince: null, waitingNote: null,
  dependsOnDealId: null, dependsOn: null, dependsOnHidden: false, updatedAt: null, updatedByName: null,
};

// The clock a screen is sent for one deal: what is stored, with the linked
// item's name; or, when nobody has set a waiting-on, the one read from the
// deal's checklist, marked derived. Null when there is neither.
export function waitingClockFor(stored: WaitingClock | null | undefined, checklist: WaitingChecklist | null | undefined, dealId: string): WaitingClock | null {
  const own = checklistIsForDeal(checklist, dealId) ? checklist : null;
  if (stored && (stored.waitingOnParty || stored.waitingOnName || stored.checklistItemId)) {
    const item = stored.checklistItemId ? own?.items.find(i => i.id === stored.checklistItemId) : null;
    return { ...stored, checklistItemId: stored.checklistItemId || null, checklistItemLabel: item?.label || null, derived: false };
  }
  const derived = derivedWaiting(own, dealId);
  if (!derived) return stored ? { ...stored, checklistItemId: null, checklistItemLabel: null, derived: false } : null;
  return {
    ...(stored || BLANK_CLOCK),
    waitingOnParty: derived.party, waitingOnName: derived.name, waitingSince: derived.since, waitingNote: derived.label,
    checklistItemId: derived.itemId, checklistItemLabel: derived.label, derived: true,
  };
}

// Someone is named as who the deal is waiting on: a party or a person, set
// by hand or read from the checklist.
export const waitingNamed = (clock: Pick<LandsecDealClock, "waitingOnParty" | "waitingOnName"> | null | undefined): boolean =>
  !!clock && !!(clock.waitingOnParty || clock.waitingOnName);

// ── What the Waiting on editor is given (GET /api/landsec/deal/:id/waiting-options) ──
export interface WaitingOptionItem {
  id: string;
  stage: ChecklistStageKey;
  label: string;
  required: boolean;
  // Who it is with now, and the party they stand for. viaDeal: it has nobody
  // of its own and falls to the person responsible for the deal.
  person: { key: string | null; name: string; side: ChecklistSide | null } | null;
  party: WaitingParty | null;
  viaDeal: boolean;
}
export interface WaitingOptions {
  trackerUnitId: string | null;        // the tracker unit this deal is the current letting of
  started: boolean;                    // the deal has a checklist
  canStart: boolean;                   // the caller may start it (never started by opening the editor)
  canLink: boolean;                    // the caller may add an item and make someone responsible
  stage: ChecklistStageKey | null;
  items: WaitingOptionItem[];          // the open items, by stage then order
  people: (ChecklistPerson & { party: WaitingParty | null })[];
}
