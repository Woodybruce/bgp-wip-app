import type { PlanPoint as Pt } from "./plan-geometry";

export type ScanReviewUnit = {
  id: string;
  unitRef: string;
  tenantName: string | null;
  polygon: Pt[] | null;
  dot: Pt | null;
  source: string | null;
};

export type ScanReviewCandidate = {
  id: string;
  unitRef: string;
  tenantName: string | null;
  polygon: Pt[];
  dot: Pt;
  status: "added" | "refined" | "current" | "review";
  unitId: string | null;
  suggestedUnitIds: string[];
  reason: string;
};

export type PlanScanReview = {
  version: 1;
  planId: string;
  levelId: string;
  jobId: string;
  backgroundKey: string;
  createdAt: string;
  summary: { detected: number; added: number; refined: number; current: number; needsReview: number };
  candidates: ScanReviewCandidate[];
  existingUnits: ScanReviewUnit[];
  applied: Record<string, { unitId: string; action: "created" | "replaced" }>;
  clearedUnitIds: string[];
};

export type ScanReviewResponse = { review: PlanScanReview | null; legacyNeedsRescan: boolean };
export type ScanReviewAssignment = { candidateId: string; unitId: string | null; newUnitRef?: string };
export type ScanReviewApplyRequest = { assignments: ScanReviewAssignment[]; clearOutlineUnitIds?: string[] };
