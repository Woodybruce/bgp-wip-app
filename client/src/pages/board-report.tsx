import { useQuery } from "@tanstack/react-query";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line, Area, AreaChart,
} from "recharts";
import { TrendingUp, DollarSign, Target, Clock, Printer, RefreshCw, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getAuthHeaders } from "@/lib/queryClient";

const COLORS = [
  "#818cf8", "#a78bfa", "#c084fc", "#e879f9", "#f472b6",
  "#fb7185", "#f97316", "#facc15", "#4ade80", "#34d399",
  "#22d3ee", "#38bdf8", "#60a5fa", "#6366f1", "#8b5cf6",
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
    <div className="bg-[#1a1a2e] border border-[#2a2a4a] rounded-xl p-6 flex flex-col gap-2" data-testid={`kpi-${label.toLowerCase().replace(/\s/g, "-")}`}>
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-[#2a2a4a] flex items-center justify-center">
          <Icon className="w-5 h-5 text-indigo-400" />
        </div>
        <span className="text-sm text-gray-400 font-medium tracking-wide uppercase">{label}</span>
      </div>
      <div className="text-3xl font-bold text-white tracking-tight mt-1">{value}</div>
      {sub && <div className="text-xs text-gray-500">{sub}</div>}
    </div>
  );
}

function ChartCard({ title, children, className = "" }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-[#1a1a2e] border border-[#2a2a4a] rounded-xl p-6 ${className}`} data-testid={`chart-${title.toLowerCase().replace(/\s/g, "-")}`}>
      <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-4">{title}</h3>
      {children}
    </div>
  );
}

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-[#0f0f23] border border-[#2a2a4a] rounded-lg px-3 py-2 shadow-xl">
      <p className="text-xs text-gray-400 mb-1">{label}</p>
      {payload.map((p: any, i: number) => (
        <p key={i} className="text-sm font-semibold" style={{ color: p.color || "#818cf8" }}>
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
      <div className="min-h-screen bg-[#0f0f23] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-gray-400 text-sm">Generating board report...</p>
        </div>
      </div>
    );
  }

  const generatedDate = new Date(data.generatedAt).toLocaleDateString("en-GB", {
    day: "numeric", month: "long", year: "numeric",
  });

  return (
    <div className="board-report min-h-screen bg-[#0f0f23] text-white">
      <style>{`
        @media print {
          body { background: #0f0f23 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .board-report { padding: 0 !important; }
          .no-print { display: none !important; }
          .print-break { page-break-before: always; }
          .board-report * { color-adjust: exact; -webkit-print-color-adjust: exact; }
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
              className="border-white/20 text-white/80 hover:bg-white/10 hover:text-white"
              data-testid="button-refresh"
            >
              <RefreshCw className="w-4 h-4 mr-2" /> Refresh
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleExportExcel}
              className="border-white/20 text-white/80 hover:bg-white/10 hover:text-white"
              data-testid="button-export-excel"
            >
              <Download className="w-4 h-4 mr-2" /> Download Excel
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.print()}
              className="border-white/20 text-white/80 hover:bg-white/10 hover:text-white"
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
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e1e3a" horizontal={false} />
                  <XAxis type="number" tick={{ fill: "#6b7280", fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="name" tick={{ fill: "#9ca3af", fontSize: 11 }} width={100} axisLine={false} tickLine={false} />
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
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e1e3a" horizontal={false} />
                  <XAxis type="number" tick={{ fill: "#6b7280", fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="name" tick={{ fill: "#9ca3af", fontSize: 11 }} width={120} axisLine={false} tickLine={false} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="value" fill="#818cf8" radius={[0, 4, 4, 0]} maxBarSize={28} />
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
                <div key={entry.name} className="flex items-center gap-1.5 text-xs text-gray-400">
                  <div className="w-2.5 h-2.5 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
                  {entry.name} ({entry.value})
                </div>
              ))}
            </div>
          </ChartCard>

          <ChartCard title="Pipeline by Asset Class">
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.pipeline.byAssetClass.slice(0, 10)} margin={{ left: 0, right: 20, bottom: 60 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e1e3a" vertical={false} />
                  <XAxis
                    dataKey="name"
                    tick={{ fill: "#9ca3af", fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                    angle={-45}
                    textAnchor="end"
                    height={70}
                  />
                  <YAxis tick={{ fill: "#6b7280", fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="value" fill="#a78bfa" radius={[4, 4, 0, 0]} maxBarSize={36} />
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
                      <stop offset="5%" stopColor="#818cf8" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#818cf8" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e1e3a" vertical={false} />
                  <XAxis
                    dataKey="month"
                    tickFormatter={formatMonth}
                    tick={{ fill: "#9ca3af", fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tickFormatter={(v) => formatCurrency(v)}
                    tick={{ fill: "#6b7280", fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Area type="monotone" dataKey="total" stroke="#818cf8" strokeWidth={2} fill="url(#feeGradient)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </ChartCard>

          <ChartCard title="Time to Close Distribution">
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.performance.timeToCloseBuckets} margin={{ left: 0, right: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e1e3a" vertical={false} />
                  <XAxis dataKey="range" tick={{ fill: "#9ca3af", fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: "#6b7280", fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="count" fill="#22d3ee" radius={[4, 4, 0, 0]} maxBarSize={40}>
                    {data.performance.timeToCloseBuckets.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="text-xs text-gray-500 mt-2 text-center">Days from deal creation to completion</p>
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
                      <span className="text-gray-300 truncate max-w-[200px]" title={deal.name}>
                        <span className="text-gray-500 mr-2">{i + 1}.</span>
                        {deal.name}
                      </span>
                      <span className="text-white font-semibold">{formatCurrency(deal.fee)}</span>
                    </div>
                    <div className="h-1.5 bg-[#2a2a4a] rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-700"
                        style={{ width: `${pct}%`, background: COLORS[i % COLORS.length] }}
                      />
                    </div>
                    <div className="flex gap-2 mt-0.5">
                      {deal.team && <span className="text-[10px] text-gray-500">{deal.team}</span>}
                      {deal.dealType && <span className="text-[10px] text-gray-500">· {deal.dealType}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </ChartCard>

          <ChartCard title={`Market Insights — Last 30 Days (${data.marketInsights.totalArticles} articles)`}>
            <div className="mb-5">
              <h4 className="text-xs text-gray-500 uppercase tracking-wider mb-3">Trending Topics</h4>
              <div className="flex flex-wrap gap-2">
                {data.marketInsights.trendingTags.map((t, i) => (
                  <span
                    key={t.tag}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border border-[#2a2a4a]"
                    style={{ color: COLORS[i % COLORS.length], borderColor: `${COLORS[i % COLORS.length]}33` }}
                    data-testid={`tag-trending-${i}`}
                  >
                    {t.tag}
                    <span className="text-gray-500 text-[10px]">{t.count}</span>
                  </span>
                ))}
              </div>
            </div>
            <div>
              <h4 className="text-xs text-gray-500 uppercase tracking-wider mb-3">Category Breakdown</h4>
              <div className="space-y-2">
                {data.marketInsights.categoryBreakdown.map((cat, i) => {
                  const max = data.marketInsights.categoryBreakdown[0]?.count || 1;
                  return (
                    <div key={cat.category}>
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="text-gray-300">{cat.category}</span>
                        <span className="text-gray-500">{cat.count}</span>
                      </div>
                      <div className="h-1.5 bg-[#2a2a4a] rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${(cat.count / max) * 100}%`, background: COLORS[i % COLORS.length] }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </ChartCard>
        </div>

        <div className="text-center text-xs text-gray-600 py-6 border-t border-[#1e1e3a]">
          Generated {generatedDate} · Bruce Gillingham Pollard · Confidential
        </div>
      </div>
    </div>
  );
}
