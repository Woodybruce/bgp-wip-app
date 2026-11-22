// The joint agent's checks on a party (Woody, 22 November 2026: "Let's get
// the app to follow HMRC rules and also send them an email so they can load
// everything up or email the aml? If they email or upload it can we then
// upload it and check it in the app?").
//
// In each party's AML box, BGP staff ask the joint agent for their checks
// (an email from the KYC mailbox with a page of their own), add the files the
// joint agent emailed to someone at BGP, and see each file as it was read,
// set against the people the checks need. The officers then decide: on a
// sale, Not required with the request as the record of asking (HMRC,
// AMLG2200 s21); on a letting at £10,000 a month or more, the reliance on the
// joint agent's checks (MLR 2017 reg 39). The server is
// server/joint-agent-checks.ts; the rules shared/joint-agent-checks.ts.
import { useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Copy, FileText, Loader2, Mail, RefreshCw, Send, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, getAuthHeaders, queryClient } from "@/lib/queryClient";
import { JOINT_DOC_KINDS, type JointAgentChecksView, type JointAgentPartyView, type JointAgentRequestView, type JointFileReading } from "@shared/joint-agent-checks";
import type { AmlBoxFacts } from "@shared/aml-box";

const plain = (e: unknown) => String((e as any)?.message || e || "").replace(/^\d{3}:\s*/, "").replace(/^\{"message":"(.*)"(,.*)?\}$/, "$1");
const day = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" }) : "");
const born = (ym: string | null | undefined) => {
  if (!ym) return "";
  const [y, m] = ym.split("-");
  return m ? new Date(`${y}-${m}-15T12:00:00Z`).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" }) : y;
};

export const jointChecksKey = (dealId: string) => ["/api/deals", dealId, "joint-agent-checks"];

export function refreshJointChecks(dealId: string) {
  queryClient.invalidateQueries({ queryKey: jointChecksKey(dealId) });
  queryClient.invalidateQueries({ queryKey: ["/api/kyc/deal", dealId, "status"] });
  queryClient.invalidateQueries({ queryKey: ["/api/aml-dashboard"] });
  queryClient.invalidateQueries({ queryKey: ["/api/crm/deals", dealId] });
}

/** The deal's joint agent checks (BGP staff only). Read again while a file is being read. */
export function useJointChecks(dealId: string, enabled: boolean) {
  return useQuery<JointAgentChecksView>({
    queryKey: jointChecksKey(dealId),
    enabled,
    queryFn: async () => (await apiRequest("GET", `/api/deals/${dealId}/joint-agent-checks`)).json(),
    refetchInterval: q => (q.state.data?.parties.some(p => p.requests.some(r => r.status !== "cancelled" && r.files.some(f => !f.reading))) ? 8000 : false),
  });
}

/** The latest request on the party that is not cancelled. */
export const currentJointRequest = (p: JointAgentPartyView | null | undefined): JointAgentRequestView | null =>
  p?.requests.find(r => r.status !== "cancelled") || null;

/** Whether the joint agent section belongs on this party's box. */
export function jointApplies(view: JointAgentChecksView | undefined, companyId: string): JointAgentPartyView | null {
  if (!view || view.rule === "letting_under" || view.rule === "advisory") return null;
  const p = view.parties.find(x => x.companyId === companyId) || null;
  if (!p || p.isClient) return null;
  return view.firm || p.requests.length ? p : null;
}

/** The facts the AML box's Next line reads (shared/aml-box.ts). */
export function jointBoxFacts(view: JointAgentChecksView | undefined, companyId: string): AmlBoxFacts["joint"] {
  const p = jointApplies(view, companyId);
  const r = currentJointRequest(p);
  if (!view || !p || !r) return null;
  return {
    status: r.status === "cancelled" ? "expired" : r.status,
    firm: r.firm,
    rule: view.rule === "sale" ? "sale" : view.rule === "letting" ? "letting" : "other",
    reliance: !!r.reliance,
    missing: p.coverage ? p.coverage.missing.length + p.coverage.flags.length : 0,
  };
}

/** The section's one line. */
export function jointSectionLine(p: JointAgentPartyView): { tone: "done" | "wait" | "act" | "flag" | "info"; summary: string } {
  const r = currentJointRequest(p);
  if (p.coverage?.flags.length) return { tone: "flag", summary: `${p.line}. ${p.coverage.flags.length} to look at` };
  if (!r) return { tone: "info", summary: p.line };
  if (r.status === "in" || r.status === "finished") return { tone: p.coverage?.complete ? "done" : "act", summary: p.coverage && !p.coverage.complete && p.coverage.missing.length ? `${p.line}. Not covered: ${p.coverage.missing.length}` : p.line };
  if (r.status === "not_sent" || r.status === "expired") return { tone: "act", summary: p.line };
  return { tone: "wait", summary: p.line };
}

const STATUS_WORDS: Record<JointAgentRequestView["status"], string> = {
  not_sent: "Email not sent", sent: "Asked, nothing back yet", opened: "They opened the link", in: "Their checks came in",
  finished: "They pressed Finish", expired: "The link ran out", cancelled: "Cancelled",
};

function readingWords(r: JointFileReading): string {
  const kind = r.kind ? JOINT_DOC_KINDS[r.kind] : "Document";
  const bits = [
    r.title && r.title.toLowerCase() !== kind.toLowerCase() ? `${kind}: ${r.title}` : kind,
    r.issuer,
    r.date ? day(r.date) : null,
    r.expiry ? `expires ${day(r.expiry)}` : null,
    r.result ? `result: ${r.result}` : null,
    r.addressVerified ? "address verified" : null,
    r.certified ? "certified copy" : null,
  ].filter(Boolean);
  return bits.join(", ");
}

function FileRow({ dealId, token, file }: { dealId: string; token: string; file: JointAgentRequestView["files"][number] }) {
  const { toast } = useToast();
  const reread = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/deals/${dealId}/joint-agent-checks/read`, { token, documentId: file.documentId })).json(),
    onSuccess: () => refreshJointChecks(dealId),
    onError: (e: any) => toast({ title: "Not read", description: plain(e), variant: "destructive" }),
  });
  const r = file.reading;
  return (
    <li className="text-xs" data-testid="joint-file">
      <div className="flex items-start gap-1.5">
        <FileText className="w-3.5 h-3.5 mt-[1px] shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          {file.url ? <a href={file.url} target="_blank" rel="noreferrer" className="underline underline-offset-2 break-all">{file.name}</a> : <span className="break-all">{file.name}</span>}
          <span className="text-muted-foreground"> · {day(file.uploadedAt)}</span>
          {!r && <div className="text-muted-foreground"><Loader2 className="inline w-3 h-3 mr-1 animate-spin" />Reading…</div>}
          {r?.state === "read" && (
            <div className="text-muted-foreground">
              {readingWords(r)}
              {(r.people || []).length > 0 && <> · {(r.people || []).map(p => `${p.name}${p.born ? ` (born ${born(p.born)})` : ""}`).join(", ")}</>}
              {(r.companies || []).length > 0 && <> · {(r.companies || []).join(", ")}</>}
              {r.summary && <div>{r.summary}</div>}
            </div>
          )}
          {r && r.state !== "read" && (
            <div className="text-amber-800 dark:text-amber-300">
              Not read: {r.why}.
              {file.documentId && (
                <button type="button" data-no-min-touch className="ml-1.5 underline underline-offset-2" disabled={reread.isPending} onClick={() => reread.mutate()} data-testid="joint-file-reread">
                  {reread.isPending ? "Reading…" : "Read again"}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

function RequestRow({ dealId, companyId, request }: { dealId: string; companyId: string; request: JointAgentRequestView }) {
  const { toast } = useToast();
  const remind = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/aml/client-checks/${encodeURIComponent(request.token)}/remind`, {})).json(),
    onSuccess: () => { refreshJointChecks(dealId); toast({ title: "Reminder sent", description: `To ${request.to || request.firm}.` }); },
    onError: (e: any) => toast({ title: "Not sent", description: plain(e), variant: "destructive" }),
  });
  const cancel = useMutation({
    mutationFn: async () => (await apiRequest("DELETE", `/api/aml/client-checks/${encodeURIComponent(request.token)}`)).json(),
    onSuccess: () => { refreshJointChecks(dealId); toast({ title: "Cancelled", description: `The link to ${request.firm} no longer opens.` }); },
    onError: (e: any) => toast({ title: "Not cancelled", description: plain(e), variant: "destructive" }),
  });
  const copy = () => { void navigator.clipboard?.writeText(request.link).then(() => toast({ title: "Link copied", description: "Send it to the joint agent yourself if the email did not reach them." })); };
  const live = request.status !== "cancelled" && request.status !== "expired";
  return (
    <div className={`rounded border px-2.5 py-2 text-xs ${request.status === "cancelled" ? "opacity-60" : ""}`} data-testid={`joint-request-${request.ref}`}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-medium">{request.manual ? "Added from their email" : `Asked ${request.firm}`}</span>
        <span className="text-muted-foreground">ref {request.ref}</span>
        <span className="rounded bg-muted px-1.5 py-0.5">{STATUS_WORDS[request.status]}</span>
        <span className="ml-auto flex flex-wrap gap-1">
          {request.canRemind && (
            <Button type="button" size="sm" variant="outline" className="h-6 px-2 text-[11px]" disabled={remind.isPending} onClick={() => remind.mutate()} data-testid={`joint-remind-${request.ref}`}>
              <Mail className="w-3 h-3 mr-1" />Remind
            </Button>
          )}
          {live && !request.manual && (
            <Button type="button" size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={copy} data-testid={`joint-copy-${request.ref}`}><Copy className="w-3 h-3 mr-1" />Link</Button>
          )}
          {request.status !== "cancelled" && (
            <Button type="button" size="sm" variant="ghost" className="h-6 px-2 text-[11px]" disabled={cancel.isPending} onClick={() => cancel.mutate()} data-testid={`joint-cancel-${request.ref}`}>
              <X className="w-3 h-3 mr-1" />Cancel
            </Button>
          )}
        </span>
      </div>
      <div className="mt-1 text-muted-foreground">
        {request.manual
          ? `Files ${request.to ? `from ${request.to}` : "the joint agent"} emailed to BGP, added by ${request.sentBy || "BGP"}`
          : request.sentAt ? `To ${request.to || "the joint agent"}${request.toEmail ? ` <${request.toEmail}>` : ""}, ${day(request.sentAt)}${request.sentBy ? ` by ${request.sentBy}` : ""}`
          : `Not sent${request.sendError ? `: ${request.sendError}` : ""}`}
        {request.openedAt && !request.manual ? ` · opened ${day(request.openedAt)}` : ""}
        {request.finishedAt ? ` · finished ${day(request.finishedAt)}` : ""}
      </div>
      {request.reliance && (
        <div className="mt-1.5 rounded border border-violet-200 bg-violet-50/60 px-2 py-1 text-violet-950 dark:border-violet-900 dark:bg-violet-950/30 dark:text-violet-100" data-testid={`joint-reliance-${request.ref}`}>
          Agreed to BGP relying on their checks: {[request.reliance.name, request.reliance.position].filter(Boolean).join(", ")} of {request.reliance.firm}, {day(request.reliance.agreedAt)}.
          {" "}Supervised by {request.reliance.supervisor}{request.reliance.registration ? ` (${request.reliance.registration})` : ""}.
          {" "}<a className="underline underline-offset-2" target="_blank" rel="noreferrer" href={`/api/deals/${dealId}/joint-agent-checks/${request.ref}/reliance.pdf?companyId=${encodeURIComponent(companyId)}`}>Confirmation (PDF)</a>
        </div>
      )}
      {request.files.length > 0 && <ul className="mt-1.5 space-y-1">{request.files.map((f, i) => <FileRow key={`${f.documentId || f.name}-${i}`} dealId={dealId} token={request.token} file={f} />)}</ul>}
    </div>
  );
}

function Coverage({ p }: { p: JointAgentPartyView }) {
  const c = p.coverage;
  if (!c || !currentJointRequest(p)?.files.length) return null;
  return (
    <div className="space-y-1 text-xs" data-testid={`joint-coverage-${p.companyId}`}>
      <div className="font-medium">Against the people the checks need</div>
      {c.people.map(person => (
        <div key={person.name} className="flex items-start gap-1.5">
          {person.missing.length ? <AlertTriangle className="w-3.5 h-3.5 mt-[1px] shrink-0 text-amber-600" /> : <CheckCircle2 className="w-3.5 h-3.5 mt-[1px] shrink-0 text-emerald-600" />}
          <span>
            <span className="font-medium">{person.name}</span>
            {person.missing.length ? <span className="text-amber-800 dark:text-amber-300">: no {person.missing.join(" or ")} yet</span> : null}
            {(person.id || person.address) && <span className="text-muted-foreground"> · {[person.id ? `ID: ${person.id}` : null, person.address ? `address: ${person.address}` : null].filter(Boolean).join("; ")}</span>}
          </span>
        </div>
      ))}
      {c.company && (
        <div className={c.company.register && c.company.ownership ? "text-muted-foreground" : "text-amber-800 dark:text-amber-300"}>
          The company: {c.company.register ? `register (${c.company.register})` : "no register entry yet"}; {c.company.ownership ? `ownership (${c.company.ownership})` : "who owns it not sent yet"}
        </div>
      )}
      <div className={c.screening ? "text-muted-foreground" : "text-amber-800 dark:text-amber-300"}>Screening: {c.screening || "not sent yet"}</div>
      {c.flags.map(f => <div key={f} className="flex items-start gap-1.5 text-red-700 dark:text-red-300"><AlertTriangle className="w-3.5 h-3.5 mt-[1px] shrink-0" />{f}</div>)}
      {c.others.length > 0 && <div className="text-muted-foreground">Also named in their files: {c.others.join(", ")}</div>}
      {c.unread > 0 && <div className="text-muted-foreground">{c.unread} file{c.unread === 1 ? "" : "s"} not read yet.</div>}
      {c.complete && <div className="text-emerald-700 dark:text-emerald-300">Their files cover everyone the checks need.</div>}
    </div>
  );
}

/** Ask the joint agent: an email from the KYC mailbox with a page of their own. */
export function AskJointAgentButton({ dealId, view, party, label }: { dealId: string; view: JointAgentChecksView; party: JointAgentPartyView; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" size="sm" className="h-7 text-xs" onClick={() => setOpen(true)} data-testid={`joint-ask-${party.role}`}>
        <Send className="w-3.5 h-3.5 mr-1" />{label || `Ask ${view.firm?.name || "the joint agent"} for their checks`}
      </Button>
      {open && <AskDialog dealId={dealId} view={view} party={party} onClose={() => setOpen(false)} />}
    </>
  );
}

function AskDialog({ dealId, view, party, onClose }: { dealId: string; view: JointAgentChecksView; party: JointAgentPartyView; onClose: () => void }) {
  const { toast } = useToast();
  const withEmail = view.contacts.filter(c => c.email);
  const [firm, setFirm] = useState(view.firm?.name || "");
  const [contactId, setContactId] = useState<string>(view.defaultContactId || (withEmail[0]?.id ?? "other"));
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const picked = withEmail.find(c => c.id === contactId) || null;
  const letting = view.rule === "letting" || view.rule === "other";
  const toName = picked ? picked.name : name.trim();
  const toEmail = picked ? picked.email || "" : email.trim();
  const missing = firm.trim().length < 2 ? "Name the joint agent's firm." : toName.length < 2 ? "Who at the joint agent?" : !/^\S+@\S+\.\S+$/.test(toEmail) ? "Their email address." : null;
  const send = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/deals/${dealId}/joint-agent-checks`, {
      companyId: party.companyId, contactId: picked ? picked.id : null, name: toName, email: toEmail, note: note.trim() || null,
      firm: firm.trim(), firmCompanyId: view.firm && firm.trim() === view.firm.name ? view.firm.companyId : null,
    })).json(),
    onSuccess: (r: any) => {
      refreshJointChecks(dealId);
      if (r?.sent?.ok) toast({ title: "Sent", description: `${toName} has a link to send their checks on ${party.name} (ref ${r.ref}).` });
      else toast({ title: "Saved, but the email did not go", description: `${r?.sent?.error || "Microsoft refused it"}. Copy the link from the request and send it yourself.`, variant: "destructive" });
      onClose();
    },
    onError: (e: any) => toast({ title: "Not sent", description: plain(e), variant: "destructive" }),
  });
  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md" data-testid="joint-ask-dialog">
        <DialogHeader>
          <DialogTitle>Ask the joint agent about {party.name}</DialogTitle>
          <DialogDescription>
            {letting
              ? "A letting at £10,000 a month or more: HMRC wants every party verified. They send their checks and agree on the page to BGP relying on them (MLR 2017 reg 39)."
              : "A sale: HMRC asks the joint agent who did not deal with this party to ask the one who did for their checks, and to record what comes back (AMLG2200 s21)."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="joint-firm">The joint agent's firm</Label>
            <Input id="joint-firm" value={firm} onChange={e => setFirm(e.target.value)} maxLength={160} placeholder="Savills" data-testid="joint-firm" />
          </div>
          {withEmail.length > 0 && firm.trim() === view.firm?.name && (
            <div className="space-y-1.5">
              <Label>Who to ask</Label>
              <Select value={contactId} onValueChange={setContactId}>
                <SelectTrigger data-testid="joint-contact"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {withEmail.map(c => <SelectItem key={c.id} value={c.id}>{c.name} · {c.email}</SelectItem>)}
                  <SelectItem value="other">Someone else</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          {!picked && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="joint-name">Their name</Label>
                <Input id="joint-name" value={name} onChange={e => setName(e.target.value)} maxLength={120} data-testid="joint-name" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="joint-email">Their email</Label>
                <Input id="joint-email" type="email" value={email} onChange={e => setEmail(e.target.value)} maxLength={200} data-testid="joint-email" />
              </div>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="joint-note">A note to them (optional)</Label>
            <Textarea id="joint-note" value={note} onChange={e => setNote(e.target.value)} rows={2} maxLength={2000} data-testid="joint-note" />
          </div>
          <p className="text-[11px] text-muted-foreground">They get an email from BGP's KYC mailbox with a link to upload their checks, copied to the deal's agents. They can also reply with the files attached.</p>
          {missing && <p className="text-[11px] text-muted-foreground" data-testid="joint-ask-missing">{missing}</p>}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="button" disabled={!!missing || send.isPending} onClick={() => send.mutate()} data-testid="joint-ask-send">
            {send.isPending && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}Send
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Files the joint agent emailed to someone at BGP, added here. */
export function AddJointFilesButton({ dealId, view, party }: { dealId: string; view: JointAgentChecksView; party: JointAgentPartyView }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" size="sm" variant="outline" className="h-7 text-xs bg-background" onClick={() => setOpen(true)} data-testid={`joint-add-files-${party.role}`}>
        <Upload className="w-3.5 h-3.5 mr-1" />Add files they emailed you
      </Button>
      {open && <AddFilesDialog dealId={dealId} view={view} party={party} onClose={() => setOpen(false)} />}
    </>
  );
}

function AddFilesDialog({ dealId, view, party, onClose }: { dealId: string; view: JointAgentChecksView; party: JointAgentPartyView; onClose: () => void }) {
  const { toast } = useToast();
  const current = currentJointRequest(party);
  const [files, setFiles] = useState<File[]>([]);
  const [firm, setFirm] = useState(view.firm?.name || "");
  const [who, setWho] = useState("");
  const [whoEmail, setWhoEmail] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const missing = !files.length ? "Choose the files." : !current && firm.trim().length < 2 ? "Name the joint agent's firm." : null;
  const save = useMutation({
    mutationFn: async () => {
      const fd = new FormData();
      fd.append("companyId", party.companyId);
      if (current) fd.append("ref", current.ref);
      else {
        fd.append("firm", firm.trim());
        if (view.firm?.companyId && firm.trim() === view.firm.name) fd.append("firmCompanyId", view.firm.companyId);
        if (who.trim()) fd.append("contactName", who.trim());
        if (whoEmail.trim()) fd.append("contactEmail", whoEmail.trim());
      }
      for (const f of files) fd.append("files", f);
      const res = await fetch(`/api/deals/${dealId}/joint-agent-checks/upload`, { method: "POST", body: fd, credentials: "include", headers: getAuthHeaders() });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.message || "The files could not be added.");
      return body;
    },
    onSuccess: (r: any) => {
      refreshJointChecks(dealId);
      toast({ title: `${r.filed} file${r.filed === 1 ? "" : "s"} added`, description: `${r.refused?.length ? `Not added: ${r.refused.slice(0, 3).join("; ")}. ` : ""}Each is read and set against the people the checks need.` });
      onClose();
    },
    onError: (e: any) => toast({ title: "Not added", description: plain(e), variant: "destructive" }),
  });
  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md" data-testid="joint-files-dialog">
        <DialogHeader>
          <DialogTitle>The joint agent's checks on {party.name}</DialogTitle>
          <DialogDescription>
            The files they emailed you: ID, address proofs, the company's register entry, their screening and risk assessment. A zip is fine. Each is filed on {party.name}'s KYC record and read.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {!current && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="joint-files-firm">The joint agent's firm</Label>
                <Input id="joint-files-firm" value={firm} onChange={e => setFirm(e.target.value)} maxLength={160} data-testid="joint-files-firm" />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="joint-files-who">Who sent them (optional)</Label>
                  <Input id="joint-files-who" value={who} onChange={e => setWho(e.target.value)} maxLength={120} data-testid="joint-files-who" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="joint-files-email">Their email (optional)</Label>
                  <Input id="joint-files-email" type="email" value={whoEmail} onChange={e => setWhoEmail(e.target.value)} maxLength={200} />
                </div>
              </div>
            </>
          )}
          <div className="space-y-1.5">
            <Button type="button" variant="outline" size="sm" onClick={() => input.current?.click()} data-testid="joint-files-choose"><Upload className="w-3.5 h-3.5 mr-1.5" />Choose files</Button>
            <input ref={input} type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.heic,.heif,.webp,.doc,.docx,.zip" className="hidden"
              onChange={e => { setFiles(Array.from(e.target.files || []).slice(0, 40)); e.target.value = ""; }} data-testid="joint-files-input" />
            {files.length > 0 && <ul className="text-xs text-muted-foreground">{files.map(f => <li key={f.name}>{f.name}</li>)}</ul>}
          </div>
          {current && <p className="text-[11px] text-muted-foreground">Added to the request to {current.firm} (ref {current.ref}).</p>}
          {missing && <p className="text-[11px] text-muted-foreground">{missing}</p>}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="button" disabled={!!missing || save.isPending} onClick={() => save.mutate()} data-testid="joint-files-save">
            {save.isPending && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}Add them
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The section's detail: HMRC's route for the deal, each request with its
 * files as read, what the files cover, and the officers' next step.
 * `decide` renders the officers' buttons (Not required on a sale, the
 * reliance on a letting), which live with the other decisions.
 */
export function JointAgentPanel({ dealId, view, party, decide }: {
  dealId: string; view: JointAgentChecksView; party: JointAgentPartyView; decide?: React.ReactNode;
}) {
  const current = currentJointRequest(party);
  // Asked and the email went (or their files were added): no second request.
  const open = !!current && current.status !== "expired" && current.status !== "not_sent";
  return (
    <div className="space-y-2" data-testid={`joint-panel-${party.role}`}>
      <p className="text-[11px] text-muted-foreground">{view.ruleWords}</p>
      <div className="flex flex-wrap items-center gap-1.5">
        {!open && <AskJointAgentButton dealId={dealId} view={view} party={party} label={current ? "Ask them again" : undefined} />}
        <AddJointFilesButton dealId={dealId} view={view} party={party} />
        {decide}
      </div>
      {party.requests.map(r => <RequestRow key={r.ref} dealId={dealId} companyId={party.companyId} request={r} />)}
      <Coverage p={party} />
      {current && !current.reliance && (view.rule === "letting" || view.rule === "other") && (current.status === "in" || current.status === "finished") && (
        <p className="text-xs text-amber-800 dark:text-amber-300">Not agreed to the reliance terms yet: remind them, or send the client checks.</p>
      )}
      {party.requests.some(r => r.status !== "cancelled" && r.files.some(f => !f.reading)) && (
        <p className="text-[11px] text-muted-foreground"><RefreshCw className="inline w-3 h-3 mr-1" />Reading their files: this updates by itself.</p>
      )}
    </div>
  );
}
