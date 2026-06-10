// Company Finance dashboard — pulls the firm's actual financial position
// from Xero's Reports API (P&L, Balance Sheet) plus outstanding ACCREC
// invoices for the debtors view. Runs on the SYSTEM Xero session so any
// admin can view it without personally connecting Xero.
//
// Requires the `accounting.reports.read` scope — added to the consent URL
// in xero.ts, but existing connections were granted before it existed, so
// the endpoint reports needsReconnect until an admin re-runs
// /api/xero/connect. The OAuth callback re-captures the system session
// automatically, so one reconnect fixes it for everyone.
//
// Xero rate limits are 60 calls/min, 5,000/day per tenant — responses are
// cached in-memory for 15 minutes; ?refresh=1 busts the cache.

import type { Express, Request, Response } from "express";
import { requireAdmin } from "./auth";
import { xeroApi } from "./xero";
import { withSystemXero } from "./xero-system-session";

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

// Financial-year start from the org's FY end settings: the day after the
// FY end, in whichever year makes the start <= today.
function fyStartFrom(org: any, today: Date): Date {
  const endDay = Number(org?.FinancialYearEndDay) || 31;
  const endMonth = Number(org?.FinancialYearEndMonth) || 12; // 1-12
  // FY end this calendar year, then start = day after, minus one year if
  // that lands in the future.
  const endThisYear = new Date(Date.UTC(today.getUTCFullYear(), endMonth - 1, endDay));
  let start = new Date(endThisYear);
  start.setUTCDate(start.getUTCDate() + 1);
  start.setUTCFullYear(start.getUTCFullYear() - 1);
  if (start > today) start.setUTCFullYear(start.getUTCFullYear() - 1);
  // Calendar-year orgs (end 31 Dec) come out as 1 Jan — "start of the year".
  return start;
}

function monthsBetween(a: Date, b: Date): number {
  return (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
}

async function buildFinancials(session: any): Promise<any> {
  const orgRes = await xeroApi(session, "/Organisation");
  const org = orgRes?.Organisations?.[0] || {};
  const today = new Date();
  const fyStart = fyStartFrom(org, today);
  const from = iso(fyStart);
  const to = iso(today);

  // Monthly P&L columns: Xero allows at most 11 trailing periods on top of
  // the requested month.
  const periods = Math.min(Math.max(monthsBetween(fyStart, today), 0), 11);

  const [pnlRes, pnlMonthlyRes, bsRes, invRes] = await Promise.all([
    xeroApi(session, `/Reports/ProfitAndLoss?fromDate=${from}&toDate=${to}`),
    xeroApi(session, `/Reports/ProfitAndLoss?toDate=${to}&periods=${periods}&timeframe=MONTH`),
    xeroApi(session, `/Reports/BalanceSheet?date=${to}`),
    // Outstanding sales invoices (debtors). One page of 100, most recent
    // first, is plenty for the dashboard's aged view.
    xeroApi(session, `/Invoices?where=${encodeURIComponent('Type=="ACCREC" AND Status=="AUTHORISED"')}&order=${encodeURIComponent("DueDate ASC")}&page=1`),
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
  const invoices: any[] = invRes?.Invoices || [];
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

  return {
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

export function registerXeroFinancialRoutes(app: Express): void {
  app.get("/api/xero/financials", requireAdmin, async (req: Request, res: Response) => {
    try {
      if (cache && Date.now() - cache.at < CACHE_TTL_MS && req.query.refresh !== "1") {
        return res.json(cache.payload);
      }
      const payload = await withSystemXero((session) => buildFinancials(session));
      if (!payload) {
        return res.json({ notConnected: true, message: "Xero isn't connected — connect it on the Subscriptions page first." });
      }
      cache = { at: Date.now(), payload };
      res.json(payload);
    } catch (e: any) {
      const msg = String(e?.message || "");
      // 401/403 from the Reports endpoints with an old token = the
      // connection predates the accounting.reports.read scope.
      if (/403|401|insufficient|unauthori[sz]ed|forbidden/i.test(msg)) {
        return res.json({
          needsReconnect: true,
          message: "The Xero connection predates reports access. An admin needs to reconnect Xero (Subscriptions → Xero → Connect) to grant the new reports permission.",
          detail: msg,
        });
      }
      console.error("[xero-financials] error:", msg);
      res.status(500).json({ error: msg });
    }
  });
}
