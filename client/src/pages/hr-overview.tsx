import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  Trophy, Mountain, TrendingUp, Users, Calendar, Cake, Sparkles,
  Coffee, Beer, Pizza, Star, Flame, Target, ChevronRight, ChevronDown,
  Loader2, Plus, Check, Briefcase, BarChart3, GitBranch, Eye,
  Megaphone, Heart, ArrowRight, Clock, CreditCard, FileText,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { apiRequest, queryClient, getQueryFn } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { User as AuthUser } from "@shared/schema";

// ── Helpers ──────────────────────────────────────────────────────────────────

const fmtMoney = (pence: number) => {
  if (pence >= 100_000_000) return `£${(pence / 100_000_000).toFixed(2)}m`;
  if (pence >= 100_000) return `£${Math.round(pence / 100_000)}k`;
  return `£${(pence / 100).toLocaleString("en-GB", { maximumFractionDigits: 0 })}`;
};
const fmtFull = (pence: number) => `£${(pence / 100).toLocaleString("en-GB", { maximumFractionDigits: 0 })}`;

const TEAM_STYLES: Record<string, { bg: string; border: string; accent: string; ring: string }> = {
  "Office / Corporate": { bg: "from-purple-50 to-purple-100/50 dark:from-purple-950/40 dark:to-purple-900/20", border: "border-purple-200 dark:border-purple-800", accent: "text-purple-700 dark:text-purple-300", ring: "ring-purple-500/30" },
  "Investment":         { bg: "from-emerald-50 to-emerald-100/50 dark:from-emerald-950/40 dark:to-emerald-900/20", border: "border-emerald-200 dark:border-emerald-800", accent: "text-emerald-700 dark:text-emerald-300", ring: "ring-emerald-500/30" },
  "Lease Advisory":     { bg: "from-amber-50 to-amber-100/50 dark:from-amber-950/40 dark:to-amber-900/20", border: "border-amber-200 dark:border-amber-800", accent: "text-amber-700 dark:text-amber-300", ring: "ring-amber-500/30" },
  "National Leasing":   { bg: "from-orange-50 to-orange-100/50 dark:from-orange-950/40 dark:to-orange-900/20", border: "border-orange-200 dark:border-orange-800", accent: "text-orange-700 dark:text-orange-300", ring: "ring-orange-500/30" },
  "Development":        { bg: "from-pink-50 to-pink-100/50 dark:from-pink-950/40 dark:to-pink-900/20", border: "border-pink-200 dark:border-pink-800", accent: "text-pink-700 dark:text-pink-300", ring: "ring-pink-500/30" },
  "Tenant Rep":         { bg: "from-sky-50 to-sky-100/50 dark:from-sky-950/40 dark:to-sky-900/20", border: "border-sky-200 dark:border-sky-800", accent: "text-sky-700 dark:text-sky-300", ring: "ring-sky-500/30" },
  "London Retail":      { bg: "from-yellow-50 to-yellow-100/50 dark:from-yellow-950/40 dark:to-yellow-900/20", border: "border-yellow-200 dark:border-yellow-800", accent: "text-yellow-700 dark:text-yellow-300", ring: "ring-yellow-500/30" },
  "London F&B":         { bg: "from-rose-50 to-rose-100/50 dark:from-rose-950/40 dark:to-rose-900/20", border: "border-rose-200 dark:border-rose-800", accent: "text-rose-700 dark:text-rose-300", ring: "ring-rose-500/30" },
};
const DEFAULT_TEAM_STYLE = { bg: "from-muted to-muted/50", border: "border-border", accent: "text-foreground", ring: "ring-muted" };
const teamStyle = (t: string) => TEAM_STYLES[t] || DEFAULT_TEAM_STYLE;

// ── Types ────────────────────────────────────────────────────────────────────

interface FirmSummary {
  target: { pence: number; label: string; reward: string };
  billedPence: number;
  wipPence: number;
  forecastPence: number;
  pctBilled: number;
  pctForecast: number;
  toGoPence: number;
  daysRemaining: number;
  dealCount: number;
  headcount: number;
  year: number;
}

interface TeamSummary {
  team: string;
  headcount: number;
  head: { id: string; name: string; title: string | null; profilePicUrl: string | null } | null;
  memberIds: string[];
  pipelinePence: number;
  topDeals: Array<{ id: string; name: string; fee: number; status: string; date: string | null }>;
}

interface CommissionData {
  salary: number;
  effectiveSalary: number;
  schemeYear: string;
  billedPence: number;
  wipTotal: number;
  forecastPence: number;
  t1: number; t2: number; t3: number;
  commissionEarned: number;
  commissionForecast: number;
}

interface UserTask {
  id: string;
  title: string;
  description: string | null;
  due_date: string | null;
  priority: string;
  status: string;
  is_pinned: boolean;
  linked_deal_id: string | null;
  deal_name: string | null;
}

interface StaffMember {
  id: string;
  name: string;
  title: string | null;
  team: string | null;
  profile_pic_url: string | null;
  email: string | null;
  phone: string | null;
}

interface Birthday {
  id: string;
  name: string;
  title: string | null;
  team: string | null;
  profilePicUrl: string | null;
  date: string;
  daysUntil: number;
}

// ── 🎿 Ski-target hero strip ─────────────────────────────────────────────────

function SkiTargetHero() {
  const { data, isLoading } = useQuery<FirmSummary>({ queryKey: ["/api/dashboard/firm-summary"] });
  if (isLoading || !data) {
    return <Skeleton className="h-24 w-full rounded-xl" />;
  }
  return (
    <div className="relative overflow-hidden rounded-xl border bg-gradient-to-r from-sky-50 via-blue-50 to-indigo-50 dark:from-sky-950/40 dark:via-blue-950/40 dark:to-indigo-950/40 p-5 shadow-sm">
      <div className="flex items-start gap-4">
        <div className="rounded-full bg-white/70 dark:bg-white/10 p-2.5 backdrop-blur shrink-0">
          <Mountain className="w-6 h-6 text-sky-600 dark:text-sky-300" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <h2 className="text-base font-semibold tracking-tight">Ski target {data.year}</h2>
            <span className="text-xs text-muted-foreground">{data.target.reward}</span>
          </div>
          <div className="mt-2 flex items-baseline gap-3 flex-wrap">
            <span className="text-2xl font-bold tabular-nums">{fmtMoney(data.billedPence)}</span>
            <span className="text-sm text-muted-foreground">billed of {fmtMoney(data.target.pence)} target</span>
            <span className="text-xs px-2 py-0.5 rounded-full bg-white/60 dark:bg-white/10 text-muted-foreground">+ {fmtMoney(data.wipPence)} WIP</span>
          </div>
          <div className="relative h-2.5 mt-3 rounded-full bg-white/60 dark:bg-white/10 overflow-hidden">
            <div className="absolute inset-y-0 left-0 bg-sky-300 dark:bg-sky-700/70 rounded-full transition-all" style={{ width: `${data.pctForecast}%` }} />
            <div className="absolute inset-y-0 left-0 bg-sky-600 dark:bg-sky-400 rounded-full transition-all" style={{ width: `${data.pctBilled}%` }} />
          </div>
          <div className="mt-1.5 flex items-center justify-between text-[11px] text-muted-foreground">
            <span>
              {data.toGoPence > 0
                ? `${fmtMoney(data.toGoPence)} to go (incl. WIP)`
                : `Beating target — see you on the slopes`}
            </span>
            <span>{data.daysRemaining} days left in {data.year}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── 👤 You panel ─────────────────────────────────────────────────────────────

function YouPanel({ user }: { user: AuthUser }) {
  const [, navigate] = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [newTask, setNewTask] = useState("");

  const { data: commission } = useQuery<CommissionData>({ queryKey: [`/api/hr/staff/${user.id}/commission`] });
  const { data: tasks = [] } = useQuery<UserTask[]>({ queryKey: ["/api/tasks", "todo"], queryFn: () => apiRequest("GET", "/api/tasks?status=todo").then(r => r.json()) });

  const addTask = useMutation({
    mutationFn: async (title: string) => {
      const r = await apiRequest("POST", "/api/tasks", { title, priority: "medium", status: "todo" });
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks", "todo"] });
      setNewTask("");
    },
  });

  const completeTask = useMutation({
    mutationFn: async (id: string) => {
      const r = await apiRequest("PATCH", `/api/tasks/${id}`, { status: "done" });
      return r.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/tasks", "todo"] }),
  });

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const endOfWeek = new Date(today); endOfWeek.setDate(today.getDate() + 7);

  // Pinned first, then due today/overdue, then due this week, then no-due-date.
  // Don't hide tasks just because they're undated — that's why "Inbox zero"
  // was showing on accounts that genuinely had open work.
  const pinnedTasks = tasks.filter(t => t.is_pinned);
  const todayTasks = tasks.filter(t => !t.is_pinned && t.due_date && new Date(t.due_date) <= today);
  const weekTasks = tasks.filter(t => !t.is_pinned && t.due_date && new Date(t.due_date) > today && new Date(t.due_date) <= endOfWeek);
  const undatedTasks = tasks.filter(t => !t.is_pinned && !t.due_date);
  const visibleTasks = [...pinnedTasks, ...todayTasks, ...weekTasks, ...undatedTasks].slice(0, 6);
  const totalOpen = tasks.length;

  const target = commission?.t2 ?? 0;
  const pct = target > 0 ? Math.min((commission!.forecastPence / target) * 100, 100) : 0;
  const pctBilled = target > 0 ? Math.min((commission!.billedPence / target) * 100, 100) : 0;

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-3 cursor-pointer" onClick={() => setCollapsed(c => !c)}>
        <CardTitle className="text-sm flex items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <span className="text-base">👋</span>
            Hi {user.name?.split(" ")[0] ?? "there"} — your day
          </span>
          <ChevronDown className={`w-4 h-4 transition-transform ${collapsed ? "-rotate-90" : ""}`} />
        </CardTitle>
      </CardHeader>
      {!collapsed && (
        <CardContent className="space-y-4 pt-0">
          {/* Commission hero */}
          {commission && (
            <button
              onClick={() => navigate(`/hr`)}
              className="w-full text-left rounded-lg border bg-gradient-to-br from-primary/5 to-transparent p-3 hover:from-primary/10 transition-colors"
              data-testid="you-commission"
            >
              <div className="flex items-baseline justify-between mb-1.5">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Commission · {commission.schemeYear}</span>
                <span className="text-[11px] text-muted-foreground">target {fmtMoney(commission.t2)}</span>
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold tabular-nums">{fmtMoney(commission.billedPence)}</span>
                <span className="text-xs text-muted-foreground">billed</span>
                <span className="text-xs ml-auto text-muted-foreground">+ {fmtMoney(commission.wipTotal)} WIP</span>
              </div>
              <div className="relative h-2 mt-2 rounded-full bg-muted overflow-hidden">
                <div className="absolute inset-y-0 left-0 bg-primary/30 rounded-full transition-all" style={{ width: `${pct}%` }} />
                <div className="absolute inset-y-0 left-0 bg-primary rounded-full transition-all" style={{ width: `${pctBilled}%` }} />
              </div>
              <div className="text-[11px] text-muted-foreground mt-1">
                Forecast {fmtMoney(commission.forecastPence)} → est. commission {fmtMoney(commission.commissionForecast)}
              </div>
            </button>
          )}

          {/* Tasks */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Open tasks {totalOpen > 0 && <span className="text-foreground font-semibold ml-1">{totalOpen}</span>}
              </span>
              <button onClick={() => navigate("/tasks")} className="text-[11px] text-primary hover:underline">See all</button>
            </div>
            <form
              onSubmit={(e) => { e.preventDefault(); if (newTask.trim()) addTask.mutate(newTask.trim()); }}
              className="flex gap-1.5 mb-2"
            >
              <Input
                value={newTask}
                onChange={(e) => setNewTask(e.target.value)}
                placeholder="Quick task — press Enter"
                className="h-8 text-sm"
                data-testid="dashboard-quick-task"
              />
              <Button size="sm" type="submit" variant="outline" className="h-8 px-2.5" disabled={!newTask.trim() || addTask.isPending}>
                <Plus className="w-3.5 h-3.5" />
              </Button>
            </form>
            <div className="space-y-1">
              {totalOpen === 0 ? (
                <div className="text-xs text-muted-foreground italic py-2">Inbox zero. Nice. 🌴</div>
              ) : visibleTasks.map(t => {
                const due = t.due_date ? new Date(t.due_date) : null;
                const isOverdue = due && due < today;
                const isToday = due && due.toDateString() === new Date().toDateString();
                return (
                  <div key={t.id} className="flex items-center gap-2 p-1.5 rounded-md hover:bg-muted/40 group">
                    <button
                      onClick={() => completeTask.mutate(t.id)}
                      className="w-4 h-4 rounded border border-muted-foreground/40 hover:border-primary hover:bg-primary/10 flex items-center justify-center shrink-0 transition-colors"
                      data-testid={`task-complete-${t.id}`}
                    >
                      <Check className="w-3 h-3 text-primary opacity-0 group-hover:opacity-100" />
                    </button>
                    <button
                      onClick={() => t.linked_deal_id ? navigate(`/deals/${t.linked_deal_id}`) : navigate("/tasks")}
                      className="flex-1 min-w-0 text-left"
                    >
                      <div className="text-sm truncate">{t.title}</div>
                      {(t.deal_name || t.due_date) && (
                        <div className="text-[10px] text-muted-foreground flex items-center gap-1.5">
                          {t.deal_name && <span className="truncate">{t.deal_name}</span>}
                          {t.due_date && (
                            <span className={isOverdue ? "text-red-500 font-medium" : isToday ? "text-amber-600 font-medium" : ""}>
                              {isOverdue ? "Overdue" : isToday ? "Today" : new Date(t.due_date).toLocaleDateString("en-GB", { weekday: "short", day: "numeric" })}
                            </span>
                          )}
                        </div>
                      )}
                    </button>
                    {t.priority === "urgent" && <Flame className="w-3 h-3 text-red-500 shrink-0" />}
                    {t.priority === "high" && <Star className="w-3 h-3 text-amber-500 shrink-0" />}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Quick stats strip */}
          <div className="grid grid-cols-3 gap-2 text-center pt-1">
            <button onClick={() => navigate("/hr")} className="rounded-md border p-2 hover:bg-accent/40 transition-colors">
              <div className="text-lg font-semibold">{commission ? fmtMoney(commission.wipTotal) : "—"}</div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Pipeline</div>
            </button>
            <button onClick={() => navigate("/tasks")} className="rounded-md border p-2 hover:bg-accent/40 transition-colors">
              <div className="text-lg font-semibold">{tasks.length}</div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Open tasks</div>
            </button>
            <button onClick={() => navigate("/hr")} className="rounded-md border p-2 hover:bg-accent/40 transition-colors">
              <div className="text-lg font-semibold">{commission ? fmtMoney(commission.commissionForecast) : "—"}</div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Comm. forecast</div>
            </button>
          </div>

          {/* Direct shortcut to the user's own profile tabs */}
          <div className="grid grid-cols-2 gap-2 pt-1">
            <button onClick={() => navigate(`/hr?person=${user.id}&tab=expenses`)} className="rounded-md border p-2 text-xs flex items-center gap-1.5 justify-center hover:bg-accent/40 transition-colors">
              <CreditCard className="w-3.5 h-3.5 text-muted-foreground" /> My card &amp; expenses
            </button>
            <button onClick={() => navigate(`/hr?person=${user.id}&tab=files`)} className="rounded-md border p-2 text-xs flex items-center gap-1.5 justify-center hover:bg-accent/40 transition-colors">
              <FileText className="w-3.5 h-3.5 text-muted-foreground" /> My documents
            </button>
          </div>
        </CardContent>
      )}
    </Card>
  );
}

// ── 🏛️ Organigram team cards ────────────────────────────────────────────────

interface TeamAiSummary { team: string; summary: string; generated_at: string }

// Member-first team card. No per-team billing/pipeline/top-deals — those live
// on the firm-wide ski target hero. Each card shows the team head pinned at
// the top with their direct reports listed underneath, organigram-style,
// plus a one-line AI summary of what they've been up to lately.
function TeamCard({ team, allStaff, aiSummary, oooByUser, onSelectPerson }: { team: TeamSummary; allStaff: StaffMember[]; aiSummary?: string; oooByUser?: Map<string, { subject: string; isAllDay: boolean }>; onSelectPerson?: (id: string) => void }) {
  const [, navigate] = useLocation();
  const style = teamStyle(team.team);
  const members = useMemo(() => allStaff.filter(s => team.memberIds.includes(s.id)), [allStaff, team.memberIds]);
  const head = team.head;
  const others = members.filter(m => m.id !== head?.id);

  const MemberRow = ({ m, isHead }: { m: StaffMember | TeamSummary["head"]; isHead?: boolean }) => {
    if (!m) return null;
    const profilePic = (m as any).profile_pic_url ?? (m as any).profilePicUrl ?? null;
    const ooo = oooByUser?.get(m.id);
    return (
      <button
        onClick={() => onSelectPerson ? onSelectPerson(m.id) : navigate(`/hr?person=${m.id}`)}
        className={`w-full flex items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-white/70 dark:hover:bg-white/5 ${isHead ? "bg-white/60 dark:bg-white/10" : ""} ${ooo ? "opacity-70" : ""}`}
        title={ooo ? `OOO: ${ooo.subject}` : undefined}
      >
        <div className="relative shrink-0">
          {profilePic ? (
            <img src={profilePic} alt={m.name} className={`rounded-full object-cover ${isHead ? "w-9 h-9 ring-2 ring-white dark:ring-black/20" : "w-7 h-7"}`} />
          ) : (
            <div className={`rounded-full bg-white/80 dark:bg-white/10 flex items-center justify-center font-medium ${isHead ? "w-9 h-9 text-xs ring-2 ring-white dark:ring-black/20" : "w-7 h-7 text-[10px]"}`}>
              {m.name.split(" ").map(p => p[0]).join("").slice(0, 2).toUpperCase()}
            </div>
          )}
          {ooo && (
            <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-orange-500 border-2 border-white dark:border-black/20" title={ooo.subject} />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className={`truncate ${isHead ? "text-sm font-semibold" : "text-xs font-medium"}`}>{m.name}</div>
          {m.title && <div className="text-[10px] text-muted-foreground truncate">{m.title}</div>}
        </div>
        {ooo && <Badge variant="outline" className="text-[9px] h-4 px-1 bg-orange-100 dark:bg-orange-950/40 text-orange-700 dark:text-orange-300 border-orange-300 shrink-0">OOO</Badge>}
        {isHead && !ooo && <Badge variant="outline" className="text-[9px] h-4 px-1 bg-white/70 dark:bg-white/10 border-white/40 shrink-0">Head</Badge>}
      </button>
    );
  };

  return (
    <div className={`rounded-xl border ${style.border} bg-gradient-to-br ${style.bg} shadow-sm hover:shadow-md transition-shadow overflow-hidden`} data-testid={`team-card-${team.team.replace(/\s+/g, "-").toLowerCase()}`}>
      <div className="px-3 py-2 flex items-center justify-between border-b border-white/40 dark:border-black/20">
        <h3 className={`font-semibold text-sm ${style.accent}`}>{team.team}</h3>
        <Badge variant="outline" className="text-[10px] h-5 bg-white/60 dark:bg-white/10 border-white/40">{team.headcount}</Badge>
      </div>
      {aiSummary && (
        <div className="px-3 py-1.5 text-[11px] text-muted-foreground italic flex items-start gap-1.5 bg-white/30 dark:bg-black/5 border-b border-white/40 dark:border-black/20">
          <Sparkles className="w-3 h-3 text-violet-500 shrink-0 mt-0.5" />
          <span>{aiSummary}</span>
        </div>
      )}
      <div className="p-2 space-y-1">
        {head && <MemberRow m={head} isHead />}
        {others.length > 0 && (
          <div className="space-y-0.5 pl-2 border-l border-white/40 dark:border-black/20 ml-3 mt-1">
            {others.map(m => <MemberRow key={m.id} m={m} />)}
          </div>
        )}
      </div>
    </div>
  );
}

function OrganigramSection({ allStaff, isAdmin, onSelectPerson }: { allStaff: StaffMember[]; isAdmin: boolean; onSelectPerson?: (id: string) => void }) {
  const { toast } = useToast();
  const { data, isLoading } = useQuery<{ teams: TeamSummary[] }>({ queryKey: ["/api/hr/team-summary"] });
  const { data: aiSummaries = [] } = useQuery<TeamAiSummary[]>({ queryKey: ["/api/hr/team-ai-summaries"] });
  const { data: oooData } = useQuery<{ events: Array<{ userId: string; subject: string; isAllDay: boolean }> }>({ queryKey: ["/api/hr/calendar/now"] });

  const refreshAi = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/hr/team-ai-summaries/refresh").then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/hr/team-ai-summaries"] });
      toast({ title: "Team summaries refreshed" });
    },
  });

  const aiByTeam = useMemo(() => new Map(aiSummaries.map(s => [s.team, s.summary])), [aiSummaries]);
  const oooByUser = useMemo(() => {
    const m = new Map<string, { subject: string; isAllDay: boolean }>();
    for (const e of oooData?.events || []) {
      if (!m.has(e.userId)) m.set(e.userId, { subject: e.subject, isAllDay: e.isAllDay });
    }
    return m;
  }, [oooData]);

  if (isLoading) return <Skeleton className="h-64 w-full rounded-xl" />;
  if (!data?.teams?.length) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2"><GitBranch className="w-4 h-4 text-primary" /> Teams</span>
          <div className="flex items-center gap-2">
            {isAdmin && (
              <Button size="sm" variant="ghost" className="h-6 text-[10px] px-1.5" onClick={() => refreshAi.mutate()} disabled={refreshAi.isPending}>
                {refreshAi.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3 mr-1" />}
                Refresh AI
              </Button>
            )}
            <span className="text-[11px] font-normal text-muted-foreground">click anyone to open their profile</span>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {data.teams.map(t => <TeamCard key={t.team} team={t} allStaff={allStaff} aiSummary={aiByTeam.get(t.team)} oooByUser={oooByUser} onSelectPerson={onSelectPerson} />)}
        </div>
      </CardContent>
    </Card>
  );
}

// ── 🏅 Brucey Bonuses — AI-awarded points + weekly winner ────────────────────

interface BruceyLeader {
  userId: string;
  name: string;
  title: string | null;
  profilePicUrl: string | null;
  weekPoints: number;
  weekEvents: number;
  ytdPoints: number;
}

interface BruceyLeaderboard {
  weekStart: string;
  leaderboard: BruceyLeader[];
  winnerUserId: string | null;
}

function BruceyBonusesCard({ isAdmin, onSelectPerson }: { isAdmin: boolean; onSelectPerson?: (id: string) => void }) {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const { data, isLoading } = useQuery<BruceyLeaderboard>({ queryKey: ["/api/hr/brucey-points/leaderboard"] });

  const scan = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/hr/brucey-points/scan").then(r => r.json()),
    onSuccess: (d: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/hr/brucey-points/leaderboard"] });
      toast({ title: `Scanned ${d.scannedEvents || 0} events · ${d.newAwards || 0} new Brucey Bonuses` });
    },
    onError: (e: any) => toast({ title: "Scan failed", description: e?.message, variant: "destructive" }),
  });

  const leaders = data?.leaderboard || [];
  const winner = leaders[0];
  const medals = ["🥇", "🥈", "🥉"];

  return (
    <Card className="overflow-hidden border-amber-200 dark:border-amber-900/50">
      <div className="bg-gradient-to-br from-amber-50 via-yellow-50 to-orange-50 dark:from-amber-950/40 dark:via-yellow-950/40 dark:to-orange-950/40 px-3 py-2 border-b border-amber-200/50 dark:border-amber-900/50 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-base">🏅</span>
          <span className="text-sm font-bold tracking-tight">Brucey Bonuses</span>
        </div>
        {isAdmin && (
          <Button size="sm" variant="ghost" className="h-6 text-[10px] px-1.5" onClick={() => scan.mutate()} disabled={scan.isPending}>
            {scan.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3 mr-0.5" />}
            Scan
          </Button>
        )}
      </div>
      <CardContent className="pt-3 pb-3">
        {isLoading ? (
          <div className="space-y-1.5">{[0, 1, 2].map(i => <Skeleton key={i} className="h-10 w-full rounded-md" />)}</div>
        ) : leaders.length === 0 ? (
          <div className="text-xs text-muted-foreground italic text-center py-3">
            No Brucey Bonuses awarded yet this week.{isAdmin ? " Click Scan to let AI find them." : ""}
          </div>
        ) : (
          <>
            {/* Winner banner */}
            {winner && (
              <button
                onClick={() => onSelectPerson ? onSelectPerson(winner.userId) : navigate(`/hr?person=${winner.userId}`)}
                className="w-full mb-2 rounded-lg bg-gradient-to-br from-amber-100 to-yellow-100 dark:from-amber-950/60 dark:to-yellow-950/60 border border-amber-300 dark:border-amber-700 p-2.5 flex items-center gap-2.5 hover:shadow-sm transition-shadow text-left"
              >
                <span className="text-xl">🥇</span>
                {winner.profilePicUrl ? (
                  <img src={winner.profilePicUrl} alt={winner.name} className="w-9 h-9 rounded-full object-cover ring-2 ring-amber-400" />
                ) : (
                  <div className="w-9 h-9 rounded-full bg-amber-200 dark:bg-amber-900/40 flex items-center justify-center text-xs font-bold ring-2 ring-amber-400">
                    {winner.name.split(" ").map(p => p[0]).join("").slice(0, 2).toUpperCase()}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-[9px] uppercase tracking-wider text-amber-800 dark:text-amber-300 font-semibold">This week's leader</div>
                  <div className="text-sm font-bold truncate">{winner.name}</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-base font-bold tabular-nums text-amber-700 dark:text-amber-300">{winner.weekPoints}</div>
                  <div className="text-[9px] uppercase tracking-wider text-amber-700/70">pts</div>
                </div>
              </button>
            )}

            {/* Rest of leaderboard */}
            <div className="space-y-1">
              {leaders.slice(1, 5).map((l, i) => (
                <button
                  key={l.userId}
                  onClick={() => onSelectPerson ? onSelectPerson(l.userId) : navigate(`/hr?person=${l.userId}`)}
                  className="w-full flex items-center gap-2 p-1.5 rounded-md hover:bg-amber-50/50 dark:hover:bg-amber-950/20 transition-colors text-left"
                >
                  <span className="w-5 text-center text-[11px] text-muted-foreground shrink-0">{medals[i + 1] || `#${i + 2}`}</span>
                  {l.profilePicUrl ? (
                    <img src={l.profilePicUrl} alt={l.name} className="w-6 h-6 rounded-full object-cover" />
                  ) : (
                    <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center text-[9px] font-medium">
                      {l.name.split(" ").map(p => p[0]).join("").slice(0, 2).toUpperCase()}
                    </div>
                  )}
                  <span className="flex-1 truncate text-xs">{l.name}</span>
                  <span className="text-xs font-semibold tabular-nums">{l.weekPoints}</span>
                </button>
              ))}
            </div>

            <div className="mt-2 pt-2 border-t border-amber-200/50 dark:border-amber-900/50 text-[10px] text-muted-foreground italic text-center">
              Earn points for closing deals, kudos, completing tasks, submitting reviews. Weekly winner gets a prize.
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ── 🏆 Hunger Games strip ────────────────────────────────────────────────────

interface IndividualLeader {
  userId: string;
  name: string;
  team: string | null;
  title: string | null;
  profilePicUrl: string | null;
  billedPence: number;
  pipelinePence: number;
  activeDeals: number;
  closedThisWeekPence: number;
  kudosThisWeek: number;
}

interface LeaderboardData {
  topBiller: IndividualLeader[];
  topPipeline: IndividualLeader[];
  topActive: IndividualLeader[];
  topClosedThisWeek: IndividualLeader[];
  topKudos: IndividualLeader[];
}

function HungerGamesStrip({ allStaff: _allStaff, onSelectPerson }: { allStaff: StaffMember[]; onSelectPerson?: (id: string) => void }) {
  const [, navigate] = useLocation();
  const { data: teamData } = useQuery<{ teams: TeamSummary[] }>({ queryKey: ["/api/hr/team-summary"] });
  const { data: indiv } = useQuery<LeaderboardData>({ queryKey: ["/api/dashboard/individual-leaderboard"] });
  const [tab, setTab] = useState<"teams" | "billers" | "pipeline" | "active" | "kudos">("billers");

  const teamPodium = useMemo(() => {
    if (!teamData?.teams) return [];
    return [...teamData.teams].sort((a, b) => b.pipelinePence - a.pipelinePence).slice(0, 3);
  }, [teamData]);
  const medals = ["🥇", "🥈", "🥉"];

  const tabs: Array<{ id: typeof tab; label: string; icon: any }> = [
    { id: "billers",  label: "Top biller",     icon: Target },
    { id: "pipeline", label: "Top pipeline",   icon: TrendingUp },
    { id: "active",   label: "Most active",    icon: Flame },
    { id: "kudos",    label: "Most kudos",     icon: Star },
    { id: "teams",    label: "Top team",       icon: Trophy },
  ];

  const list: IndividualLeader[] = (() => {
    if (!indiv) return [];
    if (tab === "billers")  return indiv.topBiller;
    if (tab === "pipeline") return indiv.topPipeline;
    if (tab === "active")   return indiv.topActive;
    if (tab === "kudos")    return indiv.topKudos;
    return [];
  })().slice(0, 5);

  const valueOf = (l: IndividualLeader) => {
    if (tab === "billers")  return fmtMoney(l.billedPence);
    if (tab === "pipeline") return fmtMoney(l.pipelinePence);
    if (tab === "active")   return `${l.activeDeals} deals`;
    if (tab === "kudos")    return `${l.kudosThisWeek} 👏`;
    return "";
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center justify-between gap-2 flex-wrap">
          <span className="flex items-center gap-2"><Trophy className="w-4 h-4 text-amber-500" /> Hunger Games</span>
          <div className="inline-flex rounded-md border bg-muted/30 p-0.5 text-[11px]">
            {tabs.map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-1 rounded px-2 py-1 font-medium transition-colors ${tab === t.id ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                <t.icon className="w-3 h-3" /> {t.label}
              </button>
            ))}
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {tab === "teams" ? (
          teamPodium.length === 0 ? (
            <div className="text-xs text-muted-foreground italic text-center py-4">No team data yet.</div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {teamPodium.map((t, i) => {
                const style = teamStyle(t.team);
                return (
                  <div key={t.team} className={`rounded-lg border ${style.border} bg-gradient-to-br ${style.bg} p-3 relative`}>
                    <div className="absolute top-2 right-2 text-2xl">{medals[i]}</div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">{i === 0 ? "Leader" : i === 1 ? "Runner-up" : "Third"}</div>
                    <div className={`font-semibold text-sm ${style.accent}`}>{t.team}</div>
                    <div className="text-lg font-bold tabular-nums mt-0.5">{fmtMoney(t.pipelinePence)}</div>
                    <div className="text-[10px] text-muted-foreground">{t.headcount} {t.headcount === 1 ? "person" : "people"}</div>
                  </div>
                );
              })}
            </div>
          )
        ) : list.length === 0 ? (
          <div className="text-xs text-muted-foreground italic text-center py-4">Nothing to show on the {tabs.find(t => t.id === tab)?.label.toLowerCase()} board yet.</div>
        ) : (
          <div className="space-y-1.5">
            {list.map((l, i) => (
              <button
                key={l.userId}
                onClick={() => onSelectPerson ? onSelectPerson(l.userId) : navigate(`/hr?person=${l.userId}`)}
                className={`w-full flex items-center gap-3 p-2 rounded-lg border text-left transition-colors hover:bg-accent/40 ${i === 0 ? "bg-amber-50/50 border-amber-200 dark:bg-amber-950/20 dark:border-amber-800" : ""}`}
                data-testid={`leaderboard-${tab}-${i}`}
              >
                <div className="w-7 text-center text-lg shrink-0">{medals[i] || `#${i + 1}`}</div>
                {l.profilePicUrl ? (
                  <img src={l.profilePicUrl} alt={l.name} className="w-9 h-9 rounded-full object-cover shrink-0" />
                ) : (
                  <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center text-xs font-medium shrink-0">
                    {l.name.split(" ").map(p => p[0]).join("").slice(0, 2).toUpperCase()}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold truncate">{l.name}</div>
                  <div className="text-[10px] text-muted-foreground truncate">{l.title || l.team || ""}</div>
                </div>
                <div className="text-base font-bold tabular-nums shrink-0">{valueOf(l)}</div>
              </button>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── 🎁 Watch House board ─────────────────────────────────────────────────────

interface Award {
  id: string;
  user_id: string;
  user_name: string;
  user_pic: string | null;
  issued_by_name: string | null;
  kind: string;
  emoji: string | null;
  reason: string | null;
  created_at: string;
}

const AWARD_KINDS: Array<{ kind: string; emoji: string; label: string; adminOnly: boolean }> = [
  { kind: "coffee",  emoji: "☕", label: "Coffee on Woody",       adminOnly: true },
  { kind: "beer",    emoji: "🍺", label: "Beer Friday",            adminOnly: true },
  { kind: "lunch",   emoji: "🍱", label: "Lunch on the firm",      adminOnly: true },
  { kind: "cake",    emoji: "🍰", label: "Cake from Watch House",  adminOnly: true },
  { kind: "star",    emoji: "⭐", label: "Above & beyond",         adminOnly: true },
  { kind: "fire",    emoji: "🔥", label: "On fire",                adminOnly: true },
  { kind: "kudos",   emoji: "👏", label: "Peer kudos",             adminOnly: false },
];

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d === 1) return "yesterday";
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function IssueAwardDialog({ open, onClose, isAdmin, allStaff }: { open: boolean; onClose: () => void; isAdmin: boolean; allStaff: StaffMember[] }) {
  const [userId, setUserId] = useState("");
  const [kind, setKind] = useState(isAdmin ? "coffee" : "kudos");
  const [reason, setReason] = useState("");
  const kindsAvailable = AWARD_KINDS.filter(k => isAdmin || !k.adminOnly);
  const selected = AWARD_KINDS.find(k => k.kind === kind);

  const issue = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("POST", "/api/hr/awards", {
        userId,
        kind,
        emoji: selected?.emoji,
        reason: reason.trim() || null,
      });
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/hr/awards"] });
      setUserId(""); setReason("");
      onClose();
    },
  });

  // Lazy import the Dialog primitives we need to avoid ballooning imports.
  // (Already imported globally in shadcn's Dialog component.)
  return (
    <div className={`fixed inset-0 z-50 ${open ? "" : "pointer-events-none opacity-0"} transition-opacity`}>
      <div className={`absolute inset-0 bg-black/40 ${open ? "opacity-100" : "opacity-0"} transition-opacity`} onClick={onClose} />
      <div className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[90vw] max-w-md rounded-xl border bg-background shadow-xl p-5 ${open ? "scale-100" : "scale-95"} transition-transform`}>
        <div className="flex items-center gap-2 mb-3">
          <Coffee className="w-4 h-4 text-amber-700" />
          <h3 className="text-sm font-semibold">{isAdmin ? "Issue an award" : "Send peer kudos"}</h3>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Recipient</label>
            <select value={userId} onChange={e => setUserId(e.target.value)} className="w-full h-8 rounded-md border bg-background px-2 text-sm">
              <option value="">Choose someone…</option>
              {allStaff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Award</label>
            <div className="grid grid-cols-2 gap-1.5">
              {kindsAvailable.map(k => (
                <button
                  key={k.kind}
                  type="button"
                  onClick={() => setKind(k.kind)}
                  className={`flex items-center gap-1.5 rounded-md border p-2 text-xs ${kind === k.kind ? "border-primary bg-primary/10" : "hover:bg-muted/50"}`}
                >
                  <span className="text-base">{k.emoji}</span>
                  <span className="truncate">{k.label}</span>
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">For… (optional)</label>
            <Input value={reason} onChange={e => setReason(e.target.value)} placeholder="What did they do? e.g. 'Closed Sushidog Bullring'" className="h-8 text-sm" />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={() => issue.mutate()} disabled={!userId || issue.isPending}>
            {issue.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : null}
            {isAdmin ? "Issue" : "Send kudos"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function WatchHouseBoard({ isAdmin, allStaff, onSelectPerson }: { isAdmin: boolean; allStaff: StaffMember[]; onSelectPerson?: (id: string) => void }) {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [issueOpen, setIssueOpen] = useState(false);
  const { data: awards = [], isLoading } = useQuery<Award[]>({ queryKey: ["/api/hr/awards"] });

  const autoDetect = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/hr/awards/auto-detect").then(r => r.json()),
    onSuccess: (d: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/hr/awards"] });
      const n = d.created?.length || 0;
      toast({ title: n > 0 ? `${n} auto-award${n === 1 ? "" : "s"} added` : "Nothing to auto-award today" });
    },
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2"><Coffee className="w-4 h-4 text-amber-700" /> Watch House board</span>
          <div className="flex gap-1">
            {isAdmin && (
              <Button size="sm" variant="ghost" className="h-7 text-[11px] text-muted-foreground" onClick={() => autoDetect.mutate()} disabled={autoDetect.isPending}>
                {autoDetect.isPending ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Sparkles className="w-3 h-3 mr-1" />} Auto-detect
              </Button>
            )}
            <Button size="sm" variant="ghost" className="h-7 text-[11px]" onClick={() => setIssueOpen(true)} data-testid="award-issue">
              <Plus className="w-3 h-3 mr-1" /> {isAdmin ? "Issue award" : "Send kudos"}
            </Button>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {isLoading ? (
          <div className="space-y-1.5">{[0,1,2].map(i => <Skeleton key={i} className="h-12 w-full rounded-md" />)}</div>
        ) : awards.length === 0 ? (
          <div className="text-center py-6 text-xs text-muted-foreground italic">
            No awards yet. {isAdmin ? "Click 'Issue award' to recognise someone." : "Click 'Send kudos' to recognise a colleague."}
          </div>
        ) : (
          <div className="space-y-1.5">
            {awards.slice(0, 6).map(a => (
              <button
                key={a.id}
                onClick={() => onSelectPerson ? onSelectPerson(a.user_id) : navigate(`/hr?person=${a.user_id}`)}
                className="w-full flex items-center gap-2.5 p-2 rounded-md border bg-card hover:bg-accent/40 transition-colors text-left"
              >
                <span className="text-xl shrink-0">{a.emoji || "⭐"}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{a.user_name}</div>
                  <div className="text-[11px] text-muted-foreground truncate">
                    {a.reason || AWARD_KINDS.find(k => k.kind === a.kind)?.label || a.kind}
                    {a.issued_by_name && <span className="opacity-60"> · from {a.issued_by_name}</span>}
                  </div>
                </div>
                <span className="text-[10px] text-muted-foreground shrink-0">{relativeTime(a.created_at)}</span>
              </button>
            ))}
          </div>
        )}
        <div className="mt-3 text-[10px] text-muted-foreground italic text-center">
          {isAdmin ? "Coffee · beer · lunch · cake · above & beyond" : "Peer shout-outs welcome 👏"}
        </div>
      </CardContent>
      <IssueAwardDialog open={issueOpen} onClose={() => setIssueOpen(false)} isAdmin={isAdmin} allStaff={allStaff} />
    </Card>
  );
}

// ── 📅 Calendar widget ───────────────────────────────────────────────────────

function CalendarWidget() {
  const { data: birthdays = [] } = useQuery<Birthday[]>({ queryKey: ["/api/hr/birthdays"] });
  const { data: oooData } = useQuery<{ events: Array<{ userId: string; userName: string; subject: string; start: string; end: string; isAllDay: boolean; showAs: string }>; note?: string }>({ queryKey: ["/api/hr/calendar/now"] });
  const { data: marketing = [] } = useQuery<Array<{ id: string; title: string; starts_at: string | null; kind: string | null }>>({ queryKey: ["/api/marketing/events", "upcoming"], queryFn: () => apiRequest("GET", "/api/marketing/events?upcoming=1").then(r => r.json()) });

  const oooThisWeek = (oooData?.events || []).slice(0, 6);
  const upcomingMarketing = marketing
    .filter(m => m.starts_at && new Date(m.starts_at) >= new Date())
    .slice(0, 4);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Calendar className="w-4 h-4 text-primary" /> What's on
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 space-y-3">
        {birthdays.length > 0 && (
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5 flex items-center gap-1"><Cake className="w-3 h-3 text-pink-500" /> Birthdays</div>
            <div className="space-y-1">
              {birthdays.slice(0, 4).map(b => (
                <div key={b.id} className="flex items-center gap-2 text-xs">
                  {b.profilePicUrl ? (
                    <img src={b.profilePicUrl} alt={b.name} className="w-6 h-6 rounded-full object-cover" />
                  ) : (
                    <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center text-[9px] font-medium">
                      {b.name.split(" ").map(p => p[0]).join("").slice(0, 2).toUpperCase()}
                    </div>
                  )}
                  <span className="flex-1 truncate">{b.name}</span>
                  <Badge variant={b.daysUntil === 0 ? "default" : "outline"} className="text-[9px] h-4 px-1.5">
                    {b.daysUntil === 0 ? "Today" : b.daysUntil === 1 ? "Tomorrow" : `${b.daysUntil}d`}
                  </Badge>
                </div>
              ))}
            </div>
          </div>
        )}

        {oooThisWeek.length > 0 && (
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5 flex items-center gap-1"><Clock className="w-3 h-3 text-orange-500" /> Out of office (next 7d)</div>
            <div className="space-y-1">
              {oooThisWeek.map((e, i) => (
                <div key={i} className="flex items-center gap-2 text-xs">
                  <span className="w-1.5 h-1.5 rounded-full bg-orange-500 shrink-0" />
                  <span className="flex-1 truncate">{e.userName}</span>
                  <span className="text-[10px] text-muted-foreground shrink-0">{new Date(e.start).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {upcomingMarketing.length > 0 && (
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5 flex items-center gap-1"><Megaphone className="w-3 h-3 text-violet-500" /> Marketing &amp; events</div>
            <div className="space-y-1">
              {upcomingMarketing.map(m => (
                <div key={m.id} className="flex items-center gap-2 text-xs">
                  <span className="w-1.5 h-1.5 rounded-full bg-violet-500 shrink-0" />
                  <span className="flex-1 truncate">{m.title}</span>
                  <span className="text-[10px] text-muted-foreground shrink-0">{m.starts_at ? new Date(m.starts_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : ""}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {birthdays.length === 0 && oooThisWeek.length === 0 && upcomingMarketing.length === 0 && (
          <div className="text-xs text-muted-foreground italic text-center py-2">Quiet week ahead.</div>
        )}

        {oooData?.note && (
          <div className="text-[10px] text-muted-foreground italic border-t pt-2">{oooData.note}</div>
        )}
      </CardContent>
    </Card>
  );
}

// ── 🚀 People & HR overview — embedded in /hr as a tab ─────────────────────

export default function HrOverview({ onSelectPerson }: { onSelectPerson?: (id: string) => void } = {}) {
  const { data: currentUser, isLoading: userLoading } = useQuery<AuthUser | null>({
    queryKey: ["/api/auth/me"],
    queryFn: getQueryFn({ on401: "returnNull" }),
  });
  const { data: allStaff = [] } = useQuery<StaffMember[]>({ queryKey: ["/api/hr/staff"] });

  if (userLoading) {
    return (
      <div className="space-y-4 pb-6">
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  const isAdmin = !!currentUser?.isAdmin;

  return (
    <div className="space-y-4 pb-6">
      <SkiTargetHero />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-1 space-y-4">
          {currentUser && <YouPanel user={currentUser} />}
          <BruceyBonusesCard isAdmin={isAdmin} onSelectPerson={onSelectPerson} />
          <HungerGamesStrip allStaff={allStaff} onSelectPerson={onSelectPerson} />
          <WatchHouseBoard isAdmin={isAdmin} allStaff={allStaff} onSelectPerson={onSelectPerson} />
        </div>
        <div className="lg:col-span-2 space-y-4">
          <OrganigramSection allStaff={allStaff} isAdmin={isAdmin} onSelectPerson={onSelectPerson} />
          <CalendarWidget />
        </div>
      </div>
    </div>
  );
}
