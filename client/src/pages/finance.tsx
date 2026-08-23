// Company Finance — the firm's actual financial position pulled live from
// Xero (admin-only): FY-to-date P&L, cash at bank, balance sheet headline,
// aged debtors. Data comes from /api/xero/financials (system Xero session,
// cached 15 min server-side).
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { getAuthHeaders } from "@/lib/queryClient";
import { formatDate } from "@/lib/format";
import { RefreshCw, Landmark, TrendingUp, Banknote, AlertTriangle, ExternalLink, Briefcase } from "lucide-react";
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from "recharts";

interface WipForecast {
  pipeline: Record<"NEG" | "SOL" | "EXC", { total: number; count: number }>;
  weights: Record<string, number>;
  weightedPipeline: number;
  unweightedPipeline: number;
  toInvoice: { total: number; count: number; deals: Array<{ id: string; name: string; fee: number; completedAt: string | null; agent: string | null }> };
  invoicedAwaitingPayment: number;
  earlyPipeline: { total: number; count: number };
  health?: {
    affectedCount: number;
    affectedFee: number;
    noClient: number;
    noAgent: number;
    noDate: number;
    invNoXero: number;
    noFee: number;
  } | null;
}

interface Financials {
  notConnected?: boolean;
  needsReconnect?: boolean;
  message?: string;
  orgName?: string;
  currency?: string;
  fyStart?: string;
  asAt?: string;
  headline?: { income: number | null; grossProfit: number | null; operatingExpenses: number | null; netProfit: number | null };
  monthly?: Array<{ month: string; income: number; expenses: number; netProfit: number }>;
  pnlSections?: Array<{ title: string; rows: Array<{ label: string; values: number[]; isTotal: boolean }> }>;
  balanceSheet?: { totalAssets: number | null; totalLiabilities: number | null; netAssets: number | null; equity: number | null };
  bankAccounts?: Array<{ name: string; balance: number }>;
  cashTotal?: number;
  debtors?: {
    outstanding: number; overdue: number;
    buckets: { current: number; d1to30: number; d31to60: number; d60plus: number };
    top: Array<{ contact: string; number: string; due: string; amount: number }>;
    invoiceCount: number;
  };
  wip?: WipForecast | null;
  projection?: { actuals: number; toInvoice: number; weightedPipeline: number; total: number; projectedFyCosts?: number; projectedNet?: number };
  costs?: {
    fytdExpenses: number;
    runRate: number;
    runRateBasisMonths: number;
    monthsRemaining: number;
    projectedRemainingCosts: number;
    projectedFyCosts: number;
    topLines: Array<{ label: string; fytd: number; share: number }>;
    movers: Array<{ label: string; lastMonth: number; priorAvg: number; delta: number }>;
  } | null;
  recurring?: {
    monthlyBills: number;
    monthlyIncome: number;
    bills: Array<{ contact: string; reference: string; monthly: number }>;
  } | null;
  creditors?: {
    outstanding: number;
    buckets: { overdue: number; thisMonth: number; nextMonth: number; later: number };
    top: Array<{ contact: string; number: string; due: string; amount: number }>;
    billCount: number;
  } | null;
  cashflow?: {
    receiptsDue: { overdue: number; thisMonth: number; nextMonth: number; later: number };
    billsDue: { overdue: number; thisMonth: number; nextMonth: number; later: number };
  } | null;
  paid?: {
    totalPaid: number;
    count: number;
    recent: Array<{ label: string; dealId: string | null; number: string; amount: number; paidOn: string | null }>;
    unmatchedCount: number;
  } | null;
  spend?: {
    monthSpend: number;
    fytdSpend: number;
    pendingReceipts: { count: number; total: number };
    pendingApprovals: { count: number; total: number };
  } | null;
  commissions?: {
    fyStart: string;
    statements: Array<{
      agent: string;
      salary: number | null;
      billings: number;
      multiple: number | null;
      currentRate: number;
      earned: number;
      payable: number;
      awaitingPayment: number;
      nextThreshold: { multiple: number; rate: number; billingsAway: number } | null;
      deals: Array<{ id: string; name: string; feeDue: string | null; billing: number; commission: number; clientPaid: boolean }>;
    }>;
    assumptions: string[];
  } | null;
  fetchedAt?: string;
}

function money(n: number | null | undefined): string {
  if (n == null || isNaN(Number(n))) return "—";
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(Number(n));
}

function StatCard({ label, value, sub, negative }: { label: string; value: string; sub?: string; negative?: boolean }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className={`text-2xl font-semibold tracking-tight mt-1 ${negative ? "text-red-600 dark:text-red-400" : ""}`} data-testid={`finance-stat-${label.toLowerCase().replace(/\s+/g, "-")}`}>
          {value}
        </p>
        {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
      </CardContent>
    </Card>
  );
}

// Pipeline + forecast from the WIP board, cross-referenced against Xero
// invoices. Rendered on its own so it still shows when Xero needs a
// reconnect (it's built from the CRM, not the Xero API).
function WipSection({ wip, projection }: { wip: WipForecast; projection?: Financials["projection"] }) {
  const stages: Array<{ code: "EXC" | "SOL" | "NEG"; label: string }> = [
    { code: "EXC", label: "Exchanged" },
    { code: "SOL", label: "At solicitors" },
    { code: "NEG", label: "Negotiating" },
  ];
  const proj = projection;
  const projParts = proj ? [
    { label: "Actual income", value: proj.actuals, color: "bg-emerald-500" },
    { label: "To invoice", value: proj.toInvoice, color: "bg-sky-500" },
    { label: "Weighted pipeline", value: proj.weightedPipeline, color: "bg-violet-500" },
  ].filter(p => p.value > 0) : [];
  const projTotal = proj?.total || 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          label="Completed — to invoice"
          value={money(wip.toInvoice.total)}
          sub={`${wip.toInvoice.count} deal(s) with no Xero invoice`}
          negative={wip.toInvoice.total > 0}
        />
        {stages.map(s => (
          <StatCard
            key={s.code}
            label={`${s.label} pipeline`}
            value={money(wip.pipeline[s.code]?.total)}
            sub={`${wip.pipeline[s.code]?.count || 0} deal(s) · weighted ${Math.round((wip.weights[s.code] || 0) * 100)}%`}
          />
        ))}
      </div>

      {proj && projTotal > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2"><Briefcase className="w-4 h-4" /> Projected year</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex h-8 w-full rounded-md overflow-hidden border">
              {projParts.map((p, i) => (
                <div
                  key={i}
                  className={`${p.color} h-full`}
                  style={{ width: `${Math.max((p.value / projTotal) * 100, 1.5)}%` }}
                  title={`${p.label}: ${money(p.value)}`}
                />
              ))}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
              {projParts.map((p, i) => (
                <span key={i} className="inline-flex items-center gap-1.5">
                  <span className={`w-2.5 h-2.5 rounded-sm ${p.color}`} />
                  {p.label} <span className="font-mono font-medium">{money(p.value)}</span>
                </span>
              ))}
              <span className="ml-auto font-semibold">Projected total {money(projTotal)}</span>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Actual Xero income FY-to-date + completed-but-uninvoiced fees + pipeline weighted EXC 90% · SOL 75% · NEG 50%.
              Unweighted pipeline {money(wip.unweightedPipeline)}; early-stage deals (pre-negotiation) excluded: {money(wip.earlyPipeline.total)} across {wip.earlyPipeline.count}.
            </p>
          </CardContent>
        </Card>
      )}

      {wip.toInvoice.deals.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center justify-between">
              <span className="flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-amber-500" /> Completed, not yet invoiced</span>
              <Badge variant="secondary" className="text-[10px]">{wip.toInvoice.count} deal(s) · {money(wip.toInvoice.total)}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-0.5">
            {wip.toInvoice.deals.map(deal => (
              <Link key={deal.id} href={`/deals/${deal.id}`}>
                <div className="flex items-center justify-between text-sm py-1 px-1 -mx-1 rounded hover:bg-muted cursor-pointer" data-testid={`finance-uninvoiced-${deal.id}`}>
                  <span className="truncate pr-3">
                    {deal.name}
                    <span className="text-muted-foreground text-xs">
                      {deal.agent ? ` · ${deal.agent}` : ""}{deal.completedAt ? ` · completed ${formatDate(deal.completedAt)}` : ""}
                    </span>
                  </span>
                  <span className="font-mono shrink-0">{money(deal.fee)}</span>
                </div>
              </Link>
            ))}
            {wip.invoicedAwaitingPayment > 0 && (
              <p className="text-[11px] text-muted-foreground pt-2">
                Plus {money(wip.invoicedAwaitingPayment)} invoiced on completed deals still awaiting payment (in debtors above).
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// Commission statements — the tiered scheme: billings (agent's fee split,
// after BGP House's 15%) accumulate from 1 May in fee-due order; 0% to 2×
// salary, then 30% / 40% / 50% bands; payable at month-end payroll once
// the client has paid.
function CommissionSection({ commissions }: { commissions: NonNullable<Financials["commissions"]> }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center justify-between">
          <span>Commission statements</span>
          <span className="text-xs font-normal text-muted-foreground">FY from {formatDate(commissions.fyStart)}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {commissions.statements.map((s, i) => {
          const pct = s.multiple != null ? Math.min((s.multiple / 4) * 100, 100) : 0;
          return (
            <div key={i} className="space-y-1.5" data-testid={`commission-statement-${s.agent.toLowerCase().replace(/\s+/g, "-")}`}>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-sm font-medium truncate">{s.agent}</span>
                  {s.multiple != null ? (
                    <Badge variant="secondary" className="text-[10px]">{s.multiple}× salary</Badge>
                  ) : (
                    <Badge variant="outline" className="text-[10px] text-amber-600">no salary on file</Badge>
                  )}
                  <Badge variant={s.currentRate > 0 ? "default" : "outline"} className="text-[10px]">
                    {Math.round(s.currentRate * 100)}% band
                  </Badge>
                </div>
                <div className="flex items-center gap-4 text-sm">
                  <span className="text-muted-foreground text-xs">Billings <span className="font-mono font-medium text-foreground">{money(s.billings)}</span></span>
                  <span className="text-muted-foreground text-xs">Earned <span className="font-mono font-medium text-foreground">{money(s.earned)}</span></span>
                  <span className="text-muted-foreground text-xs">Payable <span className="font-mono font-medium text-emerald-600 dark:text-emerald-400">{money(s.payable)}</span></span>
                  {s.awaitingPayment > 0 && (
                    <span className="text-muted-foreground text-xs">Awaiting client <span className="font-mono font-medium text-amber-600 dark:text-amber-400">{money(s.awaitingPayment)}</span></span>
                  )}
                </div>
              </div>
              {/* Progress to the salary-multiple thresholds (markers at 2×/3×/4×) */}
              {s.multiple != null && (
                <div className="relative h-2 rounded-full bg-muted overflow-hidden">
                  <div className="absolute inset-y-0 left-0 bg-primary rounded-full" style={{ width: `${pct}%` }} />
                  {[2, 3, 4].map(m => (
                    <div key={m} className="absolute inset-y-0 w-px bg-background" style={{ left: `${(m / 4) * 100}%` }} title={`${m}× salary`} />
                  ))}
                </div>
              )}
              {s.nextThreshold && (
                <p className="text-[11px] text-muted-foreground">
                  {money(s.nextThreshold.billingsAway)} of billings away from the {Math.round(s.nextThreshold.rate * 100)}% band ({s.nextThreshold.multiple}× salary).
                </p>
              )}
            </div>
          );
        })}
        <div className="border-t pt-2">
          <p className="text-[11px] text-muted-foreground">
            {commissions.assumptions.join(" ")}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

// App + AI running costs — what the app itself spends on Claude / Gemini /
// gpt-image / ScraperAPI, metered from each provider's own usage figures.
function AppCostsSection() {
  const { data } = useQuery<{
    monthUsd: number; fytdUsd: number; monthCalls: number; monthTokens: number;
    monthUnpricedImages: number;
    byProvider: Array<{ provider: string; model: string; calls: number; input_tokens: number; output_tokens: number; images: number; usd: number }>;
    byFeature: Array<{ feature: string; calls: number; usd: number }>;
    scraperapi: { requestCount: number | null; requestLimit: number | null; subscriptionName: string | null } | null;
    meteredFrom: string;
  }>({
    queryKey: ["/api/app-costs"],
    staleTime: 10 * 60 * 1000,
  });

  if (!data) return null;
  const usd = (n: number) => `$${(n || 0).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center justify-between">
          <span>App &amp; AI running costs</span>
          <span className="text-xs font-normal text-muted-foreground">
            {usd(data.monthUsd)} this month · {usd(data.fytdUsd)} FYTD
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">By provider (this month)</p>
            <div className="space-y-0.5">
              {data.byProvider.length === 0 && <p className="text-sm text-muted-foreground">No AI calls metered yet — data accrues from the next deploy onwards.</p>}
              {data.byProvider.map((p, i) => (
                <div key={i} className="flex items-center justify-between text-sm py-0.5">
                  <span className="truncate pr-3">
                    {p.provider} <span className="text-muted-foreground text-xs">· {p.model} · {p.calls.toLocaleString()} call(s){p.images ? ` · ${p.images} image(s)` : ""}</span>
                  </span>
                  <span className="font-mono shrink-0">{usd(p.usd)}</span>
                </div>
              ))}
            </div>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">By feature (this month)</p>
            <div className="space-y-0.5">
              {data.byFeature.map((f, i) => (
                <div key={i} className="flex items-center justify-between text-sm py-0.5">
                  <span className="truncate pr-3">{f.feature} <span className="text-muted-foreground text-xs">· {f.calls.toLocaleString()} call(s)</span></span>
                  <span className="font-mono shrink-0">{usd(f.usd)}</span>
                </div>
              ))}
            </div>
            {data.scraperapi && (
              <p className="text-xs text-muted-foreground pt-2">
                ScraperAPI: {data.scraperapi.requestCount?.toLocaleString() ?? "?"} / {data.scraperapi.requestLimit?.toLocaleString() ?? "?"} credits used
                {data.scraperapi.subscriptionName ? ` (${data.scraperapi.subscriptionName})` : ""}.
              </p>
            )}
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground border-t pt-2">
          {data.meteredFrom}
          {data.monthUnpricedImages > 0 ? ` ${data.monthUnpricedImages} image generation(s) this month aren't priced — set AI_IMAGE_COST_USD_GEMINI / AI_IMAGE_COST_USD_OPENAI to include them.` : ""}
          {" "}{data.monthTokens > 0 ? `${(data.monthTokens / 1_000_000).toFixed(1)}M tokens this month.` : ""}
        </p>
      </CardContent>
    </Card>
  );
}

// Costs & forecast — the other half of the projection. Income forecasting
// comes from the WIP pipeline; this is the cost base (per-account P&L lines),
// a run-rate projection to FY end (Wendy doesn't budget in Xero, so the
// forecast is trailing-average based), committed bills, and near-term cash
// flow both directions.
function CostsSection({ costs, creditors, cashflow, recurring, projection }: {
  costs: NonNullable<Financials["costs"]>;
  creditors?: Financials["creditors"];
  cashflow?: Financials["cashflow"];
  recurring?: Financials["recurring"];
  projection?: Financials["projection"];
}) {
  const cf = cashflow;
  const cfCols = cf ? [
    { label: "Overdue", in: cf.receiptsDue.overdue, out: cf.billsDue.overdue },
    { label: "This month", in: cf.receiptsDue.thisMonth, out: cf.billsDue.thisMonth },
    { label: "Next month", in: cf.receiptsDue.nextMonth, out: cf.billsDue.nextMonth },
    { label: "Later", in: cf.receiptsDue.later, out: cf.billsDue.later },
  ] : [];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          label="Cost run rate"
          value={`${money(costs.runRate)}/mo`}
          sub={costs.runRateBasisMonths > 0 ? `Avg of last ${costs.runRateBasisMonths} full month(s)` : "Current month so far"}
        />
        <StatCard
          label="Projected FY costs"
          value={money(costs.projectedFyCosts)}
          sub={`${money(costs.fytdExpenses)} to date + ${costs.monthsRemaining} mo at run rate`}
        />
        {projection?.projectedNet != null && (
          <StatCard
            label="Projected FY net"
            value={money(projection.projectedNet)}
            negative={projection.projectedNet < 0}
            sub={`Projected income ${money(projection.total)} − costs`}
          />
        )}
        {creditors && (
          <StatCard
            label="Bills outstanding"
            value={money(creditors.outstanding)}
            negative={creditors.buckets.overdue > 0}
            sub={creditors.buckets.overdue > 0 ? `${money(creditors.buckets.overdue)} overdue` : `${creditors.billCount} open bill(s)`}
          />
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Where the money goes */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Where the money goes — FY to date</CardTitle>
          </CardHeader>
          <CardContent className="space-y-0.5">
            {costs.topLines.map((c, i) => (
              <div key={i} className="flex items-center gap-2 text-sm py-0.5">
                <span className="truncate flex-1">{c.label}</span>
                <span className="text-[11px] text-muted-foreground w-9 text-right shrink-0">{c.share}%</span>
                <span className="font-mono shrink-0 w-24 text-right">{money(c.fytd)}</span>
              </div>
            ))}
            {costs.movers.length > 0 && (
              <div className="pt-3">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">Biggest movers vs 3-month average</p>
                {costs.movers.map((m, i) => (
                  <div key={i} className="flex items-center justify-between text-sm py-0.5">
                    <span className="truncate pr-3">{m.label}</span>
                    <span className={`font-mono shrink-0 ${m.delta > 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}`}>
                      {m.delta > 0 ? "+" : ""}{money(m.delta)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          {/* Near-term cash flow */}
          {cf && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Cash due in vs out</CardTitle></CardHeader>
              <CardContent>
                <div className="grid grid-cols-4 gap-2 text-center">
                  {cfCols.map((c, i) => (
                    <div key={i} className="rounded-md border p-2">
                      <p className="text-[10px] text-muted-foreground">{c.label}</p>
                      <p className="text-xs font-mono text-emerald-600 dark:text-emerald-400">+{money(c.in)}</p>
                      <p className="text-xs font-mono text-red-600 dark:text-red-400">−{money(c.out)}</p>
                    </div>
                  ))}
                </div>
                <p className="text-[11px] text-muted-foreground mt-2">
                  Invoices due in vs bills due out, by due date. Bills are already inside the P&L cost figures — this is timing, not extra cost.
                </p>
              </CardContent>
            </Card>
          )}

          {/* Largest open bills */}
          {creditors && creditors.top.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center justify-between">
                  <span>Largest open bills</span>
                  <Badge variant="secondary" className="text-[10px]">{creditors.billCount} bill(s)</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-0.5">
                {creditors.top.map((b, i) => (
                  <div key={i} className="flex items-center justify-between text-sm py-0.5">
                    <span className="truncate pr-3">{b.contact} <span className="text-muted-foreground text-xs">{b.number}{b.due ? ` · due ${formatDate(b.due)}` : ""}</span></span>
                    <span className="font-mono shrink-0">{money(b.amount)}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Recurring commitments */}
          {recurring && (recurring.monthlyBills > 0 || recurring.bills.length > 0) && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center justify-between">
                  <span>Recurring commitments</span>
                  <Badge variant="secondary" className="text-[10px]">{money(recurring.monthlyBills)}/mo</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-0.5">
                {recurring.bills.map((r, i) => (
                  <div key={i} className="flex items-center justify-between text-sm py-0.5">
                    <span className="truncate pr-3">{r.contact}{r.reference ? <span className="text-muted-foreground text-xs"> · {r.reference}</span> : null}</span>
                    <span className="font-mono shrink-0">{money(r.monthly)}/mo</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

export default function FinancePage() {
  const { toast } = useToast();
  const { data, isLoading, isFetching, refetch, error } = useQuery<Financials>({
    queryKey: ["/api/xero/financials"],
    staleTime: 5 * 60 * 1000,
  });

  // The Xero OAuth callback lands back here with ?xero=connected or
  // ?xero_error=… — surface the outcome and, on success, force a live
  // pull so the page doesn't keep showing the cached pre-connect state.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ok = params.get("xero");
    const err = params.get("xero_error");
    if (!ok && !err) return;
    window.history.replaceState({}, "", "/finance");
    if (ok === "connected") {
      toast({ title: "Xero connected", description: "Pulling fresh figures from Xero…" });
      fetch("/api/xero/financials?refresh=1", { credentials: "include", headers: getAuthHeaders() })
        .catch(() => {})
        .finally(() => refetch());
    } else if (err) {
      toast({ title: "Xero connection failed", description: decodeURIComponent(err), variant: "destructive" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hardRefresh = async () => {
    await fetch("/api/xero/financials?refresh=1", { credentials: "include", headers: getAuthHeaders() });
    refetch();
  };

  if (isLoading) {
    return (
      <div className="max-w-6xl mx-auto p-4 sm:p-6 space-y-4">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-24" />)}
        </div>
        <Skeleton className="h-[300px]" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="max-w-2xl mx-auto p-6">
        <Card><CardContent className="p-6 text-sm text-muted-foreground">
          Couldn't load financials{error ? ` — ${(error as Error).message}` : ""}. Try again shortly.
        </CardContent></Card>
      </div>
    );
  }

  if (data.notConnected || data.needsReconnect) {
    return (
      <div className="max-w-6xl mx-auto p-4 sm:p-6 space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">Company Finance</h1>
        <Card>
          <CardContent className="p-6 space-y-3">
            <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
              <AlertTriangle className="w-4 h-4" />
              <p className="text-sm font-medium">{data.needsReconnect ? "Xero needs reconnecting" : "Xero isn't connected"}</p>
            </div>
            <p className="text-sm text-muted-foreground">{data.message}</p>
            <Button onClick={() => { window.location.href = "/api/xero/connect"; }} data-testid="button-finance-connect-xero">
              <ExternalLink className="w-4 h-4 mr-2" />
              {data.needsReconnect ? "Reconnect Xero" : "Connect Xero"}
            </Button>
          </CardContent>
        </Card>
        {/* The pipeline + commission halves come from the CRM, so they work
            regardless of the Xero connection state. */}
        {data.wip && <WipSection wip={data.wip} />}
        {data.commissions && data.commissions.statements.length > 0 && (
          <CommissionSection commissions={data.commissions} />
        )}
      </div>
    );
  }

  const h = data.headline || { income: null, grossProfit: null, operatingExpenses: null, netProfit: null };
  const d = data.debtors;

  return (
    <div className="max-w-6xl mx-auto p-4 sm:p-6 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Landmark className="w-6 h-6 text-primary" /> Company Finance
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {data.orgName} · financial year from {formatDate(data.fyStart)} · as at {formatDate(data.asAt)} · live from Xero
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={hardRefresh} disabled={isFetching} data-testid="button-finance-refresh">
          <RefreshCw className={`w-4 h-4 mr-1 ${isFetching ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      {/* Headline stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Income FYTD" value={money(h.income)} />
        <StatCard
          label="Net profit FYTD"
          value={money(h.netProfit)}
          negative={(h.netProfit ?? 0) < 0}
          sub={h.operatingExpenses != null ? `Expenses ${money(h.operatingExpenses)}` : undefined}
        />
        <StatCard label="Cash at bank" value={money(data.cashTotal)} sub={`${data.bankAccounts?.length || 0} account(s)`} />
        <StatCard
          label="Debtors outstanding"
          value={money(d?.outstanding)}
          negative={(d?.overdue ?? 0) > 0}
          sub={d ? `${money(d.overdue)} overdue` : undefined}
        />
      </div>

      {/* WIP pipeline + projection (CRM ⇄ Xero cross-reference) */}
      {data.wip && <WipSection wip={data.wip} projection={data.projection} />}

      {/* WIP data health — how trustworthy the projections above are. */}
      {data.wip?.health && data.wip.health.affectedCount > 0 && (
        <Link href="/wip-report">
          <Card className="border-amber-300 bg-amber-50 dark:bg-amber-950/20 cursor-pointer hover:border-amber-400 transition-colors">
            <CardContent className="p-4 flex items-start gap-3">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <div className="text-sm">
                <p className="font-medium text-amber-900 dark:text-amber-200">
                  {data.wip.health.affectedCount} deal(s) worth {money(data.wip.health.affectedFee)} have broken links — the projections above may undercount or misattribute them.
                </p>
                <p className="text-xs text-amber-800/80 dark:text-amber-300/70 mt-0.5">
                  {[
                    data.wip.health.noClient ? `${data.wip.health.noClient} without a client` : null,
                    data.wip.health.noAgent ? `${data.wip.health.noAgent} without an agent` : null,
                    data.wip.health.noDate ? `${data.wip.health.noDate} undated` : null,
                    data.wip.health.invNoXero ? `${data.wip.health.invNoXero} invoiced with no Xero link` : null,
                    data.wip.health.noFee ? `${data.wip.health.noFee} live with no fee` : null,
                  ].filter(Boolean).join(" · ")} — open WIP report → Needs Attention to fix.
                </p>
              </div>
            </CardContent>
          </Card>
        </Link>
      )}

      {/* Costs & forecast — cost base, run-rate projection, bills, cash flow */}
      {data.costs && (
        <CostsSection
          costs={data.costs}
          creditors={data.creditors}
          cashflow={data.cashflow}
          recurring={data.recurring}
          projection={data.projection}
        />
      )}

      {/* Paid this FY — when the client's money actually landed. */}
      {data.paid && data.paid.count > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center justify-between">
                <span>Paid this year</span>
                <Badge variant="secondary" className="text-[10px]">{data.paid.count} invoice(s) · {money(data.paid.totalPaid)} ex VAT</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-0.5">
              {data.paid.recent.map((p, i) => {
                const row = (
                  <div className={`flex items-center justify-between text-sm py-1 px-1 -mx-1 rounded ${p.dealId ? "hover:bg-muted cursor-pointer" : ""}`}>
                    <span className="truncate pr-3">
                      {p.label}
                      <span className="text-muted-foreground text-xs">
                        {p.number ? ` · ${p.number}` : ""}{p.paidOn ? ` · paid ${formatDate(p.paidOn)}` : ""}
                      </span>
                    </span>
                    <span className="font-mono shrink-0">{money(p.amount)}</span>
                  </div>
                );
                return p.dealId
                  ? <Link key={i} href={`/deals/${p.dealId}`}>{row}</Link>
                  : <div key={i}>{row}</div>;
              })}
              {data.paid.unmatchedCount > 0 && (
                <p className="text-[11px] text-muted-foreground pt-2">
                  {data.paid.unmatchedCount} paid invoice(s) aren't linked to a deal in the app (raised directly in Xero).
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Cash collected</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-semibold tracking-tight">{money(data.paid.totalPaid)}</p>
              <p className="text-xs text-muted-foreground mt-1">
                {data.paid.count} invoice(s) fully paid this financial year (ex VAT). Commission statements below pay out at month-end payroll once these land.
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Commission statements — Woody's tiered scheme */}
      {data.commissions && data.commissions.statements.length > 0 && (
        <CommissionSection commissions={data.commissions} />
      )}

      {/* Company card spend — the Expenses workflow's headline numbers,
          with jump-offs into the queues. */}
      {data.spend && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard label="Card spend this month" value={money(data.spend.monthSpend)} sub="Business spend, ex personal" />
          <StatCard label="Card spend FYTD" value={money(data.spend.fytdSpend)} />
          <Link href="/expenses">
            <div className="cursor-pointer h-full">
              <StatCard
                label="Receipts missing"
                value={String(data.spend.pendingReceipts.count)}
                sub={`${money(data.spend.pendingReceipts.total)} unreceipted → Expenses`}
                negative={data.spend.pendingReceipts.count > 0}
              />
            </div>
          </Link>
          <Link href="/expenses/approvals">
            <div className="cursor-pointer h-full">
              <StatCard
                label="Awaiting approval"
                value={String(data.spend.pendingApprovals.count)}
                sub={`${money(data.spend.pendingApprovals.total)} queued → Approvals`}
                negative={data.spend.pendingApprovals.count > 0}
              />
            </div>
          </Link>
        </div>
      )}

      {/* Monthly P&L chart */}
      {(data.monthly?.length || 0) > 1 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2"><TrendingUp className="w-4 h-4" /> Month by month</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={data.monthly}>
                  <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => `£${(v / 1000).toFixed(0)}k`} />
                  <Tooltip formatter={(v: any) => money(Number(v))} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="income" name="Income" fill="#10b981" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="expenses" name="Expenses" fill="#f59e0b" radius={[3, 3, 0, 0]} />
                  <Line dataKey="netProfit" name="Net profit" stroke="#6366f1" strokeWidth={2} dot={{ r: 3 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* P&L summary */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Profit &amp; Loss — financial year to date</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {(data.pnlSections || []).filter(s => s.rows.length > 0).map((sec, i) => (
              <div key={i}>
                {sec.title && <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">{sec.title}</p>}
                <div className="space-y-0.5">
                  {sec.rows.map((r, j) => (
                    <div key={j} className={`flex items-center justify-between text-sm py-0.5 ${r.isTotal ? "font-semibold border-t mt-1 pt-1" : ""}`}>
                      <span className="truncate pr-3">{r.label}</span>
                      <span className="font-mono shrink-0">{money(r.values[0])}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <div className="space-y-4">
          {/* Bank accounts */}
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Banknote className="w-4 h-4" /> Cash position</CardTitle></CardHeader>
            <CardContent className="space-y-1">
              {(data.bankAccounts || []).map((a, i) => (
                <div key={i} className="flex items-center justify-between text-sm py-0.5">
                  <span className="truncate pr-3">{a.name}</span>
                  <span className="font-mono shrink-0">{money(a.balance)}</span>
                </div>
              ))}
              <div className="flex items-center justify-between text-sm font-semibold border-t mt-1 pt-1.5">
                <span>Total cash</span>
                <span className="font-mono">{money(data.cashTotal)}</span>
              </div>
              {data.balanceSheet?.netAssets != null && (
                <p className="text-xs text-muted-foreground pt-2">
                  Net assets {money(data.balanceSheet.netAssets)}
                  {data.balanceSheet.totalAssets != null ? ` · total assets ${money(data.balanceSheet.totalAssets)}` : ""}
                </p>
              )}
            </CardContent>
          </Card>

          {/* Aged debtors */}
          {d && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center justify-between">
                  <span>Aged debtors</span>
                  <Badge variant="secondary" className="text-[10px]">{d.invoiceCount} open invoice(s)</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-4 gap-2 text-center">
                  {[
                    { label: "Current", v: d.buckets.current },
                    { label: "1–30d", v: d.buckets.d1to30 },
                    { label: "31–60d", v: d.buckets.d31to60 },
                    { label: "60d+", v: d.buckets.d60plus },
                  ].map((b, i) => (
                    <div key={i} className="rounded-md border p-2">
                      <p className="text-[10px] text-muted-foreground">{b.label}</p>
                      <p className={`text-sm font-semibold font-mono ${i >= 2 && b.v > 0 ? "text-red-600 dark:text-red-400" : ""}`}>{money(b.v)}</p>
                    </div>
                  ))}
                </div>
                {d.top.length > 0 && (
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">Largest overdue</p>
                    <div className="space-y-0.5">
                      {d.top.map((inv, i) => (
                        <div key={i} className="flex items-center justify-between text-sm py-0.5">
                          <span className="truncate pr-3">{inv.contact} <span className="text-muted-foreground text-xs">{inv.number}{inv.due ? ` · due ${formatDate(inv.due)}` : ""}</span></span>
                          <span className="font-mono shrink-0">{money(inv.amount)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* What the app itself costs to run (AI + data APIs) */}
      <AppCostsSection />

      {data.fetchedAt && (
        <p className="text-[11px] text-muted-foreground">Snapshot fetched {new Date(data.fetchedAt).toLocaleTimeString("en-GB")} · cached 15 min · Refresh forces a live pull.</p>
      )}
    </div>
  );
}
