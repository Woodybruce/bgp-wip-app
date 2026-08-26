import { useQuery, useMutation } from "@tanstack/react-query";
import { Sparkles, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getAuthHeaders, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type Tab = "brand" | "uk" | "activity" | "intel";

const TAB_LABELS: Record<Tab, string> = {
  brand: "BGP take — who they are",
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
export function BgpTakeStrip({ companyId, tab, intro }: { companyId: string; tab: Tab; intro?: string | null }) {
  const { toast } = useToast();
  const queryKey = ["/api/brand", companyId, "ai-take", tab];

  const { data, isLoading, isError, error } = useQuery<{ text: string; cached: boolean; generatedAt: number }>({
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
          <p className="text-sm leading-snug text-foreground/85 whitespace-pre-wrap">{intro}</p>
          <div className="border-t border-border/60 my-2" />
        </>
      )}
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
          <Sparkles className="w-3 h-3 text-primary" /> {TAB_LABELS[tab]}
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="h-5 w-5 p-0"
          onClick={() => refresh.mutate()}
          disabled={refresh.isPending || isLoading}
          title="Refresh AI take"
        >
          <RefreshCw className={`w-3 h-3 ${refresh.isPending ? "animate-spin" : ""}`} />
        </Button>
      </div>
      {isLoading ? (
        <p className="text-xs text-muted-foreground italic">Generating BGP take…</p>
      ) : isError ? (
        <p className="text-xs text-muted-foreground italic">{friendlyTakeError((error as any)?.message)}</p>
      ) : data?.text ? (
        <p className="text-xs leading-snug text-foreground/90 whitespace-pre-wrap">{data.text}</p>
      ) : (
        <p className="text-xs text-muted-foreground italic">No take available.</p>
      )}
    </div>
  );
}
