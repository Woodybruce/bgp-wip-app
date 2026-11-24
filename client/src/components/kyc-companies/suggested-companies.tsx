// Suggested sub companies (Woody, 24 November 2026: "if we put the top
// company in then using our search facility to be able to have a suggestion
// of sub companies or linked companies? Not exhaustive but helpful prompts").
// Read only when asked (GET /api/client-kyc/:companyId/suggestions): each with
// why it is suggested; ticked ones are filed under the company through the
// billing entity route with no Xero contact. Nothing is checked until someone
// presses KYC. The rules are shared/kyc-suggestions.ts.
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2, RefreshCw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiRequest, getAuthHeaders } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { KycSuggestion } from "@shared/kyc-suggestions";

interface SuggestionsReply {
  top: { name: string; number: string | null } | null;
  suggestions: KycSuggestion[];
  sources: Array<{ source: string; read: boolean; words: string }>;
  readAt: string;
}

const errorText = (e: any) => { const m = String(e?.message || e || ""); try { const j = JSON.parse(m.slice(m.indexOf("{"))); return j.error || j.message || m; } catch { return m.replace(/^\d{3}:\s*/, ""); } };

export function SuggestedCompanies({ companyId, onAdded }: { companyId: string; onAdded: () => void }) {
  const { toast } = useToast();
  const [asked, setAsked] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const { data, isFetching, error } = useQuery<SuggestionsReply>({
    queryKey: ["/api/client-kyc", companyId, "suggestions", refresh],
    enabled: asked,
    retry: false,
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const res = await fetch(`/api/client-kyc/${encodeURIComponent(companyId)}/suggestions${refresh ? "?refresh=1" : ""}`, { credentials: "include", headers: getAuthHeaders() });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || `HTTP ${res.status}`);
      return res.json();
    },
  });
  const add = useMutation({
    mutationFn: async (list: KycSuggestion[]) => {
      const added: string[] = [];
      const failed: string[] = [];
      for (const s of list) {
        try {
          if (s.number) await apiRequest("POST", "/api/billing-entities", { brandId: companyId, companyNumber: s.number, xero: false });
          else if (s.country) await apiRequest("POST", "/api/billing-entities", { brandId: companyId, abroad: { name: s.name, country: s.country }, xero: false });
          else { failed.push(`${s.name}: no company number`); continue; }
          added.push(s.name);
        } catch (e) { failed.push(`${s.name}: ${errorText(e)}`); }
      }
      return { added, failed };
    },
    onSuccess: ({ added, failed }) => {
      setPicked(new Set());
      onAdded();
      setRefresh(n => n + 1);
      toast({
        title: added.length ? `${added.length} added as compan${added.length === 1 ? "y" : "ies"} to check` : "Nothing added",
        description: failed.length ? failed.slice(0, 3).join("; ") : "Press KYC on each to start its checks.",
        variant: failed.length && !added.length ? "destructive" : undefined,
      });
    },
  });

  if (!asked) {
    return (
      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setAsked(true)} data-testid="entities-suggest">
        <Sparkles className="w-3 h-3 mr-1" />Suggest the group's companies
      </Button>
    );
  }
  const list = data?.suggestions || [];
  const addable = (s: KycSuggestion) => !!(s.number || s.country);
  return (
    <div className="w-full rounded-md border bg-muted/20 p-2 space-y-1.5" data-testid="entities-suggestions">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium">Suggested companies{data?.top ? ` linked to ${data.top.name}` : ""}</span>
        <span className="text-[11px] text-muted-foreground">Prompts only: tick the ones that belong to the group.</span>
        <span className="ml-auto flex items-center gap-1">
          <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[11px]" disabled={isFetching} onClick={() => setRefresh(n => n + 1)} data-testid="entities-suggest-refresh">
            <RefreshCw className={`w-3 h-3 mr-1 ${isFetching ? "animate-spin" : ""}`} />Read again
          </Button>
          <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[11px]" onClick={() => { setAsked(false); setPicked(new Set()); }}>Close</Button>
        </span>
      </div>
      {isFetching && !data ? (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Loader2 className="w-3.5 h-3.5 animate-spin" />Reading Companies House, Land Registry and GLEIF…</p>
      ) : error ? (
        <p className="text-xs text-destructive">{errorText(error)}</p>
      ) : (
        <>
          {!list.length && <p className="text-xs text-muted-foreground" data-testid="entities-suggestions-none">Nothing more to suggest from these sources.</p>}
          {list.length > 0 && (
            <ul className="divide-y rounded-md border bg-background max-h-72 overflow-y-auto">
              {list.map(s => (
                <li key={s.key} className="flex items-start gap-2 px-2 py-1.5" data-testid={`entities-suggestion-${s.key}`}>
                  <input type="checkbox" className="mt-1 h-4 w-4 shrink-0 accent-primary" aria-label={`Add ${s.name}`} disabled={!addable(s)}
                    checked={picked.has(s.key)} onChange={e => setPicked(prev => { const n = new Set(prev); if (e.target.checked) n.add(s.key); else n.delete(s.key); return n; })} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-medium break-words">
                      {s.name}
                      {s.number && <span className="ml-1.5 font-mono font-normal text-muted-foreground">{s.number}</span>}
                      {!s.number && s.country && <span className="ml-1.5 font-normal text-muted-foreground">{s.country}</span>}
                    </span>
                    <span className="block text-[11px] text-muted-foreground">{s.reasons.join(" · ")}</span>
                    {!addable(s) && <span className="block text-[11px] text-amber-700 dark:text-amber-300">No company number: add it with Add a company</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {list.length > 0 && (
              <Button size="sm" className="h-7 text-xs" disabled={!picked.size || add.isPending}
                onClick={() => add.mutate(list.filter(s => picked.has(s.key)))} data-testid="entities-suggestions-add">
                {add.isPending && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}Add {picked.size || ""} to check
              </Button>
            )}
            <span className="text-[11px] text-muted-foreground">{(data?.sources || []).map(x => x.words).join(" · ")}</span>
          </div>
        </>
      )}
    </div>
  );
}
