// The client KYC box: BGP's client checked with no transaction (Woody,
// 24 November 2026: "Yes build it within companies ... aml all the sub
// companies within each company ... use those for xero invoicing too").
// One company (a sub company filed under the account, or the account's own
// record when it is a person, trust or public body), in the transaction AML
// box's four steps: the company, screening, documents, sign-off. The client
// checks, people to check and documents are the transaction screens, pointed
// at the client file's addresses (client/src/lib/aml-scope.tsx). The rules
// are shared/client-kyc.ts; the server is server/client-kyc.ts.

import { useState, type ReactNode } from "react";
import { Link } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, ChevronDown, Clock, ExternalLink, Loader2, Receipt, ShieldCheck, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, getAuthHeaders, queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { AmlUrlsProvider, clientFileKey, clientFileUrls } from "@/lib/aml-scope";
import { ClientChecksForParty, SendClientChecksButton, useClientChecks } from "@/components/kyc-client-checks";
import { PartyDocumentsBox } from "@/components/kyc-documents";
import { CLIENT_INSTRUCTIONS, clientSubjectParam, type ClientKycNext } from "@shared/client-kyc";
import type { PrecheckCardLine, PrecheckCompany } from "@shared/kyc-prechecks";
import type { KycRedFlag } from "@shared/kyc-red-flags";

export interface ClientFileView {
  subject: { companyId: string; accountName: string; entityId: string | null; name: string; number: string | null; kind: string; country: string | null; sameCompany: boolean };
  file: { id: string; instruction: string | null; instructionLabel: string | null; contactId: string | null; openedAt: string | null; openedBy: string | null; contact: { id: string; name: string; email: string | null } | null } | null;
  state: { status: string | null; expiresAt: string | null; approvedBy: string | null; scope: string | null; bucket: string };
  precheck: { ranAt: string | null; running: boolean; lines: PrecheckCardLine[]; company: PrecheckCompany | null } | null;
  flags: { live: KycRedFlag[]; setAside: Array<{ flag: KycRedFlag; review: { id: number; comment: string; by: string | null; at: string | null } }>; level: { level: string; why: string[] } | null; unchecked: string[] };
  signOff: { blocked: string | null; needsNote: boolean; edd: boolean; outstanding: string[]; canSignOff: boolean; canDecide: boolean };
  next: ClientKycNext;
  documents?: { done: boolean };
  // The company's sanctions-only switch (24 November 2026): the sanctions steps alone, nothing asked of the client.
  sanctionsOnly?: boolean;
  xero: { id: string; name: string } | null;
  transactions: Array<{ id: string; name: string; ref: number | null; status: string | null; role: string }>;
}

const plain = (e: any) => String(e?.message || e || "").replace(/^\d{3}:\s*/, "");
const day = (iso: string | null | undefined) => iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "";
export const clientFileQueryKey = (companyId: string, entityId: string | null) => ["/api/client-kyc", companyId, "subjects", clientSubjectParam(entityId)];

export function useClientFile(companyId: string, entityId: string | null, enabled = true) {
  return useQuery<ClientFileView>({
    queryKey: clientFileQueryKey(companyId, entityId),
    enabled,
    queryFn: async () => {
      const res = await fetch(`/api/client-kyc/${encodeURIComponent(companyId)}/subjects/${encodeURIComponent(clientSubjectParam(entityId))}`, { credentials: "include", headers: getAuthHeaders() });
      if (!res.ok) throw new Error(plain(await res.text()));
      return res.json();
    },
    refetchInterval: q => (q.state.data?.precheck?.running ? 5000 : false),
  });
}

const TONE: Record<ClientKycNext["tone"], string> = {
  ok: "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200",
  act: "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200",
  wait: "border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-200",
  bad: "border-red-200 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200",
};

function Step({ n, label, summary, done, open, onToggle, children, testId }: {
  n: number; label: string; summary: ReactNode; done: boolean; open: boolean; onToggle: () => void; children: ReactNode; testId: string;
}) {
  return (
    <section className="border-t border-border first:border-t-0" data-testid={testId}>
      <button type="button" onClick={onToggle} className="flex w-full items-center gap-2 py-2 text-left" aria-expanded={open}>
        <span className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
          done ? "bg-emerald-600 text-white" : "border border-border text-muted-foreground")}>{done ? <CheckCircle2 className="h-3.5 w-3.5" /> : n}</span>
        <span className="text-sm font-medium">{label}</span>
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{summary}</span>
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      {open && <div className="space-y-3 pb-3 pl-7">{children}</div>}
    </section>
  );
}

function CheckLine({ line }: { line: PrecheckCardLine }) {
  const icon = line.state === "ok" ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
    : line.state === "attention" || line.failed ? <AlertCircle className="h-3.5 w-3.5 text-amber-600" />
    : <Clock className="h-3.5 w-3.5 text-muted-foreground" />;
  return (
    <li className="flex items-start gap-2 text-xs">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span className="min-w-0">
        <span className="font-medium">{line.label}</span>
        {line.detail && <span className="text-muted-foreground"> · {line.detail}</span>}
        {line.links.length > 0 && <span className="ml-1">{line.links.slice(0, 3).map(l => (
          <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer" className="ml-1 inline-flex items-center gap-0.5 text-primary hover:underline">{l.label}<ExternalLink className="h-3 w-3" /></a>
        ))}</span>}
      </span>
    </li>
  );
}

function SetAsideButton({ companyId, entityId, flag, onDone }: { companyId: string; entityId: string | null; flag: KycRedFlag; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [comment, setComment] = useState("");
  const { toast } = useToast();
  const save = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/client-kyc/${encodeURIComponent(companyId)}/subjects/${encodeURIComponent(clientSubjectParam(entityId))}/red-flags/set-aside`, { key: flag.key, comment: comment.trim() })).json(),
    onSuccess: () => { setOpen(false); setComment(""); onDone(); },
    onError: (e: any) => toast({ title: "Not set aside", description: plain(e), variant: "destructive" }),
  });
  return (
    <>
      <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[11px]" onClick={() => setOpen(true)} data-testid={`client-kyc-set-aside-${flag.key}`}>Set aside</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Set aside: {flag.label}</DialogTitle><DialogDescription>Say why it does not apply. It stays on the record.</DialogDescription></DialogHeader>
          <Textarea value={comment} onChange={e => setComment(e.target.value)} rows={3} placeholder="Why it does not apply" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button disabled={comment.trim().length < 10 || save.isPending} onClick={() => save.mutate()}>{save.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}Set aside</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Opens the client file: what BGP is instructed on, and who to ask. */
function OpenFile({ view, onOpened }: { view: ClientFileView; onOpened: (v: ClientFileView) => void }) {
  const { toast } = useToast();
  const scopeKey = clientFileKey(view.subject.companyId, clientSubjectParam(view.subject.entityId));
  const { data: checks } = useClientChecks(scopeKey);
  const contacts = checks?.parties?.[0]?.contacts || [];
  const [instruction, setInstruction] = useState<string>("");
  const [contactId, setContactId] = useState<string>("");
  const open = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/client-kyc/${encodeURIComponent(view.subject.companyId)}/subjects/${encodeURIComponent(clientSubjectParam(view.subject.entityId))}/open`,
      { instruction: instruction || null, contactId: contactId || null })).json() as Promise<ClientFileView>,
    onSuccess: v => onOpened(v),
    onError: (e: any) => toast({ title: "Not started", description: plain(e), variant: "destructive" }),
  });
  return (
    <div className="space-y-3" data-testid="client-kyc-open">
      <p className="text-sm text-muted-foreground">Check {view.subject.name} now, before any transaction. When it is signed off, every transaction with it is cleared until the re-check date.</p>
      <div className="space-y-1">
        <Label className="text-xs">What BGP is instructed on</Label>
        <Select value={instruction} onValueChange={setInstruction}>
          <SelectTrigger className="h-9" data-testid="client-kyc-instruction"><SelectValue placeholder="Pick one" /></SelectTrigger>
          <SelectContent>{CLIENT_INSTRUCTIONS.map(i => <SelectItem key={i.key} value={i.key}>{i.label}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Who to ask for the checks (optional now)</Label>
        <Select value={contactId} onValueChange={setContactId}>
          <SelectTrigger className="h-9" data-testid="client-kyc-contact"><SelectValue placeholder={contacts.length ? "Pick a person" : `Nobody with an email at ${view.subject.accountName}`} /></SelectTrigger>
          <SelectContent>{contacts.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}{c.email ? ` · ${c.email}` : ""}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <Button onClick={() => open.mutate()} disabled={!instruction || open.isPending} data-testid="client-kyc-start">
        {open.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}Start the checks
      </Button>
    </div>
  );
}

export function ClientKycDialog({ companyId, entityId, name, open, onOpenChange }: {
  companyId: string; entityId: string | null; name: string; open: boolean; onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const { data: view, isLoading, error, refetch } = useClientFile(companyId, entityId, open);
  const entity = clientSubjectParam(entityId);
  const urls = clientFileUrls(companyId, entity);
  const scopeKey = clientFileKey(companyId, entity);
  const [openStep, setOpenStep] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const refresh = () => {
    void refetch();
    queryClient.invalidateQueries({ queryKey: ["/api/aml/deal", scopeKey, "client-checks"] });
    queryClient.invalidateQueries({ queryKey: ["/api/accounts", companyId, "entities"] });
    queryClient.invalidateQueries({ queryKey: ["/api/crm/hub"] });
  };
  const runChecks = useMutation({
    mutationFn: async (again: boolean) => (await apiRequest("POST", `/api/client-kyc/${encodeURIComponent(companyId)}/subjects/${encodeURIComponent(entity)}/checks`, { again })).json(),
    onSuccess: refresh,
    onError: (e: any) => toast({ title: "BGP's checks did not start", description: plain(e), variant: "destructive" }),
  });
  const signOff = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/client-kyc/${encodeURIComponent(companyId)}/subjects/${encodeURIComponent(entity)}/sign-off`, { note: note.trim() })).json(),
    onSuccess: (r: any) => { setNote(""); refresh(); toast({ title: "Signed off", description: `${name}: re-check in ${r.years} year${r.years === 1 ? "" : "s"}.` }); },
    onError: (e: any) => toast({ title: "Not signed off", description: plain(e), variant: "destructive" }),
  });
  const xero = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/billing-entities/${encodeURIComponent(String(entityId))}/xero`, {})).json(),
    onSuccess: (r: any) => { refresh(); toast({ title: r.xeroCreated ? "Made in Xero" : "Linked to Xero", description: r.contact?.Name || name }); },
    onError: (e: any) => toast({ title: "Not linked to Xero", description: plain(e), variant: "destructive" }),
  });

  const step = (n: number) => openStep === n;
  const toggle = (n: number) => setOpenStep(s => (s === n ? null : n));
  const pre = view?.precheck;
  const live = view?.flags.live || [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90dvh] max-w-3xl flex-col gap-3" data-testid="client-kyc-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><ShieldCheck className="h-4 w-4" />KYC · {view?.subject.name || name}</DialogTitle>
          <DialogDescription>
            {view ? [view.subject.number ? `Companies House ${view.subject.number}` : null, view.subject.country, `under ${view.subject.accountName}`, "no transaction needed"].filter(Boolean).join(" · ") : "Client checks before any transaction"}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          {isLoading && <p className="text-sm text-muted-foreground"><Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" />Loading…</p>}
          {error && <p className="text-sm text-red-700">{plain(error)}</p>}
          <AmlUrlsProvider urls={urls}>
          {view && !view.file && view.state.bucket === "not_checked" && !pre ? (
            <OpenFile view={view} onOpened={() => refresh()} />
          ) : view && (
            <>
              <div className={cn("mb-3 flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm", TONE[view.next.tone])} data-testid="client-kyc-next">
                <span className="font-semibold">{view.next.lead}</span>
                {view.next.words && <span>· {view.next.words}</span>}
                <span className="ml-auto flex gap-1.5">
                  {(view.next.action === "run_checks" || view.next.action === "full_checks") && (
                    <Button size="sm" className="h-7" disabled={runChecks.isPending} onClick={() => runChecks.mutate(view.next.action === "full_checks")}>Run BGP's checks</Button>
                  )}
                  {(view.next.action === "send_checks" || view.next.action === "pick_person") && (
                    <SendClientChecksButton dealId={scopeKey} companyId={companyId} partyName={view.subject.name} label="Send client checks" />
                  )}
                  {view.next.action === "sign_off" && <Button size="sm" className="h-7" onClick={() => setOpenStep(4)}>Sign off</Button>}
                </span>
              </div>
              {view.sanctionsOnly && (
                <p className="mb-2 text-xs text-muted-foreground" data-testid="client-kyc-sanctions-only">Sanctions checks only: for lettings under £10,000 a month. Nothing is asked of the client; the sign-off covers small lettings only.</p>
              )}
              {view.file?.instructionLabel && (
                <p className="mb-2 text-xs text-muted-foreground">{view.file.instructionLabel}{view.file.openedBy ? `, started by ${view.file.openedBy}` : ""}{view.file.openedAt ? ` on ${day(view.file.openedAt)}` : ""}.</p>
              )}

              <Step n={1} label="The company" testId="client-kyc-step-company" open={step(1)} onToggle={() => toggle(1)} done={!!pre?.ranAt}
                summary={[view.subject.number ? `No. ${view.subject.number}` : view.subject.kind === "individual" ? "A person" : view.subject.country || null, view.xero ? "in Xero" : "not in Xero", view.transactions.length ? `${view.transactions.length} transaction${view.transactions.length === 1 ? "" : "s"}` : null].filter(Boolean).join(" · ")}>
                {pre?.company && (
                  <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1 text-xs">
                    <dt className="text-muted-foreground">Registered name</dt><dd><a href={pre.company.registerUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">{pre.company.name}</a></dd>
                    {pre.company.status && <><dt className="text-muted-foreground">Status</dt><dd>{pre.company.status}</dd></>}
                    {pre.company.type && <><dt className="text-muted-foreground">Type</dt><dd>{pre.company.type}</dd></>}
                    {pre.company.incorporatedOn && <><dt className="text-muted-foreground">Incorporated</dt><dd>{day(pre.company.incorporatedOn)}</dd></>}
                    {pre.company.registeredOffice && <><dt className="text-muted-foreground">Registered office</dt><dd>{pre.company.registeredOffice}</dd></>}
                    {pre.company.home && <><dt className="text-muted-foreground">Home register</dt><dd>{pre.company.home}</dd></>}
                    {pre.company.listing && <><dt className="text-muted-foreground">Listed</dt><dd>{pre.company.listing}</dd></>}
                    {pre.company.directors.length > 0 && <><dt className="text-muted-foreground">Directors</dt><dd>{pre.company.directors.join(", ")}</dd></>}
                    {pre.company.owners.length > 0 && <><dt className="text-muted-foreground">Owners</dt><dd>{pre.company.owners.map(o => `${o.name}${o.control ? ` (${o.control})` : ""}`).join("; ")}</dd></>}
                    {pre.company.ownerNote && <><dt className="text-muted-foreground" /><dd className="text-muted-foreground">{pre.company.ownerNote}</dd></>}
                    {pre.company.chain.length > 0 && <><dt className="text-muted-foreground">Owned through</dt><dd>{pre.company.chain.join(" → ")}</dd></>}
                    {pre.company.accounts && <><dt className="text-muted-foreground">Latest accounts</dt><dd>{pre.company.accounts}</dd></>}
                    {pre.company.warnings.map((w, i) => <dd key={i} className="col-span-2 text-amber-800 dark:text-amber-300">{w}</dd>)}
                  </dl>
                )}
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <Receipt className="h-3.5 w-3.5 text-muted-foreground" />
                  {view.xero ? <span>Xero: <span className="font-medium">{view.xero.name}</span>, used for invoices when it signs</span>
                    : view.subject.entityId ? <><span className="text-muted-foreground">Not in Xero yet.</span><Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" disabled={xero.isPending} onClick={() => xero.mutate()} data-testid="client-kyc-xero">{xero.isPending && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}Link to Xero</Button></>
                    : <span className="text-muted-foreground">Recorded on the account itself.</span>}
                </div>
                {view.transactions.length > 0 && (
                  <ul className="space-y-0.5 text-xs">
                    {view.transactions.map(t => <li key={t.id}><Link href={`/deals/${t.id}?section=parties`} className="text-primary hover:underline">{t.name}{t.ref != null ? ` #${t.ref}` : ""}</Link><span className="text-muted-foreground"> · {t.role}{t.status ? ` · ${t.status}` : ""}</span></li>)}
                  </ul>
                )}
              </Step>

              <Step n={2} label={view.sanctionsOnly ? "Sanctions" : "Screening"} testId="client-kyc-step-screening" open={step(2)} onToggle={() => toggle(2)} done={!!pre?.ranAt && !live.length}
                summary={pre?.running ? "BGP's checks are running" : pre?.ranAt ? `Checked ${day(pre.ranAt)}${live.length ? ` · ${live.length} red flag${live.length === 1 ? "" : "s"}` : " · no red flags"}` : "Not run yet"}>
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="outline" className="h-7" disabled={runChecks.isPending || !!pre?.running} onClick={() => runChecks.mutate(!!pre?.ranAt)} data-testid="client-kyc-run-checks">
                    {(runChecks.isPending || pre?.running) && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}{pre?.ranAt ? "Run again" : "Run BGP's checks"}
                  </Button>
                  {view.flags.level && <span className="text-xs text-muted-foreground">Due diligence: <span className="font-medium text-foreground">{view.flags.level.level}</span>{view.flags.level.why[0] ? ` · ${view.flags.level.why[0]}` : ""}</span>}
                </div>
                {pre && pre.lines.length > 0 && <ul className="space-y-1">{pre.lines.filter(l => !view.sanctionsOnly || l.key === "sanctions").map(l => <CheckLine key={l.key} line={l} />)}</ul>}
                {live.length > 0 && (
                  <ul className="space-y-1.5" data-testid="client-kyc-flags">
                    {live.map(f => (
                      <li key={f.key} className="rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-xs dark:border-red-900 dark:bg-red-950/40">
                        <div className="flex items-start gap-2">
                          <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-600" />
                          <span className="min-w-0 flex-1"><span className="font-medium">{f.label}</span>{f.detail ? <span className="text-muted-foreground"> · {f.detail}</span> : null}</span>
                          {view.signOff.canDecide && <SetAsideButton companyId={companyId} entityId={entityId} flag={f} onDone={refresh} />}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                {view.flags.setAside.length > 0 && <p className="text-xs text-muted-foreground">{view.flags.setAside.length} set aside by the officers.</p>}
                {view.flags.unchecked.length > 0 && <p className="text-xs text-amber-700">Could not read {view.flags.unchecked.join(", ")}.</p>}
              </Step>

              {!view.sanctionsOnly && <Step n={3} label="Documents" testId="client-kyc-step-documents" open={step(3)} onToggle={() => toggle(3)} done={!!view.documents?.done}
                summary={view.signOff.outstanding.length ? `Still to come: ${view.signOff.outstanding.slice(0, 2).join("; ")}` : view.file?.contact ? `Who to ask: ${view.file.contact.name}` : "Send the client checks, or upload what you hold"}>
                <div className="flex flex-wrap gap-2">
                  <SendClientChecksButton dealId={scopeKey} companyId={companyId} partyName={view.subject.name} label="Send client checks" />
                </div>
                <ClientChecksForParty dealId={scopeKey} companyId={companyId} canDecide={view.signOff.canDecide} />
                <PartyDocumentsBox dealId={scopeKey} role="client" partyName={view.subject.name} canDecide={view.signOff.canDecide} />
              </Step>}

              <Step n={view.sanctionsOnly ? 3 : 4} label="Sign-off" testId="client-kyc-step-sign-off" open={step(4)} onToggle={() => toggle(4)} done={view.state.bucket === "cleared" || view.state.bucket === "expiring"}
                summary={view.state.status === "approved" ? `Signed off${view.state.approvedBy ? ` by ${view.state.approvedBy}` : ""}${view.state.expiresAt ? `, until ${day(view.state.expiresAt)}` : ""}` : view.signOff.blocked ? "Not ready" : "Ready"}>
                {view.signOff.blocked && <p className="text-xs text-amber-800 dark:text-amber-300">{view.signOff.blocked}</p>}
                {view.signOff.canSignOff ? (
                  <div className="space-y-2">
                    {(view.signOff.needsNote || view.signOff.edd) && <Textarea value={note} onChange={e => setNote(e.target.value)} rows={3} placeholder={view.signOff.edd ? "What was checked, and why the risk is acceptable" : "A note: what was checked"} data-testid="client-kyc-sign-off-note" />}
                    <Button size="sm" disabled={!!view.signOff.blocked || signOff.isPending} onClick={() => signOff.mutate()} data-testid="client-kyc-sign-off">
                      {signOff.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}Sign off {view.subject.name}
                    </Button>
                  </div>
                ) : <p className="text-xs text-muted-foreground">Signed off by {view.subject.accountName}'s BGP people, the Nominated Officer or a Deputy.</p>}
              </Step>
            </>
          )}
          </AmlUrlsProvider>
        </div>
      </DialogContent>
    </Dialog>
  );
}
