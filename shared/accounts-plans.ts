// What a company's filed accounts say it plans: sites to open, sites to
// close, capital spend (Woody, 2026-11-15: "Yes to all on expansion"; item 3
// of docs/expansion-review-2026-11-14.md). The strategic report is read once
// per filing (server/accounts-plans.ts) and the result kept on the company
// under companies_house_data.latestAccountsPlans. This file is the contract
// and the checks: a plan is kept only with the sentence it came from, and
// where the accounts have a text layer that sentence must be in it.

export interface AccountsPlanLine {
  summary: string;          // a few words: "30 new restaurants in FY2026"
  count: number | null;     // sites, when the sentence gives a number
  quote: string;            // the sentence from the report
}

export interface AccountsPlans {
  docId: string | null;
  period: string | null;    // accounts made up to, yyyy-mm-dd
  readAt: string;
  mode: "text" | "scan";    // scan = read from page images, quotes not checkable
  quoteChecked: boolean;
  openings: AccountsPlanLine | null;
  closures: AccountsPlanLine | null;
  capex: AccountsPlanLine | null;
  none: boolean;            // read, and the report states no plan
}

const squash = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim();
const plain = (s: unknown) => squash(s).toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"');

function line(raw: any, text: string | null): AccountsPlanLine | null {
  const summary = squash(raw?.summary).slice(0, 160);
  const quote = squash(raw?.quote).slice(0, 500);
  if (!summary || quote.length < 12 || /^(none|not found|n\/?a|null|unknown)$/i.test(summary)) return null;
  // With a text layer the sentence must be in the accounts, word for word.
  if (text !== null && !plain(text).includes(plain(quote))) return null;
  // A count is kept only when the sentence itself carries that number.
  const n = Number(raw?.count);
  const count = Number.isInteger(n) && n > 0 && n < 5000 && new RegExp(`(^|[^\\d,.])${n.toLocaleString("en-GB").replace(/,/g, ",?")}([^\\d]|$)`).test(quote) ? n : null;
  return { summary, count, quote };
}

/** The model's answer, checked. text = the accounts' own text, or null for a scan. */
export function plansFromAnswer(answer: any, text: string | null): Pick<AccountsPlans, "openings" | "closures" | "capex" | "none"> {
  const openings = line(answer?.openings, text);
  const closures = line(answer?.closures, text);
  const capex = line(answer?.capex, text);
  return { openings, closures, capex, none: !openings && !closures && !capex };
}

/** How much a stated plan counts: in full for 18 months after the year end, half to 30 months, then nothing. */
export function plansWeight(period: unknown, now: Date = new Date()): number {
  const end = Date.parse(String(period || ""));
  if (!Number.isFinite(end)) return 0.5;
  const months = (now.getTime() - end) / (30.4 * 86400000);
  return months <= 18 ? 1 : months <= 30 ? 0.5 : 0;
}

/** "Dec 2025" from a year end. */
export function plansPeriodLabel(period: unknown): string {
  const end = new Date(String(period || ""));
  if (!Number.isFinite(end.getTime())) return "the latest year";
  return end.toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });
}

// The pages worth sending: those that speak of the estate or of spend.
export const PLAN_WORDS_RE = /\b(open(?:ed|ing|ings)?|new (?:sites?|stores?|restaurants?|shops?|pubs?|hotels?|clubs?|gyms?|bakeries|outlets?|locations?|units?)|pipeline|roll[- ]?out|expan(?:d|sion)|clos(?:e|ed|ure|ures|ing)|dispos(?:e|al|als)|capital (?:expenditure|investment)|capex|estate)\b/i;
