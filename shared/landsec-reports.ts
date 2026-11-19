// Landsec reports (Woody, 2026-11-19, after a call with Mark Warne at
// Landsec: the reports Landsec takes from VTS should come from the app.
// "go ahead"; "quarters just have ability to pick one or several months";
// who runs them: "yes landsec and BGP").
//
// Two things live here, and nowhere else:
//  1. THE PERIOD RULE: one or several whole months, From and To inclusive.
//  2. THE REPORT REGISTRY: every report the Reports page offers. A new report
//     (the quarterly board pack comes next) is one more entry here plus its
//     builder in server/landsec-reports.ts.
//
// Pure: no database, no request. Tests: shared/landsec-reports.test.ts.

export const REPORT_MAX_MONTHS = 36;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

export interface ReportPeriod {
  /** First month, YYYY-MM. */
  from: string;
  /** Last month, YYYY-MM (inclusive). */
  to: string;
  /** The first day of the first month, YYYY-MM-DD (inclusive). */
  start: string;
  /** The first day of the month after the last, YYYY-MM-DD (exclusive). */
  end: string;
  /** How many months the period holds. */
  months: number;
  /** "Oct 2026", "Aug to Oct 2026", "Nov 2025 to Jan 2026". */
  label: string;
}

const monthIndex = (ym: string): number | null => {
  const m = MONTH_RE.exec(String(ym || "").trim());
  return m ? Number(m[1]) * 12 + (Number(m[2]) - 1) : null;
};
const monthOfIndex = (index: number): string => `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;

/** The London month a moment falls in, YYYY-MM. */
export function londonMonth(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit" }).formatToParts(now);
  return `${parts.find(p => p.type === "year")!.value}-${parts.find(p => p.type === "month")!.value}`;
}

/** The default: the last three whole months before the one we are in. */
export function defaultReportMonths(now: Date = new Date()): { from: string; to: string } {
  const current = monthIndex(londonMonth(now))!;
  return { from: monthOfIndex(current - 3), to: monthOfIndex(current - 1) };
}

export function reportPeriodLabel(from: string, to: string): string {
  const a = monthIndex(from), b = monthIndex(to);
  if (a === null || b === null) return "";
  const name = (i: number) => MONTHS[i % 12];
  const year = (i: number) => Math.floor(i / 12);
  if (a === b) return `${name(a)} ${year(a)}`;
  if (year(a) === year(b)) return `${name(a)} to ${name(b)} ${year(b)}`;
  return `${name(a)} ${year(a)} to ${name(b)} ${year(b)}`;
}

export type ReportPeriodResult = { ok: true; period: ReportPeriod } | { ok: false; error: string };

/**
 * The period a report covers. From and To are months (YYYY-MM), both
 * inclusive. With neither given it is the last three whole months; with one
 * given it is that one month. A month that is not a month, a To before its
 * From, or more than 36 months is refused.
 */
export function parseReportPeriod(fromIn: unknown, toIn: unknown, now: Date = new Date()): ReportPeriodResult {
  let from = typeof fromIn === "string" ? fromIn.trim() : "";
  let to = typeof toIn === "string" ? toIn.trim() : "";
  if (!from && !to) ({ from, to } = defaultReportMonths(now));
  else if (!from) from = to;
  else if (!to) to = from;
  const a = monthIndex(from), b = monthIndex(to);
  if (a === null || b === null) return { ok: false, error: "Give each month as a year and a month, for example 2026-10." };
  if (b < a) return { ok: false, error: "The last month is before the first. Swap them, or pick the same month for both." };
  const months = b - a + 1;
  if (months > REPORT_MAX_MONTHS) return { ok: false, error: `A report covers at most ${REPORT_MAX_MONTHS} months. Pick a shorter period.` };
  return { ok: true, period: { from, to, start: `${from}-01`, end: `${monthOfIndex(b + 1)}-01`, months, label: reportPeriodLabel(from, to) } };
}

/** Whether a date (a Date, an ISO string or YYYY-MM-DD) falls in the period, by its London day. */
export function inReportPeriod(value: unknown, period: Pick<ReportPeriod, "start" | "end">): boolean {
  const day = reportDay(value);
  return !!day && day >= period.start && day < period.end;
}

/** A calendar day, YYYY-MM-DD, of a stored date: a plain day stays as it is, a moment is read in London. */
export function reportDay(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value === "string") {
    const plain = /^(\d{4}-\d{2}-\d{2})(?:$|T00:00:00(?:\.0+)?Z?$)/.exec(value.trim());
    if (plain) return plain[1];
  }
  const d = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

// ── The registry ─────────────────────────────────────────────────────────

export type LandsecReportFormat = "xlsx" | "pdf";
export interface LandsecReportDef {
  key: string;
  title: string;
  /** One or two plain sentences for the card. */
  description: string;
  format: LandsecReportFormat;
  /** "schemes" = every scheme ticked; "one" = one scheme, picked on the card. */
  schemes: "schemes" | "one";
  /** How the period is used, in words for the card. */
  period: string;
  /** Anything the report does not hold, said on the card. */
  note?: string;
  /** "board" = one of the two files of the board report, which the page draws as one card at the head of the list. */
  card?: "board";
}

export const LANDSEC_REPORTS: readonly LandsecReportDef[] = [
  // The board report (Woody, 2026-11-19): the document Landsec presents each
  // quarter, and the figures behind it. Its rules are shared/landsec-board-report.ts.
  {
    key: "board-report", title: "Board report", format: "pdf", schemes: "schemes", card: "board",
    description: "The document to present: headlines, letting activity by scheme and by brief category, rental growth, deal speed, brand engagements and the market report.",
    period: "Lettings, Heads of Terms, new instructions, viewings and offers dated in the period. Occupancy, live lettings and brand stages are as recorded today.",
    note: "It holds what is recorded in ChatBGP. A letting Landsec did without BGP is in it only if it is on the app. A market report section prints only once it has been saved.",
  },
  {
    key: "board-report-figures", title: "Board report figures", format: "xlsx", schemes: "schemes", card: "board",
    description: "The figures behind the board report, one sheet per section, with every letting, viewing count and brand line it was worked out from.",
    period: "The same period and rules as the board report.",
  },
  {
    key: "tenancy-schedule", title: "Tenancy schedule", format: "xlsx", schemes: "schemes",
    description: "Every unit at each scheme as its property page lists it: unit, floor, brand, lease name, size, passing rent, ERV, lease dates, occupancy and letting stage.",
    period: "As recorded today. The period is shown for reference only.",
  },
  {
    key: "leasing-activity", title: "Leasing activity", format: "xlsx", schemes: "schemes",
    description: "The live lettings from the deal clock, and the deals that changed stage in the period: stage, days at stage, who it is waiting on, rents, brief check and the dates held.",
    period: "Live lettings today, plus every deal that changed stage in the period.",
  },
  {
    key: "leasing-activity-pdf", title: "Leasing activity (formatted)", format: "pdf", schemes: "schemes",
    description: "The same leasing activity as a formatted document, scheme by scheme, ready to send on.",
    period: "Live lettings today, plus every deal that changed stage in the period.",
  },
  {
    key: "space-activity", title: "Space activity", format: "xlsx", schemes: "schemes",
    description: "The lease roll: expiries and breaks by year, each unit with any letting running on it.",
    period: "Every lease event on record. Events that fall in the period are marked.",
  },
  {
    key: "tour-activity", title: "Tour activity", format: "xlsx", schemes: "schemes",
    description: "Viewings: date, scheme, unit, brand, status, outcome and follow-up.",
    period: "Viewings dated in the period.",
  },
  {
    key: "requirements", title: "Requirements", format: "xlsx", schemes: "schemes",
    description: "Open leasing requirements: brand, use, size and places wanted, and what each record is.",
    period: "Open requirements as recorded today. Requirements are not held by scheme.",
  },
  {
    key: "comps", title: "Comps", format: "xlsx", schemes: "schemes",
    description: "Leasing comparables recorded at the schemes: tenant, size, rents, incentives, term and date.",
    period: "Every comparable at the schemes. Those completed in the period are marked.",
  },
  {
    key: "asset-profile", title: "Asset profile", format: "pdf", schemes: "one",
    description: "One scheme on a page or two: its facts, occupancy, trading units by brief category, the lease roll by year and the live lettings by stage.",
    period: "As recorded today.",
  },
  {
    key: "portfolio", title: "Portfolio", format: "xlsx", schemes: "schemes",
    description: "One workbook: Assets, Deals, Spaces, Tenants, and Lease terms and options.",
    period: "As recorded today.",
    note: "No budgets: the app does not hold them, so there is no Budgets sheet.",
  },
];

export const landsecReportByKey = (key: unknown): LandsecReportDef | null =>
  LANDSEC_REPORTS.find(r => r.key === String(key || "")) || null;

/** The file a report downloads as: "Landsec Tenancy schedule - Aug to Oct 2026.xlsx". */
export function landsecReportFileName(def: Pick<LandsecReportDef, "title" | "format">, period: Pick<ReportPeriod, "label">, schemeName?: string | null): string {
  const clean = (s: string) => s.replace(/[^A-Za-z0-9 ._&'()-]/g, " ").replace(/\s+/g, " ").trim();
  const title = clean(def.title.replace(/\s*\(formatted\)\s*$/i, ""));
  const place = schemeName ? ` ${clean(schemeName)}` : "";
  return `Landsec${place} ${title} - ${period.label}.${def.format}`;
}

/** What the page is sent before anything is exported (GET /api/landsec/reports). */
export interface LandsecReportsIndex {
  schemes: Array<{ key: string; name: string; group: string }>;
  reports: readonly LandsecReportDef[];
  defaultPeriod: { from: string; to: string };
  maxMonths: number;
}
