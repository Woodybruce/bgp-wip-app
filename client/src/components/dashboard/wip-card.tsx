import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Link } from "wouter";
import { useState, useMemo, useCallback, useRef } from "react";
import { useTeam } from "@/lib/team-context";
import {
  BarChart3,
  ArrowRight,
  ArrowUpDown,
  X,
  Search,
  Filter,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import type { User } from "@shared/schema";
import { formatCurrencyShort, formatCurrencyFull, getWipMonthSortKey } from "./helpers";

function WipMiniSummaryTable({
  title, data, valueLabel, field, activeField, activeValue, onRowClick,
}: {
  title: string;
  data: Array<{ label: string; value: number }>;
  valueLabel: string;
  field: string;
  activeField: string | null;
  activeValue: string | null;
  onRowClick: (field: string, value: string) => void;
}) {
  const total = data.reduce((s, d) => s + d.value, 0);
  const isActive = activeField === field;

  return (
    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden" data-testid={`wip-dash-summary-${title.toLowerCase().replace(/\s/g, "-")}`}>
      <div className="bg-gray-50 border-b px-3 py-1.5 flex items-center justify-between">
        <span className="text-[11px] font-semibold text-gray-700 uppercase tracking-wide">{title}</span>
        <span className="text-[11px] font-semibold text-gray-500">{valueLabel}</span>
      </div>
      <div className="max-h-[260px] overflow-y-auto">
        <div className="divide-y divide-gray-100">
          {data.map((row) => {
            const rowActive = isActive && activeValue === row.label;
            return (
              <div
                key={row.label}
                className={`flex items-center justify-between px-3 py-1 text-xs cursor-pointer transition-colors ${
                  rowActive ? "bg-green-100 border-l-2 border-green-600" : "hover:bg-gray-50"
                }`}
                onClick={() => onRowClick(field, row.label)}
                data-testid={`wip-dash-click-${field}-${row.label}`}
              >
                <span className={`truncate flex-1 mr-1 ${rowActive ? "text-green-900 font-semibold" : "text-gray-800"}`}>{row.label}</span>
                <span className={`font-mono font-medium text-right whitespace-nowrap ${rowActive ? "text-green-900" : "text-gray-900"}`}>
                  {formatCurrencyFull(row.value)}
                </span>
              </div>
            );
          })}
        </div>
      </div>
      <div className="bg-gray-100 border-t px-3 py-1 flex items-center justify-between font-semibold text-xs">
        <span className="text-gray-800">Total</span>
        <span className="font-mono text-gray-900">{formatCurrencyFull(total)}</span>
      </div>
    </div>
  );
}

function WipMiniFilterSection({
  title, items, selected, onToggle, onSelectAll, onClearAll,
}: {
  title: string;
  items: string[];
  selected: Set<string>;
  onToggle: (item: string) => void;
  onSelectAll: () => void;
  onClearAll: () => void;
}) {
  const [searchTerm, setSearchTerm] = useState("");
  const filtered = searchTerm
    ? items.filter((i) => i.toLowerCase().includes(searchTerm.toLowerCase()))
    : items;

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden" data-testid={`wip-dash-filter-${title.toLowerCase().replace(/\s/g, "-")}`}>
      <div className="bg-gray-50 border-b px-2 py-1.5 flex items-center justify-between">
        <span className="text-[10px] font-semibold text-gray-700 uppercase tracking-wide">{title}</span>
        {selected.size < items.length && (
          <Badge variant="secondary" className="text-[9px] h-3.5 px-1">
            {selected.size}/{items.length}
          </Badge>
        )}
      </div>
      {items.length > 6 && (
        <div className="px-2 pt-1.5">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-gray-400" />
            <Input placeholder="Search..." className="h-5 text-[10px] pl-6" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
          </div>
        </div>
      )}
      <div className="px-2 pt-0.5 flex gap-2">
        <button onClick={onSelectAll} className="text-[9px] text-blue-600 hover:underline">Select all</button>
        <button onClick={onClearAll} className="text-[9px] text-blue-600 hover:underline">Clear</button>
      </div>
      <div className="max-h-[120px] overflow-y-auto px-2 py-0.5">
        {filtered.map((item) => (
          <label key={item} className="flex items-center gap-1.5 py-0.5 text-[10px] text-gray-700 cursor-pointer hover:text-gray-900">
            <Checkbox checked={selected.has(item)} onCheckedChange={() => onToggle(item)} className="h-3 w-3" />
            <span className="truncate">{item}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

export function WipDashboardCard({ user }: { user: User | undefined }) {
  const { activeTeam } = useTeam();
  const { data: wipResponse, isLoading } = useQuery<{ entries: any[]; isAdmin: boolean; userTeam: string | null }>({
    queryKey: ["/api/wip"],
    staleTime: 5 * 60 * 1000,
  });

  const wipEntries = Array.isArray(wipResponse) ? wipResponse : (wipResponse?.entries || []);
  const isWipAdmin = Array.isArray(wipResponse) ? false : (wipResponse?.isAdmin || false);
  const wipUserTeam = Array.isArray(wipResponse) ? null : (wipResponse?.userTeam || null);

  const selectedTeam = isWipAdmin
    ? (activeTeam === "all" ? "all" : (activeTeam || user?.team || "Investment"))
    : (wipUserTeam || user?.team || "Investment");
  const isAllTeams = isWipAdmin && activeTeam === "all";

  const teamEntries = useMemo(() => {
    if (wipEntries.length === 0) return [];
    if (!isWipAdmin) return wipEntries;
    if (activeTeam === "all") return wipEntries;
    const at = (activeTeam || "").toLowerCase();
    if (!at) return wipEntries;
    return wipEntries.filter((e: any) => {
      if (!e.team) return false;
      const teams = (e.team as string).split(",").map((t: string) => t.trim().toLowerCase());
      return teams.some(t => t === at);
    });
  }, [wipEntries, activeTeam, isWipAdmin]);

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

  const allStatuses = useMemo(() => {
    const set = new Set(teamEntries.map(e => e.dealStatus).filter(Boolean) as string[]);
    return [...set].sort();
  }, [teamEntries]);

  const [selectedMonths, setSelectedMonths] = useState<Set<string>>(new Set());
  const [selectedAgents, setSelectedAgents] = useState<Set<string>>(new Set());
  const [selectedStatuses, setSelectedStatuses] = useState<Set<string>>(new Set());
  const [detailSort, setDetailSort] = useState<{ column: string; direction: "asc" | "desc" }>({ column: "amtWip", direction: "desc" });
  const [detailOpen, setDetailOpen] = useState(false);
  const [clickFilterField, setClickFilterField] = useState<string | null>(null);
  const [clickFilterValue, setClickFilterValue] = useState<string | null>(null);

  const handleClickFilter = useCallback((field: string, value: string) => {
    if (clickFilterField === field && clickFilterValue === value) {
      setClickFilterField(null);
      setClickFilterValue(null);
    } else {
      setClickFilterField(field);
      setClickFilterValue(value);
    }
  }, [clickFilterField, clickFilterValue]);

  const prevTeamRef = useRef<string | null>(null);
  if (teamEntries.length > 0 && prevTeamRef.current !== selectedTeam) {
    prevTeamRef.current = selectedTeam;
    setSelectedMonths(new Set(allMonths));
    setSelectedAgents(new Set(allAgents));
    setSelectedStatuses(new Set(allStatuses));
    setClickFilterField(null);
    setClickFilterValue(null);
  }

  const filteredEntries = useMemo(() => {
    return teamEntries.filter(e => {
      if (selectedMonths.size > 0 && selectedMonths.size < allMonths.length) {
        if (!e.month || !selectedMonths.has(e.month)) return false;
      }
      if (selectedAgents.size > 0 && selectedAgents.size < allAgents.length) {
        if (!e.agent) return false;
        const agentParts = (e.agent as string).split(",").map((a: string) => a.trim()).filter(Boolean);
        if (!agentParts.some((a: string) => selectedAgents.has(a))) return false;
      }
      if (selectedStatuses.size > 0 && selectedStatuses.size < allStatuses.length) {
        if (!e.dealStatus || !selectedStatuses.has(e.dealStatus)) return false;
      }
      if (clickFilterField && clickFilterValue) {
        if (clickFilterField === "agent") {
          if (!e.agent) return false;
          const agentParts = (e.agent as string).split(",").map((a: string) => a.trim()).filter(Boolean);
          if (!agentParts.some((a: string) => a === clickFilterValue)) return false;
        } else {
          const fieldMap: Record<string, string> = {
            groupName: e.groupName || "Other",
            team: e.team || "Other",
            project: e.project || "Other",
            dealStatus: e.dealStatus || "",
          };
          if (fieldMap[clickFilterField] !== clickFilterValue) return false;
        }
      }
      return true;
    });
  }, [teamEntries, selectedMonths, selectedAgents, selectedStatuses, allMonths.length, allAgents.length, allStatuses.length, clickFilterField, clickFilterValue]);

  const totalNetFees = useMemo(
    () => filteredEntries.reduce((s, e) => s + (e.amtWip || 0) + (e.amtInvoice || 0), 0),
    [filteredEntries],
  );

  const groupData = useMemo(() => {
    const map: Record<string, number> = {};
    filteredEntries.forEach(e => {
      const g = e.groupName || "Other";
      map[g] = (map[g] || 0) + (e.amtWip || 0) + (e.amtInvoice || 0);
    });
    return Object.entries(map).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  }, [filteredEntries]);

  const teamData = useMemo(() => {
    const map: Record<string, number> = {};
    filteredEntries.forEach(e => {
      const t = e.team || "Other";
      map[t] = (map[t] || 0) + (e.amtWip || 0) + (e.amtInvoice || 0);
    });
    return Object.entries(map).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  }, [filteredEntries]);

  const agentData = useMemo(() => {
    const map: Record<string, number> = {};
    filteredEntries.forEach(e => {
      const agentField = e.agent || "Other";
      const agents = (agentField as string).split(",").map((a: string) => a.trim()).filter(Boolean);
      const fee = (e.amtWip || 0) + (e.amtInvoice || 0);
      if (agents.length === 0) {
        map["Other"] = (map["Other"] || 0) + fee;
      } else {
        const perAgent = fee / agents.length;
        agents.forEach(a => {
          map[a] = (map[a] || 0) + perAgent;
        });
      }
    });
    return Object.entries(map).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  }, [filteredEntries]);

  const projectData = useMemo(() => {
    const map: Record<string, { value: number; txns: number }> = {};
    filteredEntries.forEach(e => {
      const p = e.project || "Other";
      if (!map[p]) map[p] = { value: 0, txns: 0 };
      map[p].value += (e.amtWip || 0) + (e.amtInvoice || 0);
      map[p].txns += 1;
    });
    return Object.entries(map).map(([label, d]) => ({ label, value: d.value, txns: d.txns })).sort((a, b) => b.value - a.value);
  }, [filteredEntries]);

  const statusData = useMemo(() => {
    const map: Record<string, number> = {};
    filteredEntries.forEach(e => {
      if (!e.dealStatus) return;
      map[e.dealStatus] = (map[e.dealStatus] || 0) + (e.amtWip || 0) + (e.amtInvoice || 0);
    });
    return Object.entries(map).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  }, [filteredEntries]);

  const monthChartData = useMemo(() => {
    const map: Record<string, number> = {};
    filteredEntries.forEach(e => {
      if (!e.month) return;
      map[e.month] = (map[e.month] || 0) + (e.amtWip || 0) + (e.amtInvoice || 0);
    });
    const colors = ["#4a7c59", "#5a8f6a", "#6ba27b", "#7cb58c", "#8dc89d", "#9edcae", "#73946d", "#5e7d58", "#4f6b49", "#8aad82", "#a3c49b", "#bcdbb4"];
    return Object.entries(map)
      .map(([label, value], i) => ({ label, value, color: colors[i % colors.length] }))
      .sort((a, b) => getWipMonthSortKey(b.label) - getWipMonthSortKey(a.label));
  }, [filteredEntries]);

  const sortedDetailEntries = useMemo(() => {
    const sorted = [...filteredEntries];
    sorted.sort((a, b) => {
      let aVal: any, bVal: any;
      switch (detailSort.column) {
        case "ref": aVal = a.ref || ""; bVal = b.ref || ""; break;
        case "groupName": aVal = a.groupName || ""; bVal = b.groupName || ""; break;
        case "project": aVal = a.project || ""; bVal = b.project || ""; break;
        case "tenant": aVal = a.tenant || ""; bVal = b.tenant || ""; break;
        case "team": aVal = a.team || ""; bVal = b.team || ""; break;
        case "agent": aVal = a.agent || ""; bVal = b.agent || ""; break;
        case "amtWip": aVal = a.amtWip || 0; bVal = b.amtWip || 0; break;
        case "month": aVal = getWipMonthSortKey(a.month || ""); bVal = getWipMonthSortKey(b.month || ""); break;
        case "dealStatus": aVal = a.dealStatus || ""; bVal = b.dealStatus || ""; break;
        default: aVal = 0; bVal = 0;
      }
      if (typeof aVal === "string") return detailSort.direction === "asc" ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      return detailSort.direction === "asc" ? aVal - bVal : bVal - aVal;
    });
    return sorted;
  }, [filteredEntries, detailSort]);

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
    (selectedMonths.size < allMonths.length ? 1 : 0) +
    (selectedAgents.size < allAgents.length ? 1 : 0) +
    (selectedStatuses.size < allStatuses.length ? 1 : 0);

  const maxMonthValue = Math.max(...monthChartData.map(d => d.value), 1);
  const displayTeam = isAllTeams ? "All Teams" : selectedTeam;
  const title = `WIP Report — ${displayTeam}`;

  if (isLoading) {
    return (
      <div className="space-y-3 pb-6" data-testid="wip-dashboard-card">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-3 gap-3"><Skeleton className="h-48" /><Skeleton className="h-48" /><Skeleton className="h-48" /></div>
      </div>
    );
  }

  if (wipEntries.length === 0) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-8 text-center" data-testid="wip-dashboard-card">
        <BarChart3 className="w-8 h-8 mx-auto mb-2 text-gray-300" />
        <p className="text-sm text-gray-500">No deals with fees found</p>
        <p className="text-xs text-gray-400 mt-1">Add fees to deals on the WIP board to see data here</p>
        <Link href="/wip-report">
          <Button variant="outline" size="sm" className="mt-3" data-testid="link-wip-upload">
            Go to WIP Report <ArrowRight className="w-3.5 h-3.5 ml-1" />
          </Button>
        </Link>
      </div>
    );
  }

  if (teamEntries.length === 0) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-8 text-center" data-testid="wip-dashboard-card">
        <BarChart3 className="w-8 h-8 mx-auto mb-2 text-gray-300" />
        <p className="text-sm text-gray-500">No WIP entries found for {displayTeam}</p>
        <p className="text-xs text-gray-400 mt-1">Try selecting a different team</p>
      </div>
    );
  }

  return (
    <div className="space-y-3 pb-6" data-testid="wip-dashboard-card">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold text-gray-900" data-testid="wip-dash-title">{title}</h2>
          <p className="text-xs text-gray-500">
            {filteredEntries.length} transactions · Total net fees: {formatCurrencyFull(totalNetFees)}
          </p>
        </div>
        <Link href="/wip-report">
          <Button variant="outline" size="sm" data-testid="link-wip-report">
            Full Report <ArrowRight className="w-3.5 h-3.5 ml-1" />
          </Button>
        </Link>
      </div>

      <div className="flex gap-3">
        <div className="flex-1 space-y-3 min-w-0">
          {clickFilterField && (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-gray-500">Filtered by <span className="font-semibold text-gray-800">{clickFilterField === "groupName" ? "Group" : clickFilterField === "dealStatus" ? "Status" : clickFilterField.charAt(0).toUpperCase() + clickFilterField.slice(1)}</span>: <span className="font-semibold text-green-700">{clickFilterValue}</span></span>
              <button onClick={() => { setClickFilterField(null); setClickFilterValue(null); }} className="text-gray-400 hover:text-gray-700" data-testid="wip-dash-clear-filter">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <WipMiniSummaryTable title="Group" data={groupData} valueLabel="Net fees" field="groupName" activeField={clickFilterField} activeValue={clickFilterValue} onRowClick={handleClickFilter} />
            {isAllTeams ? (
              <WipMiniSummaryTable title="Team" data={teamData} valueLabel="Net fees" field="team" activeField={clickFilterField} activeValue={clickFilterValue} onRowClick={handleClickFilter} />
            ) : (
              <WipMiniSummaryTable title="Deal Status" data={statusData} valueLabel="Net fees" field="dealStatus" activeField={clickFilterField} activeValue={clickFilterValue} onRowClick={handleClickFilter} />
            )}
            <WipMiniSummaryTable title="Agent" data={agentData} valueLabel="Net fees" field="agent" activeField={clickFilterField} activeValue={clickFilterValue} onRowClick={handleClickFilter} />
          </div>

          <div className={`grid grid-cols-1 ${isAllTeams ? "md:grid-cols-3" : "md:grid-cols-2"} gap-3`}>
            <WipMiniSummaryTable title="Project" data={projectData} valueLabel="Net fees" field="project" activeField={clickFilterField} activeValue={clickFilterValue} onRowClick={handleClickFilter} />
            {isAllTeams && <WipMiniSummaryTable title="Deal Status" data={statusData} valueLabel="Net fees" field="dealStatus" activeField={clickFilterField} activeValue={clickFilterValue} onRowClick={handleClickFilter} />}
            <div className="bg-white border border-gray-200 rounded-lg p-2.5">
              <div className="bg-gray-50 border-b -mx-2.5 -mt-2.5 px-3 py-1.5 mb-2 rounded-t-lg">
                <span className="text-[11px] font-semibold text-gray-700 uppercase tracking-wide">Net Fees by Month</span>
              </div>
              <div className="space-y-1">
                {monthChartData.map((d) => (
                  <div key={d.label} className="flex items-center gap-1.5">
                    <span className="text-[10px] text-gray-600 w-12 text-right flex-shrink-0">{d.label}</span>
                    <div className="flex-1 h-4 bg-gray-100 rounded overflow-hidden relative">
                      <div className="h-full rounded transition-all duration-500" style={{ width: `${Math.max(1, (d.value / maxMonthValue) * 100)}%`, backgroundColor: d.color }} />
                    </div>
                    <span className="text-[10px] font-mono text-gray-700 w-12 text-right flex-shrink-0">{formatCurrencyShort(d.value)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden" data-testid="wip-dash-detail-table">
            <button
              onClick={() => setDetailOpen(prev => !prev)}
              className="w-full bg-gray-50 border-b px-3 py-1.5 flex items-center justify-between hover:bg-gray-100 transition-colors"
              data-testid="wip-dash-detail-toggle"
            >
              <div>
                <span className="text-[11px] font-semibold text-gray-700 uppercase tracking-wide">Transaction Detail</span>
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
                        { key: "ref", label: "Ref", width: "w-14" },
                        { key: "groupName", label: "Group", width: "w-28" },
                        { key: "project", label: "Project", width: "w-28" },
                        { key: "tenant", label: "Tenant", width: "w-28" },
                        { key: "team", label: "Team", width: "w-36" },
                        { key: "agent", label: "Agent", width: "w-10" },
                        { key: "amtWip", label: "Amt WIP", width: "w-20" },
                        { key: "amtInvoice", label: "Amt Invoice", width: "w-20" },
                        { key: "month", label: "Month", width: "w-14" },
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
                        <td className="px-2 py-1 text-gray-700">
                          {e.dealId ? (
                            <Link href={`/deals/${e.dealId}`} className="text-blue-600 hover:underline text-[11px]">{e.ref}</Link>
                          ) : e.ref}
                        </td>
                        <td className="px-2 py-1 text-gray-700 truncate max-w-[130px]">{e.groupName || "—"}</td>
                        <td className="px-2 py-1 text-gray-700 truncate max-w-[130px]">{e.project || "—"}</td>
                        <td className="px-2 py-1 text-gray-700 truncate max-w-[130px]">{e.tenant || "—"}</td>
                        <td className="px-2 py-1 text-gray-700 truncate max-w-[160px]">{e.team || "—"}</td>
                        <td className="px-2 py-1 text-gray-700">{e.agent || "—"}</td>
                        <td className="px-2 py-1 text-gray-900 font-mono text-right">{e.amtWip ? formatCurrencyFull(e.amtWip) : "—"}</td>
                        <td className="px-2 py-1 text-green-700 font-mono text-right">{e.amtInvoice ? formatCurrencyFull(e.amtInvoice) : "—"}</td>
                        <td className="px-2 py-1 text-gray-600">{e.month || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-gray-100 border-t font-semibold">
                    <tr>
                      <td colSpan={6} className="px-2 py-1 text-gray-800 text-xs">Total</td>
                      <td className="px-2 py-1 text-gray-900 font-mono text-right text-xs">{formatCurrencyFull(sortedDetailEntries.reduce((s, e) => s + (e.amtWip || 0), 0))}</td>
                      <td className="px-2 py-1 text-green-700 font-mono text-right text-xs">{formatCurrencyFull(sortedDetailEntries.reduce((s, e) => s + (e.amtInvoice || 0), 0))}</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        </div>

        <div className="w-44 flex-shrink-0 self-start space-y-2" data-testid="wip-dash-filters">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold text-gray-700 uppercase tracking-wide flex items-center gap-1">
              <Filter className="h-3 w-3" /> Filters
            </span>
            {activeFilterCount > 0 && (
              <button
                onClick={() => {
                  setSelectedMonths(new Set(allMonths));
                  setSelectedAgents(new Set(allAgents));
                  setSelectedStatuses(new Set(allStatuses));
                }}
                className="text-[9px] text-blue-600 hover:underline flex items-center gap-0.5"
              >
                <X className="h-2.5 w-2.5" /> Reset
              </button>
            )}
          </div>

          <WipMiniFilterSection
            title="Month"
            items={allMonths}
            selected={selectedMonths}
            onToggle={(m) => toggleFilter(selectedMonths, setSelectedMonths, m)}
            onSelectAll={() => setSelectedMonths(new Set(allMonths))}
            onClearAll={() => setSelectedMonths(new Set())}
          />

          <WipMiniFilterSection
            title="Agent"
            items={allAgents}
            selected={selectedAgents}
            onToggle={(a) => toggleFilter(selectedAgents, setSelectedAgents, a)}
            onSelectAll={() => setSelectedAgents(new Set(allAgents))}
            onClearAll={() => setSelectedAgents(new Set())}
          />

          <WipMiniFilterSection
            title="Deal Status"
            items={allStatuses}
            selected={selectedStatuses}
            onToggle={(s) => toggleFilter(selectedStatuses, setSelectedStatuses, s)}
            onSelectAll={() => setSelectedStatuses(new Set(allStatuses))}
            onClearAll={() => setSelectedStatuses(new Set())}
          />
        </div>
      </div>
    </div>
  );
}
