import { useState, useEffect } from "react";
import { useLocation, Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getAuthHeaders } from "@/lib/queryClient";
import {
  Building2, FolderOpen, MapPin, ShieldCheck, Sparkles,
  FileText, Image as ImageIcon, ChevronRight, ChevronDown, ArrowRight,
  Check, Clock, AlertCircle, Plus, Search, Download, ExternalLink, Trash2,
  Copy, Paperclip, Loader2, Maximize2, Briefcase, FileSpreadsheet, MessageSquare,
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
  { n: 6, label: "Business Plan", icon: Briefcase },
  { n: 7, label: "Model Studio", icon: FileSpreadsheet },
  { n: 8, label: "Studio Time", icon: ImageIcon },
  { n: 9, label: "Why Buy", icon: FileText },
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

  // Keep the run list fresh while any run has a stage in "running" state —
  // lets the list page show live progress for background runs.
  useEffect(() => {
    const anyRunning = runs.some((r: any) =>
      Object.values(r.stageStatus || {}).some((s) => s === "running"),
    );
    if (!anyRunning) return;
    const id = setInterval(() => loadRuns(), 8000);
    return () => clearInterval(id);
  }, [runs]);

  // Auto-poll whenever the selected run has a stage in "running" state — the
  // server keeps running stages in the background even if the user navigates
  // away, so on re-entry (or a refresh) we pick up progress without needing
  // the user to manually re-click the advance button.
  useEffect(() => {
    if (!selectedRun?.id) return;
    const anyRunning = Object.values((selectedRun as any).stageStatus || {}).some(
      (s) => s === "running",
    );
    if (!anyRunning) return;
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      try {
        const res = await fetch(`/api/property-pathway/${selectedRun.id}`, {
          headers: getAuthHeaders(),
          credentials: "include",
        });
        if (res.ok) {
          const polled = await res.json();
          if (!cancelled) setSelectedRun(polled);
        }
      } catch {}
      if (!cancelled) {
        const stillRunning = Object.values((selectedRun as any).stageStatus || {}).some(
          (s) => s === "running",
        );
        if (stillRunning) loadRuns();
      }
    };
    const id = setInterval(tick, 4000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [selectedRun?.id, JSON.stringify((selectedRun as any)?.stageStatus || {})]);

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
        // Always async: Railway's HTTP edge timeout is 45s; stages 2/4/6/7 can
        // take 2-3 minutes (Claude analysis + Companies House + Idox scrape +
        // accounts PDF). Server returns 202 immediately and the client polls.
        body: JSON.stringify({ ...(stage ? { stage } : {}), async: true }),
      });
      if (!res.ok) {
        let errMsg = "";
        let partialRun: any = null;
        try {
          const body = await res.json();
          errMsg = body.error || `HTTP ${res.status}`;
          partialRun = body.run || null;
        } catch {
          errMsg = await res.text().catch(() => `HTTP ${res.status}`);
        }
        if (partialRun) setSelectedRun(partialRun);
        throw new Error(errMsg.slice(0, 300));
      }

      const body = await res.json();

      // Async mode: stage is running in background, poll for completion
      if (body.async) {
        const targetStage = body.targetStage;
        const stageKey = `stage${targetStage}`;
        toast({ title: `Stage ${targetStage} running in background`, description: "This usually takes 30-90 seconds. Watching for completion..." });

        const pollStart = Date.now();
        const POLL_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
        let lastStatus: string | undefined;

        while (Date.now() - pollStart < POLL_TIMEOUT_MS) {
          await new Promise((r) => setTimeout(r, 3000));
          try {
            const pollRes = await fetch(`/api/property-pathway/${runId}`, { headers: getAuthHeaders(), credentials: "include" });
            if (!pollRes.ok) continue;
            const polled = await pollRes.json();
            setSelectedRun(polled);
            lastStatus = polled.stageStatus?.[stageKey];
            if (lastStatus === "completed" || lastStatus === "failed" || lastStatus === "skipped") {
              break;
            }
          } catch {}
        }

        loadRuns();
        const finalResults = (selectedRun as any)?.stageResults?.[stageKey] || {};
        if (lastStatus === "skipped") {
          toast({ title: `Stage ${targetStage} skipped`, description: finalResults?.reason || "Stage was skipped — see board for details." });
        } else if (lastStatus === "failed") {
          toast({ title: `Stage ${targetStage} failed`, description: finalResults?.reason || finalResults?.summary || "See server logs.", variant: "destructive" });
        } else if (lastStatus === "completed") {
          toast({ title: `Stage ${targetStage} complete`, description: finalResults?.summary ? String(finalResults.summary).slice(0, 200) : "Findings added to board." });
        } else {
          toast({ title: "Still running", description: "Stage is taking longer than usual. Check the board in a minute.", variant: "destructive" });
        }
        return;
      }

      const { run } = body;
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
  const s6 = run.stageResults?.stage6;   // Business Plan
  const s7 = run.stageResults?.stage7;   // Excel Model
  const s8 = run.stageResults?.stage8;   // Studio Time
  const s9 = run.stageResults?.stage9;   // Why Buy
  const mi = run.stageResults?.marketIntel;
  const s2Status = run.stageStatus?.stage2;
  const nextStage = Math.min(run.currentStage, 9);
  const [tenantInput, setTenantInput] = useState("");
  const [openEmail, setOpenEmail] = useState<{ msgId: string; mailboxEmail: string } | null>(null);

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <button onClick={onBack} className="text-xs text-muted-foreground hover:text-foreground mb-1">← All investigations</button>
          <h1 className="text-2xl font-semibold tracking-tight">{run.address}</h1>
          {run.postcode && <p className="text-sm text-muted-foreground">{run.postcode}</p>}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => onAdvance(1)} disabled={advancing} title="Re-scan for new emails, attachments, SharePoint items, and regenerate the briefing">
            {advancing ? <Clock className="w-4 h-4 mr-1 animate-spin" /> : <Search className="w-4 h-4 mr-1" />}
            Refresh
          </Button>
          <Button variant="ghost" size="sm" onClick={onDelete} className="text-muted-foreground hover:text-destructive" title="Delete investigation">
            <Trash2 className="w-4 h-4" />
          </Button>
          <Button onClick={() => onAdvance(nextStage)} disabled={advancing || run.currentStage > 9} className="gap-1.5">
            {advancing ? <Clock className="w-4 h-4" /> : <ArrowRight className="w-4 h-4" />}
            {(() => {
              switch (nextStage) {
                case 1: return "Run Initial Search";
                case 2: return "Run Brand Intelligence";
                case 3: return "Review & Confirm";
                case 4: return "Purchase Property Intelligence";
                case 5: return "Build Investigation Board";
                case 6: return "Draft Business Plan";
                case 7: return "Generate Model Studio";
                case 8: return "Run Studio Time";
                case 9: return "Generate Why Buy";
                default: return `Run Stage ${nextStage}`;
              }
            })()}
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
          {/* Side-by-side: Initial Search summary (left) + Analyst briefing (right) */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <Card>
              <CardHeader className="pb-2 flex flex-row items-center justify-between">
                <CardTitle className="text-sm flex items-center gap-2"><Search className="w-4 h-4" /> Initial Search</CardTitle>
                <div className="flex items-center gap-2">
                  {s1.propertyImage?.googleMapsUrl && (
                    <a href={s1.propertyImage.googleMapsUrl} target="_blank" rel="noreferrer" className="text-[11px] text-primary hover:underline inline-flex items-center gap-1">
                      <MapPin className="w-3 h-3" /> Maps
                    </a>
                  )}
                  {run.sharepointFolderUrl && (
                    <a href={run.sharepointFolderUrl} target="_blank" rel="noreferrer" className="text-[11px] text-primary hover:underline inline-flex items-center gap-1">
                      <FolderOpen className="w-3 h-3" /> SharePoint
                    </a>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-2 text-sm pb-3">
                {/* Building image + address */}
                <div className="flex gap-2.5">
                  {s1.propertyImage?.streetViewUrl && (
                    <a href={s1.propertyImage.googleMapsUrl || "#"} target="_blank" rel="noreferrer" className="shrink-0 block hover:opacity-90 transition-opacity">
                      <img
                        src={s1.propertyImage.streetViewUrl}
                        alt={`Street view of ${run.address}`}
                        className="w-28 h-20 rounded object-cover border"
                        onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                      />
                    </a>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm break-words">{run.address}{run.postcode ? `, ${run.postcode}` : ""}</p>
                    <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                      {s1.aiFacts?.listedStatus && s1.aiFacts.listedStatus.length <= 40 && <Badge variant="outline" className="text-[9px] py-0 max-w-full truncate">{s1.aiFacts.listedStatus}</Badge>}
                      {s1.aiFacts?.sizeSqft && s1.aiFacts.sizeSqft.length <= 40 && <Badge variant="outline" className="text-[9px] py-0 max-w-full truncate">{s1.aiFacts.sizeSqft} sq ft</Badge>}
                    </div>
                    {s1.aiFacts?.currentUse && <p className="text-[11px] text-muted-foreground mt-0.5 break-words line-clamp-2">{s1.aiFacts.currentUse}</p>}
                  </div>
                </div>

                {/* Ownership — clickable links */}
                {(() => {
                  // Stage 1's autonomous AI sometimes stuffs a full paragraph into
                  // proprietorName/titleNumber ("Gainesville Partnership LLP (title
                  // NGL939200); previously Amsprop Estates Ltd..."). Pull the bare
                  // company name / title ref out for the link; render the rest as
                  // a separate commentary line so it stays visible but doesn't
                  // break CH search or the Land Registry deep-link.
                  const cleanName = (raw?: string | null): string => {
                    if (!raw) return "";
                    let s = String(raw).trim();
                    s = s.split(/\s*[;—]\s*|\s*\.\s+(?=[A-Z])|\n/)[0];
                    s = s.replace(/\s*\([^)]*\)\s*$/g, "").trim();
                    s = s.replace(/[.\s)]+$/, "").trim();
                    if (s.length > 120) s = s.slice(0, 120).trim();
                    return s;
                  };
                  const cleanTitle = (raw?: string | null): string => {
                    if (!raw) return "";
                    const m = String(raw).match(/\b([A-Z]{1,3}\d{3,7})\b/);
                    return m ? m[1] : String(raw).trim().split(/[\s(,;]/)[0];
                  };
                  // Same defensive parse for Companies House numbers — the
                  // investigator sometimes jams multiple proprietors into
                  // one field ("OC407278 (X); 01690503 (Y)"), which broke
                  // the CH deep link. Take the first valid CH number.
                  const cleanCoNumber = (raw?: string | null): string => {
                    if (!raw) return "";
                    const m = String(raw).match(/\b([A-Z]{0,3}\d{6,8})\b/);
                    return m ? m[1] : "";
                  };

                  const rawOwnerName = s1.initialOwnership?.proprietorName || s1.aiFacts?.owner;
                  const rawTitleNum = s1.initialOwnership?.titleNumber;
                  const ownerName = cleanName(rawOwnerName);
                  const ownerCommentary = rawOwnerName && rawOwnerName !== ownerName ? String(rawOwnerName).trim() : null;
                  const titleNum = cleanTitle(rawTitleNum);
                  const titleCommentary = rawTitleNum && rawTitleNum !== titleNum ? String(rawTitleNum).trim() : null;

                  const paid = s1.initialOwnership?.pricePaid ? `£${(s1.initialOwnership.pricePaid / 1e6).toFixed(1)}m` : s1.aiFacts?.purchasePrice;
                  const date = s1.initialOwnership?.dateOfPurchase || s1.aiFacts?.purchaseDate;
                  const ownerCompanyId = s1.initialOwnership?.proprietorCompanyId;
                  const rawOwnerCoNumber = s1.initialOwnership?.proprietorCompanyNumber || s1.aiFacts?.ownerCompanyNumber;
                  const ownerCoNumber = cleanCoNumber(rawOwnerCoNumber);
                  const ownerCoCommentary = rawOwnerCoNumber && rawOwnerCoNumber !== ownerCoNumber ? String(rawOwnerCoNumber).trim() : null;

                  if (!ownerName && !titleNum && !paid && !date) {
                    return <p className="text-[11px] text-muted-foreground">Owner not resolved. Advance to Stage 4 for deeper lookups.</p>;
                  }

                  // Owner link logic: CRM company wins, else Companies House, else plain text
                  let ownerEl: any = ownerName || "—";
                  if (ownerName && ownerCompanyId) {
                    ownerEl = <Link href={`/companies/${ownerCompanyId}`}><span className="text-primary hover:underline cursor-pointer font-medium">{ownerName}</span></Link>;
                  } else if (ownerName && ownerCoNumber) {
                    ownerEl = <a href={`https://find-and-update.company-information.service.gov.uk/company/${ownerCoNumber}`} target="_blank" rel="noreferrer" className="text-primary hover:underline font-medium inline-flex items-center gap-0.5">{ownerName}<ExternalLink className="w-2.5 h-2.5" /></a>;
                  } else if (ownerName) {
                    ownerEl = <a href={`https://find-and-update.company-information.service.gov.uk/search/companies?q=${encodeURIComponent(ownerName)}`} target="_blank" rel="noreferrer" className="text-primary hover:underline font-medium inline-flex items-center gap-0.5">{ownerName}<ExternalLink className="w-2.5 h-2.5" /></a>;
                  }

                  // Title link — to our Land Registry tab pre-filtered by postcode
                  let titleEl: any = titleNum || "—";
                  if (titleNum && run.postcode) {
                    titleEl = <Link href={`/property-intelligence?tab=land-registry&postcode=${encodeURIComponent(run.postcode)}`}><span className="text-primary hover:underline cursor-pointer font-medium">{titleNum}</span></Link>;
                  } else if (titleNum) {
                    titleEl = <span className="font-medium">{titleNum}</span>;
                  }

                  return (
                    <div className="border rounded p-2 bg-muted/20">
                      <p className="text-[9px] uppercase tracking-wide text-muted-foreground mb-1">Ownership</p>
                      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                        <div className="col-span-2 min-w-0"><span className="text-muted-foreground">Owner:</span> {ownerEl}{ownerCoNumber ? <span className="text-muted-foreground text-[10px] ml-0.5">(Co# {ownerCoNumber})</span> : null}</div>
                        {ownerCommentary && <div className="col-span-2 min-w-0 text-[10px] text-muted-foreground break-words leading-snug">{ownerCommentary}</div>}
                        {ownerCoCommentary && <div className="col-span-2 min-w-0 text-[10px] text-muted-foreground break-words leading-snug">Other proprietors noted: {ownerCoCommentary}</div>}
                        <div className="col-span-2 min-w-0"><span className="text-muted-foreground">Title:</span> <span className="break-words">{titleEl}</span></div>
                        {titleCommentary && <div className="col-span-2 min-w-0 text-[10px] text-muted-foreground break-words leading-snug">{titleCommentary}</div>}
                        <div className="min-w-0"><span className="text-muted-foreground">Paid:</span> <span className="font-medium break-words">{paid || "—"}</span></div>
                        <div className="min-w-0"><span className="text-muted-foreground">Date:</span> <span className="font-medium">{date || "—"}</span></div>
                        {s1.aiFacts?.refurbCost && <div className="col-span-2 min-w-0"><span className="text-muted-foreground">Refurb spend:</span> <span className="font-medium break-words">{s1.aiFacts.refurbCost}</span></div>}
                      </div>
                    </div>
                  );
                })()}

                {/* Lease terms — structured table */}
                {(() => {
                  const tenant = s1.tenant;
                  const hasLeaseData = tenant || s1.aiFacts?.leaseStatus || (s1.aiFacts?.mainTenants && s1.aiFacts.mainTenants.length > 0);
                  if (!hasLeaseData) return null;

                  const cleanName = (raw?: string | null): string => {
                    if (!raw) return "";
                    let s = String(raw).trim();
                    s = s.split(/\s*[;—]\s*|\s*\.\s+(?=[A-Z])|\n/)[0];
                    s = s.replace(/\s*\([^)]*\)\s*$/g, "").trim();
                    s = s.replace(/[.\s)]+$/, "").trim();
                    if (s.length > 120) s = s.slice(0, 120).trim();
                    return s;
                  };
                  const rawTenantName = tenant?.name || (s1.aiFacts?.mainTenants?.[0]) || "";
                  const tenantName = cleanName(rawTenantName);
                  const tenantCommentary = rawTenantName && rawTenantName !== tenantName ? String(rawTenantName).trim() : null;

                  // Tenant link logic
                  let tenantEl: any = tenantName || "—";
                  if (tenantName && tenant?.companyId) {
                    tenantEl = <Link href={`/companies/${tenant.companyId}`}><span className="text-primary hover:underline cursor-pointer font-medium">{tenantName}</span></Link>;
                  } else if (tenantName && tenant?.companyNumber) {
                    tenantEl = <a href={`https://find-and-update.company-information.service.gov.uk/company/${tenant.companyNumber}`} target="_blank" rel="noreferrer" className="text-primary hover:underline font-medium inline-flex items-center gap-0.5">{tenantName}<ExternalLink className="w-2.5 h-2.5" /></a>;
                  } else if (tenantName) {
                    tenantEl = <a href={`https://find-and-update.company-information.service.gov.uk/search/companies?q=${encodeURIComponent(tenantName)}`} target="_blank" rel="noreferrer" className="text-primary hover:underline font-medium inline-flex items-center gap-0.5">{tenantName}<ExternalLink className="w-2.5 h-2.5" /></a>;
                  }

                  return (
                    <div className="border rounded p-2 bg-muted/20">
                      <p className="text-[9px] uppercase tracking-wide text-muted-foreground mb-1">Tenancy</p>
                      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                        <div className="min-w-0"><span className="text-muted-foreground">Tenant:</span> {tenantEl}</div>
                        {tenant?.companyNumber && <div className="min-w-0"><span className="text-muted-foreground">Co#:</span> <span className="font-medium">{tenant.companyNumber}</span></div>}
                        {s1.aiFacts?.passingRent && <div className="col-span-2 min-w-0"><span className="text-muted-foreground">Rent passing:</span> <span className="font-medium break-words">{s1.aiFacts.passingRent}</span></div>}
                        {tenantCommentary && <div className="col-span-2 min-w-0 text-[10px] text-muted-foreground break-words leading-snug">{tenantCommentary}</div>}
                        {s1.aiFacts?.leaseStatus && <div className="col-span-2 min-w-0"><span className="text-muted-foreground">Status:</span> <span className="font-medium break-words">{s1.aiFacts.leaseStatus}</span></div>}
                        {s1.aiFacts?.mainTenants && s1.aiFacts.mainTenants.length > 1 && (
                          <div className="col-span-2 min-w-0"><span className="text-muted-foreground">Other occupiers:</span> <span className="font-medium break-words">{s1.aiFacts.mainTenants.slice(1).join(", ")}</span></div>
                        )}
                      </div>
                    </div>
                  );
                })()}

                {/* Rates headline */}
                <div className="border rounded p-2 bg-muted/20">
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-[9px] uppercase tracking-wide text-muted-foreground">Business Rates (VOA)</p>
                    {run.postcode && (
                      <a href={`https://www.tax.service.gov.uk/business-rates-find/search?postcode=${encodeURIComponent(run.postcode)}`} target="_blank" rel="noreferrer" className="text-[10px] text-primary hover:underline inline-flex items-center gap-0.5">
                        gov.uk <ExternalLink className="w-2.5 h-2.5" />
                      </a>
                    )}
                  </div>
                  {s1.rates && s1.rates.assessmentCount && s1.rates.assessmentCount > 0 ? (
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                      <div><span className="text-muted-foreground">Total RV:</span> <span className="font-medium">{s1.rates.totalRateableValue ? `£${s1.rates.totalRateableValue.toLocaleString()}` : "—"}</span></div>
                      <div><span className="text-muted-foreground">Assessments:</span> <span className="font-medium">{s1.rates.assessmentCount}</span></div>
                    </div>
                  ) : (
                    <p className="text-[10px] text-muted-foreground">No VOA data indexed for this postcode. Check directly on gov.uk, or ask an admin to run the VOA import for this billing authority.</p>
                  )}
                </div>

                {/* Area valuation (PropertyData) */}
                {s1.valuation && (s1.valuation.marketRentPerSqft != null || s1.valuation.estimatedErvAnnual != null || s1.valuation.estimatedCapitalValue != null || s1.valuation.estimatedErvPerSqft != null || s1.valuation.estimatedCapValuePerSqft != null) && (
                  <div className="border rounded p-2 bg-muted/20">
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-[9px] uppercase tracking-wide text-muted-foreground">Area Valuation (PropertyData{s1.valuation.propertyType ? ` · ${s1.valuation.propertyType}` : ""})</p>
                    </div>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                      {s1.valuation.marketRentPerSqft != null && (
                        <div className="col-span-2 min-w-0">
                          <span className="text-muted-foreground">Market rent:</span>{" "}
                          <span className="font-medium">£{Number(s1.valuation.marketRentPerSqft).toLocaleString()}/sq ft</span>
                          {s1.valuation.marketRentMinPerSqft != null && s1.valuation.marketRentMaxPerSqft != null && (
                            <span className="text-muted-foreground"> (range £{Number(s1.valuation.marketRentMinPerSqft).toLocaleString()}–£{Number(s1.valuation.marketRentMaxPerSqft).toLocaleString()})</span>
                          )}
                        </div>
                      )}
                      {s1.valuation.estimatedErvAnnual != null && (
                        <div className="min-w-0">
                          <span className="text-muted-foreground">Est ERV:</span>{" "}
                          <span className="font-medium">£{Number(s1.valuation.estimatedErvAnnual).toLocaleString()} pa</span>
                        </div>
                      )}
                      {s1.valuation.estimatedErvPerSqft != null && (
                        <div className="min-w-0">
                          <span className="text-muted-foreground">Est ERV/sqft:</span>{" "}
                          <span className="font-medium">£{Number(s1.valuation.estimatedErvPerSqft).toLocaleString()}</span>
                        </div>
                      )}
                      {s1.valuation.estimatedCapitalValue != null && (
                        <div className="min-w-0">
                          <span className="text-muted-foreground">Est capital value:</span>{" "}
                          <span className="font-medium">£{Number(s1.valuation.estimatedCapitalValue).toLocaleString()}</span>
                        </div>
                      )}
                      {s1.valuation.estimatedCapValuePerSqft != null && (
                        <div className="min-w-0">
                          <span className="text-muted-foreground">£/sqft capital:</span>{" "}
                          <span className="font-medium">£{Number(s1.valuation.estimatedCapValuePerSqft).toLocaleString()}</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

              </CardContent>
            </Card>

            {/* AI briefing synthesising everything we found */}
            {s1.aiBriefing && (
              <Card className="border-primary/40 bg-primary/5">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2"><Sparkles className="w-4 h-4" /> Analyst briefing</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm pb-3">
                  {s1.aiBriefing.headline && (
                    <p className="text-sm font-medium leading-snug">{s1.aiBriefing.headline}</p>
                  )}
                  {s1.aiBriefing.bullets?.length > 0 && (
                    <ul className="space-y-1 text-[12px] text-muted-foreground">
                      {s1.aiBriefing.bullets.map((b: string, i: number) => (
                        <li key={i} className="flex gap-1.5">
                          <span className="text-primary shrink-0">·</span>
                          <span>{b}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {s1.aiBriefing.keyQuestions?.length > 0 && (
                    <div className="pt-1.5 border-t border-primary/20">
                      <p className="text-[9px] uppercase tracking-wide text-muted-foreground mb-1">Next questions</p>
                      <ul className="space-y-0.5 text-[11px]">
                        {s1.aiBriefing.keyQuestions.map((q: string, i: number) => (
                          <li key={i} className="flex gap-1.5">
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
          </div>

          {/* Dense sub-cards in 4-col grid on wide screens.
              Row 1 order: SharePoint, Brochures, CRM, Comps (as requested).
              Row 2: Deals, Street sales, Units, Engagements. */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3">
            {/* SharePoint */}
            {s1.sharepointHits && s1.sharepointHits.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2"><FolderOpen className="w-4 h-4" /> SharePoint ({s1.sharepointHits.length})</CardTitle>
                </CardHeader>
                <CardContent className="text-[11px] space-y-0.5 max-h-56 overflow-y-auto pb-2">
                  {s1.sharepointHits.slice(0, 15).map((f: any, i: number) => (
                    <div key={i} className="flex items-center gap-1 py-0.5 border-b last:border-b-0">
                      {f.webUrl ? (
                        <a href={f.webUrl} target="_blank" rel="noreferrer" className="min-w-0 flex-1 flex items-center gap-1 cursor-pointer group">
                          <span className="text-primary group-hover:underline truncate">{f.name}</span>
                          <ExternalLink className="w-2.5 h-2.5 text-muted-foreground shrink-0" />
                        </a>
                      ) : (
                        <span className="min-w-0 flex-1 truncate">{f.name}</span>
                      )}
                      {f.type === "folder" && <Badge variant="outline" className="text-[8px] py-0 px-1 shrink-0">f</Badge>}
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            {/* Brochures — always show card so users know the pathway looked */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2"><FileText className="w-4 h-4" /> Brochures ({s1.brochureFiles?.length || 0})</CardTitle>
              </CardHeader>
              <CardContent className="text-[11px] space-y-0.5 max-h-56 overflow-y-auto pb-2">
                {s1.brochureFiles && s1.brochureFiles.length > 0 ? (
                  s1.brochureFiles.map((b: any, i: number) => (
                    <div key={i} className="flex items-center gap-1 py-0.5 border-b last:border-b-0">
                      {b.webUrl ? (
                        <a href={b.webUrl} target="_blank" rel="noreferrer" className="min-w-0 flex-1 flex items-center gap-1 cursor-pointer group">
                          <span className="text-primary group-hover:underline truncate">{b.name}</span>
                          <ExternalLink className="w-2.5 h-2.5 text-muted-foreground shrink-0" />
                        </a>
                      ) : (
                        <span className="min-w-0 flex-1 truncate">{b.name}</span>
                      )}
                      {b.sizeMB && <span className="text-muted-foreground text-[10px] shrink-0">{b.sizeMB}M</span>}
                    </div>
                  ))
                ) : (
                  <p className="text-muted-foreground text-[11px] py-1 truncate">None found — check 📎 emails.</p>
                )}
              </CardContent>
            </Card>

            {/* CRM properties */}
            {s1.crmHits?.properties && s1.crmHits.properties.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2"><Building2 className="w-4 h-4" /> CRM ({s1.crmHits.properties.length})</CardTitle>
                </CardHeader>
                <CardContent className="text-[11px] space-y-0.5 pb-2">
                  {s1.crmHits.properties.map((p: any) => (
                    <Link key={p.id} href={`/properties/${p.id}`}>
                      <div className="flex items-center gap-1 py-0.5 border-b last:border-b-0 hover:bg-muted/50 cursor-pointer">
                        <span className="text-primary truncate flex-1">{p.name}</span>
                        <ChevronRight className="w-3 h-3 text-muted-foreground shrink-0" />
                      </div>
                    </Link>
                  ))}
                </CardContent>
              </Card>
            )}

            {/* Comps — investment (sales) + retail letting from CRM + fresh lease crawl */}
            {(() => {
              const investmentComps = (s1.comps || []).filter((c: any) => c.kind === "investment" || (!c.kind && (c.price || c.yield)));
              const lettingComps = (s1.comps || []).filter((c: any) => c.kind === "letting");
              const crawledLeaseComps = mi?.comparables || [];
              const total = investmentComps.length + lettingComps.length + crawledLeaseComps.length;
              return (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Building2 className="w-4 h-4" /> Comps ({total})
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="text-[11px] space-y-0.5 max-h-56 overflow-y-auto pb-2">
                    {investmentComps.length > 0 && (
                      <>
                        <p className="text-[9px] uppercase tracking-wide text-muted-foreground pt-0.5">Investment / sales ({investmentComps.length})</p>
                        {investmentComps.slice(0, 10).map((c: any, i: number) => (
                          <div key={`inv-${i}`} className="flex items-center gap-1 py-0.5 border-b last:border-b-0">
                            <span className="truncate flex-1">{c.address}</span>
                            <span className="text-muted-foreground text-[10px] shrink-0">{c.price ? `£${(c.price / 1e6).toFixed(1)}m` : "—"}{c.yield ? ` ${(c.yield * 100).toFixed(1)}%` : ""}</span>
                          </div>
                        ))}
                      </>
                    )}
                    {lettingComps.length > 0 && (
                      <>
                        <p className="text-[9px] uppercase tracking-wide text-muted-foreground pt-1">Retail letting — CRM ({lettingComps.length})</p>
                        {lettingComps.slice(0, 10).map((c: any, i: number) => (
                          <div key={`crm-let-${i}`} className="flex items-center gap-1 py-0.5 border-b last:border-b-0">
                            <span className="truncate flex-1">
                              {c.tenant || "—"}
                              {c.address ? <span className="text-muted-foreground"> · {c.address}</span> : null}
                            </span>
                            <span className="text-muted-foreground text-[10px] shrink-0">
                              {c.rent || ""}{c.area ? ` · ${c.area}` : ""}
                            </span>
                          </div>
                        ))}
                      </>
                    )}
                    {crawledLeaseComps.length > 0 && (
                      <>
                        <p className="text-[9px] uppercase tracking-wide text-muted-foreground pt-1">Lease — market intel ({crawledLeaseComps.length})</p>
                        {crawledLeaseComps.slice(0, 10).map((c: any, i: number) => (
                          <div key={`lease-${i}`} className="flex items-center gap-1 py-0.5 border-b last:border-b-0">
                            <span className="truncate flex-1">
                              {c.address || c.tenant || "—"}
                              {c.tenant && c.address ? <span className="text-muted-foreground"> · {c.tenant}</span> : null}
                            </span>
                            <span className="text-muted-foreground text-[10px] shrink-0">
                              {c.rent || ""}{c.area ? ` · ${c.area}` : ""}
                            </span>
                          </div>
                        ))}
                      </>
                    )}
                    {total === 0 && (
                      <p className="text-muted-foreground text-[11px] py-1">No investment or letting comparables found yet — market intel crawl may still be running.</p>
                    )}
                  </CardContent>
                </Card>
              );
            })()}

            {/* Business rates entries */}
            {s1.rates && s1.rates.entries && s1.rates.entries.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <span>Rates ({s1.rates.entries.length})</span>
                    {run.postcode && (
                      <a href={`https://www.tax.service.gov.uk/business-rates-find/search?postcode=${encodeURIComponent(run.postcode)}`} target="_blank" rel="noreferrer" className="ml-auto text-[10px] text-primary hover:underline inline-flex items-center gap-0.5 font-normal">
                        gov.uk <ExternalLink className="w-2.5 h-2.5" />
                      </a>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-[11px] space-y-0.5 max-h-56 overflow-y-auto pb-2">
                  {s1.rates.entries.slice(0, 30).map((r: any, i: number) => {
                    const voaUrl = r.uarn
                      ? `https://www.tax.service.gov.uk/business-rates-find/valuations/${encodeURIComponent(r.uarn)}`
                      : (run.postcode ? `https://www.tax.service.gov.uk/business-rates-find/search?postcode=${encodeURIComponent(run.postcode)}` : null);
                    const Body = (
                      <>
                        <div className="min-w-0 flex-1">
                          <span className="truncate block">{r.firmName || r.address || "—"}</span>
                          {r.description && <span className="text-muted-foreground text-[10px]">{r.description}</span>}
                        </div>
                        <span className="text-muted-foreground text-[10px] shrink-0 text-right">
                          {r.rateableValue != null ? `£${Number(r.rateableValue).toLocaleString()}` : "—"}
                        </span>
                        {voaUrl && <ExternalLink className="w-2.5 h-2.5 shrink-0 text-muted-foreground" />}
                      </>
                    );
                    return voaUrl ? (
                      <a key={i} href={voaUrl} target="_blank" rel="noreferrer" className="flex items-start gap-1 py-0.5 border-b last:border-b-0 hover:bg-muted/50 cursor-pointer">
                        {Body}
                      </a>
                    ) : (
                      <div key={i} className="flex items-start gap-1 py-0.5 border-b last:border-b-0">
                        {Body}
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            )}

            {/* Deals */}
            {s1.deals && s1.deals.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2"><Building2 className="w-4 h-4" /> Deals ({s1.deals.length})</CardTitle>
                </CardHeader>
                <CardContent className="text-[11px] space-y-0.5 pb-2">
                  {s1.deals.slice(0, 10).map((d: any) => (
                    <Link key={d.id} href={`/deals/${d.id}`}>
                      <div className="flex items-center gap-1 py-0.5 border-b last:border-b-0 hover:bg-muted/50 cursor-pointer">
                        <span className="text-primary truncate flex-1">{d.name}</span>
                        <span className="text-muted-foreground text-[10px] shrink-0">{d.stage || d.status || ""}</span>
                      </div>
                    </Link>
                  ))}
                </CardContent>
              </Card>
            )}

            {/* Past transactions */}
            {s1.pricePaidHistory && s1.pricePaidHistory.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2"><Download className="w-4 h-4" /> Street sales ({s1.pricePaidHistory.length})</CardTitle>
                </CardHeader>
                <CardContent className="text-[11px] space-y-0.5 pb-2">
                  {s1.pricePaidHistory.slice(0, 10).map((t: any, i: number) => (
                    <div key={i} className="flex items-center gap-1 py-0.5 border-b last:border-b-0">
                      <span className="truncate flex-1">{t.address}</span>
                      <span className="text-muted-foreground text-[10px] shrink-0">{t.price ? `£${(t.price / 1000).toFixed(0)}k` : "—"}</span>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            {/* PropertyData market tone — retail/office quoting rents, resi
                rent + sold psf. Aggregate figures, not individual comps. */}
            {s1.pdMarket && <PropertyDataMarketCard tone={s1.pdMarket} />}

            {/* Retail leasing comps — Claude-extracted from emails, curated
                store (separate from CRM). Keyed by postcode / outward code. */}
            {s1.retailComps && s1.retailComps.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Building2 className="w-4 h-4" /> Retail leasing comps ({s1.retailComps.length})
                    <Badge variant="outline" className="text-[10px] py-0">from emails</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-[11px] space-y-0.5 pb-2">
                  {s1.retailComps.slice(0, 10).map((c: any) => (
                    <div key={c.id} className="flex items-center gap-1 py-0.5 border-b last:border-b-0">
                      <span className="truncate flex-1">
                        {c.address}
                        {c.tenant ? <span className="text-muted-foreground"> · {c.tenant}</span> : null}
                      </span>
                      <span className="text-muted-foreground text-[10px] shrink-0">
                        {c.areaSqft ? `${Math.round(c.areaSqft).toLocaleString()} sf` : ""}
                        {c.rentPsf ? ` · £${Math.round(c.rentPsf)}/sf` : c.rentPa ? ` · £${Math.round(c.rentPa / 1000)}k pa` : ""}
                        {c.leaseDate ? ` · ${String(c.leaseDate).slice(0, 7)}` : ""}
                      </span>
                    </div>
                  ))}
                  {s1.retailComps.length > 10 && (
                    <div className="text-[10px] text-muted-foreground pt-1">+ {s1.retailComps.length - 10} more</div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Tenancy units */}
            {s1.tenancy?.units && s1.tenancy.units.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2"><MapPin className="w-4 h-4" /> Units ({s1.tenancy.units.length}) <Badge variant="outline" className="text-[10px] py-0">{s1.tenancy.status}</Badge></CardTitle>
                </CardHeader>
                <CardContent className="text-[11px] space-y-0.5 pb-2">
                  {s1.tenancy.units.slice(0, 10).map((u: any) => (
                    <div key={u.id} className="flex items-center gap-1 py-0.5 border-b last:border-b-0">
                      <span className="truncate flex-1">{u.unitName}{u.floor ? ` · ${u.floor}` : ""}</span>
                      {u.sqft && <span className="text-muted-foreground text-[10px] shrink-0">{Math.round(u.sqft / 1000)}k sf</span>}
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            {/* Engagements */}
            {s1.engagements && s1.engagements.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2"><ShieldCheck className="w-4 h-4" /> Engaged ({s1.engagements.length})</CardTitle>
                </CardHeader>
                <CardContent className="text-[11px] space-y-0.5 pb-2">
                  {s1.engagements.slice(0, 10).map((e: any, i: number) => (
                    <div key={i} className="flex items-center gap-1 py-0.5 border-b last:border-b-0">
                      <span className="truncate flex-1">{e.contact || e.company || "Unknown"}</span>
                      {e.outcome && <Badge variant="outline" className="text-[8px] py-0 px-1 shrink-0">{e.outcome}</Badge>}
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

          </div>

          {/* Emails — full list at bottom, scrollable so all hits fit.
              Click opens in-app viewer (dialog) so users can read the email
              and download attachments without being bounced to Outlook Web. */}
          {s1.emailHits && s1.emailHits.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2"><Search className="w-4 h-4" /> Emails ({s1.emailHits.length})</CardTitle>
              </CardHeader>
              <CardContent className="text-[11px] grid grid-cols-1 md:grid-cols-2 gap-x-3 gap-y-1 pb-2 max-h-[250px] overflow-y-auto">
                {s1.emailHits.map((h: any, i: number) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => h.mailboxEmail ? setOpenEmail({ msgId: h.msgId, mailboxEmail: h.mailboxEmail }) : null}
                    disabled={!h.mailboxEmail}
                    className="text-left border-l-2 border-muted hover:border-primary pl-1.5 py-0.5 hover:bg-muted/50 rounded-r cursor-pointer disabled:cursor-default disabled:opacity-60"
                  >
                    <p className="font-medium truncate">{h.subject}{h.hasAttachments ? " 📎" : ""}</p>
                    <p className="text-muted-foreground text-[10px]">{h.from} — {new Date(h.date).toLocaleDateString("en-GB")}</p>
                  </button>
                ))}
              </CardContent>
            </Card>
          )}

          {/* In-app email viewer — opens on click, fetches full body + attachments */}
          {openEmail && (
            <EmailViewerDialog
              msgId={openEmail.msgId}
              mailboxEmail={openEmail.mailboxEmail}
              onClose={() => setOpenEmail(null)}
            />
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
          <CardHeader className="pb-3 flex flex-row items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Sparkles className="w-4 h-4" /> Brand Intelligence
              {s2.company?.name && <span className="text-muted-foreground font-normal text-sm">· {s2.company.name}</span>}
            </CardTitle>
            {s2.companyId && (
              <Link href={`/companies/${s2.companyId}`}>
                <Button variant="ghost" size="sm" className="text-xs gap-1">
                  Open company <ChevronRight className="w-3 h-3" />
                </Button>
              </Link>
            )}
          </CardHeader>
          <CardContent className="text-sm space-y-3">
            {/* Brand header — link to domain, tenant legal entity, industry */}
            <div className="flex flex-wrap items-center gap-2">
              {s2.company?.domain && (
                <a href={`https://${s2.company.domain.replace(/^https?:\/\//, "")}`} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline inline-flex items-center gap-1">
                  <ExternalLink className="w-3 h-3" /> {s2.company.domain}
                </a>
              )}
              {s2.company?.instagramHandle && (
                <a href={`https://instagram.com/${s2.company.instagramHandle}`} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline inline-flex items-center gap-1">
                  <ExternalLink className="w-3 h-3" /> @{s2.company.instagramHandle}
                </a>
              )}
              {s2.company?.companiesHouseNumber && (
                <a href={`https://find-and-update.company-information.service.gov.uk/company/${s2.company.companiesHouseNumber}`} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline inline-flex items-center gap-1">
                  <ExternalLink className="w-3 h-3" /> Co# {s2.company.companiesHouseNumber}
                </a>
              )}
            </div>

            {/* Tenant legal entity (from Stage 1) — if different from brand */}
            {s1?.tenant?.name && s2.company?.name && s1.tenant.name.toLowerCase() !== s2.company.name.toLowerCase() && (
              <div className="border rounded-lg p-3 bg-muted/20">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Tenant (leaseholder)</p>
                <p className="font-medium text-sm">{s1.tenant.name}{s1.tenant.companyNumber ? ` (Co# ${s1.tenant.companyNumber})` : ""}</p>
                <p className="text-xs text-muted-foreground mt-0.5">The legal entity on the lease — typically an SPV of the trading brand ({s2.company.name}).</p>
              </div>
            )}

            {/* Core facts */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {s2.company?.industry && <InfoBlock label="Industry" value={s2.company.industry} />}
              {s2.company?.storeCount != null && <InfoBlock label="UK Stores" value={String(s2.company.storeCount)} />}
              {s2.company?.rolloutStatus && <InfoBlock label="Rollout" value={s2.company.rolloutStatus} />}
              {s2.company?.backers && <InfoBlock label="Backers" value={s2.company.backers} />}
            </div>

            {/* Description + concept pitch */}
            {s2.company?.description && (
              <div>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Description</p>
                <p className="text-sm">{s2.company.description}</p>
              </div>
            )}
            {s2.company?.conceptPitch && (
              <div>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Concept Pitch</p>
                <p className="text-sm text-muted-foreground">{s2.company.conceptPitch}</p>
              </div>
            )}

            {/* Backers detail — structured list */}
            {s2.company?.backersDetail && s2.company.backersDetail.length > 0 && (
              <div>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5">Backers detail</p>
                <div className="space-y-1.5">
                  {s2.company.backersDetail.map((b: any, i: number) => (
                    <div key={i} className="border-l-2 border-primary/40 pl-2">
                      <p className="text-sm font-medium">
                        {b.name}
                        {b.type && <span className="text-xs text-muted-foreground ml-1.5">· {b.type}</span>}
                      </p>
                      {b.description && <p className="text-xs text-muted-foreground">{b.description}</p>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      {/* Stage 4 — Property Intelligence: virtual document board */}
      {s4 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Building2 className="w-4 h-4" /> Property Intelligence
              <span className="text-[10px] text-muted-foreground font-normal ml-2">Virtual — materialise to SharePoint at Investigation Board</span>
              <Button
                variant="outline"
                size="sm"
                className="ml-auto h-7 text-[11px]"
                onClick={() => onAdvance(4)}
                disabled={advancing}
                title="Re-run Stage 4 — re-resolves Companies House + planning + floor plans from Stage 1 data"
              >
                {advancing ? <Clock className="w-3 h-3 mr-1 animate-spin" /> : <Search className="w-3 h-3 mr-1" />}
                Re-run
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
              {/* 01 Ownership — InfoTrack placeholder slots */}
              <div className="border rounded p-2.5 bg-muted/10">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5">01 Ownership</p>
                <div className="space-y-1 text-[11px]">
                  {[
                    { label: "Title Register (OC1)", kind: "OC1" },
                    { label: "Title Plan (OC2)", kind: "OC2" },
                    { label: "Filed Leases", kind: "LEASES" },
                  ].map((slot) => (
                    <div key={slot.kind} className="flex items-center justify-between py-1 border-b last:border-b-0">
                      <span className="text-muted-foreground truncate">{slot.label}</span>
                      <button
                        type="button"
                        disabled
                        title="InfoTrack credentials required"
                        className="text-[10px] px-1.5 py-0.5 rounded border bg-muted/20 text-muted-foreground cursor-not-allowed"
                      >
                        Order
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* 02 Companies House KYC — summary only; full report lives in Clouseau */}
              <div className="border rounded p-2.5 bg-muted/10">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5">02 Companies House</p>
                {s4.companyKyc && s4.companyKyc.length > 0 ? (
                  <div className="space-y-2 text-[11px]">
                    {s4.companyKyc.map((c: any) => {
                      const riskColor =
                        c.riskLevel === "critical" ? "bg-red-600 text-white" :
                        c.riskLevel === "high" ? "bg-red-500 text-white" :
                        c.riskLevel === "medium" ? "bg-amber-500 text-white" :
                        c.riskLevel === "low" ? "bg-emerald-600 text-white" :
                        "bg-muted text-muted-foreground";
                      return (
                        <div key={c.companyNumber} className="border rounded p-1.5 bg-background">
                          <div className="flex items-center justify-between mb-1 gap-1">
                            <span className="font-medium truncate flex-1">{c.companyName}</span>
                            <span className="text-[9px] uppercase text-muted-foreground shrink-0">{c.role}</span>
                          </div>
                          {c.error ? (
                            <p className="text-[10px] text-destructive">{c.error}</p>
                          ) : (
                            <>
                              <div className="flex items-center gap-1 flex-wrap mb-1">
                                {c.riskLevel && (
                                  <span className={`text-[9px] px-1.5 py-0.5 rounded uppercase font-medium ${riskColor}`}>
                                    {c.riskLevel} {c.riskScore != null ? `(${c.riskScore})` : ""}
                                  </span>
                                )}
                                {c.sanctionsMatch && (
                                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-red-600 text-white uppercase font-medium">Sanctions</span>
                                )}
                                {c.pepMatch && (
                                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-purple-600 text-white uppercase font-medium" title="Politically-exposed person (ComplyAdvantage)">PEP</span>
                                )}
                                {c.adverseMediaMatch && (
                                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-orange-600 text-white uppercase font-medium" title="Adverse media hit (ComplyAdvantage)">Adverse media</span>
                                )}
                                {c.status && <span className="text-[9px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground uppercase">{c.status}</span>}
                                {c.reusedFromClouseau && (
                                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 uppercase font-medium" title="Reused from a recent Clouseau investigation (within 30 days)">Cached · Clouseau</span>
                                )}
                              </div>
                              <p className="text-[10px] text-muted-foreground">
                                {c.officerCount ?? 0} officers · {c.pscCount ?? 0} PSCs · {c.uboCount ?? 0} UBO chain · {c.filingCount ?? 0} filings
                              </p>
                              {c.flags && c.flags.length > 0 && (
                                <details className="mt-1">
                                  <summary className="cursor-pointer text-[10px] text-muted-foreground">{c.flags.length} risk flag{c.flags.length === 1 ? "" : "s"}</summary>
                                  <ul className="mt-1 space-y-0.5 text-[10px] pl-2">
                                    {c.flags.slice(0, 6).map((f: string, i: number) => (
                                      <li key={i} className="text-muted-foreground">• {f}</li>
                                    ))}
                                  </ul>
                                </details>
                              )}
                              {c.investigationId ? (
                                <a
                                  href={`/property-intelligence?tab=investigator&investigation=${c.investigationId}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="mt-1 inline-flex items-center gap-1 text-[10px] text-primary hover:underline"
                                >
                                  View full Clouseau report <ExternalLink className="w-2.5 h-2.5" />
                                </a>
                              ) : (
                                <p className="mt-1 text-[10px] text-muted-foreground italic">Saved to Clouseau history</p>
                              )}
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-[10px] text-muted-foreground">No proprietor/tenant company number resolved at Stage 1.</p>
                )}
              </div>

              {/* 03 Planning */}
              <PlanningCard apps={s4.planningApplications || []} />

              {/* 04 Planning Documents (floor plans, drawings, decision notices — scraped PDFs per application) */}
              <PlanningDocsCard
                apps={s4.planningApplications || []}
                planningDocs={s4.planningDocs || []}
                legacyUrls={s4.floorPlanUrls || []}
              />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Stage 6 — Business Plan */}
      {s6 && (
        <BusinessPlanCard runId={run.id} stage6={s6} onReload={onReload} />
      )}

      {/* Stage 7 — Model Studio (Excel) */}
      {s7 && (
        <ExcelModelCard runId={run.id} stage7={s7} stage6={s6} onReload={onReload} />
      )}

      {/* Stage 8 — Image Studio */}
      {s8 && (
        <ImageStudioCard runId={run.id} stage8={s8} onReload={onReload} />
      )}

      {/* Stage 9 — Why Buy */}
      {s9 && (
        <Card>
          <CardHeader className="pb-3 flex flex-row items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2"><FileText className="w-4 h-4" /> Why Buy</CardTitle>
            {(s9.sharepointUrl || s9.documentUrl) && (
              <a href={s9.sharepointUrl || s9.documentUrl} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline inline-flex items-center gap-1">
                <Download className="w-3 h-3" /> Open Why Buy PDF
              </a>
            )}
          </CardHeader>
          <CardContent className="text-sm">
            <p className="text-muted-foreground">4-page PE-style investment memo generated from the agreed business plan + agreed Excel model.</p>
          </CardContent>
        </Card>
      )}

    </div>
  );
}

function fmtMoney(n?: number): string {
  if (n === undefined || n === null || !Number.isFinite(Number(n))) return "—";
  const x = Number(n);
  if (Math.abs(x) >= 1_000_000) return `£${(x / 1_000_000).toFixed(x >= 10_000_000 ? 0 : 2)}m`;
  if (Math.abs(x) >= 1_000) return `£${Math.round(x / 1_000)}k`;
  return `£${x.toLocaleString()}`;
}

function fmtPct(n?: number, digits = 2): string {
  if (n === undefined || n === null || !Number.isFinite(Number(n))) return "—";
  const x = Number(n);
  const scaled = Math.abs(x) < 1 ? x * 100 : x;
  return `${scaled.toFixed(digits)}%`;
}

function BusinessPlanCard({ runId, stage6, onReload }: { runId: string; stage6: any; onReload: () => void }) {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [agreeing, setAgreeing] = useState(false);
  const agreed = stage6?.agreed;
  const plan = agreed || stage6?.draft || {};
  const summary: string = stage6?.summary || "";

  async function agree() {
    if (!confirm("Agree this business plan? It will lock the plan and unlock the Excel model stage.")) return;
    setAgreeing(true);
    try {
      const res = await fetch(`/api/property-pathway/${runId}/business-plan/agree`, {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
      });
      if (!res.ok) throw new Error(await res.text());
      toast({ title: "Business plan agreed", description: "Unlocked Stage 7 — Model Studio." });
      onReload();
    } catch (e: any) {
      toast({ title: "Couldn't agree plan", description: e?.message, variant: "destructive" });
    } finally {
      setAgreeing(false);
    }
  }

  const openChat = () => {
    const prefill = `Let's finalise the business plan for pathway run ${runId}. Call get_property_pathway, walk me through the Stage 6 draft, and we'll refine it together. Use update_business_plan whenever we agree on a change — don't call agree_business_plan until I explicitly say "agree".`;
    navigate(`/chatbgp?message=${encodeURIComponent(prefill)}`);
  };

  return (
    <Card>
      <CardHeader className="pb-3 flex flex-row items-center justify-between">
        <CardTitle className="text-base flex items-center gap-2">
          <Briefcase className="w-4 h-4" /> Business Plan
          {agreed && <Badge className="ml-1 bg-emerald-100 text-emerald-900">Agreed</Badge>}
        </CardTitle>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={openChat} className="gap-1.5">
            <MessageSquare className="w-3.5 h-3.5" /> Discuss in ChatBGP
          </Button>
          {!agreed && (
            <Button size="sm" onClick={agree} disabled={agreeing || !stage6?.draft} className="gap-1.5 bg-emerald-600 hover:bg-emerald-700">
              {agreeing ? <Clock className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Agree plan
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="text-sm space-y-3">
        {summary && !agreed && (
          <div className="rounded-lg bg-muted/40 border p-3 text-[13px] leading-relaxed whitespace-pre-wrap">{summary}</div>
        )}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <InfoBlock label="Strategy" value={plan.strategy || "—"} />
          <InfoBlock label="Hold (yrs)" value={plan.holdPeriodYrs ? String(plan.holdPeriodYrs) : "—"} />
          <InfoBlock label="Target price" value={fmtMoney(plan.targetPurchasePrice)} />
          <InfoBlock label="Target NIY" value={fmtPct(plan.targetNIY)} />
          <InfoBlock label="Exit price" value={fmtMoney(plan.exitPrice)} />
          <InfoBlock label="Exit yield" value={fmtPct(plan.exitYield)} />
          <InfoBlock label="Target IRR" value={fmtPct(plan.targetIRR)} />
          <InfoBlock label="Target MOIC" value={plan.targetMOIC ? `${Number(plan.targetMOIC).toFixed(2)}x` : "—"} />
        </div>
        {Array.isArray(plan.keyMoves) && plan.keyMoves.length > 0 && (
          <div>
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">Key moves</p>
            <ul className="list-disc pl-5 text-[13px] space-y-0.5">
              {plan.keyMoves.map((m: string, i: number) => <li key={i}>{m}</li>)}
            </ul>
          </div>
        )}
        {Array.isArray(plan.risks) && plan.risks.length > 0 && (
          <div>
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">Risks</p>
            <ul className="list-disc pl-5 text-[13px] space-y-0.5 text-muted-foreground">
              {plan.risks.map((r: string, i: number) => <li key={i}>{r}</li>)}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ExcelModelCard({ runId, stage7, stage6, onReload }: { runId: string; stage7: any; stage6: any; onReload: () => void }) {
  const { toast } = useToast();
  const [agreeing, setAgreeing] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [areaInput, setAreaInput] = useState<string>(
    stage7?.overrideTotalAreaSqFt ? String(stage7.overrideTotalAreaSqFt) :
    stage7?.totalAreaSqFt ? String(stage7.totalAreaSqFt) : "",
  );
  const [rentInput, setRentInput] = useState<string>(
    stage7?.overrideCurrentRentPA ? String(stage7.overrideCurrentRentPA) :
    stage7?.currentRentPA ? String(stage7.currentRentPA) : "",
  );
  const planAgreed = !!stage6?.agreed;
  const modelAgreed = !!stage7?.agreed;

  async function regenerate() {
    const totalAreaSqFt = areaInput.trim() ? parseFloat(areaInput.replace(/[^0-9.]/g, "")) : null;
    const currentRentPA = rentInput.trim() ? parseFloat(rentInput.replace(/[^0-9.]/g, "")) : null;
    if (totalAreaSqFt !== null && (!Number.isFinite(totalAreaSqFt) || totalAreaSqFt <= 0)) {
      toast({ title: "Invalid area", description: "Enter a positive number of sq ft", variant: "destructive" });
      return;
    }
    setRegenerating(true);
    try {
      const res = await fetch(`/api/property-pathway/${runId}/stage7/override`, {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ totalAreaSqFt, currentRentPA, regenerate: true }),
      });
      if (!res.ok) throw new Error(await res.text());
      toast({ title: "Regenerating model", description: "Using your overrides — refresh shortly." });
      setTimeout(onReload, 2500);
    } catch (e: any) {
      toast({ title: "Couldn't regenerate", description: e?.message, variant: "destructive" });
    } finally {
      setRegenerating(false);
    }
  }

  async function agree() {
    if (!confirm("Agree this Excel model version? It will lock this version as the one Why Buy uses.")) return;
    setAgreeing(true);
    try {
      const res = await fetch(`/api/property-pathway/${runId}/excel-model/agree`, {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ modelVersionId: stage7?.modelVersionId }),
      });
      if (!res.ok) throw new Error(await res.text());
      toast({ title: "Model agreed", description: "Unlocked Stage 8 — Studio Time." });
      onReload();
    } catch (e: any) {
      toast({ title: "Couldn't agree model", description: e?.message, variant: "destructive" });
    } finally {
      setAgreeing(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3 flex flex-row items-center justify-between">
        <CardTitle className="text-base flex items-center gap-2">
          <FileSpreadsheet className="w-4 h-4" /> Model Studio
          {modelAgreed && <Badge className="ml-1 bg-emerald-100 text-emerald-900">Agreed</Badge>}
        </CardTitle>
        <div className="flex items-center gap-2">
          {stage7?.workbookUrl && (
            <a href={stage7.workbookUrl} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline inline-flex items-center gap-1">
              <ExternalLink className="w-3 h-3" /> Open in Excel
            </a>
          )}
          {!modelAgreed && (
            <Button size="sm" onClick={agree} disabled={agreeing || !stage7?.modelRunId} className="gap-1.5 bg-emerald-600 hover:bg-emerald-700">
              {agreeing ? <Clock className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Agree model
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="text-sm">
        {!planAgreed && (
          <p className="text-muted-foreground">Agree the business plan first — the model is generated from its targets.</p>
        )}
        {planAgreed && !stage7?.modelRunId && (
          <p className="text-muted-foreground">Click "Generate Model Studio" above to build the workbook from the agreed plan.</p>
        )}
        {stage7?.modelRunId && (
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
            <InfoBlock label="Model run" value={stage7.modelRunName || stage7.modelRunId} />
            <InfoBlock label="Version" value={stage7.modelVersionLabel || stage7.modelVersionId || "—"} />
            <InfoBlock label="Status" value={modelAgreed ? "Agreed" : "Drafting in Excel"} />
          </div>
        )}

        {/* Area + passing rent — the two inputs that matter most. Show the
            value the model was built with (and its source) so you can sanity-
            check before agreeing. Override + regenerate if wrong. */}
        {stage7?.modelRunId && !modelAgreed && (
          <div className="mt-3 border rounded-lg p-3 bg-muted/30">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-medium">Area & passing rent</p>
              <span className={`text-[10px] px-1.5 py-0.5 rounded ${stage7.totalAreaSource === "default" ? "bg-amber-100 text-amber-900" : "bg-emerald-100 text-emerald-900"}`}>
                Area source: {stage7.totalAreaSource || "default"}
                {stage7.totalAreaSource === "default" && " — please override"}
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-2">
              <label className="block">
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Total area (sq ft)</span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={areaInput}
                  onChange={(e) => setAreaInput(e.target.value)}
                  placeholder={stage7.totalAreaSqFt ? String(stage7.totalAreaSqFt) : "e.g. 22000"}
                  className="mt-0.5 w-full border rounded px-2 py-1 text-sm"
                />
              </label>
              <label className="block">
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Passing rent (£/year)</span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={rentInput}
                  onChange={(e) => setRentInput(e.target.value)}
                  placeholder={stage7.currentRentPA ? String(stage7.currentRentPA) : "e.g. 1200000"}
                  className="mt-0.5 w-full border rounded px-2 py-1 text-sm"
                />
              </label>
            </div>
            <Button size="sm" variant="outline" onClick={regenerate} disabled={regenerating} className="gap-1.5">
              {regenerating ? <Clock className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />} Regenerate model
            </Button>
          </div>
        )}

        <p className="text-[11px] text-muted-foreground mt-3">
          Continue the conversation inside Excel using the BGP add-in — Claude can amend assumptions in the workbook and you can push back until you agree.
        </p>
      </CardContent>
    </Card>
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

function statusTone(status: string): string {
  const s = (status || "").toLowerCase();
  if (/permit|approv|grant|allowed/.test(s)) return "bg-emerald-100 text-emerald-800";
  if (/refus|reject|dismiss|withdraw/.test(s)) return "bg-rose-100 text-rose-800";
  if (/pend|register|valid|consult|under/.test(s)) return "bg-amber-100 text-amber-800";
  return "bg-slate-100 text-slate-700";
}

function PlanningRow({ p }: { p: any }) {
  const [expanded, setExpanded] = useState(false);
  const dateStr = p.decidedAt || p.receivedAt || p.date || "";
  const lpa = p.lpa ? p.lpa.split(/[ &]/)[0] : null;

  return (
    <div className="border-b last:border-b-0 text-[11px]">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-start gap-1.5 py-1 px-0.5 hover:bg-muted/30 text-left"
      >
        {expanded ? <ChevronDown className="w-3 h-3 mt-0.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="w-3 h-3 mt-0.5 shrink-0 text-muted-foreground" />}
        <span className="text-[10px] text-muted-foreground shrink-0 w-16 mt-px">{dateStr ? dateStr.slice(0, 10) : ""}</span>
        {lpa && <span className="text-[8px] px-1 py-px rounded bg-emerald-100 text-emerald-800 uppercase font-medium shrink-0 mt-px" title={p.lpa}>{lpa}</span>}
        <span className="flex-1 min-w-0">
          <span className="font-medium break-all">{p.reference}</span>
          {p.status && <span className={`ml-1 text-[9px] px-1 py-px rounded uppercase tracking-wide ${statusTone(p.status)}`}>{p.status}</span>}
          <span className="block text-muted-foreground truncate">{p.description || ""}</span>
        </span>
      </button>
      {expanded && (
        <div className="px-5 pb-2 pt-0.5 space-y-1 text-[10px] leading-relaxed">
          {p.description && <p className="text-foreground/90">{p.description}</p>}
          <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-muted-foreground">
            {p.type && <div><span className="uppercase tracking-wide text-[9px]">Type</span><br /><span className="text-foreground">{p.type}</span></div>}
            {p.decision && <div><span className="uppercase tracking-wide text-[9px]">Decision</span><br /><span className="text-foreground">{p.decision}</span></div>}
            {p.receivedAt && <div><span className="uppercase tracking-wide text-[9px]">Received</span><br /><span className="text-foreground">{String(p.receivedAt).slice(0, 10)}</span></div>}
            {p.decidedAt && <div><span className="uppercase tracking-wide text-[9px]">Decided</span><br /><span className="text-foreground">{String(p.decidedAt).slice(0, 10)}</span></div>}
            {p.address && <div className="col-span-2"><span className="uppercase tracking-wide text-[9px]">Site address</span><br /><span className="text-foreground">{p.address}</span></div>}
          </div>
          {p.documentUrl && (
            <a href={p.documentUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
              View on LPA portal <ExternalLink className="w-2.5 h-2.5" />
            </a>
          )}
        </div>
      )}
    </div>
  );
}

function PlanningCard({ apps }: { apps: any[] }) {
  const [showDialog, setShowDialog] = useState(false);
  return (
    <div className="border rounded p-2.5 bg-muted/10">
      <div className="flex items-center justify-between mb-1.5">
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">03 Planning (20y){apps.length > 0 ? ` · ${apps.length}` : ""}</p>
        {apps.length > 0 && (
          <button type="button" onClick={() => setShowDialog(true)} className="text-[10px] text-primary hover:underline inline-flex items-center gap-1">
            <Maximize2 className="w-2.5 h-2.5" /> Expand
          </button>
        )}
      </div>
      {apps.length > 0 ? (
        <div className="max-h-[28rem] overflow-y-auto">
          {apps.slice(0, 30).map((p: any, i: number) => <PlanningRow key={i} p={p} />)}
        </div>
      ) : (
        <p className="text-[10px] text-muted-foreground">No planning applications found for this building over the last 20 years.</p>
      )}
      <PlanningDialog apps={apps} open={showDialog} onClose={() => setShowDialog(false)} />
    </div>
  );
}

function fmtGBP(v?: number): string {
  if (v == null || !Number.isFinite(v)) return "—";
  if (Math.abs(v) >= 1_000_000) return `£${(v / 1_000_000).toFixed(1)}m`;
  if (Math.abs(v) >= 1_000) return `£${(v / 1_000).toFixed(0)}k`;
  return `£${Math.round(v)}`;
}

function fmtPsf(v?: number): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `£${v.toFixed(v < 10 ? 2 : 0)}/sqft`;
}

function ImageStudioCard({ runId, stage8, onReload }: { runId: string; stage8: any; onReload: () => void }) {
  const { toast } = useToast();
  const [retrying, setRetrying] = useState(false);
  const thumbUrl = (imageId: string) =>
    `/api/property-pathway/${runId}/image/${imageId}?thumb=1`;
  const fullUrl = (imageId: string) =>
    `/api/property-pathway/${runId}/image/${imageId}`;
  const additional = Array.isArray(stage8?.additionalImageIds) ? stage8.additionalImageIds : [];
  const collections = Array.isArray(stage8?.collections) ? stage8.collections : [];
  const hasAny = stage8?.streetViewImageId || stage8?.retailContextImageId || additional.length > 0 || collections.some((c: any) => (c.imageCount || 0) > 0);

  const retry = async () => {
    setRetrying(true);
    try {
      const res = await fetch(`/api/property-pathway/${runId}/stage8/retry`, { method: "POST" });
      if (!res.ok) throw new Error(await res.text());
      toast({ title: "Re-running Image Studio", description: "Refresh in a moment to see the new output." });
      setTimeout(onReload, 3000);
    } catch (err: any) {
      toast({ title: "Retry failed", description: err?.message || "Could not retry", variant: "destructive" });
    } finally {
      setRetrying(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3 flex flex-row items-center justify-between">
        <CardTitle className="text-base flex items-center gap-2">
          <ImageIcon className="w-4 h-4" /> Image Studio
        </CardTitle>
        <div className="flex items-center gap-2">
          <a href="/image-studio" target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline inline-flex items-center gap-1">
            <ExternalLink className="w-3 h-3" /> Open Image Studio
          </a>
          <Button size="sm" variant="outline" onClick={retry} disabled={retrying} className="gap-1.5">
            {retrying ? <Clock className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />} Re-run
          </Button>
        </div>
      </CardHeader>
      <CardContent className="text-sm space-y-3">
        {!hasAny && (
          <p className="text-muted-foreground text-xs">
            No images captured yet. If you expected a retail context plan or street view, hit <b>Re-run</b> — the render may have been skipped on the first pass.
          </p>
        )}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {stage8?.streetViewImageId && (
            <a href={fullUrl(stage8.streetViewImageId)} target="_blank" rel="noreferrer" className="block group">
              <div className="aspect-[4/3] bg-muted rounded overflow-hidden border">
                <img src={thumbUrl(stage8.streetViewImageId)} alt="Street View" className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
              </div>
              <div className="text-[10px] text-muted-foreground mt-1">Street View</div>
            </a>
          )}
          {stage8?.retailContextImageId && (
            <a href={fullUrl(stage8.retailContextImageId)} target="_blank" rel="noreferrer" className="block group">
              <div className="aspect-[4/3] bg-muted rounded overflow-hidden border">
                <img src={thumbUrl(stage8.retailContextImageId)} alt="Retail Context Plan" className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
              </div>
              <div className="text-[10px] text-muted-foreground mt-1">Retail Context Plan</div>
            </a>
          )}
          {additional.slice(0, 6).map((id: string) => (
            <a key={id} href={fullUrl(id)} target="_blank" rel="noreferrer" className="block group">
              <div className="aspect-[4/3] bg-muted rounded overflow-hidden border">
                <img src={thumbUrl(id)} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
              </div>
            </a>
          ))}
        </div>
        {collections.length > 0 && (
          <div className="grid grid-cols-3 gap-2 text-[11px]">
            {collections.map((c: any) => (
              <div key={c.id} className="border rounded px-2 py-1 flex items-center justify-between">
                <span className="truncate">{c.name}</span>
                <Badge variant="outline" className="text-[10px] py-0 shrink-0">{c.imageCount || 0}</Badge>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function PropertyDataMarketCard({ tone }: { tone: any }) {
  const commercial = tone?.commercial || {};
  const residential = tone?.residential || {};
  const rows: Array<{ label: string; postcode?: string; samples?: number; psf?: number; total?: number; size?: number; tone: string }> = [];
  const add = (label: string, t: any, tag: string) => {
    if (!t) return;
    rows.push({
      label,
      postcode: t.postcodeUsed,
      samples: t.pointsAnalysed,
      psf: t.avgQuotingRentPerSqft ?? t.avgRentPerSqft ?? t.avgPricePerSqft,
      total: t.avgQuotingRent ?? t.avgRent ?? t.avgPrice,
      size: t.avgSize,
      tone: tag,
    });
  };
  add("Retail quoting rent", commercial.retail, "bg-sky-100 text-sky-800");
  add("Office quoting rent", commercial.offices, "bg-indigo-100 text-indigo-800");
  add("Restaurant quoting rent", commercial.restaurants, "bg-amber-100 text-amber-800");
  add("Residential asking rent", residential.rents, "bg-emerald-100 text-emerald-800");
  add("Residential sold £/sqft", residential.sold, "bg-slate-100 text-slate-700");

  if (rows.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Building2 className="w-4 h-4" /> Market tone
          <Badge variant="outline" className="text-[10px] py-0">PropertyData</Badge>
        </CardTitle>
        <p className="text-[10px] text-muted-foreground">Aggregate quoting rents and £/sqft for this postcode sector — not individual deal comps.</p>
      </CardHeader>
      <CardContent className="text-[11px] space-y-1 pb-2">
        {rows.map((r, i) => (
          <div key={i} className="flex items-center gap-1.5 py-1 border-b last:border-b-0">
            <span className={`text-[9px] px-1 py-px rounded uppercase shrink-0 ${r.tone}`}>{r.label.split(" ")[0]}</span>
            <span className="flex-1 min-w-0 truncate" title={r.label}>{r.label}</span>
            {r.psf != null && <span className="font-medium shrink-0">{fmtPsf(r.psf)}</span>}
            {r.total != null && <span className="text-muted-foreground text-[10px] shrink-0">{fmtGBP(r.total)}</span>}
            {r.samples != null && <span className="text-muted-foreground text-[10px] shrink-0">n={r.samples}</span>}
            {r.postcode && <span className="text-muted-foreground text-[10px] shrink-0 uppercase">{r.postcode}</span>}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

// Route planning PDF downloads through our server so ScraperAPI can pull the
// file via a UK residential IP — Idox (Westminster and similar) blocks direct
// browser fetches via referer/IP checks and the raw URL often returns an HTML
// viewer rather than the PDF bytes.
function planningPdfProxy(rawUrl: string): string {
  if (!rawUrl) return rawUrl;
  return `/api/planning-docs/download?url=${encodeURIComponent(rawUrl)}`;
}

function classifyDocType(text: string): { label: string; tone: string } {
  const t = (text || "").toLowerCase();
  if (/floor\s*plan|ground\s*floor|first\s*floor|second\s*floor|basement\s*plan/.test(t)) return { label: "Floor Plan", tone: "bg-sky-100 text-sky-800" };
  if (/elevation/.test(t)) return { label: "Elevation", tone: "bg-violet-100 text-violet-800" };
  if (/section/.test(t) && !/section\s*\d+\s*(agreement|notice)/.test(t)) return { label: "Section", tone: "bg-violet-100 text-violet-800" };
  if (/site\s*(plan|location)|location\s*plan|block\s*plan/.test(t)) return { label: "Site Plan", tone: "bg-emerald-100 text-emerald-800" };
  if (/decision\s*notice|decision\s*letter/.test(t)) return { label: "Decision", tone: "bg-amber-100 text-amber-800" };
  if (/design\s*and\s*access|d&a|heritage\s*statement|planning\s*statement/.test(t)) return { label: "Statement", tone: "bg-slate-100 text-slate-700" };
  if (/application\s*form/.test(t)) return { label: "Form", tone: "bg-slate-100 text-slate-700" };
  return { label: "Doc", tone: "bg-slate-100 text-slate-700" };
}

function docCategoryTone(category: string): string {
  switch (category) {
    case "floor_plan_proposed":
      return "bg-sky-200 text-sky-900";
    case "floor_plan_existing":
      return "bg-sky-50 text-sky-700";
    case "floor_plan":
      return "bg-sky-100 text-sky-800";
    case "elevation_proposed":
      return "bg-violet-200 text-violet-900";
    case "elevation_existing":
      return "bg-violet-50 text-violet-700";
    case "elevation":
      return "bg-violet-100 text-violet-800";
    case "section_proposed":
      return "bg-fuchsia-200 text-fuchsia-900";
    case "section_existing":
      return "bg-fuchsia-50 text-fuchsia-700";
    case "section":
      return "bg-fuchsia-100 text-fuchsia-800";
    case "site_plan":
      return "bg-emerald-100 text-emerald-800";
    case "decision":
    case "officer_report":
      return "bg-amber-100 text-amber-800";
    case "das":
    case "heritage":
    case "planning_statement":
      return "bg-indigo-100 text-indigo-800";
    case "photo":
      return "bg-pink-100 text-pink-800";
    default:
      return "bg-slate-100 text-slate-700";
  }
}

function PlanningDocsCard({
  apps,
  planningDocs,
  legacyUrls,
}: {
  apps: any[];
  planningDocs: Array<{
    ref: string;
    lpa: string;
    appDate: string;
    description: string;
    docsUrl: string;
    docs: Array<{ url: string; date: string; description: string; type: string; drawingNumber?: string; category: string; label: string }>;
  }>;
  legacyUrls: string[];
}) {
  const [showDialog, setShowDialog] = useState(false);
  const scrapedRefs = new Set(planningDocs.map((p) => p.ref));
  const totalPdfs = planningDocs.reduce((acc, p) => acc + p.docs.length, 0);

  // Applications that weren't scraped (either >top-10, or scrape returned 0)
  const unscraped = apps.filter((a: any) => a.documentUrl && !scrapedRefs.has(a.reference));

  return (
    <div className="border rounded p-2.5 bg-muted/10">
      <div className="flex items-center justify-between mb-1.5">
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
          04 Planning Documents
          {totalPdfs > 0 ? ` · ${totalPdfs} PDFs across ${planningDocs.length} apps` : ""}
        </p>
        {(totalPdfs > 0 || unscraped.length > 0) && (
          <button type="button" onClick={() => setShowDialog(true)} className="text-[10px] text-primary hover:underline inline-flex items-center gap-1">
            <Maximize2 className="w-2.5 h-2.5" /> Expand
          </button>
        )}
      </div>

      {planningDocs.length > 0 ? (
        <div className="space-y-2 max-h-[28rem] overflow-y-auto">
          {planningDocs.map((app, ai) => (
            <div key={ai} className="border rounded bg-background">
              {/* App-grouping header: one line to match the doc rows below.
                  Full description + long refs are available via Expand. */}
              <div className="flex items-center gap-1.5 px-2 py-1 border-b bg-muted/30 text-[11px]">
                <span className="text-[10px] text-muted-foreground shrink-0 w-16">{app.appDate ? app.appDate.slice(0, 10) : ""}</span>
                {app.lpa && <span className="text-[8px] px-1 py-px rounded bg-emerald-100 text-emerald-800 uppercase font-medium shrink-0" title={app.lpa}>{app.lpa.split(/[ &]/)[0]}</span>}
                <a href={app.docsUrl} target="_blank" rel="noreferrer" className="font-medium text-primary hover:underline truncate min-w-0 flex-1" title={app.ref + (app.description ? ` — ${app.description}` : "")}>{app.ref}</a>
                <span className="text-[9px] px-1 py-px rounded bg-sky-100 text-sky-800 shrink-0">{app.docs.length} PDF{app.docs.length === 1 ? "" : "s"}</span>
              </div>
              <div className="divide-y">
                {app.docs.slice(0, 40).map((d, di) => (
                  <a
                    key={di}
                    href={planningPdfProxy(d.url)}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-start gap-1.5 py-1 px-2 hover:bg-muted/30 text-[11px]"
                    title={d.description}
                  >
                    <span className="text-[10px] text-muted-foreground shrink-0 w-16 mt-px">{d.date ? d.date.slice(0, 10) : ""}</span>
                    <span className={`text-[9px] px-1 py-px rounded uppercase tracking-wide shrink-0 mt-px ${docCategoryTone(d.category)}`}>{d.label}</span>
                    <span className="flex-1 min-w-0">
                      <span className="block truncate">{d.description}</span>
                      {d.drawingNumber && <span className="block text-muted-foreground text-[10px] truncate">Drawing {d.drawingNumber}</span>}
                    </span>
                    <Download className="w-3 h-3 shrink-0 text-muted-foreground mt-px" />
                  </a>
                ))}
                {app.docs.length > 40 && (
                  <a href={app.docsUrl} target="_blank" rel="noreferrer" className="block px-2 py-1 text-[10px] text-muted-foreground hover:bg-muted/30">
                    … {app.docs.length - 40} more — open full list on LPA portal
                  </a>
                )}
              </div>
            </div>
          ))}

          {unscraped.length > 0 && (
            <div className="border rounded bg-background">
              <p className="px-2 py-1.5 text-[10px] text-muted-foreground uppercase tracking-wide border-b">
                Other applications · docs tab only
              </p>
              <div className="divide-y">
                {unscraped.slice(0, 20).map((p: any, i: number) => (
                  <a
                    key={i}
                    href={p.documentUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-start gap-1.5 py-1 px-2 hover:bg-muted/30 text-[11px]"
                  >
                    <span className="text-[10px] text-muted-foreground shrink-0 w-16 mt-px">{(p.decidedAt || p.receivedAt || p.date || "").slice(0, 10)}</span>
                    <span className="flex-1 min-w-0">
                      <span className="font-medium break-all text-primary">{p.reference}</span>
                      {p.description && <span className="block text-muted-foreground text-[10px] truncate">{p.description}</span>}
                    </span>
                    <ExternalLink className="w-2.5 h-2.5 shrink-0 text-muted-foreground mt-px" />
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : apps.length > 0 ? (
        <>
          <p className="text-[10px] text-muted-foreground mb-1">
            PDF scraping didn't return anything — showing LPA documents-tab links instead.
            {` `}Set <code className="text-[9px] bg-muted px-1 py-px rounded">SCRAPERAPI_KEY</code> on the server to pull individual PDFs.
          </p>
          <div className="space-y-0.5 text-[11px] max-h-56 overflow-y-auto">
            {apps.filter((p: any) => p.documentUrl).slice(0, 30).map((p: any, i: number) => {
              const cat = classifyDocType(`${p.type || ""} ${p.description || ""}`);
              return (
                <a
                  key={i}
                  href={p.documentUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-start gap-1.5 py-1 px-0.5 border-b last:border-b-0 hover:bg-muted/30"
                >
                  <span className="text-[10px] text-muted-foreground shrink-0 w-16 mt-px">{(p.decidedAt || p.receivedAt || p.date || "").slice(0, 10)}</span>
                  <span className={`text-[9px] px-1 py-px rounded uppercase tracking-wide shrink-0 mt-px ${cat.tone}`}>{cat.label}</span>
                  <span className="flex-1 min-w-0">
                    <span className="font-medium break-all text-primary">{p.reference}</span>
                    {p.description && <span className="block text-muted-foreground text-[10px] truncate">{p.description}</span>}
                  </span>
                  <ExternalLink className="w-2.5 h-2.5 shrink-0 text-muted-foreground mt-px" />
                </a>
              );
            })}
            {legacyUrls.filter((u) => !apps.some((a: any) => a.documentUrl === u)).slice(0, 10).map((u, i) => (
              <a key={`legacy-${i}`} href={u} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 py-1 px-0.5 border-b last:border-b-0 hover:bg-muted/30 text-[10px] text-muted-foreground">
                <ExternalLink className="w-2.5 h-2.5 shrink-0" />
                <span className="truncate">{u}</span>
              </a>
            ))}
          </div>
        </>
      ) : (
        <p className="text-[10px] text-muted-foreground">No planning document links surfaced. If a planning application exists, check the LPA portal directly.</p>
      )}
      <PlanningDocsDialog
        planningDocs={planningDocs}
        unscraped={unscraped}
        legacyUrls={legacyUrls}
        open={showDialog}
        onClose={() => setShowDialog(false)}
      />
    </div>
  );
}

function PlanningDocsDialog({
  planningDocs,
  unscraped,
  legacyUrls,
  open,
  onClose,
}: {
  planningDocs: Array<{
    ref: string;
    lpa: string;
    appDate: string;
    description: string;
    docsUrl: string;
    docs: Array<{ url: string; date: string; description: string; type: string; drawingNumber?: string; category: string; label: string }>;
  }>;
  unscraped: any[];
  legacyUrls: string[];
  open: boolean;
  onClose: () => void;
}) {
  const totalPdfs = planningDocs.reduce((acc, p) => acc + p.docs.length, 0);
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-5xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>
            Planning documents ({totalPdfs} PDFs across {planningDocs.length} apps)
          </DialogTitle>
        </DialogHeader>
        <div className="overflow-y-auto -mx-6 px-6 space-y-3">
          {planningDocs.map((app, ai) => (
            <div key={ai} className="border rounded bg-background">
              <div className="flex items-start gap-2 px-3 py-2 border-b bg-muted/30">
                <span className="text-[11px] text-muted-foreground shrink-0 w-20 mt-0.5">{app.appDate ? app.appDate.slice(0, 10) : ""}</span>
                {app.lpa && <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 uppercase font-medium shrink-0 mt-0.5" title={app.lpa}>{app.lpa.split(/[ &]/)[0]}</span>}
                <span className="flex-1 min-w-0">
                  <a href={app.docsUrl} target="_blank" rel="noreferrer" className="font-medium break-all text-primary hover:underline text-[12px]">{app.ref}</a>
                  {app.description && <span className="block text-muted-foreground text-[11px]">{app.description}</span>}
                </span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-100 text-sky-800 shrink-0 mt-0.5">{app.docs.length} PDF{app.docs.length === 1 ? "" : "s"}</span>
              </div>
              <div className="divide-y">
                {app.docs.map((d, di) => (
                  <a
                    key={di}
                    href={planningPdfProxy(d.url)}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-start gap-2 py-1.5 px-3 hover:bg-muted/30 text-[12px]"
                    title={d.description}
                  >
                    <span className="text-[11px] text-muted-foreground shrink-0 w-20 mt-0.5">{d.date ? d.date.slice(0, 10) : ""}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wide shrink-0 mt-0.5 ${docCategoryTone(d.category)}`}>{d.label}</span>
                    <span className="flex-1 min-w-0">
                      <span className="block">{d.description}</span>
                      {d.drawingNumber && <span className="block text-muted-foreground text-[11px]">Drawing {d.drawingNumber}</span>}
                    </span>
                    <Download className="w-3.5 h-3.5 shrink-0 text-muted-foreground mt-0.5" />
                  </a>
                ))}
              </div>
            </div>
          ))}

          {unscraped.length > 0 && (
            <div className="border rounded bg-background">
              <p className="px-3 py-2 text-[11px] text-muted-foreground uppercase tracking-wide border-b">
                Other applications · docs tab only ({unscraped.length})
              </p>
              <div className="divide-y">
                {unscraped.map((p: any, i: number) => (
                  <a
                    key={i}
                    href={p.documentUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-start gap-2 py-1.5 px-3 hover:bg-muted/30 text-[12px]"
                  >
                    <span className="text-[11px] text-muted-foreground shrink-0 w-20 mt-0.5">{(p.decidedAt || p.receivedAt || p.date || "").slice(0, 10)}</span>
                    <span className="flex-1 min-w-0">
                      <span className="font-medium break-all text-primary">{p.reference}</span>
                      {p.description && <span className="block text-muted-foreground text-[11px]">{p.description}</span>}
                    </span>
                    <ExternalLink className="w-3 h-3 shrink-0 text-muted-foreground mt-0.5" />
                  </a>
                ))}
              </div>
            </div>
          )}

          {legacyUrls.length > 0 && (
            <div className="border rounded bg-background">
              <p className="px-3 py-2 text-[11px] text-muted-foreground uppercase tracking-wide border-b">Legacy doc URLs</p>
              <div className="divide-y">
                {legacyUrls.map((u, i) => (
                  <a key={i} href={u} target="_blank" rel="noreferrer" className="flex items-center gap-2 py-1.5 px-3 hover:bg-muted/30 text-[11px] text-muted-foreground">
                    <ExternalLink className="w-3 h-3 shrink-0" />
                    <span className="truncate">{u}</span>
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PlanningDialog({ apps, open, onClose }: { apps: any[]; open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Planning applications ({apps.length})</DialogTitle>
        </DialogHeader>
        <div className="overflow-y-auto -mx-6 px-6">
          <table className="w-full text-[12px]">
            <thead className="sticky top-0 bg-background border-b">
              <tr className="text-left text-muted-foreground text-[10px] uppercase tracking-wide">
                <th className="py-2 pr-2 w-20">Date</th>
                <th className="py-2 pr-2 w-24">LPA</th>
                <th className="py-2 pr-2 w-28">Reference</th>
                <th className="py-2 pr-2 w-24">Status</th>
                <th className="py-2 pr-2">Description</th>
                <th className="py-2 pr-0 w-10"></th>
              </tr>
            </thead>
            <tbody>
              {apps.map((p, i) => (
                <tr key={i} className="border-b last:border-b-0 align-top hover:bg-muted/20">
                  <td className="py-2 pr-2 text-muted-foreground">{(p.decidedAt || p.receivedAt || p.date || "").slice(0, 10)}</td>
                  <td className="py-2 pr-2">{p.lpa || ""}</td>
                  <td className="py-2 pr-2 font-medium break-all">{p.reference}</td>
                  <td className="py-2 pr-2">{p.status && <span className={`text-[9px] px-1 py-px rounded uppercase tracking-wide ${statusTone(p.status)}`}>{p.status}</span>}</td>
                  <td className="py-2 pr-2 text-foreground/90">{p.description}{p.type ? <span className="block text-muted-foreground text-[10px] mt-0.5">{p.type}</span> : null}</td>
                  <td className="py-2 pr-0">
                    {p.documentUrl && (
                      <a href={p.documentUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline inline-flex items-center" title="View on LPA portal">
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface EmailDetail {
  id: string;
  subject: string;
  from: { name?: string; email?: string };
  to: Array<{ name?: string; email?: string }>;
  cc: Array<{ name?: string; email?: string }>;
  date: string;
  bodyContentType: "text" | "html";
  bodyHtml: string;
  bodyText: string;
  hasAttachments: boolean;
  webLink: string | null;
  attachments: Array<{ id: string; name: string; size: number; contentType: string }>;
}

function EmailViewerDialog({ msgId, mailboxEmail, onClose }: { msgId: string; mailboxEmail: string; onClose: () => void }) {
  const [email, setEmail] = useState<EmailDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/pathway/email/${encodeURIComponent(mailboxEmail)}/${encodeURIComponent(msgId)}`,
          { headers: getAuthHeaders(), credentials: "include" }
        );
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        if (!cancelled) setEmail(data);
      } catch (err: any) {
        if (!cancelled) setError(err?.message || "Failed to load email");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [msgId, mailboxEmail]);

  const copyBody = () => {
    if (!email) return;
    const text = email.bodyText || stripHtml(email.bodyHtml);
    navigator.clipboard.writeText(text);
    toast({ title: "Email body copied" });
  };

  const copyAll = () => {
    if (!email) return;
    const header = [
      `From: ${email.from.name || ""} <${email.from.email || ""}>`,
      `To: ${email.to.map((r) => r.email).filter(Boolean).join(", ")}`,
      email.cc.length ? `Cc: ${email.cc.map((r) => r.email).filter(Boolean).join(", ")}` : null,
      `Date: ${new Date(email.date).toLocaleString("en-GB")}`,
      `Subject: ${email.subject}`,
    ].filter(Boolean).join("\n");
    const body = email.bodyText || stripHtml(email.bodyHtml);
    navigator.clipboard.writeText(`${header}\n\n${body}`);
    toast({ title: "Full email copied" });
  };

  const downloadAttachment = async (a: { id: string; name: string }) => {
    try {
      const res = await fetch(
        `/api/pathway/email/${encodeURIComponent(mailboxEmail)}/${encodeURIComponent(msgId)}/attachment/${encodeURIComponent(a.id)}`,
        { headers: getAuthHeaders(), credentials: "include" }
      );
      if (!res.ok) throw new Error(await res.text());
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = a.name;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      toast({ title: "Download failed", description: err?.message || "Unknown error", variant: "destructive" });
    }
  };

  return (
    <Dialog open={true} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-base pr-8">{loading ? "Loading email…" : email?.subject || "Email"}</DialogTitle>
        </DialogHeader>

        {loading && (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {error && (
          <div className="py-8 text-center">
            <AlertCircle className="w-8 h-8 mx-auto text-destructive mb-2" />
            <p className="text-sm text-muted-foreground">{error}</p>
          </div>
        )}

        {email && !loading && (
          <>
            <div className="border-b pb-2 mb-2 text-xs space-y-0.5">
              <div><span className="text-muted-foreground">From:</span> <span className="font-medium">{email.from.name || email.from.email}</span> {email.from.email && email.from.name && <span className="text-muted-foreground">&lt;{email.from.email}&gt;</span>}</div>
              <div><span className="text-muted-foreground">To:</span> {email.to.map((r) => r.name || r.email).join(", ")}</div>
              {email.cc.length > 0 && <div><span className="text-muted-foreground">Cc:</span> {email.cc.map((r) => r.name || r.email).join(", ")}</div>}
              <div><span className="text-muted-foreground">Date:</span> {new Date(email.date).toLocaleString("en-GB")}</div>
            </div>

            <div className="flex items-center gap-2 mb-2">
              <Button variant="outline" size="sm" onClick={copyBody} className="h-7 text-xs gap-1">
                <Copy className="w-3 h-3" /> Copy body
              </Button>
              <Button variant="outline" size="sm" onClick={copyAll} className="h-7 text-xs gap-1">
                <Copy className="w-3 h-3" /> Copy full email
              </Button>
              {email.webLink && (
                <a href={email.webLink} target="_blank" rel="noreferrer">
                  <Button variant="ghost" size="sm" className="h-7 text-xs gap-1">
                    Open in Outlook <ExternalLink className="w-3 h-3" />
                  </Button>
                </a>
              )}
            </div>

            {email.attachments.length > 0 && (
              <div className="border rounded p-2 mb-2 bg-muted/20">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5 flex items-center gap-1">
                  <Paperclip className="w-3 h-3" /> {email.attachments.length} attachment{email.attachments.length !== 1 ? "s" : ""}
                </p>
                <div className="space-y-1">
                  {email.attachments.map((a) => (
                    <button key={a.id} onClick={() => downloadAttachment(a)} className="flex items-center gap-2 w-full text-left text-xs hover:bg-muted/50 p-1 rounded group">
                      <Download className="w-3 h-3 text-muted-foreground group-hover:text-primary shrink-0" />
                      <span className="truncate flex-1">{a.name}</span>
                      <span className="text-muted-foreground text-[10px] shrink-0">{formatBytes(a.size)}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="flex-1 overflow-y-auto border rounded p-3 bg-background">
              {email.bodyContentType === "html" && email.bodyHtml ? (
                <div
                  className="text-sm prose prose-sm max-w-none dark:prose-invert [&_a]:text-primary [&_a]:underline [&_img]:max-w-full [&_table]:border-collapse"
                  dangerouslySetInnerHTML={{ __html: email.bodyHtml }}
                />
              ) : (
                <pre className="text-sm whitespace-pre-wrap font-sans">{email.bodyText || "(No body content)"}</pre>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function stripHtml(html: string): string {
  if (!html) return "";
  const tmp = document.createElement("div");
  tmp.innerHTML = html;
  return tmp.textContent || tmp.innerText || "";
}

function formatBytes(bytes: number): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}
