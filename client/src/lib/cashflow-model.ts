// Shared cashflow-forecast model + fetch helpers, used by the Cashflow
// board (/cashflow) and the Finance page's forecasting section. Only the
// input lines are stored server-side; totals, the per-basis opening-balance
// chain and closing balances are computed here (equity/admin gate only —
// the early password layer was removed on Woody's instruction).
import { getAuthHeaders } from "@/lib/queryClient";

export interface CashflowLine { id: string; key: string; label: string; section: "receipts" | "payments" | "balance"; sort: number }
export interface CashflowCell { line_id: string; month: string; basis: "budget" | "actual"; amount: number }
export interface CashflowXero {
  asAt?: string; orgName?: string; cashTotal: number | null;
  fytdIncome?: number | null;
  fytdExpenses?: number | null;
  bankAccounts: Array<{ name: string; balance: number }>;
  monthly: Array<{ month: string; income: number; expenses: number; netProfit: number }>;
  arByMonth?: Record<string, number>;
  apByMonth?: Record<string, number>;
  recurringBills?: number | null;
  costRunRate?: number | null;
}
export interface CashflowDeals {
  byMonth: Record<string, { weighted: number; count: number }>;
  undated: { weighted: number; count: number };
  byStage?: Record<string, { weighted: number; unweighted: number; count: number }>;
}
export interface CommissionOutlook {
  fyStart: string;
  earned: number;
  payable: number;
  awaiting: number;
  projectedForward: number;
  projectedFyTotal: number;
  byAgent: Array<{ agent: string; salary: number | null; billings: number; forwardBillings: number; earned: number; projectedForward: number }>;
  missingSplits?: { count: number; fee: number };
}
export interface CashflowData { lines: CashflowLine[]; cells: CashflowCell[]; months: string[]; xero: CashflowXero | null; deals: CashflowDeals | null; commissionOutlook?: CommissionOutlook | null }

export async function cashflowFetch(method: string, url: string, body?: unknown): Promise<Response> {
  const headers: Record<string, string> = { ...getAuthHeaders() };
  if (body) headers["Content-Type"] = "application/json";
  const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined, credentials: "include" });
  if (!res.ok) throw new Error((await res.text()) || res.statusText);
  return res;
}

export const CASHFLOW_MONTH_LABEL = (m: string) => {
  const [y, mm] = m.split("-");
  return `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][parseInt(mm, 10) - 1]} ${y.slice(2)}`;
};

export function fmtCashflow(n: number | undefined | null): string {
  if (n === undefined || n === null) return "";
  if (n === 0) return "-";
  const abs = Math.abs(n).toLocaleString("en-GB", { maximumFractionDigits: 0 });
  return n < 0 ? `(${abs})` : abs;
}

export interface MonthTotals { rec: number; pay: number; open: number; close: number; reserve: number | undefined; all: number }
export interface CashflowModel {
  receipts: CashflowLine[];
  payments: CashflowLine[];
  openLine: CashflowLine | null;
  reserveLine: CashflowLine | null;
  months: string[];
  get: (lineId: string, month: string, basis: string) => number | undefined;
  totals: Record<string, Record<"budget" | "actual", MonthTotals>>;
  hasActual: (month: string) => boolean;
}

export function buildCashflowModel(data: CashflowData): CashflowModel {
  const { lines, cells, months } = data;
  const cellMap = new Map<string, number>();
  for (const c of cells) cellMap.set(`${c.line_id}|${c.month}|${c.basis}`, Number(c.amount));
  const get = (lineId: string, month: string, basis: string) => cellMap.get(`${lineId}|${month}|${basis}`);
  const receipts = lines.filter(l => l.section === "receipts");
  const payments = lines.filter(l => l.section === "payments");
  const openLine = lines.find(l => l.key === "OPEN") || null;
  const reserveLine = lines.find(l => l.key === "RESERVE") || null;

  const totals: CashflowModel["totals"] = {};
  for (const basis of ["budget", "actual"] as const) {
    let opening = openLine ? months.map(m => get(openLine.id, m, basis)).find(v => v !== undefined) ?? 0 : 0;
    const firstOpenMonth = openLine ? months.find(m => get(openLine.id, m, basis) !== undefined) : undefined;
    for (const m of months) {
      if (openLine && firstOpenMonth && m === firstOpenMonth) opening = get(openLine.id, m, basis)!;
      const rec = receipts.reduce((s, l) => s + (get(l.id, m, basis) || 0), 0);
      const pay = payments.reduce((s, l) => s + (get(l.id, m, basis) || 0), 0);
      const close = opening + rec + pay;
      const reserve = reserveLine ? get(reserveLine.id, m, basis) : undefined;
      (totals[m] ||= {} as any)[basis] = { rec, pay, open: opening, close, reserve, all: close + (reserve || 0) };
      opening = close;
    }
  }
  const hasActual = (month: string) =>
    [...receipts, ...payments].some(l => get(l.id, month, "actual") !== undefined);
  return { receipts, payments, openLine, reserveLine, months, get, totals, hasActual };
}

// Map a Xero monthly-column label (e.g. "31 Jul 26" / "Jul-26" / a date
// string) onto the board's YYYY-MM month keys, so forecast and Xero rows
// can be compared side by side.
export function xeroLabelToMonth(label: string): string | null {
  // Month-name forms first: "Aug-26" fed to new Date() parses as 26 Aug
  // 2001 (day-of-month + two-digit year), silently landing the month
  // outside the FY — the named-month regex reads it correctly. Note
  // "31 Aug 26" also hits the regex ("Aug 26" → 2026-08), which matches
  // what Date() would have said. Pure date strings fall through to Date().
  const m = label.match(/([A-Za-z]{3,9})[\s-]+(\d{2,4})/);
  if (m) {
    const idx = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
      .indexOf(m[1].slice(0, 3).toLowerCase());
    if (idx >= 0) {
      const yn = m[2].length === 2 ? `20${m[2]}` : m[2];
      return `${yn}-${String(idx + 1).padStart(2, "0")}`;
    }
  }
  const d = new Date(label);
  if (!isNaN(d.getTime())) return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  return null;
}

// App-linked projection: for the current and future months, what the app
// itself expects — weighted deal fees + Xero AR due as cash in, Xero AP due
// + the opex run-rate as cash out — chained into its own closing line from
// the same opening as the typed forecast. Reference only: it knows nothing
// about VAT quarters or anything not in the deal book / Xero.
export interface LinkedProjection {
  byMonth: Record<string, { in: number; out: number; close: number }>;
  months: string[];
  hasXero: boolean;
}
export function buildLinkedProjection(data: CashflowData, model: CashflowModel): LinkedProjection | null {
  if (!data.deals && !data.xero) return null;
  const nowKey = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
  const future = model.months.filter(m => m >= nowKey);
  if (future.length === 0) return null;
  const runRate = data.xero?.costRunRate ?? null;
  const byMonth: LinkedProjection["byMonth"] = {};
  // Start from the typed forecast's opening for the first projected month
  // (actual basis where actuals exist, else budget).
  const firstBasis = model.hasActual(future[0]) ? "actual" : "budget";
  let open = model.totals[future[0]]?.[firstBasis]?.open ?? 0;
  for (const m of future) {
    const inflow = (data.deals?.byMonth[m]?.weighted || 0) + (data.xero?.arByMonth?.[m] || 0);
    const outflow = (data.xero?.apByMonth?.[m] || 0) + (runRate || 0);
    const close = open + inflow - outflow;
    byMonth[m] = { in: Math.round(inflow), out: Math.round(outflow), close: Math.round(close) };
    open = close;
  }
  return { byMonth, months: future, hasXero: !!data.xero };
}

// Unified forecast (v3 — Woody, 2026-08-27): Xero + the app are the
// receipts source of truth, Wendy's typed lines are COSTS ONLY, plus the
// one manual LEGACY receivables line. Per forward month:
//   in  = weighted deal fees + Xero AR due + typed LEGACY (actual ?? budget)
//   out = typed cost lines (actual ?? budget)
// The chain anchors on Xero's live cash at bank when available (falling
// back to the typed opening), so the app's balance IS the balance.
export interface UnifiedForecast {
  months: string[];
  byMonth: Record<string, { in: number; dealsIn: number; arIn: number; legacyIn: number; out: number; open: number; close: number }>;
  anchor: { value: number; source: "xero" | "typed" };
  low: { month: string; close: number };
  current: { month: string; close: number } | null;
}
export function buildUnifiedForecast(data: CashflowData, model: CashflowModel): UnifiedForecast | null {
  const nowKey = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
  const months = model.months.filter(m => m >= nowKey);
  if (months.length === 0) return null;
  const legacyLine = model.receipts.find(l => l.key === "LEGACY") || null;
  const firstBasis = model.hasActual(months[0]) ? "actual" : "budget";
  const anchor: UnifiedForecast["anchor"] = data.xero?.cashTotal != null
    ? { value: data.xero.cashTotal, source: "xero" }
    : { value: model.totals[months[0]]?.[firstBasis]?.open ?? 0, source: "typed" };
  const byMonth: UnifiedForecast["byMonth"] = {};
  let open = anchor.value;
  for (const m of months) {
    const basis = model.hasActual(m) ? "actual" as const : "budget" as const;
    const dealsIn = data.deals?.byMonth[m]?.weighted || 0;
    const arIn = data.xero?.arByMonth?.[m] || 0;
    const legacyIn = legacyLine ? (model.get(legacyLine.id, m, "actual") ?? model.get(legacyLine.id, m, "budget") ?? 0) : 0;
    const inflow = dealsIn + arIn + legacyIn;
    // Typed cost lines are stored negative; exclude the legacy receipts
    // line's contribution from model totals by using payments only.
    const out = model.payments.reduce((s, l) => s + (model.get(l.id, m, basis) ?? model.get(l.id, m, "budget") ?? 0), 0);
    const close = open + inflow + out;
    byMonth[m] = {
      in: Math.round(inflow), dealsIn: Math.round(dealsIn), arIn: Math.round(arIn), legacyIn: Math.round(legacyIn),
      out: Math.round(out), open: Math.round(open), close: Math.round(close),
    };
    open = close;
  }
  const low = months.reduce((a, m) => (byMonth[m].close < a.close ? { month: m, close: byMonth[m].close } : a), { month: months[0], close: byMonth[months[0]].close });
  const current = byMonth[nowKey] ? { month: nowKey, close: byMonth[nowKey].close } : null;
  return { months, byMonth, anchor, low, current };
}
