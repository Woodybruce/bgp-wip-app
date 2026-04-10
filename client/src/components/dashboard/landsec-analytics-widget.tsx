import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import {
  Landmark,
  Users,
  Clock,
  PieChart,
  Briefcase,
} from "lucide-react";
import { getQueryFn } from "@/lib/queryClient";
import { formatCurrencyShort, formatCurrencyFull, timeAgo } from "./helpers";

interface LandsecAnalytics {
  totalDeals: number;
  totalWIP: number;
  totalInvoiced: number;
  byDealType: Record<string, { count: number; fees: number }>;
  byStatus: Record<string, number>;
  byAgent: Record<string, { count: number; fees: number }>;
  recentActivity: Array<{
    id: string;
    name: string;
    dealType: string | null;
    status: string | null;
    fee: number;
    agent: string;
    updatedAt: string;
  }>;
  pipelineValue: number;
  averageDealSize: number;
}

// BGP brand greens & golds
const BGP_GREENS = ["#166534", "#15803d", "#22c55e", "#4ade80", "#86efac"];
const BGP_GOLDS = ["#a16207", "#ca8a04", "#eab308", "#facc15", "#fde047"];
const FUNNEL_COLORS = ["#166534", "#15803d", "#22c55e", "#ca8a04", "#eab308", "#facc15"];

const STATUS_COLOR_MAP: Record<string, string> = {
  Targeting: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  Available: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  Marketing: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
  NEG: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  HOTs: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300",
  SOLs: "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300",
  Exchanged: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  Completed: "bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-300",
  Live: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300",
  Invoiced: "bg-green-200 text-green-900 dark:bg-green-900/50 dark:text-green-200",
  Dead: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400",
};

/** a) Portfolio Overview Card */
export function LandsecOverviewCard({ data }: { data: LandsecAnalytics }) {
  const totalPortfolio = data.totalWIP + data.totalInvoiced;
  const wipPct = totalPortfolio > 0 ? (data.totalWIP / totalPortfolio) * 100 : 0;
  const invoicedPct = totalPortfolio > 0 ? (data.totalInvoiced / totalPortfolio) * 100 : 0;
  const pipelinePct = totalPortfolio > 0 ? (data.pipelineValue / totalPortfolio) * 100 : 0;

  const dealTypeEntries = Object.entries(data.byDealType).sort(([, a], [, b]) => b.count - a.count);

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-2 pt-4 px-4">
        <div className="flex items-center gap-2">
          <Landmark className="w-4 h-4 text-emerald-600" />
          <CardTitle className="text-sm font-semibold">Landsec Portfolio Overview</CardTitle>
          <Badge variant="secondary" className="text-[10px]">{data.totalDeals} deals</Badge>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4 pt-0 flex-1 overflow-hidden space-y-3">
        {/* Total portfolio value */}
        <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800">
          <p className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium uppercase tracking-wider">Total Portfolio Value</p>
          <p className="text-2xl font-bold text-emerald-700 dark:text-emerald-300">{formatCurrencyFull(totalPortfolio)}</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            Avg deal: {formatCurrencyShort(data.averageDealSize)}
          </p>
        </div>

        {/* Pipeline / WIP / Invoiced bar */}
        <div>
          <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider mb-1.5">Revenue Breakdown</p>
          <div className="flex h-4 rounded-full overflow-hidden border">
            {pipelinePct > 0 && (
              <div
                className="bg-amber-400 dark:bg-amber-500 transition-all"
                style={{ width: `${pipelinePct}%` }}
                title={`Pipeline: ${formatCurrencyShort(data.pipelineValue)}`}
              />
            )}
            {(wipPct - pipelinePct) > 0 && (
              <div
                className="bg-emerald-400 dark:bg-emerald-500 transition-all"
                style={{ width: `${Math.max(wipPct - pipelinePct, 0)}%` }}
                title={`WIP (non-pipeline): ${formatCurrencyShort(data.totalWIP - data.pipelineValue)}`}
              />
            )}
            {invoicedPct > 0 && (
              <div
                className="bg-green-700 dark:bg-green-600 transition-all"
                style={{ width: `${invoicedPct}%` }}
                title={`Invoiced: ${formatCurrencyShort(data.totalInvoiced)}`}
              />
            )}
          </div>
          <div className="flex justify-between mt-1 text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400 inline-block" /> Pipeline {formatCurrencyShort(data.pipelineValue)}</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" /> WIP {formatCurrencyShort(data.totalWIP)}</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-700 inline-block" /> Invoiced {formatCurrencyShort(data.totalInvoiced)}</span>
          </div>
        </div>

        {/* Deal count by type */}
        <div>
          <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider mb-1.5">Deals by Type</p>
          <div className="flex flex-wrap gap-1">
            {dealTypeEntries.map(([type, { count, fees }]) => (
              <Badge
                key={type}
                variant="outline"
                className="text-[10px] gap-1 border-emerald-200 dark:border-emerald-800"
                title={`${count} deals, ${formatCurrencyShort(fees)} total fees`}
              >
                <Briefcase className="w-2.5 h-2.5" />
                {type}: {count}
              </Badge>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/** b) Agent Performance Card */
export function LandsecAgentPerformanceCard({ data }: { data: LandsecAnalytics }) {
  const agents = Object.entries(data.byAgent)
    .map(([name, { count, fees }]) => ({
      name,
      count,
      fees,
      pct: data.totalWIP + data.totalInvoiced > 0
        ? ((fees / (data.totalWIP + data.totalInvoiced)) * 100)
        : 0,
    }))
    .sort((a, b) => b.fees - a.fees);

  const maxFees = agents.length > 0 ? agents[0].fees : 1;

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-2 pt-4 px-4">
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-emerald-600" />
          <CardTitle className="text-sm font-semibold">Agent Performance</CardTitle>
          <Badge variant="secondary" className="text-[10px]">{agents.length} agents</Badge>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4 pt-0 flex-1 overflow-hidden">
        <ScrollArea className="h-full">
          <div className="space-y-1.5 pr-2">
            {agents.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-4">No agent data available</p>
            ) : (
              agents.map((agent, i) => (
                <div
                  key={agent.name}
                  className="flex items-center gap-2 p-2 rounded-lg border bg-background hover:bg-muted/50 transition-colors"
                  data-testid={`agent-row-${i}`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium truncate">{agent.name}</span>
                      <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 tabular-nums">
                        {formatCurrencyShort(agent.fees)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-2 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${(agent.fees / maxFees) * 100}%`,
                            backgroundColor: BGP_GREENS[i % BGP_GREENS.length],
                          }}
                        />
                      </div>
                      <span className="text-[10px] text-muted-foreground tabular-nums w-12 text-right shrink-0">
                        {agent.pct.toFixed(1)}%
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[10px] text-muted-foreground">{agent.count} deal{agent.count !== 1 ? "s" : ""}</span>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

/** c) Deal Pipeline Funnel */
export function LandsecPipelineFunnel({ data }: { data: LandsecAnalytics }) {
  const FUNNEL_STAGES = ["Targeting", "Available", "Marketing", "NEG", "HOTs", "SOLs", "Exchanged", "Completed", "Invoiced"];

  const stages = FUNNEL_STAGES.map((stage) => ({
    stage,
    count: data.byStatus[stage] || 0,
    // Compute fee value for each stage from deals
  })).filter(s => s.count > 0 || FUNNEL_STAGES.indexOf(s.stage) < 6); // Always show first 6 stages

  // For the bar chart, reverse to show funnel top-to-bottom
  const chartData = FUNNEL_STAGES.map((stage, i) => ({
    stage: stage === "NEG" ? "Under Neg." : stage,
    count: data.byStatus[stage] || 0,
    fill: i < BGP_GREENS.length ? BGP_GREENS[i] : BGP_GOLDS[i - BGP_GREENS.length] || "#94a3b8",
  })).filter(s => s.count > 0);

  const totalActive = chartData.reduce((s, d) => s + d.count, 0);

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-2 pt-4 px-4">
        <div className="flex items-center gap-2">
          <PieChart className="w-4 h-4 text-emerald-600" />
          <CardTitle className="text-sm font-semibold">Deal Pipeline</CardTitle>
          <Badge variant="secondary" className="text-[10px]">{totalActive} deals</Badge>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4 pt-0 flex-1 overflow-hidden flex flex-col">
        {/* Visual funnel */}
        <div className="space-y-1 mb-3">
          {chartData.map((stage, i) => {
            const maxCount = Math.max(...chartData.map(s => s.count), 1);
            const widthPct = Math.max((stage.count / maxCount) * 100, 15);
            return (
              <div key={stage.stage} className="flex items-center gap-2">
                <span className="text-[10px] text-muted-foreground w-20 text-right shrink-0 truncate">{stage.stage}</span>
                <div className="flex-1 flex items-center gap-1.5">
                  <div
                    className="h-5 rounded-md flex items-center justify-end px-2 transition-all"
                    style={{
                      width: `${widthPct}%`,
                      backgroundColor: FUNNEL_COLORS[i % FUNNEL_COLORS.length],
                      minWidth: "2rem",
                    }}
                  >
                    <span className="text-[10px] font-semibold text-white">{stage.count}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Mini bar chart */}
        {chartData.length > 0 && (
          <div className="flex-1 min-h-[120px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} layout="vertical" margin={{ left: 0, right: 10, top: 0, bottom: 0 }}>
                <XAxis type="number" tick={{ fontSize: 10 }} />
                <YAxis dataKey="stage" type="category" tick={{ fontSize: 9 }} width={70} />
                <Tooltip
                  contentStyle={{ fontSize: 11, borderRadius: 8 }}
                  formatter={(value: number) => [`${value} deals`, "Count"]}
                />
                <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                  {chartData.map((entry, i) => (
                    <Cell key={entry.stage} fill={FUNNEL_COLORS[i % FUNNEL_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** d) Recent Activity Feed */
export function LandsecRecentActivity({ data }: { data: LandsecAnalytics }) {
  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-2 pt-4 px-4">
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-emerald-600" />
          <CardTitle className="text-sm font-semibold">Recent Landsec Activity</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4 pt-0 flex-1 overflow-hidden">
        <ScrollArea className="h-full">
          {data.recentActivity.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <Clock className="w-8 h-8 text-muted-foreground/30 mb-2" />
              <p className="text-xs text-muted-foreground">No recent activity</p>
            </div>
          ) : (
            <div className="space-y-1 pr-2">
              {data.recentActivity.map((deal) => {
                const statusClass = STATUS_COLOR_MAP[deal.status || ""] || "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300";
                return (
                  <div
                    key={deal.id}
                    className="flex items-start gap-2.5 p-2 rounded-md hover:bg-muted/50 transition-colors"
                    data-testid={`landsec-activity-${deal.id}`}
                  >
                    <div className="w-6 h-6 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center shrink-0 mt-0.5">
                      <Briefcase className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium leading-tight truncate">{deal.name}</p>
                      <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                        {deal.agent && (
                          <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                            <Users className="w-2.5 h-2.5" /> {deal.agent}
                          </span>
                        )}
                        {deal.status && (
                          <Badge className={`text-[9px] px-1.5 py-0 ${statusClass}`}>
                            {deal.status}
                          </Badge>
                        )}
                        {deal.fee > 0 && (
                          <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">
                            {formatCurrencyShort(deal.fee)}
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        {deal.dealType || "Deal"} · {timeAgo(deal.updatedAt)}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

/** Combined Landsec Analytics Widget that fetches data and renders all 4 cards as a grid */
export function LandsecAnalyticsWidget() {
  const { data, isLoading } = useQuery<LandsecAnalytics>({
    queryKey: ["/api/portfolio/landsec/analytics"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {[1, 2, 3, 4].map((i) => (
          <Card key={i} className="h-full">
            <CardContent className="p-4 space-y-3">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-12 w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (!data || data.totalDeals === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <Landmark className="w-8 h-8 mx-auto mb-2 text-muted-foreground/30" />
          <p className="text-xs text-muted-foreground">No Landsec deals found</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 h-full">
      <LandsecOverviewCard data={data} />
      <LandsecAgentPerformanceCard data={data} />
      <LandsecPipelineFunnel data={data} />
      <LandsecRecentActivity data={data} />
    </div>
  );
}
