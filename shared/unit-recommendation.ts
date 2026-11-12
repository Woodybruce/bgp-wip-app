// The letting transaction recommendation (Woody, 2026-11-12: "we also need
// to provide letting transaction recommendation once the HOTs are issued to
// a tenant").
//
// Once Heads of Terms have gone to the tenant, BGP recommends the transaction
// to the client, and the client's leasing and asset managers decide. The
// form is Landsec's own: the "Land Securities x BGP - Offer template"
// (February 2026) lists what every offer report includes and what BGP must
// comment on. BGP's 2026 strategy for Landsec named the weakness this fixes:
// "ad hoc advice rather than clear recommendations and commentary".
//
// One recommendation per letting (the tracker unit and its current deal).
// BGP and the scheme's joint agent write and issue it; the figures are filled from the agreed offer, the unit and
// the Targeting Brief and can be corrected. After it is issued any change
// raises the version, and a decision given on an earlier version stops
// counting.

// The transaction as recommended: the Offer template's list, in its order.
export const RECOMMENDATION_TERM_FIELDS = [
  { key: "tenant", label: "Tenant", kind: "text", hint: "the trading brand" },
  { key: "tenantWebsite", label: "Tenant's website", kind: "text" },
  { key: "tenantEntity", label: "Tenant entity", kind: "text", hint: "the company taking the lease, if known" },
  { key: "unit", label: "Unit and centre", kind: "text" },
  { key: "areaSqFt", label: "Unit area (sq ft)", kind: "number" },
  { key: "depositGuarantor", label: "Deposit or guarantor", kind: "longtext", hint: "amount, who guarantees, and how a deposit is released" },
  { key: "rentPa", label: "Headline rent a year", kind: "money" },
  { key: "rentPsfWeighted", label: "Rent per sq ft, weighted", kind: "money", hint: "if the unit is zoned or weighted; the overall rate is worked out" },
  { key: "turnoverPct", label: "Turnover rent %", kind: "number" },
  { key: "turnoverProjection", label: "Turnover projection and occupancy cost ratio", kind: "longtext" },
  { key: "rentFreeMonths", label: "Rent free (months)", kind: "number" },
  { key: "capitalContribution", label: "Capital contribution", kind: "money" },
  { key: "otherIncentives", label: "Other incentives", kind: "longtext" },
  { key: "termYears", label: "Term (years)", kind: "number" },
  { key: "breaks", label: "Breaks", kind: "text" },
  { key: "rentReview", label: "Rent review", kind: "text" },
  { key: "use", label: "Use", kind: "text" },
  { key: "handoverSpec", label: "Handover specification", kind: "longtext" },
  { key: "timing", label: "Timing", kind: "longtext", hint: "access, opening, exchange and completion targets" },
  { key: "costs", label: "Costs", kind: "longtext", hint: "landlord's works, fees, anything else the client pays" },
  { key: "conditionality", label: "Conditionality", kind: "longtext" },
] as const;
export type RecommendationTermKey = (typeof RECOMMENDATION_TERM_FIELDS)[number]["key"];
export type RecommendationTerms = { [K in RecommendationTermKey]?: string | number | null };

// What BGP must comment on: the Offer template's commentary list, in its order.
export const RECOMMENDATION_COMMENTARY = [
  { key: "againstErv", label: "The offer against ERV and the business plan", hint: "on a headline and a net effective basis" },
  { key: "improvement", label: "Where the terms could be improved, and to what level" },
  { key: "strategyFit", label: "Whether the use and brand are in line with the leasing strategy" },
  { key: "turnoverView", label: "Our view on the turnover projections" },
  { key: "handover", label: "Handover specification" },
  { key: "conditions", label: "Conditionality" },
  { key: "otherInterest", label: "Further interest and the likelihood of other offers" },
  { key: "nextSteps", label: "Next steps" },
] as const;
export type RecommendationCommentaryKey = (typeof RECOMMENDATION_COMMENTARY)[number]["key"];
export type RecommendationCommentary = { [K in RecommendationCommentaryKey]?: string | null };

export const RECOMMENDATION_OPTIONS = [
  { key: "proceed", label: "Proceed", tone: "good" },
  { key: "proceed_with_conditions", label: "Proceed, subject to conditions", tone: "warn" },
  { key: "do_not_proceed", label: "Do not proceed", tone: "bad" },
] as const;
export type RecommendationOption = (typeof RECOMMENDATION_OPTIONS)[number]["key"];

// One row of comparable evidence (the Leasing Advice template's table).
export interface RecommendationComparable {
  id: string;                       // a client-made id, unique in the list
  transaction: string | null;       // new letting, renewal, regear ...
  date: string | null;              // yyyy-mm-dd or yyyy-mm
  tenant: string | null;
  unit: string | null;              // unit, level, mall and centre
  areaSqFt: number | null;
  use: string | null;
  rentPa: number | null;
  turnoverPct: number | null;
  rentFreeMonths: number | null;
  capitalContribution: number | null;
  termYears: number | null;
  breaks: string | null;
  rentReview: string | null;
  comment: string | null;
  dealId: string | null;            // when it was picked from a deal in the app
}

export const RECOMMENDATION_DECISIONS = [
  { key: "approved", label: "Approved" },
  { key: "query", label: "Query raised" },
  { key: "declined", label: "Declined" },
] as const;
export type RecommendationDecision = (typeof RECOMMENDATION_DECISIONS)[number]["key"];

export interface RecommendationDecider {
  briefPersonId: string;
  role: string;                     // client_leasing | senior_asset_manager | asset_manager
  name: string;
  firm: string | null;
  userId: string | null;
  isMe: boolean;
  decision: RecommendationDecision | null;      // on the CURRENT version only
  comment: string | null;
  decidedAt: string | null;
  decidedByName: string | null;
  recordedOnBehalf: boolean;
  staleDecision: RecommendationDecision | null; // given on an earlier version
}

export interface RecommendationEvent {
  id: string; kind: string; body: string | null; version: number | null;
  authorName: string | null; authorRole: string | null; createdAt: string | null;
}

export type RecommendationStage = "not_ready" | "draft" | "issued" | "approved" | "declined";

// The figures the recommendation is measured against, worked out, not typed.
export interface RecommendationMeasure {
  quotingRentPa: number | null;     // the brief's quoting rent (else the unit's)
  ervPa: number | null;             // the brief's ERV
  nerFloorPa: number | null;        // the brief's net effective floor
  headlinePsf: number | null;       // rent a year / area
  nerPa: number | null;             // net effective rent of the recommended terms
  nerLessFitOutPa: number | null;   // the same after three months' fit-out, as Landsec's template asks
  headlineVsErvPct: number | null;  // headline rent as a percentage of ERV
  nerVsFloorPct: number | null;     // net effective rent as a percentage of the floor
  occupancyCostPa: number | null;   // rent + service charge + rates + insurance
  occupancyCostPsf: number | null;
}

export interface RecommendationWorkspace {
  id: string | null;                // null until BGP starts it
  unit: { id: string; unitName: string; propertyId: string | null; propertyName: string | null; marketingStatus: string | null; dealId: string | null; dealRef: string | null; clientName: string | null };
  stage: RecommendationStage;       // not_ready: no agreed offer yet
  ready: { agreedOffer: boolean; hotsIssued: boolean };
  offer: { id: string; companyName: string | null; offerDate: string; rentPa: number | null } | null;
  version: number;
  terms: RecommendationTerms;
  measure: RecommendationMeasure;
  comparables: RecommendationComparable[];
  rounds: { roundNo: number; party: string; roundDate: string; rentPa: number | null; rentFreeMonths: number | null; termYears: number | null; capitalContribution: number | null; note: string | null }[];
  facts: { onTargetList: boolean; targetPriority: string | null; otherOffers: number; viewingsHeld: number; interestLogged: number; briefAgreed: boolean; hotsIssuedAt: string | null };
  commentary: RecommendationCommentary;
  recommendation: RecommendationOption | null;
  summary: string | null;
  missing: string[];                // what must be filled before it can be issued, in words
  issuedAt: string | null; issuedByName: string | null; issuedVersion: number | null;
  issuedByFirm?: string | null;     // the issuer's firm when a joint agent issued it; null when BGP did
  deciders: RecommendationDecider[];
  approval: { total: number; approved: number; declined: number; complete: boolean };
  decidedAt: string | null;
  events: RecommendationEvent[];    // oldest first
  // isStaff is a BGP login only. canRecord: may record a decision for a
  // decider with no login (BGP, and a joint agent on their scheme).
  // jointAgent: the tenant's website is not sent to them, so its box is not shown.
  viewer: { isStaff: boolean; canEdit: boolean; canIssue: boolean; canDecide: boolean; canRecord?: boolean; jointAgent?: boolean };
}

// What the tracker row and the success monitor need to know.
export interface RecommendationSummary { stage: RecommendationStage; approved: number; total: number; issuedAt: string | null }

const num = (v: unknown): number | null => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

// Net effective rent a year over the term: headline rent less the rent free
// (and, when asked, three further months for fit-out) and the capital
// contribution, spread over the term. Null without a rent and a term.
export function recommendationNer(t: RecommendationTerms, fitOutMonths = 0): number | null {
  const rent = num(t.rentPa), term = num(t.termYears);
  if (rent === null || rent <= 0 || term === null || term <= 0) return null;
  const freeYears = ((num(t.rentFreeMonths) || 0) + fitOutMonths) / 12;
  return Math.round((rent * Math.max(0, term - freeYears) - (num(t.capitalContribution) || 0)) / term);
}

export function recommendationMeasure(
  t: RecommendationTerms,
  brief: { quotingRentPa?: number | null; ervPa?: number | null; nerFloorPa?: number | null; insurancePa?: number | null } | null,
  unit: { askingRent?: number | null; serviceChargePa?: number | null; ratesPa?: number | null },
): RecommendationMeasure {
  const rent = num(t.rentPa), area = num(t.areaSqFt);
  const erv = num(brief?.ervPa), floor = num(brief?.nerFloorPa);
  const ner = recommendationNer(t);
  const costs = [rent, num(unit.serviceChargePa), num(unit.ratesPa), num(brief?.insurancePa)];
  const occupancy = rent === null ? null : costs.reduce<number>((s, v) => s + (v || 0), 0);
  const pct = (a: number | null, b: number | null) => (a !== null && b !== null && b > 0 ? Math.round((a / b) * 1000) / 10 : null);
  return {
    quotingRentPa: num(brief?.quotingRentPa) ?? num(unit.askingRent), ervPa: erv, nerFloorPa: floor,
    headlinePsf: rent !== null && area !== null && area > 0 ? Math.round((rent / area) * 100) / 100 : null,
    nerPa: ner, nerLessFitOutPa: recommendationNer(t, 3),
    headlineVsErvPct: pct(rent, erv), nerVsFloorPct: pct(ner, floor),
    occupancyCostPa: occupancy, occupancyCostPsf: occupancy !== null && area !== null && area > 0 ? Math.round((occupancy / area) * 100) / 100 : null,
  };
}

// What still has to be written before the recommendation can go to the client.
export function recommendationMissing(w: { terms: RecommendationTerms; commentary: RecommendationCommentary; recommendation: string | null; summary: string | null }): string[] {
  const out: string[] = [];
  const has = (v: unknown) => v !== null && v !== undefined && String(v).trim() !== "";
  for (const key of ["tenant", "unit", "rentPa", "termYears", "use"] as const) {
    if (!has(w.terms[key])) out.push(RECOMMENDATION_TERM_FIELDS.find(f => f.key === key)!.label);
  }
  for (const c of RECOMMENDATION_COMMENTARY) if (!has(w.commentary[c.key])) out.push(`Commentary: ${c.label.charAt(0).toLowerCase()}${c.label.slice(1)}`);
  if (!has(w.recommendation)) out.push("The recommendation itself");
  if (!has(w.summary)) out.push("The summary paragraph");
  return out;
}
