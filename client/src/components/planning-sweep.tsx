// Planning for the last 12 months, for every brand (Woody, 2026-11-18: "can
// we do planning for the last 12 months?"). The admin's view of the run that
// asks PlanIt about every tenant brand at the register's own pace, and of
// every brand with a planning application naming it in the last 12 months.
// The run only reads the register: it changes nothing a person typed.
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { BandHeading } from "@/components/brand-page/brand-top";
import { useCap, ShowAll } from "@/components/brand-page/brand-card";

const KEY = "/api/admin/brand-pipeline/planning-sweep";

interface Sweep {
  status: "running" | "done" | "stopped";
  startedAt: string; startedBy: string | null; finishedAt: string | null;
  total: number; processed: number; withRecords: number; records: number; skipped: number; failed: number;
  lastError: string | null;
}
interface Finding { id: string; name: string; applications: number; sites: number; latest: string | null; towns: string[] }
interface View { sweep: Sweep | null; gapSeconds: number; brandCount: number; findings: Finding[] }

const day = (value: string) => new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" });
const errorText = (e: any) => { const m = String(e?.message || ""); try { return JSON.parse(m.slice(m.indexOf("{"))).error || m; } catch { return m; } };
const num = (v: number) => <span className="font-mono tabular-nums text-foreground">{v.toLocaleString("en-GB")}</span>;
const timeFor = (brands: number, gapSeconds: number) => {
  const minutes = Math.ceil((brands * gapSeconds) / 60);
  return minutes >= 90 ? `about ${Math.round(minutes / 60)} hours` : `about ${Math.max(1, minutes)} minute${minutes === 1 ? "" : "s"}`;
};

export function PlanningSweepButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setOpen(true)} data-testid="planning-sweep-open"><MapPin className="w-3 h-3 mr-1" /> Planning, 12 months</Button>
      {open && <PlanningSweepDialog onClose={() => setOpen(false)} />}
    </>
  );
}

function PlanningSweepDialog({ onClose }: { onClose: () => void }) {
  const { toast } = useToast();
  const { data, isLoading, error } = useQuery<View>({
    queryKey: [KEY],
    staleTime: 0,
    // Never false: the app's own refresh carries on when nothing runs.
    refetchInterval: (q) => (q.state.data?.sweep?.status === "running" ? 10_000 : 30_000),
  });
  const act = useMutation({
    mutationFn: async (action: "start" | "stop") => (await apiRequest("POST", KEY, { action })).json(),
    onSuccess: (view: View) => queryClient.setQueryData([KEY], view),
    onError: (e: any) => toast({ title: "Nothing was changed", description: errorText(e), variant: "destructive" }),
  });
  const sweep = data?.sweep ?? null;
  const gap = data?.gapSeconds ?? 6;
  const findings = data?.findings ?? [];
  const list = useCap(findings, 12);
  const left = sweep ? Math.max(0, sweep.total - sweep.processed) : 0;
  const pct = sweep && sweep.total ? Math.min(100, Math.round((sweep.processed / sweep.total) * 100)) : 0;
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto" data-testid="planning-sweep-dialog">
        <DialogHeader>
          <DialogTitle>Planning, last 12 months</DialogTitle>
          <DialogDescription>
            Asks PlanIt, the national register of planning applications, about every tenant brand. An application counts when its
            description names the brand and is about works a new occupier applies for (shopfront, signage, change of use, fit-out),
            and not when it only replaces what is already there. PlanIt limits how fast it may be asked, so this goes one brand every {gap} seconds.
            Job adverts are not checked here. It carries on after a deploy, and Stop keeps its place.
          </DialogDescription>
        </DialogHeader>
        {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {error && <p role="status" className="text-sm text-muted-foreground">The check could not be loaded.</p>}
        {data && (
          <div className="space-y-4">
            <section className="space-y-2 rounded-md border border-border p-3" data-testid="planning-sweep-status">
              {!sweep && (
                <p className="text-sm text-muted-foreground">Not run yet. {num(data.brandCount)} brands take {timeFor(data.brandCount, gap)} at PlanIt's pace.</p>
              )}
              {sweep && (
                <>
                  <p className="text-sm text-muted-foreground" data-testid="planning-sweep-summary">
                    {sweep.status === "running" ? "Checking: " : sweep.status === "stopped" ? "Paused at " : `Finished ${sweep.finishedAt ? day(sweep.finishedAt) : ""}: `}
                    {num(sweep.processed)} of {num(sweep.total)} brands, {num(sweep.withRecords)} with applications naming them
                    {sweep.failed ? <>, {num(sweep.failed)} could not be read</> : null}
                    {sweep.skipped ? <>, {num(sweep.skipped)} names too common to search</> : null}.
                    {sweep.status === "running" && left > 0 && <> {timeFor(left, gap)} left.</>}
                  </p>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden="true">
                    <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${pct}%` }} />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Started {day(sweep.startedAt)}{sweep.startedBy ? ` by ${sweep.startedBy}` : ""}.
                    {sweep.lastError ? <> Last problem: {sweep.lastError}.</> : null}
                  </p>
                </>
              )}
              <div className="flex gap-2">
                {sweep?.status === "running" ? (
                  <Button size="sm" variant="outline" disabled={act.isPending} onClick={() => act.mutate("stop")} data-testid="planning-sweep-stop">Stop</Button>
                ) : (
                  <Button size="sm" disabled={act.isPending} onClick={() => act.mutate("start")} data-testid="planning-sweep-start">
                    {sweep?.status === "stopped" ? "Carry on" : sweep?.status === "done" ? "Check every brand again" : "Check every brand"}
                  </Button>
                )}
              </div>
            </section>
            <section className="space-y-1.5" data-testid="planning-sweep-findings">
              <BandHeading count={findings.length || null}>Brands with applications in the last 12 months</BandHeading>
              {findings.length === 0 ? (
                <p className="text-[13px] text-muted-foreground">None held yet.</p>
              ) : (
                <div className="divide-y divide-border rounded-md border border-border">
                  {list.shown.map((f) => (
                    <div key={f.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-2.5 py-1.5 text-sm">
                      <Link href={`/companies/${f.id}?section=expansion`} className="font-medium text-primary hover:underline">{f.name}</Link>
                      <span className="text-xs text-muted-foreground">{num(f.sites)} site{f.sites === 1 ? "" : "s"}{f.applications !== f.sites ? <>, {num(f.applications)} applications</> : null}</span>
                      {f.latest && <span className="font-mono text-xs tabular-nums text-muted-foreground">{day(f.latest)}</span>}
                      {f.towns.length > 0 && <span className="text-xs text-muted-foreground">{f.towns.join(", ")}</span>}
                    </div>
                  ))}
                </div>
              )}
              {list.over && <ShowAll total={findings.length} open={list.open} onToggle={list.toggle} />}
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
