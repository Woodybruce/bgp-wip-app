import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { toDateInputValue } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Printer,
  ArrowUpDown,
  X,
  Upload,
  Loader2,
  Link2,
  Plus,
  Download,
} from "lucide-react";
import { FilterDropdown } from "@/components/wip-filter-dropdown";
import { ScrollableTable } from "@/components/scrollable-table";
import bgpLogo from "@assets/BGP_WhiteHolder.png_-_new_1771853582466.png";
import { useTeam } from "@/lib/team-context";
import { useBrand } from "@/lib/brand-context";
import { Link } from "wouter";
import { apiRequest, getAuthHeaders, invalidateDealCaches, queryClient } from "@/lib/queryClient";
import { RefreshCw } from "lucide-react";
import { legacyToCode, WIP_STATUSES, DEAL_STATUS_LABELS } from "@shared/deal-status";
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

// v2: filters are opt-in — empty selection means "show everything". The key
// bump discards v1 snapshots, which stored every option ticked by default.
const WIP_FILTERS_STORAGE_KEY = "bgp-wip-report-filters-v2";

interface SavedWipFilters {
  activeTab: "report" | "agent-summary" | "fee-check";
  clients?: string[];
  teams: string[];
  months: string[];
  agents: string[];
  projects?: string[];
  statuses: string[];
  fiscalYears: number[];
  detailSort: { column: string; direction: SortDirection };
}

function loadSavedWipFilters(): SavedWipFilters | null {
  try {
    const raw = sessionStorage.getItem(WIP_FILTERS_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as SavedWipFilters) : null;
  } catch {
    return null;
  }
}

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

function getMonthSortKey(m: string): number {
  const parsed = parseMonth(m);
  if (!parsed) return 99;
  const fyMonth = parsed.monthNum >= 4 ? parsed.monthNum - 4 : parsed.monthNum + 8;
  return parsed.calendarYear * 12 + fyMonth;
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

interface FeeReconRow {
  dealId: string;
  dealRef: number | null;
  name: string;
  team: string | null;
  agents: string | null;
  status: string | null;
  fee: number;
  xeroNet: number;
  xeroGross: number;
  diff: number;
  invoiceCount: number;
  invoiceNumbers: string | null;
}

// Fee Check — invoiced deals whose recorded fee (what the WIP + commission use)
// doesn't match the NET invoiced in Xero. Net-to-net, so VAT isn't flagged as a
// discrepancy. Leadership only (the tab is hidden otherwise).
function FeeCheckTab() {
  const { data = [], isLoading, error } = useQuery<FeeReconRow[]>({
    queryKey: ["/api/wip/fee-reconciliation"],
    queryFn: async () => {
      const res = await fetch("/api/wip/fee-reconciliation", { headers: getAuthHeaders() });
      if (!res.ok) throw new Error(String(res.status));
      return res.json();
    },
  });
  const money = (n: number) => `£${Math.round(n).toLocaleString("en-GB")}`;
  const { toast } = useToast();
  const [savingId, setSavingId] = useState<string | null>(null);

  // Set the deal's recorded fee to the Xero net — fixes the WIP + commission
  // in one go (both read deal.fee). Confirmed per row so a mis-click can't
  // silently move a fee. Writes via the normal deal PUT (audited).
  const matchToXero = async (row: FeeReconRow) => {
    if (!window.confirm(
      `Set the fee on ${row.dealRef ? `deal ${row.dealRef} ` : ""}"${row.name}" to ${money(row.xeroNet)} (Xero net)?\n\nThis updates the WIP report and the agents' commission.`,
    )) return;
    setSavingId(row.dealId);
    try {
      await apiRequest("PUT", `/api/crm/deals/${row.dealId}`, { fee: row.xeroNet });
      toast({ title: "Fee updated", description: `${row.name} set to ${money(row.xeroNet)}.` });
      queryClient.invalidateQueries({ queryKey: ["/api/wip/fee-reconciliation"] });
      invalidateDealCaches();
    } catch (e: any) {
      toast({ title: "Couldn't update fee", description: e?.message || "Please try again.", variant: "destructive" });
    } finally {
      setSavingId(null);
    }
  };

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">Checking fees against Xero…</div>;
  if (error) return <div className="p-6 text-sm text-muted-foreground">Couldn't load the fee check.</div>;
  if (data.length === 0) return (
    <div className="p-6 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg" data-testid="fee-check-clean">
      ✅ No discrepancies — every invoiced deal's recorded fee matches its Xero net figure.
    </div>
  );

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {data.length} deal{data.length === 1 ? "" : "s"} where the recorded fee doesn't match the net invoiced in Xero.
        The WIP and commission both use the <strong>recorded fee</strong>, so fix these on the Deals page to bring them in line with Xero.
      </p>
      <div className="bg-white border border-gray-200 rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left">
            <tr>
              <th className="px-3 py-2 font-medium">Deal</th>
              <th className="px-3 py-2 font-medium">Team</th>
              <th className="px-3 py-2 font-medium">Agent</th>
              <th className="px-3 py-2 font-medium text-right">Recorded fee</th>
              <th className="px-3 py-2 font-medium text-right">Xero net</th>
              <th className="px-3 py-2 font-medium text-right">Xero gross</th>
              <th className="px-3 py-2 font-medium text-right">Difference</th>
              <th className="px-3 py-2 font-medium">Invoice</th>
              <th className="px-3 py-2 font-medium">Fix</th>
            </tr>
          </thead>
          <tbody>
            {data.map((r) => (
              <tr key={r.dealId} className="border-t hover:bg-gray-50" data-testid={`fee-check-${r.dealId}`}>
                <td className="px-3 py-2">
                  <Link href={`/deals/${r.dealId}`}>
                    <span className="text-blue-600 hover:underline cursor-pointer">
                      {r.dealRef ? `${r.dealRef} · ` : ""}{r.name || "—"}
                    </span>
                  </Link>
                </td>
                <td className="px-3 py-2 text-gray-600">{r.team || "—"}</td>
                <td className="px-3 py-2 text-gray-600">{r.agents || "—"}</td>
                <td className="px-3 py-2 text-right font-mono">{money(r.fee)}</td>
                <td className="px-3 py-2 text-right font-mono">{money(r.xeroNet)}</td>
                <td className="px-3 py-2 text-right font-mono text-gray-400">{money(r.xeroGross)}</td>
                <td className={`px-3 py-2 text-right font-mono font-semibold ${r.diff < 0 ? "text-red-600" : "text-amber-600"}`}>
                  {r.diff >= 0 ? "+" : "-"}{money(Math.abs(r.diff))}
                </td>
                <td className="px-3 py-2 text-gray-500">{r.invoiceNumbers || "—"}</td>
                <td className="px-3 py-2">
                  <button
                    onClick={() => matchToXero(r)}
                    disabled={savingId === r.dealId}
                    className="text-xs px-2 py-1 rounded border border-blue-200 text-blue-700 hover:bg-blue-50 disabled:opacity-50 whitespace-nowrap"
                    data-testid={`fee-check-match-${r.dealId}`}
                  >
                    {savingId === r.dealId ? "Saving…" : `Set → ${money(r.xeroNet)}`}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
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
  const [savedFilters] = useState(loadSavedWipFilters);
  const [activeTab, setActiveTab] = useState<"report" | "agent-summary" | "fee-check">(savedFilters?.activeTab || "report");

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
  const [selectedClients, setSelectedClients] = useState<Set<string>>(() => new Set(savedFilters?.clients || []));
  const [selectedTeams, setSelectedTeams] = useState<Set<string>>(() => new Set(savedFilters?.teams || []));
  const [selectedMonths, setSelectedMonths] = useState<Set<string>>(() => new Set(savedFilters?.months || []));
  const [selectedAgents, setSelectedAgents] = useState<Set<string>>(() => new Set(savedFilters?.agents || []));
  const [selectedProjects, setSelectedProjects] = useState<Set<string>>(() => new Set(savedFilters?.projects || []));
  const [selectedStatuses, setSelectedStatuses] = useState<Set<string>>(() => new Set(savedFilters?.statuses || []));
  const [selectedFiscalYears, setSelectedFiscalYears] = useState<Set<number>>(() => new Set(savedFilters?.fiscalYears || []));
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
  const [detailSort, setDetailSort] = useState<{ column: string; direction: SortDirection }>(
    savedFilters?.detailSort || { column: "amtWip", direction: "desc" },
  );

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
    { key: "dealDate", label: "Target Month", width: "w-24" },
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
  // When the Deal Status filter is narrowed to Invoiced only, every row is a
  // done deal — the Target Month column is meaningless, so drop it entirely.
  const invoicedOnly =
    selectedStatuses.size > 0 &&
    [...selectedStatuses].every((s) => legacyToCode(s) === "INV");
  const colVisible = (k: string) => (k === "dealDate" && invoicedOnly ? false : showCol(k));
  const toggleWipCol = (k: string) => setHiddenWipCols((prev) => {
    const n = new Set(prev);
    if (n.has(k)) n.delete(k); else n.add(k);
    try { localStorage.setItem("bgp_wip_hidden_cols", JSON.stringify([...n])); } catch {}
    return n;
  });

  const allClients = useMemo(() => {
    const set = new Set(entries.map((e) => e.client).filter(Boolean) as string[]);
    return [...set].sort();
  }, [entries]);

  const allProjects = useMemo(() => {
    const set = new Set(entries.map((e) => e.project).filter(Boolean) as string[]);
    return [...set].sort();
  }, [entries]);

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

  // No default selections — the page opens showing every deal, and each
  // dropdown starts unticked. Ticking options narrows the report.
  useEffect(() => {
    try {
      const snapshot: SavedWipFilters = {
        activeTab,
        clients: [...selectedClients],
        teams: [...selectedTeams],
        months: [...selectedMonths],
        agents: [...selectedAgents],
        projects: [...selectedProjects],
        statuses: [...selectedStatuses],
        fiscalYears: [...selectedFiscalYears],
        detailSort,
      };
      sessionStorage.setItem(WIP_FILTERS_STORAGE_KEY, JSON.stringify(snapshot));
    } catch {
      // storage unavailable — filters just won't survive navigation
    }
  }, [activeTab, selectedClients, selectedTeams, selectedMonths, selectedAgents, selectedProjects, selectedStatuses, selectedFiscalYears, detailSort]);

  // A dropdown with nothing ticked applies no filter; any tick narrows.
  const filteredEntries = useMemo(() => {
    return entries.filter((e) => {
      if (selectedClients.size > 0) {
        if (!e.client || !selectedClients.has(e.client)) return false;
      }
      if (selectedTeams.size > 0) {
        if (!e.team) return false;
        const entryTeams = (e.team as string).split(",").map(t => t.trim()).filter(Boolean);
        if (!entryTeams.some(t => selectedTeams.has(t))) return false;
      }
      if (selectedFiscalYears.size > 0) {
        const rawFy = e.fiscalYear && e.fiscalYear >= 2000 && e.fiscalYear <= 2100 ? e.fiscalYear : null;
        const fy = rawFy || (e.month ? getFiscalYear(e.month) : null);
        if (fy) {
          if (!selectedFiscalYears.has(fy)) return false;
        } else {
          if (!selectedFiscalYears.has(0)) return false;
        }
      }
      if (selectedMonths.size > 0) {
        if (e.month && !selectedMonths.has(e.month)) return false;
      }
      if (selectedAgents.size > 0) {
        if (!e.agent) return false;
        const agentParts = (e.agent as string).split(",").map(a => normalizeAgent(a.trim()).toUpperCase()).filter(Boolean);
        if (!agentParts.some(a => selectedAgents.has(a))) return false;
      }
      if (selectedProjects.size > 0) {
        if (!e.project || !selectedProjects.has(e.project)) return false;
      }
      if (selectedStatuses.size > 0) {
        if (!e.dealStatus || !selectedStatuses.has(e.dealStatus)) return false;
      }
      return true;
    });
  }, [entries, selectedClients, selectedTeams, selectedMonths, selectedAgents, selectedProjects, selectedStatuses, selectedFiscalYears]);

  const totalWip = useMemo(
    () => filteredEntries.reduce((s, e) => s + (e.amtWip || 0), 0),
    [filteredEntries],
  );
  const totalInvoiced = useMemo(
    () => filteredEntries.reduce((s, e) => s + (e.amtInvoice || 0), 0),
    [filteredEntries],
  );
  const totalNetFees = totalWip + totalInvoiced;

  // Net fees per filter option, shown alongside each entry in the dropdown
  // lists (replaces the old summary boards). Computed from the full entry set
  // so option values stay stable while filtering. Team gets the full fee per
  // team (matching the old Team card); agents split the fee evenly.
  const filterFees = useMemo(() => {
    const client: Record<string, number> = {};
    const team: Record<string, number> = {};
    const agent: Record<string, number> = {};
    const project: Record<string, number> = {};
    const status: Record<string, number> = {};
    const month: Record<string, number> = {};
    entries.forEach((e) => {
      const fee = (e.amtWip || 0) + (e.amtInvoice || 0);
      if (e.client) client[e.client] = (client[e.client] || 0) + fee;
      if (e.project) project[e.project] = (project[e.project] || 0) + fee;
      if (e.dealStatus) status[e.dealStatus] = (status[e.dealStatus] || 0) + fee;
      if (e.month) month[e.month] = (month[e.month] || 0) + fee;
      if (e.team) {
        const teams = new Set((e.team as string).split(",").map(t => t.trim()).filter(Boolean));
        teams.forEach(t => { team[t] = (team[t] || 0) + fee; });
      }
      if (e.agent) {
        const parts = (e.agent as string).split(",").map(a => normalizeAgent(a.trim()).toUpperCase()).filter(Boolean);
        const perAgent = parts.length > 0 ? fee / parts.length : fee;
        parts.forEach(a => { agent[a] = (agent[a] || 0) + perAgent; });
      }
    });
    return { client, team, agent, project, status, month };
  }, [entries]);

  // The server emits one entry per agent fee-split (so agent filtering and
  // per-agent fees work), but Deal Detail should read one row per deal —
  // a split deal was showing twice. Collapse splits by dealId: sum the fee
  // shares, combine the agents. Merging AFTER filtering means an agent
  // filter still shows only that agent's share of a split deal.
  const mergedDetailEntries = useMemo(() => {
    const byDeal = new Map<string, WipDealEntry>();
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
            (existing.agent || "").split(",").map(a => a.trim()).filter(Boolean),
          );
          (e.agent as string).split(",").map(a => a.trim()).filter(Boolean).forEach(a => agents.add(a));
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
  }, [mergedDetailEntries, detailSort]);

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
    (selectedFiscalYears.size > 0 ? 1 : 0) +
    (selectedClients.size > 0 ? 1 : 0) +
    (selectedTeams.size > 0 ? 1 : 0) +
    (selectedMonths.size > 0 ? 1 : 0) +
    (selectedAgents.size > 0 ? 1 : 0) +
    (selectedProjects.size > 0 ? 1 : 0) +
    (selectedStatuses.size > 0 ? 1 : 0);

  const resetAllFilters = () => {
    setSelectedFiscalYears(new Set());
    setSelectedClients(new Set());
    setSelectedTeams(new Set());
    setSelectedMonths(new Set());
    setSelectedAgents(new Set());
    setSelectedProjects(new Set());
    setSelectedStatuses(new Set());
  };

  if (isLoading) {
    return (
      <div className="space-y-3 p-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full rounded-lg" />
        ))}
      </div>
    );
  }

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
          {canSeeAll && (
            <button
              onClick={() => setActiveTab("fee-check")}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === "fee-check"
                  ? "border-green-600 text-green-700"
                  : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
              }`}
              data-testid="wip-tab-fee-check"
            >
              Fee Check
            </button>
          )}
        </div>
      </div>

      {activeTab === "agent-summary" ? (
        <AgentSummaryTab />
      ) : activeTab === "fee-check" ? (
        <FeeCheckTab />
      ) : (
      <div className="flex flex-col gap-4 flex-1 min-h-0">
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

          {/* Filter dropdowns — one per former summary board */}
          <div className="flex flex-wrap items-center gap-2 flex-shrink-0 no-print" data-testid="wip-filters-bar">
            {allFiscalYears.length > 0 && (
              <FilterDropdown
                title="Fiscal Year"
                items={allFiscalYears.map((yr) => (yr === 0 ? "TBC" : String(yr)))}
                selected={new Set([...selectedFiscalYears].map((yr) => (yr === 0 ? "TBC" : String(yr))))}
                onToggle={(item) => {
                  const yr = item === "TBC" ? 0 : parseInt(item);
                  setSelectedFiscalYears(prev => {
                    const next = new Set(prev);
                    if (next.has(yr)) next.delete(yr); else next.add(yr);
                    return next;
                  });
                }}
                onClearAll={() => setSelectedFiscalYears(new Set())}
              />
            )}
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
            <FilterDropdown
              title="Team"
              items={allTeams}
              selected={selectedTeams}
              onToggle={(t) => toggleFilter(selectedTeams, setSelectedTeams, t)}
              onClearAll={() => setSelectedTeams(new Set())}
              values={filterFees.team}
            />
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
                onClick={resetAllFilters}
                className="text-xs text-blue-600 hover:underline flex items-center gap-0.5 ml-1"
                data-testid="wip-clear-all-filters"
              >
                <X className="h-3 w-3" /> Reset filters
              </button>
            )}
          </div>

          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden print-break flex-1 min-h-0 flex flex-col" data-testid="wip-detail-table">
            <div className="bg-gray-50 border-b px-3 py-2 flex items-center justify-between flex-shrink-0">
              <div>
                <span className="text-xs font-semibold text-gray-700 uppercase tracking-wide">
                  Deal Detail
                </span>
                <span className="text-xs text-gray-500 ml-2">({sortedDetailEntries.length} rows)</span>
              </div>
              <div className="flex items-center gap-2">
                {activeFilterCount > 0 && (
                  <Badge variant="secondary" className="text-[10px]">
                    {activeFilterCount} filter{activeFilterCount !== 1 ? "s" : ""} active
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
              <div className="flex items-center gap-3 px-4 py-2 bg-primary/5 border-b flex-shrink-0">
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
                    {WIP_DETAIL_COLS.filter((col) => colVisible(col.key)).map((col) => (
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
                      {colVisible("dealRef") && (
                      <td className="px-2 py-1.5 text-xs font-mono text-gray-400 whitespace-nowrap">
                        {e.dealRef ? `#${e.dealRef}` : "—"}
                      </td>
                      )}
                      {colVisible("ref") && (
                      <td className="px-2 py-1.5 text-gray-700 truncate max-w-[180px]">
                        {e.dealId ? (
                          <Link href={`/deals/${e.dealId}`}>
                            <span className="text-blue-600 hover:underline cursor-pointer" data-testid={`link-deal-${e.dealId}`}>{e.ref || "—"}</span>
                          </Link>
                        ) : (e.ref || "—")}
                      </td>
                      )}
                      {colVisible("client") && <td className="px-2 py-1.5 text-gray-700 truncate max-w-[130px]">{e.client || "—"}</td>}
                      {colVisible("tenant") && <td className="px-2 py-1.5 text-gray-700 truncate max-w-[150px]">{e.tenant || "—"}</td>}
                      {colVisible("project") && <td className="px-2 py-1.5 text-gray-700 truncate max-w-[150px]">{e.project || "—"}</td>}
                      {colVisible("billingEntity") && <td className="px-2 py-1.5 text-gray-700 truncate max-w-[150px]">{e.billingEntity || "—"}</td>}
                      {colVisible("team") && <td className="px-2 py-1.5 text-gray-700 truncate max-w-[150px]">{e.team || "—"}</td>}
                      {colVisible("amtWip") && (
                      <td className="px-2 py-1.5 text-gray-900 font-mono text-right">
                        {e.amtWip ? formatFullCurrency(e.amtWip) : "—"}
                      </td>
                      )}
                      {colVisible("amtInvoice") && (
                      <td className="px-2 py-1.5 text-green-700 font-mono text-right">
                        {e.amtInvoice ? formatFullCurrency(e.amtInvoice) : "—"}
                      </td>
                      )}
                      {colVisible("dealDate") && (
                      <td className="px-2 py-1.5 text-gray-600 whitespace-nowrap">
                        {(() => {
                          // Invoiced deals are done — a target month is meaningless,
                          // so the cell stays blank.
                          if (e.stage === "invoiced" || e.invoicedAt) return <span>—</span>;
                          const isActual = !!(e.exchangedAt || e.completedAt);
                          const pick = e.completedAt
                            ? { label: "Completed", iso: e.completedAt, cls: "bg-blue-100 text-blue-800" }
                            : e.exchangedAt
                            ? { label: "Exchanged", iso: e.exchangedAt, cls: "bg-amber-100 text-amber-800" }
                            : e.targetDate
                            ? { label: "Target", iso: e.targetDate, cls: "bg-gray-100 text-gray-700" }
                            : null;
                          const dateStr = pick ? (() => { const d = new Date(pick.iso); return isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-GB", { month: "short", year: "2-digit" }); })() : null;
                          return (
                            <div className="flex flex-col gap-0.5">
                              {!isActual && e.dealId ? (
                                <input
                                  type="month"
                                  // The target date belongs to the DEAL, so this saves to the deal —
                                  // every split row for that deal (e.g. AT / CR / LK) shares it, and
                                  // keying on targetDate remounts the other agents' inputs after the
                                  // refetch so they re-sync to the new date.
                                  //
                                  // Save on CHANGE, not blur: picking a date from the date popup often
                                  // doesn't blur the field, so the old onBlur save silently never fired
                                  // (this was the "I keep changing it and it won't save" bug).
                                  key={`wip-target-${e.dealId}-${e.targetDate ?? ""}`}
                                  defaultValue={toDateInputValue(e.targetDate).slice(0, 7)}
                                  className="text-xs border border-gray-200 rounded px-1 py-0.5 w-[150px] focus:outline-none focus:border-blue-400"
                                  onChange={async (ev) => {
                                    const val = ev.target.value;
                                    if (!val) return;
                                    // PUT /api/crm/deals/:id — the endpoint the Deals page uses. (The
                                    // old PATCH /api/deals/:id route never existed, so nothing saved.)
                                    // Month picker gives yyyy-MM; the deal stores a full date, so pin
                                    // the target to the 1st of the chosen month.
                                    try {
                                      await apiRequest("PUT", `/api/crm/deals/${e.dealId}`, { targetDate: `${val}-01` });
                                      toast({ title: "Target month updated", description: "Applied to everyone on this deal." });
                                      // Refetch so every split row on this deal re-syncs to the new date.
                                      invalidateDealCaches();
                                    } catch (err: any) {
                                      toast({ title: "Couldn't save target month", description: err?.message || "Please try again.", variant: "destructive" });
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
                      {colVisible("dealType") && (
                      <td className="px-2 py-1.5">
                        {e.dealType ? (
                          <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${DEAL_TYPE_BADGE_COLORS[e.dealType] || "bg-gray-100 text-gray-700"}`}>{e.dealType}</span>
                        ) : <span className="text-gray-400">—</span>}
                      </td>
                      )}
                      {colVisible("agent") && <td className="px-2 py-1.5 text-gray-700">{e.agent ? e.agent.split(",").map(a => a.trim()).map(a => a.includes(" ") ? a.split(" ").map(p => p[0]).join("").toUpperCase() : a).join(", ") : "—"}</td>}
                      {colVisible("dealStatus") && <td className="px-2 py-1.5 text-gray-600 truncate max-w-[100px]">{e.dealStatus || "—"}</td>}
                      {colVisible("stage") && (
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
                    <td colSpan={1 + WIP_LEAD_KEYS.filter(colVisible).length} className="px-2 py-1.5 text-gray-800">Total</td>
                    {colVisible("amtWip") && (
                      <td className="px-2 py-1.5 text-gray-900 font-mono text-right">
                        {formatFullCurrency(sortedDetailEntries.reduce((s, e) => s + (e.amtWip || 0), 0))}
                      </td>
                    )}
                    {colVisible("amtInvoice") && (
                      <td className="px-2 py-1.5 text-green-700 font-mono text-right">
                        {formatFullCurrency(sortedDetailEntries.reduce((s, e) => s + (e.amtInvoice || 0), 0))}
                      </td>
                    )}
                    {WIP_TRAIL_KEYS.filter(colVisible).length > 0 && (
                      <td colSpan={WIP_TRAIL_KEYS.filter(colVisible).length} className="px-2 py-1.5" />
                    )}
                  </tr>
                </tfoot>
              </table>
            </ScrollableTable>
          </div>
      </div>
      )}
    </div>
  );
}
