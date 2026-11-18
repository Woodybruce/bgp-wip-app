// A deal's parties, each with the company that signs for it and the person
// to ask (Woody, 18 November 2026: "most importantly adding the billing
// entities so can AML. Also when doing that if the AML hasnt started need
// the ability to add in all the info so it can start such as email phone
// numbers etc"; docs/deal-page-review-2026-11-18.md, step 1).
//
// A party on a deal is a CRM company (the brand: "The Dulwich Bakery"). The
// company that signs is a crm_trading_entities row filed under that brand
// ("The Dulwich Bakery Ltd", with its Companies House number), stored on the
// deal as <role>_trading_entity_id. It is not the Xero billing contact
// (<role>_entity_id), which is made from it. The person to ask is a contact
// filed under the brand, stored as <role>_contact_id.
//
// The rules here are pure: server/deal-parties.ts reads the records and
// writes, the screens draw from what it sends.

export const DEAL_PARTY_ROLES = ["landlord", "tenant", "vendor", "purchaser"] as const;
export type DealPartyRole = (typeof DEAL_PARTY_ROLES)[number];
export const isDealPartyRole = (v: unknown): v is DealPartyRole =>
  typeof v === "string" && (DEAL_PARTY_ROLES as readonly string[]).includes(v);

export const DEAL_PARTY_LABEL: Record<DealPartyRole, string> = {
  landlord: "Landlord", tenant: "Tenant", vendor: "Vendor", purchaser: "Purchaser",
};

// The deal's own fields for each party, as the API names them and as the
// table does.
export const DEAL_PARTY_FIELDS: Record<DealPartyRole, { brand: string; company: string; person: string; xeroId: string; xeroName: string }> = {
  landlord: { brand: "landlordId", company: "landlordTradingEntityId", person: "landlordContactId", xeroId: "landlordEntityId", xeroName: "landlordEntityName" },
  tenant: { brand: "tenantId", company: "tenantTradingEntityId", person: "tenantContactId", xeroId: "tenantEntityId", xeroName: "tenantEntityName" },
  vendor: { brand: "vendorId", company: "vendorTradingEntityId", person: "vendorContactId", xeroId: "vendorEntityId", xeroName: "vendorEntityName" },
  purchaser: { brand: "purchaserId", company: "purchaserTradingEntityId", person: "purchaserContactId", xeroId: "purchaserEntityId", xeroName: "purchaserEntityName" },
};
export const DEAL_PARTY_COLUMNS: Record<DealPartyRole, { brand: string; company: string; person: string; xeroId: string; xeroName: string }> = {
  landlord: { brand: "landlord_id", company: "landlord_trading_entity_id", person: "landlord_contact_id", xeroId: "landlord_entity_id", xeroName: "landlord_entity_name" },
  tenant: { brand: "tenant_id", company: "tenant_trading_entity_id", person: "tenant_contact_id", xeroId: "tenant_entity_id", xeroName: "tenant_entity_name" },
  vendor: { brand: "vendor_id", company: "vendor_trading_entity_id", person: "vendor_contact_id", xeroId: "vendor_entity_id", xeroName: "vendor_entity_name" },
  purchaser: { brand: "purchaser_id", company: "purchaser_trading_entity_id", person: "purchaser_contact_id", xeroId: "purchaser_entity_id", xeroName: "purchaser_entity_name" },
};
export const DEAL_PARTY_COMPANY_FIELDS = DEAL_PARTY_ROLES.map(r => DEAL_PARTY_FIELDS[r].company);

export interface DealPartyCompany { id: string; name: string; companiesHouseNumber: string | null; isDefault: boolean }
export interface DealPartyPerson { id: string; name: string; email: string | null; mobile: string | null; jobTitle: string | null }

export type PartyGapKey = "company" | "person" | "email";
// words: the full line (the AML box, the editor); short: a few words for a
// narrow column (the deal page's party lines).
export interface PartyGap { key: PartyGapKey; words: string; short: string }

export type CompanyOfferWhy = "lease" | "default" | "only";

export interface DealPartyView {
  role: DealPartyRole;
  label: string;
  brand: { id: string; name: string; companiesHouseNumber: string | null; kind: "company" | "individual" };
  // The company that signs, as set on the deal.
  company: DealPartyCompany | null;
  // What to offer when none is set: the company on the unit's lease (a
  // letting's tenant), the brand's default, or its only company.
  offer: (DealPartyCompany & { why: CompanyOfferWhy }) | null;
  // Every company filed under the brand.
  companies: DealPartyCompany[];
  // The Xero contact invoices go to.
  xero: { contactId: string; name: string | null } | null;
  // Who the client checks and KYC4U go to: set for this party on the deal,
  // or the deal's client contact when that person is filed under the brand.
  person: (DealPartyPerson & { from: "party" | "client" }) | null;
  // The people filed under the brand.
  people: DealPartyPerson[];
  // What stops the checks from starting, in the order to fill it.
  gaps: PartyGap[];
}

const text = (v: unknown): string => String(v ?? "").replace(/\s+/g, " ").trim();
const number = (v: unknown): string => String(v ?? "").replace(/\s+/g, "").toUpperCase();
export const sameCompaniesHouseNumber = (a: unknown, b: unknown): boolean => {
  const pad = (s: string) => (/^\d+$/.test(s) ? s.padStart(8, "0") : s);
  const x = number(a), y = number(b);
  return !!x && !!y && pad(x) === pad(y);
};

/** The company to offer first when the deal names none: the one on the unit's lease, the brand's default, or the only one filed. */
export function companyOffer(companies: DealPartyCompany[], leaseCompanyId: string | null | undefined): DealPartyView["offer"] {
  const lease = leaseCompanyId ? companies.find(c => c.id === leaseCompanyId) : undefined;
  if (lease) return { ...lease, why: "lease" };
  const defaults = companies.filter(c => c.isDefault);
  if (defaults.length === 1) return { ...defaults[0], why: "default" };
  if (companies.length === 1) return { ...companies[0], why: "only" };
  return null;
}

export const OFFER_WORDS: Record<CompanyOfferWhy, string> = {
  lease: "the company on the unit's lease",
  default: "the brand's main company",
  only: "the only company filed under the brand",
};

/**
 * What stops BGP's checks and the client checks from starting for one party.
 * A company party needs a company the checks can read: the one set on the
 * deal, or the brand's own Companies House record. Every party needs a
 * person to ask, with an email. Nothing else is asked for here: an
 * individual's date of birth and address are the client checks' to gather.
 */
export function partyGaps(input: {
  kind: "company" | "individual";
  brandName: string;
  brandHasNumber: boolean;
  companySet: boolean;
  person: { name: string; email: string | null } | null;
}): PartyGap[] {
  const gaps: PartyGap[] = [];
  if (input.kind === "company" && !input.companySet && !input.brandHasNumber) {
    gaps.push({ key: "company", words: `The company that signs for ${text(input.brandName) || "this party"}, so the checks can read Companies House`, short: "the company that signs" });
  }
  if (!input.person) gaps.push({ key: "person", words: "Who to ask: their name and email", short: "who to ask" });
  else if (!text(input.person.email)) gaps.push({ key: "email", words: `An email for ${text(input.person.name) || "the person to ask"}`, short: "their email" });
  return gaps;
}

/** Whether a contact's email looks like an address. */
export const looksLikeEmail = (v: unknown): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text(v));

export interface NewPartyPerson { name: string; email: string | null; mobile: string | null; jobTitle: string | null }

/** A person typed on the deal: a name, and an email or mobile that look right. Null with the reason when not. */
export function newPartyPerson(body: unknown): { person: NewPartyPerson } | { problem: string } {
  const b: Record<string, unknown> = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const name = text(b.name).slice(0, 120);
  const email = text(b.email).toLowerCase().slice(0, 200) || null;
  const mobile = text(b.mobile).slice(0, 40) || null;
  const jobTitle = text(b.jobTitle).slice(0, 120) || null;
  if (!name) return { problem: "Give the person's name." };
  if (email && !looksLikeEmail(email)) return { problem: "That email address does not look right." };
  if (mobile && !/^\+?[\d\s()-]{6,}$/.test(mobile)) return { problem: "That mobile number does not look right." };
  if (!email && !mobile) return { problem: "Give their email (the client checks go by email), or at least a mobile." };
  return { person: { name, email, mobile, jobTitle } };
}

/** What a contact already on the CRM gains from what was typed: blank fields only, never an overwrite. */
export function personFill(held: { email: string | null; phone_mobile: string | null; role: string | null }, typed: NewPartyPerson): Record<string, string> {
  const fill: Record<string, string> = {};
  if (!text(held.email) && typed.email) fill.email = typed.email;
  if (!text(held.phone_mobile) && typed.mobile) fill.phone_mobile = typed.mobile;
  if (!text(held.role) && typed.jobTitle) fill.role = typed.jobTitle;
  return fill;
}
