// The negotiation on a Letting Tracker offer (Woody, 2026-11-12: "the
// negotiation process from receiving first offer needs to be logged so can
// see how the bid evolved all the way up to the point of HOTs").
//
// `unit_offers` holds the bid's CURRENT position. `unit_offer_rounds` holds
// every position it has been through: the tenant's first offer, the
// landlord's counter, the tenant's next offer, and so on. The newest round is
// always the same as the offer row.

// "Closed" is an offer from an earlier letting of the unit: set when the unit
// goes back on the market (server/letting-cycle.ts), never chosen by a person.
export const OFFER_STATUSES = ["Pending", "Negotiating", "Agreed", "Rejected", "Withdrawn", "Closed"] as const;
export type OfferStatus = (typeof OFFER_STATUSES)[number];

// An offer still in play (it can take another round).
export const isOpenOffer = (status: string | null | undefined): boolean =>
  !status || status === "Pending" || status === "Negotiating";

export const ROUND_PARTIES = [
  { key: "tenant", label: "Tenant offer", short: "Tenant" },
  { key: "landlord", label: "Landlord counter", short: "Landlord" },
] as const;
export type RoundParty = (typeof ROUND_PARTIES)[number]["key"];
export const roundPartyLabel = (party: string | null | undefined): string =>
  ROUND_PARTIES.find(p => p.key === party)?.label || "Position";

// The terms a round carries. `key` is the camelCase field on the API and on
// `unit_offers` (drizzle); `column` is the Postgres column on both tables.
export const ROUND_TERM_FIELDS = [
  { key: "rentPa", column: "rent_pa", label: "Rent p.a.", kind: "money" },
  { key: "rentFreeMonths", column: "rent_free_months", label: "Rent free (months)", kind: "number" },
  { key: "termYears", column: "term_years", label: "Term (years)", kind: "number" },
  { key: "breakOption", column: "break_option", label: "Break", kind: "text" },
  { key: "fittingOutContribution", column: "fitting_out_contribution", label: "Capital contribution", kind: "money" },
  { key: "premium", column: "premium", label: "Premium", kind: "money" },
  { key: "turnoverRentPct", column: "turnover_rent_pct", label: "Turnover rent %", kind: "number" },
  { key: "rentReview", column: "rent_review", label: "Rent review", kind: "text" },
  { key: "rentDeposit", column: "rent_deposit", label: "Rent deposit", kind: "text" },
  { key: "incentives", column: "incentives", label: "Other incentives", kind: "text" },
] as const;
export type RoundTermKey = (typeof ROUND_TERM_FIELDS)[number]["key"];
export type RoundTerms = { [K in RoundTermKey]?: number | string | null };

export interface OfferRound extends RoundTerms {
  id: string;
  offerId: string;
  unitId: string;
  roundNo: number;
  party: RoundParty;
  roundDate: string;            // yyyy-mm-dd
  note: string | null;
  createdByName: string | null;
  createdAt: string | null;
  canEdit: boolean;             // the person who logged it, or BGP staff
}

export interface OfferNegotiation {
  offer: {
    id: string; unitId: string; companyId: string | null; companyName: string | null;
    contactName: string | null; offerDate: string; status: OfferStatus;
    agreedAt: string | null; agreedByName: string | null;
    source: string | null; comments: string | null;
  } & RoundTerms;
  rounds: OfferRound[];          // oldest first
  canEdit: boolean;              // may add a round or change the status
  hotsOfferId: string | null;    // the offer the unit's HOTs were generated from, if any
}

const same = (a: unknown, b: unknown): boolean => {
  const blank = (v: unknown) => v === null || v === undefined || v === "";
  if (blank(a) && blank(b)) return true;
  if (typeof a === "number" || typeof b === "number") return Number(a) === Number(b);
  return String(a ?? "").trim() === String(b ?? "").trim();
};

// The terms that differ between two positions (for highlighting what moved).
export function roundChanges(prev: RoundTerms | null | undefined, next: RoundTerms): RoundTermKey[] {
  if (!prev) return [];
  return ROUND_TERM_FIELDS.map(f => f.key).filter(k => !same(prev[k], next[k]));
}

// Net effective rent over the term to the first break (or the whole term):
// headline rent less the rent-free and the capital contribution, spread over
// the years. Returns null when rent or term is missing. Same reading as the
// NER on the Landsec unit page (shared/landsec.ts), kept dependency-free.
export function roundNetEffectiveRent(t: RoundTerms): number | null {
  const rent = Number(t.rentPa), term = Number(t.termYears);
  if (!Number.isFinite(rent) || rent <= 0 || !Number.isFinite(term) || term <= 0) return null;
  const rentFreeYears = (Number(t.rentFreeMonths) || 0) / 12;
  const capital = Number(t.fittingOutContribution) || 0;
  const ner = (rent * Math.max(0, term - rentFreeYears) - capital) / term;
  return Math.round(ner);
}
