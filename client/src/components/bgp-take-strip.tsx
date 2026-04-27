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

export function BgpTakeStrip({ companyId, tab }: { companyId: string; tab: Tab }) {
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
    <div className="rounded-md border border-purple-200 dark:border-purple-900 bg-purple-50/60 dark:bg-purple-950/30 p-2.5">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-1 text-[11px] font-medium text-purple-700 dark:text-purple-300">
          <Sparkles className="w-3 h-3" /> {TAB_LABELS[tab]}
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="h-5 w-5 p-0 text-purple-600 hover:text-purple-700"
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
        <p className="text-xs text-muted-foreground italic">{(error as any)?.message || "Unable to generate take."}</p>
      ) : data?.text ? (
        <p className="text-xs leading-snug text-foreground/90 whitespace-pre-wrap">{data.text}</p>
      ) : (
        <p className="text-xs text-muted-foreground italic">No take available.</p>
      )}
    </div>
  );
}
