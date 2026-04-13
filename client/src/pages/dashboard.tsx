import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useTeam } from "@/lib/team-context";
import { useBrand } from "@/lib/brand-context";
import { DraggableGrid } from "@/components/draggable-grid";
import {
  Building2,
  CalendarDays,
  Users,
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
  boardsToWidgets,
  widgetsToBoards,
  timeAgo,
} from "@/components/dashboard";
import type { CrmStats, NewsArticle, DashboardIntelligence, CalendarEvent } from "@/components/dashboard";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import type { CrmComp } from "@shared/schema";


function SystemActivityWidget() {
  const { data: activities, isLoading: actLoading } = useQuery<any[]>({ queryKey: ["/api/activity-feed"] });
  const sourceIcons: Record<string, { icon: React.ElementType; color: string }> = {
    "email-processor": { icon: MailIcon, color: "text-blue-500" },
    "auto-enrich": { icon: Sparkles, color: "text-purple-500" },
    "news-feed": { icon: Newspaper, color: "text-orange-500" },
    "comp-extract": { icon: BarChart3, color: "text-green-500" },
    "archivist": { icon: FolderOpen, color: "text-amber-500" },
    "interaction-sync": { icon: Users, color: "text-cyan-500" },
  };
  return (
    <Card key="system-activity" className="h-full flex flex-col" data-testid="widget-system-activity">
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2 pt-4 px-4">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-primary" />
          <CardTitle className="text-sm font-semibold">System Activity</CardTitle>
        </div>
        <Badge variant="secondary" className="text-[10px]">Live</Badge>
      </CardHeader>
      <CardContent className="flex-1 overflow-hidden px-4 pb-4">
        <ScrollArea className="h-full">
          {actLoading ? (
            <div className="space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-12 w-full" />)}</div>
          ) : !activities?.length ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <Zap className="w-8 h-8 text-muted-foreground/30 mb-2" />
              <p className="text-xs text-muted-foreground">No automated activity yet</p>
            </div>
          ) : (
            <div className="space-y-1">
              {activities.map((a: any) => {
                const config = sourceIcons[a.source] || { icon: Zap, color: "text-muted-foreground" };
                const Icon = config.icon;
                return (
                  <div key={a.id} className="flex items-start gap-2.5 p-2 rounded-md hover:bg-muted/50 transition-colors" data-testid={`activity-item-${a.id}`}>
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

function DailyDigestWidget() {
  const { data: alerts, isLoading: digestLoading } = useQuery<any[]>({ queryKey: ["/api/daily-digest"] });
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
  return (
    <Card key="daily-digest" className="h-full flex flex-col" data-testid="widget-daily-digest">
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2 pt-4 px-4">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-500" />
          <CardTitle className="text-sm font-semibold">Daily Digest</CardTitle>
        </div>
        {alerts && alerts.length > 0 && <Badge variant="destructive" className="text-[10px]">{alerts.length}</Badge>}
      </CardHeader>
      <CardContent className="flex-1 overflow-hidden px-4 pb-4">
        <ScrollArea className="h-full">
          {digestLoading ? (
            <div className="space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-14 w-full" />)}</div>
          ) : !alerts?.length ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <Check className="w-8 h-8 text-green-500/30 mb-2" />
              <p className="text-xs text-muted-foreground">All clear — no alerts today</p>
            </div>
          ) : (
            <div className="space-y-1">
              {alerts.map((alert: any, idx: number) => {
                const sev = severityConfig[alert.severity] || severityConfig.info;
                const Icon = typeIcons[alert.type] || AlertTriangle;
                const href = alert.entityType === "deal" ? `/deals/${alert.entityId}` : alert.entityType === "contact" ? `/contacts/${alert.entityId}` : alert.entityType === "requirement" ? `/requirements` : "#";
                return (
                  <Link key={idx} href={href}>
                    <div className="flex items-start gap-2.5 p-2 rounded-md hover:bg-muted/50 transition-colors cursor-pointer" data-testid={`digest-alert-${idx}`}>
                      <div className={`w-6 h-6 rounded-full ${sev.bg} flex items-center justify-center shrink-0 mt-0.5`}>
                        <Icon className={`w-3 h-3 ${sev.color}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium leading-tight">{alert.title}</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">{alert.detail}</p>
                      </div>
                      <ArrowRight className="w-3 h-3 text-muted-foreground shrink-0 mt-1" />
                    </div>
                  </Link>
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
  const { data: briefingData, isLoading: briefingLoading } = useQuery<any>({
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
  const overdueTasks = activeTasks.filter((t: any) => t.due_date && new Date(t.due_date) < new Date());
  const priorityIcon = (p: string) => p === "urgent" ? <Flame className="w-2.5 h-2.5 text-red-500" /> : p === "high" ? <AlertTriangle className="w-2.5 h-2.5 text-orange-500" /> : null;
  const dueLabel = (d: string | null) => {
    if (!d) return null;
    const diff = Math.floor((new Date(d).getTime() - new Date().setHours(0,0,0,0)) / 86400000);
    if (diff < 0) return <span className="text-[10px] text-red-600 font-medium">{Math.abs(diff)}d overdue</span>;
    if (diff === 0) return <span className="text-[10px] text-orange-600 font-medium">Today</span>;
    if (diff === 1) return <span className="text-[10px] text-blue-600">Tomorrow</span>;
    return <span className="text-[10px] text-muted-foreground">{new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>;
  };
  const renderBriefingLine = (line: string, i: number) => {
    if (line.startsWith("## ")) return <h3 key={i} className="text-xs font-semibold mt-2 mb-0.5">{line.slice(3)}</h3>;
    if (line.startsWith("# ")) return <h2 key={i} className="text-xs font-bold mt-2 mb-0.5 first:mt-0">{line.slice(2)}</h2>;
    if (line.startsWith("- ") || line.startsWith("• ")) return <li key={i} className="ml-3 text-[11px] list-disc marker:text-primary/40 leading-snug">{line.slice(2).replace(/\*\*/g, "")}</li>;
    if (line.trim() === "") return <div key={i} className="h-1" />;
    if (line.startsWith("---")) return <hr key={i} className="my-1.5 border-border" />;
    return <p key={i} className="text-[11px] leading-snug">{line.replace(/\*\*/g, "")}</p>;
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
            className="w-full flex items-center justify-between px-3 py-1.5 text-[11px] font-medium hover:bg-muted/50 transition-colors"
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
                <p className="text-[11px] text-muted-foreground py-2">Briefing will appear shortly...</p>
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
                      <span className="text-xs font-medium truncate">{task.title}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      {dueLabel(task.due_date)}
                      {task.deal_name && <span className="text-[10px] text-muted-foreground truncate max-w-[120px]">{task.deal_name}</span>}
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

function QuickAction({ title, subtitle, icon: Icon, href }: { title: string; subtitle: string; icon: React.ElementType; href: string }) {
  return (
    <Link href={href}>
      <div className="flex items-center gap-3 p-3 rounded-lg border border-border hover:bg-muted/50 transition-colors cursor-pointer" data-testid={`quick-action-${title.toLowerCase().replace(/\s/g, "-")}`}>
        <div className="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
          <Icon className="w-4 h-4 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">{title}</p>
          <p className="text-xs text-muted-foreground truncate">{subtitle}</p>
        </div>
        <ArrowRight className="w-4 h-4 text-muted-foreground shrink-0" />
      </div>
    </Link>
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
    return (localStorage.getItem("bgp_dashboard_view_mode") as "team" | "individual") || "team";
  });
  const [diaryRange, setDiaryRange] = useState<"today" | "week">("week");
  const handleViewModeChange = useCallback((mode: "team" | "individual") => {
    setDashboardViewMode(mode);
    localStorage.setItem("bgp_dashboard_view_mode", mode);
  }, []);
  const { isLoading: statsLoading } = useQuery<CrmStats>({
    queryKey: ["/api/crm/stats"],
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
  });
  const { data: myCalEvents } = useQuery<CalendarEvent[]>({
    queryKey: ["/api/microsoft/calendar"],
  });
  const { data: msStatus } = useQuery<{ connected: boolean }>({
    queryKey: ["/api/user-mail/status"],
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
  });
  const calInsights = calInsightsData?.insights || [];
  const { data: invTrackerItems } = useQuery<InvTracker[]>({
    queryKey: ["/api/investment-tracker"],
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

  const [closeDialogCb, setCloseDialogCb] = useState<(() => void) | null>(null);
  const saveMutation = useMutation({
    mutationFn: async (widgets: string[]) => {
      await apiRequest("PATCH", "/api/auth/me/dashboard-widgets", { widgets });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      toast({ title: "Widgets updated", duration: 1500 });
      if (closeDialogCb) {
        closeDialogCb();
        setCloseDialogCb(null);
      }
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

  const LAYOUT_VERSION = 13;
  const rawSavedLayout = (user as any)?.dashboardLayout || null;
  const savedLayoutVersion = rawSavedLayout?._version || 1;
  const validSaved = savedLayoutVersion >= LAYOUT_VERSION ? rawSavedLayout : null;

  const { data: templateData } = useQuery<{ template: Record<string, any> | null }>({
    queryKey: ["/api/dashboard-template"],
  });
  const rawTemplate = templateData?.template;
  const templateLayout = (rawTemplate?._version >= LAYOUT_VERSION) ? rawTemplate : null;

  const portfolioSavedLayout = validSaved?.portfolio || templateLayout?.portfolio || null;
  const widgetSavedLayout = validSaved?.widgets || templateLayout?.widgets || null;
  const hiddenPortfolioBoards: string[] = validSaved?.hiddenPortfolio ?? templateLayout?.hiddenPortfolio ?? ["portfolio-properties"];

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

  const handlePortfolioLayoutSave = useCallback((layout: Record<string, any>) => {
    const current = (user as any)?.dashboardLayout || {};
    layoutSaveMutation.mutate({ ...current, portfolio: layout, _version: LAYOUT_VERSION });
  }, [layoutSaveMutation, user]);

  const handleWidgetLayoutSave = useCallback((layout: Record<string, any>) => {
    const current = (user as any)?.dashboardLayout || {};
    layoutSaveMutation.mutate({ ...current, widgets: layout, _version: LAYOUT_VERSION });
  }, [layoutSaveMutation, user]);

  const handleHidePortfolioBoard = useCallback((boardId: string) => {
    const current = (user as any)?.dashboardLayout || {};
    const hidden = [...(current.hiddenPortfolio || []), boardId];
    layoutSaveMutation.mutate({ ...current, hiddenPortfolio: hidden, _version: LAYOUT_VERSION });
  }, [layoutSaveMutation, user]);

  const handleShowPortfolioBoard = useCallback((boardId: string) => {
    const current = (user as any)?.dashboardLayout || {};
    const hidden = (current.hiddenPortfolio || []).filter((id: string) => id !== boardId);
    layoutSaveMutation.mutate({ ...current, hiddenPortfolio: hidden, _version: LAYOUT_VERSION });
  }, [layoutSaveMutation, user]);

  const handleResetLayout = useCallback(() => {
    layoutSaveMutation.mutate(null as any);
    window.location.reload();
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
    "London Leasing": ["London Leasing", "London"],
    "National Leasing": ["National Leasing", "National"],
    "Investment": ["Investment"],
    "Tenant Rep": ["Tenant Rep"],
    "Development": ["Development"],
    "Lease Advisory": ["Lease Advisory"],
    "Office / Corporate": ["Office / Corporate", "Office", "Corporate"],
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
  const rawWidgets = (user?.dashboardWidgets ?? DEFAULT_WIDGETS)
    .map((id: string) => id === "recent-properties" ? "key-instructions" : id)
    .filter((id: string) => id !== "latest-news" && id !== "stats" && id !== "quick-access");
  const withNews = rawWidgets.includes("news-summary") ? rawWidgets : ["news-summary", ...rawWidgets];
  const withLeads = withNews.includes("my-leads") ? withNews : ["my-leads", ...withNews];
  const withKpi = withLeads.includes("kpi-overview") ? withLeads : [...withLeads, "kpi-overview"];
  const topWidgets = ["my-leads", "news-summary", "kpi-overview"];
  const reordered = withKpi.filter((id: string) => !topWidgets.includes(id));
  reordered.unshift("kpi-overview");
  reordered.unshift("my-leads", "news-summary");
  const tripleIds = ["today-diary", "key-instructions", "active-contacts"];
  const hasAll = tripleIds.every(id => reordered.includes(id));
  if (hasAll) {
    const without = reordered.filter((id: string) => !tripleIds.includes(id));
    const insertAt = Math.min(...tripleIds.map(id => reordered.indexOf(id)));
    const adjustedAt = Math.min(insertAt, without.length);
    without.splice(adjustedAt, 0, ...tripleIds);
    reordered.length = 0;
    reordered.push(...without);
  }
  const activeWidgets = Array.from(new Set(reordered.filter((id: string) => knownIds.includes(id))));

  const widgetLabelMap = useMemo(() => {
    const map: Record<string, string> = {};
    WIDGET_REGISTRY.forEach(w => { map[w.id] = w.name; });
    return map;
  }, []);

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
                <>{brand.footerText} · {dashboardViewMode === "team" ? "Team view" : "Individual view"}</>
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
                  setCloseDialogCb(() => onDone);
                  saveMutation.mutate(widgets);
                }}
                saving={saveMutation.isPending}
                viewMode={dashboardViewMode}
                onViewModeChange={handleViewModeChange}
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

        const totalLeasingUnits = portfolioData.leasingUnits?.length || 0;
        const occupiedUnits = (portfolioData.leasingUnits || []).filter((u: any) => u.status === "Occupied" || u.status === "Let").length;
        const expiringUnits = (portfolioData.leasingUnits || []).filter((u: any) => isExpiringSoon(u.lease_expiry)).length;

        const companyInfo = portfolioData.company;
        const bgpContactColors = [
          "bg-orange-500", "bg-teal-600", "bg-zinc-700", "bg-purple-600",
          "bg-blue-600", "bg-emerald-600", "bg-indigo-600", "bg-pink-600",
          "bg-amber-600", "bg-cyan-600", "bg-rose-600", "bg-lime-700",
        ];

        const stats = portfolioData.stats || {};
        const avgRentPerUnit = stats.totalUnits > 0 ? stats.totalPassingRent / stats.totalUnits : 0;
        const occupiedCount = stats.totalUnits - stats.vacantUnits;
        const occupancyRate = stats.totalUnits > 0 ? ((occupiedCount / stats.totalUnits) * 100).toFixed(1) : "0";

        const portfolioGridItems = [
          companyInfo ? {
            id: "portfolio-company",
            label: "Company Info",
            defaultW: 6, defaultH: 12, minW: 4, minH: 6,
            content: (
              <Card className="h-full flex flex-col">
                <CardContent className="p-4 flex-1 overflow-hidden">
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
                        {(companyInfo.kycStatus) && (
                          <div>
                            <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider mb-0.5">KYC & Ownership</p>
                            <div className="flex items-center gap-2">
                              <Badge className={`text-[10px] ${companyInfo.kycStatus === "pass" ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300" : "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-300"}`}>
                                <ShieldCheck className="w-3 h-3 mr-0.5" />
                                {companyInfo.kycStatus === "pass" ? "KYC Passed" : companyInfo.kycStatus}
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
            label: "Upcoming Events",
            defaultW: 6, defaultH: 12, minW: 3, minH: 6,
            content: (
              <Card className="h-full flex flex-col">
                <CardContent className="p-3 space-y-2 flex-1 overflow-hidden">
                  <h3 className="font-semibold text-xs flex items-center gap-1.5">
                    <CalendarDays className="w-3.5 h-3.5 text-teal-500" />
                    Upcoming Events ({portfolioData.events?.length || 0})
                  </h3>
                  {portfolioData.events?.length > 0 ? (
                    <ScrollArea className="flex-1">
                      <div className="space-y-0.5 pr-2">
                        {portfolioData.events.map((ev: any, i: number) => (
                          <div key={i} className="flex items-center justify-between px-2 py-1.5 text-xs">
                            <div className="min-w-0 flex-1">
                              <span className="text-sm font-medium truncate block">{ev.title}</span>
                              <span className="text-muted-foreground">
                                {new Date(ev.start_time).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}
                                {ev.location ? ` · ${ev.location}` : ""}
                              </span>
                            </div>
                            {ev.event_type && (
                              <Badge variant="outline" className="text-[10px] px-1.5 shrink-0">{ev.event_type}</Badge>
                            )}
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  ) : (
                    <p className="text-xs text-muted-foreground">No upcoming events</p>
                  )}
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
                  <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 h-full">
                    <div className="flex flex-col justify-center p-2 rounded-lg bg-teal-50 dark:bg-teal-900/20 border border-teal-200 dark:border-teal-800" data-testid="kpi-properties">
                      <p className="text-[10px] text-teal-600 dark:text-teal-400 font-medium uppercase tracking-wider">Properties</p>
                      <p className="text-2xl font-bold text-teal-700 dark:text-teal-300">{stats.totalProperties}</p>
                    </div>
                    <div className="flex flex-col justify-center p-2 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800" data-testid="kpi-units">
                      <p className="text-[10px] text-blue-600 dark:text-blue-400 font-medium uppercase tracking-wider">Total Units</p>
                      <p className="text-2xl font-bold text-blue-700 dark:text-blue-300">{stats.totalUnits}</p>
                      <p className="text-[10px] text-muted-foreground">{occupiedCount} occupied · {stats.vacantUnits} vacant</p>
                    </div>
                    <div className="flex flex-col justify-center p-2 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800" data-testid="kpi-occupancy">
                      <p className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium uppercase tracking-wider">Occupancy</p>
                      <p className="text-2xl font-bold text-emerald-700 dark:text-emerald-300">{occupancyRate}%</p>
                      <p className="text-[10px] text-muted-foreground">{stats.vacancyRate}% vacancy</p>
                    </div>
                    <div className="flex flex-col justify-center p-2 rounded-lg bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800" data-testid="kpi-rent">
                      <p className="text-[10px] text-purple-600 dark:text-purple-400 font-medium uppercase tracking-wider">Passing Rent</p>
                      <p className="text-xl font-bold text-purple-700 dark:text-purple-300">£{(stats.totalPassingRent / 1000000).toFixed(1)}m</p>
                      <p className="text-[10px] text-muted-foreground">£{avgRentPerUnit.toLocaleString("en-GB", { maximumFractionDigits: 0 })}/unit avg</p>
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
          portfolioData.properties?.length > 0 ? {
            id: "portfolio-properties",
            label: "Linked Properties",
            defaultW: 12, defaultH: 11, minW: 6, minH: 6,
            content: (
              <Card className="h-full flex flex-col">
                <CardContent className="p-3 space-y-2 flex-1 overflow-hidden">
                  <h3 className="font-semibold text-xs flex items-center gap-1.5">
                    <Building2 className="w-3.5 h-3.5 text-teal-500" />
                    Linked Properties ({portfolioData.properties.length})
                  </h3>
                  <ScrollArea className="flex-1">
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5 pr-2">
                      {portfolioData.properties.map((property: any) => {
                        const isLeasing = property.status === "Leasing Instruction";
                        return (
                        <Link key={property.id} href={`/properties/${property.id}`}>
                          <div className={`flex flex-col p-2 rounded-md transition-colors cursor-pointer ${isLeasing ? "border border-green-300 dark:border-green-700 bg-green-50/50 dark:bg-green-900/10 hover:bg-green-50 dark:hover:bg-green-900/20" : "border border-purple-300 dark:border-purple-700 bg-purple-50/50 dark:bg-purple-900/10 hover:bg-purple-50 dark:hover:bg-purple-900/20"}`} data-testid={`link-property-${property.id}`}>
                            <div className="flex items-center gap-2 min-w-0">
                              <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${isLeasing ? "bg-green-500" : "bg-purple-500"}`} />
                              <p className="text-sm font-medium truncate text-zinc-800 dark:text-zinc-200">{property.name}</p>
                            </div>
                            {property.asset_class && (
                              <div className="flex flex-wrap gap-0.5 mt-1 ml-4">
                                <Badge className="text-[9px] px-1 py-0 bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-300">{property.asset_class}</Badge>
                              </div>
                            )}
                          </div>
                        </Link>
                        );
                      })}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>
            ),
          } : null,
          totalLeasingUnits > 0 ? {
            id: "portfolio-leasing",
            label: "Leasing Schedule",
            defaultW: 6, defaultH: 10, minW: 4, minH: 6,
            content: (
              <Card className="h-full flex flex-col">
                <CardContent className="p-3 space-y-3 flex-1 overflow-hidden">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold text-sm flex items-center gap-2">
                      <Building2 className="w-4 h-4" />Leasing Schedule
                      <Badge variant="secondary" className="text-[10px]">{totalLeasingUnits} units across {leasingByProperty.size} properties</Badge>
                    </h3>
                    <div className="flex items-center gap-3 text-[10px]">
                      <span className="text-emerald-600">{occupiedUnits} occupied</span>
                      {expiringUnits > 0 && <span className="text-amber-600">{expiringUnits} expiring</span>}
                      <Link href="/leasing-schedule">
                        <span className="text-indigo-500 hover:underline flex items-center gap-1 cursor-pointer" data-testid="link-leasing-board">
                          <ExternalLink className="w-3 h-3" />Open Board
                        </span>
                      </Link>
                    </div>
                  </div>
                  <ScrollArea className="flex-1">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pr-2">
                      {Array.from(leasingByProperty.entries()).map(([propId, { name, units: propUnits }]) => {
                        const propOccupied = propUnits.filter((u: any) => u.status === "Occupied" || u.status === "Let").length;
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
          {
            id: "portfolio-activity",
            label: "Recent Activity",
            defaultW: 6, defaultH: 10, minW: 3, minH: 6,
            content: (
              <Card className="h-full flex flex-col">
                <CardContent className="p-3 space-y-2 flex-1 overflow-hidden">
                  <h3 className="font-semibold text-xs flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-teal-500" />
                    Recent Activity
                  </h3>
                  {portfolioData.activity?.length > 0 ? (
                    <ScrollArea className="flex-1">
                      <div className="space-y-0.5 pr-2">
                        {portfolioData.activity.map((item: any, i: number) => (
                          <div key={i} className="flex items-start gap-2 px-2 py-1.5 text-xs">
                            <div className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${item.type === "deal" ? "bg-purple-500" : "bg-blue-500"}`} />
                            <div>
                              <p className="font-medium">{item.title}</p>
                              <p className="text-muted-foreground">
                                {item.property_name && <span>{item.property_name} · </span>}
                                {item.status && <span className="capitalize">{item.status} · </span>}
                                {new Date(item.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  ) : (
                    <p className="text-xs text-muted-foreground">No recent activity</p>
                  )}
                </CardContent>
              </Card>
            ),
          },
          {
            id: "portfolio-contacts",
            label: "Contacts",
            defaultW: 4, defaultH: 14, minW: 3, minH: 6,
            content: (
              <Card className="h-full flex flex-col">
                <CardContent className="p-3 space-y-2 flex-1 overflow-hidden">
                  <h3 className="font-semibold text-xs flex items-center gap-1.5">
                    <Users className="w-3.5 h-3.5 text-teal-500" />
                    Contacts ({portfolioData.contacts?.length || 0})
                  </h3>
                  {portfolioData.contacts?.length > 0 ? (
                    <ScrollArea className="flex-1 overflow-y-auto">
                      <div className="space-y-0.5 pr-2">
                        {portfolioData.contacts.map((contact: any) => (
                          <Link key={contact.id} href={`/contacts/${contact.id}`}>
                            <div className="flex items-center gap-2 px-2 py-1 rounded hover:bg-teal-50 dark:hover:bg-teal-900/20 transition-colors cursor-pointer" data-testid={`link-contact-${contact.id}`}>
                              {contact.avatar_url ? (
                                <img src={contact.avatar_url} alt={contact.name} className="w-6 h-6 rounded-full flex-shrink-0 object-cover" />
                              ) : (
                                <div className="w-6 h-6 rounded-full flex-shrink-0 bg-teal-100 dark:bg-teal-900 flex items-center justify-center text-[10px] font-semibold text-teal-700 dark:text-teal-300">
                                  {contact.name?.split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase()}
                                </div>
                              )}
                              <div>
                                <p className="text-xs font-medium text-teal-700 dark:text-teal-300">{contact.name}</p>
                                <p className="text-[10px] text-muted-foreground">{contact.role || contact.email}</p>
                              </div>
                            </div>
                          </Link>
                        ))}
                      </div>
                    </ScrollArea>
                  ) : (
                    <p className="text-xs text-muted-foreground">No contacts linked</p>
                  )}
                </CardContent>
              </Card>
            ),
          },
          (dealsByProperty.size > 0 || unlinkedDeals.length > 0) ? {
            id: "portfolio-deals",
            label: "Properties & Deals",
            defaultW: 8, defaultH: 14, minW: 4, minH: 6,
            content: (
              <Card className="h-full flex flex-col">
                <CardContent className="p-3 space-y-3 flex-1 overflow-hidden">
                  <h3 className="font-semibold text-xs flex items-center gap-1.5">
                    <BarChart3 className="w-3.5 h-3.5 text-teal-500" />
                    Properties & Deals ({portfolioData.deals?.length || 0} deal{(portfolioData.deals?.length || 0) !== 1 ? "s" : ""} across {dealsByProperty.size} propert{dealsByProperty.size !== 1 ? "ies" : "y"})
                  </h3>
                  <ScrollArea className="flex-1">
                    <div className="pr-2">
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    {Array.from(dealsByProperty.values()).map(({ property, deals }) => (
                      <div key={property.id} className="border rounded-lg overflow-hidden" data-testid={`property-group-${property.id}`}>
                        <Link href={`/properties/${property.id}`}>
                          <div className="flex items-center gap-2 p-2 bg-teal-50 dark:bg-teal-900/20 hover:bg-teal-100 dark:hover:bg-teal-900/30 transition-colors cursor-pointer border-b border-teal-100 dark:border-teal-800">
                            <Building2 className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400 shrink-0" />
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-medium truncate text-teal-700 dark:text-teal-300">{property.name}</p>
                            </div>
                            <Badge className="text-[9px] shrink-0 bg-teal-100 text-teal-700 dark:bg-teal-800 dark:text-teal-300 border-0">{deals.length} deal{deals.length !== 1 ? "s" : ""}</Badge>
                          </div>
                        </Link>
                        <div className="divide-y max-h-[150px] overflow-y-auto">
                          {deals.map((deal: any) => (
                            <Link key={deal.id} href={`/deals/${deal.id}`}>
                              <div className="flex items-center justify-between px-2 py-1.5 hover:bg-muted/30 transition-colors cursor-pointer" data-testid={`link-deal-${deal.id}`}>
                                <div className="min-w-0 flex-1">
                                  <p className="text-xs truncate">{deal.name}</p>
                                  <p className="text-[10px] text-muted-foreground">{deal.status}</p>
                                </div>
                                <div className="flex items-center gap-1 shrink-0">
                                  {deal.dealType && (
                                    <Badge variant="secondary" className={`text-[9px] ${deal.dealType === "Leasing" ? "bg-teal-100 text-teal-700 dark:bg-teal-800 dark:text-teal-300" : ""}`}>{deal.dealType}</Badge>
                                  )}
                                </div>
                              </div>
                            </Link>
                          ))}
                        </div>
                      </div>
                    ))}
                    </div>
                    {unlinkedDeals.length > 0 && (
                      <div className="border rounded-lg overflow-hidden mt-2">
                        <div className="flex items-center gap-2 p-2 bg-muted/50">
                          <BarChart3 className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                          <p className="text-xs font-medium">Other Deals (no property linked)</p>
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
          } : null,
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
                      <Badge variant="secondary" className="text-[10px]">{unitsWithExpiry.length} leases across {propertyNames.size} properties</Badge>
                    </h3>
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
              const isOccupied = u.status === "Occupied" || u.status === "Let";
              if (!isOccupied) entry.vacantUnits += 1;
            }

            // Count active deals per property (non-completed, non-withdrawn)
            for (const d of allDeals) {
              if (!d.property_id) continue;
              const st = (d.status || "").toLowerCase();
              const isActive = !st.includes("completed") && !st.includes("withdrawn") && !st.includes("closed") && !st.includes("fallen");
              if (!isActive) continue;
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
                        {totalVacant} total vacant unit{totalVacant !== 1 ? "s" : ""} across {propertiesWithVacancy} propert{propertiesWithVacancy !== 1 ? "ies" : "y"} · {totalActiveDeals} active deal{totalActiveDeals !== 1 ? "s" : ""} in progress
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

        const visiblePortfolioItems = portfolioGridItems.filter((item: any) => !hiddenPortfolioBoards.includes(item.id));
        const hiddenPortfolioItems = portfolioGridItems.filter((item: any) => hiddenPortfolioBoards.includes(item.id));

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
            <DraggableGrid
              items={visiblePortfolioItems}
              savedLayout={portfolioSavedLayout}
              onLayoutSave={handlePortfolioLayoutSave}
              onHideItem={handleHidePortfolioBoard}
              editing={dashboardEditing}
              rowHeight={30}
            />
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
          "available-units": { w: 12, h: 10, minW: 6, minH: 6 },
          "agent-pipeline": { w: 12, h: 22, minW: 6, minH: 14 },
          "inbox": { w: 12, h: 20, minW: 6, minH: 10 },
          "sharepoint": { w: 6, h: 12, minW: 4, minH: 6 },
          "studios": { w: 6, h: 12, minW: 4, minH: 6 },
          "properties-deals": { w: 12, h: 14, minW: 6, minH: 8 },
          "system-activity": { w: 6, h: 9, minW: 4, minH: 5 },
          "daily-digest": { w: 6, h: 9, minW: 4, minH: 5 },
          "my-tasks": { w: 6, h: 18, minW: 4, minH: 10 },
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

        if (widgetId === "quick-actions") return (
          <div key="quick-actions" className="flex items-center gap-2 flex-wrap">
            <Link href="/models">
              <Button variant="outline" size="sm" className="gap-1.5 text-xs" data-testid="quick-action-models">
                <FileSpreadsheet className="w-3.5 h-3.5" /> Models
              </Button>
            </Link>
            <Link href="/templates">
              <Button variant="outline" size="sm" className="gap-1.5 text-xs" data-testid="quick-action-docs">
                <FileText className="w-3.5 h-3.5" /> Documents
              </Button>
            </Link>
            <Link href="/news">
              <Button variant="outline" size="sm" className="gap-1.5 text-xs" data-testid="quick-action-news">
                <Zap className="w-3.5 h-3.5" /> News & Leads
              </Button>
            </Link>
            <Link href="/deals">
              <Button variant="outline" size="sm" className="gap-1.5 text-xs" data-testid="quick-action-deals">
                <BarChart3 className="w-3.5 h-3.5" /> Deals
              </Button>
            </Link>
            <Link href="/chatbgp">
              <Button variant="outline" size="sm" className="gap-1.5 text-xs" data-testid="quick-action-chat">
                <Sparkles className="w-3.5 h-3.5" /> ChatBGP
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
                  <div className="w-[160px] flex-shrink-0 border-r overflow-y-auto p-2 space-y-3">
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

                  <div className="flex-1 overflow-hidden flex flex-col">
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
              <Link href={`/requirements?type=${reqType}&team=${encodeURIComponent(reqTeam)}`}><Button variant="ghost" size="sm" className="text-xs h-7">View all <ArrowRight className="w-3 h-3 ml-1" /></Button></Link>
            </CardHeader>
            <CardContent className="pt-0">
              {filteredReqs.length > 0 ? (
                <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
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
                  <CardTitle className="text-sm font-semibold">{dashboardViewMode === "team" ? "Team Activity" : "Activity Alerts"}</CardTitle>
                  {dashIntel?.activityAlerts && dashIntel.activityAlerts.length > 0 && (
                    <span className="text-[10px] font-medium text-amber-600 bg-amber-500/10 rounded-full px-1.5 py-0.5">{dashIntel.activityAlerts.length}</span>
                  )}
                </div>
                <p className="text-[10px] text-muted-foreground mt-0.5 ml-6">Recent emails and meetings between colleagues and your contacts</p>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              {dashIntel?.activityAlerts && dashIntel.activityAlerts.length > 0 ? (
                <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
                  {dashIntel.activityAlerts.map((alert, i) => {
                    const bgpName = alert.bgpUser.split("@")[0].replace(/([a-z])([A-Z])/g, "$1 $2");
                    return (
                      <Link key={i} href={`/contacts/${alert.contactId}`}>
                        <div className="flex items-start gap-2.5 p-2 rounded-md border hover:bg-muted/50 transition-colors cursor-pointer text-xs" data-testid={`activity-alert-${i}`}>
                          <div className="w-7 h-7 rounded-full bg-amber-500/10 flex items-center justify-center shrink-0">
                            {alert.type === "email" ? <MailIcon className="w-3.5 h-3.5 text-amber-500" /> : <Video className="w-3.5 h-3.5 text-amber-500" />}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="font-medium"><span className="capitalize">{bgpName}</span> · {alert.contactName}</p>
                            <p className="text-muted-foreground truncate">{alert.type} {alert.subject ? `— ${alert.subject}` : ""}</p>
                            <p className="text-muted-foreground">{new Date(alert.date).toLocaleDateString("en-GB")}</p>
                          </div>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center py-4 text-muted-foreground">
                  <Bell className="w-6 h-6 mx-auto mb-1.5 opacity-30" />
                  <p className="text-xs">No colleague activity on your contacts this week</p>
                </div>
              )}
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
          const scopedDeals = deals || [];
          const scopedProps = properties || [];
          const propMap = new Map(scopedProps.map(p => [p.id, p]));
          const grouped = new Map<string, { property: CrmProperty; deals: CrmDeal[] }>();
          const unlinked: CrmDeal[] = [];
          for (const deal of scopedDeals) {
            if (deal.propertyId && propMap.has(deal.propertyId)) {
              if (!grouped.has(deal.propertyId)) {
                grouped.set(deal.propertyId, { property: propMap.get(deal.propertyId)!, deals: [] });
              }
              grouped.get(deal.propertyId)!.deals.push(deal);
            } else if (!deal.propertyId) {
              unlinked.push(deal);
            }
          }
          const propertiesWithNoDeals = scopedProps.filter(p => !grouped.has(p.id));
          const totalDeals = scopedDeals.length;
          const totalProperties = grouped.size + propertiesWithNoDeals.length;
          return (
            <Card key="properties-deals" className="h-full flex flex-col">
              <CardContent className="p-3 space-y-2 flex-1 overflow-hidden">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-xs flex items-center gap-1.5" data-testid="text-properties-deals-title">
                    <Building2 className="w-3.5 h-3.5 text-teal-500" />
                    Properties & Deals ({totalDeals} deal{totalDeals !== 1 ? "s" : ""} across {totalProperties} propert{totalProperties !== 1 ? "ies" : "y"})
                  </h3>
                  <div className="flex items-center gap-2">
                    <Link href="/deals">
                      <span className="text-[10px] text-indigo-500 hover:underline flex items-center gap-1 cursor-pointer" data-testid="link-all-deals">
                        <ExternalLink className="w-3 h-3" />All Deals
                      </span>
                    </Link>
                    <Link href="/properties">
                      <span className="text-[10px] text-indigo-500 hover:underline flex items-center gap-1 cursor-pointer" data-testid="link-all-properties">
                        <ExternalLink className="w-3 h-3" />All Properties
                      </span>
                    </Link>
                  </div>
                </div>
                <ScrollArea className="flex-1">
                  <div className="pr-2">
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                      {Array.from(grouped.values()).map(({ property, deals }) => (
                        <div key={property.id} className="border rounded-lg overflow-hidden" data-testid={`widget-property-group-${property.id}`}>
                          <Link href={`/properties/${property.id}`}>
                            <div className="flex items-center gap-2 p-2 bg-teal-50 dark:bg-teal-900/20 hover:bg-teal-100 dark:hover:bg-teal-900/30 transition-colors cursor-pointer border-b border-teal-100 dark:border-teal-800">
                              <Building2 className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400 shrink-0" />
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-medium truncate text-teal-700 dark:text-teal-300">{property.name}</p>
                              </div>
                              <Badge className="text-[9px] shrink-0 bg-teal-100 text-teal-700 dark:bg-teal-800 dark:text-teal-300 border-0">{deals.length} deal{deals.length !== 1 ? "s" : ""}</Badge>
                            </div>
                          </Link>
                          <div className="divide-y max-h-[150px] overflow-y-auto">
                            {deals.map((deal) => (
                              <Link key={deal.id} href={`/deals/${deal.id}`}>
                                <div className="flex items-center justify-between px-2 py-1.5 hover:bg-muted/30 transition-colors cursor-pointer" data-testid={`link-widget-deal-${deal.id}`}>
                                  <div className="min-w-0 flex-1">
                                    <p className="text-xs truncate">{deal.name}</p>
                                    <p className="text-[10px] text-muted-foreground">{deal.status}</p>
                                  </div>
                                  <div className="flex items-center gap-1 shrink-0">
                                    {deal.dealType && (
                                      <Badge variant="secondary" className={`text-[9px] ${deal.dealType === "Leasing" ? "bg-teal-100 text-teal-700 dark:bg-teal-800 dark:text-teal-300" : deal.dealType === "Lease Advisory" ? "bg-blue-100 text-blue-700 dark:bg-blue-800 dark:text-blue-300" : deal.dealType === "Tenant Rep" ? "bg-purple-100 text-purple-700 dark:bg-purple-800 dark:text-purple-300" : ""}`}>{deal.dealType}</Badge>
                                    )}
                                  </div>
                                </div>
                              </Link>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                    {unlinked.length > 0 && (
                      <div className="border rounded-lg overflow-hidden mt-2">
                        <div className="flex items-center gap-2 p-2 bg-muted/50">
                          <BarChart3 className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                          <p className="text-xs font-medium">Other Deals (no property linked)</p>
                          <Badge variant="outline" className="text-[10px] shrink-0 ml-auto">{unlinked.length}</Badge>
                        </div>
                        <div className="divide-y">
                          {unlinked.map((deal) => (
                            <Link key={deal.id} href={`/deals/${deal.id}`}>
                              <div className="flex items-center justify-between px-2 py-1.5 pl-7 hover:bg-muted/30 transition-colors cursor-pointer" data-testid={`link-widget-deal-${deal.id}`}>
                                <div className="min-w-0 flex-1">
                                  <p className="text-xs truncate">{deal.name}</p>
                                  <p className="text-[10px] text-muted-foreground">{deal.status}</p>
                                </div>
                                {deal.dealType && (
                                  <Badge variant="secondary" className="text-[9px]">{deal.dealType}</Badge>
                                )}
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
          );
        })();

        if (widgetId === "system-activity") return <SystemActivityWidget />;

        if (widgetId === "daily-digest") return <DailyDigestWidget />;

        if (widgetId === "my-tasks") return <MyTasksWidget />;

        if (widgetId === "my-portfolio") return <MyPortfolioWidget key="my-portfolio" />;

        if (widgetId === "landsec-analytics") return <LandsecAnalyticsWidget key="landsec-analytics" />;

        if (widgetId === "kpi-overview") return <KpiOverviewWidget key="kpi-overview" />;

        return null;
        };

        const gridItems = activeWidgets.map((wid) => {
          const sizes = WIDGET_GRID_SIZES[wid] || { w: 12, h: 8, minW: 4, minH: 4 };
          return {
            id: wid,
            label: widgetLabelMap[wid] || wid,
            content: renderWidget(wid),
            defaultW: sizes.w,
            defaultH: sizes.h,
            minW: sizes.minW,
            minH: sizes.minH,
          };
        }).filter(item => item.content !== null);

        return (
          <DraggableGrid
            items={gridItems}
            savedLayout={widgetSavedLayout}
            onLayoutSave={handleWidgetLayoutSave}
            onHideItem={handleHideWidget}
            editing={dashboardEditing}
            rowHeight={30}
          />
        );
      })()}

      {activeWidgets.length === 0 && (
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
