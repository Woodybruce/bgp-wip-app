// Company outlook — the front-and-centre Finance panel (Woody, 2026-08-28):
// income (Xero to date + weighted deal book + legacy Sage), Wendy's costs
// split basic vs payroll, app-computed commissions, prior-year comparison,
// average cost per month (the breakeven line) and what the next six months'
// profit means per equity partner on top of the £145k basic.
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { type CashflowData, cashflowFetch, CASHFLOW_MONTH_LABEL } from "@/lib/cashflow-model";
import { buildCompanyOutlook, type HistoricalWip } from "@/lib/outlook-model";
import { TrendingUp } from "lucide-react";
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from "recharts";

function money(n: number | null | undefined): string {
  if (n == null || isNaN(Number(n))) return "—";
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(Number(n));
}

function Stat({ label, value, sub, negative, strong }: { label: string; value: string; sub?: string; negative?: boolean; strong?: boolean }) {
  return (
    <div className={`border rounded-xl p-3 ${strong ? "bg-muted/40" : ""}`}>
      <p className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className={`text-lg font-semibold tabular-nums mt-0.5 ${negative ? "text-red-600 dark:text-red-400" : ""}`} data-testid={`outlook-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}>
        {value}
      </p>
      {sub && <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">{sub}</p>}
    </div>
  );
}

export function CompanyOutlookSection() {
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

  const outlook = useMemo(() => buildCompanyOutlook(cashflow, hist), [cashflow, hist]);

  const chartData = useMemo(() => {
    if (!outlook) return [];
    return outlook.months.map((m, i) => {
      const row: any = {
        label: CASHFLOW_MONTH_LABEL(m.month),
        billed: m.isPast || m.month === outlook.nowKey ? m.incomeActual : 0,
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
        <CardTitle className="text-sm flex items-center gap-2">
          <TrendingUp className="w-4 h-4" /> Company outlook — {fyLabel}
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          All ex VAT. Income is what Xero has billed this year plus the pipeline-weighted deal book and the legacy Sage line; costs are Wendy's plan with commissions worked out from the deal boards' fee splits.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Income */}
        <div>
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5">Income</p>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
            <Stat label="Billed FYTD (Xero)" value={money(income.fytdActual)} sub={outlook.hasXero ? "Invoiced this FY, ex VAT" : "Xero not connected here"} />
            <Stat label="Forward book (weighted)" value={money(income.forwardDeals)} sub="Deal board × stage weights" />
            <Stat label="Legacy (Sage)" value={money(income.legacy)} sub={income.legacy ? "Typed on the Legacy line below" : "Type it on the Legacy line below"} />
            <Stat
              label="Projected FY income" strong
              value={money(income.projectedFy)}
              sub={history?.vsLastFyPct != null && lastFy ? `${history.vsLastFyPct >= 0 ? "+" : ""}${history.vsLastFyPct}% vs ${lastFy.label} (${money(lastFy.total)})` : undefined}
            />
          </div>
        </div>

        {/* Costs */}
        <div>
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5">Costs</p>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
            <Stat label="Basic company costs" value={`${money(costs.basicAvg)}/mo`} sub="Wendy's plan, averaged — rent, rates, suppliers, everything non-people" />
            <Stat label="Salaries & payroll" value={`${money(costs.payrollAvg)}/mo`} sub="Wages, pensions, PAYE/NI, directors — per the plan" />
            <Stat
              label="Commissions (computed)"
              value={money(costs.commissionFy)}
              sub={costs.usingEngineCommission
                ? `${money(costs.commissionEarned)} earned + ${money(costs.commissionForward)} if the weighted book lands${costs.commissionTypedFy ? ` · plan had ${money(costs.commissionTypedFy)}` : ""}`
                : "From Wendy's typed line — fee splits unavailable"}
            />
            <Stat
              label="Average cost / month" strong
              value={money(costs.avgPerMonth)}
              sub={`Bill ${money(costs.avgPerMonth)}/mo to break even · ${money(costs.projectedFy)} FY total`}
            />
          </div>
        </div>

        {/* Profit + partners */}
        <div>
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5">Profit &amp; the four of you</p>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
            <Stat
              label="Next 6 months profit"
              value={money(profit.next6)}
              negative={profit.next6 < 0}
              sub={`${money(profit.next6Income)} in − ${money(profit.next6Costs)} out`}
            />
            <Stat label="Projected FY profit" value={money(profit.projectedFy)} negative={profit.projectedFy < 0} sub="Pre corporation tax; salaries and commissions already deducted" />
            <Stat
              label="Per partner profit share" strong
              value={money(profit.perPartner)}
              negative={profit.perPartner < 0}
              sub="Projected profit ÷ 4, on top of salary"
            />
            <Stat
              label="Partner year (salary + share)" strong
              value={money(profit.partnerSalary + profit.perPartner)}
              sub={`£145k basic + ${money(profit.perPartner)} share`}
            />
          </div>
        </div>

        {/* Month-by-month vs the last few years */}
        {chartData.length > 0 && (
          <div>
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5">Month by month vs prior years</p>
            <div className="h-[240px]">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={(v: number) => `£${(v / 1000).toFixed(0)}k`} />
                  <Tooltip formatter={(v: any) => money(Number(v))} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="billed" name="Billed (Xero)" stackId="fy" fill="#10b981" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="forecast" name="Forecast (deals + legacy)" stackId="fy" fill="#8b5cf6" radius={[3, 3, 0, 0]} />
                  <Line dataKey="cost" name="Costs" stroke="#f59e0b" strokeWidth={2} dot={false} />
                  {(history?.fyTotals || []).map((h, i) => (
                    <Line key={h.fy} dataKey={`fy${h.fy}`} name={h.label} stroke={HIST_COLOURS[i] || "#94a3b8"} strokeWidth={1.5} strokeDasharray="4 3" dot={false} />
                  ))}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        <p className="text-[11px] text-muted-foreground leading-relaxed border-t pt-2">
          Basis: income counts Xero's booked (accrual) income for months gone plus the deal board weighted NEG 50% / SOL 75% / EXC 90% / COM 100% for months ahead — invoiced deals only ever count once. Costs use Xero's actual spend for months gone and Wendy's typed plan forward (averages fill untyped months); commissions come from each deal's fee-split rows through the tier bands (0% to 2× salary, then 30/40/50%), spread over the months remaining. VAT, transfers and corporation tax are left out — profit here is pre-tax. Prior-year lines are the Sage billings archive.
        </p>
      </CardContent>
    </Card>
  );
}
