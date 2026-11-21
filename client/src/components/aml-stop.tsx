// BGP stops acting on a deal for AML reasons (Woody, 21 November 2026: MLR
// 2017 reg 31). The Nominated Officer or a Deputy stops it from the deal's AML
// box and releases it from the banner; every BGP login sees the banner, and
// only the officers see why. The rules are shared/aml-stop.ts, the routes
// server/aml-stop.ts.
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Ban, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, getAuthHeaders, queryClient } from "@/lib/queryClient";
import { AML_STOP_REASONS, amlStopInput, type AmlStopReason, type AmlStopView } from "@shared/aml-stop";

type StopReply = { stopped: AmlStopView | null; canDecide: boolean };
const keyFor = (dealId: string) => ["/api/deals", dealId, "aml-stop"];

/** Whether BGP has stopped acting on the deal. Null for a login that may not read it. */
export function useAmlStop(dealId: string, enabled = true) {
  return useQuery<StopReply | null>({
    queryKey: keyFor(dealId),
    enabled: enabled && !!dealId,
    staleTime: 30_000,
    queryFn: async () => {
      const res = await fetch(`/api/deals/${dealId}/aml-stop`, { credentials: "include", headers: getAuthHeaders() });
      if (res.status === 403 || res.status === 401) return null;
      if (!res.ok) throw new Error("Could not read whether BGP is acting on this deal.");
      return res.json();
    },
  });
}

const refresh = (dealId: string) => {
  queryClient.invalidateQueries({ queryKey: keyFor(dealId) });
  queryClient.invalidateQueries({ queryKey: ["/api/crm/deals"] });
  queryClient.invalidateQueries({ queryKey: ["/api/kyc/deal", dealId, "status"] });
  queryClient.invalidateQueries({ queryKey: ["/api/aml-dashboard"] });
};

const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" });

/** The banner on the deal page, on every pill. BGP staff only. */
export function AmlStopBanner({ dealId }: { dealId: string }) {
  const { toast } = useToast();
  const q = useAmlStop(dealId);
  const [confirming, setConfirming] = useState(false);
  const release = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/deals/${dealId}/aml-stop/resume`, {})).json(),
    onSuccess: (r: any) => {
      refresh(dealId);
      setConfirming(false);
      toast({
        title: "BGP acts on this deal again",
        description: r?.restoreError || (r?.restored ? "The deal is back where it was before it was withdrawn." : r?.told?.sent === false ? `The agents were not emailed: ${r.told.error}` : "The deal's agents have been told."),
      });
    },
    onError: (e: any) => toast({ title: "Not released", description: String(e?.message || e).replace(/^\d+:\s*/, ""), variant: "destructive" }),
  });
  const stop = q.data?.stopped;
  if (!stop) return null;
  const officer = !!q.data?.canDecide;
  return (
    <div className="flex items-start gap-2 rounded-md border-2 border-red-600 bg-red-50 px-3 py-2 text-red-900 dark:bg-red-950/40 dark:text-red-100" data-testid="aml-stop-banner">
      <Ban className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
      <div className="min-w-0 flex-1 text-[13px] leading-snug">
        <div className="text-[11px] font-semibold uppercase tracking-wide">BGP has stopped acting on this deal (AML)</div>
        <p>
          Stopped by {stop.by} on {day(stop.at)}. Do not move it on, invoice it or do more work on it, and do not tell the client or the other side why. Speak to the Nominated Officer.
        </p>
        {officer && stop.reasonWords && (
          <p className="mt-1 text-xs" data-testid="aml-stop-reason">
            <span className="font-medium">{stop.reasonWords}.</span> {stop.note}
            {stop.withdrew ? ` The stop moved the deal to Withdrawn${stop.prevStatus ? ` from ${stop.prevStatus}` : ""}; releasing it puts it back.` : ""}
          </p>
        )}
        {officer && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {confirming ? (
              <>
                <span className="text-xs">Release it, so the deal can move on and be invoiced?</span>
                <Button type="button" size="sm" className="h-7 text-xs" disabled={release.isPending} onClick={() => release.mutate()} data-testid="aml-stop-release-confirm">
                  {release.isPending && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}Release
                </Button>
                <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setConfirming(false)}>Cancel</Button>
              </>
            ) : (
              <Button type="button" size="sm" variant="outline" className="h-7 bg-background text-xs" onClick={() => setConfirming(true)} data-testid="aml-stop-release">
                Release: BGP acts on it again
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** In the AML box's header: Stop acting for the officers, or a mark once stopped. */
export function AmlStopButton({ dealId }: { dealId: string }) {
  const q = useAmlStop(dealId);
  const [open, setOpen] = useState(false);
  if (!q.data) return null;
  if (q.data.stopped) {
    return <span className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-800 dark:bg-red-900/40 dark:text-red-200" data-testid="aml-stop-mark">BGP stopped acting</span>;
  }
  if (!q.data.canDecide) return null;
  return (
    <>
      <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs text-red-700 hover:text-red-800 dark:text-red-400" onClick={() => setOpen(true)} data-testid="aml-stop-open">
        <Ban className="mr-1 h-3.5 w-3.5" />Stop acting
      </Button>
      {open && <AmlStopDialog dealId={dealId} onClose={() => setOpen(false)} />}
    </>
  );
}

function AmlStopDialog({ dealId, onClose }: { dealId: string; onClose: () => void }) {
  const { toast } = useToast();
  const [reason, setReason] = useState<AmlStopReason>("checks_incomplete");
  const [note, setNote] = useState("");
  const [withdraw, setWithdraw] = useState(false);
  const checked = amlStopInput({ reason, note, withdraw });
  const stop = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/deals/${dealId}/aml-stop`, { reason, note: note.trim(), withdraw })).json(),
    onSuccess: (r: any) => {
      refresh(dealId);
      toast({
        title: "BGP has stopped acting on this deal",
        description: r?.withdrawError || (r?.told?.sent === false ? `The agents were not emailed: ${r.told.error}` : "The deal's agents and the officers have been told, without the reason."),
      });
      onClose();
    },
    onError: (e: any) => toast({ title: "Not stopped", description: String(e?.message || e).replace(/^\d+:\s*/, ""), variant: "destructive" }),
  });
  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md" data-testid="aml-stop-dialog">
        <DialogHeader>
          <DialogTitle>Stop BGP acting on this deal</DialogTitle>
          <DialogDescription>
            When BGP cannot complete the checks, it must not go ahead with the deal (MLR 2017 reg 31). BGP cannot stop the parties exchanging through their solicitors, but it stops its own part: the deal cannot move on in the app (only to Withdrawn), cannot be invoiced or deleted, and its AML file is kept. The deal's agents and the officers are emailed, without the reason.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Why</Label>
            <Select value={reason} onValueChange={v => setReason(v as AmlStopReason)}>
              <SelectTrigger data-testid="aml-stop-reason-select"><SelectValue /></SelectTrigger>
              <SelectContent>{Object.entries(AML_STOP_REASONS).map(([k, w]) => <SelectItem key={k} value={k}>{w}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="aml-stop-note">What has happened</Label>
            <Textarea id="aml-stop-note" value={note} onChange={e => setNote(e.target.value)} rows={3} maxLength={1500}
              placeholder="For example: the buyer will not say who owns the company, after three requests" data-testid="aml-stop-note" />
            <p className="text-[11px] text-muted-foreground">Only the Nominated Officer and the Deputies read this. If you suspect money laundering, record it in the AML register as well: a report to the National Crime Agency is the Nominated Officer's decision.</p>
          </div>
          <label className="flex items-start gap-2 text-xs">
            <Checkbox checked={withdraw} onCheckedChange={v => setWithdraw(v === true)} data-testid="aml-stop-withdraw" />
            <span>Move the deal to Withdrawn as well (BGP's client cannot be checked, so BGP ends the instruction). Releasing the stop puts it back.</span>
          </label>
          {!checked.ok && <p className="text-[11px] text-muted-foreground" data-testid="aml-stop-missing">{checked.message}</p>}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="button" variant="destructive" disabled={!checked.ok || stop.isPending} onClick={() => stop.mutate()} data-testid="aml-stop-save">
            {stop.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}Stop acting
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
