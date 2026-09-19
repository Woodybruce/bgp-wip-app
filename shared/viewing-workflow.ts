import { calendarDateValue } from "./calendar-date";

export const VIEWING_STATUSES = ["scheduled", "completed", "cancelled", "no_show", "not_leasing"] as const;
export type ViewingStatus = typeof VIEWING_STATUSES[number];
export const VIEWING_OUTCOMES = ["Interested", "Not Interested", "Follow Up", "Second Viewing", "Offer Expected", "Offer Received"] as const;

export interface ViewingRecord {
  id: string;
  unitId: string | null;
  propertyId: string | null;
  propertyName: string | null;
  unitName: string | null;
  sqft: number | null;
  companyId: string | null;
  companyName: string | null;
  contactId: string | null;
  contactName: string | null;
  agentContactId: string | null;
  agentContactName: string | null;
  ownerUserId: string | null;
  ownerName: string | null;
  team: string | null;
  requirementId: string | null;
  requirementName: string | null;
  viewingDate: string;
  viewingTime: string | null;
  status: ViewingStatus;
  outcome: string | null;
  notes: string | null;
  attendees: string | null;
  nextAction: string | null;
  followUpDate: string | null;
  source: string | null;
  calendarEventId: string | null;
  bookingId: string | null;
  detailsConfirmedAt: string | null;
  outcomeRecordedAt: string | null;
  updatedAt: string;
  issues: string[];
  sourceDetails?: { subject?: string; location?: string; issues?: string[]; [key: string]: unknown } | null;
  offers?: { id: string; offerDate: string; confirmedAt: string | null; status: string | null }[];
}

export interface ViewingOptions {
  units: { id: string; name: string; propertyId: string; propertyName: string; sqft: number | null }[];
  brands: { id: string; name: string }[];
  contacts: { id: string; name: string; email: string | null; companyId: string | null; representedBrandIds?: string[] }[];
  owners: { id: string; name: string; team: string | null }[];
  requirements: { id: string; name: string; companyId: string | null }[];
}

export interface ViewingPatch {
  unitId?: string | null;
  companyId?: string | null;
  contactId?: string | null;
  agentContactId?: string | null;
  ownerUserId?: string | null;
  requirementId?: string | null;
  viewingDate?: string;
  viewingTime?: string | null;
  status?: ViewingStatus;
  outcome?: string | null;
  notes?: string | null;
  nextAction?: string | null;
  followUpDate?: string | null;
  confirmDetails?: boolean;
  expectedUpdatedAt?: string;
}

export function viewingMissingDetails(v: {
  unitId?: string | null; companyId?: string | null; contactId?: string | null;
  agentContactId?: string | null; ownerUserId?: string | null;
  viewingDate?: string | null; viewingTime?: string | null;
}): string[] {
  const missing: string[] = [];
  if (!v.unitId) missing.push("Choose the tracker unit");
  if (!v.companyId) missing.push("Confirm the brand");
  if (!v.contactId && !v.agentContactId) missing.push("Choose a brand contact or representing agent");
  if (!v.ownerUserId) missing.push("Assign the BGP owner");
  if (!calendarDateValue(v.viewingDate)) missing.push("Set the viewing date");
  if (!v.viewingTime || !/^([01]\d|2[0-3]):[0-5]\d$/.test(v.viewingTime)) missing.push("Set the viewing time");
  return missing;
}

export function viewingNeedsOutcome(v: Pick<ViewingRecord, "status" | "viewingDate" | "outcome">, today: string): boolean {
  return (v.status === "scheduled" && !!calendarDateValue(v.viewingDate) && v.viewingDate < today)
    || (v.status === "completed" && !v.outcome?.trim());
}
