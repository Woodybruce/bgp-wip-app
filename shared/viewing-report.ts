import { calendarDateValue } from "./calendar-date";

/** Facts must already be scoped to the caller. Include history before the
 * cohort start so repeat visits cannot become a second opportunity. */
export interface ViewingReportViewing {
  id: string;
  unitId: string | null;
  physicalUnitId?: string | null;
  propertyId?: string | null;
  propertyName?: string | null;
  unitName?: string | null;
  companyId: string | null;
  companyName?: string | null;
  ownerUserId?: string | null;
  team?: string | null;
  viewingDate: string | null;
  status: string | null;
  confirmed: boolean;
  deletedAt?: string | null;
}
export interface ViewingReportOffer {
  id: string;
  unitId: string | null;
  physicalUnitId?: string | null;
  companyId: string | null;
  offerDate: string | null;
  confirmed: boolean;
  deletedAt?: string | null;
}
export interface ViewingConversionOpportunity {
  key: string;
  companyId: string;
  companyName: string | null;
  unitId: string;
  unitName: string | null;
  propertyId: string | null;
  propertyName: string | null;
  ownerUserId: string | null;
  firstViewingDate: string;
  firstOfferDate: string | null;
  viewingIds: string[];
  offerIds: string[];
  repeatViewings: number;
  converted: boolean;
  mature: boolean;
  windowEnds: string;
}
export interface ViewingConversionReport {
  period: { from: string; to: string; asOf: string; conversionWindowDays: number };
  totals: {
    viewings: number; completedViewings: number; pending: number; unresolved: number;
    cancelled: number; noShow: number; notLeasing: number;
    completedOpportunities: number; confirmedOfferOpportunities: number; conversionRate: number | null;
    matureOpportunities: number; matureConvertedOpportunities: number; matureConversionRate: number | null;
    repeatViewings: number;
  };
  coverage: {
    unconfirmedCompleted: number; missingBrand: number; missingUnit: number;
    invalidViewingDate: number; unknownStatus: number; unconfirmedOffers: number;
    missingOfferBrand: number; missingOfferUnit: number; invalidOfferDate: number;
  };
  owners: Array<{ ownerUserId: string | null; completedOpportunities: number; confirmedOfferOpportunities: number; conversionRate: number | null }>;
  opportunities: ViewingConversionOpportunity[];
}

const identity = (value: string | null | undefined) => typeof value === "string" && value.trim() ? value.trim() : null;
const rate = (numerator: number, denominator: number) => denominator ? Math.round(numerator / denominator * 1000) / 10 : null;
const unitKey = (row: { unitId: string | null; physicalUnitId?: string | null }) => identity(row.physicalUnitId) ? `physical:${identity(row.physicalUnitId)}` : identity(row.unitId) ? `tracker:${identity(row.unitId)}` : null;
function opportunityKey(row: { unitId: string | null; physicalUnitId?: string | null; companyId: string | null }) {
  const brand = identity(row.companyId), unit = unitKey(row);
  return brand && unit ? JSON.stringify([brand, unit]) : null;
}
function addDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

/** Day-based conversion: same-day offers count; a genuine offer remains an
 * offer received even when subsequently withdrawn/rejected. Never infer an
 * offer from 'Offer Expected' or match brands from free-text names. */
export function buildViewingReport(input: {
  viewings: ViewingReportViewing[]; offers: ViewingReportOffer[];
  from: string; to: string; asOf: string; conversionWindowDays?: number;
  ownerUserId?: string; team?: string;
}): ViewingConversionReport {
  const { from, to, asOf } = input;
  for (const date of [from, to, asOf]) if (calendarDateValue(date) !== date) throw new Error("Report dates must be valid YYYY-MM-DD calendar dates");
  if (from > to) throw new Error("Report start must not follow report end");
  const conversionWindowDays = input.conversionWindowDays ?? 90;
  if (!Number.isInteger(conversionWindowDays) || conversionWindowDays < 1 || conversionWindowDays > 730) throw new Error("Conversion window must be between 1 and 730 days");
  const report: ViewingConversionReport = {
    period: { from, to, asOf, conversionWindowDays },
    totals: { viewings: 0, completedViewings: 0, pending: 0, unresolved: 0, cancelled: 0, noShow: 0, notLeasing: 0, completedOpportunities: 0, confirmedOfferOpportunities: 0, conversionRate: null, matureOpportunities: 0, matureConvertedOpportunities: 0, matureConversionRate: null, repeatViewings: 0 },
    coverage: { unconfirmedCompleted: 0, missingBrand: 0, missingUnit: 0, invalidViewingDate: 0, unknownStatus: 0, unconfirmedOffers: 0, missingOfferBrand: 0, missingOfferUnit: 0, invalidOfferDate: 0 },
    owners: [], opportunities: [],
  };
  const inRange = (date: string) => date >= from && date <= to;
  const matchesFilter = (row: ViewingReportViewing) => (!input.ownerUserId || row.ownerUserId === input.ownerUserId) && (!input.team || row.team === input.team);
  const viewings = [...new Map(input.viewings.filter(v => !v.deletedAt).map(v => [v.id, v])).values()];
  const offers = [...new Map(input.offers.filter(o => !o.deletedAt).map(o => [o.id, o])).values()];
  const groups = new Map<string, Array<{ row: ViewingReportViewing; date: string }>>();
  for (const row of viewings) {
    const date = calendarDateValue(row.viewingDate);
    // Undated records cannot be allocated to a cohort; expose that gap
    // across the scoped source set instead of silently discarding them.
    if (!date) { if (matchesFilter(row)) report.coverage.invalidViewingDate++; continue; }
    const key = opportunityKey(row);
    if (inRange(date) && matchesFilter(row)) {
      report.totals.viewings++;
      if (row.status === "completed") report.totals.completedViewings++;
      else if (row.status === "scheduled") report.totals.pending++;
      else if (row.status === "cancelled") report.totals.cancelled++;
      else if (row.status === "no_show") report.totals.noShow++;
      else if (row.status === "not_leasing") report.totals.notLeasing++;
      else report.coverage.unknownStatus++;
      if (row.status === "completed" || row.status === "scheduled") {
        if (!row.confirmed || !key) report.totals.unresolved++;
        if (!identity(row.companyId)) report.coverage.missingBrand++;
        if (!unitKey(row)) report.coverage.missingUnit++;
        if (row.status === "completed" && !row.confirmed) report.coverage.unconfirmedCompleted++;
      }
    }
    if (row.status !== "completed" || !key || date > asOf) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push({ row, date });
  }
  const qualifiedOffers = new Map<string, Array<{ row: ViewingReportOffer; date: string }>>();
  for (const row of offers) {
    const date = calendarDateValue(row.offerDate);
    if (!date) { report.coverage.invalidOfferDate++; continue; }
    const key = opportunityKey(row);
    if (inRange(date)) {
      if (!row.confirmed) report.coverage.unconfirmedOffers++;
      if (!identity(row.companyId)) report.coverage.missingOfferBrand++;
      if (!unitKey(row)) report.coverage.missingOfferUnit++;
    }
    if (!row.confirmed || !key || date > asOf) continue;
    if (!qualifiedOffers.has(key)) qualifiedOffers.set(key, []);
    qualifiedOffers.get(key)!.push({ row, date });
  }
  for (const [key, visits] of groups) {
    visits.sort((a, b) => a.date.localeCompare(b.date) || a.row.id.localeCompare(b.row.id));
    const first = visits[0];
    // Establish the first completed visit before applying owner/team or
    // confirmation filters. Otherwise a repeat visit can silently become
    // a fresh cohort after a handover or while earlier data awaits review.
    if (!inRange(first.date) || !first.row.confirmed || !matchesFilter(first.row)) continue;
    const windowEnds = addDays(first.date, conversionWindowDays);
    const conversionOffers = (qualifiedOffers.get(key) || []).filter(o => o.date >= first.date && o.date <= windowEnds).sort((a, b) => a.date.localeCompare(b.date) || a.row.id.localeCompare(b.row.id));
    report.opportunities.push({
      key, companyId: identity(first.row.companyId)!, companyName: first.row.companyName || null,
      unitId: identity(first.row.unitId) || identity(first.row.physicalUnitId)!, unitName: first.row.unitName || null,
      propertyId: first.row.propertyId || null, propertyName: first.row.propertyName || null,
      ownerUserId: first.row.ownerUserId || null, firstViewingDate: first.date,
      firstOfferDate: conversionOffers[0]?.date || null, viewingIds: visits.filter(v => v.row.confirmed).map(v => v.row.id), offerIds: conversionOffers.map(o => o.row.id),
      repeatViewings: visits.filter(v => v.row.confirmed).length - 1, converted: conversionOffers.length > 0,
      mature: windowEnds <= asOf, windowEnds,
    });
  }
  report.opportunities.sort((a, b) => b.firstViewingDate.localeCompare(a.firstViewingDate) || a.key.localeCompare(b.key));
  const mature = report.opportunities.filter(o => o.mature);
  report.totals.completedOpportunities = report.opportunities.length;
  report.totals.confirmedOfferOpportunities = report.opportunities.filter(o => o.converted).length;
  report.totals.conversionRate = rate(report.totals.confirmedOfferOpportunities, report.totals.completedOpportunities);
  report.totals.matureOpportunities = mature.length;
  report.totals.matureConvertedOpportunities = mature.filter(o => o.converted).length;
  report.totals.matureConversionRate = rate(report.totals.matureConvertedOpportunities, mature.length);
  report.totals.repeatViewings = report.opportunities.reduce((total, o) => total + o.repeatViewings, 0);
  const owners = new Map<string | null, ViewingConversionReport["owners"][number]>();
  for (const opportunity of report.opportunities) {
    if (!owners.has(opportunity.ownerUserId)) owners.set(opportunity.ownerUserId, { ownerUserId: opportunity.ownerUserId, completedOpportunities: 0, confirmedOfferOpportunities: 0, conversionRate: null });
    const owner = owners.get(opportunity.ownerUserId)!;
    owner.completedOpportunities++;
    if (opportunity.converted) owner.confirmedOfferOpportunities++;
    owner.conversionRate = rate(owner.confirmedOfferOpportunities, owner.completedOpportunities);
  }
  report.owners = [...owners.values()].sort((a, b) => b.completedOpportunities - a.completedOpportunities || String(a.ownerUserId).localeCompare(String(b.ownerUserId)));
  return report;
}
