// The unit scan on the older Plans card. A finished scan saves its own
// outlines (server/property-plan-match.ts: linked to the schedule unit the
// plan's number or tenant name names, the rest unlinked), so nothing waits to
// be reviewed (Woody, 2026-11-16). This shows a scan running, offers to save
// what a scan from before then left waiting, and lets BGP staff scan again.
import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import type { PropertyPlanScanJob as ScanJob } from "@shared/property-plan-scan";
import type { PropertyPlan } from "./property-plan-types";

export function PropertyPlanScanStatus({ plan, canStart = false }: { plan: PropertyPlan; canStart?: boolean }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const jobKey = ["/api/plans", plan.id, "scan"];
  const jobQuery = useQuery<{ job: ScanJob | null }>({
    queryKey: jobKey,
    queryFn: async () => (await apiRequest("GET", `/api/plans/${plan.id}/scan`)).json(),
    refetchInterval: query => query.state.data?.job?.status === "running" ? 2000 : false,
  });
  const job = jobQuery.data?.job;
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["/api/plans", plan.id, "units"] });
    void queryClient.invalidateQueries({ queryKey: ["/api/plans", plan.id, "match"] });
    void queryClient.invalidateQueries({ queryKey: ["/api/plans", "property-links", plan.property_id] });
    void queryClient.invalidateQueries({ queryKey: ["/api/properties", plan.property_id, "units"] });
    void queryClient.invalidateQueries({ queryKey: ["/api/properties", plan.property_id, "review-items"] });
  };
  // A scan that has just finished has put its outlines on the plan: read them.
  const seen = useRef(job ? `${job.id}:${job.status}` : "");
  useEffect(() => {
    const now = job ? `${job.id}:${job.status}` : "";
    if (seen.current === `${job?.id}:running` && job?.status !== "running") refresh();
    seen.current = now;
  }, [job?.id, job?.status]);
  const start = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/plans/${plan.id}/scan`, {})).json(),
    onSuccess: data => { queryClient.setQueryData(jobKey, data); void queryClient.invalidateQueries({ queryKey: ["/api/plans", plan.id, "match"] }); },
    onError: (error: Error) => toast({ title: "The scan did not start", description: error.message, variant: "destructive" }),
  });
  const save = useMutation({
    mutationFn: async (scanId: string): Promise<{ linked: number; unlinked: number }> => (await apiRequest("POST", `/api/plans/${plan.id}/match/accept-all`, { scanId })).json(),
    onSuccess: result => {
      toast({ title: `${result.linked} outline${result.linked === 1 ? "" : "s"} linked to the tenancy schedule`,
        description: result.unlinked ? `${result.unlinked} not linked: select ${result.unlinked === 1 ? "it" : "them"} to link a unit, or remove ${result.unlinked === 1 ? "it" : "them"}.` : undefined });
      refresh();
    },
    onError: (error: Error) => toast({ title: "The scan's outlines were not saved", description: error.message, variant: "destructive" }),
  });
  const unsaved = job?.status === "ready" ? job.candidates.length : 0;
  if (job?.status === "running" || start.isPending) {
    return <Button size="sm" variant="outline" className="h-8 text-xs" disabled title={job?.message || undefined} data-testid="button-scan-property-plan"><Sparkles className="w-3.5 h-3.5 mr-1 animate-pulse" />Scanning…</Button>;
  }
  if (unsaved > 0 && job) {
    return <Button size="sm" className="h-8 text-xs" disabled={save.isPending} onClick={() => save.mutate(job.id)} data-testid="button-save-scanned-outlines">
      <Sparkles className="w-3.5 h-3.5 mr-1" />{save.isPending ? "Saving…" : `Save ${unsaved} scanned outline${unsaved === 1 ? "" : "s"}`}
    </Button>;
  }
  if (!canStart) return null;
  return <Button size="sm" variant="outline" className="h-8 text-xs" disabled={jobQuery.isPending} title={job?.status === "failed" ? job.message || undefined : undefined} onClick={() => start.mutate()} data-testid="button-scan-property-plan">
    <Sparkles className="w-3.5 h-3.5 mr-1" />{job ? "Scan again" : "Scan units"}
  </Button>;
}
