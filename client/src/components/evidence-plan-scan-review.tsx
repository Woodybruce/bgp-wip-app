import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, ChevronDown, Loader2, ScanLine } from "lucide-react";
import type { PlanScanReview, ScanReviewAssignment, ScanReviewCandidate, ScanReviewResponse, ScanReviewUnit } from "@shared/plan-scan-review";
import { interiorPoint, isValidPolygon, pointInPolygon, type PlanPoint } from "@shared/plan-geometry";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useIsMobile } from "@/hooks/use-mobile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Pill } from "@/components/ui/pill";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";

type Level = { id: string; name: string; background_key: string | null; background_width: number | null; background_height: number | null };
type Filter = "review" | "queued" | "all";
const NEW_UNIT = "__new_unit__";

function isPending(candidate: ScanReviewCandidate, review: PlanScanReview) {
  return candidate.status === "review" && !review.applied[candidate.id];
}

function markerFor(polygon: PlanPoint[], desired?: PlanPoint | null) {
  return desired && pointInPolygon(desired, polygon) ? desired : interiorPoint(polygon);
}

function protectedTarget(unit: ScanReviewUnit, review: PlanScanReview): string | null {
  if (review.clearedUnitIds.includes(unit.id)) return "outline already removed (protected)";
  if (Object.values(review.applied).some(item => item.unitId === unit.id)) return "reviewed boundary already applied (protected)";
  return unit.source === "manual" ? "manually drawn (protected)" : null;
}

export function EvidencePlanScanReview({ open, onOpenChange, planId, level, onSaved, onRefresh, scanRunning }: {
  open: boolean; onOpenChange: (open: boolean) => void; planId: string; level: Level;
  onSaved: () => void; onRefresh: () => void; scanRunning: boolean;
}) {
  const isMobile = useIsMobile();
  const queryKey = ["/api/evidence-plans", planId, "scan-review", level.id];
  const result = useQuery<ScanReviewResponse>({
    queryKey, enabled: open,
    queryFn: async () => (await apiRequest("GET", `/api/evidence-plans/${planId}/scan-review?levelId=${encodeURIComponent(level.id)}`)).json(),
    refetchOnMount: "always", refetchInterval: false, staleTime: 0,
  });
  const review = result.data?.review;
  const [draftJob, setDraftJob] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("review");
  const [search, setSearch] = useState("");
  const [targetSearch, setTargetSearch] = useState("");
  const [targetId, setTargetId] = useState("");
  const [newRef, setNewRef] = useState("");
  const [queued, setQueued] = useState<Record<string, ScanReviewAssignment>>({});
  const [clearIds, setClearIds] = useState<string[]>([]);
  const [oldOutlinesOpen, setOldOutlinesOpen] = useState(false);
  const [oldSearch, setOldSearch] = useState("");
  const [inspectedOldId, setInspectedOldId] = useState<string | null>(null);
  const [zoomSelected, setZoomSelected] = useState(true);
  const [page, setPage] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  useEffect(() => {
    if (!review || draftJob === review.jobId) return;
    setDraftJob(review.jobId); setQueued({}); setClearIds([]); setError(null); setConflict(false); setSuccess(null);
    setSelectedId(review.candidates.find(candidate => isPending(candidate, review))?.id || review.candidates[0]?.id || null);
    setFilter("review"); setSearch(""); setPage(0);
  }, [review, draftJob]);
  const selected = review?.candidates.find(candidate => candidate.id === selectedId) || null;
  const selectedQueued = selected ? queued[selected.id] : undefined;
  useEffect(() => {
    const suggestion = selected?.suggestedUnitIds.length === 1 ? selected.suggestedUnitIds[0] : "";
    const eligibleSuggestion = review?.existingUnits.find(unit => unit.id === suggestion && !protectedTarget(unit, review));
    setTargetId(selectedQueued ? selectedQueued.unitId ?? NEW_UNIT : eligibleSuggestion?.id || "");
    setNewRef(selectedQueued?.newUnitRef || selected?.unitRef || "");
    setTargetSearch("");
    setInspectedOldId(null);
  }, [selected?.id, draftJob]);
  useEffect(() => setPage(0), [filter, search]);
  const staleImage = !!review && review.backgroundKey !== level.background_key;
  const pending = review?.candidates.filter(candidate => isPending(candidate, review)) || [];
  const appliedCount = review?.candidates.filter(candidate => !isPending(candidate, review)).length || 0;
  const queueList = Object.values(queued).filter(item => review?.candidates.some(candidate => candidate.id === item.candidateId && isPending(candidate, review)));
  const activeClearIds = clearIds.filter(id => !review?.clearedUnitIds.includes(id));
  const target = review?.existingUnits.find(unit => unit.id === targetId) || null;
  const chosenIds = new Set(queueList.filter(item => item.candidateId !== selectedId && item.unitId).map(item => item.unitId));
  const exactMatches = pending.filter(candidate => candidate.suggestedUnitIds.length === 1
    && review?.existingUnits.some(unit => unit.id === candidate.suggestedUnitIds[0] && !protectedTarget(unit, review))
    && pending.filter(other => other.suggestedUnitIds.includes(candidate.suggestedUnitIds[0])).length === 1);
  const filtered = (review?.candidates || []).filter(candidate => (filter === "all" || filter === "queued" && queued[candidate.id] && isPending(candidate, review!) || filter === "review" && isPending(candidate, review!))
    && `${candidate.unitRef} ${candidate.tenantName || ""}`.toLowerCase().includes(search.toLowerCase()));
  const pages = Math.max(1, Math.ceil(filtered.length / 6));
  const currentPage = Math.min(page, pages - 1);
  const eligibleOldUnits = (review?.existingUnits || []).filter(unit => unit.source === "ai" && isValidPolygon(unit.polygon)
    && !review?.clearedUnitIds.includes(unit.id) && !queueList.some(item => item.unitId === unit.id)
    && !Object.values(review?.applied || {}).some(item => item.unitId === unit.id)
    && !review?.candidates.some(candidate => candidate.status !== "review" && candidate.unitId === unit.id));
  const visibleOldUnits = eligibleOldUnits.filter(unit => `${unit.unitRef} ${unit.tenantName || ""}`.toLowerCase().includes(oldSearch.toLowerCase()));
  const inspectedOldUnit = eligibleOldUnits.find(unit => unit.id === inspectedOldId) || null;
  const width = Math.max(1, level.background_width || 1000);
  const height = Math.max(1, level.background_height || 700);
  const points = (polygon: PlanPoint[]) => polygon.map(point => `${point.x * width},${point.y * height}`).join(" ");
  const viewBox = useMemo(() => {
    const outline = inspectedOldUnit?.polygon || selected?.polygon;
    if (!zoomSelected || !outline) return `0 0 ${width} ${height}`;
    const x0 = Math.min(...outline.map(point => point.x * width)), x1 = Math.max(...outline.map(point => point.x * width));
    const y0 = Math.min(...outline.map(point => point.y * height)), y1 = Math.max(...outline.map(point => point.y * height));
    const margin = Math.max(x1 - x0, y1 - y0, Math.min(width, height) * .12) * .4;
    const left = Math.max(0, x0 - margin), top = Math.max(0, y0 - margin);
    return `${left} ${top} ${Math.min(width, x1 + margin) - left} ${Math.min(height, y1 + margin) - top}`;
  }, [selected, inspectedOldUnit, zoomSelected, width, height]);
  const marker = selected ? markerFor(selected.polygon, target ? target.dot : selected.dot) : null;
  const markerMoved = !!selected && !!target?.dot && !pointInPolygon(target.dot, selected.polygon);
  const blocked = staleImage || scanRunning;
  const apply = useMutation({
    mutationFn: async () => {
      if (!review || !queueList.length && !activeClearIds.length) throw new Error("Choose a boundary or old outline first.");
      if (queueList.some(item => item.unitId && review.existingUnits.some(unit => unit.id === item.unitId && protectedTarget(unit, review)))) throw new Error("A queued unit now has a protected outline. Remove that assignment or choose another unit.");
      return (await apiRequest("POST", `/api/evidence-plans/${planId}/scan-review/${review.jobId}/apply`, {
        assignments: queueList, clearOutlineUnitIds: activeClearIds,
      })).json() as Promise<{ review: PlanScanReview; applied: Record<string, { unitId: string; action: string }>; clearedUnitIds: string[] }>;
    },
    onMutate: () => { setError(null); setSuccess(null); },
    onSuccess: saved => {
      queryClient.setQueryData(queryKey, { review: saved.review, legacyNeedsRescan: false });
      setQueued({}); setClearIds([]); setError(null); setConflict(false);
      setSuccess(`${queueList.length} boundaries applied${activeClearIds.length ? ` · ${activeClearIds.length} old outlines removed` : ""}. Unit information and evidence have been kept.`);
      onSaved();
    },
    onError: failure => {
      const message = failure instanceof Error ? failure.message : "Couldn't apply the reviewed boundaries.";
      setError(message.replace(/^\d{3}:\s*/, "")); setConflict(message.startsWith("409:"));
    },
  });
  function queueSelected() {
    if (!selected || !targetId || targetId === NEW_UNIT && !newRef.trim() || !review || !isPending(selected, review)) return;
    if (target && protectedTarget(target, review) || chosenIds.has(targetId)) return;
    setQueued(current => ({ ...current, [selected.id]: { candidateId: selected.id, unitId: targetId === NEW_UNIT ? null : targetId, ...(targetId === NEW_UNIT ? { newUnitRef: newRef.trim() } : {}) } }));
    setClearIds(current => current.filter(id => id !== targetId)); setSuccess(null);
  }
  function changeTarget(value: string) {
    setTargetId(value); setInspectedOldId(null);
    if (selected) setQueued(current => { const next = { ...current }; delete next[selected.id]; return next; });
  }
  function selectCandidate(id: string) {
    setSelectedId(id); setInspectedOldId(null);
  }
  function queueExactMatches() {
    setQueued(current => {
      const next = { ...current };
      for (const candidate of exactMatches) {
        const unitId = candidate.suggestedUnitIds[0];
        if (!next[candidate.id] && !Object.values(next).some(item => item.unitId === unitId)) next[candidate.id] = { candidateId: candidate.id, unitId };
      }
      return next;
    });
    setClearIds(current => current.filter(id => !exactMatches.some(candidate => candidate.suggestedUnitIds[0] === id)));
    const selectedMatch = exactMatches.find(candidate => candidate.id === selectedId);
    if (selectedMatch && !selectedQueued && !queueList.some(item => item.unitId === selectedMatch.suggestedUnitIds[0])) setTargetId(selectedMatch.suggestedUnitIds[0]);
    setSuccess(null);
  }
  const header = <>
    {isMobile ? <SheetHeader className="pr-8 text-left"><SheetTitle>Review scan · {level.name}</SheetTitle><SheetDescription>Match each detected boundary to its unit. Existing unit information and evidence stay linked.</SheetDescription></SheetHeader>
      : <DialogHeader className="pr-8"><DialogTitle>Review scan · {level.name}</DialogTitle><DialogDescription>Match each detected boundary to its unit. Existing unit information and evidence stay linked.</DialogDescription></DialogHeader>}
  </>;
  const content = <>
    {header}
    {result.isLoading ? <div className="grid gap-4 md:grid-cols-2" aria-label="Loading scan review"><Skeleton className="h-64" /><div className="space-y-3"><Skeleton className="h-12" /><Skeleton className="h-44" /></div></div>
      : result.isError ? <div role="alert" className="space-y-3"><p className="text-sm">{result.error.message.replace(/^\d{3}:\s*/, "")}</p><p className="text-sm text-muted-foreground">Your plan is unchanged.</p>{result.error.message.startsWith("409:") ? <Button disabled={scanRunning} onClick={() => { onOpenChange(false); onRefresh(); }}>Refresh units</Button> : <Button variant="outline" onClick={() => result.refetch()}>Try again</Button>}</div>
      : !review ? <div className="py-10 text-center space-y-3" data-testid="scan-review-empty"><ScanLine className="mx-auto h-8 w-8 text-muted-foreground" /><p className="text-sm">{result.data?.legacyNeedsRescan ? "This scan was completed before results were retained. Refresh units to create a review you can reopen." : "No saved scan yet — Refresh units to find boundaries for this level."}</p><Button disabled={scanRunning} onClick={() => { onOpenChange(false); onRefresh(); }}>{scanRunning ? "Scanning…" : "Refresh units"}</Button></div>
      : <>
        <p className="text-sm font-mono tabular-nums" data-testid="scan-review-summary">{review.summary.detected} detected · {review.summary.added} added · {review.summary.refined} refined · {review.summary.current} already current · {Object.keys(review.applied).length} applied in review · {pending.length} awaiting review</p>
        {(staleImage || scanRunning) && <p role="status" className="rounded-lg border border-border bg-muted p-3 text-sm">{staleImage ? "The source plan has changed. Refresh units before applying boundaries from this scan." : "A scan is running. You can inspect this review and apply changes when the scan finishes."}</p>}
        {error && <div role="alert" className="rounded-lg border border-destructive/40 p-3 text-sm space-y-2"><p>{error}</p>{conflict && <p>Your queued choices are kept. Adjust them and try again. If the saved unit or source plan has changed, close this review and refresh units first.</p>}</div>}
        {success && <p role="status" className="rounded-lg border border-border bg-muted p-3 text-sm" data-testid="scan-review-success">{success}</p>}
        <div className="grid min-h-0 gap-4 md:grid-cols-[minmax(0,1.35fr)_minmax(300px,1fr)]">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap gap-2"><Pill active={!zoomSelected} onClick={() => setZoomSelected(false)} data-testid="scan-review-full-plan">Full plan</Pill><Pill active={zoomSelected} disabled={!selected} onClick={() => setZoomSelected(true)} data-testid="scan-review-zoom">Selected unit</Pill></div>
            {inspectedOldUnit && <div className="flex flex-wrap items-center gap-2"><p className="text-sm flex-1">Old outline: <strong>{inspectedOldUnit.unitRef}</strong>{inspectedOldUnit.tenantName ? ` · ${inspectedOldUnit.tenantName}` : ""}</p><Button variant="outline" size="sm" onClick={() => setInspectedOldId(null)} data-testid="scan-review-return-candidate">Return to detected boundary</Button></div>}
            <svg viewBox={viewBox} role="group" aria-label="Detected boundaries on the source plan. Select a boundary to review its unit." className="w-full h-[32dvh] md:h-[49dvh] min-h-56 rounded-lg border border-border bg-muted/30" data-testid="scan-review-preview">
              <image href={`/api/evidence-plans/levels/${level.id}/background?v=${encodeURIComponent(level.background_key || "")}`} x="0" y="0" width={width} height={height} />
              {(inspectedOldUnit || target) && isValidPolygon((inspectedOldUnit || target)!.polygon) && <polygon points={points((inspectedOldUnit || target)!.polygon!)} fill={inspectedOldUnit ? "hsl(var(--foreground) / .12)" : "none"} stroke="hsl(var(--foreground))" strokeWidth={2} strokeDasharray="6 4" vectorEffect="non-scaling-stroke" pointerEvents="none" data-testid="scan-review-old-outline" />}
              {review.candidates.filter(candidate => candidate.id !== selectedId).map(candidate => <polygon key={candidate.id} points={points(candidate.polygon)} fill="hsl(var(--primary) / 0.08)" stroke={queued[candidate.id] ? "hsl(var(--foreground))" : "hsl(var(--primary) / 0.55)"} strokeWidth={queued[candidate.id] ? 2 : 1} vectorEffect="non-scaling-stroke" className="cursor-pointer" role="button" tabIndex={0} aria-label={`Review boundary ${candidate.unitRef}`} data-testid={`scan-candidate-outline-${candidate.id}`} onClick={() => selectCandidate(candidate.id)} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); selectCandidate(candidate.id); } }}><title>{candidate.unitRef} · {candidate.tenantName || "Tenant not read"}</title></polygon>)}
              {selected && !inspectedOldUnit && <polygon points={points(selected.polygon)} fill="hsl(var(--primary) / 0.18)" stroke="hsl(var(--primary))" strokeWidth={3} vectorEffect="non-scaling-stroke" pointerEvents="none" data-testid="scan-review-selected-outline" />}
              {marker && !inspectedOldUnit && <circle cx={marker.x * width} cy={marker.y * height} r={Math.max(1, Number(viewBox.split(" ")[2]) * .012)} fill="hsl(var(--primary))" stroke="hsl(var(--background))" strokeWidth={1.5} vectorEffect="non-scaling-stroke" pointerEvents="none" data-testid="scan-review-marker" />}
            </svg>
            <p className="text-[11px] text-muted-foreground">Solid outline: detected boundary. Dashed outline: selected unit’s saved boundary. Dot: label position after applying.</p>
            {selected && <div className="rounded-lg border border-border bg-card p-3 space-y-3" data-testid="scan-review-selection">
              <div><h3 className="text-sm font-semibold">{selected.unitRef} · {selected.tenantName || "Tenant not read"}</h3>{!review.applied[selected.id] && <p className="mt-1 text-[11px] text-muted-foreground">{selected.reason}</p>}</div>
              {!isPending(selected, review) ? <p className="text-sm flex items-center gap-2"><Check className="h-4 w-4" />{review.applied[selected.id] ? "Reviewed boundary already applied." : selected.status === "current" ? "Saved boundary is already current." : "Boundary saved during scanning."}</p> : <>
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground" htmlFor="scan-review-target-search">Match to an existing unit</label>
                <Input id="scan-review-target-search" value={targetSearch} onChange={event => setTargetSearch(event.target.value)} placeholder="Find saved unit or tenant…" aria-label="Find existing unit" data-testid="scan-review-target-search" />
                <select className="w-full min-h-11 rounded-md border border-input bg-background px-2 text-sm" aria-label="Assign boundary to unit" value={targetId} disabled={apply.isPending} onChange={event => changeTarget(event.target.value)} data-testid="scan-review-target">
                  <option value="">Choose a saved unit…</option><option value={NEW_UNIT}>Create a new unit</option>
                  {review.existingUnits.filter(unit => unit.id === targetId || `${unit.unitRef} ${unit.tenantName || ""}`.toLowerCase().includes(targetSearch.toLowerCase())).sort((a, b) => a.unitRef.localeCompare(b.unitRef, undefined, { numeric: true })).map(unit => <option key={unit.id} value={unit.id} disabled={!!protectedTarget(unit, review) || chosenIds.has(unit.id)}>{unit.unitRef}{unit.tenantName ? ` · ${unit.tenantName}` : ""}{protectedTarget(unit, review) ? ` · ${protectedTarget(unit, review)}` : chosenIds.has(unit.id) ? " · already queued" : ""}</option>)}
                </select>
                {targetId === NEW_UNIT ? <div><label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground" htmlFor="scan-review-new-ref">New unit reference</label><Input id="scan-review-new-ref" className="mt-1" value={newRef} disabled={apply.isPending} onChange={event => { setNewRef(event.target.value); if (selected) setQueued(current => { const next = { ...current }; delete next[selected.id]; return next; }); }} data-testid="scan-review-new-ref" /><p className="mt-1 text-[11px] text-muted-foreground">Creates a separate unit. Choose an existing unit above to retain its linked information.</p></div>
                  : target && <p className="text-sm">{selected.suggestedUnitIds.includes(target.id) && !selectedQueued ? "Suggested by exact unit reference — check the boundary before queuing. " : ""}The saved reference, tenant, lease information and evidence are kept.{markerMoved ? " Its label is outside this boundary and will move to the dot shown." : ""}</p>}
                <div className="flex gap-2 flex-wrap"><Button variant="outline" size="sm" onClick={queueSelected} disabled={blocked || apply.isPending || !targetId || targetId === NEW_UNIT && !newRef.trim() || !!target && !!protectedTarget(target, review) || chosenIds.has(targetId)} data-testid="scan-review-queue">{selectedQueued ? "Update queued boundary" : "Queue boundary"}</Button>{selectedQueued && <Button variant="ghost" size="sm" disabled={apply.isPending} onClick={() => setQueued(current => { const next = { ...current }; delete next[selected.id]; return next; })} data-testid="scan-review-unqueue">Remove from queue</Button>}</div>
              </>}
            </div>}
          </div>
          <div className="min-w-0 space-y-3">
            <div className="flex flex-wrap gap-2"><Pill active={filter === "review"} onClick={() => setFilter("review")} data-testid="scan-review-filter-pending">To review · <span className="font-mono">{pending.length}</span></Pill><Pill active={filter === "queued"} onClick={() => setFilter("queued")} data-testid="scan-review-filter-queued">Queued · <span className="font-mono">{queueList.length}</span></Pill><Pill active={filter === "all"} onClick={() => setFilter("all")} data-testid="scan-review-filter-all">All · <span className="font-mono">{review.candidates.length}</span></Pill></div>
            <Input value={search} onChange={event => setSearch(event.target.value)} placeholder="Find detected unit or tenant…" aria-label="Find detected boundary" data-testid="scan-review-search" />
            <div className="space-y-2">{filtered.slice(currentPage * 6, currentPage * 6 + 6).map(candidate => <button key={candidate.id} className={`w-full min-h-11 rounded-lg border bg-card p-3 text-left ${selectedId === candidate.id ? "border-primary ring-1 ring-primary" : "border-border hover:border-primary"}`} onClick={() => selectCandidate(candidate.id)} aria-pressed={candidate.id === selectedId} data-testid={`scan-review-candidate-${candidate.id}`}><span className="block text-sm font-semibold">{candidate.unitRef} · {candidate.tenantName || "Tenant not read"}</span><span className="block mt-1 text-[11px] text-muted-foreground">{queued[candidate.id] && isPending(candidate, review) ? `Queued → ${queued[candidate.id].unitId ? review.existingUnits.find(unit => unit.id === queued[candidate.id].unitId)?.unitRef || "Existing unit" : `New unit ${queued[candidate.id].newUnitRef}`}` : isPending(candidate, review) ? exactMatches.some(match => match.id === candidate.id) ? "Exact reference suggested · check boundary" : "Choose its existing unit or create a new unit" : review.applied[candidate.id] ? "Reviewed and applied" : candidate.status === "current" ? "Already current" : "Saved during scanning"}</span></button>)}{!filtered.length && <p className="py-4 text-sm text-muted-foreground">{filter === "review" && !pending.length ? `All ${appliedCount} detected boundaries are saved.` : "No boundaries match this view."}</p>}</div>
            {pages > 1 && <div className="flex items-center justify-between gap-2"><Button variant="outline" size="sm" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</Button><span className="font-mono text-[11px]">{currentPage + 1} / {pages}</span><Button variant="outline" size="sm" disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}>Next</Button></div>}
            {!!exactMatches.length && <div className="rounded-lg border border-border p-3 space-y-2"><p className="text-sm"><span className="font-mono">{exactMatches.length}</span> boundaries have one exact reference match. Queuing only prepares the changes; check them on the plan before applying.</p><Button variant="outline" size="sm" className="max-w-full whitespace-normal h-auto min-h-9" disabled={blocked || apply.isPending} onClick={queueExactMatches} data-testid="scan-review-queue-exact">Queue exact-reference matches</Button></div>}
            <div className="rounded-lg border border-border p-3 space-y-2">
              <Button variant="ghost" size="sm" className="w-full justify-between" aria-expanded={oldOutlinesOpen} onClick={() => setOldOutlinesOpen(value => !value)} data-testid="scan-review-old-outlines">Old outlines <ChevronDown className="h-4 w-4" /></Button>
              {oldOutlinesOpen && <>
                <p className="text-sm">Remove an incorrect old outline only after checking it. The unit and its information remain. Manually drawn or already applied outlines are protected.</p>
                <Input aria-label="Find old outline" placeholder="Find old unit or tenant…" value={oldSearch} onChange={event => setOldSearch(event.target.value)} />
                <div className="max-h-52 overflow-y-auto space-y-1">
                  {visibleOldUnits.map(unit => <div key={unit.id} className={`flex min-h-11 gap-2 items-center rounded-md p-2 text-sm ${inspectedOldId === unit.id ? "bg-muted" : "hover:bg-muted"}`}>
                    <label className="flex flex-1 min-w-0 min-h-11 items-center gap-3">
                      <input type="checkbox" className="h-4 w-4 shrink-0 accent-primary" checked={activeClearIds.includes(unit.id)} disabled={blocked || apply.isPending} onChange={event => { setInspectedOldId(unit.id); setZoomSelected(true); setClearIds(current => event.target.checked ? [...current, unit.id] : current.filter(id => id !== unit.id)); }} data-testid={`scan-review-clear-${unit.id}`} />
                      <span>{unit.unitRef}{unit.tenantName ? ` · ${unit.tenantName}` : ""}</span>
                    </label>
                    <Button variant="outline" size="sm" className="shrink-0" onClick={() => { setInspectedOldId(unit.id); setZoomSelected(true); }} aria-label={`Show old outline ${unit.unitRef}`} data-testid={`scan-review-show-old-${unit.id}`}>Show outline</Button>
                  </div>)}
                  {!visibleOldUnits.length && <p className="text-sm text-muted-foreground">No eligible old outlines match this view.</p>}
                </div>
              </>}
            </div>
          </div>
        </div>
        <div className="sticky bottom-0 -mx-4 md:-mx-6 px-4 md:px-6 pt-3 pb-[max(.75rem,env(safe-area-inset-bottom))] bg-background border-t border-border flex flex-wrap items-center gap-3" data-testid="scan-review-actions"><p className="flex-1 min-w-40 text-sm font-mono tabular-nums">{queueList.length} boundaries queued{activeClearIds.length ? ` · ${activeClearIds.length} old outlines to remove` : ""}</p><Button variant="outline" size="sm" disabled={apply.isPending} onClick={() => onOpenChange(false)}>Close</Button><Button size="sm" disabled={blocked || apply.isPending || !queueList.length && !activeClearIds.length} onClick={() => apply.mutate()} data-testid="scan-review-apply">{apply.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Apply reviewed boundaries</Button></div>
      </>}
  </>;
  const changeOpen = (value: boolean) => { if (!apply.isPending) onOpenChange(value); };
  return isMobile ? <Sheet open={open} onOpenChange={changeOpen}><SheetContent side="bottom" className="h-[94dvh] max-h-[94dvh] rounded-t-2xl p-4 overflow-y-auto space-y-4" data-testid="scan-review-dialog" onPointerDownOutside={event => { if (apply.isPending) event.preventDefault(); }} onEscapeKeyDown={event => { if (apply.isPending) event.preventDefault(); }}>{content}</SheetContent></Sheet>
    : <Dialog open={open} onOpenChange={changeOpen}><DialogContent className="max-w-6xl max-h-[92dvh] overflow-y-auto" data-testid="scan-review-dialog" onPointerDownOutside={event => { if (apply.isPending) event.preventDefault(); }} onEscapeKeyDown={event => { if (apply.isPending) event.preventDefault(); }}>{content}</DialogContent></Dialog>;
}
