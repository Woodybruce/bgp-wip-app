import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
import { apiRequest, getAuthHeaders } from "@/lib/queryClient";
import { RefreshCw } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

type SortDirection = "asc" | "desc";

interface WipDealEntry {
  id: string;
  dealId: string;
  dealType: string | null;
  ref: string;
  groupName: string | null;
  project: string | null;
  tenant: string | null;
  team: string | null;
  agent: string | null;
  assetClass: string | null;
  amtWip: number | null;
  amtInvoice: number | null;
  month: string | null;
  dealStatus: string | null;
  stage: string | null;
  invoiceNo: string | null;
  orderNumber: string | null;
  fiscalYear: number | null;
  source?: "crm" | "spreadsheet";
}

interface ReconciliationData {
  dealsWithoutWip: Array<{
    id: string;
    name: string;
    dealType: string | null;
    status: string | null;
    fee: number | null;
    team: string[] | null;
    internalAgent: string[] | null;
    propertyName: string | null;
  }>;
  wipWithoutDeals: Array<{
    id: string;
    ref: string | null;
    project: string | null;
    agent: string | null;
    team: string | null;
    amtWip: number | null;
    amtInvoice: number | null;
    groupName: string | null;
    dealStatus: string | null;
  }>;
}

const DEAL_TYPE_BADGE_COLORS: Record<string, string> = {
  "Acquisition": "bg-blue-100 text-blue-800",
  "Sale": "bg-red-100 text-red-800",
  "Leasing": "bg-green-100 text-green-800",
  "Lease Renewal": "bg-purple-100 text-purple-800",
  "Rent Review": "bg-orange-100 text-orange-800",
  "Investment": "bg-indigo-100 text-indigo-800",
  "Lease Advisory": "bg-cyan-100 text-cyan-800",
  "Tenant Rep": "bg-rose-100 text-rose-800",
  "Lease Acquisition": "bg-violet-100 text-violet-800",
  "Lease Disposal": "bg-amber-100 text-amber-800",
  "Regear": "bg-teal-100 text-teal-800",
  "Purchase": "bg-emerald-100 text-emerald-800",
  "New Letting": "bg-lime-100 text-lime-800",
  "Sub-Letting": "bg-sky-100 text-sky-800",
  "Assignment": "bg-slate-100 text-slate-800",
};

type ClickFilter = {
  field: "groupName" | "team" | "agent" | "project" | "dealStatus" | "month";
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
}: {
  title: string;
  data: Array<{ label: string; value: number; clickValue?: string }>;
  valueLabel: string;
  activeValue: string | null;
  onRowClick: (field: string, value: string) => void;
  field: string;
}) {
  const total = data.reduce((s, d) => s + d.value, 0);

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
                    ? "bg-green-100 border-l-2 border-green-600"
                    : "hover:bg-gray-50"
                }`}
                onClick={() => onRowClick(field, cv)}
                data-testid={`wip-click-${field}-${cv}`}
              >
                <span className={`truncate flex-1 mr-1 ${activeValue === cv ? "text-green-900 font-semibold" : "text-gray-800"}`}>
                  {row.label}
                </span>
                <span className={`font-mono font-medium text-right whitespace-nowrap ${activeValue === cv ? "text-green-900" : "text-gray-900"}`}>
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
      <ScrollArea className="max-h-[220px] px-2 py-1">
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
      </ScrollArea>
    </div>
  );
}

function ReconciliationTab() {
  const { data, isLoading } = useQuery<ReconciliationData>({
    queryKey: ["/api/wip/reconciliation"],
    queryFn: async () => {
      const res = await fetch("/api/wip/reconciliation", { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to fetch reconciliation data");
      return res.json();
    },
  });

  const dealsWithoutWip = data?.dealsWithoutWip || [];
  const wipWithoutDeals = data?.wipWithoutDeals || [];

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
      {/* Deals without WIP */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden" data-testid="recon-deals-without-wip">
        <div className="bg-gray-50 border-b px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-gray-700">Deals not on WIP</span>
            <Badge variant="secondary" className="text-xs">
              {dealsWithoutWip.length}
            </Badge>
          </div>
        </div>
        {dealsWithoutWip.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-gray-500">
            All active deals are matched to WIP entries
          </div>
        ) : (
          <ScrollableTable minWidth={900}>
            <table className="w-full">
              <thead className="bg-gray-50 border-b sticky top-0 z-10 text-sm">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-gray-600 w-48">Deal Name</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600 w-40">Property</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600 w-32">Assigned To</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600 w-24">Status</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-600 w-28">Expected Fee</th>
                  <th className="px-3 py-2 text-center font-medium text-gray-600 w-28">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-xs">
                {dealsWithoutWip.map((deal) => (
                  <tr key={deal.id} className="hover:bg-gray-50" data-testid={`recon-deal-row-${deal.id}`}>
                    <td className="px-3 py-2 text-gray-700">
                      <Link href={`/deals/${deal.id}`}>
                        <span className="text-blue-600 hover:underline cursor-pointer">{deal.name}</span>
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-gray-700 truncate max-w-[160px]">{deal.propertyName || "—"}</td>
                    <td className="px-3 py-2 text-gray-700 truncate max-w-[130px]">
                      {Array.isArray(deal.internalAgent) ? deal.internalAgent.join(", ") : deal.internalAgent || "—"}
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant="secondary" className="text-[10px]">
                        {deal.status || "—"}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-gray-900">
                      {deal.fee ? `£${deal.fee.toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}` : "—"}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <Button variant="outline" size="sm" className="h-6 text-[10px] gap-1">
                        <Link2 className="w-3 h-3" />
                        Link to WIP
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollableTable>
        )}
      </div>

      {/* WIP entries without deals */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden" data-testid="recon-wip-without-deals">
        <div className="bg-gray-50 border-b px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-gray-700">WIP entries without a deal</span>
            <Badge variant="secondary" className="text-xs">
              {wipWithoutDeals.length}
            </Badge>
          </div>
        </div>
        {wipWithoutDeals.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-gray-500">
            All WIP entries are matched to CRM deals
          </div>
        ) : (
          <ScrollableTable minWidth={800}>
            <table className="w-full">
              <thead className="bg-gray-50 border-b sticky top-0 z-10 text-sm">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-gray-600 w-32">Ref</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600 w-40">Project / Property</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600 w-28">Fee Earner</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-600 w-28">WIP Amount</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-600 w-28">Invoice Amount</th>
                  <th className="px-3 py-2 text-center font-medium text-gray-600 w-28">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-xs">
                {wipWithoutDeals.map((wip) => (
                  <tr key={wip.id} className="hover:bg-gray-50" data-testid={`recon-wip-row-${wip.id}`}>
                    <td className="px-3 py-2 text-gray-700 truncate max-w-[130px]">{wip.ref || "—"}</td>
                    <td className="px-3 py-2 text-gray-700 truncate max-w-[160px]">{wip.project || "—"}</td>
                    <td className="px-3 py-2 text-gray-700 truncate max-w-[120px]">{wip.agent || "—"}</td>
                    <td className="px-3 py-2 text-right font-mono text-gray-900">
                      {wip.amtWip ? `£${wip.amtWip.toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}` : "—"}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-green-700">
                      {wip.amtInvoice ? `£${wip.amtInvoice.toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}` : "—"}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <Button variant="outline" size="sm" className="h-6 text-[10px] gap-1">
                        <Plus className="w-3 h-3" />
                        Create Deal
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollableTable>
        )}
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

  const agents = summaryData || [];
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
                <th className="px-4 py-2 text-left font-medium text-gray-600">Agent Name</th>
                <th className="px-4 py-2 text-right font-medium text-gray-600">WIP Amount</th>
                <th className="px-4 py-2 text-right font-medium text-gray-600">Invoiced Amount</th>
                <th className="px-4 py-2 text-right font-medium text-gray-600">Total</th>
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
                    <th className="px-3 py-2 text-left font-medium text-gray-600">Deal Name</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-600">Property</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-600">Type</th>
                    <th className="px-3 py-2 text-right font-medium text-gray-600">Total Fee</th>
                    <th className="px-3 py-2 text-right font-medium text-gray-600">Allocated</th>
                    <th className="px-3 py-2 text-center font-medium text-gray-600">Status</th>
                    <th className="px-3 py-2 text-center font-medium text-gray-600">Stage</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 text-xs">
                  {drilldownData.map((d) => (
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
  const [activeTab, setActiveTab] = useState<"report" | "reconciliation" | "agent-summary">("report");

  const { data: user } = useQuery<{ id: string; name: string; email: string; team: string; isAdmin?: boolean }>({
    queryKey: ["/api/auth/me"],
  });

  const { data: reconData } = useQuery<ReconciliationData>({
    queryKey: ["/api/wip/reconciliation"],
    queryFn: async () => {
      const res = await fetch("/api/wip/reconciliation", { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to fetch reconciliation data");
      return res.json();
    },
  });

  const reconCount = (reconData?.dealsWithoutWip?.length || 0) + (reconData?.wipWithoutDeals?.length || 0);

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

  const isLandsecView = activeTeam === "Landsec";

  const entries = useMemo(() => {
    let filtered = rawEntries;
    if (isLandsecView) {
      filtered = filtered.filter((e) => {
        const gn = (e.groupName || "").toLowerCase().replace(/\s+/g, "");
        return gn === "landsec" || gn === "landsecurities" || gn.includes("landsec");
      });
    } else if (isWipAdmin && activeTeam && activeTeam !== "all") {
      const at = activeTeam.toLowerCase();
      filtered = filtered.filter((e) => {
        if (!e.team) return false;
        const teams = (e.team as string).split(",").map(t => t.trim().toLowerCase());
        return teams.some(t => t === at);
      });
    }
    return filtered;
  }, [rawEntries, isLandsecView, activeTeam, isWipAdmin]);

  const INVOICED_STATUSES = useMemo(() => ["Invoiced", "Billed"], []);
  const [selectedTeams, setSelectedTeams] = useState<Set<string>>(new Set());
  const [selectedMonths, setSelectedMonths] = useState<Set<string>>(new Set());
  const [selectedAgents, setSelectedAgents] = useState<Set<string>>(new Set());
  const [selectedStatuses, setSelectedStatuses] = useState<Set<string>>(new Set());
  const [selectedFiscalYears, setSelectedFiscalYears] = useState<Set<number>>(new Set());
  const [clickFilter, setClickFilter] = useState<ClickFilter>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [uploading, setUploading] = useState(false);
  const [appendUploading, setAppendUploading] = useState(false);
  const [syncingXero, setSyncingXero] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

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

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>, append = false) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const setter = append ? setAppendUploading : setUploading;
    setter(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const token = localStorage.getItem("bgp_auth_token");
      const url = append ? "/api/wip/import?append=true" : "/api/wip/import";
      const res = await fetch(url, {
        method: "POST",
        body: formData,
        credentials: "include",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Upload failed");
      }
      const data = await res.json();
      toast({ title: append ? "Data Added" : "WIP Updated", description: `${append ? "Appended" : "Imported"} ${data.imported} entries from spreadsheet.` });
      filtersInitialized.current = false;
      queryClient.invalidateQueries({ queryKey: ["/api/wip"] });
    } catch (err: any) {
      toast({ title: "Upload failed", description: err?.message || "Could not import file.", variant: "destructive" });
    } finally {
      setter(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };
  const [detailSort, setDetailSort] = useState<{ column: string; direction: SortDirection }>({
    column: "amtWip",
    direction: "desc",
  });

  const handleClickFilter = useCallback((field: string, value: string) => {
    setClickFilter((prev) => {
      if (prev && prev.field === field && prev.value === value) return null;
      return { field: field as ClickFilter extends null ? never : NonNullable<ClickFilter>["field"], value };
    });
  }, []);

  const clearClickFilter = useCallback(() => setClickFilter(null), []);

  const allTeams = useMemo(() => {
    const set = new Set(entries.map((e) => e.team).filter(Boolean) as string[]);
    return [...set].sort();
  }, [entries]);

  const allMonths = useMemo(() => {
    const set = new Set(entries.map((e) => e.month).filter(Boolean) as string[]);
    return [...set].sort((a, b) => getMonthSortKey(a) - getMonthSortKey(b));
  }, [entries]);

  const allAgents = useMemo(() => {
    const map = new Map<string, string>(); // lowercase key → display value
    entries.forEach((e) => {
      if (e.agent) {
        const parts = (e.agent as string).split(",").map(a => a.trim()).filter(Boolean);
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
      if (e.fiscalYear) {
        set.add(e.fiscalYear);
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
        if (!e.team || !selectedTeams.has(e.team)) return false;
      }
      if (selectedFiscalYears.size > 0 && selectedFiscalYears.size < allFiscalYears.length) {
        const fy = e.fiscalYear || (e.month ? getFiscalYear(e.month) : null);
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
        const agentParts = (e.agent as string).split(",").map(a => a.trim().toUpperCase()).filter(Boolean);
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
    return sidebarFilteredEntries.filter((e) => {
      if (clickFilter.field === "agent") {
        const agentField = (e.agent || "unknown").trim();
        const agents = agentField.split(",").map(a => a.trim()).filter(Boolean);
        const target = clickFilter.value.toLowerCase();
        return agents.some(a => a.toLowerCase() === target);
      }
      const val = e[clickFilter.field];
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
      const g = e.groupName || "Unknown";
      map[g] = (map[g] || 0) + (e.amtWip || 0) + (e.amtInvoice || 0);
    });
    return Object.entries(map)
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value);
  }, [filteredEntries]);

  const teamData = useMemo(() => {
    const map: Record<string, number> = {};
    filteredEntries.forEach((e) => {
      const t = e.team || "Unknown";
      map[t] = (map[t] || 0) + (e.amtWip || 0) + (e.amtInvoice || 0);
    });
    return Object.entries(map)
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value);
  }, [filteredEntries]);

  const agentData = useMemo(() => {
    const map: Record<string, number> = {};
    filteredEntries.forEach((e) => {
      const agentField = e.agent || "Unknown";
      const agents = agentField.split(",").map(a => a.trim()).filter(Boolean);
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
        case "ref": aVal = a.ref || ""; bVal = b.ref || ""; break;
        case "groupName": aVal = a.groupName || ""; bVal = b.groupName || ""; break;
        case "project": aVal = a.project || ""; bVal = b.project || ""; break;
        case "tenant": aVal = a.tenant || ""; bVal = b.tenant || ""; break;
        case "team": aVal = a.team || ""; bVal = b.team || ""; break;
        case "dealType": aVal = a.dealType || ""; bVal = b.dealType || ""; break;
        case "agent": aVal = a.agent || ""; bVal = b.agent || ""; break;
        case "amtWip": aVal = a.amtWip || 0; bVal = b.amtWip || 0; break;
        case "amtInvoice": aVal = a.amtInvoice || 0; bVal = b.amtInvoice || 0; break;
        case "month": aVal = getMonthSortKey(a.month || ""); bVal = getMonthSortKey(b.month || ""); break;
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
      queryClient.invalidateQueries({ queryKey: ["/api/wip"] });
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
    <div className="h-[calc(100vh-64px)] flex flex-col overflow-hidden p-4 sm:p-6 print:p-2 print:h-auto print:overflow-visible" data-testid="wip-report-page">
      <style>{`
        @media print {
          .no-print { display: none !important; }
          .print-break { page-break-before: always; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      `}</style>

      <div className="flex items-center justify-between flex-shrink-0 mb-4">
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
                const teamLabel = isWipAdmin
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
        <div className="flex items-center gap-2 no-print">
          {clickFilter && (
            <Button variant="outline" size="sm" onClick={clearClickFilter} data-testid="wip-clear-click-filter">
              <X className="h-4 w-4 mr-1" />
              Clear: {clickFilter.value}
            </Button>
          )}
          {isSeniorWipUser && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={(e) => handleUpload(e, false)}
                data-testid="wip-upload-input"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                data-testid="wip-upload-button"
              >
                {uploading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Upload className="h-4 w-4 mr-1" />}
                {uploading ? "Importing..." : "Upload WIP"}
              </Button>
            </>
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
      <div className="flex items-center gap-1 mb-4 flex-shrink-0 no-print border-b" data-testid="wip-tabs">
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
          onClick={() => setActiveTab("reconciliation")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5 ${
            activeTab === "reconciliation"
              ? "border-green-600 text-green-700"
              : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
          }`}
          data-testid="wip-tab-reconciliation"
        >
          Reconciliation
          {reconCount > 0 && (
            <Badge variant="secondary" className="text-[10px] h-4 px-1.5">
              {reconCount}
            </Badge>
          )}
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

      {activeTab === "reconciliation" ? (
        <ReconciliationTab />
      ) : activeTab === "agent-summary" ? (
        <AgentSummaryTab />
      ) : (
      <div className="flex gap-4 flex-1 min-h-0">
        <div className="flex-1 overflow-y-auto space-y-4 min-h-0">
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
              title="Group"
              data={groupData}
              valueLabel="Net fees"
              activeValue={clickFilterActiveField === "groupName" ? clickFilterActiveValue : null}
              onRowClick={handleClickFilter}
              field="groupName"
            />
            <ClickableSummaryTable
              title="Team"
              data={teamData}
              valueLabel="Net fees"
              activeValue={clickFilterActiveField === "team" ? clickFilterActiveValue : null}
              onRowClick={handleClickFilter}
              field="team"
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
              title="Project"
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
              {clickFilter && (
                <Badge variant="secondary" className="text-[10px]">
                  Filtered by {clickFilter.field === "groupName" ? "Group" : clickFilter.field === "dealStatus" ? "Status" : clickFilter.field}: {clickFilter.value}
                </Badge>
              )}
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
                    {[
                      { key: "ref", label: "Deal", width: "w-40" },
                      { key: "groupName", label: "Group", width: "w-28" },
                      { key: "project", label: "Project", width: "w-32" },
                      { key: "tenant", label: "Tenant", width: "w-32" },
                      { key: "team", label: "Team", width: "w-32" },
                      { key: "dealType", label: "Deal Type", width: "w-24" },
                      { key: "agent", label: "BGP Contact", width: "w-20" },
                      { key: "amtWip", label: "Amt WIP", width: "w-24" },
                      { key: "amtInvoice", label: "Amt invoice", width: "w-24" },
                      { key: "month", label: "Month", width: "w-16" },
                      { key: "dealStatus", label: "Deal Status", width: "w-24" },
                      { key: "stage", label: "Stage", width: "w-24" },
                    ].map((col) => (
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
                      <td className="px-2 py-1.5 text-gray-700 truncate max-w-[180px]">
                        {e.dealId ? (
                          <Link href={`/deals/${e.dealId}`}>
                            <span className="text-blue-600 hover:underline cursor-pointer" data-testid={`link-deal-${e.dealId}`}>{e.ref || "—"}</span>
                          </Link>
                        ) : (e.ref || "—")}
                      </td>
                      <td className="px-2 py-1.5 text-gray-700 truncate max-w-[130px]">{e.groupName || "—"}</td>
                      <td className="px-2 py-1.5 text-gray-700 truncate max-w-[150px]">{e.project || "—"}</td>
                      <td className="px-2 py-1.5 text-gray-700 truncate max-w-[150px]">{e.tenant || "—"}</td>
                      <td className="px-2 py-1.5 text-gray-700 truncate max-w-[150px]">{e.team || "—"}</td>
                      <td className="px-2 py-1.5">
                        {e.dealType ? (
                          <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${DEAL_TYPE_BADGE_COLORS[e.dealType] || "bg-gray-100 text-gray-700"}`}>{e.dealType}</span>
                        ) : <span className="text-gray-400">—</span>}
                      </td>
                      <td className="px-2 py-1.5 text-gray-700">{e.agent ? e.agent.split(",").map(a => a.trim()).map(a => a.includes(" ") ? a.split(" ").map(p => p[0]).join("").toUpperCase() : a).join(", ") : "—"}</td>
                      <td className="px-2 py-1.5 text-gray-900 font-mono text-right">
                        {e.amtWip ? formatFullCurrency(e.amtWip) : "—"}
                      </td>
                      <td className="px-2 py-1.5 text-green-700 font-mono text-right">
                        {e.amtInvoice ? formatFullCurrency(e.amtInvoice) : "—"}
                      </td>
                      <td className="px-2 py-1.5 text-gray-600">{e.month || "—"}</td>
                      <td className="px-2 py-1.5 text-gray-600 truncate max-w-[100px]">{e.dealStatus || "—"}</td>
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
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-gray-100 border-t font-semibold">
                  <tr>
                    <td colSpan={8} className="px-2 py-1.5 text-gray-800">Total</td>
                    <td className="px-2 py-1.5 text-gray-900 font-mono text-right">
                      {formatFullCurrency(sortedDetailEntries.reduce((s, e) => s + (e.amtWip || 0), 0))}
                    </td>
                    <td className="px-2 py-1.5 text-green-700 font-mono text-right">
                      {formatFullCurrency(sortedDetailEntries.reduce((s, e) => s + (e.amtInvoice || 0), 0))}
                    </td>
                    <td colSpan={3} className="px-2 py-1.5" />
                  </tr>
                </tfoot>
              </table>
            </ScrollableTable>
          </div>
        </div>

        <div className="w-52 flex-shrink-0 no-print overflow-y-auto space-y-3 min-h-0 max-h-full" data-testid="wip-filters-panel">
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
