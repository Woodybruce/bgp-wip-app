// Company outlook — the front-and-centre Finance panel (Woody, 2026-08-28):
// income (Xero to date + weighted deal book + legacy Sage), Wendy's costs
// split basic vs payroll, app-computed commissions, prior-year comparison,
// average cost per month (the breakeven line) and what the profit means per
// equity partner on top of the £145k basic. v2 (same day): "simple and easy
// for everyone to understand" — three headline numbers (money in / money
// out / profit), the deal-book strip mirrors the WIP report's stages and
// links to it, and each cost bucket is a dropdown revealing the lines (or
// agents) behind the number.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { type CashflowData, type CashflowXero, cashflowFetch, CASHFLOW_MONTH_LABEL } from "@/lib/cashflow-model";
import { buildCompanyOutlook, type HistoricalWip, type CostLineDetail } from "@/lib/outlook-model";
import { TrendingUp, ChevronDown, ChevronRight, ArrowRight } from "lucide-react";
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from "recharts";

function money(n: number | null | undefined): string {
  if (n == null || isNaN(Number(n))) return "—";
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(Number(n));
}

// The one disclosure-row anatomy every expandable number on Finance uses
// (Woody, 2026-08-29: "all needs some uniformity"): chevron left, name +
// detail, figure right, tap to open the rows behind it.
export function DisclosureRow({ id, title, headline, sub, negative, open, onToggle, children }: {
  id: string; title: string; headline: string; sub?: string; negative?: boolean;
  open: boolean; onToggle: () => void; children: React.ReactNode;
}) {
  return (
    <div className="border rounded-xl bg-card">
      <button
        className="w-full flex items-center gap-2 p-3 text-left"
        onClick={onToggle}
        data-testid={`outlook-cost-${id}`}
        aria-expanded={open}
      >
        {open ? <ChevronDown className="w-4 h-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 shrink-0 text-muted-foreground" />}
        <span className="flex-1 min-w-0">
          <span className="text-sm font-medium">{title}</span>
          {sub && <span className="block text-[11px] text-muted-foreground leading-snug">{sub}</span>}
        </span>
        <span className={`text-sm font-semibold tabular-nums shrink-0 ${negative ? "text-red-600 dark:text-red-400" : ""}`}>{headline}</span>
      </button>
      {open && <div className="px-3 pb-3 pl-9">{children}</div>}
    </div>
  );
}
const CostRow = DisclosureRow;

// On touch screens a recharts tooltip opens on tap and never closes — there
// is no mouseleave (Woody, 2026-08-29: "doesn't go when click off"). This
// wrapper remounts its chart when a touch lands outside it, clearing any
// stuck tooltip. Shared by every Finance chart.
export function TapAwayChart({ className, children }: { className?: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [k, setK] = useState(0);
  useEffect(() => {
    if (typeof window === "undefined" || !("ontouchstart" in window)) return;
    const onTouch = (e: TouchEvent) => {
      if (ref.current && e.target instanceof Node && !ref.current.contains(e.target)) setK(x => x + 1);
    };
    document.addEventListener("touchstart", onTouch, { passive: true });
    return () => document.removeEventListener("touchstart", onTouch);
  }, []);
  return <div ref={ref} className={className}><div key={k} className="w-full h-full">{children}</div></div>;
}

// A deal-book stage row — the same DisclosureRow as everything else,
// opening to the stage's deals. Drawn on Finance → Fees & pipeline.
export function StageRow({ stage, open, onToggle }: {
  stage: { code: string; label: string; weightPct: number; weighted: number; unweighted: number; count: number; deals: Array<{ id: string; name: string; fee: number; weighted: number }> };
  open: boolean; onToggle: () => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? stage.deals : stage.deals.slice(0, 15);
  return (
    <DisclosureRow
      id={`stage-${stage.code}`}
      title={stage.label}
      sub={`${stage.count} transaction${stage.count === 1 ? "" : "s"} · ${money(stage.unweighted)} at ${stage.weightPct}%`}
      headline={money(stage.weighted)}
      open={open}
      onToggle={onToggle}
    >
      <div className="space-y-0.5">
        {visible.map(d => (
          <Link key={d.id} href={`/deals/${d.id}`}>
            <div className="flex items-center justify-between gap-3 text-sm py-1 px-1 -mx-1 rounded hover:bg-muted cursor-pointer">
              <span className="truncate">{d.name}</span>
              <span className="font-mono tabular-nums shrink-0 text-muted-foreground">{money(d.fee)} <span className="text-foreground">→ {money(d.weighted)}</span></span>
            </div>
          </Link>
        ))}
        {stage.deals.length > visible.length && (
          <button type="button" className="text-xs text-primary pt-1" onClick={() => setShowAll(true)}>
            Show all {stage.deals.length}
          </button>
        )}
        <p className="text-[11px] text-muted-foreground pt-1.5">Fee → weighted at {stage.weightPct}%. Tap a transaction to open it.</p>
      </div>
    </DisclosureRow>
  );
}

function LineList({ lines }: { lines: CostLineDetail[] }) {
  if (lines.length === 0) return <p className="text-xs text-muted-foreground">Nothing typed on the plan yet.</p>;
  return (
    <div className="space-y-0.5">
      {lines.map((l, i) => (
        <div key={i} className="flex items-center justify-between text-xs py-0.5">
          <span className="truncate pr-3">{l.label}</span>
          <span className="font-mono tabular-nums shrink-0">{money(l.monthly)}/mo</span>
        </div>
      ))}
    </div>
  );
}

// xeroFallback: the Finance page's own /api/xero/financials numbers (the
// feed the headline cards use). If the cashflow snapshot's Xero fetch
// hiccups, the outlook borrows this instead of showing "£0 billed so far"
// under a headline card that says £600k+.
export function CompanyOutlookSection({ xeroFallback, onOpenPipeline }: { xeroFallback?: CashflowXero; onOpenPipeline?: () => void } = {}) {
  const { data: cashflow } = useQuery<CashflowData>({
    queryKey: ["/api/cashflow"],
    queryFn: async () => (await cashflowFetch("GET", "/api/cashflow")).json(),
    staleTime: 5 * 60 * 1000,
  });
  const { data: hist } = useQuery<HistoricalWip>({
    queryKey: ["/api/historical-wip"],
    queryFn: async () => (await cashflowFetch("GET", "/api/historical-wip")).json(),
    staleTime: 60 * 60 * 1000,
  });

  const effective = useMemo<CashflowData | undefined>(() => {
    if (!cashflow) return undefined;
    if (cashflow.xero || !xeroFallback) return cashflow;
    return { ...cashflow, xero: xeroFallback };
  }, [cashflow, xeroFallback]);

  const outlook = useMemo(() => buildCompanyOutlook(effective, hist), [effective, hist]);
  const [openRow, setOpenRow] = useState<string | null>(null);
  const toggle = (id: string) => setOpenRow(cur => (cur === id ? null : id));

  const chartData = useMemo(() => {
    if (!outlook) return [];
    return outlook.months.map((m, i) => {
      const row: any = {
        label: CASHFLOW_MONTH_LABEL(m.month),
        billed: m.incomeActual,
        forecast: m.incomeDeals + m.incomeLegacy,
        cost: m.cost,
      };
      for (const h of outlook.history?.fyTotals || []) {
        row[`fy${h.fy}`] = outlook.history?.monthlyByFy[h.fy]?.[i] ?? null;
      }
      return row;
    });
  }, [outlook]);

  if (!outlook) return null;
  const { income, costs, profit, history, fyLabel } = outlook;
  const lastFy = history?.fyTotals[history.fyTotals.length - 1];
  const HIST_COLOURS = ["#cbd5e1", "#94a3b8", "#64748b"];

  return (
    <Card data-testid="company-outlook">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <TrendingUp className="w-4 h-4" /> Company outlook — {fyLabel}
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          All ex VAT. What's coming in, what's going out, and what's left — live from Xero, the transaction boards and the cost plan.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* The three numbers that matter */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <div className="border rounded-xl p-4">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Income — projected year</p>
            <p className="text-2xl font-semibold tabular-nums mt-1" data-testid="outlook-money-in">{money(income.projectedFy)}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
              {money(income.fytdActual)} billed so far + {money(income.forwardDeals)} transaction book{income.unscheduled.count ? ` + ${money(income.unscheduled.weighted)} Unscheduled / TBC` : ""}{income.legacy ? ` + ${money(income.legacy)} old Sage invoices (Wendy's sheet)` : ""}
              {history?.vsLastFyPct != null && lastFy ? ` · ${history.vsLastFyPct >= 0 ? "+" : ""}${history.vsLastFyPct}% vs last year` : ""}
            </p>
          </div>
          <div className="border rounded-xl p-4">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Costs — projected year</p>
            <p className="text-2xl font-semibold tabular-nums mt-1" data-testid="outlook-money-out">{money(costs.projectedFy)}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
              {money(costs.avgPerMonth)}/month on average — that's what we need to bill monthly to break even
            </p>
          </div>
          <div className="border rounded-xl p-4 bg-muted/40">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Profit — projected year</p>
            <p className={`text-2xl font-semibold tabular-nums mt-1 ${profit.projectedFy < 0 ? "text-red-600 dark:text-red-400" : ""}`} data-testid="outlook-profit">{money(profit.projectedFy)}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
              {profit.perPartner > 0
                ? `${money(profit.perPartner)} each on top of the £145k salary`
                : "no profit share on today's book yet — transactions won through the year fill this in"} · next 6 months: {money(profit.next6)}
            </p>
          </div>
        </div>

        {/* The deal book in one line; its stages, teams, deal types and
            largest deals are on Fees & pipeline (Woody, 2026-11-17: "to the
            point"). Same book, same rule (shared/finance-pipeline.ts). */}
        {(() => {
          const bookWeighted = income.byStage.reduce((s, st) => s + st.weighted, 0);
          const bookFee = income.byStage.reduce((s, st) => s + st.unweighted, 0);
          const bookCount = income.byStage.reduce((s, st) => s + st.count, 0);
          return (
            <div className="border rounded-xl p-3 flex items-start gap-3" data-testid="outlook-deal-book">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">
                  Transaction book {money(bookWeighted)} <span className="font-normal text-muted-foreground">weighted · {bookCount} live transaction{bookCount === 1 ? "" : "s"} · {money(bookFee)} at full fee</span>
                </p>
                <p className="text-[11px] text-muted-foreground leading-snug mt-0.5">
                  {money(income.forwardDeals + income.unscheduled.weighted)} expected this year{income.unscheduled.count ? ` (incl. ${money(income.unscheduled.weighted)} with no date yet)` : ""}{income.afterYearEnd.count ? ` · ${money(income.afterYearEnd.weighted)} more after 30 April` : ""}
                </p>
              </div>
              {onOpenPipeline && (
                <button type="button" onClick={onOpenPipeline} className="text-xs text-primary inline-flex items-center gap-1 whitespace-nowrap shrink-0 pt-0.5" data-testid="outlook-open-pipeline">
                  Fees &amp; pipeline <ArrowRight className="w-3 h-3" />
                </button>
              )}
            </div>
          );
        })()}

        {/* Month by month vs the last few years — moved above the costs
            (Woody, 2026-08-29). */}
        {chartData.length > 0 && (
          <div>
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5">Month by month vs prior years</p>
            <TapAwayChart className="h-[240px]">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} minTickGap={24} />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={(v: number) => `£${(v / 1000).toFixed(0)}k`} />
                  <Tooltip formatter={(v: any) => money(Number(v))} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="billed" name="Billed (Xero)" stackId="fy" fill="#10b981" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="forecast" name="Forecast (transactions + legacy)" stackId="fy" fill="#8b5cf6" radius={[3, 3, 0, 0]} />
                  <Line dataKey="cost" name="Costs" stroke="#f59e0b" strokeWidth={2} dot={false} />
                  {(history?.fyTotals || []).map((h, i) => (
                    <Line key={h.fy} dataKey={`fy${h.fy}`} name={h.label} stroke={HIST_COLOURS[i] || "#94a3b8"} strokeWidth={1.5} strokeDasharray="4 3" dot={false} />
                  ))}
                </ComposedChart>
              </ResponsiveContainer>
            </TapAwayChart>
          </div>
        )}

        {/* Costs — tap a row to see what's inside it */}
        <div className="space-y-2">
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Average monthly costs</p>
          <CostRow
            id="basic" title="Basic company costs"
            sub="Rent, rates, suppliers — everything that isn't people"
            headline={`${money(costs.basicAvg)}/mo`}
            open={openRow === "basic"} onToggle={() => toggle("basic")}
          >
            <LineList lines={costs.basicLines} />
          </CostRow>
          <CostRow
            id="payroll" title="Salaries & payroll"
            sub="Wages, pensions, PAYE/NI, directors"
            headline={`${money(costs.payrollAvg)}/mo`}
            open={openRow === "payroll"} onToggle={() => toggle("payroll")}
          >
            <LineList lines={costs.payrollLines} />
          </CostRow>
          <CostRow
            id="commission" title="Commissions"
            sub={`${costs.usingEngineCommission
              ? "Worked out live from each transaction's fee splits and the tier bands"
              : "From the typed plan line — fee splits unavailable"} · ${money(costs.commissionFy)} for the year`}
            headline={`${money(Math.round(costs.commissionFy / 12))}/mo`}
            open={openRow === "commission"} onToggle={() => toggle("commission")}
          >
            {costs.commissionByAgent.length === 0 ? (
              <p className="text-xs text-muted-foreground">No commission accruing yet this year.</p>
            ) : (
              <div className="space-y-1">
                {costs.commissionByAgent.map((a, i) => (
                  <div key={i} className="flex items-center justify-between gap-3 text-xs py-0.5">
                    <span className="min-w-0">
                      <span className="font-medium truncate block">{a.agent}{a.salary == null ? " ⚠︎" : ""}</span>
                      <span className="text-muted-foreground tabular-nums">billed {money(a.billings)} · pipeline {money(a.forwardBillings)}</span>
                    </span>
                    <span className="font-mono tabular-nums font-medium shrink-0">{money(a.earned + a.projectedForward)}</span>
                  </div>
                ))}
                <p className="text-[11px] text-muted-foreground pt-1.5">
                  Earned so far {money(costs.commissionEarned)} + {money(costs.commissionForward)} if the weighted book lands.
                  {costs.commissionTypedFy ? ` Wendy's plan line had ${money(costs.commissionTypedFy)}.` : ""}
                  {costs.commissionByAgent.some(a => a.salary == null) ? " ⚠︎ = no salary on file, so no commission can be worked out." : ""}
                  {" "}Full per-transaction statements with band progress are on the Commission pill.
                </p>
              </div>
            )}
            {costs.missingSplits && (
              <p className="text-[11px] text-amber-600 dark:text-amber-400 pt-1.5">
                {costs.missingSplits.count} pipeline transaction{costs.missingSplits.count === 1 ? " has" : "s have"} no fee split yet ({money(costs.missingSplits.fee)} of fees) — that commission isn't counted until the splits go in on the transaction.
              </p>
            )}
          </CostRow>
          {/* The three rows above, added up */}
          <div className="border rounded-xl bg-muted/40 flex items-center gap-2 p-3" data-testid="outlook-cost-total">
            <span className="w-4 shrink-0" />
            <span className="flex-1 min-w-0">
              <span className="text-sm font-semibold">Total</span>
              <span className="block text-[11px] text-muted-foreground leading-snug">
                Basic costs + payroll + commissions · {money((costs.basicAvg + costs.payrollAvg) * 12 + costs.commissionFy)} a year on the plan
              </span>
            </span>
            <span className="text-sm font-semibold tabular-nums shrink-0">
              {money(Math.round(costs.basicAvg + costs.payrollAvg + costs.commissionFy / 12))}/mo
            </span>
          </div>
        </div>

        {/* (The "Basis:" footnote was deleted 2026-08-29 on Woody's
            instruction — the methodology lives in this comment instead:
            income = Xero accrual income for months gone + deal board
            weighted by shared/finance-pipeline.ts ahead (NEG and HOT 50, SOL/EXC/COM 100, 2026-11-17), invoiced deals
            count once; costs = Xero actuals gone + typed plan forward;
            commissions = fee splits through the tier bands; VAT/transfers/
            corp tax excluded, profit pre-tax; prior years = Sage archive.) */}
      </CardContent>
    </Card>
  );
}
