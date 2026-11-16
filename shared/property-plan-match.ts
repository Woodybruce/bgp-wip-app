// Matching a plan to the tenancy schedule on the property page
// (docs/property-page-rebuild-2026-11-13.md). The schedule row is the unit; an
// outline on a plan is only ever a picture of one, so the plan never writes to
// the schedule. Everything a scan finds is saved as soon as it finishes
// (Woody, 2026-11-16: "the scan and tenancy schedule matches dont need
// checking they are all done immediately and then there is the ability to
// edit"): an outline is linked to the row its printed unit number or tenant
// name points at, or saved unlinked (grey) for a person to link, change or
// remove on the plan. server/property-plan-match.ts reads and writes this; the
// Plan tab draws it.
import type { PropertyPlanPolygon } from "./property-plan-scan";

// How a row was suggested for a proposal: the unit code printed on the plan,
// the tenant's name, or the floor settling a name that matched more than one.
export type PlanMatchMethod = "code" | "tenant" | "floor";

export interface PlanMatchRow {
  id: string;                 // tenancy schedule row id
  label: string;              // unit number, else premises
  tenant: string | null;      // trading name, else the tenant on the lease
  floor: string | null;
  use: string | null;
  outlinedHere: boolean;      // already drawn on this plan
  outlinedElsewhere: boolean; // drawn on another floor of this property
}

export interface PlanMatchOutline {
  id: string;
  label: string | null;       // what the plan prints
  polygon: PropertyPlanPolygon;
  scheduleRowId: string | null; // null = not linked: drawn in grey, not a schedule unit
  // What the scan read here, when the outline came from the plan's current scan.
  printed: { label: string; tenant: string | null } | null;
  // Not linked: the free schedule rows its printed number or name could be, likeliest first.
  possibleRowIds: string[];
}

// A scan's outline not yet saved: a scan from before outlines were saved as
// soon as it finished, one whose save failed, or one that was under an outline
// since removed. The Plan tab offers to save them all.
export interface PlanMatchProposal {
  id: string;                 // the scan's own id for this outline
  label: string;
  tenant: string | null;
  polygon: PropertyPlanPolygon;
  suggestedRowId: string | null;
  method: PlanMatchMethod | null;
  possibleRowIds: string[];   // more than one row could be meant: a person chooses
  // The suggested row is the unit the plan's number names, but the plan prints
  // a different tenant (an older plan) or the schedule puts it on another floor.
  tenantDiffers: boolean;
  floorDiffers: boolean;
}

export interface PlanMatchBoard {
  plan: { id: string; propertyId: string; floor: string; width: number | null; height: number | null; imageKey: string };
  scan: null | { id: string; status: "running" | "ready" | "failed" | "applied"; message: string | null; completed: number; total: number };
  outlines: PlanMatchOutline[];
  proposals: PlanMatchProposal[];
  rows: PlanMatchRow[];
  canScan: boolean;           // BGP staff, with the plan reader switched on
}

// "Upper Level", "upper mall" and "UPPER" are one floor; "Level 1" and
// "Level 2" are not. Empty never matches anything.
const FLOOR_NOISE = /\b(level|floor|mall|storey|the)\b/g;
export function floorKey(value: unknown): string {
  return String(value ?? "").toLowerCase().replace(/&/g, " and ").replace(FLOOR_NOISE, " ").replace(/[^a-z0-9]+/g, " ").trim();
}
export function sameFloor(a: unknown, b: unknown): boolean {
  const left = floorKey(a);
  return !!left && left === floorKey(b);
}

export function floorsDisagree(a: unknown, b: unknown): boolean {
  const left = floorKey(a), right = floorKey(b);
  return !!left && !!right && left !== right;
}

// The order a scan's outlines are saved in: a unit number or a tenant name
// first, then a floor tie-break, then the outlines with no unit. Where two
// outlines overlap, the first saved stays and the other is left off.
export function planSaveOrder(proposal: Pick<PlanMatchProposal, "suggestedRowId" | "method">): number {
  return !proposal.suggestedRowId ? 2 : proposal.method === "floor" ? 1 : 0;
}

export function planMatchCounts(board: Pick<PlanMatchBoard, "outlines" | "proposals" | "rows">) {
  const linked = board.outlines.filter(o => o.scheduleRowId).length;
  return {
    linked,
    unlinked: board.outlines.length - linked,
    unsaved: board.proposals.length,
    rowsNotDrawn: board.rows.filter(r => !r.outlinedHere && !r.outlinedElsewhere).length,
  };
}
