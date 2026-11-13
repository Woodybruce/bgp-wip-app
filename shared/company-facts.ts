// The facts a Company checks card states about a company, worked out from
// records already held: the stored Companies House record on the company and
// the covenant report the card has loaded. Nothing here asks for anything.
// Every line is public register data or part of the report the viewer has
// already been sent, so it is the same for BGP staff and a client login.
// A line is drawn only when its fact is held; a fact not held is left out,
// never guessed.
import { displayTicker } from "./stock-ticker";

type FactsCompany = {
  companies_house_number?: string | null;
  companies_house_data?: any;
  stock_ticker?: string | null;
  last_accounts_made_up_to?: string | Date | null;
  last_accounts_storage_key?: string | null;
  annual_report_storage_key?: string | null;
};
type FactsReport = { signals?: Record<string, any> | null } | null | undefined;

export type CompanyFactLine = { key: string; text: string; warn?: boolean };
export type CompanyFactRow = { key: string; label: string; value: string; warn?: boolean };

const TYPE_WORDS: Record<string, string> = {
  plc: "Public limited company",
  ltd: "Private limited company",
  llp: "Limited liability partnership",
  "private-unlimited": "Private unlimited company",
  "private-limited-guarant-nsc": "Private company limited by guarantee",
  "private-limited-guarant-nsc-limited-exemption": "Private company limited by guarantee",
  "limited-partnership": "Limited partnership",
  "oversea-company": "Overseas company",
  "uk-establishment": "UK establishment of an overseas company",
};

const profileOf = (company: FactsCompany) => (company.companies_house_data && typeof company.companies_house_data === "object" ? company.companies_house_data.profile : null) || {};

/** True for a public limited company on the stored Companies House record. */
export function isPlcRecord(company: FactsCompany): boolean {
  return String(profileOf(company).companyType || "").trim().toLowerCase() === "plc";
}

function isoDay(value: unknown): string | null {
  if (!value) return null;
  const time = value instanceof Date ? value.getTime() : Date.parse(String(value));
  return Number.isFinite(time) ? new Date(time).toISOString().slice(0, 10) : null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function ukDay(value: unknown): string | null {
  const iso = isoDay(value);
  if (!iso) return null;
  const [year, month, day] = iso.split("-").map(Number);
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

// A figure read from filed accounts is kept as the text it was read as
// ("£2,151m"). Early reads stored "not found": only text with a digit counts.
function figure(value: unknown): string | null {
  const text = value == null ? "" : String(value).trim();
  return text && /\d/.test(text) && text.length <= 40 ? text : null;
}

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

// The period the accounts figures are for. The stored "period" on an
// extraction can be a date cut to its weekday and month ("Sat Dec 27", no
// year), so it is used only when it is a full date; otherwise the company's
// own last-accounts date stands, unless the cut text names another day, in
// which case no date is claimed.
function accountsPeriod(company: FactsCompany, accounts: any): string | null {
  const stored = String(accounts?.period || "").trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(stored)) return isoDay(stored);
  const own = isoDay(company.last_accounts_made_up_to) || isoDay(profileOf(company).lastAccountsMadeUpTo);
  const cut = stored.match(/^[A-Z][a-z]{2} ([A-Z][a-z]{2}) (\d{1,2})$/);
  if (own && cut) {
    const [, month, day] = own.split("-").map(Number);
    if (MONTHS[month - 1] !== cut[1] || day !== Number(cut[2])) return null;
  }
  return own;
}

/** Officers held on the stored record who are serving directors. */
export function servingDirectors(company: FactsCompany): number | null {
  const officers = company.companies_house_data?.officers;
  if (!Array.isArray(officers) || !officers.length) return null;
  return officers.filter((officer: any) => !officer?.resignedOn && /director/i.test(String(officer?.officerRole || ""))).length;
}

export type CheckRow = { key: "ch" | "psc" | "accounts" | "annual_report"; label: string; done: boolean; note?: string };

// The "Checks run" rows that are decided by the stored records alone (the
// covenant row is decided by the report and is added by the card).
// - Officers + PSCs: ticked when PSC entries are held, or when officers are
//   held and the PSC register was read and is empty, or the company is a plc
//   (a listed plc has no registrable person with significant control, so the
//   row could never tick for one).
// - Annual report: applies to a plc, or to any company with a stored annual
//   report. For a plc the group accounts filed at Companies House are its
//   annual report and accounts, so held accounts tick it.
// landlord: the landlord card's annual report row is its own scraped annual
// report, drawn for every landlord and ticked only by that stored file.
export function recordCheckRows(company: FactsCompany, landlord = false): CheckRow[] {
  const ch = (company.companies_house_data && typeof company.companies_house_data === "object" ? company.companies_house_data : null) || {};
  const plc = isPlcRecord(company);
  const officersHeld = Array.isArray(ch.officers) && ch.officers.length > 0;
  const pscsHeld = Array.isArray(ch.pscs) && ch.pscs.length > 0;
  const pscRegisterRead = ch.fetchStatus?.pscs === "ok";
  const pscDone = pscsHeld || (officersHeld && (pscRegisterRead || plc));
  const directors = servingDirectors(company);
  const pscNote = !pscDone ? undefined : [
    directors ? `${directors} serving director${directors === 1 ? "" : "s"}` : null,
    pscsHeld ? null : plc ? "public company, no PSCs on the register" : "no PSCs on the register",
  ].filter(Boolean).join(" · ") || undefined;
  const storedReport = !!company.annual_report_storage_key;
  const filedAsReport = !landlord && !storedReport && plc && !!company.last_accounts_storage_key;
  return [
    { key: "ch", label: "Companies House profile", done: !!company.companies_house_number },
    { key: "psc", label: "Officers + PSCs", done: pscDone, note: pscNote },
    { key: "accounts", label: "Latest accounts", done: !!company.last_accounts_storage_key },
    ...(landlord || plc || storedReport ? [{
      key: "annual_report" as const,
      label: filedAsReport ? "Annual report and accounts" : "Annual report (PLC)",
      done: storedReport || filedAsReport,
      note: filedAsReport ? "as filed at Companies House" : undefined,
    }] : []),
  ];
}

export function companyFacts(company: FactsCompany, report?: FactsReport): { summary: CompanyFactLine[]; rows: CompanyFactRow[] } {
  const profile = profileOf(company);
  const signals = (report && report.signals) || {};
  const summary: CompanyFactLine[] = [];
  const rows: CompanyFactRow[] = [];

  const typeWords = TYPE_WORDS[String(profile.companyType || "").trim().toLowerCase()] || null;
  const status = String(profile.companyStatus || signals.status || "").trim().toLowerCase();
  const statusWords = status ? status.charAt(0).toUpperCase() + status.slice(1).replace(/-/g, " ") : null;
  const incorporated = isoDay(profile.dateOfCreation);
  const ticker = String(company.stock_ticker || "").trim() ? displayTicker(String(company.stock_ticker)) : null;

  const identity = [
    typeWords,
    incorporated ? `Incorporated ${incorporated.slice(0, 4)}` : null,
    ticker ? `Listed ${ticker}` : null,
    status && status !== "active" ? statusWords : null,
  ].filter(Boolean) as string[];
  if (identity.length) summary.push({ key: "identity", text: identity.join(" · "), warn: !!status && status !== "active" });

  if (typeWords) rows.push({ key: "type", label: "Type", value: typeWords });
  if (statusWords) rows.push({ key: "status", label: "Status", value: statusWords, warn: status !== "active" });
  if (incorporated) rows.push({ key: "incorporated", label: "Incorporated", value: ukDay(incorporated)! });
  if (ticker) rows.push({ key: "listed", label: "Listed", value: ticker });
  const office = profile.registeredOfficeAddress || profile.registered_office_address;
  if (office && typeof office === "object") {
    const text = ["premises", "address_line_1", "address_line_2", "locality", "region", "postal_code"]
      .map(part => String(office[part] || "").trim()).filter(Boolean).join(", ");
    if (text) rows.push({ key: "office", label: "Registered office", value: text });
  }
  if (Array.isArray(profile.sicCodes) && profile.sicCodes.length) {
    rows.push({ key: "sic", label: "Nature of business (SIC)", value: profile.sicCodes.map(String).join(", ") });
  }

  // Accounts figures: the covenant report's first (it is what the grade was
  // worked out from), the company's own read of its filed accounts otherwise.
  const own = company.companies_house_data?.latestAccountsExtracted || null;
  const fromReport = signals.accounts && (figure(signals.accounts.turnover) || figure(signals.accounts.profitBeforeTax) || figure(signals.accounts.netAssets) || figure(signals.accounts.cash));
  const accounts = fromReport ? signals.accounts : own;
  const turnover = figure(accounts?.turnover);
  const profit = figure(accounts?.profitBeforeTax);
  const netAssets = figure(accounts?.netAssets);
  const cash = figure(accounts?.cash);
  const employees = accounts === own ? figure(own?.employees) : null;
  const anyFigure = turnover || profit || netAssets || cash;
  const period = anyFigure ? accountsPeriod(company, accounts) : isoDay(company.last_accounts_made_up_to) || isoDay(profile.lastAccountsMadeUpTo);
  if (turnover || profit) {
    const figures = [turnover ? `turnover ${turnover}` : null, profit ? `profit before tax ${profit}` : null].filter(Boolean).join(" · ");
    summary.push({ key: "accounts", text: `${period ? `Year to ${ukDay(period)}` : "Latest filed accounts"}: ${figures}` });
  }
  if (period) rows.push({ key: "period", label: "Latest accounts made up to", value: ukDay(period)! });
  if (turnover) rows.push({ key: "turnover", label: "Turnover", value: turnover });
  if (profit) rows.push({ key: "profit", label: "Profit before tax", value: profit });
  if (netAssets) rows.push({ key: "net_assets", label: "Net assets", value: netAssets });
  if (cash) rows.push({ key: "cash", label: "Cash", value: cash });
  if (employees) rows.push({ key: "employees", label: "Employees", value: employees });

  // Filing status: stated only when the register's own flag is held.
  const accountsOverdue = typeof signals.accountsOverdue === "boolean" ? signals.accountsOverdue
    : typeof profile.accountsOverdue === "boolean" ? profile.accountsOverdue : null;
  const confirmationOverdue = typeof profile.confirmationStatementOverdue === "boolean" ? profile.confirmationStatementOverdue : null;
  const late = [accountsOverdue ? "accounts" : null, confirmationOverdue ? "confirmation statement" : null].filter(Boolean) as string[];
  if (late.length) {
    const text = late.join(" and ");
    summary.push({ key: "filing", text: `${text.charAt(0).toUpperCase()}${text.slice(1)} overdue at Companies House`, warn: true });
  } else if (accountsOverdue === false && confirmationOverdue === false) {
    summary.push({ key: "filing", text: "Accounts and confirmation statement up to date" });
  } else if (accountsOverdue === false) {
    summary.push({ key: "filing", text: "Accounts up to date" });
  }
  const nextDue = isoDay(signals.nextAccountsDue);
  if (accountsOverdue) rows.push({ key: "accounts_due", label: "Accounts", value: "Overdue at Companies House", warn: true });
  else if (nextDue) rows.push({ key: "accounts_due", label: "Next accounts due", value: ukDay(nextDue)! });
  else if (accountsOverdue === false) rows.push({ key: "accounts_due", label: "Accounts", value: "Up to date" });
  if (confirmationOverdue !== null) rows.push({ key: "confirmation", label: "Confirmation statement", value: confirmationOverdue ? "Overdue at Companies House" : "Up to date", warn: confirmationOverdue });

  const charges = count(signals.outstandingCharges);
  if (charges !== null) rows.push({ key: "charges", label: "Charges outstanding", value: charges ? String(charges) : "None" });
  else if (profile.hasCharges === false) rows.push({ key: "charges", label: "Charges", value: "None registered" });
  const insolvency = count(signals.insolvencyCases);
  if (insolvency) rows.push({ key: "insolvency", label: "Insolvency", value: `${insolvency} case${insolvency === 1 ? "" : "s"} recorded`, warn: true });
  else if (insolvency === 0 || profile.hasInsolvencyHistory === false) rows.push({ key: "insolvency", label: "Insolvency", value: "None recorded" });
  else if (profile.hasInsolvencyHistory === true) rows.push({ key: "insolvency", label: "Insolvency", value: "History recorded at Companies House", warn: true });
  if (signals.gazetteChecked === true && Array.isArray(signals.gazetteNotices)) {
    const notices = signals.gazetteNotices.length;
    rows.push({ key: "gazette", label: "Gazette insolvency notices", value: notices ? String(notices) : "None found", warn: notices > 0 });
  }
  // The stored officers first, so this count matches the Officers + PSCs row above it.
  const directors = servingDirectors(company) || count(signals.directorRisk?.activeDirectors);
  if (directors) rows.push({ key: "directors", label: "Serving directors", value: String(directors) });
  const pay = signals.paymentPractices;
  const payDays = count(pay?.avgDays) === null ? null : Math.round(pay.avgDays);
  const payLate = count(pay?.pctLate) === null ? null : Math.round(pay.pctLate);
  if (payDays !== null || payLate !== null) {
    rows.push({ key: "payment", label: "Supplier payment", value: [payDays !== null ? `${payDays} days on average` : null, payLate !== null ? `${payLate}% paid late` : null].filter(Boolean).join(" · ") });
  }
  return { summary, rows };
}
