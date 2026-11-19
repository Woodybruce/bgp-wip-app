// Client checks on a deal: send a party's contact one email asking for an
// identity check and documents, and follow what they have done. The server
// is server/aml-portal.ts; the email's words, which the preview here draws
// with the same function the server sends, are in shared/kyc-request.ts.
// Shown while the client checks are on (clientChecks on the deal's KYC
// status: their own switch since 18 November 2026, not in-app AML's);
// otherwise KYC4U does the checks.
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CheckCircle2, Clock, Copy, Eye, Loader2, Mail, MessageCircle, Send, ShieldCheck, Trash2, AlertCircle, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { pillMetrics } from "@/components/ui/pill";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, getAuthHeaders, queryClient } from "@/lib/queryClient";
import {
  KYC_DOCS, KYC_LETTING_SCOPE, KYC_LOGO_CID, KYC_PEP_QUESTION, KYC_TIMING, kycOwnersWords, kycPepWords, kycRequestEmail, kycWhatsAppHref, kycWhatsAppText,
  type KycDocKey, type KycIdState, type KycOwnersAnswer, type KycPartyKind, type KycPepAnswer,
} from "@shared/kyc-request";
import { precheckAsks, precheckDay, type PrecheckAskInput } from "@shared/kyc-prechecks";

interface PartyContact { id: string; name: string; email: string | null; mobile: string | null }
interface Party {
  // name: the company that signs when the deal names one, else the brand.
  companyId: string; name: string; brandName?: string; entityId?: string | null; entityNumber?: string | null;
  role: string; kind: KycPartyKind; contactId: string | null; contacts: PartyContact[]; defaultDocs: KycDocKey[];
  // What BGP's checks before asking found, for "ask only what is left".
  askInput: PrecheckAskInput | null; precheckRanAt: string | null;
}
export interface ClientCheckRequest {
  token: string; ref: string; companyId: string | null; partyName: string; role: string | null;
  recipientName: string | null; recipientEmail: string | null; mobile: string | null;
  sentAt: string | null; sentFrom: string | null; sendError: string | null; sentBy: string | null; cc: string[];
  openedAt: string | null; expiresAt: string; finishedAt: string | null;
  status: "not_sent" | "sent" | "opened" | "in_progress" | "finished" | "expired" | "cancelled";
  needsIdCheck: boolean; idState: KycIdState | null; idCheckNote: string | null;
  // The name Veriff read off the document, and whether it is someone other
  // than the person the request was for (19 November 2026).
  idVerifiedName?: string | null; idOtherPerson?: boolean;
  askPep: boolean; pep: KycPepAnswer | null; pepDetail: string | null;
  owners: { list: Array<{ name: string; detail: string }>; answer: KycOwnersAnswer | null; detail: string | null } | null;
  notAsked: Array<{ key: KycDocKey; reason: string }>;
  docs: Array<{ key: KycDocKey; title: string; done: boolean }>;
  files: Array<{ name: string; docKey: KycDocKey | null; uploadedAt: string; url: string | null }>;
  remindersSent: number; link: string; whatsapp: string | null; canRemind: boolean;
}
interface ClientChecks { dealName: string; mailbox: string; veriff: boolean; agents: Array<{ name: string; email: string }>; parties: Party[]; requests: ClientCheckRequest[] }

const plain = (e: any) => String(e?.message || e || "").replace(/^\d{3}:\s*/, "");
const shortDate = (iso: string | null) => iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "";
const keyFor = (dealId: string) => ["/api/aml/deal", dealId, "client-checks"];

export function useClientChecks(dealId: string | null | undefined, enabled = true) {
  return useQuery<ClientChecks>({
    enabled: !!dealId && enabled,
    queryKey: keyFor(String(dealId)),
    queryFn: async () => {
      const res = await fetch(`/api/aml/deal/${dealId}/client-checks`, { credentials: "include", headers: getAuthHeaders() });
      if (!res.ok) throw new Error(plain(await res.text()));
      return res.json();
    },
  });
}

const STATUS: Record<ClientCheckRequest["status"], { label: string; cls: string }> = {
  not_sent: { label: "Not sent", cls: "bg-red-50 text-red-700 border border-red-200" },
  sent: { label: "Sent", cls: "bg-amber-50 text-amber-800 border border-amber-200" },
  opened: { label: "Opened", cls: "bg-amber-50 text-amber-800 border border-amber-200" },
  in_progress: { label: "In progress", cls: "bg-sky-50 text-sky-800 border border-sky-200" },
  finished: { label: "Finished", cls: "bg-emerald-50 text-emerald-700 border border-emerald-200" },
  expired: { label: "Link ran out", cls: "bg-muted text-muted-foreground border border-border" },
  cancelled: { label: "Cancelled", cls: "bg-muted text-muted-foreground border border-border" },
};

// A photo a browser can show (HEIC, which most cannot, stays a file line).
const isPhoto = (f: { name: string; url: string | null }) => !!f.url && /\.(jpe?g|png|webp|gif)$/i.test(f.name);

const ID_WORDS: Record<KycIdState, string> = {
  not_started: "not started", started: "started", submitted: "done, waiting for the result",
  approved: "passed", retry: "asked to try again", restart: "needs starting again",
};

// One request: who it went to, what is done, the files, and what to do next.
export function ClientCheckRow({ dealId, request }: { dealId: string; request: ClientCheckRequest }) {
  const { toast } = useToast();
  const remind = useMutation({
    mutationFn: () => apiRequest("POST", `/api/aml/client-checks/${request.token}/remind`),
    onSuccess: () => { toast({ title: "Reminder sent", description: `To ${request.recipientName || request.recipientEmail}` }); queryClient.invalidateQueries({ queryKey: keyFor(dealId) }); },
    onError: (e) => toast({ title: "Reminder not sent", description: plain(e), variant: "destructive" }),
  });
  const cancel = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/aml/client-checks/${request.token}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keyFor(dealId) }),
    onError: (e) => toast({ title: "Not cancelled", description: plain(e), variant: "destructive" }),
  });
  const status = STATUS[request.status];
  const live = request.status !== "cancelled" && request.status !== "expired";
  return (
    <div className="rounded-md border bg-background p-2.5 text-xs space-y-1.5" data-testid={`client-check-${request.ref}`}>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={`${pillMetrics} ${status.cls}`}>{status.label}</span>
        <span className="font-medium text-sm">{request.recipientName || request.recipientEmail}</span>
        <span className="text-muted-foreground truncate">{request.recipientEmail}</span>
      </div>
      <div className="text-muted-foreground">
        {request.sentAt
          ? <>Sent {shortDate(request.sentAt)}{request.sentBy ? ` by ${request.sentBy}` : ""} from {request.sentFrom}{request.cc.length ? `, copied to ${request.cc.length} at BGP` : ""}{request.remindersSent ? ` · ${request.remindersSent} reminder${request.remindersSent === 1 ? "" : "s"}` : ""}</>
          : <span className="text-red-700">Not sent: {request.sendError || "the email failed"}</span>}
        {request.sentAt && request.sendError ? <div className="text-amber-700">{request.sendError}</div> : null}
        {request.finishedAt ? <> · finished {shortDate(request.finishedAt)}</> : null}
      </div>
      <ul className="flex flex-wrap gap-x-3 gap-y-0.5">
        {request.needsIdCheck && (request.idOtherPerson ? (
          <li className="flex items-center gap-1 text-amber-800" data-testid={`client-check-id-other-${request.ref}`}>
            <AlertCircle className="w-3.5 h-3.5 text-amber-600" />
            Identity check ({ID_WORDS[request.idState || "not_started"]}) was <strong>{request.idVerifiedName || "someone else"}</strong>'s, not {request.recipientName || "the person it was for"}'s
          </li>
        ) : (
          <li className="flex items-center gap-1">
            {request.idState === "approved" || request.idState === "submitted" ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> : <Clock className="w-3.5 h-3.5 text-muted-foreground" />}
            Identity check: {ID_WORDS[request.idState || "not_started"]}
          </li>
        ))}
        {request.docs.map(d => (
          <li key={d.key} className="flex items-center gap-1">
            {d.done ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> : <Clock className="w-3.5 h-3.5 text-muted-foreground" />}{d.title}
          </li>
        ))}
      </ul>
      {request.askPep && (
        <p className={request.pep === "yes" || request.pep === "unsure" ? "rounded border border-amber-300 bg-amber-50 px-2 py-1 text-amber-900" : "text-muted-foreground"} data-testid={`client-check-pep-${request.ref}`}>
          Public roles: <strong>{kycPepWords(request.pep)}</strong>{request.pepDetail ? ` · ${request.pepDetail}` : ""}
          {(request.pep === "yes" || request.pep === "unsure") && <> · Enhanced due diligence: senior management approval (a director or the MLRO) before the deal goes ahead, source of wealth and of funds, closer monitoring. Lighter for a UK one with no other risk.</>}
        </p>
      )}
      {request.owners && (
        <p className={request.owners.answer === "no" ? "rounded border border-amber-300 bg-amber-50 px-2 py-1 text-amber-900" : "text-muted-foreground"} data-testid={`client-check-owners-${request.ref}`}>
          Owners on the register: <strong>{kycOwnersWords(request.owners.answer)}</strong>{request.owners.detail ? ` · ${request.owners.detail}` : ""}
          {request.owners.answer === "no" && <> · Find out who the owners are and report the difference to Companies House.</>}
        </p>
      )}
      {request.idOtherPerson && (
        <p className="rounded border border-amber-300 bg-amber-50 px-2 py-1 text-amber-900">
          {request.recipientName || "The person it was for"} has not done their own identity check: the one on this link was {request.idVerifiedName || "someone else"}'s. Send them a new request, or record on the deal why {request.idVerifiedName || "that person"} can act for {request.partyName}.
        </p>
      )}
      {request.idCheckNote && <p className="text-muted-foreground italic">{request.idCheckNote}</p>}
      {request.files.length > 0 && (
        <div className="space-y-1.5">
          {/* Photos as thumbnails (Woody, 19 November 2026: "the letters for the photos can we show them as thumb nails?"). */}
          {request.files.some(isPhoto) && (
            <div className="flex flex-wrap gap-2" data-testid={`client-check-thumbs-${request.ref}`}>
              {request.files.filter(isPhoto).map((f, i) => (
                <a key={`${f.name}-${i}`} href={f.url!} target="_blank" rel="noreferrer" title={f.name} className="group w-20 shrink-0">
                  <img src={f.url!} alt={f.docKey ? KYC_DOCS[f.docKey].title : "Photo sent by the client"} loading="lazy"
                    className="h-20 w-20 rounded border bg-muted object-cover group-hover:ring-2 group-hover:ring-primary/40" />
                  <span className="block truncate text-[11px] leading-tight text-muted-foreground">{f.docKey ? KYC_DOCS[f.docKey].title : "By email"}</span>
                  <span className="block text-[11px] leading-tight text-muted-foreground">{shortDate(f.uploadedAt)}</span>
                </a>
              ))}
            </div>
          )}
          {request.files.some(f => !isPhoto(f)) && (
            <ul className="space-y-0.5">
              {request.files.filter(f => !isPhoto(f)).map((f, i) => (
                <li key={`${f.name}-${i}`} className="flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  {f.url ? <a href={f.url} target="_blank" rel="noreferrer" className="hover:underline truncate">{f.name}</a> : <span className="truncate">{f.name}</span>}
                  <span className="text-muted-foreground shrink-0">{f.docKey ? KYC_DOCS[f.docKey].title : "by email"} · {shortDate(f.uploadedAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {live && (
        <div className="flex flex-wrap gap-1 pt-0.5">
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => { navigator.clipboard.writeText(request.link); toast({ title: "Link copied", description: "It's personal to the client: send it only to them." }); }}>
            <Copy className="w-3 h-3 mr-1" />Copy link
          </Button>
          {request.whatsapp && (
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" asChild>
              <a href={request.whatsapp} target="_blank" rel="noreferrer"><MessageCircle className="w-3 h-3 mr-1" />WhatsApp</a>
            </Button>
          )}
          {request.canRemind && (
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={remind.isPending} onClick={() => remind.mutate()}>
              {remind.isPending ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Mail className="w-3 h-3 mr-1" />}Send a reminder
            </Button>
          )}
          {request.status !== "finished" && (
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive" disabled={cancel.isPending}
              onClick={() => { if (window.confirm(`Cancel this request? The link stops working for ${request.recipientName || "the client"}.`)) cancel.mutate(); }}>
              <Trash2 className="w-3 h-3 mr-1" />Cancel
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

// The requests sent for one party on the deal.
export function ClientChecksForParty({ dealId, companyId }: { dealId: string; companyId: string }) {
  const { data } = useClientChecks(dealId);
  const list = (data?.requests || []).filter(r => r.companyId === companyId);
  if (!list.length) return null;
  return <div className="space-y-1.5">{list.map(r => <ClientCheckRow key={r.token} dealId={dealId} request={r} />)}</div>;
}

// "Send client checks" for one party: pick the person, choose what to ask
// for, see the email, send.
export function SendClientChecksButton({ dealId, companyId, partyName, label = "Send client checks", size = "sm", className }: {
  dealId: string; companyId: string; partyName: string; label?: string; size?: "sm" | "default"; className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" size={size} variant="outline" className={className} onClick={() => setOpen(true)} data-testid={`button-client-checks-${companyId}`}>
        <ShieldCheck className="w-3.5 h-3.5 mr-1.5" />{label}
      </Button>
      {open && <SendClientChecksDialog dealId={dealId} companyId={companyId} partyName={partyName} onClose={() => setOpen(false)} />}
    </>
  );
}

const SOMEONE_ELSE = "__other__";

function SendClientChecksDialog({ dealId, companyId, partyName, onClose }: { dealId: string; companyId: string; partyName: string; onClose: () => void }) {
  const { toast } = useToast();
  const { data, isLoading, error } = useClientChecks(dealId);
  const party = data?.parties.find(p => p.companyId === companyId) || null;
  // The request names the company that signs when the deal sets one.
  const shownName = party?.name || partyName;
  const [contactId, setContactId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [mobile, setMobile] = useState<string | null>(null);
  const [kind, setKind] = useState<KycPartyKind | null>(null);
  const [idCheck, setIdCheck] = useState<boolean | null>(null);
  const [docs, setDocs] = useState<KycDocKey[] | null>(null);
  const [note, setNote] = useState("");
  const [preview, setPreview] = useState(false);
  const [sent, setSent] = useState<null | { link: string; from: string | null; cc: string[]; error: string | null; fellBack: boolean; idCheckNote: string | null }>(null);

  // First fill from the party: the deal's own contact, the party's kind,
  // what is usually asked of that kind and role.
  const chosenKind: KycPartyKind = kind || party?.kind || "company";
  const veriff = !!data?.veriff;
  // The online identity check is offered only when it is set up; without
  // it, photo ID is one of the documents (ticked by default).
  const wantId = veriff && (idCheck ?? true);
  const pickedContact = party?.contacts.find(c => c.id === (contactId ?? party?.contactId ?? party?.contacts[0]?.id ?? "")) || null;
  const usingOther = contactId === SOMEONE_ELSE || (!!party && !party.contacts.length);
  const toName = usingOther ? name.trim() : pickedContact?.name || "";
  // What is still to ask once BGP's own checks are counted (Woody,
  // 2026-11-17: "we need to do everyhting we can before we ask questions on
  // someone"): the same rule the server records the request by.
  const asks = party ? precheckAsks(party.askInput, { kind: chosenKind, role: party.role, idCheck: wantId, contactName: toName || null }) : null;
  const chosenDocs = docs || asks?.docs || [];
  const confirmOwners = chosenKind === "company" && !chosenDocs.includes("ownership") && asks?.confirmOwners?.length ? asks.confirmOwners : null;
  const notAsked = (asks?.notAsked || []).filter(n => !chosenDocs.includes(n.key));
  const toEmail = usingOther ? email.trim() : pickedContact?.email || "";
  const mobileValue = mobile ?? (usingOther ? "" : pickedContact?.mobile || "");
  const toMobile = mobileValue.trim();

  const toggleDoc = (key: KycDocKey) => setDocs(current => {
    const list = current || chosenDocs;
    return list.includes(key) ? list.filter(k => k !== key) : [...list, key];
  });
  const offeredDocs: KycDocKey[] = chosenKind === "company"
    ? ["ownership", "owner_ids", "authority", "source_of_funds", "company_documents", "proof_of_address", "photo_id", "other"]
    : ["proof_of_address", "source_of_funds", "photo_id", "other"];

  const previewHtml = useMemo(() => {
    if (!preview || !party) return "";
    const { html } = kycRequestEmail({
      recipientName: toName || "Jane Smith", partyName: party.name, kind: chosenKind, dealName: data?.dealName || "this deal", ref: "SAMPLE",
      link: "https://chatbgp.app/kyc-upload/your-link", expiresAt: new Date(Date.now() + 14 * 86400000),
      needsIdCheck: wantId, docs: chosenDocs,
      note, agents: (data?.agents || []).map(a => ({ name: a.name, email: a.email, phone: null })), sentFrom: data?.mailbox || "kyc@chatbgp.app", askPep: true,
      confirmOwners, ownerNames: chosenDocs.includes("owner_ids") ? asks?.ownerNames || [] : [],
    });
    return html.split(`cid:${KYC_LOGO_CID}`).join("/bgp-logo.png");
  }, [preview, party, toName, chosenKind, veriff, wantId, chosenDocs, confirmOwners, asks, note, data]);

  const send = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/aml/deal/${dealId}/client-checks`, {
        companyId, contactId: usingOther ? null : pickedContact?.id || null, name: toName, email: toEmail,
        mobile: toMobile || null, kind: chosenKind, needsIdCheck: wantId, docs: chosenDocs, note: note.trim() || null,
      });
      return res.json();
    },
    onSuccess: (r: any) => {
      queryClient.invalidateQueries({ queryKey: keyFor(dealId) });
      setSent({ link: r.link, from: r.sent?.from || null, cc: r.cc || [], error: r.sent?.ok ? null : r.sent?.error || "The email was not sent", fellBack: !!r.sent?.fellBack, idCheckNote: r.idCheckNote || null });
    },
    onError: (e) => toast({ title: "Not sent", description: plain(e), variant: "destructive" }),
  });

  const canSend = !!party && !!toName && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toEmail) && (wantId || chosenDocs.length > 0) && !send.isPending;
  const copied = (data?.agents || []).map(a => a.name);

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto" data-testid="client-checks-dialog">
        <DialogHeader>
          <DialogTitle>{sent ? (sent.error ? "Not sent" : "Sent") : `Send client checks to ${shownName}`}</DialogTitle>
          {!sent && <DialogDescription>One email asking for an identity check and the documents you choose, with a link to a page of their own.</DialogDescription>}
        </DialogHeader>

        {isLoading && <div className="flex items-center gap-2 text-sm text-muted-foreground py-6"><Loader2 className="w-4 h-4 animate-spin" />Loading…</div>}
        {error && <p className="text-sm text-red-700">{plain(error)}</p>}

        {sent ? (
          <div className="space-y-3 text-sm" data-testid="client-checks-sent">
            {sent.error ? (
              <p className="flex items-start gap-2 text-red-700"><AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />The email didn't go: {sent.error}. The request is saved: copy the link below and send it yourself, or try again later.</p>
            ) : (
              <p className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 mt-0.5 text-emerald-600 shrink-0" />
                <span>Sent to <strong>{toName}</strong> ({toEmail}) from <strong>{sent.from}</strong>{sent.cc.length ? <>, copied to {sent.cc.join(", ")}</> : null}.{sent.fellBack ? " Microsoft wouldn't send from the KYC mailbox, so it went from the shared one." : ""}</span>
              </p>
            )}
            {sent.idCheckNote && <p className="text-muted-foreground">{sent.idCheckNote}</p>}
            <p className="text-muted-foreground">They get a reminder after three days and again after seven if anything is still missing. You'll get an email when they press Finish. Progress shows on the deal's AML card.</p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(sent.link); toast({ title: "Link copied", description: "It's personal to the client: send it only to them." }); }}><Copy className="w-3.5 h-3.5 mr-1.5" />Copy their link</Button>
              {toMobile && (
                <Button size="sm" variant="outline" asChild>
                  <a href={kycWhatsAppHref(toMobile, kycWhatsAppText({ recipientName: toName, dealName: data?.dealName || "the deal", link: sent.link, expiresAt: new Date(Date.now() + 14 * 86400000) }))} target="_blank" rel="noreferrer"><MessageCircle className="w-3.5 h-3.5 mr-1.5" />Send on WhatsApp</a>
                </Button>
              )}
            </div>
          </div>
        ) : party ? (
          <div className="space-y-4">
            <div className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900 space-y-1 dark:bg-sky-950/20 dark:text-sky-200" data-testid="client-checks-timing">
              {KYC_TIMING[party.role] && <p>{KYC_TIMING[party.role]}</p>}
              <p>{KYC_LETTING_SCOPE}</p>
            </div>
            <div className="space-y-1.5">
              <Label>Who should we ask?</Label>
              {party.contacts.length > 0 && (
                <Select value={contactId ?? party.contactId ?? party.contacts[0].id} onValueChange={v => { setContactId(v); setMobile(null); }}>
                  <SelectTrigger data-testid="select-client-check-contact"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {party.contacts.map(c => <SelectItem key={c.id} value={c.id}>{c.name} · {c.email}</SelectItem>)}
                    <SelectItem value={SOMEONE_ELSE}>Someone else…</SelectItem>
                  </SelectContent>
                </Select>
              )}
              {usingOther && (
                <>
                  <div className="grid sm:grid-cols-2 gap-2">
                    <Input placeholder="Their name" value={name} onChange={e => setName(e.target.value)} data-testid="input-client-check-name" />
                    <Input type="email" placeholder="Their email" value={email} onChange={e => setEmail(e.target.value)} data-testid="input-client-check-email" />
                  </div>
                  <p className="text-[11px] text-muted-foreground" data-testid="client-checks-saved-to-crm">Saved to the CRM under {party.brandName || party.name}, and made the person to ask on this deal if nobody is set.</p>
                </>
              )}
              <Input placeholder="Their mobile (optional, so you can send the link on WhatsApp)" value={mobileValue} onChange={e => setMobile(e.target.value)} />
            </div>

            <div className="space-y-1.5">
              <Label>{shownName} is</Label>
              {party.entityId && <p className="text-[11px] text-muted-foreground">The company that signs for {party.brandName}{party.entityNumber ? ` (Companies House ${party.entityNumber})` : ""}.</p>}
              <div className="flex gap-2">
                {(["company", "individual"] as const).map(k => (
                  <Button key={k} type="button" size="sm" variant={chosenKind === k ? "default" : "outline"} onClick={() => { setKind(k); setDocs(null); }}>
                    {k === "company" ? "A company" : "A private individual"}
                  </Button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label>What to ask for</Label>
              {veriff ? (
                <label className="flex items-start gap-2 text-sm cursor-pointer">
                  <input type="checkbox" className="mt-0.5 h-4 w-4" checked={wantId} onChange={e => { setIdCheck(e.target.checked); setDocs(null); }} />
                  <span><strong>Identity check online</strong><span className="block text-xs text-muted-foreground">With Veriff: a photo of their passport or licence and a short selfie, about two minutes on their phone.</span></span>
                </label>
              ) : (
                <p className="text-xs text-muted-foreground" data-testid="client-checks-no-veriff">The online identity check isn't set up yet, so photo ID is one of the documents below.</p>
              )}
              {offeredDocs.map(key => (
                <label key={key} className="flex items-start gap-2 text-sm cursor-pointer">
                  <input type="checkbox" className="mt-0.5 h-4 w-4" checked={chosenDocs.includes(key)} onChange={() => toggleDoc(key)} />
                  <span><strong>{KYC_DOCS[key].title}</strong><span className="block text-xs text-muted-foreground">{KYC_DOCS[key].detail}</span></span>
                </label>
              ))}
            </div>

            {(confirmOwners || notAsked.length > 0) && (
              <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs space-y-1" data-testid="client-checks-not-asked">
                <p className="font-semibold">Already found by BGP's checks{party.precheckRanAt ? ` (${precheckDay(party.precheckRanAt)})` : ""}, so not asked:</p>
                {notAsked.map(n => <p key={n.key}><strong>{KYC_DOCS[n.key].title}</strong>: {n.reason}</p>)}
                {confirmOwners && <p data-testid="client-checks-confirm-owners">They are asked to confirm the owners Companies House lists: {confirmOwners.map(o => `${o.name} (${o.detail})`).join("; ")}.</p>}
                <p className="text-muted-foreground">Tick anything above to ask for it after all.</p>
              </div>
            )}
            {!party.askInput && (
              <p className="text-xs text-muted-foreground" data-testid="client-checks-no-precheck">BGP's checks before asking have not finished for {shownName} yet, so everything usual is ticked. They show on the deal's AML card when done.</p>
            )}

            <p className="text-xs text-muted-foreground">Every request also asks {KYC_PEP_QUESTION.title.toLowerCase()} (politically exposed persons). A yes comes back to you and the MLRO.</p>

            <div className="space-y-1.5">
              <Label>A note from you (optional)</Label>
              <Textarea rows={2} value={note} onChange={e => setNote(e.target.value)} placeholder="Shown in the email and on their page" />
            </div>

            <div className="rounded-md bg-muted/60 p-3 text-xs space-y-0.5" data-testid="client-checks-summary">
              <div><span className="text-muted-foreground">From:</span> {data?.mailbox}</div>
              <div><span className="text-muted-foreground">To:</span> {toName ? `${toName} ` : ""}{toEmail ? `<${toEmail}>` : "choose someone above"}</div>
              <div><span className="text-muted-foreground">Copied:</span> {copied.length ? `${copied.join(", ")} (the deal's agents) and you` : "you (the deal has no agents set)"}</div>
            </div>

            <Button type="button" variant="ghost" size="sm" className="px-0 h-auto text-xs" onClick={() => setPreview(v => !v)}>
              <Eye className="w-3.5 h-3.5 mr-1" />{preview ? "Hide the email" : "See the email"}
            </Button>
            {preview && <iframe title="Email preview" srcDoc={previewHtml} className="w-full h-[480px] rounded border bg-white" sandbox="" data-testid="client-checks-preview" />}
          </div>
        ) : !isLoading && !error ? (
          <p className="text-sm text-muted-foreground">{shownName} isn't a party on this deal yet. Set it on the deal first.</p>
        ) : null}

        <DialogFooter>
          {sent ? (
            <Button onClick={onClose}>Done</Button>
          ) : (
            <>
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button onClick={() => send.mutate()} disabled={!canSend} data-testid="button-send-client-checks">
                {send.isPending ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Send className="w-4 h-4 mr-1.5" />}Send
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
