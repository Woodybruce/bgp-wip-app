import { useQuery, useMutation } from "@tanstack/react-query";
import { IntelligenceFooter } from "@/components/intelligence-footer";
import { CompanyContactsBoard } from "@/components/company-contacts-board";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useTeam } from "@/lib/team-context";
import { useBrand } from "@/lib/brand-context";
import { DraggableGrid } from "@/components/draggable-grid";
import { ClientTeamOrgChart } from "@/components/ClientTeamOrgChart";
import { BrandPortfolioMap } from "@/components/brand-portfolio-map";
import { PropertiesSummary } from "@/components/properties-summary";
import { ActivitySummary } from "@/components/activity-summary";
import { ClientPropertyFoldersPanel } from "@/pages/properties";
import { BgpTakeStrip } from "@/components/bgp-take-strip";
import { AIActivityCard } from "@/components/ai-activity-card";
import {
  Building2,
  CalendarDays,
  Users,
  Eye,
  Phone,
  Sparkles,
  FileText,
  ArrowRight,
  BarChart3,
  Brain,
  Clock,
  Newspaper,
  FileSpreadsheet,
  Zap,
  Mail as MailIcon,
  Video,
  Star,
  Settings2,
  ExternalLink,
  Bell,
  UserCheck,
  ListPlus,
  Gavel,
  Home,
  Landmark,
  Globe,
  MapPin,
  Handshake,
  ShieldCheck,
  Pencil,
  Check,
  RotateCcw,
  Flame,
  TrendingUp,
  AlertTriangle,
  Calendar as CalendarIcon,
  FolderOpen,
  Folder,
  File,
  ChevronRight,
  ChevronDown,
  RefreshCw,
  Download,
  Loader2,
  LayoutTemplate,
  ListTodo,
  Plus,
  CircleDot,
  CheckCircle2,
} from "lucide-react";
import type { User, CrmProperty, CrmDeal, CrmContact, InvestmentTracker as InvTracker } from "@shared/schema";
import { MailView } from "@/pages/mail";
import { ScrollArea } from "@/components/ui/scroll-area";
import { apiRequest, queryClient, getAuthHeaders } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  MyLeadsWidget,
  WipDashboardCard,
  AvailableUnitsWidget,
  DealsBoardWidget,
  InvestmentTrackerWidget,
  SharePointWidget,
  StudiosWidget,
  MyPortfolioWidget,
  KpiOverviewWidget,
  LandsecAnalyticsWidget,
  LandsecOverviewCard,
  LandsecAgentPerformanceCard,
  LandsecPipelineFunnel,
  LandsecRecentActivity,
  WidgetPickerDialog,
  WIDGET_REGISTRY,
  DEFAULT_WIDGETS,
  DEFAULT_BOARDS,
  CLIENT_BOARD_REGISTRY,
  CLIENT_SAFE_WIDGET_IDS,
  boardsToWidgets,
  widgetsToBoards,
  timeAgo,
} from "@/components/dashboard";
import type { CrmStats, NewsArticle, DashboardIntelligence, CalendarEvent } from "@/components/dashboard";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import type { CrmComp } from "@shared/schema";


// Merged "Activity Feed" = Daily Digest alerts (proactive) + System Activity (automated background processes).
function ActivityFeedWidget() {
  const { data: alerts, isLoading: digestLoading } = useQuery<any[]>({ queryKey: ["/api/daily-digest"] });
  const { data: activities, isLoading: actLoading } = useQuery<any[]>({ queryKey: ["/api/activity-feed"] });

  const severityConfig: Record<string, { color: string; bg: string }> = {
    critical: { color: "text-red-600 dark:text-red-400", bg: "bg-red-100 dark:bg-red-900/30" },
    warning: { color: "text-amber-600 dark:text-amber-400", bg: "bg-amber-100 dark:bg-amber-900/30" },
    info: { color: "text-blue-600 dark:text-blue-400", bg: "bg-blue-100 dark:bg-blue-900/30" },
  };
  const typeIcons: Record<string, React.ElementType> = {
    stuck_deal: Clock,
    unmatched_requirement: ListPlus,
    kyc_gap: ShieldCheck,
    cooling_contact: Users,
  };
  const sourceIcons: Record<string, { icon: React.ElementType; color: string }> = {
    "email-processor": { icon: MailIcon, color: "text-blue-500" },
    "auto-enrich": { icon: Sparkles, color: "text-purple-500" },
    "news-feed": { icon: Newspaper, color: "text-orange-500" },
    "comp-extract": { icon: BarChart3, color: "text-green-500" },
    "archivist": { icon: FolderOpen, color: "text-amber-500" },
    "interaction-sync": { icon: Users, color: "text-cyan-500" },
  };

  const digestHref = (alert: any): string | null =>
    alert.entityType === "deal" ? `/deals/${alert.entityId}`
    : alert.entityType === "contact" ? `/contacts/${alert.entityId}`
    : alert.entityType === "requirement" ? `/requirements`
    : null;

  const isLoading = digestLoading || actLoading;
  const hasAlerts = !!alerts?.length;
  const hasActivity = !!activities?.length;

  return (
    <Card key="system-activity" className="h-full flex flex-col" data-testid="widget-activity-feed">
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2 pt-4 px-4">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-primary" />
          <CardTitle className="text-sm font-semibold">Activity Feed</CardTitle>
          {hasAlerts && <Badge variant="destructive" className="text-[10px]">{alerts!.length}</Badge>}
        </div>
        <Badge variant="secondary" className="text-[10px]">Live</Badge>
      </CardHeader>
      <CardContent className="flex-1 overflow-hidden px-4 pb-4">
        <ScrollArea className="h-full">
          {isLoading ? (
            <div className="space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-12 w-full" />)}</div>
          ) : !hasAlerts && !hasActivity ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <Check className="w-8 h-8 text-green-500/30 mb-2" />
              <p className="text-xs text-muted-foreground">All clear — nothing to report</p>
            </div>
          ) : (
            <div className="space-y-1">
              {hasAlerts && (
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-1 pt-1">Alerts</p>
              )}
              {alerts?.map((alert: any, idx: number) => {
                const sev = severityConfig[alert.severity] || severityConfig.info;
                const Icon = typeIcons[alert.type] || AlertTriangle;
                const href = digestHref(alert);
                const row = (
                  <div className="flex items-start gap-2.5 p-2 rounded-md hover:bg-muted/50 transition-colors" data-testid={`digest-alert-${idx}`}>
                    <div className={`w-6 h-6 rounded-full ${sev.bg} flex items-center justify-center shrink-0 mt-0.5`}>
                      <Icon className={`w-3 h-3 ${sev.color}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium leading-tight">{alert.title}</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">{alert.detail}</p>
                    </div>
                    {href && <ArrowRight className="w-3 h-3 text-muted-foreground shrink-0 mt-1" />}
                  </div>
                );
                return href ? (
                  <Link key={`alert-${idx}`} href={href} className="block cursor-pointer">{row}</Link>
                ) : (
                  <div key={`alert-${idx}`}>{row}</div>
                );
              })}
              {hasActivity && (
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-1 pt-2">System Activity</p>
              )}
              {activities?.map((a: any) => {
                const config = sourceIcons[a.source] || { icon: Zap, color: "text-muted-foreground" };
                const Icon = config.icon;
                return (
                  <div key={`act-${a.id}`} className="flex items-start gap-2.5 p-2 rounded-md hover:bg-muted/50 transition-colors" data-testid={`activity-item-${a.id}`}>
                    <div className={`w-6 h-6 rounded-full bg-muted flex items-center justify-center shrink-0 mt-0.5`}>
                      <Icon className={`w-3 h-3 ${config.color}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium leading-tight">{a.detail}</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">{a.source.replace(/-/g, " ")} · {timeAgo(a.created_at)}</p>
                    </div>
                    {a.count > 1 && <Badge variant="outline" className="text-[9px] shrink-0">{a.count}</Badge>}
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

function MyTasksWidget() {
  const { data: tasksData = [], isLoading: tasksLoading } = useQuery<any[]>({ queryKey: ["/api/tasks"] });
  const { data: briefingData, isLoading: briefingLoading, refetch: refetchBriefing } = useQuery<any>({
    queryKey: ["/api/ai-briefing"],
    staleTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  const [briefingOpen, setBriefingOpen] = useState(true);
  const toggleMut = useMutation({
    mutationFn: (task: any) => apiRequest("PATCH", `/api/tasks/${task.id}`, { status: task.status === "done" ? "todo" : "done" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/tasks"] }),
  });
  const addMut = useMutation({
    mutationFn: (title: string) => apiRequest("POST", "/api/tasks", { title, priority: "medium" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/tasks"] }),
  });
  const [quickInput, setQuickInput] = useState("");
  const activeTasks = tasksData.filter((t: any) => t.status !== "done");
  const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
  const overdueTasks = activeTasks.filter((t: any) => {
    if (!t.due_date) return false;
    const due = new Date(t.due_date); due.setHours(0, 0, 0, 0);
    return due < startOfToday();
  });
  const priorityIcon = (p: string) => p === "urgent" ? <Flame className="w-2.5 h-2.5 text-red-500" /> : p === "high" ? <AlertTriangle className="w-2.5 h-2.5 text-orange-500" /> : null;
  const dueLabel = (d: string | null) => {
    if (!d) return null;
    const due = new Date(d); due.setHours(0, 0, 0, 0);
    const diff = Math.floor((due.getTime() - startOfToday().getTime()) / 86400000);
    if (diff < 0) return <span className="text-xs text-red-600 font-medium">{Math.abs(diff)}d overdue</span>;
    if (diff === 0) return <span className="text-xs text-orange-600 font-medium">Today</span>;
    if (diff === 1) return <span className="text-xs text-blue-600">Tomorrow</span>;
    return <span className="text-xs text-muted-foreground">{new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>;
  };
  const renderBriefingLine = (line: string, i: number) => {
    if (line.startsWith("## ")) return <h3 key={i} className="text-sm font-semibold mt-2 mb-0.5">{line.slice(3)}</h3>;
    if (line.startsWith("# ")) return <h2 key={i} className="text-sm font-bold mt-2 mb-0.5 first:mt-0">{line.slice(2)}</h2>;
    if (line.startsWith("- ") || line.startsWith("• ")) return <li key={i} className="ml-4 text-[13px] list-disc marker:text-primary/40 leading-snug">{line.slice(2).replace(/\*\*/g, "")}</li>;
    if (line.trim() === "") return <div key={i} className="h-1" />;
    if (line.startsWith("---")) return <hr key={i} className="my-1.5 border-border" />;
    // Markdown table rows used to leak as raw "| Metric | Figures |" text —
    // render each data row as "label — value" and drop the separator rows.
    if (line.trim().startsWith("|")) {
      const cells = line.split("|").map(c => c.trim()).filter(Boolean);
      if (cells.length === 0 || cells.every(c => /^[-: ]+$/.test(c))) return null;
      return <p key={i} className="text-[13px] leading-snug"><span className="text-muted-foreground">{cells[0]}</span>{cells.length > 1 ? ` — ${cells.slice(1).join(" · ")}` : ""}</p>;
    }
    return <p key={i} className="text-[13px] leading-snug">{line.replace(/\*\*/g, "")}</p>;
  };
  return (
    <Card key="my-tasks" className="h-full flex flex-col" data-testid="widget-my-tasks">
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2 pt-4 px-4">
        <div className="flex items-center gap-2">
          <ListTodo className="w-4 h-4 text-primary" />
          <CardTitle className="text-sm font-semibold">My Tasks & Briefing</CardTitle>
          {overdueTasks.length > 0 && <Badge variant="destructive" className="text-[10px] px-1.5">{overdueTasks.length} overdue</Badge>}
        </div>
        <Link href="/tasks">
          <Button variant="ghost" size="sm" className="text-xs h-7" data-testid="link-tasks-all">
            View all <ArrowRight className="w-3 h-3 ml-0.5" />
          </Button>
        </Link>
      </CardHeader>
      <CardContent className="flex-1 overflow-hidden px-4 pb-3">
        <div className="mb-2 rounded-lg border bg-muted/30 overflow-hidden">
          <button
            onClick={() => setBriefingOpen(!briefingOpen)}
            className="w-full flex items-center justify-between px-3 py-1.5 text-xs font-medium hover:bg-muted/50 transition-colors"
            data-testid="widget-briefing-toggle"
          >
            <div className="flex items-center gap-1.5">
              <Sparkles className="w-3 h-3 text-primary" />
              <span>AI Briefing</span>
              {briefingData?.generatedAt && (
                <span className="text-[10px] text-muted-foreground font-normal">
                  {new Date(briefingData.generatedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                </span>
              )}
            </div>
            {briefingOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          </button>
          {briefingOpen && (
            <div className="px-3 pb-2 max-h-48 overflow-y-auto">
              {briefingLoading ? (
                <div className="flex items-center gap-2 py-3">
                  <RefreshCw className="w-3 h-3 animate-spin text-primary" />
                  <span className="text-[11px] text-muted-foreground">Preparing your briefing...</span>
                </div>
              ) : briefingData?.briefing ? (
                <div className="text-foreground">
                  {briefingData.briefing.split("\n").map(renderBriefingLine)}
                </div>
              ) : (
                /* AI unavailable or briefing not generated — show a static
                   digest so the panel always earns its space, with a retry
                   instead of an open-ended promise. */
                <div className="py-2 space-y-1">
                  <p className="text-[11px] leading-snug">
                    {activeTasks.length === 0
                      ? "No open tasks — all clear for today."
                      : `${activeTasks.length} open task${activeTasks.length === 1 ? "" : "s"}${overdueTasks.length > 0 ? `, ${overdueTasks.length} overdue` : ""}.`}
                  </p>
                  <button
                    onClick={() => refetchBriefing()}
                    className="text-[10px] text-primary hover:underline flex items-center gap-1"
                    data-testid="button-retry-briefing"
                  >
                    <RefreshCw className="w-2.5 h-2.5" /> Try AI briefing again
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1.5 mb-2">
          <input
            value={quickInput}
            onChange={(e) => setQuickInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && quickInput.trim()) { addMut.mutate(quickInput.trim()); setQuickInput(""); }}}
            placeholder="Quick add task..."
            className="flex-1 text-xs px-2 py-1.5 rounded border bg-background focus:outline-none focus:ring-1 focus:ring-primary"
            data-testid="input-quick-task"
          />
          {quickInput.trim() && (
            <Button size="sm" className="h-7 w-7 p-0" onClick={() => { addMut.mutate(quickInput.trim()); setQuickInput(""); }} data-testid="button-quick-add">
              <Plus className="w-3.5 h-3.5" />
            </Button>
          )}
        </div>
        <ScrollArea className="h-[calc(100%-8rem)]">
          {tasksLoading ? (
            <div className="space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : activeTasks.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-6 text-center">
              <CheckCircle2 className="w-8 h-8 text-emerald-400/40 mb-2" />
              <p className="text-xs text-muted-foreground">All tasks complete!</p>
            </div>
          ) : (
            <div className="space-y-0.5">
              {activeTasks.slice(0, 12).map((task: any) => (
                <div key={task.id} className="flex items-start gap-2 py-1.5 px-1 rounded hover:bg-muted/40 transition-colors group" data-testid={`widget-task-${task.id}`}>
                  <button
                    onClick={() => toggleMut.mutate(task)}
                    className="mt-0.5 w-4 h-4 rounded-full border-2 border-gray-300 hover:border-primary flex-shrink-0 flex items-center justify-center"
                    data-testid={`widget-task-toggle-${task.id}`}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      {priorityIcon(task.priority)}
                      <span className="text-sm font-medium truncate">{task.title}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      {dueLabel(task.due_date)}
                      {task.deal_name && <span className="text-xs text-muted-foreground truncate max-w-[140px]">{task.deal_name}</span>}
                    </div>
                  </div>
                </div>
              ))}
              {activeTasks.length > 12 && (
                <Link href="/tasks">
                  <p className="text-[10px] text-primary cursor-pointer hover:underline text-center pt-1">+{activeTasks.length - 12} more</p>
                </Link>
              )}
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

function PropertyRow({ item }: { item: CrmProperty }) {
  const addr = item.address as any;
  const addressText = addr?.address || addr?.lat ? `${addr.lat}, ${addr.lng}` : "";
  return (
    <Link href={`/properties/${item.id}`}>
      <div className="flex items-center gap-1.5 py-1 px-1.5 rounded hover:bg-muted/50 transition-colors cursor-pointer" data-testid={`property-${item.id}`}>
        <Building2 className="w-3 h-3 text-primary shrink-0" />
        <span className="text-[11px] font-medium truncate">{item.name}</span>
      </div>
    </Link>
  );
}


function NewsRow({ article, userTeam }: { article: NewsArticle; userTeam: string }) {
  return (
    <a href={article.url} target="_blank" rel="noopener noreferrer" className="block">
      <div className="flex gap-2.5 p-2 rounded-md hover:bg-muted/50 transition-colors cursor-pointer" data-testid={`news-${article.id}`}>
        {article.imageUrl && (
          <img
            src={article.imageUrl}
            alt=""
            className="w-16 h-16 rounded object-cover shrink-0"
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold leading-snug line-clamp-2">{article.title}</p>
          <div className="flex items-center gap-1.5 mt-1">
            <span className="text-[10px] text-muted-foreground">{article.sourceName}</span>
            <span className="text-[10px] text-muted-foreground">·</span>
            <span className="text-[10px] text-muted-foreground">{timeAgo(article.publishedAt)}</span>
          </div>
        </div>
      </div>
    </a>
  );
}



function LoadingSkeleton() {
  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div className="space-y-2">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-48" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-28" />
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Skeleton className="h-64 lg:col-span-2" />
        <Skeleton className="h-64" />
      </div>
    </div>
  );
}




// Week-grid team calendar for the client portfolio dashboard (Woody,
// 2026-08-03: "same as [the staff National Leasing Diary]") — mini month,
// event-type legend, today's schedule and the Mon–Fri hour grid, fed by the
// synced team_events for the client's portfolio (no Microsoft token needed).
// Types are Viewing / Meeting / Call / Deadline only: inspections count as
// viewings and valuations aren't a BGP-client thing (Woody, 2026-08-03).
function ClientTeamWeekCalendar({ events }: { events: any[] }) {
  const [weekOffset, setWeekOffset] = useState(0);
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const now = new Date();
  const todayStr = now.toDateString();
  const monday = new Date(now);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7) + weekOffset * 7);
  const days: Date[] = Array.from({ length: 5 }, (_, i) => {
    const d = new Date(monday); d.setDate(monday.getDate() + i); return d;
  });
  // 6–22 to match the staff diary grid — 19:00 cap hid evening events
  // (Woody, 2026-08-04: "calendar scroll stops at 6pm").
  const HOUR_START = 6, HOUR_END = 22, ROW_H = 30;
  const [selectedEvent, setSelectedEvent] = useState<any | null>(null);
  const hours = Array.from({ length: HOUR_END - HOUR_START }, (_, i) => i + HOUR_START);
  const wkLabel = `${days[0].getDate()} – ${days[4].getDate()} ${days[4].toLocaleDateString("en-GB", { month: "long", year: "numeric" })}`;

  const classify = (ev: any): "viewing" | "meeting" | "call" | "deadline" => {
    const t = (ev.event_type || "").toLowerCase();
    if (t === "viewing" || t === "inspection") return "viewing";
    if (t === "call") return "call";
    if (t === "deadline") return "deadline";
    if (t === "meeting") return "meeting";
    const s = (ev.title || "").toLowerCase();
    if (s.includes("viewing") || s.includes("inspection") || s.includes("walk around") || s.includes("walk-around") || s.includes("site tour") || s.includes("walk ")) return "viewing";
    if (s.includes("call") || s.includes("phone")) return "call";
    if (s.includes("deadline") || s.includes("expiry")) return "deadline";
    return "meeting";
  };
  const chipColor: Record<string, string> = {
    viewing: "bg-blue-100 dark:bg-blue-900/40 border-blue-300 text-blue-800 dark:text-blue-200",
    meeting: "bg-amber-100 dark:bg-amber-900/40 border-amber-300 text-amber-800 dark:text-amber-200",
    call: "bg-purple-100 dark:bg-purple-900/40 border-purple-300 text-purple-800 dark:text-purple-200",
    deadline: "bg-red-100 dark:bg-red-900/40 border-red-300 text-red-800 dark:text-red-200",
  };
  const dotColor: Record<string, string> = { viewing: "bg-blue-500", meeting: "bg-amber-500", call: "bg-purple-500", deadline: "bg-red-500" };
  const typeIcon: Record<string, typeof Eye> = { viewing: Eye, meeting: Users, call: Phone, deadline: AlertTriangle };
  const TYPE_KEYS = ["viewing", "meeting", "call", "deadline"] as const;

  const typed = (events || []).filter(e => e.start_time).map(e => ({ ...e, _type: classify(e) }));
  const typeCounts: Record<string, number> = { viewing: 0, meeting: 0, call: 0, deadline: 0 };
  for (const e of typed) typeCounts[e._type]++;

  const todaysEvents = typed
    .filter(e => new Date(e.start_time).toDateString() === todayStr)
    .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
  const next30 = typed.filter(e => { const t = new Date(e.start_time).getTime(); return t >= Date.now() && t <= Date.now() + 30 * 86400000; }).length;
  const dayTotals = new Map<string, number>();
  const eventDays = new Set<string>();
  for (const e of typed) {
    const d = new Date(e.start_time);
    eventDays.add(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`);
    const t = d.getTime();
    if (t >= Date.now() - 30 * 86400000 && t <= Date.now() + 30 * 86400000) {
      const k = d.toDateString();
      dayTotals.set(k, (dayTotals.get(k) || 0) + 1);
    }
  }
  const busiest = Array.from(dayTotals.entries()).sort((a, b) => b[1] - a[1])[0] || null;

  // Mini month — the month the visible week starts in; a dot marks days
  // with synced events; clicking a day jumps the grid to that week.
  const calMonth = new Date(days[0].getFullYear(), days[0].getMonth(), 1);
  const startDow = (calMonth.getDay() + 6) % 7;
  const daysInMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 0).getDate();
  const miniCells: (number | null)[] = [];
  for (let i = 0; i < startDow; i++) miniCells.push(null);
  for (let d = 1; d <= daysInMonth; d++) miniCells.push(d);
  const jumpToDay = (dayNum: number) => {
    const target = new Date(calMonth.getFullYear(), calMonth.getMonth(), dayNum);
    target.setHours(0, 0, 0, 0);
    const targetMonday = new Date(target);
    targetMonday.setDate(target.getDate() - ((target.getDay() + 6) % 7));
    const baseMonday = new Date(now);
    baseMonday.setHours(0, 0, 0, 0);
    baseMonday.setDate(baseMonday.getDate() - ((baseMonday.getDay() + 6) % 7));
    setWeekOffset(Math.round((targetMonday.getTime() - baseMonday.getTime()) / (7 * 86400000)));
  };
  const inVisibleWeek = (dayNum: number) => {
    const d = new Date(calMonth.getFullYear(), calMonth.getMonth(), dayNum);
    return days.some(w => w.toDateString() === d.toDateString());
  };

  const eventsForDay = (day: Date) =>
    typed
      .filter(e => new Date(e.start_time).toDateString() === day.toDateString())
      .filter(e => !typeFilter || e._type === typeFilter)
      .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());

  return (
    <Card className="h-full flex flex-col">
      <CardContent className="p-0 flex-1 overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/30">
          <div className="flex items-center gap-2">
            <CalendarDays className="w-4 h-4 text-primary" />
            <h3 className="font-semibold text-xs">Team Calendar</h3>
            <span className="text-[10px] text-muted-foreground">· {wkLabel}</span>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" className="h-6 px-1.5 text-xs" onClick={() => setWeekOffset(o => o - 1)} data-testid="btn-cal-prev">‹</Button>
            <Button variant="ghost" size="sm" className="h-6 px-1.5 text-xs" onClick={() => setWeekOffset(0)} data-testid="btn-cal-today">Today</Button>
            <Button variant="ghost" size="sm" className="h-6 px-1.5 text-xs" onClick={() => setWeekOffset(o => o + 1)} data-testid="btn-cal-next">›</Button>
          </div>
        </div>
        <div className="flex-1 overflow-hidden flex">
          {/* Sidebar — mini month, event types, today's schedule (staff-diary layout) */}
          <div className="w-44 shrink-0 border-r p-2.5 space-y-3 overflow-y-auto hidden md:block">
            <div>
              <div className="text-[10px] font-semibold mb-1">{calMonth.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}</div>
              <div className="grid grid-cols-7 gap-y-0.5 text-center text-[9px] text-muted-foreground">
                {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => <div key={i}>{d}</div>)}
                {miniCells.map((d, i) => {
                  if (d == null) return <div key={i} />;
                  const cellDate = new Date(calMonth.getFullYear(), calMonth.getMonth(), d);
                  const isToday = cellDate.toDateString() === todayStr;
                  const hasEvents = eventDays.has(`${cellDate.getFullYear()}-${cellDate.getMonth()}-${d}`);
                  return (
                    <button
                      key={i}
                      onClick={() => jumpToDay(d)}
                      className={`relative rounded-full w-5 h-5 mx-auto leading-5 hover:bg-muted ${isToday ? "bg-primary text-primary-foreground font-semibold" : inVisibleWeek(d) ? "bg-primary/10" : "text-foreground"}`}
                      data-testid={`cal-mini-${d}`}
                    >
                      {d}
                      {hasEvents && !isToday && <span className="absolute left-1/2 -translate-x-1/2 bottom-0 w-0.5 h-0.5 rounded-full bg-primary" />}
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <div className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Event types</div>
              <div className="space-y-0.5">
                {TYPE_KEYS.map(t => {
                  const Icon = typeIcon[t];
                  return (
                    <button
                      key={t}
                      onClick={() => setTypeFilter(f => f === t ? null : t)}
                      className={`w-full flex items-center gap-1.5 px-1 py-0.5 rounded text-[10px] hover:bg-muted ${typeFilter === t ? "bg-primary/10 font-semibold" : typeFilter ? "opacity-40" : ""}`}
                      data-testid={`cal-type-${t}`}
                    >
                      <Icon className="w-3 h-3 text-muted-foreground" />
                      <span className="capitalize flex-1 text-left">{t}</span>
                      <span className={`w-4 h-4 rounded-full text-[9px] leading-4 text-white text-center ${dotColor[t]}`}>{typeCounts[t]}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <div className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Today's schedule <span className="text-primary">{todaysEvents.length}</span></div>
              {todaysEvents.length === 0 ? (
                <p className="text-[10px] text-muted-foreground">Nothing scheduled</p>
              ) : (
                <div className="space-y-0.5">
                  {todaysEvents.slice(0, 6).map((ev: any) => (
                    <div key={ev.id} className="text-[10px] leading-snug">
                      <span className="font-medium tabular-nums">{new Date(ev.start_time).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</span>{" "}
                      <span className="text-muted-foreground">{ev.title}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          {/* Week grid */}
          <div className="flex-1 overflow-auto">
            <div className="grid min-w-[560px]" style={{ gridTemplateColumns: "44px repeat(5, minmax(0, 1fr))" }}>
              <div />
              {days.map(d => (
                <div key={d.toISOString()} className={`text-center py-1.5 border-b border-l text-xs ${d.toDateString() === todayStr ? "bg-primary/5 font-semibold" : ""}`}>
                  <span className="text-[10px] text-muted-foreground uppercase mr-1">{d.toLocaleDateString("en-GB", { weekday: "short" })}</span>
                  {d.getDate()}
                </div>
              ))}
              <div className="relative border-r">
                {hours.map(h => (
                  <div key={h} className="text-[9px] text-muted-foreground text-right pr-1" style={{ height: ROW_H }}>{String(h).padStart(2, "0")}:00</div>
                ))}
              </div>
              {days.map(d => {
                const dayEvents = eventsForDay(d);
                return (
                  <div key={d.toISOString()} className={`relative border-l ${d.toDateString() === todayStr ? "bg-primary/5" : ""}`} style={{ height: hours.length * ROW_H }}>
                    {hours.map(h => <div key={h} className="border-b border-border/40" style={{ height: ROW_H }} />)}
                    {dayEvents.map((ev: any) => {
                      const start = new Date(ev.start_time);
                      const end = ev.end_time ? new Date(ev.end_time) : new Date(start.getTime() + 3600000);
                      const startH = Math.max(start.getHours() + start.getMinutes() / 60, HOUR_START);
                      const endH = Math.min(Math.max(end.getHours() + end.getMinutes() / 60, startH + 0.5), HOUR_END);
                      if (startH >= HOUR_END) return null;
                      const type = ev._type;
                      return (
                        <button
                          type="button"
                          key={ev.id}
                          onClick={() => setSelectedEvent(ev)}
                          className={`absolute left-0.5 right-0.5 rounded border px-1 py-0.5 text-[9px] leading-tight overflow-hidden text-left cursor-pointer hover:ring-1 hover:ring-primary/50 ${chipColor[type] || chipColor.meeting}`}
                          style={{ top: (startH - HOUR_START) * ROW_H, height: Math.max((endH - startH) * ROW_H - 2, 16) }}
                          title={`${ev.title}${ev.location ? ` · ${ev.location}` : ""}`}
                          data-testid={`cal-event-${ev.id}`}
                        >
                          <span className="font-medium block truncate">{ev.title}</span>
                          {(ev.property_name || ev.location) && <span className="truncate block opacity-80">{ev.property_name || ev.location}</span>}
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        {/* Event details — chips were inert divs; clicking anywhere on the
            calendar did nothing (Woody, 2026-08-04). */}
        {selectedEvent && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setSelectedEvent(null)}>
            <div className="bg-card border rounded-xl shadow-lg w-[340px] max-w-[90vw] p-4 space-y-2" onClick={e => e.stopPropagation()} data-testid="cal-event-detail">
              <div className="flex items-start justify-between gap-2">
                <h4 className="text-sm font-semibold leading-snug">{selectedEvent.title}</h4>
                <Badge variant="outline" className="text-[10px] capitalize shrink-0">{selectedEvent._type}</Badge>
              </div>
              <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                <Clock className="w-3 h-3" />
                {new Date(selectedEvent.start_time).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                {selectedEvent.end_time && <> – {new Date(selectedEvent.end_time).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</>}
              </div>
              {(selectedEvent.location || selectedEvent.property_name) && (
                <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <MapPin className="w-3 h-3" />
                  {selectedEvent.property_name || selectedEvent.location}
                </div>
              )}
              {selectedEvent.property_id && (
                <Link href={`/properties/${selectedEvent.property_id}`} className="text-xs text-primary hover:underline inline-block">
                  Open property →
                </Link>
              )}
              {selectedEvent.description && <p className="text-xs leading-relaxed max-h-[140px] overflow-y-auto whitespace-pre-wrap">{selectedEvent.description}</p>}
              <div className="pt-1 text-right">
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setSelectedEvent(null)}>Close</Button>
              </div>
            </div>
          </div>
        )}
        {/* Intelligence strip — the shared footer board, living INSIDE the
            calendar board rather than orphaned at the page bottom
            (Woody, 2026-08-04). Local calendar reads lead; the CRM/diary
            insights follow from the shared component. */}
        <div data-testid="cal-intelligence" className="border-t">
          <div className="flex items-center gap-4 px-3 py-1 bg-muted/30 text-[10px] flex-wrap">
            <span className="inline-flex items-center gap-1 font-semibold uppercase tracking-wider text-muted-foreground">
              <Sparkles className="w-3 h-3" /> Intelligence
            </span>
            <span><span className="font-semibold uppercase text-muted-foreground mr-1">Today</span>{todaysEvents.length} event{todaysEvents.length === 1 ? "" : "s"}</span>
            {busiest && (
              <span><span className="font-semibold uppercase text-muted-foreground mr-1">Busiest day</span>{new Date(busiest[0]).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })} — {busiest[1]} event{busiest[1] === 1 ? "" : "s"}</span>
            )}
            <span><span className="font-semibold uppercase text-muted-foreground mr-1">Next 30 days</span>{next30} event{next30 === 1 ? "" : "s"}</span>
          </div>
          <IntelligenceFooter />
        </div>
      </CardContent>
    </Card>
  );
}

// Grouped account contacts for the client portfolio dashboard (Woody,
// 2026-08-03: "include brands and agents"): the company's own people, one
// contact per brand with a deal on the portfolio, and the agents working
// those deals. Backed by /api/crm/companies/:id/contact-summary.
function PortfolioContactsBoard({ companyId }: { companyId: string }) {
  const { data } = useQuery<{ yours: any[]; brands: any[]; agents: any[] }>({
    queryKey: ["/api/crm/companies", companyId, "contact-summary"],
    queryFn: async () => {
      const r = await fetch(`/api/crm/companies/${companyId}/contact-summary`, { credentials: "include", headers: getAuthHeaders() });
      if (!r.ok) return { yours: [], brands: [], agents: [] };
      return r.json();
    },
    staleTime: 5 * 60_000,
  });
  // The canonical contacts board (same component as the brand profile) with
  // the dashboard's extra groups; discovery off — this widget is read-heavy
  // and shouldn't burn provider credits on every dashboard load.
  return (
    <CompanyContactsBoard
      companyId={companyId}
      companyName={data?.yours?.[0]?.company_name || "your company"}
      contacts={data?.yours || []}
      extraSections={[
        { key: "brands", title: "Brands on your deals", tint: "text-blue-700", rows: data?.brands || [] },
        { key: "agents", title: "Agents", tint: "text-amber-700", rows: data?.agents || [] },
      ]}
      discovery={false}
      filterPropertyTier={false}
    />
  );
}


export default function Dashboard() {
  const { data: user } = useQuery<User>({ queryKey: ["/api/auth/me"] });
  const { activeTeam } = useTeam();
  const { brand, isLandsec: isBrandLandsec } = useBrand();
  const { toast } = useToast();
  const effectiveTeam = activeTeam && activeTeam !== "all" ? activeTeam : user?.team;
  const isLandsecTeam = effectiveTeam === "Landsec";
  const clientCompanyId = (user as any)?.companyScopeId || (user as any)?.clientTeamCompanyId || null;
  const clientCompanyName = isLandsecTeam ? "Landsec" : null;

  const { data: companyLookup } = useQuery<any>({
    queryKey: ["/api/company-by-name", effectiveTeam],
    queryFn: async () => {
      const res = await fetch(`/api/company-by-name/${encodeURIComponent(effectiveTeam!)}`, { credentials: "include", headers: getAuthHeaders() });
      if (!res.ok) return null;
      return res.json();
    },
    enabled: isLandsecTeam && !clientCompanyId,
    staleTime: 30 * 60 * 1000,
  });

  const resolvedCompanyId = clientCompanyId || companyLookup?.id || null;

  const { data: portfolioData } = useQuery<any>({
    queryKey: ["/api/company-portfolio", resolvedCompanyId],
    queryFn: async () => {
      const res = await fetch(`/api/company-portfolio/${resolvedCompanyId}`, { credentials: "include", headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: isLandsecTeam && !!resolvedCompanyId,
    staleTime: 5 * 60 * 1000,
  });

  // Fetch comps for the portfolio's property areas/postcodes
  const portfolioPostcodes = useMemo(() => {
    if (!portfolioData?.properties) return [];
    return (portfolioData.properties as any[])
      .map((p: any) => {
        const addr = p.address as any;
        if (addr?.postcode) return (addr.postcode as string).split(" ")[0]; // district only e.g. "EC2"
        return null;
      })
      .filter(Boolean) as string[];
  }, [portfolioData?.properties]);

  const { data: portfolioComps = [], isLoading: compsLoading } = useQuery<CrmComp[]>({
    queryKey: ["/api/crm/comps"],
    enabled: isLandsecTeam && !!portfolioData,
    staleTime: 10 * 60 * 1000,
    select: (allComps: CrmComp[]) => {
      if (!portfolioPostcodes.length) return allComps.slice(0, 10);
      // Filter comps whose postcode or areaLocation matches any portfolio property district
      const matched = allComps.filter((c: CrmComp) => {
        const cPostcode = (c.postcode || "").toUpperCase();
        const cArea = (c.areaLocation || "").toUpperCase();
        return portfolioPostcodes.some(district => {
          const d = district.toUpperCase();
          return cPostcode.startsWith(d) || cArea.includes(d);
        });
      });
      // Sort by completionDate desc, take 10
      return matched
        .sort((a: CrmComp, b: CrmComp) => {
          const da = a.completionDate ? new Date(a.completionDate).getTime() : 0;
          const db = b.completionDate ? new Date(b.completionDate).getTime() : 0;
          return db - da;
        })
        .slice(0, 10);
    },
  });

  const { data: landsecAnalytics } = useQuery<any>({
    queryKey: ["/api/portfolio/landsec/analytics"],
    queryFn: async () => {
      const res = await fetch("/api/portfolio/landsec/analytics", { credentials: "include", headers: getAuthHeaders() });
      if (!res.ok) return null;
      return res.json();
    },
    enabled: isLandsecTeam,
    staleTime: 5 * 60 * 1000,
  });

  const [dashboardViewMode, setDashboardViewMode] = useState<"team" | "individual">(() => {
    try { return (localStorage.getItem("bgp_dashboard_view_mode") as "team" | "individual") || "team"; }
    catch { return "team"; }
  });
  // Client logins AND staff in client-view mode — both are served the client
  // dashboard, so the staff-only intelligence/stats calls would just 403.
  const isClientViewer = user?.role === "Client" || !!(user as any)?.companyScopeId;
  const [diaryRange, setDiaryRange] = useState<"today" | "week">("week");
  const handleViewModeChange = useCallback((mode: "team" | "individual") => {
    setDashboardViewMode(mode);
    try { localStorage.setItem("bgp_dashboard_view_mode", mode); } catch { /* private browsing */ }
  }, []);
  const { isLoading: statsLoading } = useQuery<CrmStats>({
    queryKey: ["/api/crm/stats"],
    enabled: !!user && !isClientViewer,
  });
  const { data: crmProperties } = useQuery<CrmProperty[]>({
    queryKey: ["/api/crm/properties"],
  });
  const { data: crmDeals } = useQuery<CrmDeal[]>({
    queryKey: ["/api/crm/deals"],
  });
  const { data: crmContacts } = useQuery<CrmContact[]>({
    queryKey: ["/api/crm/contacts"],
  });
  const { data: crmReqLeasing } = useQuery<any[]>({
    queryKey: ["/api/crm/requirements-leasing"],
  });
  const { data: crmReqInvestment } = useQuery<any[]>({
    queryKey: ["/api/crm/requirements-investment"],
  });
  const { data: bgpUsers } = useQuery<{ id: string; name: string; email: string; team?: string }[]>({
    queryKey: ["/api/users"],
  });
  const { data: dashIntel } = useQuery<DashboardIntelligence>({
    queryKey: ["/api/dashboard/intelligence", dashboardViewMode],
    queryFn: async () => {
      const res = await fetch(`/api/dashboard/intelligence?viewMode=${dashboardViewMode}`, {
        credentials: "include",
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error("Failed to fetch intelligence");
      return res.json();
    },
    staleTime: 60_000,
    enabled: !!user && !isClientViewer,
  });
  const { data: myCalEvents } = useQuery<CalendarEvent[]>({
    queryKey: ["/api/microsoft/calendar"],
    enabled: !!user && !isClientViewer, // clients (and client-view mode) have no M365 surface
  });
  const { data: msStatus } = useQuery<{ connected: boolean }>({
    queryKey: ["/api/user-mail/status"],
    enabled: user?.role !== "Client",
  });
  const diaryDays = 7;
  const { data: teamCalSchedules } = useQuery<any[]>({
    queryKey: ["/api/microsoft/team-calendar", activeTeam, dashboardViewMode, diaryDays],
    queryFn: async () => {
      const team = activeTeam === "all" ? "" : (activeTeam || user?.team || "");
      const url = team
        ? `/api/microsoft/team-calendar?team=${encodeURIComponent(team)}&days=${diaryDays}`
        : `/api/microsoft/team-calendar?days=${diaryDays}`;
      const res = await fetch(url, { credentials: "include", headers: getAuthHeaders() });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: dashboardViewMode === "team" && msStatus?.connected === true,
    staleTime: 60_000,
  });
  const { data: diaryIntelligence, isLoading: diaryIntelLoading } = useQuery<{ summary: string }>({
    queryKey: ["/api/microsoft/team-intelligence", diaryRange === "week" ? "week" : "day"],
    queryFn: async () => {
      const period = diaryRange === "week" ? "week" : "day";
      const res = await fetch(`/api/microsoft/team-intelligence?period=${period}`, { credentials: "include", headers: getAuthHeaders() });
      if (!res.ok) return { summary: "" };
      return res.json();
    },
    enabled: msStatus?.connected === true,
    staleTime: 5 * 60_000,
  });
  const { data: calInsightsData } = useQuery<{ insights: Array<{ type: string; title: string; detail: string; priority: number }> }>({
    queryKey: ["/api/microsoft/calendar/insights"],
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
    enabled: user?.role !== "Client", // clients have no Microsoft 365 access
  });
  const calInsights = calInsightsData?.insights || [];
  const { data: invTrackerItems } = useQuery<InvTracker[]>({
    queryKey: ["/api/investment-tracker"],
    enabled: user?.role !== "Client",
  });
  const { data: newsArticles } = useQuery<NewsArticle[]>({
    queryKey: ["/api/news-feed/articles", "dashboard", activeTeam],
    queryFn: async () => {
      const team = activeTeam === "all" ? "" : (activeTeam || user?.team || "Investment");
      const url = team
        ? `/api/news-feed/articles?team=${encodeURIComponent(team)}&limit=12`
        : `/api/news-feed/articles?limit=12`;
      const res = await fetch(url, { credentials: "include", headers: getAuthHeaders() });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!user,
  });

  const [dashboardEditing, setDashboardEditing] = useState(false);

  const saveMutation = useMutation({
    mutationFn: async (widgets: string[]) => {
      await apiRequest("PATCH", "/api/auth/me/dashboard-widgets", { widgets });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      toast({ title: "Widgets updated", duration: 1500 });
    },
    onError: () => {
      toast({ title: "Failed to update widgets", variant: "destructive" });
    },
  });

  const layoutSaveMutation = useMutation({
    mutationFn: async (layout: Record<string, any> | null) => {
      await apiRequest("PATCH", "/api/auth/me/dashboard-layout", { layout });
    },
    onSuccess: (_data, savedLayout) => {
      queryClient.setQueryData(["/api/auth/me"], (old: any) => {
        if (!old) return old;
        return { ...old, dashboardLayout: savedLayout };
      });
    },
    onError: () => {
      toast({ title: "Failed to save layout", variant: "destructive" });
    },
  });

  // v14: Landsec portfolio re-arranged (tracker + tasks top, calendar +
  // files boards added, deal-movements board folded into Activity).
  const LAYOUT_VERSION = 14;
  const rawSavedLayout = (user as any)?.dashboardLayout || null;
  const savedLayoutVersion = rawSavedLayout?._version || 1;
  const validSaved = savedLayoutVersion >= LAYOUT_VERSION ? rawSavedLayout : null;

  const { data: templateData } = useQuery<{ template: Record<string, any> | null }>({
    queryKey: ["/api/dashboard-template"],
  });
  const rawTemplate = templateData?.template;
  const templateLayout = (rawTemplate?._version >= LAYOUT_VERSION) ? rawTemplate : null;

  // The client-team dashboard is standardised: in Landsec view (client
  // logins AND staff switched into the team) the org template — set from
  // Mark Warne's arrangement — beats any personal layout, so everyone sees
  // the same board (Woody, 2026-08-04: "should be the same"). Personal
  // layouts still win on the staff dashboard.
  const preferTemplate = isLandsecTeam || isClientViewer;
  const firstLayout = preferTemplate ? (templateLayout || validSaved) : (validSaved || templateLayout);
  const secondLayout = preferTemplate ? validSaved : templateLayout;

  const widgetSavedLayoutRaw = firstLayout?.widgets || secondLayout?.widgets || null;
  const hiddenPortfolioBoards: string[] = firstLayout?.hiddenPortfolio ?? secondLayout?.hiddenPortfolio ?? ["portfolio-properties"];

  // Portfolio boards and widgets used to live in two separate grids stacked
  // on the page, so a widget (e.g. My Tasks & Briefing) could never be
  // dragged above the portfolio boards — drags "to the top" silently snapped
  // back. When the portfolio section is present they now render as ONE grid,
  // laid out from `combined` — seeded by stacking the two legacy layouts so
  // existing arrangements carry over.
  const combinedSavedLayoutRaw = firstLayout?.combined || secondLayout?.combined || (() => {
    const p = (firstLayout?.portfolio || secondLayout?.portfolio)?.lg as any[] | undefined;
    const w = (firstLayout?.widgets || secondLayout?.widgets)?.lg as any[] | undefined;
    if (!p && !w) return null;
    const maxY = (p || []).reduce((m: number, l: any) => Math.max(m, l.y + l.h), 0);
    return { lg: [...(p || []), ...(w || []).map((l: any) => ({ ...l, y: l.y + maxY }))] };
  })();

  // Side-by-side board pairs stay the same height even in saved layouts
  // where one was dragged/seeded taller (Woody, 2026-08-04): the Letting
  // Tracker follows My Tasks & Briefing; Your BGP Team follows
  // Properties & Deals.
  const HEIGHT_PAIRS: Array<[follower: string, leader: string]> = [
    ["available-units", "my-tasks"],
    ["portfolio-team", "portfolio-deals"],
  ];
  const matchTrackerToTasks = (layout: any) => {
    const lg = layout?.lg;
    if (!Array.isArray(lg)) return layout;
    let next = lg;
    for (const [followerId, leaderId] of HEIGHT_PAIRS) {
      const leader = next.find((l: any) => l.i === leaderId);
      const follower = next.find((l: any) => l.i === followerId);
      if (!leader || !follower || follower.h === leader.h) continue;
      next = next.map((l: any) => (l.i === followerId ? { ...l, h: leader.h } : l));
    }
    return next === lg ? layout : { ...layout, lg: next };
  };
  const combinedSavedLayout = combinedSavedLayoutRaw ? matchTrackerToTasks(combinedSavedLayoutRaw) : combinedSavedLayoutRaw;
  const widgetSavedLayout = widgetSavedLayoutRaw ? matchTrackerToTasks(widgetSavedLayoutRaw) : widgetSavedLayoutRaw;

  const isAdmin = (user as any)?.isAdmin || (user as any)?.is_admin;

  const setTemplateMutation = useMutation({
    mutationFn: async () => {
      const current = (user as any)?.dashboardLayout || {};
      await apiRequest("PUT", "/api/dashboard-template", { template: { ...current, _version: LAYOUT_VERSION } });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard-template"] });
      toast({ title: "Template saved", description: "All new users will see this layout by default.", duration: 3000 });
    },
    onError: () => {
      toast({ title: "Failed to save template", variant: "destructive" });
    },
  });

  const handleCombinedLayoutSave = useCallback((layout: Record<string, any>) => {
    const current = (user as any)?.dashboardLayout || {};
    layoutSaveMutation.mutate({ ...current, combined: layout, _version: LAYOUT_VERSION });
  }, [layoutSaveMutation, user]);

  const handleWidgetLayoutSave = useCallback((layout: Record<string, any>) => {
    const current = (user as any)?.dashboardLayout || {};
    layoutSaveMutation.mutate({ ...current, widgets: layout, _version: LAYOUT_VERSION });
  }, [layoutSaveMutation, user]);

  // Hide/show must base the hidden list on hiddenPortfolioBoards (what the
  // UI is actually showing, template fallback included) — basing it on the
  // user's own (often absent) layout meant a chip click saved the wrong
  // list: showing one board unhid everything, hiding one re-showed the
  // template-hidden ones.
  const handleHidePortfolioBoard = useCallback((boardId: string) => {
    const current = (user as any)?.dashboardLayout || {};
    const hidden = Array.from(new Set([...hiddenPortfolioBoards, boardId]));
    layoutSaveMutation.mutate({ ...current, hiddenPortfolio: hidden, _version: LAYOUT_VERSION });
  }, [layoutSaveMutation, user, hiddenPortfolioBoards]);

  const handleShowPortfolioBoard = useCallback((boardId: string) => {
    const current = (user as any)?.dashboardLayout || {};
    const hidden = hiddenPortfolioBoards.filter((id: string) => id !== boardId);
    // Drop the restored board's stale rect so the grid appends it fresh at
    // the bottom (full width, own row) instead of dumping it onto its old
    // coordinates on top of whatever now lives there.
    const portfolio = current.portfolio?.lg
      ? { ...current.portfolio, lg: current.portfolio.lg.filter((l: any) => l.i !== boardId) }
      : current.portfolio;
    const combined = current.combined?.lg
      ? { ...current.combined, lg: current.combined.lg.filter((l: any) => l.i !== boardId) }
      : current.combined;
    layoutSaveMutation.mutate({ ...current, portfolio, combined, hiddenPortfolio: hidden, _version: LAYOUT_VERSION });
  }, [layoutSaveMutation, user, hiddenPortfolioBoards]);

  const handleResetLayout = useCallback(() => {
    layoutSaveMutation.mutate(null as any, {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/dashboard-template"] }),
    });
  }, [layoutSaveMutation]);

  useEffect(() => {
    if (rawSavedLayout && savedLayoutVersion < LAYOUT_VERSION) {
      layoutSaveMutation.mutate({ _version: LAYOUT_VERSION } as any);
    }
  }, [savedLayoutVersion]);

  const isAllTeams = activeTeam === "all";
  const currentTeam = isAllTeams ? "All Teams" : (activeTeam || user?.team || "Investment");
  const allProperties = crmProperties || [];
  const allDeals = crmDeals || [];

  const TEAM_ALIASES: Record<string, string[]> = useMemo(() => ({
    "London F&B": ["London F&B"],
    "London Retail": ["London Retail"],
    "National Leasing": ["National Leasing", "National"],
    "Investment": ["Investment"],
    "Tenant Rep": ["Tenant Rep"],
    "Development": ["Development"],
    "Lease Advisory": ["Lease Advisory"],
    "Office / Corporate": ["Office / Corporate", "Office", "Corporate"],
    "Landsec": ["Landsec"],
  }), []);

  const matchesTeam = useCallback((teamField: string | string[] | null | undefined) => {
    if (isAllTeams) return true;
    if (!teamField) return false;
    const teams: string[] = Array.isArray(teamField) ? teamField : typeof teamField === "string" ? teamField.split(",").map((t: string) => t.trim()) : [];
    if (teams.length === 0) return false;
    const aliases = TEAM_ALIASES[currentTeam] || [currentTeam];
    return teams.some(t => aliases.some(a => a.toLowerCase() === t.toLowerCase()));
  }, [isAllTeams, currentTeam, TEAM_ALIASES]);

  const deals = useMemo(() => {
    if (isAllTeams) return allDeals;
    return allDeals.filter(d => matchesTeam(d.team));
  }, [allDeals, isAllTeams, matchesTeam]);

  const properties = useMemo(() => {
    if (isAllTeams) return allProperties;
    const aliases = TEAM_ALIASES[currentTeam] || [currentTeam];
    return allProperties.filter(p => {
      const engagement = Array.isArray(p.bgpEngagement) ? p.bgpEngagement : [];
      const folderTeams = Array.isArray(p.folderTeams) ? p.folderTeams : [];
      const combined = [...engagement, ...folderTeams];
      if (combined.length === 0) return false;
      return combined.some(t => aliases.some(a => a.toLowerCase() === t.toLowerCase()));
    });
  }, [allProperties, isAllTeams, currentTeam, TEAM_ALIASES]);

  const teamContacts = useMemo(() => {
    if (!crmContacts) return [];
    if (isAllTeams) return crmContacts;
    const aliases = TEAM_ALIASES[currentTeam] || [currentTeam];
    return crmContacts.filter(c => {
      let allocs: string[] = [];
      try {
        const parsed = c.bgpAllocation ? JSON.parse(c.bgpAllocation) : [];
        allocs = Array.isArray(parsed) ? parsed : c.bgpAllocation ? [c.bgpAllocation] : [];
      } catch {
        allocs = c.bgpAllocation ? [c.bgpAllocation] : [];
      }
      return allocs.some(a => aliases.some(al => al.toLowerCase() === a.toLowerCase()));
    });
  }, [crmContacts, isAllTeams, currentTeam, TEAM_ALIASES]);

  const userTeamMap = useMemo(() => {
    const map: Record<string, string> = {};
    if (bgpUsers) {
      for (const u of bgpUsers) {
        if (u.team) map[u.id] = u.team;
      }
    }
    return map;
  }, [bgpUsers]);

  const reqMatchesTeam = useCallback((r: any) => {
    const aliases = TEAM_ALIASES[currentTeam] || [currentTeam];
    const assignedIds: string[] = Array.isArray(r.bgpContactUserIds) ? r.bgpContactUserIds : [];
    if (assignedIds.length > 0) {
      return assignedIds.some(uid => {
        const uTeam = userTeamMap[uid];
        if (!uTeam) return false;
        return aliases.some(a => a.toLowerCase() === uTeam.toLowerCase());
      });
    }
    const group = r.groupName || "";
    return aliases.some(a => group.toLowerCase().includes(a.toLowerCase()));
  }, [currentTeam, TEAM_ALIASES, userTeamMap]);

  const teamReqLeasing = useMemo(() => {
    if (!crmReqLeasing) return [];
    if (isAllTeams) return crmReqLeasing;
    return crmReqLeasing.filter(reqMatchesTeam);
  }, [crmReqLeasing, isAllTeams, reqMatchesTeam]);

  const teamReqInvestment = useMemo(() => {
    if (!crmReqInvestment) return [];
    if (isAllTeams) return crmReqInvestment;
    return crmReqInvestment.filter(reqMatchesTeam);
  }, [crmReqInvestment, isAllTeams, reqMatchesTeam]);

  const knownIds = WIDGET_REGISTRY.map(w => w.id);
  // Preferred display order; any known widget not listed here falls to the end.
  const WIDGET_ORDER = [
    "my-leads", "news-summary", "kpi-overview",
    "today-diary", "key-instructions", "active-contacts",
  ];
  const orderIndex = (id: string) => {
    const i = WIDGET_ORDER.indexOf(id);
    return i === -1 ? WIDGET_ORDER.length : i;
  };
  // Client logins (e.g. Landsec) get the portfolio section plus any widgets
  // they've added from the vetted client-safe set. Every other standard
  // widget is BGP-ops (inbox, WIP, SharePoint, KPI fees, org alerts) and is
  // filtered out even if it somehow ends up saved.
  const isClientUser = user?.role === "Client" || !!(user as any)?.companyScopeId;
  // Migrate one renamed legacy id, then ensure the three always-on widgets are
  // present (staff only — clients fully control their own safe widget set).
  // Clients DEFAULT to the Letting Tracker + Tasks widgets (Woody,
  // 2026-08-03: "letting tracker and tasks should be near the top") — a
  // saved widget list still wins, so removals stick.
  const requested = (user?.dashboardWidgets ?? (isClientUser ? ["available-units", "my-tasks", "news-summary"] : DEFAULT_WIDGETS))
    .map((id: string) => id === "recent-properties" ? "key-instructions" : id);
  const withDefaults = isClientUser
    ? requested
    : Array.from(new Set([...requested, "my-leads", "news-summary", "kpi-overview"]));
  const activeWidgets = withDefaults
    .filter((id: string) => knownIds.includes(id)) // single filter: drop unknown ids
    .filter((id: string) => !isClientUser || CLIENT_SAFE_WIDGET_IDS.includes(id)) // clients: safe set only
    .sort((a: string, b: string) => orderIndex(a) - orderIndex(b)); // single sort

  const widgetLabelMap = useMemo(() => {
    const map: Record<string, string> = {};
    WIDGET_REGISTRY.forEach(w => { map[w.id] = w.name; });
    return map;
  }, []);

  const widgetDescriptionMap = useMemo(() => {
    const map: Record<string, string> = {};
    WIDGET_REGISTRY.forEach(w => { if (w.description) map[w.id] = w.description; });
    return map;
  }, []);

  // Board blurbs for the client-portfolio grid — shown in the edit-mode
  // handle so each board says what it does.
  const PORTFOLIO_DESCRIPTIONS: Record<string, string> = {
    "portfolio-company": "Your landlord entity and account summary",
    "portfolio-events": "Upcoming diary events and recent emails / calls / meetings across your portfolio",
    "portfolio-calendar": "The BGP account team's diary for your portfolio, day by day",
    "portfolio-files": "Your document library — the account folder tree, browsable in place",
    "portfolio-kpis": "Headline metrics across your portfolio",
    "portfolio-team": "The BGP people working across your portfolio and their properties",
    "portfolio-properties": "Every property linked to your account",
    "portfolio-relationship": "Your account with BGP — coverage, contacts, last touch and live deals",
    "portfolio-leasing": "Every unit — tenant, occupancy, rent and expiry",
    "portfolio-contacts": "Your key contacts on the account",
    "portfolio-deals": "Your portfolio on the map with active properties and live deals below",
    "portfolio-lease-expiry": "Units with leases expiring over the next five years, by quarter",
    "portfolio-vacancy-pipeline": "Vacant units per property vs the letting deals working to fill them",
  };

  const handleHideWidget = useCallback((widgetId: string) => {
    const currentWidgets = activeWidgets.filter(id => id !== widgetId);
    saveMutation.mutate(currentWidgets);
  }, [activeWidgets, saveMutation]);

  const { data: favoriteIds = [] } = useQuery<string[]>({
    queryKey: ["/api/favorite-instructions"],
  });

  const keyInstructions = useMemo(() => {
    const instructions = properties.filter(p => (p.status || "").toLowerCase() === "bgp instruction");
    if (favoriteIds.length > 0) {
      return instructions.filter(p => favoriteIds.includes(p.id)).slice(0, 5);
    }
    return instructions.slice(0, 5);
  }, [properties, favoriteIds]);

  if (statsLoading) return <LoadingSkeleton />;

  const dealsByGroup: Record<string, number> = {};
  for (const deal of deals) {
    const group = deal.groupName || "Other";
    dealsByGroup[group] = (dealsByGroup[group] || 0) + 1;
  }
  const topGroups = Object.entries(dealsByGroup).sort(([, a], [, b]) => b - a).slice(0, 5);

  // Filled in by the portfolio section below (renders earlier in the JSX)
  // and consumed by the single dashboard grid at the bottom — portfolio
  // boards and widgets share one grid so any board can be dragged anywhere.
  let portfolioBoardsForGrid: any[] = [];

  return (
    <div className="p-4 sm:p-6 space-y-6" data-testid="dashboard-page">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
            <Home className="w-5 h-5 text-primary" />
          </div>
          <div className="space-y-1">
            <h1 className="text-2xl font-bold tracking-tight">
              {isBrandLandsec ? "Landsec Portfolio Dashboard" : `Welcome back, ${user?.name?.split(" ")[0] || "there"}`}
            </h1>
            <p className="text-sm text-muted-foreground">
              {isBrandLandsec ? (
                <>{brand.footerText}{!isClientUser && <> · {dashboardViewMode === "team" ? "Team view" : "Individual view"}</>}</>
              ) : (
                <>{currentTeam} · {dashboardViewMode === "team" ? "Team view" : "Individual view"}</>
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {dashboardEditing && (
            <>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-[11px] gap-1 text-muted-foreground"
                onClick={handleResetLayout}
                data-testid="button-reset-grid-layout"
              >
                <RotateCcw className="w-3 h-3" /> Reset layout
              </Button>
              {isAdmin && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-[11px] gap-1 text-muted-foreground"
                  onClick={() => setTemplateMutation.mutate()}
                  disabled={setTemplateMutation.isPending}
                  data-testid="button-set-template"
                >
                  <LayoutTemplate className="w-3 h-3" />
                  {setTemplateMutation.isPending ? "Saving..." : "Set as template"}
                </Button>
              )}
              <WidgetPickerDialog
                activeWidgets={activeWidgets}
                onSave={(widgets, onDone) => {
                  // Close the dialog via the mutation's per-call onSuccess so
                  // it fires with a fresh callback (routing it through state
                  // left the dialog stuck open — widgets saved but nothing
                  // appeared to happen).
                  saveMutation.mutate(widgets, { onSuccess: () => onDone() });
                }}
                saving={saveMutation.isPending}
                viewMode={dashboardViewMode}
                onViewModeChange={handleViewModeChange}
                boards={isClientUser ? CLIENT_BOARD_REGISTRY : undefined}
                showViewMode={!isClientUser}
              />
            </>
          )}
          <Button
            variant={dashboardEditing ? "default" : "outline"}
            size="sm"
            className="gap-1.5"
            onClick={() => setDashboardEditing(!dashboardEditing)}
            data-testid="button-edit-dashboard"
          >
            {dashboardEditing ? (
              <><Check className="w-3.5 h-3.5" /> Done</>
            ) : (
              <><Pencil className="w-3.5 h-3.5" /> Edit</>
            )}
          </Button>
        </div>
      </div>

      {isLandsecTeam && portfolioData && (() => {
        const isExpiringSoon = (d: string | null) => {
          if (!d) return false;
          const exp = new Date(d);
          const now = new Date();
          const sixMonths = new Date();
          sixMonths.setMonth(sixMonths.getMonth() + 6);
          return exp >= now && exp <= sixMonths;
        };

        const leasingByProperty = new Map<string, { name: string; id: string; units: any[] }>();
        for (const u of (portfolioData.leasingUnits || [])) {
          const key = u.property_id;
          if (!leasingByProperty.has(key)) leasingByProperty.set(key, { name: u.property_name || "Unknown", id: key, units: [] });
          leasingByProperty.get(key)!.units.push(u);
        }

        const dealsByProperty = new Map<string, { property: any; deals: any[] }>();
        const unlinkedDeals: any[] = [];
        for (const d of (portfolioData.deals || [])) {
          if (d.property_id) {
            if (!dealsByProperty.has(d.property_id)) {
              const prop = (portfolioData.properties || []).find((p: any) => p.id === d.property_id);
              dealsByProperty.set(d.property_id, { property: prop || { id: d.property_id, name: d.property_name || "Unknown" }, deals: [] });
            }
            dealsByProperty.get(d.property_id)!.deals.push(d);
          } else {
            unlinkedDeals.push(d);
          }
        }

        // Vacancy is defined explicitly (Vacant / Void / Available) so tenancy
        // statuses like "Not Vacant" and "Occupied"/"Let" all count as occupied.
        const isVacantStatus = (s: string) => s === "Vacant" || s === "Void" || s === "Available";
        const totalLeasingUnits = portfolioData.leasingUnits?.length || 0;
        const occupiedUnits = (portfolioData.leasingUnits || []).filter((u: any) => !isVacantStatus(u.status)).length;
        const expiringUnits = (portfolioData.leasingUnits || []).filter((u: any) => isExpiringSoon(u.lease_expiry)).length;

        const companyInfo = portfolioData.company;
        const bgpContactColors = [
          "bg-orange-500", "bg-teal-600", "bg-zinc-700", "bg-purple-600",
          "bg-blue-600", "bg-emerald-600", "bg-indigo-600", "bg-pink-600",
          "bg-amber-600", "bg-cyan-600", "bg-rose-600", "bg-lime-700",
        ];

        const stats = portfolioData.stats || {};
        // Average over units that actually carry a rent — dividing by every
        // unit understates it while rent coverage is partial.
        const rentUnits = stats.rentRecordedUnits ?? 0;
        const avgRentPerUnit = rentUnits > 0 ? stats.totalPassingRent / rentUnits : 0;
        const occupiedCount = stats.totalUnits - stats.vacantUnits;
        const rentCoveragePct = occupiedCount > 0 ? Math.min(100, Math.round((rentUnits / occupiedCount) * 100)) : 0;
        const occupancyRate = stats.totalUnits > 0 ? ((occupiedCount / stats.totalUnits) * 100).toFixed(1) : "0";

        const portfolioGridItems = [
          companyInfo ? {
            id: "portfolio-company",
            label: "Company Info",
            defaultW: 6, defaultH: 12, minW: 4, minH: 6,
            content: (
              <Card className="h-full flex flex-col">
                <CardContent className="p-3 flex-1 overflow-hidden flex flex-col">
                  <div className="flex items-start gap-3 mb-3">
                    <div className="w-12 h-12 rounded-lg bg-teal-50 dark:bg-teal-900/30 border flex items-center justify-center flex-shrink-0">
                      <Landmark className="w-6 h-6 text-teal-600 dark:text-teal-400" />
                    </div>
                    <div>
                      <h3 className="text-lg font-semibold">{companyInfo.name}</h3>
                      {companyInfo.companyType && (
                        <Badge className="text-[10px] bg-zinc-800 text-white dark:bg-zinc-200 dark:text-zinc-800">{companyInfo.companyType}</Badge>
                      )}
                    </div>
                  </div>
                  {/* Headline KPI strip — the first screen should carry the
                      portfolio numbers, not just the company name. */}
                  <div className="grid grid-cols-4 gap-2 mb-3">
                    <div className="rounded-lg border bg-muted/30 px-2 py-1.5 text-center">
                      <p className="text-base font-bold tabular-nums leading-tight">{(portfolioData.properties || []).length}</p>
                      <p className="text-[9px] text-muted-foreground uppercase tracking-wider">Properties</p>
                    </div>
                    <div className="rounded-lg border bg-muted/30 px-2 py-1.5 text-center">
                      <p className="text-base font-bold tabular-nums leading-tight">{occupancyRate}%</p>
                      <p className="text-[9px] text-muted-foreground uppercase tracking-wider">Occupancy</p>
                    </div>
                    <div className="rounded-lg border bg-muted/30 px-2 py-1.5 text-center">
                      <p className="text-base font-bold tabular-nums leading-tight">{stats.vacantUnits ?? 0}</p>
                      <p className="text-[9px] text-muted-foreground uppercase tracking-wider">Vacant units</p>
                    </div>
                    <div className="rounded-lg border bg-muted/30 px-2 py-1.5 text-center">
                      <p className="text-base font-bold tabular-nums leading-tight">{expiringUnits}</p>
                      <p className="text-[9px] text-muted-foreground uppercase tracking-wider">Expiring soon</p>
                    </div>
                  </div>
                  <ScrollArea className="flex-1">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pr-2">
                      <div className="space-y-3">
                        {companyInfo.website && (
                          <div>
                            <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider mb-0.5">Website</p>
                            <a href={companyInfo.website} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1" data-testid="link-company-website">
                              <Globe className="w-3 h-3" />{companyInfo.website.replace(/^https?:\/\//, "")}
                            </a>
                          </div>
                        )}
                        {companyInfo.address && (
                          <div>
                            <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider mb-0.5">Address</p>
                            <p className="text-sm flex items-center gap-1">
                              <MapPin className="w-3 h-3 text-emerald-500 flex-shrink-0" />
                              {[companyInfo.address.line1, companyInfo.address.city, companyInfo.address.postcode].filter(Boolean).join(", ")}
                            </p>
                          </div>
                        )}
                        {/* KYC/AML status + PSC ownership is BGP's own
                            compliance record on the client — never show it
                            back to the client themselves. */}
                        {(companyInfo.kycStatus && !isClientUser) && (
                          <div>
                            <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider mb-0.5">KYC & Ownership</p>
                            <div className="flex items-center gap-2">
                              <Badge className={`text-[10px] ${companyInfo.kycStatus === "approved" ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300" : "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-300"}`}>
                                <ShieldCheck className="w-3 h-3 mr-0.5" />
                                {companyInfo.kycStatus === "approved" ? "KYC Passed" : companyInfo.kycStatus}
                              </Badge>
                              {companyInfo.kycCheckedAt && (
                                <span className="text-[10px] text-muted-foreground">
                                  {new Date(companyInfo.kycCheckedAt).toLocaleDateString("en-GB", { day: "numeric", month: "numeric", year: "numeric" })}
                                </span>
                              )}
                            </div>
                            {companyInfo.pscList?.length > 0 && (
                              <div className="mt-1.5">
                                <p className="text-[10px] text-muted-foreground mb-0.5">Ownership (PSCs)</p>
                                <div className="flex flex-wrap gap-1">
                                  {companyInfo.pscList.map((psc: string, i: number) => (
                                    <Badge key={i} variant="outline" className="text-[10px] font-normal">{psc}</Badge>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                      <div>
                        {companyInfo.bgpContacts?.length > 0 && (
                          <div>
                            <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider mb-1">BGP Contacts</p>
                            <div className="flex flex-wrap gap-1">
                              {companyInfo.bgpContacts.map((name: string, i: number) => (
                                <Badge key={i} className={`text-[10px] text-white ${bgpContactColors[i % bgpContactColors.length]}`}>
                                  {name}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                    {companyInfo.description && (
                      <div className="mt-3 pt-3 border-t">
                        <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider mb-0.5">Description</p>
                        <p className="text-sm text-muted-foreground">{companyInfo.description}</p>
                      </div>
                    )}
                  </ScrollArea>
                </CardContent>
              </Card>
            ),
          } : null,
          {
            id: "portfolio-events",
            label: "Activity",
            defaultW: 6, defaultH: 12, minW: 3, minH: 6,
            content: (
              <Card className="h-full flex flex-col">
                <CardContent className="p-3 space-y-2 flex-1 overflow-hidden flex flex-col">
                  <h3 className="font-semibold text-xs flex items-center gap-1.5">
                    <CalendarDays className="w-3.5 h-3.5 text-teal-500" />
                    Activity
                  </h3>
                  <p className="text-[10px] text-muted-foreground -mt-1">Upcoming diary events and recent emails / calls / meetings across your portfolio.</p>
                  {/* Canonical ActivitySummary (Woody, 2026-08-03) — replaces
                      the bespoke Upcoming Events list; same board as the
                      property page and staff dashboard. */}
                  <div className="flex-1 overflow-hidden">
                    <ActivitySummary companyId={resolvedCompanyId!} />
                  </div>
                </CardContent>
              </Card>
            ),
          },
          {
            id: "portfolio-kpis",
            label: "Key Metrics",
            defaultW: 12, defaultH: 4, minW: 6, minH: 3,
            content: (
              <Card className="h-full">
                <CardContent className="p-3 h-full">
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 h-full">
                    <div className="flex flex-col justify-center p-2 rounded-lg bg-teal-50 dark:bg-teal-900/20 border border-teal-200 dark:border-teal-800" data-testid="kpi-properties">
                      <p className="text-[10px] text-teal-600 dark:text-teal-400 font-medium uppercase tracking-wider">Properties</p>
                      <p className="text-2xl font-bold text-teal-700 dark:text-teal-300">{Number(stats.totalProperties || 0).toLocaleString("en-GB")}</p>
                    </div>
                    <div className="flex flex-col justify-center p-2 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800" data-testid="kpi-units">
                      <p className="text-[10px] text-blue-600 dark:text-blue-400 font-medium uppercase tracking-wider">Total Units</p>
                      <p className="text-2xl font-bold text-blue-700 dark:text-blue-300">{Number(stats.totalUnits || 0).toLocaleString("en-GB")}</p>
                      <p className="text-[10px] text-muted-foreground">{occupiedCount.toLocaleString("en-GB")} occupied · {Number(stats.vacantUnits || 0).toLocaleString("en-GB")} vacant</p>
                    </div>
                    <div className="flex flex-col justify-center p-2 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800" data-testid="kpi-occupancy">
                      <p className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium uppercase tracking-wider">Occupancy</p>
                      <p className="text-2xl font-bold text-emerald-700 dark:text-emerald-300">{occupancyRate}%</p>
                      <p className="text-[10px] text-muted-foreground">{stats.vacancyRate}% vacancy</p>
                    </div>
                    <div className="flex flex-col justify-center p-2 rounded-lg bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800" data-testid="kpi-rent">
                      <p className="text-[10px] text-purple-600 dark:text-purple-400 font-medium uppercase tracking-wider">Passing Rent</p>
                      <p className="text-xl font-bold text-purple-700 dark:text-purple-300">£{(stats.totalPassingRent / 1000000).toFixed(1)}m</p>
                      <p className="text-[10px] text-muted-foreground">
                        {rentUnits > 0 && rentCoveragePct < 95
                          ? `across ${rentUnits.toLocaleString()} units with rent recorded (${rentCoveragePct}% of occupied)`
                          : `£${avgRentPerUnit.toLocaleString("en-GB", { maximumFractionDigits: 0 })}/unit avg`}
                      </p>
                    </div>
                    <div className="flex flex-col justify-center p-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800" data-testid="kpi-deals">
                      <p className="text-[10px] text-amber-600 dark:text-amber-400 font-medium uppercase tracking-wider">Active Deals</p>
                      <p className="text-2xl font-bold text-amber-700 dark:text-amber-300">{stats.activeDeals}</p>
                    </div>
                    <div className="flex flex-col justify-center p-2 rounded-lg bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800" data-testid="kpi-expiring">
                      <p className="text-[10px] text-rose-600 dark:text-rose-400 font-medium uppercase tracking-wider">Expiring (6m)</p>
                      <p className="text-2xl font-bold text-rose-700 dark:text-rose-300">{expiringUnits}</p>
                      <p className="text-[10px] text-muted-foreground">leases expiring soon</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ),
          },
          {
            id: "portfolio-team",
            label: "Your BGP Team",
            defaultW: 12, defaultH: 18, minW: 6, minH: 6,
            content: (
              <Card className="h-full flex flex-col">
                <CardContent className="p-3 space-y-2 flex-1 overflow-hidden flex flex-col">
                  <h3 className="font-semibold text-xs flex items-center gap-1.5">
                    <Users className="w-3.5 h-3.5 text-teal-500" />
                    Your BGP Team
                  </h3>
                  <p className="text-[10px] text-muted-foreground -mt-1">
                    The BGP people working across your portfolio — account leads, asset management and leasing.
                  </p>
                  {/* Plain overflow container, not ScrollArea — the team
                      columns overflow HORIZONTALLY and radix ScrollArea only
                      scrolls vertically, clipping the extra columns with no
                      way to reach them. */}
                  <div className="flex-1 overflow-auto pr-1">
                    <ClientTeamOrgChart clientCompanyId={resolvedCompanyId!} />
                  </div>
                </CardContent>
              </Card>
            ),
          },
          portfolioData.properties?.length > 0 ? {
            id: "portfolio-properties",
            label: "Linked Properties",
            defaultW: 12, defaultH: 11, minW: 6, minH: 6,
            content: (
              <Card className="h-full flex flex-col">
                <CardContent className="p-3 space-y-2 flex-1 overflow-hidden flex flex-col">
                  <h3 className="font-semibold text-xs flex items-center gap-1.5">
                    <Building2 className="w-3.5 h-3.5 text-teal-500" />
                    Linked Properties ({portfolioData.properties.length})
                  </h3>
                  <div className="flex-1 overflow-hidden">
                    <PropertiesSummary companyId={resolvedCompanyId!} role="landlord" />
                  </div>
                </CardContent>
              </Card>
            ),
          } : null,
          // BGP Relationship — the client-facing half of the relationship zone
          // on the landlord page: who covers the account, how many people and
          // properties we're across, last touch and live deals.
          {
            id: "portfolio-relationship",
            label: "BGP Relationship",
            defaultW: 6, defaultH: 14, minW: 3, minH: 4,
            content: (() => {
              const evs = (portfolioData.events || []) as any[];
              const past = evs
                .map((e: any) => e.start_time)
                .filter((t: any) => t && new Date(t).getTime() <= Date.now())
                .sort()
                .reverse();
              const lastTouch = past[0] as string | undefined;
              const daysSince = lastTouch
                ? Math.floor((Date.now() - new Date(lastTouch).getTime()) / 864e5)
                : null;
              const bgpTeam: string[] = companyInfo?.bgpContacts || [];
              return (
                <Card className="h-full flex flex-col">
                  <CardContent className="p-3 space-y-2 flex-1 overflow-auto">
                    <h3 className="font-semibold text-xs flex items-center gap-1.5">
                      <Handshake className="w-3.5 h-3.5 text-teal-500" />
                      BGP Relationship
                    </h3>
                    <p className="text-[10px] text-muted-foreground -mt-1">
                      How the account is actually going — AI read of the live
                      relationship, not a count.
                    </p>
                    {/* The AI relationship read, not a stats grid. Properties /
                        live deals already sit in the tiles at the top of this
                        dashboard, so repeating them here said nothing; the
                        'activity' take is the "BGP take — relationship read". */}
                    {clientCompanyId ? (
                      <BgpTakeStrip companyId={clientCompanyId} tab="activity" />
                    ) : (
                      <p className="text-xs text-muted-foreground italic">Relationship read unavailable.</p>
                    )}
                    <div className="flex items-center gap-3 text-[10px] text-muted-foreground border-t pt-2">
                      <span>Last touch{" "}
                        <span className={
                          daysSince == null ? "" 
                          : daysSince < 30 ? "text-emerald-700 dark:text-emerald-400 font-medium"
                          : daysSince < 90 ? "text-amber-600 dark:text-amber-400 font-medium"
                          : "text-red-600 dark:text-red-400 font-medium"
                        }>
                          {daysSince == null ? "—" : daysSince === 0 ? "today" : `${daysSince}d ago`}
                        </span>
                      </span>
                      <span>·</span>
                      <span>{portfolioData.contacts?.length || 0} of your contacts</span>
                    </div>
                    {bgpTeam.length > 0 && (
                      <div className="border-t pt-2">
                        <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Your BGP contacts</div>
                        <div className="flex flex-wrap gap-1">
                          {bgpTeam.map((name: string, i: number) => (
                            <Badge key={i} variant="outline" className="text-[10px] font-normal">{name}</Badge>
                          ))}
                        </div>
                      </div>
                    )}
                    {/* The full AI activity commentary — same card as the
                        internal company page's BGP Relationship zone ("just
                        mirror our page", Woody 2026-07-30). Read-only for
                        clients; the middleware scopes it to their own
                        company and the curate action stays staff-side. */}
                    {clientCompanyId && (
                      <AIActivityCard
                        subjectType="landlord"
                        subjectId={clientCompanyId}
                        title={`${clientCompanyName || companyInfo?.name || "Account"} — Activity`}
                        compact
                      />
                    )}
                  </CardContent>
                </Card>
              );
            })(),
          },
          // The standalone Portfolio Map board is folded into Properties &
          // Deals below (Woody, 2026-08-03: "same as properties and deals
          // but with map above").
          totalLeasingUnits > 0 ? {
            id: "portfolio-leasing",
            label: "Leasing Schedule",
            defaultW: 6, defaultH: 10, minW: 4, minH: 6,
            content: (
              <Card className="h-full flex flex-col">
                <CardContent className="p-3 space-y-3 flex-1 overflow-hidden flex flex-col">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold text-sm flex items-center gap-2">
                      <Building2 className="w-4 h-4" />Leasing Schedule
                      <Badge variant="secondary" className="text-[10px]">{totalLeasingUnits} units across {leasingByProperty.size} properties</Badge>
                    </h3>
                    <div className="flex items-center gap-3 text-[10px]">
                      <span className="text-emerald-600 dark:text-emerald-400">{occupiedUnits} occupied</span>
                      {expiringUnits > 0 && <span className="text-amber-600 dark:text-amber-400">{expiringUnits} expiring</span>}
                      <Link href="/leasing-schedule">
                        <span className="text-indigo-500 hover:underline flex items-center gap-1 cursor-pointer" data-testid="link-leasing-board">
                          <ExternalLink className="w-3 h-3" />Open Board
                        </span>
                      </Link>
                    </div>
                  </div>
                  <p className="text-[10px] text-muted-foreground -mt-2">Every unit across the portfolio — tenant, occupied/vacant, rent and lease expiry.</p>
                  <ScrollArea className="flex-1">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pr-2">
                      {Array.from(leasingByProperty.entries()).map(([propId, { name, units: propUnits }]) => {
                        const propOccupied = propUnits.filter((u: any) => !isVacantStatus(u.status)).length;
                        const propExpiring = propUnits.filter((u: any) => isExpiringSoon(u.lease_expiry)).length;
                        return (
                          <div key={propId} className="border rounded-lg overflow-hidden">
                            <Link href={`/leasing-schedule/${propId}`}>
                              <div className="w-full flex items-center gap-2 px-3 py-2 bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 text-left cursor-pointer" data-testid={`dash-prop-${propId}`}>
                                <span className="font-medium text-sm">{name}</span>
                                <Badge variant="secondary" className="text-[10px]">{propUnits.length}</Badge>
                                <span className="text-[10px] text-emerald-600 ml-auto">{propOccupied} occ</span>
                                {propExpiring > 0 && <Badge variant="outline" className="text-[9px] border-amber-300 text-amber-600 ml-1">{propExpiring} exp</Badge>}
                                <span className="text-[10px] text-indigo-500 ml-2">View Full</span>
                              </div>
                            </Link>
                          </div>
                        );
                      })}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>
            ),
          } : null,
          // The old "Recent Activity (deal movements)" board is retired —
          // deal movements now flow into the canonical Activity board's
          // Recent feed (Woody, 2026-08-03). Two boards replace it:
          // the BGP team calendar and the account Files tree.
          {
            id: "portfolio-calendar",
            label: "Team Calendar",
            defaultW: 12, defaultH: 14, minW: 6, minH: 8,
            content: <ClientTeamWeekCalendar events={(portfolioData.calendarEvents || []) as any[]} />,
          },
          isClientUser ? {
            id: "portfolio-files",
            label: "Files",
            defaultW: 6, defaultH: 12, minW: 3, minH: 6,
            content: (
              // Whole-account jailed SharePoint browser — empty propertyName
              // starts at the client's root folder (per-property trees inside).
              <div className="h-full overflow-y-auto">
                <ClientPropertyFoldersPanel propertyName="" />
              </div>
            ),
          } : null,
          {
            id: "portfolio-contacts",
            label: "Contacts",
            defaultW: 4, defaultH: 14, minW: 3, minH: 6,
            content: <PortfolioContactsBoard companyId={resolvedCompanyId!} />,
          },
          {
            id: "portfolio-deals",
            label: "Properties & Deals",
            defaultW: 12, defaultH: 18, minW: 6, minH: 8,
            content: (
              <Card className="h-full flex flex-col">
                <CardContent className="p-3 space-y-2 flex-1 overflow-hidden flex flex-col">
                  <h3 className="font-semibold text-xs flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5 text-teal-500" />
                    Properties & Deals
                  </h3>
                  <p className="text-[10px] text-muted-foreground -mt-1">Your portfolio on the map, with active properties and their live lettings and deals below — pins and chips open everything pre-filtered.</p>
                  {(portfolioData.properties || []).some((p: any) => p.lat != null && p.lng != null) && (
                    <div className="flex-none h-[42%] min-h-[180px] rounded-lg overflow-hidden border">
                      <BrandPortfolioMap
                        alwaysRender
                        height="100%"
                        stores={(portfolioData.properties || [])
                          .filter((p: any) => p.lat != null && p.lng != null)
                          .map((p: any) => ({
                            id: `crm:${p.id}`,
                            name: p.name,
                            address: typeof p.address === "string" ? p.address : null,
                            lat: Number(p.lat),
                            lng: Number(p.lng),
                            status: p.status ?? null,
                            tone: "linked" as const,
                            href: `/properties/${p.id}`,
                          })) as any}
                        onSelect={(s: any) => { if (s?.href) window.location.assign(s.href); }}
                      />
                    </div>
                  )}
                  <ScrollArea className="flex-1">
                    <div className="pr-2">
                    {/* Canonical PropertiesSummary (Woody, 2026-08-03) — the
                        same board design as the staff dashboard and property
                        pages; this was the last bespoke copy. */}
                    <PropertiesSummary companyId={resolvedCompanyId!} role="landlord" onlyActive />
                    {unlinkedDeals.length > 0 && (
                      <div className="border rounded-lg overflow-hidden mt-2">
                        <div className="flex items-center gap-2 p-2 bg-muted/50">
                          <BarChart3 className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                          <p className="text-xs font-medium">Other Deals</p>
                          <Badge variant="outline" className="text-[10px] shrink-0 ml-auto">{unlinkedDeals.length}</Badge>
                        </div>
                        <div className="divide-y">
                          {unlinkedDeals.map((deal: any) => (
                            <Link key={deal.id} href={`/deals/${deal.id}`}>
                              <div className="flex items-center justify-between px-2 py-1.5 pl-7 hover:bg-muted/30 transition-colors cursor-pointer" data-testid={`link-deal-${deal.id}`}>
                                <div className="min-w-0 flex-1">
                                  <p className="text-xs truncate">{deal.name}</p>
                                  <p className="text-[10px] text-muted-foreground">{deal.status}</p>
                                </div>
                              </div>
                            </Link>
                          ))}
                        </div>
                      </div>
                    )}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>
            ),
          },
          // === Feature 1: Lease Expiry Waterfall Chart ===
          (() => {
            const WATERFALL_COLORS = [
              "#0d9488", "#2563eb", "#7c3aed", "#db2777", "#ea580c",
              "#059669", "#4f46e5", "#be185d", "#c2410c", "#0891b2",
              "#65a30d", "#9333ea", "#e11d48", "#d97706", "#0284c7",
            ];
            const allUnits = portfolioData.leasingUnits || [];
            const unitsWithExpiry = allUnits.filter((u: any) => u.lease_expiry);
            if (unitsWithExpiry.length === 0) return {
              id: "portfolio-lease-expiry",
              label: "Lease Expiry Timeline",
              defaultW: 12, defaultH: 10, minW: 6, minH: 6,
              content: (
                <Card className="h-full flex flex-col">
                  <CardContent className="p-3 flex-1 flex flex-col items-center justify-center">
                    <h3 className="font-semibold text-xs flex items-center gap-1.5 mb-4 self-start">
                      <CalendarDays className="w-3.5 h-3.5 text-teal-500" />
                      Lease Expiry Timeline
                    </h3>
                    <CalendarDays className="w-8 h-8 text-muted-foreground/30 mb-2" />
                    <p className="text-xs text-muted-foreground">No lease expiry data available</p>
                  </CardContent>
                </Card>
              ),
            };

            // Group by quarter for next 5 years, stacked by property
            const now = new Date();
            const fiveYearsOut = new Date(now.getFullYear() + 5, 11, 31);
            const propertyNames = new Map<string, string>();
            const quarterData = new Map<string, Record<string, { count: number; sqft: number }>>();

            for (const u of unitsWithExpiry) {
              const exp = new Date(u.lease_expiry);
              if (exp < now || exp > fiveYearsOut) continue;
              const q = `Q${Math.ceil((exp.getMonth() + 1) / 3)} ${exp.getFullYear()}`;
              const propName = u.property_name || "Unknown";
              const propKey = propName.replace(/[^a-zA-Z0-9]/g, "_");
              propertyNames.set(propKey, propName);
              if (!quarterData.has(q)) quarterData.set(q, {});
              const qd = quarterData.get(q)!;
              if (!qd[propKey]) qd[propKey] = { count: 0, sqft: 0 };
              qd[propKey].count += 1;
              qd[propKey].sqft += (u.sqft || 0);
            }

            // Build sorted quarter labels
            const quarterLabels: string[] = [];
            for (let y = now.getFullYear(); y <= now.getFullYear() + 5; y++) {
              for (let q = 1; q <= 4; q++) {
                const label = `Q${q} ${y}`;
                if (quarterData.has(label)) quarterLabels.push(label);
              }
            }

            const propKeys = Array.from(propertyNames.keys());
            const chartData = quarterLabels.map(q => {
              const entry: any = { quarter: q };
              const qd = quarterData.get(q) || {};
              for (const pk of propKeys) {
                entry[pk] = qd[pk]?.count || 0;
                entry[`${pk}_sqft`] = qd[pk]?.sqft || 0;
              }
              return entry;
            });

            return {
              id: "portfolio-lease-expiry",
              label: "Lease Expiry Timeline",
              defaultW: 12, defaultH: 12, minW: 6, minH: 8,
              content: (
                <Card className="h-full flex flex-col">
                  <CardContent className="p-3 flex-1 overflow-hidden flex flex-col">
                    <h3 className="font-semibold text-xs flex items-center gap-1.5 mb-2">
                      <CalendarDays className="w-3.5 h-3.5 text-teal-500" />
                      Lease Expiry Timeline
                      <Badge variant="secondary" className="text-[10px]">{Array.from(quarterData.values()).reduce((s, q) => s + Object.values(q).reduce((a, v) => a + v.count, 0), 0)} expiring within 5 yrs across {propertyNames.size} properties</Badge>
                    </h3>
                    <p className="text-[10px] text-muted-foreground -mt-1 mb-1">Units with leases expiring, grouped by quarter over the next five years.</p>
                    <div className="flex-1 min-h-0">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                          <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                          <XAxis dataKey="quarter" tick={{ fontSize: 10 }} interval={0} angle={-45} textAnchor="end" height={50} />
                          <YAxis tick={{ fontSize: 10 }} allowDecimals={false} label={{ value: "Units", angle: -90, position: "insideLeft", style: { fontSize: 10 } }} />
                          <Tooltip
                            contentStyle={{ fontSize: 11, borderRadius: 8 }}
                            formatter={(value: number, name: string) => {
                              const propName = propertyNames.get(name) || name;
                              return [value, propName];
                            }}
                            labelFormatter={(label: string) => `${label}`}
                            itemSorter={(item: any) => -(item.value || 0)}
                          />
                          <Legend
                            wrapperStyle={{ fontSize: 10 }}
                            formatter={(value: string) => propertyNames.get(value) || value}
                          />
                          {propKeys.map((pk, i) => (
                            <Bar key={pk} dataKey={pk} stackId="a" fill={WATERFALL_COLORS[i % WATERFALL_COLORS.length]} radius={i === propKeys.length - 1 ? [2, 2, 0, 0] : [0, 0, 0, 0]} />
                          ))}
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </CardContent>
                </Card>
              ),
            };
          })(),
          // === Feature 2: Vacancy-to-Pipeline Funnel ===
          (() => {
            const allUnits = portfolioData.leasingUnits || [];
            const allDeals = portfolioData.deals || [];
            const properties = portfolioData.properties || [];

            // Build vacancy + deal stats per property
            const propStats: { propId: string; propName: string; vacantUnits: number; totalUnits: number; activeDeals: number }[] = [];
            const propMap = new Map<string, { vacantUnits: number; totalUnits: number; activeDeals: number; propName: string }>();

            for (const u of allUnits) {
              const key = u.property_id;
              if (!propMap.has(key)) propMap.set(key, { vacantUnits: 0, totalUnits: 0, activeDeals: 0, propName: u.property_name || "Unknown" });
              const entry = propMap.get(key)!;
              entry.totalUnits += 1;
              const isVacant = u.status === "Vacant" || u.status === "Void" || u.status === "Available";
              if (isVacant) entry.vacantUnits += 1;
            }

            // Count active deals per property (non-completed, non-withdrawn)
            for (const d of allDeals) {
              if (!d.property_id) continue;
              const st = (d.status || "").toLowerCase();
              const isActive = !st.includes("completed") && !st.includes("withdrawn") && !st.includes("closed") && !st.includes("fallen");
              if (!isActive) continue;
              // Rent reviews / investment deals don't fill a void — only
              // letting-type deals count towards vacancy coverage.
              const dt = (d.deal_type || d.dealType || "").toLowerCase();
              if (dt && !dt.includes("leas") && !dt.includes("lett")) continue;
              if (!propMap.has(d.property_id)) {
                const prop = properties.find((p: any) => p.id === d.property_id);
                propMap.set(d.property_id, { vacantUnits: 0, totalUnits: 0, activeDeals: 0, propName: prop?.name || d.property_name || "Unknown" });
              }
              propMap.get(d.property_id)!.activeDeals += 1;
            }

            for (const [propId, data] of propMap.entries()) {
              propStats.push({ propId, ...data });
            }
            propStats.sort((a, b) => b.vacantUnits - a.vacantUnits);

            const totalVacant = propStats.reduce((s, p) => s + p.vacantUnits, 0);
            const totalActiveDeals = propStats.reduce((s, p) => s + p.activeDeals, 0);
            const propertiesWithVacancy = propStats.filter(p => p.vacantUnits > 0).length;

            if (propStats.length === 0) return null;

            return {
              id: "portfolio-vacancy-pipeline",
              label: "Vacancy Pipeline",
              defaultW: 6, defaultH: 12, minW: 4, minH: 6,
              content: (
                <Card className="h-full flex flex-col">
                  <CardContent className="p-3 space-y-2 flex-1 overflow-hidden flex flex-col">
                    <h3 className="font-semibold text-xs flex items-center gap-1.5">
                      <TrendingUp className="w-3.5 h-3.5 text-teal-500" />
                      Vacancy Pipeline
                    </h3>
                    <p className="text-[10px] text-muted-foreground -mt-1">Vacant units per property vs the active deals working to fill them.</p>
                    <ScrollArea className="flex-1">
                      <div className="space-y-2 pr-2">
                        {propStats.filter(p => p.vacantUnits > 0 || p.activeDeals > 0).map(({ propId, propName, vacantUnits, totalUnits, activeDeals }) => {
                          const vacancyPct = totalUnits > 0 ? (vacantUnits / totalUnits) * 100 : 0;
                          const pipelinePct = vacantUnits > 0 ? Math.min((activeDeals / vacantUnits) * 100, 100) : 0;
                          return (
                            <div key={propId} className="border rounded-lg p-2.5" data-testid={`vacancy-prop-${propId}`}>
                              <div className="flex items-center justify-between mb-1.5">
                                <Link href={`/properties/${propId}`}>
                                  <span className="text-xs font-medium text-teal-700 dark:text-teal-300 hover:underline cursor-pointer">{propName}</span>
                                </Link>
                                <span className="text-[10px] text-muted-foreground">
                                  {vacantUnits} vacant unit{vacantUnits !== 1 ? "s" : ""} · {activeDeals} active deal{activeDeals !== 1 ? "s" : ""}
                                </span>
                              </div>
                              {/* Vacancy bar */}
                              <div className="flex items-center gap-2 mb-1">
                                <span className="text-[9px] text-muted-foreground w-12 shrink-0">Vacancy</span>
                                <div className="flex-1 h-2 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                                  <div
                                    className="h-full bg-rose-400 dark:bg-rose-500 rounded-full transition-all"
                                    style={{ width: `${vacancyPct}%` }}
                                  />
                                </div>
                                <span className="text-[9px] text-muted-foreground w-10 text-right shrink-0">{vacancyPct.toFixed(0)}%</span>
                              </div>
                              {/* Pipeline coverage bar */}
                              <div className="flex items-center gap-2">
                                <span className="text-[9px] text-muted-foreground w-12 shrink-0">Pipeline</span>
                                <div className="flex-1 h-2 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                                  <div
                                    className={`h-full rounded-full transition-all ${pipelinePct >= 75 ? "bg-emerald-400 dark:bg-emerald-500" : pipelinePct >= 40 ? "bg-amber-400 dark:bg-amber-500" : "bg-rose-300 dark:bg-rose-400"}`}
                                    style={{ width: `${pipelinePct}%` }}
                                  />
                                </div>
                                <span className="text-[9px] text-muted-foreground w-10 text-right shrink-0">{pipelinePct.toFixed(0)}%</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </ScrollArea>
                    <div className="border-t pt-2 mt-auto">
                      <p className="text-[10px] text-muted-foreground text-center">
                        {totalVacant} total vacant unit{totalVacant !== 1 ? "s" : ""} across {propertiesWithVacancy} propert{propertiesWithVacancy !== 1 ? "ies" : "y"} · {totalActiveDeals} letting deal{totalActiveDeals !== 1 ? "s" : ""} working the voids
                      </p>
                    </div>
                  </CardContent>
                </Card>
              ),
            };
          })(),
          // === Feature 3: Market Comparables ===
          (() => {
            if (compsLoading) return {
              id: "portfolio-market-comps",
              label: "Market Comparables",
              defaultW: 12, defaultH: 10, minW: 6, minH: 6,
              content: (
                <Card className="h-full flex flex-col">
                  <CardContent className="p-3 flex-1">
                    <h3 className="font-semibold text-xs flex items-center gap-1.5 mb-3">
                      <BarChart3 className="w-3.5 h-3.5 text-teal-500" />
                      Market Comparables
                    </h3>
                    <div className="space-y-2">
                      {[1,2,3].map(i => <Skeleton key={i} className="h-8 w-full" />)}
                    </div>
                  </CardContent>
                </Card>
              ),
            };

            if (!portfolioComps.length) return {
              id: "portfolio-market-comps",
              label: "Market Comparables",
              defaultW: 12, defaultH: 10, minW: 6, minH: 6,
              content: (
                <Card className="h-full flex flex-col">
                  <CardContent className="p-3 flex-1 flex flex-col items-center justify-center">
                    <h3 className="font-semibold text-xs flex items-center gap-1.5 mb-4 self-start">
                      <BarChart3 className="w-3.5 h-3.5 text-teal-500" />
                      Market Comparables
                    </h3>
                    <BarChart3 className="w-8 h-8 text-muted-foreground/30 mb-2" />
                    <p className="text-xs text-muted-foreground">No comparable evidence found for portfolio areas</p>
                    <Link href="/comps">
                      <span className="text-xs text-teal-600 dark:text-teal-400 hover:underline mt-1 cursor-pointer">Browse all comps</span>
                    </Link>
                  </CardContent>
                </Card>
              ),
            };

            return {
              id: "portfolio-market-comps",
              label: "Market Comparables",
              defaultW: 12, defaultH: 11, minW: 6, minH: 6,
              content: (
                <Card className="h-full flex flex-col">
                  <CardContent className="p-3 space-y-2 flex-1 overflow-hidden flex flex-col">
                    <div className="flex items-center justify-between">
                      <h3 className="font-semibold text-xs flex items-center gap-1.5">
                        <BarChart3 className="w-3.5 h-3.5 text-teal-500" />
                        Market Comparables
                        <Badge variant="secondary" className="text-[10px]">{portfolioComps.length} comp{portfolioComps.length !== 1 ? "s" : ""}</Badge>
                      </h3>
                      <Link href="/comps">
                        <span className="text-xs text-teal-600 dark:text-teal-400 hover:underline flex items-center gap-1 cursor-pointer" data-testid="link-view-all-comps">
                          View all comps <ExternalLink className="w-3 h-3" />
                        </span>
                      </Link>
                    </div>
                    <ScrollArea className="flex-1">
                      <div className="pr-2">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b text-left">
                              <th className="pb-1.5 font-medium text-muted-foreground">Address</th>
                              <th className="pb-1.5 font-medium text-muted-foreground">Tenant</th>
                              <th className="pb-1.5 font-medium text-muted-foreground text-right">Size (sqft)</th>
                              <th className="pb-1.5 font-medium text-muted-foreground text-right">Rent (psf)</th>
                              <th className="pb-1.5 font-medium text-muted-foreground">Date</th>
                              <th className="pb-1.5 font-medium text-muted-foreground">Source</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y">
                            {portfolioComps.map((comp: CrmComp) => (
                              <tr key={comp.id} className="hover:bg-muted/30 transition-colors">
                                <td className="py-1.5 pr-2 max-w-[180px]">
                                  <p className="truncate font-medium">{comp.name}</p>
                                  {comp.postcode && <p className="text-[10px] text-muted-foreground">{comp.postcode}</p>}
                                </td>
                                <td className="py-1.5 pr-2 max-w-[120px]">
                                  <p className="truncate">{comp.tenant || "-"}</p>
                                </td>
                                <td className="py-1.5 pr-2 text-right tabular-nums">
                                  {comp.niaSqft || comp.areaSqft || comp.floorAreaSqft || "-"}
                                </td>
                                <td className="py-1.5 pr-2 text-right tabular-nums">
                                  {comp.overallRate || comp.zoneARate || comp.rentPsfNia ? (
                                    <span>{comp.overallRate || comp.zoneARate || comp.rentPsfNia}</span>
                                  ) : "-"}
                                </td>
                                <td className="py-1.5 pr-2 whitespace-nowrap text-muted-foreground">
                                  {comp.completionDate ? new Date(comp.completionDate).toLocaleDateString("en-GB", { month: "short", year: "2-digit" }) : "-"}
                                </td>
                                <td className="py-1.5">
                                  {comp.sourceEvidence || comp.evidenceSource ? (
                                    <Badge variant="outline" className="text-[9px] px-1.5 py-0">
                                      {comp.sourceEvidence || comp.evidenceSource}
                                    </Badge>
                                  ) : (
                                    <span className="text-muted-foreground">-</span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </ScrollArea>
                  </CardContent>
                </Card>
              ),
            };
          })(),
          // === Landsec Deal Analytics: Overview Card ===
          landsecAnalytics && landsecAnalytics.totalDeals > 0 ? {
            id: "portfolio-landsec-overview",
            label: "Landsec Overview",
            defaultW: 6, defaultH: 12, minW: 4, minH: 8,
            content: <LandsecOverviewCard data={landsecAnalytics} />,
          } : null,
          // === Landsec Deal Analytics: Agent Performance ===
          landsecAnalytics && landsecAnalytics.totalDeals > 0 ? {
            id: "portfolio-landsec-agents",
            label: "Agent Performance",
            defaultW: 6, defaultH: 12, minW: 4, minH: 8,
            content: <LandsecAgentPerformanceCard data={landsecAnalytics} />,
          } : null,
          // === Landsec Deal Analytics: Pipeline Funnel ===
          landsecAnalytics && landsecAnalytics.totalDeals > 0 ? {
            id: "portfolio-landsec-pipeline",
            label: "Deal Pipeline",
            defaultW: 6, defaultH: 14, minW: 4, minH: 8,
            content: <LandsecPipelineFunnel data={landsecAnalytics} />,
          } : null,
          // === Landsec Deal Analytics: Recent Activity ===
          landsecAnalytics && landsecAnalytics.totalDeals > 0 ? {
            id: "portfolio-landsec-activity",
            label: "Recent Activity",
            defaultW: 6, defaultH: 12, minW: 4, minH: 6,
            content: <LandsecRecentActivity data={landsecAnalytics} />,
          } : null,
        ].filter(Boolean) as any[];

        // For client logins hide the BGP-internal cards: comps stay blank for
        // now, and the deal-analytics quartet is fee/agent-centric (WIP,
        // invoiced, agent performance) which is BGP's side of the ledger.
        const clientHiddenBoards = new Set([
          "portfolio-market-comps",
          "portfolio-landsec-overview",
          "portfolio-landsec-agents",
          "portfolio-landsec-pipeline",
          "portfolio-landsec-activity",
        ]);
        const clientScopedItems = isClientUser
          ? portfolioGridItems.filter((item: any) => !clientHiddenBoards.has(item.id))
          : portfolioGridItems;

        const visiblePortfolioItems = clientScopedItems.filter((item: any) => !hiddenPortfolioBoards.includes(item.id));
        const hiddenPortfolioItems = clientScopedItems.filter((item: any) => hiddenPortfolioBoards.includes(item.id));

        portfolioBoardsForGrid = visiblePortfolioItems.map((i: any) => ({ ...i, description: i.description || PORTFOLIO_DESCRIPTIONS[i.id] }));

        return (
          <div data-testid="portfolio-overview">
            <div className="flex items-center gap-2 mb-2">
              <Building2 className="w-5 h-5 text-teal-600" />
              <h2 className="text-lg font-semibold">{clientCompanyName} Portfolio</h2>
              {dashboardEditing && hiddenPortfolioItems.length > 0 && (
                <div className="flex items-center gap-1 ml-auto">
                  <span className="text-[10px] text-muted-foreground">{hiddenPortfolioItems.length} hidden:</span>
                  {hiddenPortfolioItems.map((item: any) => (
                    <button
                      key={item.id}
                      onClick={() => handleShowPortfolioBoard(item.id)}
                      className="text-[10px] px-2 py-0.5 rounded bg-muted hover:bg-primary/10 text-muted-foreground hover:text-primary transition-colors"
                      data-testid={`button-show-portfolio-${item.id}`}
                    >
                      + {item.label || item.id.replace("portfolio-", "")}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {(() => {
        const WIDGET_GRID_SIZES: Record<string, { w: number; h: number; minW?: number; minH?: number }> = {
          "my-leads": { w: 6, h: 9, minW: 4, minH: 5 },
          "news-summary": { w: 6, h: 9, minW: 4, minH: 5 },
          "today-diary": { w: 12, h: 13, minW: 8, minH: 8 },
          "key-instructions": { w: 6, h: 7, minW: 3, minH: 4 },
          "active-contacts": { w: 6, h: 7, minW: 3, minH: 4 },
          "quick-actions": { w: 12, h: 2, minW: 6, minH: 2 },
          "new-requirements": { w: 6, h: 8, minW: 4, minH: 5 },
          "activity-alerts": { w: 6, h: 8, minW: 4, minH: 5 },
          "available-units": { w: 6, h: 14, minW: 4, minH: 6 },
          "deals-board": { w: 6, h: 14, minW: 4, minH: 6 },
          "agent-pipeline": { w: 12, h: 22, minW: 6, minH: 14 },
          "inbox": { w: 12, h: 20, minW: 6, minH: 10 },
          "sharepoint": { w: 6, h: 12, minW: 4, minH: 6 },
          "studios": { w: 6, h: 12, minW: 4, minH: 6 },
          "properties-deals": { w: 12, h: 14, minW: 6, minH: 8 },
          "system-activity": { w: 6, h: 9, minW: 4, minH: 5 },
          "daily-digest": { w: 6, h: 9, minW: 4, minH: 5 },
          "my-tasks": { w: 6, h: 14, minW: 4, minH: 8 },
          "my-portfolio": { w: 6, h: 10, minW: 4, minH: 6 },
          "landsec-analytics": { w: 12, h: 20, minW: 8, minH: 12 },
          "kpi-overview": { w: 12, h: 5, minW: 6, minH: 4 },
        };

        const renderWidget = (widgetId: string) => {

        if (widgetId === "news-summary") return (
          <Card key="news-summary" className="h-full flex flex-col">
            <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2 pt-4 px-4">
              <div className="flex items-center gap-2">
                <CardTitle className="text-sm font-semibold">News Feed</CardTitle>
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                  <Brain className="w-3 h-3 mr-0.5" />
                  AI-curated for {currentTeam}
                </Badge>
              </div>
              <Link href="/news">
                <Button variant="ghost" size="sm" className="text-xs h-7" data-testid="link-news-summary-all">
                  View all <ArrowRight className="w-3 h-3 ml-0.5" />
                </Button>
              </Link>
            </CardHeader>
            <CardContent className="px-4 pb-4 pt-0 flex-1 overflow-hidden">
              {newsArticles && newsArticles.length > 0 ? (
                <div className="divide-y overflow-y-auto h-full">
                  {newsArticles.slice(0, 6).map((article) => (
                    <NewsRow key={article.id} article={article} userTeam={currentTeam} />
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <Newspaper className="w-6 h-6 mx-auto mb-2 opacity-30" />
                  <p className="text-xs">No news yet</p>
                  <Link href="/news">
                    <Button variant="outline" size="sm" className="mt-2 text-xs">
                      Fetch News
                    </Button>
                  </Link>
                </div>
              )}
            </CardContent>
          </Card>
        );

        // Action-framed shortcuts (not nav duplicates): each kicks off a task rather than
        // just opening the matching sidebar page.
        if (widgetId === "quick-actions") return (
          <div key="quick-actions" className="flex items-center gap-2 flex-wrap">
            <Link href="/models">
              <Button variant="outline" size="sm" className="gap-1.5 text-xs" data-testid="quick-action-models">
                <FileSpreadsheet className="w-3.5 h-3.5" /> Generate Model
              </Button>
            </Link>
            <Link href="/templates">
              <Button variant="outline" size="sm" className="gap-1.5 text-xs" data-testid="quick-action-docs">
                <FileText className="w-3.5 h-3.5" /> Generate Document
              </Button>
            </Link>
            <Link href="/chatbgp">
              <Button variant="outline" size="sm" className="gap-1.5 text-xs" data-testid="quick-action-chat">
                <Sparkles className="w-3.5 h-3.5" /> Ask ChatBGP
              </Button>
            </Link>
          </div>
        );

        if (widgetId === "today-diary") return (() => {
          const now = new Date();
          const todayStr = now.toDateString();

          const calEventsNorm: any[] = [];
          if (dashboardViewMode === "team" && teamCalSchedules) {
            for (const member of teamCalSchedules) {
              for (const item of member.scheduleItems || []) {
                if (item.start?.dateTime) {
                  const subj = item.isPrivate ? "Private" : (item.subject || "Busy");
                  const subjLc = subj.toLowerCase();
                  let eventType = "meeting";
                  if (subjLc.includes("viewing")) eventType = "viewing";
                  else if (subjLc.includes("inspection") || subjLc.includes("refurb")) eventType = "inspection";
                  else if (subjLc.includes("call") || subjLc.includes("phone")) eventType = "call";
                  else if (subjLc.includes("valuation")) eventType = "valuation";
                  else if (subjLc.includes("deadline") || subjLc.includes("expiry")) eventType = "deadline";
                  calEventsNorm.push({
                    id: `${member.email}-${item.start.dateTime}`,
                    start_time: item.start.dateTime,
                    end_time: item.end?.dateTime || item.start.dateTime,
                    title: `${subj} — ${member.name || member.email?.split("@")[0] || ""}`,
                    event_type: eventType,
                  });
                }
              }
            }
          } else {
            for (const ev of (myCalEvents || [])) {
              const subjLc = (ev.subject || "").toLowerCase();
              let eventType = "meeting";
              if (subjLc.includes("viewing")) eventType = "viewing";
              else if (subjLc.includes("inspection") || subjLc.includes("refurb")) eventType = "inspection";
              else if (subjLc.includes("call") || subjLc.includes("phone")) eventType = "call";
              else if (subjLc.includes("valuation")) eventType = "valuation";
              else if (subjLc.includes("deadline") || subjLc.includes("expiry")) eventType = "deadline";
              calEventsNorm.push({
                id: ev.id,
                start_time: ev.start?.dateTime,
                end_time: ev.end?.dateTime || ev.start?.dateTime,
                title: ev.subject,
                event_type: eventType,
              });
            }
          }

          const calDaysW: Date[] = [];
          const mondayW = new Date(now);
          mondayW.setHours(0, 0, 0, 0);
          const dow = mondayW.getDay();
          mondayW.setDate(mondayW.getDate() - ((dow + 6) % 7));
          for (let i = 0; i < 5; i++) {
            const d = new Date(mondayW);
            d.setDate(mondayW.getDate() + i);
            calDaysW.push(d);
          }
          const wkStart = calDaysW[0];
          const wkEnd = calDaysW[4];
          const wkLabel = `${wkStart.getDate()} – ${wkEnd.getDate()} ${wkEnd.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}`;
          const hoursW = Array.from({ length: 12 }, (_, i) => i + 7);

          const allDayEventsW = calEventsNorm.filter((ev: any) => {
            const start = new Date(ev.start_time);
            const end = ev.end_time ? new Date(ev.end_time) : start;
            return (end.getTime() - start.getTime()) / (1000 * 60 * 60) >= 20;
          });
          const timedEventsW = calEventsNorm.filter((ev: any) => {
            const start = new Date(ev.start_time);
            const end = ev.end_time ? new Date(ev.end_time) : start;
            return (end.getTime() - start.getTime()) / (1000 * 60 * 60) < 20;
          });

          const eventTypeCountsW: Record<string, number> = {};
          calEventsNorm.forEach((ev: any) => {
            const t = ev.event_type?.toLowerCase() || "other";
            eventTypeCountsW[t] = (eventTypeCountsW[t] || 0) + 1;
          });
          const todaysEventsW = calEventsNorm.filter((ev: any) => new Date(ev.start_time).toDateString() === todayStr);

          const calMonthW = wkStart;
          const miniCalCellsW: (number | null)[] = [];
          const firstDayW = new Date(calMonthW.getFullYear(), calMonthW.getMonth(), 1);
          const startDowW = (firstDayW.getDay() + 6) % 7;
          const daysInMonthW = new Date(calMonthW.getFullYear(), calMonthW.getMonth() + 1, 0).getDate();
          for (let i = 0; i < startDowW; i++) miniCalCellsW.push(null);
          for (let d = 1; d <= daysInMonthW; d++) miniCalCellsW.push(d);

          const eventColorMapW: Record<string, string> = {
            viewing: "bg-blue-100 dark:bg-blue-900/40 border-blue-300 text-blue-800 dark:text-blue-200",
            inspection: "bg-rose-100 dark:bg-rose-900/40 border-rose-300 text-rose-800 dark:text-rose-200",
            meeting: "bg-amber-100 dark:bg-amber-900/40 border-amber-300 text-amber-800 dark:text-amber-200",
            call: "bg-purple-100 dark:bg-purple-900/40 border-purple-300 text-purple-800 dark:text-purple-200",
            valuation: "bg-emerald-100 dark:bg-emerald-900/40 border-emerald-300 text-emerald-800 dark:text-emerald-200",
            deadline: "bg-red-100 dark:bg-red-900/40 border-red-300 text-red-800 dark:text-red-200",
          };
          const eventTypeColorsW: Record<string, string> = {
            viewing: "bg-blue-500",
            inspection: "bg-rose-500",
            meeting: "bg-amber-500",
            call: "bg-purple-500",
            valuation: "bg-emerald-500",
            deadline: "bg-red-500",
          };
          const eventTypeIconsW: Record<string, string> = {
            viewing: "👁", inspection: "🔍", meeting: "🤝", call: "📞", valuation: "📊", deadline: "📋",
          };

          const diaryTitle = dashboardViewMode === "team" ? `${currentTeam} Diary` : "My Diary";

          return (
            <Card key="today-diary" data-testid="card-today-diary" className="h-full flex flex-col">
              <CardContent className="p-0 flex-1 overflow-hidden flex flex-col">
                <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/30">
                  <div className="flex items-center gap-2">
                    <CalendarDays className="w-4 h-4 text-primary" />
                    <h3 className="font-semibold text-xs">{diaryTitle}</h3>
                    <span className="text-[10px] text-muted-foreground">·</span>
                    <span className="text-[10px] text-muted-foreground">{wkLabel}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-muted-foreground">Work week</span>
                    <Link href="/calendar"><Button variant="ghost" size="sm" className="text-xs h-7 gap-1" data-testid="link-diary-full">Full view <ArrowRight className="w-3 h-3" /></Button></Link>
                  </div>
                </div>

                <div className="flex flex-1 overflow-hidden">
                  <div className="flex-1 min-w-0 border-r overflow-y-auto p-2 space-y-3">
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] font-semibold text-muted-foreground">{calMonthW.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}</span>
                      </div>
                      <div className="grid grid-cols-7 gap-0">
                        {["M","T","W","T","F","S","S"].map((d, i) => (
                          <div key={i} className="text-center text-[8px] text-muted-foreground font-medium py-0.5">{d}</div>
                        ))}
                        {miniCalCellsW.map((day, i) => {
                          const isToday = day === new Date().getDate() && calMonthW.getMonth() === new Date().getMonth();
                          const hasEvent = day ? calEventsNorm.some((ev: any) => new Date(ev.start_time).getDate() === day && new Date(ev.start_time).getMonth() === calMonthW.getMonth()) : false;
                          return (
                            <div key={i} className={`text-center text-[9px] py-0.5 relative ${isToday ? "bg-teal-500 text-white rounded-full font-bold" : day ? "text-foreground" : ""}`}>
                              {day || ""}
                              {hasEvent && !isToday && <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-teal-400" />}
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    <div>
                      <p className="text-[9px] font-semibold text-muted-foreground uppercase mb-1.5">Event Types</p>
                      <div className="space-y-1">
                        {Object.entries(eventTypeColorsW).map(([type, color]) => (
                          <div key={type} className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5">
                              <span className="text-[10px]">{eventTypeIconsW[type] || "📌"}</span>
                              <span className="text-[10px] capitalize">{type}</span>
                            </div>
                            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${color} text-white min-w-[18px] text-center`}>
                              {eventTypeCountsW[type] || 0}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div>
                      <p className="text-[9px] font-semibold text-muted-foreground uppercase mb-1.5">Today's Schedule <span className="ml-1 text-teal-500">{todaysEventsW.length}</span></p>
                      {todaysEventsW.length === 0 ? (
                        <p className="text-[9px] text-muted-foreground/60 italic">No events today</p>
                      ) : (
                        <div className="space-y-1">
                          {todaysEventsW.slice(0, 4).map((ev: any, i: number) => (
                            <div key={i} className="text-[9px]">
                              <span className="text-teal-500 font-medium">{new Date(ev.start_time).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</span>
                              <span className="ml-1 truncate">{ev.title}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex-[5] min-w-0 overflow-hidden flex flex-col">
                    <div className="flex border-b">
                      <div className="w-[44px] flex-shrink-0" />
                      {calDaysW.map((day, i) => {
                        const isToday = day.toDateString() === todayStr;
                        return (
                          <div key={i} className={`flex-1 text-center py-1.5 border-l ${isToday ? "bg-teal-50 dark:bg-teal-900/20" : ""}`}>
                            <div className="text-[9px] text-muted-foreground uppercase">{day.toLocaleDateString("en-GB", { weekday: "short" })}</div>
                            <div className={`text-lg font-semibold leading-tight ${isToday ? "text-teal-600 dark:text-teal-400" : ""}`}>{day.getDate()}</div>
                          </div>
                        );
                      })}
                    </div>

                    {allDayEventsW.length > 0 && (
                      <div className="flex border-b bg-muted/20">
                        <div className="w-[44px] flex-shrink-0 text-[8px] text-muted-foreground text-right pr-1 py-1">All day</div>
                        {calDaysW.map((day, di) => {
                          const dayAllDay = allDayEventsW.filter((ev: any) => {
                            const s = new Date(ev.start_time); s.setHours(0,0,0,0);
                            const e = ev.end_time ? new Date(ev.end_time) : s; e.setHours(23,59,59,999);
                            return day >= s && day <= e;
                          });
                          return (
                            <div key={di} className="flex-1 border-l p-0.5 space-y-0.5">
                              {dayAllDay.map((ev: any, ei: number) => {
                                const colors = eventColorMapW[ev.event_type?.toLowerCase()] || "bg-zinc-100 border-zinc-300 text-zinc-700";
                                return (
                                  <div key={ei} className={`text-[9px] px-1 py-0.5 rounded border truncate ${colors}`}>{ev.title}</div>
                                );
                              })}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    <ScrollArea className="flex-1">
                      <div className="relative">
                        {hoursW.map((hour) => (
                          <div key={hour} className="flex" style={{ height: "36px" }}>
                            <div className="w-[44px] flex-shrink-0 text-[9px] text-muted-foreground text-right pr-1 pt-0 leading-none border-t border-dashed">
                              {`${hour.toString().padStart(2, "0")}:00`}
                            </div>
                            {calDaysW.map((day, di) => {
                              const isToday = day.toDateString() === todayStr;
                              const hourEvents = timedEventsW.filter((ev: any) => {
                                const s = new Date(ev.start_time);
                                return s.toDateString() === day.toDateString() && s.getHours() === hour;
                              });
                              return (
                                <div key={di} className={`flex-1 border-l border-t border-dashed relative ${isToday ? "bg-teal-50/30 dark:bg-teal-900/5" : ""}`}>
                                  {hourEvents.map((ev: any, ei: number) => {
                                    const colors = eventColorMapW[ev.event_type?.toLowerCase()] || "bg-zinc-100 border-zinc-300 text-zinc-700";
                                    return (
                                      <div key={ei} className={`absolute inset-x-0.5 top-0.5 text-[9px] px-1 py-0.5 rounded border truncate z-10 ${colors}`} data-testid={`cal-event-${ev.id}`}>
                                        {ev.title}
                                      </div>
                                    );
                                  })}
                                </div>
                              );
                            })}
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  </div>
                </div>
              </CardContent>
              {calInsights.length > 0 && (
                <div className="border-t bg-muted/10 px-3 py-1.5 flex items-center gap-2 overflow-x-auto scrollbar-none shrink-0" data-testid="diary-insights">
                  <Brain className="w-3.5 h-3.5 text-primary shrink-0" />
                  {calInsights.slice(0, 3).map((ins, i) => {
                    const IIcon = ({ todaySummary: CalendarIcon, hotProperty: Flame, viewingTrend: TrendingUp, activeTenant: Building2, busiestAgent: UserCheck, coldProperty: AlertTriangle, busiestDay: BarChart3 } as Record<string, any>)[ins.type] || Brain;
                    const iclr = ({ todaySummary: "text-blue-500", hotProperty: "text-rose-500", viewingTrend: "text-emerald-500", activeTenant: "text-amber-500", busiestAgent: "text-violet-500", coldProperty: "text-orange-500", busiestDay: "text-sky-500" } as Record<string, string>)[ins.type] || "text-muted-foreground";
                    return (
                      <div key={`${ins.type}-${i}`} className="flex items-center gap-1.5 shrink-0 text-[10px]" data-testid={`dash-insight-${ins.type}`}>
                        <IIcon className={`w-3 h-3 ${iclr} shrink-0`} />
                        <span className="font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">{ins.title}</span>
                        <span className="text-foreground/80 whitespace-nowrap">{ins.detail}</span>
                        {i < Math.min(calInsights.length, 3) - 1 && <span className="text-border mx-1">|</span>}
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          );
        })();

        if (widgetId === "active-contacts") return (() => {
          const contactTeam = activeTeam === "all" ? (user?.team || null) : (activeTeam || user?.team || null);
          const activeContactsFiltered = (dashIntel?.activeContacts || []).filter(c => {
            if (!contactTeam) return true;
            const allocs = (() => { try { return Array.isArray(c.bgpAllocation) ? c.bgpAllocation : c.bgpAllocation ? JSON.parse(c.bgpAllocation) : []; } catch { return c.bgpAllocation ? [c.bgpAllocation] : []; } })();
            return allocs.some((a: string) => a.toLowerCase().includes(contactTeam.toLowerCase().split(" ")[0]));
          });
          return (
          <Card key="active-contacts" data-testid="card-active-contacts" className="h-full flex flex-col">
            <CardHeader className="flex flex-row items-center justify-between gap-2 pb-1">
              <div>
                <div className="flex items-center gap-2">
                  <UserCheck className="w-4 h-4 text-green-500" />
                  <CardTitle className="text-sm font-semibold">
                    {dashboardViewMode === "team" ? (contactTeam ? `${contactTeam} Active Contacts` : "Team Active Contacts") : "My Active Contacts"}
                  </CardTitle>
                </div>
                <p className="text-[10px] text-muted-foreground mt-0.5 ml-6">Contacts with the most email and calendar interactions this week</p>
              </div>
              <Link href={contactTeam ? `/contacts?team=${encodeURIComponent(contactTeam)}` : "/contacts"}><Button variant="ghost" size="sm" className="text-xs h-7">View all <ArrowRight className="w-3 h-3 ml-1" /></Button></Link>
            </CardHeader>
            <CardContent className="pt-0">
              {activeContactsFiltered.length > 0 ? (
                <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
                  {activeContactsFiltered.map(c => (
                    <Link key={c.contactId} href={`/contacts/${c.contactId}`}>
                      <div className="flex items-center gap-2.5 p-2 rounded-md border hover:bg-muted/50 transition-colors cursor-pointer text-xs" data-testid={`active-contact-${c.contactId}`}>
                        <div className="w-7 h-7 rounded-full bg-green-500/10 flex items-center justify-center shrink-0">
                          <Users className="w-3.5 h-3.5 text-green-500" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="font-medium truncate">{c.name}</p>
                          <p className="text-muted-foreground">{c.count} interactions · {c.lastType}</p>
                        </div>
                        <Badge variant="secondary" className="text-[10px] shrink-0">{c.count}</Badge>
                      </div>
                    </Link>
                  ))}
                </div>
              ) : (
                <div className="text-center py-4 text-muted-foreground">
                  <Users className="w-6 h-6 mx-auto mb-1.5 opacity-30" />
                  <p className="text-xs">No team contact activity yet</p>
                </div>
              )}
            </CardContent>
          </Card>
          );
        })();

        if (widgetId === "new-requirements") return (() => {
          const reqTeam = activeTeam === "all" ? (user?.team || "Investment") : (activeTeam || user?.team || "Investment");
          const isInvestmentTeam = reqTeam.toLowerCase().includes("investment");
          const reqType = isInvestmentTeam ? "investment" : "leasing";
          const reqLabel = isInvestmentTeam ? "Investment" : "Leasing";
          const filteredReqs = (dashIntel?.recentRequirements || []).filter(r => r.type === reqType);
          return (
          <Card key="new-requirements" data-testid="card-new-requirements" className="h-full flex flex-col">
            <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
              <div className="flex items-center gap-2">
                <ListPlus className={`w-4 h-4 ${isInvestmentTeam ? "text-amber-500" : "text-blue-500"}`} />
                <CardTitle className="text-sm font-semibold">{reqLabel} Requirements</CardTitle>
                {filteredReqs.length > 0 && (
                  <Badge variant="secondary" className="text-[10px]">{filteredReqs.length}</Badge>
                )}
              </div>
              <div className="flex items-center gap-1">
                {!isClientUser && (
                  <Link href={`/requirements?type=${reqType}&team=${encodeURIComponent(reqTeam)}&new=1`}><Button variant="ghost" size="sm" className="text-xs h-7" data-testid="button-widget-add-requirement"><Plus className="w-3.5 h-3.5 mr-1" />Add</Button></Link>
                )}
                <Link href={`/requirements?type=${reqType}&team=${encodeURIComponent(reqTeam)}`}><Button variant="ghost" size="sm" className="text-xs h-7">View all <ArrowRight className="w-3 h-3 ml-1" /></Button></Link>
              </div>
            </CardHeader>
            <CardContent className="pt-0 flex-1 overflow-hidden flex flex-col">
              {filteredReqs.length > 0 ? (
                <div className="space-y-1.5 flex-1 overflow-y-auto">
                  {filteredReqs.map(r => (
                    <div key={r.id} className="flex items-center gap-2.5 p-2 rounded-md border text-xs" data-testid={`new-req-${r.id}`}>
                      <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${isInvestmentTeam ? "bg-amber-500/10" : "bg-blue-500/10"}`}>
                        <FileText className={`w-3.5 h-3.5 ${isInvestmentTeam ? "text-amber-500" : "text-blue-500"}`} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium truncate">{r.name}</p>
                        <p className="text-muted-foreground">{new Date(r.createdAt).toLocaleDateString("en-GB")}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-4 text-muted-foreground">
                  <ListPlus className="w-6 h-6 mx-auto mb-1.5 opacity-30" />
                  <p className="text-xs">No {reqLabel.toLowerCase()} requirements found</p>
                  {!isClientUser && (
                    <Link href={`/requirements?type=${reqType}&team=${encodeURIComponent(reqTeam)}&new=1`}>
                      <Button variant="outline" size="sm" className="mt-2 text-xs h-7" data-testid="button-widget-add-requirement-empty">
                        <Plus className="w-3.5 h-3.5 mr-1" />
                        Add requirement
                      </Button>
                    </Link>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
          );
        })();

        if (widgetId === "activity-alerts") return (
          <Card key="activity-alerts" data-testid="card-activity-alerts" className="h-full flex flex-col">
            <CardHeader className="flex flex-row items-center justify-between gap-2 pb-1">
              <div>
                <div className="flex items-center gap-2">
                  <Bell className="w-4 h-4 text-amber-500" />
                  <CardTitle className="text-sm font-semibold">Activity</CardTitle>
                </div>
                <p className="text-[10px] text-muted-foreground mt-0.5 ml-6">Upcoming diary events and recent emails / calls / meetings</p>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              {/* Canonical ActivitySummary (Woody, 2026-08-03) — replaces the
                  bespoke Team Activity / Activity Alerts list. */}
              <ActivitySummary />
            </CardContent>
          </Card>
        );

        if (widgetId === "key-instructions") return (
          <Card key="key-instructions" className="h-full flex flex-col">
            <CardHeader className="flex flex-row items-center justify-between gap-2 pb-1">
              <div>
                <div className="flex items-center gap-2">
                  <Star className="w-4 h-4 text-amber-500 fill-amber-500" />
                  <CardTitle className="text-sm font-semibold">Key Instructions</CardTitle>
                </div>
                <p className="text-[10px] text-muted-foreground mt-0.5 ml-6">Your starred properties currently under BGP instruction</p>
              </div>
              <Link href="/instructions">
                <Button variant="ghost" size="sm" className="text-xs h-7" data-testid="link-view-all-instructions">View all <ArrowRight className="w-3 h-3 ml-1" /></Button>
              </Link>
            </CardHeader>
            <CardContent className="pt-0">
              {statsLoading ? (
                <div className="space-y-1.5">
                  {[1, 2, 3].map((i) => <Skeleton key={i} className="h-12" />)}
                </div>
              ) : keyInstructions.length > 0 ? (
                <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
                  {keyInstructions.map((item) => {
                    const addr = item.address as any;
                    const addressText = addr?.address || addr?.street || "";
                    const details = [item.assetClass, item.sqft ? `${Math.round(item.sqft).toLocaleString()} sq ft` : null].filter(Boolean).join(" · ");
                    return (
                      <Link key={item.id} href={`/properties/${item.id}`}>
                        <div className="flex items-center gap-2.5 p-2 rounded-md border hover:bg-muted/50 transition-colors cursor-pointer text-xs" data-testid={`key-instruction-${item.id}`}>
                          <div className="w-7 h-7 rounded-full bg-amber-500/10 flex items-center justify-center shrink-0">
                            <Building2 className="w-3.5 h-3.5 text-amber-500" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="font-medium truncate">{item.name}</p>
                            <p className="text-muted-foreground truncate">{details || addressText || "BGP Instruction"}</p>
                          </div>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center py-4 text-muted-foreground">
                  <Star className="w-6 h-6 mx-auto mb-1.5 opacity-30" />
                  <p className="text-xs">{favoriteIds.length === 0 ? "Star instructions to pin them here" : "No matches"}</p>
                </div>
              )}
            </CardContent>
          </Card>
        );


        if (widgetId === "inbox") return (
          <Card key="inbox" className="overflow-hidden h-full flex flex-col">
            <CardHeader className="flex flex-row items-center justify-between gap-2 py-2 px-3 flex-shrink-0">
              <div className="flex items-center gap-2">
                <MailIcon className="w-4 h-4 text-blue-500" />
                <CardTitle className="text-sm font-semibold">Inbox</CardTitle>
              </div>
              <Link href="/mail">
                <Button variant="ghost" size="sm" className="text-xs h-7 gap-1" data-testid="link-view-mail">
                  Open <ExternalLink className="w-3 h-3" />
                </Button>
              </Link>
            </CardHeader>
            <div className="flex-1 min-h-0" data-testid="dash-inbox-embed">
              <MailView mailType="personal" />
            </div>
          </Card>
        );



        if (widgetId === "available-units") {
          const effectiveTeam = activeTeam || user?.team;
          if (effectiveTeam === "Investment") return <InvestmentTrackerWidget key="investment-tracker-widget" />;
          return <AvailableUnitsWidget key="available-units" />;
        }

        if (widgetId === "deals-board") return <DealsBoardWidget key="deals-board" />;

        if (widgetId === "agent-pipeline") return (
          <WipDashboardCard key="agent-pipeline" user={user} />
        );

        if (widgetId === "my-leads") return (
          <MyLeadsWidget key="my-leads" />
        );

        if (widgetId === "sharepoint") return (
          <SharePointWidget key="sharepoint" />
        );

        if (widgetId === "studios") return (
          <StudiosWidget key="studios" />
        );

        if (widgetId === "properties-deals") return (() => {
          // The Landsec portfolio board already shows properties grouped with their deals,
          // so suppress this general widget for Landsec to avoid showing the same content twice.
          if (isLandsecTeam && portfolioData) return null;
          // Canonical PropertiesSummary (Woody, 2026-08-03) — active properties
          // with live-letting / live-deal chips deep-linking into both boards.
          return (
            <Card key="properties-deals" className="h-full flex flex-col">
              <CardContent className="p-3 space-y-2 flex-1 overflow-hidden">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-xs flex items-center gap-1.5" data-testid="text-properties-deals-title">
                    <Building2 className="w-3.5 h-3.5 text-teal-500" />
                    Properties & Deals
                  </h3>
                </div>
                <PropertiesSummary onlyActive />
              </CardContent>
            </Card>
          );
        })();

        // System Activity + Daily Digest merged into one "Activity Feed" widget.
        if (widgetId === "system-activity") return <ActivityFeedWidget />;

        // daily-digest is now folded into the Activity Feed; render nothing so it
        // drops out of the grid (filtered by content !== null) without duplicating content.
        if (widgetId === "daily-digest") return null;

        if (widgetId === "my-tasks") return <MyTasksWidget />;

        if (widgetId === "my-portfolio") return <MyPortfolioWidget key="my-portfolio" />;

        if (widgetId === "landsec-analytics") return <LandsecAnalyticsWidget key="landsec-analytics" />;

        if (widgetId === "kpi-overview") return <KpiOverviewWidget key="kpi-overview" />;

        return null;
        };

        const widgetGridItems = activeWidgets.map((wid) => {
          const sizes = WIDGET_GRID_SIZES[wid] || { w: 12, h: 8, minW: 4, minH: 4 };
          return {
            id: wid,
            label: widgetLabelMap[wid] || wid,
            description: widgetDescriptionMap[wid],
            content: renderWidget(wid),
            defaultW: sizes.w,
            defaultH: sizes.h,
            minW: sizes.minW,
            minH: sizes.minH,
          };
        }).filter(item => item.content !== null);

        // One grid for everything. When portfolio boards are present they
        // share the grid with the widgets (combined layout key); plain staff
        // dashboards keep their existing widgets layout untouched.
        const hasPortfolioBoards = portfolioBoardsForGrid.length > 0;
        let gridItems = [...portfolioBoardsForGrid, ...widgetGridItems];
        // Client-portfolio default order (Woody, 2026-08-03: "letting tracker
        // and tasks should be near the top"): the grid packs sequentially, so
        // this list IS the default layout. Users can still drag; unknown ids
        // keep their relative order at the end.
        if (hasPortfolioBoards) {
          const DEFAULT_ORDER = [
            "portfolio-kpis",
            "available-units", "my-tasks",
            "portfolio-events", "news-summary",
            "portfolio-calendar",
            "portfolio-deals",
            "portfolio-vacancy-pipeline", "portfolio-files",
            "portfolio-relationship",
            "portfolio-leasing", "portfolio-lease-expiry",
            "portfolio-team",
            "portfolio-contacts", "portfolio-company",
            "portfolio-properties",
          ];
          const rank = (id: string) => { const i = DEFAULT_ORDER.indexOf(id); return i === -1 ? DEFAULT_ORDER.length : i; };
          gridItems = [...gridItems].sort((a: any, b: any) => rank(a.id) - rank(b.id));
        }

        return (
          <DraggableGrid
            items={gridItems}
            savedLayout={hasPortfolioBoards ? combinedSavedLayout : widgetSavedLayout}
            onLayoutSave={hasPortfolioBoards ? handleCombinedLayoutSave : handleWidgetLayoutSave}
            onHideItem={(id) => (id.startsWith("portfolio-") ? handleHidePortfolioBoard(id) : handleHideWidget(id))}
            editing={dashboardEditing}
            rowHeight={30}
          />
        );
      })()}

      {activeWidgets.length === 0 && portfolioBoardsForGrid.length === 0 && (
        <Card>
          <CardContent className="py-16 text-center">
            <Settings2 className="w-10 h-10 mx-auto mb-3 text-muted-foreground opacity-30" />
            <p className="text-sm font-medium mb-1">No widgets selected</p>
            <p className="text-xs text-muted-foreground mb-4">Use the Customise button to add boards to your dashboard</p>
          </CardContent>
        </Card>
      )}

    </div>
  );
}
