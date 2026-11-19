// Deleting AML records after five years, on screen (Woody, 19 November
// 2026): the Nominated Officer or the Deputy previews what is due, ticks what
// goes and types DELETE. Nothing goes by itself. The rules are
// shared/aml-retention.ts; the routes server/aml-records-retention.ts.
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { RETENTION_CATEGORY_WORDS, RETENTION_CONFIRM_WORD, type RetentionCategory, type RetentionItem } from "@shared/aml-retention";

const plain = (e: unknown) => String((e as any)?.message || e || "").replace(/^\d{3}:\s*/, "").replace(/^\{"message":"(.*?)"(,.*)?\}$/, "$1");
const day = (iso: string | null | undefined) => (iso ? new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "");
const COUNT_WORDS: Record<string, string> = {
  kyc_documents: "documents", files: "stored files", kyc_investigations: "checks", kyc_upload_tokens: "client check requests", kyc_upload_files: "uploads",
  veriff_sessions: "identity checks", kyc4u_requests: "KYC4U rows", kyc4u_drafts: "KYC4U drafts", kyc_flag_reviews: "flags set aside",
  kyc_party_exemptions: "Not required marks", kyc_audit_log: "history lines", crm_entity_kyc: "company-that-signs records",
  aml_recheck_reminders: "re-check reminders", company_fields: "record fields",
};
const countsWords = (c?: Record<string, number>) => Object.entries(c || {}).map(([k, n]) => `${n} ${COUNT_WORDS[k] || k.replace(/_/g, " ")}`).join(", ");

export function AmlRetentionBoard() {
  const { toast } = useToast();
  const [ticked, setTicked] = useState<string[]>([]);
  const [confirm, setConfirm] = useState("");
  const preview = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/aml-retention/preview", {})).json() as Promise<{ cutoff: string; items: RetentionItem[]; keptParties: number }>,
    onSuccess: () => setTicked([]),
    onError: (e: any) => toast({ title: "Not worked out", description: plain(e), variant: "destructive" }),
  });
  const log = useQuery<{ entries: Array<{ id: number; at: string | null; by: string | null; category: RetentionCategory; itemId: string; counts: Record<string, number>; why: string | null }> }>({ queryKey: ["/api/aml-retention/log"] });
  const apply = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/aml-retention/apply", { ids: ticked, confirm })).json() as Promise<{ deleted: number; skipped: number; results: Array<{ id: string; deleted: boolean; why: string }> }>,
    onSuccess: r => {
      queryClient.invalidateQueries({ queryKey: ["/api/aml-retention/log"] });
      toast({ title: `${r.deleted} deleted`, description: r.skipped ? `${r.skipped} no longer due: ${r.results.filter(x => !x.deleted).map(x => x.why).slice(0, 3).join("; ")}` : undefined });
      setConfirm("");
      preview.mutate();
    },
    onError: (e: any) => toast({ title: "Not deleted", description: plain(e), variant: "destructive" }),
  });
  const items = preview.data?.items || [];
  const groups = (Object.keys(RETENTION_CATEGORY_WORDS) as RetentionCategory[]).map(c => ({ c, list: items.filter(i => i.category === c) })).filter(g => g.list.length);
  return (
    <div className="space-y-3" data-testid="aml-retention-board">
      <p className="text-sm text-muted-foreground">
        The Money Laundering Regulations keep due diligence for five years after the business relationship ends, then the personal data is deleted. A party is due only when its latest check is over five years old and every deal it was on ended over five years ago. Nothing goes by itself: preview, tick, then type {RETENTION_CONFIRM_WORD}. KYC4U keeps its own records; its next sync may copy back what it still holds.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="outline" disabled={preview.isPending} onClick={() => preview.mutate()} data-testid="aml-retention-preview">
          {preview.isPending && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}Preview what is due
        </Button>
        {preview.data && <span className="text-xs text-muted-foreground" data-testid="aml-retention-summary">Records from before {day(preview.data.cutoff)}: {items.length} due; {preview.data.keptParties} other parties with AML records are kept.</span>}
      </div>
      {preview.data && !items.length && <p className="text-sm text-muted-foreground" data-testid="aml-retention-none">Nothing is due for deletion.</p>}
      {groups.map(g => (
        <div key={g.c} className="space-y-1">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {RETENTION_CATEGORY_WORDS[g.c]} ({g.list.length})
            <button type="button" className="normal-case font-normal text-primary hover:underline" onClick={() => setTicked(prev => {
              const ids = g.list.map(i => i.id);
              return ids.every(id => prev.includes(id)) ? prev.filter(id => !ids.includes(id)) : [...new Set([...prev, ...ids])];
            })}>Tick all</button>
          </div>
          <ul className="divide-y rounded-lg border bg-card">
            {g.list.map(i => (
              <li key={i.id}>
                <label className="flex items-start gap-2 p-2 text-sm cursor-pointer">
                  <Checkbox checked={ticked.includes(i.id)} onCheckedChange={() => setTicked(prev => (prev.includes(i.id) ? prev.filter(x => x !== i.id) : [...prev, i.id]))} data-testid={`aml-retention-item-${i.id}`} />
                  <span className="min-w-0">
                    <span className="font-medium">{i.label}</span>
                    <span className="block text-xs text-muted-foreground">{i.why}{i.counts ? ` · ${countsWords(i.counts)}` : ""}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {!!items.length && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-red-300 bg-red-50 p-2.5 text-sm dark:bg-red-950/20">
          <span>Delete the {ticked.length} ticked for good. Type {RETENTION_CONFIRM_WORD}:</span>
          <Input value={confirm} onChange={e => setConfirm(e.target.value)} className="h-8 w-32" data-testid="aml-retention-confirm" />
          <Button type="button" size="sm" variant="destructive" disabled={!ticked.length || confirm !== RETENTION_CONFIRM_WORD || apply.isPending} onClick={() => apply.mutate()} data-testid="aml-retention-apply">
            {apply.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5 mr-1.5" />}Delete
          </Button>
        </div>
      )}
      {!!log.data?.entries.length && (
        <div className="space-y-1">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Deleted so far</div>
          <ul className="divide-y rounded-lg border bg-card text-xs" data-testid="aml-retention-log">
            {log.data.entries.slice(0, 30).map(e => (
              <li key={e.id} className="p-2">{day(e.at)}{e.by ? ` · ${e.by}` : ""} · {RETENTION_CATEGORY_WORDS[e.category] || e.category}{e.why ? ` · ${e.why}` : ""}{Object.keys(e.counts || {}).length ? ` · ${countsWords(e.counts)}` : ""}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
