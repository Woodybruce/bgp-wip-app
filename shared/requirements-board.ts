// The requirements board (docs/requirements-board-review-2026-11-19.md,
// sections 1 and 4; Woody, 19 November 2026: "carry on", taken as yes to the
// review's recommendations). One row per brand (decision 1); the board opens
// on Open, BGP's own first and then market listings, newest listing first
// (decision 3); a market listing PIPnet has not listed for six months reads
// as Older, worked out here on read with nothing written (decision 4); In the
// news is its own list, loaded only when opened (decision 6).
//
// The lists, and what is on each:
//   own     BGP's own: live or to confirm by the one live rule
//           (shared/requirement-live.ts).
//   market  A market listing (PIPnet, The Requirement List) nobody at BGP has
//           confirmed, listed in the last six months.
//   older   BGP's own background rows (on hold, or more than 12 months since
//           a confirmation), and a market listing not listed for six months
//           or with no date to tell.
//   closed  Past, archived or satisfied.
//   open    own and market together: the board's first list.
// A client login has two: open (everything not closed) and closed.
import { formatSizeList } from "./format-size";
import { REQUIREMENT_STATE_WEIGHT, type RequirementLive, type RequirementState } from "./requirement-live";

export type BoardList = "own" | "market" | "older" | "closed";
export type BoardPill = "open" | BoardList;
export const BOARD_PILLS: readonly BoardPill[] = ["open", "own", "market", "older", "closed"];
export const BOARD_PILL_LABELS: Record<BoardPill, string> = {
  open: "Open", own: "BGP's own", market: "Market listings", older: "Older", closed: "Closed",
};

// Six months, in days: a market listing PIPnet has not listed for longer
// reads as Older (decision 4).
export const MARKET_UNSEEN_DAYS = 183;

/** The list one requirement belongs on, from its live reading. */
export function boardListOf(live: Pick<RequirementLive, "state" | "importOnly" | "days">): BoardList {
  if (live.state === "closed") return "closed";
  if (live.state === "live" || live.state === "to_confirm") return "own";
  if (!live.importOnly) return "older";
  // A listing with no date cannot be shown to be current.
  return live.days == null || live.days > MARKET_UNSEEN_DAYS ? "older" : "market";
}

// A client login is never told which of BGP's lists a row is on (that would
// say whether BGP confirmed it): its rows read "open" or "closed".
export type RowList = BoardList | "open";
export const clientList = (list: BoardList): RowList => (list === "closed" ? "closed" : "open");

/** Is a row on a pill? Open is BGP's own and the market listings together (and every open row of a client's). */
export function onPill(list: RowList, pill: BoardPill): boolean {
  if (list === "open") return pill === "open";
  return pill === "open" ? list === "own" || list === "market" : list === pill;
}

// The one line a row shows for what the brand wants: size, use and places,
// each written once ("1,500–3,000 sq ft · Restaurant · Leeds, York").
export function wantsLine(row: { size?: string[] | string | null; use?: readonly unknown[] | null; requirement_locations?: readonly unknown[] | null }): string {
  const list = (v: readonly unknown[] | null | undefined) => Array.from(new Set((Array.isArray(v) ? v : []).map(x => String(x ?? "").trim()).filter(Boolean)));
  return [formatSizeList(row.size ?? null), list(row.use).join(", "), list(row.requirement_locations).join(", ")].filter(Boolean).join(" · ");
}

// A requirement as the board reads it, before the client cut.
export interface BoardCandidate {
  id: string;
  list: BoardList;
  state: RequirementState;
  /** The date behind the row's dated line (confirmed, listed, dated, edited or added), or null. */
  date: Date | null;
  name: string;
}

const LIST_RANK: Record<BoardList, number> = { own: 0, market: 1, older: 2, closed: 3 };
const time = (d: Date | null) => (d ? d.getTime() : -Infinity);

/**
 * The order of requirements: by list (BGP's own, then market listings, then
 * older, then closed); BGP's own by state (live before to confirm), then the
 * newest date; every other list newest date first; then name. A brand's row
 * shows the first of its requirements in this order.
 */
export function compareCandidates(a: BoardCandidate, b: BoardCandidate): number {
  return LIST_RANK[a.list] - LIST_RANK[b.list]
    || (a.list === "own" ? REQUIREMENT_STATE_WEIGHT[b.state] - REQUIREMENT_STATE_WEIGHT[a.state] : 0)
    || time(b.date) - time(a.date)
    || a.name.localeCompare(b.name, "en-GB", { sensitivity: "base" });
}

/**
 * A client login's order: open before closed, then the newest date, then
 * name. Never by state, which would show which listings BGP has confirmed.
 */
export function compareForClient(a: BoardCandidate, b: BoardCandidate): number {
  return Number(a.list === "closed") - Number(b.list === "closed")
    || time(b.date) - time(a.date)
    || a.name.localeCompare(b.name, "en-GB", { sensitivity: "base" });
}

/**
 * One row per brand (decision 1): a brand's requirements grouped, the first in
 * compareCandidates' order shown and the rest carried inside the row. A
 * requirement with no brand is a row of its own.
 */
export function groupByBrand<T extends BoardCandidate & { companyId: string | null }>(items: T[], compare: (a: T, b: T) => number = compareCandidates): Array<{ key: string; brandId: string | null; shown: T; others: T[] }> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = item.companyId ? `brand:${item.companyId}` : `req:${item.id}`;
    const list = groups.get(key);
    if (list) list.push(item); else groups.set(key, [item]);
  }
  return Array.from(groups.entries()).map(([key, list]) => {
    const sorted = [...list].sort(compare);
    return { key, brandId: sorted[0].companyId, shown: sorted[0], others: sorted.slice(1) };
  });
}

// ── The feed's reply ────────────────────────────────────────────────────
export interface BoardFit {
  unitId: string;
  unitName: string;
  propertyId: string | null;
  propertyName: string | null;
  scheduleRowId: string | null;
  sqft: number | null;
  why: string;
}

export interface BoardRequirement {
  id: string;
  name: string;
  wants: string;
  type: string | null;
  list: RowList;
  /** BGP staff only: the state and its label ("Live", "To confirm"). */
  state?: RequirementState;
  stateLabel?: string;
  /** The dated line: the live rule's date line for staff, requirementReason's clientText for a client login. */
  dateLine: string;
  /**
   * The date to sort and filter by: for staff the date behind the dated line
   * (a confirmation, a listing, the requirement's date, an edit); for a client
   * login the requirement's own date (listed, dated or added), never when BGP
   * confirmed it.
   */
  date: string | null;
  /** The requirement's group (Retail, F&B, ...), as the filter names it. */
  group: string | null;
  /** The deal it is linked to (name and stage only); for a client login only a deal it may open. */
  deal?: { id: string; name: string; status: string | null } | null;
  /** BGP staff only: when a named person last confirmed it. */
  confirmedAt?: string | null;
  /** Where it came from, in the page's words (staff only). */
  sources?: string[];
  /** The market listing's page (PIPnet), from the import (staff only). */
  listingUrl?: string | null;
}

export interface BoardAgent {
  contactId: string;
  name: string;
  firmId: string | null;
  firmName: string | null;
  email: string | null;
  phone: string | null;
}

export interface BoardRow {
  key: string;
  brandId: string | null;
  brandName: string;
  domain: string | null;
  superBrand: boolean;
  list: RowList;
  requirement: BoardRequirement;
  others: BoardRequirement[];
  fits: { count: number; best: BoardFit | null };
  agent: BoardAgent | null;
  /** BGP staff only: the requirement's BGP owners. */
  owners?: Array<{ id: string; name: string }>;
  expansion: { score: number; band: string } | null;
  /** BGP staff only: the last email, call or meeting with the brand or its people. */
  lastContactAt?: string | null;
}

export interface BoardResponse {
  viewer: "staff" | "client";
  rows: BoardRow[];
  /** Rows per pill (a row is counted once, on the list of the requirement it shows). */
  counts: Record<BoardPill, number>;
  /** How many units the fits were read against. */
  unitPool: number;
  /** The reads that failed: their columns are empty, never read as none. */
  unavailable: string[];
}

export function countPills(rows: Array<{ list: RowList }>): Record<BoardPill, number> {
  const counts: Record<BoardPill, number> = { open: 0, own: 0, market: 0, older: 0, closed: 0 };
  for (const row of rows) {
    if (row.list !== "open") counts[row.list] += 1;
    if (row.list === "open" || row.list === "own" || row.list === "market") counts.open += 1;
  }
  return counts;
}

// The Hunter board's bands for the Expansion score (scoreBand in
// brand-hunter-board.tsx and expansionBand in brand-profile-panel.tsx): keep
// the three in step.
export function boardExpansionBand(score: number): string {
  return score >= 30 ? "Very hot" : score >= 20 ? "Hot" : score >= 10 ? "Watch" : "Warm";
}
