import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  Trophy, Mountain, TrendingUp, Users, Calendar, Cake, Sparkles,
  Coffee, Beer, Pizza, Star, Flame, Target, ChevronRight, ChevronDown,
  Loader2, Plus, Check, Briefcase, BarChart3, GitBranch, Eye,
  Megaphone, Heart, ArrowRight, Clock,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { apiRequest, queryClient, getQueryFn } from "@/lib/queryClient";
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
  "London Leasing":     { bg: "from-yellow-50 to-yellow-100/50 dark:from-yellow-950/40 dark:to-yellow-900/20", border: "border-yellow-200 dark:border-yellow-800", accent: "text-yellow-700 dark:text-yellow-300", ring: "ring-yellow-500/30" },
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

  const todayTasks = tasks.filter(t => t.due_date && new Date(t.due_date) <= today);
  const weekTasks = tasks.filter(t => t.due_date && new Date(t.due_date) > today && new Date(t.due_date) <= endOfWeek);
  const visibleTasks = [...todayTasks, ...weekTasks].slice(0, 6);

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
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Today &amp; this week</span>
              <button onClick={() => navigate("/my-tasks")} className="text-[11px] text-primary hover:underline">See all</button>
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
              {visibleTasks.length === 0 ? (
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
                      onClick={() => t.linked_deal_id ? navigate(`/deals/${t.linked_deal_id}`) : navigate("/my-tasks")}
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
            <button onClick={() => navigate("/my-tasks")} className="rounded-md border p-2 hover:bg-accent/40 transition-colors">
              <div className="text-lg font-semibold">{tasks.length}</div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Open tasks</div>
            </button>
            <button onClick={() => navigate("/hr")} className="rounded-md border p-2 hover:bg-accent/40 transition-colors">
              <div className="text-lg font-semibold">{commission ? fmtMoney(commission.commissionForecast) : "—"}</div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Comm. forecast</div>
            </button>
          </div>
        </CardContent>
      )}
    </Card>
  );
}

// ── 🏛️ Organigram team cards ────────────────────────────────────────────────

function TeamCard({ team, allStaff, expanded, onToggle }: { team: TeamSummary; allStaff: StaffMember[]; expanded: boolean; onToggle: () => void }) {
  const [, navigate] = useLocation();
  const style = teamStyle(team.team);
  const members = useMemo(() => allStaff.filter(s => team.memberIds.includes(s.id)), [allStaff, team.memberIds]);

  const stageBadge = (s: string) => ({ NEG: "bg-amber-500", SOL: "bg-amber-500", EXC: "bg-blue-500", COM: "bg-emerald-500" }[s] || "bg-muted-foreground/30");

  return (
    <div className={`rounded-xl border ${style.border} bg-gradient-to-br ${style.bg} transition-all ${expanded ? "shadow-md" : "shadow-sm hover:shadow-md"}`}>
      <button
        onClick={onToggle}
        className="w-full text-left p-4"
        data-testid={`team-card-${team.team.replace(/\s+/g, "-").toLowerCase()}`}
      >
        <div className="flex items-start gap-3">
          {team.head?.profilePicUrl ? (
            <img src={team.head.profilePicUrl} alt={team.head.name} className="w-12 h-12 rounded-full object-cover border-2 border-white dark:border-black/20 shadow-sm shrink-0" />
          ) : (
            <div className="w-12 h-12 rounded-full bg-white/70 dark:bg-white/10 flex items-center justify-center font-semibold text-sm shrink-0 border-2 border-white dark:border-black/20 shadow-sm">
              {team.head?.name?.split(" ").map(p => p[0]).join("").slice(0, 2).toUpperCase() || "—"}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <h3 className={`font-semibold text-sm ${style.accent}`}>{team.team}</h3>
              <Badge variant="outline" className="text-[10px] bg-white/60 dark:bg-white/10 border-white/40">{team.headcount}</Badge>
            </div>
            {team.head && (
              <div className="text-xs text-muted-foreground truncate mt-0.5">
                Led by <span className="font-medium text-foreground">{team.head.name}</span>{team.head.title ? ` · ${team.head.title}` : ""}
              </div>
            )}
            <div className="mt-2 flex items-baseline gap-1.5">
              <span className="text-base font-semibold tabular-nums">{fmtMoney(team.pipelinePence)}</span>
              <span className="text-[11px] text-muted-foreground">pipeline</span>
            </div>
            {team.topDeals.length > 0 && (
              <div className="mt-2 space-y-0.5">
                {team.topDeals.map(d => (
                  <div key={d.id} className="flex items-center gap-1.5 text-[11px]">
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${stageBadge(d.status)}`} />
                    <span className="truncate flex-1 text-muted-foreground">{d.name}</span>
                    <span className="font-medium tabular-nums shrink-0">{fmtMoney(d.fee)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform shrink-0 mt-1 ${expanded ? "rotate-180" : ""}`} />
        </div>
      </button>
      {expanded && members.length > 0 && (
        <div className="border-t border-white/40 dark:border-black/20 p-3 bg-white/40 dark:bg-black/10">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {members.map(m => (
              <button
                key={m.id}
                onClick={(e) => { e.stopPropagation(); navigate(`/hr?person=${m.id}`); }}
                className="flex items-center gap-2 p-1.5 rounded-md hover:bg-white/60 dark:hover:bg-white/5 transition-colors text-left"
              >
                {m.profile_pic_url ? (
                  <img src={m.profile_pic_url} alt={m.name} className="w-7 h-7 rounded-full object-cover shrink-0" />
                ) : (
                  <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center text-[10px] font-medium shrink-0">
                    {m.name.split(" ").map(p => p[0]).join("").slice(0, 2).toUpperCase()}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium truncate">{m.name}</div>
                  {m.title && <div className="text-[10px] text-muted-foreground truncate">{m.title}</div>}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function OrganigramSection({ allStaff }: { allStaff: StaffMember[] }) {
  const { data, isLoading } = useQuery<{ teams: TeamSummary[] }>({ queryKey: ["/api/hr/team-summary"] });
  const [expanded, setExpanded] = useState<string | null>(null);

  if (isLoading) return <Skeleton className="h-64 w-full rounded-xl" />;
  if (!data?.teams?.length) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2"><GitBranch className="w-4 h-4 text-primary" /> Teams</span>
          <span className="text-[11px] font-normal text-muted-foreground">click a team to expand</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {data.teams.map(t => (
            <TeamCard
              key={t.team}
              team={t}
              allStaff={allStaff}
              expanded={expanded === t.team}
              onToggle={() => setExpanded(prev => prev === t.team ? null : t.team)}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ── 🏆 Hunger Games strip ────────────────────────────────────────────────────

function HungerGamesStrip({ allStaff }: { allStaff: StaffMember[] }) {
  const { data: teamData } = useQuery<{ teams: TeamSummary[] }>({ queryKey: ["/api/hr/team-summary"] });

  // For now we surface "top team by pipeline" until per-person metrics ship.
  // Hunter signals, viewings, AML hygiene etc. wire up in a follow-up.
  const podium = useMemo(() => {
    if (!teamData?.teams) return [];
    return [...teamData.teams].sort((a, b) => b.pipelinePence - a.pipelinePence).slice(0, 3);
  }, [teamData]);

  if (podium.length === 0) return null;
  const medals = ["🥇", "🥈", "🥉"];

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Trophy className="w-4 h-4 text-amber-500" /> Hunger Games — top teams this week
          <span className="text-[10px] font-normal text-muted-foreground ml-auto">by pipeline £</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {podium.map((t, i) => {
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
        <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-1.5 text-center">
          {[
            { icon: <Target className="w-3 h-3" />, label: "Top biller", value: "Coming soon" },
            { icon: <Eye className="w-3 h-3" />, label: "Most viewings", value: "Coming soon" },
            { icon: <Megaphone className="w-3 h-3" />, label: "PR star", value: "Coming soon" },
            { icon: <Flame className="w-3 h-3" />, label: "Streak", value: "Coming soon" },
          ].map(m => (
            <div key={m.label} className="rounded-md border border-dashed p-1.5 text-[10px] text-muted-foreground">
              <div className="flex items-center justify-center gap-1 font-medium uppercase tracking-wider">{m.icon} {m.label}</div>
              <div className="mt-0.5 italic opacity-70">{m.value}</div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ── 🎁 Watch House board ─────────────────────────────────────────────────────

function WatchHouseBoard({ isAdmin }: { isAdmin: boolean }) {
  // Awards table doesn't exist yet — skeleton shows the design + admin "issue
  // award" button stub. Wire up `awards` schema next session.
  const placeholder = [
    { who: "Tom Cater", emoji: "☕", reason: "Win on City of London BIDs pitch", when: "Today" },
    { who: "Lucy Gardiner", emoji: "🍰", reason: "Filmworks save with new owner", when: "Yesterday" },
    { who: "Luke Donohoe", emoji: "🎉", reason: "First HoTs on Mecca Bingo Lewisham", when: "2d ago" },
  ];
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2"><Coffee className="w-4 h-4 text-amber-700" /> Watch House board</span>
          {isAdmin && (
            <Button size="sm" variant="ghost" className="h-7 text-[11px]" disabled>
              <Plus className="w-3 h-3 mr-1" /> Issue award
            </Button>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="space-y-1.5">
          {placeholder.map((p, i) => (
            <div key={i} className="flex items-center gap-2.5 p-2 rounded-md border bg-card">
              <span className="text-xl shrink-0">{p.emoji}</span>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{p.who}</div>
                <div className="text-[11px] text-muted-foreground truncate">{p.reason}</div>
              </div>
              <span className="text-[10px] text-muted-foreground shrink-0">{p.when}</span>
            </div>
          ))}
        </div>
        <div className="mt-3 text-[10px] text-muted-foreground italic text-center">
          Coffee · beer · lunch · "above &amp; beyond" — admin-issued. Auto: first deal · birthday · £100k milestone.
        </div>
      </CardContent>
    </Card>
  );
}

// ── 📅 Calendar widget ───────────────────────────────────────────────────────

function CalendarWidget() {
  const { data: birthdays = [] } = useQuery<Birthday[]>({ queryKey: ["/api/hr/birthdays"] });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Calendar className="w-4 h-4 text-primary" /> What's on
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 space-y-2">
        {birthdays.length > 0 && (
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Birthdays</div>
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
        <div className="border-t pt-2 text-[10px] text-muted-foreground italic">
          Firm events, OOO, deal milestones &amp; industry deadlines coming next.
        </div>
      </CardContent>
    </Card>
  );
}

// ── 🚀 Main dashboard ────────────────────────────────────────────────────────

export default function Dashboard() {
  const { data: currentUser, isLoading: userLoading } = useQuery<AuthUser | null>({
    queryKey: ["/api/auth/me"],
    queryFn: getQueryFn({ on401: "returnNull" }),
  });
  const { data: allStaff = [] } = useQuery<StaffMember[]>({ queryKey: ["/api/hr/staff"] });

  if (userLoading) {
    return (
      <div className="p-4 space-y-4">
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  const isAdmin = !!currentUser?.isAdmin;

  return (
    <div className="p-4 space-y-4 max-w-[1400px] mx-auto">
      <SkiTargetHero />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-1 space-y-4">
          {currentUser && <YouPanel user={currentUser} />}
          <CalendarWidget />
        </div>
        <div className="lg:col-span-2 space-y-4">
          <OrganigramSection allStaff={allStaff} />
          <HungerGamesStrip allStaff={allStaff} />
          <WatchHouseBoard isAdmin={isAdmin} />
        </div>
      </div>
    </div>
  );
}
