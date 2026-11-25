// The client KYC box: BGP's client checked with no transaction (Woody,
// 24 November 2026: "Yes build it within companies ... aml all the sub
// companies within each company ... use those for xero invoicing too").
// One company (a sub company filed under the account, or the account's own
// record when it is a person, trust or public body), in the transaction AML
// box's four steps: the company, screening, documents, sign-off. The client
// checks, people to check and documents are the transaction screens, pointed
// at the client file's addresses (client/src/lib/aml-scope.tsx). The rules
// are shared/client-kyc.ts; the server is server/client-kyc.ts.

import { useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2, Receipt, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, getAuthHeaders, queryClient } from "@/lib/queryClient";
import { AmlUrlsProvider, clientFileKey, clientFileUrls } from "@/lib/aml-scope";
import { AmlCheckLines, AmlLevelChip, AmlNextBox, AmlScreeningHead, AmlStep, CompanyFactsList, DealStatusChip, RedFlagChip } from "@/components/aml-frame";
import { RedFlagLists } from "@/components/aml-red-flags";
import { useAmlOfficerLabel } from "@/components/aml-policy-panel";
import { AML_STEP_LABEL, companyStepLine, documentsStepLine, sanctionsStepLine, screeningStepLine, signOffStepLine, type ClientRequestStatus, type ScreeningRun } from "@shared/aml-steps";
import { isSanctionsFlag } from "@shared/kyc-red-flags";
import { ClientChecksForParty, SendClientChecksButton, useClientChecks } from "@/components/kyc-client-checks";
import { PartyDocumentsBox } from "@/components/kyc-documents";
import { CLIENT_INSTRUCTIONS, clientSubjectParam, type ClientKycNext } from "@shared/client-kyc";
import type { PrecheckCardLine, PrecheckCompany } from "@shared/kyc-prechecks";
import type { KycRedFlag, SetAsideFlag } from "@shared/kyc-red-flags";
import type { PersonDetailsView } from "@shared/kyc-person-details";
import { PersonDetailsLine } from "@/components/aml-person-details";
import { AbroadTrace, useDealAbroad } from "@/components/aml-abroad";

export interface ClientFileView {
  subject: { companyId: string; accountName: string; entityId: string | null; name: string; number: string | null; kind: string; country: string | null; sameCompany: boolean };
  file: { id: string; instruction: string | null; instructionLabel: string | null; contactId: string | null; openedAt: string | null; openedBy: string | null; contact: { id: string; name: string; email: string | null } | null } | null;
  state: { status: string | null; expiresAt: string | null; approvedBy: string | null; scope: string | null; bucket: string };
  precheck: { ranAt: string | null; running: boolean; lines: PrecheckCardLine[]; company: PrecheckCompany | null } | null;
  flags: { live: KycRedFlag[]; setAside: SetAsideFlag[]; level: { level: "simplified" | "standard" | "enhanced"; why: string[]; toWeigh?: string[] } | null; unchecked: string[] };
  signOff: { blocked: string | null; needsNote: boolean; edd: boolean; outstanding: string[]; canSignOff: boolean; canDecide: boolean;
    // A private individual's date of birth and nationality (24 November 2026).
    person?: PersonDetailsView | null;
    // A listed company's sign-off note, written from the file (24 November 2026).
    fileNote?: string | null };
  next: ClientKycNext;
  documents?: { done: boolean; request?: { status: ClientRequestStatus; who: string; sentAt: string | null } | null; owing?: number; links?: { total: number; owing: number; sentAt: string | null } | null };
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

// Owners abroad on a client file (Woody, 25 November 2026, on Federated Hermes
// Limited: "suggesting find them on owners abroad but there isnt anywhere to do
// it on this form"): the transaction box's own section, rendered inside the
// client file's addresses so its reads and saves go to the client file.
function ClientFileAbroad({ scopeKey, ownedAbroad, sanctionsOnly }: { scopeKey: string; ownedAbroad: boolean; sanctionsOnly: boolean }) {
  const query = useDealAbroad(scopeKey, "client", true);
  return (
    <div className="space-y-1.5" data-testid="client-kyc-abroad">
      <p className="text-xs font-medium text-muted-foreground">{query.data?.trace?.party ? "Registered abroad" : ownedAbroad ? "Owners abroad" : "Parent companies"}</p>
      <AbroadTrace dealId={scopeKey} role="client" query={query} sanctionsOnly={sanctionsOnly} />
    </div>
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
  const officer = useAmlOfficerLabel();

  // Each step's line, by the rule every AML screen uses (shared/aml-steps.ts):
  // the same company reads the same here and on a transaction (24 November 2026).
  const sanctionsOnly = !!view?.sanctionsOnly;
  const cleared = view?.state.bucket === "cleared" || view?.state.bucket === "expiring";
  const flags = live.filter(f => !f.factor);
  const run: ScreeningRun = pre?.running ? "running" : pre?.ranAt ? "done" : "none";
  const failedLine = pre?.lines.find(l => l.failed) || null;
  const sanctionsLine = pre?.lines.find(l => l.key === "sanctions") || null;
  const request = view?.documents?.request || null;
  const companyLine = view ? companyStepLine({
    missing: false,
    kind: view.subject.kind === "individual" ? "a person" : null,
    warning: pre?.company?.warnings[0] || null,
    gaps: [
      !cleared && !sanctionsOnly && !view.file?.contact && !request ? "who to ask not set" : null,
      // A private individual's date of birth, before a sanctions-only sign-off (24 November 2026).
      !cleared && view.signOff.person?.needed && !view.signOff.person.details ? "date of birth to add" : null,
    ].filter((g): g is string => !!g),
    notes: [
      view.signOff.person?.words ? view.signOff.person.words.replace(/^Born /, "born ") : null,
      view.file?.contact && !cleared ? `ask ${view.file.contact.name}` : null,
      view.subject.entityId ? (view.xero ? "in Xero" : "not in Xero") : null,
      view.transactions.length ? `${view.transactions.length} transaction${view.transactions.length === 1 ? "" : "s"}` : null,
    ].filter((n): n is string => !!n),
  }) : null;
  const screening = view ? (sanctionsOnly
    ? sanctionsStepLine({ run, ranAt: pre?.ranAt || null, match: live.some(isSanctionsFlag), read: !!sanctionsLine && !sanctionsLine.failed, officer })
    : screeningStepLine({
        run, ranAt: pre?.ranAt || null, redFlags: flags.map(f => f.label),
        attention: pre ? pre.lines.filter(l => l.state === "attention").length : 0,
        failed: failedLine ? (failedLine.key === "sanctions" ? "sanctions" : "provider") : null,
        enhanced: view.flags.level?.level === "enhanced", setAside: view.flags.setAside.filter(a => !a.flag.factor).length,
        unread: view.flags.unchecked.length > 0, flagsRead: true,
      })) : null;
  const documents = view ? documentsStepLine({
    sanctionsOnly, cleared, request, people: { total: 0, owing: view.documents?.owing || 0 }, clientChecks: true, links: view.documents?.links || null,
  }) : null;
  const signOffLine = view ? signOffStepLine({
    rejected: view.state.status === "rejected", notRequired: null,
    approved: view.state.status === "approved" && cleared ? { by: view.state.approvedBy, until: view.state.expiresAt } : null,
    expired: view.state.bucket === "expired" ? { on: view.state.expiresAt } : null,
    companyMissing: false, screeningPending: !!screening?.pending, sanctionsView: sanctionsOnly,
    documentsDone: sanctionsOnly || !!view.documents?.done, decisionRead: true,
    blocked: view.signOff.blocked, edd: view.signOff.edd, canDecide: view.signOff.canDecide, canSignOff: view.signOff.canSignOff, needsNote: view.signOff.needsNote,
  }) : null;
  const signOffStep = sanctionsOnly ? 3 : 4;
  const alreadyCleared = !!view?.signOff.blocked && /^Already approved/.test(view.signOff.blocked);
  const isPerson = view?.subject.kind === "individual";
  // Owned through a company abroad, or anything traced past Companies House: the section to record the people behind it.
  const ownedAbroad = pre?.company?.ownersAbroad || [];
  const showAbroad = !!view && !isPerson && (ownedAbroad.length > 0 || (pre?.company?.trace || []).length > 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90dvh] max-w-3xl flex-col gap-3" data-testid="client-kyc-dialog">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2 pr-8">
            <ShieldCheck className="h-4 w-4" />KYC · {view?.subject.name || name}
            {view && (
              <span className="flex flex-wrap items-center gap-1.5">
                <RedFlagChip count={flags.length} onClick={() => setOpenStep(2)} testId="client-kyc-flags" />
                {view.flags.level && <AmlLevelChip level={view.flags.level.level} testId="client-kyc-level" />}
              </span>
            )}
          </DialogTitle>
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
          ) : view && companyLine && screening && documents && signOffLine && (
            <>
              <AmlNextBox className="mb-3" tone={view.next.tone} lead={view.next.lead} words={view.next.words} testId="client-kyc-next" action={<>
                {(view.next.action === "run_checks" || view.next.action === "full_checks") && (
                  <Button size="sm" variant="outline" className="h-7 text-xs bg-background" disabled={runChecks.isPending} onClick={() => runChecks.mutate(view.next.action === "full_checks")}>Run BGP's checks</Button>
                )}
                {(view.next.action === "send_checks" || view.next.action === "pick_person") && (
                  <SendClientChecksButton dealId={scopeKey} companyId={companyId} partyName={view.subject.name} label="Send client checks" className="h-7 text-xs bg-background" />
                )}
                {view.next.action === "sign_off" && <Button size="sm" variant="outline" className="h-7 text-xs bg-background" onClick={() => setOpenStep(signOffStep)}>Sign off</Button>}
                {view.next.action === "person_details" && <Button size="sm" variant="outline" className="h-7 text-xs bg-background" onClick={() => setOpenStep(1)} data-testid="client-kyc-next-dob">Add it</Button>}
              </>} />
              {view.sanctionsOnly && (
                <p className="mb-2 text-xs text-muted-foreground" data-testid="client-kyc-sanctions-only">Sanctions checks only: for lettings under £10,000 a month. Nothing is asked of the client; the sign-off covers small lettings only.</p>
              )}
              {view.file?.instructionLabel && (
                <p className="mb-2 text-xs text-muted-foreground">{view.file.instructionLabel}{view.file.openedBy ? `, started by ${view.file.openedBy}` : ""}{view.file.openedAt ? ` on ${day(view.file.openedAt)}` : ""}.</p>
              )}

              <AmlStep n={1} label={isPerson ? AML_STEP_LABEL.person : AML_STEP_LABEL.company} testId="client-kyc-step-company" open={step(1)} onToggle={() => toggle(1)}
                state={companyLine.state} summary={companyLine.words}>
                {pre?.company && <CompanyFactsList company={pre.company} testKey={`client-${view.subject.entityId || view.subject.companyId}`} />}
                {showAbroad && <ClientFileAbroad scopeKey={scopeKey} ownedAbroad={ownedAbroad.length > 0} sanctionsOnly={sanctionsOnly} />}
                {view.signOff.person && (
                  <PersonDetailsLine view={view.signOff.person} url={`/api/client-kyc/${encodeURIComponent(companyId)}/subjects/${encodeURIComponent(entity)}/person-details`}
                    onSaved={refresh} testKey="client" />
                )}
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <Receipt className="h-3.5 w-3.5 text-muted-foreground" />
                  {view.xero ? <span>Xero: <span className="font-medium">{view.xero.name}</span>, used for invoices when it signs</span>
                    : view.subject.entityId ? <><span className="text-muted-foreground">Not in Xero yet.</span><Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" disabled={xero.isPending} onClick={() => xero.mutate()} data-testid="client-kyc-xero">{xero.isPending && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}Link to Xero</Button></>
                    : <span className="text-muted-foreground">Recorded on the account itself.</span>}
                </div>
                {view.transactions.length > 0 && (
                  <ul className="space-y-1 text-xs" data-testid="client-kyc-transactions">
                    {view.transactions.map(t => (
                      <li key={`${t.id}:${t.role}`} className="flex flex-wrap items-center gap-1.5">
                        <Link href={`/deals/${t.id}?section=parties`} className="text-primary hover:underline">{t.name}{t.ref != null ? ` #${t.ref}` : ""}</Link>
                        <span className="text-muted-foreground">· {t.role}</span>
                        <DealStatusChip status={t.status} />
                      </li>
                    ))}
                  </ul>
                )}
              </AmlStep>

              <AmlStep n={2} label={sanctionsOnly ? AML_STEP_LABEL.sanctions : AML_STEP_LABEL.screening} testId="client-kyc-step-screening" open={step(2)} onToggle={() => toggle(2)}
                state={screening.state} summary={screening.words}>
                {/* Run again and the level, then each check, then the red flags: the transaction's order and look. */}
                <AmlScreeningHead level={sanctionsOnly ? null : view.flags.level} testId="client-kyc-screening-head" action={
                  <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={runChecks.isPending || !!pre?.running} onClick={() => runChecks.mutate(!!pre?.ranAt)} data-testid="client-kyc-run-checks">
                    {(runChecks.isPending || pre?.running) && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}{pre?.ranAt ? "Run again" : "Run BGP's checks"}
                  </Button>
                } />
                {pre && <AmlCheckLines lines={pre.lines} only={sanctionsOnly ? ["sanctions"] : undefined} testId="client-kyc-check-lines" />}
                <RedFlagLists dealId={scopeKey} role="client" flags={live} setAside={view.flags.setAside} canDecide={view.signOff.canDecide}
                  sanctionsOnly={sanctionsOnly} testKey={`client-${view.subject.entityId || view.subject.companyId}`} onChanged={refresh} reportDealId={null} />
                {view.flags.unchecked.length > 0 && <p className="text-xs text-amber-800 dark:text-amber-300">Could not read {view.flags.unchecked.join(", ")}.</p>}
              </AmlStep>

              {!view.sanctionsOnly && <AmlStep n={3} label={AML_STEP_LABEL.documents} testId="client-kyc-step-documents" open={step(3)} onToggle={() => toggle(3)}
                state={documents.state} summary={documents.words}>
                {!request && <div className="flex flex-wrap gap-2">
                  <SendClientChecksButton dealId={scopeKey} companyId={companyId} partyName={view.subject.name} label="Send client checks" className="h-7 text-xs" />
                </div>}
                <ClientChecksForParty dealId={scopeKey} companyId={companyId} canDecide={view.signOff.canDecide} />
                {request && <SendClientChecksButton dealId={scopeKey} companyId={companyId} partyName={view.subject.name} label="Send them again" className="h-7 text-xs" />}
                <PartyDocumentsBox dealId={scopeKey} role="client" partyName={view.subject.name} canDecide={view.signOff.canDecide} />
              </AmlStep>}

              <AmlStep n={signOffStep} label={AML_STEP_LABEL.signOff} testId="client-kyc-step-sign-off" open={step(signOffStep)} onToggle={() => toggle(signOffStep)}
                state={signOffLine.state} summary={signOffLine.words}>
                {/* Already cleared and in date (Woody, 25 November 2026: "why cant I sign this off?"): nothing to
                    sign off, so no note box or greyed button; it comes up again at its re-check date. */}
                {alreadyCleared ? (
                  <p className="text-xs text-muted-foreground" data-testid="client-kyc-already-cleared">
                    {view.signOff.blocked!.replace(/\.$/, "")}: nothing to sign off now. It comes up for sign-off again at its re-check date.
                  </p>
                ) : view.signOff.blocked && <p className="text-xs text-amber-800 dark:text-amber-300">{view.signOff.blocked}</p>}
                {alreadyCleared ? null : view.signOff.canSignOff ? (
                  <div className="space-y-2">
                    {view.signOff.fileNote && (
                      <div className="space-y-1" data-testid="client-kyc-sign-off-file-note">
                        <p className="text-xs font-medium">Written from the file</p>
                        <p className="rounded-md border bg-muted/40 px-2.5 py-2 text-xs leading-relaxed">{view.signOff.fileNote}</p>
                      </div>
                    )}
                    {(view.signOff.needsNote || view.signOff.edd) && <Textarea value={note} onChange={e => setNote(e.target.value)} rows={3}
                      placeholder={view.signOff.edd ? "What was checked, and why the risk is acceptable" : view.signOff.fileNote ? "The client checks aren't finished: say why you're signing off before they are" : "A note: what was checked"} data-testid="client-kyc-sign-off-note" />}
                    <Button size="sm" disabled={!!view.signOff.blocked || signOff.isPending} onClick={() => signOff.mutate()} data-testid="client-kyc-sign-off">
                      {signOff.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}Sign off {view.subject.name}
                    </Button>
                  </div>
                ) : <p className="text-xs text-muted-foreground">Signed off by {view.subject.accountName}'s BGP people, the Nominated Officer or a Deputy.</p>}
              </AmlStep>
            </>
          )}
          </AmlUrlsProvider>
        </div>
      </DialogContent>
    </Dialog>
  );
}
