// Select and Delete on the CRM page's lists (Woody, 2026-11-23: "add a select
// and delete buttons on the CRMs pages"), for landlords, brands, agents and
// lenders, admins only, as on Brand Explorer. The server
// (POST /api/admin/crm-companies/bulk-delete) deletes for good a ticked
// company nothing points at, hides a ticked brand something does point at,
// and keeps any other company something points at, saying what holds it.
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import type { CrmHubKind } from "@shared/crm-hub";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { BULK_DELETE_MAX, invalidateBrandLists } from "@/components/brand-tidy";
import { CRM_HUB_KEY } from "./company-row";

type Named = { id: string; name: string; ties?: string[] };
interface Result { deleted: Named[]; hidden: Named[]; kept: Named[]; staysHidden: Named[]; missing: number; failed: Named[] }
const errorText = (e: any) => { const m = String(e?.message || ""); try { return JSON.parse(m.slice(m.indexOf("{"))).error || m; } catch { return m; } };

function Names({ list, testId }: { list: Named[]; testId: string }) {
  return (
    <div className="max-h-44 overflow-y-auto rounded-md border divide-y" data-testid={testId}>
      {list.map(c => <div key={c.id} className="px-2 py-1 text-xs"><span className="font-medium">{c.name}</span>{c.ties?.length ? <span className="text-muted-foreground">: {c.ties.join("; ")}</span> : null}</div>)}
    </div>
  );
}

export function CrmSelectBar({ kind, words, picked, onPick, shown, onDone }: {
  kind: CrmHubKind; words: { one: string; many: string };
  picked: Set<string>; onPick: (next: Set<string>) => void; shown: Array<{ id: string; name: string }>; onDone: () => void;
}) {
  const { toast } = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const n = picked.size;
  const word = (count: number) => `${count.toLocaleString("en-GB")} ${count === 1 ? words.one : words.many}`;
  const remove = useMutation({
    mutationFn: async (ids: string[]): Promise<Result> => (await apiRequest("POST", "/api/admin/crm-companies/bulk-delete", { ids })).json(),
    onSuccess: r => {
      setResult(r); setConfirmOpen(false); setConfirm(""); onPick(new Set());
      queryClient.invalidateQueries({ queryKey: [CRM_HUB_KEY] });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/engagement"] });
      invalidateBrandLists();
    },
    onError: (e: any) => toast({ title: "Nothing was deleted", description: errorText(e), variant: "destructive" }),
  });
  const close = () => { setConfirmOpen(false); setConfirm(""); setResult(null); };
  const first = shown.slice(0, BULK_DELETE_MAX).map(c => c.id);
  return (
    <div className="sticky top-0 z-20 flex items-center gap-2 flex-wrap rounded-lg border bg-background/95 backdrop-blur px-3 py-2 shadow-sm" data-testid={`crm-select-bar-${kind}`}>
      <span className="text-sm font-medium tabular-nums">{n.toLocaleString("en-GB")} selected</span>
      <span className="text-xs text-muted-foreground">{n >= BULK_DELETE_MAX ? `${BULK_DELETE_MAX} is the most at once.` : `Click a ${words.one} to tick it.`}</span>
      <div className="flex items-center gap-1.5 ml-auto flex-wrap">
        <Button variant="outline" size="sm" className="h-7 text-xs" disabled={!first.length} onClick={() => onPick(new Set(first))} data-testid={`crm-select-all-${kind}`}>
          {first.length < shown.length ? `Select the first ${first.length.toLocaleString("en-GB")}` : `Select all ${first.length.toLocaleString("en-GB")}`}
        </Button>
        <Button variant="outline" size="sm" className="h-7 text-xs" disabled={!n} onClick={() => onPick(new Set())}>Clear</Button>
        <Button variant="destructive" size="sm" className="h-7 text-xs" disabled={!n || remove.isPending} onClick={() => setConfirmOpen(true)} data-testid={`crm-bulk-delete-${kind}`}>
          <Trash2 className="w-3 h-3 mr-1" /> {n ? `Delete ${n.toLocaleString("en-GB")}` : "Delete"}
        </Button>
        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onDone} data-testid={`crm-select-done-${kind}`}>Done</Button>
      </div>
      {(confirmOpen || result) && (
        <Dialog open onOpenChange={o => { if (!o) close(); }}>
          <DialogContent className="max-w-md">
            {result ? (
              <div className="space-y-3" data-testid={`crm-bulk-result-${kind}`}>
                <DialogHeader><DialogTitle>{result.deleted.length ? `${word(result.deleted.length)} deleted` : "Nothing deleted"}</DialogTitle></DialogHeader>
                {result.deleted.length > 0 && <Names list={result.deleted} testId="crm-bulk-deleted" />}
                {result.hidden.length > 0 && <><p className="text-sm text-muted-foreground">{result.hidden.length === 1 ? "1 brand was" : `${result.hidden.length} brands were`} hidden instead, because something in the app points at {result.hidden.length === 1 ? "it" : "them"}. Unhide under Brands → Brand Explorer → Hidden.</p><Names list={result.hidden} testId="crm-bulk-hidden" /></>}
                {result.kept.length > 0 && <><p className="text-sm text-muted-foreground">{word(result.kept.length)} kept, because other records point at {result.kept.length === 1 ? "it" : "them"} (shown after each name). Clear those first, or merge the duplicate on its page.</p><Names list={result.kept} testId="crm-bulk-kept" /></>}
                {result.staysHidden.length > 0 && <p className="text-sm text-muted-foreground">Already hidden and kept on file: {result.staysHidden.map(c => c.name).join(", ")}.</p>}
                {result.failed.length > 0 && <p className="text-sm text-destructive">Could not be deleted: {result.failed.map(c => c.name).join(", ")}. Try again.</p>}
                <div className="flex justify-end"><Button size="sm" onClick={close}>Close</Button></div>
              </div>
            ) : (
              <div className="space-y-3">
                <DialogHeader><DialogTitle>Delete {word(n)}</DialogTitle></DialogHeader>
                <p className="text-sm text-muted-foreground">
                  A {words.one} that nothing else in the app points at is deleted for good and cannot be brought back. One with a transaction, a property, contacts, a requirement, an interaction, a CRM plan, a KYC file or other history is not deleted: a brand is hidden instead (it can be unhidden), and anything else is kept and listed with what holds it.
                </p>
                <div className="flex items-center justify-end gap-2">
                  <Input value={confirm} onChange={e => setConfirm(e.target.value)} placeholder={`Type ${n} to confirm`} className="h-8 text-sm max-w-[12rem]" autoFocus data-testid={`crm-bulk-confirm-${kind}`} />
                  <Button variant="outline" size="sm" onClick={close}>Cancel</Button>
                  <Button size="sm" variant="destructive" disabled={!n || confirm.trim() !== String(n) || remove.isPending} onClick={() => remove.mutate([...picked])} data-testid={`crm-bulk-apply-${kind}`}>
                    {remove.isPending ? "Deleting…" : `Delete ${n.toLocaleString("en-GB")}`}
                  </Button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
