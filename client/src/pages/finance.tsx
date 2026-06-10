// Company Finance — the firm's actual financial position pulled live from
// Xero (admin-only): FY-to-date P&L, cash at bank, balance sheet headline,
// aged debtors. Data comes from /api/xero/financials (system Xero session,
// cached 15 min server-side).
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { getAuthHeaders } from "@/lib/queryClient";
import { formatDate } from "@/lib/format";
import { RefreshCw, Landmark, TrendingUp, Banknote, AlertTriangle, ExternalLink } from "lucide-react";
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from "recharts";

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

export default function FinancePage() {
  const { data, isLoading, isFetching, refetch, error } = useQuery<Financials>({
    queryKey: ["/api/xero/financials"],
    staleTime: 5 * 60 * 1000,
  });

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
      <div className="max-w-2xl mx-auto p-6 space-y-4">
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

      {data.fetchedAt && (
        <p className="text-[11px] text-muted-foreground">Snapshot fetched {new Date(data.fetchedAt).toLocaleTimeString("en-GB")} · cached 15 min · Refresh forces a live pull.</p>
      )}
    </div>
  );
}
