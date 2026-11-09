import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ChatBGPMarkdown } from "@/components/chatbgp-markdown";
import { apiRequest } from "@/lib/queryClient";

// The all-staff "Gossip & market intel" channel in Messages (Woody,
// 2026-10-12): a strip on the thread saying who sees it, with a Summarise
// digest of the last week or month.
export const isGossipThread = (t: { linkedType?: string | null; linkedId?: string | null } | null | undefined) =>
  !!t && t.linkedType === "channel" && t.linkedId === "gossip";

export function GossipStrip() {
  const [result, setResult] = useState<{ summary: string; posts: number; from: string; to: string; days: number } | null>(null);
  const run = useMutation({
    mutationFn: async (days: number) => ({ ...(await (await apiRequest("POST", "/api/gossip/summary", { days })).json()), days }),
    onSuccess: (r) => setResult(r),
  });
  return (
    <div className="flex items-center justify-between gap-2 px-3 py-2 border-b bg-muted/40 text-xs" data-testid="gossip-strip">
      <span className="text-muted-foreground min-w-0">Everyone at BGP · people moves &amp; market intel · no phone alerts</span>
      <div className="flex items-center gap-1 shrink-0">
        {[7, 30].map(days => (
          <Button key={days} size="sm" variant="outline" className="h-7 rounded-full text-xs" disabled={run.isPending} onClick={() => run.mutate(days)} data-testid={`button-gossip-summary-${days}`}>
            {run.isPending && run.variables === days ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Sparkles className="w-3 h-3 mr-1" />}
            {days === 7 ? "Week" : "Month"}
          </Button>
        ))}
      </div>
      <Dialog open={!!result} onOpenChange={(o) => { if (!o) setResult(null); }}>
        <DialogContent className="max-w-xl max-h-[85dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Gossip &amp; market intel — last {result?.days === 30 ? "month" : "week"}</DialogTitle>
            <DialogDescription>{result?.posts ? `${result.posts} post${result.posts === 1 ? "" : "s"}, ${result.from} to ${result.to}. Summarised by ChatBGP — check anything important against the posts.` : ""}</DialogDescription>
          </DialogHeader>
          {result && <div className="text-sm"><ChatBGPMarkdown content={result.summary} /></div>}
        </DialogContent>
      </Dialog>
    </div>
  );
}
