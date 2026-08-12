// The Intelligence strip — CRM/diary insights in a single footer row.
// Extracted from the calendar page so the same board renders anywhere
// (calendar footer, Landsec dashboard) instead of growing per-page
// variants (Woody, 2026-08-04: one structure, rolled across the app).
import { useQuery } from "@tanstack/react-query";
import {
  Brain, Building2, Calendar as CalendarIcon, Flame, TrendingUp,
  UserCheck, Handshake, AlertTriangle, BarChart3,
} from "lucide-react";

interface BackendInsight {
  type: string;
  title: string;
  detail: string;
  priority: number;
}

const INSIGHT_ICONS: Record<string, typeof Building2> = {
  todaySummary: CalendarIcon,
  hotProperty: Flame,
  viewingTrend: TrendingUp,
  activeTenant: Building2,
  busiestAgent: UserCheck,
  pipeline: Handshake,
  coldProperty: AlertTriangle,
  busiestDay: BarChart3,
};

const INSIGHT_COLORS: Record<string, string> = {
  todaySummary: "text-blue-500",
  hotProperty: "text-rose-500",
  viewingTrend: "text-emerald-500",
  activeTenant: "text-amber-500",
  busiestAgent: "text-violet-500",
  pipeline: "text-green-500",
  coldProperty: "text-orange-500",
  busiestDay: "text-sky-500",
};

export function IntelligenceFooter({ connected = false }: { connected?: boolean }) {
  const { data: insightsData, isLoading } = useQuery<{ insights: BackendInsight[] }>({
    queryKey: ["/api/microsoft/calendar/insights"],
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
    // Client viewers get the company-scoped insights variant server-side —
    // the endpoint is no longer staff-only, so don't gate the query.
  });

  const insights = insightsData?.insights || [];

  return (
    <div className="border-t bg-muted/15 shrink-0" data-testid="calendar-footer">
      <div className="flex items-center px-5 py-3 gap-4">
        <div className="flex items-center gap-2.5 shrink-0 pr-4 border-r border-border/40">
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
            <Brain className="w-4.5 h-4.5 text-primary" />
          </div>
          <span className="hidden sm:inline text-sm font-semibold text-foreground/70 uppercase tracking-wider">Intelligence</span>
        </div>

        <div className="flex-1 flex items-center gap-4 overflow-x-auto scrollbar-none">
          {isLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <div className="w-3 h-3 border-2 border-muted-foreground/30 border-t-muted-foreground rounded-full animate-spin" />
              <span className="text-sm">Analysing CRM data...</span>
            </div>
          ) : insights.length === 0 ? (
            <span className="text-sm text-muted-foreground">No insights available yet</span>
          ) : (
            insights.map((insight, i) => {
              const Icon = INSIGHT_ICONS[insight.type] || Brain;
              const color = INSIGHT_COLORS[insight.type] || "text-muted-foreground";
              return (
                <div
                  key={`${insight.type}-${i}`}
                  className="flex items-center gap-2.5 shrink-0 rounded-lg px-2.5 py-1.5 hover:bg-muted/40 transition-colors group"
                  data-testid={`insight-${insight.type}`}
                >
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${color.replace("text-", "bg-")}/10`}>
                    <Icon className={`w-4 h-4 ${color} shrink-0`} />
                  </div>
                  <div className="flex flex-col text-left">
                    <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider leading-tight whitespace-nowrap">{insight.title}</span>
                    <span className="text-[13px] font-medium leading-tight whitespace-nowrap max-w-[58vw] truncate sm:max-w-none">{insight.detail}</span>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="hidden sm:flex items-center gap-3 shrink-0 pl-4 border-l border-border/40">
          {connected && (
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-xs text-muted-foreground">Live</span>
            </div>
          )}
          <span className="text-xs text-muted-foreground/50">
            {new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
          </span>
        </div>
      </div>
    </div>
  );
}
