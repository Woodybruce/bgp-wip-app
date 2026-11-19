// The deal page (Woody, 2026-11-18: "need full time line of deal tracking
// from marketing to completion", "bring up to the same level as Landsec",
// "Needs a chat box too", "the tasks list for the deal? Responsibility").
// docs/deal-page-review-2026-11-18.md, steps 3 to 5 and 7. The server reads
// the records (server/deal-page.ts); the rules that turn them into the stage
// strip, the timeline and the page's sections live here, with their tests in
// server/deal-page.test.ts. Imported by the client and the server alike.
import { DEAL_STATUS_LABELS, isInvestmentDeal, legacyToCode, type DealStatusCode } from "./deal-status";
import { dealStatusLabel } from "./letting-rules";
import type { ChecklistSummary } from "./deal-checklist";
import type { WaitingClock } from "./deal-waiting";
import type { LandsecBriefCheck, LandsecNer } from "./landsec";

export type DealPageViewer = "staff" | "client" | "joint_agent";

// The steps a deal goes through, the spine of the page. Every deal that is
// not an investment runs from Marketing; an investment deal from Solicitors,
// because before that it lives on the Investment Tracker (Jack, 2026-11-16).
export const DEAL_STRIP: DealStatusCode[] = ["AVA", "NEG", "HOT", "SOL", "EXC", "COM", "INV"];
export const INVESTMENT_STRIP: DealStatusCode[] = ["SOL", "EXC", "COM", "INV"];
// Where a deal can end off the strip.
const OFF_STRIP_ENDS: DealStatusCode[] = ["WIT", "ARCH", "UOX"];

// A move of the deal's status, from its history (deal_audit_log). confirmed is
// false when the line shares its minute with a bulk update (shared/stage-since.ts).
export interface StageMove { from: DealStatusCode | null; to: DealStatusCode; at: string; byName: string | null; confirmed: boolean }

export interface StripStep {
  code: DealStatusCode;
  label: string;
  state: "done" | "current" | "ahead";
  // When it was reached. Null on a step passed with no date recorded.
  reachedAt: string | null;
  confirmed: boolean;
  // Days spent in it: to the next dated step, or to today for the stage it is at.
  days: number | null;
  byName: string | null;
  // The deal's target date, shown against the step after the one it is at.
  target: string | null;
}
export interface StageStrip {
  steps: StripStep[];
  // A deal that ended off the strip (Withdrawn, Archived, under offer to
  // another agent), with when and who.
  outcome: { code: DealStatusCode; label: string; at: string | null; byName: string | null } | null;
  // A deal not on the strip yet: an opportunity, or an investment deal still
  // on the Investment Tracker.
  before: { code: DealStatusCode; label: string } | null;
}

export interface StripInput {
  status: string | null;
  dealType: string | null;
  team: string[] | string | null;
  moves: StageMove[];
  // When it reached the stage it is at, by the one rule (resolveStageSince).
  since: string | null;
  sinceConfirmed: boolean;
  dates: { instructedAt?: string | null; exchangedAt?: string | null; completedAt?: string | null; invoicedAt?: string | null; targetDate?: string | null };
  now?: Date;
}

const DAY = 86_400_000;
const ms = (d: string | Date | null | undefined): number | null => {
  if (!d) return null;
  const t = d instanceof Date ? d.getTime() : Date.parse(d);
  return Number.isNaN(t) ? null : t;
};
const iso = (d: string | Date | null | undefined): string | null => {
  const t = ms(d);
  return t === null ? null : new Date(t).toISOString();
};
const wholeDays = (from: number, to: number) => Math.max(0, Math.floor((to - from) / DAY));

export function stageLabel(code: DealStatusCode, dealType: string | null | undefined): string {
  return dealStatusLabel(code, dealType) || DEAL_STATUS_LABELS[code];
}

// The strip: which steps are done, which it is at, when each was reached, how
// long it spent there and who moved it. The stage it is at takes its date
// from the same rule as "days at stage", so the two never disagree. A step
// passed with no move in the history takes the date the deal records for it
// (instructed, exchanged, completed, invoiced) when that is not later than the
// next step; else it is done with no date.
export function buildStageStrip(input: StripInput): StageStrip {
  const now = (input.now || new Date()).getTime();
  const codes = isInvestmentDeal(input.dealType, input.team) ? INVESTMENT_STRIP : DEAL_STRIP;
  const code = legacyToCode(input.status);
  const moves = [...input.moves].filter(m => ms(m.at) !== null).sort((a, b) => ms(a.at)! - ms(b.at)!);
  const recorded: Partial<Record<DealStatusCode, string | null | undefined>> = {
    AVA: input.dates.instructedAt, EXC: input.dates.exchangedAt, COM: input.dates.completedAt, INV: input.dates.invoicedAt,
  };
  let currentIdx = code ? codes.indexOf(code) : -1;
  let lastIdx = currentIdx;
  let outcome: StageStrip["outcome"] = null;
  let before: StageStrip["before"] = null;
  if (currentIdx < 0 && code) {
    if (OFF_STRIP_ENDS.includes(code)) {
      const ended = [...moves].reverse().find(m => m.to === code) || null;
      outcome = { code, label: stageLabel(code, input.dealType), at: iso(ended?.at || input.since), byName: ended?.byName || null };
      // The furthest step it reached before it ended.
      for (const m of moves) for (const c of [m.from, m.to]) if (c && codes.indexOf(c) > lastIdx) lastIdx = codes.indexOf(c);
      for (const [c, d] of Object.entries(recorded)) if (d && codes.indexOf(c as DealStatusCode) > lastIdx) lastIdx = codes.indexOf(c as DealStatusCode);
    } else {
      before = { code, label: stageLabel(code, input.dealType) };
    }
  }
  const steps: StripStep[] = codes.map(c => ({
    code: c, label: stageLabel(c, input.dealType), state: "ahead", reachedAt: null, confirmed: false, days: null, byName: null, target: null,
  }));
  for (let i = 0; i <= lastIdx; i++) steps[i].state = i === currentIdx ? "current" : "done";
  if (currentIdx >= 0) {
    const into = [...moves].reverse().find(m => m.to === code) || null;
    steps[currentIdx].reachedAt = iso(input.since);
    steps[currentIdx].confirmed = !!input.since && input.sinceConfirmed;
    steps[currentIdx].byName = into?.byName || null;
  }
  // Back from the last step reached: each earlier step takes the latest move
  // into it that is not after the step that followed it.
  let upper: number | null = currentIdx >= 0 ? ms(steps[currentIdx].reachedAt) : ms(outcome?.at);
  for (let i = (currentIdx >= 0 ? currentIdx - 1 : lastIdx); i >= 0; i--) {
    const c = codes[i];
    const move = [...moves].reverse().find(m => m.to === c && (upper === null || ms(m.at)! <= upper)) || null;
    const fallback = ms(recorded[c]);
    if (move) {
      steps[i].reachedAt = iso(move.at);
      steps[i].confirmed = move.confirmed;
      steps[i].byName = move.byName;
    } else if (fallback !== null && (upper === null || fallback <= upper)) {
      steps[i].reachedAt = new Date(fallback).toISOString();
      steps[i].confirmed = true;
    }
    if (steps[i].reachedAt) upper = ms(steps[i].reachedAt);
  }
  // Days in each step: to the next dated step, or the end.
  for (let i = 0; i <= lastIdx; i++) {
    const from = ms(steps[i].reachedAt);
    if (from === null) continue;
    if (i === currentIdx) { steps[i].days = wholeDays(from, now); continue; }
    const next = i + 1 <= lastIdx ? ms(steps[i + 1].reachedAt) : ms(outcome?.at);
    if (next !== null) steps[i].days = wholeDays(from, next);
  }
  const target = iso(input.dates.targetDate);
  if (target && currentIdx >= 0 && currentIdx + 1 < steps.length) steps[currentIdx + 1].target = target;
  if (target && before) steps[0].target = target;
  return { steps, outcome, before };
}

// ── The letting's window ─────────────────────────────────────────────────
// Offers, viewings and the Heads of Terms hang off the Letting Tracker unit,
// not the deal. A unit that is re-marketed starts a new deal on the same
// unit (server/letting-cycle.ts), so a deal's own events on the unit are
// those from when it began (when an earlier letting on the unit came before
// it) until the deal that replaced it began.
export interface LettingWindow { from: number | null; to: number | null }
export function lettingWindow(opts: { dealCreatedAt: string | Date | null; earlierLetting: boolean; replacedAt: string | Date | null }): LettingWindow {
  return { from: opts.earlierLetting ? ms(opts.dealCreatedAt) : null, to: ms(opts.replacedAt) };
}
export function inLettingWindow(at: string | Date | null | undefined, w: LettingWindow): boolean {
  const t = ms(at);
  if (t === null) return false;
  return (w.from === null || t >= w.from) && (w.to === null || t < w.to);
}

// ── The timeline ─────────────────────────────────────────────────────────
export const DEAL_PAGE_SECTIONS = ["overview", "timeline", "negotiation", "checklist", "parties", "fees", "files", "history"] as const;
export type DealPageSection = (typeof DEAL_PAGE_SECTIONS)[number];

export type DealEventKind =
  | "created" | "instructed" | "stage" | "brief" | "viewing" | "offer" | "round" | "offer_status"
  | "hots" | "recommendation" | "checklist" | "aml" | "exchanged" | "completed" | "invoiced" | "invoice";
// What pressing an event opens: the offer's negotiation, a dialog of the
// letting, or one of the page's sections.
export type DealEventOpen =
  | { to: "offer"; offerId: string }
  | { to: "hots" } | { to: "checklist" } | { to: "recommendation" } | { to: "brief" }
  | { to: "section"; section: DealPageSection };
export interface DealEvent {
  id: string;
  at: string;
  kind: DealEventKind;
  title: string;
  detail: string | null;
  by: string | null;
  // False: the date is a bulk stamp (a status line shared with five or more
  // other deals in the same minute), drawn greyed.
  confirmed: boolean;
  open: DealEventOpen | null;
}
// BGP's own records: the AML working and the invoicing are never sent to a
// client login or a joint agent.
export const STAFF_ONLY_EVENTS: readonly DealEventKind[] = ["aml", "invoiced", "invoice"];
export function eventsForViewer(events: DealEvent[], viewer: DealPageViewer): DealEvent[] {
  return viewer === "staff" ? events : events.filter(e => !STAFF_ONLY_EVENTS.includes(e.kind));
}
// Oldest first: the deal from marketing to completion. A tie keeps the order
// the events were read in.
export function sortEvents(events: DealEvent[]): DealEvent[] {
  return events.map((e, i) => ({ e, i, t: ms(e.at) ?? 0 })).sort((a, b) => a.t - b.t || a.i - b.i).map(x => x.e);
}

// ── The page's sections ──────────────────────────────────────────────────
// One page for every login, cut on the server: a client never sees the fee
// or BGP's AML working, a joint agent sees its own schemes and no brand
// pages. Negotiation is drawn only for a deal with a Letting Tracker unit.
// History is the deal's change log, which a joint agent is not sent.
export function dealPageSections(viewer: DealPageViewer, opts: { letting: boolean }): { key: DealPageSection; label: string }[] {
  const out: { key: DealPageSection; label: string }[] = [{ key: "overview", label: "Overview" }, { key: "timeline", label: "Timeline" }];
  if (opts.letting) out.push({ key: "negotiation", label: "Negotiation" });
  out.push({ key: "checklist", label: opts.letting ? "Checklist & tasks" : "Tasks" });
  out.push({ key: "parties", label: viewer === "staff" ? "Parties & AML" : "Parties" });
  if (viewer === "staff") out.push({ key: "fees", label: "Fees & invoicing" });
  out.push({ key: "files", label: "Files" });
  if (viewer !== "joint_agent") out.push({ key: "history", label: "History" });
  return out;
}

// ── What GET /api/crm/deals/:id/page sends ───────────────────────────────
export interface DealOfferLine {
  offerId: string; companyName: string | null; status: string; rounds: number;
  firstRentPa: number | null; latestRentPa: number | null; lastRoundDate: string | null; lastParty: "tenant" | "landlord"; agreedAt: string | null;
}
export type DealHotsStage = "none" | "draft" | "agreed" | "issued" | "final";
export function hotsStageOf(u: { hotsContent?: string | null; agreedAt?: unknown; issuedAt?: unknown; finalAt?: unknown }): DealHotsStage {
  if (u.finalAt) return "final";
  if (u.issuedAt) return "issued";
  if (u.agreedAt) return "agreed";
  return String(u.hotsContent || "").trim() ? "draft" : "none";
}
export const HOTS_STAGE_LABELS: Record<DealHotsStage, string> = {
  none: "Not started", draft: "Drafted", agreed: "Agreed by everyone on the brief", issued: "Issued to the tenant", final: "Final agreed copy on file",
};
export interface DealLettingSummary {
  trackerId: string;
  unitName: string;
  propertyId: string | null;
  propertyName: string | null;
  // The unit's live record still points at this deal. False on a deal whose
  // unit has been re-marketed since: its own checklist and recommendation
  // are shown, read only, and the unit's dialogs (which open the unit's
  // current letting) are not offered.
  current: boolean;
  marketingStatus: string | null;
  brief: { id: string; agreedAt: string | null; signoff: { total: number; agreed: number } } | null;
  briefCheck: LandsecBriefCheck;
  briefState: "agreed" | "drafted" | null;
  // The deal the unit's live record points at now (this one, or the letting
  // that replaced it).
  currentDealId: string | null;
  hots: { stage: DealHotsStage; version: number; agreedAt: string | null; issuedAt: string | null; issuedByName: string | null; finalAt: string | null; finalByName: string | null } | null;
  recommendation: { id: string; recommendation: string | null; version: number; issuedAt: string | null; decidedAt: string | null; total: number; approved: number; declined: number } | null;
  offers: DealOfferLine[];
  viewings: { total: number; completed: number; upcoming: number; last: string | null; next: string | null };
}
export interface DealChecklistItemView {
  id: string; stage: string; label: string; required: boolean; done: boolean; doneAt: string | null; doneByName: string | null;
  dueDate: string | null; assigneeName: string | null; assigneeSide: string | null; overdue: boolean;
}
export interface DealChecklistView {
  id: string; responsibleName: string | null; responsibleSide: string | null; stage: string;
  summary: ChecklistSummary; items: DealChecklistItemView[];
}
export interface DealTaskView {
  id: string; title: string; assignee: string | null; assignedBy: string | null; dueDate: string | null; status: string; done: boolean; mine: boolean;
}
// The names the page draws with, so it does not download the whole company,
// contact and property lists to look a few of them up. A joint agent is sent
// names with no company ids (it has no brand pages); the property's folder
// links and the deal's own unit record are BGP staff's.
export type DealPartyRole = "landlord" | "tenant" | "vendor" | "purchaser";
export interface DealPageNames {
  property: { id: string; name: string; address: string | null; postcode: string | null; status: string | null; folderTeams: string[] | null; sharepointFolderUrl: string | null } | null;
  parties: Partial<Record<DealPartyRole, { id: string | null; name: string; domain: string | null }>>;
  unit: { id: string; unitName: string; propertyId: string | null; unitAddress: string | null; unitPostcode: string | null; unitUprn: string | null; unitAddressFreeText: string | null } | null;
}
export interface DealPageData {
  names: DealPageNames;
  viewer: { kind: DealPageViewer; canSetWaiting: boolean; canSetStage: boolean; landsec: boolean };
  stage: { code: DealStatusCode | null; label: string | null; since: string | null; days: number | null; confirmed: boolean; set: { date: string; byName: string | null } | null };
  strip: StageStrip;
  // Who and what the deal is waiting on (lettings only; null for any other deal).
  clock: WaitingClock | null;
  waitingDays: number | null;
  // The other live deals it may be said to depend on: the same scheme for a
  // Landsec deal, else the same property.
  otherDeals: { id: string; ref: number | null; name: string; unit: string | null }[];
  ner: LandsecNer | null;
  incentivesRecorded: boolean;
  letting: DealLettingSummary | null;
  checklist: DealChecklistView | null;
  tasks: DealTaskView[];
}

// What the deal owes now, for the Overview: required checklist items still
// open at or before its stage, items past their due date, and items with
// nobody on them when nobody is responsible for the letting.
export function owedItems(checklist: DealChecklistView | null, limit = 5): DealChecklistItemView[] {
  if (!checklist) return [];
  const order = ["enquiry", "negotiating", "under_offer", "exchanged"];
  const upTo = order.indexOf(checklist.stage);
  return checklist.items
    .filter(i => !i.done && (i.overdue || (i.required && order.indexOf(i.stage) <= upTo) || (!i.assigneeName && !checklist.responsibleName)))
    .sort((a, b) => Number(b.overdue) - Number(a.overdue) || order.indexOf(a.stage) - order.indexOf(b.stage))
    .slice(0, limit);
}
