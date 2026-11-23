// Upload documents on a party (Woody, 23 November 2026: "can that be just
// upload documents but also add the drag and drop function in the new box we
// have done so can upload certified documents, the app must read these and
// check they are acceptable"). Drop or choose files; each is filed on the
// party's KYC record, read, and set against the people to check: a document
// that passes counts for that person's identity or address. The rules are
// shared/kyc-documents.ts; the server is server/kyc-documents.ts.
import { useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, FileText, Languages, Loader2, RefreshCw, Upload, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, getAuthHeaders, queryClient } from "@/lib/queryClient";
import { FilePopout } from "@/components/file-popout";
import { partyTrailKey } from "@/components/aml-files";
import { KYC_DOCUMENT_ACCEPT_NOTE_MIN, type KycDocumentCheck, type KycDocumentReading } from "@shared/kyc-documents";
import { personDisplayName } from "@shared/kyc-prechecks";

interface UploadedDocument {
  id: string; fileName: string; url: string | null; uploadedAt: string; seenOriginal: boolean;
  read: boolean; reading: KycDocumentReading | null; accepted: { by: string; at: string; note: string } | null;
  check: KycDocumentCheck | null;
  // The company abroad a register extract was uploaded for, when not the party itself.
  about?: { name: string; country?: string | null } | null;
  // Its English translation, made in the app (23 November 2026).
  translation?: { language: string | null; english: boolean | null; madeAt: string; cut: boolean; error: string | null; held: boolean } | null;
}

const plain = (e: any) => String(e?.message || e || "").replace(/^\d{3}:\s*/, "");
const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer?.types || []).includes("Files");
const keyFor = (dealId: string, role: string) => ["/api/deals", dealId, "parties", role, "documents"];
// The people to check read the uploads too.
const peopleKey = (dealId: string) => ["/api/aml/deal", dealId, "client-checks"];

export function useUploadedDocuments(dealId: string, role: string, enabled = true) {
  return useQuery<{ documents: UploadedDocument[] }>({
    enabled,
    queryKey: keyFor(dealId, role),
    queryFn: async () => (await apiRequest("GET", `/api/deals/${dealId}/parties/${role}/documents`)).json(),
    // Read again every few seconds while a file is being read or translated.
    refetchInterval: q => (q.state.data?.documents || []).some(d => !d.read || (d.reading?.read && d.reading.english === false && !d.translation)) ? 5000 : false,
  });
}

function useLanded(dealId: string, role: string) {
  return (body: { documents: UploadedDocument[] }) => {
    queryClient.setQueryData(keyFor(dealId, role), { documents: body.documents });
    queryClient.invalidateQueries({ queryKey: peopleKey(dealId) });
    // The files on record at the top of the Documents step.
    queryClient.invalidateQueries({ queryKey: partyTrailKey(dealId, role) });
  };
}

export function PartyDocumentsBox({ dealId, role, partyName, canDecide }: { dealId: string; role: string; partyName: string; canDecide: boolean }) {
  const { toast } = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [seenOriginal, setSeenOriginal] = useState(false);
  const docs = useUploadedDocuments(dealId, role);
  const landed = useLanded(dealId, role);
  const send = useMutation({
    mutationFn: async (files: File[]) => {
      const fd = new FormData();
      for (const f of files) fd.append("files", f);
      fd.append("seenOriginal", seenOriginal ? "true" : "false");
      const res = await fetch(`/api/deals/${dealId}/parties/${role}/documents`, { method: "POST", body: fd, credentials: "include", headers: getAuthHeaders() });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.message || "The documents could not be uploaded.");
      return body;
    },
    onSuccess: (body: any) => {
      landed(body);
      toast({
        title: body.filed ? `${body.filed} document${body.filed === 1 ? "" : "s"} uploaded` : "Nothing new uploaded",
        description: body.refused?.length ? `${body.filed ? "Not kept: " : ""}${body.refused.slice(0, 3).join("; ")}.` : "Each is read and checked against the people to check.",
      });
    },
    onError: (e) => toast({ title: "Not uploaded", description: plain(e), variant: "destructive" }),
  });
  const take = (list: FileList | File[] | null | undefined) => {
    const files = Array.from(list || []).slice(0, 10);
    if (files.length) send.mutate(files);
  };
  const list = docs.data?.documents || [];
  return (
    <div className="space-y-1.5" data-testid={`aml-documents-${role}`}>
      <div
        className={`rounded-md border px-2.5 py-2 text-xs transition-colors ${dragging ? "border-primary bg-primary/5" : "border-dashed border-border"}`}
        // The box keeps its own drops: stopped here, the app-wide "Drop to
        // import" (GlobalDropZone, on window) neither shows nor opens Import
        // Anything over it.
        onDragEnter={e => { if (hasFiles(e)) { e.preventDefault(); e.stopPropagation(); setDragging(true); } }}
        onDragOver={e => { if (hasFiles(e)) { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = "copy"; setDragging(true); } }}
        onDragLeave={e => { if (hasFiles(e)) e.stopPropagation(); if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false); }}
        onDrop={e => { if (!hasFiles(e)) return; e.preventDefault(); e.stopPropagation(); setDragging(false); take(e.dataTransfer.files); }}
        data-testid={`aml-documents-drop-${role}`}
      >
        <div className="flex flex-wrap items-center gap-2">
          <Upload className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="font-medium">Upload documents</span>
          <span className="text-muted-foreground">{dragging ? `Drop them to file on ${partyName}` : "Drag them here: certified ID, proof of address, company documents. PDF, photos, Word or a zip."}</span>
          <Button type="button" size="sm" variant="outline" className="ml-auto h-7 text-xs bg-background" disabled={send.isPending} onClick={() => input.current?.click()} data-testid={`aml-documents-choose-${role}`}>
            {send.isPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}Choose files
          </Button>
          <input ref={input} type="file" multiple className="hidden" accept=".pdf,.jpg,.jpeg,.png,.heic,.heif,.webp,.doc,.docx,.zip,application/pdf,image/*"
            onChange={e => { take(e.target.files); e.target.value = ""; }} data-testid={`aml-documents-input-${role}`} />
        </div>
        <label className="mt-1.5 flex cursor-pointer items-center gap-1.5 text-muted-foreground">
          <input type="checkbox" className="h-3.5 w-3.5" checked={seenOriginal} onChange={e => setSeenOriginal(e.target.checked)} data-testid={`aml-documents-seen-${role}`} />
          An agent saw the originals (then a copy needs no certification)
        </label>
      </div>
      {list.length > 0 && (
        <ul className="space-y-1" data-testid={`aml-documents-list-${role}`}>
          {list.map(d => <DocumentLine key={d.id} dealId={dealId} role={role} doc={d} canDecide={canDecide} />)}
        </ul>
      )}
    </div>
  );
}

function DocumentLine({ dealId, role, doc, canDecide }: { dealId: string; role: string; doc: UploadedDocument; canDecide: boolean }) {
  const { toast } = useToast();
  const landed = useLanded(dealId, role);
  const [accepting, setAccepting] = useState(false);
  const [note, setNote] = useState("");
  const [viewing, setViewing] = useState<number | null>(null);
  const reread = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/deals/${dealId}/parties/${role}/documents/${doc.id}/read`, {})).json(),
    onSuccess: (body: any) => landed(body),
    onError: (e) => toast({ title: "Not read", description: plain(e), variant: "destructive" }),
  });
  const accept = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/deals/${dealId}/parties/${role}/documents/${doc.id}/accept`, { note: note.trim() })).json(),
    onSuccess: (body: any) => { landed(body); setAccepting(false); setNote(""); toast({ title: "Accepted" }); },
    onError: (e) => toast({ title: "Not accepted", description: plain(e), variant: "destructive" }),
  });
  const check = doc.check;
  const who = check?.person ? personDisplayName(check.person) : null;
  const counts = !!check && (check.use === "identity" || check.use === "address") && !!who && (check.ok || !!doc.accepted);
  // A register extract is checked against its company (23 November 2026).
  const extract = !!doc.reading?.read && doc.reading.kind === "register_extract";
  const extractOk = extract && !!check && check.use === "company" && (check.ok || !!doc.accepted);
  const verdict = !doc.read ? null
    : !doc.reading?.read ? null
    : counts ? `Counts for ${who}'s ${check!.use === "identity" ? "identity" : "proof of address"}${doc.accepted && !check!.ok ? ` (accepted by ${doc.accepted.by})` : ""}`
    : extractOk ? `Register extract checked${doc.about ? ` for ${doc.about.name}` : ""}: the same company, issued in the last three months${doc.accepted && !check!.ok ? ` (accepted by ${doc.accepted.by})` : ""}`
    : extract ? null
    : check?.use === "company" ? "Kept on the record"
    : check?.use === "other" ? "Kept on the record: not an identity or address document"
    : null;
  const toLook = !!doc.reading?.read && !counts && !doc.accepted && ((check?.use === "identity" || check?.use === "address") || (extract && !!check && !check.ok));
  return (
    <li className="rounded-md border border-border/70 bg-background px-2.5 py-1.5 text-xs" data-testid={`aml-document-${doc.id}`}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {!doc.read ? <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
          : counts || check?.use === "company" ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
          : toLook || !doc.reading?.read ? <AlertCircle className="h-3.5 w-3.5 text-amber-600" />
          : <FileText className="h-3.5 w-3.5 text-muted-foreground" />}
        {/* The file opens in the pop-out viewer, not a download (Woody, 23 November 2026). */}
        {doc.url ? <button type="button" onClick={() => setViewing(0)} className="font-medium hover:underline text-left" data-testid={`aml-document-open-${doc.id}`}>{doc.fileName}</button> : <span className="font-medium">{doc.fileName}</span>}
        <FilePopout files={[{ key: doc.id, name: doc.fileName, url: doc.url, caption: check?.summary || null, translate: { dealId, role, documentId: doc.id } }]} index={viewing} onIndex={setViewing} />
        <span className="text-muted-foreground">{!doc.read ? "Reading…" : check?.summary}</span>
        {doc.read && (
          <Button type="button" size="sm" variant="ghost" className="ml-auto h-6 px-1.5 text-[11px]" disabled={reread.isPending} onClick={() => reread.mutate()} data-testid={`aml-document-reread-${doc.id}`}>
            {reread.isPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <RefreshCw className="mr-1 h-3 w-3" />}Read again
          </Button>
        )}
      </div>
      {doc.read && <TranslationLine dealId={dealId} role={role} doc={doc} />}
      {extract && <ExtractPeople dealId={dealId} role={role} doc={doc} />}
      {verdict && <p className={counts || check?.use === "company" ? "mt-0.5 text-emerald-700 dark:text-emerald-300" : "mt-0.5 text-muted-foreground"} data-testid={`aml-document-verdict-${doc.id}`}>{verdict}</p>}
      {toLook && check?.reasons.length ? (
        <ul className="mt-0.5 list-disc pl-4 text-amber-800 dark:text-amber-300" data-testid={`aml-document-reasons-${doc.id}`}>
          {check.reasons.map(r => <li key={r}>{r}</li>)}
        </ul>
      ) : null}
      {doc.accepted && <p className="mt-0.5 text-muted-foreground">Accepted by {doc.accepted.by}: {doc.accepted.note}</p>}
      {toLook && canDecide && (
        accepting ? (
          <div className="mt-1 space-y-1">
            <Textarea rows={2} value={note} onChange={e => setNote(e.target.value)} placeholder="Why it is acceptable, e.g. original seen at the meeting on 20 November" className="text-xs" data-testid={`aml-document-note-${doc.id}`} />
            <div className="flex gap-1.5">
              <Button type="button" size="sm" className="h-7 text-xs" disabled={note.trim().length < KYC_DOCUMENT_ACCEPT_NOTE_MIN || accept.isPending} onClick={() => accept.mutate()} data-testid={`aml-document-accept-save-${doc.id}`}>Accept it</Button>
              <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setAccepting(false)}>Cancel</Button>
            </div>
          </div>
        ) : (
          <Button type="button" size="sm" variant="outline" className="mt-1 h-6 px-2 text-[11px] bg-background" onClick={() => setAccepting(true)} data-testid={`aml-document-accept-${doc.id}`}>Accept it</Button>
        )
      )}
    </li>
  );
}

// The document in English, made in the app (Woody, 23 November 2026: "all
// happen in the app including translation"). Not a certified translation:
// HMRC can ask for one (MLR 2017 reg 66), and the screen says so.
function TranslationLine({ dealId, role, doc }: { dealId: string; role: string; doc: UploadedDocument }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const t = doc.translation || null;
  const foreign = doc.reading?.read && doc.reading.english === false;
  const translate = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/deals/${dealId}/parties/${role}/documents/${doc.id}/translate`, {})).json(),
    onSuccess: (body: any) => {
      queryClient.invalidateQueries({ queryKey: keyFor(dealId, role) });
      if (body?.translation?.error) toast({ title: "Not translated", description: body.translation.error, variant: "destructive" });
      else if (body?.translation?.english) toast({ title: "Already in English" });
      else setOpen(true);
    },
    onError: (e) => toast({ title: "Not translated", description: plain(e), variant: "destructive" }),
  });
  if (!foreign && !t?.held && !t?.error) {
    // An English document: translation only on a press, out of the way.
    return null;
  }
  return (
    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground" data-testid={`aml-document-translation-${doc.id}`}>
      <Languages className="h-3.5 w-3.5" />
      <span>In {t?.language || doc.reading?.language || "another language"}</span>
      {t?.held ? (
        <Button type="button" size="sm" variant="outline" className="h-6 px-2 text-[11px] bg-background" onClick={() => setOpen(true)} data-testid={`aml-document-translation-open-${doc.id}`}>English translation</Button>
      ) : t?.error ? (
        <>
          <span className="text-amber-700 dark:text-amber-300">Not translated: {t.error}</span>
          <Button type="button" size="sm" variant="ghost" className="h-6 px-1.5 text-[11px]" disabled={translate.isPending} onClick={() => translate.mutate()} data-testid={`aml-document-translate-${doc.id}`}>
            {translate.isPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}Translate again
          </Button>
        </>
      ) : (
        <span className="flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" />Translating into English…</span>
      )}
      {open && <TranslationDialog dealId={dealId} role={role} doc={doc} onClose={() => setOpen(false)} onAgain={() => translate.mutate()} again={translate.isPending} />}
    </div>
  );
}

function TranslationDialog({ dealId, role, doc, onClose, onAgain, again }: { dealId: string; role: string; doc: UploadedDocument; onClose: () => void; onAgain: () => void; again: boolean }) {
  const q = useQuery<{ translation: { language: string | null; translation: string | null; madeAt: string; cut: boolean; madeBy: string | null } | null; note: string }>({
    queryKey: [...keyFor(dealId, role), doc.id, "translation", doc.translation?.madeAt || ""],
    queryFn: async () => (await apiRequest("GET", `/api/deals/${dealId}/parties/${role}/documents/${doc.id}/translation`)).json(),
  });
  const t = q.data?.translation || null;
  return (
    <Dialog open onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-2xl" data-testid={`aml-document-translation-dialog-${doc.id}`}>
        <DialogHeader>
          <DialogTitle>{doc.fileName} in English</DialogTitle>
          <DialogDescription>
            {t ? `Translated from ${t.language || "another language"} on ${new Date(t.madeAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" })}. ` : ""}{q.data?.note || ""}
          </DialogDescription>
        </DialogHeader>
        {q.isLoading ? <p className="text-sm text-muted-foreground">Reading…</p>
          : !t?.translation ? <p className="text-sm text-muted-foreground">No translation yet.</p>
          : (
            <div className="max-h-[60vh] overflow-y-auto rounded-md border bg-muted/30 p-3">
              {t.cut && <p className="mb-2 text-xs text-amber-700 dark:text-amber-300">Cut short: the document is long. Read the original for the rest.</p>}
              <pre className="whitespace-pre-wrap break-words font-sans text-xs leading-relaxed" data-testid={`aml-document-translation-text-${doc.id}`}>{t.translation}</pre>
            </div>
          )}
        <div className="flex justify-end">
          <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" disabled={again} onClick={onAgain} data-testid={`aml-document-translate-again-${doc.id}`}>
            {again ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}Translate again
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// The board and the owners a register extract lists (23 November 2026). The
// directors are screened against the sanctions lists by BGP's checks; an owner
// who is a person is added as one with a press, and then does their own check.
function ExtractPeople({ dealId, role, doc }: { dealId: string; role: string; doc: UploadedDocument }) {
  const { toast } = useToast();
  const r = doc.reading!;
  const company = doc.about?.name || r.company?.name || null;
  const directors = r.directors || [];
  const owners = r.owners || [];
  const [added, setAdded] = useState<string[]>([]);
  const add = useMutation({
    mutationFn: async (o: { name: string; share: string | null }) => (await apiRequest("POST", `/api/deals/${dealId}/parties/${role}/abroad/person`, {
      ownerName: company, name: o.name, detail: `${o.share ? `${o.share} ` : ""}shareholder on the register extract`,
    })).json(),
    onSuccess: (_b, o) => {
      setAdded(a => [...a, o.name]);
      queryClient.invalidateQueries({ queryKey: ["/api/deals", dealId, "parties", role, "abroad"] });
      queryClient.invalidateQueries({ queryKey: peopleKey(dealId) });
      queryClient.invalidateQueries({ queryKey: ["/api/kyc/deal", dealId, "status"] });
      toast({ title: `${o.name} added as an owner`, description: "Screened now, and listed in People to check for their own check." });
    },
    onError: (e) => toast({ title: "Not added", description: plain(e), variant: "destructive" }),
  });
  if (!directors.length && !owners.length) return null;
  return (
    <div className="mt-1 space-y-0.5 text-muted-foreground" data-testid={`aml-document-extract-people-${doc.id}`}>
      {directors.length > 0 && (
        <p><span className="font-medium text-foreground">Board:</span> {directors.map(d => `${d.name}${d.role ? ` (${d.role})` : ""}`).join("; ")}. Screened against the sanctions lists.</p>
      )}
      {owners.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-medium text-foreground">Owners:</span>
          {owners.map(o => (
            <span key={o.name} className="inline-flex items-center gap-1">
              {o.name}{o.share ? ` (${o.share})` : ""}{!o.person ? " · a company" : ""}
              {o.person && company && (added.includes(o.name)
                ? <span className="text-emerald-700 dark:text-emerald-300">added</span>
                : <Button type="button" size="sm" variant="outline" className="h-6 px-1.5 text-[11px] bg-background" disabled={add.isPending} onClick={() => add.mutate({ name: o.name, share: o.share })} data-testid={`aml-document-add-owner-${doc.id}-${o.name.replace(/\W+/g, "-").toLowerCase()}`}>
                    <UserPlus className="mr-1 h-3 w-3" />Add as owner
                  </Button>)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
