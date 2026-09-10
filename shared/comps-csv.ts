// ─────────────────────────────────────────────────────────────────────────
// Leasing-comps CSV export — the comps board's own "Export" button.
//
// It is a SECOND exporter of the same evidence ChatBGP's export_to_excel
// ships, and it used to disagree with the board it exports: the board's
// headline green "Net Effective" column is the SERVER devaluation
// (`devaluation` attached to every /api/crm/comps row), while the CSV only
// carried the separate hand-typed `netEffectiveRent` field. On a comp whose
// package the app had devalued but nobody had typed a figure into — the
// normal case — the exported "Net Effective Rent" column was BLANK next to a
// board showing a number. "Net psf" (`effectiveRatePsf`) was on screen and
// absent from the file altogether.
//
// Pure and dependency-free so the export can be asserted against the same
// devaluation the board renders (qa/comps-csv-check.ts).
// ─────────────────────────────────────────────────────────────────────────

export interface CompCsvDevaluation {
  netEffectiveRentPa: number;
  netEffectiveRentPsf: number | null;
}

export interface CompCsvRow {
  name?: string | null;
  tenant?: string | null;
  landlord?: string | null;
  areaLocation?: string | null;
  postcode?: string | null;
  useClass?: string | null;
  transactionType?: string | null;
  completionDate?: string | null;
  headlineRent?: string | null;
  zoneARate?: string | null;
  overallRate?: string | null;
  netEffectiveRent?: string | null;
  effectiveRatePsf?: string | null;
  niaSqft?: string | null;
  giaSqft?: string | null;
  itzaSqft?: string | null;
  rentFreeMonths?: string | null;
  rentFree?: string | null;
  fitoutContribution?: string | null;
  term?: string | null;
  breakClause?: string | null;
  ltActStatus?: string | null;
  measurementStandard?: string | null;
  sourceEvidence?: string | null;
  contactName?: string | null;
  verified?: boolean | null;
  comments?: string | null;
  devaluation?: CompCsvDevaluation | null;
}

export const COMPS_CSV_HEADERS = [
  "Property", "Tenant", "Landlord", "Area", "Postcode", "Use Class", "Transaction Type",
  "Date", "Headline Rent", "Zone A Rate",
  // The board's own green column, in the same place it sits on screen.
  "Net Effective Rent (devalued £ pa)", "Net Effective Rent (devalued £ psf)",
  "Overall Rate", "Net Effective Rent", "Net Effective Rate (psf)",
  "NIA (sqft)", "GIA (sqft)", "ITZA (sqft)", "Rent Free (mths)", "Tenant Incentive",
  "Term (yrs)", "Break", "L&T Act", "Measurement Standard",
  "Source", "Contact", "Verified", "Comments",
];

export function compsCsvRow(c: CompCsvRow): (string | number | null | undefined)[] {
  const dv = c.devaluation || null;
  return [
    c.name, c.tenant, c.landlord, c.areaLocation, c.postcode, c.useClass, c.transactionType,
    c.completionDate, c.headlineRent, c.zoneARate,
    dv ? Math.round(dv.netEffectiveRentPa) : "",
    dv && dv.netEffectiveRentPsf != null ? dv.netEffectiveRentPsf : "",
    c.overallRate, c.netEffectiveRent, c.effectiveRatePsf,
    c.niaSqft, c.giaSqft, c.itzaSqft, c.rentFreeMonths ?? c.rentFree, c.fitoutContribution,
    c.term, c.breakClause, c.ltActStatus, c.measurementStandard,
    c.sourceEvidence, c.contactName, c.verified ? "Yes" : "No", c.comments,
  ];
}

// `?? ""` not `|| ""` — a recorded 0 (nil rent free, nil incentive) is a fact
// about the deal and used to export as an empty cell.
const cell = (v: string | number | null | undefined) =>
  `"${(v ?? "").toString().replace(/"/g, '""')}"`;

export function compsCsv(comps: CompCsvRow[]): string {
  // Excel reads a CSV as the machine's ANSI codepage unless a UTF-8 BOM says
  // otherwise, so "Café Nero" arrived as "CafÃ© Nero".
  // Header names are quoted too — one of them carrying a comma would
  // otherwise silently widen the header row past the data rows.
  return "﻿" + [
    COMPS_CSV_HEADERS.map(cell).join(","),
    ...comps.map(c => compsCsvRow(c).map(cell).join(",")),
  ].join("\n");
}
