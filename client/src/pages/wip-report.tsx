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
  Search as SearchIcon,
} from "lucide-react";
import { FilterDropdown } from "@/components/wip-filter-dropdown";
import { Pill } from "@/components/ui/pill";
import { ScrollableTable } from "@/components/scrollable-table";
import bgpLogo from "@assets/BGP_WhiteHolder.png_-_new_1771853582466.png";
import { useTeam } from "@/lib/team-context";
import { useBrand } from "@/lib/brand-context";
import { Link } from "wouter";
import { apiRequest, getAuthHeaders, invalidateDealCaches, queryClient } from "@/lib/queryClient";
import { RefreshCw } from "lucide-react";
import { legacyToCode, WIP_STATUSES, DEAL_STATUS_LABELS, DEAL_STATUS_DOT_COLORS, DEAL_PAGE_STATUSES } from "@shared/deal-status";
import { InlineLabelSelect } from "@/components/inline-edit";
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
  clientId?: string | null;
  project: string | null;
  propertyId?: string | null;
  tenant: string | null;
  tenantId?: string | null;
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
  activeTab: "report" | "agent-summary" | "fee-check" | "health";
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
// Needs Attention — the unlinked-entries audit (Woody, 2026-08-23: "there
// are entries which are not linked"). Each bucket is a data problem that
// distorts the report and the equity Finance projections; every row links to
// its deal so it can be fixed in place.
function HealthTab() {
  const { data, isLoading, error } = useQuery<any>({
    queryKey: ["/api/wip/health"],
    queryFn: async () => {
      const res = await fetch("/api/wip/health", { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to load data health");
      return res.json();
    },
  });
  const money = (n: number) => `£${Math.round(n || 0).toLocaleString("en-GB")}`;
  if (isLoading) return <Skeleton className="h-[300px]" />;
  if (error || !data) return <p className="text-sm text-muted-foreground p-4">Couldn't load the audit — try again shortly.</p>;
  const b = data.buckets;
  const sections: Array<{ key: string; title: string; why: string; data: any }> = [
    { key: "noClient", title: "No client linked", why: "Shows as \"Unknown\" in the Client column — set the landlord / tenant / vendor / purchaser on the deal.", data: b.noClient },
    { key: "noAgent", title: "No BGP agent", why: "Invisible in the Agent Summary and earns nobody commission — add the agent or a fee allocation.", data: b.noAgent },
    { key: "noDate", title: "No date at all", why: "No target, exchange or completion date — the deal lands in no month and skews the year view.", data: b.noDate },
    { key: "invNoXero", title: "Invoiced with no Xero invoice", why: "Status says Invoiced but no Xero invoice is linked — raise or link the invoice so cash tracking works.", data: b.invNoXero },
    { key: "noFee", title: "Live deal with no fee", why: "In the pipeline but fee is blank — it's excluded from the WIP report entirely (invisible money).", data: b.noFee },
    { key: "noProperty", title: "No property linked", why: "Fine for consultancy mandates; worth linking for everything else.", data: b.noProperty },
  ];
  return (
    <div className="space-y-4" data-testid="wip-health-tab">
      <div className="rounded-lg border bg-amber-50 border-amber-200 px-4 py-3">
        <p className="text-sm font-medium text-amber-900">
          {data.affected.count > 0
            ? `${data.affected.count} deal(s) worth ${money(data.affected.fee)} have broken links that distort this report and the Finance projections.`
            : "All linked — every WIP deal has a client, agent and date. Lovely."}
        </p>
        <p className="text-xs text-amber-800/80 mt-0.5">{data.totalWipDeals} deals checked · tap any row to open the deal and fix it</p>
      </div>
      {sections.filter(sec => sec.data.count > 0).map(sec => (
        <div key={sec.key} className="bg-card border border-border rounded-lg overflow-hidden">
          <div className="px-4 py-2.5 border-b bg-muted/50 flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold">{sec.title} <span className="text-muted-foreground font-normal">({sec.data.count}{sec.data.fee ? ` · ${money(sec.data.fee)}` : ""})</span></p>
              <p className="text-[11px] text-muted-foreground">{sec.why}</p>
            </div>
          </div>
          <div className="divide-y divide-border">
            {sec.data.deals.map((d: any) => (
              <Link key={d.dealId} href={`/deals/${d.dealId}`}>
                <div className="flex items-center gap-3 px-4 py-2 hover:bg-muted cursor-pointer text-sm">
                  <span className="flex-1 min-w-0 truncate">
                    {d.name || "(unnamed deal)"}
                    <span className="text-xs text-muted-foreground"> {d.dealType ? `· ${d.dealType}` : ""}{d.team ? ` · ${d.team}` : ""}</span>
                  </span>
                  <Badge variant="secondary" className="text-[10px] shrink-0">{(() => { const c = legacyToCode(d.status); return c ? DEAL_STATUS_LABELS[c] : d.status; })()}</Badge>
                  <span className="font-mono text-xs shrink-0 w-20 text-right">{d.fee ? money(d.fee) : "—"}</span>
                </div>
              </Link>
            ))}
            {sec.data.count > sec.data.deals.length && (
              <p className="px-4 py-2 text-[11px] text-muted-foreground">Showing first {sec.data.deals.length} of {sec.data.count}.</p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

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

  const blanks = data.filter(r => !r.fee && r.xeroNet > 0);
  const fillBlanks = async () => {
    const total = blanks.reduce((s, r) => s + r.xeroNet, 0);
    if (!window.confirm(
      `Fill ${blanks.length} blank recorded fee${blanks.length === 1 ? "" : "s"} from Xero (${money(total)} total)?\n\nOnly deals with NO recorded fee are touched — each is set to its Xero invoice net and logged on the deal. This updates the WIP report and the agents' commission.`,
    )) return;
    setSavingId("__bulk__");
    try {
      const r = await apiRequest("POST", "/api/wip/fill-blank-fees");
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "failed");
      toast({ title: "Fees filled from Xero", description: `${j.filled} deal${j.filled === 1 ? "" : "s"} updated.` });
      queryClient.invalidateQueries({ queryKey: ["/api/wip/fee-reconciliation"] });
      invalidateDealCaches();
    } catch (e: any) {
      toast({ title: "Couldn't fill fees", description: e?.message || "Please try again.", variant: "destructive" });
    } finally { setSavingId(null); }
  };

  return (
    <div className="space-y-3">
      {blanks.length > 0 && (
        <div className="flex items-center justify-between gap-3 flex-wrap rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 px-4 py-3" data-testid="fill-blank-fees-banner">
          <p className="text-sm text-amber-900 dark:text-amber-200">
            <strong>{blanks.length}</strong> invoiced deal{blanks.length === 1 ? " has" : "s have"} <strong>no recorded fee</strong> but a linked Xero invoice
            ({money(blanks.reduce((s, r) => s + r.xeroNet, 0))} net) — invisible in the WIP and paying nobody commission.
          </p>
          <Button size="sm" onClick={fillBlanks} disabled={savingId === "__bulk__"} data-testid="button-fill-blank-fees">
            {savingId === "__bulk__" ? "Filling…" : "Fill them from Xero"}
          </Button>
        </div>
      )}
      <p className="text-sm text-muted-foreground">
        {data.length} deal{data.length === 1 ? "" : "s"} where the recorded fee doesn't match the net invoiced in Xero.
        The WIP and commission both use the <strong>recorded fee</strong>, so fix these on the Deals page to bring them in line with Xero.
      </p>
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        {/* Phone: one card per discrepancy (§7) — the table never ships below md. */}
        <div className="md:hidden divide-y divide-border">
          {data.map((r) => (
            <div key={r.dealId} className="px-4 py-3" data-testid={`fee-check-card-${r.dealId}`}>
              <div className="flex items-start justify-between gap-2">
                <Link href={`/deals/${r.dealId}`}>
                  <span className="text-sm font-medium text-primary cursor-pointer">
                    {r.dealRef ? `${r.dealRef} · ` : ""}{r.name || "—"}
                  </span>
                </Link>
                <span className={`text-sm font-mono tabular-nums font-semibold shrink-0 ${r.diff < 0 ? "text-red-600" : "text-amber-600"}`}>
                  {r.diff >= 0 ? "+" : "-"}{money(Math.abs(r.diff))}
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                {r.team || "—"}{r.agents ? ` · ${r.agents}` : ""}
              </p>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-[11px] text-muted-foreground">
                <span className="whitespace-nowrap">Recorded <span className="font-mono tabular-nums text-foreground">{money(r.fee)}</span></span>
                <span className="whitespace-nowrap">Xero net <span className="font-mono tabular-nums text-foreground">{money(r.xeroNet)}</span></span>
                <span className="whitespace-nowrap">Gross <span className="font-mono tabular-nums">{money(r.xeroGross)}</span></span>
              </div>
              <div className="flex items-center justify-between gap-2 mt-1.5">
                <span className="text-[11px] text-muted-foreground truncate">{r.invoiceNumbers || "—"}</span>
                <button
                  onClick={() => matchToXero(r)}
                  disabled={savingId === r.dealId}
                  className="text-xs px-2 py-1 rounded border border-border hover:bg-muted disabled:opacity-50 whitespace-nowrap shrink-0"
                  data-testid={`fee-check-match-card-${r.dealId}`}
                >
                  {savingId === r.dealId ? "Saving…" : `Set → ${money(r.xeroNet)}`}
                </button>
              </div>
            </div>
          ))}
        </div>
        <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
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
              <tr key={r.dealId} className="border-t hover:bg-muted" data-testid={`fee-check-${r.dealId}`}>
                <td className="px-3 py-2">
                  <Link href={`/deals/${r.dealId}`}>
                    <span className="text-primary hover:underline cursor-pointer">
                      {r.dealRef ? `${r.dealRef} · ` : ""}{r.name || "—"}
                    </span>
                  </Link>
                </td>
                <td className="px-3 py-2 text-muted-foreground">{r.team || "—"}</td>
                <td className="px-3 py-2 text-muted-foreground">{r.agents || "—"}</td>
                <td className="px-3 py-2 text-right font-mono">{money(r.fee)}</td>
                <td className="px-3 py-2 text-right font-mono">{money(r.xeroNet)}</td>
                <td className="px-3 py-2 text-right font-mono text-muted-foreground/70">{money(r.xeroGross)}</td>
                <td className={`px-3 py-2 text-right font-mono font-semibold ${r.diff < 0 ? "text-red-600" : "text-amber-600"}`}>
                  {r.diff >= 0 ? "+" : "-"}{money(Math.abs(r.diff))}
                </td>
                <td className="px-3 py-2 text-muted-foreground">{r.invoiceNumbers || "—"}</td>
                <td className="px-3 py-2">
                  <button
                    onClick={() => matchToXero(r)}
                    disabled={savingId === r.dealId}
                    className="text-xs px-2 py-1 rounded border border-border hover:bg-muted disabled:opacity-50 whitespace-nowrap"
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

  if (agents.length === 0) {
    return (
      <div className="bg-card border border-border rounded-lg p-8 text-center text-sm text-muted-foreground" data-testid="agent-summary-empty">
        No fees are attributed to agents yet — assign a BGP contact (or add a fee split) on a deal to see the breakdown here.
      </div>
    );
  }

  return (
    <div className="space-y-6 overflow-y-auto flex-1 min-h-0">
      {/* Agent Bar Chart */}
      <div className="bg-card border border-border rounded-lg overflow-hidden" data-testid="agent-summary-chart">
        <div className="bg-muted/50 border-b px-4 py-3">
          <span className="text-sm font-semibold text-muted-foreground">Agent Fee Breakdown</span>
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
                  isSelected ? "bg-green-50 ring-1 ring-green-300" : "hover:bg-muted"
                }`}
                onClick={() => setSelectedAgent(isSelected ? null : a.agent)}
                data-testid={`agent-bar-${a.agent}`}
              >
                <span className="text-xs text-muted-foreground w-36 text-right flex-shrink-0 truncate font-medium">
                  {a.agent}
                </span>
                <div className="flex-1 h-6 bg-muted rounded overflow-hidden relative flex">
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
                <span className="text-xs font-mono text-muted-foreground w-20 text-right flex-shrink-0">
                  {formatCurrency(total)}
                </span>
              </div>
            );
          })}
          {agents.length > 0 && (
            <div className="flex items-center gap-3 pt-2 border-t mt-2">
              <span className="text-xs w-36 text-right flex-shrink-0" />
              <div className="flex gap-4 text-xs text-muted-foreground">
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
      <div className="bg-card border border-border rounded-lg overflow-hidden" data-testid="agent-summary-table">
        <div className="bg-muted/50 border-b px-4 py-3 flex items-center justify-between">
          <span className="text-sm font-semibold text-muted-foreground">Agent Summary</span>
          <span className="text-xs text-muted-foreground">{agents.length} agents</span>
        </div>
        {/* Phone: one card per agent (§7) — tap selects the agent, same as the table rows. */}
        <div className="md:hidden divide-y divide-border">
          {agents.map((a) => {
            const total = a.wip + a.invoiced;
            const pct = grandTotal > 0 ? ((total / grandTotal) * 100).toFixed(1) : "0.0";
            const isSelected = selectedAgent === a.agent;
            return (
              <div
                key={a.agent}
                className={`px-4 py-3 cursor-pointer ${isSelected ? "bg-green-50" : ""}`}
                onClick={() => setSelectedAgent(isSelected ? null : a.agent)}
                data-testid={`agent-card-${a.agent}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-sm font-medium min-w-0 truncate">{a.agent}</span>
                  <span className="text-sm font-mono tabular-nums font-semibold shrink-0">{formatFullCurrency(total)}</span>
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-[11px] text-muted-foreground">
                  <span className="whitespace-nowrap">WIP <span className="font-mono tabular-nums text-foreground">{formatFullCurrency(a.wip)}</span></span>
                  <span className="whitespace-nowrap">Invoiced <span className="font-mono tabular-nums text-green-700">{formatFullCurrency(a.invoiced)}</span></span>
                  <span className="whitespace-nowrap"><span className="font-mono tabular-nums">{pct}%</span> of total</span>
                </div>
              </div>
            );
          })}
          {agents.length > 0 && (
            <div className="px-4 py-3 flex items-center justify-between text-sm font-semibold bg-muted/50">
              <span>Total</span>
              <span className="font-mono tabular-nums">{formatFullCurrency(grandTotal)}</span>
            </div>
          )}
        </div>
        <div className="hidden md:block">
        <ScrollableTable minWidth={700}>
          <table className="w-full">
            <thead className="bg-muted/50 border-b sticky top-0 z-10 text-sm">
              <tr>
                <SortableTableHead sortKey="agent" sort={summarySort} raw className="px-4 py-2 text-left font-medium text-muted-foreground">Agent Name</SortableTableHead>
                <SortableTableHead sortKey="wip" sort={summarySort} raw align="right" className="px-4 py-2 font-medium text-muted-foreground">WIP Amount</SortableTableHead>
                <SortableTableHead sortKey="invoiced" sort={summarySort} raw align="right" className="px-4 py-2 font-medium text-muted-foreground">Invoiced Amount</SortableTableHead>
                <SortableTableHead sortKey="total" sort={summarySort} raw align="right" className="px-4 py-2 font-medium text-muted-foreground">Total</SortableTableHead>
                <th className="px-4 py-2 text-right font-medium text-muted-foreground">% of Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border text-xs">
              {agents.map((a) => {
                const total = a.wip + a.invoiced;
                const pct = grandTotal > 0 ? ((total / grandTotal) * 100).toFixed(1) : "0.0";
                const isSelected = selectedAgent === a.agent;
                return (
                  <tr
                    key={a.agent}
                    className={`cursor-pointer transition-colors ${
                      isSelected ? "bg-green-50" : "hover:bg-muted"
                    }`}
                    onClick={() => setSelectedAgent(isSelected ? null : a.agent)}
                    data-testid={`agent-row-${a.agent}`}
                  >
                    <td className="px-4 py-2 text-foreground font-medium">{a.agent}</td>
                    <td className="px-4 py-2 text-right font-mono text-muted-foreground">{formatFullCurrency(a.wip)}</td>
                    <td className="px-4 py-2 text-right font-mono text-green-700">{formatFullCurrency(a.invoiced)}</td>
                    <td className="px-4 py-2 text-right font-mono text-foreground font-semibold">{formatFullCurrency(total)}</td>
                    <td className="px-4 py-2 text-right text-muted-foreground">{pct}%</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="bg-muted border-t font-semibold text-sm">
              <tr>
                <td className="px-4 py-2 text-foreground">Total</td>
                <td className="px-4 py-2 text-right font-mono text-foreground">
                  {formatFullCurrency(agents.reduce((s, a) => s + a.wip, 0))}
                </td>
                <td className="px-4 py-2 text-right font-mono text-green-700">
                  {formatFullCurrency(agents.reduce((s, a) => s + a.invoiced, 0))}
                </td>
                <td className="px-4 py-2 text-right font-mono text-foreground">
                  {formatFullCurrency(grandTotal)}
                </td>
                <td className="px-4 py-2 text-right text-muted-foreground">100%</td>
              </tr>
            </tfoot>
          </table>
        </ScrollableTable>
        </div>
      </div>

      {/* Agent Drilldown */}
      {selectedAgent && (
        <div className="bg-card border border-border rounded-lg overflow-hidden" data-testid="agent-drilldown">
          <div className="bg-muted/50 border-b px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-muted-foreground">
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
              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
            >
              <X className="w-3 h-3" /> Close
            </button>
          </div>
          {drilldownLoading ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">Loading deals...</div>
          ) : !drilldownData || drilldownData.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">No deals found for this agent</div>
          ) : (
            <>
            {/* Phone: one card per deal (§7) — the table never ships below md. */}
            <div className="md:hidden divide-y divide-border">
              {drilldownData.map((d) => (
                <div key={d.dealId} className="px-4 py-3" data-testid={`agent-drilldown-card-${d.dealId}`}>
                  <div className="flex items-start justify-between gap-2">
                    <Link href={`/deals/${d.dealId}`}>
                      <span className="text-sm font-medium text-primary cursor-pointer">{d.name}</span>
                    </Link>
                    <span className="text-sm font-mono tabular-nums font-semibold shrink-0">{formatFullCurrency(d.totalFee)}</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                    {d.property || "—"}{d.dealType ? ` · ${d.dealType}` : ""}
                  </p>
                  <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                    {d.stage === "invoiced" ? (
                      <Badge className="text-[10px] bg-green-100 text-green-800 whitespace-nowrap">Invoiced</Badge>
                    ) : d.stage === "wip" ? (
                      <Badge className="text-[10px] bg-yellow-100 text-yellow-800 whitespace-nowrap">WIP</Badge>
                    ) : d.stage ? (
                      <span className="text-[10px] text-muted-foreground whitespace-nowrap">{d.stage}</span>
                    ) : null}
                    <span className="text-[11px] text-muted-foreground ml-auto whitespace-nowrap">
                      Allocated <span className="font-mono tabular-nums text-foreground">{formatFullCurrency(d.allocatedAmount)}</span>
                    </span>
                  </div>
                </div>
              ))}
              <div className="px-4 py-3 flex items-center justify-between text-sm font-semibold bg-muted/50">
                <span>Total</span>
                <span className="font-mono tabular-nums">{formatFullCurrency(drilldownData.reduce((s, d) => s + d.allocatedAmount, 0))}</span>
              </div>
            </div>
            <div className="hidden md:block">
            <ScrollableTable minWidth={900}>
              <table className="w-full">
                <thead className="bg-muted/50 border-b sticky top-0 z-10 text-sm">
                  <tr>
                    <SortableTableHead sortKey="name" sort={drillSort} raw className="px-3 py-2 text-left font-medium text-muted-foreground">Deal Name</SortableTableHead>
                    <SortableTableHead sortKey="property" sort={drillSort} raw className="px-3 py-2 text-left font-medium text-muted-foreground">Property</SortableTableHead>
                    <SortableTableHead sortKey="dealType" sort={drillSort} raw className="px-3 py-2 text-left font-medium text-muted-foreground">Type</SortableTableHead>
                    <SortableTableHead sortKey="totalFee" sort={drillSort} raw align="right" className="px-3 py-2 font-medium text-muted-foreground">Total Fee</SortableTableHead>
                    <SortableTableHead sortKey="allocated" sort={drillSort} raw align="right" className="px-3 py-2 font-medium text-muted-foreground">Allocated</SortableTableHead>
                    <SortableTableHead sortKey="status" sort={drillSort} raw align="center" className="px-3 py-2 font-medium text-muted-foreground">Status</SortableTableHead>
                    <SortableTableHead sortKey="stage" sort={drillSort} raw align="center" className="px-3 py-2 font-medium text-muted-foreground">Stage</SortableTableHead>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border text-xs">
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
                    <tr key={d.dealId} className="hover:bg-muted">
                      <td className="px-3 py-2 text-muted-foreground">
                        <Link href={`/deals/${d.dealId}`}>
                          <span className="text-primary hover:underline cursor-pointer">{d.name}</span>
                        </Link>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground truncate max-w-[160px]">{d.property || "---"}</td>
                      <td className="px-3 py-2">
                        {d.dealType ? (
                          <Badge variant="outline" className={`border-transparent text-[10px] ${DEAL_TYPE_BADGE_COLORS[d.dealType] || "bg-gray-100 text-gray-800"}`}>
                            {d.dealType}
                          </Badge>
                        ) : "---"}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-muted-foreground">
                        {formatFullCurrency(d.totalFee)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-foreground font-semibold">
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
                          <span className="text-muted-foreground">{d.stage}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-muted border-t font-semibold text-xs">
                  <tr>
                    <td colSpan={3} className="px-3 py-2 text-foreground">Total</td>
                    <td className="px-3 py-2 text-right font-mono text-muted-foreground">
                      {formatFullCurrency(drilldownData.reduce((s, d) => s + d.totalFee, 0))}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-foreground">
                      {formatFullCurrency(drilldownData.reduce((s, d) => s + d.allocatedAmount, 0))}
                    </td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              </table>
            </ScrollableTable>
            </div>
            </>
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
  const [activeTab, setActiveTab] = useState<"report" | "agent-summary" | "fee-check" | "health">(savedFilters?.activeTab || "report");

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
  // Free-text quick search across the row's names — much faster than the
  // dropdowns for "find the Bluewater deal" on desktop, and the primary way
  // to navigate on the phone.
  const [searchText, setSearchText] = useState("");

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
    // v2 (2026-09-01): Billing Entity + Fee Split are blank on most rows and
    // squeezed Client/Tenant/Property into truncation (Woody: "WIP report is
    // fucked") — hide them once for everyone, carrying over any earlier
    // hides; the Columns menu brings them back per browser.
    try {
      const v2 = localStorage.getItem("bgp_wip_hidden_cols_v2");
      if (v2 !== null) return new Set<string>(JSON.parse(v2));
      const v1: string[] = JSON.parse(localStorage.getItem("bgp_wip_hidden_cols") || "[]");
      return new Set<string>([...v1, "billingEntity", "amtInvoice"]);
    } catch { return new Set(["billingEntity", "amtInvoice"]); }
  });
  const [colMenuOpen, setColMenuOpen] = useState(false);
  const [expandedBoards, setExpandedBoards] = useState<Set<string>>(new Set());
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
    try { localStorage.setItem("bgp_wip_hidden_cols_v2", JSON.stringify([...n])); } catch {}
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
  // One predicate for the list AND the phone boards. `skip` leaves out one
  // dimension's own filter so a board can stay complete while every other
  // filter still applies to it — Power BI-style cross-filtering (the old
  // Equity_WIP report every board tapped through, Woody 2026-08-31).
  const entryMatches = useCallback((e: WipDealEntry, skip?: "client" | "team" | "month" | "agent" | "project" | "status") => {
    const q = searchText.trim().toLowerCase();
    if (q) {
      const hay = [e.ref, e.client, e.tenant, e.project, e.billingEntity, e.agent, e.team, e.dealRef ? `#${e.dealRef}` : "", e.dealRef ? String(e.dealRef) : ""]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (skip !== "client" && selectedClients.size > 0) {
      const ok = e.client ? selectedClients.has(e.client) : selectedClients.has("Unassigned");
      if (!ok) return false;
    }
    if (skip !== "team" && selectedTeams.size > 0) {
      const entryTeams = e.team ? (e.team as string).split(",").map(t => t.trim()).filter(Boolean) : [];
      const ok = entryTeams.length > 0 ? entryTeams.some(t => selectedTeams.has(t)) : selectedTeams.has("Unassigned");
      if (!ok) return false;
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
    if (skip !== "month" && selectedMonths.size > 0) {
      if (e.month && !selectedMonths.has(e.month)) return false;
    }
    if (skip !== "agent" && selectedAgents.size > 0) {
      const agentParts = e.agent ? (e.agent as string).split(",").map(a => normalizeAgent(a.trim()).toUpperCase()).filter(Boolean) : [];
      const ok = agentParts.length > 0 ? agentParts.some(a => selectedAgents.has(a)) : selectedAgents.has("Unassigned");
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
  }, [searchText, selectedClients, selectedTeams, selectedMonths, selectedAgents, selectedProjects, selectedStatuses, selectedFiscalYears]);

  const filteredEntries = useMemo(() => entries.filter((e) => entryMatches(e)), [entries, entryMatches]);

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

  // At-a-glance boards (phone AND desktop) — Power BI-style: each board is
  // computed with every filter EXCEPT its own dimension applied, so picking
  // a month keeps the other months visible (highlighted, not vanished) and
  // the Client / Property / Team / Contact boards cross-filter each other.
  const monthlyFees = useMemo(() => {
    const byMonth = new Map<string, { wip: number; invoiced: number; deals: Set<string> }>();
    for (const e of entries) {
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
      .sort((a, b) => (a.month === "TBC" ? 1 : b.month === "TBC" ? -1 : getMonthSortKey(a.month) - getMonthSortKey(b.month)));
  }, [entries, entryMatches]);

  const stageMix = useMemo(() => {
    const byStage = new Map<string, { total: number; deals: Set<string> }>();
    for (const e of entries) {
      if (!e.dealStatus || !entryMatches(e, "status")) continue;
      const cur = byStage.get(e.dealStatus) || { total: 0, deals: new Set<string>() };
      cur.total += (e.amtWip || 0) + (e.amtInvoice || 0);
      cur.deals.add(e.dealId || e.id);
      byStage.set(e.dealStatus, cur);
    }
    return [...byStage.entries()].map(([status, v]) => ({ status, total: v.total, count: v.deals.size })).sort((a, b) => b.total - a.total);
  }, [entries, entryMatches]);

  const feeBoards = useMemo(() => {
    const build = (skip: "client" | "project" | "team" | "agent", keyOf: (e: WipDealEntry) => string[]) => {
      const agg = new Map<string, number>();
      for (const e of entries) {
        if (!entryMatches(e, skip)) continue;
        const fee = (e.amtWip || 0) + (e.amtInvoice || 0);
        const keys = keyOf(e);
        // Teams get the full fee each (matching the Team filter card);
        // agents split evenly (matching filterFees).
        const share = skip === "agent" && keys.length > 0 ? fee / keys.length : fee;
        for (const k of keys) agg.set(k, (agg.get(k) || 0) + share);
      }
      return [...agg.entries()].map(([name, total]) => ({ name, total })).sort((a, b) => b.total - a.total);
    };
    // UX #141 — fees with no attribution used to simply vanish from the
    // breakdown, so the board contradicted the header total. "Unassigned"
    // keeps the sum honest and is filterable like any row.
    const orUnassigned = (keys: string[]) => (keys.length > 0 ? keys : ["Unassigned"]);
    return {
      client: build("client", (e) => orUnassigned(e.client ? [e.client] : [])),
      project: build("project", (e) => orUnassigned(e.project ? [e.project] : [])),
      team: build("team", (e) => orUnassigned(e.team ? (e.team as string).split(",").map(t => t.trim()).filter(Boolean) : [])),
      agent: build("agent", (e) => orUnassigned(e.agent ? (e.agent as string).split(",").map(a => normalizeAgent(a.trim()).toUpperCase()).filter(Boolean) : [])),
    };
  }, [entries, entryMatches]);

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

  // Inline target-month saves, debounced. A month input fires `change` for
  // EVERY keystroke while a year is being typed — "2027" passes through
  // 0002 / 0020 / 0202 — and the old save-on-change wrote each one to the
  // deal, refetched, remounted the input mid-edit and flung the deal into
  // fiscal year 0002 (the "Jan-00" bars; Woody 2026-09-02: "it doesn't
  // allow it and jumps... or doesn't allow enough time"). Now: implausible
  // years never save, edits settle for 1.2s before saving, and blur (or a
  // finished popup pick) flushes immediately.
  const pendingTargetSaves = useRef<Map<string, { val: string; timer: ReturnType<typeof setTimeout> }>>(new Map());
  const flushTargetSave = async (dealId: string) => {
    const pending = pendingTargetSaves.current.get(dealId);
    if (!pending) return;
    pendingTargetSaves.current.delete(dealId);
    clearTimeout(pending.timer);
    try {
      await apiRequest("PUT", `/api/crm/deals/${dealId}`, { targetDate: `${pending.val}-01` });
      toast({ title: "Target month updated", description: "Applied to everyone on this deal." });
      invalidateDealCaches();
    } catch (err: any) {
      toast({ title: "Couldn't save target month", description: err?.message || "Please try again.", variant: "destructive" });
    }
  };
  const scheduleTargetSave = (dealId: string, val: string) => {
    const yr = parseInt(val.slice(0, 4), 10);
    if (!yr || yr < 2000 || yr > 2100) return; // mid-typing year — not a real edit
    const prev = pendingTargetSaves.current.get(dealId);
    if (prev) clearTimeout(prev.timer);
    pendingTargetSaves.current.set(dealId, { val, timer: setTimeout(() => flushTargetSave(dealId), 1200) });
  };

  // Inline deal-status transitions from the Deal Detail table — same PUT the
  // Deals page uses, so the senior-approval (INV/COM) and AML (SOL+) gates
  // still apply server-side; a rejected transition surfaces as a toast.
  const handleStatusChange = async (dealId: string, code: string) => {
    try {
      await apiRequest("PUT", `/api/crm/deals/${dealId}`, { status: code });
      toast({ title: "Deal status updated" });
      invalidateDealCaches();
    } catch (err: any) {
      toast({ title: "Couldn't update status", description: err?.message || "Please try again.", variant: "destructive" });
    }
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
    <div className="min-h-[calc(100vh-64px)] flex flex-col p-4 sm:p-6 print:p-2" data-testid="wip-report-page">
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
                  <span className="text-base font-normal text-muted-foreground ml-2 whitespace-nowrap">— {teamLabel}</span>
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
          <Link href="/deals/list?new=1">
            <Button size="sm" data-testid="wip-new-deal-button">
              <Plus className="h-4 w-4 mr-1" />
              New Deal
            </Button>
          </Link>
        </div>
      </div>

      {/* Tab switcher — app pill standard (ui/pill.tsx) */}
      <div className="flex items-center gap-1.5 mb-4 flex-shrink-0 no-print flex-wrap" data-testid="wip-tabs">
        <Pill active={activeTab === "report"} onClick={() => setActiveTab("report")} data-testid="wip-tab-report">WIP Report</Pill>
        <Pill active={activeTab === "agent-summary"} onClick={() => setActiveTab("agent-summary")} data-testid="wip-tab-agent-summary">Agent Summary</Pill>
        {canSeeAll && (
          <Pill active={activeTab === "fee-check"} onClick={() => setActiveTab("fee-check")} data-testid="wip-tab-fee-check">Fee Check</Pill>
        )}
        {canSeeAll && (
          <Pill active={activeTab === "health"} onClick={() => setActiveTab("health")} data-testid="wip-tab-health">Needs Attention</Pill>
        )}
      </div>

      {activeTab === "agent-summary" ? (
        <AgentSummaryTab />
      ) : activeTab === "fee-check" ? (
        <FeeCheckTab />
      ) : activeTab === "health" ? (
        <HealthTab />
      ) : (
      <div className="flex flex-col gap-4">
          {/* Filter dropdowns — one per former summary board */}
          <div className="flex flex-wrap items-center gap-2 flex-shrink-0 no-print" data-testid="wip-filters-bar">
            <div className="relative w-full sm:w-56">
              <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/70 pointer-events-none" />
              <input
                type="search"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder="Search deal, client, property…"
                className="w-full h-8 pl-8 pr-2 text-sm border border-border rounded-md bg-background focus:outline-none focus:border-ring"
                data-testid="wip-search-input"
              />
            </div>
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
                // Expand short codes (INV → Invoiced) but keep meaningful
                // legacy labels like "HOTs" as-is — mapping them to their
                // canonical stage name hid the HOTs distinction.
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
                onClick={resetAllFilters}
                className="text-xs text-primary hover:underline flex items-center gap-0.5 ml-1"
                data-testid="wip-clear-all-filters"
              >
                <X className="h-3 w-3" /> Reset filters
              </button>
            )}
          </div>

          {/* Phone at-a-glance — the desktop report leans on the wide table;
              on a phone the story comes first: totals, fees by month, stage
              mix, each tappable to filter the deal list below (Woody,
              2026-08-31: "stopped being charts and now just lists"). */}
          <div className="md:hidden space-y-3 no-print" data-testid="wip-phone-summary">
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-card border border-border rounded-lg p-3" data-testid="wip-phone-tile-wip">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">WIP</p>
                <p className="text-lg font-mono font-semibold text-foreground">{formatFullCurrency(totalWip)}</p>
                <p className="text-[10px] text-muted-foreground">{sortedDetailEntries.length} deal{sortedDetailEntries.length !== 1 ? "s" : ""}</p>
              </div>
              <div className="bg-card border border-border rounded-lg p-3" data-testid="wip-phone-tile-invoiced">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Invoiced</p>
                <p className="text-lg font-mono font-semibold text-green-700">{formatFullCurrency(totalInvoiced)}</p>
                <p className="text-[10px] text-muted-foreground">of {formatFullCurrency(totalNetFees)} total</p>
              </div>
            </div>
            {monthlyFees.length > 0 && (
              <div className="bg-card border border-border rounded-lg overflow-hidden">
                <div className="bg-muted/50 border-b px-3 py-2 flex items-center justify-between">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Net fees by month</span>
                  <span className="text-[10px] text-muted-foreground">tap to filter</span>
                </div>
                <div className="p-3 space-y-1">
                  {(() => {
                    const shown = monthlyFees.slice(0, 14);
                    const maxM = Math.max(...shown.map(m => m.total), 1);
                    return shown.map(m => {
                      const tappable = m.month !== "TBC";
                      const active = selectedMonths.has(m.month);
                      const bar = (
                        <>
                          <span className="text-[11px] text-muted-foreground w-12 text-left shrink-0 font-medium">{m.month}</span>
                          <div className="flex-1 h-4 bg-muted rounded overflow-hidden flex">
                            {m.wip > 0 && <div className="h-full" style={{ width: `${(m.wip / maxM) * 100}%`, backgroundColor: active ? "#16a34a" : "#86efac" }} />}
                            {m.invoiced > 0 && <div className="h-full" style={{ width: `${(m.invoiced / maxM) * 100}%`, backgroundColor: active ? "#15803d" : "#22c55e" }} />}
                          </div>
                          <span className="text-[11px] font-mono text-muted-foreground w-14 text-right shrink-0">{formatCurrency(m.total)}</span>
                        </>
                      );
                      if (!tappable) {
                        return <div key={m.month} className="w-full flex items-center gap-2 px-1 py-1">{bar}</div>;
                      }
                      return (
                        <button
                          key={m.month}
                          className={`w-full flex items-center gap-2 rounded px-1 py-1 transition-colors ${active ? "bg-green-50 ring-1 ring-green-300" : "active:bg-muted"}`}
                          onClick={() => setSelectedMonths(prev => {
                            const next = new Set(prev);
                            if (next.has(m.month)) next.delete(m.month); else next.add(m.month);
                            return next;
                          })}
                          data-testid={`wip-phone-month-${m.month}`}
                        >
                          {bar}
                        </button>
                      );
                    });
                  })()}
                  <div className="flex items-center gap-3 pt-1.5 border-t mt-1 text-[10px] text-muted-foreground">
                    <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded" style={{ backgroundColor: "#86efac" }} />WIP</span>
                    <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded" style={{ backgroundColor: "#22c55e" }} />Invoiced</span>
                  </div>
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
                      onClick={() => setSelectedStatuses(prev => {
                        const next = new Set(prev);
                        if (next.has(s.status)) next.delete(s.status); else next.add(s.status);
                        return next;
                      })}
                      className="shrink-0"
                      data-testid={`wip-phone-stage-${s.status}`}
                    >
                      {label} · {formatCurrency(s.total)} · {s.count}
                    </Pill>
                  );
                })}
              </div>
            )}
            {([
              { key: "client", title: "Client", rows: feeBoards.client, selected: selectedClients, setter: setSelectedClients },
              { key: "project", title: "Property", rows: feeBoards.project, selected: selectedProjects, setter: setSelectedProjects },
              { key: "team", title: "Team", rows: feeBoards.team, selected: selectedTeams, setter: setSelectedTeams },
              { key: "agent", title: "BGP Contact", rows: feeBoards.agent, selected: selectedAgents, setter: setSelectedAgents },
            ] as const).map(board => {
              if (board.rows.length === 0) return null;
              const expanded = expandedBoards.has(board.key);
              const shown = expanded ? board.rows.slice(0, 40) : board.rows.slice(0, 6);
              const maxB = Math.max(...board.rows.map(r => r.total), 1);
              const boardTotal = board.rows.reduce((s, r) => s + r.total, 0);
              return (
                <div key={board.key} className="bg-card border border-border rounded-lg overflow-hidden" data-testid={`wip-phone-board-${board.key}`}>
                  <div className="bg-muted/50 border-b px-3 py-2 flex items-center justify-between">
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Net fees by {board.title}</span>
                    <span className="text-[11px] font-mono text-muted-foreground">{formatCurrency(boardTotal)}</span>
                  </div>
                  <div className="p-2">
                    {shown.map(r => {
                      const active = board.selected.has(r.name);
                      return (
                        <button
                          key={r.name}
                          className={`w-full rounded px-1.5 py-1 text-left transition-colors ${active ? "bg-green-50 ring-1 ring-green-300" : "active:bg-muted"}`}
                          onClick={() => toggleFilter(board.selected, board.setter, r.name)}
                          data-testid={`wip-phone-${board.key}-row`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className={`text-xs truncate min-w-0 ${active ? "font-semibold text-foreground" : "text-foreground"}`}>{r.name}</span>
                            <span className="text-xs font-mono text-muted-foreground shrink-0">{formatFullCurrency(r.total)}</span>
                          </div>
                          <div className="h-1 bg-muted rounded overflow-hidden mt-0.5">
                            <div className="h-full" style={{ width: `${Math.max(1, (r.total / maxB) * 100)}%`, backgroundColor: active ? "#16a34a" : "#86efac" }} />
                          </div>
                        </button>
                      );
                    })}
                    {board.rows.length > 6 && (
                      <button
                        className="w-full text-center text-[11px] text-primary py-1.5"
                        onClick={() => setExpandedBoards(prev => {
                          const next = new Set(prev);
                          if (next.has(board.key)) next.delete(board.key); else next.add(board.key);
                          return next;
                        })}
                        data-testid={`wip-phone-board-${board.key}-more`}
                      >
                        {expanded ? "Show top 6" : `All ${Math.min(board.rows.length, 40)}${board.rows.length > 40 ? ` of ${board.rows.length}` : ""} →`}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Desktop at-a-glance — the Equity_WIP Power BI layout: fees-by-
              month columns, stage mix, and ranked Client / Property / Team /
              Contact boards, every element clickable and cross-filtering
              (Woody, 2026-09-01: "the WIP report is meant to be based on
              the Power BI"). Shares selection state with the dropdowns. */}
          <div className="hidden md:block space-y-3 no-print mb-4" data-testid="wip-desktop-boards">
            {monthlyFees.length > 0 && (
              <div className="bg-card border border-border rounded-lg overflow-hidden">
                <div className="bg-muted/50 border-b px-3 py-2 flex items-center justify-between">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Net fees by month</span>
                  <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                    <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded" style={{ backgroundColor: "#86efac" }} />WIP</span>
                    <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded" style={{ backgroundColor: "#22c55e" }} />Invoiced</span>
                    <span>click to filter</span>
                  </div>
                </div>
                <div className="flex items-end gap-1 px-3 pt-2 pb-2">
                  {(() => {
                    const maxM = Math.max(...monthlyFees.map(m => m.total), 1);
                    const colH = 104;
                    return monthlyFees.map(m => {
                      const tappable = m.month !== "TBC";
                      const active = selectedMonths.has(m.month);
                      return (
                        <button
                          key={m.month}
                          disabled={!tappable}
                          className={`flex-1 min-w-0 flex flex-col items-center justify-end gap-1 rounded px-0.5 pt-1 pb-0.5 transition-colors ${active ? "bg-green-50 ring-1 ring-green-300" : tappable ? "hover:bg-muted" : ""}`}
                          onClick={() => tappable && setSelectedMonths(prev => {
                            const next = new Set(prev);
                            if (next.has(m.month)) next.delete(m.month); else next.add(m.month);
                            return next;
                          })}
                          title={`${m.month} · ${formatFullCurrency(m.total)} · ${m.count} deal${m.count !== 1 ? "s" : ""}`}
                          data-testid={`wip-desk-month-${m.month}`}
                        >
                          <span className="text-[10px] font-mono text-muted-foreground">{formatCurrency(m.total)}</span>
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
                      onClick={() => setSelectedStatuses(prev => {
                        const next = new Set(prev);
                        if (next.has(s.status)) next.delete(s.status); else next.add(s.status);
                        return next;
                      })}
                      className="shrink-0"
                      data-testid={`wip-desk-stage-${s.status}`}
                    >
                      {label} · {formatCurrency(s.total)} · {s.count}
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
                const expanded = expandedBoards.has(`desk-${board.key}`);
                const shown = expanded ? board.rows.slice(0, 60) : board.rows.slice(0, 8);
                const maxB = Math.max(...board.rows.map(r => r.total), 1);
                const boardTotal = board.rows.reduce((s, r) => s + r.total, 0);
                return (
                  <div key={board.key} className="bg-card border border-border rounded-lg overflow-hidden flex flex-col" data-testid={`wip-desk-board-${board.key}`}>
                    <div className="bg-muted/50 border-b px-3 py-2 flex items-center justify-between">
                      <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Net fees by {board.title}</span>
                      <span className="text-[11px] font-mono text-muted-foreground">{formatCurrency(boardTotal)}</span>
                    </div>
                    <div className={`p-2 ${expanded ? "max-h-72 overflow-y-auto" : ""}`}>
                      {shown.map(r => {
                        const active = board.selected.has(r.name);
                        return (
                          <button
                            key={r.name}
                            className={`w-full rounded px-1.5 py-1 text-left transition-colors ${active ? "bg-green-50 ring-1 ring-green-300" : "hover:bg-muted"}`}
                            onClick={() => toggleFilter(board.selected, board.setter, r.name)}
                            data-testid={`wip-desk-${board.key}-row`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className={`text-xs truncate min-w-0 ${active ? "font-semibold text-foreground" : "text-foreground"}`}>{r.name}</span>
                              <span className="text-xs font-mono text-muted-foreground shrink-0">{formatFullCurrency(r.total)}</span>
                            </div>
                            <div className="h-1 bg-muted rounded overflow-hidden mt-0.5">
                              <div className="h-full" style={{ width: `${Math.max(1, (r.total / maxB) * 100)}%`, backgroundColor: active ? "#16a34a" : "#86efac" }} />
                            </div>
                          </button>
                        );
                      })}
                    </div>
                    {board.rows.length > 8 && (
                      <button
                        className="w-full text-center text-[11px] text-primary py-1.5 border-t border-border"
                        onClick={() => setExpandedBoards(prev => {
                          const next = new Set(prev);
                          if (next.has(`desk-${board.key}`)) next.delete(`desk-${board.key}`); else next.add(`desk-${board.key}`);
                          return next;
                        })}
                        data-testid={`wip-desk-board-${board.key}-more`}
                      >
                        {expanded ? "Show top 8" : `All ${Math.min(board.rows.length, 60)}${board.rows.length > 60 ? ` of ${board.rows.length}` : ""} →`}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="print-break" data-testid="wip-detail-table">
            <div className="border-b border-border pb-2 flex items-center justify-between">
              <div>
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Deal Detail
                </span>
                <span className="text-xs text-muted-foreground ml-2">({sortedDetailEntries.length} rows)</span>
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
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground border border-border rounded px-2 py-1 bg-background"
                    data-testid="wip-columns-button"
                  >
                    Columns{hiddenWipCols.size > 0 ? ` (${WIP_DETAIL_COLS.length - hiddenWipCols.size}/${WIP_DETAIL_COLS.length})` : ""}
                  </button>
                  {colMenuOpen && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setColMenuOpen(false)} />
                      <div className="absolute right-0 top-full mt-1 z-50 bg-popover border border-border rounded-lg shadow-xl p-2 w-48 max-h-[320px] overflow-y-auto">
                        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide px-1 pb-1">Show columns</p>
                        {WIP_DETAIL_COLS.map((c) => (
                          <label key={c.key} className="flex items-center gap-2 px-1 py-1 rounded hover:bg-muted cursor-pointer text-xs text-muted-foreground">
                            <Checkbox checked={showCol(c.key)} onCheckedChange={() => toggleWipCol(c.key)} className="h-4 w-4" data-no-min-touch />
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
              <div className="flex items-center gap-3 px-2 py-2 bg-primary/5 border-b">
                <span className="text-xs font-medium">{selectedIds.size} selected</span>
                <span className="text-xs text-muted-foreground">
                  {formatFullCurrency(sortedDetailEntries.filter(e => e.id && selectedIds.has(e.id)).reduce((s, e) => s + (e.amtWip || 0) + (e.amtInvoice || 0), 0))} total
                </span>
                <Button variant="outline" size="sm" className="h-6 text-[10px]" onClick={() => setSelectedIds(new Set())}>
                  Clear Selection
                </Button>
              </div>
            )}
            {/* Phone layout: the 1400px table was unusable at 390px (pinch +
                two-axis scrolling). One card per deal instead — name links to
                the deal, client/property link through, fee + stage up front.
                Desktop keeps the full table below. */}
            <div className="md:hidden divide-y divide-border" data-testid="wip-mobile-cards">
              {sortedDetailEntries.length === 0 && (
                <p className="py-8 text-center text-sm text-muted-foreground">No deals match the current filters.</p>
              )}
              {sortedDetailEntries.map((e, i) => (
                <div key={e.id || i} className="py-3 px-1" data-testid={`wip-card-${i}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      {e.dealId ? (
                        <Link href={`/deals/${e.dealId}`}>
                          <span className="text-sm font-medium text-primary cursor-pointer">{e.ref || "—"}</span>
                        </Link>
                      ) : (
                        <span className="text-sm font-medium">{e.ref || "—"}</span>
                      )}
                      {e.dealRef && <span className="ml-1.5 text-[11px] font-mono text-muted-foreground/70">#{e.dealRef}</span>}
                    </div>
                    <div className="text-right shrink-0">
                      {e.stage === "invoiced" ? (
                        <span className="text-sm font-mono font-semibold text-green-700">{e.amtInvoice ? formatFullCurrency(e.amtInvoice) : "—"}</span>
                      ) : (
                        <span className="text-sm font-mono font-semibold text-foreground">{e.amtWip ? formatFullCurrency(e.amtWip) : "—"}</span>
                      )}
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">
                    {e.client && e.clientId ? (
                      <Link href={`/companies/${e.clientId}`}><span className="cursor-pointer">{e.client}</span></Link>
                    ) : (e.client || null)}
                    {e.client && e.project ? " · " : null}
                    {e.project && e.propertyId ? (
                      <Link href={`/properties/${e.propertyId}`}><span className="cursor-pointer">{e.project}</span></Link>
                    ) : (e.project || null)}
                    {!e.client && !e.project ? "—" : null}
                  </p>
                  <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                    {e.stage === "pipeline" && <span className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-800">Pipeline</span>}
                    {e.stage === "wip" && <span className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-100 text-blue-800">WIP</span>}
                    {e.stage === "invoiced" && <span className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-100 text-green-800">Invoiced</span>}
                    {e.dealType && (
                      <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium ${DEAL_TYPE_BADGE_COLORS[e.dealType] || "bg-gray-100 text-gray-700"}`}>{e.dealType}</span>
                    )}
                    {e.stage !== "invoiced" && e.targetDate && (() => {
                      const d = new Date(e.targetDate);
                      return isNaN(d.getTime()) ? null : (
                        <span className="text-[10px] text-muted-foreground">Target {d.toLocaleDateString("en-GB", { month: "short", year: "2-digit" })}</span>
                      );
                    })()}
                    {e.agent && (
                      <span className="text-[10px] text-muted-foreground ml-auto">
                        {e.agent.split(",").map(a => a.trim()).map(a => a.includes(" ") ? a.split(" ").map(p => p[0]).join("").toUpperCase() : a).join(", ")}
                      </span>
                    )}
                  </div>
                </div>
              ))}
              {sortedDetailEntries.length > 0 && (
                <div className="py-3 px-1 flex items-center justify-between text-sm font-semibold bg-muted/50 rounded-b">
                  <span>Total</span>
                  <span className="font-mono">
                    {formatFullCurrency(sortedDetailEntries.reduce((s, e) => s + (e.amtWip || 0) + (e.amtInvoice || 0), 0))}
                  </span>
                </div>
              )}
            </div>
            <div className="hidden md:block">
            <ScrollableTable minWidth={1400} pageScroll>
              <table className="w-full">
                <thead className="bg-muted/50 border-b sticky top-0 z-10 text-sm">
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
                        className={`px-2 py-2 text-left font-medium text-muted-foreground cursor-pointer hover:text-foreground ${col.width}`}
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
                <tbody className="divide-y divide-border text-xs">
                  {sortedDetailEntries.map((e, i) => (
                    <tr key={e.id || i} className={`hover:bg-muted group ${e.id && selectedIds.has(e.id) ? "bg-primary/5" : ""}`} data-testid={`wip-row-${i}`}>
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
                      <td className="px-2 py-1.5 text-xs font-mono whitespace-nowrap">
                        {e.dealRef && e.dealId ? (
                          <Link href={`/deals/${e.dealId}`}>
                            <span className="text-blue-600 hover:underline cursor-pointer" data-testid={`link-deal-ref-${e.dealId}`}>#{e.dealRef}</span>
                          </Link>
                        ) : e.dealRef ? (
                          <span className="text-muted-foreground/70">#{e.dealRef}</span>
                        ) : (
                          <span className="text-muted-foreground/70">—</span>
                        )}
                      </td>
                      )}
                      {colVisible("ref") && (
                      <td className="px-2 py-1.5 text-muted-foreground truncate max-w-[210px]">
                        {e.dealId ? (
                          <Link href={`/deals/${e.dealId}`}>
                            <span className="text-primary hover:underline cursor-pointer" data-testid={`link-deal-${e.dealId}`}>{e.ref || "—"}</span>
                          </Link>
                        ) : (e.ref || "—")}
                      </td>
                      )}
                      {colVisible("client") && (
                      <td className="px-2 py-1.5 text-muted-foreground truncate max-w-[170px]">
                        {e.client && e.clientId ? (
                          <Link href={`/companies/${e.clientId}`}><span className="hover:underline hover:text-primary cursor-pointer">{e.client}</span></Link>
                        ) : (e.client || "—")}
                      </td>
                      )}
                      {colVisible("tenant") && (
                      <td className="px-2 py-1.5 text-muted-foreground truncate max-w-[170px]">
                        {e.tenant && e.tenantId ? (
                          <Link href={`/companies/${e.tenantId}`}><span className="hover:underline hover:text-primary cursor-pointer">{e.tenant}</span></Link>
                        ) : (e.tenant || "—")}
                      </td>
                      )}
                      {colVisible("project") && (
                      <td className="px-2 py-1.5 text-muted-foreground truncate max-w-[170px]">
                        {e.project && e.propertyId ? (
                          <Link href={`/properties/${e.propertyId}`}><span className="hover:underline hover:text-primary cursor-pointer">{e.project}</span></Link>
                        ) : (e.project || "—")}
                      </td>
                      )}
                      {colVisible("billingEntity") && <td className="px-2 py-1.5 text-muted-foreground truncate max-w-[150px]">{e.billingEntity || "—"}</td>}
                      {colVisible("team") && <td className="px-2 py-1.5 text-muted-foreground truncate max-w-[150px]">{e.team || "—"}</td>}
                      {colVisible("amtWip") && (
                      <td className="px-2 py-1.5 text-foreground font-mono">
                        {e.amtWip ? formatFullCurrency(e.amtWip) : "—"}
                      </td>
                      )}
                      {colVisible("amtInvoice") && (
                      <td className="px-2 py-1.5 text-green-700 font-mono">
                        {e.amtInvoice ? formatFullCurrency(e.amtInvoice) : "—"}
                      </td>
                      )}
                      {colVisible("dealDate") && (
                      <td className="px-2 py-1.5 text-muted-foreground whitespace-nowrap">
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
                                  // Change events schedule a debounced save (scheduleTargetSave —
                                  // implausible mid-typing years never save); blur flushes at once, so
                                  // both the popup pick and typed edits land exactly once, when done.
                                  key={`wip-target-${e.dealId}-${e.targetDate ?? ""}`}
                                  defaultValue={toDateInputValue(e.targetDate).slice(0, 7)}
                                  className="text-xs border border-border rounded px-1 py-0.5 w-[150px] focus:outline-none focus:border-ring"
                                  onChange={(ev) => {
                                    const val = ev.target.value;
                                    if (!val || !e.dealId) return;
                                    // Month picker gives yyyy-MM; the deal stores a full date, so the
                                    // save pins the target to the 1st of the chosen month.
                                    scheduleTargetSave(e.dealId, val);
                                  }}
                                  onBlur={() => e.dealId && flushTargetSave(e.dealId)}
                                />
                              ) : dateStr ? (
                                <span className="text-xs">{dateStr}</span>
                              ) : (
                                <span>—</span>
                              )}
                              {/* No badge for targets — the column header already says Target Month.
                                  Completed/Exchanged keep theirs since those are actuals, not targets. */}
                              {pick && pick.label !== "Target" && <span className={`inline-flex items-center px-1 py-0 rounded text-[9px] font-medium w-fit ${pick.cls}`}>{pick.label}</span>}
                            </div>
                          );
                        })()}
                      </td>
                      )}
                      {colVisible("dealType") && (
                      <td className="px-2 py-1.5">
                        {e.dealType ? (
                          <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${DEAL_TYPE_BADGE_COLORS[e.dealType] || "bg-gray-100 text-gray-700"}`}>{e.dealType}</span>
                        ) : <span className="text-muted-foreground/70">—</span>}
                      </td>
                      )}
                      {colVisible("agent") && <td className="px-2 py-1.5 text-muted-foreground">{e.agent ? e.agent.split(",").map(a => a.trim()).map(a => a.includes(" ") ? a.split(" ").map(p => p[0]).join("").toUpperCase() : a).join(", ") : "—"}</td>}
                      {colVisible("dealStatus") && (
                      <td className="px-2 py-1.5">
                        {e.dealId ? (
                          <InlineLabelSelect
                            value={legacyToCode(e.dealStatus) || ""}
                            options={DEAL_PAGE_STATUSES as unknown as string[]}
                            colorMap={DEAL_STATUS_DOT_COLORS as Record<string, string>}
                            labelMap={DEAL_STATUS_LABELS as Record<string, string>}
                            onSave={(v) => { if (v) handleStatusChange(e.dealId, v); }}
                            allowClear={false}
                            compact
                          />
                        ) : (
                          <span className="text-muted-foreground truncate max-w-[100px] inline-block">{e.dealStatus || "—"}</span>
                        )}
                      </td>
                      )}
                      {colVisible("stage") && (
                      <td className="px-2 py-1.5 text-xs truncate max-w-[100px]">
                        {e.stage === "pipeline" ? (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800">Pipeline</span>
                        ) : e.stage === "wip" ? (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">WIP</span>
                        ) : e.stage === "invoiced" ? (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">Invoiced</span>
                        ) : (
                          <span className="text-muted-foreground">{e.stage || "—"}</span>
                        )}
                      </td>
                      )}
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-muted border-t font-semibold">
                  <tr>
                    <td colSpan={1 + WIP_LEAD_KEYS.filter(colVisible).length} className="px-2 py-1.5 text-foreground">Total</td>
                    {colVisible("amtWip") && (
                      <td className="px-2 py-1.5 text-foreground font-mono">
                        {formatFullCurrency(sortedDetailEntries.reduce((s, e) => s + (e.amtWip || 0), 0))}
                      </td>
                    )}
                    {colVisible("amtInvoice") && (() => {
                      // Status colour only when the total says something: red is
                      // reserved for genuinely negative, £0 stays plain foreground
                      // (docs/DESIGN.md §1 — red means negative, not emphasis).
                      const invoiceTotal = sortedDetailEntries.reduce((s, e) => s + (e.amtInvoice || 0), 0);
                      return (
                        <td className={`px-2 py-1.5 font-mono ${invoiceTotal < 0 ? "text-red-600" : invoiceTotal > 0 ? "text-green-700" : "text-foreground"}`}>
                          {formatFullCurrency(invoiceTotal)}
                        </td>
                      );
                    })()}
                    {WIP_TRAIL_KEYS.filter(colVisible).length > 0 && (
                      <td colSpan={WIP_TRAIL_KEYS.filter(colVisible).length} className="px-2 py-1.5" />
                    )}
                  </tr>
                </tfoot>
              </table>
            </ScrollableTable>
            </div>
          </div>
      </div>
      )}
    </div>
  );
}
