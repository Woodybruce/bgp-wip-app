// Company Finance — the firm's actual financial position pulled live from
// Xero (admin-only): FY-to-date P&L, cash at bank, balance sheet headline,
// aged debtors. Data comes from /api/xero/financials (system Xero session,
// cached 15 min server-side).
import { useQuery } from "@tanstack/react-query";
import { CashflowBoardSection } from "@/components/cashflow-board";
import { CompanyOutlookSection, DisclosureRow } from "@/components/company-outlook";
import { cashflowFetch } from "@/lib/cashflow-model";
import { HistoricalBillingsSection } from "@/components/historical-billings";
import { PartnerRemunerationSection } from "@/components/partner-remuneration";
import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getAuthHeaders } from "@/lib/queryClient";
import { formatDate } from "@/lib/format";
import { RefreshCw, AlertTriangle, ExternalLink } from "lucide-react";

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

// Headline stat as the same disclosure row every other expandable number
// on the page uses (Woody, 2026-08-29: "all needs some uniformity").
// While open the row spans the full grid so the detail isn't crushed.
function ExpandableStat({ label, value, sub, negative, children }: {
  label: string; value: string; sub?: string; negative?: boolean; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const slug = label.toLowerCase().replace(/\s+/g, "-");
  return (
    <div className={open ? "md:col-span-2" : ""}>
      <DisclosureRow
        id={`stat-${slug}`}
        title={label}
        sub={sub}
        headline={value}
        negative={negative}
        open={open}
        onToggle={() => setOpen(o => !o)}
      >
        {children}
      </DisclosureRow>
    </div>
  );
}

// (The "Completed, not yet invoiced" card was retired 2026-08-29 — the
// outlook's "Completed, to invoice" deal-book row opens to the same deals.)

// Commission statements — the tiered scheme: billings (agent's fee split,
// after BGP House's 15%) accumulate from 1 May in fee-due order; 0% to 2×
// salary, then 30% / 40% / 50% bands; payable at month-end payroll once
// the client has paid.
function CommissionSection({ commissions }: { commissions: NonNullable<Financials["commissions"]> }) {
  const [openAgent, setOpenAgent] = useState<string | null>(null);
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center justify-between">
          <span>Commission statements</span>
          <span className="text-xs font-normal text-muted-foreground">FY from {formatDate(commissions.fyStart)}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {commissions.statements.map((s) => {
          const pct = s.multiple != null ? Math.min((s.multiple / 4) * 100, 100) : 0;
          const slug = s.agent.toLowerCase().replace(/\s+/g, "-");
          return (
            <div key={s.agent} data-testid={`commission-statement-${slug}`}>
              <DisclosureRow
                id={`agent-${slug}`}
                title={s.agent}
                sub={s.multiple != null
                  ? `Billings ${money(s.billings)} · ${s.multiple}× salary · ${Math.round(s.currentRate * 100)}% band`
                  : `Billings ${money(s.billings)} · no salary on file`}
                headline={s.payable > 0 ? `${money(s.payable)} due` : money(s.earned)}
                open={openAgent === slug}
                onToggle={() => setOpenAgent(o => (o === slug ? null : slug))}
              >
                <div className="space-y-2">
                  <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
                    <span>Earned <span className="font-mono font-medium text-foreground">{money(s.earned)}</span></span>
                    <span>Payable <span className="font-mono font-medium text-emerald-600 dark:text-emerald-400">{money(s.payable)}</span></span>
                    {s.awaitingPayment > 0 && (
                      <span>Awaiting client <span className="font-mono font-medium text-amber-600 dark:text-amber-400">{money(s.awaitingPayment)}</span></span>
                    )}
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
                  {s.deals.length > 0 && (
                    <div className="space-y-0.5">
                      {s.deals.map(d => (
                        <Link key={d.id} href={`/deals/${d.id}`}>
                          <div className="flex items-center justify-between gap-3 text-xs py-1 px-1 -mx-1 rounded hover:bg-muted cursor-pointer">
                            <span className="truncate">{d.name}</span>
                            <span className="font-mono tabular-nums shrink-0 text-muted-foreground">
                              {money(d.billing)} → {money(d.commission)}
                              <span className={`ml-1.5 text-[10px] ${d.clientPaid ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}>{d.clientPaid ? "paid" : "awaiting"}</span>
                            </span>
                          </div>
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              </DisclosureRow>
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

// (The cash-management block — Bills outstanding, Cash due in vs out,
// largest open bills, recurring commitments — was retired 2026-08-29.
// Woody: double counting and dead data (BGP doesn't run bills through
// Xero, so AP was always £0, and cash due in duplicated the Debtors
// dropdown). The Debtors headline stat is the one receivables view.)

export default function FinancePage() {
  const { toast } = useToast();
  const { data, isLoading, isFetching, refetch, error } = useQuery<Financials>({
    queryKey: ["/api/xero/financials"],
    staleTime: 5 * 60 * 1000,
  });

  // Pre-Xero (Sage-era) receivables — the editable LEGACY line on the
  // cashflow board below. Woody, 2026-08-28: the Debtors card must show
  // Xero + Sage together; he types the confirmed Sage figure on the board.
  const { data: cfData } = useQuery<{ lines: Array<{ id: string; key: string }>; cells: Array<{ line_id: string; month: string; basis: string; amount: number }> }>({
    queryKey: ["/api/cashflow"],
    queryFn: async () => (await cashflowFetch("GET", "/api/cashflow")).json(),
    staleTime: 5 * 60 * 1000,
  });
  const sageOutstanding = useMemo(() => {
    const line = cfData?.lines?.find(l => l.key === "LEGACY");
    if (!line) return 0;
    const byMonth: Record<string, { a?: number; b?: number }> = {};
    for (const c of cfData!.cells || []) {
      if (c.line_id !== line.id) continue;
      (byMonth[c.month] ||= {})[c.basis === "actual" ? "a" : "b"] = Number(c.amount) || 0;
    }
    return Object.values(byMonth).reduce((s, m) => s + (m.a ?? m.b ?? 0), 0);
  }, [cfData]);

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
        {/* The pipeline, commission and cashflow-forecast halves come from
            the CRM / local DB, so they work regardless of the Xero
            connection state. */}
        <CompanyOutlookSection />
        <CashflowBoardSection />
        <HistoricalBillingsSection />
        <PartnerRemunerationSection />
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
          <h1 className="text-2xl font-semibold tracking-tight">
            Company Finance
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {data.orgName} · financial year from {formatDate(data.fyStart)} · as at {formatDate(data.asAt)} · live from Xero
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={hardRefresh} disabled={isFetching} data-testid="button-finance-refresh">
          <RefreshCw className={`w-4 h-4 mr-1 ${isFetching ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      {/* Headline stats — tap a row to see what's behind the number */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 items-start">
        <ExpandableStat label="Income FYTD" value={money(h.income)} sub="Tap for the invoices">
          {data.paid && data.paid.count > 0 ? (
            <div className="space-y-0.5">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground pb-1">Paid this year · {data.paid.count} invoice(s) · {money(data.paid.totalPaid)}</p>
              {data.paid.recent.map((p, i) => {
                const row = (
                  <div className={`flex items-center justify-between text-sm py-1 px-1 -mx-1 rounded ${p.dealId ? "hover:bg-muted cursor-pointer" : ""}`}>
                    <span className="truncate pr-3">
                      {p.label}
                      <span className="text-muted-foreground text-xs">{p.number ? ` · ${p.number}` : ""}{p.paidOn ? ` · paid ${formatDate(p.paidOn)}` : ""}</span>
                    </span>
                    <span className="font-mono shrink-0">{money(p.amount)}</span>
                  </div>
                );
                return p.dealId ? <Link key={i} href={`/deals/${p.dealId}`}>{row}</Link> : <div key={i}>{row}</div>;
              })}
              <p className="text-[11px] text-muted-foreground pt-2">
                The rest of the FYTD income is invoiced but unpaid — it's in Debtors outstanding.
                {data.paid.unmatchedCount > 0 ? ` ${data.paid.unmatchedCount} paid invoice(s) aren't linked to a deal in the app (raised directly in Xero).` : ""}
              </p>
            </div>
          ) : <p className="text-xs text-muted-foreground">No fully paid invoices this financial year yet.</p>}
        </ExpandableStat>
        <ExpandableStat
          label="Net profit FYTD"
          value={money(h.netProfit)}
          negative={(h.netProfit ?? 0) < 0}
          sub={h.operatingExpenses != null ? `Expenses ${money(h.operatingExpenses)}` : "Tap for the P&L"}
        >
          <div className="space-y-3">
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
            {(data.pnlSections || []).length === 0 && <p className="text-xs text-muted-foreground">P&L lines unavailable right now.</p>}
          </div>
        </ExpandableStat>
        <ExpandableStat label="Cash at bank" value={money(data.cashTotal)} sub={`${data.bankAccounts?.length || 0} account(s) — tap to list`}>
          <div className="space-y-1">
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
          </div>
        </ExpandableStat>
        <ExpandableStat
          label="Debtors outstanding"
          value={money((d?.outstanding ?? 0) + sageOutstanding)}
          negative={(d?.overdue ?? 0) > 0}
          sub={`${money(d?.overdue ?? 0)} overdue · pre-Xero (Sage) ${money(sageOutstanding)}`}
        >
          {d ? (
            <div className="space-y-3">
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
              <p className="text-[11px] text-muted-foreground">
                Plus {money(sageOutstanding)} pre-Xero (Sage) receivables from Wendy's cashflow — edit on the Legacy line of the cashflow board below.
              </p>
            </div>
          ) : <p className="text-xs text-muted-foreground">No open invoices.</p>}
        </ExpandableStat>
      </div>

      {/* Company outlook — front and centre (Woody, 2026-08-28): income
          forecast + actuals, cost base, computed commissions, prior years,
          breakeven and the per-partner picture. Fed the page's own Xero
          numbers as a fallback so it can never disagree with the headline
          cards when the cashflow snapshot hiccups. */}
      <CompanyOutlookSection
        xeroFallback={{
          cashTotal: data.cashTotal ?? null,
          fytdIncome: h.income ?? null,
          fytdExpenses: h.operatingExpenses ?? null,
          monthly: data.monthly || [],
          bankAccounts: data.bankAccounts || [],
        }}
      />

      {/* Cashflow forecast — the app + Xero drive receipts, the typed
          lines below are Wendy's costs plan (Woody, 2026-08-27). */}
      <CashflowBoardSection />
      <HistoricalBillingsSection />
      <PartnerRemunerationSection />

      {/* (Data-health card removed — Woody, 2026-08-23: a weekly fix-list
          email to equity@ replaced it; see runWipHealthEmail. The live list
          stays on WIP report → Needs Attention.) */}

      {/* (The "Paid this year" card moved into the Income FYTD dropdown,
          2026-08-29.) */}

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

      {/* (The bottom P&L / Cash position / Aged debtors grid moved into
          the headline stat dropdowns, 2026-08-29.) */}

      {/* What the app itself costs to run (AI + data APIs) */}
      <AppCostsSection />

      {data.fetchedAt && (
        <p className="text-[11px] text-muted-foreground">Snapshot fetched {new Date(data.fetchedAt).toLocaleTimeString("en-GB")} · cached 15 min · Refresh forces a live pull.</p>
      )}
    </div>
  );
}

