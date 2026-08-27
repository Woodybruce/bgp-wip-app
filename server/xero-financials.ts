// Company Finance dashboard — pulls the firm's actual financial position
// from Xero's Reports API (P&L, Balance Sheet) plus outstanding ACCREC
// invoices for the debtors view. Runs on the SYSTEM Xero session so any
// admin can view it without personally connecting Xero.
//
// Requires the granular `accounting.reports.profitandloss.read` and
// `accounting.reports.balancesheet.read` scopes (apps created on/after
// 2 Mar 2026 can't use the old broad reports scope) — requested by the
// consent URL in xero.ts. Connections granted before those scopes existed
// report needsReconnect until an admin re-runs /api/xero/connect. The
// OAuth callback re-captures the system session automatically, so one
// reconnect fixes it for everyone.
//
// Xero rate limits are 60 calls/min, 5,000/day per tenant — responses are
// cached in-memory for 15 minutes; ?refresh=1 busts the cache.

import type { Express, Request, Response } from "express";
import { requireEquityOrAdmin } from "./auth";
import { xeroApi } from "./xero";
import { withSystemXero } from "./xero-system-session";
import { pool } from "./db";
import { legacyToCode, type DealStatusCode } from "../shared/deal-status";
import { buildCommissionStatements } from "./commission-engine";

const CACHE_TTL_MS = 15 * 60_000;
let cache: { at: number; payload: any } | null = null;

// ── Xero report parsing ─────────────────────────────────────────────────
// Reports come back as nested Rows: Header → Section(title) → Row /
// SummaryRow, each with Cells [{ Value }]. We flatten to sections with
// labelled numeric rows and keep the column headers for monthly layouts.

type FlatRow = { label: string; values: number[]; isTotal: boolean };
type FlatSection = { title: string; rows: FlatRow[] };

function toNum(v: any): number {
  const n = typeof v === "string" ? Number(v.replace(/,/g, "")) : Number(v);
  return isNaN(n) ? 0 : n;
}

function flattenReport(report: any): { columns: string[]; sections: FlatSection[] } {
  const columns: string[] = [];
  const sections: FlatSection[] = [];
  for (const row of report?.Rows || []) {
    if (row.RowType === "Header") {
      for (const c of (row.Cells || []).slice(1)) columns.push(String(c?.Value ?? ""));
      continue;
    }
    if (row.RowType === "Section") {
      const sec: FlatSection = { title: String(row.Title || ""), rows: [] };
      for (const r of row.Rows || []) {
        const cells = r.Cells || [];
        sec.rows.push({
          label: String(cells[0]?.Value ?? ""),
          values: cells.slice(1).map((c: any) => toNum(c?.Value)),
          isTotal: r.RowType === "SummaryRow",
        });
      }
      sections.push(sec);
      continue;
    }
    // Root-level Row (e.g. the final "Net Profit" line on the P&L)
    if (row.RowType === "Row" || row.RowType === "SummaryRow") {
      const cells = row.Cells || [];
      sections.push({
        title: "",
        rows: [{
          label: String(cells[0]?.Value ?? ""),
          values: cells.slice(1).map((c: any) => toNum(c?.Value)),
          isTotal: true,
        }],
      });
    }
  }
  return { columns, sections };
}

function findRow(flat: { sections: FlatSection[] }, pattern: RegExp): FlatRow | null {
  for (const sec of flat.sections) {
    for (const r of sec.rows) {
      if (pattern.test(r.label)) return r;
    }
  }
  return null;
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// Xero's classic JSON serialises dates as "/Date(1718064000000+0000)/";
// some fields also have ISO "...String" variants. Accept either.
function parseXeroDate(v: any): Date | null {
  if (!v) return null;
  const s = String(v);
  const m = s.match(/\/Date\((\d+)/);
  if (m) return new Date(Number(m[1]));
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

// Financial-year start from the org's FY end settings: the day after the
// FY end, in whichever year makes the start <= today.
function fyStartFrom(org: any, today: Date): Date {
  const endDay = Number(org?.FinancialYearEndDay) || 31;
  const endMonth = Number(org?.FinancialYearEndMonth) || 12; // 1-12
  // FY end this calendar year, then start = day after — minus one year if
  // that start hasn't arrived yet. (Xero caps report spans at 365 days, so
  // overshooting into the previous FY here breaks the P&L call.)
  const endThisYear = new Date(Date.UTC(today.getUTCFullYear(), endMonth - 1, endDay));
  let start = new Date(endThisYear);
  start.setUTCDate(start.getUTCDate() + 1);
  if (start > today) start.setUTCFullYear(start.getUTCFullYear() - 1);
  // Calendar-year orgs (end 31 Dec) come out as 1 Jan — "start of the year".
  return start;
}

function monthsBetween(a: Date, b: Date): number {
  return (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
}

// Xero pages invoices at 100/call with no total count — follow pages until a
// short page. Capped so a runaway ledger can't eat the 60/min rate limit;
// 6 pages (600 invoices) is far beyond BGP's live volumes.
async function fetchInvoicePages(session: any, where: string, order: string, maxPages = 6): Promise<any[]> {
  const all: any[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const res = await xeroApi(
      session,
      `/Invoices?where=${encodeURIComponent(where)}&order=${encodeURIComponent(order)}&page=${page}`,
    );
    const batch: any[] = res?.Invoices || [];
    all.push(...batch);
    if (batch.length < 100) break;
  }
  return all;
}

export async function buildFinancials(session: any): Promise<any> {
  const orgRes = await xeroApi(session, "/Organisation");
  const org = orgRes?.Organisations?.[0] || {};
  const today = new Date();
  const fyStart = fyStartFrom(org, today);
  const from = iso(fyStart);
  const to = iso(today);

  // Monthly P&L columns: Xero allows at most 11 trailing periods on top of
  // the requested month.
  const periods = Math.min(Math.max(monthsBetween(fyStart, today), 0), 11);

  const [pnlRes, pnlMonthlyRes, bsRes, invoices, paidAll, bills] = await Promise.all([
    xeroApi(session, `/Reports/ProfitAndLoss?fromDate=${from}&toDate=${to}`),
    xeroApi(session, `/Reports/ProfitAndLoss?toDate=${to}&periods=${periods}&timeframe=MONTH`),
    xeroApi(session, `/Reports/BalanceSheet?date=${to}`),
    // Outstanding sales invoices (debtors) — all pages, not just the first
    // 100 (a 101st invoice used to silently drop out of the aged view).
    fetchInvoicePages(session, 'Type=="ACCREC" AND Status=="AUTHORISED"', "DueDate ASC"),
    // Paid sales invoices — the commission trigger (Wendy pays commission
    // when the money lands, not when the invoice is raised). FY filter is
    // applied after fetch since FullyPaidOnDate isn't filterable in where.
    fetchInvoicePages(session, 'Type=="ACCREC" AND Status=="PAID"', "UpdatedDateUTC DESC"),
    // Outstanding bills (creditors) — committed cash out with due dates.
    fetchInvoicePages(session, 'Type=="ACCPAY" AND Status=="AUTHORISED"', "DueDate ASC"),
  ]);

  const pnl = flattenReport(pnlRes?.Reports?.[0]);
  const pnlMonthly = flattenReport(pnlMonthlyRes?.Reports?.[0]);
  const bs = flattenReport(bsRes?.Reports?.[0]);

  // ---- Headline P&L numbers (FY to date) ----
  const incomeRow = findRow(pnl, /^total (income|revenue|trading income)$/i);
  const grossRow = findRow(pnl, /^gross profit$/i);
  const opexRow = findRow(pnl, /^total (operating )?expenses$/i);
  const netRow = findRow(pnl, /^net profit$/i) || findRow(pnl, /^profit for the (period|year)$/i);
  const headline = {
    income: incomeRow?.values[0] ?? null,
    grossProfit: grossRow?.values[0] ?? null,
    operatingExpenses: opexRow?.values[0] ?? null,
    netProfit: netRow?.values[0] ?? null,
  };

  // ---- Monthly series (income / expenses / net per month column) ----
  const mIncome = findRow(pnlMonthly, /^total (income|revenue|trading income)$/i);
  const mOpex = findRow(pnlMonthly, /^total (operating )?expenses$/i);
  const mNet = findRow(pnlMonthly, /^net profit$/i);
  // Columns come newest-first from Xero; reverse to chronological and only
  // keep months inside the financial year.
  const monthly = (pnlMonthly.columns || []).map((label, i) => ({
    month: label,
    income: mIncome?.values[i] ?? 0,
    expenses: mOpex?.values[i] ?? 0,
    netProfit: mNet?.values[i] ?? 0,
  })).reverse().filter(m => {
    const d = new Date(m.month);
    return isNaN(d.getTime()) ? true : d >= new Date(fyStart.getTime() - 27 * 24 * 3600 * 1000);
  });

  // ---- Balance sheet: bank accounts + headline totals ----
  const bankSection = bs.sections.find(s => /^bank$/i.test(s.title));
  const bankAccounts = (bankSection?.rows || [])
    .filter(r => !r.isTotal)
    .map(r => ({ name: r.label, balance: r.values[0] ?? 0 }));
  const cashTotal = bankSection?.rows.find(r => r.isTotal)?.values[0]
    ?? bankAccounts.reduce((s, a) => s + a.balance, 0);
  const balanceSheet = {
    totalAssets: findRow(bs, /^total assets$/i)?.values[0] ?? null,
    totalLiabilities: findRow(bs, /^total liabilities$/i)?.values[0] ?? null,
    netAssets: findRow(bs, /^net assets$/i)?.values[0] ?? null,
    equity: findRow(bs, /^total equity$/i)?.values[0] ?? null,
  };

  // ---- Debtors (outstanding ACCREC invoices) ----
  const now = today.getTime();
  const buckets = { current: 0, d1to30: 0, d31to60: 0, d60plus: 0 };
  let outstanding = 0, overdue = 0;
  const overdueList: Array<{ contact: string; number: string; due: string; amount: number }> = [];
  for (const inv of invoices) {
    const due = inv.DueDateString || inv.DueDate || null;
    const amount = toNum(inv.AmountDue);
    if (!amount) continue;
    outstanding += amount;
    const dueMs = due ? new Date(due).getTime() : NaN;
    const daysOver = isNaN(dueMs) ? 0 : Math.floor((now - dueMs) / 86_400_000);
    if (daysOver <= 0) buckets.current += amount;
    else {
      overdue += amount;
      if (daysOver <= 30) buckets.d1to30 += amount;
      else if (daysOver <= 60) buckets.d31to60 += amount;
      else buckets.d60plus += amount;
      overdueList.push({
        contact: inv.Contact?.Name || "—",
        number: inv.InvoiceNumber || "",
        due: due ? String(due).slice(0, 10) : "",
        amount,
      });
    }
  }
  overdueList.sort((a, b) => b.amount - a.amount);

  // ---- Paid this FY (commission basis) ----
  const fyStartMs = fyStart.getTime();
  const paidInvoices = (paidAll as any[])
    .map((inv: any) => ({
      xeroInvoiceId: inv.InvoiceID,
      number: inv.InvoiceNumber || "",
      contact: inv.Contact?.Name || "—",
      // SubTotal = ex-VAT, comparable to the deal fee. AmountPaid includes VAT.
      subTotal: toNum(inv.SubTotal),
      total: toNum(inv.Total),
      paidOn: parseXeroDate(inv.FullyPaidOnDate),
    }))
    .filter(p => p.paidOn && p.paidOn.getTime() >= fyStartMs)
    .sort((a, b) => (b.paidOn!.getTime() - a.paidOn!.getTime()));

  // ---- Creditors (outstanding ACCPAY bills) + cash-out schedule ----
  // Bills are accrual entries: an AUTHORISED bill is already inside the P&L
  // expense figures. This view is about WHEN the cash leaves, not extra cost.
  const monthEnd = Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0);
  const nextMonthEnd = Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 2, 0);
  const credBuckets = { overdue: 0, thisMonth: 0, nextMonth: 0, later: 0 };
  let creditorsOutstanding = 0;
  const upcomingBills: Array<{ contact: string; number: string; due: string; amount: number }> = [];
  for (const b of bills as any[]) {
    const amount = toNum(b.AmountDue);
    if (!amount) continue;
    creditorsOutstanding += amount;
    const due = parseXeroDate(b.DueDateString || b.DueDate);
    const dueMs = due ? due.getTime() : NaN;
    if (!isNaN(dueMs) && dueMs < now) credBuckets.overdue += amount;
    else if (!isNaN(dueMs) && dueMs <= monthEnd) credBuckets.thisMonth += amount;
    else if (!isNaN(dueMs) && dueMs <= nextMonthEnd) credBuckets.nextMonth += amount;
    else credBuckets.later += amount;
    upcomingBills.push({
      contact: b.Contact?.Name || "—",
      number: b.InvoiceNumber || "",
      due: due ? iso(due) : "",
      amount,
    });
  }
  upcomingBills.sort((a, b) => b.amount - a.amount);

  // Receipts due IN, same forward buckets — pairs with the bills schedule to
  // make a simple near-term cash-flow view (debtors above only look backward).
  const recBuckets = { overdue: 0, thisMonth: 0, nextMonth: 0, later: 0 };
  for (const inv of invoices) {
    const amount = toNum(inv.AmountDue);
    if (!amount) continue;
    const due = parseXeroDate(inv.DueDateString || inv.DueDate);
    const dueMs = due ? due.getTime() : NaN;
    if (!isNaN(dueMs) && dueMs < now) recBuckets.overdue += amount;
    else if (!isNaN(dueMs) && dueMs <= monthEnd) recBuckets.thisMonth += amount;
    else if (!isNaN(dueMs) && dueMs <= nextMonthEnd) recBuckets.nextMonth += amount;
    else recBuckets.later += amount;
  }

  // ---- Cost analysis + run-rate forecast ----
  // Everything derives from the P&L reports already fetched: per-account cost
  // lines from the FY report, movement from the monthly report (columns come
  // newest-first: values[0] = current partial month, values[1] = last full
  // month). Wendy doesn't budget in Xero, so the forecast is a run-rate: the
  // average of the last 3 full months, projected over the rest of the FY.
  const isCostSection = (t: string) => /expense|overhead|administrat|direct cost|cost of sales/i.test(t);
  const fytdExpenses = (opexRow?.values[0] ?? 0) || 0;

  const costLines: Array<{ label: string; fytd: number; share: number }> = [];
  for (const sec of pnl.sections) {
    if (!isCostSection(sec.title)) continue;
    for (const r of sec.rows) {
      if (r.isTotal || !r.values[0]) continue;
      costLines.push({ label: r.label, fytd: r.values[0], share: 0 });
    }
  }
  costLines.sort((a, b) => b.fytd - a.fytd);
  for (const c of costLines) c.share = fytdExpenses ? Math.round((c.fytd / fytdExpenses) * 100) : 0;

  const movers: Array<{ label: string; lastMonth: number; priorAvg: number; delta: number }> = [];
  for (const sec of pnlMonthly.sections) {
    if (!isCostSection(sec.title)) continue;
    for (const r of sec.rows) {
      if (r.isTotal || r.values.length < 3) continue;
      const lastMonth = r.values[1] ?? 0;
      const prior = r.values.slice(2, 5).filter(v => v !== undefined);
      if (!prior.length) continue;
      const priorAvg = prior.reduce((s, v) => s + v, 0) / prior.length;
      const delta = lastMonth - priorAvg;
      if (Math.abs(delta) >= 250) movers.push({ label: r.label, lastMonth, priorAvg: Math.round(priorAvg), delta: Math.round(delta) });
    }
  }
  movers.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  // Run rate from the chronological monthly series, excluding the current
  // (partial) month; falls back to the partial month if the FY just started.
  const currentLabel = monthly.length ? monthly[monthly.length - 1] : null;
  const fullMonths = monthly.slice(0, -1);
  const runRateBasis = fullMonths.slice(-3);
  const runRate = runRateBasis.length
    ? runRateBasis.reduce((s, m) => s + (m.expenses || 0), 0) / runRateBasis.length
    : (currentLabel?.expenses || 0);
  const daysInMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0)).getUTCDate();
  const monthsElapsedExact = monthsBetween(fyStart, today) + today.getUTCDate() / daysInMonth;
  const monthsRemaining = Math.max(0, 12 - monthsElapsedExact);
  const projectedRemainingCosts = runRate * monthsRemaining;
  const projectedFyCosts = fytdExpenses + projectedRemainingCosts;

  const costs = {
    fytdExpenses: Math.round(fytdExpenses),
    runRate: Math.round(runRate),
    runRateBasisMonths: runRateBasis.length,
    monthsRemaining: Math.round(monthsRemaining * 10) / 10,
    projectedRemainingCosts: Math.round(projectedRemainingCosts),
    projectedFyCosts: Math.round(projectedFyCosts),
    topLines: costLines.slice(0, 12),
    movers: movers.slice(0, 6),
  };

  // ---- Recurring commitments (repeating bill/invoice templates) ----
  // Best-effort: repeating invoices may sit outside the granted granular
  // scopes on older consents — degrade to null rather than fail the page.
  let recurring: any = null;
  try {
    const repRes = await xeroApi(session, "/RepeatingInvoices");
    const reps: any[] = repRes?.RepeatingInvoices || [];
    const monthlyEquivalent = (r: any) => {
      const unit = r?.Schedule?.Unit;
      const period = Number(r?.Schedule?.Period) || 1;
      const total = toNum(r.Total);
      if (unit === "WEEKLY") return (total * 52) / 12 / period;
      if (unit === "MONTHLY") return total / period;
      return 0;
    };
    const active = reps.filter(r => r.Status === "AUTHORISED");
    const billTemplates = active.filter(r => r.Type === "ACCPAY");
    const incomeTemplates = active.filter(r => r.Type === "ACCREC");
    recurring = {
      monthlyBills: Math.round(billTemplates.reduce((s, r) => s + monthlyEquivalent(r), 0)),
      monthlyIncome: Math.round(incomeTemplates.reduce((s, r) => s + monthlyEquivalent(r), 0)),
      bills: billTemplates
        .map(r => ({ contact: r.Contact?.Name || "—", reference: r.Reference || "", monthly: Math.round(monthlyEquivalent(r)) }))
        .sort((a, b) => b.monthly - a.monthly)
        .slice(0, 10),
    };
  } catch (e: any) {
    console.warn("[xero-financials] repeating invoices unavailable:", e?.message);
  }

  return {
    paidInvoices: paidInvoices.map(p => ({ ...p, paidOn: p.paidOn ? iso(p.paidOn) : null })),
    costs,
    recurring,
    creditors: {
      outstanding: Math.round(creditorsOutstanding),
      buckets: credBuckets,
      top: upcomingBills.slice(0, 8),
      billCount: (bills as any[]).length,
    },
    cashflow: { receiptsDue: recBuckets, billsDue: credBuckets },
    orgName: org.Name || "Xero",
    currency: org.BaseCurrency || "GBP",
    fyStart: from,
    asAt: to,
    headline,
    monthly,
    pnlSections: pnl.sections,
    balanceSheet,
    bankAccounts,
    cashTotal,
    debtors: { outstanding, overdue, buckets, top: overdueList.slice(0, 8), invoiceCount: invoices.length },
    fetchedAt: new Date().toISOString(),
  };
}

// ── WIP pipeline + invoice cross-reference ──────────────────────────────
// Joins crm_deals (fee + canonical status) to xero_invoices (by deal_id)
// so the dashboard can forecast the year and surface reconciliation gaps:
//   - NEG / SOL / EXC fees = the live pipeline, weighted for projection
//   - COM deals with NO Xero invoice = "completed, not yet invoiced" —
//     fees earned but unbilled (the money-left-on-table list)
//   - INV / invoiced amounts deliberately NOT added to the projection:
//     they're already inside Xero's actual income figures
const STAGE_WEIGHTS: Record<string, number> = { NEG: 0.5, SOL: 0.75, EXC: 0.9 };

async function buildWipForecast(): Promise<any> {
  const { rows } = await pool.query(`
    SELECT d.id, d.name, d.status, d.fee::float AS fee, d.team,
           d.internal_agent AS "internalAgent",
           d.completed_at AS "completedAt",
           d.target_date AS "targetDate",
           inv.invoice_count AS "invoiceCount",
           inv.invoiced_total AS "invoicedTotal",
           inv.paid_count AS "paidCount"
      FROM crm_deals d
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS invoice_count,
               COALESCE(SUM(xi.total_amount), 0)::float AS invoiced_total,
               COUNT(*) FILTER (WHERE xi.status = 'PAID')::int AS paid_count
          FROM xero_invoices xi
         WHERE xi.deal_id = d.id AND COALESCE(xi.status, '') <> 'ERROR'
      ) inv ON TRUE
     WHERE d.fee IS NOT NULL AND d.fee > 0
  `);

  const pipeline: Record<string, { total: number; count: number }> = {
    NEG: { total: 0, count: 0 },
    SOL: { total: 0, count: 0 },
    EXC: { total: 0, count: 0 },
  };
  const early = { total: 0, count: 0 };
  let toInvoiceTotal = 0;
  const toInvoiceDeals: any[] = [];
  let invoicedAwaitingPayment = 0;

  for (const d of rows) {
    const code = legacyToCode(d.status) as DealStatusCode | null;
    if (!code || code === "WIT") continue;
    const fee = Number(d.fee) || 0;

    if (code === "NEG" || code === "SOL" || code === "EXC") {
      pipeline[code].total += fee;
      pipeline[code].count++;
      continue;
    }
    if (code === "REP" || code === "SPEC" || code === "LIVE" || code === "AVA") {
      early.total += fee;
      early.count++;
      continue;
    }
    if (code === "COM") {
      if (!d.invoiceCount) {
        toInvoiceTotal += fee;
        toInvoiceDeals.push({
          id: d.id,
          name: d.name,
          fee,
          completedAt: d.completedAt,
          agent: Array.isArray(d.internalAgent) ? d.internalAgent[0] || null : null,
        });
      } else if (d.paidCount < d.invoiceCount) {
        invoicedAwaitingPayment += Number(d.invoicedTotal) || 0;
      }
      continue;
    }
    // INV — invoiced; the amounts live in Xero's actuals already.
  }

  // Data health — how much of the WIP book has broken links (no client /
  // agent / date / Xero invoice). Shown to the equity group so they know how
  // trustworthy the projections above are.
  let health: any = null;
  try {
    const { computeWipHealth } = await import("./crm");
    const h = await computeWipHealth();
    health = {
      affectedCount: h.affected.count,
      affectedFee: h.affected.fee,
      noClient: h.buckets.noClient.count,
      noAgent: h.buckets.noAgent.count,
      noDate: h.buckets.noDate.count,
      invNoXero: h.buckets.invNoXero.count,
      noFee: h.buckets.noFee.count,
    };
  } catch (e: any) {
    console.warn("[xero-financials] wip health failed:", e?.message);
  }

  toInvoiceDeals.sort((a, b) => new Date(b.completedAt || 0).getTime() - new Date(a.completedAt || 0).getTime());
  const weightedPipeline =
    pipeline.NEG.total * STAGE_WEIGHTS.NEG +
    pipeline.SOL.total * STAGE_WEIGHTS.SOL +
    pipeline.EXC.total * STAGE_WEIGHTS.EXC;

  return {
    pipeline,
    weights: STAGE_WEIGHTS,
    weightedPipeline: Math.round(weightedPipeline),
    unweightedPipeline: Math.round(pipeline.NEG.total + pipeline.SOL.total + pipeline.EXC.total),
    toInvoice: { total: Math.round(toInvoiceTotal), count: toInvoiceDeals.length, deals: toInvoiceDeals.slice(0, 12) },
    invoicedAwaitingPayment: Math.round(invoicedAwaitingPayment),
    earlyPipeline: { total: Math.round(early.total), count: early.count },
    health,
  };
}

// ── Paid panel: cash collected this FY, matched back to deals ───────────
// (Commission maths lives in commission-engine.ts — this panel is just
// the "what's been paid, when" view Wendy asked for.)
async function buildPaidPanel(paidInvoices: any[]): Promise<any> {
  if (!paidInvoices?.length) return { totalPaid: 0, count: 0, recent: [], unmatchedCount: 0 };
  const ids = paidInvoices.map(p => p.xeroInvoiceId).filter(Boolean);
  const linkRes = ids.length
    ? await pool.query(
        `SELECT xi.xero_invoice_id AS "xeroInvoiceId", xi.deal_id AS "dealId", d.name AS "dealName"
           FROM xero_invoices xi
           JOIN crm_deals d ON d.id = xi.deal_id
          WHERE xi.xero_invoice_id = ANY($1)`,
        [ids],
      )
    : { rows: [] as any[] };
  const linkByInvoice = new Map(linkRes.rows.map((r: any) => [r.xeroInvoiceId, r]));

  let totalPaid = 0;
  let unmatchedCount = 0;
  const recent: any[] = [];
  for (const p of paidInvoices) {
    totalPaid += p.subTotal || 0;
    const link = linkByInvoice.get(p.xeroInvoiceId);
    if (!link) unmatchedCount++;
    recent.push({
      label: link?.dealName || p.contact,
      dealId: link?.dealId || null,
      number: p.number,
      amount: p.subTotal,
      paidOn: p.paidOn,
    });
  }

  return {
    totalPaid: Math.round(totalPaid),
    count: paidInvoices.length,
    recent: recent.slice(0, 10),
    unmatchedCount,
  };
}

// ── Company card spend (Revolut expenses module) ────────────────────────
// Pulls the admin spend workflow onto the one dashboard: month + FYTD card
// spend (business, non-rejected) and the two action queues.
async function buildSpendSnapshot(fyStartIso: string): Promise<any> {
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const { rows } = await pool.query(
    `SELECT
       COALESCE(SUM(amount_pence) FILTER (
         WHERE COALESCE(transaction_date::timestamptz, created_at) >= $1::timestamptz
           AND COALESCE(is_personal, false) = false AND status <> 'rejected'), 0)::bigint AS fytd_pence,
       COALESCE(SUM(amount_pence) FILTER (
         WHERE COALESCE(transaction_date::timestamptz, created_at) >= $2::timestamptz
           AND COALESCE(is_personal, false) = false AND status <> 'rejected'), 0)::bigint AS month_pence,
       COUNT(*) FILTER (WHERE status = 'pending_receipt')::int AS pending_receipts,
       COALESCE(SUM(amount_pence) FILTER (WHERE status = 'pending_receipt'), 0)::bigint AS pending_receipts_pence,
       COUNT(*) FILTER (WHERE status = 'pending_approval')::int AS pending_approvals,
       COALESCE(SUM(amount_pence) FILTER (WHERE status = 'pending_approval'), 0)::bigint AS pending_approvals_pence
     FROM expenses`,
    [fyStartIso, monthStart],
  );
  const r = rows[0] || {};
  const toPounds = (p: any) => Math.round(Number(p || 0) / 100);
  return {
    monthSpend: toPounds(r.month_pence),
    fytdSpend: toPounds(r.fytd_pence),
    pendingReceipts: { count: Number(r.pending_receipts || 0), total: toPounds(r.pending_receipts_pence) },
    pendingApprovals: { count: Number(r.pending_approvals || 0), total: toPounds(r.pending_approvals_pence) },
  };
}

export function registerXeroFinancialRoutes(app: Express): void {
  app.get("/api/xero/financials", requireEquityOrAdmin, async (req: Request, res: Response) => {
    try {
      if (cache && Date.now() - cache.at < CACHE_TTL_MS && req.query.refresh !== "1") {
        return res.json(cache.payload);
      }
      // WIP forecast + commission statements are local-DB only — compute
      // them first so those halves of the dashboard work even when Xero
      // needs reconnecting.
      const wip = await buildWipForecast().catch((e: any) => {
        console.warn("[xero-financials] wip forecast failed:", e?.message);
        return null;
      });
      const commissions = await buildCommissionStatements().catch((e: any) => {
        console.warn("[xero-financials] commission engine failed:", e?.message);
        return null;
      });
      const spend = await buildSpendSnapshot(commissions?.fyStart || `${new Date().getUTCFullYear()}-05-01`).catch((e: any) => {
        console.warn("[xero-financials] spend snapshot failed:", e?.message);
        return null;
      });

      let payload: any;
      try {
        payload = await withSystemXero((session) => buildFinancials(session));
      } catch (e: any) {
        const msg = String(e?.message || "");
        // Anything that smells like an auth/consent problem — old token
        // without the reports scope (401/403), a burned rotating refresh
        // token (invalid_grant), or a dead system session — gets the
        // reconnect callout rather than a raw 500. Reconnecting re-mints
        // and re-captures the system session either way.
        if (/401|403|insufficient|unauthori[sz]ed|forbidden|invalid_grant|refresh token|not connected to xero|no xero tenant|reconnect/i.test(msg)) {
          return res.json({
            needsReconnect: true,
            message: "The Xero connection needs re-authorising (expired token or missing reports permission). Click Reconnect Xero — one consent fixes it for everyone.",
            detail: msg,
            wip,
            commissions,
            spend,
          });
        }
        console.error("[xero-financials] unclassified Xero failure:", msg, e?.stack);
        throw e;
      }
      if (!payload) {
        return res.json({ notConnected: true, message: "Xero isn't connected — connect it on the Subscriptions page first.", wip, commissions, spend });
      }

      payload.wip = wip;
      payload.commissions = commissions;
      payload.spend = spend;
      payload.paid = await buildPaidPanel(payload.paidInvoices || []).catch((e: any) => {
        console.warn("[xero-financials] paid panel failed:", e?.message);
        return null;
      });
      delete payload.paidInvoices; // raw list folded into the paid panel
      if (wip) {
        const actuals = Number(payload.headline?.income) || 0;
        payload.projection = {
          actuals,
          toInvoice: wip.toInvoice.total,
          weightedPipeline: wip.weightedPipeline,
          total: Math.round(actuals + wip.toInvoice.total + wip.weightedPipeline),
        };
        // Projected FY net = projected income (above) − projected FY costs
        // (actual opex to date + run-rate for the remaining months).
        if (payload.costs?.projectedFyCosts != null) {
          payload.projection.projectedFyCosts = payload.costs.projectedFyCosts;
          payload.projection.projectedNet = Math.round(payload.projection.total - payload.costs.projectedFyCosts);
        }
      }
      cache = { at: Date.now(), payload };
      res.json(payload);
    } catch (e: any) {
      const msg = String(e?.message || "");
      console.error("[xero-financials] error:", msg);
      res.status(500).json({ error: msg });
    }
  });
}
