import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PageLayout } from "@/components/page-layout";
import { getAuthHeaders } from "@/lib/queryClient";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, AreaChart, Area, Legend,
} from "recharts";
import {
  TrendingUp,
  DollarSign,
  Clock,
  Target,
  Users,
  Building2,
  Handshake,
  PoundSterling,
} from "lucide-react";

// --- Types ---

interface AgentSummaryRow {
  agent: string;
  invoiced: number;
  wip: number;
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
  totalDeals: number;
  generatedAt: string;
}

interface KpiTrends {
  months: string[];
  dealsPerMonth: number[];
  feesPerMonth: number[];
  propertiesPerMonth: number[];
  contactsPerMonth: number[];
  totalDeals: number;
  totalFees: number;
  totalProperties: number;
  totalContacts: number;
  dealsChange: number;
  feesChange: number;
  propertiesChange: number;
  contactsChange: number;
}

interface CrmStats {
  properties: number;
  deals: number;
  companies: number;
  contacts: number;
  leads: number;
  comps: number;
  requirementsLeasing: number;
  requirementsInvestment: number;
}

// --- Helpers ---

const CHART_COLORS = [
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
};

function formatCurrency(value: number): string {
  if (value >= 1_000_000) return `\u00A3${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `\u00A3${(value / 1_000).toFixed(0)}K`;
  return `\u00A3${value.toLocaleString()}`;
}

function formatMonth(month: string): string {
  const [y, m] = month.split("-");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[parseInt(m) - 1]} ${y.slice(2)}`;
}

// --- KPI Card ---

function KpiCard({
  icon: Icon,
  label,
  value,
  subtitle,
  change,
}: {
  icon: any;
  label: string;
  value: string;
  subtitle?: string;
  change?: number;
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
            <Icon className="w-4.5 h-4.5 text-primary" />
          </div>
          <span className="text-sm font-medium text-muted-foreground">{label}</span>
        </div>
        <div className="text-2xl font-bold tracking-tight">{value}</div>
        {(subtitle || change !== undefined) && (
          <div className="flex items-center gap-2 mt-1">
            {subtitle && <span className="text-xs text-muted-foreground">{subtitle}</span>}
            {change !== undefined && change !== 0 && (
              <span className={`text-xs font-medium ${change > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                {change > 0 ? "+" : ""}{change}%
              </span>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// --- Main component ---

export default function Reporting() {
  const { data: agentSummary, isLoading: agentsLoading } = useQuery<AgentSummaryRow[]>({
    queryKey: ["/api/wip/agent-summary"],
    queryFn: async () => {
      const res = await fetch("/api/wip/agent-summary", { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to fetch agent summary");
      return res.json();
    },
  });

  const { data: boardReport, isLoading: boardLoading } = useQuery<BoardReportData>({
    queryKey: ["/api/board-report"],
  });

  const { data: kpiTrends, isLoading: kpiLoading } = useQuery<KpiTrends>({
    queryKey: ["/api/dashboard/kpi-trends"],
    staleTime: 5 * 60 * 1000,
  });

  const { data: crmStats, isLoading: statsLoading } = useQuery<CrmStats>({
    queryKey: ["/api/crm/stats"],
  });

  const isLoading = agentsLoading || boardLoading || kpiLoading || statsLoading;

  // Derive monthly fees chart data
  const monthlyFeesData = (boardReport?.performance.monthlyFees || []).map((m) => ({
    month: formatMonth(m.month),
    total: m.total,
  }));

  // Derive pipeline by status data
  const pipelineByStatus = (boardReport?.pipeline.byStatus || [])
    .filter((s) => s.value > 0)
    .sort((a, b) => b.value - a.value);

  // Derive pipeline by deal type
  const pipelineByDealType = (boardReport?.pipeline.byDealType || [])
    .filter((s) => s.value > 0)
    .sort((a, b) => b.value - a.value);

  // Agent performance data (sorted by total fees)
  const agentData = (agentSummary || [])
    .map((a) => ({ agent: a.agent, wip: a.wip, invoiced: a.invoiced, total: a.wip + a.invoiced }))
    .sort((a, b) => b.total - a.total);

  // Deals trend chart
  const dealsTrend = (kpiTrends?.months || []).map((m, i) => ({
    month: formatMonth(m),
    deals: kpiTrends?.dealsPerMonth[i] || 0,
    fees: kpiTrends?.feesPerMonth[i] || 0,
  }));

  // Time to close buckets
  const timeToCloseBuckets = boardReport?.performance.timeToCloseBuckets || [];

  return (
    <PageLayout
      title="Reporting & Analytics"
      subtitle="Key performance metrics and pipeline insights"
      testId="page-reporting"
    >
      {/* Top-level KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}><CardContent className="p-5"><Skeleton className="h-20" /></CardContent></Card>
          ))
        ) : (
          <>
            <KpiCard
              icon={DollarSign}
              label="Total Fees YTD"
              value={formatCurrency(boardReport?.performance.totalFeesYTD || 0)}
              subtitle="This financial year"
              change={kpiTrends?.feesChange}
            />
            <KpiCard
              icon={Handshake}
              label="Total Deals"
              value={(kpiTrends?.totalDeals || crmStats?.deals || 0).toLocaleString()}
              change={kpiTrends?.dealsChange}
            />
            <KpiCard
              icon={Building2}
              label="Properties"
              value={(kpiTrends?.totalProperties || crmStats?.properties || 0).toLocaleString()}
              change={kpiTrends?.propertiesChange}
            />
            <KpiCard
              icon={Clock}
              label="Avg Time to Close"
              value={boardReport?.performance.avgTimeToClose ? `${boardReport.performance.avgTimeToClose} days` : "--"}
              subtitle="HOTs to completion"
            />
          </>
        )}
      </div>

      {/* Row 2: Average Deal Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}><CardContent className="p-5"><Skeleton className="h-20" /></CardContent></Card>
          ))
        ) : (
          <>
            <KpiCard
              icon={Target}
              label="Avg Deal Size"
              value={formatCurrency(boardReport?.performance.avgDealSize || 0)}
            />
            <KpiCard
              icon={TrendingUp}
              label="Conversion Rate"
              value={`${(boardReport?.performance.conversionRate || 0).toFixed(1)}%`}
              subtitle="Pipeline to completed"
            />
            <KpiCard
              icon={Users}
              label="Contacts"
              value={(kpiTrends?.totalContacts || crmStats?.contacts || 0).toLocaleString()}
              change={kpiTrends?.contactsChange}
            />
            <KpiCard
              icon={PoundSterling}
              label="Active Agents"
              value={String(agentData.length)}
              subtitle="With WIP or invoiced fees"
            />
          </>
        )}
      </div>

      {/* Charts Row: Monthly Fees + Deal Flow by Status */}
      <div className="grid md:grid-cols-2 gap-6 mb-6">
        {/* Monthly Fees Trend */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold">Fee Income by Month</CardTitle>
          </CardHeader>
          <CardContent>
            {boardLoading ? (
              <Skeleton className="h-64" />
            ) : monthlyFeesData.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart data={monthlyFeesData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} className="text-muted-foreground" />
                  <YAxis tickFormatter={(v) => formatCurrency(v)} tick={{ fontSize: 11 }} className="text-muted-foreground" />
                  <Tooltip
                    formatter={(value: number) => [formatCurrency(value), "Fees"]}
                    contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px" }}
                  />
                  <Area type="monotone" dataKey="total" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.15} strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">No data available</div>
            )}
          </CardContent>
        </Card>

        {/* Investment Pipeline by Status */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold">Deal Flow by Stage</CardTitle>
          </CardHeader>
          <CardContent>
            {boardLoading ? (
              <Skeleton className="h-64" />
            ) : pipelineByStatus.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie
                    data={pipelineByStatus}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    dataKey="value"
                    nameKey="name"
                    paddingAngle={2}
                  >
                    {pipelineByStatus.map((entry, i) => (
                      <Cell key={i} fill={STATUS_COLORS[entry.name] || CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value: number, name: string) => [value, name]}
                    contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px" }}
                  />
                  <Legend
                    layout="vertical"
                    align="right"
                    verticalAlign="middle"
                    iconType="circle"
                    iconSize={8}
                    wrapperStyle={{ fontSize: "12px" }}
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">No data available</div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Charts Row: Deals Trend + Deal Type Breakdown */}
      <div className="grid md:grid-cols-2 gap-6 mb-6">
        {/* Deals & Fees per Month */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold">Leasing Activity Trend</CardTitle>
          </CardHeader>
          <CardContent>
            {kpiLoading ? (
              <Skeleton className="h-64" />
            ) : dealsTrend.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={dealsTrend}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} className="text-muted-foreground" />
                  <YAxis tick={{ fontSize: 11 }} className="text-muted-foreground" />
                  <Tooltip
                    contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px" }}
                  />
                  <Bar dataKey="deals" name="Deals" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">No data available</div>
            )}
          </CardContent>
        </Card>

        {/* Pipeline by Deal Type */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold">Pipeline by Deal Type</CardTitle>
          </CardHeader>
          <CardContent>
            {boardLoading ? (
              <Skeleton className="h-64" />
            ) : pipelineByDealType.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={pipelineByDealType} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis type="number" tick={{ fontSize: 11 }} className="text-muted-foreground" />
                  <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} width={120} className="text-muted-foreground" />
                  <Tooltip
                    contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px" }}
                  />
                  <Bar dataKey="value" name="Deals" fill="#8b5cf6" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">No data available</div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Team Performance - Agent Summary */}
      <Card className="mb-6">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold">Team Performance: Fees by Agent</CardTitle>
        </CardHeader>
        <CardContent>
          {agentsLoading ? (
            <Skeleton className="h-80" />
          ) : agentData.length > 0 ? (
            <ResponsiveContainer width="100%" height={Math.max(280, agentData.length * 40)}>
              <BarChart data={agentData} layout="vertical" margin={{ left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis type="number" tickFormatter={(v) => formatCurrency(v)} tick={{ fontSize: 11 }} className="text-muted-foreground" />
                <YAxis dataKey="agent" type="category" tick={{ fontSize: 11 }} width={140} className="text-muted-foreground" />
                <Tooltip
                  formatter={(value: number, name: string) => [formatCurrency(value), name === "invoiced" ? "Invoiced" : "WIP"]}
                  contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px" }}
                />
                <Legend wrapperStyle={{ fontSize: "12px" }} />
                <Bar dataKey="invoiced" name="Invoiced" stackId="a" fill="#10b981" radius={[0, 0, 0, 0]} />
                <Bar dataKey="wip" name="WIP" stackId="a" fill="#3b82f6" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-40 flex items-center justify-center text-muted-foreground text-sm">No agent data available</div>
          )}
        </CardContent>
      </Card>

      {/* Time to Close Distribution */}
      <div className="grid md:grid-cols-2 gap-6 mb-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold">Time to Completion Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            {boardLoading ? (
              <Skeleton className="h-64" />
            ) : timeToCloseBuckets.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={timeToCloseBuckets}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="range" tick={{ fontSize: 11 }} className="text-muted-foreground" />
                  <YAxis tick={{ fontSize: 11 }} className="text-muted-foreground" />
                  <Tooltip
                    contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px" }}
                  />
                  <Bar dataKey="count" name="Deals" fill="#f97316" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">No data available</div>
            )}
          </CardContent>
        </Card>

        {/* Top Deals Table */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold">Top Deals</CardTitle>
          </CardHeader>
          <CardContent>
            {boardLoading ? (
              <Skeleton className="h-64" />
            ) : (boardReport?.topDeals || []).length > 0 ? (
              <div className="overflow-auto max-h-[280px]">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="pb-2 font-medium">Deal</th>
                      <th className="pb-2 font-medium">Team</th>
                      <th className="pb-2 font-medium text-right">Fee</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(boardReport?.topDeals || []).slice(0, 10).map((deal, i) => (
                      <tr key={i} className="border-b last:border-0">
                        <td className="py-2 pr-4 truncate max-w-[200px]" title={deal.name}>{deal.name}</td>
                        <td className="py-2 pr-4 text-muted-foreground">{deal.team}</td>
                        <td className="py-2 text-right font-medium">{formatCurrency(deal.fee)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">No deals data available</div>
            )}
          </CardContent>
        </Card>
      </div>
    </PageLayout>
  );
}
