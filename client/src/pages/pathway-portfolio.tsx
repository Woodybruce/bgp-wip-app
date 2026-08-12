import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { apiRequest, getQueryFn } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { ArrowUpDown, ExternalLink, FileText } from "lucide-react";

interface PortfolioRow {
  runId: string;
  propertyId: string | null;
  address: string;
  postcode: string | null;
  propertyName: string | null;
  startedByName: string | null;
  currentStage: number;
  completedAt: string | null;
  updatedAt: string | null;
  price: number | null;
  niy: number | null;
  irr: number | null;
  moic: number | null;
  strategy: string | null;
  holdPeriodYrs: number | null;
  exitPrice: number | null;
  exitYield: number | null;
  capex: number | null;
  planAgreed: boolean;
  modelAgreed: boolean;
  whyBuyUrl: string | null;
  disposition: string | null;
  dispositionReason: string | null;
}

const DISPOSITIONS: Array<{ value: string; label: string }> = [
  { value: "pursuing", label: "Pursuing" },
  { value: "offer_made", label: "Offer made" },
  { value: "passed", label: "Passed" },
  { value: "lost", label: "Lost" },
];

function money(v: number | null): string {
  if (v == null || !isFinite(v)) return "—";
  if (Math.abs(v) >= 1_000_000) return `£${(v / 1_000_000).toFixed(v % 1_000_000 === 0 ? 0 : 1)}m`;
  if (Math.abs(v) >= 1_000) return `£${Math.round(v / 1_000)}k`;
  return `£${v.toLocaleString("en-GB")}`;
}
function pct(v: number | null): string {
  if (v == null || !isFinite(v)) return "—";
  const p = v <= 1 ? v * 100 : v; // plans store decimals; hand-patches sometimes whole %
  return `${p.toFixed(p % 1 === 0 ? 0 : 2).replace(/\.?0+$/, "")}%`;
}
// Normalised sort value so decimal-stored (0.0525) and whole-number (5.25)
// rates order together instead of splitting into two bands.
function pctSortValue(v: number | null): number | null {
  if (v == null || !isFinite(v)) return null;
  return v <= 1 ? v * 100 : v;
}

type SortKey = "property" | "price" | "niy" | "irr" | "moic" | "stage" | "updated";

export default function PathwayPortfolio() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [sortKey, setSortKey] = useState<SortKey>("irr");
  const [sortAsc, setSortAsc] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  const { data: rows, isLoading } = useQuery<PortfolioRow[]>({
    queryKey: ["/api/property-pathway/portfolio"],
    queryFn: getQueryFn({ on401: "throw" }),
  });

  const dispositionMutation = useMutation({
    mutationFn: async ({ runId, status, reason }: { runId: string; status: string | null; reason?: string }) => {
      await apiRequest("POST", `/api/property-pathway/${runId}/disposition`, { status, reason });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/property-pathway/portfolio"] });
      queryClient.invalidateQueries({ queryKey: ["/api/property-pathway"] });
    },
    onError: (err: any) => toast({ title: "Could not save outcome", description: err?.message, variant: "destructive" }),
  });

  const setDisposition = (row: PortfolioRow, status: string | null) => {
    let reason: string | undefined;
    if (status === "passed" || status === "lost") {
      // One line of "why" is the whole value of outcome tracking.
      const answer = window.prompt(`Why ${status === "passed" ? "did we pass on" : "did we lose"} ${row.propertyName || row.address}? (one line)`);
      if (answer === null) return; // cancelled — leave unchanged
      reason = answer.trim() || undefined;
    }
    dispositionMutation.mutate({ runId: row.runId, status, reason });
  };

  const sorted = useMemo(() => {
    const active = (rows || []).filter(r => showArchived || !(r.disposition === "passed" || r.disposition === "lost"));
    const dir = sortAsc ? 1 : -1;
    const val = (r: PortfolioRow): string | number | null => {
      switch (sortKey) {
        case "property": return (r.propertyName || r.address || "").toLowerCase();
        case "price": return r.price;
        case "niy": return pctSortValue(r.niy);
        case "irr": return pctSortValue(r.irr);
        case "moic": return r.moic;
        case "stage": return r.currentStage;
        case "updated": return r.updatedAt ? new Date(r.updatedAt).getTime() : null;
      }
    };
    return [...active].sort((a, b) => {
      const av = val(a), bv = val(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1; // blanks sink regardless of direction
      if (bv == null) return -1;
      if (typeof av === "string" && typeof bv === "string") return av.localeCompare(bv) * dir;
      return ((av as number) - (bv as number)) * dir;
    });
  }, [rows, sortKey, sortAsc, showArchived]);

  const archivedCount = (rows || []).filter(r => r.disposition === "passed" || r.disposition === "lost").length;

  const Th = ({ label, k, className }: { label: string; k?: SortKey; className?: string }) => (
    <th className={`px-3 py-2 text-left text-[11px] uppercase tracking-wide text-muted-foreground font-medium whitespace-nowrap ${className || ""}`}>
      {k ? (
        <button
          className="inline-flex items-center gap-1 hover:text-foreground"
          onClick={() => { if (sortKey === k) setSortAsc(!sortAsc); else { setSortKey(k); setSortAsc(false); } }}
          data-testid={`sort-portfolio-${k}`}
        >
          {label}
          <ArrowUpDown className={`w-3 h-3 ${sortKey === k ? "opacity-100" : "opacity-30"}`} />
        </button>
      ) : label}
    </th>
  );

  return (
    <div className="max-w-7xl mx-auto p-4 sm:p-6 space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Pathway Portfolio</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Every investigation with a business plan, numbers side by side. Sort by IRR and discuss the top five. Outcomes set here archive dead runs off the board.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {archivedCount > 0 && (
            <Button variant={showArchived ? "default" : "outline"} size="sm" onClick={() => setShowArchived(!showArchived)} data-testid="button-toggle-archived">
              {showArchived ? "Hide" : "Show"} archived ({archivedCount})
            </Button>
          )}
          <Link href="/pathway-review"><Button variant="outline" size="sm">Review queue</Button></Link>
          <Link href="/property-pathway"><Button variant="outline" size="sm">Pathway board</Button></Link>
        </div>
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : sorted.length === 0 ? (
        <div className="text-sm text-muted-foreground">No runs with a business plan yet — the table fills as pathways reach Stage 6.</div>
      ) : (
        <div className="rounded-xl border bg-card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/30">
              <tr>
                <Th label="Property" k="property" />
                <Th label="Price" k="price" className="text-right" />
                <Th label="NIY" k="niy" className="text-right" />
                <Th label="IRR" k="irr" className="text-right" />
                <Th label="MOIC" k="moic" className="text-right" />
                <Th label="Strategy" />
                <Th label="Stage" k="stage" />
                <Th label="Outcome" />
                <Th label="" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {sorted.map((r) => {
                const archived = r.disposition === "passed" || r.disposition === "lost";
                return (
                  <tr key={r.runId} className={archived ? "opacity-55" : undefined} data-testid={`row-portfolio-${r.runId}`}>
                    <td className="px-3 py-2.5 max-w-[260px]">
                      <div className="font-medium truncate" title={r.propertyName || r.address}>{r.propertyName || r.address}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {r.propertyName ? r.address : r.postcode || ""}
                        {r.startedByName ? ` · ${r.startedByName}` : ""}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">{money(r.price)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{pct(r.niy)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{pct(r.irr)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{r.moic != null ? `${r.moic.toFixed(2).replace(/\.?0+$/, "")}x` : "—"}</td>
                    <td className="px-3 py-2.5 max-w-[220px]">
                      <span className="block truncate text-xs" title={r.strategy || undefined}>
                        {r.strategy || "—"}{r.holdPeriodYrs ? ` · ${r.holdPeriodYrs}yr` : ""}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-xs">
                      {r.completedAt ? "Complete" : `Stage ${r.currentStage}`}
                      {r.modelAgreed ? " ✓" : r.planAgreed ? " (plan ✓)" : ""}
                    </td>
                    <td className="px-3 py-2.5">
                      <select
                        value={r.disposition || ""}
                        onChange={(e) => setDisposition(r, e.target.value || null)}
                        className="text-xs border rounded-md px-1.5 py-1 bg-card"
                        title={r.dispositionReason || undefined}
                        data-testid={`select-disposition-${r.runId}`}
                      >
                        <option value="">—</option>
                        {DISPOSITIONS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
                      </select>
                      {r.dispositionReason && (
                        <div className="text-[10px] text-muted-foreground mt-0.5 max-w-[160px] truncate" title={r.dispositionReason}>{r.dispositionReason}</div>
                      )}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <div className="flex items-center gap-1 justify-end">
                        {r.whyBuyUrl && (
                          <a href={r.whyBuyUrl} target="_blank" rel="noreferrer" title="Why Buy deck">
                            <Button variant="ghost" size="sm" className="h-7 w-7 p-0"><FileText className="w-3.5 h-3.5" /></Button>
                          </a>
                        )}
                        <Link href={`/property-pathway?runId=${r.runId}`}>
                          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" title="Open run"><ExternalLink className="w-3.5 h-3.5" /></Button>
                        </Link>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
