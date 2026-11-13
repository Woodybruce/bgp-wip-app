// The units of one property, as the property page shows them
// (docs/property-page-rebuild-2026-11-13.md). The tenancy schedule row is the
// unit; its Letting Tracker row, live deal, brief and plan outlines are read
// onto it by server/property-units.ts. This file holds the response shape and
// the ONE rule for a unit's occupancy, letting stage and flags, which the unit
// list, the plan colouring and the pills all use. Change a rule here, with a
// test in shared/property-units.test.ts, never on a screen.
//
// Two facts, kept apart as docs/unit-status-cleanup-plan.md decided: occupancy
// says whether the unit is let, the stage says where its letting has got to.
// A stage is read from the tracker row and its deal, never from a word typed
// on the schedule.
import { legacyToCode, type DealStatusCode } from "./deal-status";
import { TRACKER_LIVE_STATUSES, LETTING_STATUS_LABELS, effectiveStatus, isLettingType } from "./letting-rules";
import { calendarDateValue } from "./calendar-date";

export type UnitOccupancy = "occupied" | "vacant" | "unknown";
// Live on the Letting Tracker: Opportunity, Marketing, Negotiating, HOTs, Solicitors.
export type UnitStage = "OPP" | "AVA" | "NEG" | "HOT" | "SOL";
export type UnitStateKey = UnitStage | UnitOccupancy;

export const UNIT_OCCUPANCY_LABELS: Record<UnitOccupancy, string> = { occupied: "Occupied", vacant: "Vacant", unknown: "Not recorded" };

const VACANT_WORDS = ["vacant", "void", "available", "ava", "marketing", "held", "in negotiation", "under offer"];
const OCCUPIED_WORDS = ["occupied", "let", "trading", "not vacant", "holding over", "taw", "lease event", "lease event pending"];
const NO_TENANT = /^(vacant|void|available|tbc|n\/a|[-—–])$/i;

const word = (value: unknown) => String(value ?? "").trim().toLowerCase();
const amount = (value: unknown) => { const n = Number(value); return value != null && value !== "" && Number.isFinite(n) ? n : null; };

/** A real tenant name, not a placeholder such as "VACANT" or "-". */
export function namedTenant(...names: Array<string | null | undefined>): string | null {
  for (const name of names) {
    const text = String(name ?? "").trim();
    if (text && !NO_TENANT.test(text)) return text;
  }
  return null;
}

/** Whether the unit is let. The schedule's status word decides when it is one
 *  of the known words (the backfilled occupancy_status only when it is not);
 *  a word that says neither, such as "Opportunity", falls to the tenant and
 *  the rent on the row. Missing data stays "unknown": it is never read as
 *  vacant or as let. */
export function unitOccupancy(row: { status?: string | null; occupancy_status?: string | null; tenant_name?: string | null; trading_name?: string | null; passing_rent_pa?: unknown }): UnitOccupancy {
  const status = word(row.status);
  const known = [...VACANT_WORDS, ...OCCUPIED_WORDS];
  const stated = known.includes(status) ? status : word(row.occupancy_status);
  if (VACANT_WORDS.includes(stated)) return "vacant";
  if (OCCUPIED_WORDS.includes(stated)) return "occupied";
  if (namedTenant(row.trading_name, row.tenant_name) || (amount(row.passing_rent_pa) ?? 0) > 0) return "occupied";
  return "unknown";
}

/** Where the unit's letting has got to: the tracker row's code (its deal's
 *  status first), or a live letting deal on the unit with no tracker row.
 *  Null when nothing is live. Advisory deals (a rent review, a renewal) are
 *  not a letting stage. */
export function unitStage(input: { trackerStatus?: string | null; hasTracker?: boolean; dealStatus?: string | null; dealType?: string | null }): UnitStage | null {
  const live = (code: DealStatusCode | null): UnitStage | null => (code && TRACKER_LIVE_STATUSES.includes(code) ? (code as UnitStage) : null);
  if (input.hasTracker) return live(effectiveStatus({ marketing_status: input.trackerStatus }, input.dealStatus ? { status: input.dealStatus } : null));
  if (input.dealStatus && isLettingType(input.dealType)) return live(legacyToCode(input.dealStatus));
  return null;
}

export const unitStateKey = (unit: { stage: UnitStage | null; occupancy: UnitOccupancy }): UnitStateKey => unit.stage ?? unit.occupancy;
export const unitStateLabel = (key: UnitStateKey): string =>
  key === "occupied" || key === "vacant" || key === "unknown" ? UNIT_OCCUPANCY_LABELS[key] : LETTING_STATUS_LABELS[key];

// One colour per state for the plan (hex, for SVG) in the same hue as the
// status chips in shared/deal-status.ts, so a stage reads as one colour on
// the plan, in the list and on the Deals board.
export const UNIT_STATE_HEX: Record<UnitStateKey, string> = {
  OPP: "#14b8a6", AVA: "#0ea5e9", NEG: "#f59e0b", HOT: "#f43f5e", SOL: "#ea580c",
  vacant: "#dc2626", occupied: "#10b981", unknown: "#94a3b8",
};
// The order the key and the pills run in.
export const UNIT_STATE_ORDER: UnitStateKey[] = ["vacant", "OPP", "AVA", "NEG", "HOT", "SOL", "occupied", "unknown"];

export const UNIT_STUCK_DAYS = 30;
const STUCK_STAGES: UnitStage[] = ["NEG", "HOT", "SOL"];
const EVENT_MONTHS = 12;

export interface UnitFlags {
  /** Occupied, with the lease expiry or a break inside 12 months (a passed expiry counts). */
  expiryOrBreakSoon: boolean;
  /** Vacant with nothing live on the tracker. */
  vacantNoLetting: boolean;
  /** Negotiating, HOTs or Solicitors for 30 days or more. */
  stuck: boolean;
  /** Vacant or in a live letting, with no agreed Targeting Brief. */
  noAgreedBrief: boolean;
  /** On the Letting Tracker with no row on the tenancy schedule. */
  notOnSchedule: boolean;
  /** The property has a plan and this unit has no outline on it. */
  notOnPlan: boolean;
  /** More than one outline points at this row on one plan. */
  duplicateOutline: boolean;
}

const dayMs = 24 * 60 * 60 * 1000;
const dateMs = (value: string | null | undefined) => { const day = calendarDateValue(value ?? null); return day ? Date.parse(`${day}T00:00:00.000Z`) : null; };
const addMonths = (todayMs: number, months: number) => { const d = new Date(todayMs); d.setUTCMonth(d.getUTCMonth() + months); return d.getTime(); };

/** today is a calendar day, YYYY-MM-DD. */
export function unitFlags(unit: Pick<PropertyUnit, "occupancy" | "stage" | "deal" | "brief" | "scheduleRowId" | "outlines" | "leaseExpiry" | "breakDate" | "landlordBreakDate">, ctx: { today: string; propertyHasPlans: boolean }): UnitFlags {
  const now = dateMs(ctx.today) ?? 0;
  const soon = addMonths(now, EVENT_MONTHS);
  const expiry = dateMs(unit.leaseExpiry);
  const breaks = [dateMs(unit.breakDate), dateMs(unit.landlordBreakDate)].filter((t): t is number => t != null);
  const perPlan = new Map<string, number>();
  for (const outline of unit.outlines) perPlan.set(outline.planId, (perPlan.get(outline.planId) || 0) + 1);
  return {
    expiryOrBreakSoon: unit.occupancy !== "vacant" && ((expiry != null && expiry < soon) || breaks.some(t => t >= now && t < soon)),
    vacantNoLetting: unit.occupancy === "vacant" && !unit.stage,
    stuck: !!unit.stage && STUCK_STAGES.includes(unit.stage) && unit.deal?.days != null && unit.deal.days >= UNIT_STUCK_DAYS,
    noAgreedBrief: (unit.occupancy === "vacant" || !!unit.stage) && unit.brief !== "agreed",
    notOnSchedule: !unit.scheduleRowId,
    // Only a schedule row can be drawn: a unit on the tracker alone is "not on schedule" instead.
    notOnPlan: ctx.propertyHasPlans && !!unit.scheduleRowId && unit.outlines.length === 0,
    duplicateOutline: [...perPlan.values()].some(count => count > 1),
  };
}

/** The next dated lease event on the unit, on or after today. */
export function nextLeaseEvent(unit: Pick<PropertyUnit, "leaseExpiry" | "breakDate" | "landlordBreakDate" | "nextReview">, today: string): { kind: "expiry" | "break" | "landlord_break" | "review"; date: string } | null {
  const now = dateMs(today) ?? 0;
  const events = ([["expiry", unit.leaseExpiry], ["break", unit.breakDate], ["landlord_break", unit.landlordBreakDate], ["review", unit.nextReview]] as const)
    .map(([kind, date]) => ({ kind, date: calendarDateValue(date ?? null), at: dateMs(date) }))
    .filter((e): e is { kind: typeof e.kind; date: string; at: number } => e.date != null && e.at != null && e.at >= now)
    .sort((a, b) => a.at - b.at);
  return events[0] ? { kind: events[0].kind, date: events[0].date } : null;
}

export const daysBetween = (fromMs: number, toMs: number) => Math.max(0, Math.floor((toMs - fromMs) / dayMs));

export interface PropertyUnitDeal {
  id: string;
  ref: number | null;
  name: string | null;
  type: string | null;
  tenant: string | null;
  code: DealStatusCode | null;
  days: number | null;
  /** False when the date behind `days` is not one the app can stand behind (shared/stage-since.ts): shown as "41d?". */
  daysConfirmed: boolean;
  /** A letting (New Letting, Lease Disposal, Temp Lease, Licence, Sub-Letting), not advisory work. */
  letting: boolean;
}

export interface PropertyUnit {
  /** The schedule row id, or "tracker:<id>" for a unit that is on the Letting Tracker only. */
  id: string;
  scheduleRowId: string | null;
  trackerId: string | null;
  label: string;
  floor: string | null;
  grouping: string | null;
  use: string | null;
  /** The schedule's own status word, as typed. */
  scheduleStatus: string | null;
  tenant: {
    /** What to call the occupier: the trading name, else the tenant name. */
    name: string | null;
    tradingName: string | null;
    /** The contracting company as the schedule records it. */
    legalName: string | null;
    /** The brand's company record. */
    companyId: string | null;
    companyName: string | null;
  };
  sqft: number | null;
  passingRent: number | null;
  erv: number | null;
  quotingRent: number | null;
  leaseStart: string | null;
  leaseExpiry: string | null;
  breakDate: string | null;
  landlordBreakDate: string | null;
  nextReview: string | null;
  occupancy: UnitOccupancy;
  stage: UnitStage | null;
  deal: PropertyUnitDeal | null;
  brief: "agreed" | "drafted" | null;
  counts: { viewings: number; offers: number; targets: number };
  outlines: Array<{ planId: string; outlineId: string }>;
  flags: UnitFlags;
}

export interface PropertyUnitPlan {
  id: string;
  floor: string;
  /** Saved outlines on this plan, and how many of them point at no schedule row. */
  outlines: number;
  unlinkedOutlines: number;
  /** Outlines a scan has proposed that nobody has reviewed yet. */
  proposals: number;
}

export interface PropertyUnitsFeed {
  property: { id: string; name: string };
  plans: PropertyUnitPlan[];
  units: PropertyUnit[];
  /** Open deals on the property that sit on no unit. */
  unplacedDeals: Array<Omit<PropertyUnitDeal, "days"> & { days: number | null }>;
  counts: {
    units: number;
    occupied: number;
    vacant: number;
    unknown: number;
    liveLettings: number;
    stages: Record<UnitStage, number>;
    expiryOrBreakSoon: number;
    noAgreedBrief: number;
    notOnSchedule: number;
    onPlan: number;
    notOnPlan: number;
    unlinkedOutlines: number;
    proposals: number;
  };
}

/** What the unit panel shows beyond the feed's line. The brand's contact at a
 *  viewing is for BGP staff only. */
export interface PropertyUnitDetail {
  unit: PropertyUnit;
  schedule: null | {
    termYears: number | null; outsideLtAct: string | null; breakType: string | null; breakDetails: string | null; breakNotice: string | null;
    reviewBasis: string | null; serviceCharge: number | null; insurance: number | null; ratesPayable: number | null; rateableValue: number | null;
    rentPsf: number | null; turnoverPercent: number | null; niaSqft: number | null; giaSqft: number | null; itzaSqft: number | null;
    comments: string | null; leasingComments: string | null;
  };
  tracker: null | {
    id: string; quotingRent: number | null; rentOnApplication: boolean; leaseTerms: string | null; availableDate: string | null; marketingStartDate: string | null; onWebsite: boolean;
    viewings: Array<{ id: string; company: string | null; contact: string | null; date: string | null; outcome: string | null; status: string | null }>;
    offers: Array<{ id: string; company: string | null; date: string | null; rentPa: number | null; rentFreeMonths: number | null; termYears: number | null; status: string | null }>;
  };
  brief: null | { id: string; title: string | null; agreed: boolean; targets: Array<{ id: string; name: string; companyId: string | null; status: string | null; priority: string | null }> };
  /** Every open deal on the unit, the letting first. */
  deals: PropertyUnitDeal[];
  outlines: Array<{ planId: string; outlineId: string; floor: string; label: string | null }>;
}

export function propertyUnitCounts(units: PropertyUnit[], plans: PropertyUnitPlan[]): PropertyUnitsFeed["counts"] {
  const stages: Record<UnitStage, number> = { OPP: 0, AVA: 0, NEG: 0, HOT: 0, SOL: 0 };
  for (const unit of units) if (unit.stage) stages[unit.stage]++;
  const count = (test: (unit: PropertyUnit) => boolean) => units.filter(test).length;
  return {
    units: units.length,
    occupied: count(u => u.occupancy === "occupied"),
    vacant: count(u => u.occupancy === "vacant"),
    unknown: count(u => u.occupancy === "unknown"),
    liveLettings: count(u => !!u.stage),
    stages,
    expiryOrBreakSoon: count(u => u.flags.expiryOrBreakSoon),
    noAgreedBrief: count(u => u.flags.noAgreedBrief),
    notOnSchedule: count(u => u.flags.notOnSchedule),
    onPlan: count(u => u.outlines.length > 0),
    notOnPlan: count(u => u.flags.notOnPlan),
    unlinkedOutlines: plans.reduce((sum, plan) => sum + plan.unlinkedOutlines, 0),
    proposals: plans.reduce((sum, plan) => sum + plan.proposals, 0),
  };
}

export type UnitFilter = "all" | "vacant" | "live" | "expiring" | "nobrief" | "notonplan" | "notonschedule";
export function unitMatchesFilter(unit: PropertyUnit, filter: UnitFilter): boolean {
  if (filter === "vacant") return unit.occupancy === "vacant";
  if (filter === "live") return !!unit.stage;
  if (filter === "expiring") return unit.flags.expiryOrBreakSoon;
  if (filter === "nobrief") return unit.flags.noAgreedBrief;
  if (filter === "notonplan") return unit.flags.notOnPlan;
  if (filter === "notonschedule") return unit.flags.notOnSchedule;
  return true;
}
