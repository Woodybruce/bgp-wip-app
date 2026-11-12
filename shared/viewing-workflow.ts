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
  // A typed name stands in for the CRM contact on this viewing. Set by the
  // server only: on a viewing a joint agent saved with a typed contact or
  // agent name, and, for a joint agent (who is never sent a CRM contact id),
  // on any viewing that has a contact behind it.
  typedContact?: boolean;
  // The firm of a viewing's agent when they are a joint agent. Filled in by
  // the calendar from the agents list; the server does not send it.
  ownerFirm?: string | null;
  sourceDetails?: { subject?: string; location?: string; issues?: string[]; [key: string]: unknown } | null;
  offers?: { id: string; offerDate: string; confirmedAt: string | null; status: string | null }[];
}

export interface ViewingOptions {
  units: { id: string; name: string; propertyId: string; propertyName: string; sqft: number | null }[];
  brands: { id: string; name: string }[];
  contacts: { id: string; name: string; email: string | null; companyId: string | null; representedBrandIds?: string[] }[];
  // The agents a viewing can sit with: BGP agents, then joint agents (with
  // their firm and the properties of the schemes they are instructed on).
  owners: { id: string; name: string; team: string | null; firm?: string | null; jointAgent?: boolean; propertyIds?: string[] }[];
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
  // Typed names, read from a joint agent login only (it has no CRM pickers).
  companyName?: string | null;
  contactName?: string | null;
  agentContactName?: string | null;
}

export function viewingMissingDetails(v: {
  unitId?: string | null; companyId?: string | null; contactId?: string | null;
  agentContactId?: string | null; ownerUserId?: string | null;
  viewingDate?: string | null; viewingTime?: string | null;
  typedContact?: boolean | null;
}): string[] {
  const missing: string[] = [];
  if (!v.unitId) missing.push("Choose the tracker unit");
  if (!v.companyId) missing.push("Confirm the brand");
  if (!v.contactId && !v.agentContactId && !v.typedContact) missing.push("Choose a brand contact or representing agent");
  if (!v.ownerUserId) missing.push("Assign the agent");
  if (!calendarDateValue(v.viewingDate)) missing.push("Set the viewing date");
  if (!v.viewingTime || !/^([01]\d|2[0-3]):[0-5]\d$/.test(v.viewingTime)) missing.push("Set the viewing time");
  return missing;
}

// A joint agent has no CRM contact list, so they type who is coming. The
// server marks that viewing (source_details.typedContact, with the agent's
// name beside it) and the typed name then fills the contact gap on that
// viewing only. A name typed on any other viewing is not marked and counts
// as before.
export function viewingTypedContact(v: { sourceDetails?: Record<string, unknown> | null; contactName?: string | null }): boolean {
  const details = v.sourceDetails;
  if (!details || details.typedContact !== true) return false;
  return !!String(v.contactName || "").trim() || !!String(details.typedAgentName || "").trim();
}

// Calendar issues and missing-detail checks name the same gap in different
// words ("Choose the tracker unit" / "Choose which tracker units are being
// viewed"). One plain phrase per gap, dropping gaps the record has since
// filled, for the follow-up task's "Why:" line (Woody, 2026-09-28).
const PLAIN_VIEWING_ISSUES: Array<[RegExp, string]> = [
  [/leasing viewing/i, "may not be a leasing viewing"],
  [/invitation changed/i, "the calendar invitation changed"],
  [/no longer in the owner's calendar/i, "no longer in the owner's calendar"],
  [/more than one is named|property for the named units/i, "more than one property is named"],
  [/name appears more than once/i, "the unit name matches more than one tracker unit"],
  [/tracker unit|units are being viewed/i, "unit"],
  [/duplicate crm contacts/i, "an attendee's email is on duplicate CRM contacts"],
  [/not found in the crm/i, "attendees are not in the CRM"],
  [/named in the invitation/i, "brand was taken from the invitation wording"],
  [/email domain/i, "brand was taken from an attendee's email domain"],
  [/more than one possibility/i, "attendees point to more than one brand"],
  [/which attendee represents/i, "an attendee's role is unclear"],
  [/contact or representing agent/i, "contact"],
  [/brand/i, "brand"],
  [/bgp owner|assign the agent/i, "no agent assigned"],
  [/date/i, "no viewing date"],
  [/time/i, "no viewing time"],
  [/review and confirm/i, "not yet confirmed"],
];

export function viewingWhy(issues: string[], v: {
  unitId?: string | null; companyId?: string | null; contactId?: string | null;
  agentContactId?: string | null; ownerUserId?: string | null; propertyName?: string | null;
  typedContact?: boolean | null;
}): string[] {
  const out: string[] = [];
  for (const issue of issues) {
    let phrase = PLAIN_VIEWING_ISSUES.find(([pattern]) => pattern.test(issue))?.[1] || issue.trim();
    if (phrase === "unit") { if (v.unitId) continue; phrase = v.propertyName ? `no tracker unit chosen at ${v.propertyName}` : "no property or tracker unit identified"; }
    if (phrase === "brand") { if (v.companyId) continue; phrase = "no brand identified"; }
    if (phrase === "contact") { if (v.contactId || v.agentContactId || v.typedContact) continue; phrase = "no brand contact or agent"; }
    if (phrase === "no agent assigned" && v.ownerUserId) continue;
    if (phrase && !out.includes(phrase)) out.push(phrase);
  }
  const rest = out.filter(phrase => phrase !== "not yet confirmed");
  return rest.length ? rest : out;
}

export function viewingNeedsOutcome(v: Pick<ViewingRecord, "status" | "viewingDate" | "outcome">, today: string): boolean {
  return (v.status === "scheduled" && !!calendarDateValue(v.viewingDate) && v.viewingDate < today)
    || (v.status === "completed" && !v.outcome?.trim());
}
