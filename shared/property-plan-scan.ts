export type PropertyPlanPolygon = { points: [number, number][] };
export type PropertyPlanCandidate = {
  id: string;
  label: string;
  tenant: string | null;
  polygon: PropertyPlanPolygon;
  tenancy_unit_id: string | null;
  unit_id: string | null;
  requiresReview: boolean;
  warning: string | null;
};
export type PropertyPlanScanJob = {
  id: string;
  status: "running" | "ready" | "failed" | "applied";
  total: number;
  completed: number;
  message: string;
  candidates: PropertyPlanCandidate[];
};
export type PropertyPlanScanAssignment = {
  candidateId: string;
  tenancy_unit_id: string | null;
  unit_id: string | null;
  label: string;
};
