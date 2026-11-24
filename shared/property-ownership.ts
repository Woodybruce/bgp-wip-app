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
import { signedOffStatus } from "./kyc-status";
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
    /** The Long leaseholder pill: set to the CRM company already holding this company, or a new one; or kept (already set). */
    company: "existing" | "create" | "keep";
    /** The company is filed under the Long leaseholder for the AML (24 November 2026, Touchwood). */
    files: boolean;
  }
  | {
    // A building held on a long lease: a freehold found is the Freeholder's. The head lease stays
    // on the record and the Owner is not touched (24 November 2026, Touchwood).
    kind: "freeholder";
    company: "existing" | "create" | "keep";
    files: boolean;
  };

export interface ProprietorView extends LandRegistryProprietor {
  /** The account this title's owner is filed under for the AML: the Owner for a freehold, the Long leaseholder for a head lease. */
  account: OwnershipCompanyRef | null;
  /** Filed under that account as one of its companies. */
  filed: { entityId: string; name: string } | null;
  /** The account's own CRM record is this company. */
  isAccount: boolean;
  /** Another CRM company with this number or name (when the role is empty, Use sets it). */
  crm: OwnershipCompanyRef | null;
  /** Filed under another account in the CRM. */
  elsewhere: { entityId: string; name: string; under: OwnershipCompanyRef } | null;
  /** What pressing Use does; null when there is nothing left to do. */
  use: TitleUsePlan | null;
  /** Its KYC, once it is filed under the account; the KYC itself is the shared client KYC window. */
  kyc: OwnershipKyc | null;
}

export interface TitleView extends Omit<LandRegistryTitle, "proprietors"> {
  /**
   * Why it is listed: its address names the building's number and street, or its name; the title on the record;
   * only the postcode; a freehold naming the building outside its postcode ("elsewhere") or on its street ("street");
   * a lease of a unit here ("unit"); or a title number a person typed ("typed").
   */
  fit: "address" | "name" | "record" | "postcode" | "elsewhere" | "street" | "unit" | "typed";
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
  /** Leases of units in the building (a tenant's lease, never its owner). */
  unitLeases: TitleView[];
  /**
   * With no freehold among the titles: freeholds that may be the building's, found beyond its postcode
   * (naming the building in its town, or on its street), and the words searched.
   */
  freeholds: { searched: { name: string | null; street: string | null; town: string | null }; titles: TitleView[] } | null;
  /** A title number a person typed, looked up (null when the lists hold no owner for it). */
  typed?: TitleView | null;
  typedNumber?: string;
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

// ── Beyond the postcode (24 November 2026, Touchwood) ──────────────────────
// Woody on Touchwood, Solihull: "picked up the long leasehold interest but not
// the freehold". The search read only the building's postcode, and a big
// site's freehold is often registered at another address or with no postcode
// at all (Solihull Council holds much of Touchwood's). With no freehold found,
// the card also lists freeholds naming the building in its town, and
// freeholds on its street, for a person to pick; and a lease of a unit here is
// a tenant's, never offered as the building's Long leaseholder.

/** A lease of a unit, shop, kiosk, suite, flat or floor: a tenant's lease, not the building's. */
export function isUnitLease(address: unknown): boolean {
  const a = text(address);
  if (!a) return false;
  return /\b(?:units?|shops?|kiosks?|stands?|stalls?|suites?|flats?|apartments?)\s+(?:no\.?\s*)?[a-z]{0,3}\s?\d/i.test(a)
    || /\b(?:ground|first|second|third|fourth|fifth|sixth|lower ground|upper ground|basement|mezzanine)\s+floors?\b/i.test(a);
}

// Words that say only what kind of place it is: a name of these alone is too general to search for.
const SEARCH_GENERIC = new Set([
  "the", "and", "of", "at", "on", "in", "house", "building", "buildings", "centre", "center", "shopping", "mall", "court", "place",
  "tower", "towers", "hall", "park", "plaza", "square", "street", "road", "lane", "unit", "units", "shop", "shops", "store", "stores",
  "office", "offices", "estate", "land", "site", "works", "yard", "retail", "block", "new", "old", "north", "south", "east", "west",
  "upper", "lower", "high", "one", "two", "three", "four", "five",
]);
// A name's ending that varies between the CRM and Land Registry ("Westgate Shopping Centre" is "Westgate Centre" there).
const KIND_SUFFIX = /\s+(?:shopping centre|shopping center|shopping mall|shopping park|retail park|centre|center|building|buildings)$/;

/**
 * The building's own name, to look for at Land Registry beyond its postcode:
 * "touchwood" from "Touchwood, Solihull", "westgate" from "Westgate Shopping
 * Centre, Oxford", "millennium bridge house". Null for a street address, or
 * a name with no word of its own ("The Mall").
 */
export function buildingSearchTerm(name: unknown): string | null {
  const first = words(text(name).split(",")[0]).replace(/^the\s+/, "");
  if (!first || /^\d/.test(first)) return null;
  const term = first.replace(KIND_SUFFIX, "").trim();
  return term.split(" ").some(w => w.length >= 4 && !SEARCH_GENERIC.has(w) && !/^\d/.test(w)) ? term : null;
}

const STREET_END = /\b(road|street|lane|avenue|way|walk|place|square|row|hill|gardens|terrace|crescent|drive|close|parade|grove|mews|yard|wharf|quay|circus|green|court|broadway|boulevard|embankment|precinct)$/i;
const POSTCODE_RE = /\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i;

/** The street the building's address names without a number ("Homer Road" from "Touchwood, Homer Road, Solihull B91 3GJ"). */
export function unnumberedStreet(address: unknown): string | null {
  const fields = address && typeof address === "object" ? address as Record<string, unknown> : {};
  const all = typeof address === "string" ? address : Object.values(fields).filter(v => typeof v === "string").join(", ");
  for (const part of all.split(",")) {
    const t = text(part.replace(POSTCODE_RE, ""));
    if (t && !/\d/.test(t) && STREET_END.test(t) && t.split(" ").length <= 5) return t;
  }
  return null;
}

/** The building's town: the address part beside its postcode ("Solihull"), else the last part of its name. */
export function postTown(address: unknown, name?: unknown): string | null {
  const fields = address && typeof address === "object" ? address as Record<string, unknown> : {};
  const all = typeof address === "string" ? address : Object.values(fields).filter(v => typeof v === "string").join(", ");
  const parts = all.split(",").map(text).filter(Boolean);
  const ok = (t: string) => !!t && /^[a-z][a-z' -]*$/i.test(t) && t.length >= 3 && t.split(" ").length <= 3 && !STREET_END.test(t);
  for (const part of parts) {
    if (!POSTCODE_RE.test(part)) continue;
    const t = text(part.replace(POSTCODE_RE, ""));
    if (ok(t)) return t;
  }
  const last = text(text(name).split(",").slice(1).pop());
  if (ok(last)) return last;
  const tail = parts.length > 1 ? text(parts[parts.length - 1].replace(POSTCODE_RE, "")) : "";
  return ok(tail) ? tail : null;
}

/** The address names the building (its own words, whole) and its town. */
export function addressNamesBuilding(titleAddress: unknown, term: string, town: string | null): boolean {
  const at = ` ${words(titleAddress)} `;
  if (!at.includes(` ${words(term)} `)) return false;
  return !town || at.includes(` ${words(town)} `);
}

/** Land Registry's country for a company abroad, as people write it: "JERSEY" is "Jersey". */
export function countryWords(country: unknown): string | null {
  const t = text(country);
  if (!t) return null;
  return t.toLowerCase().replace(/\b([a-z])/g, c => c.toUpperCase()).replace(/\b(And|Of|The)\b/g, w => w.toLowerCase());
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
  proprietor: { filed: boolean; crm: { id: string } | null };
  roles: { freeholderId: string | null; longLeaseholderId: string | null };
  /** A lease of a unit here: a tenant's lease, never the building's Long leaseholder. */
  unitLease?: boolean;
}): TitleUsePlan | null {
  if (text(input.tenure).toLowerCase() === "leasehold") {
    if (input.unitLease) return null;
    // The head lease's owner is the Long leaseholder: set the empty pill, and file the company under it for the AML.
    if (!input.roles.longLeaseholderId) return { kind: "long_leaseholder", company: input.proprietor.crm ? "existing" : "create", files: true };
    return input.proprietor.filed ? null : { kind: "long_leaseholder", company: "keep", files: true };
  }
  if (input.roles.longLeaseholderId && !input.onRecord && text(input.tenure).toLowerCase() === "freehold") {
    if (!input.roles.freeholderId) return { kind: "freeholder", company: input.proprietor.crm ? "existing" : "create", files: true };
    return input.proprietor.filed ? null : { kind: "freeholder", company: "keep", files: true };
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
export function titleUseWords(plan: TitleUsePlan, ctx: { titleNumber: string; ownerName: string | null; proprietorName: string; crmName?: string | null; storedTitle?: string | null; accountName?: string | null }): string {
  if (plan.kind === "long_leaseholder" || plan.kind === "freeholder") {
    const role = plan.kind === "long_leaseholder" ? "Long leaseholder" : "Freeholder";
    if (plan.company === "keep") {
      if (!plan.files) return "";
      const under = ctx.accountName || `the ${role}`;
      return ctx.accountName && legalNameKey(ctx.accountName) === legalNameKey(ctx.proprietorName) ? "So its KYC can be checked." : `Files ${ctx.proprietorName} under ${under} for the AML.`;
    }
    const holder = plan.company === "existing" ? ctx.crmName || ctx.proprietorName : ctx.proprietorName;
    const set = plan.company === "existing" ? `Sets the ${role} to ${holder}` : `Adds ${ctx.proprietorName} to the CRM and sets it as the ${role}`;
    if (!plan.files) return `${set}.`;
    return legalNameKey(holder) === legalNameKey(ctx.proprietorName) ? `${set}, and files it for the AML.` : `${set}, and files ${ctx.proprietorName} under it for the AML.`;
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
  // Only a sign-off counts (24 November 2026): a stale "in review" reads as not signed off.
  const status = signedOffStatus(state?.status);
  const until = state?.expiresAt ? new Date(state.expiresAt) : null;
  const day = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" });
  const expired = !!until && !Number.isNaN(until.getTime()) && until.getTime() < now.getTime();
  const words = status === "approved" && !expired ? `KYC approved${until && !Number.isNaN(until.getTime()) ? ` until ${day(until)}` : ""}`
    : status === "approved" || status === "expired" ? "KYC expired: check again"
    : status === "rejected" ? "KYC rejected by the officers"
    : "Not signed off yet";
  return { status, words, expiresAt: until && !Number.isNaN(until.getTime()) ? until.toISOString() : null, approvedBy: text(state?.approvedBy) || null };
}
