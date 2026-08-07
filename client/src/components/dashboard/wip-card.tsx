import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { useState, useMemo, useRef } from "react";
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
import { formatCurrencyFull, getWipMonthSortKey } from "./helpers";

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

  const filteredEntries = useMemo(() => {
    return teamEntries.filter(e => {
      if (selectedClients.size > 0) {
        if (!e.client || !selectedClients.has(e.client)) return false;
      }
      if (selectedTeams.size > 0) {
        if (!e.team) return false;
        const entryTeams = (e.team as string).split(",").map((t: string) => t.trim()).filter(Boolean);
        if (!entryTeams.some((t: string) => selectedTeams.has(t))) return false;
      }
      if (selectedMonths.size > 0) {
        if (!e.month || !selectedMonths.has(e.month)) return false;
      }
      if (selectedAgents.size > 0) {
        if (!e.agent) return false;
        const agentParts = (e.agent as string).split(",").map((a: string) => a.trim()).filter(Boolean);
        if (!agentParts.some((a: string) => selectedAgents.has(a))) return false;
      }
      if (selectedProjects.size > 0) {
        if (!e.project || !selectedProjects.has(e.project)) return false;
      }
      if (selectedStatuses.size > 0) {
        if (!e.dealStatus || !selectedStatuses.has(e.dealStatus)) return false;
      }
      return true;
    });
  }, [teamEntries, selectedClients, selectedTeams, selectedMonths, selectedAgents, selectedProjects, selectedStatuses]);

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
      <Card className="p-4 space-y-3" data-testid="wip-dashboard-card">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-48 w-full" />
      </Card>
    );
  }

  if (wipEntries.length === 0) {
    return (
      <Card className="p-8 text-center" data-testid="wip-dashboard-card">
        <BarChart3 className="w-8 h-8 mx-auto mb-2 text-gray-300" />
        <p className="text-sm text-gray-500">No deals with fees found</p>
        <p className="text-xs text-gray-400 mt-1">Add fees to deals on the WIP board to see data here</p>
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
      <Card className="p-8 text-center" data-testid="wip-dashboard-card">
        <BarChart3 className="w-8 h-8 mx-auto mb-2 text-gray-300" />
        <p className="text-sm text-gray-500">No WIP entries found for {displayTeam}</p>
        <p className="text-xs text-gray-400 mt-1">Try selecting a different team</p>
      </Card>
    );
  }

  return (
    <Card className="p-4 space-y-3" data-testid="wip-dashboard-card">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold text-gray-900" data-testid="wip-dash-title">{title}</h2>
          <p className="text-xs text-gray-500">
            {mergedDetailEntries.length} deal{mergedDetailEntries.length !== 1 ? "s" : ""} · Total net fees: {formatCurrencyFull(totalNetFees)}
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
            const code = legacyToCode(s);
            return code ? DEAL_STATUS_LABELS[code] : s;
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
            className="text-xs text-blue-600 hover:underline flex items-center gap-0.5 ml-1"
            data-testid="wip-dash-clear-all-filters"
          >
            <X className="h-3 w-3" /> Reset filters
          </button>
        )}
      </div>

      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden" data-testid="wip-dash-detail-table">
        <button
          onClick={() => setDetailOpen(prev => !prev)}
          className="w-full bg-gray-50 border-b px-3 py-1.5 flex items-center justify-between hover:bg-gray-100 transition-colors"
          data-testid="wip-dash-detail-toggle"
        >
          <div>
            <span className="text-[11px] font-semibold text-gray-700 uppercase tracking-wide">Deal Detail</span>
            <span className="text-[10px] text-gray-500 ml-2">({sortedDetailEntries.length} rows)</span>
          </div>
          {detailOpen ? <ChevronUp className="h-4 w-4 text-gray-500" /> : <ChevronDown className="h-4 w-4 text-gray-500" />}
        </button>
        {detailOpen && (
          <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
            <table className="w-full text-[11px]">
              <thead className="bg-gray-50 border-b sticky top-0 z-10">
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
                    <th key={col.key} className={`px-2 py-1.5 text-left font-medium text-gray-600 cursor-pointer hover:text-gray-900 ${col.width}`} onClick={() => toggleSort(col.key)}>
                      <div className="flex items-center gap-0.5">
                        {col.label}
                        <ArrowUpDown className="h-2.5 w-2.5" />
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {sortedDetailEntries.map((e: any, i: number) => (
                  <tr key={e.id || i} className="hover:bg-gray-50">
                    <td className="px-2 py-1 text-gray-700 truncate max-w-[150px]">
                      {e.dealId ? (
                        <Link href={`/deals/${e.dealId}`} className="text-blue-600 hover:underline text-[11px]">{e.ref}</Link>
                      ) : e.ref}
                    </td>
                    <td className="px-2 py-1 text-gray-700 truncate max-w-[130px]">{e.client || "—"}</td>
                    <td className="px-2 py-1 text-gray-700 truncate max-w-[130px]">{e.tenant || "—"}</td>
                    <td className="px-2 py-1 text-gray-700 truncate max-w-[130px]">{e.project || "—"}</td>
                    <td className="px-2 py-1 text-gray-700 truncate max-w-[160px]">{e.team || "—"}</td>
                    <td className="px-2 py-1 text-gray-700">{e.agent ? (e.agent as string).split(",").map((a: string) => a.trim()).map((a: string) => a.includes(" ") ? a.split(" ").map((p: string) => p[0]).join("").toUpperCase() : a).join(", ") : "—"}</td>
                    <td className="px-2 py-1 text-gray-900 font-mono">{e.amtWip ? formatCurrencyFull(e.amtWip) : "—"}</td>
                    <td className="px-2 py-1 text-green-700 font-mono">{e.amtInvoice ? formatCurrencyFull(e.amtInvoice) : "—"}</td>
                    <td className="px-2 py-1 text-gray-600">{e.month || "—"}</td>
                    <td className="px-2 py-1 text-gray-600 truncate max-w-[100px]">{e.dealStatus || "—"}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-gray-100 border-t font-semibold">
                <tr>
                  <td colSpan={6} className="px-2 py-1 text-gray-800 text-xs">Total</td>
                  <td className="px-2 py-1 text-gray-900 font-mono text-xs">{formatCurrencyFull(sortedDetailEntries.reduce((s, e) => s + (e.amtWip || 0), 0))}</td>
                  <td className="px-2 py-1 text-green-700 font-mono text-xs">{formatCurrencyFull(sortedDetailEntries.reduce((s, e) => s + (e.amtInvoice || 0), 0))}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </Card>
  );
}
