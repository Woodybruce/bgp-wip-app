// BGP's sign-off and KYC4U's result on a deal party (Woody, 18 November
// 2026: step 2 of docs/deal-page-review-2026-11-18.md, "Ok go ahead with
// your suggestions I will do the requests"). Since 19 November 2026 (BGP's
// AML policy, Issue 2, and Woody's answers): a standard or simplified party
// is signed off by an agent on the deal, the Nominated Officer or the Deputy;
// KYC4U's result and "Not required" are the Nominated Officer's or the
// Deputy's (an admin's until a Nominated Officer is set). The server
// (server/deal-party-aml.ts) refuses anyone else, and the deal's AML status
// says who may (`decisions`). Each acts on the company that signs when the
// deal names one, else on the brand.
import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { BadgeCheck, CircleSlash, FileUp, Loader2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, getAuthHeaders, queryClient } from "@/lib/queryClient";
import { KYC4U_RESULTS, KYC4U_RESULT_MAX_FILES, SIGN_OFF_NOTE_MIN, type Kyc4uResultKey } from "@shared/party-kyc";
import { DUE_DILIGENCE_LABEL, NOT_REQUIRED_COMMENT_MIN, NOT_REQUIRED_REASONS, type NotRequiredReason } from "@shared/aml-policy";
import type { DealAmlStatus } from "@/components/deal-aml-status";

const plain = (e: unknown) => String((e as any)?.message || e || "").replace(/^\d{3}:\s*/, "").replace(/^\{"message":"(.*)"(,.*)?\}$/, "$1");

function refreshAfterDecision(dealId: string) {
  queryClient.invalidateQueries({ queryKey: ["/api/kyc/deal", dealId, "status"] });
  queryClient.invalidateQueries({ queryKey: ["/api/deals", dealId, "parties"] });
  queryClient.invalidateQueries({ queryKey: ["/api/crm/deals", dealId] });
  queryClient.invalidateQueries({ predicate: q => String(q.queryKey[0] || "").startsWith("/api/kyc4u") });
  queryClient.invalidateQueries({ queryKey: ["/api/aml-dashboard"] });
}

const todayLondon = () => new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });

function SignOffDialog({ dealId, role, partyName, needsNote, levelWords, onClose }: { dealId: string; role: string; partyName: string; needsNote: boolean; levelWords: string | null; onClose: () => void }) {
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
            {levelWords ? `${levelWords}. ` : ""}BGP approves this party until its re-check date (3 years, BGP's AML policy), and the deal's AML gate reads it as approved. A party needing enhanced due diligence goes to KYC4U instead.
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

interface Kyc4uPackReading {
  files: Array<{ path: string; name: string; size: number; heading: string; kind: string; docType: string; docWords: string }>;
  skipped: Array<{ path: string; reason: string }>;
  report: null | {
    jobId: string | null; levelOfRisk: string | null; conclusion: string | null;
    risks: Array<{ label: string; value: string | null; details: string | null }>;
  };
  prefill: { verdict: Kyc4uResultKey | null; date: string | null; reference: string | null; note: string; highRisk: boolean; lines: string[] };
}

function Kyc4uResultDialog({ dealId, role, partyName, onClose }: { dealId: string; role: string; partyName: string; onClose: () => void }) {
  const { toast } = useToast();
  const [verdict, setVerdict] = useState<Kyc4uResultKey | "">("");
  const [date, setDate] = useState(todayLondon());
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [reading, setReading] = useState<Kyc4uPackReading | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const missing = !verdict ? "Choose KYC4U's result."
    : !date ? "Give the date of KYC4U's result."
    : verdict === "approved" && !files.length ? "Attach KYC4U's report or their email approving the party."
    : verdict !== "approved" && !files.length && note.trim().length < SIGN_OFF_NOTE_MIN ? "Attach KYC4U's email or say what they said."
    : null;
  const formWith = (chosen: File[]) => {
    const fd = new FormData();
    for (const f of chosen) fd.append("files", f);
    return fd;
  };
  // KYC4U's pack is read as soon as it is chosen: where each file will be
  // filed, and what their risk report says, filled in below for you to check.
  const read = useMutation({
    mutationFn: async (chosen: File[]) => {
      const res = await fetch(`/api/deals/${dealId}/parties/${role}/kyc4u-result/read`, { method: "POST", body: formWith(chosen), credentials: "include", headers: getAuthHeaders() });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.message || "KYC4U's files could not be read.");
      return body as Kyc4uPackReading;
    },
    onSuccess: (r) => {
      setReading(r);
      const p = r.prefill;
      if (p.verdict) setVerdict(v => v || p.verdict!);
      if (p.date) setDate(p.date);
      if (p.reference) setReference(v => v.trim() ? v : p.reference!);
      if (p.note) setNote(v => v.trim() ? v : p.note);
    },
    onError: (e: any) => { setReading(null); toast({ title: "Not read", description: plain(e), variant: "destructive" }); },
  });
  const save = useMutation({
    mutationFn: async () => {
      const fd = formWith(files);
      fd.append("verdict", verdict);
      fd.append("date", date);
      if (reference.trim()) fd.append("reference", reference.trim());
      if (note.trim()) fd.append("note", note.trim());
      const res = await fetch(`/api/deals/${dealId}/parties/${role}/kyc4u-result`, { method: "POST", body: fd, credentials: "include", headers: getAuthHeaders() });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.message || "KYC4U's result could not be saved.");
      return body;
    },
    onSuccess: (r: any) => {
      refreshAfterDecision(dealId);
      toast({ title: "KYC4U's result added", description: r?.message || `${partyName}: ${verdict ? KYC4U_RESULTS[verdict] : ""}. ${r?.filed ? `${r.filed} file${r.filed === 1 ? " is" : "s are"} on its KYC record.` : ""}`.trim() });
      onClose();
    },
    onError: (e: any) => toast({ title: "Not added", description: plain(e), variant: "destructive" }),
  });
  const groups = reading ? Array.from(reading.files.reduce((m, f) => m.set(f.heading, [...(m.get(f.heading) || []), f]), new Map<string, Kyc4uPackReading["files"]>())) : [];
  const report = reading?.report || null;
  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[88vh] overflow-y-auto" data-testid={`aml-kyc4u-result-dialog-${role}`}>
        <DialogHeader>
          <DialogTitle>Add KYC4U's result</DialogTitle>
          <DialogDescription>
            For {partyName}. KYC4U are BGP's outsourced KYC provider: you record their result as the Nominated Officer or a Deputy, and a later KYC4U request for the party replaces this one. An approval lasts 1 year when the party needs enhanced due diligence or KYC4U rate it high risk, otherwise 3.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="block">KYC4U's pack or files</Label>
            <input ref={fileRef} type="file" multiple className="hidden" accept=".zip,.pdf,.png,.jpg,.jpeg,.heic,.doc,.docx,.xls,.xlsx,.csv,.msg,.eml,.txt"
              onChange={e => {
                const chosen = Array.from(e.target.files || []).slice(0, KYC4U_RESULT_MAX_FILES);
                setFiles(chosen);
                setReading(null);
                if (chosen.length) read.mutate(chosen);
              }} data-testid={`aml-kyc4u-files-${role}`} />
            <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={read.isPending}>
              <FileUp className="w-3.5 h-3.5 mr-1.5" />{files.length ? "Choose again" : "Choose KYC4U's zip or files"}
            </Button>
            <p className="text-[11px] text-muted-foreground">KYC4U's zip as they send it (up to 100MB), or up to {KYC4U_RESULT_MAX_FILES} files of 25MB each. Each file is filed on the party's KYC record under its folder: the heads of terms, the company, each holding company, each owner.</p>
            {read.isPending && (
              <p className="text-[11px] text-muted-foreground flex items-center gap-1.5" data-testid={`aml-kyc4u-reading-${role}`}><Loader2 className="w-3 h-3 animate-spin" />Reading KYC4U's files…</p>
            )}
            {!reading && !read.isPending && files.length > 0 && (
              <ul className="text-[11px] text-muted-foreground space-y-0.5" data-testid={`aml-kyc4u-file-list-${role}`}>
                {files.map(f => <li key={`${f.name}-${f.size}`} className="truncate">{f.name}</li>)}
              </ul>
            )}
          </div>
          {report && (
            <div className="rounded-md border bg-muted/40 p-2.5 space-y-1.5 text-xs" data-testid={`aml-kyc4u-report-${role}`}>
              <p className="font-medium">
                KYC4U's risk assessment{report.jobId ? ` ${report.jobId}` : ""}{report.levelOfRisk ? `: ${report.levelOfRisk} risk` : ""}
              </p>
              {report.risks.some(r => r.value) && (
                <div className="flex flex-wrap gap-1">
                  {report.risks.filter(r => r.value).map(r => (
                    <span key={r.label} className="rounded-full border bg-background px-2 py-0.5 text-[11px]">{r.label}: {r.value}{r.details ? ` (${r.details})` : ""}</span>
                  ))}
                </div>
              )}
              {report.conclusion && <p className="text-muted-foreground">{report.conclusion}</p>}
              {reading!.prefill.lines.filter(l => !/^(KYC4U reference|Level of risk|Client Risk|Geographic Risk|Other Risk|PEP Involved Risk)/.test(l)).map(l => (
                <p key={l} className="text-muted-foreground">{l}</p>
              ))}
              {reading!.prefill.highRisk && <p className="text-amber-700 dark:text-amber-400">KYC4U rate it high risk: the approval lasts 1 year.</p>}
              <p className="text-[11px] text-muted-foreground">Read from KYC4U's report and filled in below: check it before you save.</p>
            </div>
          )}
          {reading && reading.files.length > 0 && (
            <div className="space-y-1" data-testid={`aml-kyc4u-pack-files-${role}`}>
              <p className="text-xs font-medium">Where the files go ({reading.files.length})</p>
              {groups.map(([heading, list]) => (
                <div key={heading} className="text-[11px]">
                  <p className="font-medium text-foreground/80">{heading}</p>
                  <ul className="text-muted-foreground pl-3">
                    {list.map(f => <li key={f.path} className="truncate">{f.name} <span className="opacity-70">· {f.docWords}</span></li>)}
                  </ul>
                </div>
              ))}
            </div>
          )}
          {reading && reading.skipped.length > 0 && (
            <div className="text-[11px] text-amber-700 dark:text-amber-400" data-testid={`aml-kyc4u-pack-skipped-${role}`}>
              <p className="font-medium">Not filed ({reading.skipped.length})</p>
              <ul className="pl-3">{reading.skipped.slice(0, 8).map(sk => <li key={sk.path} className="truncate">{sk.path}: {sk.reason}</li>)}</ul>
            </div>
          )}
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
            <Label htmlFor={`aml-kyc4u-note-${role}`}>Note</Label>
            <Textarea id={`aml-kyc4u-note-${role}`} value={note} onChange={e => setNote(e.target.value)} rows={3} maxLength={1000}
              placeholder={verdict === "more_info" ? "What KYC4U asked for" : "Anything to add"} data-testid={`aml-kyc4u-note-${role}`} />
          </div>
          {missing && <p className="text-[11px] text-muted-foreground">{missing}</p>}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="button" disabled={!!missing || save.isPending || read.isPending} onClick={() => save.mutate()} data-testid={`aml-kyc4u-save-${role}`}>
            {save.isPending && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}Add result
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// "Not required" (BGP's AML policy, G and F.f): the other side of a deal a
// joint agent found and negotiated, or one where no deal was done.
function NotRequiredDialog({ dealId, role, partyName, onClose }: { dealId: string; role: string; partyName: string; onClose: () => void }) {
  const { toast } = useToast();
  const [reason, setReason] = useState<NotRequiredReason | "">("");
  const [comment, setComment] = useState("");
  const missing = !reason ? "Choose why." : comment.trim().length < NOT_REQUIRED_COMMENT_MIN ? "Say what happened (at least a sentence)." : null;
  const save = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/deals/${dealId}/parties/${role}/not-required`, { reason, comment: comment.trim() })).json(),
    onSuccess: () => { refreshAfterDecision(dealId); toast({ title: "Marked Not required", description: `${partyName} needs no checks on this deal.` }); onClose(); },
    onError: (e: any) => toast({ title: "Not marked", description: plain(e), variant: "destructive" }),
  });
  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md" data-testid={`aml-not-required-dialog-${role}`}>
        <DialogHeader>
          <DialogTitle>No checks needed on {partyName}?</DialogTitle>
          <DialogDescription>
            BGP's AML policy: no checks are needed on the other side of a deal when a joint agent found and negotiated it, or when no deal is done. Never for BGP's own client. It stays on the deal with your name and the reason.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Why</Label>
            <Select value={reason} onValueChange={v => setReason(v as NotRequiredReason)}>
              <SelectTrigger data-testid={`aml-not-required-reason-${role}`}><SelectValue placeholder="Choose" /></SelectTrigger>
              <SelectContent>
                {(Object.keys(NOT_REQUIRED_REASONS) as NotRequiredReason[]).map(k => <SelectItem key={k} value={k}>{NOT_REQUIRED_REASONS[k]}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`aml-not-required-comment-${role}`}>What happened</Label>
            <Textarea id={`aml-not-required-comment-${role}`} value={comment} onChange={e => setComment(e.target.value)} rows={3} maxLength={1000}
              placeholder="For example: Savills found the tenant and ran the negotiation; BGP acted for the landlord only"
              data-testid={`aml-not-required-comment-${role}`} />
          </div>
          {missing && <p className="text-[11px] text-muted-foreground">{missing}</p>}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="button" disabled={!!missing || save.isPending} onClick={() => save.mutate()} data-testid={`aml-not-required-save-${role}`}>
            {save.isPending && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}Mark Not required
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Under a party on the AML card (and in Kick off AML): Sign off for whoever
// may sign it off (an agent on the deal, the Nominated Officer or the
// Deputy), and Add KYC4U result and Not required for the officers.
// `approved`: the party is approved and in date, so the reason it cannot be
// signed off again is not shown. `notRequired`: marked so; the officers can
// take the marker off.
export function PartyDecisions({ dealId, data, companyId, role, partyName, approved, compact, notRequired }: {
  dealId: string; data: DealAmlStatus | undefined; companyId: string; role: string; partyName: string; approved?: boolean; compact?: boolean; notRequired?: boolean;
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState<"sign-off" | "kyc4u" | "not-required" | null>(null);
  const undo = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/deals/${dealId}/parties/${role}/not-required/undo`, {})).json(),
    onSuccess: () => { refreshAfterDecision(dealId); toast({ title: "Taken off", description: `${partyName} needs its checks again.` }); },
    onError: (e: any) => toast({ title: "Not taken off", description: plain(e), variant: "destructive" }),
  });
  const decisions = data?.decisions;
  const canSignOff = !!(decisions?.canSignOff ?? decisions?.canDecide);
  if (!decisions || (!decisions.canDecide && !canSignOff)) return null;
  if (notRequired) {
    return decisions.canDecide ? (
      <div className="flex flex-wrap gap-1.5" data-testid={`aml-decisions-${role}`}>
        <Button type="button" variant="outline" size="sm" className="h-7 text-xs" disabled={undo.isPending} onClick={() => undo.mutate()} data-testid={`aml-not-required-undo-${role}`}>
          <Undo2 className="w-3.5 h-3.5 mr-1" />Take off Not required
        </Button>
      </div>
    ) : null;
  }
  const view = decisions.parties[companyId];
  // null: it may be signed off now (so never `??`, which would read null as missing).
  const blocked = view ? view.blocked : "This party could not be read.";
  const level = data?.redFlags?.levels?.[companyId];
  return (
    <div className="space-y-1" data-testid={`aml-decisions-${role}`}>
      <div className="flex flex-wrap gap-1.5">
        {!approved && canSignOff && (
          <Button type="button" variant="outline" size="sm" className="h-7 text-xs" disabled={!!blocked} title={blocked || undefined}
            onClick={() => setOpen("sign-off")} data-testid={`aml-sign-off-${role}`}>
            <BadgeCheck className="w-3.5 h-3.5 mr-1" />Sign off
          </Button>
        )}
        {decisions.canDecide && (
          <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={() => setOpen("kyc4u")} data-testid={`aml-kyc4u-result-${role}`}>
            <FileUp className="w-3.5 h-3.5 mr-1" />Add KYC4U result
          </Button>
        )}
        {decisions.canDecide && !approved && (
          <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setOpen("not-required")} data-testid={`aml-not-required-${role}`}>
            <CircleSlash className="w-3.5 h-3.5 mr-1" />Not required
          </Button>
        )}
      </div>
      {!approved && !compact && blocked && canSignOff && (
        <p className="text-[11px] text-muted-foreground" data-testid={`aml-sign-off-blocked-${role}`}>Sign off: {blocked}</p>
      )}
      {open === "sign-off" && <SignOffDialog dealId={dealId} role={role} partyName={partyName} needsNote={!!view?.needsNote}
        levelWords={level && level.level !== "enhanced" ? DUE_DILIGENCE_LABEL[level.level] : null} onClose={() => setOpen(null)} />}
      {open === "kyc4u" && <Kyc4uResultDialog dealId={dealId} role={role} partyName={partyName} onClose={() => setOpen(null)} />}
      {open === "not-required" && <NotRequiredDialog dealId={dealId} role={role} partyName={partyName} onClose={() => setOpen(null)} />}
    </div>
  );
}

// One decision as a single button, for the AML box's Next line (20 November
// 2026): Sign off, or Add KYC4U result. The same dialogs, the same server
// checks; the button is only offered to those the deal's AML status says may.
export function PartyDecisionButton({ dealId, data, companyId, role, partyName, kind }: {
  dealId: string; data: DealAmlStatus | undefined; companyId: string; role: string; partyName: string; kind: "sign_off" | "kyc4u_result";
}) {
  const [open, setOpen] = useState(false);
  const decisions = data?.decisions;
  const view = decisions?.parties[companyId];
  const level = data?.redFlags?.levels?.[companyId];
  if (!decisions) return null;
  if (kind === "sign_off") {
    const canSignOff = !!(decisions.canSignOff ?? decisions.canDecide);
    if (!canSignOff || !view || view.blocked) return null;
    return (
      <>
        <Button type="button" size="sm" className="h-7 text-xs" onClick={() => setOpen(true)} data-testid={`aml-next-sign-off-${role}`}>
          <BadgeCheck className="w-3.5 h-3.5 mr-1" />Sign off
        </Button>
        {open && <SignOffDialog dealId={dealId} role={role} partyName={partyName} needsNote={!!view.needsNote}
          levelWords={level && level.level !== "enhanced" ? DUE_DILIGENCE_LABEL[level.level] : null} onClose={() => setOpen(false)} />}
      </>
    );
  }
  if (!decisions.canDecide) return null;
  return (
    <>
      <Button type="button" size="sm" variant="outline" className="h-7 text-xs bg-background" onClick={() => setOpen(true)} data-testid={`aml-next-kyc4u-result-${role}`}>
        <FileUp className="w-3.5 h-3.5 mr-1" />Add KYC4U result
      </Button>
      {open && <Kyc4uResultDialog dealId={dealId} role={role} partyName={partyName} onClose={() => setOpen(false)} />}
    </>
  );
}
