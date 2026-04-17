import { useState, useEffect } from "react";
import { useLocation, Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { getAuthHeaders } from "@/lib/queryClient";
import {
  Building2, FolderOpen, MapPin, ShieldCheck, Sparkles,
  FileText, Image as ImageIcon, ChevronRight, ArrowRight,
  Check, Clock, AlertCircle, Plus, Search, Download, ExternalLink, Trash2,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface PathwayRun {
  id: string;
  propertyId?: string | null;
  address: string;
  postcode?: string | null;
  currentStage: number;
  stageStatus: Record<string, string>;
  stageResults: any;
  sharepointFolderPath?: string | null;
  sharepointFolderUrl?: string | null;
  modelRunId?: string | null;
  whyBuyDocumentUrl?: string | null;
  startedAt: string;
  updatedAt: string;
  completedAt?: string | null;
}

const STAGE_LABELS = [
  { n: 1, label: "Initial Search", icon: Search },
  { n: 2, label: "Brand Intelligence", icon: Sparkles },
  { n: 3, label: "Review & Confirm", icon: Check },
  { n: 4, label: "Property Intelligence", icon: Building2 },
  { n: 5, label: "Investigation Board", icon: FolderOpen },
  { n: 6, label: "Studio Time", icon: ImageIcon },
  { n: 7, label: "Why Buy", icon: FileText },
];

function stageBadgeColor(status?: string) {
  switch (status) {
    case "completed": return "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-300";
    case "running": return "bg-blue-100 text-blue-900 dark:bg-blue-900/30 dark:text-blue-300";
    case "failed": return "bg-red-100 text-red-900 dark:bg-red-900/30 dark:text-red-300";
    case "skipped": return "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400";
    default: return "bg-zinc-50 text-zinc-500 dark:bg-zinc-900 dark:text-zinc-500";
  }
}

export default function PropertyPathway() {
  const [location, navigate] = useLocation();
  const { toast } = useToast();
  const [runs, setRuns] = useState<PathwayRun[]>([]);
  const [selectedRun, setSelectedRun] = useState<PathwayRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [advancing, setAdvancing] = useState(false);
  const [newAddress, setNewAddress] = useState("");
  const [newPostcode, setNewPostcode] = useState("");

  const runIdFromUrl = (() => {
    try {
      const params = new URLSearchParams(window.location.search);
      return params.get("runId");
    } catch { return null; }
  })();

  useEffect(() => {
    loadRuns();
  }, []);

  useEffect(() => {
    if (runIdFromUrl) loadRun(runIdFromUrl);
  }, [runIdFromUrl]);

  async function loadRuns() {
    setLoading(true);
    try {
      const res = await fetch("/api/property-pathway", { headers: getAuthHeaders(), credentials: "include" });
      if (res.ok) setRuns(await res.json());
    } finally {
      setLoading(false);
    }
  }

  async function loadRun(id: string) {
    try {
      const res = await fetch(`/api/property-pathway/${id}`, { headers: getAuthHeaders(), credentials: "include" });
      if (res.ok) setSelectedRun(await res.json());
    } catch {}
  }

  async function startRun() {
    if (!newAddress.trim()) return;
    try {
      const res = await fetch("/api/property-pathway/start", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        credentials: "include",
        body: JSON.stringify({ address: newAddress.trim(), postcode: newPostcode.trim() || undefined }),
      });
      if (!res.ok) throw new Error("Failed to start");
      const { run, existing } = await res.json();
      setNewAddress("");
      setNewPostcode("");
      await loadRuns();
      setSelectedRun(run);
      navigate(`/property-pathway?runId=${run.id}`);
      if (existing) {
        toast({ title: "Opened existing investigation", description: `Resuming ${run.address}.` });
      } else {
        advanceRun(run.id, 1); // auto-advance Stage 1 on brand new runs only
      }
    } catch (err: any) {
      toast({ title: "Could not start", description: err.message, variant: "destructive" });
    }
  }

  async function deleteRun(runId: string) {
    if (!confirm("Delete this investigation? SharePoint folders and CRM records will not be affected.")) return;
    try {
      const res = await fetch(`/api/property-pathway/${runId}`, {
        method: "DELETE",
        headers: getAuthHeaders(),
        credentials: "include",
      });
      if (!res.ok) throw new Error(await res.text());
      setRuns(prev => prev.filter(r => r.id !== runId));
      if (selectedRun?.id === runId) {
        setSelectedRun(null);
        navigate("/property-pathway");
      }
      toast({ title: "Investigation deleted" });
    } catch (err: any) {
      toast({ title: "Could not delete", description: err.message, variant: "destructive" });
    }
  }

  async function advanceRun(runId: string, stage?: number) {
    setAdvancing(true);
    try {
      const res = await fetch(`/api/property-pathway/${runId}/advance`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        credentials: "include",
        body: JSON.stringify(stage ? { stage } : {}),
      });
      if (!res.ok) throw new Error(await res.text());
      const { run } = await res.json();
      setSelectedRun(run);
      loadRuns();
      // Toast the stage outcome so the user sees what happened
      const ranStage = stage ?? (run.currentStage - 1);
      const status = run.stageStatus?.[`stage${ranStage}`];
      const results = run.stageResults?.[`stage${ranStage}`];
      if (status === "skipped") {
        toast({
          title: `Stage ${ranStage} skipped`,
          description: results?.reason || "Stage was skipped — see board for details.",
        });
      } else if (status === "failed") {
        toast({ title: `Stage ${ranStage} failed`, description: results?.reason || "See server logs.", variant: "destructive" });
      } else if (status === "completed") {
        toast({ title: `Stage ${ranStage} complete`, description: results?.summary ? String(results.summary).slice(0, 200) : "Findings added to board." });
      }
    } catch (err: any) {
      toast({ title: "Stage failed", description: err.message, variant: "destructive" });
    } finally {
      setAdvancing(false);
    }
  }

  async function setTenant(runId: string, tenantName: string, companyNumber?: string) {
    try {
      const runRes = await fetch(`/api/property-pathway/${runId}`, { headers: getAuthHeaders(), credentials: "include" });
      if (!runRes.ok) throw new Error("Could not load run");
      const run = await runRes.json();
      const stageResults = { ...(run.stageResults || {}) };
      stageResults.stage1 = { ...(stageResults.stage1 || {}), tenant: { name: tenantName, ...(companyNumber ? { companyNumber } : {}) } };
      const res = await fetch(`/api/property-pathway/${runId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        credentials: "include",
        body: JSON.stringify({ stageResults }),
      });
      if (!res.ok) throw new Error(await res.text());
      const updated = await res.json();
      setSelectedRun(updated);
      toast({ title: "Tenant set", description: `${tenantName} linked to this run. Run Stage 2 again to enrich the brand.` });
    } catch (err: any) {
      toast({ title: "Could not set tenant", description: err.message, variant: "destructive" });
    }
  }

  if (selectedRun) {
    return <RunDetail
      run={selectedRun}
      onBack={() => { setSelectedRun(null); navigate("/property-pathway"); }}
      onAdvance={(s) => advanceRun(selectedRun.id, s)}
      advancing={advancing}
      onReload={() => loadRun(selectedRun.id)}
      onSetTenant={(name) => setTenant(selectedRun.id, name)}
      onDelete={() => deleteRun(selectedRun.id)}
    />;
  }

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Property Pathway</h1>
        <p className="text-sm text-muted-foreground mt-1">End-to-end investigation: search, brand intelligence, property intelligence, studios, and Why Buy.</p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Start a new investigation</CardTitle>
        </CardHeader>
        <CardContent className="flex gap-2 items-end">
          <div className="flex-1">
            <label className="text-xs text-muted-foreground mb-1 block">Address</label>
            <Input value={newAddress} onChange={e => setNewAddress(e.target.value)} placeholder="e.g. 18-22 Haymarket" className="h-9" />
          </div>
          <div className="w-32">
            <label className="text-xs text-muted-foreground mb-1 block">Postcode</label>
            <Input value={newPostcode} onChange={e => setNewPostcode(e.target.value)} placeholder="SW1Y 4DG" className="h-9" />
          </div>
          <Button onClick={startRun} disabled={!newAddress.trim()} className="h-9 gap-1.5">
            <Plus className="w-4 h-4" /> Start
          </Button>
        </CardContent>
      </Card>

      <div>
        <h2 className="text-sm font-medium text-muted-foreground mb-2">Recent investigations</h2>
        {loading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : runs.length === 0 ? (
          <div className="text-sm text-muted-foreground">No investigations yet — start one above.</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {runs.map(r => (
              <div
                key={r.id}
                className="group relative p-4 rounded-lg border bg-card hover:bg-muted/40 transition"
              >
                <button
                  onClick={(e) => { e.stopPropagation(); deleteRun(r.id); }}
                  className="absolute top-2 right-2 p-1.5 rounded hover:bg-destructive/10 text-muted-foreground/50 hover:text-destructive transition"
                  title="Delete investigation"
                  data-testid={`button-delete-pathway-${r.id}`}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => { setSelectedRun(r); navigate(`/property-pathway?runId=${r.id}`); }}
                  className="text-left w-full"
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{r.address}</p>
                      {r.postcode && <p className="text-xs text-muted-foreground mt-0.5">{r.postcode}</p>}
                    </div>
                    <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {STAGE_LABELS.map(s => (
                      <span key={s.n} className={`text-[10px] px-1.5 py-0.5 rounded ${stageBadgeColor(r.stageStatus?.[`stage${s.n}`])}`}>
                        {s.n}
                      </span>
                    ))}
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-2">Updated {new Date(r.updatedAt).toLocaleString("en-GB")}</p>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function RunDetail({ run, onBack, onAdvance, advancing, onReload, onSetTenant, onDelete }: { run: PathwayRun; onBack: () => void; onAdvance: (stage?: number) => void; advancing: boolean; onReload: () => void; onSetTenant: (name: string) => void; onDelete: () => void }) {
  const s1 = run.stageResults?.stage1;
  const s2 = run.stageResults?.stage2;
  const s4 = run.stageResults?.stage4;
  const s6 = run.stageResults?.stage6;
  const s7 = run.stageResults?.stage7;
  const s2Status = run.stageStatus?.stage2;
  const nextStage = Math.min(run.currentStage, 7);
  const [tenantInput, setTenantInput] = useState("");

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <button onClick={onBack} className="text-xs text-muted-foreground hover:text-foreground mb-1">← All investigations</button>
          <h1 className="text-2xl font-semibold tracking-tight">{run.address}</h1>
          {run.postcode && <p className="text-sm text-muted-foreground">{run.postcode}</p>}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onReload} title="Reload saved state from server">
            <AlertCircle className="w-4 h-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => onAdvance(1)} disabled={advancing} title="Re-run Stage 1 with latest logic (emails, brochures, SharePoint, AI briefing)">
            {advancing ? <Clock className="w-4 h-4 mr-1 animate-spin" /> : <Search className="w-4 h-4 mr-1" />}
            Re-run Stage 1
          </Button>
          <Button variant="ghost" size="sm" onClick={onDelete} className="text-muted-foreground hover:text-destructive" title="Delete investigation">
            <Trash2 className="w-4 h-4" />
          </Button>
          <Button onClick={() => onAdvance(nextStage)} disabled={advancing || run.currentStage > 7} className="gap-1.5">
            {advancing ? <Clock className="w-4 h-4" /> : <ArrowRight className="w-4 h-4" />}
            Run Stage {nextStage}
          </Button>
        </div>
      </div>

      {/* Stage timeline */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex items-center justify-between gap-2">
            {STAGE_LABELS.map(s => {
              const status = run.stageStatus?.[`stage${s.n}`];
              const Icon = s.icon;
              return (
                <div key={s.n} className="flex-1 text-center">
                  <div className={`mx-auto w-8 h-8 rounded-full flex items-center justify-center mb-1.5 ${
                    status === "completed" ? "bg-emerald-500 text-white" :
                    status === "running" ? "bg-blue-500 text-white" :
                    status === "failed" ? "bg-red-500 text-white" :
                    status === "skipped" ? "bg-zinc-300 text-zinc-600" :
                    "bg-zinc-100 text-zinc-400 dark:bg-zinc-800"
                  }`}>
                    {status === "completed" ? <Check className="w-4 h-4" /> :
                     status === "failed" ? <AlertCircle className="w-4 h-4" /> :
                     <Icon className="w-4 h-4" />}
                  </div>
                  <p className="text-[10px] leading-tight">{s.label}</p>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Stage 1 — Initial Search findings */}
      {s1 && (
        <>
          {/* AI briefing synthesising everything we found */}
          {s1.aiBriefing && (
            <Card className="border-primary/40 bg-primary/5">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2"><Sparkles className="w-4 h-4" /> Analyst briefing</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {s1.aiBriefing.headline && (
                  <p className="text-[15px] font-medium leading-snug">{s1.aiBriefing.headline}</p>
                )}
                {s1.aiBriefing.bullets?.length > 0 && (
                  <ul className="space-y-1.5 text-muted-foreground">
                    {s1.aiBriefing.bullets.map((b: string, i: number) => (
                      <li key={i} className="flex gap-2">
                        <span className="text-primary shrink-0">·</span>
                        <span>{b}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {s1.aiBriefing.keyQuestions?.length > 0 && (
                  <div className="pt-2 border-t border-primary/20">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1.5">Next questions</p>
                    <ul className="space-y-1 text-xs">
                      {s1.aiBriefing.keyQuestions.map((q: string, i: number) => (
                        <li key={i} className="flex gap-2">
                          <span className="text-primary shrink-0">?</span>
                          <span>{q}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="pb-3 flex flex-row items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2"><Search className="w-4 h-4" /> Initial Search — summary</CardTitle>
              <div className="flex items-center gap-3">
                {s1.propertyImage?.googleMapsUrl && (
                  <a href={s1.propertyImage.googleMapsUrl} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline inline-flex items-center gap-1">
                    <MapPin className="w-3 h-3" /> Google Maps
                  </a>
                )}
                {run.sharepointFolderUrl && (
                  <a href={run.sharepointFolderUrl} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline inline-flex items-center gap-1">
                    <FolderOpen className="w-3 h-3" /> Open SharePoint
                  </a>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex gap-3">
                {s1.propertyImage?.streetViewUrl && (
                  <a href={s1.propertyImage.googleMapsUrl || "#"} target="_blank" rel="noreferrer" className="shrink-0 block hover:opacity-90 transition-opacity">
                    <img
                      src={s1.propertyImage.streetViewUrl}
                      alt={`Street view of ${run.address}`}
                      className="w-40 h-24 md:w-56 md:h-32 rounded-lg object-cover border"
                      onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                    />
                  </a>
                )}
                <div className="flex-1 min-w-0">
                  <p className="font-medium">{run.address}{run.postcode ? `, ${run.postcode}` : ""}</p>
                  {s1.aiFacts?.listedStatus && <Badge variant="outline" className="mt-1 text-[10px]">{s1.aiFacts.listedStatus}</Badge>}
                  {s1.aiFacts?.currentUse && <p className="text-xs text-muted-foreground mt-1">{s1.aiFacts.currentUse}</p>}
                  {s1.summary && <p className="text-xs text-muted-foreground mt-2">{s1.summary}</p>}
                </div>
              </div>

              {/* Ownership — prefer Land Reg structured data, fall back to AI-extracted facts */}
              <div className="border rounded-lg p-3 bg-muted/20">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-2">Ownership</p>
                {(() => {
                  const ownerName = s1.initialOwnership?.proprietorName || s1.aiFacts?.owner;
                  const titleNum = s1.initialOwnership?.titleNumber;
                  const paid = s1.initialOwnership?.pricePaid ? `£${(s1.initialOwnership.pricePaid / 1e6).toFixed(1)}m` : s1.aiFacts?.purchasePrice;
                  const date = s1.initialOwnership?.dateOfPurchase || s1.aiFacts?.purchaseDate;
                  const coNumber = s1.aiFacts?.ownerCompanyNumber;

                  if (!ownerName && !titleNum && !paid && !date) {
                    return <p className="text-xs text-muted-foreground">Owner not resolved via Land Registry or CRM. Advance to Stage 4 (Property Intelligence) for deeper lookups.</p>;
                  }
                  return (
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
                      <div><span className="text-muted-foreground">Owner:</span> <span className="font-medium">{ownerName || "—"}</span>{coNumber ? <span className="text-muted-foreground ml-1">(Co# {coNumber})</span> : null}</div>
                      <div><span className="text-muted-foreground">Title:</span> <span className="font-medium">{titleNum || "—"}</span></div>
                      <div><span className="text-muted-foreground">Paid:</span> <span className="font-medium">{paid || "—"}</span></div>
                      <div><span className="text-muted-foreground">Date:</span> <span className="font-medium">{date || "—"}</span></div>
                      {s1.aiFacts?.refurbCost && <div><span className="text-muted-foreground">Refurb:</span> <span className="font-medium">{s1.aiFacts.refurbCost}</span></div>}
                    </div>
                  );
                })()}
              </div>

              {/* Tenants */}
              {((s1.aiFacts?.mainTenants && s1.aiFacts.mainTenants.length > 0) || s1.aiFacts?.leaseStatus) && (
                <div className="border rounded-lg p-3 bg-muted/20">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-2">Tenants</p>
                  {s1.aiFacts?.mainTenants && s1.aiFacts.mainTenants.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-1.5">
                      {s1.aiFacts.mainTenants.map((t: string, i: number) => (
                        <Badge key={i} variant="secondary" className="text-[10px]">{t}</Badge>
                      ))}
                    </div>
                  )}
                  {s1.aiFacts?.leaseStatus && <p className="text-xs text-muted-foreground">{s1.aiFacts.leaseStatus}</p>}
                </div>
              )}

              {/* Pipeline counts */}
              <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
                <CountBlock label="Emails" value={s1.emailHits?.length || 0} />
                <CountBlock label="SharePoint" value={s1.sharepointHits?.length || 0} />
                <CountBlock label="Deals" value={s1.deals?.length || 0} />
                <CountBlock label="Units" value={s1.tenancy?.units?.length || 0} />
                <CountBlock label="Comps" value={s1.comps?.length || 0} />
                <CountBlock label="Brochures" value={s1.brochureFiles?.length || 0} />
              </div>
            </CardContent>
          </Card>

          {/* CRM property matches */}
          {s1.crmHits?.properties && s1.crmHits.properties.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2"><Building2 className="w-4 h-4" /> CRM properties ({s1.crmHits.properties.length})</CardTitle>
              </CardHeader>
              <CardContent className="text-sm space-y-1">
                {s1.crmHits.properties.map((p: any) => (
                  <Link key={p.id} href={`/properties/${p.id}`}>
                    <div className="flex items-center justify-between py-1.5 border-b last:border-b-0 hover:bg-muted/50 px-2 -mx-2 rounded cursor-pointer">
                      <div className="min-w-0">
                        <p className="font-medium truncate">{p.name}</p>
                        <p className="text-xs text-muted-foreground">{[p.status, p.assetClass, p.team].filter(Boolean).join(" · ")}</p>
                      </div>
                      <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                    </div>
                  </Link>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Deals on file */}
          {s1.deals && s1.deals.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2"><Building2 className="w-4 h-4" /> BGP deal history ({s1.deals.length})</CardTitle>
              </CardHeader>
              <CardContent className="text-sm space-y-1">
                {s1.deals.map((d: any) => (
                  <Link key={d.id} href={`/deals/${d.id}`}>
                    <div className="flex items-center justify-between py-1.5 border-b last:border-b-0 hover:bg-muted/50 px-2 -mx-2 rounded cursor-pointer">
                      <div className="min-w-0">
                        <p className="font-medium truncate">{d.name}</p>
                        <p className="text-xs text-muted-foreground">{[d.dealType, d.stage || d.status, d.team?.join?.(", ")].filter(Boolean).join(" · ")}</p>
                      </div>
                      <div className="text-right text-xs text-muted-foreground shrink-0">
                        {d.rentPa ? `£${d.rentPa.toLocaleString()} pa` : ""}
                        {d.createdAt && <span className="block">{new Date(d.createdAt).toLocaleDateString("en-GB")}</span>}
                      </div>
                    </div>
                  </Link>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Tenancy / units */}
          {s1.tenancy?.units && s1.tenancy.units.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <MapPin className="w-4 h-4" /> Tenancy — {s1.tenancy.units.length} unit(s)
                  <Badge variant="outline" className="ml-2 text-[10px]">{s1.tenancy.status}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="text-xs space-y-1">
                {s1.tenancy.units.slice(0, 15).map((u: any) => (
                  <div key={u.id} className="flex items-center justify-between py-1 border-b last:border-b-0">
                    <div className="min-w-0">
                      <span className="font-medium">{u.unitName}</span>
                      {u.floor && <span className="text-muted-foreground ml-1">· {u.floor}</span>}
                      {u.useClass && <span className="text-muted-foreground ml-1">· {u.useClass}</span>}
                    </div>
                    <div className="text-right text-muted-foreground shrink-0">
                      {u.sqft ? `${Math.round(u.sqft).toLocaleString()} sqft` : ""}
                      {u.askingRent ? <span className="ml-2">£{u.askingRent.toLocaleString()}</span> : ""}
                      {u.marketingStatus && <Badge variant="outline" className="ml-2 text-[9px]">{u.marketingStatus}</Badge>}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Engagements — viewings + interactions */}
          {s1.engagements && s1.engagements.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2"><ShieldCheck className="w-4 h-4" /> Who has engaged ({s1.engagements.length})</CardTitle>
              </CardHeader>
              <CardContent className="text-xs space-y-1">
                {s1.engagements.slice(0, 20).map((e: any, i: number) => (
                  <div key={i} className="flex items-center justify-between py-1 border-b last:border-b-0">
                    <div className="min-w-0">
                      <span className="font-medium">{e.contact || e.company || "Unknown"}</span>
                      {e.company && e.contact && <span className="text-muted-foreground ml-1">· {e.company}</span>}
                      {e.unitName && <span className="text-muted-foreground ml-1">· {e.unitName}</span>}
                      {e.outcome && <Badge variant="outline" className="ml-2 text-[9px]">{e.outcome}</Badge>}
                    </div>
                    <span className="text-muted-foreground shrink-0 ml-2">{e.date ? new Date(e.date).toLocaleDateString("en-GB") : ""}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Existing SharePoint folders / files */}
          {s1.sharepointHits && s1.sharepointHits.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2"><FolderOpen className="w-4 h-4" /> SharePoint already has ({s1.sharepointHits.length})</CardTitle>
              </CardHeader>
              <CardContent className="text-xs space-y-1 max-h-72 overflow-y-auto">
                {s1.sharepointHits.map((f: any, i: number) => (
                  <div key={i} className="flex items-center justify-between py-1 border-b last:border-b-0 hover:bg-muted/40 rounded px-1 -mx-1">
                    {f.webUrl ? (
                      <a href={f.webUrl} target="_blank" rel="noreferrer" className="min-w-0 flex-1 flex items-center gap-1.5 cursor-pointer group">
                        <span className="font-medium text-primary group-hover:underline truncate">{f.name}</span>
                        <ExternalLink className="w-3 h-3 text-muted-foreground shrink-0" />
                        <span className="text-muted-foreground truncate hidden sm:inline">· {f.path.replace(/^\//, "")}</span>
                      </a>
                    ) : (
                      <span className="min-w-0 flex-1 font-medium truncate">{f.name}</span>
                    )}
                    <span className="text-muted-foreground shrink-0 ml-2 flex items-center gap-1.5">
                      {f.type === "folder" && <Badge variant="outline" className="text-[9px]">folder</Badge>}
                      {f.sizeMB ? <span>{f.sizeMB} MB</span> : null}
                      {f.modifiedAt ? <span>{new Date(f.modifiedAt).toLocaleDateString("en-GB")}</span> : null}
                    </span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Brochures identified */}
          {s1.brochureFiles && s1.brochureFiles.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2"><FileText className="w-4 h-4" /> Brochures on file ({s1.brochureFiles.length})</CardTitle>
              </CardHeader>
              <CardContent className="text-xs space-y-1">
                {s1.brochureFiles.map((b: any, i: number) => (
                  <div key={i} className="flex items-center justify-between py-1 border-b last:border-b-0 hover:bg-muted/40 rounded px-1 -mx-1">
                    {b.webUrl ? (
                      <a href={b.webUrl} target="_blank" rel="noreferrer" className="min-w-0 flex-1 flex items-center gap-1.5 cursor-pointer group">
                        <span className="font-medium text-primary group-hover:underline truncate">{b.name}</span>
                        <ExternalLink className="w-3 h-3 text-muted-foreground shrink-0" />
                      </a>
                    ) : (
                      <span className="min-w-0 flex-1 font-medium truncate">{b.name}</span>
                    )}
                    <span className="text-muted-foreground shrink-0 ml-2">{b.source}{b.date ? ` · ${new Date(b.date).toLocaleDateString("en-GB")}` : ""}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Past transactions */}
          {s1.pricePaidHistory && s1.pricePaidHistory.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2"><Download className="w-4 h-4" /> Past transactions — this street</CardTitle>
              </CardHeader>
              <CardContent className="text-xs space-y-1">
                {s1.pricePaidHistory.slice(0, 12).map((t: any, i: number) => (
                  <div key={i} className="flex items-center justify-between py-1 border-b last:border-b-0">
                    <span className="truncate">{t.address}</span>
                    <span className="text-muted-foreground shrink-0 ml-2">
                      {t.price ? `£${t.price.toLocaleString()}` : "—"}{t.date ? ` · ${t.date}` : ""}
                    </span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Investment comps */}
          {s1.comps && s1.comps.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2"><Building2 className="w-4 h-4" /> Investment comps — same postcode</CardTitle>
              </CardHeader>
              <CardContent className="text-xs space-y-1">
                {s1.comps.slice(0, 12).map((c: any, i: number) => (
                  <div key={i} className="flex items-center justify-between py-1 border-b last:border-b-0">
                    <span className="truncate">{c.address}</span>
                    <span className="text-muted-foreground shrink-0 ml-2">
                      {c.price ? `£${(c.price / 1e6).toFixed(1)}m` : "—"}
                      {c.yield ? ` · ${(c.yield * 100).toFixed(2)}%` : ""}
                      {c.date ? ` · ${c.date}` : ""}
                    </span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Email hits — full list */}
          {s1.emailHits && s1.emailHits.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2"><Search className="w-4 h-4" /> Emails ({s1.emailHits.length})</CardTitle>
              </CardHeader>
              <CardContent className="text-xs space-y-1.5">
                {s1.emailHits.slice(0, 12).map((h: any, i: number) => {
                  const Wrapper: any = h.webLink ? "a" : "div";
                  const wrapperProps = h.webLink ? { href: h.webLink, target: "_blank", rel: "noreferrer", className: "block border-l-2 border-muted hover:border-primary pl-2 py-0.5 hover:bg-muted/50 rounded-r cursor-pointer" } : { className: "border-l-2 border-muted pl-2 py-0.5" };
                  return (
                    <Wrapper key={i} {...wrapperProps}>
                      <p className="font-medium truncate">{h.subject}{h.hasAttachments ? " 📎" : ""}{h.webLink ? <ExternalLink className="w-3 h-3 inline ml-1 text-muted-foreground" /> : null}</p>
                      <p className="text-muted-foreground">{h.from} — {new Date(h.date).toLocaleDateString("en-GB")}</p>
                    </Wrapper>
                  );
                })}
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* Stage 2 — Brand Intelligence */}
      {s2Status === "skipped" ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2"><Sparkles className="w-4 h-4" /> Brand Intelligence — skipped</CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-3">
            <p className="text-muted-foreground">
              {s2?.reason || "No tenant was identified in Stage 1."} Set the tenant here and re-run Stage 2.
            </p>
            <div className="flex gap-2 items-end max-w-md">
              <div className="flex-1">
                <label className="text-xs text-muted-foreground mb-1 block">Tenant / occupier</label>
                <Input value={tenantInput} onChange={e => setTenantInput(e.target.value)} placeholder="e.g. Dover Street Market" className="h-9" />
              </div>
              <Button
                onClick={() => { if (tenantInput.trim()) { onSetTenant(tenantInput.trim()); setTenantInput(""); } }}
                disabled={!tenantInput.trim()}
                className="h-9"
              >
                Set tenant
              </Button>
            </div>
            <Button variant="outline" size="sm" onClick={() => onAdvance(2)}>Re-run Stage 2</Button>
          </CardContent>
        </Card>
      ) : s2 && !s2.skipped ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2"><Sparkles className="w-4 h-4" /> Brand Intelligence</CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-2">
            <p className="text-xs text-muted-foreground">Enriched fields: {Object.keys(s2.enrichedFields || {}).join(", ") || "(none)"}</p>
            {s2.enrichedFields && (
              <div className="grid grid-cols-2 gap-2 text-xs">
                {Object.entries(s2.enrichedFields).map(([k, v]) => (
                  <div key={k} className="border rounded p-2">
                    <p className="text-muted-foreground capitalize">{k.replace(/_/g, " ")}</p>
                    <p className="font-medium">{String(v).slice(0, 120)}</p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      {/* Stage 4 — Property Intelligence */}
      {s4 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2"><Building2 className="w-4 h-4" /> Property Intelligence</CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-2">
            <div className="grid grid-cols-2 gap-3">
              <InfoBlock label="Planning applications" value={`${s4.planningApplications?.length || 0}`} />
              <InfoBlock label="Floor plan candidates" value={`${s4.floorPlanUrls?.length || 0}`} />
            </div>
            {s4.planningApplications && s4.planningApplications.length > 0 && (
              <details className="text-xs">
                <summary className="cursor-pointer text-muted-foreground">Planning applications</summary>
                <ul className="mt-2 space-y-1">
                  {s4.planningApplications.slice(0, 10).map((p: any, i: number) => (
                    <li key={i} className="border-l-2 border-muted pl-2">
                      <span className="font-medium">{p.reference}</span>
                      <span className="text-muted-foreground"> — {p.description} ({p.status})</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </CardContent>
        </Card>
      )}

      {/* Stage 6 — Studios */}
      {s6 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2"><ImageIcon className="w-4 h-4" /> Studios</CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-2">
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
              <InfoBlock label="Street View" value={s6.streetViewImageId ? "Captured" : "—"} />
              <InfoBlock label="Retail Context Plan" value={s6.retailContextImageId ? "Rendered" : "—"} />
              <InfoBlock label="Model run" value={run.modelRunId ? "Linked" : "Not started"} />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Stage 7 — Why Buy */}
      {s7 && (
        <Card>
          <CardHeader className="pb-3 flex flex-row items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2"><FileText className="w-4 h-4" /> Why Buy</CardTitle>
            {(s7.sharepointUrl || s7.documentUrl) && (
              <a href={s7.sharepointUrl || s7.documentUrl} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline inline-flex items-center gap-1">
                <Download className="w-3 h-3" /> Open Why Buy PDF
              </a>
            )}
          </CardHeader>
          <CardContent className="text-sm">
            <p className="text-muted-foreground">4-page PE-style investment memo generated from pathway findings.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function InfoBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="border rounded-lg p-3">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-sm font-medium mt-0.5 truncate">{value}</p>
    </div>
  );
}

function CountBlock({ label, value }: { label: string; value: number }) {
  return (
    <div className="border rounded-lg p-2 text-center">
      <p className="text-lg font-bold">{value}</p>
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
    </div>
  );
}
