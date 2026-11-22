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
import { IN_HOUSE_EDD_NOTE_MIN, KYC4U_RESULTS, KYC4U_RESULT_MAX_FILES, SIGN_OFF_NOTE_MIN, type Kyc4uResultKey } from "@shared/party-kyc";
import {
  DUE_DILIGENCE_LABEL, JOINT_ASKED_HOW, JOINT_OUTCOMES, NOT_REQUIRED_REASONS, jointAgentNotRequiredRefusal, notRequiredInput,
  type JointAgentRule, type JointAskedHow, type JointOutcome, type NotRequiredReason,
} from "@shared/aml-policy";
import { useJointChecks } from "@/components/joint-agent-checks";
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

function SignOffDialog({ dealId, role, partyName, needsNote, levelWords, edd, onClose }: { dealId: string; role: string; partyName: string; needsNote: boolean; levelWords: string | null; edd?: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const [note, setNote] = useState("");
  const short = (edd && note.trim().length < IN_HOUSE_EDD_NOTE_MIN) || (needsNote && note.trim().length < SIGN_OFF_NOTE_MIN);
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
            {edd
              ? "Enhanced checks: cleared for a year."
              : <>{levelWords ? `${levelWords}. ` : ""}Cleared for three years.</>}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor={`aml-sign-off-note-${role}`}>What you relied on{needsNote ? "" : " (optional)"}</Label>
          <Textarea id={`aml-sign-off-note-${role}`} value={note} onChange={e => setNote(e.target.value)} rows={3} maxLength={1000}
            placeholder="For example: listed plc, register owners confirmed, ID seen in person on 12 Nov"
            data-testid={`aml-sign-off-note-${role}`} />
          {edd ? (
            <p className="text-[11px] text-muted-foreground" data-testid={`aml-sign-off-edd-${role}`}>What was checked and why the risk is acceptable: each flag, where the money comes from, who is behind it. A couple of sentences.</p>
          ) : needsNote && (
            <p className="text-[11px] text-muted-foreground">The client checks aren't finished: say what you relied on.</p>
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
            KYC4U's result for {partyName}. An approval lasts a year if KYC4U rate it high risk, otherwise three.
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
// HMRC's rules (Woody, 22 November 2026: "We have to do what HMRC say"): on a
// sale the joint agent reason needs the record of asking the joint agent for
// their checks and what came back (AMLG2200 s21): a request made in the app
// (server/joint-agent-checks.ts), or how, when and whom BGP asked otherwise.
// On a letting at £10,000 a month or more the reason is not offered.
export function NotRequiredDialog({ dealId, role, companyId, partyName, jointRule, initialRef, onClose }: {
  dealId: string; role: string; companyId?: string; partyName: string; jointRule?: JointAgentRule | null; initialRef?: string | null; onClose: () => void;
}) {
  const { toast } = useToast();
  const rule: JointAgentRule = jointRule || "other";
  const [reason, setReason] = useState<NotRequiredReason | "">(initialRef ? "joint_agent" : "");
  const [comment, setComment] = useState("");
  const joint = useJointChecks(dealId, reason === "joint_agent" && rule === "sale");
  const jointParty = joint.data?.parties.find(p => p.companyId === companyId) || null;
  const requests = (jointParty?.requests || []).filter(r => r.status !== "cancelled" && (r.sentAt || r.openedAt || r.manual));
  // What the latest request's files do not cover, and what they show (22 November 2026).
  const currentRef = jointParty?.requests.find(r => r.status !== "cancelled")?.ref || null;
  const gapsOf = (ref: string) => (ref && ref === currentRef && jointParty?.coverage ? { missing: jointParty.coverage.missing, flags: jointParty.coverage.flags } : { missing: [] as string[], flags: [] as string[] });
  const [missingText, setMissingText] = useState("");
  const [flagNote, setFlagNote] = useState("");
  const [checkedByHand, setCheckedByHand] = useState("");
  const [askedBy, setAskedBy] = useState<"app" | "other">(initialRef ? "app" : "other");
  const [jointRef, setJointRef] = useState(initialRef || "");
  const [askedOn, setAskedOn] = useState("");
  const [askedHow, setAskedHow] = useState<JointAskedHow | "">("");
  const [askedWhom, setAskedWhom] = useState("");
  const [outcome, setOutcome] = useState<JointOutcome | "">("");
  const selected = askedBy === "app" ? gapsOf(jointRef) : { missing: [] as string[], flags: [] as string[] };
  const body = {
    reason, comment: comment.trim(),
    ...(reason === "joint_agent" && rule === "sale" ? {
      outcome,
      ...(askedBy === "app" ? { jointRef } : { askedOn, askedHow, askedWhom: askedWhom.trim() }),
      ...(outcome === "partly" ? { missing: missingText } : {}),
      ...(outcome !== "not_provided" && selected.flags.length ? { flagNote: flagNote.trim() } : {}),
      ...(outcome === "received" && selected.missing.length ? { checkedByHand: checkedByHand.trim() } : {}),
    } : {}),
  };
  const forRecord = requests.map(r => ({
    ref: r.ref, sentAt: r.manual ? r.files[0]?.uploadedAt || new Date().toISOString() : r.sentAt || r.openedAt,
    whom: `${r.firm}${r.to ? ` (${r.to})` : ""}`, how: r.manual ? "email" as const : "app" as const, files: r.files.length,
    ...gapsOf(r.ref),
  }));
  // "They sent part of their checks": what did not come, from their files, to check and edit.
  const pickOutcome = (v: JointOutcome) => {
    setOutcome(v);
    if (v === "partly" && !missingText.trim() && selected.missing.length) setMissingText(selected.missing.join("\n"));
  };
  const checked = reason ? notRequiredInput(body, { rule, requests: forRecord }) : null;
  const refused = reason === "joint_agent" ? jointAgentNotRequiredRefusal(rule) : null;
  const missing = !reason ? "Choose why." : checked && "problem" in checked ? checked.problem : null;
  const save = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/deals/${dealId}/parties/${role}/not-required`, body)).json(),
    onSuccess: () => { refreshAfterDecision(dealId); queryClient.invalidateQueries({ queryKey: ["/api/deals", dealId, "joint-agent-checks"] }); toast({ title: "Marked Not required", description: `${partyName} needs no checks on this transaction.` }); onClose(); },
    onError: (e: any) => toast({ title: "Not marked", description: plain(e), variant: "destructive" }),
  });
  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto" data-testid={`aml-not-required-dialog-${role}`}>
        <DialogHeader>
          <DialogTitle>No checks needed on {partyName}?</DialogTitle>
          <DialogDescription>
            The joint agent dealt with this party on a sale, or no transaction was done. It stays on the transaction with your name.
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
          {refused && <p className="rounded border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200" data-testid={`aml-not-required-refused-${role}`}>{refused}</p>}
          {reason === "joint_agent" && rule === "sale" && (
            <div className="space-y-2 rounded border p-2" data-testid={`aml-not-required-asked-${role}`}>
              <p className="text-xs font-medium">How BGP asked the joint agent</p>
              <Select value={askedBy} onValueChange={v => setAskedBy(v as "app" | "other")}>
                <SelectTrigger className="h-8 text-xs" data-testid={`aml-not-required-asked-by-${role}`}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="app">The request in the app</SelectItem>
                  <SelectItem value="other">Asked another way</SelectItem>
                </SelectContent>
              </Select>
              {askedBy === "app" ? (
                requests.length ? (
                  <Select value={jointRef} onValueChange={setJointRef}>
                    <SelectTrigger className="h-8 text-xs" data-testid={`aml-not-required-ref-${role}`}><SelectValue placeholder="Choose the request" /></SelectTrigger>
                    <SelectContent>
                      {requests.map(r => <SelectItem key={r.ref} value={r.ref}>{r.firm}, ref {r.ref} · {r.files.length} file{r.files.length === 1 ? "" : "s"}</SelectItem>)}
                    </SelectContent>
                  </Select>
                ) : <p className="text-[11px] text-muted-foreground">{joint.isLoading ? "Loading the requests…" : "No request to them yet. Ask from the Joint agent line, or say how you asked."}</p>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label htmlFor={`aml-asked-on-${role}`} className="text-[11px]">When you asked</Label>
                    <Input id={`aml-asked-on-${role}`} type="date" value={askedOn} onChange={e => setAskedOn(e.target.value)} max={todayLondon()} className="h-8 text-xs" data-testid={`aml-not-required-asked-on-${role}`} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px]">How</Label>
                    <Select value={askedHow} onValueChange={v => setAskedHow(v as JointAskedHow)}>
                      <SelectTrigger className="h-8 text-xs" data-testid={`aml-not-required-asked-how-${role}`}><SelectValue placeholder="Choose" /></SelectTrigger>
                      <SelectContent>
                        {(Object.keys(JOINT_ASKED_HOW) as JointAskedHow[]).filter(k => k !== "app").map(k => <SelectItem key={k} value={k}>{JOINT_ASKED_HOW[k]}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1 sm:col-span-2">
                    <Label htmlFor={`aml-asked-whom-${role}`} className="text-[11px]">Whom, at the joint agent</Label>
                    <Input id={`aml-asked-whom-${role}`} value={askedWhom} onChange={e => setAskedWhom(e.target.value)} maxLength={160} placeholder="Savills (Jane Smith)" className="h-8 text-xs" data-testid={`aml-not-required-asked-whom-${role}`} />
                  </div>
                </div>
              )}
              <Select value={outcome} onValueChange={v => pickOutcome(v as JointOutcome)}>
                <SelectTrigger className="h-8 text-xs" data-testid={`aml-not-required-outcome-${role}`}><SelectValue placeholder="What came back" /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(JOINT_OUTCOMES) as JointOutcome[]).map(k => <SelectItem key={k} value={k}>{JOINT_OUTCOMES[k][0].toUpperCase() + JOINT_OUTCOMES[k].slice(1)}</SelectItem>)}
                </SelectContent>
              </Select>
              {outcome === "partly" && (
                <div className="space-y-1">
                  <Label htmlFor={`aml-missing-${role}`} className="text-[11px]">What they did not send (one per line)</Label>
                  <Textarea id={`aml-missing-${role}`} value={missingText} onChange={e => setMissingText(e.target.value)} rows={3} maxLength={1500} className="text-xs" data-testid={`aml-not-required-missing-text-${role}`} />
                </div>
              )}
              {outcome === "received" && selected.missing.length > 0 && (
                <div className="space-y-1 rounded border border-amber-300 bg-amber-50 p-1.5 text-[11px] text-amber-950 dark:bg-amber-950/30 dark:text-amber-100">
                  <p>Their files do not cover: {selected.missing.join("; ")}. Choose "they sent part of their checks", or say how you checked these by hand.</p>
                  <Textarea value={checkedByHand} onChange={e => setCheckedByHand(e.target.value)} rows={2} maxLength={1000} className="text-xs" data-testid={`aml-not-required-by-hand-${role}`} />
                </div>
              )}
              {outcome && outcome !== "not_provided" && selected.flags.length > 0 && (
                <div className="space-y-1 rounded border border-red-300 bg-red-50 p-1.5 text-[11px] text-red-950 dark:bg-red-950/30 dark:text-red-100" data-testid={`aml-not-required-flags-${role}`}>
                  <p>Their files show something to look at: {selected.flags.join("; ")}. Say what you did about it.</p>
                  <Textarea value={flagNote} onChange={e => setFlagNote(e.target.value)} rows={2} maxLength={1000} className="text-xs" data-testid={`aml-not-required-flag-note-${role}`} />
                </div>
              )}
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor={`aml-not-required-comment-${role}`}>What happened</Label>
            <Textarea id={`aml-not-required-comment-${role}`} value={comment} onChange={e => setComment(e.target.value)} rows={3} maxLength={1000}
              placeholder="For example: Savills found the buyer and ran the negotiation; BGP acted for the seller only"
              data-testid={`aml-not-required-comment-${role}`} />
          </div>
          {missing && !refused && <p className="text-[11px] text-muted-foreground" data-testid={`aml-not-required-missing-${role}`}>{missing}</p>}
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

/** The officers' button on the Joint agent line of a sale: Not required, with the request as the record. */
export function JointNotRequiredButton({ dealId, role, companyId, partyName, jointRef }: { dealId: string; role: string; companyId: string; partyName: string; jointRef: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" size="sm" variant="outline" className="h-7 text-xs bg-background" onClick={() => setOpen(true)} data-testid={`joint-not-required-${role}`}>
        <CircleSlash className="w-3.5 h-3.5 mr-1" />Mark Not required
      </Button>
      {open && <NotRequiredDialog dealId={dealId} role={role} companyId={companyId} partyName={partyName} jointRule="sale" initialRef={jointRef} onClose={() => setOpen(false)} />}
    </>
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
  // Enhanced due diligence by BGP is the officers' to sign off, never an agent's.
  const mayPress = canSignOff && !(view?.edd && !decisions.canDecide);
  return (
    <div className="space-y-1" data-testid={`aml-decisions-${role}`}>
      <div className="flex flex-wrap gap-1.5">
        {!approved && mayPress && (
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
      {!approved && !compact && blocked && mayPress && (
        <p className="text-[11px] text-muted-foreground" data-testid={`aml-sign-off-blocked-${role}`}>Sign off: {blocked}</p>
      )}
      {open === "sign-off" && <SignOffDialog dealId={dealId} role={role} partyName={partyName} needsNote={!!view?.needsNote} edd={!!view?.edd}
        levelWords={level && level.level !== "enhanced" ? DUE_DILIGENCE_LABEL[level.level] : null} onClose={() => setOpen(null)} />}
      {open === "kyc4u" && <Kyc4uResultDialog dealId={dealId} role={role} partyName={partyName} onClose={() => setOpen(null)} />}
      {open === "not-required" && <NotRequiredDialog dealId={dealId} role={role} companyId={companyId} partyName={partyName} jointRule={data?.jointRule || null} onClose={() => setOpen(null)} />}
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
    if (!canSignOff || !view || view.blocked || (view.edd && !decisions.canDecide)) return null;
    return (
      <>
        <Button type="button" size="sm" className="h-7 text-xs" onClick={() => setOpen(true)} data-testid={`aml-next-sign-off-${role}`}>
          <BadgeCheck className="w-3.5 h-3.5 mr-1" />Sign off
        </Button>
        {open && <SignOffDialog dealId={dealId} role={role} partyName={partyName} needsNote={!!view.needsNote} edd={!!view.edd}
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
