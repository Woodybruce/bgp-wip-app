import { useState, useEffect, useCallback, useRef, useMemo, type ReactNode } from "react";
import { useLocation, Link } from "wouter";
import DOMPurify from "dompurify";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PropertyImageryPicker } from "@/components/property-imagery-picker";
import { StreetViewPanoramaCapture } from "@/components/image-studio/street-view-panorama";
import { RetailContextPlanEditor } from "@/components/retail-context-plan-editor";
import { usePropertyContext } from "@/lib/property-context";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { getAuthHeaders } from "@/lib/queryClient";
import { OfficialCopyButton } from "@/components/official-copy-button";
import { PropertyFoldersPanel, SetUpFoldersDialog } from "@/pages/properties";
import {
  Building2, FolderOpen, MapPin, ShieldCheck, Sparkles,
  FileText, Image as ImageIcon, ChevronRight, ChevronDown, ChevronsUpDown, ArrowRight,
  Check, Clock, AlertCircle, Plus, Search, Download, ExternalLink, Trash2,
  Copy, Paperclip, Loader2, Maximize2, Briefcase, FileSpreadsheet, MessageSquare,
  ZoomIn, ZoomOut, Link2,
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
  startedBy?: string | null;
  // Set by GET /api/property-pathway only — joined from crm_properties +
  // property_imagery_assets so the board can show recognisable cards.
  propertyName?: string | null;
  heroImageStudioId?: string | null;
  startedByName?: string | null;
}

// Which human gate (if any) a run is parked at — mirrors the server's
// review-queue detection so the board can badge runs that need a decision.
function awaitingGateLabel(run: PathwayRun): string | null {
  if (run.completedAt) return null;
  const ss = run.stageStatus || {};
  if (Object.values(ss).some(s => s === "running")) return null;
  const sr = run.stageResults || {};
  const st6 = sr.stage6 || {};
  const st7 = sr.stage7 || {};
  if (ss.stage7 === "completed" && (st7.modelRunId || st7.modelVersionId) && !st7.agreed) return "Model sign-off";
  if (ss.stage6 === "completed" && st6.draft && !st6.agreed) return "Plan sign-off";
  if (ss.stage3 === "completed" && (!ss.stage4 || ss.stage4 === "pending")) return "Review & confirm";
  return null;
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
  // initialLoading: true ONLY for the very first fetch. Subsequent
  // background refetches (the 30s poll while runs are in progress)
  // keep the existing cards on screen instead of flashing back to a
  // "Loading…" state — which is what made the board look glitchy.
  const [initialLoading, setInitialLoading] = useState(true);
  const [advancing, setAdvancing] = useState(false);
  // Board attribution filters — whose deal, and what's waiting on a human.
  const { data: viewer } = useQuery<any>({ queryKey: ["/api/auth/me"] });
  const [ownerFilter, setOwnerFilter] = useState<string>("all"); // all | mine | waiting | <userId>
  const ownerOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of runs) if (r.startedBy && r.startedByName) seen.set(r.startedBy, r.startedByName);
    return Array.from(seen, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [runs]);
  const visibleRuns = useMemo(() => {
    // Passed/Lost runs are archived: out of every view except the explicit
    // Archived one, so dead investigations stop accumulating on the board.
    const archivedOf = (r: PathwayRun) => {
      const d = (r.stageResults as any)?._disposition?.status;
      return d === "passed" || d === "lost";
    };
    if (ownerFilter === "archived") return runs.filter(archivedOf);
    const live = runs.filter(r => !archivedOf(r));
    if (ownerFilter === "mine") return live.filter(r => r.startedBy && r.startedBy === viewer?.id);
    if (ownerFilter === "waiting") return live.filter(r => awaitingGateLabel(r) !== null);
    if (ownerFilter !== "all") return live.filter(r => r.startedBy === ownerFilter);
    return live;
  }, [runs, ownerFilter, viewer?.id]);

  // Folder / portfolio grouping — free-text label stored on the run
  // (stage_results._folder). Folders render as collapsible sections above
  // the ungrouped cards; assignment happens from the folder menu on each card.
  const folderOf = (r: PathwayRun) => (((r.stageResults as any)?._folder as string) || null);
  const allFolders = useMemo(
    () => Array.from(new Set(runs.map(folderOf).filter(Boolean) as string[])).sort((a, b) => a.localeCompare(b)),
    [runs],
  );
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());
  async function setRunFolder(runId: string, folder: string | null) {
    setRuns(prev => prev.map(r => r.id === runId
      ? { ...r, stageResults: { ...(r.stageResults || {}), _folder: folder || undefined } }
      : r));
    try {
      const res = await fetch(`/api/property-pathway/${runId}/folder`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        credentials: "include",
        body: JSON.stringify({ folder }),
      });
      if (!res.ok) throw new Error(await res.text());
    } catch (err: any) {
      toast({ title: "Could not move run", description: err?.message || "Try again", variant: "destructive" });
      loadRuns();
    }
  }
  const ctxProperty = usePropertyContext();
  const [newAddress, setNewAddress] = useState(ctxProperty?.name || "");
  const [newPostcode, setNewPostcode] = useState(ctxProperty?.postcode || "");
  // When the parent Property Intelligence page resolves a different property,
  // freshen the New-investigation inputs so they line up with the selection.
  useEffect(() => {
    if (ctxProperty?.name && !newAddress) setNewAddress(ctxProperty.name);
    if (ctxProperty?.postcode && !newPostcode) setNewPostcode(ctxProperty.postcode);
  }, [ctxProperty?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const runIdFromUrl = (() => {
    try {
      const params = new URLSearchParams(window.location.search);
      return params.get("runId");
    } catch { return null; }
  })();

  const prefilledFromUrl = (() => {
    try {
      const params = new URLSearchParams(window.location.search);
      return {
        address: params.get("address") || "",
        postcode: params.get("postcode") || "",
      };
    } catch { return { address: "", postcode: "" }; }
  })();

  useEffect(() => {
    // The resolver bar is gone, so when callers (Intel strip, edozo-map,
    // ChatBGP-generated links) deep-link with ?address=X&postcode=Y the
    // run starts automatically. ?runId=X is the open-existing flow and
    // is handled by a separate effect below — we skip auto-start then.
    if (prefilledFromUrl.address && !runIdFromUrl) {
      startRun(prefilledFromUrl.address, prefilledFromUrl.postcode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadRuns();
  }, []);

  // Anchor the open run to the URL's ?runId=. With several pathways
  // auto-running, the list + per-run polls re-render constantly; without an
  // anchor a re-render that drops `selectedRun` bounces you back to the list
  // (or the URL/state drift lands you on a different run). Here the URL wins:
  // if the selection drifts from the URL, restore it — instantly from the
  // cached list, then refresh. We never clear on a transient empty URL; only
  // the explicit "All investigations" back action does that.
  useEffect(() => {
    if (!runIdFromUrl) return;
    if (selectedRun?.id === runIdFromUrl) return;
    const cached = runs.find((r) => r.id === runIdFromUrl);
    if (cached) setSelectedRun(cached);
    loadRun(runIdFromUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runIdFromUrl, runs]);

  // Mirror the open run into the URL (?runId=) so the anchor above can always
  // restore it after a re-render/refresh. Without this the selection lived
  // only in volatile state and a re-render bounced you back to the list.
  useEffect(() => {
    if (selectedRun?.id && runIdFromUrl !== selectedRun.id) {
      navigate(`/property-pathway?runId=${selectedRun.id}`, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRun?.id]);

  // Keep the run list fresh while any run has a stage in "running" state —
  // lets the list page show live progress for background runs.
  useEffect(() => {
    const anyRunning = runs.some((r: any) =>
      Object.values(r.stageStatus || {}).some((s) => s === "running"),
    );
    if (!anyRunning) return;
    const id = setInterval(() => loadRuns(), 30_000);
    return () => clearInterval(id);
  }, [runs]);

  // Generation counter for advanceRun's inline poll loop. See advanceRun()
  // below — every call increments this and the loop bails when superseded.
  const advanceTokenRef = useRef(0);

  // Auto-poll whenever the selected run has a stage in "running" state — the
  // server keeps running stages in the background even if the user navigates
  // away, so on re-entry (or a refresh) we pick up progress without needing
  // the user to manually re-click the advance button.
  //
  // NOTE: keep the interval generous (10s+). Stages take minutes, so 1-2
  // second polls just hammer the API and stack up while Anthropic is busy.
  // The dep array used to also watch JSON.stringify(stageStatus), which
  // re-created the interval on every poll response — gone now, so the
  // interval lives for the lifetime of the runId rather than churning
  // every few seconds.
  // useRef holds the single live interval id keyed by runId. Earlier this
  // effect leaked: production logs showed the same runId being polled every
  // ~3 seconds because multiple intervals were stacking when re-renders
  // re-ran the effect before cleanup completed. The ref guarantees that for
  // any given runId at most one timer exists at a time across the page's
  // lifetime, regardless of how many re-renders, route changes, or polled
  // state updates happen.
  const pollIntervalRef = useRef<{ runId: string; id: ReturnType<typeof setInterval> } | null>(null);
  useEffect(() => {
    const runId = selectedRun?.id;
    if (!runId) {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current.id);
        pollIntervalRef.current = null;
      }
      return;
    }
    // Already polling this runId? Don't stack another interval. The tick
    // itself stops the loop when no stages are "running", so we never need
    // to re-enter the effect just because stage status flipped.
    if (pollIntervalRef.current?.runId === runId) return;
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current.id);
      pollIntervalRef.current = null;
    }
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      // Don't poll while the tab is hidden — wastes battery + API quota.
      // The list-poll (every 30s) catches you up when the tab refocuses.
      if (typeof document !== "undefined" && document.hidden) return;
      try {
        const res = await fetch(`/api/property-pathway/${runId}`, {
          headers: getAuthHeaders(),
          credentials: "include",
        });
        if (res.ok) {
          const polled = await res.json();
          if (cancelled) return;
          setSelectedRun(polled);
          const stillRunning = Object.values(polled?.stageStatus || {}).some(
            (s) => s === "running",
          );
          if (!stillRunning && pollIntervalRef.current?.runId === runId) {
            clearInterval(pollIntervalRef.current.id);
            pollIntervalRef.current = null;
          }
        }
      } catch (err: any) {
        console.error("[pathway] polling error:", err?.message);
      }
    };
    const id = setInterval(tick, 15_000);
    pollIntervalRef.current = { runId, id };
    return () => {
      cancelled = true;
      if (pollIntervalRef.current?.id === id) {
        clearInterval(id);
        pollIntervalRef.current = null;
      }
    };
  }, [selectedRun?.id]);

  async function loadRuns() {
    try {
      const res = await fetch("/api/property-pathway", { headers: getAuthHeaders(), credentials: "include" });
      if (res.ok) setRuns(await res.json());
    } finally {
      setInitialLoading(false);
    }
  }

  async function loadRun(id: string) {
    try {
      const res = await fetch(`/api/property-pathway/${id}`, { headers: getAuthHeaders(), credentials: "include" });
      if (res.ok) setSelectedRun(await res.json());
    } catch {}
  }

  async function startRun(addressOverride?: string, postcodeOverride?: string, force?: boolean) {
    const addr = (addressOverride ?? newAddress).trim();
    if (!addr) return;
    const pc = (postcodeOverride ?? newPostcode).trim();
    try {
      const res = await fetch("/api/property-pathway/start", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        credentials: "include",
        body: JSON.stringify({ address: addr, postcode: pc || undefined, force: force || undefined }),
      });
      // Fuzzy duplicate — the server found run(s) that look like the same
      // property under a different spelling. Hard prompt: open the existing
      // run, or deliberately start fresh.
      if (res.status === 409) {
        const dup = await res.json().catch(() => null);
        const cands: Array<{ id: string; address: string; postcode?: string | null }> = dup?.candidates || [];
        if (cands.length > 0) {
          const listing = cands.map(c => `• ${c.address}${c.postcode ? ` (${c.postcode})` : ""}`).join("\n");
          const openExisting = confirm(
            `There's already an investigation that looks like this property:\n\n${listing}\n\nOK — open the existing run\nCancel — start a genuinely new one anyway`,
          );
          if (openExisting) {
            setNewAddress("");
            setNewPostcode("");
            await loadRuns();
            navigate(`/property-pathway?runId=${cands[0].id}`);
          } else {
            await startRun(addr, pc, true);
          }
          return;
        }
      }
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
        // Used to auto-advance Stage 1 here. That caused unwanted "main page
        // jumps me into a running pathway" behaviour when an address was
        // entered just to navigate or browse. The user now taps Advance when
        // they're ready.
        toast({ title: "Pathway created", description: `Tap Advance to run Stage 1 for ${run.address}.` });
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
    // Cancellation token. Each advance call bumps the counter; the in-flight
    // while-loop below checks `myToken === advanceTokenRef.current` every
    // iteration and exits if a newer advance has superseded it. This is what
    // stops the per-run poll from stacking — previously two Advance clicks
    // (or a click + a route change) left two 6-second poll loops running in
    // parallel for 20 minutes each.
    const myToken = ++advanceTokenRef.current;
    setAdvancing(true);
    try {
      const currentRun = selectedRun?.id === runId ? selectedRun : null;
      const targetStage = stage ?? (currentRun?.currentStage ?? 1);
      // Auto-chain end-to-end through the whole pathway (Stage 9, Why Buy).
      // Stage 6 auto-drafts the business plan; Stage 7 uses that draft if no
      // agreed version exists; Stage 8 sweeps images; Stage 9 builds the deck.
      // The run produces a complete first draft to work with — no stop/start.
      const autoChainTo = targetStage < 10 ? 10 : undefined;
      const res = await fetch(`/api/property-pathway/${runId}/advance`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        credentials: "include",
        // Always async: Railway's HTTP edge timeout is 45s; stages 2/4/6/7 can
        // take 2-3 minutes (Claude analysis + Companies House + Idox scrape +
        // accounts PDF). Server returns 202 immediately and the client polls.
        body: JSON.stringify({ ...(stage ? { stage } : {}), async: true, ...(autoChainTo ? { autoChainTo } : {}) }),
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

      // Async mode: stage(s) running in background — poll until done.
      if (body.async) {
        const targetStageResp: number = body.targetStage;
        const chainEnd: number | null = body.autoChainTo ?? null;
        const stageKey = `stage${targetStageResp}`;

        if (chainEnd) {
          toast({ title: `Running stages ${targetStageResp}–${chainEnd - 1}`, description: "Running the whole pathway end-to-end in the background. It keeps going even if a stage stumbles, so you get a complete first draft to refine." });
        } else {
          toast({ title: `Stage ${targetStageResp} running in background`, description: "Usually 30–90 seconds. Watching for completion…" });
        }

        const pollStart = Date.now();
        // Full end-to-end runs (1→9) can take 10–15 minutes; single stage caps at 5.
        const POLL_TIMEOUT_MS = chainEnd ? 20 * 60 * 1000 : 5 * 60 * 1000;
        let lastPolled: any = null;
        let lastStatus: string | undefined;

        while (Date.now() - pollStart < POLL_TIMEOUT_MS) {
          await new Promise((r) => setTimeout(r, 6000));
          // A newer advanceRun has superseded this one — stop polling.
          if (myToken !== advanceTokenRef.current) return;
          // Tab is hidden — skip this tick instead of hammering the API while
          // the user isn't watching. The list-poll catches them up on return.
          if (typeof document !== "undefined" && document.hidden) continue;
          try {
            const pollRes = await fetch(`/api/property-pathway/${runId}`, { headers: getAuthHeaders(), credentials: "include" });
            if (!pollRes.ok) continue;
            const polled = await pollRes.json();
            if (myToken !== advanceTokenRef.current) return;
            setSelectedRun(polled);
            lastPolled = polled;

            // Don't abort on a failed stage — the server pushes through to the
            // end so we get a full draft. Just wait until the chain reaches the
            // final stage (or every stage has a terminal status).
            if (chainEnd) {
              if (polled.currentStage >= chainEnd) break;
              let allSettled = true;
              for (let s = targetStageResp; s < chainEnd; s++) {
                const st = polled.stageStatus?.[`stage${s}`];
                if (st !== "completed" && st !== "skipped" && st !== "failed") { allSettled = false; break; }
              }
              if (allSettled) break;
            } else {
              lastStatus = polled.stageStatus?.[stageKey];
              if (lastStatus === "completed" || lastStatus === "failed" || lastStatus === "skipped") break;
            }
          } catch {}
        }

        loadRuns();
        if (chainEnd) {
          const failed: number[] = [];
          for (let s = targetStageResp; s < chainEnd; s++) {
            if (lastPolled?.stageStatus?.[`stage${s}`] === "failed") failed.push(s);
          }
          if (failed.length) {
            toast({ title: "Pathway draft ready (with gaps)", description: `Ran the full pathway. Stage${failed.length > 1 ? "s" : ""} ${failed.join(", ")} couldn't complete — everything else is on the board to work with.`, variant: "destructive" });
          } else {
            toast({ title: "Pathway complete", description: "Ran end-to-end through Why Buy. Full draft is on the board — refine the business plan from here." });
          }
        } else {
          const finalResults = lastPolled?.stageResults?.[stageKey] || {};
          if (lastStatus === "skipped") {
            toast({ title: `Stage ${targetStageResp} skipped`, description: finalResults?.reason || "Stage was skipped — see board for details." });
          } else if (lastStatus === "failed") {
            toast({ title: `Stage ${targetStageResp} failed`, description: finalResults?.reason || finalResults?.summary || "See server logs.", variant: "destructive" });
          } else if (lastStatus === "completed") {
            toast({ title: `Stage ${targetStageResp} complete`, description: finalResults?.summary ? String(finalResults.summary).slice(0, 200) : "Findings added to board." });
          } else {
            toast({ title: "Still running", description: "Stage is taking longer than usual. Check the board in a minute.", variant: "destructive" });
          }
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
    <div className="max-w-6xl mx-auto p-4 sm:p-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Property Pathway</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Start an investigation below, or ask ChatBGP ("start a pathway for 12 Haymarket"). Existing runs appear here.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Link href="/pathway-portfolio">
            <Button variant="outline" size="sm" data-testid="button-pathway-portfolio">Portfolio</Button>
          </Link>
          <ReviewQueueButton />
        </div>
      </div>

      {/* Direct start — the board previously only started runs via ChatBGP,
          forcing a context switch for a one-line address (UX #23). */}
      <form
        className="flex items-end gap-2 flex-wrap"
        onSubmit={(e) => { e.preventDefault(); startRun(); }}
        data-testid="pathway-start-form"
      >
        <div className="flex-1 min-w-[220px] max-w-sm">
          <label className="text-xs text-muted-foreground">Address</label>
          <Input value={newAddress} onChange={(e) => setNewAddress(e.target.value)} placeholder="e.g. 12 Haymarket, London" data-testid="input-pathway-address" />
        </div>
        <div className="w-[130px]">
          <label className="text-xs text-muted-foreground">Postcode</label>
          <Input value={newPostcode} onChange={(e) => setNewPostcode(e.target.value)} placeholder="optional" data-testid="input-pathway-postcode" />
        </div>
        <Button type="submit" disabled={!newAddress.trim()} data-testid="button-start-investigation">
          Start investigation
        </Button>
      </form>

      <div>
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <h2 className="text-sm font-medium text-muted-foreground mr-2">Recent investigations</h2>
          {runs.length > 0 && (
            <>
              {[{ key: "all", label: "All" }, { key: "mine", label: "Mine" }, { key: "waiting", label: "Needs sign-off" }, { key: "archived", label: "Archived" }].map(f => (
                <button
                  key={f.key}
                  onClick={() => setOwnerFilter(ownerFilter === f.key ? "all" : f.key)}
                  className={`px-2.5 py-1 rounded-full text-xs border transition ${ownerFilter === f.key ? "bg-foreground text-background border-foreground" : "bg-card text-muted-foreground hover:border-foreground/30"}`}
                  data-testid={`filter-pathway-${f.key}`}
                >
                  {f.label}
                </button>
              ))}
              {ownerOptions.length > 1 && (
                <select
                  value={ownerOptions.some(o => o.id === ownerFilter) ? ownerFilter : ""}
                  onChange={(e) => setOwnerFilter(e.target.value || "all")}
                  className="px-2 py-1 rounded-full text-xs border bg-card text-muted-foreground"
                  data-testid="filter-pathway-owner"
                >
                  <option value="">By person…</option>
                  {ownerOptions.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              )}
            </>
          )}
        </div>
        {initialLoading && runs.length === 0 ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : runs.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            No investigations yet — enter an address above to start one.
          </div>
        ) : visibleRuns.length === 0 ? (
          <div className="text-sm text-muted-foreground">Nothing matches this filter.</div>
        ) : (() => {
          const renderGrid = (rs: PathwayRun[]) => (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {rs.map(r => (
                <PathwayCard
                  key={r.id}
                  run={r}
                  folders={allFolders}
                  currentFolder={folderOf(r)}
                  onSetFolder={(f) => setRunFolder(r.id, f)}
                  onOpen={() => { setSelectedRun(r); navigate(`/property-pathway?runId=${r.id}`); }}
                  onDelete={() => deleteRun(r.id)}
                />
              ))}
            </div>
          );
          const visibleFolders = Array.from(new Set(visibleRuns.map(folderOf).filter(Boolean) as string[])).sort((a, b) => a.localeCompare(b));
          const ungrouped = visibleRuns.filter(r => !folderOf(r));
          if (visibleFolders.length === 0) return renderGrid(visibleRuns);
          return (
            <div className="space-y-6">
              {visibleFolders.map(f => {
                const rs = visibleRuns.filter(r => folderOf(r) === f);
                const collapsed = collapsedFolders.has(f);
                return (
                  <div key={f}>
                    <button
                      onClick={() => setCollapsedFolders(prev => {
                        const next = new Set(prev);
                        if (next.has(f)) next.delete(f); else next.add(f);
                        return next;
                      })}
                      className="flex items-center gap-2 mb-3 text-sm font-medium hover:text-foreground text-foreground/90"
                      data-testid={`folder-header-${f}`}
                    >
                      <FolderOpen className="w-4 h-4 text-muted-foreground" />
                      {f}
                      <span className="text-xs text-muted-foreground font-normal">({rs.length})</span>
                      <span className="text-muted-foreground text-xs">{collapsed ? "▸" : "▾"}</span>
                    </button>
                    {!collapsed && renderGrid(rs)}
                  </div>
                );
              })}
              {ungrouped.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-3 text-sm font-medium text-muted-foreground">
                    Ungrouped <span className="text-xs font-normal">({ungrouped.length})</span>
                  </div>
                  {renderGrid(ungrouped)}
                </div>
              )}
            </div>
          );
        })()}
      </div>
    </div>
  );
}

// Header shortcut to /pathway-review with a live count of runs parked at
// a sign-off gate. Hidden entirely when the queue is empty.
function ReviewQueueButton() {
  const { data } = useQuery<Array<{ runId: string }>>({
    queryKey: ["/api/property-pathway/review-queue"],
    refetchInterval: 60000,
  });
  const count = data?.length || 0;
  if (count === 0) return null;
  return (
    <Link href="/pathway-review">
      <Button variant="outline" size="sm" className="shrink-0 gap-1.5" data-testid="button-review-queue">
        <Check className="w-4 h-4" />
        Review queue
        <Badge variant="secondary" className="ml-1 px-1.5">{count}</Badge>
      </Button>
    </Link>
  );
}

// Recent-investigation card: hero shot at the top, building name as the
// headline, address + last-updated timestamp underneath. No per-stage
// badges on the card itself — those live on the detail view once the
// user clicks in. Delete stays on the card (top-right, hover only).
function PathwayCard({ run, onOpen, onDelete, folders = [], currentFolder = null, onSetFolder }: {
  run: PathwayRun;
  onOpen: () => void;
  onDelete: () => void;
  folders?: string[];
  currentFolder?: string | null;
  onSetFolder?: (folder: string | null) => void;
}) {
  const heading = run.propertyName || run.address || "Untitled";
  const subline = run.propertyName ? run.address : run.postcode || "";
  const updated = run.updatedAt ? new Date(run.updatedAt) : null;
  const updatedStr = updated ? updated.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
  // Live-ness: any stage currently running? Used for a subtle pulse
  // badge so users can spot in-flight runs without the whole card
  // flashing on refetch.
  const anyRunning = Object.values(run.stageStatus || {}).some(s => s === "running");
  const heroUrl = run.heroImageStudioId ? `/api/image-studio/${run.heroImageStudioId}/thumb` : null;
  const gateLabel = awaitingGateLabel(run);
  const disposition = (run.stageResults as any)?._disposition?.status as string | undefined;
  const dispositionLabel = disposition === "offer_made" ? "Offer made"
    : disposition ? disposition.charAt(0).toUpperCase() + disposition.slice(1) : null;

  return (
    <div
      className="group relative rounded-xl border bg-card overflow-hidden hover:shadow-md hover:border-foreground/20 transition cursor-pointer"
      onClick={onOpen}
      data-testid={`card-pathway-${run.id}`}
    >
      <button
        onClick={(e) => { e.stopPropagation(); if (confirm(`Delete pathway run for "${heading}"?`)) onDelete(); }}
        className="absolute top-2 right-2 z-10 p-1.5 rounded-md bg-black/40 text-white opacity-0 group-hover:opacity-100 hover:bg-black/60 transition-opacity"
        title="Delete investigation"
        data-testid={`button-delete-pathway-${run.id}`}
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
      {onSetFolder && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              onClick={(e) => e.stopPropagation()}
              className="absolute top-2 right-10 z-10 p-1.5 rounded-md bg-black/40 text-white opacity-0 group-hover:opacity-100 hover:bg-black/60 transition-opacity"
              title={currentFolder ? `In folder: ${currentFolder}` : "Move to folder"}
              data-testid={`button-folder-pathway-${run.id}`}
            >
              <FolderOpen className="w-3.5 h-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52" onClick={(e) => e.stopPropagation()}>
            {folders.map(f => (
              <DropdownMenuItem key={f} onClick={() => onSetFolder(f)} className={f === currentFolder ? "font-semibold" : undefined}>
                <FolderOpen className="w-3.5 h-3.5 mr-2 text-muted-foreground" />
                {f}{f === currentFolder ? " ✓" : ""}
              </DropdownMenuItem>
            ))}
            {folders.length > 0 && <DropdownMenuSeparator />}
            <DropdownMenuItem onClick={() => {
              const name = window.prompt("New folder / portfolio name:");
              if (name?.trim()) onSetFolder(name.trim());
            }}>
              <Plus className="w-3.5 h-3.5 mr-2 text-muted-foreground" />
              New folder…
            </DropdownMenuItem>
            {currentFolder && (
              <DropdownMenuItem onClick={() => onSetFolder(null)} className="text-muted-foreground">
                Remove from "{currentFolder}"
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      <div className="aspect-[5/3] bg-muted/40 relative overflow-hidden">
        {heroUrl ? (
          <img
            src={heroUrl}
            alt={heading}
            className="w-full h-full object-cover"
            loading="lazy"
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-muted-foreground/40">
            <Building2 className="w-12 h-12" />
          </div>
        )}
        {anyRunning && (
          <span className="absolute bottom-2 left-2 flex items-center gap-1.5 px-2 py-1 rounded-md bg-blue-600/90 text-white text-[10px]">
            <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
            Running
          </span>
        )}
        {!anyRunning && gateLabel && (
          <span className="absolute bottom-2 left-2 px-2 py-1 rounded-md bg-amber-500/90 text-white text-[10px] font-medium">
            {gateLabel}
          </span>
        )}
        {dispositionLabel && (
          <span className={`absolute top-2 left-2 px-2 py-1 rounded-md text-white text-[10px] font-medium ${
            disposition === "pursuing" ? "bg-emerald-600/90"
            : disposition === "offer_made" ? "bg-blue-600/90"
            : "bg-zinc-600/90"
          }`}>
            {dispositionLabel}
          </span>
        )}
      </div>

      <div className="p-3">
        <p className="text-sm font-semibold truncate" title={heading}>{heading}</p>
        {subline && <p className="text-xs text-muted-foreground truncate mt-0.5" title={subline}>{subline}</p>}
        <p className="text-[10px] text-muted-foreground mt-1.5">
          {run.startedByName ? `${run.startedByName} · ` : ""}{updatedStr ? `Updated ${updatedStr}` : ""}
        </p>
      </div>
    </div>
  );
}

function RunDetail({ run, onBack, onAdvance, advancing, onReload, onSetTenant, onDelete }: { run: PathwayRun; onBack: () => void; onAdvance: (stage?: number) => void; advancing: boolean; onReload: () => void; onSetTenant: (name: string) => void; onDelete: () => void }) {
  const [, navigate] = useLocation();
  const [tenantsEditorOpen, setTenantsEditorOpen] = useState(false);
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
  const [emailSortSummary, setEmailSortSummary] = useState<string | null>(null);
  const [manualOwnershipOpen, setManualOwnershipOpen] = useState(false);
  // Re-analyse via the focused investigator returns its own emailHits — keep
  // them so [E#] citations in the fresh markdown reference the right messages
  // (the saved s1.emailHits may be older / different).
  const [emailSortHits, setEmailSortHits] = useState<any[] | null>(null);
  const [emailSorting, setEmailSorting] = useState(false);

  const goCreateComp = () => {
    const params = new URLSearchParams({
      create: "1",
      source: "Pathway",
      sourceUrl: `/property-pathway?runId=${run.id}`,
      sourceTitle: `Pathway: ${run.address}`,
      name: run.address,
    });
    navigate(`/comps?${params.toString()}`);
  };
  const goCreateDocument = () => {
    const params = new URLSearchParams();
    if (run.propertyId) params.set("propertyId", run.propertyId);
    params.set("propertyName", run.propertyName || run.address);
    if (run.postcode) params.set("postcode", run.postcode);
    navigate(`/document-briefs?${params.toString()}`);
  };

  return (
    <div className="max-w-6xl mx-auto p-4 sm:p-6 space-y-4">
      {/* Stacks on phones — the old single row pushed the action buttons
          (incl. Summary PDF) off-screen past the shell's overflow-x clip. */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div className="min-w-0">
          <button onClick={onBack} className="text-xs text-muted-foreground hover:text-foreground mb-1">← All investigations</button>
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight break-words">{run.address}</h1>
          {run.postcode && <p className="text-sm text-muted-foreground">{run.postcode}</p>}
        </div>
        <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap shrink-0">
          <Button
            variant="ghost"
            size="sm"
            className="hidden sm:inline-flex"
            onClick={goCreateComp}
            title="Create a leasing comp pre-filled with this pathway as the source"
            data-testid="button-create-comp-from-pathway"
          >
            <Plus className="w-4 h-4 mr-1" />
            Create comp
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="hidden sm:inline-flex"
            onClick={goCreateDocument}
            title="Open the Document Studio pre-loaded with this property"
            data-testid="button-create-document-from-pathway"
          >
            <FileText className="w-4 h-4 mr-1" />
            Create document
          </Button>
          <Button variant="ghost" size="sm" onClick={() => onAdvance(1)} disabled={advancing} title="Re-scan for new emails, attachments, SharePoint items, and regenerate the briefing">
            {advancing ? <Clock className="w-4 h-4 mr-1 animate-spin" /> : <Search className="w-4 h-4 mr-1" />}
            Refresh
          </Button>
          <Button variant="ghost" size="sm" title="2-page internal summary PDF (Planning / Land Registry / Companies House / Rates links) — on a phone this opens the share sheet so you can send it straight to someone"
            onClick={async () => {
              try {
                const res = await fetch(`/api/property-pathway/${run.id}/summary-pdf`, { headers: getAuthHeaders(), credentials: "include" });
                if (!res.ok) throw new Error(String(res.status));
                const blob = await res.blob();
                const fileName = `Pathway Summary — ${run.address}.pdf`;
                const file = new File([blob], fileName, { type: "application/pdf" });
                // Phones/tablets: native share sheet (WhatsApp / Mail /
                // AirDrop) — the "send the first pass internally" path.
                // window.open after an await is popup-blocked on iOS, which
                // is why the old handler silently did nothing on mobile.
                if (typeof navigator !== "undefined" && navigator.canShare?.({ files: [file] })) {
                  try {
                    await navigator.share({ files: [file], title: fileName });
                    return;
                  } catch (shareErr: any) {
                    if (shareErr?.name === "AbortError") return; // user closed the sheet
                  }
                }
                const url = URL.createObjectURL(blob);
                const coarse = window.matchMedia?.("(pointer: coarse)")?.matches;
                if (coarse) {
                  // Mobile without file-share support: anchor download
                  // (not popup-gated the way window.open is).
                  const a = document.createElement("a");
                  a.href = url; a.download = fileName; a.rel = "noreferrer";
                  document.body.appendChild(a); a.click(); a.remove();
                } else {
                  window.open(url, "_blank");
                }
                setTimeout(() => URL.revokeObjectURL(url), 60000);
              } catch {
                window.open(`/api/property-pathway/${run.id}/summary-pdf`, "_blank");
              }
            }}
            data-testid="button-pathway-summary-pdf"
          >
            <FileText className="w-4 h-4 mr-1" />
            Summary PDF
          </Button>
          <Button variant="ghost" size="sm" onClick={onDelete} className="hidden sm:inline-flex text-muted-foreground hover:text-destructive" title="Delete investigation">
            <Trash2 className="w-4 h-4" />
          </Button>
          {/* Phone overflow — Summary PDF + Refresh stay visible, the rest
              fold here (DESIGN §4: one action row + overflow). */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="sm:hidden" aria-label="More actions" data-testid="button-pathway-more">
                ⋯
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem onClick={goCreateComp}>
                <Plus className="w-3.5 h-3.5 mr-2" /> Create comp
              </DropdownMenuItem>
              <DropdownMenuItem onClick={goCreateDocument}>
                <FileText className="w-3.5 h-3.5 mr-2" /> Create document
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onDelete} className="text-destructive focus:text-destructive">
                <Trash2 className="w-3.5 h-3.5 mr-2" /> Delete investigation
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {/* The big 'Run Stage / Generate' button is gone — every stage
              now auto-runs end-to-end on Pathway start. The 'Refresh'
              button to the left still re-fires Stage 1 (and the chain
              behind it) when new emails / data come in. */}
        </div>
      </div>

      {/* Stage timeline — scrolls horizontally on phones instead of
          crushing nine labelled steps into 390px. */}
      <Card>
        <CardContent className="pt-4">
          <div className="overflow-x-auto">
            <div className="flex items-start justify-between gap-2 min-w-max sm:min-w-0">
              {STAGE_LABELS.map(s => {
                const status = run.stageStatus?.[`stage${s.n}`];
                const Icon = s.icon;
                return (
                  <div key={s.n} className="w-14 flex-none sm:w-auto sm:flex-1 text-center">
                    <div className={`mx-auto w-7 h-7 sm:w-8 sm:h-8 rounded-full flex items-center justify-center mb-1 sm:mb-1.5 ${
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
                    <p className="text-[9px] sm:text-[10px] leading-tight">{s.label}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* CRM + SharePoint folders for this building. One CRM record per
          building (auto-created/linked at Stage 1) — never duplicates. */}
      <PathwayFoldersPanel run={run} />

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
                <div className="flex flex-col sm:flex-row gap-2.5">
                  {(s1.propertyImage?.streetViewUrl || s1.propertyImage?.aerialUrl) && (
                  <div className="flex gap-2.5 shrink-0">
                  {s1.propertyImage?.streetViewUrl && (
                    <a href={s1.propertyImage.googleMapsUrl || "#"} target="_blank" rel="noreferrer" className="block flex-1 sm:flex-none hover:opacity-90 transition-opacity">
                      <img
                        src={s1.propertyImage.streetViewUrl}
                        alt={`Street view of ${run.address}`}
                        className="w-full sm:w-28 h-24 sm:h-20 rounded object-cover border"
                        onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                      />
                    </a>
                  )}
                  {s1.propertyImage?.aerialUrl && (
                    <a href={s1.propertyImage.googleMapsUrl || "#"} target="_blank" rel="noreferrer" className="block flex-1 sm:flex-none hover:opacity-90 transition-opacity">
                      <img
                        src={s1.propertyImage.aerialUrl}
                        alt={`Aerial view of ${run.address}`}
                        className="w-full sm:w-28 h-24 sm:h-20 rounded object-cover border"
                        onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                      />
                    </a>
                  )}
                  </div>
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
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-[9px] uppercase tracking-wide text-muted-foreground">Ownership</p>
                        <button
                          type="button"
                          onClick={() => setManualOwnershipOpen(true)}
                          className="text-[10px] text-primary hover:underline"
                          data-testid="btn-edit-ownership"
                        >
                          {s1.initialOwnership?.manualLock ? "Edit manual title" : (s1.initialOwnership?.titleVerified === false ? "Pick / enter title" : "Override title")}
                        </button>
                      </div>
                      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                        <div className="col-span-2 min-w-0"><span className="text-muted-foreground">Owner:</span> {ownerEl}{ownerCoNumber ? <span className="text-muted-foreground text-[10px] ml-0.5">(Co# {ownerCoNumber})</span> : null}</div>
                        {ownerCommentary && <div className="col-span-2 min-w-0 text-[10px] text-muted-foreground break-words leading-snug">{ownerCommentary}</div>}
                        {ownerCoCommentary && <div className="col-span-2 min-w-0 text-[10px] text-muted-foreground break-words leading-snug">Other proprietors noted: {ownerCoCommentary}</div>}
                        <div className="col-span-2 min-w-0">
                          <span className="text-muted-foreground">Title:</span>{" "}
                          <span className="break-words">{titleEl}</span>
                          {titleNum && s1.initialOwnership?.manualLock && (
                            <Badge variant="outline" className="text-[9px] py-0 ml-1 border-emerald-400 text-emerald-700 bg-emerald-50">
                              Manual
                            </Badge>
                          )}
                          {titleNum && !s1.initialOwnership?.manualLock && s1.initialOwnership?.titleVerified === false && (
                            <Badge variant="outline" className="text-[9px] py-0 ml-1 border-amber-400 text-amber-700 bg-amber-50">
                              Unverified · {s1.initialOwnership?.titleSource || "fallback"}
                            </Badge>
                          )}
                        </div>
                        {titleCommentary && <div className="col-span-2 min-w-0 text-[10px] text-muted-foreground break-words leading-snug">{titleCommentary}</div>}
                        {titleNum && !s1.initialOwnership?.manualLock && s1.initialOwnership?.titleVerified === false && (
                          <div className="col-span-2 min-w-0 text-[10px] text-amber-700 leading-snug">
                            This title was {s1.initialOwnership?.titleSource === "street_number" ? "matched on a street-number filter, not a UPRN lookup" : s1.initialOwnership?.titleSource === "ai" ? "proposed by the AI investigator and not verified against PropertyData" : "from a fallback source"}. Click <strong>Pick / enter title</strong> above to confirm or correct.
                          </div>
                        )}
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

                  // Multi-tenant rendering. Prefer the new tenants[] list;
                  // fall back to the legacy single `tenant` object for old
                  // runs that haven't been migrated yet. Both paths get the
                  // same row UI so the user sees an identical card whether
                  // the data came from AI extraction or a manual edit.
                  const multi: Array<{ name: string; companyNumber?: string; companyId?: string; tradingAs?: string }> = (s1 as any).tenants && (s1 as any).tenants.length > 0
                    ? (s1 as any).tenants
                    : tenant?.name ? [{ name: tenant.name, companyNumber: tenant.companyNumber, companyId: tenant.companyId }] : [];
                  const renderTenant = (t: { name: string; companyNumber?: string; companyId?: string; tradingAs?: string }, idx: number) => {
                    const cleaned = cleanName(t.name);
                    let el: any = cleaned || "—";
                    if (cleaned && t.companyId) {
                      el = <Link href={`/companies/${t.companyId}`}><span className="text-primary hover:underline cursor-pointer font-medium">{cleaned}</span></Link>;
                    } else if (cleaned && t.companyNumber) {
                      el = <a href={`https://find-and-update.company-information.service.gov.uk/company/${t.companyNumber}`} target="_blank" rel="noreferrer" className="text-primary hover:underline font-medium inline-flex items-center gap-0.5">{cleaned}<ExternalLink className="w-2.5 h-2.5" /></a>;
                    } else if (cleaned) {
                      el = <a href={`https://find-and-update.company-information.service.gov.uk/search/companies?q=${encodeURIComponent(cleaned)}`} target="_blank" rel="noreferrer" className="text-primary hover:underline font-medium inline-flex items-center gap-0.5">{cleaned}<ExternalLink className="w-2.5 h-2.5" /></a>;
                    }
                    return (
                      <div key={idx} className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px] border-b border-muted-foreground/10 pb-1 last:border-0 last:pb-0">
                        <div className="min-w-0"><span className="text-muted-foreground">Tenant:</span> {el}</div>
                        {t.companyNumber && <div className={`min-w-0 ${String(t.companyNumber).length > 12 ? "col-span-2" : ""}`}><span className="text-muted-foreground">Co#:</span> <span className="font-medium break-words">{t.companyNumber}</span></div>}
                        {t.tradingAs && t.tradingAs !== t.name && <div className="col-span-2 min-w-0"><span className="text-muted-foreground">Trading as:</span> <span className="font-medium break-words">{t.tradingAs}</span></div>}
                      </div>
                    );
                  };
                  return (
                    <div className="border rounded p-2 bg-muted/20">
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-[9px] uppercase tracking-wide text-muted-foreground">Tenancy{multi.length > 1 ? ` · ${multi.length} tenants` : ""}</p>
                        <button
                          type="button"
                          onClick={() => setTenantsEditorOpen(true)}
                          className="text-[10px] text-primary hover:underline"
                          data-testid="btn-edit-tenants"
                        >
                          Edit{multi.length === 0 ? "" : ` (${multi.length})`}
                        </button>
                      </div>
                      <div className="space-y-1">
                        {multi.length > 0
                          ? multi.map(renderTenant)
                          : <p className="text-[10px] text-muted-foreground">No tenants captured yet. Tap Edit to add.</p>}
                      </div>
                      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] mt-1.5 pt-1.5 border-t border-muted-foreground/10">
                        {s1.aiFacts?.passingRent && <div className="col-span-2 min-w-0"><span className="text-muted-foreground">Rent passing:</span> <span className="font-medium break-words">{s1.aiFacts.passingRent}</span></div>}
                        {tenantCommentary && <div className="col-span-2 min-w-0 text-[10px] text-muted-foreground break-words leading-snug">{tenantCommentary}</div>}
                        {s1.aiFacts?.leaseStatus && <div className="col-span-2 min-w-0"><span className="text-muted-foreground">Status:</span> <span className="font-medium break-words">{s1.aiFacts.leaseStatus}</span></div>}
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
                  <CardTitle className="text-sm flex items-center gap-2"><FolderOpen className="w-4 h-4" /> SharePoint ({s1.sharepointHits.length})</CardTitle>
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
                <CardTitle className="text-sm flex items-center gap-2"><FileText className="w-4 h-4" /> Brochures ({s1.brochureFiles?.length || 0})</CardTitle>
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

            {/* CRM properties — Stage 1 auto-links or auto-creates a CRM
                entry, so this card always has something to show once Stage 1
                has completed. */}
            {s1.crmHits?.properties && s1.crmHits.properties.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2"><Building2 className="w-4 h-4" /> CRM ({s1.crmHits.properties.length})</CardTitle>
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
                    <CardTitle className="text-sm flex items-center gap-2">
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
                  <CardTitle className="text-sm flex items-center gap-2">
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
                  <CardTitle className="text-sm flex items-center gap-2"><Building2 className="w-4 h-4" /> Deals ({s1.deals.length})</CardTitle>
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
                  <CardTitle className="text-sm flex items-center gap-2"><Download className="w-4 h-4" /> Street sales ({s1.pricePaidHistory.length})</CardTitle>
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
                  <CardTitle className="text-sm flex items-center gap-2">
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
                  <CardTitle className="text-sm flex items-center gap-2"><MapPin className="w-4 h-4" /> Units ({s1.tenancy.units.length}) <Badge variant="outline" className="text-[10px] py-0">{s1.tenancy.status}</Badge></CardTitle>
                </CardHeader>
                <CardContent className="text-[11px] space-y-0.5 pb-2">
                  {s1.tenancy.units.slice(0, 20).map((u: any) => (
                    <div key={u.id} className="flex items-center gap-2 py-0.5 border-b last:border-b-0">
                      <span className="truncate flex-1">
                        <span className="font-medium">{u.unitName}</span>
                        {u.floor ? <span className="text-muted-foreground"> · {u.floor}</span> : null}
                        {u.tenantName ? <span className="text-muted-foreground"> — {u.tenantName}</span> : null}
                      </span>
                      {u.sqft ? <span className="text-muted-foreground text-[10px] shrink-0">{u.sqft >= 1000 ? `${Math.round(u.sqft / 1000)}k sf` : `${Math.round(u.sqft)} sf`}</span> : null}
                      {u.passingRentPa ? <span className="text-muted-foreground text-[10px] shrink-0">£{Math.round(u.passingRentPa / 1000)}k pa</span> : null}
                    </div>
                  ))}
                  {s1.tenancy.units.length > 20 && (
                    <p className="text-muted-foreground text-[10px] pt-1">+ {s1.tenancy.units.length - 20} more</p>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Engagements */}
            {s1.engagements && s1.engagements.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2"><ShieldCheck className="w-4 h-4" /> Engaged ({s1.engagements.length})</CardTitle>
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

          {/* Emails — ChatBGP-generated commentary. We hide the raw
              `emailHits` list when commentary is present because those
              hits come from the legacy keyword sweep (just words from
              the address) — they don't match what ChatBGP actually found
              and reading both side-by-side is misleading. The commentary
              is the source of truth; for specifics, ask ChatBGP directly
              via the chat panel. */}
          {(s1.emailCommentary?.markdown || (s1.emailHits && s1.emailHits.length > 0)) && (
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Search className="w-4 h-4" /> Emails
                    {s1.emailCommentary?.generatedAt && (
                      <span className="text-[10px] text-muted-foreground font-normal">
                        — analysed {new Date(s1.emailCommentary.generatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                      </span>
                    )}
                  </CardTitle>
                  <Button
                    variant="outline" size="sm"
                    className="h-6 text-[10px] gap-1"
                    disabled={emailSorting}
                    onClick={async () => {
                      setEmailSorting(true);
                      try {
                        const r = await fetch("/api/pathway/email-sort", {
                          method: "POST", credentials: "include",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            address: run?.address,
                            postcode: run?.postcode,
                            emailHits: s1.emailHits,
                            hints: {
                              tenant: s1.tenant?.name || s1.aiFacts?.mainTenants?.[0],
                              owner: s1.initialOwnership?.proprietorName,
                              proprietorCompany: s1.initialOwnership?.proprietorCompanyNumber,
                            },
                          }),
                        });
                        const d = await r.json();
                        setEmailSortSummary(d.markdown || d.summary || "No summary returned.");
                        if (Array.isArray(d.emailHits)) setEmailSortHits(d.emailHits);
                      } catch { setEmailSortSummary("Failed to analyse emails."); }
                      finally { setEmailSorting(false); }
                    }}
                  >
                    {emailSorting ? "Analysing…" : "Re-analyse"}
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="pb-2">
                {(() => {
                  const md = emailSortSummary || s1.emailCommentary?.markdown;
                  const hitsForCitations = emailSortHits ?? s1.emailHits ?? [];
                  if (!md) {
                    return (
                      <p className="text-[11px] text-muted-foreground italic">
                        No AI commentary yet — click <strong>Re-analyse</strong> to ask ChatBGP what's in the inboxes for this property.
                      </p>
                    );
                  }
                  return (
                    <div className="max-h-[480px] overflow-y-auto pr-1">
                      <EmailCommentary
                        markdown={md}
                        emailHits={hitsForCitations}
                        onOpenEmail={(h) => setOpenEmail({ msgId: h.msgId, mailboxEmail: h.mailboxEmail })}
                      />
                    </div>
                  );
                })()}
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
          {/* Manual ownership / title-pick dialog */}
          <ManualTitleDialog
            run={run}
            open={manualOwnershipOpen}
            onOpenChange={setManualOwnershipOpen}
            onSaved={onReload}
          />
        </>
      )}

      {/* Stage 2 — Brand Intelligence */}
      {s2Status === "skipped" ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2"><Sparkles className="w-4 h-4" /> Brand Intelligence — skipped</CardTitle>
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
            {/* Re-run button removed — Stage 2 auto-runs as part of the
                pathway chain. If it fails, hit Refresh in the header
                to restart from Stage 1. */}
          </CardContent>
        </Card>
      ) : s2 && !s2.skipped ? (
        <Card>
          <CardHeader className="pb-3 flex flex-row items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
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
            <CardTitle className="text-sm flex items-center gap-2">
              <Building2 className="w-4 h-4" /> Property Intelligence
              <span className="text-[10px] text-muted-foreground font-normal ml-2">Virtual — materialise to SharePoint at Investigation Board</span>
              {/* Stage 4 re-run button removed — auto-runs in the chain. */}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
              {/* 01 Ownership — order Title Register / Plan via PropertyData */}
              <OwnershipCard titleNumber={s1?.initialOwnership?.titleNumber} />

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
                                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border uppercase font-medium" title="Reused from a recent Clouseau investigation (within 30 days)">Cached · Clouseau</span>
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

              {/* 03 Planning — hidden by request (the apps feed PlanningDocsCard
                  below which already surfaces the same data). */}

              {/* 04 Planning Documents — spans 2 columns at xl so it fills
                  the row alongside Ownership + Companies House (with 03
                  hidden), and full width at md. */}
              <PlanningDocsCard
                className="md:col-span-2 xl:col-span-2"
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

      {/* Stage 8 Image Studio card retired — imagery is managed inside Why Buy now
          (Manage images button + the deck's inline image edit). */}

      {/* Stage 9 — Why Buy. Renders from stage 7+ so the analyst can set up
          Comps + ERV walk + Covenant inputs before the model is agreed.
          The Claude-designed deck only appears once stage 9 is reached. */}
      {(s7 || s8 || s9) && (
        <WhyBuyCard
          runId={run.id}
          stage9={s9}
          stage1={s1}
          stage7={s7}
          whyBuyComps={(run.stageResults as any)?.whyBuyComps}
          onReload={onReload}
          propertyId={run.propertyId || null}
        />
      )}

      {/* Related Lease Advisory matters — same property anchor */}
      {run.propertyId && <RelatedLeaseAdvisoryMatters propertyId={run.propertyId} />}

      {tenantsEditorOpen && (
        <TenantsEditorDialog
          runId={run.id}
          stage1={s1}
          onClose={() => setTenantsEditorOpen(false)}
          onSaved={() => { setTenantsEditorOpen(false); onReload(); }}
        />
      )}
    </div>
  );
}

// Multi-tenant editor. Reads stage1.tenants (preferred) or seeds from the
// legacy stage1.tenant single object. On save: writes the array back to
// stage1.tenants AND mirrors the first row to stage1.tenant so any consumer
// that hasn't migrated to the array path yet keeps working unchanged.
function TenantsEditorDialog({ runId, stage1, onClose, onSaved }: {
  runId: string;
  stage1: any;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  type Row = {
    id: string;
    name: string;
    companyNumber?: string;
    companyId?: string;
    tradingAs?: string;
    areaSqFt?: string;
    passingRentPA?: string;
    ervPA?: string;
    leaseStart?: string;
    leaseEnd?: string;
    breakDate?: string;
    reviewDate?: string;
    strategy?: string;
  };
  const seedRows = useMemo<Row[]>(() => {
    const existing: any[] = stage1?.tenants && stage1.tenants.length > 0
      ? stage1.tenants
      : stage1?.tenant?.name
        ? [{ name: stage1.tenant.name, companyNumber: stage1.tenant.companyNumber, companyId: stage1.tenant.companyId }]
        : [];
    return existing.map((t: any, i: number) => ({
      id: t.id || `t_${Date.now()}_${i}`,
      name: t.name || "",
      companyNumber: t.companyNumber || "",
      companyId: t.companyId,
      tradingAs: t.tradingAs || "",
      areaSqFt: t.areaSqFt != null ? String(t.areaSqFt) : "",
      passingRentPA: t.passingRentPA != null ? String(t.passingRentPA) : "",
      ervPA: t.ervPA != null ? String(t.ervPA) : "",
      leaseStart: t.leaseStart || "",
      leaseEnd: t.leaseEnd || "",
      breakDate: t.breakDate || "",
      reviewDate: t.reviewDate || "",
      strategy: t.strategy || "",
    }));
  }, [stage1]);
  const [rows, setRows] = useState<Row[]>(seedRows.length > 0 ? seedRows : [{ id: `t_${Date.now()}_0`, name: "" }]);
  const [saving, setSaving] = useState(false);
  const updateRow = (id: string, patch: Partial<Row>) => setRows((p) => p.map((r) => r.id === id ? { ...r, ...patch } : r));
  const addRow = () => setRows((p) => [...p, { id: `t_${Date.now()}_${p.length}`, name: "" }]);
  const removeRow = (id: string) => setRows((p) => p.filter((r) => r.id !== id));
  const save = async () => {
    const valid = rows.filter((r) => r.name.trim());
    if (valid.length === 0) { toast({ title: "Add at least one tenant name", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const runRes = await fetch(`/api/property-pathway/${runId}`, { headers: getAuthHeaders(), credentials: "include" });
      if (!runRes.ok) throw new Error("Could not load run");
      const run = await runRes.json();
      const stageResults = { ...(run.stageResults || {}) };
      const tenants = valid.map((r) => ({
        id: r.id,
        name: r.name.trim(),
        ...(r.companyNumber?.trim() ? { companyNumber: r.companyNumber.trim() } : {}),
        ...(r.companyId ? { companyId: r.companyId } : {}),
        ...(r.tradingAs?.trim() ? { tradingAs: r.tradingAs.trim() } : {}),
        ...(r.areaSqFt?.trim() ? { areaSqFt: Number(r.areaSqFt) } : {}),
        ...(r.passingRentPA?.trim() ? { passingRentPA: Number(r.passingRentPA) } : {}),
        ...(r.ervPA?.trim() ? { ervPA: Number(r.ervPA) } : {}),
        ...(r.leaseStart?.trim() ? { leaseStart: r.leaseStart.trim() } : {}),
        ...(r.leaseEnd?.trim() ? { leaseEnd: r.leaseEnd.trim() } : {}),
        ...(r.breakDate?.trim() ? { breakDate: r.breakDate.trim() } : {}),
        ...(r.reviewDate?.trim() ? { reviewDate: r.reviewDate.trim() } : {}),
        ...(r.strategy?.trim() ? { strategy: r.strategy.trim() } : {}),
      }));
      // Mirror first tenant to the legacy single-tenant slot so old readers
      // (Covenant card, Stage 2 brand intel, deck) keep working until slices
      // 2-5 migrate them onto the array.
      stageResults.stage1 = {
        ...(stageResults.stage1 || {}),
        tenants,
        tenant: { name: tenants[0].name, ...(tenants[0].companyNumber ? { companyNumber: tenants[0].companyNumber } : {}), ...(tenants[0].companyId ? { companyId: tenants[0].companyId } : {}) },
      };
      const res = await fetch(`/api/property-pathway/${runId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        credentials: "include",
        body: JSON.stringify({ stageResults }),
      });
      if (!res.ok) throw new Error("Save failed");
      toast({ title: "Tenants saved", description: `${tenants.length} tenant${tenants.length === 1 ? "" : "s"} on this pathway.` });
      onSaved();
    } catch (e: any) {
      toast({ title: "Save failed", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Tenants on this asset</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          Capture each occupier separately. Covenant cards, Stage 2 enrichment, and the business plan
          will iterate over these. Lease dates accept ISO (2025-01-31) or free text.
        </p>
        <div className="space-y-4">
          {rows.map((r, idx) => (
            <div key={r.id} className="border rounded-md p-3 space-y-2 bg-muted/10">
              <div className="flex items-center justify-between">
                <div className="text-xs font-medium text-muted-foreground">Tenant #{idx + 1}</div>
                <button type="button" className="text-xs text-destructive hover:underline" onClick={() => removeRow(r.id)}>Remove</button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-muted-foreground">Tenant name *</label>
                  <Input value={r.name} onChange={(e) => updateRow(r.id, { name: e.target.value })} className="h-8 text-xs" placeholder="e.g. Costa Limited" />
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground">Companies House #</label>
                  <Input value={r.companyNumber || ""} onChange={(e) => updateRow(r.id, { companyNumber: e.target.value })} className="h-8 text-xs" placeholder="8 digits" />
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground">Trading as</label>
                  <Input value={r.tradingAs || ""} onChange={(e) => updateRow(r.id, { tradingAs: e.target.value })} className="h-8 text-xs" placeholder="Public brand if different" />
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground">Area (sq ft)</label>
                  <Input type="number" value={r.areaSqFt || ""} onChange={(e) => updateRow(r.id, { areaSqFt: e.target.value })} className="h-8 text-xs" />
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground">Passing rent (£ pa)</label>
                  <Input type="number" value={r.passingRentPA || ""} onChange={(e) => updateRow(r.id, { passingRentPA: e.target.value })} className="h-8 text-xs" />
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground">ERV (£ pa)</label>
                  <Input type="number" value={r.ervPA || ""} onChange={(e) => updateRow(r.id, { ervPA: e.target.value })} className="h-8 text-xs" />
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground">Lease start</label>
                  <Input value={r.leaseStart || ""} onChange={(e) => updateRow(r.id, { leaseStart: e.target.value })} className="h-8 text-xs" placeholder="2024-01-01 or Jan 2024" />
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground">Lease end</label>
                  <Input value={r.leaseEnd || ""} onChange={(e) => updateRow(r.id, { leaseEnd: e.target.value })} className="h-8 text-xs" />
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground">Break date</label>
                  <Input value={r.breakDate || ""} onChange={(e) => updateRow(r.id, { breakDate: e.target.value })} className="h-8 text-xs" />
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground">Review date</label>
                  <Input value={r.reviewDate || ""} onChange={(e) => updateRow(r.id, { reviewDate: e.target.value })} className="h-8 text-xs" />
                </div>
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground">Business plan strategy for this tenant</label>
                <textarea
                  value={r.strategy || ""}
                  onChange={(e) => updateRow(r.id, { strategy: e.target.value })}
                  className="w-full text-xs border rounded-md p-2 min-h-[60px] bg-background"
                  placeholder="e.g. Reversionary upside on review; retain on existing terms…"
                />
              </div>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={addRow} className="gap-1.5">
            <Plus className="w-3.5 h-3.5" /> Add tenant
          </Button>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save tenants"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
        <CardTitle className="text-sm flex items-center gap-2">
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
  const planAgreed = !!stage6?.agreed;
  const modelAgreed = !!stage7?.agreed;

  // Tenancy schedule (Why Buy section) is the only place the totals are
  // edited. Its Save fires a regenerate automatically — no manual button
  // needed here.

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
        <CardTitle className="text-sm flex items-center gap-2">
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
          <p className="text-muted-foreground">Excel Model auto-builds from the agreed Business Plan as part of the pathway chain — should appear here shortly.</p>
        )}
        {stage7?.modelRunId && (
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
            <InfoBlock label="Model run" value={stage7.modelRunName || stage7.modelRunId} />
            <InfoBlock label="Version" value={stage7.modelVersionLabel || stage7.modelVersionId || "—"} />
            <InfoBlock label="Status" value={modelAgreed ? "Agreed" : "Drafting in Excel"} />
          </div>
        )}

        {/* Schedule-driven model — no inputs or buttons here. Saving the
            Tenancy schedule below auto-regenerates the model from the new
            totals. */}
        {stage7?.modelRunId && !modelAgreed && (
          <p className="mt-3 text-xs text-muted-foreground border rounded-lg p-3 bg-muted/30">
            Model rebuilds automatically when you save the Tenancy schedule below
            {(stage7.overrideTotalAreaSqFt || stage7.totalAreaSqFt) ? ` — currently ${Number(stage7.overrideTotalAreaSqFt || stage7.totalAreaSqFt).toLocaleString()} sq ft` : ""}
            {(stage7.overrideCurrentRentPA || stage7.currentRentPA) ? ` · £${Number(stage7.overrideCurrentRentPA || stage7.currentRentPA).toLocaleString()} pa passing` : ""}.
          </p>
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

/**
 * Linked-CRM + SharePoint folder tree on the pathway page. Surfaces the
 * CRM property the pathway is anchored to (auto-created at Stage 1 by
 * `ensureCrmPropertyLink` if no match was found) and renders its folder
 * tree using the same `PropertyFoldersPanel` the property detail page uses.
 *
 * Rules:
 *  - If `run.propertyId` is set → fetch that CRM record, render its
 *    folders. There's only ever one CRM property per building (the auto-
 *    create logic dedupes via crm_lookup), so we never spawn a second
 *    folder tree from the pathway.
 *  - If `run.propertyId` is null (only happens on a fresh run before
 *    Stage 1 has completed) → prompt the user to run Stage 1, which
 *    auto-creates the CRM + links it.
 *  - Folder tree itself is created on-demand via the existing
 *    SetUpFoldersDialog (POST /api/microsoft/property-folders) — same UX
 *    as the property detail page's "Set Up Folders" button.
 */
function PathwayFoldersPanel({ run }: { run: PathwayRun }) {
  const [folderDialogOpen, setFolderDialogOpen] = useState(false);
  const [relinkOpen, setRelinkOpen] = useState(false);

  const { data: property, isLoading } = useQuery<any>({
    queryKey: ["/api/crm/properties", run.propertyId],
    queryFn: async () => {
      if (!run.propertyId) return null;
      const r = await fetch(`/api/crm/properties/${run.propertyId}`, {
        credentials: "include",
        headers: getAuthHeaders(),
      });
      if (!r.ok) return null;
      return r.json();
    },
    enabled: !!run.propertyId,
  });

  if (!run.propertyId) {
    return (
      <>
        <RelinkCrmDialog runId={run.id} open={relinkOpen} onOpenChange={setRelinkOpen} initialQuery={run.address} />
        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between gap-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <FolderOpen className="w-4 h-4" /> CRM & Folders
            </CardTitle>
            <Button variant="outline" size="sm" className="h-7 text-[11px]" onClick={() => setRelinkOpen(true)}>
              Link to CRM
            </Button>
          </CardHeader>
          <CardContent className="text-[12px] text-muted-foreground">
            <p>This investigation isn't linked to a CRM property yet.</p>
            <p className="mt-1">Run Stage 1 — it auto-creates a CRM record (or links to an existing one for this address) — or click <strong>Link to CRM</strong> above to pick the right record manually.</p>
          </CardContent>
        </Card>
      </>
    );
  }

  if (isLoading || !property) {
    return (
      <Card>
        <CardContent className="p-3 space-y-2">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-20 w-full" />
        </CardContent>
      </Card>
    );
  }

  const folderTeams: string[] = property.folderTeams || [];
  const hasFolderTree = folderTeams.length > 0;

  return (
    <>
      <SetUpFoldersDialog
        propertyId={property.id}
        propertyName={property.name}
        folderTeams={folderTeams}
        open={folderDialogOpen}
        onOpenChange={setFolderDialogOpen}
      />
      <RelinkCrmDialog runId={run.id} open={relinkOpen} onOpenChange={setRelinkOpen} initialQuery={run.address} />
      <Card>
        <CardHeader className="pb-2 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <CardTitle className="text-sm flex items-center gap-2 min-w-0 flex-wrap">
            <FolderOpen className="w-4 h-4 shrink-0" />
            <Link href={`/properties/${property.id}`}>
              <span className="text-primary hover:underline cursor-pointer inline-flex items-center gap-1 min-w-0">
                <span className="truncate max-w-[14rem]">{property.name}</span>
                <ExternalLink className="w-3 h-3 shrink-0" />
              </span>
            </Link>
            {!hasFolderTree && (
              <Badge variant="outline" className="text-[9px] py-0">No folders yet</Badge>
            )}
          </CardTitle>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-[11px] text-muted-foreground hover:text-foreground"
              onClick={() => setRelinkOpen(true)}
              title="Link this pathway to a different CRM property"
            >
              Wrong building?
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-[11px] gap-1"
              onClick={() => setFolderDialogOpen(true)}
            >
              <FolderOpen className="w-3 h-3" />
              {hasFolderTree ? "Manage folders" : "Set up folders"}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          {hasFolderTree ? (
            <PropertyFoldersPanel
              propertyName={property.name}
              folderTeams={folderTeams}
              sharepointFolderUrl={property.sharepointFolderUrl}
            />
          ) : (
            <p className="text-[11px] text-muted-foreground">
              No SharePoint folders set up for this building yet. Click <strong>Set up folders</strong> above to create the standard folder tree (Legal & Title, Due Diligence, KYC & AML, Comparables, etc.) — you can then save scraped planning PDFs and other investigation files into it.
            </p>
          )}
        </CardContent>
      </Card>
    </>
  );
}

function RelinkCrmDialog({
  runId,
  open,
  onOpenChange,
  initialQuery,
}: {
  runId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initialQuery: string;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [submitting, setSubmitting] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  useEffect(() => {
    if (open) setQuery(initialQuery);
  }, [open, initialQuery]);

  const { data: results, isFetching } = useQuery<any[]>({
    queryKey: ["/api/crm/properties", { search: query.trim() }],
    queryFn: async () => {
      const q = query.trim();
      if (q.length < 2) return [];
      const r = await fetch(`/api/crm/properties?search=${encodeURIComponent(q)}&limit=20`, {
        credentials: "include",
        headers: getAuthHeaders(),
      });
      if (!r.ok) return [];
      const data = await r.json();
      return Array.isArray(data) ? data : data.data || [];
    },
    enabled: open && query.trim().length >= 2,
  });

  async function relink(propertyId: string | null) {
    setSubmitting(true);
    try {
      const r = await fetch(`/api/property-pathway/${runId}/relink-crm`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ propertyId }),
      });
      if (!r.ok) throw new Error(`Relink failed: ${r.status}`);
      await queryClient.invalidateQueries({ queryKey: ["/api/property-pathway"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/crm/properties"] });
      toast({ title: propertyId ? "Re-linked" : "Unlinked", description: "Folders will refresh from the new CRM record." });
      onOpenChange(false);
    } catch (err: any) {
      toast({ title: "Re-link failed", description: err?.message || "Unknown error", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Link pathway to a CRM property</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Input
            placeholder="Search by address, postcode, or name…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
          <div className="max-h-72 overflow-y-auto border rounded-md divide-y">
            {isFetching && <p className="text-[12px] text-muted-foreground p-3">Searching…</p>}
            {!isFetching && (results || []).length === 0 && query.trim().length >= 2 && (
              <p className="text-[12px] text-muted-foreground p-3">No matches.</p>
            )}
            {(results || []).map((p: any) => (
              <button
                key={p.id}
                type="button"
                disabled={submitting}
                onClick={() => relink(p.id)}
                className="w-full text-left p-2 hover:bg-muted/50 disabled:opacity-50 transition-colors"
              >
                <div className="text-[13px] font-medium">{p.name}</div>
                <div className="text-[11px] text-muted-foreground">
                  {p.postcode || (p.address as any)?.formatted || ""}
                  {p.assetClass ? ` · ${p.assetClass}` : ""}
                </div>
              </button>
            ))}
          </div>
          <div className="flex justify-between gap-2 pt-1">
            <Button
              variant="ghost"
              size="sm"
              disabled={submitting}
              onClick={() => relink(null)}
            >
              Unlink
            </Button>
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={submitting}>
              Cancel
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Manual title override. Used when the resolver couldn't UPRN-verify the
// title — the user picks one from the candidate list (resolver matched +
// fallback + postcode neighbours) or types one in. Saves to the pathway
// stage1.initialOwnership with manualLock so Stage 1 re-runs preserve it,
// and mirrors title + proprietor onto the linked CRM property.
function ManualTitleDialog({
  run,
  open,
  onOpenChange,
  onSaved,
}: {
  run: PathwayRun;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [titleNumber, setTitleNumber] = useState("");
  const [proprietorName, setProprietorName] = useState("");
  const [proprietorCo, setProprietorCo] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const existing = (run.stageResults as any)?.stage1?.initialOwnership;
  const existingTitle = (existing?.titleNumber || "").trim();
  const existingTitleClean = existingTitle && existingTitle !== "unknown" ? existingTitle : "";

  // Pre-fill from whatever's currently set when the dialog opens.
  useEffect(() => {
    if (!open) return;
    setTitleNumber(existingTitleClean);
    setProprietorName((existing?.proprietorName || "").trim());
    setProprietorCo((existing?.proprietorCompanyNumber || "").trim());
  }, [open, existingTitleClean, existing?.proprietorName, existing?.proprietorCompanyNumber]);

  // Re-run the resolver (skipPersist on the server side via /resolve writes
  // a row, but it dedupes by user/run — fine to call) to populate candidate
  // lists. Cached by react-query so reopening the dialog is instant.
  const { data: candidates, isFetching } = useQuery<any>({
    queryKey: ["/api/land-registry/resolve", run.address, run.postcode, run.propertyId],
    queryFn: async () => {
      const r = await fetch("/api/land-registry/resolve", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        // propertyId → server looks up the resolver-canonical UPRN so
        // PropertyData uprn-title returns titles for THIS building, not
        // every freehold in the postcode.
        body: JSON.stringify({ address: run.address, postcode: run.postcode, source: "pathway-manual", pathwayRunId: run.id, propertyId: run.propertyId || undefined }),
      });
      if (!r.ok) return null;
      return r.json();
    },
    enabled: open,
    staleTime: 5 * 60 * 1000,
  });

  function pick(row: any) {
    setTitleNumber(row.title_number || row.titleNumber || "");
    setProprietorName(row.proprietor_name_1 || row.proprietor || "");
  }

  async function save() {
    setSubmitting(true);
    try {
      const r = await fetch(`/api/property-pathway/${run.id}/ownership`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({
          titleNumber: titleNumber.trim(),
          proprietorName: proprietorName.trim() || undefined,
          proprietorCompanyNumber: proprietorCo.trim() || undefined,
        }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error || `Save failed (${r.status})`);
      }
      await queryClient.invalidateQueries({ queryKey: ["/api/property-pathway"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/crm/properties"] });
      toast({ title: "Title saved", description: "Manual override locked — Stage 1 re-runs will preserve it." });
      onOpenChange(false);
      onSaved();
    } catch (err: any) {
      toast({ title: "Save failed", description: err?.message || "Unknown error", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  async function clearOverride() {
    setSubmitting(true);
    try {
      const r = await fetch(`/api/property-pathway/${run.id}/ownership`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ clear: true }),
      });
      if (!r.ok) throw new Error(`Clear failed (${r.status})`);
      await queryClient.invalidateQueries({ queryKey: ["/api/property-pathway"] });
      toast({ title: "Override cleared", description: "Re-run Stage 1 to refresh ownership." });
      onOpenChange(false);
      onSaved();
    } catch (err: any) {
      toast({ title: "Clear failed", description: err?.message || "Unknown error", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  const matched: any[] = candidates?.matched?.freeholds || [];
  const fallback: any[] = candidates?.fallback?.freeholds || [];
  const context: any[] = candidates?.context?.freeholds || [];

  const renderRow = (row: any, label?: string) => (
    <button
      key={`${row.title_number}-${label}`}
      type="button"
      disabled={submitting}
      onClick={() => pick(row)}
      className="w-full text-left p-2 hover:bg-muted/50 disabled:opacity-50 transition-colors border-b last:border-b-0"
    >
      <div className="flex items-center gap-2">
        <span className="text-[12px] font-mono font-semibold">{row.title_number}</span>
        {label && <Badge variant="outline" className="text-[8px] py-0 px-1">{label}</Badge>}
      </div>
      <div className="text-[11px] text-muted-foreground truncate">{row.proprietor_name_1 || "(no proprietor)"}</div>
      {row.property && (
        <div className="text-[10px] text-muted-foreground/80 truncate">
          {Array.isArray(row.property) ? row.property.join(", ") : row.property}
        </div>
      )}
    </button>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Set the official title for {run.address}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 min-w-0">
          <p className="text-[12px] text-muted-foreground">
            Pick a candidate from the list below or type/paste the title number you have from another source. The override is mirrored onto the linked CRM property and locks Stage 1 from overwriting it on a re-run.
          </p>

          <div className="border rounded-md max-h-56 overflow-y-auto">
            {isFetching && <p className="text-[12px] text-muted-foreground p-3">Loading candidates…</p>}
            {!isFetching && matched.length === 0 && fallback.length === 0 && context.length === 0 && (
              <p className="text-[12px] text-muted-foreground p-3">No candidates returned by the resolver — type the title manually below.</p>
            )}
            {matched.map(r => renderRow(r, "UPRN match"))}
            {fallback.map(r => renderRow(r, "Street-number match"))}
            {context.slice(0, 8).map(r => renderRow(r, "Same postcode"))}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div className="sm:col-span-2">
              <label className="text-[11px] text-muted-foreground">Title number</label>
              <Input value={titleNumber} onChange={(e) => setTitleNumber(e.target.value.toUpperCase())} placeholder="e.g. NGL939200" data-testid="input-title-number" />
            </div>
            <div>
              <label className="text-[11px] text-muted-foreground">Proprietor name</label>
              <Input value={proprietorName} onChange={(e) => setProprietorName(e.target.value)} placeholder="e.g. Amsprop Estates Ltd" />
            </div>
            <div>
              <label className="text-[11px] text-muted-foreground">Co. number (optional)</label>
              <Input value={proprietorCo} onChange={(e) => setProprietorCo(e.target.value.toUpperCase())} placeholder="e.g. 01690503" />
            </div>
          </div>

          <div className="flex justify-between gap-2 pt-1">
            {existing?.manualLock ? (
              <Button variant="ghost" size="sm" disabled={submitting} onClick={clearOverride}>
                Clear manual override
              </Button>
            ) : <span />}
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={submitting}>Cancel</Button>
              <Button size="sm" onClick={save} disabled={submitting || !titleNumber.trim()}>
                {submitting ? "Saving…" : "Save & lock"}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function OwnershipCard({ titleNumber }: { titleNumber?: string | null }) {
  const { toast } = useToast();
  const [ordering, setOrdering] = useState<string | null>(null);

  // Stage 1's AI sometimes stuffs commentary into titleNumber; pull the bare ref.
  const cleanTitle = (raw?: string | null): string => {
    if (!raw) return "";
    const m = String(raw).match(/\b([A-Z]{1,3}\d{3,7})\b/);
    return m ? m[1] : "";
  };
  const title = cleanTitle(titleNumber);

  const orderDoc = async (docType: "register" | "plan") => {
    if (!title) return;
    setOrdering(docType);
    try {
      const res = await fetch("/api/title-search/download-document", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        credentials: "include",
        body: JSON.stringify({ title, document: docType }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: "Order unavailable", description: data.error || "Could not order document", variant: "destructive" });
        return;
      }
      if (data.documentUrl) {
        window.open(data.documentUrl, "_blank");
        const priceStr = data.price?.total_gbp ? ` (£${data.price.total_gbp} inc. VAT)` : "";
        const docLabel = docType === "plan" ? "Title Plan" : "Title Register";
        toast({ title: "Document ready", description: `${docLabel} for ${title} opened${priceStr}` });
      } else {
        toast({ title: "Document not ready", description: data.documentStatus || "Please try again shortly" });
      }
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setOrdering(null);
    }
  };

  const slots: Array<{ label: string; kind: "register" | "plan" | "leases" }> = [
    { label: "Title Register (OC1)", kind: "register" },
    { label: "Title Plan (OC2)", kind: "plan" },
    { label: "Filed Leases", kind: "leases" },
  ];

  return (
    <div className="border rounded p-2.5 bg-muted/10">
      <div className="flex items-center justify-between mb-1.5">
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">01 Ownership</p>
        {title && <span className="text-[10px] text-muted-foreground font-mono">{title}</span>}
      </div>
      <div className="space-y-1 text-[11px]">
        {slots.map((slot) => {
          const isOrderable = slot.kind === "register" || slot.kind === "plan";
          const enabled = isOrderable && !!title && ordering === null;
          const isLoading = ordering === slot.kind;
          const tooltip = !title
            ? "No title number resolved at Stage 1 yet"
            : !isOrderable
              ? "Filed leases not available via PropertyData"
              : `Order ${slot.label} from PropertyData (£7.50 + VAT)`;
          return (
            <div key={slot.kind} className="flex items-center justify-between py-1 border-b last:border-b-0">
              <span className="text-muted-foreground truncate">{slot.label}</span>
              {slot.kind === "register" && title ? (
                // The register IS the OC1 — order it straight from HM Land Registry.
                <OfficialCopyButton titleNumber={title} label="Order" size="sm" className="text-[10px] h-6 px-1.5" />
              ) : (
                <button
                  type="button"
                  disabled={!enabled}
                  onClick={isOrderable ? () => orderDoc(slot.kind as "register" | "plan") : undefined}
                  title={tooltip}
                  className={`text-[10px] px-1.5 py-0.5 rounded border inline-flex items-center gap-1 ${
                    enabled
                      ? "bg-primary/10 text-primary border-primary/30 hover:bg-primary/20"
                      : "bg-muted/20 text-muted-foreground cursor-not-allowed"
                  }`}
                >
                  {isLoading && <Loader2 className="w-2.5 h-2.5 animate-spin" />}
                  {isLoading ? "Ordering" : "Order"}
                </button>
              )}
            </div>
          );
        })}
      </div>
      {!title && (
        <p className="mt-1.5 text-[10px] text-muted-foreground italic">Run Stage 1 to resolve a title number first.</p>
      )}
    </div>
  );
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
        className="w-full flex items-start gap-2 py-2 px-1 hover:bg-muted/30 text-left leading-relaxed"
      >
        {expanded ? <ChevronDown className="w-3 h-3 mt-1 shrink-0 text-muted-foreground" /> : <ChevronRight className="w-3 h-3 mt-1 shrink-0 text-muted-foreground" />}
        <span className="text-[10px] text-muted-foreground shrink-0 w-16 mt-0.5">{dateStr ? dateStr.slice(0, 10) : ""}</span>
        {lpa && <span className="text-[8px] px-1 py-0.5 rounded bg-muted text-muted-foreground uppercase font-medium shrink-0 mt-0.5" title={p.lpa}>{lpa}</span>}
        <span className="flex-1 min-w-0">
          <span className="font-medium break-all">{p.reference}</span>
          {p.status && <span className={`ml-1 text-[9px] px-1 py-0.5 rounded uppercase tracking-wide ${statusTone(p.status)}`}>{p.status}</span>}
          <span className="block text-muted-foreground truncate mt-0.5">{p.description || ""}</span>
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

/**
 * RelatedLeaseAdvisoryMatters — lists any PLA matters that share the same
 * canonical property as this Pathway run. Stops Pathway being blind to
 * an existing rent-review / dilapidations / lease-renewal advisory matter
 * already open against this asset.
 */
function RelatedLeaseAdvisoryMatters({ propertyId }: { propertyId: string }) {
  const { data: matters = [] } = useQuery<Array<{ id: string; matterType: string; status: string; actingFor: string | null; updatedAt: string }>>({
    queryKey: ["/api/pla/matters", { propertyId, includeClosed: true }],
    queryFn: async () => {
      const r = await fetch(`/api/pla/matters?propertyId=${propertyId}&includeClosed=true`, {
        credentials: "include",
        headers: getAuthHeaders(),
      });
      if (!r.ok) return [];
      return r.json();
    },
  });
  if (matters.length === 0) return null;
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2"><Briefcase className="w-4 h-4" /> Related Lease Advisory matters · {matters.length}</CardTitle>
      </CardHeader>
      <CardContent className="text-sm space-y-1">
        {matters.map((m) => (
          <a
            key={m.id}
            href={`/pla/matters/${m.id}`}
            className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-accent border-b border-border last:border-0"
          >
            <span className="capitalize">{m.matterType.replace(/_/g, " ")}</span>
            <span className="flex items-center gap-2 text-xs text-muted-foreground">
              {m.actingFor && <Badge variant="outline" className="capitalize">{m.actingFor}</Badge>}
              <Badge variant="outline" className="capitalize">{m.status.replace(/_/g, " ")}</Badge>
            </span>
          </a>
        ))}
      </CardContent>
    </Card>
  );
}

function WhyBuyChartsCard({ runId, propertyId, passingRent, erv, area, tenants }: {
  runId: string;
  propertyId: string | null;
  passingRent?: number;
  erv?: number;
  area?: number;
  tenants: Array<{ id?: string; name?: string; companyNumber?: string }>;
}) {
  const { toast } = useToast();
  const tenantOptions = tenants.filter((t) => (t?.name || "").trim());
  // covBusy tracks per-tenant generation so each row can show its own
  // spinner; "all" is the "Generate all" batch button. ervBusy is its own
  // boolean since the ERV walk is a single chart per property.
  const [ervBusy, setErvBusy] = useState(false);
  const [covBusy, setCovBusy] = useState<Set<string>>(new Set());
  const [allBusy, setAllBusy] = useState(false);

  const p = Number(passingRent || 0);
  const e = Number(erv || 0);
  const ervReady = p > 0 && e > 0;

  const genErv = async () => {
    if (!propertyId) { toast({ title: "No property linked", description: "Stage 1 needs to resolve the property first.", variant: "destructive" }); return; }
    if (!ervReady) { toast({ title: "Add ERV to the tenancy schedule", description: "Each occupier needs a Rent (£ pa) and an ERV (£ pa) for the chart to compute.", variant: "destructive" }); return; }
    setErvBusy(true);
    try {
      const r = await fetch(`/api/property-imagery/${propertyId}/compose/erv-walk`, {
        method: "POST", headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ passingRentPa: p, ervPa: e, areaSqft: area || undefined, pathwayRunId: runId }),
      });
      if (!r.ok) throw new Error(await r.text());
      toast({ title: "ERV walk generated", description: "Saved to the Why Buy imagery." });
    } catch (err: any) { toast({ title: "ERV walk failed", description: err?.message || "", variant: "destructive" }); }
    finally { setErvBusy(false); }
  };

  // Generate one covenant card for a single tenant. Used both by the
  // per-row buttons and the Generate-all batch. Returns the tenant name
  // on success so the batch can summarise results.
  const genCovOne = async (t: { id?: string; name?: string; companyNumber?: string }): Promise<{ ok: boolean; name: string; err?: string }> => {
    if (!propertyId) return { ok: false, name: t.name || "", err: "No property linked" };
    const name = (t.name || "").trim();
    if (!name) return { ok: false, name: "", err: "Missing name" };
    try {
      const r = await fetch(`/api/property-imagery/${propertyId}/compose/covenant-card-auto`, {
        method: "POST", headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          tenantName: name,
          companiesHouseNumber: t.companyNumber?.trim() || undefined,
          pathwayRunId: runId,
        }),
      });
      if (!r.ok) return { ok: false, name, err: await r.text() };
      return { ok: true, name };
    } catch (err: any) { return { ok: false, name, err: err?.message || "" }; }
  };

  const genCov = async (t: { id?: string; name?: string; companyNumber?: string }) => {
    const key = t.id || t.name || "";
    setCovBusy((s) => new Set(s).add(key));
    const res = await genCovOne(t);
    setCovBusy((s) => { const n = new Set(s); n.delete(key); return n; });
    if (res.ok) toast({ title: "Covenant card generated", description: `For ${res.name} — saved to Why Buy imagery.` });
    else toast({ title: "Covenant card failed", description: res.err || "", variant: "destructive" });
  };

  const genCovAll = async () => {
    if (tenantOptions.length === 0) { toast({ title: "Add a tenant to the schedule first", variant: "destructive" }); return; }
    setAllBusy(true);
    // Run them sequentially so the Companies House lookups inside don't
    // stampede the rate limit. Slower but safer for a multi-let.
    const results: Array<{ ok: boolean; name: string; err?: string }> = [];
    for (const t of tenantOptions) results.push(await genCovOne(t));
    setAllBusy(false);
    const okCount = results.filter((r) => r.ok).length;
    const failCount = results.length - okCount;
    toast({
      title: failCount === 0 ? "Covenant cards generated" : `Covenant cards: ${okCount}/${results.length}`,
      description: failCount === 0
        ? `${okCount} card${okCount === 1 ? "" : "s"} saved to Why Buy imagery.`
        : `Failed: ${results.filter((r) => !r.ok).map((r) => r.name).join(", ")}`,
      variant: failCount === 0 ? "default" : "destructive",
    });
  };

  const fmtGbp = (n: number) => `£${n.toLocaleString()}`;
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2"><FileSpreadsheet className="w-4 h-4" /> Charts & cards</CardTitle>
      </CardHeader>
      <CardContent className="text-sm">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="space-y-2">
            <p className="text-[11px] uppercase tracking-wide font-semibold text-muted-foreground">ERV walk</p>
            <p className="text-[11px] text-muted-foreground">
              Chart that "walks" from passing rent up to ERV — shows the reversion potential.
            </p>
            <div className="text-xs border rounded px-2 py-1.5 bg-muted/40">
              {ervReady
                ? <>From <span className="font-medium">{fmtGbp(p)} passing</span> → <span className="font-medium">{fmtGbp(e)} ERV</span> (tenancy schedule totals)</>
                : <span className="text-amber-700">Add Rent + ERV per occupier in the tenancy schedule below first.</span>}
            </div>
            <Button size="sm" onClick={genErv} disabled={ervBusy || !ervReady} className="gap-1.5">
              {ervBusy ? <Clock className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />} Generate ERV walk
            </Button>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-[11px] uppercase tracking-wide font-semibold text-muted-foreground">Covenant cards</p>
              {tenantOptions.length > 1 && (
                <Button size="sm" variant="outline" onClick={genCovAll} disabled={allBusy || covBusy.size > 0} className="gap-1.5 h-7 text-xs">
                  {allBusy ? <Clock className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />} Generate all ({tenantOptions.length})
                </Button>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground">
              One card per occupier. Tenant + Companies House link + AML status.
            </p>
            {tenantOptions.length === 0 ? (
              <div className="text-xs border rounded px-2 py-1.5 bg-muted/40 text-amber-700">
                Add an occupier in the tenancy schedule below first.
              </div>
            ) : (
              <div className="border rounded divide-y max-h-48 overflow-y-auto">
                {tenantOptions.map((t, i) => {
                  const key = t.id || t.name || String(i);
                  const busy = allBusy || covBusy.has(key);
                  return (
                    <div key={key} className="flex items-center justify-between gap-2 p-1.5">
                      <div className="text-xs min-w-0 flex-1">
                        <div className="font-medium truncate">{t.name}</div>
                        {t.companyNumber && <div className="text-[10px] text-muted-foreground">CH {t.companyNumber}</div>}
                      </div>
                      <Button size="sm" variant="outline" onClick={() => genCov(t)} disabled={busy} className="gap-1 h-6 text-[11px] shrink-0">
                        {busy ? <Clock className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />} Generate
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function WhyBuyCompsCard({ runId, propertyId, whyBuyComps, onReload }: { runId: string; propertyId: string | null; whyBuyComps: any; onReload: () => void }) {
  const { toast } = useToast();
  const [investment, setInvestment] = useState<any[]>(whyBuyComps?.investment || []);
  const [leasing, setLeasing] = useState<any[]>(whyBuyComps?.leasing || []);
  const [busy, setBusy] = useState<"match" | "save" | null>(null);
  const [charting, setCharting] = useState<"investment" | "leasing" | null>(null);
  const numOf = (v: any) => { const n = parseFloat(String(v ?? "").replace(/[^0-9.]/g, "")); return isFinite(n) ? n : 0; };

  const genChart = async (kind: "investment" | "leasing") => {
    if (!propertyId) { toast({ title: "No property linked", description: "Stage 1 needs to resolve the property first.", variant: "destructive" }); return; }
    const list = kind === "investment" ? investment : leasing;
    const comps = list.map((c) => ({
      label: `${String(c.address || c.tenant || "?").slice(0, 30)}${c.date ? " — " + c.date : ""}`,
      psf: kind === "investment" ? numOf(c.price) : numOf(c.rent),
      note: c.note || "",
    })).filter((c) => c.psf > 0);
    if (comps.length === 0) { toast({ title: "Nothing to chart", description: "Add comps with a price/rent value first.", variant: "destructive" }); return; }
    setCharting(kind);
    try {
      const r = await fetch(`/api/property-imagery/${propertyId}/compose/comps-chart`, {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ comps, pathwayRunId: runId, title: kind === "investment" ? "Investment Comparables" : "Leasing Comparables", unit: kind === "investment" ? "£ capital" : "£ rent pa" }),
      });
      if (!r.ok) throw new Error(await r.text());
      toast({ title: "Comps chart generated", description: "Saved to the Why Buy imagery — it'll show in the deck." });
      onReload();
    } catch (e: any) { toast({ title: "Chart failed", description: e?.message || "", variant: "destructive" }); }
    finally { setCharting(null); }
  };
  const [addFor, setAddFor] = useState<"investment" | "leasing" | null>(null);
  const [board, setBoard] = useState<any[]>([]);
  const [boardQ, setBoardQ] = useState("");
  const [boardLoading, setBoardLoading] = useState(false);

  useEffect(() => {
    setInvestment(whyBuyComps?.investment || []);
    setLeasing(whyBuyComps?.leasing || []);
  }, [whyBuyComps]);

  const match = async () => {
    setBusy("match");
    try {
      const r = await fetch(`/api/property-pathway/${runId}/comps/match`, { method: "POST", headers: { ...getAuthHeaders(), "Content-Type": "application/json" } });
      if (!r.ok) throw new Error(await r.text());
      const data = await r.json();
      setInvestment(data.investment || []);
      setLeasing(data.leasing || []);
      toast({ title: "Comps matched", description: `${(data.investment || []).length} investment, ${(data.leasing || []).length} leasing — review, edit, then Save.` });
    } catch (e: any) { toast({ title: "Match failed", description: e?.message || "", variant: "destructive" }); }
    finally { setBusy(null); }
  };

  const save = async () => {
    setBusy("save");
    try {
      const r = await fetch(`/api/property-pathway/${runId}/comps`, { method: "PATCH", headers: { ...getAuthHeaders(), "Content-Type": "application/json" }, body: JSON.stringify({ investment, leasing }) });
      if (!r.ok) throw new Error(await r.text());
      toast({ title: "Comps saved", description: "These now feed the Why Buy deck." });
      onReload();
    } catch (e: any) { toast({ title: "Save failed", description: e?.message || "", variant: "destructive" }); }
    finally { setBusy(null); }
  };

  const openAdd = async (kind: "investment" | "leasing") => {
    setAddFor(kind); setBoard([]); setBoardQ(""); setBoardLoading(true);
    try {
      const url = kind === "investment" ? "/api/investment-comps" : "/api/crm/comps";
      const r = await fetch(url, { headers: getAuthHeaders(), credentials: "include" });
      const data = await r.json();
      setBoard(Array.isArray(data) ? data : (data.comps || data.rows || []));
    } catch { setBoard([]); } finally { setBoardLoading(false); }
  };

  const addFromBoard = (row: any) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    if (addFor === "investment") {
      setInvestment((p) => [...p, { id, kind: "investment", note: "", address: row.address || row.propertyName || "", price: row.price ? Number(row.price) : undefined, yield: row.capRate || row.cap_rate || undefined, date: row.transactionDate || row.transaction_date || "", type: row.subtype || "" }]);
    } else {
      const addr = typeof row.address === "object" ? [row.address?.line1, row.address?.postcode].filter(Boolean).join(", ") : row.address;
      setLeasing((p) => [...p, { id, kind: "letting", note: "", address: addr || row.tenant || "", tenant: row.tenant || "", rent: row.headlineRent || row.headline_rent || row.zoneARate || row.zone_a_rate || "", area: row.areaSqft || row.area_sqft || "", date: row.completionDate || row.completion_date || "", type: row.compType || row.comp_type || "" }]);
    }
    setAddFor(null);
  };

  const upd = (kind: "investment" | "leasing", id: string, field: string, value: string) => {
    const setter = kind === "investment" ? setInvestment : setLeasing;
    setter((p) => p.map((c) => (c.id === id ? { ...c, [field]: value } : c)));
  };
  const rm = (kind: "investment" | "leasing", id: string) => {
    const setter = kind === "investment" ? setInvestment : setLeasing;
    setter((p) => p.filter((c) => c.id !== id));
  };

  const renderList = (kind: "investment" | "leasing", list: any[]) => (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <p className="text-[11px] uppercase tracking-wide font-semibold text-muted-foreground">{kind === "investment" ? "Investment (sales)" : "Leasing (rents)"} ({list.length})</p>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" className="h-6 text-[11px] gap-1" onClick={() => genChart(kind)} disabled={charting !== null || list.length === 0} title="Generate a comps chart from these comps (saves to the Why Buy imagery)">
            {charting === kind ? <Clock className="w-3 h-3 animate-spin" /> : <FileSpreadsheet className="w-3 h-3" />}Chart
          </Button>
          <Button size="sm" variant="ghost" className="h-6 text-[11px] gap-1" onClick={() => openAdd(kind)}><Plus className="w-3 h-3" />Add from board</Button>
        </div>
      </div>
      {list.length === 0 ? (
        <p className="text-[11px] text-muted-foreground italic">None yet — hit AI match or add from the board.</p>
      ) : list.map((c) => (
        <div key={c.id} className="border rounded p-2 text-[11px] space-y-1 bg-muted/20">
          <div className="flex items-center gap-1">
            <input value={c.address || ""} onChange={(e) => upd(kind, c.id, "address", e.target.value)} className="flex-1 border rounded px-1.5 py-0.5 font-medium" placeholder="Address" />
            <button onClick={() => rm(kind, c.id)} className="text-muted-foreground hover:text-destructive px-1" title="Remove">✕</button>
          </div>
          <div className="grid grid-cols-2 gap-1">
            {kind === "investment" ? (<>
              <input value={c.price ?? ""} onChange={(e) => upd(kind, c.id, "price", e.target.value)} className="border rounded px-1.5 py-0.5" placeholder="Price £" />
              <input value={c.yield ?? ""} onChange={(e) => upd(kind, c.id, "yield", e.target.value)} className="border rounded px-1.5 py-0.5" placeholder="Yield %" />
            </>) : (<>
              <input value={c.rent ?? ""} onChange={(e) => upd(kind, c.id, "rent", e.target.value)} className="border rounded px-1.5 py-0.5" placeholder="Rent" />
              <input value={c.area ?? ""} onChange={(e) => upd(kind, c.id, "area", e.target.value)} className="border rounded px-1.5 py-0.5" placeholder="Area sqft" />
            </>)}
            <input value={c.date ?? ""} onChange={(e) => upd(kind, c.id, "date", e.target.value)} className="border rounded px-1.5 py-0.5" placeholder="Date" />
            <input value={(kind === "leasing" ? c.tenant : c.type) ?? ""} onChange={(e) => upd(kind, c.id, kind === "leasing" ? "tenant" : "type", e.target.value)} className="border rounded px-1.5 py-0.5" placeholder={kind === "leasing" ? "Tenant" : "Type"} />
          </div>
          <input value={c.note || ""} onChange={(e) => upd(kind, c.id, "note", e.target.value)} className="w-full border rounded px-1.5 py-0.5 text-muted-foreground" placeholder="Why relevant (note)" />
        </div>
      ))}
    </div>
  );

  const boardFiltered = board.filter((row: any) => !boardQ.trim() || JSON.stringify(row).toLowerCase().includes(boardQ.toLowerCase())).slice(0, 30);

  return (
    <Card>
      <CardHeader className="pb-3 flex flex-row items-center justify-between">
        <CardTitle className="text-sm flex items-center gap-2"><FileSpreadsheet className="w-4 h-4" /> Comps</CardTitle>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={match} disabled={busy !== null} className="gap-1.5">
            {busy === "match" ? <Clock className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />} AI match
          </Button>
          <Button size="sm" onClick={save} disabled={busy !== null} className="gap-1.5">
            {busy === "save" ? <Clock className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Save
          </Button>
        </div>
      </CardHeader>
      <CardContent className="text-sm space-y-3">
        <p className="text-[11px] text-muted-foreground">AI-matched from the comps board. Edit figures, remove, or add more — these feed the Why Buy deck. Hit <strong>Save</strong> when done.</p>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {renderList("investment", investment)}
          {renderList("leasing", leasing)}
        </div>
      </CardContent>

      {addFor && (
        <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4" onClick={() => setAddFor(null)}>
          <div className="bg-background rounded-lg shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="p-3 border-b flex items-center justify-between">
              <h4 className="text-sm font-semibold">Add {addFor === "investment" ? "investment" : "leasing"} comp from board</h4>
              <button onClick={() => setAddFor(null)} className="text-muted-foreground hover:text-foreground text-lg leading-none">✕</button>
            </div>
            <div className="p-3 border-b">
              <Input value={boardQ} onChange={(e) => setBoardQ(e.target.value)} placeholder="Search the comps board…" />
            </div>
            <div className="p-2 overflow-y-auto flex-1">
              {boardLoading ? <p className="text-xs text-muted-foreground p-3">Loading…</p> : boardFiltered.length === 0 ? <p className="text-xs text-muted-foreground p-3">No matches.</p> : boardFiltered.map((row: any, i: number) => {
                const label = addFor === "investment"
                  ? `${row.address || row.propertyName || "?"}${row.price ? ` — £${row.price}` : ""}${(row.transactionDate || row.transaction_date) ? ` — ${row.transactionDate || row.transaction_date}` : ""}`
                  : `${(typeof row.address === "object" ? [row.address?.line1, row.address?.postcode].filter(Boolean).join(", ") : row.address) || row.tenant || "?"}${row.tenant ? ` — ${row.tenant}` : ""}${(row.headlineRent || row.headline_rent) ? ` — ${row.headlineRent || row.headline_rent}` : ""}`;
                return <button key={row.id || i} onClick={() => addFromBoard(row)} className="w-full text-left text-[11px] p-2 hover:bg-muted/50 rounded border-b last:border-b-0">{label}</button>;
              })}
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

function WhyBuyCard({
  runId, stage9, stage1, stage7, whyBuyComps, onReload, propertyId,
}: {
  runId: string;
  stage9: any;
  stage1?: any;
  stage7?: any;
  whyBuyComps?: any;
  onReload: () => void;
  propertyId: string | null;
}) {
  const [manageOpen, setManageOpen] = useState(false);
  const [relinkOpen, setRelinkOpen] = useState(false);
  return (
    <Card>
      <CardHeader className="pb-3 flex flex-row items-center justify-between">
        <CardTitle className="text-sm flex items-center gap-2"><FileText className="w-4 h-4" /> Why Buy</CardTitle>
        <div className="flex items-center gap-1.5">
          {propertyId && (
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5" onClick={() => setRelinkOpen(true)} title="Pick from uploads that have no property assigned and link them to this property. Fixes the empty-picker case when images were uploaded before per-property folders existed.">
              <Link2 className="w-3.5 h-3.5" /> Re-link uploads
            </Button>
          )}
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5" onClick={() => setManageOpen(true)} title="Upload, AI-edit, delete and capture imagery for this property">
            <ImageIcon className="w-3.5 h-3.5" /> Manage images
          </Button>
        </div>
      </CardHeader>
      <CardContent className="text-sm space-y-3">
        <p className="text-muted-foreground">In-app, Claude-designed pitch deck — generated from the agreed business plan + agreed Excel model. Iterate by prompt or click any image / headline to edit inline.</p>

        {/* Collapsible Comps + Charts & cards. Both default collapsed so the
            Why Buy panel opens at the deck preview rather than the inputs;
            the analyst expands the section they want to edit. */}
        <CollapsibleSection title="Comps" defaultOpen={false}>
          <WhyBuyCompsCard
            runId={runId}
            propertyId={propertyId}
            whyBuyComps={whyBuyComps}
            onReload={onReload}
          />
        </CollapsibleSection>

        <CollapsibleSection title="ERV walk & Covenant card" defaultOpen={false}>
          <WhyBuyChartsCard
            runId={runId}
            propertyId={propertyId}
            passingRent={stage7?.overrideCurrentRentPA || stage7?.currentRentPA}
            erv={stage7?.ervPA}
            area={stage7?.overrideTotalAreaSqFt || stage7?.totalAreaSqFt}
            tenants={stage1?.tenants && stage1.tenants.length > 0
              ? stage1.tenants
              : (stage1?.tenant?.name ? [stage1.tenant] : [])}
          />
        </CollapsibleSection>

        {/* Tenancy schedule — multi-row editable list. Replaces the old
            single-area + single-passing-rent boxes (useless for a multi-let
            like Showcase). Each row is one occupier; Stage 7 reads this when
            building the model. */}
        <CollapsibleSection title="Tenancy schedule" defaultOpen={true}>
          <TenancyScheduleEditor runId={runId} stage1={stage1} onReload={onReload} />
        </CollapsibleSection>

        {/* Imagery — pinned candidates per kind feed Claude design's brief.
            comps_chart added so the chart generated above actually has a
            visible tab here (was missing — chart was being generated but
            had nowhere to land in the UI). */}
        {propertyId && (
          <div className="border rounded-md p-3 bg-muted/20">
            <PropertyImageryPicker
              propertyId={propertyId}
              pathwayRunId={runId}
              kinds={["hero", "secondary_external", "internal", "location_plan", "floor_plan", "comps_chart", "erv_walk", "covenant_card"]}
            />
          </div>
        )}

        {/* Claude-designed deck — only available once the model + business
            plan are agreed (stage 9). Until then the Comps / Charts / Imagery
            panels above let the analyst stage everything up. */}
        {stage9 && <ClaudeDesignPane runId={runId} />}
      </CardContent>

      {manageOpen && (
        <ImageStudioPicker runId={runId} onPick={() => setManageOpen(false)} onClose={() => setManageOpen(false)} />
      )}
      {relinkOpen && propertyId && (
        <RelinkUploadsModal
          propertyId={propertyId}
          onClose={() => setRelinkOpen(false)}
        />
      )}
    </Card>
  );
}

// Modal for picking unassigned Image Studio uploads and linking them to
// the current property. Posts to the existing bulk-assign-property endpoint
// which sets property_id on image_studio_images AND auto-creates the
// matching property_imagery_assets / entity_images rows + property folder
// link. Result: the Why Buy imagery picker stops being empty for properties
// whose uploads pre-date the per-property folders feature.
function RelinkUploadsModal({ propertyId, onClose }: { propertyId: string; onClose: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const { data: orphans = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/image-studio/orphans"],
    queryFn: async () => {
      const r = await fetch(`/api/image-studio/orphans?limit=300`, { credentials: "include", headers: getAuthHeaders() });
      if (!r.ok) throw new Error("orphan fetch failed");
      return r.json();
    },
  });
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return orphans;
    return orphans.filter((o: any) => {
      const blob = `${o.fileName || ""} ${o.address || ""} ${o.description || ""} ${o.brandName || ""}`.toLowerCase();
      return blob.includes(q);
    });
  }, [orphans, search]);
  const toggle = (id: string) => setSelected((p) => {
    const next = new Set(p);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const assignMutation = useMutation({
    mutationFn: async () => {
      const ids = Array.from(selected);
      const r = await fetch(`/api/image-studio/bulk-assign-property`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ ids, propertyId }),
      });
      if (!r.ok) throw new Error("assign failed");
      return r.json();
    },
    onSuccess: (res) => {
      toast({ title: "Uploads linked", description: `${res?.updated ?? selected.size} uploaded image${selected.size === 1 ? "" : "s"} now attached to this property.` });
      queryClient.invalidateQueries({ queryKey: ["/api/image-studio/orphans"] });
      queryClient.invalidateQueries({ queryKey: ["/api/property-imagery", propertyId, "manifest"] });
      onClose();
    },
    onError: (err: any) => toast({ title: "Re-link failed", description: err.message, variant: "destructive" }),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Re-link uploads to this property</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Input
            placeholder="Filter by filename, address, brand…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="text-xs text-muted-foreground">
            {isLoading
              ? "Loading orphan uploads…"
              : `${filtered.length} unassigned upload${filtered.length === 1 ? "" : "s"} · ${selected.size} selected`}
          </div>
          <div className="max-h-[55vh] overflow-y-auto grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 p-1 border rounded-md bg-muted/10">
            {filtered.map((o) => {
              const picked = selected.has(o.id);
              return (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => toggle(o.id)}
                  className={`relative text-left rounded-md overflow-hidden border ${picked ? "border-primary ring-2 ring-primary/30" : "border-muted-foreground/20"}`}
                >
                  <img
                    src={`/api/image-studio/${o.id}/thumb`}
                    alt={o.fileName || "upload"}
                    className="w-full h-24 object-cover bg-muted"
                    loading="lazy"
                  />
                  <div className="px-2 py-1 text-[10px] leading-tight">
                    <div className="truncate font-medium">{o.fileName || "(no filename)"}</div>
                    {o.address && <div className="truncate text-muted-foreground">{o.address}</div>}
                  </div>
                  {picked && (
                    <div className="absolute top-1 right-1 bg-primary text-primary-foreground rounded-full w-5 h-5 flex items-center justify-center text-[10px]">✓</div>
                  )}
                </button>
              );
            })}
            {!isLoading && filtered.length === 0 && (
              <div className="col-span-full text-center text-xs text-muted-foreground py-6">
                No orphan uploads to link.
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            disabled={selected.size === 0 || assignMutation.isPending}
            onClick={() => assignMutation.mutate()}
          >
            {assignMutation.isPending ? "Linking…" : `Link ${selected.size} to property`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Claude Design — in-app deck designer for Why Buy ─────────────────────────
function ClaudeDesignPane({ runId }: { runId: string }) {
  const { toast } = useToast();
  const [versions, setVersions] = useState<Array<{ id: string; version: number; prompt: string | null; created_at: string }>>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [iteratePrompt, setIteratePrompt] = useState("");
  const [busy, setBusy] = useState<"generate" | "iterate" | "edit" | null>(null);
  const [pickerEditId, setPickerEditId] = useState<string | null>(null);
  // True when the pathway data has changed since the latest deck version was
  // generated (see /why-buy-design/stale). Drives the regenerate banner.
  const [stale, setStale] = useState(false);
  // Zoom for the iframe preview. 1.0 = native; values below 1 shrink the
  // deck so the whole thing (all slides) fits in the preview box, values
  // above 1 magnify a slice. Clamped to 0.4–2.0 so the controls can't
  // produce something unusable.
  const [zoom, setZoom] = useState(1);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const reload = useCallback(async () => {
    try {
      const r = await fetch(`/api/property-pathway/${runId}/why-buy-design`);
      if (r.ok) {
        const data = await r.json();
        setVersions(data);
        if (!activeId && data.length > 0) setActiveId(data[0].id);
      }
    } catch { /* ignore */ }
    try {
      const sr = await fetch(`/api/property-pathway/${runId}/why-buy-design/stale`);
      if (sr.ok) setStale(!!(await sr.json()).stale);
    } catch { /* ignore */ }
  }, [runId, activeId]);

  // Re-check on mount and whenever the tab regains focus — catches the
  // common case of correcting the pathway via ChatBGP elsewhere, then
  // coming back to find the deck flagged stale.
  useEffect(() => { reload(); }, [reload]);
  useEffect(() => {
    const onFocus = () => { reload(); };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [reload]);

  // PATCH a single editable element. Auto-save: server returns a new
  // version, we switch to it. Undo = go back one.
  const patchElement = useCallback(async (editId: string, type: "image" | "text", value: string) => {
    if (!activeId) return;
    setBusy("edit");
    try {
      const r = await fetch(`/api/property-pathway/${runId}/why-buy-design/${activeId}/element`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ editId, type, value }),
      });
      if (!r.ok) throw new Error(await r.text());
      const d = await r.json();
      await reload();
      setActiveId(d.id);
      toast({ title: "Saved", description: d.label });
    } catch (e: any) {
      toast({ title: "Edit failed", description: e?.message || "", variant: "destructive" });
    } finally { setBusy(null); }
  }, [activeId, runId, reload, toast]);

  // Undo — switch active to the previous version (one row older in the
  // list, which is sorted version DESC). Doesn't delete; the newer
  // version stays in history so the user can redo via the dropdown.
  const undo = useCallback(() => {
    if (!activeId || versions.length < 2) return;
    const idx = versions.findIndex(v => v.id === activeId);
    if (idx < 0 || idx >= versions.length - 1) return;
    setActiveId(versions[idx + 1].id);
  }, [activeId, versions]);
  const canUndo = (() => {
    if (!activeId || versions.length < 2) return false;
    const idx = versions.findIndex(v => v.id === activeId);
    return idx >= 0 && idx < versions.length - 1;
  })();

  // Iframe overlay — attach hover/click handlers to data-edit-id
  // elements inside the rendered deck. The iframe is same-origin
  // (sandbox="allow-same-origin") so the parent can manipulate its DOM.
  // Click an <img> → open picker. Click any other tagged element →
  // contentEditable inline; auto-save on blur.
  const onIframeLoad = useCallback(() => {
    const doc = iframeRef.current?.contentDocument;
    if (!doc) return;
    // Inject hover/edit styles
    let style = doc.getElementById("__bgp_editor_styles") as HTMLStyleElement | null;
    if (!style) {
      style = doc.createElement("style");
      style.id = "__bgp_editor_styles";
      style.textContent = `
        [data-edit-id] { cursor: pointer; transition: outline 0.12s ease, background 0.12s ease; }
        [data-edit-id]:hover { outline: 2px dashed #15616D; outline-offset: 3px; }
        [data-edit-id].__bgp_editing { outline: 2px solid #FF7D00; outline-offset: 3px; background: rgba(255,125,0,0.04); cursor: text; }
        @media print { [data-edit-id] { outline: none !important; cursor: default !important; } }
      `;
      doc.head.appendChild(style);
    }
    // Attach handlers
    doc.querySelectorAll<HTMLElement>("[data-edit-id]").forEach((el) => {
      if ((el as any).__bgp_wired) return;
      (el as any).__bgp_wired = true;
      const editId = el.getAttribute("data-edit-id")!;
      el.addEventListener("click", (e) => {
        if (el.classList.contains("__bgp_editing")) return; // mid-edit, ignore
        e.preventDefault();
        e.stopPropagation();
        if (el.tagName === "IMG") {
          setPickerEditId(editId);
          return;
        }
        // Inline text edit
        el.classList.add("__bgp_editing");
        el.contentEditable = "true";
        el.focus();
        // Select all on focus for easy overwrite
        const range = doc.createRange();
        range.selectNodeContents(el);
        const sel = doc.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
        const original = el.textContent || "";
        const finish = () => {
          el.contentEditable = "false";
          el.classList.remove("__bgp_editing");
          const newText = (el.textContent || "").replace(/\s+/g, " ").trim();
          el.removeEventListener("blur", finish);
          el.removeEventListener("keydown", onKey);
          if (newText && newText !== original.trim()) {
            patchElement(editId, "text", newText);
          } else {
            // Restore original (in case user deleted everything then bailed)
            el.textContent = original;
          }
        };
        const onKey = (ke: KeyboardEvent) => {
          if (ke.key === "Enter" && !ke.shiftKey) {
            ke.preventDefault();
            (el as HTMLElement).blur();
          } else if (ke.key === "Escape") {
            ke.preventDefault();
            el.textContent = original;
            (el as HTMLElement).blur();
          }
        };
        el.addEventListener("blur", finish);
        el.addEventListener("keydown", onKey);
      });
    });
  }, [patchElement]);

  const generate = async () => {
    setBusy("generate");
    try {
      const r = await fetch(`/api/property-pathway/${runId}/why-buy-design/generate`, { method: "POST", headers: { "Content-Type": "application/json" } });
      if (!r.ok) throw new Error(await r.text());
      const d = await r.json();
      await reload();
      setActiveId(d.id);
      setStale(false);
      toast({ title: "Deck generated", description: `Version ${d.version} ready` });
    } catch (e: any) {
      toast({ title: "Generation failed", description: e?.message || "", variant: "destructive" });
    } finally { setBusy(null); }
  };

  const iterate = async () => {
    if (!iteratePrompt.trim()) return;
    setBusy("iterate");
    try {
      const r = await fetch(`/api/property-pathway/${runId}/why-buy-design/iterate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: iteratePrompt, baseVersionId: activeId }),
      });
      if (!r.ok) throw new Error(await r.text());
      const d = await r.json();
      await reload();
      setActiveId(d.id);
      setIteratePrompt("");
      toast({ title: "Updated", description: `Version ${d.version}` });
    } catch (e: any) {
      toast({ title: "Iteration failed", description: e?.message || "", variant: "destructive" });
    } finally { setBusy(null); }
  };

  return (
    <div className="mt-4 rounded-lg border border-border bg-muted/40 p-3 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-primary" />
          <span className="text-sm font-semibold">Claude design — in-app deck</span>
          <span className="text-[10px] text-muted-foreground">live HTML preview · iterate by prompt · print to PDF</span>
        </div>
        <div className="flex items-center gap-1">
          {versions.length > 1 && (
            <select
              value={activeId || ""}
              onChange={(e) => setActiveId(e.target.value)}
              className="h-7 text-xs rounded-md border bg-background px-2"
            >
              {versions.map(v => (
                <option key={v.id} value={v.id}>v{v.version} · {v.prompt ? v.prompt.slice(0, 30) : "initial"}</option>
              ))}
            </select>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={undo}
            disabled={!canUndo || busy !== null}
            className="h-7 text-xs"
            title="Go back to the previous version"
          >
            ↶ Undo
          </Button>
          <Button size="sm" variant="outline" onClick={generate} disabled={busy !== null} className="h-7 text-xs">
            {busy === "generate" ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Sparkles className="w-3.5 h-3.5 mr-1" />}
            {versions.length === 0 ? "Generate" : "Re-generate"}
          </Button>
          {versions.length > 0 && (
            <div className="flex items-center gap-0.5 ml-1 pl-1 border-l">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setZoom(z => Math.max(0.4, +(z - 0.1).toFixed(2)))}
                disabled={zoom <= 0.4}
                className="h-7 w-7 p-0"
                title="Zoom out"
                data-testid="btn-deck-zoom-out"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </Button>
              <button
                type="button"
                onClick={() => setZoom(1)}
                className="text-[11px] font-mono px-1.5 h-7 rounded hover:bg-muted/60 min-w-[42px]"
                title="Reset zoom"
                data-testid="btn-deck-zoom-reset"
              >
                {Math.round(zoom * 100)}%
              </button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setZoom(z => Math.min(2, +(z + 0.1).toFixed(2)))}
                disabled={zoom >= 2}
                className="h-7 w-7 p-0"
                title="Zoom in"
                data-testid="btn-deck-zoom-in"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </Button>
            </div>
          )}
          {activeId && (
            <a href={`/api/property-pathway/${runId}/why-buy-design/${activeId}/render`} target="_blank" rel="noreferrer">
              <Button size="sm" variant="ghost" className="h-7 text-xs">
                <ExternalLink className="w-3.5 h-3.5 mr-1" /> Open / print
              </Button>
            </a>
          )}
        </div>
      </div>

      {stale && versions.length > 0 && (
        <div className="flex items-center justify-between gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 dark:border-amber-800 dark:bg-amber-950/30">
          <div className="flex items-center gap-2 text-[11px] text-amber-800 dark:text-amber-200">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            <span>Pathway data has changed since this deck was generated. Regenerate to refresh it — a fresh generation replaces manual deck edits (older versions stay in the dropdown).</span>
          </div>
          <Button size="sm" variant="outline" onClick={generate} disabled={busy !== null} className="h-7 shrink-0 border-amber-400 text-xs">
            {busy === "generate" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1 h-3.5 w-3.5" />}
            Regenerate
          </Button>
        </div>
      )}

      {versions.length === 0 ? (
        <div className="text-xs text-muted-foreground italic text-center py-6">
          Click <strong>Generate</strong> — Claude builds a Why Buy deck from this pathway run's brief (property, tenant, model outputs, comps). You can then iterate by typing things like "make slide 2 punchier" or "swap the colour scheme".
        </div>
      ) : (
        <>
          <div className="text-[10px] text-muted-foreground italic px-1">
            Click any image, headline, or KPI in the deck below to edit it inline. Edits auto-save as a new version — use Undo to step back.
          </div>
          {/* Zoom is applied via CSS transform on the iframe. To keep
              the iframe filling its outer container regardless of
              zoom, we set its width/height to 100/zoom% then scale
              the rendering back down. zoom=0.5 → iframe is 200%
              size internally, scaled to 50% visually = you see 2x
              the slides. zoom=1.5 → 66.7% size, scaled up = closer
              look at a portion. overflow-auto on the wrapper lets
              the user pan when zoomed in past the box. */}
          <div className="rounded-md overflow-auto border bg-white" style={{ height: 600 }}>
            {activeId && (
              <iframe
                ref={iframeRef}
                src={`/api/property-pathway/${runId}/why-buy-design/${activeId}/render`}
                className="border-0 block"
                style={{
                  width: `${100 / zoom}%`,
                  height: `${100 / zoom}%`,
                  transform: `scale(${zoom})`,
                  transformOrigin: "top left",
                }}
                title="Why Buy preview"
                sandbox="allow-same-origin"
                onLoad={onIframeLoad}
              />
            )}
          </div>
        </>
      )}

      {versions.length > 0 && (
        <form onSubmit={(e) => { e.preventDefault(); iterate(); }} className="flex gap-2">
          <input
            value={iteratePrompt}
            onChange={(e) => setIteratePrompt(e.target.value)}
            placeholder="Iterate — e.g. 'add a comp slide', 'use BGP teal', 'shorten the risks section'"
            className="flex-1 h-8 rounded-md border bg-background px-2.5 text-sm"
            disabled={busy !== null}
          />
          <Button size="sm" type="submit" disabled={busy !== null || !iteratePrompt.trim()} className="h-8">
            {busy === "iterate" ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : null}
            Iterate
          </Button>
        </form>
      )}

      <HouseStylePanel scope="why_buy" />

      {pickerEditId && (
        <ImageStudioPicker
          runId={runId}
          onPick={(url) => {
            const id = pickerEditId;
            setPickerEditId(null);
            if (id) patchElement(id, "image", url);
          }}
          onClose={() => setPickerEditId(null)}
        />
      )}
    </div>
  );
}

// Modal that lists all images discovered for this pathway run (Stage 8 —
// Street View, Retail Context Plan, additional, collections) so the user
// can swap one into the deck without leaving the page.
// ImageStudioPicker — grouped picker that doubles as a property's image
// inventory manager. Reads from the canonical property_imagery_assets
// manifest (any image attached to this property, from any source) so
// captures + uploads done elsewhere in Image Studio show up automatically.
//
// Per-image actions:
//   • Use   — swap into the deck slot the user clicked (calls onPick)
//   • ⭐    — toggle hero tag (PATCH kind=hero)
//   • 📷   — open Image Studio for this property (deep link)
//   • ✕    — soft-delete (PATCH hidden=true)
//
// Plus + New Street View capture (inline dialog, reuses StreetViewPanoramaCapture)
// and + Upload (multi-file). Both link the result to the property automatically
// so it appears in this picker on next refresh — no separate Discover step.
type Asset = {
  id: string;
  kind: string;
  source: string;
  thumbnail: string | null;     // base64
  imageStudioId: string | null;
  caption: string | null;
  pinned: boolean;
  score: number;
};

function ImageStudioPicker({ runId, onPick, onClose }: { runId: string; onPick: (url: string) => void; onClose: () => void }) {
  const { toast } = useToast();
  const [propertyId, setPropertyId] = useState<string | null>(null);
  const [propertyAddress, setPropertyAddress] = useState<string>("");
  const [propertyPostcode, setPropertyPostcode] = useState<string>("");
  const [propertyLat, setPropertyLat] = useState<number | undefined>(undefined);
  const [propertyLng, setPropertyLng] = useState<number | undefined>(undefined);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [planEditorOpen, setPlanEditorOpen] = useState(false);
  const [pov, setPov] = useState<{ heading: number; pitch: number; fov: number }>({ heading: 0, pitch: 0, fov: 90 });
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [aiEditAsset, setAiEditAsset] = useState<Asset | null>(null);
  const [aiPrompt, setAiPrompt] = useState("");

  const loadManifest = useCallback(async (pid: string) => {
    try {
      const r = await fetch(`/api/property-imagery/${pid}/manifest`);
      if (!r.ok) return;
      const data = await r.json();
      const merged: Asset[] = [];
      const byKind = data?.byKind || {};
      for (const k of Object.keys(byKind)) {
        for (const c of byKind[k]) merged.push({
          id: c.id, kind: c.kind, source: c.source,
          thumbnail: c.thumbnail, imageStudioId: c.imageStudioId,
          caption: c.caption, pinned: !!c.pinned, score: c.score ?? 0.5,
        });
      }
      setAssets(merged);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/property-pathway/${runId}`);
        if (!r.ok) return;
        const data = await r.json();
        const pid = data?.propertyId || data?.property_id || null;
        const addr = data?.address || "";
        const pc = data?.postcode || "";
        const stage1 = data?.stageResults?.stage1 || data?.stage_results?.stage1 || {};
        const lat = stage1?.coordinates?.lat ?? data?.lat;
        const lng = stage1?.coordinates?.lng ?? data?.lng;
        if (!cancelled) {
          setPropertyId(pid);
          setPropertyAddress(addr);
          setPropertyPostcode(pc);
          if (typeof lat === "number") setPropertyLat(lat);
          if (typeof lng === "number") setPropertyLng(lng);
        }
        if (pid) await loadManifest(pid);
      } catch { /* ignore */ }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [runId, loadManifest]);

  const refresh = useCallback(() => {
    if (propertyId) loadManifest(propertyId);
  }, [propertyId, loadManifest]);

  // Source / kind grouping for display. Hero is its own group; Plans
  // covers the composed/generated (retail context plan, comps chart, etc.);
  // Street View is photos from Google Street View; Map is google_static.
  const groups: Array<{ key: string; label: string; predicate: (a: Asset) => boolean }> = [
    { key: "hero", label: "Hero", predicate: (a) => a.kind === "hero" },
    { key: "plans", label: "Plans (Retail Context, Comps, ERV)", predicate: (a) => a.kind !== "hero" && (a.kind === "location_plan" || a.kind === "comps_chart" || a.kind === "erv_walk" || a.kind === "covenant_card") },
    { key: "street_view", label: "Street View", predicate: (a) => a.kind !== "hero" && a.source === "street_view" },
    { key: "map", label: "Map view", predicate: (a) => a.kind !== "hero" && a.source === "google_static" },
    { key: "other", label: "Other", predicate: (a) => a.kind !== "hero" && a.kind !== "location_plan" && a.kind !== "comps_chart" && a.kind !== "erv_walk" && a.kind !== "covenant_card" && a.source !== "street_view" && a.source !== "google_static" },
  ];

  const tagAsHero = async (assetId: string) => {
    setBusy(true);
    try {
      const r = await fetch(`/api/property-imagery/asset/${assetId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "hero", pinned: true }),
      });
      if (!r.ok) throw new Error(await r.text());
      await refresh();
      toast({ title: "Tagged as hero" });
    } catch (e: any) {
      toast({ title: "Couldn't tag", description: e?.message || "", variant: "destructive" });
    } finally { setBusy(false); }
  };

  const hideAsset = async (assetId: string) => {
    setBusy(true);
    try {
      const r = await fetch(`/api/property-imagery/asset/${assetId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hidden: true }),
      });
      if (!r.ok) throw new Error(await r.text());
      await refresh();
    } catch (e: any) {
      toast({ title: "Couldn't hide", description: e?.message || "", variant: "destructive" });
    } finally { setBusy(false); }
  };

  const captureStreetView = async () => {
    if (!propertyAddress) return;
    setBusy(true);
    try {
      const r = await fetch("/api/image-studio/capture-streetview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          location: propertyAddress,
          heading: pov.heading,
          pitch: pov.pitch,
          fov: pov.fov,
          propertyId,
          kind: "secondary_external",
        }),
      });
      if (!r.ok) throw new Error(await r.text());
      await refresh();
      setCaptureOpen(false);
      toast({ title: "Captured", description: `Heading ${pov.heading}° saved` });
    } catch (e: any) {
      toast({ title: "Capture failed", description: e?.message || "", variant: "destructive" });
    } finally { setBusy(false); }
  };

  const handleUpload = async (files: FileList | null) => {
    if (!files || files.length === 0 || !propertyId) return;
    setBusy(true);
    try {
      const fd = new FormData();
      for (let i = 0; i < files.length; i++) fd.append("images", files[i]);
      fd.append("propertyId", propertyId);
      fd.append("kind", "secondary_external");
      fd.append("category", "Property Photos");
      if (propertyAddress) fd.append("address", propertyAddress);
      const r = await fetch("/api/image-studio/upload", { method: "POST", body: fd });
      if (!r.ok) throw new Error(await r.text());
      await refresh();
      toast({ title: "Uploaded", description: `${files.length} image(s) added` });
    } catch (e: any) {
      toast({ title: "Upload failed", description: e?.message || "", variant: "destructive" });
    } finally { setBusy(false); }
  };

  const toggleSelect = (imageStudioId?: string | null) => {
    if (!imageStudioId) return;
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(imageStudioId)) n.delete(imageStudioId); else n.add(imageStudioId);
      return n;
    });
  };

  const deleteSelected = async () => {
    const ids = Array.from(selected).filter(Boolean);
    if (ids.length === 0) return;
    if (!confirm(`Permanently delete ${ids.length} image(s)? This can't be undone.`)) return;
    setBusy(true);
    try {
      const r = await fetch("/api/image-studio/bulk-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      if (!r.ok) throw new Error(await r.text());
      setSelected(new Set());
      await refresh();
      toast({ title: "Deleted", description: `${ids.length} image(s) removed` });
    } catch (e: any) {
      toast({ title: "Delete failed", description: e?.message || "", variant: "destructive" });
    } finally { setBusy(false); }
  };

  const applyAiEdit = async () => {
    if (!aiEditAsset?.imageStudioId || !aiPrompt.trim()) return;
    setBusy(true);
    try {
      const r = await fetch("/api/image-studio/ai-edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageId: aiEditAsset.imageStudioId, editPrompt: aiPrompt.trim() }),
      });
      if (!r.ok) throw new Error(await r.text());
      setAiEditAsset(null);
      setAiPrompt("");
      await refresh();
      toast({ title: "AI edit applied", description: "Saved — Use it to swap into the deck." });
    } catch (e: any) {
      toast({ title: "AI edit failed", description: e?.message || "", variant: "destructive" });
    } finally { setBusy(false); }
  };

  const fullUrl = (a: Asset) => `/api/image-studio/${a.imageStudioId}/full`;
  const thumbSrc = (a: Asset) => a.thumbnail ? `data:image/jpeg;base64,${a.thumbnail}` : `/api/image-studio/${a.imageStudioId}/thumbnail`;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-background rounded-lg shadow-2xl max-w-4xl w-full max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="p-4 border-b flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-sm">Pick an image</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              All images linked to {propertyAddress || "this property"}. <strong>Use</strong> swaps it into the deck, ⭐ sets the hero,
              ✨ AI-edits in place, ✕ hides. Tick images and <strong>Delete</strong> to remove them for good.
            </p>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-lg leading-none ml-2">✕</button>
          </div>
        </div>

        <div className="p-3 border-b flex items-center gap-2 flex-wrap">
          <Button size="sm" variant="outline" onClick={() => setCaptureOpen(true)} disabled={busy || !propertyAddress} className="h-7 text-xs">
            + New Street View
          </Button>
          <Link
            href={`/property-intelligence?tab=map${propertyAddress ? `&address=${encodeURIComponent(propertyAddress)}` : ""}${propertyPostcode ? `&postcode=${encodeURIComponent(propertyPostcode)}` : ""}`}
            className={`h-7 text-xs inline-flex items-center justify-center px-3 rounded-md border border-input bg-background hover:bg-accent hover:text-accent-foreground transition-colors ${(busy || !propertyId) ? "opacity-50 pointer-events-none" : ""}`}
          >
            🗺 Open in Map
          </Link>
          <Button size="sm" onClick={() => fileInputRef.current?.click()} disabled={busy || !propertyId} className="h-7 text-xs gap-1">
            <ImageIcon className="w-3.5 h-3.5" /> Upload images
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*"
            className="hidden"
            onChange={(e) => { handleUpload(e.target.files); e.target.value = ""; }}
          />
          {selected.size > 0 && (
            <Button size="sm" variant="destructive" onClick={deleteSelected} disabled={busy} className="h-7 text-xs gap-1">
              <Trash2 className="w-3.5 h-3.5" /> Delete ({selected.size})
            </Button>
          )}
          {busy && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
        </div>

        <div className="p-4 overflow-y-auto flex-1 space-y-5">
          {loading ? (
            <div className="text-xs text-muted-foreground italic text-center py-12">Loading…</div>
          ) : !propertyId ? (
            <div className="text-xs text-muted-foreground italic text-center py-12">
              This pathway run isn't linked to a CRM property yet — Stage 1 needs to resolve the address first.
            </div>
          ) : assets.length === 0 ? (
            <div className="text-xs text-muted-foreground italic text-center py-12">
              No images yet for this property. Use <strong>+ New Street View</strong> or <strong>+ Upload</strong> above to add some.
            </div>
          ) : (
            groups.map(({ key, label, predicate }) => {
              const items = assets.filter(predicate);
              if (items.length === 0) return null;
              return (
                <section key={key}>
                  <h4 className="text-[11px] uppercase tracking-wide font-semibold text-muted-foreground mb-1.5">
                    {label} ({items.length})
                  </h4>
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                    {items.map((a) => (
                      <div
                        key={a.id}
                        className="group relative aspect-[4/3] rounded-md overflow-hidden border bg-muted"
                      >
                        <img src={thumbSrc(a)} alt={a.caption || ""} className="w-full h-full object-cover" />
                        <input
                          type="checkbox"
                          checked={!!a.imageStudioId && selected.has(a.imageStudioId)}
                          onChange={() => toggleSelect(a.imageStudioId)}
                          onClick={(e) => e.stopPropagation()}
                          className="absolute top-1 left-1 z-10 w-4 h-4 cursor-pointer accent-primary"
                          title="Select (then Delete above)"
                        />
                        {a.kind === "hero" && (
                          <span className="absolute top-1 right-1 bg-foreground text-background text-[9px] px-1 rounded">⭐ HERO</span>
                        )}
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/45 transition-colors flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100">
                          <button
                            onClick={() => onPick(fullUrl(a))}
                            className="bg-primary text-primary-foreground text-[10px] px-2 py-1 rounded hover:opacity-90"
                            title="Use this image in the deck"
                          >
                            Use
                          </button>
                          {a.kind !== "hero" && (
                            <button
                              onClick={() => tagAsHero(a.id)}
                              disabled={busy}
                              className="bg-white/90 text-foreground text-[10px] px-1.5 py-1 rounded hover:opacity-90"
                              title="Tag as the hero shot"
                            >
                              ⭐
                            </button>
                          )}
                          <button
                            onClick={() => { setAiEditAsset(a); setAiPrompt(""); }}
                            disabled={busy}
                            className="bg-white/90 text-foreground text-[10px] px-1.5 py-1 rounded hover:opacity-90"
                            title="AI edit this image"
                          >
                            ✨
                          </button>
                          <button
                            onClick={() => hideAsset(a.id)}
                            disabled={busy}
                            className="bg-destructive text-destructive-foreground text-[10px] px-1.5 py-1 rounded hover:opacity-90"
                            title="Hide this image"
                          >
                            ✕
                          </button>
                        </div>
                        {a.caption && (
                          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent text-white text-[9px] p-1 leading-tight pointer-events-none truncate">
                            {a.caption}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              );
            })
          )}
        </div>
      </div>

      {planEditorOpen && propertyId && (
        <RetailContextPlanEditor
          propertyId={propertyId}
          address={propertyAddress}
          postcode={propertyPostcode}
          initialLat={propertyLat}
          initialLng={propertyLng}
          onClose={() => setPlanEditorOpen(false)}
          onChange={refresh}
        />
      )}

      {aiEditAsset && (
        <div className="fixed inset-0 bg-black/70 z-[60] flex items-center justify-center p-4" onClick={() => setAiEditAsset(null)}>
          <div className="bg-background rounded-lg shadow-2xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="p-3 border-b flex items-center justify-between">
              <h4 className="text-sm font-semibold">AI edit image</h4>
              <button onClick={() => setAiEditAsset(null)} className="text-muted-foreground hover:text-foreground text-lg leading-none">✕</button>
            </div>
            <div className="p-3 space-y-2">
              <img src={thumbSrc(aiEditAsset)} alt="" className="w-full rounded border max-h-48 object-contain bg-muted" />
              <textarea
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                rows={3}
                maxLength={1000}
                placeholder="Describe the edit — e.g. 'brighten and warm the lighting', 'remove the parked cars', 'add outdoor seating and people'"
                className="w-full border rounded p-2 text-sm"
              />
              <p className="text-[11px] text-muted-foreground">Edits this image in place via AI (OpenAI / Gemini) and saves it back, so you can <strong>Use</strong> it in the deck.</p>
            </div>
            <div className="p-3 border-t flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setAiEditAsset(null)} disabled={busy}>Cancel</Button>
              <Button size="sm" onClick={applyAiEdit} disabled={busy || !aiPrompt.trim()}>
                {busy && <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />}Apply edit
              </Button>
            </div>
          </div>
        </div>
      )}

      {captureOpen && propertyAddress && (
        <div className="fixed inset-0 bg-black/70 z-[60] flex items-center justify-center p-4" onClick={() => setCaptureOpen(false)}>
          <div className="bg-background rounded-lg shadow-2xl w-full max-w-3xl flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="p-3 border-b flex items-center justify-between">
              <h4 className="text-sm font-semibold">New Street View capture</h4>
              <button onClick={() => setCaptureOpen(false)} className="text-muted-foreground hover:text-foreground text-lg leading-none">✕</button>
            </div>
            <div className="p-3 space-y-2">
              <div className="rounded-md overflow-hidden border" style={{ height: 360 }}>
                <StreetViewPanoramaCapture
                  address={propertyAddress}
                  lat={propertyLat}
                  lng={propertyLng}
                  onPovChange={setPov}
                />
              </div>
              <div className="text-[11px] text-muted-foreground">
                Pan to the angle you want, then click Capture. The image saves to Image Studio AND links to this property.
              </div>
            </div>
            <div className="p-3 border-t flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setCaptureOpen(false)}>Cancel</Button>
              <Button size="sm" onClick={captureStreetView} disabled={busy}>
                {busy && <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />}
                Capture
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Inline "House style" panel — free-text preferences that flow into every
// Why Buy generation/iteration as prompt context. Same data is editable
// via ChatBGP (sql_write into document_design_preferences) — keeping
// Claude's design fluid rather than locking it down with rigid fields.
function HouseStylePanel({ scope }: { scope: string }) {
  const { toast } = useToast();
  const [prefs, setPrefs] = useState<Array<{ id: string; preference: string; category: string | null; added_at: string }>>([]);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      const r = await fetch(`/api/document-design-preferences?scope=${encodeURIComponent(scope)}`);
      if (!r.ok) return;
      const data = await r.json();
      setPrefs(data);
    } catch { /* ignore */ }
  }, [scope]);

  useEffect(() => { if (open) reload(); }, [open, reload]);

  const add = async () => {
    if (!draft.trim()) return;
    setBusy(true);
    try {
      const r = await fetch("/api/document-design-preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope, preference: draft.trim() }),
      });
      if (!r.ok) throw new Error(await r.text());
      setDraft("");
      await reload();
      toast({ title: "House style updated", description: "Will apply to the next generation." });
    } catch (e: any) {
      toast({ title: "Couldn't save", description: e?.message || "", variant: "destructive" });
    } finally { setBusy(false); }
  };

  const disable = async (id: string) => {
    try {
      const r = await fetch(`/api/document-design-preferences/${id}/disable`, { method: "PATCH" });
      if (!r.ok) throw new Error(await r.text());
      await reload();
    } catch (e: any) {
      toast({ title: "Couldn't disable", description: e?.message || "", variant: "destructive" });
    }
  };

  return (
    <div className="border-t pt-2 mt-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-[11px] font-medium text-muted-foreground hover:text-foreground flex items-center gap-1.5"
      >
        <span>{open ? "▼" : "▶"}</span>
        House style ({prefs.length})
        <span className="text-[10px] opacity-60">— preferences applied to every deck</span>
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          {prefs.length === 0 ? (
            <div className="text-[11px] text-muted-foreground italic">
              No house preferences yet. Add one below — or ask ChatBGP "remember to ___ on Why Buy decks" and it will save the same way.
            </div>
          ) : (
            <ul className="space-y-1">
              {prefs.map((p) => (
                <li key={p.id} className="flex items-start justify-between gap-2 text-[11px] bg-background/60 rounded px-2 py-1 border">
                  <span className="flex-1">{p.preference}</span>
                  <button
                    onClick={() => disable(p.id)}
                    className="text-muted-foreground hover:text-destructive text-[10px]"
                    title="Remove this preference"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
          <form onSubmit={(e) => { e.preventDefault(); add(); }} className="flex gap-1.5">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="e.g. Always use the brochure hero on the cover"
              className="flex-1 h-7 rounded-md border bg-background px-2 text-[11px]"
              disabled={busy}
            />
            <Button size="sm" type="submit" disabled={busy || !draft.trim()} className="h-7 text-[11px] px-2">
              Add
            </Button>
          </form>
        </div>
      )}
    </div>
  );
}

function ImageStudioCard({ runId, stage8, onReload, propertyId, runAddress, runPostcode, runLat, runLng }: {
  runId: string;
  stage8: any;
  onReload: () => void;
  propertyId?: string | null;
  runAddress?: string;
  runPostcode?: string;
  runLat?: number;
  runLng?: number;
}) {
  const { toast } = useToast();
  const [retrying, setRetrying] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [planEditorOpen, setPlanEditorOpen] = useState(false);
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
        <CardTitle className="text-sm flex items-center gap-2">
          <ImageIcon className="w-4 h-4" /> Image Studio
        </CardTitle>
        <div className="flex items-center gap-2 flex-wrap">
          {propertyId && (
            <Button size="sm" variant="outline" onClick={() => setPickerOpen(true)} className="h-7 text-xs gap-1">
              <ImageIcon className="w-3.5 h-3.5" /> Manage images
            </Button>
          )}
          {propertyId && (
            <Link
              href={`/property-intelligence?tab=map${runAddress ? `&address=${encodeURIComponent(runAddress)}` : ""}${runPostcode ? `&postcode=${encodeURIComponent(runPostcode)}` : ""}`}
              className="h-7 text-xs inline-flex items-center justify-center px-3 rounded-md border border-input bg-background hover:bg-accent hover:text-accent-foreground transition-colors gap-1"
            >
              🗺 Open in Map
            </Link>
          )}
          <a
            href={collections[0]?.id ? `/image-studio?collection=${encodeURIComponent(collections[0].id)}` : "/image-studio"}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-primary hover:underline inline-flex items-center gap-1"
          >
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
              <a
                key={c.id}
                href={`/image-studio?collection=${encodeURIComponent(c.id)}`}
                target="_blank"
                rel="noreferrer"
                className="border rounded px-2 py-1 flex items-center justify-between hover:bg-accent hover:border-primary/40 transition-colors"
              >
                <span className="truncate">{c.name}</span>
                <Badge variant="outline" className="text-[10px] py-0 shrink-0">{c.imageCount || 0}</Badge>
              </a>
            ))}
          </div>
        )}
      </CardContent>

      {/* Picker — full image management for the property (capture, upload,
          tag as hero, edit in Image Studio, soft-delete) */}
      {pickerOpen && (
        <ImageStudioPicker
          runId={runId}
          onPick={() => { /* not used here — this entry point is for management not swap */ }}
          onClose={() => { setPickerOpen(false); onReload(); }}
        />
      )}

      {/* Retail Context Plan editor — map + radius + category filter,
          regenerate, mark canonical */}
      {planEditorOpen && propertyId && (
        <RetailContextPlanEditor
          propertyId={propertyId}
          address={runAddress || ""}
          postcode={runPostcode || ""}
          initialLat={runLat}
          initialLng={runLng}
          onClose={() => setPlanEditorOpen(false)}
          onChange={onReload}
        />
      )}
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
        <CardTitle className="text-sm flex items-center gap-2">
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
function planningPdfProxy(rawUrl: string, refererUrl?: string): string {
  if (!rawUrl) return rawUrl;
  const base = `/api/planning-docs/download?url=${encodeURIComponent(rawUrl)}`;
  return refererUrl ? `${base}&referer=${encodeURIComponent(refererUrl)}` : base;
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
  className,
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
  className?: string;
}) {
  const [showDialog, setShowDialog] = useState(false);
  const scrapedRefs = new Set(planningDocs.map((p) => p.ref));
  const totalPdfs = planningDocs.reduce((acc, p) => acc + p.docs.length, 0);

  // Applications that weren't scraped (either >top-10, or scrape returned 0)
  const unscraped = apps.filter((a: any) => a.documentUrl && !scrapedRefs.has(a.reference));

  return (
    <div className={`border rounded p-2.5 bg-muted/10${className ? ` ${className}` : ""}`}>
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
              <div className="flex items-center gap-2 px-2 py-1.5 border-b bg-muted/30 text-[11px]">
                <span className="text-[10px] text-muted-foreground shrink-0 w-16">{app.appDate ? app.appDate.slice(0, 10) : ""}</span>
                {app.lpa && <span className="text-[8px] px-1 py-0.5 rounded bg-muted text-muted-foreground uppercase font-medium shrink-0" title={app.lpa}>{app.lpa.split(/[ &]/)[0]}</span>}
                <a href={app.docsUrl} target="_blank" rel="noreferrer" className="font-medium text-primary hover:underline truncate min-w-0 flex-1" title={app.ref + (app.description ? ` — ${app.description}` : "")}>{app.ref}</a>
                <span className="text-[9px] px-1 py-0.5 rounded bg-muted text-muted-foreground shrink-0">{app.docs.length} PDF{app.docs.length === 1 ? "" : "s"}</span>
              </div>
              <div className="divide-y">
                {app.docs.slice(0, 40).map((d, di) => (
                  <a
                    key={di}
                    href={planningPdfProxy(d.url, app.docsUrl)}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-start gap-2 py-2 px-2 hover:bg-muted/30 text-[11px] leading-relaxed"
                    title={d.description}
                  >
                    <span className="text-[10px] text-muted-foreground shrink-0 w-16 mt-0.5">{d.date ? d.date.slice(0, 10) : ""}</span>
                    <span className={`text-[9px] px-1 py-0.5 rounded uppercase tracking-wide shrink-0 mt-0.5 ${docCategoryTone(d.category)}`}>{d.label}</span>
                    <span className="flex-1 min-w-0">
                      <span className="block truncate">{d.description}</span>
                      {d.drawingNumber && <span className="block text-muted-foreground text-[10px] truncate mt-0.5">Drawing {d.drawingNumber}</span>}
                    </span>
                    <Download className="w-3 h-3 shrink-0 text-muted-foreground mt-1" />
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
                    className="flex items-start gap-2 py-2 px-2 hover:bg-muted/30 text-[11px] leading-relaxed"
                  >
                    <span className="text-[10px] text-muted-foreground shrink-0 w-16 mt-0.5">{(p.decidedAt || p.receivedAt || p.date || "").slice(0, 10)}</span>
                    <span className="flex-1 min-w-0">
                      <span className="font-medium break-all text-primary">{p.reference}</span>
                      {p.description && <span className="block text-muted-foreground text-[10px] truncate mt-0.5">{p.description}</span>}
                    </span>
                    <ExternalLink className="w-2.5 h-2.5 shrink-0 text-muted-foreground mt-1" />
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
                  className="flex items-start gap-2 py-2 px-1 border-b last:border-b-0 hover:bg-muted/30 leading-relaxed"
                >
                  <span className="text-[10px] text-muted-foreground shrink-0 w-16 mt-0.5">{(p.decidedAt || p.receivedAt || p.date || "").slice(0, 10)}</span>
                  <span className={`text-[9px] px-1 py-0.5 rounded uppercase tracking-wide shrink-0 mt-0.5 ${cat.tone}`}>{cat.label}</span>
                  <span className="flex-1 min-w-0">
                    <span className="font-medium break-all text-primary">{p.reference}</span>
                    {p.description && <span className="block text-muted-foreground text-[10px] truncate mt-0.5">{p.description}</span>}
                  </span>
                  <ExternalLink className="w-2.5 h-2.5 shrink-0 text-muted-foreground mt-1" />
                </a>
              );
            })}
            {legacyUrls.filter((u) => !apps.some((a: any) => a.documentUrl === u)).slice(0, 10).map((u, i) => (
              <a key={`legacy-${i}`} href={u} target="_blank" rel="noreferrer" className="flex items-center gap-2 py-2 px-1 border-b last:border-b-0 hover:bg-muted/30 text-[10px] text-muted-foreground">
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
  const subtitle = totalPdfs > 0
    ? `${totalPdfs} PDF${totalPdfs === 1 ? "" : "s"} across ${planningDocs.length} application${planningDocs.length === 1 ? "" : "s"}${unscraped.length ? ` · ${unscraped.length} more on the portal` : ""}`
    : unscraped.length
      ? `${unscraped.length} application${unscraped.length === 1 ? "" : "s"} — documents on the council portal only`
      : "No applications found";
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-5xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader className="pr-8">
          <DialogTitle className="truncate">Planning documents</DialogTitle>
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        </DialogHeader>
        <div className="overflow-y-auto -mx-6 px-6 space-y-3">
          {planningDocs.map((app, ai) => (
            <div key={ai} className="border rounded bg-background">
              {/* Phone: date + badges on one small line, ref + description
                  full-width below — the desktop columns left ~110px for the
                  reference and broke refs mid-token (UX #98). */}
              <div className="px-3 py-2 border-b bg-muted/30 flex flex-col gap-1 sm:flex-row sm:items-start sm:gap-2">
                <div className="flex items-center gap-2 sm:contents">
                  <span className="text-[11px] text-muted-foreground shrink-0 sm:w-20 sm:mt-0.5 sm:order-1">{app.appDate ? app.appDate.slice(0, 10) : ""}</span>
                  {app.lpa && <span className="text-[9px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground uppercase font-medium shrink-0 sm:mt-0.5 sm:order-2" title={app.lpa}>{app.lpa.split(/[ &]/)[0]}</span>}
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0 ml-auto sm:ml-0 sm:mt-0.5 sm:order-4">{app.docs.length} PDF{app.docs.length === 1 ? "" : "s"}</span>
                </div>
                <span className="flex-1 min-w-0 sm:order-3">
                  <a href={app.docsUrl} target="_blank" rel="noreferrer" className="font-medium break-all text-primary hover:underline text-[12px]">{app.ref}</a>
                  {app.description && <span className="block text-muted-foreground text-[11px]">{app.description}</span>}
                </span>
              </div>
              <div className="divide-y">
                {app.docs.map((d, di) => (
                  <a
                    key={di}
                    href={planningPdfProxy(d.url, app.docsUrl)}
                    target="_blank"
                    rel="noreferrer"
                    className="py-1.5 px-3 hover:bg-muted/30 text-[12px] flex flex-col gap-0.5 sm:flex-row sm:items-start sm:gap-2"
                    title={d.description}
                  >
                    <div className="flex items-center gap-2 sm:contents">
                      <span className="text-[11px] text-muted-foreground shrink-0 sm:w-20 sm:mt-0.5 sm:order-1">{d.date ? d.date.slice(0, 10) : ""}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wide shrink-0 sm:mt-0.5 sm:order-2 ${docCategoryTone(d.category)}`}>{d.label}</span>
                      <Download className="w-3.5 h-3.5 shrink-0 text-muted-foreground ml-auto sm:ml-0 sm:mt-0.5 sm:order-4" />
                    </div>
                    <span className="flex-1 min-w-0 sm:order-3">
                      <span className="block">{d.description}</span>
                      {d.drawingNumber && <span className="block text-muted-foreground text-[11px]">Drawing {d.drawingNumber}</span>}
                    </span>
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
        {/* Phone: one card per application (§7) — the table never ships below md. */}
        <div className="md:hidden overflow-y-auto -mx-6 px-6 divide-y">
          {apps.map((p, i) => (
            <div key={i} className="py-2.5">
              <div className="flex items-start justify-between gap-2">
                <p className="text-xs font-medium break-all min-w-0">{p.reference}</p>
                {p.status && <span className={`shrink-0 whitespace-nowrap text-[9px] px-1 py-px rounded uppercase tracking-wide ${statusTone(p.status)}`}>{p.status}</span>}
              </div>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {(p.decidedAt || p.receivedAt || p.date || "").slice(0, 10) || "No date"}
                {p.lpa ? ` · ${p.lpa}` : ""}
              </p>
              {p.description && <p className="text-xs text-foreground/90 mt-1">{p.description}</p>}
              {p.type && <p className="text-[10px] text-muted-foreground mt-0.5">{p.type}</p>}
              {p.documentUrl && (
                <a href={p.documentUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline inline-flex items-center gap-1 text-[11px] mt-1">
                  <ExternalLink className="w-3 h-3" /> View on LPA portal
                </a>
              )}
            </div>
          ))}
        </div>
        <div className="hidden md:block overflow-y-auto -mx-6 px-6">
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

/**
 * Renders the AI-generated email triage markdown with inline [E#] tokens
 * turned into clickable buttons that open the in-app EmailViewerDialog
 * for that exact message. Supports a small subset of markdown (h1/h2/h3,
 * bold, lists, blockquotes) — written inline rather than pulling
 * react-markdown to avoid a new dependency.
 */
function EmailCommentary({
  markdown,
  emailHits,
  onOpenEmail,
}: {
  markdown: string;
  emailHits: Array<{ msgId: string; mailboxEmail?: string; subject?: string; from?: string }>;
  onOpenEmail: (h: { msgId: string; mailboxEmail: string }) => void;
}) {
  const handleOpen = (oneBasedIdx: number) => {
    const h = emailHits[oneBasedIdx - 1];
    if (h?.mailboxEmail && h?.msgId) onOpenEmail({ msgId: h.msgId, mailboxEmail: h.mailboxEmail });
  };

  // Inline parser — splits a line into [E#] buttons, **bold**, and plain text spans.
  let keyCounter = 0;
  const parseInline = (text: string): ReactNode[] => {
    const out: ReactNode[] = [];
    const re = /(\[E(\d+)\])|(\*\*([^*]+)\*\*)|(`([^`]+)`)/g;
    let cursor = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (m.index > cursor) {
        out.push(<span key={`s-${keyCounter++}`}>{text.slice(cursor, m.index)}</span>);
      }
      if (m[1]) {
        const idx = parseInt(m[2], 10);
        const h = emailHits[idx - 1];
        const title = h ? `${h.subject || ""} — ${h.from || ""}` : `Email #${idx}`;
        const disabled = !h?.mailboxEmail || !h?.msgId;
        out.push(
          <button
            key={`e-${keyCounter++}`}
            type="button"
            data-no-min-touch
            disabled={disabled}
            onClick={() => handleOpen(idx)}
            title={title}
            className={`inline-flex items-center text-[10px] font-mono px-1 py-0 mx-0.5 rounded border ${
              disabled
                ? "bg-muted/40 text-muted-foreground border-muted cursor-not-allowed"
                : "bg-primary/10 text-primary border-primary/30 hover:bg-primary/20 cursor-pointer"
            }`}
          >
            E{idx}
          </button>
        );
      } else if (m[3]) {
        out.push(<strong key={`b-${keyCounter++}`}>{m[4]}</strong>);
      } else if (m[5]) {
        out.push(<code key={`c-${keyCounter++}`} className="text-[10px] bg-muted px-1 py-px rounded">{m[6]}</code>);
      }
      cursor = m.index + m[0].length;
    }
    if (cursor < text.length) {
      out.push(<span key={`s-${keyCounter++}`}>{text.slice(cursor)}</span>);
    }
    return out;
  };

  // Block-level parser — line-by-line, batches consecutive bullets into <ul>.
  const lines = markdown.split("\n");
  const blocks: ReactNode[] = [];
  let listBuffer: ReactNode[] = [];
  const flushList = () => {
    if (listBuffer.length) {
      blocks.push(<ul key={`ul-${blocks.length}`} className="list-disc ml-5 my-1 space-y-0.5">{listBuffer}</ul>);
      listBuffer = [];
    }
  };

  lines.forEach((line, i) => {
    if (/^### /.test(line)) {
      flushList();
      blocks.push(<h3 key={i} className="text-[12px] font-semibold mt-2 mb-0.5">{parseInline(line.slice(4))}</h3>);
    } else if (/^## /.test(line)) {
      flushList();
      blocks.push(<h2 key={i} className="text-[13px] font-semibold mt-3 mb-1">{parseInline(line.slice(3))}</h2>);
    } else if (/^# /.test(line)) {
      flushList();
      blocks.push(<h1 key={i} className="text-sm font-semibold mt-3 mb-1">{parseInline(line.slice(2))}</h1>);
    } else if (/^> /.test(line)) {
      flushList();
      blocks.push(<blockquote key={i} className="border-l-2 border-primary/40 pl-2 py-0.5 my-1 text-muted-foreground italic">{parseInline(line.slice(2))}</blockquote>);
    } else if (/^[-*] /.test(line)) {
      listBuffer.push(<li key={i}>{parseInline(line.slice(2))}</li>);
    } else if (line.trim() === "") {
      flushList();
    } else {
      flushList();
      blocks.push(<p key={i} className="my-1 leading-relaxed">{parseInline(line)}</p>);
    }
  });
  flushList();

  return <div className="text-[11px]">{blocks}</div>;
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
                  dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(email.bodyHtml, { FORBID_TAGS: ["script", "style", "iframe", "object", "embed"], FORBID_ATTR: ["onerror", "onload", "onclick"] }) }}
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

// Plain expandable section header. Chevron rotates with state. Used to keep
// the Why Buy panel scannable — analyst expands only the section they need.
function CollapsibleSection({ title, defaultOpen, children }: { title: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="border rounded-md bg-muted/20">
      <CollapsibleTrigger className="w-full flex items-center justify-between px-3 py-2 hover:bg-muted/40 transition-colors">
        <span className="text-sm font-medium">{title}</span>
        {open ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
      </CollapsibleTrigger>
      <CollapsibleContent className="px-3 pb-3 pt-1">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}

// Tenancy schedule editor. Surfaces stage1.tenants[] as an editable table so
// the analyst can capture/amend the rent-roll for the asset and Stage 7's
// model reads it as the input set. Replaces the old single-area + single-rent
// summary inputs which were useless for multi-lets.
//
// On save: writes stage1.tenants[] back and mirrors the totals to legacy
// stage7.totalAreaSqFt / currentRentPA so any consumer that hasn't migrated
// onto the array yet keeps working.
function TenancyScheduleEditor({ runId, stage1, onReload }: { runId: string; stage1: any; onReload: () => void }) {
  const { toast } = useToast();
  type Row = {
    id: string;
    name: string;
    unit?: string;
    areaSqFt?: string;
    passingRentPA?: string;
    ervPA?: string;
    leaseStart?: string;
    leaseEnd?: string;
    breakDate?: string;
  };
  const seed: Row[] = useMemo(() => {
    const existing: any[] = stage1?.tenants && stage1.tenants.length > 0
      ? stage1.tenants
      : stage1?.tenant?.name
        ? [{ name: stage1.tenant.name, companyNumber: stage1.tenant.companyNumber }]
        : [];
    return existing.map((t: any, i: number) => ({
      id: t.id || `t_${Date.now()}_${i}`,
      name: t.name || "",
      unit: t.tradingAs || "",
      areaSqFt: t.areaSqFt != null ? String(t.areaSqFt) : "",
      passingRentPA: t.passingRentPA != null ? String(t.passingRentPA) : "",
      ervPA: t.ervPA != null ? String(t.ervPA) : "",
      leaseStart: t.leaseStart || "",
      leaseEnd: t.leaseEnd || "",
      breakDate: t.breakDate || "",
    }));
  }, [stage1]);
  const [rows, setRows] = useState<Row[]>(seed.length > 0 ? seed : [{ id: `t_${Date.now()}`, name: "" }]);
  const [saving, setSaving] = useState(false);

  const updateRow = (id: string, patch: Partial<Row>) => setRows((p) => p.map((r) => r.id === id ? { ...r, ...patch } : r));
  const addRow = () => setRows((p) => [...p, { id: `t_${Date.now()}_${p.length}`, name: "" }]);
  const removeRow = (id: string) => setRows((p) => p.filter((r) => r.id !== id));

  const totals = useMemo(() => {
    let area = 0;
    let rent = 0;
    let erv = 0;
    for (const r of rows) {
      area += Number(r.areaSqFt || 0) || 0;
      rent += Number(r.passingRentPA || 0) || 0;
      erv += Number(r.ervPA || 0) || 0;
    }
    return { area, rent, erv };
  }, [rows]);

  const save = async () => {
    const valid = rows.filter((r) => r.name.trim());
    if (valid.length === 0) { toast({ title: "Add at least one occupier name", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const runRes = await fetch(`/api/property-pathway/${runId}`, { headers: getAuthHeaders(), credentials: "include" });
      if (!runRes.ok) throw new Error("Could not load run");
      const run = await runRes.json();
      const stageResults = { ...(run.stageResults || {}) };
      // Merge our edits onto whatever existing per-tenant detail was on the
      // run (strategy, companyId, etc.) — the schedule editor only covers
      // the rent-roll fields, not the brand intel.
      const existingMap = new Map<string, any>((stage1?.tenants || []).map((t: any) => [t.id, t]));
      const tenants = valid.map((r) => {
        const prev = existingMap.get(r.id) || {};
        return {
          ...prev,
          id: r.id,
          name: r.name.trim(),
          ...(r.unit?.trim() ? { tradingAs: r.unit.trim() } : {}),
          ...(r.areaSqFt?.trim() ? { areaSqFt: Number(r.areaSqFt) } : {}),
          ...(r.passingRentPA?.trim() ? { passingRentPA: Number(r.passingRentPA) } : {}),
          ...(r.ervPA?.trim() ? { ervPA: Number(r.ervPA) } : {}),
          ...(r.leaseStart?.trim() ? { leaseStart: r.leaseStart.trim() } : {}),
          ...(r.leaseEnd?.trim() ? { leaseEnd: r.leaseEnd.trim() } : {}),
          ...(r.breakDate?.trim() ? { breakDate: r.breakDate.trim() } : {}),
        };
      });
      stageResults.stage1 = {
        ...(stageResults.stage1 || {}),
        tenants,
        tenant: { name: tenants[0].name, ...(tenants[0].companyNumber ? { companyNumber: tenants[0].companyNumber } : {}), ...(tenants[0].companyId ? { companyId: tenants[0].companyId } : {}) },
      };
      // Mirror totals onto Stage 7 — both as the convenience fields (so the
      // Model Studio summary line + Why Buy charts read them straight away)
      // AND as the canonical overrides (so a Regenerate run preserves them
      // instead of re-deriving from old aiFacts / tenancy.units shapes).
      // ervPA is new — Stage 7 doesn't compute it, but the ERV walk chart
      // needs the total ERV from the schedule.
      stageResults.stage7 = {
        ...(stageResults.stage7 || {}),
        totalAreaSqFt: totals.area || (stageResults.stage7?.totalAreaSqFt),
        currentRentPA: totals.rent || (stageResults.stage7?.currentRentPA),
        ...(totals.area > 0 ? { overrideTotalAreaSqFt: totals.area } : {}),
        ...(totals.rent > 0 ? { overrideCurrentRentPA: totals.rent } : {}),
        ...(totals.erv > 0 ? { ervPA: totals.erv } : {}),
      };
      const res = await fetch(`/api/property-pathway/${runId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        credentials: "include",
        body: JSON.stringify({ stageResults }),
      });
      if (!res.ok) throw new Error("Save failed");

      // Kick the model regenerate so the Excel build picks up the new totals
      // automatically — no manual "Regenerate" button. Best-effort: the
      // schedule itself is already saved; a regen failure shouldn't block
      // the success toast.
      let regenStarted = false;
      try {
        const r2 = await fetch(`/api/property-pathway/${runId}/stage7/override`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...getAuthHeaders() },
          credentials: "include",
          body: JSON.stringify({ regenerate: true }),
        });
        regenStarted = r2.ok;
      } catch { /* ignore — schedule is saved */ }

      toast({
        title: "Schedule saved",
        description: `${tenants.length} occupier${tenants.length === 1 ? "" : "s"} · £${totals.rent.toLocaleString()} pa across ${totals.area.toLocaleString()} sq ft.${regenStarted ? " Regenerating model…" : ""}`,
      });
      // Slight delay so the regen kick has a chance to land before the
      // refetch — otherwise the page still shows the previous model run.
      setTimeout(onReload, regenStarted ? 2500 : 0);
    } catch (e: any) {
      toast({ title: "Save failed", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        One row per occupier. Totals feed the Stage 7 model and the deck's headline KPIs.
        Lease dates accept ISO (<code>2025-01-31</code>) or free text.
      </p>
      {/* Phone: one card per occupier (§7/§11) — the input grid never ships below md.
          Same per-row bindings as the table, stacked with micro-labels. */}
      <div className="md:hidden space-y-2">
        {rows.map((r, i) => (
          <div key={r.id} className="rounded-2xl bg-card border border-border p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium truncate">
                {r.name?.trim() || `Occupier ${i + 1}`}{r.unit?.trim() ? ` · ${r.unit.trim()}` : ""}
              </p>
              <button type="button" className="text-[10px] text-destructive hover:underline shrink-0" onClick={() => removeRow(r.id)}>Remove</button>
            </div>
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1 block">Occupier</label>
              <Input value={r.name} onChange={(e) => updateRow(r.id, { name: e.target.value })} placeholder="e.g. Showcase Cinemas" />
            </div>
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1 block">Unit</label>
              <Input value={r.unit || ""} onChange={(e) => updateRow(r.id, { unit: e.target.value })} placeholder="Unit / floor" />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1 block">Area sq ft</label>
                <Input type="number" value={r.areaSqFt || ""} onChange={(e) => updateRow(r.id, { areaSqFt: e.target.value })} className="text-right font-mono tabular-nums" />
              </div>
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1 block">Rent £ pa</label>
                <Input type="number" value={r.passingRentPA || ""} onChange={(e) => updateRow(r.id, { passingRentPA: e.target.value })} className="text-right font-mono tabular-nums" />
              </div>
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1 block">ERV £ pa</label>
                <Input type="number" value={r.ervPA || ""} onChange={(e) => updateRow(r.id, { ervPA: e.target.value })} className="text-right font-mono tabular-nums" />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1 block">Start</label>
                <Input value={r.leaseStart || ""} onChange={(e) => updateRow(r.id, { leaseStart: e.target.value })} />
              </div>
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1 block">End</label>
                <Input value={r.leaseEnd || ""} onChange={(e) => updateRow(r.id, { leaseEnd: e.target.value })} />
              </div>
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1 block">Break</label>
                <Input value={r.breakDate || ""} onChange={(e) => updateRow(r.id, { breakDate: e.target.value })} />
              </div>
            </div>
          </div>
        ))}
        <p className="text-xs text-muted-foreground text-right">
          Totals: <span className="font-mono tabular-nums">{totals.area.toLocaleString()}</span> sq ft
          {" · "}<span className="font-mono tabular-nums">£{totals.rent.toLocaleString()}</span> rent
          {" · "}<span className="font-mono tabular-nums">£{totals.erv.toLocaleString()}</span> ERV
        </p>
      </div>
      <div className="hidden md:block overflow-x-auto border rounded">
        <table className="w-full text-xs">
          <thead className="bg-muted/40 text-muted-foreground text-[10px] uppercase">
            <tr>
              <th className="text-left p-1.5 font-medium">Occupier</th>
              <th className="text-left p-1.5 font-medium">Unit</th>
              <th className="text-right p-1.5 font-medium">Area (sq ft)</th>
              <th className="text-right p-1.5 font-medium">Rent (£ pa)</th>
              <th className="text-right p-1.5 font-medium">ERV (£ pa)</th>
              <th className="text-left p-1.5 font-medium">Start</th>
              <th className="text-left p-1.5 font-medium">End</th>
              <th className="text-left p-1.5 font-medium">Break</th>
              <th className="p-1.5"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t">
                <td className="p-1"><Input value={r.name} onChange={(e) => updateRow(r.id, { name: e.target.value })} className="h-7 text-xs" placeholder="e.g. Showcase Cinemas" /></td>
                <td className="p-1"><Input value={r.unit || ""} onChange={(e) => updateRow(r.id, { unit: e.target.value })} className="h-7 text-xs" placeholder="Unit / floor" /></td>
                <td className="p-1"><Input type="number" value={r.areaSqFt || ""} onChange={(e) => updateRow(r.id, { areaSqFt: e.target.value })} className="h-7 text-xs text-right" /></td>
                <td className="p-1"><Input type="number" value={r.passingRentPA || ""} onChange={(e) => updateRow(r.id, { passingRentPA: e.target.value })} className="h-7 text-xs text-right" /></td>
                <td className="p-1"><Input type="number" value={r.ervPA || ""} onChange={(e) => updateRow(r.id, { ervPA: e.target.value })} className="h-7 text-xs text-right" /></td>
                <td className="p-1"><Input value={r.leaseStart || ""} onChange={(e) => updateRow(r.id, { leaseStart: e.target.value })} className="h-7 text-xs" /></td>
                <td className="p-1"><Input value={r.leaseEnd || ""} onChange={(e) => updateRow(r.id, { leaseEnd: e.target.value })} className="h-7 text-xs" /></td>
                <td className="p-1"><Input value={r.breakDate || ""} onChange={(e) => updateRow(r.id, { breakDate: e.target.value })} className="h-7 text-xs" /></td>
                <td className="p-1 text-right">
                  <button type="button" className="text-[10px] text-destructive hover:underline" onClick={() => removeRow(r.id)}>×</button>
                </td>
              </tr>
            ))}
            <tr className="border-t bg-muted/30 font-medium">
              <td colSpan={2} className="p-1.5 text-right">Totals</td>
              <td className="p-1.5 text-right">{totals.area.toLocaleString()}</td>
              <td className="p-1.5 text-right">£{totals.rent.toLocaleString()}</td>
              <td className="p-1.5 text-right">£{totals.erv.toLocaleString()}</td>
              <td colSpan={4}></td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={addRow} className="h-7 gap-1.5"><Plus className="w-3 h-3" /> Add row</Button>
        <Button size="sm" onClick={save} disabled={saving} className="h-7 ml-auto">{saving ? "Saving…" : "Save schedule"}</Button>
      </div>
    </div>
  );
}
