// PIPnet, last 12 months (19 November 2026). Woody: "We want the last 12
// months", each flyer kept as it was uploaded and its agent in the tenant rep
// CRM. The admin's view of the catch-up run (server/pipnet-catchup.ts): it
// searches PIPnet one trade type at a time, stores each listing and its
// flyer, and pauses after the first 100 flyers with what they cost.
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { PipnetCatchupState } from "@shared/pipnet-catchup";
import { CATCHUP_FIRST_FLYERS } from "@shared/pipnet-catchup";

const KEY = "/api/admin/pipnet-catchup";
interface View { state: PipnetCatchupState | null; words: string; capped: string[] }

const errorText = (e: any) => { const m = String(e?.message || ""); try { return JSON.parse(m.slice(m.indexOf("{"))).error || m; } catch { return m; } };
const num = (v: number) => <span className="font-mono tabular-nums text-foreground">{v.toLocaleString("en-GB")}</span>;

export function PipnetCatchupDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { toast } = useToast();
  const { data, isLoading, error } = useQuery<View>({
    queryKey: [KEY],
    enabled: open,
    staleTime: 0,
    refetchInterval: (q) => (open ? (q.state.data?.state?.status === "running" ? 10_000 : 30_000) : false),
  });
  const act = useMutation({
    mutationFn: async (action: "start" | "carry_on" | "stop") => (await apiRequest("POST", KEY, { action })).json(),
    onSuccess: (view: View) => queryClient.setQueryData([KEY], view),
    onError: (e: any) => toast({ title: "Nothing was changed", description: errorText(e), variant: "destructive" }),
  });
  const state = data?.state ?? null;
  const t = state?.totals;
  const searches = state ? state.types.length + 1 : 0;
  const pct = state && searches ? Math.min(100, Math.round((Math.min(state.next, searches) / searches) * 100)) : 0;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto" data-testid="pipnet-catchup-dialog">
        <DialogHeader>
          <DialogTitle>PIPnet, last 12 months</DialogTitle>
          <DialogDescription>
            Reads every retail requirement listed on PIPnet in the last 12 months, one trade type at a time (a plain search stops at
            about 1,000 listings), then once more for listings with no trade type. Each listing is stored with its flyer as uploaded,
            the flyer is read by AI once, the requirement goes onto the board as a market listing, and its agent goes into the tenant
            rep CRM. It pauses after the first {CATCHUP_FIRST_FLYERS} flyers read so their cost can be checked; Carry on reads the rest.
            Each search logs off PIPnet when it finishes. It carries on after a deploy, and Stop keeps its place.
          </DialogDescription>
        </DialogHeader>
        {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {error && <p role="status" className="text-sm text-muted-foreground">The catch-up could not be loaded.</p>}
        {data && (
          <div className="space-y-4">
            <p className="text-sm" data-testid="pipnet-catchup-words">{data.words}</p>
            {state && (
              <>
                <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden" aria-hidden>
                  <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
                </div>
                <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs text-muted-foreground" data-testid="pipnet-catchup-figures">
                  <div><dt>Listed since</dt><dd className="text-sm text-foreground">{state.since}</dd></div>
                  <div><dt>Searches</dt><dd className="text-sm">{num(Math.min(state.next, searches))} of {num(searches)}</dd></div>
                  <div><dt>Listings seen</dt><dd className="text-sm">{num(t?.rows ?? 0)}</dd></div>
                  <div><dt>Flyers read</dt><dd className="text-sm">{num(t?.aiReads ?? 0)}</dd></div>
                  <div><dt>Already read</dt><dd className="text-sm">{num(t?.reused ?? 0)}</dd></div>
                  <div><dt>New requirements</dt><dd className="text-sm">{num(t?.promoted ?? 0)}</dd></div>
                  <div><dt>Agents only</dt><dd className="text-sm">{num(t?.agentsOnly ?? 0)}</dd></div>
                  <div><dt>Could not be read</dt><dd className="text-sm">{num(t?.failed ?? 0)}</dd></div>
                </dl>
                {state.firstCost && (
                  <p className="text-xs text-muted-foreground" data-testid="pipnet-catchup-cost">
                    The first {num(state.firstCost.flyers)} flyers cost {state.firstCost.usd != null ? <>about <span className="font-mono tabular-nums text-foreground">${state.firstCost.usd.toFixed(2)}</span> of AI</> : "an amount App costs could not price"}.
                  </p>
                )}
                {data.capped.length > 0 && (
                  <p className="text-xs text-muted-foreground" data-testid="pipnet-catchup-capped">
                    PIPnet's cap of 50 pages cut these searches short, so their oldest listings were not reached: {data.capped.join(", ")}.
                  </p>
                )}
                {state.lastError && <p className="text-xs text-muted-foreground" role="status">Last stop: {state.lastError}</p>}
              </>
            )}
            <div className="flex flex-wrap gap-2">
              {(!state || state.status === "done") && (
                <Button size="sm" disabled={act.isPending} onClick={() => act.mutate("start")} data-testid="pipnet-catchup-start">{state ? "Run it again" : "Start"}</Button>
              )}
              {state && (state.status === "paused" || state.status === "stopped") && (
                <Button size="sm" disabled={act.isPending} onClick={() => act.mutate("carry_on")} data-testid="pipnet-catchup-carry-on">Carry on</Button>
              )}
              {state?.status === "running" && (
                <Button size="sm" variant="outline" disabled={act.isPending} onClick={() => act.mutate("stop")} data-testid="pipnet-catchup-stop">Stop</Button>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
