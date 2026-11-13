// Matching a plan to the tenancy schedule on the property page
// (docs/property-page-rebuild-2026-11-13.md). The schedule row is the unit; an
// outline on a plan is only ever a picture of one. So the plan never writes to
// the schedule: a person links an outline to a row, keeps it as context (grey,
// no row) or says it is not a unit. server/property-plan-match.ts reads and
// writes this; the Match screen draws it.
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
  scheduleRowId: string | null; // null = context: drawn, but not a schedule unit
}

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
  dismissed: number;          // proposals a person marked "not a unit"
  rows: PlanMatchRow[];
  canScan: boolean;           // BGP staff, with the plan reader switched on
}

export const PLAN_MATCH_METHOD_LABELS: Record<PlanMatchMethod, string> = {
  code: "Unit number matches",
  tenant: "Tenant name matches",
  floor: "Name matches, and it is the only one on this floor",
};

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

// What the bulk button may take: a suggestion made on the unit number or the
// tenant's name alone, with nothing about it that disagrees with the schedule.
// A floor tie-break, a different tenant or a different floor is a weaker
// reading, so a person accepts those one at a time.
export function bulkAcceptable(proposal: Pick<PlanMatchProposal, "suggestedRowId" | "method" | "tenantDiffers" | "floorDiffers">): boolean {
  return !!proposal.suggestedRowId && (proposal.method === "code" || proposal.method === "tenant") && !proposal.tenantDiffers && !proposal.floorDiffers;
}

export function planMatchCounts(board: Pick<PlanMatchBoard, "outlines" | "proposals" | "rows">) {
  const matched = board.outlines.filter(o => o.scheduleRowId).length;
  return {
    matched,
    context: board.outlines.length - matched,
    toCheck: board.proposals.length,
    suggested: board.proposals.filter(bulkAcceptable).length,
    rowsNotDrawn: board.rows.filter(r => !r.outlinedHere && !r.outlinedElsewhere).length,
  };
}
