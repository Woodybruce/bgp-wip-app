import type { PlanPoint } from "./plan-geometry";

export interface EvidencePlanShareSettings {
  label: string;
  entryIds: string[];
  documentEntryIds: string[];
  includeUnitFacts: boolean;
}

export interface EvidencePlanShare extends EvidencePlanShareSettings {
  id: string;
  token: string;
  createdAt: string;
  updatedAt: string;
  revokedAt: string | null;
}

export type ExpectedEvidencePlanShare = { id: string; updatedAt: string } | null;
export interface EvidencePlanShareSaveRequest extends EvidencePlanShareSettings { expectedShare: ExpectedEvidencePlanShare }
export interface EvidencePlanShareRevokeRequest { expectedShare: ExpectedEvidencePlanShare }

export interface EvidencePlanShareResponse { share: EvidencePlanShare | null }

export interface SharedEvidenceUnitFacts {
  leaseStart: string | null;
  leaseExpiry: string | null;
  breakDate: string | null;
  reviewDate: string | null;
  outsideLtAct: string | null;
  erv: number | null;
  passingRent: number | null;
  sqft: number | null;
}

export interface SharedEvidenceLevel {
  id: string;
  name: string;
  width: number | null;
  height: number | null;
  imageUrl: string | null;
}

export interface SharedEvidenceUnit {
  id: string;
  levelId: string | null;
  unitRef: string;
  tenantName: string | null;
  polygon: PlanPoint[] | null;
  dot: PlanPoint | null;
  facts?: SharedEvidenceUnitFacts;
}

export interface SharedEvidenceEntry {
  id: string;
  unitId: string | null;
  unitRef: string | null;
  tenant: string | null;
  transactionType: string | null;
  transactionDate: string | null;
  sizeSqft: number | null;
  zoneA: number | null;
  netZoneA: number | null;
  itza: number | null;
  headlineRent: number | null;
  netEffective: number | null;
  term: string | null;
  concession: string | null;
  documentUrl?: string;
}

export interface SharedEvidencePlan {
  plan: { name: string; updatedAt: string | null };
  levels: SharedEvidenceLevel[];
  units: SharedEvidenceUnit[];
  entries: SharedEvidenceEntry[];
}
