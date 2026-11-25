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

import type { BillingState } from "./deal-billing";
import type { DealGuarantorView } from "./deal-guarantor";

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

// xeroContactId: the company's own contact in the firm's Xero, once one is
// found or made for it (20 November 2026), so billing it is billing this company.
// kind "individual": a person filed under the party who signs (or is billed)
// in their own name (Woody, 20 November 2026: "need ability to create billing
// entity or contracting entity as a person we will then KYC them");
// contactId: the CRM contact who is that person.
export interface DealPartyCompany { id: string; name: string; companiesHouseNumber: string | null; isDefault: boolean; xeroContactId?: string | null; xeroContactName?: string | null; kind?: "company" | "individual"; contactId?: string | null;
  // A company registered abroad (23 November 2026): its country, its number on its own register and a link to its entry.
  abroad?: { country: string; registrationNumber: string | null; registerUrl: string | null } }

/** How a filed company reads beside its name: its Companies House number, or where it is registered abroad. */
export function companyRegisterWords(c: Pick<DealPartyCompany, "companiesHouseNumber" | "abroad" | "kind">): string {
  if (c.kind === "individual") return "a person";
  if (c.abroad) return `registered in ${c.abroad.country}${c.abroad.registrationNumber ? ` · ${c.abroad.registrationNumber}` : ""}`;
  return c.companiesHouseNumber || "no Companies House number";
}

/** crm_trading_entities.entity_kind as the screens read it: "individual" for a person, else a company. */
export const signerKindOf = (entityKind: unknown): "company" | "individual" =>
  String(entityKind ?? "").trim().toLowerCase() === "individual" ? "individual" : "company";

/**
 * Whether a party's checks are about a company or a private individual. The
 * one who signs decides when the deal names one (a person who signs is
 * checked as an individual, whatever the record above them is); with nobody
 * named, the record itself (crm_companies.aml_subject_type).
 */
export function partySubjectKind(brandSubjectType: unknown, signer: { kind?: unknown } | null | undefined): "company" | "individual" {
  if (signer) return signerKindOf(signer.kind);
  return String(brandSubjectType ?? "").trim().toLowerCase() === "individual" ? "individual" : "company";
}

/** A third party that pays BGP's invoice for the client (shared/deal-billing.ts). */
export interface DealPartyPayer {
  id: string; name: string; companiesHouseNumber: string | null; xeroContactId: string | null;
  relationship: string | null; relationshipWords: string; note: string | null; clear: boolean;
}

/** Who BGP's client is billed as, set against the company that signs (BGP's client only). */
export interface DealPartyBilling {
  state: BillingState;
  tone: "done" | "act" | "flag" | "info";
  words: string;
  // Who the invoice goes to now, and where that is set: the deal's own
  // invoice contact, or this party's billing contact.
  billed: { contactId: string | null; name: string | null } | null;
  from: "deal" | "party" | null;
  payer: DealPartyPayer | null;
}
export interface DealPartyPerson { id: string; name: string; email: string | null; mobile: string | null; jobTitle: string | null }

// Who the person to ask is to the party (Woody, 25 November 2026: "when we are
// looking at a joint agent led deal we are proposing to ask the joint agent ...
// pick the relationship when adding who to ask so the app can then send the
// correct email"). It decides which email the checks go out as.
export const ASK_RELATIONS = ["party", "manager", "own_agent", "joint_agent"] as const;
export type AskRelation = typeof ASK_RELATIONS[number];
export const ASK_RELATION_WORDS: Record<AskRelation, string> = {
  party: "Someone at the party",
  manager: "Their asset or managing agent",
  own_agent: "Their agent",
  joint_agent: "The joint agent",
};
// What each sends, in a line under the choice.
export const ASK_RELATION_EMAIL: Record<AskRelation, string> = {
  party: "They get the client checks: their own ID and the company's documents.",
  manager: "They get the client checks, acting for the party: their ID and their authority to act.",
  own_agent: "They get our checks to pass on to their client, and can upload what they hold.",
  joint_agent: "They are asked for the documents they hold as joint agent, not the client checks.",
};
export const isAskRelation = (v: unknown): v is AskRelation => (ASK_RELATIONS as readonly string[]).includes(String(v));
/** An agent relation: the person is at another firm, so they need not be filed under the party. */
export const askIsAgent = (r: AskRelation | null | undefined): boolean => r === "own_agent" || r === "joint_agent";

export type PartyGapKey = "company" | "person" | "email";
// words: the full line (the AML box, the editor); short: a few words for a
// narrow column (the deal page's party lines).
export interface PartyGap { key: PartyGapKey; words: string; short: string }

export type CompanyOfferWhy = "lease" | "land_registry" | "default" | "only";

// What the company that signs is, for each party (Woody, 19 November 2026:
// "We must have the company taking the lease or who owns the property to be
// able to do a check").
export const SIGNING_COMPANY_WORDS: Record<DealPartyRole, string> = {
  landlord: "the company that owns the property",
  tenant: "the company taking the lease",
  vendor: "the company selling",
  purchaser: "the company buying",
};

// A CRM name marked as a private client, as the investment import names them
// ("Sandy Macaskill (private)", "Chan family (private client)"). Only a
// suggestion: a person records the party as a private individual (Woody,
// 20 November 2026, after the Kick off AML step asked for "the company
// buying" for Sandy Macaskill).
/**
 * A party recorded as a trust (Jack, 20 November 2026: "Trusts are listed as
 * high risk under our policy, and quite technical"; the vendor on Fortis Green,
 * URC Thames North Trust, read as an ordinary company). Stored as the record's
 * own subject type, crm_companies.aml_subject_type = 'trust'. The checks are
 * KYC4U's in full; a trust needs no company that signs (its trustees sign), and
 * a corporate trustee can still be set as one, so BGP's free checks run on it.
 */
export const isTrustRecord = (subjectType: unknown): boolean => text(subjectType).toLowerCase() === "trust";

/** A name that reads like a trust: a suggestion a person confirms, never applied by itself. */
export const trustMarkInName = (name: unknown): boolean =>
  /\b(trust|trusts|trustees?|settlement|trust corporation)\b/i.test(text(name)) && !/\btrust ?pilot\b/i.test(text(name));

/**
 * A name that reads like a foundation (Woody, 21 November 2026: "Foundations:
 * a trust can be recorded as a trust, but names like Fonden, Stiftung,
 * Stichting or Foundation aren't spotted" ... "Yes go ahead"). A foundation
 * has no shareholders: the regulations treat the people who control it and
 * the people it benefits as its beneficial owners (MLR 2017 reg 6), as for a
 * trust, so BGP treats it as one. A suggestion a person confirms, never
 * applied by itself: a UK charity company called "… Foundation" is not one.
 */
export const foundationMarkInName = (name: unknown, opts: { abroad?: boolean } = {}): boolean => {
  const t = text(name);
  // A company form at the end ("… Foundation Limited", "Foundation Coffee
  // House Ltd") makes it a company, whose owners the register shows.
  if (!t || COMPANY_FORM_AT_END.test(t)) return false;
  // English law has no foundation: "The X Foundation" registered in the UK is
  // a charity company or a charitable trust, read by the register's own rules
  // as it always was. The English word counts only for one registered abroad
  // (Jersey, Guernsey, Liechtenstein, Panama ...), which the caller says.
  return /\b(fondation|fonden|stichting|fundaci[oó]n|fondazione|funda[cç][aã]o|fundacja|nadace|nad[aá]cia)\b|stiftung|stiftelse/i.test(t)
    || (!!opts.abroad && /\bfoundation\b/i.test(t));
};
const COMPANY_FORM_AT_END = /\b(ltd|limited|plc|llp|llc|inc|incorporated|corp|corporation|gmbh|ag|a\/s|aps|ab|oy|sa|sas|sarl|s\.a\.r\.l|spa|s\.p\.a|srl|bv|b\.v|nv|n\.v|kg|lp)\.?$/i;

export const privateMarkInName = (name: unknown): boolean =>
  /\(\s*(?:private(?:\s+(?:client|individual|buyer|purchaser|vendor|seller|investor))?|individual)\s*\)/i.test(String(name ?? ""));

// "if they …", for the private individual suggestion.
export const OWN_NAME_WORDS: Record<DealPartyRole, string> = {
  landlord: "own the property in their own name",
  tenant: "are taking the lease in their own name",
  vendor: "are selling in their own name",
  purchaser: "are buying in their own name",
};

export interface DealPartyView {
  role: DealPartyRole;
  label: string;
  // kind: whether the checks are about a company or a private individual (a
  // person who signs makes it an individual); recordIndividual: the record
  // itself is a private individual; privateMark: its CRM name says private.
  brand: { id: string; name: string; companiesHouseNumber: string | null; kind: "company" | "individual"; recordIndividual?: boolean; privateMark?: boolean;
    // recordTrust: recorded as a trust or foundation (KYC4U in full, enhanced);
    // trustHint: its name, or the company that signs, reads like a trust (Jack,
    // 20 November 2026) or a foundation (foundationHint, 21 November 2026).
    recordTrust?: boolean; trustHint?: boolean; foundationHint?: boolean;
    // A UK public body (shared/aml-sdd.ts): recorded by a person; a name that
    // reads like one is a suggestion. publicBodyKnown: its legal name, when known.
    recordPublicBody?: boolean; publicBodyHint?: boolean; publicBodyKnown?: string | null;
    // A Companies House link on a public body's record naming another company:
    // a mistake, never offered, taken off when it is recorded (25 November 2026).
    wrongCompaniesHouse?: { number: string; name: string } | null;
    // charityHint: a UK party with no company record whose name reads like a
    // charity or foundation: recorded, its register entry is read (21 November 2026).
    charityHint?: boolean };
  // The company that signs, as set on the deal.
  company: DealPartyCompany | null;
  // What to offer when none is set: the company on the unit's lease (a
  // letting's tenant), the brand's default, or its only company.
  offer: (DealPartyCompany & { why: CompanyOfferWhy }) | null;
  // The brand's own registered company, when no company filed under the
  // brand carries its number: offered as one choice, never assumed.
  // registeredOwner: it is also the building's registered owner at Land Registry.
  brandOwn: { name: string; number: string; registeredOwner?: boolean } | null;
  // The building's registered owner at Land Registry (a landlord's or a
  // seller's), when no company filed under the brand is it: added under the
  // brand from Companies House on a press, never assumed (23 November 2026).
  titleOwner?: { name: string; number: string; titleNumber: string | null } | null;
  // Every company filed under the brand.
  companies: DealPartyCompany[];
  // The Xero contact invoices go to.
  xero: { contactId: string; name: string | null } | null;
  // Who the client checks and KYC4U go to: set for this party on the deal,
  // or the deal's client contact when that person is filed under the brand,
  // or the person who signs, when a person does.
  person: (DealPartyPerson & { from: "party" | "client" | "signer"; relation?: AskRelation; firm?: string | null }) | null;
  // The people filed under the brand.
  people: DealPartyPerson[];
  // What stops the checks from starting, in the order to fill it.
  gaps: PartyGap[];
  // BGP's client on the deal, the party it invoices (dealClientRole), and who
  // it is billed as against the company that signs (null for any other party).
  client?: boolean;
  billing?: DealPartyBilling | null;
  // A tenant's or a buyer's guarantors (23 November 2026; shared/deal-guarantor.ts).
  guarantors?: DealGuarantorView[];
  // The other companies (or people) that sign for the party too (24 November 2026; shared/deal-guarantor.ts).
  signers?: DealGuarantorView[];
}

const text = (v: unknown): string => String(v ?? "").replace(/\s+/g, " ").trim();
const number = (v: unknown): string => String(v ?? "").replace(/\s+/g, "").toUpperCase();
export const sameCompaniesHouseNumber = (a: unknown, b: unknown): boolean => {
  const pad = (s: string) => (/^\d+$/.test(s) ? s.padStart(8, "0") : s);
  const x = number(a), y = number(b);
  return !!x && !!y && pad(x) === pad(y);
};

// A registered company name without case, punctuation or its legal form.
const registeredNameKey = (v: unknown): string => text(v).toLowerCase().replace(/&/g, " and ").replace(/['\u2019]/g, "")
  .replace(/[^a-z0-9]+/g, " ").trim().replace(/^the /, "")
  .replace(/\s*\b(limited|ltd|public limited company|plc|llp|limited liability partnership)$/, "").replace(/\s+/g, "");

/** The building's registered owner at Land Registry, as the property's record holds it (the Ownership & KYC tab, 23 November 2026). */
export interface LandRegistryOwner { name: string; number: string | null; titleNumber: string | null }

/** A company filed under the brand that is the building's registered owner: the same number, else the same registered name. */
export function registeredOwnerAmong(companies: DealPartyCompany[], owner: LandRegistryOwner | null | undefined): DealPartyCompany | undefined {
  if (!owner) return undefined;
  return companies.find(c => c.kind !== "individual" && (owner.number && c.companiesHouseNumber
    ? sameCompaniesHouseNumber(c.companiesHouseNumber, owner.number)
    : !!registeredNameKey(owner.name) && registeredNameKey(c.name) === registeredNameKey(owner.name)));
}

/**
 * The company to offer first when the deal names none: the one on the unit's
 * lease, the building's registered owner at Land Registry (a landlord or a
 * seller), the brand's default, or the only one filed.
 */
export function companyOffer(companies: DealPartyCompany[], leaseCompanyId: string | null | undefined, landRegistry?: LandRegistryOwner | null): DealPartyView["offer"] {
  const lease = leaseCompanyId ? companies.find(c => c.id === leaseCompanyId) : undefined;
  if (lease) return { ...lease, why: "lease" };
  const registered = registeredOwnerAmong(companies, landRegistry);
  if (registered) return { ...registered, why: "land_registry" };
  const defaults = companies.filter(c => c.isDefault);
  if (defaults.length === 1) return { ...defaults[0], why: "default" };
  if (companies.length === 1) return { ...companies[0], why: "only" };
  return null;
}

export const OFFER_WORDS: Record<CompanyOfferWhy, string> = {
  lease: "the company on the unit's lease",
  land_registry: "the building's registered owner at Land Registry",
  default: "the brand's main company",
  only: "the only company filed under the brand",
};

/**
 * What stops BGP's checks and the client checks from starting for one party.
 * A company party needs the company that signs set on the deal: the company
 * taking the lease, or the one that owns the property. The brand is usually
 * not it, so its own Companies House record is never assumed (Woody,
 * 19 November 2026; until then a brand with a number counted). Every party
 * needs a person to ask, with an email. Nothing else is asked for here: an
 * individual's date of birth and address are the client checks' to gather.
 */
export function partyGaps(input: {
  role: DealPartyRole;
  kind: "company" | "individual";
  brandName: string;
  companySet: boolean;
  person: { name: string; email: string | null } | null;
  trust?: boolean;
}): PartyGap[] {
  const gaps: PartyGap[] = [];
  if (input.kind === "company" && !input.companySet && !input.trust) {
    const what = SIGNING_COMPANY_WORDS[input.role];
    gaps.push({
      key: "company",
      words: `${what[0].toUpperCase()}${what.slice(1)}: the checks are about it, not ${text(input.brandName) || "the brand"}`,
      short: what.replace(/^the /, ""),
    });
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

/**
 * The CRM contact an owner's details are saved on (Woody, 20 November 2026:
 * "these owners need to AML and prompt for contact details at that stage"):
 * the one filed under the party with the email typed, else the one whose name
 * is theirs (the register's "SURNAME, Forenames" read the way the AML checks
 * read it, `namesMatch`), one with an email first; null to add them.
 */
export function ownerContactMatch<T extends { id: string; name: string; email: string | null }>(
  name: string, email: string | null, contacts: readonly T[], namesMatch: (a: string, b: string) => boolean,
): T | null {
  const want = text(email).toLowerCase();
  if (want) {
    const byEmail = contacts.find(c => text(c.email).toLowerCase() === want);
    if (byEmail) return byEmail;
  }
  const byName = contacts.filter(c => namesMatch(name, c.name));
  return byName.find(c => text(c.email)) || byName[0] || null;
}

/**
 * The people a party's checks need who cannot be reached yet: something still
 * owed, no link of their own, and no contact filed under the party with their
 * name and an email or mobile. The party box asks for their details; the Kick
 * off AML step and the Parties card name them.
 */
export function peopleToReach<P extends { name: string; outstanding: readonly string[]; own: unknown }>(
  people: readonly P[], contacts: readonly DealPartyPerson[], namesMatch: (a: string, b: string) => boolean,
): P[] {
  return people.filter(p => p.outstanding.length > 0 && !p.own && !contacts.some(c => namesMatch(p.name, c.name) && (text(c.email) || text(c.mobile))));
}

/**
 * What the deal's AML status (GET /api/kyc/deal/:id/status) already says
 * about a party: approved and in date, or marked Not required, asks nothing
 * more of anyone; a letting under £10,000 a month asks no one for anything
 * (BGP's AML policy A). null while the status is not read.
 */
export interface PartyAmlFacts { done: "approved" | "not_required" | null; sanctionsOnly: boolean }

export function partyAmlFacts(
  status: { regime?: { regime: string } | null; counterparties: ReadonlyArray<{ id: string; isApproved: boolean; isExpired: boolean; notRequired?: unknown }> } | null | undefined,
  companyId: string | null | undefined,
): PartyAmlFacts | null {
  if (!status || !companyId) return null;
  const cp = status.counterparties.find(c => c.id === companyId);
  return {
    done: cp?.notRequired ? "not_required" : cp && cp.isApproved && !cp.isExpired ? "approved" : null,
    sanctionsOnly: status.regime?.regime === "sanctions_only",
  };
}

const PARTY_AML_QUIET_WORDS = {
  approved: "Approved for AML: nothing more is needed from these people.",
  not_required: "Marked Not required: no checks are needed from these people.",
  sanctions_only: "A letting under £10,000 a month: sanctions checks only (BGP's AML policy A), so nobody is asked for anything.",
} as const;

/** Why nobody is asked for details on this party, or null when they are. */
export function partyAmlQuietWords(aml: PartyAmlFacts | null | undefined): string | null {
  return aml?.done ? PARTY_AML_QUIET_WORDS[aml.done] : aml?.sanctionsOnly ? PARTY_AML_QUIET_WORDS.sanctions_only : null;
}

/**
 * BGP's client on a deal, the party it invoices (Woody, 20 November 2026:
 * "this xero invoicing is not autolinked to the AML deal process thats
 * happening it should be"): the vendor on a sale, the purchaser on a
 * purchase, the tenant on a tenant-side deal (Lease Acquisition, Lease
 * Disposal, BGP acting for the tenant, the Tenant Rep team), else the
 * landlord. The Deals table's Client cell reads the same rule.
 */
export function dealClientRole(deal: { dealType?: string | null; bgpActingFor?: string | null; bgp_acting_for?: string | null; team?: unknown }): DealPartyRole {
  const dt = text(deal.dealType);
  const team = (Array.isArray(deal.team) ? deal.team.join(",") : text(deal.team)).toLowerCase();
  // On a sale or purchase, who BGP acts for is chosen on the transaction
  // (Woody, 25 November 2026: "we are acting for the purchaser here and the
  // app is acting like we are acting automatically for the Vendor").
  const side = text(deal.bgpActingFor ?? deal.bgp_acting_for).toLowerCase();
  if ((side === "vendor" || side === "purchaser") && (dt === "Sale" || dt === "Purchase" || dt === "Investment")) return side;
  if (dt === "Sale") return "vendor";
  if (dt === "Purchase") return "purchaser";
  if (dt === "Lease Acquisition" || dt === "Lease Disposal") return "tenant";
  if (/tenant\s*rep/.test(team) || text(deal.bgpActingFor).toLowerCase() === "tenant") return "tenant";
  return "landlord";
}

export interface InvoiceContact {
  // The party BGP invoices (dealClientRole).
  role: DealPartyRole;
  // The Xero contact the invoice goes to, and where it came from: "deal", the
  // deal's own invoice contact (set on purpose on the deal, or from a
  // scheme's billing entity); "party", the billing entity on BGP's client,
  // set under Parties with the AML checks; null, none yet.
  contactId: string | null;
  name: string | null;
  source: "deal" | "party" | "payer" | "signing" | null;
  // The billing entity on BGP's client, whichever is used.
  party: { contactId: string; name: string } | null;
  // BGP's client is on the deal.
  partyLinked: boolean;
  // A company billed by name (source "payer" or "signing"): its Xero contact
  // is found or made when the invoice is drafted, and kept on the company.
  company?: InvoiceCompany | null;
}

export interface InvoiceCompany { id: string; name: string; companiesHouseNumber?: string | null; xeroContactId?: string | null; xeroContactName?: string | null }

/**
 * Who the deal's invoice goes to in Xero: the deal's own invoice contact when
 * one is set (some invoices go to another company than the party's billing
 * entity: a fund's partnership, a scheme's billing company), else the billing
 * entity on BGP's client from the Parties and AML set-up. Never a name made
 * up from the deal or a brand.
 */
//
// Since 20 November 2026 (Woody: "the company signs is effectively the xero
// billing entity"), with neither set, the invoice goes to the third party the
// deal records as paying for the client, else to the client's company that
// signs: by their own Xero contact when one is kept on the company, else by
// name, the contact found or made when the invoice is drafted.
export function invoiceContactFor(deal: Record<string, any>, extra: { payer?: InvoiceCompany | null; signing?: InvoiceCompany | null } = {}): InvoiceContact {
  const role = dealClientRole(deal);
  const f = DEAL_PARTY_FIELDS[role];
  const partyId = text(deal[f.xeroId]), partyName = text(deal[f.xeroName]);
  const party = partyId && partyName ? { contactId: partyId, name: partyName } : null;
  const partyLinked = !!text(deal[f.brand]);
  const ownId = text(deal.xeroContactId), ownName = text(deal.xeroContactName);
  if (ownId || ownName) return { role, contactId: ownId || null, name: ownName || null, source: "deal", party, partyLinked };
  if (party) return { role, contactId: party.contactId, name: party.name, source: "party", party, partyLinked };
  const company = extra.payer?.name ? { co: extra.payer, source: "payer" as const } : extra.signing?.name ? { co: extra.signing, source: "signing" as const } : null;
  if (company) {
    return { role, contactId: text(company.co.xeroContactId) || null, name: text(company.co.xeroContactName) || company.co.name, source: company.source, party: null, partyLinked, company: company.co };
  }
  return { role, contactId: null, name: null, source: null, party: null, partyLinked };
}
