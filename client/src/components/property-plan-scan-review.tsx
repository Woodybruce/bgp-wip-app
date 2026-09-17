import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PropertyPlanPreview } from "./property-plan-preview";
import { planUnitChoiceKey, type PickablePlanUnit, type PropertyPlan } from "./property-plan-types";

import type { PropertyPlanScanJob as ScanJob } from "@shared/property-plan-scan";

export function PropertyPlanScanReview({ plan, canStart = false }: { plan: PropertyPlan; canStart?: boolean }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [accepted, setAccepted] = useState<Record<string, boolean>>({});
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [labels, setLabels] = useState<Record<string, string>>({});
  const jobKey = ["/api/plans", plan.id, "scan"];
  const jobQuery = useQuery<{ job: ScanJob | null }>({
    queryKey: jobKey,
    queryFn: async () => (await apiRequest("GET", `/api/plans/${plan.id}/scan`)).json(),
    refetchInterval: query => query.state.data?.job?.status === "running" ? 2000 : false,
  });
  const pickable = useQuery<{ units: PickablePlanUnit[] }>({
    queryKey: ["/api/properties", plan.property_id, "plan-pickable-units"],
    queryFn: async () => (await apiRequest("GET", `/api/properties/${plan.property_id}/plan-pickable-units`)).json(),
    enabled: open,
  });
  const job = jobQuery.data?.job;
  const candidates = job?.candidates || [];
  const selected = candidates.find(candidate => candidate.id === selectedId) || candidates[0];
  useEffect(() => {
    setAccepted({}); setChoices({}); setLabels({}); setSelectedId(null);
  }, [job?.id, plan.id]);

  const start = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/plans/${plan.id}/scan`, {})).json(),
    onSuccess: data => { queryClient.setQueryData(jobKey, data); queryClient.invalidateQueries({ queryKey: jobKey }); },
  });
  const apply = useMutation({
    mutationFn: async () => {
      if (!job) throw new Error("This scan is no longer available. Start a new scan.");
      const assignments = candidates.filter(candidate => accepted[candidate.id]).map(candidate => {
        const choiceKey = choices[candidate.id] ?? planUnitChoiceKey(candidate);
        const choice = pickable.data?.units.find(unit => planUnitChoiceKey(unit) === choiceKey);
        if (choiceKey && !choice) throw new Error("A chosen tenancy row is no longer available. Choose the link again before saving.");
        const label = (labels[candidate.id] ?? candidate.label).trim();
        if (!label || label.length > 160) throw new Error("Give each chosen outline a label of up to 160 characters.");
        return { candidateId: candidate.id, tenancy_unit_id: choice?.tenancy_unit_id || null, unit_id: choice?.unit_id || null, label };
      });
      if (!assignments.length) throw new Error("Review and tick at least one outline to save.");
      return (await apiRequest("POST", `/api/plans/${plan.id}/scans/${job.id}/apply`, { assignments })).json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/plans", plan.id, "units"] });
      queryClient.invalidateQueries({ queryKey: ["/api/plans", "property-links", plan.property_id] });
      queryClient.invalidateQueries({ queryKey: jobKey });
      setOpen(false);
    },
  });
  const selectedCount = candidates.filter(candidate => accepted[candidate.id]).length;
  const busy = start.isPending || job?.status === "running";
  const units = pickable.data?.units || [];
  const selectedChoice = selected ? choices[selected.id] ?? planUnitChoiceKey(selected) : "";
  return <>
    <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => setOpen(true)} data-testid="button-scan-property-plan">
      <Sparkles className={`w-3.5 h-3.5 mr-1 ${busy ? "animate-pulse" : ""}`} />
      {busy ? "Scanning…" : job?.status === "ready" ? "Review scan" : canStart ? "Scan units" : "Scan review"}
    </Button>
    <Dialog open={open} onOpenChange={value => { if (!apply.isPending) setOpen(value); }}>
      <DialogContent className="max-w-6xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Scan and review units · {plan.floor}</DialogTitle>
          <DialogDescription>Scan the boundaries, check each proposed outline, then link it to a tenancy row. Only the outlines you choose are added; existing units are kept.</DialogDescription>
        </DialogHeader>
        {(jobQuery.isError || start.isError || apply.isError) && <p role="alert" className="text-sm text-destructive">{(apply.error || start.error || jobQuery.error)?.message} {jobQuery.isError && <button className="underline" onClick={() => jobQuery.refetch()}>Retry</button>}</p>}
        {jobQuery.isPending && <p role="status" className="text-sm text-muted-foreground">Checking for an existing scan…</p>}
        {busy && <div role="status" className="border rounded p-4 space-y-2 text-sm">
          <p>{job?.message || "Reading the plan and tracing unit boundaries…"}</p>
          {Boolean(job?.total) && <progress className="w-full" value={job?.completed || 0} max={job?.total} />}
          <p className="text-muted-foreground">You can close this window while the scan runs. Return to Review scan to check the result.</p>
        </div>}
        {job?.status === "failed" && <p role="alert" className="border rounded p-3 text-sm text-destructive">{job.message || "The scan could not finish."} Existing outlines are unchanged. You can retry or use Trace unit / Draw unit.</p>}
        {!canStart && !jobQuery.isPending && !job && <p className="text-sm text-muted-foreground">The BGP team can start a scan for this plan. You can trace or draw units now, and review scanned outlines here when they are ready.</p>}
        {job?.status === "applied" && <p className="text-sm text-muted-foreground">The reviewed outlines have been added to this plan.</p>}
        {job?.status === "ready" && <>
          {job.message && <p className="text-sm text-muted-foreground">{job.message}</p>}
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm"><span>{candidates.length} proposed outlines · {selectedCount} chosen</span><span className="text-muted-foreground">Select a row or outline to inspect it.</span></div>
          <div className="grid md:grid-cols-[minmax(0,1.6fr)_minmax(260px,1fr)] gap-4 min-w-0">
            <PropertyPlanPreview plan={plan} outlines={candidates.map(candidate => ({ id: candidate.id, polygon: candidate.polygon, selected: candidate.id === selected?.id, accepted: accepted[candidate.id] }))} onSelect={setSelectedId} />
            <div className="space-y-3 min-w-0">
              <div className="max-h-48 overflow-y-auto border rounded divide-y" aria-label="Proposed units">
                {candidates.map((candidate, index) => <div key={candidate.id} className={`flex items-start gap-2 p-2 ${selected?.id === candidate.id ? "bg-muted" : ""}`}>
                  <input type="checkbox" checked={Boolean(accepted[candidate.id])} aria-label={`Add ${candidate.label || `outline ${index + 1}`}`} onChange={event => { setAccepted(previous => ({ ...previous, [candidate.id]: event.target.checked })); setSelectedId(candidate.id); }} className="mt-1" />
                  <button className="text-left text-sm flex-1 min-w-0" onClick={() => setSelectedId(candidate.id)}><span className="font-medium">{labels[candidate.id] ?? candidate.label ?? `Outline ${index + 1}`}</span>{candidate.tenant && <span className="block text-xs text-muted-foreground truncate">{candidate.tenant}</span>}{candidate.requiresReview && <span className="block text-xs text-amber-700">Check boundary and link</span>}</button>
                </div>)}
              </div>
              {selected && <div className="border rounded p-3 space-y-3">
                <p className="text-sm font-medium">Selected outline</p>
                {selected.warning && <p className="text-xs text-amber-700">{selected.warning}</p>}
                <label className="block text-xs">On-plan label<input className="mt-1 w-full rounded border bg-background p-2 text-sm" maxLength={160} value={labels[selected.id] ?? selected.label ?? ""} onChange={event => setLabels(previous => ({ ...previous, [selected.id]: event.target.value }))} /></label>
                <label className="block text-xs">Link to tenancy / property unit<select className="mt-1 w-full rounded border bg-background p-2 text-sm" value={selectedChoice} disabled={pickable.isPending || pickable.isError} onChange={event => setChoices(previous => ({ ...previous, [selected.id]: event.target.value }))}>
                  <option value="">Leave unlinked</option>
                  {selectedChoice && !units.some(unit => planUnitChoiceKey(unit) === selectedChoice) && <option value={selectedChoice}>Link unavailable — choose again</option>}
                  {units.map(unit => <option key={planUnitChoiceKey(unit)} value={planUnitChoiceKey(unit)}>{unit.unit_name}{unit.tenant_name ? ` · ${unit.tenant_name}` : ""}{unit.floor ? ` · ${unit.floor}` : ""}{!unit.tenancy_unit_id ? " · property unit only" : ""}</option>)}
                </select></label>
                {pickable.isError && <p role="alert" className="text-xs text-destructive">Could not load tenancy rows. <button className="underline" onClick={() => pickable.refetch()}>Retry</button></p>}
                <p className="text-xs text-muted-foreground">Tenancy links keep rent, lease dates and occupancy in step with the schedule. Untick any boundary that crosses into another unit.</p>
              </div>}
            </div>
          </div>
          {!candidates.length && <p className="text-sm text-muted-foreground">No usable boundaries were found. Try clicking inside a unit with Trace unit, or draw its boundary.</p>}
        </>}
        <DialogFooter className="flex-wrap gap-2">
          <Button variant="outline" onClick={() => setOpen(false)} disabled={apply.isPending}>Close</Button>
          {canStart && !busy && !jobQuery.isPending && job?.status !== "ready" && <Button onClick={() => { start.reset(); apply.reset(); start.mutate(); }} disabled={jobQuery.isError}>{job?.status === "failed" ? "Retry scan" : "Start scan"}</Button>}
          {canStart && job?.status === "ready" && <Button variant="outline" disabled={apply.isPending} onClick={() => { if (confirm("Start a new scan? The current proposed outlines will be replaced. Saved outlines will be kept.")) { start.reset(); apply.reset(); start.mutate(); } }}>Scan again</Button>}
          {job?.status === "ready" && <Button onClick={() => apply.mutate()} disabled={!selectedCount || apply.isPending || pickable.isPending || pickable.isError}>{apply.isPending ? "Saving…" : `Add ${selectedCount} chosen outline${selectedCount === 1 ? "" : "s"}`}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
