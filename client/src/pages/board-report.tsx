import { useQuery } from "@tanstack/react-query";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line, Area, AreaChart,
} from "recharts";
import { TrendingUp, DollarSign, Target, Clock, Printer, RefreshCw, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { pillMetrics } from "@/components/ui/pill";
import { cn } from "@/lib/utils";
import { getAuthHeaders } from "@/lib/queryClient";

// Chart series palette (deliberate encoding, matches reporting.tsx — not chrome).
const COLORS = [
  "#3b82f6", "#8b5cf6", "#ec4899", "#f97316", "#10b981",
  "#06b6d4", "#eab308", "#ef4444", "#6366f1", "#14b8a6",
];

const STATUS_COLORS: Record<string, string> = {
  "New": "#60a5fa",
  "In Progress": "#818cf8",
  "Under Offer": "#a78bfa",
  "Exchanged": "#4ade80",
  "Invoiced": "#34d399",
  "On Hold": "#facc15",
  "Lost": "#fb7185",
  "Withdrawn": "#f87171",
  "Unknown": "#6b7280",
};

function formatCurrency(value: number): string {
  if (value >= 1_000_000) return `£${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `£${(value / 1_000).toFixed(0)}K`;
  return `£${value.toLocaleString()}`;
}

function formatMonth(month: string): string {
  const [y, m] = month.split("-");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[parseInt(m) - 1]} ${y.slice(2)}`;
}

interface BoardReportData {
  pipeline: {
    byStatus: Array<{ name: string; value: number }>;
    byTeam: Array<{ name: string; value: number }>;
    byDealType: Array<{ name: string; value: number }>;
    byAssetClass: Array<{ name: string; value: number }>;
  };
  performance: {
    totalFeesYTD: number;
    conversionRate: number;
    avgDealSize: number;
    avgTimeToClose: number;
    monthlyFees: Array<{ month: string; total: number }>;
    timeToCloseBuckets: Array<{ range: string; count: number }>;
  };
  topDeals: Array<{ name: string; fee: number; team: string; status: string; dealType: string }>;
  marketInsights: {
    trendingTags: Array<{ tag: string; count: number }>;
    categoryBreakdown: Array<{ category: string; count: number }>;
    totalArticles: number;
  };
  totalDeals: number;
  generatedAt: string;
}

function KPICard({ icon: Icon, label, value, sub }: { icon: any; label: string; value: string; sub?: string }) {
  return (
    <div className="bg-card border border-border rounded-lg p-5 flex flex-col gap-1.5" data-testid={`kpi-${label.toLowerCase().replace(/\s/g, "-")}`}>
      <div className="flex items-center gap-1.5">
        <Icon className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
      </div>
      <div className="text-2xl font-bold font-mono tabular-nums text-foreground tracking-tight">{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

function ChartCard({ title, children, className = "" }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-card border border-border rounded-lg p-6 ${className}`} data-testid={`chart-${title.toLowerCase().replace(/\s/g, "-")}`}>
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-4">{title}</h3>
      {children}
    </div>
  );
}

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-lg px-3 py-2 shadow-lg">
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      {payload.map((p: any, i: number) => (
        <p key={i} className="text-sm font-semibold font-mono tabular-nums text-foreground">
          {typeof p.value === "number" && p.value > 100 ? formatCurrency(p.value) : p.value}
        </p>
      ))}
    </div>
  );
}

export default function BoardReport() {
  const { data, isLoading, refetch } = useQuery<BoardReportData>({
    queryKey: ["/api/board-report"],
  });

  const handleExportExcel = async () => {
    try {
      const res = await fetch("/api/board-report/export-excel", {
        credentials: "include",
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `BGP_Board_Report_${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      console.error("Board report export failed:", err);
    }
  };

  if (isLoading || !data) {
    return (
      <div className="min-h-screen bg-background">
        <div className="max-w-[1400px] mx-auto px-6 py-8 animate-pulse">
          <div className="mb-10">
            <div className="h-7 w-48 rounded bg-muted" />
            <div className="h-4 w-72 rounded bg-muted mt-2" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-28 rounded-lg bg-muted" />
            ))}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="h-[360px] rounded-lg bg-muted" />
            <div className="h-[360px] rounded-lg bg-muted" />
          </div>
        </div>
      </div>
    );
  }

  const generatedDate = new Date(data.generatedAt).toLocaleDateString("en-GB", {
    day: "numeric", month: "long", year: "numeric",
  });

  return (
    <div className="board-report min-h-screen bg-background text-foreground">
      <style>{`
        @media print {
          /* Print pack is always the light/ink rendition, whatever the screen theme. */
          :root {
            --background: 0 0% 100% !important;
            --foreground: 20 10% 12% !important;
            --card: 0 0% 100% !important;
            --card-foreground: 20 10% 12% !important;
            --border: 30 10% 80% !important;
            --muted: 30 10% 94% !important;
            --muted-foreground: 25 8% 35% !important;
            --primary: 25 60% 45% !important;
          }
          body { background: #fff !important; }
          .board-report { background: #fff !important; padding: 0 !important; }
          .board-report, .board-report * {
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          .no-print { display: none !important; }
          .print-break { page-break-before: always; }
        }
      `}</style>

      <div className="max-w-[1400px] mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-10 no-print">
          <div>
            <h1 className="text-2xl font-bold tracking-tight" data-testid="text-board-report-title">Board Report</h1>
            <p className="text-muted-foreground text-sm mt-1">Bruce Gillingham Pollard — {generatedDate}</p>
          </div>
          <div className="flex gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              data-testid="button-refresh"
            >
              <RefreshCw className="w-4 h-4 mr-2" /> Refresh
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleExportExcel}
              data-testid="button-export-excel"
            >
              <Download className="w-4 h-4 mr-2" /> Download Excel
            </Button>
            <Button
              size="sm"
              onClick={() => window.print()}
              data-testid="button-print"
            >
              <Printer className="w-4 h-4 mr-2" /> Print
            </Button>
          </div>
        </div>

        <div className="print:block hidden mb-10">
          <h1 className="text-2xl font-bold tracking-tight">Board Report</h1>
          <p className="text-muted-foreground text-sm mt-1">Bruce Gillingham Pollard — {generatedDate}</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <KPICard icon={DollarSign} label="Fees Billed YTD" value={formatCurrency(data.performance.totalFeesYTD)} sub={`${data.totalDeals} total deals in pipeline`} />
          <KPICard icon={Target} label="Conversion Rate" value={`${data.performance.conversionRate}%`} sub="Completed / Total deals" />
          <KPICard icon={DollarSign} label="Avg Deal Size" value={formatCurrency(data.performance.avgDealSize)} sub="Across all deals with fees" />
          <KPICard icon={Clock} label="Avg Time to Close" value={`${data.performance.avgTimeToClose} days`} sub="Creation to completion" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          <ChartCard title="Pipeline by Status">
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.pipeline.byStatus} layout="vertical" margin={{ left: 10, right: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                  <XAxis type="number" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="name" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} width={100} axisLine={false} tickLine={false} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="value" radius={[0, 4, 4, 0]} maxBarSize={28}>
                    {data.pipeline.byStatus.map((entry, i) => (
                      <Cell key={i} fill={STATUS_COLORS[entry.name] || COLORS[i % COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </ChartCard>

          <ChartCard title="Pipeline by Team">
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.pipeline.byTeam} layout="vertical" margin={{ left: 10, right: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                  <XAxis type="number" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="name" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} width={120} axisLine={false} tickLine={false} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="value" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} maxBarSize={28} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </ChartCard>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6 print-break">
          <ChartCard title="Pipeline by Deal Type">
            <div className="h-[300px] flex items-center justify-center">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={data.pipeline.byDealType}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={110}
                    dataKey="value"
                    paddingAngle={2}
                    stroke="none"
                  >
                    {data.pipeline.byDealType.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip content={<CustomTooltip />} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="flex flex-wrap gap-3 mt-2 justify-center">
              {data.pipeline.byDealType.map((entry, i) => (
                <div key={entry.name} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <div className="w-2.5 h-2.5 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
                  {entry.name} (<span className="font-mono tabular-nums">{entry.value}</span>)
                </div>
              ))}
            </div>
          </ChartCard>

          <ChartCard title="Pipeline by Asset Class">
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.pipeline.byAssetClass.slice(0, 10)} margin={{ left: 0, right: 20, bottom: 60 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis
                    dataKey="name"
                    tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                    angle={-45}
                    textAnchor="end"
                    height={70}
                  />
                  <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="value" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} maxBarSize={36} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </ChartCard>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          <ChartCard title="Monthly Fee Revenue (YTD)">
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data.performance.monthlyFees} margin={{ left: 10, right: 20, top: 10 }}>
                  <defs>
                    <linearGradient id="feeGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis
                    dataKey="month"
                    tickFormatter={formatMonth}
                    tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tickFormatter={(v) => formatCurrency(v)}
                    tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Area type="monotone" dataKey="total" stroke="hsl(var(--primary))" strokeWidth={2} fill="url(#feeGradient)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </ChartCard>

          <ChartCard title="Time to Close Distribution">
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.performance.timeToCloseBuckets} margin={{ left: 0, right: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="range" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="count" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} maxBarSize={40} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="text-[11px] text-muted-foreground mt-2 text-center">Days from deal creation to completion</p>
          </ChartCard>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6 print-break">
          <ChartCard title="Top 10 Deals by Fee">
            <div className="space-y-2">
              {data.topDeals.map((deal, i) => {
                const maxFee = data.topDeals[0]?.fee || 1;
                const pct = (deal.fee / maxFee) * 100;
                return (
                  <div key={i} className="group" data-testid={`row-top-deal-${i}`}>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="text-foreground truncate max-w-[200px]" title={deal.name}>
                        <span className="text-muted-foreground mr-2">{i + 1}.</span>
                        {deal.name}
                      </span>
                      <span className="text-foreground font-semibold font-mono tabular-nums">{formatCurrency(deal.fee)}</span>
                    </div>
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full bg-primary transition-all duration-700"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <div className="flex gap-2 mt-0.5">
                      {deal.team && <span className="text-[10px] text-muted-foreground">{deal.team}</span>}
                      {deal.dealType && <span className="text-[10px] text-muted-foreground">· {deal.dealType}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </ChartCard>

          <ChartCard title={`Market Insights — Last 30 Days (${data.marketInsights.totalArticles} articles)`}>
            <div className="mb-5">
              <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-3">Trending Topics</h4>
              <div className="flex flex-wrap gap-2">
                {data.marketInsights.trendingTags.map((t, i) => (
                  <span
                    key={t.tag}
                    className={cn(pillMetrics, "border border-border text-foreground")}
                    data-testid={`tag-trending-${i}`}
                  >
                    {t.tag}
                    <span className="text-muted-foreground text-[10px] font-mono tabular-nums">{t.count}</span>
                  </span>
                ))}
              </div>
            </div>
            <div>
              <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-3">Category Breakdown</h4>
              <div className="space-y-2">
                {data.marketInsights.categoryBreakdown.map((cat, i) => {
                  const max = data.marketInsights.categoryBreakdown[0]?.count || 1;
                  return (
                    <div key={cat.category}>
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="text-foreground">{cat.category}</span>
                        <span className="text-muted-foreground font-mono tabular-nums">{cat.count}</span>
                      </div>
                      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full bg-primary"
                          style={{ width: `${(cat.count / max) * 100}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </ChartCard>
        </div>

        <div className="text-center text-[11px] text-muted-foreground py-6 border-t border-border">
          Generated {generatedDate} · Bruce Gillingham Pollard · Confidential
        </div>
      </div>
    </div>
  );
}
