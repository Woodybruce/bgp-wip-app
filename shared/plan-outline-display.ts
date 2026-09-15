import { isValidPolygon, polygonArea, type PlanPoint } from "./plan-geometry";
import type { PlanScanReview } from "./plan-scan-review";

export type OutlinePlacement = "manual" | "scanned" | "needs_review" | "unplaced";
export type DisplayPlanUnit = {
  id: string; unit_ref: string; tenant_name: string | null; source?: string | null;
  polygon: PlanPoint[] | null;
};
type PlanFrame = { planId: string; levelId: string; backgroundKey: string | null };

// Use the saved source coordinates, never a candidate with a merely similar
// reference. This is also an optimistic guard against stale query responses.
export function sameOutline(a: PlanPoint[] | null, b: PlanPoint[] | null): boolean {
  return !!a && !!b && a.length === b.length && a.every((point, index) => point.x === b[index].x && point.y === b[index].y);
}

export function unitOutlinePlacement(unit: DisplayPlanUnit, review: PlanScanReview | null | undefined, frame: PlanFrame): OutlinePlacement {
  if (!isValidPolygon(unit.polygon)) return "unplaced";
  if (unit.source === "manual") return "manual";
  if (!review || review.planId !== frame.planId || review.levelId !== frame.levelId
    || !frame.backgroundKey || review.backgroundKey !== frame.backgroundKey || review.clearedUnitIds.includes(unit.id)) return "needs_review";
  const snapshot = review.existingUnits.find(saved => saved.id === unit.id);
  if (!snapshot || snapshot.source !== unit.source || !sameOutline(snapshot.polygon, unit.polygon)) return "needs_review";
  const confirmed = review.candidates.some(candidate => (candidate.status !== "review" && candidate.unitId === unit.id
      || review.applied[candidate.id]?.unitId === unit.id) && sameOutline(candidate.polygon, unit.polygon));
  return confirmed ? "scanned" : "needs_review";
}

export function planOutlineDisplay<T extends DisplayPlanUnit>(units: T[], review: PlanScanReview | null | undefined, frame: PlanFrame) {
  const placement = new Map(units.map(unit => [unit.id, unitOutlinePlacement(unit, review, frame)]));
  // Small demises are painted last so a surrounding unit cannot steal their
  // clicks. Unconfirmed old boxes have no default marker or pointer target.
  const placed = units.filter(unit => ["manual", "scanned"].includes(placement.get(unit.id)!))
    .sort((a, b) => polygonArea(b.polygon!) - polygonArea(a.polygon!));
  const needsPlacement = units.filter(unit => ["needs_review", "unplaced"].includes(placement.get(unit.id)!));
  return { placement, placed, needsPlacement };
}

export function planOutlinePoints(polygon: PlanPoint[], width: number, height: number): string {
  return polygon.map(point => `${point.x * width},${point.y * height}`).join(" ");
}
