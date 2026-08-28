// Company outlook model (Woody, 2026-08-28: "front and centre the app
// income forecasting and Xero actually to date plus the legacy Sage income,
// then Wendy's forecasted costs… then salaries and commission payments…
// average cost per month… what the profit might look like over the next
// 6 months which will show the equity partners what they might make after
// their basic salary of £145k").
//
// One FY view (May–April), all ex VAT, built entirely from data the Finance
// page already fetches: /api/cashflow (typed cost plan + Xero snapshot +
// weighted deal projection + commission outlook) and /api/historical-wip.
//
//   income[m]  = Xero accrual income booked that month (invoiced deals)
//              + weighted deal book landing that month (uninvoiced, so no
//                double count) + the typed legacy Sage line
//   costs[m]   = past months → Xero actual expenses (what really went out)
//              forward months → Wendy's typed plan split into basic company
//                costs and payroll (bucket averages fill untyped months),
//                plus the app-computed commission spread over the months
//                remaining (replacing Wendy's typed commission guess)
//   profit     = income − costs, pre corporation tax; the equity pool is
//                profit ÷ 4 ON TOP of salary — salaries are already a cost.
import {
  type CashflowData, type CashflowModel, buildCashflowModel, xeroLabelToMonth,
} from "@/lib/cashflow-model";

export interface HistoricalWip {
  fys: number[];
  fyTotals: Record<string, number>;
  monthly: Record<string, number[]>; // per FY, index 0 = May
}

export interface OutlookMonth {
  month: string;            // YYYY-MM
  isPast: boolean;
  incomeActual: number;     // Xero accrual income
  incomeDeals: number;      // weighted pipeline landing this month
  incomeLegacy: number;     // typed Sage line
  income: number;
  costBasic: number;
  costPayroll: number;
  costCommission: number;
  cost: number;
  profit: number;
}

export interface CompanyOutlook {
  fyLabel: string;
  months: OutlookMonth[];
  nowKey: string;
  income: { fytdActual: number; forwardDeals: number; legacy: number; projectedFy: number };
  costs: {
    basicAvg: number;              // basic company costs, £/mo (plan)
    payrollAvg: number;            // salaries/pensions/PAYE etc, £/mo (plan)
    commissionFy: number;          // app-computed FY commission (earned + forward)
    commissionEarned: number;
    commissionForward: number;
    commissionTypedFy: number;     // Wendy's typed commission line, for comparison
    avgPerMonth: number;           // total FY costs ÷ 12 — the breakeven line
    projectedFy: number;
    usingEngineCommission: boolean;
  };
  profit: { next6: number; next6Income: number; next6Costs: number; projectedFy: number; perPartner: number; partnerSalary: number };
  history: {
    fyTotals: Array<{ fy: number; label: string; total: number }>;
    monthlyByFy: Record<number, number[]>; // aligned to the outlook months (idx 0 = May)
    vsLastFyPct: number | null;
  } | null;
  hasXero: boolean;
}

const PARTNER_SALARY = 145000;
const FY_MONTH_COUNT = 12;

// Wendy's plan lines, bucketed. Payroll = people costs; excluded lines are
// pass-through / not-a-cost rows (VAT is pass-through on an ex-VAT board,
// transfers are intercompany movements, corporation tax comes out of the
// profit shown, not before it).
const EXCLUDE_RE = /^vat$|transfer|corporation tax/i;
const PAYROLL_RE = /wages|salar|commission|bonus|pension|paye|p11d|psa|\bnic\b|directors/i;
const COMMISSION_RE = /commission/i;

function fyWindow(now = new Date()): { start: number; months: string[]; label: string } {
  const y = now.getUTCMonth() >= 4 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  const months: string[] = [];
  for (let i = 0; i < FY_MONTH_COUNT; i++) {
    const mm = ((4 + i) % 12) + 1;
    const yy = y + (4 + i >= 12 ? 1 : 0);
    months.push(`${yy}-${String(mm).padStart(2, "0")}`);
  }
  return { start: y, months, label: `FY ${y}–${String(y + 1).slice(2)}` };
}

export function buildCompanyOutlook(data: CashflowData | undefined, hist: HistoricalWip | null | undefined): CompanyOutlook | null {
  if (!data) return null;
  let model: CashflowModel;
  try {
    model = buildCashflowModel(data);
  } catch {
    return null;
  }
  const { start, months, label } = fyWindow();
  const nowKey = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;

  // Xero actuals by board month key.
  const actualIncome: Record<string, number> = {};
  const actualExpenses: Record<string, number> = {};
  for (const mo of data.xero?.monthly || []) {
    const key = xeroLabelToMonth(mo.month);
    if (!key) continue;
    actualIncome[key] = (actualIncome[key] || 0) + (mo.income || 0);
    actualExpenses[key] = (actualExpenses[key] || 0) + (mo.expenses || 0);
  }

  // Typed plan buckets (payments lines are stored negative — flip to cost).
  const legacyLine = model.receipts.find(l => l.key === "LEGACY") || null;
  const planLines = model.payments.filter(l => !EXCLUDE_RE.test(l.label.trim()));
  const commissionLines = planLines.filter(l => COMMISSION_RE.test(l.label));
  const payrollLines = planLines.filter(l => PAYROLL_RE.test(l.label) && !COMMISSION_RE.test(l.label));
  const basicLines = planLines.filter(l => !PAYROLL_RE.test(l.label));
  const lineVal = (lineId: string, m: string) => {
    const v = model.get(lineId, m, "actual") ?? model.get(lineId, m, "budget");
    return v === undefined ? undefined : Math.abs(v);
  };
  const bucketMonth = (lines: typeof planLines, m: string): number | undefined => {
    let sum = 0, any = false;
    for (const l of lines) {
      const v = lineVal(l.id, m);
      if (v !== undefined) { sum += v; any = true; }
    }
    return any ? sum : undefined;
  };
  const bucketAvg = (lines: typeof planLines): number => {
    const vals = months.map(m => bucketMonth(lines, m)).filter((v): v is number => v !== undefined);
    return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0;
  };
  const basicAvg = bucketAvg(basicLines);
  const payrollAvg = bucketAvg(payrollLines);
  const commissionTypedFy = months.reduce((s, m) => s + (bucketMonth(commissionLines, m) || 0), 0);

  // Commission: the app-computed number (fee splits × tier bands) replaces
  // the typed guess when available; spread over the forward months.
  const co = data.commissionOutlook || null;
  const usingEngineCommission = !!co;
  const forwardMonths = months.filter(m => m >= nowKey);
  // The slice of computed commission still to be paid out: everything the
  // weighted book would add, plus what's earned but not yet payable-and-paid.
  const commissionForwardPot = co ? Math.max(0, co.projectedFyTotal - co.payable) : 0;
  const commissionMonthly = co
    ? (forwardMonths.length ? commissionForwardPot / forwardMonths.length : 0)
    : 0;

  const out: OutlookMonth[] = [];
  for (const m of months) {
    const isPast = m < nowKey;
    const incomeActual = actualIncome[m] || 0;
    let incomeDeals = m >= nowKey ? (data.deals?.byMonth[m]?.weighted || 0) : 0;
    if (m === (forwardMonths[0] || "")) incomeDeals += data.deals?.undated?.weighted || 0;
    const incomeLegacy = m >= nowKey && legacyLine
      ? (model.get(legacyLine.id, m, "actual") ?? model.get(legacyLine.id, m, "budget") ?? 0)
      : 0;
    const income = incomeActual + incomeDeals + incomeLegacy;

    let costBasic = 0, costPayroll = 0, costCommission = 0, cost = 0;
    if (isPast && actualExpenses[m] !== undefined) {
      cost = actualExpenses[m];
    } else {
      costBasic = bucketMonth(basicLines, m) ?? basicAvg;
      costPayroll = bucketMonth(payrollLines, m) ?? payrollAvg;
      costCommission = co ? commissionMonthly : (bucketMonth(commissionLines, m) ?? 0);
      cost = costBasic + costPayroll + costCommission;
    }
    out.push({
      month: m, isPast,
      incomeActual: Math.round(incomeActual), incomeDeals: Math.round(incomeDeals), incomeLegacy: Math.round(incomeLegacy),
      income: Math.round(income),
      costBasic: Math.round(costBasic), costPayroll: Math.round(costPayroll), costCommission: Math.round(costCommission),
      cost: Math.round(cost), profit: Math.round(income - cost),
    });
  }

  const fytdActual = out.reduce((s, m) => s + m.incomeActual, 0);
  const forwardDeals = out.reduce((s, m) => s + m.incomeDeals, 0);
  const legacy = out.reduce((s, m) => s + m.incomeLegacy, 0);
  const projectedFyIncome = out.reduce((s, m) => s + m.income, 0);
  const projectedFyCosts = out.reduce((s, m) => s + m.cost, 0);
  const projectedFyProfit = projectedFyIncome - projectedFyCosts;
  const next6 = out.filter(m => m.month >= nowKey).slice(0, 6);
  const next6Income = next6.reduce((s, m) => s + m.income, 0);
  const next6Costs = next6.reduce((s, m) => s + m.cost, 0);

  // History: prior FYs from the Sage archive, aligned May-first like the
  // outlook months. FY labels follow the archive convention (fy 2026 =
  // May 25 – Apr 26).
  let history: CompanyOutlook["history"] = null;
  if (hist?.fyTotals) {
    const priorFys = (hist.fys || []).filter(fy => fy <= start).sort((a, b) => b - a).slice(0, 3).reverse();
    const lastFy = priorFys[priorFys.length - 1];
    const lastTotal = lastFy ? hist.fyTotals[String(lastFy)] || 0 : 0;
    history = {
      fyTotals: priorFys.map(fy => ({ fy, label: `FY ${fy - 1}–${String(fy).slice(2)}`, total: Math.round(hist.fyTotals[String(fy)] || 0) })),
      monthlyByFy: Object.fromEntries(priorFys.map(fy => [fy, (hist.monthly?.[String(fy)] || []).map(v => Math.round(v))])),
      vsLastFyPct: lastTotal ? Math.round(((projectedFyIncome / lastTotal) - 1) * 100) : null,
    };
  }

  return {
    fyLabel: label,
    months: out,
    nowKey,
    income: {
      fytdActual: Math.round(fytdActual),
      forwardDeals: Math.round(forwardDeals),
      legacy: Math.round(legacy),
      projectedFy: Math.round(projectedFyIncome),
    },
    costs: {
      basicAvg: Math.round(basicAvg),
      payrollAvg: Math.round(payrollAvg),
      commissionFy: Math.round(co?.projectedFyTotal || 0),
      commissionEarned: Math.round(co?.earned || 0),
      commissionForward: Math.round(co?.projectedForward || 0),
      commissionTypedFy: Math.round(commissionTypedFy),
      avgPerMonth: Math.round(projectedFyCosts / FY_MONTH_COUNT),
      projectedFy: Math.round(projectedFyCosts),
      usingEngineCommission,
    },
    profit: {
      next6: Math.round(next6Income - next6Costs),
      next6Income: Math.round(next6Income),
      next6Costs: Math.round(next6Costs),
      projectedFy: Math.round(projectedFyProfit),
      perPartner: Math.round(projectedFyProfit / 4),
      partnerSalary: PARTNER_SALARY,
    },
    history,
    hasXero: !!data.xero,
  };
}
