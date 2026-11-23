// Client checks on a deal: send a party's contact one email asking for an
// identity check and documents, and follow what they have done. The server
// is server/aml-portal.ts; the email's words, which the preview here draws
// with the same function the server sends, are in shared/kyc-request.ts.
// Shown while the client checks are on (clientChecks on the deal's KYC
// status: their own switch since 18 November 2026, not in-app AML's);
// otherwise KYC4U does the checks.
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useAmlInHouse } from "@/components/aml-policy-panel";
import { CheckCircle2, ChevronDown, Clock, Copy, Eye, Globe, Link2, Loader2, Mail, MessageCircle, Send, ShieldCheck, Trash2, AlertCircle, FileCheck, FileText, UserPlus } from "lucide-react";
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
import { PARTY_PEOPLE_BASIS_WORDS, PUBLIC_FIGURE_MAX_LINKS, PUBLIC_FIGURE_NOTE_MIN, personRequestAsks, personVerifiedWords, type KycPartyPerson, type PartyPeople, type PersonIdState, type PersonSanctions } from "@shared/kyc-people";
import type { KycPersonRole } from "@shared/kyc-request";

interface PartyContact { id: string; name: string; email: string | null; mobile: string | null }
interface Party {
  // name: the company that signs when the deal names one, else the brand.
  companyId: string; name: string; brandName?: string; entityId?: string | null; entityNumber?: string | null;
  role: string; kind: KycPartyKind; contactId: string | null; contacts: PartyContact[]; defaultDocs: KycDocKey[];
  // What BGP's checks before asking found, for "ask only what is left".
  askInput: PrecheckAskInput | null; precheckRanAt: string | null;
  // A trust (23 November 2026): its documents held and its trustees recorded.
  trust?: boolean; trustAsk?: { deed: boolean; trs: boolean; trsNotRequired: boolean; trustees: string[] } | null;
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
  // A person's own request (19 November 2026): who it is for.
  person?: { key: string; name: string; roles: KycPersonRole[] } | null;
  ownLinksFor?: string[];
  // note: why a step is not ticked (the old owners' step's files say nobody's name).
  docs: Array<{ key: KycDocKey; title: string; done: boolean; note?: string | null }>;
  files: Array<{ name: string; docKey: KycDocKey | null; uploadedAt: string; url: string | null; documentId?: string | null }>;
  remindersSent: number; link: string; whatsapp: string | null; canRemind: boolean;
}
export interface ClientChecks {
  dealName: string; mailbox: string; veriff: boolean; agents: Array<{ name: string; email: string }>; parties: Party[]; requests: ClientCheckRequest[];
  // The people to check per party (null when they could not be read).
  people?: Record<string, PartyPeople | null>;
}

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
// It opens on one line (20 November 2026, Woody: "minimise each section with
// the detail to pop out"): where it stands, how many steps are done, and any
// warning; the rest on press. startOpen: a person's own link, opened from
// their row, shows its detail at once.
export function ClientCheckRow({ dealId, request, startOpen }: { dealId: string; request: ClientCheckRequest; startOpen?: boolean }) {
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(!!startOpen);
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
  const idDone = request.needsIdCheck && !request.idOtherPerson && (request.idState === "approved" || request.idState === "submitted");
  const steps = request.docs.length + (request.needsIdCheck ? 1 : 0);
  const stepsDone = request.docs.filter(d => d.done).length + (idDone ? 1 : 0);
  const warning = request.idOtherPerson ? `the identity check was ${request.idVerifiedName || "someone else"}'s`
    : request.pep === "yes" || request.pep === "unsure" ? `public roles: ${kycPepWords(request.pep).toLowerCase()}`
    : request.owners?.answer === "no" ? "says the register's owners are wrong"
    : request.docs.some(d => d.note) ? "a document to check"
    : !request.sentAt ? "the email did not go" : null;
  return (
    <div className="rounded-md border bg-background p-2.5 text-xs space-y-1.5" data-testid={`client-check-${request.ref}`}>
      <button type="button" className="flex w-full flex-wrap items-center gap-1.5 text-left" aria-expanded={expanded} onClick={() => setExpanded(v => !v)} data-testid={`client-check-toggle-${request.ref}`}>
        <span className={`${pillMetrics} ${status.cls}`}>{status.label}</span>
        <span className="font-medium text-sm">{request.recipientName || request.recipientEmail}</span>
        <span className="text-muted-foreground">
          {request.sentAt ? `sent ${shortDate(request.sentAt)}` : "not sent"}{steps ? ` · ${stepsDone} of ${steps} done` : ""}
        </span>
        {warning && <span className="inline-flex items-center gap-0.5 text-amber-800 dark:text-amber-300"><AlertCircle className="w-3.5 h-3.5 text-amber-600" />{warning}</span>}
        <ChevronDown className={`ml-auto w-3.5 h-3.5 shrink-0 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`} />
      </button>
      {expanded && <>
      <div className="text-muted-foreground truncate">{request.recipientEmail}</div>
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
          <li key={d.key} className={`flex items-center gap-1 ${d.note ? "text-amber-800" : ""}`} title={d.note || undefined} data-testid={`client-check-doc-${request.ref}-${d.key}`}>
            {d.done ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> : d.note ? <AlertCircle className="w-3.5 h-3.5 text-amber-600" /> : <Clock className="w-3.5 h-3.5 text-muted-foreground" />}{d.title}
          </li>
        ))}
      </ul>
      {request.askPep && (
        <p className={request.pep === "yes" || request.pep === "unsure" ? "rounded border border-amber-300 bg-amber-50 px-2 py-1 text-amber-900" : "text-muted-foreground"} data-testid={`client-check-pep-${request.ref}`}>
          Public roles: <strong>{kycPepWords(request.pep)}</strong>{request.pepDetail ? ` · ${request.pepDetail}` : ""}
          {(request.pep === "yes" || request.pep === "unsure") && <> · Enhanced due diligence: senior management approval (a director or the MLRO) before the transaction goes ahead, source of wealth and of funds, closer monitoring. Lighter for a UK one with no other risk.</>}
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
          {request.recipientName || "The person it was for"} has not done their own identity check: the one on this link was {request.idVerifiedName || "someone else"}'s. Send them a new request, or record on the transaction why {request.idVerifiedName || "that person"} can act for {request.partyName}.
        </p>
      )}
      {request.docs.filter(d => d.note).map(d => <p key={`note-${d.key}`} className="rounded border border-amber-300 bg-amber-50 px-2 py-1 text-amber-900">{d.title}: {d.note}</p>)}
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
      </>}
    </div>
  );
}

// The requests sent for one party on the deal: the people to check, each
// with their own link, then the requests to the person acting.
// sanctionsOnly: a letting under £10,000 a month (BGP's AML policy A), where
// the owners are identified and screened, not verified. notRequired: the
// officers marked the party Not required on this deal (policy G).
// part: the AML box draws the people and the requests in sections of their
// own (20 November 2026); with none, both.
export function ClientChecksForParty({ dealId, companyId, sanctionsOnly, notRequired, canDecide, part }: { dealId: string; companyId: string; sanctionsOnly?: boolean; notRequired?: boolean; canDecide?: boolean; part?: "people" | "requests" }) {
  const { data } = useClientChecks(dealId);
  if (!data) return null;
  const list = data.requests.filter(r => r.companyId === companyId && !r.person);
  const party = data.parties.find(p => p.companyId === companyId) || null;
  const people = data.people?.[companyId] || null;
  return (
    <>
      {part !== "requests" && <>{party && people && !notRequired && <PeopleToCheck dealId={dealId} data={data} party={party} people={people} sanctionsOnly={!!sanctionsOnly} canDecide={!!canDecide} />}</>}
      {part !== "people" && list.length > 0 && <div className="space-y-1.5">{list.map(r => <ClientCheckRow key={r.token} dealId={dealId} request={r} />)}</div>}
    </>
  );
}

// ── The people to check (Woody, 19 November 2026) ──────────────────────────
// "a list of people to check for each party: the owners and the person
// acting, each with their own Veriff link and a proof-of-address upload; the
// directors shown with their sanctions result only".

const ROLE_WORDS: Record<KycPersonRole, string> = {
  owner: "Owner", acting: "Dealing with us", director: "Director", joint: "Alongside them",
  settlor: "Settlor", trustee: "Trustee", protector: "Protector", beneficiary: "Beneficiary", controller: "Other control",
};

const ID_STATE_WORDS: Record<PersonIdState, string> = {
  passed: "Identity check passed",
  waiting: "Identity check done, waiting for Veriff's result",
  document: "Photo ID sent, for the MLRO to check",
  started: "Identity check started",
  retry: "Identity check: asked to try again",
  restart: "Identity check needs starting again",
  not_started: "Identity check not done",
};

const SANCTIONS_WORDS: Record<PersonSanctions, { text: string; cls: string }> = {
  clear: { text: "Sanctions: no match", cls: "text-muted-foreground" },
  discounted: { text: "Sanctions: a namesake, set aside on the date of birth", cls: "text-muted-foreground" },
  possible: { text: "Sanctions: possible match", cls: "text-red-700 font-medium" },
  not_screened: { text: "Sanctions: not screened yet", cls: "text-muted-foreground" },
};

function Tick({ ok }: { ok: boolean }) {
  return ok ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" /> : <Clock className="w-3.5 h-3.5 text-muted-foreground shrink-0" />;
}

function PeopleToCheck({ dealId, data, party, people, sanctionsOnly, canDecide }: { dealId: string; data: ClientChecks; party: Party; people: PartyPeople; sanctionsOnly: boolean; canDecide: boolean }) {
  const inHouse = useAmlInHouse();
  if (sanctionsOnly) {
    const everyone = [...people.people.map(p => ({ name: p.name, roles: p.roles.map(r => ROLE_WORDS[r].toLowerCase()), sanctions: p.sanctions })), ...people.directors.map(d => ({ name: d.name, roles: ["director"], sanctions: d.sanctions })),
      ...(people.trustees || []).map(t => ({ name: t.name, roles: [t.chair ? "trustee, chair" : "trustee"], sanctions: t.sanctions })),
      ...(people.trustNamed || []).map(t => ({ name: t.name, roles: [t.roles], sanctions: t.sanctions }))];
    if (!everyone.length) return null;
    return (
      <div className="text-xs space-y-1.5" data-testid={`people-to-check-${party.companyId}`}>
        <p className="text-muted-foreground" data-testid={`people-sanctions-only-${party.companyId}`}>A letting under £10,000 a month: sanctions checks only (BGP's AML policy A). The owners and directors are identified and screened, not verified, so no one needs to send an identity check or a proof of address.</p>
        <ul className="space-y-0.5">
          {everyone.map(p => (
            <li key={p.name}>{p.name} <span className="text-muted-foreground">({p.roles.join(", ")})</span> <span className={SANCTIONS_WORDS[p.sanctions].cls}>{SANCTIONS_WORDS[p.sanctions].text}</span></li>
          ))}
        </ul>
      </div>
    );
  }
  return (
    <div className="text-xs space-y-1.5" data-testid={`people-to-check-${party.companyId}`}>
      {people.people.map(person => <PersonRow key={person.key} dealId={dealId} data={data} party={party} person={person} canDecide={canDecide} />)}
      {people.basis === "individual" && <AddPersonButton dealId={dealId} data={data} party={party} />}
      {people.directors.length > 0 && (
        <p className="text-muted-foreground" data-testid={`people-directors-${party.companyId}`}>
          <span className="font-medium text-foreground">Directors, no ID needed</span> (screened against the UK, US and EU sanctions lists only):{" "}
          {people.directors.map((d, i) => (
            <span key={d.name}>{i ? "; " : ""}{d.name} <span className={SANCTIONS_WORDS[d.sanctions].cls}>({SANCTIONS_WORDS[d.sanctions].text.replace("Sanctions: ", "")})</span></span>
          ))}.
        </p>
      )}
      {!!people.trustees?.length && (
        <p className="text-muted-foreground" data-testid={`people-trustees-${party.companyId}`}>
          <span className="font-medium text-foreground">Trustees of {people.charity?.name || "the charity"}{people.charity?.number ? ` (charity ${people.charity.number})` : ""}</span>, from the Charity Commission's register, screened for sanctions, public roles and adverse media, no ID asked for:{" "}
          {people.trustees.map((t, i) => (
            <span key={t.name}>{i ? "; " : ""}{t.name}{t.chair ? " (chair)" : ""} <span className={SANCTIONS_WORDS[t.sanctions].cls}>({SANCTIONS_WORDS[t.sanctions].text.replace("Sanctions: ", "")})</span></span>
          ))}.
        </p>
      )}
      {!!people.trustNamed?.length && (
        <p className="text-muted-foreground" data-testid={`people-trust-named-${party.companyId}`}>
          <span className="font-medium text-foreground">Also on the trust, no ID needed</span> (screened only):{" "}
          {people.trustNamed.map((t, i) => (
            <span key={t.name}>{i ? "; " : ""}{t.name}, {t.roles} <span className={SANCTIONS_WORDS[t.sanctions].cls}>({SANCTIONS_WORDS[t.sanctions].text.replace("Sanctions: ", "")})</span></span>
          ))}.
        </p>
      )}
      {people.loose.map(l => (
        <p key={l.ref} className="rounded border border-amber-300 bg-amber-50 px-2 py-1 text-amber-900" data-testid={`people-loose-${l.ref}`}>
          {l.files} file{l.files === 1 ? " was" : "s were"} sent on {l.ref} as "ID for each of those owners"{l.names.length ? ` (${l.names.join(", ")})` : ""}: they don't say whose they are, so they count for nobody above. Open them on that request under Client checks.
        </p>
      ))}
      {!!people.ownersAbroad?.length && (
        <p className="rounded border border-amber-300 bg-amber-50 px-2 py-1 text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200" data-testid="people-owners-abroad">
          Owned through {people.ownersAbroad.map(o => `${o.name} (${o.country})`).join(" and ")}: registered abroad, so Companies House cannot show the people behind {people.ownersAbroad.length === 1 ? "it" : "them"}.{" "}
          {people.ownersAbroad.every(o => o.answered)
            ? <>The people recorded behind {people.ownersAbroad.length === 1 ? "it" : "them"} (under Owners abroad) are listed here, each with their own checks.{inHouse ? "" : " It still goes to KYC4U (Request KYC4U check)."}</>
            : <>{inHouse ? "Find them under Owners abroad, or from a structure chart the client sends; each person found gets their own link." : "It goes to KYC4U to find them (Request KYC4U check). The app traces what it can under Owners abroad; if the client sends a structure chart naming them, each can be sent their own link."}</>}
        </p>
      )}
      <p className="text-[11px] text-muted-foreground">{PARTY_PEOPLE_BASIS_WORDS[people.basis]} Each gets a link of their own: an identity check (Veriff) and a proof of address from the last three months.</p>
    </div>
  );
}

function PersonRow({ dealId, data, party, person, canDecide }: { dealId: string; data: ClientChecks; party: Party; person: KycPartyPerson; canDecide: boolean }) {
  const [open, setOpen] = useState(false);
  const [details, setDetails] = useState(false);
  const [sending, setSending] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [verifying, setVerifying] = useState<false | "public" | "certified">(false);
  const ownRequest = person.own && !person.own.isMain ? data.requests.find(r => r.token === person.own!.token) || null : null;
  // Verified from public sources by the officers (21 November 2026): counts for the identity check and the proof of address.
  const pf = person.publicFigure || null;
  // Covered by another firm's checks that the officers rely on (MLR 2017 reg 39; 21 November 2026).
  const relied = !pf && person.reliedOn ? person.reliedOn : null;
  const idOk = !!pf || !!relied || person.id.state === "passed" || person.id.state === "waiting" || person.id.state === "document";
  const testKey = person.key.replace(/\s+/g, "-");
  const proofToCheck = !pf && !relied && !!person.address.proof && !person.address.done;
  return (
    <div className="rounded border px-2 py-1.5 space-y-1" data-testid={`person-${testKey}`}>
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
        <button type="button" className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-left" aria-expanded={details} onClick={() => setDetails(v => !v)} data-testid={`person-toggle-${testKey}`}>
          <span className="font-medium text-sm">{person.name}</span>
          {person.roles.map(r => <span key={r} className={`${pillMetrics} bg-muted text-muted-foreground border border-border`}>{ROLE_WORDS[r]}</span>)}
          <span className="inline-flex items-center gap-0.5 text-muted-foreground"><Tick ok={idOk} />ID</span>
          <span className={`inline-flex items-center gap-0.5 ${proofToCheck ? "text-amber-800 dark:text-amber-300" : "text-muted-foreground"}`}>
            {proofToCheck ? <AlertCircle className="w-3.5 h-3.5 text-amber-600 shrink-0" /> : <Tick ok={!!pf || !!relied || person.address.done} />}{proofToCheck ? "Address to check" : "Address"}
          </span>
          {pf && <span className={`${pillMetrics} bg-emerald-50 text-emerald-800 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900`} data-testid={`person-public-figure-${testKey}`}>{pf.method === "certified" ? "Certified documents" : "Public figure"}</span>}
          {relied && <span className={`${pillMetrics} bg-violet-50 text-violet-800 border border-violet-200 dark:bg-violet-950/40 dark:text-violet-200 dark:border-violet-900`} data-testid={`person-relied-${testKey}`}>Covered by reliance</span>}
          {person.sanctions === "possible" && <span className={SANCTIONS_WORDS.possible.cls}>{SANCTIONS_WORDS.possible.text}</span>}
          <ChevronDown className={`ml-auto w-3.5 h-3.5 shrink-0 text-muted-foreground transition-transform ${details ? "rotate-180" : ""}`} />
        </button>
        {canDecide && !pf && person.outstanding.length > 0 && (
          <>
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setVerifying("certified")} data-testid={`person-verify-certified-${testKey}`}>
            <FileCheck className="w-3 h-3 mr-1" />Certified documents
          </Button>
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setVerifying("public")} data-testid={`person-verify-public-${testKey}`}>
            <Globe className="w-3 h-3 mr-1" />Verified from public sources
          </Button>
          </>
        )}
        {(person.canSend || (ownRequest && !ownRequest.sentAt && ownRequest.status !== "finished")) && (
          <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => setSending(true)} data-testid={`person-send-${testKey}`}>
            <Send className="w-3 h-3 mr-1" />{person.canSend ? "Send them a link" : "Email their link"}
          </Button>
        )}
      </div>
      {details && <>
      {person.born && <p className="text-muted-foreground">Born {person.born}</p>}
      {person.ownerDetail && <p className="text-muted-foreground">{person.ownerDetail[0].toUpperCase() + person.ownerDetail.slice(1)}</p>}
      {pf && <PublicFigureLine dealId={dealId} role={party.role} person={person} canDecide={canDecide} />}
      <ul className="space-y-0.5">
        <li className="flex items-start gap-1" data-testid={`person-id-${person.key.replace(/\s+/g, "-")}`}>
          <Tick ok={idOk} />
          {pf ? <span>Identity: {personVerifiedWords(pf)} (above)</span> : relied ? <span>Identity: {relied.replace(/^Relying on/, "covered by")}</span> : (
          <span>
            {ID_STATE_WORDS[person.id.state]}
            {person.id.elsewhere ? <span className="text-muted-foreground"> {person.id.elsewhere}</span> : null}
            {!idOk && person.id.someoneElse ? <span className="text-amber-800"> (the check on their link was {person.id.someoneElse}'s)</span> : null}
            {!idOk && person.id.asked ? <span className="text-muted-foreground"> · asked</span> : null}
          </span>
          )}
        </li>
        {pf
          ? <li className="flex items-start gap-1" data-testid={`person-address-public-${testKey}`}><Tick ok /><span>Proof of address: covered by the {pf.method === "certified" ? "certified documents" : "verification from public sources"}</span></li>
          : relied ? <li className="flex items-start gap-1" data-testid={`person-address-relied-${testKey}`}><Tick ok /><span>Proof of address: covered by the reliance on the firm's checks</span></li>
          : <AddressProofLine dealId={dealId} person={person} canDecide={canDecide} />}
        <li className={SANCTIONS_WORDS[person.sanctions].cls}>{SANCTIONS_WORDS[person.sanctions].text}</li>
      </ul>
      <div className="flex flex-wrap items-center gap-1">
        {ownRequest && (
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setOpen(v => !v)} data-testid={`person-link-toggle-${person.own!.ref}`}>
            <ChevronDown className={`w-3 h-3 mr-1 transition-transform ${open ? "rotate-180" : ""}`} />
            Their link ({person.own!.ref}){ownRequest.sentAt ? ` · emailed ${shortDate(ownRequest.sentAt)}` : " · not emailed"}
          </Button>
        )}
        {person.own?.isMain && <span className="text-muted-foreground">On the request to them ({person.own.ref}), under Client checks.</span>}
        {person.own && !person.roles.includes("owner") && !person.roles.includes("director") && (
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setRenaming(true)} data-testid={`person-rename-${testKey}`}>Change name</Button>
        )}
      </div>
      {renaming && person.own && <RenamePerson dealId={dealId} token={person.own.token} current={person.name} suggested={person.id.someoneElse} onDone={() => setRenaming(false)} />}
      {open && ownRequest && <ClientCheckRow dealId={dealId} request={ownRequest} startOpen />}
      </>}
      {sending && <PersonLinkDialog dealId={dealId} data={data} party={party} person={person} onClose={() => setSending(false)} />}
      {verifying === "public" && <PublicFigureDialog dealId={dealId} role={party.role} person={person} onClose={() => setVerifying(false)} />}
      {verifying === "certified" && <CertifiedDocsDialog dealId={dealId} role={party.role} person={person} held={data.requests.filter(r => r.companyId === party.companyId).flatMap(r => r.files).filter(f => f.docKey === "certified_ids" && f.documentId)} onClose={() => setVerifying(false)} />}
    </div>
  );
}

const refreshPeople = (dealId: string) => {
  queryClient.invalidateQueries({ queryKey: keyFor(dealId) });
  queryClient.invalidateQueries({ queryKey: ["/api/kyc/deal", dealId, "status"] });
  queryClient.invalidateQueries({ queryKey: ["/api/aml-dashboard"] });
};

// Verified from public sources (Woody, 21 November 2026: KYC4U's "Public
// figure" method). The Nominated Officer or a Deputy says what makes them a
// public figure and gives the pages (copied to PDF on the KYC record) or
// files; it counts for their identity check and proof of address.
function PublicFigureDialog({ dealId, role, person, onClose }: { dealId: string; role: string; person: KycPartyPerson; onClose: () => void }) {
  const { toast } = useToast();
  const [note, setNote] = useState("");
  const [links, setLinks] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const linkList = links.split(/[\s,]+/).map(l => l.trim()).filter(Boolean);
  const badLink = linkList.find(l => !/^https?:\/\/\S+\.\S+/i.test(l));
  const missing = note.trim().length < PUBLIC_FIGURE_NOTE_MIN ? "Say what makes them a public figure (at least a sentence)."
    : badLink ? `Not a web address: ${badLink}`
    : linkList.length > PUBLIC_FIGURE_MAX_LINKS ? `Give up to ${PUBLIC_FIGURE_MAX_LINKS} links.`
    : !linkList.length && !files.length ? "Give the pages or files that show who they are."
    : null;
  const save = useMutation({
    mutationFn: async () => {
      const fd = new FormData();
      fd.append("key", person.key);
      fd.append("note", note.trim());
      fd.append("links", linkList.join("\n"));
      for (const f of files) fd.append("files", f);
      const res = await fetch(`/api/deals/${dealId}/parties/${role}/public-figure`, { method: "POST", body: fd, credentials: "include", headers: getAuthHeaders() });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.message || "It could not be recorded.");
      return body;
    },
    onSuccess: (r: any) => {
      refreshPeople(dealId);
      toast({ title: `${person.name}: verified from public sources`, description: r?.copying ? `A PDF copy of ${r.copying === 1 ? "the page" : `each of the ${r.copying} pages`} is being saved to the KYC record.` : undefined });
      onClose();
    },
    onError: (e: any) => toast({ title: "Not recorded", description: String(e?.message || e), variant: "destructive" }),
  });
  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md" data-testid="public-figure-dialog">
        <DialogHeader>
          <DialogTitle>{person.name}: verified from public sources</DialogTitle>
          <DialogDescription>
            A well-known person whose identity public sources establish. It counts for their ID and address.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="public-figure-note">What makes them a public figure, and what the sources show</Label>
            <Textarea id="public-figure-note" value={note} onChange={e => setNote(e.target.value)} rows={3} maxLength={1000}
              placeholder="For example: owner of the group, named with his photograph in its annual report, Forbes and Wikipedia" data-testid="public-figure-note" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="public-figure-links">Links (one per line, up to {PUBLIC_FIGURE_MAX_LINKS})</Label>
            <Textarea id="public-figure-links" value={links} onChange={e => setLinks(e.target.value)} rows={3} placeholder="https://…" data-testid="public-figure-links" />
            <p className="text-[11px] text-muted-foreground">A PDF copy of each page is saved to the party's KYC record, with when it was taken.</p>
          </div>
          <div className="space-y-1.5">
            <Label className="block">Files (optional)</Label>
            <input type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.heic,.doc,.docx" onChange={e => setFiles(Array.from(e.target.files || []).slice(0, 10))} data-testid="public-figure-files" className="text-xs" />
          </div>
          {missing && <p className="text-[11px] text-muted-foreground">{missing}</p>}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="button" disabled={!!missing || save.isPending} onClick={() => save.mutate()} data-testid="public-figure-save">
            {save.isPending && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}Record it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Certified copies in place of the online check (Jack, 23 November 2026): the
// Nominated Officer or a Deputy ticks the person's certified ID and proof of
// address (sent on the client's page, or added here) and says who certified
// them. It counts for their identity check and proof of address.
function CertifiedDocsDialog({ dealId, role, person, held, onClose }: {
  dealId: string; role: string; person: KycPartyPerson; held: Array<{ name: string; url: string | null; documentId?: string | null }>; onClose: () => void;
}) {
  const { toast } = useToast();
  const [note, setNote] = useState("");
  const [ticked, setTicked] = useState<string[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const missing = !ticked.length && !files.length ? "Tick their certified documents, or add them."
    : note.trim().length < PUBLIC_FIGURE_NOTE_MIN ? "Say which documents you checked and who certified them."
    : null;
  const save = useMutation({
    mutationFn: async () => {
      const fd = new FormData();
      fd.append("key", person.key);
      fd.append("method", "certified");
      fd.append("note", note.trim());
      fd.append("documentIds", ticked.join(","));
      for (const f of files) fd.append("files", f);
      const res = await fetch(`/api/deals/${dealId}/parties/${role}/public-figure`, { method: "POST", body: fd, credentials: "include", headers: getAuthHeaders() });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.message || "It could not be recorded.");
      return body;
    },
    onSuccess: () => { refreshPeople(dealId); toast({ title: `${person.name}: verified from certified documents` }); onClose(); },
    onError: (e: any) => toast({ title: "Not recorded", description: String(e?.message || e), variant: "destructive" }),
  });
  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md" data-testid="certified-docs-dialog">
        <DialogHeader>
          <DialogTitle>{person.name}: certified documents</DialogTitle>
          <DialogDescription>
            One List A document certified by a solicitor (passport, photocard driving licence or Home Office residence permit) and one List B (a utility or council tax bill under 3 months old). It counts for their ID and address.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {held.length > 0 && (
            <div className="space-y-1.5">
              <Label className="block">Certified documents sent to us: tick this person's</Label>
              <ul className="space-y-1">
                {held.map(f => (
                  <li key={f.documentId!} className="flex items-center gap-2 text-xs">
                    <input type="checkbox" checked={ticked.includes(f.documentId!)} onChange={e => setTicked(t => e.target.checked ? [...t, f.documentId!] : t.filter(x => x !== f.documentId))} data-testid={`certified-doc-${f.documentId}`} />
                    {f.url ? <a href={f.url} target="_blank" rel="noreferrer" className="underline truncate">{f.name}</a> : <span className="truncate">{f.name}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="space-y-1.5">
            <Label className="block">{held.length ? "Or add files" : "Their certified documents"}</Label>
            <input type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.heic,.doc,.docx" onChange={e => setFiles(Array.from(e.target.files || []).slice(0, 10))} data-testid="certified-docs-files" className="text-xs" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="certified-docs-note">What you checked</Label>
            <Textarea id="certified-docs-note" value={note} onChange={e => setNote(e.target.value)} rows={3} maxLength={1000}
              placeholder="For example: passport certified by J Smith, solicitor, Smith & Co, 20 Nov 2026; council tax bill dated Oct 2026 at the same address" data-testid="certified-docs-note" />
          </div>
          {missing && <p className="text-[11px] text-muted-foreground">{missing}</p>}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="button" disabled={!!missing || save.isPending} onClick={() => save.mutate()} data-testid="certified-docs-save">
            {save.isPending && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}Accept them
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PublicFigureLine({ dealId, role, person, canDecide }: { dealId: string; role: string; person: KycPartyPerson; canDecide: boolean }) {
  const { toast } = useToast();
  const pf = person.publicFigure!;
  const withdraw = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/deals/${dealId}/parties/${role}/public-figure/${pf.id}/withdraw`, {})).json(),
    onSuccess: () => { refreshPeople(dealId); toast({ title: "Withdrawn", description: `${person.name} needs their identity check and proof of address again.` }); },
    onError: (e: any) => toast({ title: "Not withdrawn", description: String(e?.message || e).replace(/^\d+:\s*/, ""), variant: "destructive" }),
  });
  return (
    <div className="rounded border border-emerald-200 bg-emerald-50/60 px-2 py-1 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200" data-testid={`public-figure-line-${person.key.replace(/\s+/g, "-")}`}>
      <p><span className="font-medium">{pf.method === "certified" ? "Verified from certified documents" : "Verified from public sources"}</span> by {pf.by} on {new Date(pf.at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" })}: {pf.note}</p>
      {pf.links.length > 0 && (
        <ul className="mt-0.5 space-y-0.5">{pf.links.map(l => <li key={l} className="truncate"><a href={l} target="_blank" rel="noreferrer" className="underline">{l}</a></li>)}</ul>
      )}
      <p className="text-[11px] opacity-80">{pf.documents ? `${pf.documents} document${pf.documents === 1 ? "" : "s"} on the KYC record (the files, and a PDF copy of each page).` : pf.links.length ? "PDF copies of the pages are being saved to the KYC record." : ""}
        {canDecide && <button type="button" className="ml-2 underline" disabled={withdraw.isPending} onClick={() => withdraw.mutate()} data-testid={`public-figure-withdraw-${person.key.replace(/\s+/g, "-")}`}>Withdraw</button>}
      </p>
    </div>
  );
}

// The name BGP typed for a person, put right to the one on their documents
// (Jack, 20 November 2026: "Jonny" on the deal, "Jonathan" on the passport).
// What they sent is read against the new name at once; nothing is resent.
function RenamePerson({ dealId, token, current, suggested, onDone }: { dealId: string; token: string; current: string; suggested: string | null; onDone: () => void }) {
  const { toast } = useToast();
  const titleCase = (s: string) => s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
  const [name, setName] = useState(suggested ? titleCase(suggested) : current);
  const save = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/aml/deal/${dealId}/client-checks/people/rename`, { token, name: name.trim() })).json(),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: keyFor(dealId) }); toast({ title: `Name changed to ${name.trim()}` }); onDone(); },
    onError: (e: any) => toast({ title: "Not changed", description: String(e?.message || e).replace(/^\d+:\s*/, ""), variant: "destructive" }),
  });
  return (
    <div className="rounded border bg-muted/40 p-2 space-y-1.5" data-testid="person-rename-box">
      <p className="text-muted-foreground">Their full name as on their passport or driving licence. Their identity check and proof of address are read against it again; nothing is sent to them.</p>
      <Input value={name} onChange={e => setName(e.target.value)} className="h-8 text-sm" data-testid="person-rename-input"
        onKeyDown={e => { if (e.key === "Enter" && name.trim().split(/\s+/).length >= 2) save.mutate(); }} />
      <div className="flex gap-1">
        <Button size="sm" className="h-7 px-2 text-xs" disabled={save.isPending || name.trim().split(/\s+/).length < 2 || name.trim() === current} onClick={() => save.mutate()} data-testid="person-rename-save">
          {save.isPending && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}Save name
        </Button>
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={onDone}>Cancel</Button>
      </div>
    </div>
  );
}

// A person's proof of address as it was read against them (Woody, 20 November
// 2026: "is the app checking its actually for that person and acceptable?").
// It counts only when the reading passes (their name, dated in the last three
// months, a kind the policy accepts) or the Nominated Officer or a Deputy
// accepts it with a note.
function AddressProofLine({ dealId, person, canDecide }: { dealId: string; person: KycPartyPerson; canDecide: boolean }) {
  const { toast } = useToast();
  const [accepting, setAccepting] = useState(false);
  const [note, setNote] = useState("");
  const proof = person.address.proof;
  const testKey = person.key.replace(/\s+/g, "-");
  const refresh = () => queryClient.invalidateQueries({ queryKey: keyFor(dealId) });
  const reread = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/aml/deal/${dealId}/client-checks/address-proof/read`, { token: proof?.token, documentId: proof?.documentId })).json(),
    onSuccess: () => { refresh(); toast({ title: "Read again" }); },
    onError: (e) => toast({ title: "Not read", description: plain(String((e as any)?.message || e)), variant: "destructive" }),
  });
  const accept = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/aml/deal/${dealId}/client-checks/address-proof/accept`, { token: proof?.token, documentId: proof?.documentId, note: note.trim() })).json(),
    onSuccess: () => { refresh(); setAccepting(false); setNote(""); toast({ title: "Proof of address accepted" }); },
    onError: (e) => toast({ title: "Not accepted", description: plain(String((e as any)?.message || e)), variant: "destructive" }),
  });
  if (!proof) {
    return (
      <li className="flex items-start gap-1" data-testid={`person-address-${testKey}`}>
        <Tick ok={false} />
        <span>Proof of address not sent{person.address.asked ? <span className="text-muted-foreground"> · asked</span> : null}</span>
      </li>
    );
  }
  const counts = person.address.done;
  return (
    <li className="space-y-1" data-testid={`person-address-${testKey}`}>
      <div className="flex items-start gap-1">
        <Tick ok={counts} />
        <span>
          {counts ? "Proof of address" : "Proof of address to check"} ({proof.ref}):{" "}
          {proof.url ? <a href={proof.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2" data-testid={`person-address-file-${testKey}`}>{proof.summary}</a> : proof.summary}
          {proof.accepted ? <span className="text-muted-foreground"> · accepted by {proof.accepted.by}: {proof.accepted.note}</span> : null}
        </span>
      </div>
      {!counts && proof.reasons.length > 0 && (
        <p className="pl-5 text-amber-800 dark:text-amber-300" data-testid={`person-address-reasons-${testKey}`}>{proof.reasons.join(". ")}.</p>
      )}
      {proof.address && <p className="pl-5 text-muted-foreground">Address on it: {proof.address}</p>}
      {!counts && proof.documentId && (
        <div className="pl-5 flex flex-wrap items-center gap-1">
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={reread.isPending} onClick={() => reread.mutate()} data-testid={`person-address-reread-${testKey}`}>
            {reread.isPending ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : null}Read again
          </Button>
          {canDecide && !accepting && (
            <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => setAccepting(true)} data-testid={`person-address-accept-${testKey}`}>Accept it</Button>
          )}
        </div>
      )}
      {accepting && (
        <div className="pl-5 space-y-1">
          <Textarea rows={2} className="text-xs" placeholder="Why it is acceptable, e.g. the bill is in their married name, matching their passport" value={note} onChange={e => setNote(e.target.value)} data-testid={`person-address-accept-note-${testKey}`} />
          <div className="flex gap-1">
            <Button size="sm" className="h-7 px-2 text-xs" disabled={accept.isPending || note.trim().length < 10} onClick={() => accept.mutate()} data-testid={`person-address-accept-save-${testKey}`}>
              {accept.isPending ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : null}Accept
            </Button>
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setAccepting(false)}>Cancel</Button>
          </div>
        </div>
      )}
    </li>
  );
}

// Someone named alongside a private individual (Jack, 20 November 2026: "I
// want to be able to start checks on more than one private individual"):
// their name, then their own link, emailed or given to pass on. They then sit
// in the list above as anyone else does.
export function AddPersonButton({ dealId, data, party, className }: { dealId: string; data: ClientChecks; party: Party; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="outline" className={className || "h-7 px-2 text-xs"} onClick={() => setOpen(true)} data-testid={`person-add-${party.companyId}`}>
        <UserPlus className="w-3 h-3 mr-1" />Add another person
      </Button>
      {open && <AddPersonDialog dealId={dealId} data={data} party={party} onClose={() => setOpen(false)} />}
    </>
  );
}

function AddPersonDialog({ dealId, data, party, onClose }: { dealId: string; data: ClientChecks; party: Party; onClose: () => void }) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [mobile, setMobile] = useState("");
  const [note, setNote] = useState("");
  const [done, setDone] = useState<null | { link: string; emailed: boolean; error: string | null; person: string }>(null);
  const make = useMutation({
    mutationFn: async (send: boolean) => {
      const res = await apiRequest("POST", `/api/aml/deal/${dealId}/client-checks/people`, {
        companyId: party.companyId, key: "new", name: name.trim(), email: send ? email.trim() : null, mobile: mobile.trim() || null, send, note: note.trim() || null,
      });
      return res.json();
    },
    onSuccess: (r: any, send) => {
      queryClient.invalidateQueries({ queryKey: keyFor(dealId) });
      setDone({ link: r.link, emailed: send && !!r.sent?.ok, error: send && !r.sent?.ok ? r.sent?.error || "The email was not sent" : null, person: r.person || name.trim() });
    },
    onError: (e) => toast({ title: "Not added", description: plain(e), variant: "destructive" }),
  });
  const named = name.trim().split(/\s+/).filter(Boolean).length >= 2;
  const canEmail = named && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) && !make.isPending;
  const what = [data.veriff ? "the identity check" : KYC_DOCS.photo_id.title.toLowerCase(), KYC_DOCS.proof_of_address.title.toLowerCase(), KYC_PEP_QUESTION.title.toLowerCase()];
  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" data-testid="person-add-dialog">
        <DialogHeader>
          <DialogTitle>{done ? (done.error ? "Added, not emailed" : done.emailed ? `Sent to ${done.person}` : `${done.person}'s link`) : `Add another person alongside ${party.name}`}</DialogTitle>
          {!done && <DialogDescription>Another person on this side. Their own page asks for {what.join(", ")}.</DialogDescription>}
        </DialogHeader>
        {done ? (
          <div className="space-y-2 text-sm">
            {done.error ? <p className="text-amber-800">{done.error}. Copy their link and send it yourself.</p> : <p className="text-muted-foreground">{done.emailed ? "Their link was emailed. They now show under People with what is still to come." : "Copy their link and send it to them only. They now show under People."}</p>}
            <div className="flex gap-1">
              <Input readOnly value={done.link} className="text-xs" />
              <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(done.link); toast({ title: "Link copied" }); }}><Copy className="w-3 h-3 mr-1" />Copy</Button>
            </div>
            <DialogFooter><Button size="sm" onClick={onClose}>Done</Button></DialogFooter>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="space-y-1"><Label className="text-xs">Full name</Label><Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Jane Macaskill" data-testid="person-add-name" /></div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-1"><Label className="text-xs">Email</Label><Input type="email" value={email} onChange={e => setEmail(e.target.value)} data-testid="person-add-email" /></div>
              <div className="space-y-1"><Label className="text-xs">Mobile (optional)</Label><Input value={mobile} onChange={e => setMobile(e.target.value)} data-testid="person-add-mobile" /></div>
            </div>
            <div className="space-y-1"><Label className="text-xs">A note in the email (optional)</Label><Textarea rows={2} className="text-xs" value={note} onChange={e => setNote(e.target.value)} /></div>
            <DialogFooter className="gap-2">
              <Button size="sm" variant="ghost" disabled={!named || make.isPending} onClick={() => make.mutate(false)} data-testid="person-add-link">Just make the link</Button>
              <Button size="sm" disabled={!canEmail} onClick={() => make.mutate(true)} data-testid="person-add-send">
                {make.isPending ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Send className="w-3 h-3 mr-1" />}Email their link
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// A person's own link: emailed to them, or given to copy and pass on.
function PersonLinkDialog({ dealId, data, party, person, onClose }: { dealId: string; data: ClientChecks; party: Party; person: KycPartyPerson; onClose: () => void }) {
  const { toast } = useToast();
  const known = party.contacts.find(c => c.email && c.name.trim().toLowerCase().split(/\s+/).every(w => person.name.toLowerCase().includes(w))) || null;
  const [email, setEmail] = useState(known?.email || "");
  const [mobile, setMobile] = useState(known?.mobile || "");
  const [note, setNote] = useState("");
  const [preview, setPreview] = useState(false);
  const [done, setDone] = useState<null | { link: string; emailed: boolean; error: string | null }>(null);
  const asks = personRequestAsks(person, data.veriff);
  const what = [...(asks.needsIdCheck ? ["the identity check"] : []), ...asks.docs.map(k => KYC_DOCS[k].title.toLowerCase()), KYC_PEP_QUESTION.title.toLowerCase()];
  const previewHtml = useMemo(() => {
    if (!preview) return "";
    const { html } = kycRequestEmail({
      recipientName: person.name, partyName: party.name, kind: "individual", dealName: data.dealName, ref: "SAMPLE",
      link: "https://chatbgp.app/kyc-upload/their-link", expiresAt: new Date(Date.now() + 14 * 86400000),
      needsIdCheck: asks.needsIdCheck, docs: asks.docs, note, agents: data.agents.map(a => ({ name: a.name, email: a.email, phone: null })),
      sentFrom: data.mailbox, askPep: true, person: { roles: person.roles },
    });
    return html.split(`cid:${KYC_LOGO_CID}`).join("/bgp-logo.png");
  }, [preview, person, party, data, asks.needsIdCheck, asks.docs, note]);
  const make = useMutation({
    mutationFn: async (send: boolean) => {
      const res = await apiRequest("POST", `/api/aml/deal/${dealId}/client-checks/people`, {
        companyId: party.companyId, key: person.key, email: send ? email.trim() : null, mobile: mobile.trim() || null, send, note: note.trim() || null,
      });
      return res.json();
    },
    onSuccess: (r: any, send) => {
      queryClient.invalidateQueries({ queryKey: keyFor(dealId) });
      setDone({ link: r.link, emailed: send && !!r.sent?.ok, error: send && !r.sent?.ok ? r.sent?.error || "The email was not sent" : null });
    },
    onError: (e) => toast({ title: "Not done", description: plain(e), variant: "destructive" }),
  });
  const canEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) && !make.isPending;
  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" data-testid="person-link-dialog">
        <DialogHeader>
          <DialogTitle>{done ? (done.error ? "Not emailed" : done.emailed ? "Sent" : "Their link") : `${person.name}'s own checks`}</DialogTitle>
          {!done && <DialogDescription>Their own page asks for {what.join(", ")}.</DialogDescription>}
        </DialogHeader>
        {done ? (
          <div className="space-y-3 text-sm">
            {done.error && <p className="flex items-start gap-2 text-red-700"><AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />The email didn't go: {done.error}. Copy the link below and send it yourself.</p>}
            {done.emailed && <p className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 mt-0.5 text-emerald-600 shrink-0" />Sent to <strong>{person.name}</strong> ({email.trim()}), copied to the transaction's agents.</p>}
            <div className="flex gap-2">
              <Input readOnly value={done.link} onFocus={e => e.currentTarget.select()} data-testid="person-link-value" />
              <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(done.link); toast({ title: "Link copied", description: `It's personal to ${person.name}: send it only to them.` }); }}><Copy className="w-3.5 h-3.5 mr-1.5" />Copy</Button>
            </div>
            <p className="text-muted-foreground">Their progress shows under People to check. They get reminders after three and seven days if anything is still missing.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {person.ownerDetail && <p className="text-xs text-muted-foreground">{person.name}: {person.ownerDetail}.</p>}
            <div className="space-y-1.5">
              <Label>Their email</Label>
              <Input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="Their email, to send it to them" data-testid="person-link-email" />
              <Input value={mobile} onChange={e => setMobile(e.target.value)} placeholder="Their mobile (optional, for WhatsApp)" />
              <p className="text-[11px] text-muted-foreground">An email you type is saved to the CRM under {party.brandName || party.name}. No email? Make the link and pass it on yourself.</p>
            </div>
            <div className="space-y-1.5">
              <Label>A note from you (optional)</Label>
              <Textarea rows={2} value={note} onChange={e => setNote(e.target.value)} placeholder="Shown in the email and on their page" />
            </div>
            <Button type="button" variant="ghost" size="sm" className="px-0 h-auto text-xs" onClick={() => setPreview(v => !v)}>
              <Eye className="w-3.5 h-3.5 mr-1" />{preview ? "Hide the email" : "See the email"}
            </Button>
            {preview && <iframe title="Email preview" srcDoc={previewHtml} className="w-full h-[420px] rounded border bg-white" sandbox="" />}
          </div>
        )}
        <DialogFooter>
          {done ? <Button onClick={onClose}>Done</Button> : (
            <>
              <Button variant="outline" onClick={() => make.mutate(false)} disabled={make.isPending} data-testid="person-link-make">
                <Link2 className="w-4 h-4 mr-1.5" />Just make the link
              </Button>
              <Button onClick={() => make.mutate(true)} disabled={!canEmail} data-testid="person-link-send">
                {make.isPending ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Send className="w-4 h-4 mr-1.5" />}Email it to them
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// "Send client checks" for one party: pick the person, choose what to ask
// for, see the email, send.
export function SendClientChecksButton({ dealId, companyId, partyName, label = "Send client checks", size = "sm", className, quiet }: {
  dealId: string; companyId: string; partyName: string; label?: string; size?: "sm" | "default"; className?: string; quiet?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" size={size} variant={quiet ? "ghost" : "outline"} className={className} onClick={() => setOpen(true)} data-testid={`button-client-checks-${companyId}`}>
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
  const asks = party ? precheckAsks(party.askInput, { kind: chosenKind, role: party.role, idCheck: wantId, contactName: toName || null, trust: chosenKind === "company" ? party.trustAsk || null : null }) : null;
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
  const offeredDocs: KycDocKey[] = chosenKind === "company" && party?.trustAsk
    ? ["trust_deed", "trs_excerpt", "trust_authority", "trust_wealth", "source_of_funds", "proof_of_address", "photo_id", "ownership", "other"]
    : chosenKind === "company"
    ? ["ownership", "owner_ids", "authority", "source_of_funds", "company_documents", "proof_of_address", "photo_id", "other"]
    : ["proof_of_address", "source_of_funds", "photo_id", "other"];

  const previewHtml = useMemo(() => {
    if (!preview || !party) return "";
    const { html } = kycRequestEmail({
      recipientName: toName || "Jane Smith", partyName: party.name, kind: chosenKind, dealName: data?.dealName || "this transaction", ref: "SAMPLE",
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
          {!sent && <DialogDescription>One email with a link to their own page.</DialogDescription>}
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
            <p className="text-muted-foreground">They get a reminder after three days and again after seven if anything is still missing. You'll get an email when they press Finish. Progress shows on the transaction's AML card.</p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(sent.link); toast({ title: "Link copied", description: "It's personal to the client: send it only to them." }); }}><Copy className="w-3.5 h-3.5 mr-1.5" />Copy their link</Button>
              {toMobile && (
                <Button size="sm" variant="outline" asChild>
                  <a href={kycWhatsAppHref(toMobile, kycWhatsAppText({ recipientName: toName, dealName: data?.dealName || "the transaction", link: sent.link, expiresAt: new Date(Date.now() + 14 * 86400000) }))} target="_blank" rel="noreferrer"><MessageCircle className="w-3.5 h-3.5 mr-1.5" />Send on WhatsApp</a>
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
                  <p className="text-[11px] text-muted-foreground" data-testid="client-checks-saved-to-crm">Saved to the CRM under {party.brandName || party.name}, and made the person to ask on this transaction if nobody is set.</p>
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
              <p className="text-xs text-muted-foreground" data-testid="client-checks-no-precheck">BGP's checks before asking have not finished for {shownName} yet, so everything usual is ticked. They show on the transaction's AML card when done.</p>
            )}

            <p className="text-xs text-muted-foreground">Every request also asks {KYC_PEP_QUESTION.title.toLowerCase()} (politically exposed persons). A yes comes back to you and the MLRO.</p>

            <div className="space-y-1.5">
              <Label>A note from you (optional)</Label>
              <Textarea rows={2} value={note} onChange={e => setNote(e.target.value)} placeholder="Shown in the email and on their page" />
            </div>

            <div className="rounded-md bg-muted/60 p-3 text-xs space-y-0.5" data-testid="client-checks-summary">
              <div><span className="text-muted-foreground">From:</span> {data?.mailbox}</div>
              <div><span className="text-muted-foreground">To:</span> {toName ? `${toName} ` : ""}{toEmail ? `<${toEmail}>` : "choose someone above"}</div>
              <div><span className="text-muted-foreground">Copied:</span> {copied.length ? `${copied.join(", ")} (the transaction's agents) and you` : "you (the transaction has no agents set)"}</div>
            </div>

            <Button type="button" variant="ghost" size="sm" className="px-0 h-auto text-xs" onClick={() => setPreview(v => !v)}>
              <Eye className="w-3.5 h-3.5 mr-1" />{preview ? "Hide the email" : "See the email"}
            </Button>
            {preview && <iframe title="Email preview" srcDoc={previewHtml} className="w-full h-[480px] rounded border bg-white" sandbox="" data-testid="client-checks-preview" />}
          </div>
        ) : !isLoading && !error ? (
          <p className="text-sm text-muted-foreground">{shownName} isn't a party on this transaction yet. Set it on the transaction first.</p>
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
