import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { getAuthHeaders } from "@/lib/queryClient";
import {
  Building2, FolderOpen, MapPin, ShieldCheck, Sparkles,
  FileText, Image as ImageIcon, ChevronRight, ArrowRight,
  Check, Clock, AlertCircle, Plus, Search, Download, ExternalLink,
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
      const { run } = await res.json();
      setNewAddress("");
      setNewPostcode("");
      await loadRuns();
      setSelectedRun(run);
      navigate(`/property-pathway?runId=${run.id}`);
      // auto-advance Stage 1
      advanceRun(run.id, 1);
    } catch (err: any) {
      toast({ title: "Could not start", description: err.message, variant: "destructive" });
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
    } catch (err: any) {
      toast({ title: "Stage failed", description: err.message, variant: "destructive" });
    } finally {
      setAdvancing(false);
    }
  }

  if (selectedRun) {
    return <RunDetail run={selectedRun} onBack={() => { setSelectedRun(null); navigate("/property-pathway"); }} onAdvance={(s) => advanceRun(selectedRun.id, s)} advancing={advancing} onReload={() => loadRun(selectedRun.id)} />;
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
              <button
                key={r.id}
                onClick={() => { setSelectedRun(r); navigate(`/property-pathway?runId=${r.id}`); }}
                className="text-left p-4 rounded-lg border bg-card hover:bg-muted/40 transition"
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
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function RunDetail({ run, onBack, onAdvance, advancing, onReload }: { run: PathwayRun; onBack: () => void; onAdvance: (stage?: number) => void; advancing: boolean; onReload: () => void }) {
  const s1 = run.stageResults?.stage1;
  const s2 = run.stageResults?.stage2;
  const s4 = run.stageResults?.stage4;
  const s6 = run.stageResults?.stage6;
  const s7 = run.stageResults?.stage7;
  const nextStage = Math.min(run.currentStage, 7);

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <button onClick={onBack} className="text-xs text-muted-foreground hover:text-foreground mb-1">← All investigations</button>
          <h1 className="text-2xl font-semibold tracking-tight">{run.address}</h1>
          {run.postcode && <p className="text-sm text-muted-foreground">{run.postcode}</p>}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onReload}>Refresh</Button>
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
        <Card>
          <CardHeader className="pb-3 flex flex-row items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2"><Search className="w-4 h-4" /> Initial Search</CardTitle>
            {run.sharepointFolderUrl && (
              <a href={run.sharepointFolderUrl} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline inline-flex items-center gap-1">
                <FolderOpen className="w-3 h-3" /> Open SharePoint
              </a>
            )}
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {s1.summary && <p className="text-muted-foreground">{s1.summary}</p>}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <InfoBlock label="Emails" value={`${s1.emailHits?.length || 0}`} />
              <InfoBlock label="CRM matches" value={`${s1.crmHits?.properties?.length || 0}`} />
              <InfoBlock label="Owner" value={s1.initialOwnership?.proprietorName || "Not resolved"} />
              <InfoBlock label="Title" value={s1.initialOwnership?.titleNumber || "—"} />
            </div>
            {s1.emailHits && s1.emailHits.length > 0 && (
              <details className="text-xs">
                <summary className="cursor-pointer text-muted-foreground hover:text-foreground">View {s1.emailHits.length} emails</summary>
                <ul className="mt-2 space-y-1.5">
                  {s1.emailHits.slice(0, 15).map((h: any, i: number) => (
                    <li key={i} className="border-l-2 border-muted pl-2">
                      <p className="font-medium truncate">{h.subject}</p>
                      <p className="text-muted-foreground">{h.from} — {new Date(h.date).toLocaleDateString("en-GB")}</p>
                      <p className="text-muted-foreground line-clamp-2">{h.preview}</p>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </CardContent>
        </Card>
      )}

      {/* Stage 2 — Brand Intelligence */}
      {s2 && !s2.skipped && (
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
      )}

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
