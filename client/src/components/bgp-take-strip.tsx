import type React from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Sparkles, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getAuthHeaders, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { AiCommentary, type CommentaryEntity } from "@/components/ai-commentary";

type Tab = "brand" | "uk" | "activity" | "intel";
type TakeResponse = { text?: string; cached?: boolean; generatedAt?: number; pending?: boolean; stale?: boolean; reason?: string; running?: boolean; status?: string };
type TakeTarget = { companyId: string; tab: Tab };

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
export function BgpTakeStrip({ companyId, tab, intro, entities, hideWhenEmpty, footer }: { companyId: string; tab: Tab; intro?: string | null; entities?: CommentaryEntity[]; hideWhenEmpty?: boolean; footer?: React.ReactNode }) {
  const { toast } = useToast();
  const queryKey = ["/api/brand", companyId, "ai-take", tab];
  const [refreshError, setRefreshError] = useState<(TakeTarget & { message: string }) | null>(null);

  const { data, isLoading, isError, error } = useQuery<TakeResponse>({
    queryKey,
    queryFn: async ({ signal }) => {
      const r = await fetch(`/api/brand/${companyId}/ai-take/${tab}`, {
        credentials: "include",
        headers: getAuthHeaders(),
        signal,
      });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    staleTime: 5 * 60 * 1000,
    retry: false,
    refetchInterval: query => query.state.status !== "error" && (query.state.data?.running || query.state.data?.status === "running") ? 5_000 : false,
  });

  const refresh = useMutation({
    onMutate: async (target: TakeTarget) => {
      setRefreshError(null);
      await queryClient.cancelQueries({ queryKey: ["/api/brand", target.companyId, "ai-take", target.tab] });
    },
    mutationFn: async (target: TakeTarget): Promise<TakeResponse> => {
      const r = await fetch(`/api/brand/${target.companyId}/ai-take/${target.tab}?refresh=1`, {
        credentials: "include",
        headers: getAuthHeaders(),
      });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    onSuccess: (out, target) => {
      queryClient.setQueryData(["/api/brand", target.companyId, "ai-take", target.tab], out);
      const running = out.running || out.status === "running";
      if (typeof out.text === "string" && out.text.trim() && !out.pending && !out.reason && !running) {
        toast({ title: "BGP take refreshed" });
      } else if (!running) {
        toast({ title: "BGP take not refreshed", description: out.reason || "No prepared brief was returned. Saved facts remain available above." });
      }
    },
    onError: (e: Error, target) => {
      const message = friendlyTakeError(e.message);
      setRefreshError({ ...target, message });
      toast({ title: "Refresh failed", description: message, variant: "destructive" });
    },
  });
  const refreshing = refresh.isPending && refresh.variables?.companyId === companyId && refresh.variables.tab === tab;
  const running = !isError && (!!data?.running || data?.status === "running");
  const text = typeof data?.text === "string" ? data.text.trim() : "";
  const currentRefreshError = refreshError?.companyId === companyId && refreshError.tab === tab ? refreshError.message : "";
  const reason = currentRefreshError || (isError ? friendlyTakeError((error as Error)?.message) : data?.reason);
  const status = reason || (running ? "Preparing the BGP brief. This section will update when it is ready." : data?.pending && text ? "An updated BGP brief is not ready yet." : !text && !isLoading ? "The BGP take has not been prepared yet." : "");

  if (hideWhenEmpty && !isLoading && !text && !running && !refreshing && !currentRefreshError && !intro) return null;

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
          onClick={() => refresh.mutate({ companyId, tab })}
          disabled={refreshing || running || isLoading}
          title="Refresh AI take"
          aria-label="Refresh BGP take"
        >
          <RefreshCw className={`w-3 h-3 ${refreshing || running ? "animate-spin" : ""}`} />
        </Button>
      </div>
      {isLoading ? (
        <div className="space-y-2 animate-pulse" aria-label="Loading saved BGP take"><div className="h-3 rounded bg-muted" /><div className="h-3 w-3/4 rounded bg-muted" /></div>
      ) : text ? <AiCommentary text={text} entities={entities} /> : null}
      {status && <p role="status" aria-live="polite" className={`text-sm text-muted-foreground${text ? " mt-2" : ""}`} data-testid="bgp-take-status">{status}</p>}
      {footer && <div className="border-t border-border/60 mt-2.5 pt-2.5 space-y-2" data-testid="bgp-take-footer">{footer}</div>}
    </div>
  );
}
