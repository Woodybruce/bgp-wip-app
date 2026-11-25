// The joint agent's checks on a party (Woody, 22 November 2026: "Let's get
// the app to follow HMRC rules and also send them an email so they can load
// everything up or email the aml? If they email or upload it can we then
// upload it and check it in the app?").
//
// In each party's AML box, BGP staff ask the joint agent for their checks
// (an email from the KYC mailbox with a page of their own), add the files the
// joint agent emailed to someone at BGP, and see each file as it was read,
// set against the people the checks need. With their documents in, the
// party is signed off on BGP's check of them, sale or letting (BGP's policy,
// Issue 4: the counterparty on a joint instruction is always checked); a
// reliance agreed before 23 November 2026 can still be recorded. The server is
// server/joint-agent-checks.ts; the rules shared/joint-agent-checks.ts.
import { useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, Check, ChevronRight, Copy, FileText, Loader2, Mail, RefreshCw, Send, Upload, X } from "lucide-react";
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
// The year only when it is not this year: "25 Nov", "2 Apr 2023".
const day = (iso: string | null | undefined) => {
  if (!iso) return "";
  const d = new Date(iso);
  const thisYear = d.getUTCFullYear() === new Date().getUTCFullYear();
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(thisYear ? {} : { year: "numeric" as const }), timeZone: "Europe/London" });
};
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
  // A joint agent, the party's own agent on the transaction, or a request already made.
  return view.firm || p.agent || p.requests.length ? p : null;
}

/** The party BGP could ask an agent about, even with no agent recorded yet (BGP types the firm in). */
export function jointAskable(view: JointAgentChecksView | undefined, companyId: string): JointAgentPartyView | null {
  if (!view || view.rule === "letting_under" || view.rule === "advisory") return null;
  const p = view.parties.find(x => x.companyId === companyId) || null;
  return p && !p.isClient ? p : null;
}

/**
 * The button that sends the party's own agent the standard checks to pass on
 * (23 November 2026): the agent the transaction records ("Tenant's agent"),
 * else "Their agent". The joint agent has its own button.
 */
export function askAgentLabel(p: JointAgentPartyView): string {
  const words = p.agent ? p.agentWords : "their agent";
  return words.charAt(0).toUpperCase() + words.slice(1);
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
    // The line about files not read yet is not a thing they owe.
    missing: r.files.length ? Math.max(0, p.gaps.filter(g => !/reliance terms$/.test(g)).length - (p.unread ? 1 : 0)) : 0,
    chasing: !!r.nextChaseAt,
    unread: p.unread || 0,
  };
}

/** The section's one line. */
export function jointSectionLine(p: JointAgentPartyView): { tone: "done" | "wait" | "act" | "flag" | "info"; summary: string } {
  const r = currentJointRequest(p);
  if (p.coverage?.flags.length) return { tone: "flag", summary: `${p.line}. ${p.coverage.flags.length} to look at` };
  if (!r) return { tone: "info", summary: p.line };
  if (r.status === "in" || r.status === "finished") {
    if (p.unread) return { tone: "act", summary: `${p.line}. ${p.unread} file${p.unread === 1 ? "" : "s"} not read yet` };
    const gaps = p.gaps.length;
    return { tone: gaps ? "act" : "done", summary: gaps ? `${p.line}. Still missing: ${gaps}${r.nextChaseAt ? ", being chased" : ""}` : `${p.line}. Nothing missing` };
  }
  if (r.status === "not_sent" || r.status === "expired") return { tone: "act", summary: p.line };
  return { tone: "wait", summary: p.line };
}

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
  const people = (r.people || []).map(p => `${p.name}${p.born ? ` (born ${born(p.born)})` : ""}`);
  return [bits.join(", "), ...people, ...(r.companies || [])].filter(Boolean).join(" · ");
}

// One file on one line: its name, what it was read as, and Read again when it was not read.
function FileRow({ dealId, token, file }: { dealId: string; token: string; file: JointAgentRequestView["files"][number] }) {
  const { toast } = useToast();
  const reread = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/deals/${dealId}/joint-agent-checks/read`, { token, documentId: file.documentId })).json(),
    onSuccess: () => refreshJointChecks(dealId),
    onError: (e: any) => toast({ title: "Not read", description: plain(e), variant: "destructive" }),
  });
  const r = file.reading;
  const kind = r?.state === "read" ? (r.title || (r.kind ? JOINT_DOC_KINDS[r.kind] : "Document")) : null;
  return (
    <li className="flex min-w-0 items-center gap-1.5 text-xs" data-testid="joint-file">
      <FileText className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
      {file.url ? <a href={file.url} target="_blank" rel="noreferrer" className="min-w-0 truncate underline underline-offset-2">{file.name}</a> : <span className="min-w-0 truncate">{file.name}</span>}
      {!r && <span className="shrink-0 text-muted-foreground"><Loader2 className="inline w-3 h-3 mr-1 animate-spin" />reading</span>}
      {kind && <span className="min-w-0 truncate text-muted-foreground" title={readingWords(r!)}>· {kind}</span>}
      {r && r.state !== "read" && (
        <span className="shrink-0 text-amber-800 dark:text-amber-300" title={r.why || undefined}>
          · {r.unreadable ? "could not be opened" : "not read"}
          {file.documentId && !r.unreadable && (
            <button type="button" data-no-min-touch className="ml-1.5 underline underline-offset-2" disabled={reread.isPending} onClick={() => reread.mutate()} data-testid="joint-file-reread">
              {reread.isPending ? "Reading…" : "Read again"}
            </button>
          )}
        </span>
      )}
    </li>
  );
}

const REQUEST_STATE: Record<JointAgentRequestView["status"], string> = {
  not_sent: "the email didn't go", sent: "nothing back yet", opened: "opened", in: "files in", finished: "finished", expired: "link ran out", cancelled: "cancelled",
};

// One request on one line: who was asked and when, what came back, Link and Cancel.
function RequestLine({ dealId, companyId, request }: { dealId: string; companyId: string; request: JointAgentRequestView }) {
  const { toast } = useToast();
  const cancel = useMutation({
    mutationFn: async () => (await apiRequest("DELETE", `/api/aml/client-checks/${encodeURIComponent(request.token)}`)).json(),
    onSuccess: () => { refreshJointChecks(dealId); toast({ title: "Cancelled", description: `The link to ${request.firm} no longer opens.` }); },
    onError: (e: any) => toast({ title: "Not cancelled", description: plain(e), variant: "destructive" }),
  });
  const copy = () => { void navigator.clipboard?.writeText(request.link).then(() => toast({ title: "Link copied" })); };
  const live = request.status !== "cancelled" && request.status !== "expired";
  const lastChase = request.chases[request.chases.length - 1];
  const bits = [
    request.manual ? `From ${request.to ? `${request.to}'s` : "their"} email, added by ${request.sentBy || "BGP"}` : `Asked ${request.to || request.firm}${request.sentAt ? ` ${day(request.sentAt)}` : ""}`,
    REQUEST_STATE[request.status],
    request.openedAt && !request.manual && request.status !== "opened" ? `opened ${day(request.openedAt)}` : null,
    request.finishedAt ? `finished ${day(request.finishedAt)}` : null,
    request.chases.length ? `reminded ${request.chases.length}× (last ${day(lastChase.at)}${lastChase.auto ? "" : `, ${lastChase.by}`})` : null,
    `ref ${request.ref}`,
  ].filter(Boolean);
  return (
    <div className={`space-y-1 text-xs ${request.status === "cancelled" ? "opacity-60" : ""}`} data-testid={`joint-request-${request.ref}`}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-muted-foreground" title={request.sendError || undefined}>{bits.join(" · ")}</span>
        {live && !request.manual && (
          <Button type="button" size="sm" variant="ghost" className="h-6 px-1.5 text-[11px]" onClick={copy} data-testid={`joint-copy-${request.ref}`}><Copy className="w-3 h-3 mr-1" />Link</Button>
        )}
        {request.status !== "cancelled" && (
          <Button type="button" size="sm" variant="ghost" className="h-6 px-1.5 text-[11px]" disabled={cancel.isPending} onClick={() => cancel.mutate()} data-testid={`joint-cancel-${request.ref}`}>
            <X className="w-3 h-3 mr-1" />Cancel
          </Button>
        )}
      </div>
      {request.chases.length > 0 && <span className="sr-only" data-testid={`joint-chases-${request.ref}`}>Reminded {request.chases.length} times</span>}
      {request.reliance && (
        <div className="text-violet-900 dark:text-violet-200" data-testid={`joint-reliance-${request.ref}`}>
          Terms agreed by {[request.reliance.name, request.reliance.position].filter(Boolean).join(", ")}, {day(request.reliance.agreedAt)}
          {" · "}<a className="underline underline-offset-2" target="_blank" rel="noreferrer" href={`/api/deals/${dealId}/joint-agent-checks/${request.ref}/reliance.pdf?companyId=${encodeURIComponent(companyId)}`}>PDF</a>
        </div>
      )}
    </div>
  );
}

// "UK passport, 2 Apr 2023 (address verified)" reads as "UK passport" in a cell; the rest is on hover.
const shortEvidence = (e: string) => {
  const first = e.split(",")[0].replace(/\s*\((?:address|identity) verified\)\s*$/i, "").trim();
  return first.length > 30 ? `${first.slice(0, 29)}…` : first;
};

// What their files cover, as ticks (Woody, 22 November 2026: "very crowded";
// the drawing he agreed): a row per person (ID, address), the company
// (register, owners) and the screening. Anything to look at under it.
function CoverageGrid({ p, dealId, request }: { p: JointAgentPartyView; dealId: string; request: JointAgentRequestView }) {
  const c = p.coverage;
  if (!c || !request.files.length) return null;
  const have = (v: string | null, label?: string) => (
    <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400" title={v || undefined}><Check className="h-3.5 w-3.5 shrink-0" />{label || shortEvidence(v || "")}</span>
  );
  const miss = (label = "Missing") => <span className="font-medium text-amber-800 dark:text-amber-300">{label}</span>;
  const cell = "py-1 pr-5 align-top";
  const unreadFiles = request.files.filter(f => f.reading && f.reading.state !== "read");
  return (
    <div className="space-y-1.5" data-testid={`joint-coverage-${p.companyId}`}>
      <div className="overflow-x-auto">
        <table className="text-xs" data-testid={`joint-grid-${p.role}`}>
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
              <th className={`${cell} font-semibold`}><span className="sr-only">Who</span></th><th className={`${cell} font-semibold`}>ID</th><th className={`${cell} font-semibold`}>Address</th>
            </tr>
          </thead>
          <tbody>
            {c.people.map(person => (
              <tr key={person.name} className="border-t border-border/60">
                <td className={cell}>{person.name}</td>
                <td className={cell}>{person.id ? have(person.id) : miss()}</td>
                <td className={cell}>{person.address ? have(person.address) : miss()}</td>
              </tr>
            ))}
            {c.company && (
              <tr className="border-t border-border/60">
                <td className={cell}>Company</td>
                <td className={cell}>{c.company.register ? have(c.company.register, "Register") : miss("Register missing")}</td>
                <td className={cell}>{c.company.ownership ? have(c.company.ownership, "Owners") : miss("Owners missing")}</td>
              </tr>
            )}
            <tr className="border-t border-border/60">
              <td className={cell}>Screening</td>
              <td className={cell} colSpan={2}>{c.screening ? have(c.screening, /: clear$/.test(c.screening) ? "Clear" : undefined) : miss()}</td>
            </tr>
          </tbody>
        </table>
      </div>
      {c.flags.map(f => <p key={f} className="flex items-start gap-1.5 text-xs text-red-700 dark:text-red-300"><AlertTriangle className="w-3.5 h-3.5 mt-[1px] shrink-0" />{f}</p>)}
      {unreadFiles.length > 0 && <ul className="space-y-1">{unreadFiles.map((f, i) => <FileRow key={`${f.documentId || f.name}-${i}`} dealId={dealId} token={request.token} file={f} />)}</ul>}
      {c.others.length > 0 && <p className="text-xs text-muted-foreground">Also named in their files: {c.others.join(", ")}</p>}
    </div>
  );
}

/**
 * Email the joint agent what is still missing (or remind them when nothing
 * has come). With no address on the request it asks for one first.
 */
export function JointChaseButton({ dealId, party, request, label, variant = "outline", onNoEmail }: {
  dealId: string; party: JointAgentPartyView; request: JointAgentRequestView; label?: string; variant?: "outline" | "default"; onNoEmail?: () => void;
}) {
  const { toast } = useToast();
  const chase = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/deals/${dealId}/joint-agent-checks/${request.ref}/chase`, {})).json(),
    onSuccess: () => { refreshJointChecks(dealId); toast({ title: "Sent", description: `${request.to || request.firm} has the list of what's still needed.` }); },
    onError: (e: any) => toast({ title: "Not sent", description: plain(e), variant: "destructive" }),
  });
  if (!party.askable) return null;
  const nothingYet = !request.files.length;
  return (
    <Button type="button" size="sm" variant={variant} className={`h-7 text-xs ${variant === "outline" ? "bg-background" : ""}`} disabled={chase.isPending}
      onClick={() => (request.toEmail ? chase.mutate() : onNoEmail?.())} data-testid={`joint-chase-${party.role}`}>
      {chase.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Mail className="w-3.5 h-3.5 mr-1" />}{label || (nothingYet ? "Remind them" : "Ask for what's missing")}
    </Button>
  );
}

// The chase, its date, and an address when the request has none.
function ChaseRow({ dealId, party, request }: { dealId: string; party: JointAgentPartyView; request: JointAgentRequestView }) {
  const { toast } = useToast();
  const [askEmail, setAskEmail] = useState(false);
  const [email, setEmail] = useState("");
  const [name, setName] = useState(request.to || "");
  const send = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/deals/${dealId}/joint-agent-checks/${request.ref}/chase`, { email: email.trim(), name: name.trim() })).json(),
    onSuccess: () => { refreshJointChecks(dealId); setAskEmail(false); toast({ title: "Sent" }); },
    onError: (e: any) => toast({ title: "Not sent", description: plain(e), variant: "destructive" }),
  });
  if (!party.gaps.length) {
    return request.files.length ? <p className="text-xs text-emerald-700 dark:text-emerald-300" data-testid={`joint-nothing-missing-${party.role}`}>Nothing missing</p> : null;
  }
  const status = !party.askable ? "Read their files first"
    : request.chaseStoppedAt ? `Reminders stopped ${day(request.chaseStoppedAt)}: ask again to restart`
    : request.nextChaseAt ? `Next reminder ${day(request.nextChaseAt)}`
    : !request.toEmail ? "No email address for them" : "";
  return (
    <div className="space-y-1.5" data-testid={`joint-still-missing-${party.role}`}>
      <div className="flex flex-wrap items-center gap-2">
        <JointChaseButton dealId={dealId} party={party} request={request} onNoEmail={() => setAskEmail(true)} />
        {status && <span className="text-xs text-muted-foreground" data-testid={`joint-chase-status-${party.role}`}>{status}</span>}
      </div>
      {askEmail && (
        <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <Input value={name} onChange={e => setName(e.target.value)} placeholder="Their name" className="h-8 text-xs" />
          <Input value={email} onChange={e => setEmail(e.target.value)} type="email" placeholder="Their email" className="h-8 text-xs" data-testid={`joint-chase-email-${party.role}`} />
          <Button type="button" size="sm" className="h-8 text-xs" disabled={!/^\S+@\S+\.\S+$/.test(email.trim()) || send.isPending} onClick={() => send.mutate()}>Send</Button>
        </div>
      )}
    </div>
  );
}

/** Ask the joint agent: an email from the KYC mailbox with a page of their own. */
// person: who to ask, set as the joint agent on the party (25 November 2026): the dialog starts on them.
export function AskJointAgentButton({ dealId, view, party, label, quiet, person }: { dealId: string; view: JointAgentChecksView; party: JointAgentPartyView; label?: string; quiet?: boolean; person?: { id: string; name: string; email: string | null; firm: string | null } | null }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" size="sm" variant={quiet ? "ghost" : "default"} className={quiet ? "h-7 px-2 text-xs" : "h-7 text-xs"} onClick={() => setOpen(true)} data-testid={`joint-ask-${party.role}`}>
        <Send className="w-3.5 h-3.5 mr-1" />{label || `Ask ${party.agent?.name || view.firm?.name || `the ${party.agentWords}`} for their checks`}
      </Button>
      {open && <AskDialog dealId={dealId} view={view} party={party} person={person || null} onClose={() => setOpen(false)} />}
    </>
  );
}

function AskDialog({ dealId, view, party, person, onClose }: { dealId: string; view: JointAgentChecksView; party: JointAgentPartyView; person: { id: string; name: string; email: string | null; firm: string | null } | null; onClose: () => void }) {
  const { toast } = useToast();
  // The joint agent only (23 November 2026): the party's own agent is sent
  // the standard client checks to pass on instead (Send client checks,
  // through their agent).
  const relation = "joint" as const;
  const recorded = view.firm ? { companyId: view.firm.companyId, name: view.firm.name, contacts: view.contacts, contactId: view.defaultContactId } : null;
  const who = "joint agent";
  const withEmail = (recorded?.contacts || []).filter(c => c.email);
  const listed = person ? withEmail.find(c => c.id === person.id) || null : null;
  const [firm, setFirm] = useState(recorded?.name || person?.firm || "");
  const [contactId, setContactId] = useState<string>(listed ? listed.id : person ? "other" : recorded?.contactId || (withEmail[0]?.id ?? "other"));
  const [name, setName] = useState(person && !listed ? person.name : "");
  const [email, setEmail] = useState(person && !listed ? person.email || "" : "");
  const [note, setNote] = useState("");
  const picked = withEmail.find(c => c.id === contactId) || null;
  const toName = picked ? picked.name : name.trim();
  const toEmail = picked ? picked.email || "" : email.trim();
  const missing = firm.trim().length < 2 ? `Name the ${who}'s firm.` : toName.length < 2 ? `Who at the ${who}?` : !/^\S+@\S+\.\S+$/.test(toEmail) ? "Their email address." : null;
  const send = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/deals/${dealId}/joint-agent-checks`, {
      companyId: party.companyId, contactId: picked ? picked.id : null, name: toName, email: toEmail, note: note.trim() || null,
      firm: firm.trim(), firmCompanyId: recorded && firm.trim() === recorded.name ? recorded.companyId : null, relation,
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
          <DialogTitle>Ask the {who} about {party.name}</DialogTitle>
          <DialogDescription>
            They send every document they hold on this party: IDs, proof of address and any AML they did.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="joint-firm">The {who}'s firm</Label>
            <Input id="joint-firm" value={firm} onChange={e => setFirm(e.target.value)} maxLength={160} placeholder="Savills" data-testid="joint-firm" />
          </div>
          {withEmail.length > 0 && firm.trim() === recorded?.name && (
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
          <p className="text-[11px] text-muted-foreground">They get an email with a link to upload them, or reply with them attached. The transaction's agents are copied.</p>
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
        <Upload className="w-3.5 h-3.5 mr-1" />Add files
      </Button>
      {open && <AddFilesDialog dealId={dealId} view={view} party={party} onClose={() => setOpen(false)} />}
    </>
  );
}

function AddFilesDialog({ dealId, view, party, onClose }: { dealId: string; view: JointAgentChecksView; party: JointAgentPartyView; onClose: () => void }) {
  const { toast } = useToast();
  const current = currentJointRequest(party);
  // Whose files: the request's agent, else the joint agent (23 November 2026:
  // the party's own agent passes the client checks on instead).
  const relation: "own" | "joint" = current ? current.relation : "joint";
  const agentWord = current ? current.who : relation === "own" ? party.agentWords : "joint agent";
  const recorded = relation === "own" ? party.agent : view.firm;
  const [files, setFiles] = useState<File[]>([]);
  const [firm, setFirm] = useState(recorded?.name || "");
  const [who, setWho] = useState("");
  const [whoEmail, setWhoEmail] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const missing = !files.length ? "Choose the files." : !current && firm.trim().length < 2 ? `Name the ${agentWord}'s firm.` : null;
  const save = useMutation({
    mutationFn: async () => {
      const fd = new FormData();
      fd.append("companyId", party.companyId);
      if (current) fd.append("ref", current.ref);
      else {
        fd.append("firm", firm.trim());
        fd.append("relation", relation);
        if (recorded?.companyId && firm.trim() === recorded.name) fd.append("firmCompanyId", recorded.companyId);
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
          <DialogTitle>The {agentWord}'s checks on {party.name}</DialogTitle>
          <DialogDescription>
            The files they emailed you. A zip is fine.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {!current && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="joint-files-firm">The {agentWord}'s firm</Label>
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
 * The joint agent's checks inside a party's Documents step: HMRC's route in
 * a line, what their files cover as ticks, the chase, then the request on one
 * line and the files folded. `decide` is the officers' button (recording a
 * reliance agreed before 23 November 2026).
 */
export function JointAgentPanel({ dealId, view, party, decide }: {
  dealId: string; view: JointAgentChecksView; party: JointAgentPartyView; decide?: React.ReactNode;
}) {
  const current = currentJointRequest(party);
  // Asked and the email went (or their files were added): no second request.
  const open = !!current && current.status !== "expired" && current.status !== "not_sent";
  const earlier = party.requests.filter(r => r !== current);
  const [filesOpen, setFilesOpen] = useState(false);
  const [earlierOpen, setEarlierOpen] = useState(false);
  const readFiles = current ? current.files.filter(f => !f.reading || f.reading.state === "read") : [];
  return (
    <div className="space-y-2.5" data-testid={`joint-panel-${party.role}`}>
      <p className="text-xs text-muted-foreground">{view.ruleWords}</p>
      {current && <CoverageGrid p={party} dealId={dealId} request={current} />}
      {current && open && <ChaseRow dealId={dealId} party={party} request={current} />}
      <div className="flex flex-wrap items-center gap-1.5">
        {!open && <AskJointAgentButton dealId={dealId} view={view} party={party} label={current ? "Ask them again" : undefined} />}
        <AddJointFilesButton dealId={dealId} view={view} party={party} />
        {decide}
      </div>
      {current && <RequestLine dealId={dealId} companyId={party.companyId} request={current} />}
      {readFiles.length > 0 && (
        <div>
          <button type="button" data-no-min-touch className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" aria-expanded={filesOpen} onClick={() => setFilesOpen(o => !o)} data-testid={`joint-files-toggle-${party.role}`}>
            <ChevronRight className={`h-3.5 w-3.5 transition-transform ${filesOpen ? "rotate-90" : ""}`} />{readFiles.length} file{readFiles.length === 1 ? "" : "s"}
          </button>
          {filesOpen && <ul className="mt-1 space-y-1 pl-4">{readFiles.map((f, i) => <FileRow key={`${f.documentId || f.name}-${i}`} dealId={dealId} token={current!.token} file={f} />)}</ul>}
        </div>
      )}
      {earlier.length > 0 && (
        <div>
          <button type="button" data-no-min-touch className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" aria-expanded={earlierOpen} onClick={() => setEarlierOpen(o => !o)}>
            <ChevronRight className={`h-3.5 w-3.5 transition-transform ${earlierOpen ? "rotate-90" : ""}`} />{earlier.length} earlier request{earlier.length === 1 ? "" : "s"}
          </button>
          {earlierOpen && <div className="mt-1 space-y-1.5 pl-4">{earlier.map(r => <RequestLine key={r.ref} dealId={dealId} companyId={party.companyId} request={r} />)}</div>}
        </div>
      )}
      {party.requests.some(r => r.status !== "cancelled" && r.files.some(f => !f.reading)) && (
        <p className="text-[11px] text-muted-foreground"><RefreshCw className="inline w-3 h-3 mr-1" />Reading their files</p>
      )}
    </div>
  );
}
