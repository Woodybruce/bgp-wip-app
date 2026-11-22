// The AML register on screen (Woody, 19 November 2026): any BGP person sends
// the Nominated Officer a report (a suspicion, a sanctions concern, an
// unregistered agent), and the Nominated Officer and the Deputy read every
// entry and record what they decided and reported. The rules and the words
// are shared/aml-register.ts; the routes server/aml-register.ts.
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { AlertTriangle, Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Pill, PillCount } from "@/components/ui/pill";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  DAML_OUTCOME_WORDS, OUTCOME_WORDS, REGISTER_CONCERN_MIN, REGISTER_KINDS, REGISTER_KIND_INFO, REGISTER_STATUS_WORDS, TIPPING_OFF_WARNING,
  type RegisterDetails, type RegisterKind, type RegisterStatus,
} from "@shared/aml-register";

const plain = (e: unknown) => String((e as any)?.message || e || "").replace(/^\d{3}:\s*/, "").replace(/^\{"message":"(.*?)"(,.*)?\}$/, "$1");
const day = (iso: string | null | undefined) => (iso ? new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" }) : "");

interface OwnEntry { id: number; kind: RegisterKind; kindWords: string; concern: string; raisedAt: string | null; where: string }
export interface RegisterEntry {
  id: number; kind: RegisterKind; kindWords: string; reportedTo: string; concern: string;
  dealId: string | null; dealName: string | null; dealRef: number | null; role: string | null;
  companyId: string | null; companyName: string | null; tradingEntityName: string | null;
  raisedBy: string | null; raisedAt: string | null; status: RegisterStatus; reportedOn: string | null; reference: string | null; reason: string | null;
  decidedBy: string | null; decidedAt: string | null; updatedBy: string | null; updatedAt: string | null;
  details: RegisterDetails; daml: { noticeEnds: string | null; moratoriumEnds: string | null } | null;
}

function refreshRegister() {
  queryClient.invalidateQueries({ queryKey: ["/api/aml-register"] });
  queryClient.invalidateQueries({ queryKey: ["/api/aml-register/mine"] });
}

export function RaiseReportDialog({ onClose, dealId, role, companyId, kind: startKind = "suspicion", seed = "", officer = false }: {
  onClose: () => void; dealId?: string | null; role?: string | null; companyId?: string | null; kind?: RegisterKind; seed?: string; officer?: boolean;
}) {
  const { toast } = useToast();
  const [kind, setKind] = useState<RegisterKind>(startKind);
  const [concern, setConcern] = useState(seed);
  const kinds = REGISTER_KINDS.filter(k => officer || REGISTER_KIND_INFO[k].staffMayRaise);
  const send = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/aml-register", { kind, concern, dealId: dealId || null, role: role || null, companyId: companyId || null })).json(),
    onSuccess: () => { refreshRegister(); toast({ title: "Sent to the Nominated Officer", description: "They have been told a report is waiting. What it says is not in their email." }); onClose(); },
    onError: (e: any) => toast({ title: "Not sent", description: plain(e), variant: "destructive" }),
  });
  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg" data-testid="aml-raise-dialog">
        <DialogHeader>
          <DialogTitle>Report to the Nominated Officer</DialogTitle>
          <DialogDescription>Only the Nominated Officer and the Deputies see it. Don't tell the client.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="space-y-1.5">
            <Label>What it is about</Label>
            <Select value={kind} onValueChange={v => setKind(v as RegisterKind)}>
              <SelectTrigger data-testid="aml-raise-kind"><SelectValue /></SelectTrigger>
              <SelectContent>{kinds.map(k => <SelectItem key={k} value={k}>{REGISTER_KIND_INFO[k].label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>What you know</Label>
            <Textarea value={concern} onChange={e => setConcern(e.target.value)} rows={6} placeholder={REGISTER_KIND_INFO[kind].ask} data-testid="aml-raise-concern" />
          </div>
          {kind === "suspicion" && (
            <p className="flex gap-1.5 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-950 dark:bg-amber-950/20 dark:text-amber-100" data-testid="aml-raise-tipping-off">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />{TIPPING_OFF_WARNING}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="button" disabled={concern.trim().length < REGISTER_CONCERN_MIN || send.isPending} onClick={() => send.mutate()} data-testid="aml-raise-send">
            {send.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Send className="w-3.5 h-3.5 mr-1.5" />}Send
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** A button that opens the report form. */
export function RaiseReportButton({ label = "Report a suspicion", className, variant = "outline", testId = "aml-raise", ...props }: {
  label?: string; className?: string; variant?: "outline" | "ghost" | "secondary" | "text"; testId?: string;
  dealId?: string | null; role?: string | null; companyId?: string | null; kind?: RegisterKind; seed?: string; officer?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {variant === "text"
        ? <button type="button" className={className || "text-xs underline-offset-2 hover:underline"} onClick={() => setOpen(true)} data-testid={testId}>{label}</button>
        : <Button type="button" variant={variant} size="sm" className={className || "h-7 text-xs"} onClick={() => setOpen(true)} data-testid={testId}>{label}</Button>}
      {open && <RaiseReportDialog {...props} onClose={() => setOpen(false)} />}
    </>
  );
}

/** The reports you raised: that each reached the Nominated Officer, never what they decided. */
export function MyRegisterReports() {
  const { data } = useQuery<{ entries: OwnEntry[] }>({ queryKey: ["/api/aml-register/mine"] });
  if (!data?.entries.length) return null;
  return (
    <div className="rounded-lg border bg-card p-3 text-sm space-y-1.5" data-testid="aml-my-reports">
      <div className="font-medium">Your reports to the Nominated Officer</div>
      <ul className="space-y-1">
        {data.entries.map(e => (
          <li key={e.id} className="text-xs flex flex-wrap gap-x-2">
            <span className="text-muted-foreground">{day(e.raisedAt)}</span>
            <span className="font-medium">{e.kindWords}</span>
            <span className="truncate max-w-[420px]" title={e.concern}>{e.concern}</span>
            <span className="text-muted-foreground">· {e.where}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const STATUS_TONE: Record<RegisterStatus, string> = {
  open: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200",
  reported: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200",
  no_report: "bg-muted text-muted-foreground",
  closed: "bg-muted text-muted-foreground",
};

function EntryDialog({ entry, onClose }: { entry: RegisterEntry; onClose: () => void }) {
  const { toast } = useToast();
  const info = REGISTER_KIND_INFO[entry.kind];
  const [status, setStatus] = useState<RegisterStatus>(entry.status);
  const [reportedOn, setReportedOn] = useState(entry.reportedOn || "");
  const [reference, setReference] = useState(entry.reference || "");
  const [reason, setReason] = useState(entry.reason || "");
  const [d, setD] = useState<RegisterDetails>(entry.details || {});
  const set = (k: keyof RegisterDetails, v: any) => setD(prev => ({ ...prev, [k]: v || null }));
  const save = useMutation({
    mutationFn: async () => (await apiRequest("PATCH", `/api/aml-register/${entry.id}`, { status, reportedOn: reportedOn || null, reference, reason, details: d })).json(),
    onSuccess: () => { refreshRegister(); toast({ title: "Saved" }); onClose(); },
    onError: (e: any) => toast({ title: "Not saved", description: plain(e), variant: "destructive" }),
  });
  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="aml-register-entry">
        <DialogHeader>
          <DialogTitle>#{entry.id} · {info.short}</DialogTitle>
          <DialogDescription>
            Raised {day(entry.raisedAt)}{entry.raisedBy ? ` by ${entry.raisedBy}` : ""}. Reported to {info.reportedTo} where it needs to be.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="rounded-md border bg-muted/30 p-2.5 whitespace-pre-wrap" data-testid="aml-register-concern">{entry.concern}</div>
          {(entry.dealId || entry.companyName) && (
            <div className="text-xs text-muted-foreground">
              {entry.dealId && <>Deal: <Link href={`/deals/${entry.dealId}?section=parties`} className="text-primary hover:underline">{entry.dealName || "the deal"}{entry.dealRef != null ? ` (#${entry.dealRef})` : ""}</Link></>}
              {entry.companyName && <>{entry.dealId ? " · " : ""}{entry.role ? `${entry.role}: ` : ""}{entry.companyName}{entry.tradingEntityName ? `, signing as ${entry.tradingEntityName}` : ""}</>}
            </div>
          )}
          {entry.kind === "suspicion" && <p className="text-xs text-amber-800 dark:text-amber-200">{TIPPING_OFF_WARNING}</p>}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Where it stands</Label>
              <Select value={status} onValueChange={v => setStatus(v as RegisterStatus)}>
                <SelectTrigger data-testid="aml-register-status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="open">Open: still being looked at</SelectItem>
                  <SelectItem value="reported">Reported to {info.reportedTo}</SelectItem>
                  <SelectItem value="no_report">No report made</SelectItem>
                  <SelectItem value="closed">Closed</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {status === "reported" && (
              <>
                <div className="space-y-1.5">
                  <Label>Reported on</Label>
                  <Input type="date" value={reportedOn} onChange={e => setReportedOn(e.target.value)} data-testid="aml-register-reported-on" />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>Their reference</Label>
                  <Input value={reference} onChange={e => setReference(e.target.value)} placeholder="The reference the NCA, OFSI, Companies House or HMRC gave" data-testid="aml-register-reference" />
                </div>
              </>
            )}
          </div>
          {(status === "no_report" || status === "closed") && (
            <div className="space-y-1.5">
              <Label>{status === "no_report" ? "Why no report is being made" : "Why it is closed"}</Label>
              <Textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} data-testid="aml-register-reason" />
            </div>
          )}
          {entry.kind === "sanctions" && (
            <div className="grid gap-3 sm:grid-cols-2 rounded-md border p-2.5">
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Funds or economic resources BGP holds for them</Label>
                <Textarea value={d.fundsHeld || ""} onChange={e => set("fundsHeld", e.target.value)} rows={2} placeholder="OFSI asks for the nature and amount at the time BGP first knew or suspected (for an agent, often none)" />
              </div>
              <div className="space-y-1.5">
                <Label>Legal advice taken</Label>
                <Input value={d.legalAdvice || ""} onChange={e => set("legalAdvice", e.target.value)} placeholder="Firm and date" />
              </div>
              <div className="space-y-1.5">
                <Label>What BGP did</Label>
                <Select value={d.outcome || "none"} onValueChange={v => set("outcome", v === "none" ? null : v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Not decided yet</SelectItem>
                    {(Object.keys(OUTCOME_WORDS) as Array<keyof typeof OUTCOME_WORDS>).map(k => <SelectItem key={k} value={k}>{OUTCOME_WORDS[k]}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
          {entry.kind === "suspicion" && (
            <div className="grid gap-3 sm:grid-cols-2 rounded-md border p-2.5">
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Further information asked for</Label>
                <Textarea value={d.furtherInfo || ""} onChange={e => set("furtherInfo", e.target.value)} rows={2} placeholder="What was asked of the client or third party to resolve it" />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Discussed with senior management</Label>
                <Input value={d.seniorManagement || ""} onChange={e => set("seniorManagement", e.target.value)} placeholder="Who, and when" />
              </div>
              <div className="space-y-1.5">
                <Label>Consent (DAML) asked for on</Label>
                <Input type="date" value={d.damlRequestedOn || ""} onChange={e => set("damlRequestedOn", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>The NCA's answer</Label>
                <Select value={d.damlOutcome || "none"} onValueChange={v => set("damlOutcome", v === "none" ? null : v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None yet</SelectItem>
                    {(Object.keys(DAML_OUTCOME_WORDS) as Array<keyof typeof DAML_OUTCOME_WORDS>).map(k => <SelectItem key={k} value={k}>{DAML_OUTCOME_WORDS[k]}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {d.damlOutcome && d.damlOutcome !== "deemed" && (
                <div className="space-y-1.5">
                  <Label>Answered on</Label>
                  <Input type="date" value={d.damlOutcomeOn || ""} onChange={e => set("damlOutcomeOn", e.target.value)} />
                </div>
              )}
              {entry.daml?.noticeEnds && (
                <p className="sm:col-span-2 text-xs text-muted-foreground" data-testid="aml-register-daml">
                  Seven working days from the request: the notice period ends {day(entry.daml.noticeEnds)}{entry.daml.moratoriumEnds ? `; the moratorium after the refusal runs to ${day(entry.daml.moratoriumEnds)}` : ""}. The NCA's own letter gives the dates to rely on; the transaction does not go ahead before consent.
                </p>
              )}
            </div>
          )}
          <div className="space-y-1.5">
            <Label>Notes</Label>
            <Textarea value={d.notes || ""} onChange={e => set("notes", e.target.value)} rows={3} />
          </div>
          {(entry.decidedBy || entry.updatedBy) && (
            <p className="text-[11px] text-muted-foreground">
              {entry.decidedBy ? `Decided by ${entry.decidedBy}${entry.decidedAt ? ` on ${day(entry.decidedAt)}` : ""}. ` : ""}{entry.updatedBy ? `Last saved by ${entry.updatedBy}${entry.updatedAt ? `, ${day(entry.updatedAt)}` : ""}.` : ""}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="button" disabled={save.isPending} onClick={() => save.mutate()} data-testid="aml-register-save">
            {save.isPending && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The officers' view of the register. */
export function AmlRegisterBoard() {
  const { data, isLoading, error } = useQuery<{ entries: RegisterEntry[] }>({ queryKey: ["/api/aml-register"] });
  const [status, setStatus] = useState<RegisterStatus | "all">("open");
  const [open, setOpen] = useState<RegisterEntry | null>(null);
  if (isLoading) return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" />Reading the register…</div>;
  if (error) return <p className="text-sm text-destructive">{plain(error)}</p>;
  const entries = data?.entries || [];
  const count = (s: RegisterStatus | "all") => (s === "all" ? entries.length : entries.filter(e => e.status === s).length);
  const shown = status === "all" ? entries : entries.filter(e => e.status === status);
  return (
    <div className="space-y-3" data-testid="aml-register-board">
      <p className="text-sm text-muted-foreground">Reports to the Nominated Officer and what was done with each. Only the officers see this.</p>
      <div className="flex flex-wrap items-center gap-1.5">
        {(["open", "reported", "no_report", "closed", "all"] as const).map(s => (
          <Pill key={s} active={status === s} onClick={() => setStatus(s)} data-testid={`aml-register-pill-${s}`}>
            {s === "all" ? "All" : REGISTER_STATUS_WORDS[s]}<PillCount n={count(s)} active={status === s} />
          </Pill>
        ))}
        <div className="ml-auto"><RaiseReportButton label="Add an entry" officer testId="aml-register-add" /></div>
      </div>
      {!shown.length ? <p className="text-sm text-muted-foreground" data-testid="aml-register-empty">Nothing here.</p> : (
        <ul className="divide-y rounded-lg border bg-card">
          {shown.map(e => (
            <li key={e.id}>
              <button type="button" className="w-full text-left p-3 hover:bg-muted/40 space-y-1" onClick={() => setOpen(e)} data-testid={`aml-register-row-${e.id}`}>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium">#{e.id} {e.kindWords}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_TONE[e.status]}`}>{e.status === "reported" ? `Reported to ${e.reportedTo.replace(/ \(a SAR\)$/, "")}` : REGISTER_STATUS_WORDS[e.status]}</span>
                  <span className="text-xs text-muted-foreground">{day(e.raisedAt)}{e.raisedBy ? ` · ${e.raisedBy}` : ""}</span>
                  {e.daml?.noticeEnds && !e.details.damlOutcome && <span className="text-xs text-red-700 dark:text-red-300">Consent notice period ends {day(e.daml.noticeEnds)}</span>}
                </div>
                <div className="text-xs text-muted-foreground truncate">{e.dealName ? `${e.dealName} · ` : ""}{e.companyName ? `${e.companyName} · ` : ""}{e.concern}</div>
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && <EntryDialog entry={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
