import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { toDateInputValue } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Printer,
  Search,
  ArrowUpDown,
  Filter,
  X,
  Upload,
  Loader2,
  Link2,
  Plus,
  Download,
} from "lucide-react";
import { ScrollableTable } from "@/components/scrollable-table";
import bgpLogo from "@assets/BGP_WhiteHolder.png_-_new_1771853582466.png";
import { useTeam } from "@/lib/team-context";
import { useBrand } from "@/lib/brand-context";
import { Link } from "wouter";
import { apiRequest, getAuthHeaders, invalidateDealCaches } from "@/lib/queryClient";
import { RefreshCw } from "lucide-react";
import { legacyToCode, WIP_STATUSES } from "@shared/deal-status";
import { Skeleton } from "@/components/ui/skeleton";
import { SortableTableHead } from "@/components/sortable-table-head";
import { useTableSort } from "@/hooks/use-table-sort";

type SortDirection = "asc" | "desc";

interface WipDealEntry {
  id: string;
  dealId: string;
  dealRef?: number | null;
  dealType: string | null;
  ref: string;
  groupName: string | null;
  // Resolved counterparty name (landlord → vendor → purchaser fallback)
  // — this is the "Client" the WIP filter card and drilldown column show.
  client: string | null;
  project: string | null;
  tenant: string | null;
  billingEntity: string | null;
  team: string | null;
  agent: string | null;
  assetClass: string | null;
  amtWip: number | null;
  amtInvoice: number | null;
  month: string | null;
  instructedAt: string | null;
  targetDate: string | null;
  exchangedAt: string | null;
  completedAt: string | null;
  invoicedAt: string | null;
  dealStatus: string | null;
  stage: string | null;
  invoiceNo: string | null;
  orderNumber: string | null;
  fiscalYear: number | null;
  source?: "crm" | "spreadsheet";
}

const DEAL_TYPE_BADGE_COLORS: Record<string, string> = {
  // Legacy — still exist in older deals
  "Acquisition": "bg-blue-100 text-blue-800",
  "Leasing": "bg-green-100 text-green-800",
  "Investment": "bg-indigo-100 text-indigo-800",
  "Lease Advisory": "bg-cyan-100 text-cyan-800",
  // Current types
  "Sale": "bg-red-100 text-red-800",
  "Purchase": "bg-emerald-100 text-emerald-800",
  "Investment Sale": "bg-red-200 text-red-900",
  "Investment Acquisition": "bg-indigo-200 text-indigo-900",
  "Lease Renewal": "bg-purple-100 text-purple-800",
  "Rent Review": "bg-orange-100 text-orange-800",
  "Tenant Rep": "bg-rose-100 text-rose-800",
  "Lease Acquisition": "bg-violet-100 text-violet-800",
  "Lease Disposal": "bg-amber-100 text-amber-800",
  "Regear": "bg-teal-100 text-teal-800",
  "New Letting": "bg-lime-100 text-lime-800",
  "Sub-Letting": "bg-sky-100 text-sky-800",
  "Temp Lease": "bg-cyan-100 text-cyan-800",
  "Assignment": "bg-slate-100 text-slate-800",
};

type ClickFilter = {
  field: "client" | "groupName" | "team" | "agent" | "project" | "dealStatus" | "month";
  value: string;
} | null;

function formatCurrency(value: number): string {
  if (value >= 1_000_000) return `£${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `£${(value / 1_000).toFixed(0)}K`;
  return `£${value.toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function formatFullCurrency(value: number): string {
  return `£${value.toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function parseMonth(m: string): { monthNum: number; calendarYear: number } | null {
  const parts = m.split("-");
  if (parts.length !== 2) return null;
  const monthNames: Record<string, number> = {
    Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6,
    Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12,
  };
  const monthNum = monthNames[parts[0]];
  const yr = parseInt(parts[1]);
  if (!monthNum || isNaN(yr)) return null;
  const calendarYear = yr < 50 ? 2000 + yr : 1900 + yr;
  return { monthNum, calendarYear };
}

function getFiscalYear(m: string | null | undefined): number | null {
  if (!m) return null;
  const parsed = parseMonth(m);
  if (!parsed) return null;
  return parsed.monthNum >= 4 ? parsed.calendarYear + 1 : parsed.calendarYear;
}

function getCurrentFiscalYear(): number {
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  return month >= 4 ? year + 1 : year;
}

function getMonthSortKey(m: string): number {
  const parsed = parseMonth(m);
  if (!parsed) return 99;
  const fyMonth = parsed.monthNum >= 4 ? parsed.monthNum - 4 : parsed.monthNum + 8;
  return parsed.calendarYear * 12 + fyMonth;
}

function ClickableSummaryTable({
  title,
  data,
  valueLabel,
  activeValue,
  onRowClick,
  field,
  overrideTotal,
}: {
  title: string;
  data: Array<{ label: string; value: number; clickValue?: string }>;
  valueLabel: string;
  activeValue: string | null;
  onRowClick: (field: string, value: string) => void;
  field: string;
  overrideTotal?: number;
}) {
  const total = overrideTotal ?? data.reduce((s, d) => s + d.value, 0);

  return (
    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden" data-testid={`wip-summary-${title.toLowerCase().replace(/\s/g, "-")}`}>
      <div className="bg-gray-50 border-b px-3 py-2 flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-700 uppercase tracking-wide">{title}</span>
        <span className="text-xs font-semibold text-gray-500">{valueLabel}</span>
      </div>
      <div className="max-h-[400px] overflow-y-auto">
        <div className="divide-y divide-gray-100">
          {data.map((row) => {
            const cv = row.clickValue ?? row.label;
            return (
              <div
                key={cv}
                className={`flex items-center justify-between px-3 py-1.5 text-sm cursor-pointer transition-colors ${
                  activeValue === cv
                    ? "bg-primary/8 border-l-2 border-primary"
                    : "hover:bg-muted/50"
                }`}
                onClick={() => onRowClick(field, cv)}
                data-testid={`wip-click-${field}-${cv}`}
              >
                <span className={`truncate flex-1 mr-1 ${activeValue === cv ? "text-foreground font-semibold" : "text-gray-800"}`}>
                  {row.label}
                </span>
                <span className={`font-mono font-medium text-right whitespace-nowrap ${activeValue === cv ? "text-foreground" : "text-gray-900"}`}>
                  {formatFullCurrency(row.value)}
                </span>
              </div>
            );
          })}
        </div>
      </div>
      <div className="bg-gray-100 border-t px-3 py-1.5 flex items-center justify-between font-semibold text-sm">
        <span className="text-gray-800">Total</span>
        <span className="font-mono text-gray-900">{formatFullCurrency(total)}</span>
      </div>
    </div>
  );
}

function HorizontalBarChart({
  data,
  maxValue,
  activeValue,
  onBarClick,
}: {
  data: Array<{ label: string; value: number; color: string }>;
  maxValue: number;
  activeValue: string | null;
  onBarClick: (field: string, value: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      {data.map((d) => (
        <div
          key={d.label}
          className={`flex items-center gap-2 cursor-pointer rounded px-1 transition-colors ${
            activeValue === d.label ? "bg-green-50" : "hover:bg-gray-50"
          }`}
          onClick={() => onBarClick("month", d.label)}
          data-testid={`wip-click-month-${d.label}`}
        >
          <span className="text-xs text-gray-600 w-14 text-right flex-shrink-0">{d.label}</span>
          <div className="flex-1 h-5 bg-gray-100 rounded overflow-hidden relative">
            <div
              className="h-full rounded transition-all duration-500"
              style={{
                width: `${Math.max(1, (d.value / maxValue) * 100)}%`,
                backgroundColor: activeValue === d.label ? "#16a34a" : d.color,
              }}
            />
          </div>
          <span className="text-xs font-mono text-gray-700 w-14 text-right flex-shrink-0">
            {formatCurrency(d.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

function FilterSection({
  title,
  items,
  selected,
  onToggle,
  onSelectAll,
  onClearAll,
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
    <div className="border border-gray-200 rounded-lg overflow-hidden" data-testid={`wip-filter-${title.toLowerCase().replace(/\s/g, "-")}`}>
      <div className="bg-gray-50 border-b px-3 py-2 flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-700 uppercase tracking-wide">{title}</span>
        {selected.size < items.length && (
          <Badge variant="secondary" className="text-[10px] h-4 px-1">
            {selected.size}/{items.length}
          </Badge>
        )}
      </div>
      {items.length > 6 && (
        <div className="px-2 pt-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-gray-400" />
            <Input
              placeholder="Search..."
              className="h-6 text-xs pl-6"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              data-testid={`wip-filter-search-${title.toLowerCase().replace(/\s/g, "-")}`}
            />
          </div>
        </div>
      )}
      <div className="px-2 pt-1 flex gap-2">
        <button onClick={onSelectAll} className="text-[10px] text-blue-600 hover:underline" data-testid={`wip-filter-selectall-${title.toLowerCase()}`}>
          Select all
        </button>
        <button onClick={onClearAll} className="text-[10px] text-blue-600 hover:underline" data-testid={`wip-filter-clearall-${title.toLowerCase()}`}>
          Clear
        </button>
      </div>
      <div className="max-h-[220px] overflow-y-auto px-2 py-1">
        {filtered.map((item) => (
          <label
            key={item}
            className="flex items-center gap-2 py-0.5 text-xs text-gray-700 cursor-pointer hover:text-gray-900"
          >
            <Checkbox
              checked={selected.has(item)}
              onCheckedChange={() => onToggle(item)}
              className="h-3 w-3"
              data-testid={`wip-filter-checkbox-${title.toLowerCase()}-${item}`}
            />
            <span className="truncate">{item}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

interface AgentSummaryRow {
  agent: string;
  invoiced: number;
  wip: number;
}

interface AgentDrilldownRow {
  dealId: string;
  name: string;
  property: string | null;
  tenant: string | null;
  dealType: string | null;
  totalFee: number;
  allocatedAmount: number;
  status: string | null;
  stage: string;
  team: string;
  isInvoiced: boolean;
  wip: number;
  invoiced: number;
}

function AgentSummaryTab() {
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const summarySort = useTableSort<AgentSummaryRow>(null, "asc");
  const drillSort = useTableSort<AgentDrilldownRow>(null, "asc");

  const { data: summaryData, isLoading } = useQuery<AgentSummaryRow[]>({
    queryKey: ["/api/wip/agent-summary"],
    queryFn: async () => {
      const res = await fetch("/api/wip/agent-summary", { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to fetch agent summary");
      return res.json();
    },
  });

  const { data: drilldownData, isLoading: drilldownLoading } = useQuery<AgentDrilldownRow[]>({
    queryKey: ["/api/wip/agent-drilldown", selectedAgent],
    queryFn: async () => {
      if (!selectedAgent) return [];
      const res = await fetch(`/api/wip/agent-drilldown/${encodeURIComponent(selectedAgent)}`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to fetch agent drilldown");
      return res.json();
    },
    enabled: !!selectedAgent,
  });

  const agentsRaw = summaryData || [];
  const agents = summarySort.sortKey
    ? summarySort.sorted(agentsRaw, {
        agent: a => a.agent,
        wip: a => a.wip,
        invoiced: a => a.invoiced,
        total: a => a.wip + a.invoiced,
      })
    : agentsRaw;
  const grandTotal = agents.reduce((s, a) => s + a.wip + a.invoiced, 0);
  const maxBarValue = agents.length > 0 ? Math.max(...agents.map(a => a.wip + a.invoiced)) : 1;

  if (isLoading) {
    return (
      <div className="space-y-3 p-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6 overflow-y-auto flex-1 min-h-0">
      {/* Agent Bar Chart */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden" data-testid="agent-summary-chart">
        <div className="bg-gray-50 border-b px-4 py-3">
          <span className="text-sm font-semibold text-gray-700">Agent Fee Breakdown</span>
        </div>
        <div className="p-4 space-y-2">
          {agents.map((a) => {
            const total = a.wip + a.invoiced;
            const widthPct = Math.max(1, (total / maxBarValue) * 100);
            const isSelected = selectedAgent === a.agent;
            return (
              <div
                key={a.agent}
                className={`flex items-center gap-3 cursor-pointer rounded px-2 py-1.5 transition-colors ${
                  isSelected ? "bg-green-50 ring-1 ring-green-300" : "hover:bg-gray-50"
                }`}
                onClick={() => setSelectedAgent(isSelected ? null : a.agent)}
                data-testid={`agent-bar-${a.agent}`}
              >
                <span className="text-xs text-gray-700 w-36 text-right flex-shrink-0 truncate font-medium">
                  {a.agent}
                </span>
                <div className="flex-1 h-6 bg-gray-100 rounded overflow-hidden relative flex">
                  {a.wip > 0 && (
                    <div
                      className="h-full transition-all duration-500"
                      style={{
                        width: `${(a.wip / maxBarValue) * 100}%`,
                        backgroundColor: isSelected ? "#16a34a" : "#86efac",
                      }}
                      title={`WIP: ${formatFullCurrency(a.wip)}`}
                    />
                  )}
                  {a.invoiced > 0 && (
                    <div
                      className="h-full transition-all duration-500"
                      style={{
                        width: `${(a.invoiced / maxBarValue) * 100}%`,
                        backgroundColor: isSelected ? "#15803d" : "#22c55e",
                      }}
                      title={`Invoiced: ${formatFullCurrency(a.invoiced)}`}
                    />
                  )}
                </div>
                <span className="text-xs font-mono text-gray-700 w-20 text-right flex-shrink-0">
                  {formatCurrency(total)}
                </span>
              </div>
            );
          })}
          {agents.length > 0 && (
            <div className="flex items-center gap-3 pt-2 border-t mt-2">
              <span className="text-xs w-36 text-right flex-shrink-0" />
              <div className="flex gap-4 text-xs text-gray-500">
                <span className="flex items-center gap-1">
                  <span className="inline-block w-3 h-3 rounded" style={{ backgroundColor: "#86efac" }} />
                  WIP
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block w-3 h-3 rounded" style={{ backgroundColor: "#22c55e" }} />
                  Invoiced
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Agent Summary Table */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden" data-testid="agent-summary-table">
        <div className="bg-gray-50 border-b px-4 py-3 flex items-center justify-between">
          <span className="text-sm font-semibold text-gray-700">Agent Summary</span>
          <span className="text-xs text-gray-500">{agents.length} agents</span>
        </div>
        <ScrollableTable minWidth={700}>
          <table className="w-full">
            <thead className="bg-gray-50 border-b sticky top-0 z-10 text-sm">
              <tr>
                <SortableTableHead sortKey="agent" sort={summarySort} raw className="px-4 py-2 text-left font-medium text-gray-600">Agent Name</SortableTableHead>
                <SortableTableHead sortKey="wip" sort={summarySort} raw align="right" className="px-4 py-2 font-medium text-gray-600">WIP Amount</SortableTableHead>
                <SortableTableHead sortKey="invoiced" sort={summarySort} raw align="right" className="px-4 py-2 font-medium text-gray-600">Invoiced Amount</SortableTableHead>
                <SortableTableHead sortKey="total" sort={summarySort} raw align="right" className="px-4 py-2 font-medium text-gray-600">Total</SortableTableHead>
                <th className="px-4 py-2 text-right font-medium text-gray-600">% of Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 text-xs">
              {agents.map((a) => {
                const total = a.wip + a.invoiced;
                const pct = grandTotal > 0 ? ((total / grandTotal) * 100).toFixed(1) : "0.0";
                const isSelected = selectedAgent === a.agent;
                return (
                  <tr
                    key={a.agent}
                    className={`cursor-pointer transition-colors ${
                      isSelected ? "bg-green-50" : "hover:bg-gray-50"
                    }`}
                    onClick={() => setSelectedAgent(isSelected ? null : a.agent)}
                    data-testid={`agent-row-${a.agent}`}
                  >
                    <td className="px-4 py-2 text-gray-800 font-medium">{a.agent}</td>
                    <td className="px-4 py-2 text-right font-mono text-gray-700">{formatFullCurrency(a.wip)}</td>
                    <td className="px-4 py-2 text-right font-mono text-green-700">{formatFullCurrency(a.invoiced)}</td>
                    <td className="px-4 py-2 text-right font-mono text-gray-900 font-semibold">{formatFullCurrency(total)}</td>
                    <td className="px-4 py-2 text-right text-gray-600">{pct}%</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="bg-gray-100 border-t font-semibold text-sm">
              <tr>
                <td className="px-4 py-2 text-gray-800">Total</td>
                <td className="px-4 py-2 text-right font-mono text-gray-900">
                  {formatFullCurrency(agents.reduce((s, a) => s + a.wip, 0))}
                </td>
                <td className="px-4 py-2 text-right font-mono text-green-700">
                  {formatFullCurrency(agents.reduce((s, a) => s + a.invoiced, 0))}
                </td>
                <td className="px-4 py-2 text-right font-mono text-gray-900">
                  {formatFullCurrency(grandTotal)}
                </td>
                <td className="px-4 py-2 text-right text-gray-600">100%</td>
              </tr>
            </tfoot>
          </table>
        </ScrollableTable>
      </div>

      {/* Agent Drilldown */}
      {selectedAgent && (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden" data-testid="agent-drilldown">
          <div className="bg-gray-50 border-b px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-gray-700">
                Deals for {selectedAgent}
              </span>
              {drilldownData && (
                <Badge variant="secondary" className="text-xs">
                  {drilldownData.length} deals
                </Badge>
              )}
            </div>
            <button
              onClick={() => setSelectedAgent(null)}
              className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1"
            >
              <X className="w-3 h-3" /> Close
            </button>
          </div>
          {drilldownLoading ? (
            <div className="px-4 py-8 text-center text-sm text-gray-500">Loading deals...</div>
          ) : !drilldownData || drilldownData.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-gray-500">No deals found for this agent</div>
          ) : (
            <ScrollableTable minWidth={900}>
              <table className="w-full">
                <thead className="bg-gray-50 border-b sticky top-0 z-10 text-sm">
                  <tr>
                    <SortableTableHead sortKey="name" sort={drillSort} raw className="px-3 py-2 text-left font-medium text-gray-600">Deal Name</SortableTableHead>
                    <SortableTableHead sortKey="property" sort={drillSort} raw className="px-3 py-2 text-left font-medium text-gray-600">Property</SortableTableHead>
                    <SortableTableHead sortKey="dealType" sort={drillSort} raw className="px-3 py-2 text-left font-medium text-gray-600">Type</SortableTableHead>
                    <SortableTableHead sortKey="totalFee" sort={drillSort} raw align="right" className="px-3 py-2 font-medium text-gray-600">Total Fee</SortableTableHead>
                    <SortableTableHead sortKey="allocated" sort={drillSort} raw align="right" className="px-3 py-2 font-medium text-gray-600">Allocated</SortableTableHead>
                    <SortableTableHead sortKey="status" sort={drillSort} raw align="center" className="px-3 py-2 font-medium text-gray-600">Status</SortableTableHead>
                    <SortableTableHead sortKey="stage" sort={drillSort} raw align="center" className="px-3 py-2 font-medium text-gray-600">Stage</SortableTableHead>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 text-xs">
                  {(drillSort.sortKey
                    ? drillSort.sorted(drilldownData, {
                        name: d => d.name,
                        property: d => d.property,
                        dealType: d => d.dealType,
                        totalFee: d => d.totalFee,
                        allocated: d => d.allocatedAmount,
                        status: d => d.status,
                        stage: d => d.stage,
                      })
                    : drilldownData
                  ).map((d) => (
                    <tr key={d.dealId} className="hover:bg-gray-50">
                      <td className="px-3 py-2 text-gray-700">
                        <Link href={`/deals/${d.dealId}`}>
                          <span className="text-blue-600 hover:underline cursor-pointer">{d.name}</span>
                        </Link>
                      </td>
                      <td className="px-3 py-2 text-gray-700 truncate max-w-[160px]">{d.property || "---"}</td>
                      <td className="px-3 py-2">
                        {d.dealType ? (
                          <Badge className={`text-[10px] ${DEAL_TYPE_BADGE_COLORS[d.dealType] || "bg-gray-100 text-gray-800"}`}>
                            {d.dealType}
                          </Badge>
                        ) : "---"}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-gray-500">
                        {formatFullCurrency(d.totalFee)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-gray-900 font-semibold">
                        {formatFullCurrency(d.allocatedAmount)}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <Badge variant="secondary" className="text-[10px]">
                          {d.status || "---"}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 text-center">
                        {d.stage === "invoiced" ? (
                          <Badge className="text-[10px] bg-green-100 text-green-800">Invoiced</Badge>
                        ) : d.stage === "wip" ? (
                          <Badge className="text-[10px] bg-yellow-100 text-yellow-800">WIP</Badge>
                        ) : (
                          <span className="text-gray-500">{d.stage}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-gray-100 border-t font-semibold text-xs">
                  <tr>
                    <td colSpan={3} className="px-3 py-2 text-gray-800">Total</td>
                    <td className="px-3 py-2 text-right font-mono text-gray-500">
                      {formatFullCurrency(drilldownData.reduce((s, d) => s + d.totalFee, 0))}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-gray-900">
                      {formatFullCurrency(drilldownData.reduce((s, d) => s + d.allocatedAmount, 0))}
                    </td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              </table>
            </ScrollableTable>
          )}
        </div>
      )}
    </div>
  );
}

export default function WipReport() {
  const { toast } = useToast();
  const { activeTeam } = useTeam();
  const { brand, isLandsec } = useBrand();
  // Sage WIP reconciliation tab retired — Deals Board + Letting Tracker
  // are now the canonical source. The page shows the live deals view
  // and the per-agent summary only.
  const [activeTab, setActiveTab] = useState<"report" | "agent-summary">("report");

  const { data: user } = useQuery<{ id: string; name: string; email: string; team: string; isAdmin?: boolean }>({
    queryKey: ["/api/auth/me"],
  });


  const WIP_SENIOR_EMAILS = useMemo(() => new Set([
    "woody@brucegillinghampollard.com",
    "charlotte@brucegillinghampollard.com",
    "rupert@brucegillinghampollard.com",
    "jack@brucegillinghampollard.com",
  ]), []);

  const WIP_RESTRICTED_AGENTS = useMemo(() => new Set([
    "woody bruce", "charlotte roberts", "rupert bentley-smith", "jack barratt",
  ]), []);

  const isSeniorWipUser = useMemo(() => {
    if (!user?.email) return false;
    return WIP_SENIOR_EMAILS.has(user.email.toLowerCase());
  }, [user?.email, WIP_SENIOR_EMAILS]);

  const { data: wipResponse, isLoading } = useQuery<{ entries: WipDealEntry[]; isAdmin: boolean; userTeam: string | null } | WipDealEntry[]>({
    queryKey: ["/api/wip"],
  });

  const rawEntries = Array.isArray(wipResponse) ? wipResponse : (wipResponse?.entries || []);
  const isWipAdmin = Array.isArray(wipResponse) ? false : (wipResponse?.isAdmin || false);
  const wipUserTeam = Array.isArray(wipResponse) ? null : (wipResponse?.userTeam || null);
  // canSeeAll (senior partners + finance full-view like Layla) receive the
  // restricted-director fees and always see every agent; non-canSeeAll users
  // never receive those rows from the server. No Normal/Admin toggle — the
  // WIP always shows everyone.
  const canSeeAll = !Array.isArray(wipResponse) && !!(wipResponse as any)?.canSeeAll;

  const isLandsecView = activeTeam === "Landsec";

  const entries = useMemo(() => {
    // Client-side safety net: strip any rows whose status maps to a non-WIP
    // canonical code (REP/SPEC/LIVE/AVA/WIT). The server applies the same
    // filter, but this catches stale cached responses or deployment lag.
    let filtered = rawEntries.filter(e => {
      const code = legacyToCode(e.dealStatus);
      if (!code) return true; // unknown/null status — keep
      return WIP_STATUSES.includes(code);
    });
    if (isLandsecView) {
      filtered = filtered.filter((e) => {
        const gn = (e.groupName || "").toLowerCase().replace(/\s+/g, "");
        return gn === "landsec" || gn === "landsecurities" || gn.includes("landsec");
      });
    } else if (isWipAdmin && !canSeeAll && activeTeam && activeTeam !== "all") {
      // Leadership (canSeeAll — senior partners + finance full-view) always
      // see the whole firm, so the team switcher never narrows their WIP.
      // This slice only applies to a plain DB admin (not a partner).
      const at = activeTeam.toLowerCase();
      filtered = filtered.filter((e) => {
        if (!e.team) return false;
        const teams = (e.team as string).split(",").map(t => t.trim().toLowerCase());
        return teams.some(t => t === at);
      });
    }
    return filtered;
  }, [rawEntries, isLandsecView, activeTeam, isWipAdmin, canSeeAll]);

  const INVOICED_STATUSES = useMemo(() => ["Invoiced", "Billed"], []);
  const [selectedTeams, setSelectedTeams] = useState<Set<string>>(new Set());
  const [selectedMonths, setSelectedMonths] = useState<Set<string>>(new Set());
  const [selectedAgents, setSelectedAgents] = useState<Set<string>>(new Set());
  const [selectedStatuses, setSelectedStatuses] = useState<Set<string>>(new Set());
  const [selectedFiscalYears, setSelectedFiscalYears] = useState<Set<number>>(new Set());
  const [clickFilter, setClickFilter] = useState<ClickFilter>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [syncingXero, setSyncingXero] = useState(false);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback((checked: boolean, rows: WipDealEntry[]) => {
    if (checked) {
      setSelectedIds(new Set(rows.filter(e => e.id).map(e => e.id!)));
    } else {
      setSelectedIds(new Set());
    }
  }, []);

  // Sage WIP import flow removed — the Deals Board + Letting Tracker
  // are now the canonical fee source.
  const [detailSort, setDetailSort] = useState<{ column: string; direction: SortDirection }>({
    column: "amtWip",
    direction: "desc",
  });

  // Deal Detail column show/hide. Checkbox + Ref + Deal stay; the rest can be
  // toggled off to fit more on screen. Persisted per browser. The lead/trail
  // key groups drive the footer's colSpans so the totals stay column-aligned.
  const WIP_DETAIL_COLS: { key: string; label: string; width: string }[] = [
    { key: "dealRef", label: "Ref", width: "w-12" },
    { key: "ref", label: "Deal", width: "w-32" },
    { key: "client", label: "Client", width: "w-24" },
    { key: "tenant", label: "Tenant", width: "w-28" },
    { key: "project", label: "Property", width: "w-28" },
    { key: "billingEntity", label: "Billing Entity", width: "w-24" },
    { key: "team", label: "Team", width: "w-24" },
    { key: "amtWip", label: "Fee", width: "w-20" },
    { key: "amtInvoice", label: "Fee Split", width: "w-20" },
    { key: "dealDate", label: "Target Date", width: "w-24" },
    { key: "dealType", label: "Deal Type", width: "w-20" },
    { key: "agent", label: "BGP Contact", width: "w-20" },
    { key: "dealStatus", label: "Deal Status", width: "w-20" },
    { key: "stage", label: "Stage", width: "w-20" },
  ];
  const WIP_LEAD_KEYS = ["dealRef", "ref", "client", "tenant", "project", "billingEntity", "team"];
  const WIP_TRAIL_KEYS = ["dealDate", "dealType", "agent", "dealStatus", "stage"];
  const [hiddenWipCols, setHiddenWipCols] = useState<Set<string>>(() => {
    try { return new Set<string>(JSON.parse(localStorage.getItem("bgp_wip_hidden_cols") || "[]")); } catch { return new Set(); }
  });
  const [colMenuOpen, setColMenuOpen] = useState(false);
  const showCol = (k: string) => !hiddenWipCols.has(k);
  const toggleWipCol = (k: string) => setHiddenWipCols((prev) => {
    const n = new Set(prev);
    if (n.has(k)) n.delete(k); else n.add(k);
    try { localStorage.setItem("bgp_wip_hidden_cols", JSON.stringify([...n])); } catch {}
    return n;
  });

  const handleClickFilter = useCallback((field: string, value: string) => {
    setClickFilter((prev) => {
      if (prev && prev.field === field && prev.value === value) return null;
      return { field: field as ClickFilter extends null ? never : NonNullable<ClickFilter>["field"], value };
    });
  }, []);

  const clearClickFilter = useCallback(() => setClickFilter(null), []);

  const allTeams = useMemo(() => {
    const set = new Set<string>();
    entries.forEach((e) => {
      if (!e.team) return;
      (e.team as string).split(",").map(t => t.trim()).filter(Boolean).forEach(t => set.add(t));
    });
    return [...set].sort();
  }, [entries]);

  const allMonths = useMemo(() => {
    const set = new Set(entries.map((e) => e.month).filter(Boolean) as string[]);
    return [...set].sort((a, b) => getMonthSortKey(a) - getMonthSortKey(b));
  }, [entries]);

  const normalizeAgent = (a: string) => a.replace(/\s*\(BGP House\)/i, "").trim();

  const allAgents = useMemo(() => {
    const map = new Map<string, string>(); // lowercase key → display value
    entries.forEach((e) => {
      if (e.agent) {
        const parts = (e.agent as string).split(",").map(a => normalizeAgent(a.trim())).filter(Boolean);
        parts.forEach(a => {
          const k = a.toLowerCase();
          if (!map.has(k)) map.set(k, a.toUpperCase());
        });
      }
    });
    return [...map.values()].sort();
  }, [entries]);

  const allStatuses = useMemo(() => {
    const set = new Set(entries.map((e) => e.dealStatus).filter(Boolean) as string[]);
    return [...set].sort();
  }, [entries]);

  const allFiscalYears = useMemo(() => {
    const set = new Set<number>();
    let hasNullFY = false;
    entries.forEach((e) => {
      // Guard: fiscal years must be plausible 4-digit years — reject Excel serial numbers
      const fy = e.fiscalYear && e.fiscalYear >= 2000 && e.fiscalYear <= 2100 ? e.fiscalYear : null;
      if (fy) {
        set.add(fy);
      } else if (e.month) {
        const fy = getFiscalYear(e.month);
        if (fy) set.add(fy);
        else hasNullFY = true;
      } else {
        hasNullFY = true;
      }
    });
    const sorted = [...set].sort().reverse();
    if (hasNullFY) sorted.push(0);
    return sorted;
  }, [entries]);

  const filtersInitialized = useRef(false);
  useEffect(() => {
    if (!filtersInitialized.current && entries.length > 0 && user) {
      filtersInitialized.current = true;
      setSelectedTeams(new Set(allTeams));
      setSelectedMonths(new Set(allMonths));
      setSelectedAgents(new Set(allAgents));
      setSelectedStatuses(new Set(allStatuses));
      if (allFiscalYears.length > 0) {
        const currentFY = getCurrentFiscalYear();
        setSelectedFiscalYears(new Set([allFiscalYears.includes(currentFY) ? currentFY : allFiscalYears[0]]));
      }
    }
  }, [entries, user, allTeams, allMonths, allAgents, allStatuses, allFiscalYears]);

  const sidebarFilteredEntries = useMemo(() => {
    return entries.filter((e) => {
      if (selectedTeams.size > 0 && selectedTeams.size < allTeams.length) {
        if (!e.team) return false;
        const entryTeams = (e.team as string).split(",").map(t => t.trim()).filter(Boolean);
        if (!entryTeams.some(t => selectedTeams.has(t))) return false;
      }
      if (selectedFiscalYears.size > 0 && selectedFiscalYears.size < allFiscalYears.length) {
        const rawFy = e.fiscalYear && e.fiscalYear >= 2000 && e.fiscalYear <= 2100 ? e.fiscalYear : null;
        const fy = rawFy || (e.month ? getFiscalYear(e.month) : null);
        if (fy) {
          if (!selectedFiscalYears.has(fy)) return false;
        } else {
          if (!selectedFiscalYears.has(0)) return false;
        }
      }
      if (selectedMonths.size > 0 && selectedMonths.size < allMonths.length) {
        if (e.month && !selectedMonths.has(e.month)) return false;
      }
      if (selectedAgents.size > 0 && selectedAgents.size < allAgents.length) {
        if (!e.agent) return false;
        const agentParts = (e.agent as string).split(",").map(a => normalizeAgent(a.trim()).toUpperCase()).filter(Boolean);
        if (!agentParts.some(a => selectedAgents.has(a))) return false;
      }
      if (selectedStatuses.size > 0 && selectedStatuses.size < allStatuses.length) {
        if (!e.dealStatus || !selectedStatuses.has(e.dealStatus)) return false;
      }
      return true;
    });
  }, [entries, selectedTeams, selectedMonths, selectedAgents, selectedStatuses, selectedFiscalYears, allTeams.length, allMonths.length, allAgents.length, allStatuses.length, allFiscalYears.length]);

  const filteredEntries = useMemo(() => {
    if (!clickFilter) return sidebarFilteredEntries;
    // "Unknown" is the bucket label used by every summary card when the
    // underlying field is null/empty. Clicking that bucket has to filter
    // to entries where the field is missing — not literally match the
    // string "Unknown", which never appears in the data.
    const isUnknownTarget = clickFilter.value === "Unknown";
    return sidebarFilteredEntries.filter((e) => {
      if (clickFilter.field === "agent") {
        const agentField = (e.agent || "").trim();
        const agents = agentField.split(",").map(a => a.trim()).filter(Boolean);
        if (isUnknownTarget) return agents.length === 0;
        const target = clickFilter.value.toLowerCase();
        return agents.some(a => a.toLowerCase() === target);
      }
      if (clickFilter.field === "team") {
        const entryTeams = e.team
          ? (e.team as string).split(",").map(t => t.trim()).filter(Boolean)
          : [];
        if (isUnknownTarget) return entryTeams.length === 0;
        return entryTeams.some(t => t === clickFilter.value);
      }
      const val = e[clickFilter.field];
      if (isUnknownTarget) return !val;
      return val === clickFilter.value;
    });
  }, [sidebarFilteredEntries, clickFilter]);

  const totalWip = useMemo(
    () => filteredEntries.reduce((s, e) => s + (e.amtWip || 0), 0),
    [filteredEntries],
  );
  const totalInvoiced = useMemo(
    () => filteredEntries.reduce((s, e) => s + (e.amtInvoice || 0), 0),
    [filteredEntries],
  );
  const totalNetFees = totalWip + totalInvoiced;

  const groupData = useMemo(() => {
    const map: Record<string, number> = {};
    filteredEntries.forEach((e) => {
      // "Client" card now groups by the resolved counterparty name
      // (landlord / vendor / purchaser) so clicking Canary Wharf
      // actually surfaces every deal where Canary Wharf is the client.
      // Old behaviour grouped by the stage-bucket `groupName` and never
      // matched a real client.
      const g = e.client || "Unknown";
      map[g] = (map[g] || 0) + (e.amtWip || 0) + (e.amtInvoice || 0);
    });
    return Object.entries(map)
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value);
  }, [filteredEntries]);

  const teamData = useMemo(() => {
    const map: Record<string, number> = {};
    // Count each deal's fee against every team it belongs to (no split).
    // This matches click-filter behaviour: clicking a team shows all deals
    // that include it, at full fee.
    const counted = new Set<string>();
    filteredEntries.forEach((e) => {
      const fee = (e.amtWip || 0) + (e.amtInvoice || 0);
      const teams = e.team
        ? (e.team as string).split(",").map(t => t.trim()).filter(Boolean)
        : ["Unknown"];
      teams.forEach(t => {
        // Deduplicate per (entry, team) so a deal split across agents
        // doesn't multiply the team total.
        const key = `${e.id}::${t}`;
        if (!counted.has(key)) {
          counted.add(key);
          map[t] = (map[t] || 0) + fee;
        }
      });
    });
    return Object.entries(map)
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value);
  }, [filteredEntries]);

  const agentData = useMemo(() => {
    const map: Record<string, number> = {};
    filteredEntries.forEach((e) => {
      const agentField = e.agent || "Unknown";
      const agents = agentField.split(",").map(a => normalizeAgent(a.trim())).filter(Boolean);
      const fee = (e.amtWip || 0) + (e.amtInvoice || 0);
      const perAgent = agents.length > 0 ? fee / agents.length : fee;
      if (agents.length === 0) {
        map["Unknown"] = (map["Unknown"] || 0) + fee;
      } else {
        agents.forEach(a => {
          const key = a.trim().toUpperCase();
          map[key] = (map[key] || 0) + perAgent;
        });
      }
    });
    return Object.entries(map)
      .map(([key, value]) => {
        const display = key.includes(" ")
          ? key.split(" ").map(p => p[0].toUpperCase()).join("")
          : key.toUpperCase();
        return { label: display, value, fullName: key };
      })
      .sort((a, b) => b.value - a.value);
  }, [filteredEntries]);

  const projectData = useMemo(() => {
    const map: Record<string, { value: number; txns: number }> = {};
    filteredEntries.forEach((e) => {
      const p = e.project || "Unknown";
      if (!map[p]) map[p] = { value: 0, txns: 0 };
      map[p].value += (e.amtWip || 0) + (e.amtInvoice || 0);
      map[p].txns += 1;
    });
    return Object.entries(map)
      .map(([label, { value, txns }]) => ({ label, value, txns }))
      .sort((a, b) => b.value - a.value);
  }, [filteredEntries]);

  const statusData = useMemo(() => {
    const map: Record<string, number> = {};
    filteredEntries.forEach((e) => {
      const s = e.dealStatus || "Unknown";
      map[s] = (map[s] || 0) + (e.amtWip || 0) + (e.amtInvoice || 0);
    });
    return Object.entries(map)
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value);
  }, [filteredEntries]);

  const monthChartData = useMemo(() => {
    const map: Record<string, number> = {};
    filteredEntries.forEach((e) => {
      const m = e.month || "No date";
      map[m] = (map[m] || 0) + (e.amtWip || 0) + (e.amtInvoice || 0);
    });
    const colors = [
      "#4a7c59", "#5a8f6a", "#6ba27b", "#7cb58c", "#8dc89d",
      "#9edcae", "#73946d", "#5e7d58", "#4f6b49", "#8aad82",
      "#a3c49b", "#bcdbb4",
    ];
    return Object.entries(map)
      .map(([label, value], i) => ({ label, value, color: colors[i % colors.length] }))
      .sort((a, b) => getMonthSortKey(b.label) - getMonthSortKey(a.label));
  }, [filteredEntries]);

  const sortedDetailEntries = useMemo(() => {
    const sorted = [...filteredEntries];
    sorted.sort((a, b) => {
      let aVal: any, bVal: any;
      switch (detailSort.column) {
        case "dealRef": aVal = a.dealRef || 0; bVal = b.dealRef || 0; break;
        case "ref": aVal = a.ref || ""; bVal = b.ref || ""; break;
        case "groupName": aVal = a.groupName || ""; bVal = b.groupName || ""; break;
        case "client": aVal = a.client || ""; bVal = b.client || ""; break;
        case "project": aVal = a.project || ""; bVal = b.project || ""; break;
        case "tenant": aVal = a.tenant || ""; bVal = b.tenant || ""; break;
        case "team": aVal = a.team || ""; bVal = b.team || ""; break;
        case "dealType": aVal = a.dealType || ""; bVal = b.dealType || ""; break;
        case "agent": aVal = a.agent || ""; bVal = b.agent || ""; break;
        case "amtWip": aVal = a.amtWip || 0; bVal = b.amtWip || 0; break;
        case "amtInvoice": aVal = a.amtInvoice || 0; bVal = b.amtInvoice || 0; break;
        case "month": aVal = getMonthSortKey(a.month || ""); bVal = getMonthSortKey(b.month || ""); break;
        case "dealDate": {
          const pick = (e: WipDealEntry) => e.invoicedAt || e.completedAt || e.exchangedAt || e.targetDate || "";
          aVal = pick(a) ? new Date(pick(a)).getTime() : 0;
          bVal = pick(b) ? new Date(pick(b)).getTime() : 0;
          break;
        }
        case "dealStatus": aVal = a.dealStatus || ""; bVal = b.dealStatus || ""; break;
        case "stage": aVal = a.stage || ""; bVal = b.stage || ""; break;
        default: aVal = 0; bVal = 0;
      }
      if (typeof aVal === "string") {
        return detailSort.direction === "asc" ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }
      return detailSort.direction === "asc" ? aVal - bVal : bVal - aVal;
    });
    return sorted;
  }, [filteredEntries, detailSort]);

  const toggleSort = (column: string) => {
    setDetailSort((prev) =>
      prev.column === column
        ? { column, direction: prev.direction === "asc" ? "desc" : "asc" }
        : { column, direction: "desc" },
    );
  };

  const toggleFilter = (set: Set<string>, setFn: (s: Set<string>) => void, item: string) => {
    const next = new Set(set);
    if (next.has(item)) next.delete(item);
    else next.add(item);
    setFn(next);
  };

  const handlePrint = () => window.print();

  const handleExportExcel = async () => {
    try {
      const res = await fetch("/api/wip/export-excel", {
        credentials: "include",
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `BGP_WIP_Report_${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      toast({ title: "Export failed", description: err.message, variant: "destructive" });
    }
  };

  const handleSyncXero = async () => {
    setSyncingXero(true);
    try {
      const res = await apiRequest("POST", "/api/xero/invoices/sync-all");
      const data = await res.json();
      const parts = [`Synced ${data.synced} invoice${data.synced !== 1 ? "s" : ""}`];
      if (data.promoted) parts.push(`${data.promoted} deal${data.promoted !== 1 ? "s" : ""} auto-invoiced`);
      if (data.errors?.length) parts.push(`${data.errors.length} failed`);
      toast({
        title: "Xero sync complete",
        description: parts.join(", "),
        variant: data.errors?.length ? "destructive" : "default",
      });
      invalidateDealCaches();
    } catch (err: any) {
      toast({ title: "Sync failed", description: err.message, variant: "destructive" });
    } finally {
      setSyncingXero(false);
    }
  };

  const activeFilterCount =
    (selectedTeams.size < allTeams.length ? 1 : 0) +
    (selectedMonths.size < allMonths.length ? 1 : 0) +
    (selectedAgents.size < allAgents.length ? 1 : 0) +
    (selectedStatuses.size < allStatuses.length ? 1 : 0);

  if (isLoading) {
    return (
      <div className="space-y-3 p-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  const maxMonthValue = Math.max(...monthChartData.map((d) => d.value), 1);
  const clickFilterActiveField = clickFilter?.field || null;
  const clickFilterActiveValue = clickFilter?.value || null;

  return (
    <div className="min-h-[calc(100vh-64px)] md:h-[calc(100vh-64px)] flex flex-col md:overflow-hidden p-4 sm:p-6 print:p-2 print:h-auto print:overflow-visible" data-testid="wip-report-page">
      <style>{`
        @media print {
          .no-print { display: none !important; }
          .print-break { page-break-before: always; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      `}</style>

      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between flex-shrink-0 mb-4">
        <div className="flex items-center gap-4">
          {isLandsec ? (
            <div
              className="h-12 px-4 rounded flex items-center justify-center"
              style={{ backgroundColor: brand.primaryColor }}
              data-testid="wip-landsec-logo"
            >
              <span className="text-white font-bold text-lg tracking-tight">Landsec</span>
            </div>
          ) : (
            <img src={bgpLogo} alt="BGP" className="h-12 w-auto invert" data-testid="wip-bgp-logo" />
          )}
          <div>
            <h1
              className="text-2xl font-bold tracking-tight"
              style={isLandsec ? { color: brand.primaryColor } : undefined}
              data-testid="wip-report-title"
            >
              WIP Report
              {(() => {
                // Leadership always see the whole firm → "All Teams". A plain
                // DB admin who has sliced to a team sees that team's name.
                const teamLabel = isLandsecView
                  ? "Landsec"
                  : canSeeAll
                    ? "All Teams"
                    : isWipAdmin
                      ? (activeTeam === "all" ? "All Teams" : activeTeam)
                      : wipUserTeam;
                return teamLabel ? (
                  <span className="text-base font-normal text-muted-foreground ml-2">— {teamLabel}</span>
                ) : null;
              })()}
            </h1>
            <p className="text-sm text-muted-foreground">
              {filteredEntries.length} transaction{filteredEntries.length !== 1 ? "s" : ""} · Total net fees: {formatFullCurrency(totalNetFees)}
              <span className="ml-2 opacity-60">· Live data from CRM deals</span>
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 no-print">
          {clickFilter && (
            <Button variant="outline" size="sm" onClick={clearClickFilter} data-testid="wip-clear-click-filter">
              <X className="h-4 w-4 mr-1" />
              Clear: {clickFilter.value}
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={handleSyncXero}
            disabled={syncingXero}
            data-testid="wip-sync-xero-button"
          >
            {syncingXero ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1" />}
            {syncingXero ? "Syncing..." : "Sync Xero"}
          </Button>
          <Button variant="outline" size="sm" onClick={handleExportExcel} data-testid="wip-export-excel-button">
            <Download className="h-4 w-4 mr-1" />
            Download Excel
          </Button>
          <Button variant="outline" size="sm" onClick={handlePrint} data-testid="wip-print-button">
            <Printer className="h-4 w-4 mr-1" />
            Print
          </Button>
        </div>
      </div>

      {/* Tab switcher */}
      <div className="flex items-center justify-between gap-2 mb-4 flex-shrink-0 no-print border-b" data-testid="wip-tabs">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setActiveTab("report")}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === "report"
                ? "border-green-600 text-green-700"
                : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
            }`}
            data-testid="wip-tab-report"
          >
            WIP Report
          </button>
          <button
            onClick={() => setActiveTab("agent-summary")}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === "agent-summary"
                ? "border-green-600 text-green-700"
                : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
            }`}
            data-testid="wip-tab-agent-summary"
          >
            Agent Summary
          </button>
        </div>
      </div>

      {activeTab === "agent-summary" ? (
        <AgentSummaryTab />
      ) : (
      <div className="flex flex-col md:flex-row gap-4 flex-1 min-h-0">
        <div className="flex-1 md:overflow-y-auto space-y-4 min-h-0">
          {/* KPI stat cards — matching Investment Tracker style */}
          <ScrollArea className="w-full shrink-0">
            <div className="flex items-center gap-3 pb-1">
              {[
                { label: "Total Entries", value: filteredEntries.length.toString(), color: "bg-primary/60" },
                { label: "Pipeline", value: filteredEntries.filter(e => e.stage === "pipeline").length.toString(), color: "bg-amber-500" },
                { label: "WIP", value: formatFullCurrency(totalWip), color: "bg-blue-500" },
                { label: "Invoiced", value: formatFullCurrency(totalInvoiced), color: "bg-green-500" },
                { label: "Net Fees", value: formatFullCurrency(totalNetFees), color: "bg-emerald-600" },
                { label: "Unique Deals", value: new Set(filteredEntries.map(e => e.dealId).filter(Boolean)).size.toString(), color: "bg-violet-500" },
                { label: "Teams", value: new Set(filteredEntries.map(e => e.team).filter(Boolean)).size.toString(), color: "bg-sky-500" },
              ].map(stat => (
                <Card key={stat.label} className="flex-shrink-0 min-w-[120px]" data-testid={`stat-${stat.label.toLowerCase().replace(/\s/g, "-")}`}>
                  <CardContent className="p-3">
                    <div className="flex items-center gap-2">
                      <div className={`w-2.5 h-2.5 rounded-full ${stat.color}`} />
                      <div>
                        <p className="text-lg font-bold">{stat.value}</p>
                        <p className="text-xs text-muted-foreground">{stat.label}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
            <ScrollBar orientation="horizontal" />
          </ScrollArea>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <ClickableSummaryTable
              title="Client"
              data={groupData}
              valueLabel="Net fees"
              activeValue={clickFilterActiveField === "client" ? clickFilterActiveValue : null}
              onRowClick={handleClickFilter}
              field="client"
            />
            <ClickableSummaryTable
              title="Team"
              data={teamData}
              valueLabel="Net fees"
              activeValue={clickFilterActiveField === "team" ? clickFilterActiveValue : null}
              onRowClick={handleClickFilter}
              field="team"
              overrideTotal={totalNetFees}
            />
            <ClickableSummaryTable
              title="BGP Contact"
              data={agentData.map(a => ({ label: a.label, value: a.value, clickValue: a.fullName }))}
              valueLabel="Net fees"
              activeValue={clickFilterActiveField === "agent" ? clickFilterActiveValue : null}
              onRowClick={handleClickFilter}
              field="agent"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <ClickableSummaryTable
              title="Property"
              data={projectData}
              valueLabel="Net fees"
              activeValue={clickFilterActiveField === "project" ? clickFilterActiveValue : null}
              onRowClick={handleClickFilter}
              field="project"
            />
            <ClickableSummaryTable
              title="Deal Status"
              data={statusData}
              valueLabel="Net fees"
              activeValue={clickFilterActiveField === "dealStatus" ? clickFilterActiveValue : null}
              onRowClick={handleClickFilter}
              field="dealStatus"
            />
            <div className="bg-white border border-gray-200 rounded-lg p-3">
              <div className="bg-gray-50 border-b -mx-3 -mt-3 px-3 py-2 mb-3 rounded-t-lg">
                <span className="text-xs font-semibold text-gray-700 uppercase tracking-wide">
                  Net fees by Month
                </span>
              </div>
              <HorizontalBarChart
                data={monthChartData}
                maxValue={maxMonthValue}
                activeValue={clickFilterActiveField === "month" ? clickFilterActiveValue : null}
                onBarClick={handleClickFilter}
              />
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden print-break" data-testid="wip-detail-table">
            <div className="bg-gray-50 border-b px-3 py-2 flex items-center justify-between">
              <div>
                <span className="text-xs font-semibold text-gray-700 uppercase tracking-wide">
                  Deal Detail
                </span>
                <span className="text-xs text-gray-500 ml-2">({sortedDetailEntries.length} rows)</span>
              </div>
              <div className="flex items-center gap-2">
                {clickFilter && (
                  <Badge variant="secondary" className="text-[10px]">
                    Filtered by {clickFilter.field === "client" || clickFilter.field === "groupName" ? "Client" : clickFilter.field === "project" ? "Property" : clickFilter.field === "dealStatus" ? "Status" : clickFilter.field}: {clickFilter.value}
                  </Badge>
                )}
                <div className="relative no-print">
                  <button
                    onClick={() => setColMenuOpen((o) => !o)}
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-gray-600 hover:text-gray-900 border border-gray-200 rounded px-2 py-1 bg-white"
                    data-testid="wip-columns-button"
                  >
                    Columns{hiddenWipCols.size > 0 ? ` (${WIP_DETAIL_COLS.length - hiddenWipCols.size}/${WIP_DETAIL_COLS.length})` : ""}
                  </button>
                  {colMenuOpen && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setColMenuOpen(false)} />
                      <div className="absolute right-0 top-full mt-1 z-50 bg-white border border-gray-200 rounded-lg shadow-xl p-2 w-48 max-h-[320px] overflow-y-auto">
                        <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide px-1 pb-1">Show columns</p>
                        {WIP_DETAIL_COLS.map((c) => (
                          <label key={c.key} className="flex items-center gap-2 px-1 py-1 rounded hover:bg-gray-50 cursor-pointer text-xs text-gray-700">
                            <Checkbox checked={showCol(c.key)} onCheckedChange={() => toggleWipCol(c.key)} className="h-3.5 w-3.5" />
                            <span>{c.label}</span>
                          </label>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
            {selectedIds.size > 0 && (
              <div className="flex items-center gap-3 px-4 py-2 bg-primary/5 border-b">
                <span className="text-xs font-medium">{selectedIds.size} selected</span>
                <span className="text-xs text-muted-foreground">
                  {formatFullCurrency(sortedDetailEntries.filter(e => e.id && selectedIds.has(e.id)).reduce((s, e) => s + (e.amtWip || 0) + (e.amtInvoice || 0), 0))} total
                </span>
                <Button variant="outline" size="sm" className="h-6 text-[10px]" onClick={() => setSelectedIds(new Set())}>
                  Clear Selection
                </Button>
              </div>
            )}
            <ScrollableTable minWidth={1400}>
              <table className="w-full">
                <thead className="bg-gray-50 border-b sticky top-0 z-10 text-sm">
                  <tr>
                    <th className="w-[36px] px-2 py-2">
                      <Checkbox
                        checked={sortedDetailEntries.length > 0 && sortedDetailEntries.every(e => e.id && selectedIds.has(e.id))}
                        onCheckedChange={(c) => toggleSelectAll(!!c, sortedDetailEntries)}
                        aria-label="Select all"
                        data-testid="checkbox-select-all"
                      />
                    </th>
                    {WIP_DETAIL_COLS.filter((col) => showCol(col.key)).map((col) => (
                      <th
                        key={col.key}
                        className={`px-2 py-2 text-left font-medium text-gray-600 cursor-pointer hover:text-gray-900 ${col.width}`}
                        onClick={() => toggleSort(col.key)}
                        data-testid={`wip-sort-${col.key}`}
                      >
                        <div className="flex items-center gap-1">
                          {col.label}
                          <ArrowUpDown className="h-3 w-3" />
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 text-xs">
                  {sortedDetailEntries.map((e, i) => (
                    <tr key={e.id || i} className={`hover:bg-gray-50 group ${e.id && selectedIds.has(e.id) ? "bg-primary/5" : ""}`} data-testid={`wip-row-${i}`}>
                      <td className="px-2 py-1.5">
                        {e.id && (
                          <Checkbox
                            checked={selectedIds.has(e.id)}
                            onCheckedChange={() => toggleSelect(e.id!)}
                            aria-label={`Select ${e.ref || "row"}`}
                            data-testid={`checkbox-select-${e.id}`}
                          />
                        )}
                      </td>
                      {showCol("dealRef") && (
                      <td className="px-2 py-1.5 text-xs font-mono text-gray-400 whitespace-nowrap">
                        {e.dealRef ? `#${e.dealRef}` : "—"}
                      </td>
                      )}
                      {showCol("ref") && (
                      <td className="px-2 py-1.5 text-gray-700 truncate max-w-[180px]">
                        {e.dealId ? (
                          <Link href={`/deals/${e.dealId}`}>
                            <span className="text-blue-600 hover:underline cursor-pointer" data-testid={`link-deal-${e.dealId}`}>{e.ref || "—"}</span>
                          </Link>
                        ) : (e.ref || "—")}
                      </td>
                      )}
                      {showCol("client") && <td className="px-2 py-1.5 text-gray-700 truncate max-w-[130px]">{e.client || "—"}</td>}
                      {showCol("tenant") && <td className="px-2 py-1.5 text-gray-700 truncate max-w-[150px]">{e.tenant || "—"}</td>}
                      {showCol("project") && <td className="px-2 py-1.5 text-gray-700 truncate max-w-[150px]">{e.project || "—"}</td>}
                      {showCol("billingEntity") && <td className="px-2 py-1.5 text-gray-700 truncate max-w-[150px]">{e.billingEntity || "—"}</td>}
                      {showCol("team") && <td className="px-2 py-1.5 text-gray-700 truncate max-w-[150px]">{e.team || "—"}</td>}
                      {showCol("amtWip") && (
                      <td className="px-2 py-1.5 text-gray-900 font-mono text-right">
                        {e.amtWip ? formatFullCurrency(e.amtWip) : "—"}
                      </td>
                      )}
                      {showCol("amtInvoice") && (
                      <td className="px-2 py-1.5 text-green-700 font-mono text-right">
                        {e.amtInvoice ? formatFullCurrency(e.amtInvoice) : "—"}
                      </td>
                      )}
                      {showCol("dealDate") && (
                      <td className="px-2 py-1.5 text-gray-600 whitespace-nowrap">
                        {(() => {
                          const isActual = !!(e.exchangedAt || e.completedAt || e.invoicedAt);
                          const pick = e.invoicedAt
                            ? { label: "Invoiced", iso: e.invoicedAt, cls: "bg-green-100 text-green-800" }
                            : e.completedAt
                            ? { label: "Completed", iso: e.completedAt, cls: "bg-blue-100 text-blue-800" }
                            : e.exchangedAt
                            ? { label: "Exchanged", iso: e.exchangedAt, cls: "bg-amber-100 text-amber-800" }
                            : e.targetDate
                            ? { label: "Target", iso: e.targetDate, cls: "bg-gray-100 text-gray-700" }
                            : null;
                          const dateStr = pick ? (() => { const d = new Date(pick.iso); return isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" }); })() : null;
                          return (
                            <div className="flex flex-col gap-0.5">
                              {!isActual && e.dealId ? (
                                <input
                                  type="date"
                                  // The target date belongs to the DEAL, so this saves to the deal —
                                  // every split row for that deal (e.g. AT / CR / LK) shares it, and
                                  // keying on targetDate remounts the other agents' inputs after the
                                  // refetch so they re-sync to the new date.
                                  //
                                  // Save on CHANGE, not blur: picking a date from the date popup often
                                  // doesn't blur the field, so the old onBlur save silently never fired
                                  // (this was the "I keep changing it and it won't save" bug).
                                  key={`wip-target-${e.dealId}-${e.targetDate ?? ""}`}
                                  defaultValue={toDateInputValue(e.targetDate)}
                                  className="text-xs border border-gray-200 rounded px-1 py-0.5 w-[110px] focus:outline-none focus:border-blue-400"
                                  onChange={async (ev) => {
                                    const val = ev.target.value;
                                    if (!val) return;
                                    // PUT /api/crm/deals/:id — the endpoint the Deals page uses. (The
                                    // old PATCH /api/deals/:id route never existed, so nothing saved.)
                                    try {
                                      await apiRequest("PUT", `/api/crm/deals/${e.dealId}`, { targetDate: val });
                                      toast({ title: "Target date updated", description: "Applied to everyone on this deal." });
                                      // Refetch so every split row on this deal re-syncs to the new date.
                                      invalidateDealCaches();
                                    } catch (err: any) {
                                      toast({ title: "Couldn't save target date", description: err?.message || "Please try again.", variant: "destructive" });
                                    }
                                  }}
                                />
                              ) : dateStr ? (
                                <span className="text-xs">{dateStr}</span>
                              ) : (
                                <span>—</span>
                              )}
                              {pick && <span className={`inline-flex items-center px-1 py-0 rounded text-[9px] font-medium w-fit ${pick.cls}`}>{pick.label}</span>}
                            </div>
                          );
                        })()}
                      </td>
                      )}
                      {showCol("dealType") && (
                      <td className="px-2 py-1.5">
                        {e.dealType ? (
                          <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${DEAL_TYPE_BADGE_COLORS[e.dealType] || "bg-gray-100 text-gray-700"}`}>{e.dealType}</span>
                        ) : <span className="text-gray-400">—</span>}
                      </td>
                      )}
                      {showCol("agent") && <td className="px-2 py-1.5 text-gray-700">{e.agent ? e.agent.split(",").map(a => a.trim()).map(a => a.includes(" ") ? a.split(" ").map(p => p[0]).join("").toUpperCase() : a).join(", ") : "—"}</td>}
                      {showCol("dealStatus") && <td className="px-2 py-1.5 text-gray-600 truncate max-w-[100px]">{e.dealStatus || "—"}</td>}
                      {showCol("stage") && (
                      <td className="px-2 py-1.5 text-xs truncate max-w-[100px]">
                        {e.stage === "pipeline" ? (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800">Pipeline</span>
                        ) : e.stage === "wip" ? (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">WIP</span>
                        ) : e.stage === "invoiced" ? (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">Invoiced</span>
                        ) : (
                          <span className="text-gray-500">{e.stage || "—"}</span>
                        )}
                      </td>
                      )}
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-gray-100 border-t font-semibold">
                  <tr>
                    <td colSpan={1 + WIP_LEAD_KEYS.filter(showCol).length} className="px-2 py-1.5 text-gray-800">Total</td>
                    {showCol("amtWip") && (
                      <td className="px-2 py-1.5 text-gray-900 font-mono text-right">
                        {formatFullCurrency(sortedDetailEntries.reduce((s, e) => s + (e.amtWip || 0), 0))}
                      </td>
                    )}
                    {showCol("amtInvoice") && (
                      <td className="px-2 py-1.5 text-green-700 font-mono text-right">
                        {formatFullCurrency(sortedDetailEntries.reduce((s, e) => s + (e.amtInvoice || 0), 0))}
                      </td>
                    )}
                    {WIP_TRAIL_KEYS.filter(showCol).length > 0 && (
                      <td colSpan={WIP_TRAIL_KEYS.filter(showCol).length} className="px-2 py-1.5" />
                    )}
                  </tr>
                </tfoot>
              </table>
            </ScrollableTable>
          </div>
        </div>

        <div className="w-full md:w-52 md:flex-shrink-0 no-print md:overflow-y-auto space-y-3 min-h-0 md:max-h-full" data-testid="wip-filters-panel">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-700 uppercase tracking-wide flex items-center gap-1">
              <Filter className="h-3 w-3" /> Filters
            </span>
            {activeFilterCount > 0 && (
              <button
                onClick={() => {
                  setSelectedTeams(new Set(allTeams));
                  setSelectedMonths(new Set(allMonths));
                  setSelectedAgents(new Set(allAgents));
                  setSelectedStatuses(new Set(allStatuses));
                }}
                className="text-[10px] text-blue-600 hover:underline flex items-center gap-0.5"
                data-testid="wip-clear-all-filters"
              >
                <X className="h-3 w-3" /> Reset
              </button>
            )}
          </div>

          {allFiscalYears.length > 0 && (
            <div className="border border-gray-200 rounded-lg overflow-hidden" data-testid="wip-filter-fiscal-year">
              <div className="bg-gray-50 border-b px-3 py-2">
                <span className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Fiscal Year</span>
              </div>
              <div className="px-2 py-1">
                {allFiscalYears.map((yr) => (
                  <label key={yr} className="flex items-center gap-2 py-0.5 text-xs text-gray-700 cursor-pointer">
                    <Checkbox
                      checked={selectedFiscalYears.has(yr)}
                      onCheckedChange={(checked) => {
                        setSelectedFiscalYears(prev => {
                          const next = new Set(prev);
                          if (checked) {
                            next.add(yr);
                          } else {
                            next.delete(yr);
                            if (next.size === 0) next.add(yr);
                          }
                          return next;
                        });
                      }}
                      className="h-3 w-3"
                      data-testid={`wip-filter-fy-${yr}`}
                    />
                    <span>{yr === 0 ? "TBC" : yr}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <FilterSection
            title="Month"
            items={allMonths}
            selected={selectedMonths}
            onToggle={(m) => toggleFilter(selectedMonths, setSelectedMonths, m)}
            onSelectAll={() => setSelectedMonths(new Set(allMonths))}
            onClearAll={() => setSelectedMonths(new Set())}
          />

          <FilterSection
            title="BGP Contact"
            items={allAgents}
            selected={selectedAgents}
            onToggle={(a) => toggleFilter(selectedAgents, setSelectedAgents, a)}
            onSelectAll={() => setSelectedAgents(new Set(allAgents))}
            onClearAll={() => setSelectedAgents(new Set())}
          />

          <FilterSection
            title="Deal Status"
            items={allStatuses}
            selected={selectedStatuses}
            onToggle={(s) => toggleFilter(selectedStatuses, setSelectedStatuses, s)}
            onSelectAll={() => setSelectedStatuses(new Set(allStatuses))}
            onClearAll={() => setSelectedStatuses(new Set())}
          />

          <div className="text-[10px] text-gray-400 text-center pt-2">
            Live data from CRM deals
          </div>
        </div>
      </div>
      )}
    </div>
  );
}
