import { useQuery, useMutation } from "@tanstack/react-query";
import { Sparkles, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getAuthHeaders, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { AiCommentary, type CommentaryEntity } from "@/components/ai-commentary";

type Tab = "brand" | "uk" | "activity" | "intel";

const TAB_LABELS: Record<Tab, string> = {
  brand: "BGP take — next action",
  uk: "BGP take — covenant verdict",
  activity: "BGP take — relationship read",
  intel: "BGP take — what's changed",
};

// The query throws the raw response body, which for API errors is a JSON
// blob — `{"error":"AI take unavailable…"}` was rendering verbatim in the
// strip. Unwrap it to the message alone.
function friendlyTakeError(raw?: string): string {
  if (!raw) return "Unable to generate take.";
  try {
    const parsed = JSON.parse(raw);
    return parsed.error || parsed.message || "Unable to generate take.";
  } catch {
    return raw;
  }
}

// `intro` merges the company description into the same card as the take —
// one continuous read instead of two stacked blocks saying similar things
// (Woody, 2026-08-25: "the BGP take and the intro should be combined").
export function BgpTakeStrip({ companyId, tab, intro, entities }: { companyId: string; tab: Tab; intro?: string | null; entities?: CommentaryEntity[] }) {
  const { toast } = useToast();
  const queryKey = ["/api/brand", companyId, "ai-take", tab];

  const { data, isLoading, isError, error } = useQuery<{ text: string; cached: boolean; generatedAt: number; pending?: boolean; stale?: boolean }>({
    queryKey,
    queryFn: async () => {
      const r = await fetch(`/api/brand/${companyId}/ai-take/${tab}`, {
        credentials: "include",
        headers: getAuthHeaders(),
      });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const refresh = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/brand/${companyId}/ai-take/${tab}?refresh=1`, {
        credentials: "include",
        headers: getAuthHeaders(),
      });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    onSuccess: (out) => {
      queryClient.setQueryData(queryKey, out);
      toast({ title: "BGP take refreshed" });
    },
    onError: (e: any) => toast({ title: "Refresh failed", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="rounded-md border border-border bg-muted/40 p-2.5">
      {intro && (
        <>
          <AiCommentary text={intro} entities={entities} size="sm" />
          <div className="border-t border-border/60 my-2" />
        </>
      )}
      <div className="flex items-center justify-between mb-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-medium text-muted-foreground">
          <Sparkles className="w-3 h-3 text-primary" /> {TAB_LABELS[tab]}
          {!!data?.generatedAt && <span className="font-normal">· {new Date(data.generatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}{data.stale ? " · Update pending" : ""}</span>}
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="min-h-8 min-w-8 p-1"
          onClick={() => refresh.mutate()}
          disabled={refresh.isPending || isLoading}
          title="Refresh AI take"
          aria-label="Refresh BGP take"
        >
          <RefreshCw className={`w-3 h-3 ${refresh.isPending ? "animate-spin" : ""}`} />
        </Button>
      </div>
      {isLoading ? (
        <div className="space-y-2 animate-pulse" aria-label="Loading saved BGP take"><div className="h-3 rounded bg-muted" /><div className="h-3 w-3/4 rounded bg-muted" /></div>
      ) : isError ? (
        <p className="text-xs text-muted-foreground italic">{friendlyTakeError((error as any)?.message)}</p>
      ) : data?.text ? (
        <AiCommentary text={data.text} entities={entities} />
      ) : (
        <p className="text-sm text-muted-foreground">The BGP brief has not been prepared yet. Saved facts remain available above.</p>
      )}
    </div>
  );
}
