// What GET /api/landsec/tracker sends the joint agent's Letting Tracker
// (server/landsec-tracker.ts, client/src/pages/landsec-tracker.tsx). Types
// only. The reply is an allow-list: there is no fee, deal id, landlord, BGP
// agent, CRM id, email address or phone number on any of these.
import type { DealStatusCode } from "./deal-status";
import type { BriefProgressInput } from "./brief-progress";
import type { ChecklistStageKey, ChecklistSummary } from "./deal-checklist";
import type { RecommendationSummary } from "./unit-recommendation";
import type { HotsStage } from "./unit-hots";

export interface LandsecTrackerInterestLine {
  id: string;
  companyName: string | null;
  agentCompanyName: string | null;
  contactName: string | null;      // only on a hand-logged line that names no brand and no agent
  interestDate: string | null;
  notes: string | null;            // never the wording the inbox or diary sweep wrote
}

export interface LandsecTrackerViewingLine {
  id: string;
  companyName: string | null;
  contactName: string | null;
  viewingDate: string | null;
  viewingTime: string | null;
  status: string;
  outcome: string | null;
}

export interface LandsecTrackerOfferLine {
  id: string;
  companyName: string | null;
  contactName: string | null;      // only on an offer this login logged
  own: boolean;
  offerDate: string | null;
  status: string;
  rentPa: number | null;
}

export interface LandsecTrackerUnit {
  id: string;
  unitName: string;
  propertyId: string;
  propertyName: string;
  schemeKey: string;
  schemeName: string;
  marketingStatus: string | null;
  statusCode: DealStatusCode;
  floor: string | null;
  sqft: number | null;
  useClass: string | null;
  condition: string | null;
  epcRating: string | null;
  askingRent: number | null;
  rentPoa: boolean;
  ratesPa: number | null;
  serviceChargePa: number | null;
  leaseTerms: string | null;
  availableDate: string | null;
  marketingStartDate: string | null;
  notes: string | null;
  restrictions: string | null;
  existingTenant: string | null;
  dealRef: number | null;          // the reference only
  hasUnitPage: boolean;            // the unit is on the tenancy schedule, so it has a Landsec unit page
  createdAt: string | null;
  updatedAt: string | null;
  brief: { id: string; agreed: boolean; agreedAt: string | null; signoff: { total: number; agreed: number; complete: boolean } } | null;
  interest: { count: number; lines: LandsecTrackerInterestLine[] };
  viewings: { count: number; lines: LandsecTrackerViewingLine[] };
  offers: { count: number; lines: LandsecTrackerOfferLine[] };
  checklist: (ChecklistSummary & { responsibleName: string | null; stage: ChecklistStageKey }) | null;
  recommendation: RecommendationSummary | null;
  hots: { stage: HotsStage; version: number; issuedAt: string | null };
  // What "Against the brief" is worked out from; the page adds today's date.
  monitor: Omit<BriefProgressInput, "today">;
}

export interface LandsecTrackerData {
  viewer: { role: "joint_agent" | "bgp"; userId: string; name: string | null; firm: string | null };
  schemes: { key: string; name: string; properties: { id: string; name: string }[] }[];
  units: LandsecTrackerUnit[];
}

export interface LandsecTrackerPickProperty { id: string; name: string; schemeKey: string; schemeName: string }
export interface LandsecTrackerPickUnit {
  unitName: string;
  tenancyUnitId: string | null;
  trackerUnitId: string | null;    // set when the unit is live on the tracker
  statusCode: string | null;
  dealRef: number | null;
  occupancy: string | null;
  tenantName: string | null;
}
export interface LandsecTrackerPickList { properties: LandsecTrackerPickProperty[]; units: LandsecTrackerPickUnit[] }
