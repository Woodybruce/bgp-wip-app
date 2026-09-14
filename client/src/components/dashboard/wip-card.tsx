import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { useState, useMemo, useRef, useCallback } from "react";
import { useTeam } from "@/lib/team-context";
import {
  BarChart3,
  ArrowRight,
  ArrowUpDown,
  X,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import type { User } from "@shared/schema";
import { legacyToCode, DEAL_STATUS_LABELS } from "@shared/deal-status";
import { FilterDropdown } from "@/components/wip-filter-dropdown";
import { Pill } from "@/components/ui/pill";
import { formatCurrencyFull, getWipMonthSortKey } from "./helpers";

// Same abbreviation the full WIP report uses on its boards (£1.2M / £340K).
function formatCurrencyBoard(value: number): string {
  if (value >= 1_000_000) return `£${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `£${(value / 1_000).toFixed(0)}K`;
  return `£${value.toLocaleString("en-GB", { maximumFractionDigits: 0 })}`;
}

type BoardDim = "client" | "team" | "month" | "agent" | "project" | "status";

export function WipDashboardCard({ user }: { user: User | undefined }) {
  const { activeTeam } = useTeam();
  const { data: wipResponse, isLoading } = useQuery<{ entries: any[]; isAdmin: boolean; userTeam: string | null }>({
    queryKey: ["/api/wip"],
    staleTime: 5 * 60 * 1000,
  });

  const wipEntries = Array.isArray(wipResponse) ? wipResponse : (wipResponse?.entries || []);
  const isWipAdmin = Array.isArray(wipResponse) ? false : (wipResponse?.isAdmin || false);
  const wipUserTeam = Array.isArray(wipResponse) ? null : (wipResponse?.userTeam || null);
  // Leadership (senior partners + finance full-view like Layla) always see the
  // whole firm — never scoped to their own team.
  const canSeeAll = Array.isArray(wipResponse) ? false : !!(wipResponse as any)?.canSeeAll;

  const selectedTeam = isWipAdmin
    ? (activeTeam === "all" ? "all" : (activeTeam || user?.team || "Investment"))
    : (wipUserTeam || user?.team || "Investment");
  const isAllTeams = canSeeAll || (isWipAdmin && activeTeam === "all");

  const teamEntries = useMemo(() => {
    if (wipEntries.length === 0) return [];
    if (canSeeAll) return wipEntries;
    if (!isWipAdmin) return wipEntries;
    if (activeTeam === "all") return wipEntries;
    const at = (activeTeam || "").toLowerCase();
    if (!at) return wipEntries;
    return wipEntries.filter((e: any) => {
      if (!e.team) return false;
      const teams = (e.team as string).split(",").map((t: string) => t.trim().toLowerCase());
      return teams.some(t => t === at);
    });
  }, [wipEntries, activeTeam, isWipAdmin, canSeeAll]);

  const allClients = useMemo(() => {
    const set = new Set(teamEntries.map(e => e.client).filter(Boolean) as string[]);
    return [...set].sort();
  }, [teamEntries]);

  const allTeams = useMemo(() => {
    const set = new Set<string>();
    teamEntries.forEach((e: any) => {
      if (!e.team) return;
      (e.team as string).split(",").map((t: string) => t.trim()).filter(Boolean).forEach(t => set.add(t));
    });
    return [...set].sort();
  }, [teamEntries]);

  const allMonths = useMemo(() => {
    const set = new Set(teamEntries.map(e => e.month).filter(Boolean) as string[]);
    return [...set].sort((a, b) => getWipMonthSortKey(a) - getWipMonthSortKey(b));
  }, [teamEntries]);

  const allAgents = useMemo(() => {
    const set = new Set<string>();
    teamEntries.forEach((e: any) => {
      if (e.agent) {
        const parts = (e.agent as string).split(",").map((a: string) => a.trim()).filter(Boolean);
        parts.forEach(a => set.add(a));
      }
    });
    return [...set].sort();
  }, [teamEntries]);

  const allProjects = useMemo(() => {
    const set = new Set(teamEntries.map(e => e.project).filter(Boolean) as string[]);
    return [...set].sort();
  }, [teamEntries]);

  const allStatuses = useMemo(() => {
    const set = new Set(teamEntries.map(e => e.dealStatus).filter(Boolean) as string[]);
    return [...set].sort();
  }, [teamEntries]);

  // Empty selection = no filter, matching the full WIP report — each dropdown
  // starts unticked and any tick narrows.
  const [selectedClients, setSelectedClients] = useState<Set<string>>(new Set());
  const [selectedTeams, setSelectedTeams] = useState<Set<string>>(new Set());
  const [selectedMonths, setSelectedMonths] = useState<Set<string>>(new Set());
  const [selectedAgents, setSelectedAgents] = useState<Set<string>>(new Set());
  const [selectedProjects, setSelectedProjects] = useState<Set<string>>(new Set());
  const [selectedStatuses, setSelectedStatuses] = useState<Set<string>>(new Set());
  const [detailSort, setDetailSort] = useState<{ column: string; direction: "asc" | "desc" }>({ column: "amtWip", direction: "desc" });
  const [detailOpen, setDetailOpen] = useState(true);

  const clearAllFilters = () => {
    setSelectedClients(new Set());
    setSelectedTeams(new Set());
    setSelectedMonths(new Set());
    setSelectedAgents(new Set());
    setSelectedProjects(new Set());
    setSelectedStatuses(new Set());
  };

  const prevTeamRef = useRef<string | null>(null);
  if (teamEntries.length > 0 && prevTeamRef.current !== selectedTeam) {
    prevTeamRef.current = selectedTeam;
    clearAllFilters();
  }

  // Same matcher as the full WIP report: `skip` leaves one dimension out so
  // that dimension's board shows every option (highlighted, not vanished)
  // and the boards cross-filter each other. "Unassigned" rows are the fees
  // with no attribution, kept so the boards add up to the header total.
  const entryMatches = useCallback((e: any, skip?: BoardDim) => {
    if (skip !== "client" && selectedClients.size > 0) {
      const ok = e.client ? selectedClients.has(e.client) : selectedClients.has("Unassigned");
      if (!ok) return false;
    }
    if (skip !== "team" && selectedTeams.size > 0) {
      const entryTeams = e.team ? (e.team as string).split(",").map((t: string) => t.trim()).filter(Boolean) : [];
      const ok = entryTeams.length > 0 ? entryTeams.some((t: string) => selectedTeams.has(t)) : selectedTeams.has("Unassigned");
      if (!ok) return false;
    }
    if (skip !== "month" && selectedMonths.size > 0) {
      if (e.month && !selectedMonths.has(e.month)) return false;
    }
    if (skip !== "agent" && selectedAgents.size > 0) {
      const agentParts = e.agent ? (e.agent as string).split(",").map((a: string) => a.trim()).filter(Boolean) : [];
      const ok = agentParts.length > 0 ? agentParts.some((a: string) => selectedAgents.has(a)) : selectedAgents.has("Unassigned");
      if (!ok) return false;
    }
    if (skip !== "project" && selectedProjects.size > 0) {
      const ok = e.project ? selectedProjects.has(e.project) : selectedProjects.has("Unassigned");
      if (!ok) return false;
    }
    if (skip !== "status" && selectedStatuses.size > 0) {
      if (!e.dealStatus || !selectedStatuses.has(e.dealStatus)) return false;
    }
    return true;
  }, [selectedClients, selectedTeams, selectedMonths, selectedAgents, selectedProjects, selectedStatuses]);

  const filteredEntries = useMemo(() => teamEntries.filter(e => entryMatches(e)), [teamEntries, entryMatches]);

  const totalWip = useMemo(() => filteredEntries.reduce((s, e) => s + (e.amtWip || 0), 0), [filteredEntries]);
  const totalInvoiced = useMemo(() => filteredEntries.reduce((s, e) => s + (e.amtInvoice || 0), 0), [filteredEntries]);

  // At-a-glance boards — mirror of the full report's desktop layout (the
  // Equity_WIP Power BI): fees-by-month columns, stage mix and ranked
  // Client / Property / Team / Contact boards, all clickable. Woody,
  // 2026-09-14: "WIP report on the Dashboard doesn't have the charts like
  // the main one — mirror".
  const monthlyFees = useMemo(() => {
    const byMonth = new Map<string, { wip: number; invoiced: number; deals: Set<string> }>();
    for (const e of teamEntries) {
      if (!entryMatches(e, "month")) continue;
      const key = e.month || "TBC";
      const cur = byMonth.get(key) || { wip: 0, invoiced: 0, deals: new Set<string>() };
      cur.wip += e.amtWip || 0;
      cur.invoiced += e.amtInvoice || 0;
      cur.deals.add(e.dealId || e.id);
      byMonth.set(key, cur);
    }
    return [...byMonth.entries()]
      .map(([month, v]) => ({ month, wip: v.wip, invoiced: v.invoiced, count: v.deals.size, total: v.wip + v.invoiced }))
      .sort((a, b) => (a.month === "TBC" ? 1 : b.month === "TBC" ? -1 : getWipMonthSortKey(a.month) - getWipMonthSortKey(b.month)));
  }, [teamEntries, entryMatches]);

  const stageMix = useMemo(() => {
    const byStage = new Map<string, { total: number; deals: Set<string> }>();
    for (const e of teamEntries) {
      if (!e.dealStatus || !entryMatches(e, "status")) continue;
      const cur = byStage.get(e.dealStatus) || { total: 0, deals: new Set<string>() };
      cur.total += (e.amtWip || 0) + (e.amtInvoice || 0);
      cur.deals.add(e.dealId || e.id);
      byStage.set(e.dealStatus, cur);
    }
    return [...byStage.entries()].map(([status, v]) => ({ status, total: v.total, count: v.deals.size })).sort((a, b) => b.total - a.total);
  }, [teamEntries, entryMatches]);

  const feeBoards = useMemo(() => {
    const build = (skip: "client" | "project" | "team" | "agent", keyOf: (e: any) => string[]) => {
      const agg = new Map<string, number>();
      for (const e of teamEntries) {
        if (!entryMatches(e, skip)) continue;
        const fee = (e.amtWip || 0) + (e.amtInvoice || 0);
        const keys = keyOf(e);
        const share = skip === "agent" && keys.length > 0 ? fee / keys.length : fee;
        for (const k of keys) agg.set(k, (agg.get(k) || 0) + share);
      }
      return [...agg.entries()].map(([name, total]) => ({ name, total })).sort((a, b) => b.total - a.total);
    };
    const orUnassigned = (keys: string[]) => (keys.length > 0 ? keys : ["Unassigned"]);
    return {
      client: build("client", (e) => orUnassigned(e.client ? [e.client] : [])),
      project: build("project", (e) => orUnassigned(e.project ? [e.project] : [])),
      team: build("team", (e) => orUnassigned(e.team ? (e.team as string).split(",").map((t: string) => t.trim()).filter(Boolean) : [])),
      agent: build("agent", (e) => orUnassigned(e.agent ? (e.agent as string).split(",").map((a: string) => a.trim()).filter(Boolean) : [])),
    };
  }, [teamEntries, entryMatches]);
  const [expandedBoards, setExpandedBoards] = useState<Set<string>>(new Set());

  const totalNetFees = useMemo(
    () => filteredEntries.reduce((s, e) => s + (e.amtWip || 0) + (e.amtInvoice || 0), 0),
    [filteredEntries],
  );

  // Net fees per filter option, shown alongside each entry in the dropdowns.
  const filterFees = useMemo(() => {
    const client: Record<string, number> = {};
    const team: Record<string, number> = {};
    const agent: Record<string, number> = {};
    const project: Record<string, number> = {};
    const status: Record<string, number> = {};
    const month: Record<string, number> = {};
    teamEntries.forEach((e: any) => {
      const fee = (e.amtWip || 0) + (e.amtInvoice || 0);
      if (e.client) client[e.client] = (client[e.client] || 0) + fee;
      if (e.project) project[e.project] = (project[e.project] || 0) + fee;
      if (e.dealStatus) status[e.dealStatus] = (status[e.dealStatus] || 0) + fee;
      if (e.month) month[e.month] = (month[e.month] || 0) + fee;
      if (e.team) {
        const teams = new Set((e.team as string).split(",").map((t: string) => t.trim()).filter(Boolean));
        teams.forEach(t => { team[t] = (team[t] || 0) + fee; });
      }
      if (e.agent) {
        const parts = (e.agent as string).split(",").map((a: string) => a.trim()).filter(Boolean);
        const perAgent = parts.length > 0 ? fee / parts.length : fee;
        parts.forEach((a: string) => { agent[a] = (agent[a] || 0) + perAgent; });
      }
    });
    return { client, team, agent, project, status, month };
  }, [teamEntries]);

  // One row per deal — collapse the server's per-agent fee-split entries,
  // matching the full report's Deal Detail.
  const mergedDetailEntries = useMemo(() => {
    const byDeal = new Map<string, any>();
    for (const e of filteredEntries) {
      const key = e.dealId || e.id;
      const existing = byDeal.get(key);
      if (!existing) {
        byDeal.set(key, { ...e, id: key });
      } else {
        existing.amtWip = (existing.amtWip || 0) + (e.amtWip || 0);
        existing.amtInvoice = (existing.amtInvoice || 0) + (e.amtInvoice || 0);
        if (e.agent) {
          const agents = new Set(
            (existing.agent || "").split(",").map((a: string) => a.trim()).filter(Boolean),
          );
          (e.agent as string).split(",").map((a: string) => a.trim()).filter(Boolean).forEach((a: string) => agents.add(a));
          existing.agent = [...agents].join(", ");
        }
      }
    }
    return [...byDeal.values()];
  }, [filteredEntries]);

  const sortedDetailEntries = useMemo(() => {
    const sorted = [...mergedDetailEntries];
    sorted.sort((a, b) => {
      let aVal: any, bVal: any;
      switch (detailSort.column) {
        case "ref": aVal = a.ref || ""; bVal = b.ref || ""; break;
        case "client": aVal = a.client || ""; bVal = b.client || ""; break;
        case "project": aVal = a.project || ""; bVal = b.project || ""; break;
        case "tenant": aVal = a.tenant || ""; bVal = b.tenant || ""; break;
        case "team": aVal = a.team || ""; bVal = b.team || ""; break;
        case "agent": aVal = a.agent || ""; bVal = b.agent || ""; break;
        case "amtWip": aVal = a.amtWip || 0; bVal = b.amtWip || 0; break;
        case "amtInvoice": aVal = a.amtInvoice || 0; bVal = b.amtInvoice || 0; break;
        case "month": aVal = getWipMonthSortKey(a.month || ""); bVal = getWipMonthSortKey(b.month || ""); break;
        case "dealStatus": aVal = a.dealStatus || ""; bVal = b.dealStatus || ""; break;
        default: aVal = 0; bVal = 0;
      }
      if (typeof aVal === "string") return detailSort.direction === "asc" ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      return detailSort.direction === "asc" ? aVal - bVal : bVal - aVal;
    });
    return sorted;
  }, [mergedDetailEntries, detailSort]);

  const toggleSort = (column: string) => {
    setDetailSort(prev => prev.column === column ? { column, direction: prev.direction === "asc" ? "desc" : "asc" } : { column, direction: "desc" });
  };

  const toggleFilter = (set: Set<string>, setFn: (s: Set<string>) => void, item: string) => {
    const next = new Set(set);
    if (next.has(item)) next.delete(item);
    else next.add(item);
    setFn(next);
  };

  const activeFilterCount =
    (selectedClients.size > 0 ? 1 : 0) +
    (selectedTeams.size > 0 ? 1 : 0) +
    (selectedMonths.size > 0 ? 1 : 0) +
    (selectedAgents.size > 0 ? 1 : 0) +
    (selectedProjects.size > 0 ? 1 : 0) +
    (selectedStatuses.size > 0 ? 1 : 0);

  const displayTeam = isAllTeams ? "All Teams" : selectedTeam;
  const title = `WIP Report — ${displayTeam}`;

  if (isLoading) {
    return (
      <Card className="p-4 space-y-3 h-full" data-testid="wip-dashboard-card">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-48 w-full" />
      </Card>
    );
  }

  if (wipEntries.length === 0) {
    return (
      <Card className="p-8 text-center h-full flex flex-col items-center justify-center" data-testid="wip-dashboard-card">
        <BarChart3 className="w-8 h-8 mx-auto mb-2 text-muted-foreground/70" />
        <p className="text-sm text-muted-foreground">No deals with fees found</p>
        <p className="text-xs text-muted-foreground/70 mt-1">Add fees to deals on the WIP board to see data here</p>
        <Link href="/wip-report">
          <Button variant="outline" size="sm" className="mt-3" data-testid="link-wip-upload">
            Go to WIP Report <ArrowRight className="w-3.5 h-3.5 ml-1" />
          </Button>
        </Link>
      </Card>
    );
  }

  if (teamEntries.length === 0) {
    return (
      <Card className="p-8 text-center h-full flex flex-col items-center justify-center" data-testid="wip-dashboard-card">
        <BarChart3 className="w-8 h-8 mx-auto mb-2 text-muted-foreground/70" />
        <p className="text-sm text-muted-foreground">No WIP entries found for {displayTeam}</p>
        <p className="text-xs text-muted-foreground/70 mt-1">Try selecting a different team</p>
      </Card>
    );
  }

  return (
    // h-full + flex column: the dashboard grid cell for this widget is
    // ~22 rows tall and the card used to stop at a fixed 400px table,
    // leaving a band of bare page inside the cell ("whats this gap",
    // Woody 2026-09-08). The deal table now takes whatever height is left.
    <Card className="p-4 flex flex-col gap-3 h-full min-h-0 overflow-y-auto" data-testid="wip-dashboard-card">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold text-foreground" data-testid="wip-dash-title">{title}</h2>
          <p className="text-xs text-muted-foreground">
            {mergedDetailEntries.length} deal{mergedDetailEntries.length !== 1 ? "s" : ""} · Total net fees: {formatCurrencyFull(totalNetFees)}
            <span className="hidden sm:inline"> · WIP {formatCurrencyFull(totalWip)} · <span className="text-green-700">Invoiced {formatCurrencyFull(totalInvoiced)}</span></span>
          </p>
        </div>
        <Link href="/wip-report">
          <Button variant="outline" size="sm" data-testid="link-wip-report">
            Full Report <ArrowRight className="w-3.5 h-3.5 ml-1" />
          </Button>
        </Link>
      </div>

      {/* Filter dropdowns — same controls as the full WIP report */}
      <div className="flex flex-wrap items-center gap-2" data-testid="wip-dash-filters">
        <FilterDropdown
          title="Client"
          items={allClients}
          selected={selectedClients}
          onToggle={(c) => toggleFilter(selectedClients, setSelectedClients, c)}
          onClearAll={() => setSelectedClients(new Set())}
          values={filterFees.client}
        />
        <FilterDropdown
          title="Property"
          items={allProjects}
          selected={selectedProjects}
          onToggle={(p) => toggleFilter(selectedProjects, setSelectedProjects, p)}
          onClearAll={() => setSelectedProjects(new Set())}
          values={filterFees.project}
        />
        {isAllTeams && (
          <FilterDropdown
            title="Team"
            items={allTeams}
            selected={selectedTeams}
            onToggle={(t) => toggleFilter(selectedTeams, setSelectedTeams, t)}
            onClearAll={() => setSelectedTeams(new Set())}
            values={filterFees.team}
          />
        )}
        <FilterDropdown
          title="BGP Contact"
          items={allAgents}
          selected={selectedAgents}
          onToggle={(a) => toggleFilter(selectedAgents, setSelectedAgents, a)}
          onClearAll={() => setSelectedAgents(new Set())}
          values={filterFees.agent}
        />
        <FilterDropdown
          title="Deal Status"
          items={allStatuses}
          selected={selectedStatuses}
          onToggle={(s) => toggleFilter(selectedStatuses, setSelectedStatuses, s)}
          onClearAll={() => setSelectedStatuses(new Set())}
          values={filterFees.status}
          getLabel={(s) => {
            // Expand short codes (INV → Invoiced) but keep legacy labels
            // like "HOTs" as-is (matches the WIP report).
            const code = legacyToCode(s);
            return code && code === s ? DEAL_STATUS_LABELS[code] : s;
          }}
        />
        <FilterDropdown
          title="Net Fees by Month"
          items={allMonths}
          selected={selectedMonths}
          onToggle={(m) => toggleFilter(selectedMonths, setSelectedMonths, m)}
          onClearAll={() => setSelectedMonths(new Set())}
          values={filterFees.month}
        />
        {activeFilterCount > 0 && (
          <button
            onClick={clearAllFilters}
            className="text-xs text-primary hover:underline flex items-center gap-0.5 ml-1"
            data-testid="wip-dash-clear-all-filters"
          >
            <X className="h-3 w-3" /> Reset filters
          </button>
        )}
      </div>

      {/* At-a-glance boards — same visuals as the full report's desktop
          layout; every element clicks to filter, shared with the dropdowns. */}
      <div className="hidden md:block space-y-3" data-testid="wip-dash-boards">
        {monthlyFees.length > 0 && (
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            <div className="bg-muted/50 border-b px-3 py-1.5 flex items-center justify-between">
              <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Net fees by month</span>
              <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded" style={{ backgroundColor: "#86efac" }} />WIP</span>
                <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded" style={{ backgroundColor: "#22c55e" }} />Invoiced</span>
                <span>click to filter</span>
              </div>
            </div>
            <div className="flex items-end gap-1 px-3 pt-2 pb-2">
              {(() => {
                const maxM = Math.max(...monthlyFees.map(m => m.total), 1);
                const colH = 84;
                return monthlyFees.map(m => {
                  const tappable = m.month !== "TBC";
                  const active = selectedMonths.has(m.month);
                  return (
                    <button
                      key={m.month}
                      disabled={!tappable}
                      className={`flex-1 min-w-0 flex flex-col items-center justify-end gap-1 rounded px-0.5 pt-1 pb-0.5 transition-colors ${active ? "bg-green-50 ring-1 ring-green-300" : tappable ? "hover:bg-muted" : ""}`}
                      onClick={() => tappable && toggleFilter(selectedMonths, setSelectedMonths, m.month)}
                      title={`${m.month} · ${formatCurrencyFull(m.total)} · ${m.count} deal${m.count !== 1 ? "s" : ""}`}
                      data-testid={`wip-dash-month-${m.month}`}
                    >
                      <span className="text-[10px] font-mono text-muted-foreground">{formatCurrencyBoard(m.total)}</span>
                      <div className="w-full max-w-[40px] flex flex-col justify-end rounded-t overflow-hidden" style={{ height: colH }}>
                        {m.wip > 0 && <div className="w-full" style={{ height: `${Math.max(2, (m.wip / maxM) * colH)}px`, backgroundColor: active ? "#16a34a" : "#86efac" }} />}
                        {m.invoiced > 0 && <div className="w-full" style={{ height: `${Math.max(2, (m.invoiced / maxM) * colH)}px`, backgroundColor: active ? "#15803d" : "#22c55e" }} />}
                      </div>
                      <span className={`text-[10px] whitespace-nowrap ${active ? "font-semibold text-foreground" : "text-muted-foreground"}`}>{m.month}</span>
                    </button>
                  );
                });
              })()}
            </div>
          </div>
        )}
        {stageMix.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {stageMix.map(s => {
              const code = legacyToCode(s.status);
              const label = code && code === s.status ? DEAL_STATUS_LABELS[code] : s.status;
              return (
                <Pill
                  key={s.status}
                  active={selectedStatuses.has(s.status)}
                  onClick={() => toggleFilter(selectedStatuses, setSelectedStatuses, s.status)}
                  className="shrink-0"
                  data-testid={`wip-dash-stage-${s.status}`}
                >
                  {label} · {formatCurrencyBoard(s.total)} · {s.count}
                </Pill>
              );
            })}
          </div>
        )}
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
          {([
            { key: "client", title: "Client", rows: feeBoards.client, selected: selectedClients, setter: setSelectedClients },
            { key: "project", title: "Property", rows: feeBoards.project, selected: selectedProjects, setter: setSelectedProjects },
            { key: "team", title: "Team", rows: feeBoards.team, selected: selectedTeams, setter: setSelectedTeams },
            { key: "agent", title: "BGP Contact", rows: feeBoards.agent, selected: selectedAgents, setter: setSelectedAgents },
          ] as const).map(board => {
            if (board.rows.length === 0) return null;
            const expanded = expandedBoards.has(board.key);
            const shown = expanded ? board.rows.slice(0, 60) : board.rows.slice(0, 6);
            const maxB = Math.max(...board.rows.map(r => r.total), 1);
            const boardTotal = board.rows.reduce((s, r) => s + r.total, 0);
            return (
              <div key={board.key} className="bg-card border border-border rounded-lg overflow-hidden flex flex-col" data-testid={`wip-dash-board-${board.key}`}>
                <div className="bg-muted/50 border-b px-3 py-1.5 flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Net fees by {board.title}</span>
                  <span className="text-[11px] font-mono text-muted-foreground">{formatCurrencyBoard(boardTotal)}</span>
                </div>
                <div className={`p-2 ${expanded ? "max-h-64 overflow-y-auto" : ""}`}>
                  {shown.map(r => {
                    const active = board.selected.has(r.name);
                    return (
                      <button
                        key={r.name}
                        className={`w-full rounded px-1.5 py-1 text-left transition-colors ${active ? "bg-green-50 ring-1 ring-green-300" : "hover:bg-muted"}`}
                        onClick={() => toggleFilter(board.selected, board.setter, r.name)}
                        data-testid={`wip-dash-${board.key}-row`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className={`text-xs truncate min-w-0 ${active ? "font-semibold text-foreground" : "text-foreground"}`}>{r.name}</span>
                          <span className="text-xs font-mono text-muted-foreground shrink-0">{formatCurrencyFull(r.total)}</span>
                        </div>
                        <div className="h-1 bg-muted rounded overflow-hidden mt-0.5">
                          <div className="h-full" style={{ width: `${Math.max(1, (r.total / maxB) * 100)}%`, backgroundColor: active ? "#16a34a" : "#86efac" }} />
                        </div>
                      </button>
                    );
                  })}
                </div>
                {board.rows.length > 6 && (
                  <button
                    className="w-full text-center text-[11px] text-primary py-1.5 border-t border-border"
                    onClick={() => setExpandedBoards(prev => {
                      const next = new Set(prev);
                      if (next.has(board.key)) next.delete(board.key); else next.add(board.key);
                      return next;
                    })}
                    data-testid={`wip-dash-board-${board.key}-more`}
                  >
                    {expanded ? "Show top 6" : `All ${Math.min(board.rows.length, 60)}${board.rows.length > 60 ? ` of ${board.rows.length}` : ""} →`}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="bg-card border border-border rounded-lg overflow-hidden flex-1 min-h-[260px] flex flex-col" data-testid="wip-dash-detail-table">
        <button
          onClick={() => setDetailOpen(prev => !prev)}
          className="w-full bg-muted/50 border-b px-3 py-1.5 flex items-center justify-between hover:bg-muted transition-colors"
          data-testid="wip-dash-detail-toggle"
        >
          <div>
            <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Deal Detail</span>
            <span className="text-[10px] text-muted-foreground ml-2">({sortedDetailEntries.length} rows)</span>
          </div>
          {detailOpen ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
        </button>
        {detailOpen && (
          <>
          {/* Phone: one card per deal (§7) — the 10-column table never ships
              below md. Deal ref links through; totals card closes the list. */}
          <div className="md:hidden divide-y divide-border max-h-[400px] overflow-y-auto" data-testid="wip-dash-mobile-cards">
            {sortedDetailEntries.map((e: any, i: number) => (
              <div key={e.id || i} className="px-3 py-2.5" data-testid={`wip-dash-card-${i}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    {e.dealId ? (
                      <Link href={`/deals/${e.dealId}`} className="text-sm font-medium text-primary hover:underline">{e.ref || "—"}</Link>
                    ) : (
                      <span className="text-sm font-medium">{e.ref || "—"}</span>
                    )}
                    {e.client && <span className="ml-1.5 text-xs text-muted-foreground">{e.client}</span>}
                  </div>
                  <span className="text-sm font-mono tabular-nums font-semibold shrink-0">{e.amtWip ? formatCurrencyFull(e.amtWip) : "—"}</span>
                </div>
                <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                  {[e.tenant, e.project].filter(Boolean).join(" · ") || "—"}
                </p>
                <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                  {e.month && (
                    <span className="text-[10px] border border-border rounded px-1.5 py-0.5 whitespace-nowrap text-muted-foreground font-mono">{e.month}</span>
                  )}
                  {e.dealStatus && (
                    <span className="text-[10px] border border-border rounded px-1.5 py-0.5 whitespace-nowrap text-muted-foreground">
                      {(() => { const code = legacyToCode(e.dealStatus); return code ? DEAL_STATUS_LABELS[code] : e.dealStatus; })()}
                    </span>
                  )}
                  {e.amtInvoice ? (
                    <span className="text-[10px] border border-border rounded px-1.5 py-0.5 whitespace-nowrap text-green-700 font-mono">Invoiced {formatCurrencyFull(e.amtInvoice)}</span>
                  ) : null}
                  {e.agent && (
                    <span className="text-[10px] text-muted-foreground ml-auto">
                      {(e.agent as string).split(",").map((a: string) => a.trim()).map((a: string) => a.includes(" ") ? a.split(" ").map((p: string) => p[0]).join("").toUpperCase() : a).join(", ")}
                    </span>
                  )}
                </div>
              </div>
            ))}
            <div className="px-3 py-2.5 bg-muted font-semibold text-xs space-y-0.5">
              <div className="flex items-center justify-between">
                <span>Total WIP</span>
                <span className="font-mono tabular-nums">{formatCurrencyFull(sortedDetailEntries.reduce((s, e) => s + (e.amtWip || 0), 0))}</span>
              </div>
              <div className="flex items-center justify-between text-green-700">
                <span>Total invoiced</span>
                <span className="font-mono tabular-nums">{formatCurrencyFull(sortedDetailEntries.reduce((s, e) => s + (e.amtInvoice || 0), 0))}</span>
              </div>
            </div>
          </div>
          <div className="hidden md:block overflow-x-auto flex-1 min-h-0 overflow-y-auto">
            <table className="w-full text-[11px]">
              <thead className="bg-muted/50 border-b sticky top-0 z-10">
                <tr>
                  {[
                    { key: "ref", label: "Deal", width: "w-28" },
                    { key: "client", label: "Client", width: "w-28" },
                    { key: "tenant", label: "Tenant", width: "w-28" },
                    { key: "project", label: "Property", width: "w-28" },
                    { key: "team", label: "Team", width: "w-32" },
                    { key: "agent", label: "BGP Contact", width: "w-20" },
                    { key: "amtWip", label: "Amt WIP", width: "w-20" },
                    { key: "amtInvoice", label: "Amt Invoice", width: "w-20" },
                    { key: "month", label: "Month", width: "w-14" },
                    { key: "dealStatus", label: "Deal Status", width: "w-20" },
                  ].map((col) => (
                    <th key={col.key} className={`px-2 py-1.5 text-left font-medium text-muted-foreground cursor-pointer hover:text-foreground ${col.width}`} onClick={() => toggleSort(col.key)}>
                      <div className="flex items-center gap-0.5">
                        {col.label}
                        <ArrowUpDown className="h-2.5 w-2.5" />
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {sortedDetailEntries.map((e: any, i: number) => (
                  <tr key={e.id || i} className="hover:bg-muted">
                    <td className="px-2 py-1 text-muted-foreground truncate max-w-[150px]">
                      {e.dealId ? (
                        <Link href={`/deals/${e.dealId}`} className="text-primary hover:underline text-[11px]">{e.ref}</Link>
                      ) : e.ref}
                    </td>
                    <td className="px-2 py-1 text-muted-foreground truncate max-w-[130px]">{e.client || "—"}</td>
                    <td className="px-2 py-1 text-muted-foreground truncate max-w-[130px]">{e.tenant || "—"}</td>
                    <td className="px-2 py-1 text-muted-foreground truncate max-w-[130px]">{e.project || "—"}</td>
                    <td className="px-2 py-1 text-muted-foreground truncate max-w-[160px]">{e.team || "—"}</td>
                    <td className="px-2 py-1 text-muted-foreground">{e.agent ? (e.agent as string).split(",").map((a: string) => a.trim()).map((a: string) => a.includes(" ") ? a.split(" ").map((p: string) => p[0]).join("").toUpperCase() : a).join(", ") : "—"}</td>
                    <td className="px-2 py-1 text-foreground font-mono">{e.amtWip ? formatCurrencyFull(e.amtWip) : "—"}</td>
                    <td className="px-2 py-1 text-green-700 font-mono">{e.amtInvoice ? formatCurrencyFull(e.amtInvoice) : "—"}</td>
                    <td className="px-2 py-1 text-muted-foreground">{e.month || "—"}</td>
                    <td className="px-2 py-1 text-muted-foreground truncate max-w-[100px]">{e.dealStatus || "—"}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-muted border-t font-semibold">
                <tr>
                  <td colSpan={6} className="px-2 py-1 text-foreground text-xs">Total</td>
                  <td className="px-2 py-1 text-foreground font-mono text-xs">{formatCurrencyFull(sortedDetailEntries.reduce((s, e) => s + (e.amtWip || 0), 0))}</td>
                  <td className="px-2 py-1 text-green-700 font-mono text-xs">{formatCurrencyFull(sortedDetailEntries.reduce((s, e) => s + (e.amtInvoice || 0), 0))}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
          </>
        )}
      </div>
    </Card>
  );
}
