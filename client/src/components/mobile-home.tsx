import { useQuery, useMutation } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { mobileOverlayItems } from "@/components/app-sidebar";
import {
  Sparkles, BarChart3, FileText, Handshake, Calendar as CalendarIcon,
  AlertTriangle, Info, CheckCircle2, Circle, ChevronRight, Sun, Wallet,
} from "lucide-react";

type Alert = { type: string; severity: "critical" | "warning" | "info"; title: string; detail?: string; entityId?: string; entityType?: string };
type Task = { id: string; title: string; status: string; priority: string; deal_name?: string | null; property_name?: string | null; contact_name?: string | null };
type DealSummary = { id: string; name: string; status: string; property_name?: string | null };
type Commission = { billedPence: number; commissionEarned: number; commissionForecast: number; schemeYear: string; wipByStage?: { neg: number; sol: number; exc: number; com: number } };

// Core boards shown on Home by default. Everything else (admin / WIP tools)
// hides behind "Show all" so the home screen stays focused on daily work.
const CORE_BOARD_URLS = new Set(["/tasks", "/comps", "/brands", "/property-intelligence", "/sharepoint"]);

// Pence → compact £ (e.g. £1.2m, £340k, £980)
function fmtMoney(pence: number | undefined | null): string {
  const p = Math.round((pence || 0) / 100);
  if (p >= 1_000_000) return `£${(p / 1_000_000).toFixed(p >= 10_000_000 ? 0 : 1)}m`;
  if (p >= 1_000) return `£${Math.round(p / 1_000)}k`;
  return `£${p.toLocaleString("en-GB")}`;
}

const QUICK_LINKS = [
  { label: "Deals", icon: BarChart3, to: "/deals", tint: "bg-purple-100 text-purple-700" },
  { label: "Requirements", icon: FileText, to: "/requirements", tint: "bg-blue-100 text-blue-700" },
  { label: "CRM", icon: Handshake, to: "/contacts", tint: "bg-emerald-100 text-emerald-700" },
  { label: "Calendar", icon: CalendarIcon, to: "/calendar", tint: "bg-amber-100 text-amber-700" },
];

const SEV: Record<string, { cls: string; icon: any }> = {
  critical: { cls: "text-red-600 bg-red-50 border-red-200", icon: AlertTriangle },
  warning: { cls: "text-amber-600 bg-amber-50 border-amber-200", icon: AlertTriangle },
  info: { cls: "text-blue-600 bg-blue-50 border-blue-200", icon: Info },
};

function alertHref(a: Alert): string {
  if (a.entityType === "deal" && a.entityId) return `/deals/${a.entityId}`;
  if (a.entityType === "contact" && a.entityId) return `/contacts/${a.entityId}`;
  if (a.entityType === "requirement") return `/requirements`;
  return "/today";
}

export default function MobileHome() {
  const [, navigate] = useLocation();
  const { data: user } = useQuery<any>({ queryKey: ["/api/auth/me"] });
  const { data: alerts = [] } = useQuery<Alert[]>({ queryKey: ["/api/daily-digest"] });
  const { data: tasks = [] } = useQuery<Task[]>({ queryKey: ["/api/tasks"] });
  const { data: commission } = useQuery<Commission>({
    queryKey: [`/api/hr/staff/${user?.id}/commission`],
    queryFn: () => apiRequest("GET", `/api/hr/staff/${user?.id}/commission`).then(r => r.json()),
    enabled: !!user?.id,
  });

  const completeTask = useMutation({
    mutationFn: (id: string) => apiRequest("PATCH", `/api/tasks/${id}`, { status: "done" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/tasks"] }),
  });

  // The bottom-nav "More" drawer is gone — board navigation lives here.
  // Default to the core daily boards; the rest (admin / WIP tools) sit behind
  // "Show all" so Home stays focused. Admins still get their extra tools.
  const visibleBoards = (mobileOverlayItems as any[]).filter(b => (user?.isAdmin || !b.adminOnly) && b.url !== "/mail");
  const boards = visibleBoards.filter(b => CORE_BOARD_URLS.has(b.url));
  const openTasks = (tasks || []).filter(t => t.status !== "done").slice(0, 6);
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const firstName = (user?.name || "").split(" ")[0] || "there";
  const today = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });

  return (
    <div
      className="bg-[#FAF9F7] dark:bg-background min-h-full px-4 pb-2 space-y-4"
      style={{ paddingTop: "calc(0.75rem + env(safe-area-inset-top))" }}
    >
      {/* Greeting */}
      <div className="flex items-center gap-2 pt-1">
        <Sun className="w-5 h-5 text-amber-500" />
        <div>
          <h1 className="text-xl font-bold tracking-tight">{greeting}, {firstName}</h1>
          <p className="text-xs text-muted-foreground">{today}</p>
        </div>
      </div>

      {/* Ask ChatBGP — primary action */}
      <button
        onClick={() => navigate("/chatbgp")}
        className="w-full flex items-center gap-3 rounded-2xl px-4 py-3.5 bg-[#1C1917] text-white shadow-sm active:opacity-90"
        data-testid="mobile-home-ask-chatbgp"
      >
        <Sparkles className="w-5 h-5 shrink-0" />
        <span className="text-base font-semibold">Ask ChatBGP…</span>
        <ChevronRight className="w-4 h-4 ml-auto opacity-70" />
      </button>

      {/* My billing & commission — the number everyone wants to see */}
      {commission && (
        <Link
          href="/deals"
          className="block rounded-2xl bg-[#1C1917] text-white shadow-sm active:opacity-90 px-4 py-3.5"
          data-testid="mobile-home-commission"
        >
          <div className="flex items-center gap-2 mb-2.5">
            <Wallet className="w-4 h-4 opacity-80" />
            <span className="text-xs font-semibold uppercase tracking-wider opacity-80">My billing — {commission.schemeYear}</span>
            <ChevronRight className="w-4 h-4 ml-auto opacity-60" />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <p className="text-lg font-bold tabular-nums leading-tight">{fmtMoney(commission.billedPence)}</p>
              <p className="text-[10px] opacity-70">Billed</p>
            </div>
            <div>
              <p className="text-lg font-bold tabular-nums leading-tight">{fmtMoney(commission.commissionEarned)}</p>
              <p className="text-[10px] opacity-70">Commission</p>
            </div>
            <div>
              <p className="text-lg font-bold tabular-nums leading-tight text-emerald-400">{fmtMoney(commission.commissionForecast)}</p>
              <p className="text-[10px] opacity-70">Potential</p>
            </div>
          </div>
          {commission.wipByStage && (
            <div className="mt-2.5 pt-2.5 border-t border-white/10 grid grid-cols-2 gap-2">
              <div>
                <p className="text-lg font-bold tabular-nums leading-tight">{fmtMoney(commission.wipByStage.neg)}</p>
                <p className="text-[10px] opacity-70">Negotiating</p>
              </div>
              <div>
                <p className="text-lg font-bold tabular-nums leading-tight">{fmtMoney(commission.wipByStage.sol)}</p>
                <p className="text-[10px] opacity-70">Solicitors</p>
              </div>
            </div>
          )}
        </Link>
      )}

      {/* Quick links */}
      <div className="grid grid-cols-4 gap-2">
        {QUICK_LINKS.map(q => (
          <Link key={q.to} href={q.to} className="flex flex-col items-center gap-1.5 py-3 rounded-2xl bg-white dark:bg-card border border-[#E7E5E4] active:bg-gray-50" data-testid={`mobile-home-link-${q.label.toLowerCase()}`}>
            <span className={`w-9 h-9 rounded-full flex items-center justify-center ${q.tint}`}><q.icon className="w-4 h-4" /></span>
            <span className="text-[11px] font-medium">{q.label}</span>
          </Link>
        ))}
      </div>

      {/* Boards — core daily boards, with the rest behind "Show all" */}
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 px-1">Boards</h2>
        <div className="grid grid-cols-4 gap-2">
          {boards.map((b: any) => (
            <Link key={b.url} href={b.url} className="relative flex flex-col items-center gap-1.5 py-3 px-1 rounded-2xl bg-white dark:bg-card border border-[#E7E5E4] active:bg-gray-50" data-testid={`mobile-home-board-${b.title.toLowerCase().replace(/\s+/g, "-")}`}>
              <span className="w-9 h-9 rounded-full flex items-center justify-center bg-gray-100 text-gray-700 dark:bg-muted"><b.icon className="w-4 h-4" /></span>
              <span className="text-[10px] font-medium text-center leading-tight">{b.title}</span>
              {b.badge && <span className="absolute top-1 right-1 text-[7px] px-1 py-0.5 rounded-full bg-primary/10 text-primary font-semibold">{b.badge}</span>}
            </Link>
          ))}
        </div>
      </section>

      {/* Today — actionable alerts */}
      {alerts.length > 0 && (
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 px-1">Needs attention ({alerts.length})</h2>
          <div className="space-y-2">
            {alerts.slice(0, 5).map((a, i) => {
              const s = SEV[a.severity] || SEV.info;
              return (
                <Link key={i} href={alertHref(a)} className={`flex items-start gap-2 rounded-2xl border p-3 bg-white dark:bg-card active:bg-gray-50`} data-testid={`mobile-home-alert-${i}`}>
                  <span className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 border ${s.cls}`}><s.icon className="w-3.5 h-3.5" /></span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium leading-tight truncate">{a.title}</p>
                    {a.detail && <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">{a.detail}</p>}
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 mt-1.5" />
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {/* My tasks */}
      <section>
        <div className="flex items-center justify-between mb-2 px-1">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">My tasks{openTasks.length ? ` (${openTasks.length})` : ""}</h2>
          <Link href="/tasks" className="text-[11px] text-primary font-medium">View all</Link>
        </div>
        {openTasks.length === 0 ? (
          <p className="text-xs text-muted-foreground italic px-1 py-3">Nothing outstanding — nice. 🎉</p>
        ) : (
          <div className="space-y-1.5">
            {openTasks.map(t => (
              <div key={t.id} className="flex items-start gap-2.5 rounded-2xl border p-3 bg-white dark:bg-card" data-testid={`mobile-home-task-${t.id}`}>
                <button onClick={() => completeTask.mutate(t.id)} className="mt-0.5 shrink-0 active:scale-90 transition-transform" aria-label="Complete task">
                  <Circle className="w-5 h-5 text-gray-300" />
                </button>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium leading-snug">{t.title}</p>
                  {(t.deal_name || t.property_name || t.contact_name) && (
                    <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{[t.deal_name, t.property_name, t.contact_name].filter(Boolean).join(" · ")}</p>
                  )}
                </div>
                {t.priority === "high" && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 font-medium shrink-0">High</span>}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
