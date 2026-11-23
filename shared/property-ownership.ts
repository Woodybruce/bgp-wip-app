// Ownership & KYC on the property page (Woody, 23 November 2026: "rename
// details to ownership and KYC that should be linked to Landreg and flow up to
// the tabs at the top ... and then als linked to our AML stuff", then "the
// landreg search should really feed the inital KYC. We dont need to KYC every
// building but have the option to from there? then we can set a builidng up
// and AML / KUYC the client from there when we get an instruction").
//
// Who owns the building at Land Registry, from the free company ownership
// lists the app holds (CCOD for UK companies, OCOD for companies abroad; never
// PropertyData), set up as its owner on the property, and checked only when a
// person asks. The rules are here; the reads and writes are
// server/property-ownership.ts and the card is
// client/src/components/property-page/ownership-card.tsx.
import { legalNameKey } from "./deal-hots";
import { sameCompaniesHouseNumber } from "./deal-parties";

/** The property's ownership roles: the pills at the top of the page. */
export const OWNERSHIP_ROLES = [
  { field: "landlordId", column: "landlord_id", label: "Owner" },
  { field: "freeholderId", column: "freeholder_id", label: "Freeholder" },
  { field: "longLeaseholderId", column: "long_leaseholder_id", label: "Long leaseholder" },
  { field: "seniorLenderId", column: "senior_lender_id", label: "Senior lender" },
  { field: "juniorLenderId", column: "junior_lender_id", label: "Junior lender" },
  { field: "assetManagerId", column: "asset_manager_id", label: "Asset manager" },
] as const;
export type OwnershipRoleField = (typeof OWNERSHIP_ROLES)[number]["field"];

export interface LandRegistryProprietor {
  name: string;
  /** Land Registry's own words: "Limited Company or Public Limited Company", "Limited Liability Partnership" ... */
  category: string | null;
  /** The UK company registration number Land Registry holds, tidied. */
  number: string | null;
  /** Where a company abroad is incorporated (the overseas list). */
  country: string | null;
  address: string | null;
  dataset: "ccod" | "ocod";
  position: number;
}

export interface LandRegistryTitle {
  titleNumber: string;
  tenure: string | null;
  propertyAddress: string | null;
  pricePaid: string | null;
  /** When the proprietor was added to the register (yyyy-mm-dd). */
  dateAdded: string | null;
  proprietors: LandRegistryProprietor[];
}

export interface OwnershipCompanyRef { id: string; name: string; companiesHouseNumber: string | null }

/** Where the KYC on a company stands, in the transaction's own words. */
export interface OwnershipKyc { status: string | null; words: string; expiresAt: string | null; approvedBy: string | null }

/** BGP's checks before asking on a company filed under the owner. */
export interface OwnershipChecks {
  running: boolean;
  ranAt: string | null;
  unfinished: string | null;
  sanctions: "clear" | "possible" | "not_screened" | null;
  redFlags: string[];
  lines: Array<{ label: string; state: "ok" | "attention" | "info" | "not_run"; detail: string | null }>;
}

// What pressing Use does for one owner on a title. A freehold title's owner
// is the building's owner: the title goes on the record, an empty Owner is set,
// an empty Freeholder is set to the Owner and the company is filed under the
// Owner (what a transaction's AML box offers as the company that signs). A
// leasehold title's owner is a long leaseholder, usually another company: only
// an empty Long leaseholder pill is set, to the CRM company that is it, and
// nothing is filed under the Owner.
export type TitleUsePlan =
  | {
    kind: "owner";
    /** The title goes on the property's record (it is not there already). */
    records: boolean;
    /** The Owner pill: kept as it is, set to the CRM company already holding this company, or a new CRM company. */
    owner: "keep" | "existing" | "create";
    /** The company is filed under the Owner as one of its companies. */
    files: boolean;
    /** The empty Freeholder pill is set to the Owner. */
    freeholder: boolean;
  }
  | {
    kind: "long_leaseholder";
    /** The CRM company already holding this company, or a new one. */
    company: "existing" | "create";
  };

export interface ProprietorView extends LandRegistryProprietor {
  /** Filed under the property's Owner as one of its companies. */
  filed: { entityId: string; name: string } | null;
  /** The Owner's own CRM record is this company. */
  isOwner: boolean;
  /** Another CRM company with this number or name (when the Owner is empty, Use sets it). */
  crm: OwnershipCompanyRef | null;
  /** Filed under another account in the CRM. */
  elsewhere: { entityId: string; name: string; under: OwnershipCompanyRef } | null;
  /** What pressing Use does; null when there is nothing left to do. */
  use: TitleUsePlan | null;
  /** Its KYC and BGP's checks, once it is filed under the Owner. */
  kyc: OwnershipKyc | null;
  checks: OwnershipChecks | null;
}

export interface TitleView extends Omit<LandRegistryTitle, "proprietors"> {
  /** Why it is listed: its address names the building's number and street, or its name; the title on the record; or only the postcode. */
  fit: "address" | "name" | "record" | "postcode";
  onRecord: boolean;
  proprietors: ProprietorView[];
}

export interface PropertyOwnershipView {
  property: { id: string; name: string; postcode: string | null; number: string | null; street: string | null };
  landRegistry: { available: boolean; loadedOn: string | null; refreshFailed: string | null };
  /** The Land Registry title the property's record holds. */
  stored: { titleNumber: string | null; proprietorName: string | null; proprietorCompanyNumber: string | null; proprietorAddress: string | null; searchedAt: string | null } | null;
  titles: TitleView[];
  /** Other titles in the postcode, when nothing at Land Registry names this address. */
  postcodeTitles: TitleView[];
  roles: Array<{ field: OwnershipRoleField; label: string; company: (OwnershipCompanyRef & { kyc: OwnershipKyc | null }) | null }>;
  owner: OwnershipCompanyRef | null;
}

const text = (v: unknown): string => String(v ?? "").replace(/\s+/g, " ").trim();
const words = (v: unknown): string => text(v).toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();

/**
 * The building's number and street as Land Registry files an address:
 * "2" and "Lambeth Hill" from "Millennium Bridge House, 2 Lambeth Hill, City
 * of London EC4V 4GG"; "35-37" from "35-37 Dover Street". Null when the address
 * holds no numbered street.
 */
export function addressNumberAndStreet(address: unknown): { number: string; street: string } | null {
  const fields = address && typeof address === "object" ? address as Record<string, unknown> : {};
  const given = [fields.streetNumber, fields.buildingNumber].map(text).find(v => /^\d/.test(v));
  const street = text(fields.street);
  if (given && street && !/^\d/.test(street) && !street.includes(",")) return { number: given.toLowerCase().replace(/\s*-\s*/g, "-"), street };
  const all = typeof address === "string" ? address : Object.values(fields).filter(v => typeof v === "string").join(", ");
  for (const part of all.split(",")) {
    const m = text(part).match(/^(\d+[a-z]?(?:\s*-\s*\d+[a-z]?)?)\s+([a-z][a-z' .-]*[a-z])/i);
    if (!m) continue;
    // A street, not a postcode district ("City of London EC4V 4GG" holds no number first).
    const streetWords = m[2].replace(/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i, "").trim();
    if (streetWords) return { number: m[1].toLowerCase().replace(/\s*-\s*/g, "-"), street: streetWords };
  }
  return null;
}

// The numbers a building number covers: "35-37" is 35 to 37, "7a" is 7.
const numberSpan = (number: string): [number, number] | null => {
  const m = number.match(/^(\d+)[a-z]?(?:-(\d+)[a-z]?)?$/i);
  if (!m) return null;
  const a = Number(m[1]), b = m[2] ? Number(m[2]) : a;
  return [Math.min(a, b), Math.max(a, b)];
};

// Every numbered stretch of the street an address names: "2-6 Lambeth Hill",
// "2 to 6 Lambeth Hill", "Millennium Bridge House, 2 Lambeth Hill".
function streetSpans(address: unknown, streetWord: string): Array<[number, number]> {
  const low = text(address).toLowerCase();
  const word = streetWord.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(?:^|[^0-9a-z])(\\d+)[a-z]?(?:\\s*(?:-|\\u2013|to|and|&)\\s*(\\d+)[a-z]?)?,?\\s+${word}\\b`, "g");
  const out: Array<[number, number]> = [];
  for (const m of low.matchAll(re)) {
    const a = Number(m[1]), b = m[2] ? Number(m[2]) : a;
    if (Math.abs(b - a) <= 400) out.push([Math.min(a, b), Math.max(a, b)]);
  }
  return out;
}

/** A property's name that says which building it is (not a street address, two words or more). */
export function buildingNameKey(name: unknown): string | null {
  const w = words(name);
  if (!w || /^\d/.test(w)) return null;
  return w.split(" ").length >= 2 ? w : null;
}

/**
 * Why a title at Land Registry is the building's: its address holds the
 * building's number on its street ("address"), or the building's own name
 * ("name"). Null when it is only in the same postcode.
 */
export function titleFit(titleAddress: unknown, place: { name?: unknown; number?: string | null; street?: string | null }): "address" | "name" | null {
  const at = ` ${words(titleAddress)} `;
  if (at.trim() === "") return null;
  const span = place.number ? numberSpan(place.number.toLowerCase()) : null;
  const firstStreetWord = place.street ? words(place.street).split(" ")[0] : "";
  if (span && firstStreetWord && streetSpans(titleAddress, firstStreetWord).some(([lo, hi]) => lo <= span[1] && span[0] <= hi)) return "address";
  const name = buildingNameKey(place.name);
  if (name && at.includes(` ${name} `)) return "name";
  return null;
}

/** The same company: the same UK number, else the same legal name. */
export function sameRegisteredCompany(a: { name: unknown; number?: unknown }, b: { name: unknown; number?: unknown }): boolean {
  if (text(a.number) && text(b.number)) return sameCompaniesHouseNumber(a.number, b.number);
  const x = legalNameKey(a.name), y = legalNameKey(b.name);
  return !!x && x === y;
}

/** What pressing Use does for one owner on a title; null when there is nothing left to do. */
export function titleUsePlan(input: {
  onRecord: boolean;
  tenure: string | null;
  owner: { id: string } | null;
  proprietor: { filed: boolean; crm: { id: string } | null; isOwner?: boolean };
  roles: { freeholderId: string | null; longLeaseholderId: string | null };
}): TitleUsePlan | null {
  if (text(input.tenure).toLowerCase() === "leasehold") {
    return input.roles.longLeaseholderId ? null : { kind: "long_leaseholder", company: input.proprietor.crm ? "existing" : "create" };
  }
  const plan: TitleUsePlan = {
    kind: "owner",
    records: !input.onRecord,
    owner: input.owner ? "keep" : input.proprietor.crm ? "existing" : "create",
    files: !input.proprietor.filed,
    freeholder: !input.roles.freeholderId,
  };
  return plan.records || plan.owner !== "keep" || plan.files || plan.freeholder ? plan : null;
}

/** The words for what Use does, for the screen ("Records title NGL123 on the building, files it under TPG Angelo Gordon for the AML"). */
export function titleUseWords(plan: TitleUsePlan, ctx: { titleNumber: string; ownerName: string | null; proprietorName: string; crmName?: string | null; storedTitle?: string | null }): string {
  if (plan.kind === "long_leaseholder") {
    return plan.company === "existing"
      ? `Sets the Long leaseholder to ${ctx.crmName || ctx.proprietorName}.`
      : `Adds ${ctx.proprietorName} to the CRM and sets it as the Long leaseholder.`;
  }
  const owner = ctx.ownerName || ctx.crmName || ctx.proprietorName;
  const replaces = ctx.storedTitle && ctx.storedTitle !== ctx.titleNumber ? ` in place of ${ctx.storedTitle}` : "";
  const parts = [
    plan.records ? `records title ${ctx.titleNumber} on the building${replaces}` : "",
    plan.owner === "existing" ? `sets the Owner to ${ctx.crmName || ctx.proprietorName}` : plan.owner === "create" ? `adds ${ctx.proprietorName} to the CRM as the Owner` : "",
    plan.files ? `files ${ctx.proprietorName} under ${owner} for the AML` : "",
    plan.freeholder ? `sets the Freeholder to ${owner}` : "",
  ].filter(Boolean);
  const said = parts.join(", ");
  return said ? `${said[0].toUpperCase()}${said.slice(1)}.` : "";
}

/** A company's KYC in the transaction's words. */
export function ownershipKycWords(state: { status?: string | null; expiresAt?: string | Date | null; approvedBy?: string | null } | null, now: Date = new Date()): OwnershipKyc {
  const status = text(state?.status).toLowerCase() || null;
  const until = state?.expiresAt ? new Date(state.expiresAt) : null;
  const day = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" });
  const expired = !!until && !Number.isNaN(until.getTime()) && until.getTime() < now.getTime();
  const words = status === "approved" && !expired ? `KYC approved${until && !Number.isNaN(until.getTime()) ? ` until ${day(until)}` : ""}`
    : status === "approved" || status === "expired" ? "KYC expired: check again"
    : status === "rejected" ? "KYC rejected by the officers"
    : status === "in_review" ? "KYC in review"
    : "Not signed off yet";
  return { status, words, expiresAt: until && !Number.isNaN(until.getTime()) ? until.toISOString() : null, approvedBy: text(state?.approvedBy) || null };
}
