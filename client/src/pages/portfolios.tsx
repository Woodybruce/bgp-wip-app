// Portfolios — bundle Property Pathway runs into one reviewable
// opportunity, toggle assets in/out, and generate combined outputs
// (summary table here; Excel + Why Buy deck via the action buttons).
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute, Link } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Loader2, Plus, FolderOpen, FileSpreadsheet, FileText, Trash2, ChevronLeft, ExternalLink } from "lucide-react";

const fmtMoney = (p: number | null) =>
  p == null ? "—" : `£${(p / 1).toLocaleString("en-GB", { maximumFractionDigits: 0 })}`;
const fmtPct = (d: number | null) => (d == null ? "—" : `${(d * 100).toFixed(2)}%`);
const fmtX = (d: number | null) => (d == null ? "—" : `${d.toFixed(2)}x`);

interface PortfolioListItem { id: string; name: string; notes: string | null; runCount: number; updatedAt: string; }
interface RunRow {
  runId: string; linkId: string; enabled: boolean;
  address: string; postcode: string | null; currentStage: number; whyBuyUrl: string | null;
  strategy: string | null; targetPurchasePrice: number | null; targetNIY: number | null;
  exitPrice: number | null; exitYield: number | null; targetIRR: number | null; targetMOIC: number | null;
  holdPeriodYrs: number | null; rentPA: number | null; keyRisks: string[];
}
interface PortfolioDetail {
  portfolio: { id: string; name: string; notes: string | null };
  items: RunRow[];
  totals: {
    assetCount: number; totalPurchasePrice: number | null; totalRentPA: number | null;
    totalExitPrice: number | null; blendedNIY: number | null; blendedExitYield: number | null;
  };
}

// ─── List view ───────────────────────────────────────────────────────────
function PortfolioList() {
  const { toast } = useToast();
  const [newName, setNewName] = useState("");
  const { data: portfolios = [], isLoading } = useQuery<PortfolioListItem[]>({ queryKey: ["/api/portfolios"] });

  const createMutation = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/portfolios", { name: newName })).json(),
    onSuccess: () => {
      setNewName("");
      queryClient.invalidateQueries({ queryKey: ["/api/portfolios"] });
      toast({ title: "Portfolio created" });
    },
    onError: (e: any) => toast({ title: "Couldn't create", description: e?.message, variant: "destructive" }),
  });

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      <h1 className="text-2xl font-semibold mb-1 flex items-center gap-2"><FolderOpen className="w-6 h-6" /> Portfolios</h1>
      <p className="text-sm text-muted-foreground mb-5">Bundle several Property Pathway runs and review them as one opportunity.</p>

      <div className="flex gap-2 mb-6">
        <Input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="New portfolio name (e.g. 'Camden retail parade')"
          onKeyDown={(e) => { if (e.key === "Enter" && newName.trim()) createMutation.mutate(); }}
        />
        <Button onClick={() => createMutation.mutate()} disabled={!newName.trim() || createMutation.isPending}>
          {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          New
        </Button>
      </div>

      {isLoading ? (
        <div className="py-12 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground" /></div>
      ) : portfolios.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-10">No portfolios yet. Create one above, then add pathway runs to it.</p>
      ) : (
        <div className="space-y-2">
          {portfolios.map((p) => (
            <Link key={p.id} href={`/portfolios/${p.id}`} className="block rounded-xl border border-border bg-card p-4 hover:bg-muted/40 transition-colors" data-testid={`portfolio-${p.id}`}>
              <div className="flex items-center justify-between">
                <div className="font-semibold">{p.name}</div>
                <div className="text-xs text-muted-foreground">{p.runCount} asset{p.runCount === 1 ? "" : "s"}</div>
              </div>
              {p.notes && <div className="text-xs text-muted-foreground mt-1 truncate">{p.notes}</div>}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Detail view ─────────────────────────────────────────────────────────
function PortfolioDetailView({ id }: { id: string }) {
  const { toast } = useToast();
  const { data, isLoading } = useQuery<PortfolioDetail>({ queryKey: [`/api/portfolios/${id}`] });

  const toggleMutation = useMutation({
    mutationFn: async ({ runId, enabled }: { runId: string; enabled: boolean }) =>
      (await apiRequest("PATCH", `/api/portfolios/${id}/runs/${runId}`, { enabled })).json(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [`/api/portfolios/${id}`] }),
    onError: (e: any) => toast({ title: "Toggle failed", description: e?.message, variant: "destructive" }),
  });

  const removeMutation = useMutation({
    mutationFn: async (runId: string) => (await apiRequest("DELETE", `/api/portfolios/${id}/runs/${runId}`)).json(),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: [`/api/portfolios/${id}`] }); toast({ title: "Removed from portfolio" }); },
    onError: (e: any) => toast({ title: "Remove failed", description: e?.message, variant: "destructive" }),
  });

  // The two document generators. They stream back a file URL; we open it.
  const genMutation = useMutation({
    mutationFn: async (kind: "excel" | "why-buy") =>
      (await apiRequest("POST", `/api/portfolios/${id}/generate/${kind}`, {})).json(),
    onSuccess: (json: any) => {
      if (json?.url) { window.open(json.url, "_blank"); toast({ title: "Generated", description: "Opening in a new tab." }); }
      else toast({ title: "Generation started", description: json?.note || "Check back shortly." });
    },
    onError: (e: any) => toast({ title: "Generation failed", description: e?.message, variant: "destructive" }),
  });

  if (isLoading) return <div className="py-16 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground" /></div>;
  if (!data) return <div className="py-16 text-center text-sm text-muted-foreground">Portfolio not found.</div>;

  const { portfolio, items, totals } = data;
  const enabledCount = items.filter(i => i.enabled).length;

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      <Link href="/portfolios" className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1 mb-3"><ChevronLeft className="w-4 h-4" /> All portfolios</Link>
      <div className="flex items-start justify-between mb-4 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{portfolio.name}</h1>
          <p className="text-sm text-muted-foreground">{enabledCount} of {items.length} asset{items.length === 1 ? "" : "s"} included in combined outputs</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => genMutation.mutate("excel")} disabled={genMutation.isPending || enabledCount === 0}>
            {genMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />} Combined Excel
          </Button>
          <Button onClick={() => genMutation.mutate("why-buy")} disabled={genMutation.isPending || enabledCount === 0}>
            {genMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />} Combined Why Buy
          </Button>
        </div>
      </div>

      {/* Portfolio totals */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-5">
        {[
          { label: "Assets", value: String(totals.assetCount) },
          { label: "Total price", value: fmtMoney(totals.totalPurchasePrice) },
          { label: "Total rent PA", value: fmtMoney(totals.totalRentPA) },
          { label: "Blended NIY", value: fmtPct(totals.blendedNIY) },
          { label: "Blended exit yield", value: fmtPct(totals.blendedExitYield) },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-border bg-card p-3">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{s.label}</div>
            <div className="text-lg font-bold mt-0.5">{s.value}</div>
          </div>
        ))}
      </div>

      {items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          No runs in this portfolio yet. Open a Property Pathway run and use "Add to portfolio", or add runs from the pathway list.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/60 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                <th className="px-3 py-2">Include</th>
                <th className="px-3 py-2">Property</th>
                <th className="px-3 py-2">Strategy</th>
                <th className="px-3 py-2 text-right">Price</th>
                <th className="px-3 py-2 text-right">NIY</th>
                <th className="px-3 py-2 text-right">Rent PA</th>
                <th className="px-3 py-2 text-right">Exit</th>
                <th className="px-3 py-2 text-right">IRR</th>
                <th className="px-3 py-2 text-right">MOIC</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((r) => (
                <tr key={r.runId} className={`border-t border-border ${r.enabled ? "" : "opacity-45"}`} data-testid={`portfolio-run-${r.runId}`}>
                  <td className="px-3 py-2">
                    <Switch
                      checked={r.enabled}
                      onCheckedChange={(v) => toggleMutation.mutate({ runId: r.runId, enabled: v })}
                      data-testid={`toggle-${r.runId}`}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <div className="font-medium flex items-center gap-1.5">
                      {r.address}
                      <Link href={`/property-pathway?runId=${r.runId}`} className="text-muted-foreground hover:text-foreground"><ExternalLink className="w-3 h-3" /></Link>
                    </div>
                    <div className="text-[11px] text-muted-foreground">{r.postcode || ""} · stage {r.currentStage}/9</div>
                  </td>
                  <td className="px-3 py-2 max-w-[180px] truncate text-muted-foreground">{r.strategy || "—"}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmtMoney(r.targetPurchasePrice)}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmtPct(r.targetNIY)}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmtMoney(r.rentPA)}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmtMoney(r.exitPrice)}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmtPct(r.targetIRR)}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmtX(r.targetMOIC)}</td>
                  <td className="px-3 py-2 text-right">
                    <button onClick={() => removeMutation.mutate(r.runId)} className="text-muted-foreground hover:text-red-600" title="Remove from portfolio" data-testid={`remove-${r.runId}`}>
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <PortfolioProperties id={id} />
    </div>
  );
}

// ─── Properties section ──────────────────────────────────────────────────
// The second membership axis: crm properties grouped under this portfolio
// (drives the expandable head row on the Investment Tracker). Runs above
// are pathway analyses; these are the actual CRM property records.
function PortfolioProperties({ id }: { id: string }) {
  const { toast } = useToast();
  const [addOpen, setAddOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");

  const { data, isLoading } = useQuery<{
    properties: Array<{
      id: string; name: string; postcode: string | null; trackerStatus: string | null;
      guidePrice: number | null; niy: number | null; sqft: number | null; currentRent: number | null;
      tenure: string | null; lettingUnits: number; pathwayRuns: number;
    }>;
    aggregates: { propertyCount: number; totalGuidePrice: number; totalSqft: number; totalRent: number; blendedNiy: number | null };
  }>({ queryKey: [`/api/portfolio-properties/${id}`] });

  const { data: allProperties = [] } = useQuery<Array<{ id: string; name: string }>>({
    queryKey: ["/api/crm/properties"],
    enabled: addOpen,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: [`/api/portfolio-properties/${id}`] });
    queryClient.invalidateQueries({ queryKey: ["/api/portfolio-properties"] });
  };

  const addMutation = useMutation({
    mutationFn: async (propertyId: string) =>
      (await apiRequest("POST", "/api/portfolio-properties", { portfolioId: id, propertyIds: [propertyId] })).json(),
    onSuccess: () => { invalidate(); toast({ title: "Property added" }); },
    onError: (e: any) => toast({ title: "Couldn't add property", description: e?.message, variant: "destructive" }),
  });

  const removeMutation = useMutation({
    mutationFn: async (propertyId: string) =>
      (await apiRequest("DELETE", `/api/portfolio-properties/${id}/${propertyId}`)).json(),
    onSuccess: () => { invalidate(); toast({ title: "Removed from portfolio" }); },
    onError: (e: any) => toast({ title: "Couldn't remove", description: e?.message, variant: "destructive" }),
  });

  const props = data?.properties || [];
  const agg = data?.aggregates;
  const memberIds = new Set(props.map(p => p.id));
  const addable = allProperties
    .filter(p => !memberIds.has(p.id))
    .filter(p => !searchTerm || p.name.toLowerCase().includes(searchTerm.toLowerCase()))
    .slice(0, 12);

  return (
    <div className="mt-8">
      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
        <div>
          <h2 className="text-lg font-semibold">Properties</h2>
          <p className="text-xs text-muted-foreground">
            CRM properties grouped under this portfolio — they render as one expandable row on the Investment Tracker.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setAddOpen(v => !v)} data-testid="button-toggle-add-property">
          <Plus className="w-4 h-4" /> Add property
        </Button>
      </div>

      {addOpen && (
        <div className="rounded-xl border border-border p-3 mb-3 bg-muted/30">
          <Input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search CRM properties..."
            autoFocus
            data-testid="input-search-add-property"
          />
          {searchTerm && (
            <div className="mt-2 space-y-1 max-h-48 overflow-y-auto">
              {addable.length === 0 ? (
                <p className="text-xs text-muted-foreground px-1 py-2">No matching properties.</p>
              ) : addable.map(p => (
                <button
                  key={p.id}
                  className="w-full text-left text-sm px-2 py-1.5 rounded hover:bg-muted"
                  onClick={() => { addMutation.mutate(p.id); setSearchTerm(""); }}
                  data-testid={`add-portfolio-property-${p.id}`}
                >
                  {p.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {isLoading ? (
        <div className="py-8 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto text-muted-foreground" /></div>
      ) : props.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          No properties yet — add them here, or select rows on the Investment Tracker and "Group into portfolio".
        </div>
      ) : (
        <>
          {agg && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
              {[
                { label: "Total guide price", value: agg.totalGuidePrice ? fmtMoney(agg.totalGuidePrice) : "—" },
                { label: "Total rent PA", value: agg.totalRent ? fmtMoney(agg.totalRent) : "—" },
                { label: "Total sq ft", value: agg.totalSqft ? agg.totalSqft.toLocaleString("en-GB") : "—" },
                { label: "Blended yield", value: agg.blendedNiy != null ? `${agg.blendedNiy.toFixed(2)}%` : "—" },
              ].map(s => (
                <div key={s.label} className="rounded-xl border border-border bg-card p-3">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{s.label}</div>
                  <div className="text-lg font-bold mt-0.5">{s.value}</div>
                </div>
              ))}
            </div>
          )}
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/60 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-3 py-2">Property</th>
                  <th className="px-3 py-2">Tracker status</th>
                  <th className="px-3 py-2 text-right">Guide</th>
                  <th className="px-3 py-2 text-right">Rent PA</th>
                  <th className="px-3 py-2 text-right">Sq ft</th>
                  <th className="px-3 py-2 text-center">Letting units</th>
                  <th className="px-3 py-2 text-center">Pathways</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {props.map(p => (
                  <tr key={p.id} className="border-t border-border" data-testid={`portfolio-property-${p.id}`}>
                    <td className="px-3 py-2">
                      <Link href={`/properties/${p.id}`} className="font-medium hover:underline">{p.name}</Link>
                      <div className="text-[11px] text-muted-foreground">{p.postcode || ""}</div>
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{p.trackerStatus || "Not on tracker"}</td>
                    <td className="px-3 py-2 text-right font-mono">{p.guidePrice ? fmtMoney(p.guidePrice) : "—"}</td>
                    <td className="px-3 py-2 text-right font-mono">{p.currentRent ? fmtMoney(p.currentRent) : "—"}</td>
                    <td className="px-3 py-2 text-right font-mono">{p.sqft ? p.sqft.toLocaleString("en-GB") : "—"}</td>
                    <td className="px-3 py-2 text-center text-xs">{Number(p.lettingUnits) || "—"}</td>
                    <td className="px-3 py-2 text-center text-xs">{Number(p.pathwayRuns) || "—"}</td>
                    <td className="px-3 py-2 text-right">
                      <button onClick={() => removeMutation.mutate(p.id)} className="text-muted-foreground hover:text-red-600" title="Remove from portfolio" data-testid={`remove-property-${p.id}`}>
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

export default function Portfolios() {
  const [, params] = useRoute("/portfolios/:id");
  if (params?.id) return <PortfolioDetailView id={params.id} />;
  return <PortfolioList />;
}
