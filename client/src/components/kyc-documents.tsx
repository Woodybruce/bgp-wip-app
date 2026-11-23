// Upload documents on a party (Woody, 23 November 2026: "can that be just
// upload documents but also add the drag and drop function in the new box we
// have done so can upload certified documents, the app must read these and
// check they are acceptable"). Drop or choose files; each is filed on the
// party's KYC record, read, and set against the people to check: a document
// that passes counts for that person's identity or address. The rules are
// shared/kyc-documents.ts; the server is server/kyc-documents.ts.
import { useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, FileText, Loader2, RefreshCw, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
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
    // Read again every few seconds while a file is being read.
    refetchInterval: q => (q.state.data?.documents || []).some(d => !d.read) ? 5000 : false,
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
  const verdict = !doc.read ? null
    : !doc.reading?.read ? null
    : counts ? `Counts for ${who}'s ${check!.use === "identity" ? "identity" : "proof of address"}${doc.accepted && !check!.ok ? ` (accepted by ${doc.accepted.by})` : ""}`
    : check?.use === "company" ? "Kept on the record"
    : check?.use === "other" ? "Kept on the record: not an identity or address document"
    : null;
  const toLook = !!doc.reading?.read && !counts && (check?.use === "identity" || check?.use === "address") && !doc.accepted;
  return (
    <li className="rounded-md border border-border/70 bg-background px-2.5 py-1.5 text-xs" data-testid={`aml-document-${doc.id}`}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {!doc.read ? <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
          : counts || check?.use === "company" ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
          : toLook || !doc.reading?.read ? <AlertCircle className="h-3.5 w-3.5 text-amber-600" />
          : <FileText className="h-3.5 w-3.5 text-muted-foreground" />}
        {/* The file opens in the pop-out viewer, not a download (Woody, 23 November 2026). */}
        {doc.url ? <button type="button" onClick={() => setViewing(0)} className="font-medium hover:underline text-left" data-testid={`aml-document-open-${doc.id}`}>{doc.fileName}</button> : <span className="font-medium">{doc.fileName}</span>}
        <FilePopout files={[{ key: doc.id, name: doc.fileName, url: doc.url, caption: check?.summary || null }]} index={viewing} onIndex={setViewing} />
        <span className="text-muted-foreground">{!doc.read ? "Reading…" : check?.summary}</span>
        {doc.read && (
          <Button type="button" size="sm" variant="ghost" className="ml-auto h-6 px-1.5 text-[11px]" disabled={reread.isPending} onClick={() => reread.mutate()} data-testid={`aml-document-reread-${doc.id}`}>
            {reread.isPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <RefreshCw className="mr-1 h-3 w-3" />}Read again
          </Button>
        )}
      </div>
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
