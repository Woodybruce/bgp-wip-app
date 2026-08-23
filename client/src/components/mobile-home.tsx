import { useQuery, useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useLocation } from "wouter";
import { apiRequest, queryClient, getAuthHeaders } from "@/lib/queryClient";
import { mobileOverlayItems } from "@/components/app-sidebar";
import { MemberAvatar } from "@/components/ClientTeamOrgChart";
import {
  Sparkles, BarChart3, FileText, Handshake, Calendar as CalendarIcon,
  AlertTriangle, Info, CheckCircle2, Circle, ChevronRight, Sun, Wallet, RefreshCw,
  Receipt, Image as ImageIcon, Building2, Store, ClipboardList, Newspaper, Users, Mail,
} from "lucide-react";
import { legacyToCode } from "@shared/deal-status";
import { isEquityUser } from "@/lib/utils";

type BriefingData = { briefing: string; generatedAt: string };

// Compact "Your BGP team" row for the client Portfolio home (UX #59) — the
// phone shell replaces the desktop dashboard where ClientTeamOrgChart lives,
// so without this a client on a phone has no way to look up who to chase at
// BGP. Tap a person to email them.
function MobileBgpTeam({ clientCompanyId }: { clientCompanyId: string }) {
  const { data: membersRaw } = useQuery<any[]>({
    queryKey: ["/api/client-teams", clientCompanyId],
    queryFn: async () => {
      const r = await fetch(`/api/client-teams/${clientCompanyId}`, { headers: getAuthHeaders() });
      if (!r.ok) return [];
      return r.json();
    },
    enabled: !!clientCompanyId,
    staleTime: 10 * 60 * 1000,
  });
  const members = (Array.isArray(membersRaw) ? membersRaw : [])
    .slice()
    .sort((a, b) => (Number(b.is_lead) - Number(a.is_lead)) || (a.sort_order - b.sort_order) || (a.full_name || "").localeCompare(b.full_name || ""));
  if (members.length === 0) return null;
  return (
    <section className="rounded-2xl border border-[#E7E5E4] dark:border-border bg-white dark:bg-card shadow-sm px-4 py-3" data-testid="mobile-home-bgp-team">
      <div className="flex items-center gap-2 mb-2.5">
        <Users className="w-4 h-4 text-muted-foreground" />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Your BGP team</span>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-1 -mx-1 px-1">
        {members.map((m: any) => (
          <a
            key={m.id}
            href={m.email ? `mailto:${m.email}` : undefined}
            className="flex flex-col items-center gap-1 w-[72px] shrink-0 active:opacity-70"
            data-testid={`mobile-bgp-team-${m.user_id}`}
          >
            <MemberAvatar member={m} className="w-12 h-12 text-sm" />
            <span className="text-[11px] font-medium leading-tight text-center line-clamp-1 w-full">
              {(m.full_name || m.username || "").split(/\s+/)[0]}
            </span>
            <span className="text-[9px] text-muted-foreground leading-tight text-center line-clamp-2 w-full">
              {m.role || m.bgp_title || (m.is_lead ? "Lead" : "")}
            </span>
            {m.email && <Mail className="w-3 h-3 text-muted-foreground" />}
          </a>
        ))}
      </div>
    </section>
  );
}

// Minimal markdown for the AI briefing — headings, bullets, bold, rules.
function renderBriefingInline(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((p, i) =>
    p.startsWith("**") && p.endsWith("**")
      ? <strong key={i}>{p.slice(2, -2)}</strong>
      : <span key={i}>{p}</span>
  );
}

function AiDailyBriefing() {
  // The briefing is generated once a day (6am cron + server-side cache), so we
  // keep it fresh for the session rather than re-fetching on every mount.
  const { data, isLoading } = useQuery<BriefingData>({
    queryKey: ["/api/ai-briefing"],
    staleTime: 6 * 60 * 60 * 1000,
  });
  // Manual refresh forces a regenerate server-side (?refresh=1) then updates
  // the cache, so the button genuinely rebuilds the briefing on demand.
  const refresh = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("GET", "/api/ai-briefing?refresh=1");
      return r.json();
    },
    onSuccess: (fresh: BriefingData) => queryClient.setQueryData(["/api/ai-briefing"], fresh),
  });
  const isFetching = refresh.isPending;
  return (
    <section className="rounded-2xl border border-[#E7E5E4] bg-white dark:bg-card overflow-hidden shadow-sm" data-testid="mobile-home-briefing">
      <div className="px-4 py-3 flex items-center justify-between bg-gradient-to-r from-primary/5 to-transparent">
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            <Sparkles className="w-4 h-4 text-primary" />
          </span>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold leading-tight">AI Daily Briefing</h2>
            <p className="text-[11px] text-muted-foreground truncate">
              {data ? `Generated ${new Date(data.generatedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}` : "Your personalised morning summary"}
            </p>
          </div>
        </div>
        <button
          onClick={() => refresh.mutate()}
          disabled={isFetching}
          className="w-8 h-8 rounded-full flex items-center justify-center active:bg-gray-100 shrink-0"
          aria-label="Refresh briefing"
          data-testid="mobile-home-briefing-refresh"
        >
          <RefreshCw className={`w-4 h-4 text-muted-foreground ${isFetching ? "animate-spin" : ""}`} />
        </button>
      </div>
      <div className="px-4 pb-4 pt-1">
        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3, 4].map(i => <div key={i} className="h-3 rounded bg-muted animate-pulse" style={{ width: `${90 - i * 8}%` }} />)}
          </div>
        ) : data?.briefing ? (
          <div className="text-[13px] leading-relaxed max-h-[300px] overflow-y-auto pr-1">
            {data.briefing.split("\n").map((line, i) => {
              if (line.startsWith("# ")) return <h3 key={i} className="text-[15px] font-bold mt-3 mb-1 first:mt-0">{renderBriefingInline(line.slice(2))}</h3>;
              if (line.startsWith("## ")) return <h4 key={i} className="text-[13px] font-semibold mt-3 mb-1">{renderBriefingInline(line.slice(3))}</h4>;
              if (line.startsWith("### ")) return <h4 key={i} className="text-[13px] font-semibold mt-2 mb-0.5">{renderBriefingInline(line.slice(4))}</h4>;
              if (/^\*\*.*\*\*$/.test(line.trim())) return <h4 key={i} className="text-[13px] font-semibold mt-3 mb-1">{line.replace(/\*\*/g, "")}</h4>;
              if (line.startsWith("- ") || line.startsWith("• ")) return <li key={i} className="ml-4 list-disc marker:text-primary/40">{renderBriefingInline(line.slice(2))}</li>;
              if (/^\d+\.\s/.test(line)) return <li key={i} className="ml-4 list-decimal marker:text-primary/40">{renderBriefingInline(line.replace(/^\d+\.\s/, ""))}</li>;
              if (line.startsWith("---")) return <hr key={i} className="my-3 border-border" />;
              if (line.trim() === "") return <div key={i} className="h-2" />;
              return <p key={i} className="mb-1">{renderBriefingInline(line)}</p>;
            })}
          </div>
        ) : (
          <div className="text-center py-4">
            <p className="text-sm text-muted-foreground">Your AI briefing will appear here</p>
            <button onClick={() => refresh.mutate()} disabled={isFetching} className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-primary" data-testid="mobile-home-briefing-generate">
              <Sparkles className="w-3.5 h-3.5" /> Generate
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

type Alert = { type: string; severity: "critical" | "warning" | "info"; title: string; detail?: string; entityId?: string; entityType?: string };
type Task = { id: string; title: string; status: string; priority: string; deal_name?: string | null; property_name?: string | null; contact_name?: string | null };
type DealSummary = { id: string; name: string; status: string; property_name?: string | null };
type Commission = { billedPence: number; commissionEarned: number; commissionForecast: number; schemeYear: string; wipByStage?: { neg: number; sol: number; exc: number; com: number } };

// Core boards shown on Home by default. Everything else (admin / WIP tools)
// hides behind "Show all" so the home screen stays focused on daily work.
const CORE_BOARD_URLS = new Set(["/comps", "/brands", "/property-intelligence", "/sharepoint"]);

// Pence → compact £ (e.g. £1.2m, £340k, £980)
function fmtMoney(pence: number | undefined | null): string {
  const p = Math.round((pence || 0) / 100);
  if (p >= 1_000_000) return `£${(p / 1_000_000).toFixed(p >= 10_000_000 ? 0 : 1)}m`;
  if (p >= 1_000) return `£${Math.round(p / 1_000)}k`;
  return `£${p.toLocaleString("en-GB")}`;
}

const QUICK_LINKS = [
  { label: "Deals", icon: BarChart3, to: "/deals", tint: "bg-purple-100 text-purple-700" },
  { label: "Expenses", icon: Receipt, to: "/m/expenses", tint: "bg-rose-100 text-rose-700" },
  { label: "Images", icon: ImageIcon, to: "/m/images", tint: "bg-blue-100 text-blue-700" },
  { label: "CRM", icon: Handshake, to: "/contacts", tint: "bg-emerald-100 text-emerald-700" },
];

// Portfolio (client) homes: one uniform 4×2 grid instead of a 3-wide row
// stacked on a 4-wide row — same tile size, same chip treatment, and only
// tint classes every colour scheme remaps (no stray blue Images icon).
const PORTFOLIO_LINKS = [
  { label: "Tracker", icon: ClipboardList, to: "/available", tint: "bg-emerald-100 text-emerald-700" },
  { label: "Requirements", icon: FileText, to: "/requirements", tint: "bg-violet-100 text-violet-700" },
  { label: "Brands", icon: Store, to: "/brands", tint: "bg-amber-100 text-amber-700" },
  { label: "Deals", icon: BarChart3, to: "/deals", tint: "bg-purple-100 text-purple-700" },
  { label: "Images", icon: ImageIcon, to: "/m/images", tint: "bg-blue-100 text-blue-700" },
  { label: "CRM", icon: Handshake, to: "/contacts", tint: "bg-emerald-100 text-emerald-700" },
  { label: "Calendar", icon: CalendarIcon, to: "/calendar", tint: "bg-amber-100 text-amber-700" },
  { label: "News", icon: Newspaper, to: "/news", tint: "bg-orange-100 text-orange-700" },
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
  // Client logins (e.g. Landsec): no Expenses tile, and skip the BGP
  // commission/WIP queries entirely — they're staff-only and would 403.
  const isClientHome = user?.role === "Client" || !!(user as any)?.companyScopeId;
  // Equity directors (Woody, Jack, Rupert, Charlotte) get the company
  // finance tile — server-gated API, so the query only runs for them.
  const isEquity = isEquityUser(user) && !isClientHome;
  const { data: equityFin } = useQuery<any>({
    queryKey: ["/api/xero/financials"],
    enabled: isEquity,
    staleTime: 5 * 60 * 1000,
  });
  // Personal (my billing) vs Company (equity finance) tab on the combined
  // finance tile — Company is the default (Woody, 2026-08-22), an explicit
  // switch to Personal sticks per device.
  const [finTab, setFinTab] = useState<"personal" | "company">(() => {
    try { return localStorage.getItem("mobile-fin-tab") === "personal" ? "personal" : "company"; } catch { return "company"; }
  });
  const pickFinTab = (t: "personal" | "company") => {
    setFinTab(t);
    try { localStorage.setItem("mobile-fin-tab", t); } catch {}
  };
  // Only real client logins get the portfolio home. Staff keep the full
  // staff home (Expenses, billing, boards) even with the Landsec team
  // selected — the team switcher scopes data, not the phone shell
  // (Woody, 2026-08-07: BGP users on the Landsec account were losing
  // Expenses/billing; reverted the staff-preview behaviour).
  // 2026-08-14: that revert never actually landed — this flag was still
  // isClientHome (role OR scope), so Landsec-scoped staff (Victoria) got
  // the client phone shell. Real client logins only, as documented.
  const showPortfolioHome = user?.role === "Client";
  // Staff currently scoped into a client's view — show an exit banner so
  // a phone can escape without finding the desktop sidebar.
  const isViewingAsClient = user?.role !== "Client" && !!(user as any)?.companyScopeId;
  const exitClientView = async () => {
    try {
      if ((user as any)?.canViewAsClient) {
        await apiRequest("POST", "/api/auth/client-view-mode", { enabled: false }).catch(() => {});
      }
      await apiRequest("POST", "/api/auth/active-team", { team: "all" });
      localStorage.setItem("bgp_active_team", "all");
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      queryClient.invalidateQueries();
    } catch { /* refetch will reflect whatever stuck */ }
  };
  const { data: alerts = [] } = useQuery<Alert[]>({ queryKey: ["/api/daily-digest"] });
  const { data: tasks = [] } = useQuery<Task[]>({ queryKey: ["/api/tasks"] });
  const { data: commission } = useQuery<Commission>({
    queryKey: [`/api/hr/staff/${user?.id}/commission`],
    queryFn: () => apiRequest("GET", `/api/hr/staff/${user?.id}/commission`).then(r => r.json()),
    enabled: !!user?.id && !isClientHome,
  });
  // Team/firm total billing — the WIP roll-up (same figure the desktop WIP
  // card shows as "Total net fees"). amtWip/amtInvoice are in pounds.
  // Client homes (Landsec): letting-tracker roll-up — the endpoint is
  // company-scoped server-side, so these are THEIR units only.
  const { data: clientUnitsRaw } = useQuery<any[]>({
    queryKey: ["/api/available-units"],
    staleTime: 2 * 60 * 1000,
    enabled: showPortfolioHome,
  });
  const clientUnits = Array.isArray(clientUnitsRaw) ? clientUnitsRaw : [];
  const unitStats = {
    available: clientUnits.filter(u => legacyToCode(u.marketingStatus) === "AVA").length,
    underOffer: clientUnits.filter(u => legacyToCode(u.marketingStatus) === "SOL").length,
    let: clientUnits.filter(u => legacyToCode(u.marketingStatus) === "COM").length,
    total: clientUnits.length,
  };
  const { data: wipResp } = useQuery<any>({ queryKey: ["/api/wip"], staleTime: 5 * 60 * 1000, enabled: !isClientHome });
  const wipEntries = Array.isArray(wipResp) ? wipResp : (wipResp?.entries || []);
  const totalBilling = wipEntries.reduce((s: number, e: any) => s + (e.amtWip || 0) + (e.amtInvoice || 0), 0);

  const completeTask = useMutation({
    mutationFn: (id: string) => apiRequest("PATCH", `/api/tasks/${id}`, { status: "done" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/tasks"] }),
  });

  // The bottom-nav "More" drawer is gone — board navigation lives here.
  // Default to the core daily boards; the rest (admin / WIP tools) sit behind
  // "Show all" so Home stays focused. Admins still get their extra tools.
  const visibleBoards = (mobileOverlayItems as any[]).filter(b => (user?.isAdmin || !b.adminOnly) && b.url !== "/mail");
  // Portfolio homes already have a Brands tile in the quick trio above, so
  // drop the Brand Intelligence board there to avoid showing /brands twice.
  const boards = visibleBoards.filter(b => CORE_BOARD_URLS.has(b.url) && !(showPortfolioHome && b.url === "/brands"));
  const openTasks = (tasks || []).filter(t => t.status !== "done").slice(0, 6);
  // Count-gated approvals link — mirrors the desktop sidebar entry so Wendy/
  // Layla + directors can reach their queue from the phone.
  const { data: pendingApprovals } = useQuery<any[]>({
    queryKey: ["/api/expenses/pending-approval"],
    refetchInterval: 60_000,
    enabled: !!user && !isClientHome,
  });
  const approvalCount = Array.isArray(pendingApprovals) ? pendingApprovals.length : 0;
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const firstName = (user?.name || "").split(" ")[0] || "there";
  const today = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });

  return (
    <div
      className="bg-[#FAF9F7] dark:bg-background min-h-full px-4 pb-2 space-y-4"
      style={{ paddingTop: "calc(0.75rem + env(safe-area-inset-top))" }}
    >
      {/* Staff scoped into a client's view — plain banner + one-tap exit.
          Without this, a phone stuck in Landsec view has no way back. */}
      {isViewingAsClient && (
        <button
          type="button"
          onClick={exitClientView}
          className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-indigo-600 text-white text-sm font-medium shadow"
          data-testid="button-mobile-exit-client-view"
        >
          <span className="truncate">Viewing as {(user as any)?.companyScopeName || "client"} — this is their view, not yours</span>
          <span className="shrink-0 text-xs bg-white/20 rounded-full px-2 py-0.5">Exit</span>
        </button>
      )}

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
        onClick={() => navigate("/chatbgp?ask=1")}
        className="w-full flex items-center gap-3 rounded-2xl px-4 py-3.5 bg-[hsl(var(--mobile-chrome))] text-white shadow-sm active:opacity-90"
        data-testid="mobile-home-ask-chatbgp"
      >
        <Sparkles className="w-5 h-5 shrink-0" />
        <span className="text-base font-semibold">Ask ChatBGP…</span>
        <ChevronRight className="w-4 h-4 ml-auto opacity-70" />
      </button>

      {/* Client homes (Landsec) — and staff previewing in the Landsec team
          view: portfolio letting roll-up + jump-offs, the phone version of
          the Landsec dashboard. */}
      {showPortfolioHome && (
        <>
          <Link
            href="/available"
            className="block rounded-2xl bg-[hsl(var(--mobile-chrome))] text-white shadow-sm active:opacity-90 px-4 py-3.5"
            data-testid="mobile-home-portfolio"
          >
            <div className="flex items-center gap-2 mb-2.5">
              <Building2 className="w-4 h-4 opacity-80" />
              <span className="text-xs font-semibold uppercase tracking-wider opacity-80">My portfolio — letting tracker</span>
              <ChevronRight className="w-4 h-4 ml-auto opacity-60" />
            </div>
            <div className="grid grid-cols-4 gap-2">
              <div>
                <p className="text-lg font-bold tabular-nums leading-tight text-emerald-400">{unitStats.available}</p>
                <p className="text-[10px] opacity-70">Available</p>
              </div>
              <div>
                <p className="text-lg font-bold tabular-nums leading-tight text-amber-300">{unitStats.underOffer}</p>
                <p className="text-[10px] opacity-70">Under offer</p>
              </div>
              <div>
                <p className="text-lg font-bold tabular-nums leading-tight text-sky-300">{unitStats.let}</p>
                <p className="text-[10px] opacity-70">Let</p>
              </div>
              <div>
                <p className="text-lg font-bold tabular-nums leading-tight">{unitStats.total}</p>
                <p className="text-[10px] opacity-70">Units</p>
              </div>
            </div>
          </Link>

          {!!(user as any)?.companyScopeId && (
            <MobileBgpTeam clientCompanyId={(user as any).companyScopeId} />
          )}
        </>
      )}

      {/* Finance tile — Personal (my billing) and Company (equity finance)
          combined into one board with tabs (Woody, 2026-08-22). Non-equity
          staff only ever see Personal; the tabs appear when both apply. */}
      {(() => {
        const equityOk = isEquity && equityFin && !equityFin.notConnected && !equityFin.needsReconnect;
        if (!commission && !equityOk) return null;
        const showTabs = !!commission && equityOk;
        const tab = showTabs ? finTab : (commission ? "personal" : "company");
        const target = tab === "personal" ? "/deals" : "/finance";
        return (
          <div className="rounded-2xl bg-[hsl(var(--mobile-chrome))] text-white shadow-sm px-4 py-3.5" data-testid="mobile-home-finance">
            <div className="flex items-center gap-2 mb-2.5">
              {showTabs ? (
                <div className="flex items-center rounded-full bg-white/10 p-px">
                  <button
                    onClick={() => pickFinTab("personal")}
                    data-no-min-touch
                    className={`px-2 py-[3px] rounded-full text-[10px] leading-none font-semibold uppercase tracking-wide transition-colors ${tab === "personal" ? "bg-white/90 text-[hsl(var(--mobile-chrome))]" : "text-white/60"}`}
                    data-testid="fin-tab-personal"
                  >
                    Personal
                  </button>
                  <button
                    onClick={() => pickFinTab("company")}
                    data-no-min-touch
                    className={`px-2 py-[3px] rounded-full text-[10px] leading-none font-semibold uppercase tracking-wide transition-colors ${tab === "company" ? "bg-white/90 text-[hsl(var(--mobile-chrome))]" : "text-white/60"}`}
                    data-testid="fin-tab-company"
                  >
                    Company
                  </button>
                </div>
              ) : tab === "personal" && commission ? (
                <>
                  <Wallet className="w-4 h-4 opacity-80" />
                  <span className="text-xs font-semibold uppercase tracking-wider opacity-80">My billing — {commission.schemeYear}</span>
                </>
              ) : (
                <>
                  <BarChart3 className="w-4 h-4 opacity-80" />
                  <span className="text-xs font-semibold uppercase tracking-wider opacity-80">Equity finance</span>
                </>
              )}
              <button onClick={() => navigate(target)} className="ml-auto flex items-center gap-1 active:opacity-70" data-testid="fin-tile-open">
                {showTabs && (
                  <span className="text-[10px] uppercase tracking-wider opacity-60">
                    {tab === "personal" ? commission?.schemeYear : "Full view"}
                  </span>
                )}
                <ChevronRight className="w-4 h-4 opacity-60" />
              </button>
            </div>
            <button onClick={() => navigate(target)} className="block w-full text-left active:opacity-90">
              {tab === "personal" && commission ? (
                <>
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
                </>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <p className="text-lg font-bold tabular-nums leading-tight">£{Math.round(equityFin.headline?.income || 0).toLocaleString("en-GB")}</p>
                    <p className="text-[10px] opacity-70">Income FYTD</p>
                  </div>
                  <div>
                    <p className={`text-lg font-bold tabular-nums leading-tight ${(equityFin.headline?.netProfit || 0) < 0 ? "text-red-400" : "text-emerald-400"}`}>
                      £{Math.round(equityFin.headline?.netProfit || 0).toLocaleString("en-GB")}
                    </p>
                    <p className="text-[10px] opacity-70">Net FYTD</p>
                  </div>
                  <div>
                    <p className="text-lg font-bold tabular-nums leading-tight">£{Math.round(equityFin.cashTotal || 0).toLocaleString("en-GB")}</p>
                    <p className="text-[10px] opacity-70">Cash at bank</p>
                  </div>
                  {equityFin.projection?.projectedNet != null ? (
                    <div>
                      <p className={`text-lg font-bold tabular-nums leading-tight ${equityFin.projection.projectedNet < 0 ? "text-red-400" : "text-emerald-400"}`}>
                        £{Math.round(equityFin.projection.projectedNet).toLocaleString("en-GB")}
                      </p>
                      <p className="text-[10px] opacity-70">Projected FY net</p>
                    </div>
                  ) : (
                    <div>
                      <p className="text-lg font-bold tabular-nums leading-tight">£{Math.round(equityFin.debtors?.outstanding || 0).toLocaleString("en-GB")}</p>
                      <p className="text-[10px] opacity-70">Debtors</p>
                    </div>
                  )}
                </div>
              )}
            </button>
          </div>
        );
      })()}

      {/* Total billing — team/firm WIP roll-up; taps through to the full WIP report */}
      {totalBilling > 0 && (
        <Link
          href="/wip-report"
          className="block rounded-2xl bg-white dark:bg-card border border-[#E7E5E4] dark:border-border shadow-sm active:bg-gray-50 px-4 py-3.5"
          data-testid="mobile-home-total-billing"
        >
          <div className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-muted-foreground shrink-0" />
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Total billing</p>
              <p className="text-2xl font-bold tabular-nums leading-tight">£{Math.round(totalBilling).toLocaleString("en-GB")}</p>
            </div>
            <ChevronRight className="w-4 h-4 ml-auto text-muted-foreground shrink-0" />
          </div>
        </Link>
      )}

      {/* Approvals — only shown when this user has expenses to sign off. */}
      {approvalCount > 0 && (
        <Link
          href="/expenses/approvals"
          className="flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-900/40 px-4 py-3 active:bg-amber-100"
          data-testid="mobile-home-approvals"
        >
          <span className="w-9 h-9 rounded-full bg-amber-500/15 text-amber-600 flex items-center justify-center shrink-0">
            <CheckCircle2 className="w-5 h-5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold">{approvalCount} expense{approvalCount === 1 ? "" : "s"} to approve</div>
            <div className="text-[11px] text-muted-foreground">Tap to review your approval queue</div>
          </div>
          <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
        </Link>
      )}

      {/* Team Expenses — read-only, only for designated team overseers
          (e.g. Victoria → National Leasing). Same responsive page the
          desktop sidebar links to. */}
      {!isClientHome && Array.isArray(user?.expenseOverseerTeams) && user.expenseOverseerTeams.length > 0 && (
        <Link
          href="/team-expenses"
          className="flex items-center gap-3 rounded-2xl border border-blue-200 bg-blue-50 dark:bg-blue-950/20 dark:border-blue-900/40 px-4 py-3 active:bg-blue-100"
          data-testid="mobile-home-team-expenses"
        >
          <span className="w-9 h-9 rounded-full bg-blue-500/15 text-blue-600 flex items-center justify-center shrink-0">
            <Receipt className="w-5 h-5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold">Team Expenses</div>
            <div className="text-[11px] text-muted-foreground">{user.expenseOverseerTeams.join(", ")} — view team spend</div>
          </div>
          <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
        </Link>
      )}

      {/* Quick links. Admins reach firm-wide spend + approvals via the
          Mine/Team toggle inside the Expenses page — keeps one entry
          point on the home grid for the daily flow. Client homes (Landsec)
          swap the staff-only Expenses tile for the team calendar, which the
          Calendar page already pins to the client's own team. */}
      <div className="grid grid-cols-4 gap-2">
        {(showPortfolioHome ? PORTFOLIO_LINKS : QUICK_LINKS).map(q => (
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
              <span className="w-9 h-9 rounded-full flex items-center justify-center bg-muted text-foreground/70"><b.icon className="w-4 h-4" /></span>
              <span className="text-[10px] font-medium text-center leading-tight">{b.title}</span>
              {b.badge && <span className="absolute top-1 right-1 text-[9px] px-1 py-0.5 rounded-full bg-primary/10 text-primary font-semibold">{b.badge}</span>}
            </Link>
          ))}
        </div>
      </section>

      {/* AI Daily Briefing — the personalised morning summary */}
      <AiDailyBriefing />

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
