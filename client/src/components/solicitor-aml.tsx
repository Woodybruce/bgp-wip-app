// The other side's solicitors on a deal, checked against the SRA register and
// the web with sources (Woody, 21 November 2026, "do 7"; BGP's AML policy,
// counterparties). The rules are shared/solicitor-aml.ts; the routes
// server/solicitor-aml.ts. BGP staff only.
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ExternalLink, Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { solicitorCheckWords, type SolicitorCheck } from "@shared/solicitor-aml";

export interface DealSolicitorsAml { dealId: string; onDeal: string | null; checks: Array<SolicitorCheck & { id: string; by: string | null }> }

const keyFor = (dealId: string) => ["/api/deals", dealId, "solicitors-aml"];

export function useDealSolicitorsAml(dealId: string, enabled = true) {
  return useQuery<DealSolicitorsAml>({ queryKey: keyFor(dealId), enabled: enabled && !!dealId, staleTime: 60_000 });
}

/** The section's line: the latest check's words, or what is missing. */
export function solicitorsSummary(data: DealSolicitorsAml | undefined): { tone: "done" | "act" | "flag" | "info"; words: string } {
  if (!data) return { tone: "info", words: "Not read yet" };
  if (!data.checks.length) return { tone: "act", words: data.onDeal ? `${data.onDeal} on the deal: not checked yet` : "Add the other side's solicitors and check them" };
  const lines = data.checks.map(solicitorCheckWords);
  const worst = lines.some(l => l.tone === "attention") ? "flag" : lines.some(l => l.tone === "info") ? "act" : "done";
  return { tone: worst, words: data.checks.length === 1 ? lines[0].words : `${data.checks.length} firms checked${worst === "flag" ? " · one needs a look" : ""}` };
}

const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" });

export function DealSolicitorsAmlPanel({ dealId }: { dealId: string }) {
  const { toast } = useToast();
  const { data } = useDealSolicitorsAml(dealId);
  const [firm, setFirm] = useState("");
  const check = useMutation({
    mutationFn: async (name: string) => (await apiRequest("POST", `/api/deals/${dealId}/solicitors-aml/check`, { firm: name })).json(),
    onSuccess: () => { setFirm(""); queryClient.invalidateQueries({ queryKey: keyFor(dealId) }); },
    onError: (e: any) => toast({ title: "Not checked", description: String(e?.message || e).replace(/^\d+:\s*/, ""), variant: "destructive" }),
  });
  if (!data) return null;
  const checkedNames = new Set(data.checks.map(c => c.firm.toLowerCase()));
  return (
    <div className="space-y-2 text-xs" data-testid="deal-solicitors-aml">
      <p className="text-muted-foreground">BGP's AML policy asks whether the other side has solicitors, and whether there is negative media about them. The check reads the SRA register (and the Law Society's Find a Solicitor) and searches the web for regulatory action or misconduct; it keeps only what a source it read says.</p>
      {data.onDeal && !checkedNames.has(data.onDeal.toLowerCase()) && (
        <div className="flex flex-wrap items-center gap-2">
          <span>On the deal: <span className="font-medium">{data.onDeal}</span></span>
          <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={check.isPending} onClick={() => check.mutate(data.onDeal!)} data-testid="solicitors-check-on-deal">
            {check.isPending && check.variables === data.onDeal ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Search className="w-3 h-3 mr-1" />}Check them
          </Button>
        </div>
      )}
      {data.checks.map(c => {
        const w = solicitorCheckWords(c);
        return (
          <div key={c.id} className={`rounded border px-2 py-1.5 space-y-1 ${w.tone === "attention" ? "border-red-300 bg-red-50/60 dark:border-red-900 dark:bg-red-950/20" : ""}`} data-testid={`solicitor-check-${c.id}`}>
            <p className={w.tone === "attention" ? "text-red-800 dark:text-red-300" : ""}>{w.words}</p>
            {c.register.url && <a href={c.register.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">Register page <ExternalLink className="w-3 h-3" /></a>}
            {c.register.office && <p className="text-muted-foreground">Office: {c.register.office}</p>}
            {c.media.findings.length > 0 && (
              <ul className="space-y-0.5">
                {c.media.findings.map(f => (
                  <li key={f.url}>{f.summary}{f.unsureIdentity ? <span className="text-muted-foreground"> (may be another firm)</span> : null} · <a href={f.url} target="_blank" rel="noreferrer" className="text-primary hover:underline">{f.source}</a>{f.date ? <span className="text-muted-foreground">, {f.date}</span> : null}</li>
                ))}
              </ul>
            )}
            {c.errors.length > 0 && <p className="text-amber-800 dark:text-amber-300">{c.errors.join(" ")}</p>}
            <p className="text-[11px] text-muted-foreground">Checked {day(c.ranAt)}{c.by ? ` by ${c.by}` : ""} ·{" "}
              <button type="button" className="underline" disabled={check.isPending} onClick={() => check.mutate(c.firm)}>Check again</button></p>
          </div>
        );
      })}
      <div className="flex flex-wrap items-center gap-1.5">
        <Input value={firm} onChange={e => setFirm(e.target.value)} placeholder="The other side's solicitors (firm name)" className="h-8 max-w-xs text-xs" data-testid="solicitors-firm-input"
          onKeyDown={e => { if (e.key === "Enter" && firm.trim().length >= 3) check.mutate(firm.trim()); }} />
        <Button size="sm" variant="outline" className="h-8 px-2 text-xs" disabled={firm.trim().length < 3 || check.isPending} onClick={() => check.mutate(firm.trim())} data-testid="solicitors-check">
          {check.isPending && check.variables === firm.trim() ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Search className="w-3 h-3 mr-1" />}Check
        </Button>
        {check.isPending && <span className="text-muted-foreground">Searching the SRA register and the web: about a minute.</span>}
      </div>
    </div>
  );
}
