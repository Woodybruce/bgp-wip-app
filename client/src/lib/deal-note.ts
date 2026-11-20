// What a note read for the deal form changes (Woody, 2026-11-17: "the type it
// and AI fills in ability in a new box at the top" of the one deal form used
// for New Deal, Promote to Solicitors and the Heads of Terms' Convert to
// Solicitors). The box reads the note as an offer with the letting note
// reader (shared/letting-note.ts), so its rules hold: a tight note fills, a
// note written out in full lists each value for the person to Use. This maps
// a reading onto the deal form. Only the keys the reading holds change the
// form: the rent, the lease length, the rent free, the break and the capital
// contribution fill their boxes; the tenant brand only when it is one the
// form's tenant picker lists; anything with no box goes into Comments as a
// labelled line, once. An offer's date is never the target date. Pure, so it
// is tested without React.
import type { LettingNoteReading } from "../../../shared/letting-note";
import type { DealNoteCandidate, DealNoteRead, DealNoteRole } from "../../../shared/deal-note";
import { formatCalendarDate } from "../../../shared/calendar-date";

export interface DealNoteForm {
  tenantId: string;
  tenantEntityId: string;
  tenantEntityName: string;
  // The company that signs for the tenant: a new tenant clears it too.
  tenantTradingEntityId?: string;
  rentPa: string;
  leaseLength: string;
  rentFree: string;
  breakOption: string;
  capitalContribution: string;
  comments: string;
}

export interface DealNoteTenant { id: string; name: string }

const words = (s: unknown) => String(s ?? "").trim();
const same = (s: unknown) => words(s).toLowerCase().replace(/\s+/g, " ");
const figure = (v: unknown): string | null => (typeof v === "number" && Number.isFinite(v) ? String(v) : null);
const pounds = (v: unknown): string | null => (typeof v === "number" && Number.isFinite(v) ? `£${v.toLocaleString("en-GB")}` : null);
const isDay = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

/** Lines added to Comments once: a line already there (typed, or from an earlier fill) is not added again. */
export function addCommentLines(existing: string, parts: Array<string | null | undefined>): string {
  const out = [words(existing)].filter(Boolean);
  for (const part of parts) {
    const line = words(part);
    if (line && !out.some(have => same(have).includes(same(line)))) out.push(line);
  }
  return out.join("\n");
}

/** The tenant a reading names: its id when the picker lists it, else one exact name among the picker's tenants. */
export function noteTenant(reading: LettingNoteReading, tenants: ReadonlyArray<DealNoteTenant>): DealNoteTenant | null {
  const f = reading.fields || {};
  if (f.brandId) {
    const byId = tenants.find(t => String(t.id) === String(f.brandId));
    if (byId) return byId;
  }
  const want = same(f.brandName);
  if (!want) return null;
  const hits = tenants.filter(t => same(t.name) === want);
  return hits.length === 1 ? hits[0] : null;
}

/**
 * The changes a reading makes to the deal form, and what to say under the
 * tenant picker: the brand's name when the note named a brand the picker does
 * not list (it is never picked), null when the tenant was found, undefined
 * when the note named no brand.
 */
export function dealNotePatch(form: DealNoteForm, reading: LettingNoteReading, tenants: ReadonlyArray<DealNoteTenant>): { patch: Partial<DealNoteForm>; brandHint: string | null | undefined } {
  const f = reading.fields || {};
  const patch: Partial<DealNoteForm> = {};
  const rent = figure(f.rentPa);
  if (rent !== null) patch.rentPa = rent;
  const term = figure(f.termYears);
  if (term !== null) patch.leaseLength = term;
  const free = figure(f.rentFreeMonths);
  if (free !== null) patch.rentFree = free;
  if (words(f.breakOption)) patch.breakOption = words(f.breakOption);
  const contribution = figure(f.fittingOutContribution);
  if (contribution !== null) patch.capitalContribution = contribution;

  let brandHint: string | null | undefined;
  if (f.brandId || words(f.brandName)) {
    const tenant = noteTenant(reading, tenants);
    if (tenant) {
      brandHint = null;
      if (String(tenant.id) !== form.tenantId) Object.assign(patch, { tenantId: String(tenant.id), tenantEntityId: "", tenantEntityName: "", tenantTradingEntityId: "" });
    } else {
      brandHint = words(f.brandName) || null;
    }
  }

  const premium = pounds(f.premium);
  const agent = [f.agentName, f.agentCompanyName].map(words).filter(Boolean);
  const comments = addCommentLines(form.comments, [
    typeof f.turnoverRentPct === "number" ? `Turnover rent: ${f.turnoverRentPct}%` : null,
    premium ? `Premium: ${premium}` : null,
    words(f.rentReview) ? `Rent review: ${words(f.rentReview)}` : null,
    words(f.rentDeposit) ? `Rent deposit: ${words(f.rentDeposit)}` : null,
    words(f.incentives) ? `Incentives: ${words(f.incentives)}` : null,
    words(f.contactName) ? `Contact: ${words(f.contactName)}` : null,
    agent.length ? `Agent: ${agent.filter((a, i) => agent.findIndex(b => same(b) === same(a)) === i).join(", ")}` : null,
    isDay(f.date) ? `Dated ${formatCalendarDate(f.date) || f.date}` : null,
    f.note, ...(reading.unplaced || []),
  ]);
  if (comments !== words(form.comments)) patch.comments = comments;
  return { patch, brandHint };
}

// ── The deal itself (2026-11-20) ────────────────────────────────────────────
// The box's second reading (shared/deal-note.ts, server/deal-note-reader.ts):
// the kind of deal, the property and each party, looked up in the CRM. What
// is sure fills an EMPTY box by itself: one kind of deal, one property that
// matched every word of the address, one CRM company for a party. A party
// already picked, a property already chosen or a deal type already set is
// never replaced. The rest is listed on the form to pick, or to add.

/** The form's boxes for each party: the CRM company, the company that signs, and the billing entity (Xero). */
export const PARTY_FORM_KEYS: Record<DealNoteRole, { id: string; trading: string; entity: string; entityName: string }> = {
  landlord: { id: "landlordId", trading: "landlordTradingEntityId", entity: "landlordEntityId", entityName: "landlordEntityName" },
  tenant: { id: "tenantId", trading: "tenantTradingEntityId", entity: "tenantEntityId", entityName: "tenantEntityName" },
  vendor: { id: "vendorId", trading: "vendorTradingEntityId", entity: "vendorEntityId", entityName: "vendorEntityName" },
  purchaser: { id: "purchaserId", trading: "purchaserTradingEntityId", entity: "purchaserEntityId", entityName: "purchaserEntityName" },
};

/** The parties a deal type's form shows: vendor and purchaser for a sale or purchase, landlord and tenant for the rest. */
export function rolesShownFor(dealType: string | null | undefined): DealNoteRole[] {
  return dealType === "Sale" || dealType === "Purchase" ? ["vendor", "purchaser"] : ["landlord", "tenant"];
}

/** The team a deal type adds (the deal form's own rule when a type is picked), or null. */
export function teamForDealType(dealType: string | null | undefined): string | null {
  if (dealType === "Purchase" || dealType === "Sale") return "Investment";
  if (dealType === "Lease Acquisition") return "Tenant Rep";
  if (["Lease Disposal", "Lease Renewal", "Rent Review", "Regear"].includes(String(dealType || ""))) return "Lease Advisory";
  return null;
}

/** Picking a party: its CRM company and, when the name matched one, the company that signs; a change of party clears the billing entity. */
export function partyPatch(form: Record<string, any>, role: DealNoteRole, c: Pick<DealNoteCandidate, "companyId" | "entityId">): Record<string, string> {
  const k = PARTY_FORM_KEYS[role];
  const patch: Record<string, string> = {};
  const changed = String(form[k.id] || "") !== c.companyId;
  if (changed) Object.assign(patch, { [k.id]: c.companyId, [k.entity]: "", [k.entityName]: "", [k.trading]: "" });
  if (c.entityId && (changed || !form[k.trading])) patch[k.trading] = c.entityId;
  return patch;
}

/** The billing entity made or found for a party (POST /api/billing-entities): the company that signs and its Xero contact. */
export function billingPatch(role: DealNoteRole, made: { entity?: { id?: string | null } | null; contact?: { ContactID?: string; Name?: string } | null }): Record<string, string> {
  const k = PARTY_FORM_KEYS[role];
  const patch: Record<string, string> = {};
  if (made.entity?.id) patch[k.trading] = String(made.entity.id);
  if (made.contact?.ContactID) { patch[k.entity] = String(made.contact.ContactID); patch[k.entityName] = String(made.contact.Name || ""); }
  return patch;
}

/** The property the reading is sure of: one that matched every word of the address. */
export function surePropertyId(read: DealNoteRead | null | undefined): string | null {
  const place = read?.place;
  return place && !place.approximate && place.properties.length === 1 ? place.properties[0].id : null;
}

/**
 * What a deal reading fills by itself: a deal type when none is set, the
 * property when none is chosen, and each party the form shows that has one
 * CRM company and is not picked yet.
 */
export function dealReadPatch(form: Record<string, any>, read: DealNoteRead): Record<string, string> {
  const patch: Record<string, string> = {};
  if (read.dealType?.value && !form.dealType) patch.dealType = read.dealType.value;
  const propertyId = surePropertyId(read);
  if (propertyId && !form.propertyId) patch.propertyId = propertyId;
  const shown = rolesShownFor(patch.dealType || form.dealType);
  for (const party of read.parties) {
    if (!shown.includes(party.role) || party.candidates.length !== 1) continue;
    const k = PARTY_FORM_KEYS[party.role];
    if (form[k.id] && String(form[k.id]) !== party.candidates[0].companyId) continue;
    Object.assign(patch, partyPatch(form, party.role, party.candidates[0]));
  }
  return patch;
}

const unitKey = (s: unknown) => String(s ?? "").toLowerCase().replace(/\b(?:unit|shop|suite)\b/g, " ").replace(/[^a-z0-9]+/g, "");

/** The unit on the chosen property: the one the note names, else the property's only unit. Null when it is not one for certain. */
export function noteUnitId(read: DealNoteRead, propertyId: string, units: ReadonlyArray<{ id: string; unitName: string; propertyId: string }>): string | null {
  const here = units.filter(u => u.propertyId === propertyId);
  const named = read.place?.unit?.value;
  if (named) {
    const want = unitKey(named);
    const hits = want ? here.filter(u => unitKey(u.unitName) === want) : [];
    return hits.length === 1 ? hits[0].id : null;
  }
  return here.length === 1 ? here[0].id : null;
}

/**
 * Picking a property (the combobox, a "Find the unit" row, or a note): the
 * property, its landlord as the landlord (or vendor on a sale or purchase)
 * when none is picked yet, and its BGP team unless the deal is already
 * Investment, Tenant Rep or Lease Advisory.
 */
export function propertyPickPatch(
  form: { dealType?: string; team: string[]; landlordId?: string; vendorId?: string },
  propertyId: string,
  prop: { landlordId?: string | null; bgpEngagement?: string[] | null } | null | undefined,
  isBgpTeam: (team: string) => boolean,
): Record<string, any> {
  const patch: Record<string, any> = { propertyId };
  const propLandlordId = prop?.landlordId || "";
  const investType = form.dealType === "Sale" || form.dealType === "Purchase";
  const propTeam = (prop?.bgpEngagement || []).find(t => isBgpTeam(t));
  if (propTeam && !form.team.some(t => ["Investment", "Tenant Rep", "Lease Advisory"].includes(t))) {
    patch.team = [propTeam, ...form.team.filter(t => t === "Landsec")];
  }
  if (propLandlordId) {
    if (investType && !form.vendorId) patch.vendorId = propLandlordId;
    if (!investType && !form.landlordId) patch.landlordId = propLandlordId;
  }
  return patch;
}

/** The deal name the form fills while nobody has typed one: "Tenant – Property", or "Client – Property" on a sale or purchase. */
export function dealAutoName(
  f: { dealType?: string; propertyId?: string; tenantId?: string; vendorId?: string; purchaserId?: string },
  properties: ReadonlyArray<{ id: string; name?: string | null }>,
  companies: ReadonlyArray<{ id: string; name?: string | null }>,
): string {
  const propName = properties.find(p => p.id === f.propertyId)?.name || "";
  const investType = f.dealType === "Sale" || f.dealType === "Purchase";
  const partyId = investType ? (f.dealType === "Sale" ? f.vendorId : f.purchaserId) : f.tenantId;
  const cpName = companies.find(c => c.id === partyId)?.name || "";
  if (cpName && propName) return `${cpName} – ${propName}`;
  return cpName || propName || "";
}
