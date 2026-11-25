// A trust's structure on the transaction's AML box (Jack, 23 November 2026:
// "Remove KYC4u on trusts. We need you to build the trust structuring"). BGP
// records what the trust deed says: its kind, HMRC's registration, the
// settlor's wealth, and its people. Each person BGP's policy asks to verify
// then shows under People to check with a link of their own. Rules:
// shared/trust-structure.ts. No form element here: the dialog opens over the deal form.
import { useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Circle, FileSearch, Loader2, Mail, Pencil, Plus, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiRequest, getAuthHeaders, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  TRS_STATUSES, TRUST_KINDS, TRUST_ROLES, trustPersonOwesChecks, trustRoleWords,
  type TrsStatus, type TrustGap, type TrustKind, type TrustRole, type TrustStructure, type TrustStructureRecord,
} from "@shared/trust-structure";
import type { TrustDeedReading } from "@shared/trust-deed-read";
import { KYC_DOCS, TRUST_REQUEST_DOCS, type KycDocKey } from "@shared/kyc-request";

export interface TrustStructureView {
  companyId: string; name: string; trust: boolean;
  record: TrustStructureRecord | null;
  documents: { deed: boolean; trs: boolean };
  // Which of the trust's documents (TRUST_REQUEST_DOCS) are on its KYC record.
  held?: KycDocKey[];
  gaps: TrustGap[];
  // The latest "Request trust structure" (23 November 2026), and the deed it brought in, read.
  request?: {
    token: string; ref: string; dealId: string; to: string | null; email: string | null; sentAt: string | null; sendError: string | null;
    finishedAt: string | null; remindersSent: number; docs: Array<{ key: string; title: string; done: boolean }>;
  } | null;
  draft?: { documentId: string; fileName: string | null; readAt: string; reading: TrustDeedReading; proposal: TrustStructure } | null;
  askFirst?: { contactId: string | null; name: string; email: string | null; mobile: string | null } | null;
  contacts?: Array<{ id: string; name: string; email: string | null; mobile: string | null }>;
}

const plain = (e: unknown) => String((e as any)?.message || e).replace(/^\d+:\s*/, "").replace(/^\{"message":"(.*)"\}$/, "$1");
const keyFor = (companyId: string) => ["/api/trust-structure", companyId];

export function useTrustStructure(companyId: string | null | undefined, enabled = true, dealId?: string | null) {
  return useQuery<TrustStructureView>({
    queryKey: [...keyFor(String(companyId)), dealId || ""],
    enabled: !!companyId && enabled, staleTime: 30_000,
    queryFn: async () => {
      const res = await fetch(`/api/trust-structure/${companyId}${dealId ? `?dealId=${encodeURIComponent(dealId)}` : ""}`, { credentials: "include", headers: getAuthHeaders() });
      if (!res.ok) throw new Error(plain(await res.text()));
      return res.json();
    },
  });
}

const shortDay = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

function refreshAfter(companyId: string, dealId?: string | null) {
  queryClient.invalidateQueries({ queryKey: keyFor(companyId) });
  if (dealId) {
    queryClient.invalidateQueries({ queryKey: ["/api/kyc/deal", dealId, "status"] });
    queryClient.invalidateQueries({ queryKey: ["/api/aml/deal", dealId, "client-checks"] });
    queryClient.invalidateQueries({ queryKey: ["/api/aml-dashboard", "deal", dealId] });
  }
}

/** The summary line for the AML box: how many people, and what is still to do. */
export function trustSummary(view: TrustStructureView | undefined): string {
  if (!view) return "";
  const s = view.record?.structure;
  if (!s) return "trust information not added yet";
  const n = s.people.length;
  return `${TRUST_KINDS[s.kind].split(" (")[0].toLowerCase()}, ${n} ${n === 1 ? "person" : "people"}${view.gaps.length ? ` · ${view.gaps.length} to do` : ""}`;
}

// Upload documents (Layla, 23 November 2026): one button beside Ask for trust
// information. The box lists the documents a trust's file needs, each with
// whether it is on file and a Choose file button.
const UPLOAD_HINTS: Partial<Record<KycDocKey, string>> = {
  trust_deed: "A certified copy, with any later deeds of appointment, retirement or variation.",
  trust_people: "A list of the settlor, the trustees now, any protector and the beneficiaries.",
  trs_excerpt: "From HMRC's Trust Registration Service, or a line saying why the trust need not register.",
  trust_wealth: "How the settlor came to have the money or property, with something showing it.",
  trust_authority: "Only when the person dealing with us is not a trustee.",
};

function UploadRow({ companyId, dealId, doc, onFile }: { companyId: string; dealId?: string | null; doc: KycDocKey; onFile: boolean }) {
  const { toast } = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState<string | null>(null);
  const title = KYC_DOCS[doc].title;
  const send = async (file: File) => {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("companyId", companyId);
      fd.append("docType", KYC_DOCS[doc].docType);
      if (dealId) fd.append("dealId", dealId);
      fd.append("notes", `${title}, added by BGP from the trust's information`);
      const res = await fetch("/api/kyc/documents/upload", { method: "POST", body: fd, credentials: "include", headers: getAuthHeaders() });
      if (!res.ok) throw new Error(plain(await res.text()));
      setAdded(file.name);
      refreshAfter(companyId, dealId);
    } catch (e) {
      toast({ title: "Not added", description: plain(e), variant: "destructive" });
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };
  const done = onFile || !!added;
  return (
    <li className="flex items-center gap-3 px-3 py-2.5" data-testid={`trust-upload-row-${doc}`}>
      {done ? <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" /> : <Circle className="h-5 w-5 shrink-0 text-muted-foreground" />}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">{added ? `Added: ${added}` : onFile ? "On file" : UPLOAD_HINTS[doc]}</p>
      </div>
      <input ref={input} type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png,.heic,.doc,.docx" onChange={e => { const f = e.target.files?.[0]; if (f) void send(f); }} />
      <Button type="button" size="sm" variant={done ? "ghost" : "outline"} className="h-8 shrink-0 text-xs" disabled={busy} onClick={() => input.current?.click()} data-testid={`trust-upload-${KYC_DOCS[doc].docType}`}>
        {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Upload className="mr-1 h-3.5 w-3.5" />}{busy ? "Uploading…" : done ? "Add another" : "Choose file"}
      </Button>
    </li>
  );
}

function TrustUploadDialog({ view, dealId, onClose }: { view: TrustStructureView; dealId?: string | null; onClose: () => void }) {
  const held = new Set<KycDocKey>(view.held || []);
  if (view.documents.deed) held.add("trust_deed");
  if (view.documents.trs) held.add("trs_excerpt");
  const docs = TRUST_REQUEST_DOCS.filter(k => !(k === "trs_excerpt" && view.record?.structure.trsStatus === "not_required"));
  return (
    <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto" data-testid="trust-upload-dialog">
        <DialogHeader>
          <DialogTitle>Upload the trust's documents</DialogTitle>
          <DialogDescription>These are the documents we need for {view.name}. Press Choose file beside each one and pick it from your computer.</DialogDescription>
        </DialogHeader>
        <ul className="divide-y divide-border/60 rounded-md border border-border/70">
          {docs.map(k => <UploadRow key={k} companyId={view.companyId} dealId={dealId} doc={k} onFile={held.has(k)} />)}
        </ul>
        <p className="text-xs text-muted-foreground">PDF, Word or a photo. Each file is saved to the trust's KYC record as soon as you choose it.</p>
        <DialogFooter>
          <Button type="button" onClick={onClose} data-testid="trust-upload-done">Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Read the trust deed into the form (23 November 2026): the deed on file, or
// one chosen now (filed on the trust's KYC record as its deed). The form opens
// on what was read, each value with the deed's words; nothing saves until Save.
function ReadDeedButton({ companyId, dealId, onFile, onRead }: {
  companyId: string; dealId?: string | null; onFile: boolean;
  onRead: (r: { reading: TrustDeedReading; proposal: TrustStructure | null }) => void;
}) {
  const { toast } = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const read = async (file: File | null) => {
    setBusy(true);
    try {
      const fd = new FormData();
      if (file) fd.append("file", file);
      if (dealId) fd.append("dealId", dealId);
      const res = await fetch(`/api/trust-structure/${companyId}/read-deed`, { method: "POST", body: fd, credentials: "include", headers: getAuthHeaders() });
      if (!res.ok) throw new Error(plain(await res.text()));
      const out = await res.json() as { reading: TrustDeedReading; proposal: TrustStructure | null; filed: boolean };
      if (out.filed) refreshAfter(companyId, dealId);
      if (!out.reading.read) toast({ title: "The deed could not be read", description: out.reading.why || undefined, variant: "destructive" });
      else onRead(out);
    } catch (e) {
      toast({ title: "Not read", description: plain(e), variant: "destructive" });
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };
  return (
    <>
      <input ref={input} type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png,.heic,.doc,.docx,.txt" onChange={e => { const f = e.target.files?.[0]; if (f) void read(f); }} />
      <Button type="button" size="sm" variant="outline" className="h-7 text-xs" disabled={busy} onClick={() => (onFile ? void read(null) : input.current?.click())} data-testid={`trust-read-deed-${companyId}`}>
        {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <FileSearch className="mr-1 h-3 w-3" />}{busy ? "Reading the deed…" : "Read the trust deed"}
      </Button>
      {onFile && !busy && (
        <button type="button" className="text-[11px] text-muted-foreground underline-offset-2 hover:underline" onClick={() => input.current?.click()}>or another file</button>
      )}
    </>
  );
}

export function TrustStructurePanel({ companyId, dealId, partyName, onPeople }: { companyId: string; dealId?: string | null; partyName: string; onPeople?: () => void }) {
  const q = useTrustStructure(companyId, true, dealId);
  const [editing, setEditing] = useState(false);
  const [deedRead, setDeedRead] = useState<{ reading: TrustDeedReading; proposal: TrustStructure | null } | null>(null);
  const [asking, setAsking] = useState(false);
  const [yourself, setYourself] = useState(false);
  const [uploading, setUploading] = useState(false);
  if (q.isLoading) return <p className="text-xs text-muted-foreground"><Loader2 className="mr-1 inline h-3 w-3 animate-spin" />Reading the trust's information…</p>;
  if (q.isError || !q.data) return <p className="text-xs text-red-700 dark:text-red-400">The trust's information could not be read: {plain(q.error)}</p>;
  const view = q.data;
  const s = view.record?.structure || null;
  const recorded = view.gaps.filter(g => g.from === "recorded");
  const starting = !s && !view.draft;
  const uploadButton = (
    <Button type="button" size="sm" variant="outline" className={starting ? "h-8 text-xs" : "h-7 text-xs"} onClick={() => setUploading(true)} data-testid={`trust-upload-open-${companyId}`}>
      <Upload className={starting ? "mr-1 h-3.5 w-3.5" : "mr-1 h-3 w-3"} />Upload documents
    </Button>
  );
  return (
    <div className="space-y-2 rounded-md border border-border/70 px-2.5 py-2 text-xs" data-testid={`trust-structure-${companyId}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">Trust information</span>
        {view.record && <span className="text-muted-foreground">recorded by {view.record.updatedBy || "BGP"} · {new Date(view.record.updatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span>}
        {!starting && <span className="ml-auto" />}
        {!starting && uploadButton}
        {s && (
          <>
            <ReadDeedButton companyId={companyId} dealId={dealId} onFile={view.documents.deed} onRead={r => { setDeedRead(r); setEditing(true); }} />
            <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={() => { setDeedRead(null); setEditing(true); }} data-testid={`trust-structure-edit-${companyId}`}>
              <Pencil className="mr-1 h-3 w-3" />Change
            </Button>
          </>
        )}
      </div>
      {view.draft && (
        <div className="flex flex-wrap items-center gap-2 rounded border border-emerald-300 bg-emerald-50 px-2 py-1.5 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200" data-testid={`trust-draft-${companyId}`}>
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
          <span>The trust deed{view.draft.fileName ? ` (${view.draft.fileName})` : ""} was read on {shortDay(view.draft.readAt)}: {view.draft.reading.people.length} {view.draft.reading.people.length === 1 ? "person" : "people"} named. Check it against the deed and save.</span>
          <Button type="button" size="sm" className="ml-auto h-7 text-xs" onClick={() => { setDeedRead({ reading: view.draft!.reading, proposal: view.draft!.proposal }); setEditing(true); }} data-testid={`trust-draft-open-${companyId}`}>Check and save</Button>
        </div>
      )}
      {view.request && <TrustRequestLine request={view.request} onAskAgain={() => setAsking(true)} companyId={companyId} dealId={dealId} />}
      {starting && (
        <div className="space-y-2" data-testid={`trust-start-${companyId}`}>
          <div className="flex flex-wrap gap-2">
            {!view.request && (
              <Button type="button" size="sm" className="h-8 text-xs" onClick={() => setAsking(true)} data-testid={`trust-request-${companyId}`}>
                <Mail className="mr-1 h-3.5 w-3.5" />Ask for trust information
              </Button>
            )}
            {uploadButton}
            <Button type="button" size="sm" variant="outline" className="h-8 text-xs" onClick={() => setYourself(v => !v)} data-testid={`trust-yourself-${companyId}`}>
              <Plus className="mr-1 h-3.5 w-3.5" />Add trust information yourself
            </Button>
          </div>
          {!view.request && <p className="text-muted-foreground">Ask for it: we email the trust's representative a link to upload the trust deed, who is who, HMRC's registration and where the money came from. When it's all in, you and the AML officers get an email that it's ready for due diligence, with the deed already read into a draft.</p>}
          {yourself && (
            <div className="flex flex-wrap items-center gap-2 rounded border border-border/60 px-2 py-1.5">
              <span className="text-muted-foreground">If you have the deed:</span>
              <ReadDeedButton companyId={companyId} dealId={dealId} onFile={view.documents.deed} onRead={r => { setDeedRead(r); setEditing(true); }} />
              <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setDeedRead(null); setEditing(true); }} data-testid={`trust-structure-edit-${companyId}`}>Fill it in by hand</Button>
            </div>
          )}
        </div>
      )}
      {s && (
        <dl className="grid gap-x-3 gap-y-1 sm:grid-cols-[max-content_1fr]">
          <dt className="text-muted-foreground">Kind</dt><dd>{TRUST_KINDS[s.kind]}{s.established ? ` · settled ${s.established}` : ""}{s.governingLaw ? ` · ${s.governingLaw} law` : ""}</dd>
          <dt className="text-muted-foreground">HMRC</dt><dd>{TRS_STATUSES[s.trsStatus]}{s.trsReference ? ` · ${s.trsReference}` : ""}</dd>
          {s.beneficiaryClass && <><dt className="text-muted-foreground">Beneficiaries</dt><dd className="whitespace-pre-line">{s.beneficiaryClass}</dd></>}
          <dt className="text-muted-foreground">Settlor's wealth</dt><dd className="whitespace-pre-line">{s.settlorWealth || <span className="text-amber-800 dark:text-amber-300">not recorded</span>}</dd>
        </dl>
      )}
      {s && s.people.length > 0 && (
        <ul className="divide-y divide-border/60 rounded border border-border/60" data-testid={`trust-people-${companyId}`}>
          {s.people.map(p => (
            <li key={p.key} className="flex flex-wrap items-center gap-x-2 px-2 py-1">
              <span className="font-medium">{p.name}</span>
              <span className="text-muted-foreground">{trustRoleWords(p.roles)}{p.corporate ? " · a company" : ""}{p.share ? ` · ${p.share}` : ""}</span>
              <span className="ml-auto text-[11px] text-muted-foreground">{trustPersonOwesChecks(p, s.kind) ? "verified: own link" : p.corporate ? "screened as a company" : "screened"}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-x-4 gap-y-1" data-testid={`trust-docs-${companyId}`}>
        <span className="inline-flex items-center gap-1">
          {view.documents.deed ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> : <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />}
          Trust deed {view.documents.deed ? "on file" : "not on file"}
        </span>
        {s?.trsStatus !== "not_required" && (
          <span className="inline-flex items-center gap-1">
            {view.documents.trs ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> : <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />}
            HMRC's proof of registration {view.documents.trs ? "on file" : "not on file"}
          </span>
        )}
      </div>
      {view.gaps.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-4 text-amber-800 dark:text-amber-300" data-testid={`trust-gaps-${companyId}`}>
          {recorded.map(g => <li key={g.key}>{g.words}</li>)}
          {view.gaps.filter(g => g.from === "document").map(g => <li key={g.key}>{g.words}: the client checks ask for it, or press Upload documents above</li>)}
        </ul>
      )}
      {s && s.people.some(p => trustPersonOwesChecks(p, s.kind)) && onPeople && (
        <button type="button" className="text-primary underline-offset-2 hover:underline" onClick={onPeople}>Send each person their own link, under People to check</button>
      )}
      {uploading && <TrustUploadDialog view={view} dealId={dealId} onClose={() => setUploading(false)} />}
      {asking && dealId && <TrustRequestDialog view={view} dealId={dealId} onClose={() => setAsking(false)} />}
      {editing && <TrustStructureDialog companyId={companyId} dealId={dealId} partyName={partyName} initial={deedRead?.proposal || s} reading={deedRead?.reading || null} onClose={() => { setEditing(false); setDeedRead(null); }} />}
    </div>
  );
}

// What has come in on the request, with Remind and Ask someone else.
function TrustRequestLine({ request, onAskAgain, companyId, dealId }: { request: NonNullable<TrustStructureView["request"]>; onAskAgain: () => void; companyId: string; dealId?: string | null }) {
  const { toast } = useToast();
  const remind = useMutation({
    mutationFn: () => apiRequest("POST", `/api/aml/client-checks/${request.token}/remind`),
    onSuccess: () => { toast({ title: `Reminder sent to ${request.to || "them"}` }); refreshAfter(companyId, dealId); },
    onError: e => toast({ title: "Not sent", description: plain(e), variant: "destructive" }),
  });
  const done = request.docs.filter(d => d.done).length;
  return (
    <div className="space-y-1 rounded border border-border/60 px-2 py-1.5" data-testid={`trust-request-line-${companyId}`}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Mail className="h-3.5 w-3.5 text-muted-foreground" />
        <span>
          {request.finishedAt
            ? <>Documents in from {request.to || "them"} on {shortDay(request.finishedAt)}: <strong>ready for due diligence</strong></>
            : request.sentAt
              ? <>Requested from {request.to || "them"}{request.email ? ` (${request.email})` : ""} on {shortDay(request.sentAt)} · {done} of {request.docs.length} in{request.remindersSent ? ` · ${request.remindersSent} reminder${request.remindersSent === 1 ? "" : "s"}` : ""}</>
              : <span className="text-amber-800 dark:text-amber-300">The request to {request.to || "them"} was not sent{request.sendError ? `: ${request.sendError}` : ""}</span>}
        </span>
        <span className="ml-auto flex gap-1">
          {!request.finishedAt && request.sentAt && <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={remind.isPending} onClick={() => remind.mutate()}>Remind</Button>}
          <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={onAskAgain}>Ask someone else</Button>
        </span>
      </div>
      <ul className="flex flex-wrap gap-x-3 gap-y-0.5 pl-5 text-[11px]">
        {request.docs.map(d => (
          <li key={d.key} className="inline-flex items-center gap-1">
            {d.done ? <CheckCircle2 className="h-3 w-3 text-emerald-600" /> : <Circle className="h-3 w-3 text-muted-foreground" />}{d.title}
          </li>
        ))}
      </ul>
    </div>
  );
}

// Request trust structure (Jack, 23 November 2026): who to email, and which
// documents. No form element: the dialog opens over the deal form.
function TrustRequestDialog({ view, dealId, onClose }: { view: TrustStructureView; dealId: string; onClose: () => void }) {
  const { toast } = useToast();
  const first = view.askFirst || null;
  const contacts = view.contacts || [];
  // The transaction's person to ask for the trust ("first", when not filed under the trust), its people, or someone typed.
  const [pick, setPick] = useState<string>(first?.contactId || (first?.email ? "first" : contacts[0]?.id || "typed"));
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [docs, setDocs] = useState<KycDocKey[]>(() => TRUST_REQUEST_DOCS.filter(k => !(k === "trust_deed" && view.documents.deed) && !(k === "trs_excerpt" && view.documents.trs)));
  const chosen: { id: string | null; name: string; email: string | null; mobile: string | null } | null = pick === "first" && first
    ? { id: null, name: first.name, email: first.email, mobile: first.mobile }
    : pick !== "typed" ? contacts.find(c => c.id === pick) || null : null;
  const send = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/trust-structure/${view.companyId}/request`, {
      dealId, contactId: chosen?.id || null, name: chosen ? chosen.name : name, email: chosen ? chosen.email : email, mobile: chosen?.mobile || null, docs, note,
    })).json() as Promise<{ sent: { ok: boolean; error?: string | null }; link: string }>,
    onSuccess: out => {
      if (out.sent.ok) toast({ title: "Request sent", description: `${chosen?.name || name} has been emailed a link to upload the trust's documents. You'll be emailed when they're in.` });
      else toast({ title: "The email did not go", description: `${out.sent.error || "Microsoft refused it"}. Send them this link yourself: ${out.link}`, variant: "destructive" });
      refreshAfter(view.companyId, dealId);
      onClose();
    },
    onError: e => toast({ title: "Not sent", description: plain(e), variant: "destructive" }),
  });
  const ready = docs.length > 0 && (chosen ? !!chosen.email : name.trim().length > 1 && /@/.test(email));
  return (
    <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto" data-testid="trust-request-dialog">
        <DialogHeader>
          <DialogTitle>Ask for the trust's information</DialogTitle>
          <DialogDescription>We email them a secure link to upload these documents. They're filed on {view.name}'s KYC record, and you and the AML officers are emailed when they're in.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          <div className="space-y-1">
            <Label>Who to ask</Label>
            <select className={selectClass} value={pick} onChange={e => setPick(e.target.value)} data-testid="trust-request-who">
              {first && !first.contactId && first.email && <option value="first">{first.name} ({first.email})</option>}
              {contacts.map(c => <option key={c.id} value={c.id}>{c.name}{c.email ? ` (${c.email})` : ""}</option>)}
              <option value="typed">Someone else…</option>
            </select>
          </div>
          {pick === "typed" && (
            <div className="grid gap-2 sm:grid-cols-2">
              <Input value={name} onChange={e => setName(e.target.value)} placeholder="Full name" data-testid="trust-request-name" />
              <Input value={email} onChange={e => setEmail(e.target.value)} placeholder="Email" type="email" data-testid="trust-request-email" />
            </div>
          )}
          <div className="space-y-1.5">
            <Label>What to ask for</Label>
            {TRUST_REQUEST_DOCS.map(k => (
              <label key={k} className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-1" checked={docs.includes(k)} onChange={e => setDocs(list => (e.target.checked ? [...list, k] : list.filter(x => x !== k)))} data-testid={`trust-request-doc-${k}`} />
                <span>{KYC_DOCS[k].title}{(k === "trust_deed" && view.documents.deed) || (k === "trs_excerpt" && view.documents.trs) ? <span className="text-muted-foreground"> (already on file)</span> : null}</span>
              </label>
            ))}
          </div>
          <div className="space-y-1"><Label>A note to them (optional)</Label><Textarea rows={2} value={note} onChange={e => setNote(e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="button" disabled={!ready || send.isPending} onClick={() => send.mutate()} data-testid="trust-request-send">
            {send.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}Send request
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface PersonDraft {
  id: number; name: string; roles: TrustRole[]; corporate: boolean; companyNumber: string; country: string;
  month: string; year: string; share: string; note: string;
}
let nextId = 1;
const blankPerson = (roles: TrustRole[] = []): PersonDraft => ({ id: nextId++, name: "", roles, corporate: false, companyNumber: "", country: "", month: "", year: "", share: "", note: "" });

const selectClass = "h-9 w-full rounded-md border border-input bg-background px-2 text-sm";

export function TrustStructureDialog({ companyId, dealId, partyName, initial, reading, onClose }: {
  companyId: string; dealId?: string | null; partyName: string; initial: TrustStructure | null; reading?: TrustDeedReading | null; onClose: () => void;
}) {
  const { toast } = useToast();
  const [kind, setKind] = useState<TrustKind>(initial?.kind || "unknown");
  const [established, setEstablished] = useState(initial?.established || "");
  const [governingLaw, setGoverningLaw] = useState(initial?.governingLaw || "");
  const [trsStatus, setTrsStatus] = useState<TrsStatus>(initial?.trsStatus || "unknown");
  const [trsReference, setTrsReference] = useState(initial?.trsReference || "");
  const [beneficiaryClass, setBeneficiaryClass] = useState(initial?.beneficiaryClass || "");
  const [settlorWealth, setSettlorWealth] = useState(initial?.settlorWealth || "");
  const [people, setPeople] = useState<PersonDraft[]>(() => initial?.people.length
    ? initial.people.map(p => ({
        id: nextId++, name: p.name, roles: [...p.roles], corporate: p.corporate, companyNumber: p.companyNumber || "", country: p.country || "",
        month: p.dob?.month ? String(p.dob.month) : "", year: p.dob?.year ? String(p.dob.year) : "", share: p.share || "", note: p.note || "",
      }))
    : [blankPerson(["settlor"]), blankPerson(["trustee"])]);

  const change = (id: number, patch: Partial<PersonDraft>) => setPeople(list => list.map(p => (p.id === id ? { ...p, ...patch } : p)));
  const toggleRole = (id: number, role: TrustRole) => setPeople(list => list.map(p => (p.id === id
    ? { ...p, roles: p.roles.includes(role) ? p.roles.filter(r => r !== role) : [...p.roles, role] } : p)));

  const save = useMutation({
    mutationFn: async () => {
      const structure = {
        kind, established, governingLaw, trsStatus, trsReference, beneficiaryClass, settlorWealth,
        people: people.filter(p => p.name.trim()).map(p => ({
          name: p.name, roles: p.roles, corporate: p.corporate, companyNumber: p.companyNumber, country: p.country,
          dob: p.year ? { year: Number(p.year), month: p.month ? Number(p.month) : null } : null, share: p.share, note: p.note,
        })),
      };
      return (await apiRequest("PUT", `/api/trust-structure/${companyId}`, { structure, dealId: dealId || null })).json();
    },
    onSuccess: () => {
      toast({ title: "Trust information saved", description: "Everyone on it is screened again now." });
      refreshAfter(companyId, dealId);
      onClose();
    },
    onError: e => toast({ title: "Not saved", description: plain(e), variant: "destructive" }),
  });

  return (
    <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto" data-testid="trust-structure-dialog">
        <DialogHeader>
          <DialogTitle>Trust information: {partyName}</DialogTitle>
          <DialogDescription>From the trust deed. The settlor, the trustees, any protector and anyone else with control each do their own identity check; beneficiaries too unless the trust is discretionary. Everyone named is screened.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          {reading?.read && <DeedReadBack reading={reading} />}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1"><Label>Kind of trust</Label>
              <select className={selectClass} value={kind} onChange={e => setKind(e.target.value as TrustKind)} data-testid="trust-kind">
                {(Object.keys(TRUST_KINDS) as TrustKind[]).map(k => <option key={k} value={k}>{TRUST_KINDS[k]}</option>)}
              </select>
            </div>
            <div className="space-y-1"><Label>Settled (date or year)</Label><Input value={established} onChange={e => setEstablished(e.target.value)} placeholder="e.g. 12 March 2004" /></div>
            <div className="space-y-1"><Label>HMRC's Trust Registration Service</Label>
              <select className={selectClass} value={trsStatus} onChange={e => setTrsStatus(e.target.value as TrsStatus)} data-testid="trust-trs">
                {(Object.keys(TRS_STATUSES) as TrsStatus[]).map(k => <option key={k} value={k}>{TRS_STATUSES[k]}</option>)}
              </select>
            </div>
            <div className="space-y-1"><Label>Its URN or UTR</Label><Input value={trsReference} onChange={e => setTrsReference(e.target.value)} placeholder="e.g. XATRUST80000001" /></div>
            <div className="space-y-1 sm:col-span-2"><Label>Governing law</Label><Input value={governingLaw} onChange={e => setGoverningLaw(e.target.value)} placeholder="e.g. England and Wales" /></div>
          </div>
          <div className="space-y-1"><Label>Where the settlor's money came from</Label>
            <Textarea rows={2} value={settlorWealth} onChange={e => setSettlorWealth(e.target.value)} placeholder="e.g. Proceeds of the sale of the family business in 2003, per the accountant's letter" data-testid="trust-wealth" />
          </div>
          {(kind === "discretionary" || beneficiaryClass) && (
            <div className="space-y-1"><Label>Class of beneficiaries (as the deed describes it)</Label>
              <Textarea rows={2} value={beneficiaryClass} onChange={e => setBeneficiaryClass(e.target.value)} placeholder="e.g. The settlor's children and remoter issue" />
            </div>
          )}
          <div className="space-y-2">
            <Label>People on the trust</Label>
            {people.map(p => (
              <div key={p.id} className="space-y-2 rounded-md border border-border p-2" data-testid="trust-person-row">
                <div className="flex items-center gap-2">
                  <Input value={p.name} onChange={e => change(p.id, { name: e.target.value })} placeholder={p.corporate ? "Company name" : "Full name"} className="flex-1" data-testid="trust-person-name" />
                  <button type="button" className="rounded p-1 text-muted-foreground hover:text-foreground" aria-label="Remove this person" onClick={() => setPeople(list => list.filter(x => x.id !== p.id))}><X className="h-4 w-4" /></button>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {(Object.keys(TRUST_ROLES) as TrustRole[]).map(r => (
                    <button key={r} type="button" onClick={() => toggleRole(p.id, r)}
                      className={`rounded-full border px-2.5 py-0.5 text-xs ${p.roles.includes(r) ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:text-foreground"}`}
                      data-testid={`trust-role-${r}`}>{TRUST_ROLES[r]}</button>
                  ))}
                  <label className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <input type="checkbox" checked={p.corporate} onChange={e => change(p.id, { corporate: e.target.checked })} />A company
                  </label>
                </div>
                <div className="grid gap-2 sm:grid-cols-3">
                  {p.corporate
                    ? <Input value={p.companyNumber} onChange={e => change(p.id, { companyNumber: e.target.value })} placeholder="Company number" />
                    : <div className="flex gap-1">
                        <Input value={p.month} onChange={e => change(p.id, { month: e.target.value.replace(/\D/g, "").slice(0, 2) })} placeholder="Born: month" inputMode="numeric" />
                        <Input value={p.year} onChange={e => change(p.id, { year: e.target.value.replace(/\D/g, "").slice(0, 4) })} placeholder="year" inputMode="numeric" />
                      </div>}
                  <Input value={p.country} onChange={e => change(p.id, { country: e.target.value })} placeholder={p.corporate ? "Country registered" : "Country they live in"} />
                  {p.roles.includes("beneficiary") && <Input value={p.share} onChange={e => change(p.id, { share: e.target.value })} placeholder="Their share (e.g. 50%)" />}
                </div>
              </div>
            ))}
            <Button type="button" size="sm" variant="outline" className="h-8 text-xs" onClick={() => setPeople(list => [...list, blankPerson()])} data-testid="trust-add-person">
              <Plus className="mr-1 h-3.5 w-3.5" />Add a person
            </Button>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="button" disabled={save.isPending} onClick={() => save.mutate()} data-testid="trust-structure-save">
            {save.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// What the deed reading filled, each with the deed's own words, and what it left out.
function DeedReadBack({ reading }: { reading: TrustDeedReading }) {
  return (
    <div className="space-y-1.5 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs" data-testid="trust-deed-readback">
      <p className="font-medium">Read from the trust deed: check each line, then Save. What you had recorded is kept; the deed only fills what was blank and adds people.</p>
      {reading.scanned && <p className="text-amber-800 dark:text-amber-300">A scanned deed: its words could not be checked by the app, so check each line against the deed by eye.</p>}
      <ul className="space-y-1">
        {reading.lines.map((l, i) => (
          <li key={i}>
            <span className="font-medium">{l.field}:</span> {l.value}
            {l.quote && <span className="block border-l-2 border-border pl-2 italic text-muted-foreground">“{l.quote}”{l.checked === null ? <span className="not-italic"> (check by eye)</span> : null}</span>}
          </li>
        ))}
      </ul>
      {reading.dropped.length > 0 && (
        <details className="text-muted-foreground">
          <summary className="cursor-pointer">{reading.dropped.length} left out</summary>
          <ul className="mt-1 list-disc pl-4">{reading.dropped.map((d, i) => <li key={i}>{d.what}: {d.why}</li>)}</ul>
        </details>
      )}
      <p className="text-muted-foreground">The deed does not say whether HMRC holds the trust or where the settlor's money came from: record those yourself.</p>
    </div>
  );
}
