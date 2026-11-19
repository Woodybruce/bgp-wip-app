// BGP's sign-off and KYC4U's result on a deal party (Woody, 18 November
// 2026: step 2 of docs/deal-page-review-2026-11-18.md, "Ok go ahead with
// your suggestions I will do the requests"). The MLRO's, or an admin's while
// no MLRO is appointed: the server (server/deal-party-aml.ts) refuses anyone
// else, and the deal's AML status says who may (`decisions`). Each acts on
// the company that signs when the deal names one, else on the brand.
import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { BadgeCheck, FileUp, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, getAuthHeaders, queryClient } from "@/lib/queryClient";
import { KYC4U_RESULTS, KYC4U_RESULT_MAX_FILES, SIGN_OFF_NOTE_MIN, type Kyc4uResultKey } from "@shared/party-kyc";
import type { DealAmlStatus } from "@/components/deal-aml-status";

const plain = (e: unknown) => String((e as any)?.message || e || "").replace(/^\d{3}:\s*/, "").replace(/^\{"message":"(.*)"(,.*)?\}$/, "$1");

function refreshAfterDecision(dealId: string) {
  queryClient.invalidateQueries({ queryKey: ["/api/kyc/deal", dealId, "status"] });
  queryClient.invalidateQueries({ queryKey: ["/api/deals", dealId, "parties"] });
  queryClient.invalidateQueries({ queryKey: ["/api/crm/deals", dealId] });
  queryClient.invalidateQueries({ predicate: q => String(q.queryKey[0] || "").startsWith("/api/kyc4u") });
}

const todayLondon = () => new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });

function SignOffDialog({ dealId, role, partyName, needsNote, onClose }: { dealId: string; role: string; partyName: string; needsNote: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const [note, setNote] = useState("");
  const short = needsNote && note.trim().length < SIGN_OFF_NOTE_MIN;
  const save = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/deals/${dealId}/parties/${role}/sign-off`, { note: note.trim() })).json(),
    onSuccess: () => {
      refreshAfterDecision(dealId);
      toast({ title: "Signed off", description: `${partyName} is approved until its re-check date.` });
      onClose();
    },
    onError: (e: any) => toast({ title: "Not signed off", description: plain(e), variant: "destructive" }),
  });
  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md" data-testid={`aml-sign-off-dialog-${role}`}>
        <DialogHeader>
          <DialogTitle>Sign off {partyName}</DialogTitle>
          <DialogDescription>
            BGP approves this party for the re-check period, and the deal's AML gate reads it as approved. A party with a red flag goes to KYC4U instead.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor={`aml-sign-off-note-${role}`}>What you relied on{needsNote ? "" : " (optional)"}</Label>
          <Textarea id={`aml-sign-off-note-${role}`} value={note} onChange={e => setNote(e.target.value)} rows={3} maxLength={1000}
            placeholder="For example: listed plc, register owners confirmed, ID seen in person on 12 Nov"
            data-testid={`aml-sign-off-note-${role}`} />
          {needsNote && (
            <p className="text-[11px] text-muted-foreground">The client checks are not finished for this party, so say what you relied on instead (at least a sentence).</p>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="button" disabled={short || save.isPending} onClick={() => save.mutate()} data-testid={`aml-sign-off-save-${role}`}>
            {save.isPending && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}Sign off
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Kyc4uResultDialog({ dealId, role, partyName, onClose }: { dealId: string; role: string; partyName: string; onClose: () => void }) {
  const { toast } = useToast();
  const [verdict, setVerdict] = useState<Kyc4uResultKey | "">("");
  const [date, setDate] = useState(todayLondon());
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const missing = !verdict ? "Choose KYC4U's result."
    : !date ? "Give the date of KYC4U's result."
    : verdict === "approved" && !files.length ? "Attach KYC4U's report or their email approving the party."
    : verdict !== "approved" && !files.length && note.trim().length < SIGN_OFF_NOTE_MIN ? "Attach KYC4U's email or say what they said."
    : null;
  const save = useMutation({
    mutationFn: async () => {
      const fd = new FormData();
      fd.append("verdict", verdict);
      fd.append("date", date);
      if (reference.trim()) fd.append("reference", reference.trim());
      if (note.trim()) fd.append("note", note.trim());
      for (const f of files) fd.append("files", f);
      const res = await fetch(`/api/deals/${dealId}/parties/${role}/kyc4u-result`, { method: "POST", body: fd, credentials: "include", headers: getAuthHeaders() });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.message || "KYC4U's result could not be saved.");
      return body;
    },
    onSuccess: (r: any) => {
      refreshAfterDecision(dealId);
      toast({ title: "KYC4U's result added", description: r?.message || `${partyName}: ${verdict ? KYC4U_RESULTS[verdict] : ""}. The files are on its KYC record.` });
      onClose();
    },
    onError: (e: any) => toast({ title: "Not added", description: plain(e), variant: "destructive" }),
  });
  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md" data-testid={`aml-kyc4u-result-dialog-${role}`}>
        <DialogHeader>
          <DialogTitle>Add KYC4U's result</DialogTitle>
          <DialogDescription>
            For {partyName}. KYC4U are BGP's MLRO: their result decides the party, and a later KYC4U request for it replaces this one.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Result</Label>
            <Select value={verdict} onValueChange={v => setVerdict(v as Kyc4uResultKey)}>
              <SelectTrigger data-testid={`aml-kyc4u-verdict-${role}`}><SelectValue placeholder="Choose" /></SelectTrigger>
              <SelectContent>
                {(Object.keys(KYC4U_RESULTS) as Kyc4uResultKey[]).map(k => <SelectItem key={k} value={k}>{KYC4U_RESULTS[k]}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label htmlFor={`aml-kyc4u-date-${role}`}>Date</Label>
              <Input id={`aml-kyc4u-date-${role}`} type="date" value={date} max={todayLondon()} onChange={e => setDate(e.target.value)} data-testid={`aml-kyc4u-date-${role}`} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`aml-kyc4u-ref-${role}`}>KYC4U reference</Label>
              <Input id={`aml-kyc4u-ref-${role}`} value={reference} onChange={e => setReference(e.target.value)} maxLength={60} placeholder="REQ113355" data-testid={`aml-kyc4u-ref-${role}`} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="block">KYC4U's report and documents</Label>
            <input ref={fileRef} type="file" multiple className="hidden" accept=".pdf,.png,.jpg,.jpeg,.heic,.doc,.docx,.msg,.eml,.txt"
              onChange={e => { setFiles(Array.from(e.target.files || []).slice(0, KYC4U_RESULT_MAX_FILES)); }} data-testid={`aml-kyc4u-files-${role}`} />
            <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
              <FileUp className="w-3.5 h-3.5 mr-1.5" />{files.length ? "Choose again" : "Choose files"}
            </Button>
            {files.length > 0 && (
              <ul className="text-[11px] text-muted-foreground space-y-0.5" data-testid={`aml-kyc4u-file-list-${role}`}>
                {files.map(f => <li key={`${f.name}-${f.size}`} className="truncate">{f.name}</li>)}
              </ul>
            )}
            <p className="text-[11px] text-muted-foreground">Up to {KYC4U_RESULT_MAX_FILES} files, 25MB each. They are filed on the party's KYC record.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`aml-kyc4u-note-${role}`}>Note</Label>
            <Textarea id={`aml-kyc4u-note-${role}`} value={note} onChange={e => setNote(e.target.value)} rows={2} maxLength={1000}
              placeholder={verdict === "more_info" ? "What KYC4U asked for" : "Anything to add"} data-testid={`aml-kyc4u-note-${role}`} />
          </div>
          {missing && <p className="text-[11px] text-muted-foreground">{missing}</p>}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="button" disabled={!!missing || save.isPending} onClick={() => save.mutate()} data-testid={`aml-kyc4u-save-${role}`}>
            {save.isPending && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}Add result
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Under a party on the AML card (and in Kick off AML): Sign off and Add
// KYC4U result, for whoever may decide. `approved`: the party is approved
// and in date, so the reason it cannot be signed off again is not shown.
export function PartyDecisions({ dealId, data, companyId, role, partyName, approved, compact }: {
  dealId: string; data: DealAmlStatus | undefined; companyId: string; role: string; partyName: string; approved?: boolean; compact?: boolean;
}) {
  const [open, setOpen] = useState<"sign-off" | "kyc4u" | null>(null);
  const decisions = data?.decisions;
  if (!decisions?.canDecide) return null;
  const view = decisions.parties[companyId];
  // null: BGP may sign it off now (so never `??`, which would read null as missing).
  const blocked = view ? view.blocked : "This party could not be read.";
  return (
    <div className="space-y-1" data-testid={`aml-decisions-${role}`}>
      <div className="flex flex-wrap gap-1.5">
        {!approved && (
          <Button type="button" variant="outline" size="sm" className="h-7 text-xs" disabled={!!blocked} title={blocked || undefined}
            onClick={() => setOpen("sign-off")} data-testid={`aml-sign-off-${role}`}>
            <BadgeCheck className="w-3.5 h-3.5 mr-1" />Sign off
          </Button>
        )}
        <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={() => setOpen("kyc4u")} data-testid={`aml-kyc4u-result-${role}`}>
          <FileUp className="w-3.5 h-3.5 mr-1" />Add KYC4U result
        </Button>
      </div>
      {!approved && !compact && blocked && (
        <p className="text-[11px] text-muted-foreground" data-testid={`aml-sign-off-blocked-${role}`}>Sign off: {blocked}</p>
      )}
      {open === "sign-off" && <SignOffDialog dealId={dealId} role={role} partyName={partyName} needsNote={!!view?.needsNote} onClose={() => setOpen(null)} />}
      {open === "kyc4u" && <Kyc4uResultDialog dealId={dealId} role={role} partyName={partyName} onClose={() => setOpen(null)} />}
    </div>
  );
}
