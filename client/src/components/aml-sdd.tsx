// Simplified due diligence (SDD) on a party (Layla, 23 November 2026, on
// transaction #3965, The Crown Estate): the box says the party is SDD so
// nobody goes looking for owners, lists what the file should hold, and drafts
// the note of reasons for a person to check and save on the transaction.
// Rules and the draft: shared/aml-sdd.ts. No form element: it opens over the
// transaction form.
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CheckCircle2, FileText, Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiRequest, getAuthHeaders, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { SDD_MEANS, SDD_NOTE_MAX, sddNoteDraft, sddNoteProblem, type SavedSddNote, type SddCase } from "@shared/aml-sdd";

const plain = (e: unknown) => String((e as any)?.message || e).replace(/^\d+:\s*/, "").replace(/^\{"message":"(.*?)".*\}$/, "$1");
const notesKey = (dealId: string) => ["/api/deals", dealId, "sdd-notes"];
const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

export function useSddNotes(dealId: string, enabled = true) {
  return useQuery<{ notes: Record<string, SavedSddNote> }>({
    queryKey: notesKey(dealId), enabled: !!dealId && enabled, staleTime: 30_000,
    queryFn: async () => {
      const res = await fetch(`/api/deals/${dealId}/sdd-notes`, { credentials: "include", headers: getAuthHeaders() });
      if (!res.ok) throw new Error(plain(await res.text()));
      return res.json();
    },
  });
}

export interface SddBoxProps {
  dealId: string; role: string; roleLabel: string; sdd: SddCase; partyName: string;
  dealName?: string | null; dealRef?: string | number | null; contactName?: string | null; isClient?: boolean;
  // An agent on the transaction, the Nominated Officer or a Deputy.
  canSave: boolean;
}

export function SddBox(props: SddBoxProps) {
  const { dealId, role, sdd, partyName } = props;
  const notes = useSddNotes(dealId);
  const saved = notes.data?.notes?.[role] || null;
  const [writing, setWriting] = useState(false);
  const [showNote, setShowNote] = useState(false);
  return (
    <div className="space-y-1.5 rounded-md border border-emerald-300 bg-emerald-50 px-2.5 py-2 text-xs text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-100" data-testid={`aml-sdd-${role}`}>
      <div className="flex flex-wrap items-center gap-1.5">
        <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-emerald-700 dark:text-emerald-300" />
        <span className="font-semibold">Simplified due diligence (SDD){sdd.confirmed ? "" : ": to confirm"}</span>
      </div>
      <p>{sdd.basis}</p>
      <p className="opacity-80">{SDD_MEANS}</p>
      <div>
        <p className="font-medium">The file should hold:</p>
        <ol className="list-decimal space-y-0.5 pl-4">
          {sdd.fileHolds.map(line => <li key={line}>{line}</li>)}
        </ol>
      </div>
      <p className="opacity-80">{sdd.caveat}</p>
      <div className="flex flex-wrap items-center gap-2 border-t border-emerald-300/60 pt-1.5 dark:border-emerald-800/60">
        {saved ? (
          <>
            <span className="inline-flex items-center gap-1" data-testid={`aml-sdd-saved-${role}`}>
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-700 dark:text-emerald-300" />
              SDD note saved{saved.by ? ` by ${saved.by}` : ""}, {day(saved.at)}
            </span>
            <button type="button" className="underline underline-offset-2" onClick={() => setShowNote(v => !v)} data-testid={`aml-sdd-show-${role}`}>{showNote ? "Hide it" : "Read it"}</button>
            {props.canSave && <button type="button" className="underline underline-offset-2" onClick={() => setWriting(true)} data-testid={`aml-sdd-change-${role}`}>Change it</button>}
          </>
        ) : props.canSave ? (
          <>
            <span className="font-medium text-amber-900 dark:text-amber-200">No SDD note saved yet.</span>
            <Button type="button" size="sm" className="ml-auto h-7 text-xs" onClick={() => setWriting(true)} disabled={!sdd.confirmed} data-testid={`aml-sdd-draft-${role}`}>
              <FileText className="mr-1 h-3.5 w-3.5" />Draft the SDD note
            </Button>
          </>
        ) : (
          <span>No SDD note saved yet: an agent on the transaction or an AML officer saves it.</span>
        )}
      </div>
      {!sdd.confirmed && !saved && <p className="text-amber-900 dark:text-amber-200">Confirm what {partyName} is on the party first (Who signs), then the note can be drafted.</p>}
      {saved && showNote && <p className="whitespace-pre-line rounded border border-emerald-300/60 bg-background/60 px-2 py-1.5 text-foreground dark:border-emerald-800/60" data-testid={`aml-sdd-note-${role}`}>{saved.note}</p>}
      {writing && <SddNoteDialog {...props} saved={saved} onClose={() => setWriting(false)} />}
    </div>
  );
}

function SddNoteDialog({ dealId, role, roleLabel, sdd, partyName, dealName, dealRef, contactName, isClient, saved, onClose }: SddBoxProps & { saved: SavedSddNote | null; onClose: () => void }) {
  const { toast } = useToast();
  const draft = () => sddNoteDraft({ sdd, partyName, roleLabel, dealName: dealName || "", dealRef, contactName, isClient });
  const [note, setNote] = useState(() => saved?.note || draft());
  const problem = sddNoteProblem(note);
  const save = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/deals/${dealId}/parties/${role}/sdd-note`, { note })).json(),
    onSuccess: () => {
      toast({ title: "SDD note saved on this transaction" });
      queryClient.invalidateQueries({ queryKey: notesKey(dealId) });
      queryClient.invalidateQueries({ predicate: q => String(q.queryKey[0] || "").startsWith(`/api/kyc/deal/${dealId}`) });
      onClose();
    },
    onError: e => toast({ title: "Not saved", description: plain(e), variant: "destructive" }),
  });
  return (
    <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto" data-testid="aml-sdd-dialog">
        <DialogHeader>
          <DialogTitle>SDD note: {partyName}</DialogTitle>
          <DialogDescription>The app has drafted why simplified due diligence applies. Check it, fill in anything in [square brackets], then save. It is kept on this transaction's history and the party's KYC record.</DialogDescription>
        </DialogHeader>
        <Textarea value={note} onChange={e => setNote(e.target.value.slice(0, SDD_NOTE_MAX))} rows={16} className="text-sm leading-relaxed" data-testid="aml-sdd-note-text" />
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {problem ? <span className="text-amber-800 dark:text-amber-300" data-testid="aml-sdd-problem">{problem}</span> : <span className="text-muted-foreground">Ready to save.</span>}
          <button type="button" className="ml-auto text-muted-foreground underline underline-offset-2" onClick={() => setNote(draft())} data-testid="aml-sdd-redraft">Draft it again</button>
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="button" disabled={!!problem || save.isPending} onClick={() => save.mutate()} data-testid="aml-sdd-save">
            {save.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}Save to this transaction
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
